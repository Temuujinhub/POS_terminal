// Receipt preview with QR + print actions
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { COLORS, RADIUS, API, fmtMNT, FUEL_COLORS } from "../../src/theme";

type Tx = {
  id: string;
  operator_name: string;
  pump_number: number;
  fuel_type: string;
  liters: number;
  price_per_liter: number;
  amount: number;
  payment_method: "cash" | "card" | "membership";
  membership_card?: string;
  customer_type: string;
  register_number?: string;
  customer_name?: string;
  ebarimt_lottery: string;
  ebarimt_bill_id: string;
  ebarimt_qr_data: string;
  printed: boolean;
  created_at: string;
};

const PAY_LABEL: Record<string, string> = { cash: "Бэлэн", card: "Карт", membership: "Гишүүний карт" };

export default function Receipt() {
  const { txId } = useLocalSearchParams<{ txId: string }>();
  const router = useRouter();
  const [tx, setTx] = useState<Tx | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    fetch(`${API}/transactions/${txId}`).then((r) => r.json()).then((d) => {
      setTx(d);
      setPrinted(d.printed);
    });
  }, [txId]);

  const onPrint = async () => {
    setPrinting(true);
    // MOCKED Bluetooth print - simulate printer delay
    setTimeout(async () => {
      try {
        await fetch(`${API}/transactions/mark-printed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_id: txId }),
        });
        setPrinted(true);
        Alert.alert("Хэвлэгдлээ", "НӨАТ-ын баримт амжилттай хэвлэгдлээ.\n(Тэмдэглэл: Bluetooth принтер симуляц - бодит хэвлэлтэнд dev build шаардана)");
      } catch {
        Alert.alert("Алдаа", "Хэвлэлт амжилтгүй боллоо");
      } finally {
        setPrinting(false);
      }
    }, 1200);
  };

  if (!tx) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }

  const date = new Date(tx.created_at);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="receipt-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace("/(tabs)/dashboard")}
          style={styles.backBtn}
          testID="receipt-close-btn"
        >
          <Ionicons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>НӨАТ-ын баримт</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        <View style={styles.successBanner}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={26} color="#fff" />
          </View>
          <View>
            <Text style={styles.successTitle}>Гүйлгээ амжилттай</Text>
            <Text style={styles.successSub}>Баримт үүсгэгдлээ</Text>
          </View>
        </View>

        <View style={styles.receipt}>
          <Text style={styles.merchantName}>PETROL POS №24</Text>
          <Text style={styles.merchantMeta}>УБ хот, Сүхбаатар дүүрэг</Text>
          <Text style={styles.merchantMeta}>ТТД: 5012345</Text>

          <View style={styles.dashed} />

          <Row label="Огноо" value={date.toLocaleString("mn-MN")} />
          <Row label="Кассчин" value={tx.operator_name} />
          <Row label="Түгээгүүр" value={`№${tx.pump_number}`} />

          <View style={styles.dashed} />

          <View style={styles.itemRow}>
            <View style={[styles.fuelDot, { backgroundColor: FUEL_COLORS[tx.fuel_type] || COLORS.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{tx.fuel_type}</Text>
              <Text style={styles.itemMeta}>
                {tx.liters.toFixed(2)} L × {fmtMNT(tx.price_per_liter)}
              </Text>
            </View>
            <Text style={styles.itemAmt}>{fmtMNT(tx.amount)}</Text>
          </View>

          <View style={styles.dashed} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>НИЙТ</Text>
            <Text style={styles.totalValue} testID="receipt-total">{fmtMNT(tx.amount)}</Text>
          </View>
          <Row label="Төлсөн" value={PAY_LABEL[tx.payment_method] || tx.payment_method} />
          {tx.membership_card && <Row label="Карт" value={tx.membership_card} />}

          <View style={styles.dashed} />

          <Text style={styles.sectionTag}>Е-БАРИМТ</Text>
          <Row label="Худ. авагч" value={tx.customer_type === "organization" ? "Байгууллага" : "Хувь хүн"} />
          {tx.register_number && <Row label="Регистр" value={tx.register_number} />}
          {tx.customer_name && <Row label="Нэр" value={tx.customer_name} />}
          <Row label="Сугалаа" value={tx.ebarimt_lottery} />
          <Row label="Билл ID" value={tx.ebarimt_bill_id.slice(0, 12) + "..."} mono />

          <View style={styles.qrBox}>
            <View style={styles.qrInner}>
              <QRCode
                value={tx.ebarimt_qr_data}
                size={180}
                color={COLORS.textPrimary}
                backgroundColor="#fff"
              />
            </View>
            <Text style={styles.qrText}>e-Barimt.mn QR код</Text>
          </View>

          <Text style={styles.thanks}>Танд баярлалаа!</Text>
        </View>
      </ScrollView>

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
          onPress={() => router.replace("/(tabs)/dashboard")}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background },
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
  merchantName: { textAlign: "center", fontSize: 18, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: 1 },
  merchantMeta: { textAlign: "center", fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  dashed: { borderStyle: "dashed", borderTopWidth: 1, borderColor: COLORS.border, marginVertical: 12 },
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
});
