// New Sale flow - combined: fuel type → liters/amount → preview → next
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import Keypad from "../../src/Keypad";
import { COLORS, FUEL_COLORS, API, fmtMNT, RADIUS } from "../../src/theme";
import { saleStore } from "../../src/saleStore";

type FuelPrice = { fuel_type: string; price_per_liter: number; color: string };

export default function NewSale() {
  const { pumpId } = useLocalSearchParams<{ pumpId: string }>();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [prices, setPrices] = useState<FuelPrice[]>([]);
  const [selectedFuel, setSelectedFuel] = useState<FuelPrice | null>(null);
  const [mode, setMode] = useState<"amount" | "liters">("amount");
  const [input, setInput] = useState("");

  useEffect(() => {
    fetch(`${API}/fuel-prices`).then((r) => r.json()).then(setPrices);
  }, []);

  const onPickFuel = (p: FuelPrice) => {
    setSelectedFuel(p);
    saleStore.set({ fuelType: p.fuel_type, pricePerLiter: p.price_per_liter });
    setStep(2);
  };

  const handleDigit = (d: string) => {
    if (input.length >= 10) return;
    if (d === "." && input.includes(".")) return;
    if (d === "." && input.length === 0) {
      setInput("0.");
      return;
    }
    setInput(input + d);
  };
  const handleBack = () => setInput((p) => p.slice(0, -1));
  const handleClear = () => setInput("");

  const numeric = parseFloat(input || "0");
  const amount = mode === "amount" ? numeric : numeric * (selectedFuel?.price_per_liter || 0);
  const liters = mode === "liters" ? numeric : (selectedFuel?.price_per_liter ? numeric / selectedFuel.price_per_liter : 0);

  const proceed = () => {
    if (!selectedFuel) return;
    if (amount <= 0 || liters <= 0) {
      Alert.alert("Алдаа", "Дүн оруулна уу");
      return;
    }
    saleStore.set({ amount: Math.round(amount), liters: Number(liters.toFixed(3)) });
    router.push("/payment");
  };

  if (step === 1) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]} testID="sale-step-1">
        <Header title={`Түгээгүүр №${saleStore.get().pumpNumber || ""}`} subtitle="Шатахууны төрөл сонгоно уу" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {prices.map((p) => (
            <TouchableOpacity
              key={p.fuel_type}
              style={[styles.fuelCard, { borderColor: FUEL_COLORS[p.fuel_type] || COLORS.primary }]}
              activeOpacity={0.85}
              onPress={() => onPickFuel(p)}
              testID={`fuel-${p.fuel_type}`}
            >
              <View style={[styles.fuelIcon, { backgroundColor: (FUEL_COLORS[p.fuel_type] || COLORS.primary) + "22" }]}>
                <MaterialCommunityIcons name="gas-station" size={32} color={FUEL_COLORS[p.fuel_type] || COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fuelTitle}>{p.fuel_type}</Text>
                <Text style={styles.fuelPrice}>{fmtMNT(p.price_per_liter)} / литр</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={28} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
          {prices.length === 0 && <ActivityIndicator color={COLORS.primary} />}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Step 2 - amount entry
  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="sale-step-2">
      <Header
        title={selectedFuel?.fuel_type || ""}
        subtitle={`Түгээгүүр №${saleStore.get().pumpNumber} • ${fmtMNT(selectedFuel?.price_per_liter || 0)}/L`}
        onBack={() => setStep(1)}
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <View style={styles.toggle}>
          <TouchableOpacity
            onPress={() => { setMode("amount"); setInput(""); }}
            style={[styles.toggleBtn, mode === "amount" && styles.toggleActive]}
            testID="mode-amount"
          >
            <Text style={[styles.toggleText, mode === "amount" && styles.toggleTextActive]}>Дүнгээр (₮)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setMode("liters"); setInput(""); }}
            style={[styles.toggleBtn, mode === "liters" && styles.toggleActive]}
            testID="mode-liters"
          >
            <Text style={[styles.toggleText, mode === "liters" && styles.toggleTextActive]}>Литрээр (L)</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.display}>
          <Text style={styles.displayLabel}>{mode === "amount" ? "Дүн" : "Литр"}</Text>
          <Text style={styles.displayValue} testID="amount-display">
            {mode === "amount" ? `${(parseFloat(input || "0")).toLocaleString("en-US")} ₮` : `${input || "0"} L`}
          </Text>
          <Text style={styles.displaySub}>
            {mode === "amount" ? `≈ ${liters.toFixed(2)} L` : `≈ ${fmtMNT(amount)}`}
          </Text>
        </View>

        <View style={styles.quickRow}>
          {[20000, 50000, 100000].map((v) => (
            <TouchableOpacity
              key={v}
              style={styles.quickChip}
              onPress={() => { setMode("amount"); setInput(String(v)); }}
              testID={`quick-${v}`}
            >
              <Text style={styles.quickText}>{fmtMNT(v)}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.quickChip, { backgroundColor: "#FEE2E2" }]} onPress={handleClear} testID="quick-clear">
            <Text style={[styles.quickText, { color: COLORS.accentRed }]}>C</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.keypadOuter}>
        <Keypad onPress={handleDigit} onBackspace={handleBack} />
        <TouchableOpacity
          style={[styles.continueBtn, (amount <= 0) && { opacity: 0.4 }]}
          disabled={amount <= 0}
          onPress={proceed}
          activeOpacity={0.8}
          testID="continue-btn"
        >
          <Text style={styles.continueText}>Үргэлжлүүлэх</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Header({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} testID="back-btn">
        <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  headerSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  fuelCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#fff", padding: 18, borderRadius: RADIUS.xl, borderWidth: 2,
  },
  fuelIcon: { width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  fuelTitle: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  fuelPrice: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2, fontWeight: "600" },
  toggle: {
    flexDirection: "row", backgroundColor: "#fff", borderRadius: RADIUS.xl, padding: 4,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
  },
  toggleBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: RADIUS.lg },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleText: { fontSize: 14, fontWeight: "700", color: COLORS.textSecondary },
  toggleTextActive: { color: "#fff" },
  display: {
    backgroundColor: "#fff", padding: 20, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center", marginBottom: 14,
  },
  displayLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1 },
  displayValue: { fontSize: 38, fontWeight: "800", color: COLORS.primary, marginTop: 6, letterSpacing: -1 },
  displaySub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, fontWeight: "600" },
  quickRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  quickChip: { flex: 1, paddingVertical: 10, backgroundColor: "#F1F5F9", borderRadius: 12, alignItems: "center" },
  quickText: { fontSize: 12, fontWeight: "800", color: COLORS.textPrimary },
  keypadOuter: { padding: 20, paddingTop: 4 },
  continueBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
    backgroundColor: COLORS.primary, paddingVertical: 18, borderRadius: RADIUS.xl, marginTop: 16,
  },
  continueText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});
