// Live sale flow: amount entry → start dispense → poll status → finalize
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import Keypad from "../../src/Keypad";
import { COLORS, FUEL_COLORS, RADIUS, fmtMNT } from "../../src/theme";
import { flux, FUEL_GRADE_LABELS } from "../../src/fluxApi";
import { paxCharge, paxConfig, paxReadCard, paxQpay, PaxResult, PaxQpayResult } from "../../src/paxPayment";
import { dispenseCtx } from "../../src/dispenseContext";
import { printReceipt } from "../../src/printReceipt";
import QRCode from "react-native-qrcode-svg";

type Step = "amount" | "card" | "prepay-pay" | "prepay-receipt" | "dispense" | "finalize";
type DoseType = "Amount" | "Volume" | "FullTank";
type PaymentFlow = "prepay" | "postpay";

// Prepay → Receipt → Dispense дамжуулагч (төлбөр амжилттай авагдсаны дараа
// дотроо хадгалж байх state). Шахалт эхлэхэд бэлэн бэлдэц.
type PendingPrepay = {
  method: "cash" | "bank_card" | "qpay" | "fuel_card" | "split";
  amount: number;
  approval_code?: string;
  rrn?: string;
  masked_pan?: string;
  qpay_invoice_id?: string;
  qpay_payment_id?: string;
  // 🆕 Хуваан төлсөн үед бүх legs (2+)
  splits?: Array<{
    method: "cash" | "bank_card" | "qpay" | "fuel_card";
    amount: number;
    approval_code?: string;
    rrn?: string;
    masked_pan?: string;
    qpay_invoice_id?: string;
  }>;
};

const PAYMENT_METHODS = [
  { id: "cash", label: "Бэлэн", icon: "cash-multiple" },
  { id: "bank_card", label: "Банк карт", icon: "credit-card-outline" },
  { id: "qpay", label: "QPay", icon: "qrcode-scan" },
  { id: "fuel_card", label: "Шатахуун карт", icon: "card-account-details-outline" },
] as const;

const VAT_TYPES: Array<"Иргэн" | "Бараа худалдан авагч" | "Байгууллага"> = ["Иргэн", "Бараа худалдан авагч", "Байгууллага"];

export default function LiveSale() {
  const params = useLocalSearchParams<{ pump: string; nozzle?: string; fuel_grade_id?: string; fuel?: string; resumeHold?: string }>();
  const router = useRouter();
  const pump = parseInt(params.pump || "0", 10);
  const nozzle = params.nozzle ? parseInt(params.nozzle, 10) : undefined;
  const fuelGradeId = params.fuel_grade_id ? parseInt(params.fuel_grade_id, 10) : undefined;
  const fuelLabel = params.fuel || (fuelGradeId ? FUEL_GRADE_LABELS[fuelGradeId] : "");

  const [step, setStep] = useState<Step>("amount");
  const [holdId, setHoldId] = useState<string | null>(null); // resume хийсэн hold-ийн id (delete-д ашиглана)
  const [holding, setHolding] = useState(false);

  // Step 1: amount
  const [doseType, setDoseType] = useState<DoseType>("Amount");
  const [input, setInput] = useState("");

  // 🆕 Payment flow auto-derived from doseType:
  //   - Amount/Volume → prepay (төлбөр эхлээд)
  //   - FullTank → postpay (шахалт дууссаны дараа төлбөр)
  const paymentFlow: PaymentFlow = doseType === "FullTank" ? "postpay" : "prepay";

  // 🆕 Step 1.5: prepay-pay (Amount/Volume үед эхлээд төлбөрөө цуглуулна)
  const [prepayMethod, setPrepayMethod] = useState<"cash" | "bank_card" | "qpay" | "fuel_card">("cash");
  const [prepayStatus, setPrepayStatus] = useState<"idle" | "charging" | "approved" | "declined">("idle");
  const [prepayBankApproval, setPrepayBankApproval] = useState<string>("");
  const [prepayBankRrn, setPrepayBankRrn] = useState<string>("");
  const [prepayBankMaskedPan, setPrepayBankMaskedPan] = useState<string>("");
  const [prepayQpayInvoice, setPrepayQpayInvoice] = useState<string>("");
  const [prepayQpayPaymentId, setPrepayQpayPaymentId] = useState<string>("");

  // 🆕 Prepay Split (хуваан төлөх) — 2 төрлийн төлбөрийг нэг үйлчилгээнд
  type SplitLeg = {
    method: "cash" | "bank_card" | "qpay" | "fuel_card";
    amount: number;
    approval_code?: string;
    rrn?: string;
    masked_pan?: string;
    qpay_invoice_id?: string;
    qpay_payment_id?: string;
    paid: boolean; // карт/qpay-ийн хувьд аль хэдийн уншигдсан эсэх
  };
  const [prepaySplitMode, setPrepaySplitMode] = useState(false);
  const [prepayFirstAmountStr, setPrepayFirstAmountStr] = useState("");
  const [prepaySecondMethod, setPrepaySecondMethod] = useState<"cash" | "bank_card" | "qpay" | "fuel_card">("bank_card");
  const [splitLeg1, setSplitLeg1] = useState<SplitLeg | null>(null);
  const [splitLeg2, setSplitLeg2] = useState<SplitLeg | null>(null);

  // 🆕 Step 1.7: prepay-receipt (НӨАТ оруулж, баримт хэвлэгдэн шахалт эхэлнэ)
  const [pendingPrepay, setPendingPrepay] = useState<PendingPrepay | null>(null);

  // Step 2: card
  const [card, setCard] = useState<any>(null);

  // Step 3: dispense
  const [commandId, setCommandId] = useState<number | null>(null);
  const [dispense, setDispense] = useState<any>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<any>(null);
  const [transaction, setTransaction] = useState<any>(null);
  // Strategy A: EOT state-д snapshot-аар pseudo-transaction үүсгэж receipt
  // дэлгэцийг урьтаж нээнэ. transaction.id хараахан ирээгүй учир finalize
  // товч disabled байх ба `completed` ирэхэд бодит transaction-аар update.
  const [awaitingTxId, setAwaitingTxId] = useState(false);
  const [presetDose, setPresetDose] = useState<number | null>(null);

  // Step 4: finalize
  const [paymentMethod, setPaymentMethod] = useState<typeof PAYMENT_METHODS[number]["id"]>("cash");
  const [vatType, setVatType] = useState<"Иргэн" | "Бараа худалдан авагч" | "Байгууллага">("Иргэн");
  const [vatRegister, setVatRegister] = useState("");
  const [vatReceipt, setVatReceipt] = useState("");
  const [bankApproval, setBankApproval] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  // PAX A8900 / EPOS SDK төлөв
  const [paxStatus, setPaxStatus] = useState<"idle" | "charging" | "approved" | "declined">("idle");
  const [paxResult, setPaxResult] = useState<PaxResult | null>(null);

  // QPay (EPOS QR төлбөр) төлөв
  const [qpayStatus, setQpayStatus] = useState<"idle" | "charging" | "approved" | "declined">("idle");
  const [qpayResult, setQpayResult] = useState<PaxQpayResult | null>(null);

  // Шатахуун карт төлөв
  const [cardStatus, setCardStatus] = useState<"idle" | "scanning" | "found" | "not_found" | "invalid">("idle");
  const [cardError, setCardError] = useState<string | null>(null);

  // Хэсэгчилсэн (split) төлбөр — дээд тал нь 2 төрөл
  const [splitMode, setSplitMode] = useState(false);
  const [secondMethod, setSecondMethod] = useState<typeof PAYMENT_METHODS[number]["id"]>("bank_card");
  const [firstAmount, setFirstAmount] = useState<string>("");
  // Тооцоо: line 1 = primary method (firstAmount), line 2 = secondMethod (үлдсэн)
  const totalAmount = Math.round(transaction?.total_amount || 0);
  const line1Amount = splitMode ? Math.max(0, Math.min(totalAmount, Math.round(parseFloat(firstAmount || "0") || 0))) : totalAmount;
  const line2Amount = splitMode ? Math.max(0, totalAmount - line1Amount) : 0;
  // PAX charge хийх дүн (bank_card line аль талд байгаагаас хамаарна)
  const bankChargeAmount =
    paymentMethod === "bank_card" ? line1Amount
    : (splitMode && secondMethod === "bank_card") ? line2Amount
    : 0;
  // Шатахуун карт line-ийн дүн
  const fuelCardAmount =
    paymentMethod === "fuel_card" ? line1Amount
    : (splitMode && secondMethod === "fuel_card") ? line2Amount
    : 0;
  // Аль ч талд bank_card / fuel_card / qpay байгаа эсэх
  const hasBankLine = paymentMethod === "bank_card" || (splitMode && secondMethod === "bank_card");
  const hasFuelLine = paymentMethod === "fuel_card" || (splitMode && secondMethod === "fuel_card");
  const hasQpayLine = paymentMethod === "qpay" || (splitMode && secondMethod === "qpay");
  const qpayChargeAmount =
    paymentMethod === "qpay" ? line1Amount
    : (splitMode && secondMethod === "qpay") ? line2Amount
    : 0;

  // Generate fake e-Barimt number (33 digit billId style)
  const generateNoat = () => {
    const ts = Date.now().toString();
    const rnd = Math.random().toString().slice(2, 12).padEnd(10, "0");
    return ("DD" + ts + rnd).slice(0, 33).toUpperCase();
  };

  // Resume from a saved hold
  useEffect(() => {
    if (!params.resumeHold) return;
    (async () => {
      try {
        const list = await flux.holds.list();
        const found = list.items.find((it) => it.hold_id === params.resumeHold);
        if (!found) {
          Alert.alert("Хүлээлгэсэн гүйлгээ", "Олдсонгүй эсвэл хугацаа дууссан");
          router.replace("/live/dashboard");
          return;
        }
        const p = found.payload || {};
        setHoldId(found.hold_id);
        // restore state
        if (p.transaction) setTransaction(p.transaction);
        if (p.paymentMethod) setPaymentMethod(p.paymentMethod);
        if (p.vatType) setVatType(p.vatType);
        if (p.vatRegister !== undefined) setVatRegister(p.vatRegister || "");
        if (p.vatReceipt !== undefined) setVatReceipt(p.vatReceipt || "");
        if (p.bankApproval !== undefined) setBankApproval(p.bankApproval || "");
        if (p.paxStatus) setPaxStatus(p.paxStatus);
        if (p.paxResult) setPaxResult(p.paxResult);
        if (p.qpayStatus) setQpayStatus(p.qpayStatus);
        if (p.qpayResult) setQpayResult(p.qpayResult);
        if (p.cardStatus) setCardStatus(p.cardStatus);
        if (p.card) setCard(p.card);
        if (p.splitMode) setSplitMode(!!p.splitMode);
        if (p.secondMethod) setSecondMethod(p.secondMethod);
        if (p.firstAmount !== undefined) setFirstAmount(String(p.firstAmount || ""));
        setStep("finalize");
      } catch (e: any) {
        Alert.alert("Алдаа", e?.message || "Hold ачааллахад алдаа");
        router.replace("/live/dashboard");
      }
    })();
  }, [params.resumeHold]);

  // ----- HOLD (Хүлээлгэх) — гүйлгээг түр өлгөж дашбоард руу буцах -----
  const onHold = async () => {
    if (!transaction) return;
    if (awaitingTxId || !transaction.id) {
      Alert.alert("Хүлээгээрэй", "Транзакцийн дугаар хараахан ирээгүй. Хошуу буусны дараа дахин оролдоно уу.");
      return;
    }
    setHolding(true);
    try {
      const payload = {
        tx_id: transaction.id,
        total: transaction.total_amount,
        liters: transaction.volume_liters,
        fuel_grade_name: transaction.fuel_grade_name || fuelLabel,
        pump,
        nozzle,
        transaction,
        paymentMethod, vatType, vatRegister, vatReceipt, bankApproval,
        paxStatus, paxResult, qpayStatus, qpayResult,
        cardStatus, card,
        splitMode, secondMethod, firstAmount,
        saved_at: new Date().toISOString(),
      };
      // Хэрэв одоо resume-той үед hold-ыг шинээр хадгалж старыг устгана
      if (holdId) {
        try { await flux.holds.remove(holdId); } catch (_) {}
      }
      await flux.holds.save(payload);
      router.replace("/live/dashboard");
    } catch (e: any) {
      Alert.alert("Хүлээлгэх боломжгүй", e?.message || "Алдаа гарлаа");
    } finally {
      setHolding(false);
    }
  };

  // 🆕 Prepay горимд (шахалт хараахан эхлээгүй үед) Хүлээлгэх — оруулсан дүн,
  // сонгосон төлбөрийн арга зэргийг түр хадгална. Дашбоард-аас resume хийхэд
  // ижил step руу буцаж очно. Эндээс /api/flux/holds endpoint-руу tx_id-гүй
  // hold явуулна.
  const onPrepayHold = async () => {
    setHolding(true);
    try {
      const payload: any = {
        tx_id: null, // prepay-д tx үүсээгүй
        total: doseType === "Amount" ? numeric : null,
        liters: doseType === "Volume" ? numeric : null,
        fuel_grade_name: fuelLabel,
        pump,
        nozzle,
        transaction: null,
        paymentMethod: prepayMethod,
        vatType, vatRegister, vatReceipt, bankApproval: prepayBankApproval,
        prepay_pending: true,
        prepay_dose_type: doseType,
        prepay_dose: numeric,
        prepay_method: prepayMethod,
        prepay_status: prepayStatus,
        cardStatus, card,
        saved_at: new Date().toISOString(),
      };
      if (holdId) {
        try { await flux.holds.remove(holdId); } catch (_) {}
      }
      await flux.holds.save(payload);
      router.replace("/live/dashboard");
    } catch (e: any) {
      Alert.alert("Хүлээлгэх боломжгүй", e?.message || "Алдаа гарлаа");
    } finally {
      setHolding(false);
    }
  };

  // On entering finalize step in DEMO mode, auto-fill the receipt number
  useEffect(() => {
    if ((step === "finalize" || step === "prepay-receipt") && !vatReceipt) {
      (async () => {
        try {
          const me = await flux.me();
          setIsDemo(!!me.is_demo);
          if (me.is_demo) setVatReceipt(generateNoat());
        } catch (_) {}
      })();
    }
  }, [step]);

  // 🆕 Prepay-аар хийгдсэн гүйлгээний хувьд finalize state-г автоматаар бөглөнө
  // — хэрэглэгч "Гүйлгээ баталгаажуулах" товчийг нэг л дарж дуусгана.
  useEffect(() => {
    if (step !== "finalize") return;
    if (paymentFlow !== "prepay") return;
    if (prepayStatus !== "approved" && prepayMethod !== "cash") return;
    // payment method-ыг prepay-ийн method-той ижил тохируулна
    setPaymentMethod(prepayMethod);
    if (prepayMethod === "bank_card") {
      setBankApproval(prepayBankApproval || "");
    }
    setSplitMode(false);
  }, [step, paymentFlow]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ----- amount step -----
  // 🆕 POS физик товчлуурын дэмжлэгийн тулд нуугдсан TextInput-руу autoFocus
  // хийнэ. Software keyboard гарахгүй (showSoftInputOnFocus=false).
  // Hardware key event-ийг авч onChangeText-руу дамжуулна.
  const amountInputRef = useRef<any>(null);
  const refocusAmount = () => {
    // requestAnimationFrame – Keypad дарсны дараа фокус хадгалах
    setTimeout(() => amountInputRef.current?.focus?.(), 30);
  };
  const handleDigit = (d: string) => {
    if (input.length >= 10) return;
    if (d === "." && input.includes(".")) return;
    if (d === "." && input.length === 0) { setInput("0."); refocusAmount(); return; }
    setInput(input + d);
    refocusAmount();
  };
  const handleBack = () => { setInput((p) => p.slice(0, -1)); refocusAmount(); };

  // POS-аас irsen physic key string-г цэвэрлэнэ (зөвхөн 0-9, .).
  const onAmountChangeText = (raw: string) => {
    let cleaned = "";
    let hasDot = false;
    for (const ch of raw) {
      if (ch >= "0" && ch <= "9") cleaned += ch;
      else if (ch === "." && !hasDot) { cleaned += "."; hasDot = true; }
    }
    if (cleaned.length > 10) cleaned = cleaned.slice(0, 10);
    setInput(cleaned);
  };

  const numeric = parseFloat(input || "0");

  const onStartDispense = async (opts?: {
    prepayment?: { method: "cash" | "bank_card" | "qpay"; amount: number;
                   bank_approval_code?: string; bank_rrn?: string; bank_masked_pan?: string;
                   qpay_invoice_id?: string; qpay_payment_id?: string };
  }) => {
    if (doseType !== "FullTank" && numeric <= 0) {
      Alert.alert("Алдаа", "Дүн оруулна уу"); return;
    }
    setStep("dispense");
    setAwaitingTxId(false);
    setTransaction(null);
    setDispense(null);
    // Preset дүнг хадгалж progress bar-д ашиглана
    setPresetDose(doseType !== "FullTank" ? numeric : null);
    try {
      const res = await flux.startDispense({
        pump,
        nozzle,
        fuel_grade_id: fuelGradeId,
        dose_type: doseType,
        dose: doseType === "FullTank" ? undefined : numeric,
        card_id: card?.card_id,
        nfc_tag: card?.nfc_tag,
        // 🆕 Prepay flow — Flux API V2 шаардлагатай talбар (backward-compat)
        payment_flow: opts?.prepayment ? "prepay" : "postpay",
        prepayment: opts?.prepayment ? {
          amount: opts.prepayment.amount,
          method: opts.prepayment.method,
          bank_approval_code: opts.prepayment.bank_approval_code,
          bank_rrn: opts.prepayment.bank_rrn,
          bank_masked_pan: opts.prepayment.bank_masked_pan,
          qpay_invoice_id: opts.prepayment.qpay_invoice_id,
          qpay_payment_id: opts.prepayment.qpay_payment_id,
        } : undefined,
      });
      setCommandId(res.command_id);
      startPolling(res.command_id);
    } catch (e: any) {
      Alert.alert("Шахалт эхлэхэд алдаа гарлаа", e.message);
      setStep(opts?.prepayment ? "prepay-pay" : "amount");
    }
  };

  // 🆕 "Шахалт эхлүүлэх" товч дарах үед хийх алхам:
  //   - FullTank (Бак дүүрэн) → шахалт шууд эхэлж дараа нь төлбөр (postpay)
  //   - Amount/Volume → эхлээд төлбөр цуглуулна (prepay), дараа нь шахалт
  const onAdvanceFromAmount = () => {
    if (doseType !== "FullTank" && numeric <= 0) {
      Alert.alert("Алдаа", "Дүн оруулна уу"); return;
    }
    if (paymentFlow === "prepay") {
      // Reset prepay state and go to payment screen
      setPrepayStatus("idle");
      setPrepayBankApproval("");
      setPrepayBankRrn("");
      setPrepayBankMaskedPan("");
      setPrepayQpayInvoice("");
      setPrepayQpayPaymentId("");
      setPendingPrepay(null);
      setStep("prepay-pay");
    } else {
      // FullTank postpay: одоогийн урсгал
      onStartDispense();
    }
  };

  // 🆕 Prepay төлбөр амжилттай авагдсаны дараа шууд шахалт ЭХЛЭХГҮЙ.
  // Эхлээд "prepay-receipt" дэлгэц рүү шилжүүлж, кассчин НӨАТ-ын мэдээллийг
  // оруулж "Баримт хэвлэж шахалт эхлүүлэх" товч дарахыг хүлээнэ.
  const onPrepayConfirmed = (
    method: "cash" | "bank_card" | "qpay" | "fuel_card",
    extra?: {
      approval_code?: string;
      rrn?: string;
      masked_pan?: string;
      qpay_invoice_id?: string;
      payment_id?: string;
    },
  ) => {
    const prepaymentAmount = doseType === "Amount"
      ? numeric
      : Math.round(numeric * /* approx price */ 3000);
    setPendingPrepay({
      method,
      amount: prepaymentAmount,
      approval_code: extra?.approval_code,
      rrn: extra?.rrn,
      masked_pan: extra?.masked_pan,
      qpay_invoice_id: extra?.qpay_invoice_id,
      qpay_payment_id: extra?.payment_id,
    });
    // VAT receipt дугаарыг урьдчилан бэлдэх (demo үед автоматаар)
    setStep("prepay-receipt");
  };

  // 🆕 Баримт + шахалт алхам — MULTI-CUSTOMER FLOW:
  //   1) НӨАТ дугаар, регистр шалгана
  //   2) Flux-руу startDispense илгээж command_id авна
  //   3) DispenseContext-д VAT/payment мэдээллийг хадгална (Dashboard
  //      шахалт дуусахад autoFinalize-д ашиглана)
  //   4) (Ирээдүйд: Thermal printer-руу баримт хэвлэх)
  //   5) Кассчныг шууд Dashboard руу буцаана — өөр pump дээр шууд шинэ
  //      үйлчилгээ хийж болно
  const onConfirmReceiptAndDispense = async () => {
    if (!pendingPrepay) {
      Alert.alert("Алдаа", "Урьдчилгаа төлбөр баталгаажаагүй байна");
      setStep("prepay-pay");
      return;
    }
    if (!vatReceipt.trim()) {
      Alert.alert("Алдаа", "НӨАТ-ын баримтын дугаар оруулна уу");
      return;
    }
    if (vatType !== "Иргэн" && !vatRegister.trim()) {
      Alert.alert("Алдаа", "Регистрийн дугаар оруулна уу");
      return;
    }
    if (doseType !== "FullTank" && numeric <= 0) {
      Alert.alert("Алдаа", "Дүн оруулна уу");
      return;
    }
    setSubmitting(true);
    try {
      // 🆕 Backend нь "split" method болон splits[] field-ийг дэмждэг.
      // Split mode үед нэг primary method хэрэглэхгүй, шууд "split" гэж явуулна.
      const isSplit = pendingPrepay.method === "split" && pendingPrepay.splits && pendingPrepay.splits.length > 0;
      // 1) Flux startDispense
      const res = await flux.startDispense({
        pump,
        nozzle,
        fuel_grade_id: fuelGradeId,
        dose_type: doseType,
        dose: doseType === "FullTank" ? undefined : numeric,
        card_id: card?.card_id,
        nfc_tag: card?.nfc_tag,
        payment_flow: "prepay",
        prepayment: {
          amount: pendingPrepay.amount,
          method: pendingPrepay.method as any,
          bank_approval_code: pendingPrepay.approval_code,
          bank_rrn: pendingPrepay.rrn,
          bank_masked_pan: pendingPrepay.masked_pan,
          qpay_invoice_id: pendingPrepay.qpay_invoice_id,
          qpay_payment_id: pendingPrepay.qpay_payment_id,
          ...(isSplit ? { splits: pendingPrepay.splits } as any : {}),
        },
      });
      // 2) Context хадгалах
      await dispenseCtx.add({
        command_id: res.command_id,
        pump,
        fuel_grade_id: fuelGradeId,
        fuel_label: fuelLabel,
        dose_type: doseType,
        dose: numeric,
        payment_method: pendingPrepay.method,
        prepaid_amount: pendingPrepay.amount,
        bank_approval_code: pendingPrepay.approval_code,
        bank_rrn: pendingPrepay.rrn,
        bank_masked_pan: pendingPrepay.masked_pan,
        qpay_invoice_id: pendingPrepay.qpay_invoice_id,
        qpay_payment_id: pendingPrepay.qpay_payment_id,
        splits: pendingPrepay.splits,
        vat_type: vatType,
        vat_register: vatRegister.trim(),
        vat_receipt_number: vatReceipt.trim(),
        hold_id: holdId,
        started_at: Date.now(),
      });
      // 3) НӨАТ баримт хэвлэх (PAX A8900 thermal printer)
      try {
        await printReceipt({
          station_name: "UBOIL ШАТАХУУН СТАНЦ",
          terminal_id: pendingPrepay.approval_code ? "EPOS" : undefined,
          date: new Date().toLocaleString("mn-MN"),
          receipt_no: vatReceipt.trim(),
          pump_no: pump,
          fuel_label: fuelLabel || "Шатахуун",
          volume_liters: doseType === "Volume" ? numeric : (doseType === "Amount" ? numeric / 3000 : undefined),
          unit_price: 3000,
          amount: pendingPrepay.amount,
          payment_method: pendingPrepay.method === "split" ? "Хуваан төлбөр"
            : pendingPrepay.method === "cash" ? "Бэлэн"
            : pendingPrepay.method === "bank_card" ? "Банк карт"
            : pendingPrepay.method === "qpay" ? "QPay"
            : "Шатахуун карт",
          splits: pendingPrepay.splits?.map((s) => ({
            method: s.method === "cash" ? "Бэлэн" : s.method === "bank_card" ? "Банк карт" : s.method === "qpay" ? "QPay" : "Шат.карт",
            amount: s.amount,
          })),
          approval_code: pendingPrepay.approval_code || pendingPrepay.splits?.find((s) => s.approval_code)?.approval_code,
          rrn: pendingPrepay.rrn || pendingPrepay.splits?.find((s) => s.rrn)?.rrn,
          masked_pan: pendingPrepay.masked_pan || pendingPrepay.splits?.find((s) => s.masked_pan)?.masked_pan,
          vat_type: vatType,
          vat_register: vatRegister.trim(),
          vat_receipt_number: vatReceipt.trim(),
        });
        // Хэвлэлт амжилттай ч бүтэлгүйтсэн ч шахалт үргэлжилнэ — кассчныг хүлээлгэхгүй
      } catch (_) {}
      // 4) Hold устгах
      if (holdId) {
        try { await flux.holds.remove(holdId); } catch (_) {}
      }
      // 5) Dashboard руу буцах — кассчин дараагийн үйлчлүүлэгчид зэрэг үйлчилнэ
      router.replace("/live/dashboard");
    } catch (e: any) {
      Alert.alert("Шахалт эхлэхэд алдаа гарлаа", e?.message || "Алдаа");
      setSubmitting(false);
    }
  };

  // ----- dispense polling -----
  // Flux state machine: pending → sent → acknowledged → filling → eot → completed
  // Strategy A (developer guide §2.3): on `eot` бид fill_snapshot-аас pseudo-
  // transaction үүсгэн finalize дэлгэцийг урьтаж нээх боловч transaction.id
  // ирэх хүртэл "Гүйлгээ баталгаажуулах" товчийг disabled байлгана.
  const startPolling = (cmdId: number) => {
    setPolling(true);
    let inFlight = false;
    let sawEot = false;
    const tick = async () => {
      if (inFlight) return; // Давхар request явуулахгүй
      inFlight = true;
      try {
        const s = await flux.dispenseStatus(cmdId, pump);
        setDispense(s);
        const fs = s.fill_snapshot;
        if (s.status === "completed" && s.transaction) {
          setTransaction(s.transaction);
          setAwaitingTxId(false);
          if (paymentFlow === "prepay") {
            // 🆕 Prepay горимд finalize дэлгэц ХАРАГДАХГҮЙ. Шахалт дуусмагц
            // backend-руу finalize-ийг автоматаар явуулж, шууд баримтын
            // дэлгэц рүү шилжинэ. Хэрэглэгч "төлбөр" 2 удаа сонгох
            // шаардлагагүй.
            stopPolling();
            autoFinalizePrepay(s.transaction);
          } else {
            setStep("finalize");
            stopPolling();
          }
        } else if (s.status === "eot" && fs) {
          setTransaction({
            id: null,
            volume_liters: fs.volume || 0,
            total_amount: fs.amount || 0,
            unit_price: fs.price || 0,
            fuel_grade_id: fs.fuel_grade_id,
            fuel_grade_name: fs.fuel_grade_name,
            fuel_type: fs.fuel_grade_name,
            _from_snapshot: true,
          });
          setAwaitingTxId(true);
          // 🆕 Prepay горимд EOT-ийн дараа finalize дэлгэц харуулахгүй.
          // Шахалт явагдаж байгаа дэлгэц дээр "Транзакцийн дугаар хүлээж байна"
          // гэж харуулсаар completed ирэх хүртэл үлдэнэ.
          if (paymentFlow !== "prepay") {
            setStep("finalize");
          }
          // EOT-ийн дараа transaction.id-г хүлээж байгаа тул түргэн polling
          // (500ms) -руу шилжинэ. Үүний улмаас "completed" хариу 1.5с-аас
          // 500мс дотор ирж UI-г блоклохгүй.
          if (!sawEot) {
            sawEot = true;
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(tick, 500);
          }
        } else if (s.status === "failed") {
          stopPolling();
          Alert.alert("Шахалт амжилтгүй", s.error_message || "Алдаа");
          setStep("amount");
        }
        // pending/sent/acknowledged/filling — dispense дэлгэц дээр үлдэнэ
      } catch (e: any) {
        // keep polling on transient errors
      } finally {
        inFlight = false;
      }
    };
    tick();
    // Үндсэн polling: 1с тутамд (өмнө нь 1.5с байсан)
    pollRef.current = setInterval(tick, 1000);
  };
  const stopPolling = () => {
    setPolling(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // ----- PAX A8900 charge (split-д тохирсон дүнгээр) -----
  const onChargePax = async () => {
    if (!transaction) return;
    const amt = bankChargeAmount;
    if (amt <= 0) {
      Alert.alert("Дүн алдаатай", "PAX-аар авах дүн 0 байж болохгүй");
      return;
    }
    setPaxStatus("charging");
    setPaxResult(null);
    try {
      const res = await paxCharge(amt, transaction.id || Date.now());
      setPaxResult(res);
      if (res.ok) {
        setPaxStatus("approved");
        if (res.approval_code) setBankApproval(res.approval_code);
      } else {
        setPaxStatus("declined");
      }
    } catch (e: any) {
      setPaxStatus("declined");
      setPaxResult({ ok: false, error: e?.message || "Алдаа гарлаа" });
    }
  };

  const onChangePaymentMethod = (id: typeof PAYMENT_METHODS[number]["id"]) => {
    setPaymentMethod(id);
    setPaxStatus("idle"); setPaxResult(null); setBankApproval("");
    setQpayStatus("idle"); setQpayResult(null);
    setCardStatus("idle"); setCardError(null); setCard(null);
    if (splitMode && id === secondMethod) {
      const fallback = PAYMENT_METHODS.find((m) => m.id !== id);
      if (fallback) setSecondMethod(fallback.id);
    }
  };

  // ----- QPay charge (EPOS SDK) -----
  const onChargeQpay = async () => {
    if (!transaction) return;
    const amt = qpayChargeAmount;
    if (amt <= 0) { Alert.alert("Дүн алдаатай", "QPay-ээр авах дүн 0 байж болохгүй"); return; }
    setQpayStatus("charging"); setQpayResult(null);
    try {
      const res = await paxQpay(amt, transaction.id || Date.now());
      setQpayResult(res);
      setQpayStatus(res.ok ? "approved" : "declined");
    } catch (e: any) {
      setQpayStatus("declined");
      setQpayResult({ ok: false, error: e?.message || "Алдаа гарлаа" });
    }
  };

  const onToggleSplit = () => {
    const next = !splitMode;
    setSplitMode(next);
    setPaxStatus("idle");
    setPaxResult(null);
    setCardStatus("idle");
    setCard(null);
    if (next) {
      // default first amount = totalAmount / 2 (round to nearest 100)
      const half = Math.round(totalAmount / 200) * 100;
      setFirstAmount(String(half || Math.round(totalAmount / 2)));
      if (secondMethod === paymentMethod) {
        const fallback = PAYMENT_METHODS.find((m) => m.id !== paymentMethod);
        if (fallback) setSecondMethod(fallback.id);
      }
    } else {
      setFirstAmount("");
    }
  };

  const onChangeSecondMethod = (id: typeof PAYMENT_METHODS[number]["id"]) => {
    if (id === paymentMethod) return;
    setSecondMethod(id);
    setPaxStatus("idle");
    setPaxResult(null);
    setCardStatus("idle");
    setCard(null);
  };

  // ----- Шатахуун карт уншуулах + lookup (split-д тохирсон дүнгээр) -----
  const onScanFuelCard = async () => {
    setCardStatus("scanning");
    setCardError(null);
    try {
      const r = await paxReadCard();
      if (!r.ok || !r.nfc_tag) {
        setCardStatus("not_found");
        setCardError(r.error || "Карт уншигдсангүй");
        return;
      }
      // Flux-аар lookup
      const data = await flux.lookupCard(r.nfc_tag);
      if (!data || data.found === false) {
        setCardStatus("not_found");
        setCardError("Карт системд бүртгэгдээгүй байна");
        return;
      }
      // Идэвхтэй эсэх
      if (data.is_active === false) {
        setCardStatus("invalid");
        setCardError("Карт идэвхгүй байна");
        setCard(data);
        return;
      }
      // Үлдэгдэл шалгах (split-д line-ийн дүнг шалгана)
      const need = fuelCardAmount;
      if (typeof data.balance === "number" && data.balance < need) {
        setCardStatus("invalid");
        setCardError(`Үлдэгдэл хүрэлцэхгүй (${fmtMNT(data.balance)} < ${fmtMNT(need)})`);
        setCard(data);
        return;
      }
      // Шатахуун зөвшөөрөгдсөн эсэх
      if (
        Array.isArray(data.allowed_fuel_grade_ids) &&
        data.allowed_fuel_grade_ids.length > 0 &&
        fuelGradeId &&
        !data.allowed_fuel_grade_ids.includes(fuelGradeId)
      ) {
        setCardStatus("invalid");
        setCardError(`Энэ карт ${fuelLabel} шатахууныг авах эрхгүй`);
        setCard(data);
        return;
      }
      setCard(data);
      setCardStatus("found");
    } catch (e: any) {
      setCardStatus("not_found");
      setCardError(e?.message || "Картын мэдээлэл татахад алдаа гарлаа");
    }
  };

  // ----- finalize -----
  const onFinalize = async () => {
    if (!transaction) return;
    if (!vatReceipt.trim()) {
      Alert.alert("Алдаа", "НӨАТ-ын баримтын дугаар оруулна уу"); return;
    }
    if (vatType !== "Иргэн" && !vatRegister.trim()) {
      Alert.alert("Алдаа", "Регистрийн дугаар оруулна уу"); return;
    }
    // Split-ийн валидаци
    if (splitMode) {
      if (line1Amount <= 0 || line2Amount <= 0) {
        Alert.alert("Хэсэгчилсэн дүн алдаатай", "Хоёр төлбөрийн дүн 0-ээс их байх ёстой");
        return;
      }
      if (line1Amount + line2Amount !== totalAmount) {
        Alert.alert("Дүн тэнцэхгүй", `Нийт ${fmtMNT(totalAmount)} байна. Хэсэг 1 + Хэсэг 2 = ${fmtMNT(line1Amount + line2Amount)}`);
        return;
      }
      if (paymentMethod === secondMethod) {
        Alert.alert("Алдаа", "Хоёр төлбөрийн төрөл ижил байж болохгүй");
        return;
      }
    }
    // Карт + PAX шалгалт нь split-д ч ажиллана
    if (hasBankLine && paxStatus !== "approved") {
      Alert.alert("Карт төлбөр баталгаажаагүй", `POS төхөөрөмжөөр ${fmtMNT(bankChargeAmount)}-ийг эхлээд авна уу.`);
      return;
    }
    if (hasQpayLine && qpayStatus !== "approved") {
      Alert.alert("QPay төлбөр баталгаажаагүй", `QPay-ээр ${fmtMNT(qpayChargeAmount)}-ийг эхлээд авна уу.`);
      return;
    }
    if (hasFuelLine && cardStatus !== "found") {
      Alert.alert("Шатахуун карт уншуулаагүй", "PAX дээр картыг уншуулж баталгаажуулна уу.");
      return;
    }
    if (awaitingTxId || !transaction?.id) {
      Alert.alert("Хүлээгээрэй", "Транзакцийн дугаар хараахан ирээгүй байна. Хошуу буулгасны дараа автоматаар идэвхэжнэ.");
      return;
    }
    // payment_lines үүсгэх (split-д л)
    const lines = splitMode
      ? [
          {
            method: paymentMethod,
            amount: line1Amount,
            ...(paymentMethod === "bank_card" && {
              bank_approval_code: bankApproval.trim() || undefined,
              bank_rrn: paxResult?.rrn,
              bank_masked_pan: paxResult?.masked_pan,
              bank_terminal_id: paxResult?.terminal_id,
            }),
            ...(paymentMethod === "fuel_card" && card && {
              card_id: card.card_id,
              card_number: card.card_number,
            }),
          },
          {
            method: secondMethod,
            amount: line2Amount,
            ...(secondMethod === "bank_card" && {
              bank_approval_code: bankApproval.trim() || undefined,
              bank_rrn: paxResult?.rrn,
              bank_masked_pan: paxResult?.masked_pan,
              bank_terminal_id: paxResult?.terminal_id,
            }),
            ...(secondMethod === "fuel_card" && card && {
              card_id: card.card_id,
              card_number: card.card_number,
            }),
          },
        ]
      : undefined;
    setSubmitting(true);
    try {
      const res = await flux.finalize({
        transaction_id: transaction.id,
        payment_method: paymentMethod,
        vat_receipt_number: vatReceipt.trim(),
        vat_type: vatType,
        vat_register: vatRegister.trim(),
        card_id: card?.card_id,
        card_number: card?.card_number,
        bank_approval_code: bankApproval.trim() || undefined,
        payment_lines: lines,
      });
      router.replace({
        pathname: "/live/receipt",
        params: {
          txId: String(res.transaction_id),
          total: String(res.total_amount || transaction.total_amount || 0),
          liters: String(res.volume_liters || transaction.volume_liters || 0),
          fuel: fuelLabel,
          payment: paymentMethod,
          vatNumber: res.vat_receipt_number || vatReceipt.trim(),
          vatType,
          vatRegister: vatRegister.trim(),
          pump: String(pump),
          bankApproval: bankApproval.trim(),
          paxRrn: paxResult?.rrn || "",
          paxPan: paxResult?.masked_pan || "",
          paxTerminal: paxResult?.terminal_id || "",
          splitJson: lines ? JSON.stringify(lines.map((l) => ({ m: l.method, a: l.amount }))) : "",
        },
      });
      // Resume-той үед hold-ыг арилгана
      if (holdId) {
        try { await flux.holds.remove(holdId); } catch (_) {}
      }
    } catch (e: any) {
      Alert.alert("Алдаа", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 🆕 Prepay горимд шахалт дууссан үед UI харуулахгүйгээр автоматаар
  // finalize-г backend-руу явуулж, хэрэглэгчийг шууд баримтын дэлгэц
  // рүү шилжүүлнэ. Хэрэглэгч "төлбөр" сонгох дэлгэцийг 2 удаа харахгүй.
  const autoFinalizePrepay = async (tx: any) => {
    if (!tx?.id) return;
    setSubmitting(true);
    // НӨАТ-ын дугаар (демо горимд автоматаар үүсгэнэ; LIVE үед prepay-ийн
    // үед нь eBarimt SDK-аас аль хэдийн авсан байх ёстой)
    let receiptNo = vatReceipt.trim();
    if (!receiptNo) {
      try {
        const me = await flux.me();
        if (me.is_demo) receiptNo = generateNoat();
      } catch (_) {}
    }
    // Prepay-ийн нэг л method ашиглана → payment_lines зайлуулагдана
    const finalizeBody: any = {
      transaction_id: tx.id,
      payment_method: prepayMethod,
      vat_receipt_number: receiptNo,
      vat_type: vatType,
      vat_register: vatRegister.trim(),
    };
    if (prepayMethod === "bank_card") {
      finalizeBody.bank_approval_code = prepayBankApproval || undefined;
    }
    try {
      const res = await flux.finalize(finalizeBody);
      // Илүүдэл буцаах дүн (refund) тооцох
      const prepaidAmount = doseType === "Amount" ? numeric : Math.round(numeric * (tx.unit_price || 3000));
      const actualAmount = res.total_amount || tx.total_amount || 0;
      const refundAmount = Math.max(0, prepaidAmount - actualAmount);
      router.replace({
        pathname: "/live/receipt",
        params: {
          txId: String(res.transaction_id || tx.id),
          total: String(actualAmount),
          liters: String(res.volume_liters || tx.volume_liters || 0),
          fuel: fuelLabel,
          payment: prepayMethod,
          vatNumber: res.vat_receipt_number || receiptNo,
          vatType,
          vatRegister: vatRegister.trim(),
          pump: String(pump),
          bankApproval: prepayBankApproval || "",
          // 🆕 Prepay metadata
          prepayFlow: "1",
          prepaidAmount: String(prepaidAmount),
          refundAmount: String(refundAmount),
          refundMethod: refundAmount > 0 ? "cash" : "",
        },
      });
      if (holdId) {
        try { await flux.holds.remove(holdId); } catch (_) {}
      }
    } catch (e: any) {
      Alert.alert("Гүйлгээ бүртгэхэд алдаа", e.message);
      // Алдаа гарвал finalize дэлгэц рүү буцаана — хэрэглэгч гараар засаж дуусгана
      setStep("finalize");
    } finally {
      setSubmitting(false);
    }
  };

  // ============= RENDER =============
  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="live-sale-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (step === "amount") router.back();
          else if (step === "dispense") {
            Alert.alert("Анхаар", "Шахалт явагдаж байна. Буцах боломжгүй.");
          } else if (step === "prepay-receipt") {
            // Буцах үед pendingPrepay-ийг цэвэрлэж prepay-pay руу буцаана
            setPendingPrepay(null);
            setStep("prepay-pay");
          } else setStep("amount");
        }} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>№{pump} • {fuelLabel || "Түгээгүүр"}</Text>
          <Text style={styles.sub}>
            {step === "amount" && "Дүн / Литр оруулна уу"}
            {step === "prepay-pay" && "Төлбөр авна уу"}
            {step === "prepay-receipt" && "НӨАТ баримт"}
            {step === "dispense" && "Шахалт явагдаж байна"}
            {step === "finalize" && "Төлбөр + НӨАТ"}
          </Text>
        </View>
      </View>

      {step === "amount" && (
        <View style={styles.amountWrap}>
          <View style={styles.toggle}>
            {(["Amount", "Volume", "FullTank"] as DoseType[]).map((dt) => (
              <TouchableOpacity
                key={dt}
                onPress={() => { setDoseType(dt); setInput(""); }}
                style={[styles.toggleBtn, doseType === dt && styles.toggleActive]}
                testID={`dose-${dt}`}
              >
                <Text style={[styles.toggleText, doseType === dt && styles.toggleTextActive]}>
                  {dt === "Amount" ? "Дүн (₮)" : dt === "Volume" ? "Литр" : "Бак дүүрэн"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {doseType !== "FullTank" && (
            <>
              <View style={styles.display}>
                <Text style={styles.displayLabel}>{doseType === "Amount" ? "Дүн" : "Литр"}</Text>
                <Text style={styles.displayValue} testID="amount-display">
                  {doseType === "Amount" ? `${(parseFloat(input || "0")).toLocaleString("en-US")} ₮` : `${input || "0"} L`}
                </Text>
                {/* Hidden TextInput — POS-ийн физик товчоор оруулах, Enter дарж "Үргэлжлүүлэх" */}
                <TextInput
                  ref={amountInputRef}
                  value={input}
                  onChangeText={onAmountChangeText}
                  onSubmitEditing={onAdvanceFromAmount}
                  keyboardType="decimal-pad"
                  returnKeyType="go"
                  autoFocus
                  caretHidden
                  showSoftInputOnFocus={false}
                  blurOnSubmit={false}
                  style={styles.hiddenInput}
                  testID="amount-hidden-input"
                />
              </View>
              <Keypad onPress={handleDigit} onBackspace={handleBack} />
            </>
          )}
          {doseType === "FullTank" && (
            <View style={styles.fullTankBox}>
              <MaterialCommunityIcons name="fuel" size={56} color={COLORS.primary} />
              <Text style={styles.fullTankText}>Бакыг бүрэн дүүргэх</Text>
              <Text style={styles.fullTankSub}>Шахалт автоматаар зогсоно</Text>
            </View>
          )}

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={[styles.bigBtn, (doseType !== "FullTank" && numeric <= 0) && { opacity: 0.5 }]}
            onPress={onAdvanceFromAmount}
            disabled={doseType !== "FullTank" && numeric <= 0}
            testID="start-dispense-btn"
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name={paymentFlow === "prepay" ? "credit-card-outline" : "play"}
              size={20} color="#fff"
            />
            <Text style={styles.bigBtnText}>
              {paymentFlow === "prepay" ? "Үргэлжлүүлэх → Төлбөр" : "Шахалт эхлүүлэх"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 🆕 PREPAY-PAY: Эхлээд төлбөр цуглуулах хэсэг (Amount/Volume үед) */}
      {step === "prepay-pay" && (
        <View style={styles.amountWrap}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.prepaySummary}>
              <Text style={styles.prepaySumLabel}>Төлбөрийн дүн</Text>
              <Text style={styles.prepaySumValue}>
                {doseType === "Amount"
                  ? `${Math.round(numeric).toLocaleString("en-US")} ₮`
                  : `${numeric} L`}
              </Text>
              <Text style={styles.prepaySumNote}>
                №{pump} • {fuelLabel || "Шатахуун"}
                {doseType === "Volume" ? " • Үнэлгээ нь шахалт дууссаны дараа тогтоно" : ""}
              </Text>
            </View>

            {/* Payment method picker - 4 methods in 2x2 grid */}
            <View style={styles.prepayMethodGrid}>
              {(["cash", "bank_card", "qpay", "fuel_card"] as const).map((m) => {
                const labels = { cash: "Бэлэн", bank_card: "Банк карт", qpay: "QPay", fuel_card: "Шатахуун карт" } as const;
                const icons = { cash: "cash-multiple", bank_card: "credit-card-outline", qpay: "qrcode-scan", fuel_card: "card-account-details-outline" } as const;
                const active = prepayMethod === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.prepayMethodBtn, active && styles.prepayMethodActive]}
                    onPress={() => {
                      setPrepayMethod(m);
                      setPrepayStatus("idle");
                      // Split mode-д 2-р арга нь 1-рээс өөр байх ёстой
                      if (prepaySplitMode && m === prepaySecondMethod) {
                        const others = (["cash", "bank_card", "qpay", "fuel_card"] as const).filter((x) => x !== m);
                        setPrepaySecondMethod(others[0]);
                      }
                      if (m !== "fuel_card") {
                        setCardStatus("idle"); setCard(null); setCardError(null);
                      }
                    }}
                    testID={`prepay-method-${m}`}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons
                      name={icons[m] as any}
                      size={20}
                      color={active ? "#fff" : COLORS.primary}
                    />
                    <Text style={[styles.prepayMethodLabel, active && { color: "#fff" }]}>{labels[m]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 🆕 Хуваан төлөх toggle (зөвхөн Amount mode-д) */}
            {doseType === "Amount" && (
              <TouchableOpacity
                style={[styles.splitToggle, prepaySplitMode && styles.splitToggleOn]}
                onPress={() => {
                  const next = !prepaySplitMode;
                  setPrepaySplitMode(next);
                  setSplitLeg1(null);
                  setSplitLeg2(null);
                  setPrepayStatus("idle");
                  if (next) {
                    // Default: 1-рийн дүн = бүх дүнгийн тал
                    const half = Math.round(numeric / 2);
                    setPrepayFirstAmountStr(String(half));
                    // 2-р арга нь 1-рээс өөр байх
                    if (prepaySecondMethod === prepayMethod) {
                      const others = (["cash", "bank_card", "qpay", "fuel_card"] as const).filter((x) => x !== prepayMethod);
                      setPrepaySecondMethod(others[0]);
                    }
                  }
                }}
                testID="prepay-split-toggle"
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons
                  name={prepaySplitMode ? "checkbox-marked" : "checkbox-blank-outline"}
                  size={20}
                  color={prepaySplitMode ? COLORS.primary : COLORS.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.splitToggleText, prepaySplitMode && { color: COLORS.primary }]}>
                    Хуваан төлөх
                  </Text>
                  <Text style={styles.splitToggleHint}>
                    2 төрлийн төлбөрөөр хуваах (жишээ: 5,000₮ бэлэн + 5,000₮ карт)
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            {/* 🆕 Split — 2 leg-ийн UI */}
            {prepaySplitMode && doseType === "Amount" && (() => {
              const leg1Amount = Math.max(0, Math.min(numeric, parseFloat(prepayFirstAmountStr || "0") || 0));
              const leg2Amount = Math.max(0, numeric - leg1Amount);
              const labels = { cash: "Бэлэн", bank_card: "Банк карт", qpay: "QPay", fuel_card: "Шат. карт" } as const;
              return (
                <View style={styles.splitBox} testID="prepay-split-box">
                  <View style={styles.splitLine}>
                    <View style={styles.splitLineHead}>
                      <View style={[styles.splitBadge, { backgroundColor: COLORS.primary }]}>
                        <Text style={styles.splitBadgeText}>1</Text>
                      </View>
                      <Text style={styles.splitLineLabel}>
                        {labels[prepayMethod]}
                        {splitLeg1?.paid ? "  ✓" : ""}
                      </Text>
                    </View>
                    <TextInput
                      style={styles.splitInput}
                      value={prepayFirstAmountStr}
                      onChangeText={(t) => {
                        setPrepayFirstAmountStr(t.replace(/[^0-9]/g, ""));
                        setSplitLeg1(null);
                      }}
                      placeholder="0"
                      placeholderTextColor={COLORS.textMuted}
                      keyboardType="numeric"
                      testID="prepay-split-amount-1"
                    />
                    <Text style={styles.splitCurr}>₮</Text>
                  </View>

                  <View style={styles.splitLine}>
                    <View style={styles.splitLineHead}>
                      <View style={[styles.splitBadge, { backgroundColor: "#64748B" }]}>
                        <Text style={styles.splitBadgeText}>2</Text>
                      </View>
                      <View style={styles.split2MethodRow}>
                        {(["cash", "bank_card", "qpay", "fuel_card"] as const).filter((m) => m !== prepayMethod).map((m) => (
                          <TouchableOpacity
                            key={m}
                            style={[styles.split2MethodChip, prepaySecondMethod === m && styles.split2MethodChipOn]}
                            onPress={() => {
                              setPrepaySecondMethod(m);
                              setSplitLeg2(null);
                            }}
                            testID={`prepay-split2-${m}`}
                          >
                            <Text style={[styles.split2MethodText, prepaySecondMethod === m && { color: "#fff" }]}>
                              {labels[m]}
                              {splitLeg2?.paid && prepaySecondMethod === m ? " ✓" : ""}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <Text style={styles.splitAutoAmt}>{fmtMNT(leg2Amount)}</Text>
                  </View>

                  <View style={styles.splitSummary}>
                    <Text style={styles.splitSummaryText}>
                      {fmtMNT(leg1Amount)} + {fmtMNT(leg2Amount)} ={" "}
                      <Text style={{ color: leg1Amount + leg2Amount === numeric ? "#16A34A" : COLORS.accentRed, fontWeight: "900" }}>
                        {fmtMNT(leg1Amount + leg2Amount)}
                      </Text>
                      {"  /  "}{fmtMNT(numeric)}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {/* Method-specific action area (compact) */}
            <View style={styles.prepayActionBox}>
              {prepayMethod === "cash" && (
                <>
                  <MaterialCommunityIcons name="cash-multiple" size={32} color={COLORS.primary} />
                  <Text style={styles.prepayActionTitle}>Бэлэн төлбөр</Text>
                  <Text style={styles.prepayActionSub}>
                    {doseType === "Amount" ? Math.round(numeric).toLocaleString("en-US") : "тооцоолсон"} ₮ хүлээж аваад баталгаажуулна уу
                  </Text>
                </>
              )}
              {prepayMethod === "bank_card" && (
                <>
                  <MaterialCommunityIcons name="credit-card-outline" size={32} color={COLORS.primary} />
                  <Text style={styles.prepayActionTitle}>Банк карт</Text>
                  <Text style={styles.prepayActionSub}>
                    {prepayStatus === "charging" ? "Терминалаар уншиж байна..." :
                     prepayStatus === "approved" ? `Зөвшөөрөгдсөн (${prepayBankApproval})` :
                     prepayStatus === "declined" ? "Татгалзагдсан — дахин оролдоно уу" :
                     "PAX A8900 терминалаар уншуулна уу"}
                  </Text>
                </>
              )}
              {prepayMethod === "qpay" && (
                <>
                  <MaterialCommunityIcons name="qrcode-scan" size={32} color={COLORS.primary} />
                  <Text style={styles.prepayActionTitle}>QPay</Text>
                  <Text style={styles.prepayActionSub}>
                    {prepayStatus === "charging" ? "QR код үүсгэж байна..." :
                     prepayStatus === "approved" ? "Төлбөр амжилттай" :
                     prepayStatus === "declined" ? "Цуцлагдсан — дахин үүсгэнэ үү" :
                     "Жолоочид QR код харуулна"}
                  </Text>
                </>
              )}
              {prepayMethod === "fuel_card" && (
                <>
                  <MaterialCommunityIcons name="card-account-details-outline" size={32} color={COLORS.primary} />
                  <Text style={styles.prepayActionTitle}>Шатахуун карт</Text>
                  <Text style={styles.prepayActionSub}>
                    {cardStatus === "scanning" ? "Карт уншиж байна..." :
                     cardStatus === "found" ? `${card?.holder_name || card?.card_number} • Үлдэгдэл: ${fmtMNT(card?.balance || 0)}` :
                     cardError || "PAX дээр шатахуун картыг уншуулна уу"}
                  </Text>
                  {cardStatus === "found" && (
                    <Text style={[styles.prepayActionSub, { color: COLORS.success, fontWeight: "800", marginTop: 4 }]}>
                      ✓ Үлдэгдэл хангалттай
                    </Text>
                  )}
                </>
              )}
            </View>
          </ScrollView>

          {/* Sticky footer — товчнууд үргэлж харагдана */}
          <View style={styles.prepayFooter}>
            <View style={styles.prepayBottomRow}>
              <TouchableOpacity
                style={styles.prepayBackBtn}
                onPress={() => setStep("amount")}
                testID="prepay-back-btn"
              >
                <Text style={styles.prepayBackText}>← Дүн өөрчлөх</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.prepayHoldBtn}
                onPress={onPrepayHold}
                disabled={holding}
                testID="prepay-hold-btn"
              >
                <MaterialCommunityIcons name="pause-circle-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.prepayHoldText}>{holding ? "..." : "Хүлээлгэх"}</Text>
              </TouchableOpacity>
            </View>

            {/* Confirm/Charge button */}
            <TouchableOpacity
              style={[styles.bigBtn, prepayStatus === "charging" && { opacity: 0.6 }]}
              disabled={prepayStatus === "charging"}
              onPress={async () => {
                // 🆕 SPLIT MODE — 2 leg-ийг дараалан төлүүлж нэгтгэнэ
                if (prepaySplitMode && doseType === "Amount") {
                  const leg1Amount = Math.max(0, Math.min(numeric, parseFloat(prepayFirstAmountStr || "0") || 0));
                  const leg2Amount = Math.max(0, numeric - leg1Amount);
                  if (leg1Amount + leg2Amount !== numeric || leg1Amount === 0 || leg2Amount === 0) {
                    Alert.alert("Алдаа", "Хоёр дүн нийт дүнгийн нийлбэртэй тэнцэх ёстой ба тус бүр 0-ээс их байх");
                    return;
                  }
                  setPrepayStatus("charging");
                  const tempTxId = `PREPAY-${pump}-${Date.now()}`;
                  try {
                    // Leg 1 (зөвхөн карт/qpay-д paxCharge ажиллана. Бэлэн = шууд OK)
                    let leg1: any = splitLeg1;
                    if (!leg1 || !leg1.paid) {
                      if (prepayMethod === "cash") {
                        leg1 = { method: "cash", amount: leg1Amount, paid: true };
                      } else if (prepayMethod === "bank_card") {
                        const r = await paxCharge(leg1Amount, tempTxId + "-1");
                        if (!r.ok) {
                          setPrepayStatus("declined");
                          Alert.alert("1-р төлбөр амжилтгүй", r.error || `rspCode=${r.rsp_code || "?"}`);
                          return;
                        }
                        leg1 = {
                          method: "bank_card",
                          amount: leg1Amount,
                          approval_code: r.approval_code,
                          rrn: r.rrn,
                          masked_pan: r.masked_pan,
                          paid: true,
                        };
                      } else if (prepayMethod === "qpay") {
                        const r = await paxQpay(leg1Amount, tempTxId + "-1");
                        if (!r.ok) {
                          setPrepayStatus("declined");
                          Alert.alert("1-р QPay амжилтгүй", r.error || `rspCode=${r.rsp_code || "?"}`);
                          return;
                        }
                        leg1 = {
                          method: "qpay",
                          amount: leg1Amount,
                          qpay_invoice_id: r.invoice_id,
                          paid: true,
                        };
                      } else {
                        // fuel_card: одоогоор split-д дэмжихгүй
                        Alert.alert("Алдаа", "Шатахуун карт нь хэсэгчилсэн төлбөрт дэмжигдэхгүй");
                        setPrepayStatus("idle");
                        return;
                      }
                      setSplitLeg1(leg1);
                    }
                    // Leg 2
                    let leg2: any = splitLeg2;
                    if (!leg2 || !leg2.paid) {
                      if (prepaySecondMethod === "cash") {
                        leg2 = { method: "cash", amount: leg2Amount, paid: true };
                      } else if (prepaySecondMethod === "bank_card") {
                        const r = await paxCharge(leg2Amount, tempTxId + "-2");
                        if (!r.ok) {
                          setPrepayStatus("declined");
                          Alert.alert("2-р төлбөр амжилтгүй", r.error || `rspCode=${r.rsp_code || "?"}`);
                          return;
                        }
                        leg2 = {
                          method: "bank_card",
                          amount: leg2Amount,
                          approval_code: r.approval_code,
                          rrn: r.rrn,
                          masked_pan: r.masked_pan,
                          paid: true,
                        };
                      } else if (prepaySecondMethod === "qpay") {
                        const r = await paxQpay(leg2Amount, tempTxId + "-2");
                        if (!r.ok) {
                          setPrepayStatus("declined");
                          Alert.alert("2-р QPay амжилтгүй", r.error || `rspCode=${r.rsp_code || "?"}`);
                          return;
                        }
                        leg2 = {
                          method: "qpay",
                          amount: leg2Amount,
                          qpay_invoice_id: r.invoice_id,
                          paid: true,
                        };
                      } else {
                        Alert.alert("Алдаа", "Шатахуун карт нь хэсэгчилсэн төлбөрт дэмжигдэхгүй");
                        setPrepayStatus("idle");
                        return;
                      }
                      setSplitLeg2(leg2);
                    }
                    // 2 leg амжилттай — pendingPrepay-д хадгалаад prepay-receipt руу
                    setPrepayStatus("approved");
                    setPendingPrepay({
                      method: "split",
                      amount: numeric,
                      splits: [
                        { method: leg1.method, amount: leg1.amount, approval_code: leg1.approval_code, rrn: leg1.rrn, masked_pan: leg1.masked_pan, qpay_invoice_id: leg1.qpay_invoice_id },
                        { method: leg2.method, amount: leg2.amount, approval_code: leg2.approval_code, rrn: leg2.rrn, masked_pan: leg2.masked_pan, qpay_invoice_id: leg2.qpay_invoice_id },
                      ],
                    });
                    setStep("prepay-receipt");
                  } catch (e: any) {
                    setPrepayStatus("declined");
                    Alert.alert("Алдаа", e?.message || "Төлбөр явуулахад алдаа гарлаа");
                  }
                  return;
                }
                if (prepayMethod === "cash") {
                  onPrepayConfirmed("cash");
                } else if (prepayMethod === "bank_card") {
                // 🆕 2 алхамт: 1-р даралт — карт уншуулна. 2-р даралт — шахалт.
                // Энэ нь "Карт уншуулах" даралт нь шууд шахалт эхлүүлж байгаа
                // асуудлыг шийднэ. approval_code-той баталгаажсан гүйлгээний
                // дараа л шахалт эхэлнэ.
                if (prepayStatus === "approved" && prepayBankApproval) {
                  // 2-р даралт: шахалт эхлүүлэх
                  onPrepayConfirmed("bank_card", {
                    approval_code: prepayBankApproval,
                    rrn: prepayBankRrn,
                    masked_pan: prepayBankMaskedPan,
                  });
                  return;
                }
                setPrepayStatus("charging");
                try {
                  const amt = doseType === "Amount" ? numeric : Math.round(numeric * 3000);
                  const tempTxId = `PREPAY-${pump}-${Date.now()}`;
                  const res: PaxResult = await paxCharge(amt, tempTxId);
                  if (res.ok && res.approval_code) {
                    setPrepayBankApproval(res.approval_code);
                    setPrepayBankRrn(res.rrn || "");
                    setPrepayBankMaskedPan(res.masked_pan || "");
                    setPrepayStatus("approved");
                    // НЭГ ДАРААГИЙН ДАРАА л шахалт эхэлнэ. Энд төлбөр зөвхөн
                    // баталгаажуулсан, кассчин товч дарахыг хүлээнэ.
                  } else {
                    setPrepayStatus("declined");
                    Alert.alert(
                      "Төлбөр баталгаажаагүй",
                      res.error || `Карт уншигдсангүй (rspCode=${res.rsp_code || "?"})`,
                    );
                  }
                } catch (e: any) {
                  setPrepayStatus("declined");
                  Alert.alert("Алдаа", e.message);
                }
              } else if (prepayMethod === "qpay") {
                // 🆕 QPay-д бас 2 алхамт хэрэглэе — invoice_status="PAID" болсныг
                // батлахаас өмнө шахалт эхлүүлэхгүй.
                if (prepayStatus === "approved" && prepayQpayInvoice) {
                  onPrepayConfirmed("qpay", { qpay_invoice_id: prepayQpayInvoice });
                  return;
                }
                setPrepayStatus("charging");
                try {
                  const amt = doseType === "Amount" ? numeric : Math.round(numeric * 3000);
                  const tempTxId = `PREPAY-${pump}-${Date.now()}`;
                  const res: PaxQpayResult = await paxQpay(amt, tempTxId);
                  if (res.ok && res.invoice_status === "PAID") {
                    setPrepayQpayInvoice(res.invoice_id || "");
                    setPrepayStatus("approved");
                  } else {
                    setPrepayStatus("declined");
                    Alert.alert("QPay төлбөр амжилтгүй", res.error || "Дахин оролдоно уу");
                  }
                } catch (e: any) {
                  setPrepayStatus("declined");
                  Alert.alert("Алдаа", e.message);
                }
              } else if (prepayMethod === "fuel_card") {
                // Эхлээд карт уншуулаагүй бол уншуулна. Уншсан бол шахалт эхлүүлнэ.
                if (cardStatus !== "found") {
                  await onScanFuelCard();
                  return;
                }
                if (card?.balance != null && card.balance < (doseType === "Amount" ? numeric : Math.round(numeric * 3000))) {
                  Alert.alert("Үлдэгдэл хүрэлцэхгүй", `Карт дээр ${fmtMNT(card.balance)} байгаа боловч ${doseType === "Amount" ? fmtMNT(numeric) : "тооцоолсон дүн"} шаардлагатай`);
                  return;
                }
                setPrepayStatus("approved");
                onPrepayConfirmed("fuel_card");
              }
            }}
            testID="prepay-confirm-btn"
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name={prepayMethod === "cash" ? "check"
                : prepayMethod === "bank_card" ? (prepayStatus === "approved" ? "check" : "credit-card-scan-outline")
                : prepayMethod === "qpay" ? (prepayStatus === "approved" ? "check" : "qrcode")
                : cardStatus === "found" ? "check" : "card-account-details-outline"}
              size={20} color="#fff"
            />
            <Text style={styles.bigBtnText}>
              {prepayMethod === "cash" ? "Төлбөр баталгаажуулах → Баримт"
               : prepayMethod === "bank_card" ? (prepayStatus === "approved" ? "Үргэлжлүүлэх → Баримт" : "Карт уншуулах")
               : prepayMethod === "qpay" ? (prepayStatus === "approved" ? "Үргэлжлүүлэх → Баримт" : "QR үүсгэх")
               : cardStatus === "found" ? "Үргэлжлүүлэх → Баримт"
               : "Шатахуун карт уншуулах"}
            </Text>
          </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 🆕 PREPAY-RECEIPT: Төлбөр аваад НӨАТ оруулж "Шахалт эхлүүлэх" */}
      {step === "prepay-receipt" && pendingPrepay && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.prepaySummary}>
              <Text style={styles.prepaySumLabel}>УРЬДЧИЛГАА ТӨЛБӨР</Text>
              <Text style={styles.prepaySumValue}>
                {fmtMNT(pendingPrepay.amount)}
              </Text>
              <Text style={styles.prepaySumNote}>
                №{pump} • {fuelLabel || "Шатахуун"} •{" "}
                {pendingPrepay.method === "split" && pendingPrepay.splits
                  ? pendingPrepay.splits.map((s) => {
                      const lbl = s.method === "cash" ? "Бэлэн" : s.method === "bank_card" ? "Банк" : s.method === "qpay" ? "QPay" : "Шат.карт";
                      return `${lbl} ${Math.round(s.amount).toLocaleString("en-US")}₮`;
                    }).join(" + ")
                  : pendingPrepay.method === "cash" ? "Бэлэн"
                  : pendingPrepay.method === "bank_card" ? "Банк карт"
                  : pendingPrepay.method === "qpay" ? "QPay"
                  : "Шатахуун карт"}
                {pendingPrepay.method !== "split" && pendingPrepay.approval_code ? ` • ${pendingPrepay.approval_code}` : ""}
              </Text>
              <Text style={styles.prepaySumNote}>
                {doseType === "Amount"
                  ? `${Math.round(numeric).toLocaleString("en-US")} ₮`
                  : `${numeric} L (~ үнэлгээ)`}
              </Text>
            </View>

            {/* 🆕 e-Barimt QR preview — баримт хэвлэхээс өмнө үзэх */}
            {!!vatReceipt.trim() && (
              <View style={styles.receiptPreview}>
                <View style={styles.receiptPreviewHeader}>
                  <MaterialCommunityIcons name="receipt-text-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.receiptPreviewTitle}>Е-БАРИМТ УРЬДЧИЛСАН ХАРАГДАЦ</Text>
                </View>
                <View style={styles.receiptPreviewBody}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={styles.rpLine}>UBOIL • Шатахуун станц</Text>
                    <View style={styles.rpDash} />
                    <Text style={styles.rpRow}>
                      <Text style={styles.rpKey}>Шатахуун: </Text>
                      <Text style={styles.rpVal}>{fuelLabel}</Text>
                    </Text>
                    <Text style={styles.rpRow}>
                      <Text style={styles.rpKey}>Түгээгүүр: </Text>
                      <Text style={styles.rpVal}>№{pump}</Text>
                    </Text>
                    <Text style={styles.rpRow}>
                      <Text style={styles.rpKey}>Дүн: </Text>
                      <Text style={[styles.rpVal, { fontWeight: "800" }]}>
                        {fmtMNT(pendingPrepay.amount)}
                      </Text>
                    </Text>
                    <Text style={styles.rpRow}>
                      <Text style={styles.rpKey}>Худ. авагч: </Text>
                      <Text style={styles.rpVal}>{vatType}</Text>
                    </Text>
                    {!!vatRegister && (
                      <Text style={styles.rpRow}>
                        <Text style={styles.rpKey}>Регистр: </Text>
                        <Text style={styles.rpVal}>{vatRegister}</Text>
                      </Text>
                    )}
                    <View style={styles.rpDash} />
                    <Text style={[styles.rpRow, { fontFamily: "monospace", fontSize: 10 }]}>
                      {vatReceipt.length > 16 ? vatReceipt.slice(0, 16) + "…" : vatReceipt}
                    </Text>
                  </View>
                  <View style={styles.qrWrap}>
                    <QRCode
                      value={`https://ebarimt.mn/?billId=${vatReceipt}&amount=${pendingPrepay.amount}&register=${vatRegister || ""}`}
                      size={90}
                      color="#0B3D2E"
                      backgroundColor="#fff"
                    />
                    <Text style={styles.qrCaption}>e-Barimt</Text>
                  </View>
                </View>
              </View>
            )}

            <Text style={[styles.label, { marginTop: 12 }]}>НӨАТ-ын төрөл</Text>
            <View style={styles.vatRow}>
              {VAT_TYPES.map((vt) => (
                <TouchableOpacity
                  key={vt}
                  style={[styles.vatCard, vatType === vt && styles.vatActive]}
                  onPress={() => setVatType(vt)}
                  testID={`vat-${vt}`}
                >
                  <Text style={[styles.vatText, vatType === vt && styles.vatTextActive]}>
                    {vt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {vatType !== "Иргэн" && (
              <>
                <Text style={[styles.label, { marginTop: 10 }]}>
                  {vatType === "Байгууллага" ? "Байгууллагын регистр" : "Иргэний регистр"}
                </Text>
                <TextInput
                  style={styles.input}
                  value={vatRegister}
                  onChangeText={setVatRegister}
                  placeholder={vatType === "Байгууллага" ? "1234567" : "АА00000000"}
                  autoCapitalize="characters"
                  testID="vat-register-input"
                />
              </>
            )}

            <Text style={[styles.label, { marginTop: 10 }]}>НӨАТ баримтын дугаар</Text>
            <TextInput
              style={styles.input}
              value={vatReceipt}
              onChangeText={setVatReceipt}
              placeholder="Жишээ: ABC123XYZ"
              autoCapitalize="characters"
              testID="vat-receipt-input-prepay"
              onSubmitEditing={onConfirmReceiptAndDispense}
              returnKeyType="go"
              autoFocus
            />
          </ScrollView>

          <View style={styles.prepayFooter}>
            <View style={styles.prepayBottomRow}>
              <TouchableOpacity
                style={styles.prepayBackBtn}
                onPress={() => {
                  setPendingPrepay(null);
                  setStep("prepay-pay");
                }}
              >
                <Text style={styles.prepayBackText}>← Төлбөр өөрчлөх</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.bigBtn, !vatReceipt.trim() && { opacity: 0.5 }]}
              disabled={!vatReceipt.trim()}
              onPress={onConfirmReceiptAndDispense}
              testID="confirm-receipt-and-dispense-btn"
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="play" size={20} color="#fff" />
              <Text style={styles.bigBtnText}>Баримт хэвлэж шахалт эхлүүлэх</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {step === "dispense" && (
        <View style={styles.dispenseBox} testID="dispense-status-box">
          {(() => {
            const st = dispense?.status || "pending";
            const fs = dispense?.fill_snapshot;
            const isFilling = st === "filling";
            const stLabel: Record<string, string> = {
              pending: "Командыг queue-д орууллаа",
              sent: "Контроллер руу илгээж байна",
              acknowledged: "Контроллер хүлээж авлаа",
              filling: "Шахаж байна",
              eot: "Шахалт дууссан — хүлээж байна",
              completed: "Гүйлгээ үүссэн",
              failed: "Алдаа",
            };
            const liveVol = isFilling ? (fs?.volume || 0) : 0;
            const liveAmt = isFilling ? (fs?.amount || 0) : 0;
            const pct = (() => {
              if (!isFilling || !presetDose) return null;
              if (doseType === "Amount" && liveAmt > 0) return Math.min(1, liveAmt / presetDose);
              if (doseType === "Volume" && liveVol > 0) return Math.min(1, liveVol / presetDose);
              return null;
            })();
            return (
              <>
                {!isFilling && <ActivityIndicator color={COLORS.primary} size="large" />}
                <Text style={styles.dispenseStatus}>{stLabel[st] || st}</Text>
                {isFilling && (
                  <View style={styles.dispenseLive}>
                    <Text style={styles.dispenseAmt}>{liveVol.toFixed(2)} L</Text>
                    <Text style={styles.dispenseAmtSub}>{fmtMNT(liveAmt)}</Text>
                    {fs?.fuel_grade_name ? (
                      <Text style={styles.dispenseHint}>{fs.fuel_grade_name} • {fmtMNT(fs.price || 0)}/L</Text>
                    ) : null}
                    {pct != null && (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
                      </View>
                    )}
                    {presetDose != null && (
                      <Text style={styles.dispenseHint}>
                        {doseType === "Amount"
                          ? `${fmtMNT(liveAmt)} / ${fmtMNT(presetDose)}`
                          : `${liveVol.toFixed(2)} / ${presetDose.toFixed(2)} L`}
                      </Text>
                    )}
                  </View>
                )}
                {!isFilling && (
                  <Text style={styles.dispenseHint}>
                    {st === "acknowledged" || st === "sent" ? "Шахалт удахгүй эхэлнэ..." : "Контроллер хүлээж байна..."}
                  </Text>
                )}
                {commandId && <Text style={styles.cmdId}>Command #{commandId}</Text>}
              </>
            );
          })()}
        </View>
      )}

      {step === "finalize" && transaction && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            {awaitingTxId && (
              <View style={styles.awaitBanner} testID="awaiting-tx-banner">
                <ActivityIndicator color="#B45309" size="small" />
                <Text style={styles.awaitText}>Транзакцийн дугаар хүлээж байна...</Text>
                <Text style={styles.awaitHint}>Хошуу буулгасны дараа автоматаар идэвхэжнэ</Text>
              </View>
            )}
            <View style={styles.txCard}>
              <Text style={styles.txLabel}>ШАХАГДСАН</Text>
              <Text style={styles.txAmount}>{fmtMNT(transaction.total_amount || 0)}</Text>
              <Text style={styles.txMeta}>
                {(transaction.volume_liters || 0).toFixed(2)} L • {fmtMNT(transaction.unit_price || 0)}/L
              </Text>
            </View>

            <Text style={styles.label}>ТӨЛБӨРИЙН ХЭЛБЭР</Text>
            <View style={styles.payGrid}>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.payCard, paymentMethod === m.id && styles.payActive]}
                  onPress={() => onChangePaymentMethod(m.id)}
                  testID={`pm-${m.id}`}
                >
                  <MaterialCommunityIcons name={m.icon as any} size={22} color={paymentMethod === m.id ? "#fff" : COLORS.primary} />
                  <Text style={[styles.payText, paymentMethod === m.id && styles.payTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Split (хэсэгчилсэн) төлбөрийн toggle */}
            <TouchableOpacity
              style={[styles.splitToggle, splitMode && styles.splitToggleOn]}
              onPress={onToggleSplit}
              testID="split-toggle"
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name={splitMode ? "checkbox-marked" : "checkbox-blank-outline"}
                size={20}
                color={splitMode ? COLORS.primary : COLORS.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.splitToggleText, splitMode && { color: COLORS.primary }]}>
                  Хэсэгчилж төлөх
                </Text>
                <Text style={styles.splitToggleHint}>
                  2 төрлийн төлбөрөөр хуваан төлөх (жишээ: 5,000₮ бэлэн + 5,000₮ карт)
                </Text>
              </View>
            </TouchableOpacity>

            {splitMode && (
              <View style={styles.splitBox} testID="split-box">
                <View style={styles.splitLine}>
                  <View style={styles.splitLineHead}>
                    <View style={[styles.splitBadge, { backgroundColor: COLORS.primary }]}>
                      <Text style={styles.splitBadgeText}>1</Text>
                    </View>
                    <Text style={styles.splitLineLabel}>
                      {PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label}
                    </Text>
                  </View>
                  <TextInput
                    style={styles.splitInput}
                    value={firstAmount}
                    onChangeText={(t) => setFirstAmount(t.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="numeric"
                    testID="split-amount-1"
                  />
                  <Text style={styles.splitCurr}>₮</Text>
                </View>

                <View style={styles.splitLine}>
                  <View style={styles.splitLineHead}>
                    <View style={[styles.splitBadge, { backgroundColor: "#64748B" }]}>
                      <Text style={styles.splitBadgeText}>2</Text>
                    </View>
                    <View style={styles.split2MethodRow}>
                      {PAYMENT_METHODS.filter((m) => m.id !== paymentMethod).map((m) => (
                        <TouchableOpacity
                          key={m.id}
                          style={[styles.split2MethodChip, secondMethod === m.id && styles.split2MethodChipOn]}
                          onPress={() => onChangeSecondMethod(m.id)}
                          testID={`split2-${m.id}`}
                        >
                          <Text style={[styles.split2MethodText, secondMethod === m.id && { color: "#fff" }]}>
                            {m.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <Text style={styles.splitAutoAmt}>{fmtMNT(line2Amount)}</Text>
                </View>

                <View style={styles.splitSummary}>
                  <Text style={styles.splitSummaryText}>
                    {fmtMNT(line1Amount)} + {fmtMNT(line2Amount)} ={" "}
                    <Text style={{ color: line1Amount + line2Amount === totalAmount ? "#16A34A" : COLORS.accentRed, fontWeight: "900" }}>
                      {fmtMNT(line1Amount + line2Amount)}
                    </Text>
                    {"  /  "}{fmtMNT(totalAmount)}
                  </Text>
                </View>
              </View>
            )}

            {hasBankLine && (
              <View style={styles.paxBox} testID="pax-box">
                <View style={styles.paxHead}>
                  <View style={styles.paxIcon}>
                    <MaterialCommunityIcons name="contactless-payment" size={22} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paxTitle}>EPOS POS төхөөрөмж{splitMode ? ` • ${fmtMNT(bankChargeAmount)}` : ""}</Text>
                    <Text style={styles.paxSub}>
                      {paxConfig().native ? "DATABANK EPOS SDK 1.4 • PAX A8900" : "Демо/Урьдчилсан горим (web/iOS)"}
                    </Text>
                  </View>
                </View>

                {paxStatus === "idle" && (
                  <TouchableOpacity
                    style={styles.paxBtn}
                    onPress={onChargePax}
                    testID="pax-charge-btn"
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="credit-card-wireless-outline" size={22} color="#fff" />
                    <Text style={styles.paxBtnText}>
                      {fmtMNT(bankChargeAmount)} - PAX-аар авах
                    </Text>
                  </TouchableOpacity>
                )}

                {paxStatus === "charging" && (
                  <View style={styles.paxStatusBox}>
                    <ActivityIndicator color={COLORS.primary} />
                    <Text style={styles.paxStatusText}>PAX төхөөрөмж рүү илгээж байна...</Text>
                    <Text style={styles.paxStatusHint}>Картаа PAX дээр өргөж/унш танилцуулна уу</Text>
                  </View>
                )}

                {paxStatus === "approved" && paxResult && (
                  <View style={[styles.paxStatusBox, styles.paxOk]}>
                    <MaterialCommunityIcons name="check-circle" size={32} color="#16A34A" />
                    <Text style={[styles.paxStatusText, { color: "#16A34A" }]}>
                      {paxResult.rsp_msg || "Карт төлбөр амжилттай"}
                    </Text>
                    <View style={styles.paxKv}>
                      {paxResult.approval_code && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Auth code</Text>
                          <Text style={styles.paxV}>{paxResult.approval_code}</Text>
                        </View>
                      )}
                      {paxResult.trace_no && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Trace</Text>
                          <Text style={styles.paxV}>{paxResult.trace_no}</Text>
                        </View>
                      )}
                      {paxResult.rrn && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>RRN</Text>
                          <Text style={styles.paxV}>{paxResult.rrn}</Text>
                        </View>
                      )}
                      {paxResult.batch_no && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Batch</Text>
                          <Text style={styles.paxV}>{paxResult.batch_no}</Text>
                        </View>
                      )}
                      {paxResult.masked_pan && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Карт</Text>
                          <Text style={styles.paxV}>{paxResult.masked_pan}{paxResult.card_type ? ` (${paxResult.card_type})` : ""}</Text>
                        </View>
                      )}
                      {paxResult.cardholder_name && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Эзэмшигч</Text>
                          <Text style={styles.paxV}>{paxResult.cardholder_name}</Text>
                        </View>
                      )}
                      {paxResult.entry_mode && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Уншсан</Text>
                          <Text style={styles.paxV}>{paxResult.entry_mode}</Text>
                        </View>
                      )}
                      {paxResult.terminal_id && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Terminal</Text>
                          <Text style={styles.paxV}>{paxResult.terminal_id}</Text>
                        </View>
                      )}
                      {paxResult.simulated && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Горим</Text>
                          <Text style={[styles.paxV, { color: "#B45309" }]}>SIMULATION</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {paxStatus === "declined" && (
                  <View style={[styles.paxStatusBox, styles.paxFail]}>
                    <MaterialCommunityIcons name="close-circle" size={32} color={COLORS.accentRed} />
                    <Text style={[styles.paxStatusText, { color: COLORS.accentRed }]}>Карт төлбөр амжилтгүй</Text>
                    {paxResult?.error && <Text style={styles.paxStatusHint}>{paxResult.error}</Text>}
                    <TouchableOpacity style={styles.paxRetry} onPress={onChargePax} testID="pax-retry-btn">
                      <MaterialCommunityIcons name="refresh" size={18} color={COLORS.primary} />
                      <Text style={styles.paxRetryText}>Дахин оролдох</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Text style={styles.paxFootnote}>
                  PAX SDK: {paxConfig().action} • {paxConfig().pkg}
                </Text>
              </View>
            )}

            {hasFuelLine && (
              <View style={styles.paxBox} testID="fuel-card-box">
                <View style={styles.paxHead}>
                  <View style={styles.paxIcon}>
                    <MaterialCommunityIcons name="card-account-details" size={22} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paxTitle}>Шатахуун карт{splitMode ? ` • ${fmtMNT(fuelCardAmount)}` : ""}</Text>
                    <Text style={styles.paxSub}>
                      {paxConfig().native ? "PAX A8900-ийн NFC уншуулагч" : "Демо уншуулагч (web/iOS)"}
                    </Text>
                  </View>
                </View>

                {(cardStatus === "idle" || cardStatus === "not_found" || cardStatus === "invalid") && (
                  <TouchableOpacity
                    style={styles.paxBtn}
                    onPress={onScanFuelCard}
                    testID="fuel-card-scan-btn"
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="cellphone-nfc" size={22} color="#fff" />
                    <Text style={styles.paxBtnText}>
                      {cardStatus === "idle" ? "Карт уншуулах" : "Дахин уншуулах"}
                    </Text>
                  </TouchableOpacity>
                )}

                {cardStatus === "scanning" && (
                  <View style={styles.paxStatusBox}>
                    <ActivityIndicator color={COLORS.primary} />
                    <Text style={styles.paxStatusText}>Картыг PAX дээр уншуулна уу...</Text>
                    <Text style={styles.paxStatusHint}>Картаа NFC талбар руу ойртуулна уу</Text>
                  </View>
                )}

                {(cardStatus === "not_found" || cardStatus === "invalid") && cardError && (
                  <View style={[styles.paxStatusBox, styles.paxFail, { marginTop: 10 }]}>
                    <MaterialCommunityIcons name="close-circle" size={28} color={COLORS.accentRed} />
                    <Text style={[styles.paxStatusText, { color: COLORS.accentRed }]}>
                      {cardStatus === "not_found" ? "Карт олдсонгүй" : "Карт ашиглах боломжгүй"}
                    </Text>
                    <Text style={styles.paxStatusHint}>{cardError}</Text>
                  </View>
                )}

                {cardStatus === "found" && card && (
                  <View style={[styles.paxStatusBox, styles.paxOk]}>
                    <MaterialCommunityIcons name="check-circle" size={32} color="#16A34A" />
                    <Text style={[styles.paxStatusText, { color: "#16A34A" }]}>Карт баталгаажлаа</Text>
                    <View style={styles.paxKv}>
                      {card.holder_name && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Эзэмшигч</Text>
                          <Text style={styles.paxV}>{card.holder_name}</Text>
                        </View>
                      )}
                      {card.card_number && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Карт #</Text>
                          <Text style={styles.paxV}>{card.card_number}</Text>
                        </View>
                      )}
                      {typeof card.balance === "number" && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Үлдэгдэл</Text>
                          <Text style={styles.paxV}>{fmtMNT(card.balance)}</Text>
                        </View>
                      )}
                      {typeof card.discount_percent === "number" && card.discount_percent > 0 && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Хямдрал</Text>
                          <Text style={styles.paxV}>{card.discount_percent}%</Text>
                        </View>
                      )}
                      {card.vehicle_number && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Тээвэр</Text>
                          <Text style={styles.paxV}>{card.vehicle_number}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                <Text style={styles.paxFootnote}>
                  Flux API: POST /api/flux/lookup-card
                </Text>
              </View>
            )}

            {hasQpayLine && (
              <View style={styles.paxBox} testID="qpay-box">
                <View style={styles.paxHead}>
                  <View style={styles.paxIcon}>
                    <MaterialCommunityIcons name="qrcode-scan" size={22} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paxTitle}>QPay (EPOS QR){splitMode ? ` • ${fmtMNT(qpayChargeAmount)}` : ""}</Text>
                    <Text style={styles.paxSub}>
                      {paxConfig().native ? "PAX дэлгэц дээр QR код" : "Демо/Урьдчилсан горим"}
                    </Text>
                  </View>
                </View>

                {qpayStatus === "idle" && (
                  <TouchableOpacity style={styles.paxBtn} onPress={onChargeQpay} testID="qpay-charge-btn" activeOpacity={0.85}>
                    <MaterialCommunityIcons name="qrcode" size={22} color="#fff" />
                    <Text style={styles.paxBtnText}>{fmtMNT(qpayChargeAmount)} - QR үүсгэх</Text>
                  </TouchableOpacity>
                )}

                {qpayStatus === "charging" && (
                  <View style={styles.paxStatusBox}>
                    <ActivityIndicator color={COLORS.primary} />
                    <Text style={styles.paxStatusText}>QPay invoice үүсгэж байна...</Text>
                    <Text style={styles.paxStatusHint}>Үйлчлүүлэгч QR-ыг сканнердана уу</Text>
                  </View>
                )}

                {qpayStatus === "approved" && qpayResult && (
                  <View style={[styles.paxStatusBox, styles.paxOk]}>
                    <MaterialCommunityIcons name="check-circle" size={32} color="#16A34A" />
                    <Text style={[styles.paxStatusText, { color: "#16A34A" }]}>QPay төлбөр төлөгдсөн</Text>
                    <View style={styles.paxKv}>
                      {qpayResult.invoice_id && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Invoice</Text>
                          <Text style={styles.paxV}>{qpayResult.invoice_id}</Text>
                        </View>
                      )}
                      {qpayResult.invoice_status && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Статус</Text>
                          <Text style={styles.paxV}>{qpayResult.invoice_status}</Text>
                        </View>
                      )}
                      {qpayResult.simulated && (
                        <View style={styles.paxRow}>
                          <Text style={styles.paxK}>Горим</Text>
                          <Text style={[styles.paxV, { color: "#B45309" }]}>SIMULATION</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {qpayStatus === "declined" && (
                  <View style={[styles.paxStatusBox, styles.paxFail]}>
                    <MaterialCommunityIcons name="close-circle" size={32} color={COLORS.accentRed} />
                    <Text style={[styles.paxStatusText, { color: COLORS.accentRed }]}>QPay амжилтгүй</Text>
                    {qpayResult?.error && <Text style={styles.paxStatusHint}>{qpayResult.error}</Text>}
                    <TouchableOpacity style={styles.paxRetry} onPress={onChargeQpay} testID="qpay-retry-btn">
                      <MaterialCommunityIcons name="refresh" size={18} color={COLORS.primary} />
                      <Text style={styles.paxRetryText}>Дахин оролдох</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Text style={styles.paxFootnote}>EPOS SDK: android.epos.payment.qpayPayment</Text>
              </View>
            )}

            <Text style={styles.label}>НӨАТ-ЫН БАРИМТ ДУГААР</Text>
            <View style={styles.receiptRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={vatReceipt}
                onChangeText={setVatReceipt}
                placeholder="ДДТД2026..."
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                testID="vat-receipt-input"
              />
              <TouchableOpacity
                style={styles.genBtn}
                onPress={() => setVatReceipt(generateNoat())}
                activeOpacity={0.7}
                testID="generate-noat-btn"
              >
                <MaterialCommunityIcons name="auto-fix" size={18} color={COLORS.primary} />
                <Text style={styles.genText}>Үүсгэх</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              {isDemo
                ? "Демо: автомат үүсгэгдсэн. Шаардлагатай бол өөрчилнө үү."
                : "Бодит горимд e-Barimt/TaxApp модулиас дугаараа уншуулах эсвэл оруулна уу."}
            </Text>

            <Text style={styles.label}>ХУДАЛДАН АВАГЧИЙН ТӨРӨЛ</Text>
            <View style={styles.vatRow}>
              {VAT_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.vatCard, vatType === t && styles.vatActive]}
                  onPress={() => setVatType(t)}
                  testID={`vat-${t}`}
                >
                  <Text style={[styles.vatText, vatType === t && styles.vatTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {vatType !== "Иргэн" && (
              <>
                <Text style={styles.label}>{vatType === "Байгууллага" ? "БАЙГУУЛЛАГЫН РТД" : "РЕГИСТРИЙН ДУГААР"}</Text>
                <TextInput
                  style={styles.input}
                  value={vatRegister}
                  onChangeText={(t) => setVatRegister(t.toUpperCase())}
                  placeholder={vatType === "Байгууллага" ? "6123456" : "УБ12345678"}
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="characters"
                  testID="vat-register-input"
                />
              </>
            )}

            <View style={styles.holdRow}>
              <TouchableOpacity
                style={[styles.holdBtn, (holding || awaitingTxId) && { opacity: 0.5 }]}
                onPress={onHold}
                disabled={holding || awaitingTxId}
                testID="hold-btn"
                activeOpacity={0.85}
              >
                {holding ? <ActivityIndicator color={COLORS.primary} /> : (
                  <>
                    <MaterialCommunityIcons name="pause-circle-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.holdBtnText}>
                      {holdId ? "Дахин хүлээлгэх" : "Хүлээлгэх"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.bigBtn, (submitting || awaitingTxId) && { opacity: 0.5 }]}
              onPress={onFinalize}
              disabled={submitting || awaitingTxId}
              testID="finalize-btn"
              activeOpacity={0.85}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : awaitingTxId ? (
                <>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.bigBtnText}>Транзакцийн дугаар хүлээж байна...</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle-outline" size={20} color="#fff" />
                  <Text style={styles.bigBtnText}>Гүйлгээ баталгаажуулах</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  amountWrap: { flex: 1, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  toggle: { flexDirection: "row", backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: 3, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, gap: 3 },
  toggleBtn: { flex: 1, paddingVertical: 7, alignItems: "center", borderRadius: RADIUS.md },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleText: { fontSize: 12, fontWeight: "700", color: COLORS.textSecondary },
  toggleTextActive: { color: "#fff" },
  display: { backgroundColor: "#fff", paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", marginBottom: 8 },
  displayLabel: { fontSize: 10, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1 },
  displayValue: { fontSize: 28, fontWeight: "800", color: COLORS.primary, marginTop: 2 },
  fullTankBox: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 20, backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  fullTankText: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary, marginTop: 10 },
  fullTankSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  bigBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: COLORS.primary, paddingVertical: 13, borderRadius: RADIUS.xl, marginTop: 10 },
  bigBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  // POS физик товчлуурын дэмжлэгийн нуугдсан TextInput
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    top: 0,
    left: 0,
  },
  // e-Barimt receipt preview (prepay-receipt step)
  receiptPreview: {
    backgroundColor: "#fff",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: "dashed",
    padding: 12,
    marginTop: 4,
  },
  receiptPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderStyle: "dashed",
  },
  receiptPreviewTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  receiptPreviewBody: {
    flexDirection: "row",
    alignItems: "center",
  },
  rpLine: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  rpDash: {
    height: 1,
    backgroundColor: COLORS.border,
    borderStyle: "dashed",
    borderWidth: 0.5,
    borderColor: COLORS.border,
    marginVertical: 4,
  },
  rpRow: { fontSize: 11, color: COLORS.textPrimary, marginVertical: 1 },
  rpKey: { color: COLORS.textSecondary, fontSize: 11 },
  rpVal: { color: COLORS.textPrimary, fontSize: 11 },
  qrWrap: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    padding: 6,
    borderRadius: 8,
  },
  qrCaption: {
    fontSize: 9,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontWeight: "700",
  },

  // 🆕 Prepay-pay screen styles
  prepaySummary: { backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 14, alignItems: "center", marginBottom: 12 },
  prepaySumLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1 },
  prepaySumValue: { fontSize: 30, fontWeight: "800", color: COLORS.primary, marginTop: 2 },
  prepaySumNote: { fontSize: 11, color: COLORS.textSecondary, fontWeight: "600", marginTop: 4, textAlign: "center" },
  prepayMethodRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  prepayMethodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  prepayMethodBtn: { width: "48%", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10, backgroundColor: "#fff", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, gap: 4 },
  prepayMethodActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  prepayMethodLabel: { fontSize: 12, fontWeight: "700", color: COLORS.textPrimary },
  prepayActionBox: { backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 16, alignItems: "center" },
  prepayActionTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary, marginTop: 8 },
  prepayActionSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, textAlign: "center" },
  prepayFooter: { paddingTop: 6, borderTopWidth: 1, borderColor: COLORS.border, marginTop: 6 },
  prepayBottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  prepayBackBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  prepayBackText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "700" },
  prepayHoldBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#FEF3C7", borderRadius: 999, borderWidth: 1, borderColor: "#FCD34D" },
  prepayHoldText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "800" },
  dispenseBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  dispenseStatus: { fontSize: 22, fontWeight: "800", color: COLORS.primary, marginTop: 24, textTransform: "uppercase", letterSpacing: 1 },
  dispenseHint: { fontSize: 13, color: COLORS.textSecondary, marginTop: 8 },
  dispenseLive: { marginTop: 24, alignItems: "center", padding: 20, backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, minWidth: 220 },
  dispenseAmt: { fontSize: 36, fontWeight: "800", color: COLORS.textPrimary },
  dispenseAmtSub: { fontSize: 16, color: COLORS.textSecondary, marginTop: 4, fontWeight: "700" },
  cmdId: { fontSize: 11, color: COLORS.textMuted, marginTop: 16, fontFamily: "monospace" },
  txCard: { backgroundColor: COLORS.primary, padding: 18, borderRadius: RADIUS.xxl, alignItems: "center", marginBottom: 18 },
  txLabel: { color: "rgba(255,255,255,0.85)", fontWeight: "800", letterSpacing: 1, fontSize: 11 },
  txAmount: { color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 4 },
  txMeta: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 4, fontWeight: "600" },
  label: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 6, marginTop: 6 },
  payGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  payCard: { width: "48%", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", padding: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  payActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  payText: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary },
  payTextActive: { color: "#fff" },
  input: { backgroundColor: "#fff", padding: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, fontSize: 15, fontWeight: "700", color: COLORS.textPrimary, marginBottom: 10 },
  vatRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  vatCard: { flex: 1, paddingVertical: 12, backgroundColor: "#fff", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  vatActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  vatText: { fontSize: 11, fontWeight: "800", color: COLORS.textPrimary, textAlign: "center" },
  vatTextActive: { color: "#fff" },
  receiptRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 4 },
  genBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F0FDFA", paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: "#CCFBF1",
  },
  genText: { fontSize: 12, fontWeight: "800", color: COLORS.primary },
  hint: { fontSize: 11, color: COLORS.textMuted, marginBottom: 12, marginTop: 4 },
  // PAX
  paxBox: {
    backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border,
    padding: 14, marginTop: 4, marginBottom: 14,
  },
  paxHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  paxIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center" },
  paxTitle: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  paxSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, fontWeight: "600" },
  paxBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.lg },
  paxBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  paxStatusBox: { alignItems: "center", paddingVertical: 16, gap: 6, borderRadius: RADIUS.lg, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: COLORS.border },
  paxOk: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  paxFail: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  paxStatusText: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary, marginTop: 4 },
  paxStatusHint: { fontSize: 11, color: COLORS.textSecondary, textAlign: "center", paddingHorizontal: 14 },
  paxKv: { width: "100%", paddingHorizontal: 16, marginTop: 6, gap: 4 },
  paxRow: { flexDirection: "row", justifyContent: "space-between" },
  paxK: { fontSize: 11, color: COLORS.textMuted, fontWeight: "700" },
  paxV: { fontSize: 12, color: COLORS.textPrimary, fontWeight: "800", fontFamily: "monospace" },
  paxRetry: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  paxRetryText: { fontSize: 12, fontWeight: "800", color: COLORS.primary },
  paxFootnote: { fontSize: 10, color: COLORS.textMuted, marginTop: 8, textAlign: "center", fontFamily: "monospace" },
  // Awaiting transaction.id banner (EOT state)
  awaitBanner: {
    flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8,
    backgroundColor: "#FEF3C7", borderColor: "#FDE68A", borderWidth: 1,
    padding: 12, borderRadius: RADIUS.lg, marginBottom: 12,
  },
  awaitText: { fontSize: 13, fontWeight: "800", color: "#92400E" },
  awaitHint: { fontSize: 11, color: "#92400E", flexBasis: "100%", marginTop: 2 },
  // Filling progress bar
  progressTrack: {
    width: "80%", height: 8, backgroundColor: "#E5E7EB",
    borderRadius: 999, marginTop: 12, overflow: "hidden",
  },
  progressFill: {
    height: "100%", backgroundColor: COLORS.primary, borderRadius: 999,
  },
  // Split payment UI
  splitToggle: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
    paddingHorizontal: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "#fff", marginBottom: 10,
  },
  splitToggleOn: { borderColor: COLORS.primary, backgroundColor: "#F0FDFA" },
  splitToggleText: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  splitToggleHint: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  splitBox: {
    backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 1,
    borderColor: COLORS.primary, padding: 14, marginBottom: 14, gap: 10,
  },
  splitLine: {
    backgroundColor: "#F8FAFC", borderRadius: RADIUS.lg, padding: 12, gap: 8,
  },
  splitLineHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  splitBadge: {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
  },
  splitBadgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  splitLineLabel: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary, flex: 1 },
  splitInput: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.md,
    fontSize: 16, fontWeight: "900", color: COLORS.textPrimary, textAlign: "right",
    minWidth: 100,
  },
  splitCurr: { fontSize: 14, fontWeight: "800", color: COLORS.textSecondary, marginLeft: 6 },
  splitAutoAmt: { fontSize: 16, fontWeight: "900", color: COLORS.primary, textAlign: "right" },
  split2MethodRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  split2MethodChip: {
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#fff",
  },
  split2MethodChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  split2MethodText: { fontSize: 11, fontWeight: "800", color: COLORS.textPrimary },
  splitSummary: {
    paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#F0FDFA",
    borderRadius: RADIUS.md, alignItems: "center",
  },
  splitSummaryText: { fontSize: 12, fontWeight: "700", color: COLORS.textSecondary },
  // Hold (Хүлээлгэх) button
  holdRow: { marginBottom: 12 },
  holdBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderRadius: RADIUS.lg, borderWidth: 1.5,
    borderColor: COLORS.primary, backgroundColor: "#F0FDFA",
  },
  holdBtnText: { fontSize: 14, fontWeight: "800", color: COLORS.primary },
});
