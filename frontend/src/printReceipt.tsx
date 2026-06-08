// Thermal Receipt Generator
//
// React Native View-г base64 PNG image болгож, PAX A8900-ийн EPOS SDK-ийн
// printBitmap-руу илгээнэ. Зориулагдсан хэмжээ:
//   - 58mm thermal: 384px өргөн (default)
//   - 80mm thermal: 576px өргөн
//
// Хэрэглээ:
//   import { printReceipt } from "../src/printReceipt";
//   await printReceipt({
//     amount: 10000,
//     vatReceipt: "ABC123",
//     ...
//   });

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { captureRef } from "react-native-view-shot";
import QRCode from "react-native-qrcode-svg";
import { paxPrintBitmap } from "./paxPayment";

export type ReceiptData = {
  // Header
  station_name?: string;
  station_address?: string;
  terminal_id?: string;
  date?: string;
  receipt_no?: string;

  // Trans details
  pump_no: number;
  fuel_label: string;
  volume_liters?: number;
  unit_price?: number;
  amount: number; // нийт төлсөн дүн

  // Payment
  payment_method: string; // "Бэлэн", "Банк карт", "QPay", "Шатахуун карт", "Хуваан"
  splits?: Array<{ method: string; amount: number }>;
  approval_code?: string;
  rrn?: string;
  masked_pan?: string;

  // VAT (НӨАТ)
  vat_type?: "Иргэн" | "Бараа худалдан авагч" | "Байгууллага";
  vat_register?: string;
  vat_receipt_number: string;
  vat_amount?: number; // НӨАТ дүн (10%)

  // Cashier
  cashier_name?: string;
};

type Props = { data: ReceiptData };

// ─────────────────────────────────────────────────────────────────────
// Off-screen receipt component (capture хийгдэх)
// ─────────────────────────────────────────────────────────────────────
export const ReceiptView = forwardRef<View, Props>(({ data }, ref) => {
  const totalAmount = data.amount;
  const vatAmount = data.vat_amount ?? Math.round(totalAmount / 11);
  const subtotal = totalAmount - vatAmount;
  const qrPayload = `https://ebarimt.mn/?billId=${data.vat_receipt_number}&amount=${totalAmount}&register=${data.vat_register || ""}`;

  return (
    <View ref={ref} collapsable={false} style={styles.root}>
      {/* Header */}
      <Text style={styles.h1}>{data.station_name || "UBOIL ШАТАХУУН СТАНЦ"}</Text>
      {!!data.station_address && <Text style={styles.center}>{data.station_address}</Text>}
      {!!data.terminal_id && <Text style={styles.center}>Терминал: {data.terminal_id}</Text>}
      <Text style={styles.dashed} />

      {/* Receipt info */}
      <View style={styles.row}>
        <Text style={styles.lblSm}>Огноо:</Text>
        <Text style={styles.valSm}>{data.date || new Date().toLocaleString("mn-MN")}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.lblSm}>Баримт №:</Text>
        <Text style={styles.valSm}>{data.receipt_no || "—"}</Text>
      </View>
      <Text style={styles.dashed} />

      {/* Trans details */}
      <Text style={styles.h2}>{data.fuel_label} • Түгээгүүр №{data.pump_no}</Text>
      {!!data.volume_liters && (
        <View style={styles.row}>
          <Text style={styles.lblSm}>Хэмжээ:</Text>
          <Text style={styles.valSm}>{data.volume_liters.toFixed(2)} л</Text>
        </View>
      )}
      {!!data.unit_price && (
        <View style={styles.row}>
          <Text style={styles.lblSm}>Нэгж үнэ:</Text>
          <Text style={styles.valSm}>{data.unit_price.toLocaleString("en-US")} ₮/л</Text>
        </View>
      )}
      <View style={styles.row}>
        <Text style={styles.lblSm}>Дүн:</Text>
        <Text style={styles.valSm}>{subtotal.toLocaleString("en-US")} ₮</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.lblSm}>НӨАТ (10%):</Text>
        <Text style={styles.valSm}>{vatAmount.toLocaleString("en-US")} ₮</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.lblTotal}>НИЙТ:</Text>
        <Text style={styles.valTotal}>{totalAmount.toLocaleString("en-US")} ₮</Text>
      </View>
      <Text style={styles.dashed} />

      {/* Payment */}
      <Text style={styles.h3}>ТӨЛБӨР</Text>
      {data.splits && data.splits.length > 0 ? (
        data.splits.map((s, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.lblSm}>  {s.method}:</Text>
            <Text style={styles.valSm}>{Math.round(s.amount).toLocaleString("en-US")} ₮</Text>
          </View>
        ))
      ) : (
        <View style={styles.row}>
          <Text style={styles.lblSm}>{data.payment_method}:</Text>
          <Text style={styles.valSm}>{totalAmount.toLocaleString("en-US")} ₮</Text>
        </View>
      )}
      {!!data.approval_code && (
        <View style={styles.row}>
          <Text style={styles.lblSm}>  Approval:</Text>
          <Text style={styles.valSm}>{data.approval_code}</Text>
        </View>
      )}
      {!!data.rrn && (
        <View style={styles.row}>
          <Text style={styles.lblSm}>  RRN:</Text>
          <Text style={styles.valSm}>{data.rrn}</Text>
        </View>
      )}
      {!!data.masked_pan && (
        <View style={styles.row}>
          <Text style={styles.lblSm}>  Карт:</Text>
          <Text style={styles.valSm}>{data.masked_pan}</Text>
        </View>
      )}
      <Text style={styles.dashed} />

      {/* VAT info */}
      <Text style={styles.h3}>Е-БАРИМТ</Text>
      <View style={styles.row}>
        <Text style={styles.lblSm}>Худ. авагч:</Text>
        <Text style={styles.valSm}>{data.vat_type || "Иргэн"}</Text>
      </View>
      {!!data.vat_register && (
        <View style={styles.row}>
          <Text style={styles.lblSm}>Регистр:</Text>
          <Text style={styles.valSm}>{data.vat_register}</Text>
        </View>
      )}
      <View style={styles.center}>
        <View style={{ marginTop: 8, padding: 4, backgroundColor: "#fff" }}>
          <QRCode value={qrPayload} size={140} color="#000" backgroundColor="#fff" />
        </View>
        <Text style={[styles.mono, { marginTop: 4, fontSize: 9 }]}>{data.vat_receipt_number}</Text>
        <Text style={[styles.center, { fontSize: 8, marginTop: 2 }]}>ebarimt.mn-аас шалгана уу</Text>
      </View>
      <Text style={styles.dashed} />

      {/* Footer */}
      {!!data.cashier_name && (
        <Text style={[styles.center, { fontSize: 9 }]}>Кассчин: {data.cashier_name}</Text>
      )}
      <Text style={[styles.center, { fontSize: 9 }]}>Танд баярлалаа!</Text>
      <Text style={[styles.center, { fontSize: 8, marginTop: 4 }]}>ubоil.mn</Text>
      <View style={{ height: 30 }} />
    </View>
  );
});
ReceiptView.displayName = "ReceiptView";

// ─────────────────────────────────────────────────────────────────────
// Capture & send to printer
// ─────────────────────────────────────────────────────────────────────

/**
 * Эх ачаалал — баримтын View-г render хийн capture хийгээд EPOS printer-руу илгээнэ.
 *
 * Энэ функц нь ReactNative root-д off-screen View байх ёстой. Хэрэглээний
 * жишээ нь /app/frontend/app/_layout.tsx-д <ReceiptPrinterProvider/>-ийг
 * бүхэлд нь wrap хийнэ.
 */
let _pendingPrint: { data: ReceiptData; resolve: (r: { ok: boolean; error?: string }) => void } | null = null;
let _trigger: ((d: ReceiptData) => void) | null = null;

export function setReceiptPrintTrigger(trigger: (d: ReceiptData) => void) {
  _trigger = trigger;
}

export function printReceipt(data: ReceiptData): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!_trigger) {
      resolve({ ok: false, error: "ReceiptPrinterProvider _layout.tsx-д mount хийгдээгүй" });
      return;
    }
    _pendingPrint = { data, resolve };
    _trigger(data);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Provider — _layout.tsx дотор бүх app-ыг wrap хийнэ
// ─────────────────────────────────────────────────────────────────────
export function ReceiptPrinterProvider({ children }: { children: React.ReactNode }) {
  const [currentData, setCurrentData] = useState<ReceiptData | null>(null);
  const captureViewRef = useRef<View>(null);

  useEffect(() => {
    setReceiptPrintTrigger((data) => {
      setCurrentData(data);
    });
  }, []);

  useEffect(() => {
    if (!currentData) return;
    // View render дууссаны дараа capture хийнэ
    const timer = setTimeout(async () => {
      try {
        if (!captureViewRef.current) {
          _pendingPrint?.resolve({ ok: false, error: "Capture ref байхгүй" });
          return;
        }
        const base64 = await captureRef(captureViewRef, {
          format: "png",
          quality: 1,
          result: "base64",
        });
        // EPOS printer-руу илгээх
        const res = await paxPrintBitmap(base64);
        _pendingPrint?.resolve(res);
      } catch (e: any) {
        _pendingPrint?.resolve({ ok: false, error: e?.message || "Capture/print алдаа" });
      } finally {
        _pendingPrint = null;
        setCurrentData(null);
      }
    }, 400); // render-ийн хүлээлт
    return () => clearTimeout(timer);
  }, [currentData]);

  return (
    <>
      {children}
      {/* Off-screen capture area — экраны гадна байрлуулав */}
      {currentData && (
        <View
          style={{
            position: "absolute",
            top: -10000,
            left: 0,
            width: 384,
            backgroundColor: "#fff",
          }}
          pointerEvents="none"
        >
          <ReceiptView ref={captureViewRef} data={currentData} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 384,
    backgroundColor: "#fff",
    padding: 12,
  },
  h1: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    color: "#000",
    marginBottom: 2,
  },
  h2: {
    fontSize: 14,
    fontWeight: "800",
    color: "#000",
    marginVertical: 4,
  },
  h3: {
    fontSize: 12,
    fontWeight: "800",
    color: "#000",
    marginVertical: 4,
    letterSpacing: 1,
  },
  center: {
    textAlign: "center",
    fontSize: 10,
    color: "#000",
  },
  dashed: {
    height: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    borderStyle: "dashed",
    marginVertical: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 1,
  },
  lblSm: { fontSize: 11, color: "#000" },
  valSm: { fontSize: 11, color: "#000", fontWeight: "600" },
  lblTotal: { fontSize: 14, fontWeight: "900", color: "#000" },
  valTotal: { fontSize: 14, fontWeight: "900", color: "#000" },
  mono: { fontFamily: "monospace", color: "#000" },
});
