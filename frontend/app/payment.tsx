// Payment method picker
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, fmtMNT } from "../src/theme";
import { saleStore } from "../src/saleStore";

export default function Payment() {
  const router = useRouter();
  const sale = saleStore.get();

  const choose = (method: "cash" | "card" | "membership") => {
    saleStore.set({ paymentMethod: method });
    if (method === "membership") {
      router.push("/membership");
    } else {
      router.push("/noat");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="payment-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Төлбөрийн хэлбэр</Text>
          <Text style={styles.sub}>Хэрхэн төлөхөө сонгоно уу</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>ТӨЛӨХ ДҮН</Text>
          <Text style={styles.summaryAmount} testID="payment-amount">{fmtMNT(sale.amount || 0)}</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryItem}>{sale.fuelType}</Text>
            <Text style={styles.summaryItem}>•</Text>
            <Text style={styles.summaryItem}>{(sale.liters || 0).toFixed(2)} L</Text>
            <Text style={styles.summaryItem}>•</Text>
            <Text style={styles.summaryItem}>№{sale.pumpNumber}</Text>
          </View>
        </View>

        <PayOption
          icon="cash-multiple" iconColor="#16A34A" bg="#F0FDF4"
          title="Бэлэн мөнгө" sub="Кассаар хүлээн авах"
          onPress={() => choose("cash")} testID="pay-cash"
        />
        <PayOption
          icon="credit-card-outline" iconColor="#1D4ED8" bg="#EFF6FF"
          title="Банкны карт" sub="POS терминалаар"
          onPress={() => choose("card")} testID="pay-card"
        />
        <PayOption
          icon="card-account-details-star-outline" iconColor={COLORS.primary} bg="#F0FDFA"
          title="Гишүүний карт" sub="Үлдэгдлээс хасна"
          onPress={() => choose("membership")} testID="pay-membership"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function PayOption({ icon, iconColor, bg, title, sub, onPress, testID }: any) {
  return (
    <TouchableOpacity style={styles.option} activeOpacity={0.85} onPress={onPress} testID={testID}>
      <View style={[styles.optIcon, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon} size={28} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optTitle}>{title}</Text>
        <Text style={styles.optSub}>{sub}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={26} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  summaryCard: { backgroundColor: COLORS.primary, padding: 22, borderRadius: RADIUS.xxl, alignItems: "center", marginBottom: 20 },
  summaryLabel: { color: "rgba(255,255,255,0.85)", fontWeight: "800", letterSpacing: 1, fontSize: 11 },
  summaryAmount: { color: "#fff", fontSize: 38, fontWeight: "800", marginTop: 6, letterSpacing: -1 },
  summaryRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  summaryItem: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600" },
  option: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#fff", padding: 16, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12,
  },
  optIcon: { width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  optTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary },
  optSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
});
