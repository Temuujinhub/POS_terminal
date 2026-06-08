// Live finalize receipt — shows e-Barimt details, QR code, and print button
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { COLORS, RADIUS, fmtMNT } from "../../src/theme";

const PAY_LABEL: Record<string, string> = {
  cash: "Бэлэн", bank_card: "Банкны карт", qpay: "QPay",
  fuel_card: "Шатахуун карт", invoice: "Нэхэмжлэх",
};

export default function LiveReceipt() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    txId: string; total: string; liters: string; fuel: string;
    payment: string; vatNumber: string; vatType: string; vatRegister?: string;
    pump?: string; bankApproval?: string;
    paxRrn?: string; paxPan?: string; paxTerminal?: string;
    splitJson?: string;
    // 🆕 Prepay metadata
    prepayFlow?: string; prepaidAmount?: string;
    refundAmount?: string; refundMethod?: string;
  }>();
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [printToast, setPrintToast] = useState<string | null>(null);

  const splitLines: Array<{ m: string; a: number }> = (() => {
    try {
      return params.splitJson ? JSON.parse(params.splitJson) : [];
    } catch { return []; }
  })();

  const total = parseFloat(params.total || "0");
  const liters = parseFloat(params.liters || "0");
  const unitPrice = liters > 0 ? Math.round(total / liters) : 0;
  const qrData = `https://ebarimt.mn/?billId=${params.vatNumber}&amount=${total}&register=${params.vatRegister || ""}`;

  // 🆕 Prepay info
  const isPrepay = params.prepayFlow === "1";
  const prepaidAmount = parseFloat(params.prepaidAmount || "0");
  const refundAmount = parseFloat(params.refundAmount || "0");

  const onPrint = () => {
    setPrinting(true);
    setPrintToast(null);
    // Simulated Bluetooth thermal print (real printing requires dev build + ESC/POS lib)
    setTimeout(() => {
      setPrinting(false);
      setPrinted(true);
      setPrintToast(
        "✓ НӨАТ-ын баримт амжилттай хэвлэгдлээ. (Bluetooth принтер симуляц — бодит хэвлэлтэнд dev build шаардана)"
      );
      // Auto-hide toast after 5 seconds
      setTimeout(() => setPrintToast(null), 5000);
    }, 1300);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => setPrintToast(null);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="live-receipt-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace("/live/dashboard")}
          style={styles.backBtn}
          testID="receipt-close-btn"
        >
          <Ionicons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>НӨАТ-ын баримт</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
        <View style={styles.successBanner} testID="success-banner">
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={26} color="#fff" />
          </View>
          <View>
            <Text style={styles.successTitle}>Гүйлгээ амжилттай</Text>
            <Text style={styles.successSub}>Баримт үүсгэгдлээ</Text>
          </View>
        </View>

        <View style={styles.receipt}>
          <View style={styles.merchantHead}>
            <Image
              source={require("../../assets/images/uboil-logo.png")}
              style={styles.merchantLogo}
              resizeMode="contain"
            />
            <Text style={styles.merchantName}>UBoil POS</Text>
            <Text style={styles.merchantMeta}>uboil.flux.mn</Text>
          </View>

          <View style={styles.dashed} />

          <Row label="Огноо" value={new Date().toLocaleString("mn-MN")} />
          {params.pump && <Row label="Түгээгүүр" value={`№${params.pump}`} />}
          <Row label="Гүйлгээ #" value={params.txId} />

          <View style={styles.dashed} />

          <View style={styles.itemRow}>
            <View style={[styles.fuelDot, { backgroundColor: COLORS.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{params.fuel || "Шатахуун"}</Text>
              <Text style={styles.itemMeta}>
                {liters.toFixed(2)} L × {fmtMNT(unitPrice)}
              </Text>
            </View>
            <Text style={styles.itemAmt}>{fmtMNT(total)}</Text>
          </View>

          <View style={styles.dashed} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>НИЙТ</Text>
            <Text style={styles.totalValue} testID="receipt-total">{fmtMNT(total)}</Text>
          </View>
          <Row label="Төлсөн" value={splitLines.length > 1 ? "Хосолсон" : (PAY_LABEL[params.payment] || params.payment)} />
          {splitLines.length > 1 && splitLines.map((l, i) => (
            <Row
              key={i}
              label={`  • ${PAY_LABEL[l.m] || l.m}`}
              value={fmtMNT(l.a)}
            />
          ))}
          {params.bankApproval && <Row label="Approval" value={params.bankApproval} mono />}
          {params.paxRrn ? <Row label="RRN" value={params.paxRrn} mono /> : null}
          {params.paxPan ? <Row label="Карт" value={params.paxPan} mono /> : null}
          {params.paxTerminal ? <Row label="Terminal" value={params.paxTerminal} mono /> : null}

          {/* 🆕 Prepay урсгалын мэдээлэл: урьдчилсан төлбөр + илүүдэл буцаалт */}
          {isPrepay && (
            <>
              <View style={styles.dashed} />
              <Row label="Урьдчилж төлсөн" value={fmtMNT(prepaidAmount)} />
              {refundAmount > 0 && (
                <View style={styles.refundBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.refundLabel}>ИЛҮҮДЭЛ ЭРГҮҮЛЭН ОЛГОНО</Text>
                    <Text style={styles.refundNote}>Бэлнээр буцаана уу</Text>
                  </View>
                  <Text style={styles.refundValue}>{fmtMNT(refundAmount)}</Text>
                </View>
              )}
              {refundAmount === 0 && prepaidAmount > 0 && (
                <Row label="Илүүдэл" value="—" />
              )}
            </>
          )}

          <View style={styles.dashed} />

          <Text style={styles.sectionTag}>Е-БАРИМТ</Text>
          <Row label="Худ. авагч" value={params.vatType} />
          {params.vatRegister && <Row label="Регистр" value={params.vatRegister} />}
          <Row label="Баримт #" value={params.vatNumber.length > 18 ? params.vatNumber.slice(0, 18) + "..." : params.vatNumber} mono />

          <View style={styles.qrBox}>
            <View style={styles.qrInner} testID="qr-code">
              <QRCode value={qrData} size={180} color={COLORS.textPrimary} backgroundColor="#fff" />
            </View>
            <Text style={styles.qrText}>e-Barimt.mn QR код</Text>
          </View>

          <Text style={styles.thanks}>Танд баярлалаа!</Text>
        </View>
      </ScrollView>

      {printToast && (
        <View style={styles.toast} testID="print-toast">
          <MaterialCommunityIcons name="check-circle" size={20} color="#fff" />
          <Text style={styles.toastText}>{printToast}</Text>
        </View>
      )}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.printBtn, printed && { backgroundColor: COLORS.success }]}
          onPress={onPrint}
          disabled={printing}
          activeOpacity={0.85}
          testID="print-btn"
        >
          {printing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons name={printed ? "check" : "printer-pos"} size={22} color="#fff" />
              <Text style={styles.printBtnText}>{printed ? "Хэвлэгдсэн" : "Хэвлэх"}</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.replace("/live/dashboard")}
          activeOpacity={0.85}
          testID="done-btn"
        >
          <Text style={styles.doneText}>Дуусгах</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && { fontFamily: "monospace" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary },
  successBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#ECFDF5", padding: 14, borderRadius: RADIUS.xl, marginBottom: 16,
    borderWidth: 1, borderColor: "#A7F3D0",
  },
  successIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.success, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 14, fontWeight: "800", color: "#065F46" },
  successSub: { fontSize: 12, color: "#047857", marginTop: 2 },
  receipt: { backgroundColor: "#fff", borderRadius: RADIUS.xl, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  merchantHead: { alignItems: "center" },
  merchantLogo: { width: 56, height: 56, borderRadius: 12, marginBottom: 6 },
  merchantName: { textAlign: "center", fontSize: 18, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: 1 },
  merchantMeta: { textAlign: "center", fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  dashed: { borderStyle: "dashed", borderTopWidth: 1, borderColor: COLORS.border, marginVertical: 12 },
  refundBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: "#FCD34D" },
  refundLabel: { fontSize: 11, fontWeight: "800", color: "#92400E", letterSpacing: 0.5 },
  refundNote: { fontSize: 11, color: "#92400E", marginTop: 2 },
  refundValue: { fontSize: 20, fontWeight: "800", color: "#B45309" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLabel: { fontSize: 12, color: COLORS.textSecondary, fontWeight: "600" },
  rowValue: { fontSize: 13, color: COLORS.textPrimary, fontWeight: "700" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  fuelDot: { width: 12, height: 12, borderRadius: 6 },
  itemName: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  itemMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  itemAmt: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  totalLabel: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: 1 },
  totalValue: { fontSize: 22, fontWeight: "800", color: COLORS.primary, letterSpacing: -0.5 },
  sectionTag: { fontSize: 10, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1.5, textAlign: "center", marginBottom: 8 },
  qrBox: { alignItems: "center", marginTop: 16 },
  qrInner: { padding: 12, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  qrText: { fontSize: 11, color: COLORS.textMuted, marginTop: 8, fontWeight: "700" },
  thanks: { textAlign: "center", fontSize: 12, color: COLORS.textSecondary, marginTop: 16, fontWeight: "600" },
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: 10, padding: 16, paddingBottom: 24,
    backgroundColor: "#fff", borderTopWidth: 1, borderColor: COLORS.border,
  },
  printBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.lg,
  },
  printBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  doneBtn: {
    paddingVertical: 16, paddingHorizontal: 22, borderRadius: RADIUS.lg,
    borderWidth: 2, borderColor: COLORS.border, backgroundColor: "#fff",
  },
  doneText: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary },
  toast: {
    position: "absolute", left: 16, right: 16, bottom: 96,
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: COLORS.success, padding: 14, borderRadius: RADIUS.lg,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700", lineHeight: 18 },
});
