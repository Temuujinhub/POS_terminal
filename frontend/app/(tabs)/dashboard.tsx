// Dashboard - pump tiles + today's stats
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, FUEL_COLORS, API, fmtMNT, RADIUS } from "../../src/theme";
import { loadOperator, Operator } from "../../src/session";
import { saleStore } from "../../src/saleStore";

type Pump = { id: string; number: number; name: string; fuel_types: string[]; status: string };
type FuelPrice = { fuel_type: string; price_per_liter: number; color: string };
type Summary = {
  total_amount: number;
  total_liters: number;
  transaction_count: number;
  by_fuel: Record<string, { liters: number; amount: number; count: number }>;
};

export default function Dashboard() {
  const router = useRouter();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [prices, setPrices] = useState<FuelPrice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (op: Operator | null) => {
    try {
      const [p, fp, s] = await Promise.all([
        fetch(`${API}/pumps`).then((r) => r.json()),
        fetch(`${API}/fuel-prices`).then((r) => r.json()),
        fetch(`${API}/shift/summary${op ? `?operator_id=${op.id}` : ""}`).then((r) => r.json()),
      ]);
      setPumps(p);
      setPrices(fp);
      setSummary(s);
    } catch (_) { /* ignore */ }
  };

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const op = await loadOperator();
        if (!op) {
          router.replace("/");
          return;
        }
        setOperator(op);
        await fetchData(op);
        setLoading(false);
      })();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData(operator);
    setRefreshing(false);
  };

  const onPumpPress = (pump: Pump) => {
    saleStore.reset();
    saleStore.set({ pumpId: pump.id, pumpNumber: pump.number });
    router.push(`/sale/${pump.id}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="dashboard-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Сайн байна уу,</Text>
          <Text style={styles.name} testID="header-operator-name">{operator?.name}</Text>
        </View>
        <View style={styles.statusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Идэвхтэй ээлж</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats cards */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: COLORS.primary }]} testID="stat-today-sales">
            <Text style={styles.statLabel}>Өнөөдрийн борлуулалт</Text>
            <Text style={styles.statValue}>{fmtMNT(summary?.total_amount || 0)}</Text>
            <Text style={styles.statSub}>{summary?.transaction_count || 0} гүйлгээ</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border }]}>
            <Text style={[styles.statLabel, { color: COLORS.textSecondary }]}>Зарагдсан литр</Text>
            <Text style={[styles.statValue, { color: COLORS.textPrimary }]}>
              {(summary?.total_liters || 0).toFixed(1)} L
            </Text>
            <Text style={[styles.statSub, { color: COLORS.textMuted }]}>Бүх төрлөөр</Text>
          </View>
        </View>

        {/* Fuel prices strip */}
        <View style={styles.pricesRow}>
          {prices.map((p) => (
            <View key={p.fuel_type} style={styles.priceChip} testID={`price-${p.fuel_type}`}>
              <View style={[styles.priceDot, { backgroundColor: FUEL_COLORS[p.fuel_type] || COLORS.primary }]} />
              <Text style={styles.priceFuel}>{p.fuel_type}</Text>
              <Text style={styles.pricePrice}>{fmtMNT(p.price_per_liter)}/L</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Түгээгүүрүүд</Text>
        <View style={styles.grid}>
          {pumps.map((pump) => {
            const sc = pumpStatusConfig(pump.status);
            return (
              <TouchableOpacity
                key={pump.id}
                style={[styles.pumpCard, { borderColor: sc.border }]}
                activeOpacity={0.82}
                onPress={() => onPumpPress(pump)}
                testID={`pump-tile-${pump.number}`}
              >
                {/* Top accent line */}
                <View style={[styles.pumpAccent, { backgroundColor: sc.accent }]} />

                <View style={styles.pumpInner}>
                  {/* Icon + status row */}
                  <View style={styles.pumpRow}>
                    <View style={[styles.pumpIconCircle, { backgroundColor: sc.iconBg }]}>
                      <MaterialCommunityIcons name="gas-station" size={18} color={sc.accent} />
                    </View>
                    <View style={[styles.pumpBadge, { backgroundColor: sc.badgeBg }]}>
                      <View style={[styles.pumpBadgeDot, { backgroundColor: sc.accent }]} />
                      <Text style={[styles.pumpBadgeText, { color: sc.badgeText }]}>{sc.label}</Text>
                    </View>
                  </View>

                  {/* Number */}
                  <Text style={styles.pumpNum}>№{pump.number}</Text>
                  <Text style={styles.pumpSub}>{pump.name}</Text>

                  {/* Fuel chips */}
                  <View style={styles.pumpFuels}>
                    {pump.fuel_types.map((f) => (
                      <View key={f} style={styles.fuelChip}>
                        <View style={[styles.fuelChipDot, { backgroundColor: FUEL_COLORS[f] || COLORS.primary }]} />
                        <Text style={styles.fuelChipText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Pure UI helper — maps pump status to visual config ──────────────────────
function pumpStatusConfig(status: string) {
  switch (status) {
    case "in_use":
    case "busy":
      return {
        label: "Хэрэглэгдэж байна",
        accent: "#F59E0B",
        border: "#FDE68A",
        iconBg: "#FFFBEB",
        badgeBg: "#FEF3C7",
        badgeText: "#92400E",
      };
    case "offline":
      return {
        label: "Офлайн",
        accent: "#94A3B8",
        border: "#E2E8F0",
        iconBg: "#F8FAFC",
        badgeBg: "#F1F5F9",
        badgeText: "#475569",
      };
    default: // free / ready / idle
      return {
        label: "Сул",
        accent: COLORS.primary,
        border: "#CCFBF1",
        iconBg: "#F0FDFA",
        badgeBg: "#CCFBF1",
        badgeText: "#065F46",
      };
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 20 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: 8, paddingBottom: 16,
  },
  hello: { fontSize: 13, color: COLORS.textSecondary, fontWeight: "500" },
  name: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary, marginTop: 2 },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#ECFDF5", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  statusText: { fontSize: 12, fontWeight: "700", color: "#065F46" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard: { flex: 1, padding: 16, borderRadius: RADIUS.xl },
  statLabel: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 22, fontWeight: "800", color: "#fff", marginTop: 6, letterSpacing: -0.5 },
  statSub: { fontSize: 11, color: "rgba(255,255,255,0.85)", marginTop: 4, fontWeight: "500" },
  pricesRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  priceChip: {
    flex: 1, backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: 10,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center", flexDirection: "column", gap: 4,
  },
  priceDot: { width: 10, height: 10, borderRadius: 5 },
  priceFuel: { fontSize: 12, fontWeight: "700", color: COLORS.textPrimary },
  pricePrice: { fontSize: 11, color: COLORS.textSecondary, fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },

  // ── Pump card ────────────────────────────────────────────────────────────
  pumpCard: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 4,
  },
  pumpAccent: { height: 4 },
  pumpInner: { padding: 13 },
  pumpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  pumpIconCircle: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  pumpBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  pumpBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  pumpBadgeText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  pumpNum: {
    fontSize: 34, fontWeight: "800", color: COLORS.textPrimary,
    letterSpacing: -1.5, lineHeight: 38, marginBottom: 1,
  },
  pumpSub: { fontSize: 11, color: COLORS.textMuted, fontWeight: "500", marginBottom: 12 },
  pumpFuels: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  fuelChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.background, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1, borderColor: COLORS.border,
  },
  fuelChipDot: { width: 7, height: 7, borderRadius: 4 },
  fuelChipText: { fontSize: 10, fontWeight: "700", color: COLORS.textSecondary },
});
