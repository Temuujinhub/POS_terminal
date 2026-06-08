// Membership card lookup
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import Keypad from "../src/Keypad";
import { COLORS, API, RADIUS, fmtMNT } from "../src/theme";
import { saleStore } from "../src/saleStore";

type Card = {
  card_number: string;
  holder_name: string;
  customer_type: "individual" | "organization";
  register_number: string;
  balance: number;
};

export default function Membership() {
  const router = useRouter();
  const [cardNum, setCardNum] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(false);

  const sale = saleStore.get();

  const handleDigit = (d: string) => {
    if (d === ".") return;
    if (cardNum.length >= 12) return;
    setCardNum(cardNum + d);
    setCard(null);
  };
  const handleBack = () => { setCardNum((p) => p.slice(0, -1)); setCard(null); };

  const lookup = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/membership/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_number: cardNum }),
      });
      const d = await r.json();
      if (!r.ok) {
        Alert.alert("Алдаа", d.detail || "Карт олдсонгүй");
        return;
      }
      setCard(d);
    } catch {
      Alert.alert("Алдаа", "Сервертэй холбогдож чадсангүй");
    } finally {
      setLoading(false);
    }
  };

  const proceed = () => {
    if (!card) return;
    if (card.balance < (sale.amount || 0)) {
      Alert.alert("Үлдэгдэл хүрэлцэхгүй", `Үлдэгдэл: ${fmtMNT(card.balance)}\nТөлөх дүн: ${fmtMNT(sale.amount || 0)}`);
      return;
    }
    saleStore.set({
      membershipCard: card.card_number,
      membershipHolder: card.holder_name,
      membershipBalance: card.balance,
      customerType: card.customer_type,
      registerNumber: card.register_number,
      customerName: card.holder_name,
    });
    router.push("/noat");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="membership-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Гишүүний карт</Text>
          <Text style={styles.sub}>Картын дугаараа оруулна уу</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        <View style={styles.cardInputBox}>
          <MaterialCommunityIcons name="card-account-details-star-outline" size={26} color={COLORS.primary} />
          <Text style={styles.cardInput} testID="card-input">{cardNum || "Дугаар оруулна уу"}</Text>
        </View>

        <View style={styles.demoRow}>
          <Text style={styles.demoText}>Туршилт: 1000000001 / 1000000003</Text>
        </View>

        {card && (
          <View style={styles.resultCard} testID="card-result">
            <View style={styles.resultRow}>
              <View>
                <Text style={styles.resultLabel}>Эзэмшигч</Text>
                <Text style={styles.resultName}>{card.holder_name}</Text>
                <Text style={styles.resultMeta}>
                  {card.customer_type === "individual" ? "Хувь хүн" : "Байгууллага"} • {card.register_number}
                </Text>
              </View>
              <View style={styles.balanceBox}>
                <Text style={styles.balanceLabel}>ҮЛДЭГДЭЛ</Text>
                <Text style={styles.balanceValue}>{fmtMNT(card.balance)}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.payRow}>
              <Text style={styles.payRowLabel}>Төлөх дүн</Text>
              <Text style={styles.payRowValue}>{fmtMNT(sale.amount || 0)}</Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payRowLabel}>Хасагдсаны дараах</Text>
              <Text style={[styles.payRowValue, { color: card.balance >= (sale.amount || 0) ? COLORS.success : COLORS.accentRed }]}>
                {fmtMNT(card.balance - (sale.amount || 0))}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.payBtn, card.balance < (sale.amount || 0) && { backgroundColor: COLORS.accentRed }]}
              onPress={proceed}
              activeOpacity={0.85}
              testID="charge-btn"
            >
              <Text style={styles.payBtnText}>
                {card.balance >= (sale.amount || 0) ? "Үргэлжлүүлэх" : "Үлдэгдэл хүрэлцэхгүй"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.keypadOuter}>
        <Keypad
          onPress={handleDigit}
          onBackspace={handleBack}
          showSubmit
          submitLabel={loading ? "..." : "Шалгах"}
          submitDisabled={cardNum.length < 6 || loading}
          onSubmit={lookup}
        />
        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 8 }} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  cardInputBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", padding: 18, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardInput: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: 2, flex: 1 },
  demoRow: { paddingVertical: 8, alignItems: "center" },
  demoText: { fontSize: 11, color: COLORS.textMuted },
  resultCard: { backgroundColor: "#fff", borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginTop: 8 },
  resultRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  resultLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1 },
  resultName: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary, marginTop: 4 },
  resultMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  balanceBox: { alignItems: "flex-end" },
  balanceLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1 },
  balanceValue: { fontSize: 18, fontWeight: "800", color: COLORS.primary, marginTop: 4 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  payRowLabel: { fontSize: 13, color: COLORS.textSecondary, fontWeight: "600" },
  payRowValue: { fontSize: 14, color: COLORS.textPrimary, fontWeight: "800" },
  payBtn: { backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: "center", marginTop: 12 },
  payBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  keypadOuter: { padding: 20, marginTop: "auto" },
});
