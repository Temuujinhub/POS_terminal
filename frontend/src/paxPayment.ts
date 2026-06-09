// DATABANK EPOS Open API v26 — Intent-based bridge (Android-only)
//
// Архитектур: Action бүр өөрийн гэсэн Intent action-той (Category биш!)
//   • Үйлдэл бүрд тусгай Intent action илгээнэ (доорх EPOS_METHOD-аас)
//   • Extras (Bundle):
//        - command_type (Int)    — заавал
//        - sdk_version  (Int=24) — заавал (SDK-ийн хувилбар)
//        - app_package  (String) — дуудаж буй апп-ийн package (METHOD_CHANNEL)
//        - amount_long  (Double→Long, центээр) — SALE/QPAY дээр заавал
//        - dbRefNo      (String) — SALE/QPAY/CHECK_TRANS дээр заавал
//        - tipAmount_long, currencyCode, items, terminalId, г.м.
//
//   Note: "_long" суффикс нь patch-package-аар хийгдсэн expo-intent-launcher
//   patch-ийн дохио бөгөөд тухайн утгыг Bundle.putLong()-ээр оруулна.
//   EPOS бодит түлхүүр нь "amount", "tipAmount" гэх мэт суффиксгүй байна.
//
// Хариу (onActivityResult-аас Bundle):
//   - response_code (Int)    — 0 = амжилттай
//   - response_message (String)
//   - command_type (Int)
//   - SALE/VOID: authCode, traceNo (Long), batchNo (Long), cardNo, cardType (Int),
//                merchantId, terminalId, amount (String!), entry_mode_text, г.м.
//   - QR/NFC:   qrCode, dbRefNo, jsonRet

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as IntentLauncher from "expo-intent-launcher";
import Constants from "expo-constants";

const EPOS_SDK_VERSION = 24;

/* ============================================================
 *  Emulator / Simulator detection
 * ============================================================ */
function isEmulator(): boolean {
  // Constants.isDevice is deprecated but often still available in Expo projects
  // Alternatively check for common emulator patterns
  const isDevice = (Constants as any).isDevice;
  if (isDevice !== undefined) return !isDevice;

  // Fallback check
  return (
    Platform.OS === 'ios' || // PAX is Android only
    Platform.constants?.Model?.includes('sdk_gphone') ||
    Platform.constants?.Model?.includes('Emulator') ||
    Platform.constants?.Brand?.includes('google') && Platform.constants?.Model?.includes('sdk')
  );
}

/* ============================================================
 *  EPOS METHOD constants — Үйлдэл тус бүрийн Intent ACTION
 *  (DATABANK EPOS Open API v26 баримтаас)
 *  
 *  ⚠️ ВАРИАНТ: Хэрэв EPOS app зөвхөн `android.epos.payment.entry`-г
 *  хүлээн авдаг бол EPOS_USE_SINGLE_ACTION-ыг true болго.
 * ============================================================ */
export const EPOS_METHOD = {
  HEALTH_CHECK: "android.epos.payment.healthCheck",
  SALE: "android.epos.payment.sale",
  VOID: "android.epos.payment.void",
  VOID_CARD: "android.epos.payment.voidCard",
  CASHBACK: "android.epos.payment.cashback",
  PREAUTH: "android.epos.payment.preAuth",
  PREAUTH_CANCEL: "android.epos.payment.PreAuthCancel", // тэмдэглэл: P том үсэгтэй
  PREAUTH_COMPLETION: "android.epos.payment.preAuthCompletion",
  CHECK_TRANS: "android.epos.payment.checkTrans",
  SETTLE: "android.epos.payment.settle",
  CITIZEN_CARD: "android.epos.payment.citizenCard",
  PRINT_TRANS: "android.epos.payment.printTrans",
  PRINT_TRANS_TOTAL: "android.epos.payment.printTransTotal",
  SCAN_CODE: "android.epos.payment.scanCode",
  PRINT_BITMAP: "android.epos.tasks.printBitmap",
  PRINT_BITMAP_FROM_FILE: "android.epos.tasks.printBitmapFile",
  CHECK_PAPER: "android.epos.tasks.checkPaper",
  READ_RF_CARD: "android.epos.tasks.readRfCard", // тэмдэглэл: бага 'f'
  ADD_ROUTE: "android.epos.tasks.addRoute",
  QPAY_PAYMENT: "android.epos.payment.qpayPayment",
} as const;

// Backwards compatibility alias
export const EPOS_CATEGORY = EPOS_METHOD;

export const EPOS_COMMAND_TYPE = {
  SALE: 1,
  SALE_NO_RECEIPT: 2,
  VOID: 3,
  VOID_NO_RECEIPT: 4,
  VOID_CARD_NO_RECEIPT: 5,
  REFUND: 6,
  CASHBACK: 8,
  SETTLE: 10,
  PRE_AUTH: 12,
  PRE_AUTH_CANCEL: 13,
  PRE_AUTH_COMPLETION: 14,
  QPAY_PAYMENT: 15,
  HEALTH_CHECK: 20,
  TRANS_COMPLETE: 21,
  CITIZEN_CARD: 24,
  REPRINT_TRANS: 26,
  REPRINT_TOTAL: 27,
  PRINT_BITMAP: 28,
  SCAN_CODE: 35,
  READ_RF_CARD: 42,
  CHECK_TRANS: 44,
  ADD_ROUTE: 45,
  CHECK_PAPER: 41,
} as const;

/* ============================================================
 *  Availability check
 * ============================================================ */
let _eposAppCheckCached: boolean | null = null;

export function isEposNativeAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  return _eposAppCheckCached !== false;
}

export function resetEposAvailability() {
  _eposAppCheckCached = null;
}

/* ============================================================
 *  Intent caller (action бүрд тусгай Intent action)
 * ============================================================ */
function getCallingPackage(): string {
  return (
    (Constants.expoConfig as any)?.android?.package ||
    (Constants as any)?.androidManifest?.package ||
    "host.exp.exponent"
  );
}

async function callEposMethod(
  method: string,
  commandType: number,
  extras: Record<string, any> = {}
): Promise<any> {
  if (Platform.OS !== "android") {
    throw new Error("EPOS зөвхөн Android дээр ажиллана");
  }

  const allExtras: Record<string, any> = {
    command_type: commandType,
    sdk_version: EPOS_SDK_VERSION,
    app_package: getCallingPackage(),
    ...extras,
  };

  try {
    // ВАЖНО: method нь Intent ACTION (category биш!)
    const result: any = await IntentLauncher.startActivityAsync(method, {
      extra: allExtras,
    } as any);

    _eposAppCheckCached = true;

    const isOk = result.resultCode === IntentLauncher.ResultCode.Success;
    const respBundle: Record<string, any> = (result.extra as any) || {};

    return {
      _resultCode: result.resultCode,
      _userCancelled: !isOk,
      ...respBundle,
    };
  } catch (e: any) {
    _eposAppCheckCached = false;
    throw new Error(e?.message || "EPOS app олдсонгүй (ActivityNotFoundException)");
  }
}

/* ============================================================
 *  Overrides (PAX Debug)
 * ============================================================ */
const PAX_OVERRIDES_KEY = "pax_debug_overrides";

let _runtimeOverrides: Partial<{ useNative: boolean }> | null = null;
let _overridesLoaded = false;

async function loadOverrides() {
  if (_overridesLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(PAX_OVERRIDES_KEY);
    if (raw) _runtimeOverrides = JSON.parse(raw);
  } catch (_) {}
  _overridesLoaded = true;
}

function currentCfg() {
  const o = _runtimeOverrides || {};
  return { useNative: o.useNative !== false };
}

/* ============================================================
 *  Public types
 * ============================================================ */
export type PaxResult = {
  ok: boolean;
  approval_code?: string;
  rrn?: string;
  trace_no?: string;
  batch_no?: string;
  masked_pan?: string;
  card_type?: string;
  cardholder_name?: string;
  entry_mode?: string;
  terminal_id?: string;
  merchant_id?: string;
  merchant_name?: string;
  rsp_code?: string;
  rsp_msg?: string;
  amount?: string;
  trans_time?: string;
  raw?: any;
  error?: string;
  simulated?: boolean;
};

export type PaxCardRead = {
  ok: boolean;
  nfc_tag?: string;
  raw?: any;
  error?: string;
  simulated?: boolean;
};

export type PaxQpayResult = {
  ok: boolean;
  invoice_id?: string;
  invoice_status?: string;
  rsp_code?: string;
  rsp_msg?: string;
  amount?: string;
  qr_code?: string;
  raw?: any;
  error?: string;
  simulated?: boolean;
};

/* ============================================================
 *  Config (debug)
 * ============================================================ */
export function paxConfig() {
  return {
    sdk: "DATABANK EPOS Open API v26 (Method-based Intents)",
    native: Platform.OS === "android" && isEposNativeAvailable(),
    nativeAvailable: isEposNativeAvailable(),
    method_channel: getCallingPackage(),
    pkg: getCallingPackage(),
    action: "Per-method (see EPOS_METHOD)",
    sample_actions: {
      sale: EPOS_METHOD.SALE,
      health: EPOS_METHOD.HEALTH_CHECK,
      readCard: EPOS_METHOD.READ_RF_CARD,
    },
    platform: Platform.OS,
  };
}

/* ============================================================
 *  Helpers
 * ============================================================ */
function genDbRefNo(seed?: number | string): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const tail = String(seed || Math.floor(Math.random() * 1000))
    .padStart(3, "0")
    .slice(-3);
  return ts + tail;
}

function simulatedSale(amountMnt: number, dbRefNo: string): PaxResult {
  return {
    ok: true,
    rsp_code: "0",
    rsp_msg: "Approved (SIM)",
    approval_code: "SIM" + Math.floor(Math.random() * 900000 + 100000),
    rrn: "RRN" + Math.floor(Math.random() * 9000000 + 1000000),
    trace_no: String(Math.floor(Math.random() * 900000 + 100000)),
    batch_no: "1",
    masked_pan: "**** **** **** 4321",
    card_type: "VISA",
    cardholder_name: "TEST/CUSTOMER",
    entry_mode: "Contactless",
    terminal_id: "EPOSDEMO",
    merchant_id: "990000000001",
    merchant_name: "PETROL POS",
    amount: amountMnt.toFixed(2),
    simulated: true,
    raw: { dbRefNo, simulated: true },
  };
}

function parseTransResp(res: any, fallbackAmount?: number): PaxResult {
  const rsp = res?.response_code;
  const ok =
    res?._userCancelled !== true &&
    (rsp === 0 || rsp === "0") &&
    !!(res?.authCode || res?.refNo);

  return {
    ok,
    rsp_code: rsp !== undefined ? String(rsp) : undefined,
    rsp_msg: res?.response_message || (res?._userCancelled ? "Cancelled by user" : undefined),
    approval_code: res?.authCode || undefined,
    rrn: res?.refNo || undefined,
    trace_no: res?.traceNo !== undefined ? String(res.traceNo) : undefined,
    batch_no: res?.batchNo !== undefined ? String(res.batchNo) : undefined,
    masked_pan: res?.cardNo || undefined,
    card_type: res?.cardType !== undefined ? String(res.cardType) : undefined,
    entry_mode: res?.entry_mode_text || res?.entry_mode || undefined,
    terminal_id: res?.terminalId || undefined,
    merchant_id: res?.merchantId || undefined,
    merchant_name: res?.merchantName || undefined,
    amount: res?.amount || (fallbackAmount !== undefined ? fallbackAmount.toFixed(2) : undefined),
    trans_time: res?.transTime || undefined,
    raw: res,
    error: ok ? undefined : (res?.response_message || `response_code=${rsp ?? "?"}`),
  };
}

/* ============================================================
 *  SALE (METHOD_SALE)
 * ============================================================ */
export async function paxCharge(
  amountMnt: number,
  transactionId: string | number
): Promise<PaxResult> {
  const dbRefNo = genDbRefNo(transactionId);
  await loadOverrides();
  const cfg = currentCfg();

  // 🛡️ Emulator protection
  if (isEmulator() || Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    console.log("[PAX] Emulator detected or Native unavailable, using simulation");
    await new Promise((r) => setTimeout(r, 1400));
    return simulatedSale(amountMnt, dbRefNo);
  }

  try {
    const amountCents = Math.round(amountMnt * 100);
    const res = await callEposMethod(EPOS_METHOD.SALE, EPOS_COMMAND_TYPE.SALE, {
      amount_long: amountCents,
      dbRefNo,
      currencyCode: "496",
    });
    return parseTransResp(res, amountMnt);
  } catch (e: any) {
    return { ok: false, error: e?.message || "EPOS SALE алдаа", raw: e };
  }
}

/* ============================================================
 *  QPAY / SCAN CODE (METHOD_SCAN_CODE)
 *  Тэмдэглэл: Танай docs-д QR/QPay-г шууд `scanCode`-аар уншина.
 * ============================================================ */
export async function paxQpay(
  amountMnt: number,
  transactionId: string | number
): Promise<PaxQpayResult> {
  const dbRefNo = genDbRefNo(transactionId);
  await loadOverrides();
  const cfg = currentCfg();

  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    await new Promise((r) => setTimeout(r, 1800));
    return {
      ok: true,
      invoice_id: "QP" + Math.floor(Math.random() * 9000000 + 1000000),
      invoice_status: "PAID",
      rsp_code: "0",
      amount: amountMnt.toFixed(2),
      simulated: true,
      raw: { dbRefNo, simulated: true },
    };
  }

  try {
    const amountCents = Math.round(amountMnt * 100);
    const res = await callEposMethod(EPOS_METHOD.SCAN_CODE, EPOS_COMMAND_TYPE.SCAN_CODE, {
      amount_long: amountCents,
      dbRefNo,
    });
    const rsp = res?.response_code;
    const ok = res?._userCancelled !== true && (rsp === 0 || rsp === "0");
    return {
      ok,
      invoice_id: res?.dbRefNo || dbRefNo,
      invoice_status: ok ? "PAID" : "FAILED",
      qr_code: res?.qrCode,
      rsp_code: rsp !== undefined ? String(rsp) : undefined,
      rsp_msg: res?.response_message,
      amount: res?.amount,
      raw: res,
      error: ok ? undefined : (res?.response_message || `response_code=${rsp ?? "?"}`),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "EPOS QPay алдаа" };
  }
}

/* ============================================================
 *  READ RF CARD (METHOD_READ_RF_CARD)
 * ============================================================ */
export async function paxReadCard(): Promise<PaxCardRead> {
  await loadOverrides();
  const cfg = currentCfg();

  if (isEmulator() || Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    console.log("[PAX] Emulator detected, simulating card tap");
    await new Promise((r) => setTimeout(r, 1200));
    const tag =
      "AA" +
      Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0") +
      Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
    return { ok: true, nfc_tag: tag, simulated: true, raw: { simulated: true } };
  }

  try {
    const res = await callEposMethod(
      EPOS_METHOD.READ_RF_CARD,
      EPOS_COMMAND_TYPE.READ_RF_CARD
    );
    const rsp = res?.response_code;
    const tag = (res?.cardNo || res?.rfCardId || res?.nfc_tag || "")
      .toString()
      .toUpperCase();
    const ok = res?._userCancelled !== true && (rsp === 0 || rsp === "0") && !!tag;
    return {
      ok,
      nfc_tag: tag || undefined,
      raw: res,
      error: ok ? undefined : (res?.response_message || "Карт уншигдсангүй"),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "EPOS NFC алдаа" };
  }
}

/* ============================================================
 *  HEALTH CHECK (METHOD_HEALTH_CHECK)
 * ============================================================ */
export async function paxHealthCheck(): Promise<{ ok: boolean; error?: string; raw?: any }> {
  await loadOverrides();
  const cfg = currentCfg();

  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    return { ok: true, raw: { simulated: true } };
  }
  try {
    const res = await callEposMethod(
      EPOS_METHOD.HEALTH_CHECK,
      EPOS_COMMAND_TYPE.HEALTH_CHECK
    );
    const rsp = res?.response_code;
    const ok = res?._userCancelled !== true && (rsp === 0 || rsp === "0");
    return {
      ok,
      raw: res,
      error: ok ? undefined : (res?.response_message || `response_code=${rsp}`),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "EPOS app холбогдоогүй байна" };
  }
}

/* ============================================================
 *  VOID (METHOD_VOID)
 * ============================================================ */
export async function paxVoid(traceNo: string, transactionId: string | number): Promise<PaxResult> {
  const dbRefNo = genDbRefNo(transactionId);
  await loadOverrides();
  const cfg = currentCfg();

  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, rsp_code: "0", rsp_msg: "Voided (SIM)", trace_no: traceNo, simulated: true };
  }
  try {
    const res = await callEposMethod(EPOS_METHOD.VOID, EPOS_COMMAND_TYPE.VOID, {
      traceNo_long: Number(traceNo) || 0,
      dbRefNo,
    });
    return parseTransResp(res);
  } catch (e: any) {
    return { ok: false, error: e?.message || "EPOS Void алдаа" };
  }
}

/* ============================================================
 *  SETTLE (METHOD_SETTLE)
 * ============================================================ */
export async function paxSettle(): Promise<{
  ok: boolean;
  rsp_code?: string;
  rsp_msg?: string;
  raw?: any;
  error?: string;
}> {
  await loadOverrides();
  const cfg = currentCfg();
  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true, rsp_code: "0", rsp_msg: "Settled (SIM)" };
  }
  try {
    const res = await callEposMethod(EPOS_METHOD.SETTLE, EPOS_COMMAND_TYPE.SETTLE);
    const rsp = res?.response_code;
    const ok = res?._userCancelled !== true && (rsp === 0 || rsp === "0");
    return {
      ok,
      rsp_code: rsp !== undefined ? String(rsp) : undefined,
      rsp_msg: res?.response_message,
      raw: res,
      error: ok ? undefined : (res?.response_message || `response_code=${rsp}`),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

/* ============================================================
 *  CHECK TRANS (METHOD_CHECK_TRANS)
 * ============================================================ */
export async function paxCheckTrans(dbRefNo: string): Promise<PaxResult> {
  await loadOverrides();
  const cfg = currentCfg();
  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    return { ok: true, rsp_code: "0", rsp_msg: "Found (SIM)", simulated: true };
  }
  try {
    const res = await callEposMethod(
      EPOS_METHOD.CHECK_TRANS,
      EPOS_COMMAND_TYPE.CHECK_TRANS,
      { dbRefNo }
    );
    return parseTransResp(res);
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

/* ============================================================
 *  REPRINT (METHOD_PRINT_TRANS)
 * ============================================================ */
export async function paxReprint(dbRefNo: string): Promise<{
  ok: boolean;
  raw?: any;
  error?: string;
}> {
  await loadOverrides();
  const cfg = currentCfg();
  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    return { ok: true };
  }
  try {
    const res = await callEposMethod(
      EPOS_METHOD.PRINT_TRANS,
      EPOS_COMMAND_TYPE.REPRINT_TRANS,
      { dbRefNo }
    );
    const rsp = res?.response_code;
    const ok = res?._userCancelled !== true && (rsp === 0 || rsp === "0");
    return { ok, raw: res, error: ok ? undefined : (res?.response_message || `response_code=${rsp}`) };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

/* ============================================================
 *  PRINT BITMAP (METHOD_PRINT_BITMAP) — НӨАТ баримт хэвлэх
 * ============================================================ */
export async function paxPrintBitmap(base64Image: string): Promise<{
  ok: boolean;
  raw?: any;
  error?: string;
}> {
  await loadOverrides();
  const cfg = currentCfg();
  if (Platform.OS !== "android" || !cfg.useNative || !isEposNativeAvailable()) {
    return { ok: true };
  }
  try {
    const res = await callEposMethod(
      EPOS_METHOD.PRINT_BITMAP,
      EPOS_COMMAND_TYPE.PRINT_BITMAP,
      { bitmap: base64Image }
    );
    const rsp = res?.response_code;
    const ok = res?._userCancelled !== true && (rsp === 0 || rsp === "0");
    return { ok, raw: res, error: ok ? undefined : (res?.response_message || `response_code=${rsp}`) };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}
