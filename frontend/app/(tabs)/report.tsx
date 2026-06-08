// Shift report
import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, FUEL_COLORS, API, fmtMNT, RADIUS } from "../../src/theme";
import { loadOperator, Operator } from "../../src/session";

type Tx = {
  id: string; pump_number: number; fuel_type: string; liters: number; amount: number;
  payment_method: string; customer_type: string; created_at: string; customer_name?: string;
};

const PAY_LABEL: Record<string, string> = { cash: "Бэлэн", card: "Карт", membership: "Гишүүн" };

export default function Report() {
  const router = useRouter();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = async (op: Operator) => {
    try {
      const [s, t] = await Promise.all([
        fetch(`${API}/shift/summary?operator_id=${op.id}`).then((r) => r.json()),
        fetch(`${API}/transactions?operator_id=${op.id}&today=true`).then((r) => r.json()),
      ]);
      setSummary(s);
      setTxs(t);
    } catch (_) {}
  };

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const op = await loadOperator();
        if (!op) { router.replace("/"); return; }
        setOperator(op);
        await fetchAll(op);
        setLoading(false);
      })();
    }, [])
  );

  const onRefresh = async () => {
    if (!operator) return;
    setRefreshing(true);
    await fetchAll(operator);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }

  const byFuel = summary?.by_fuel || {};
  const byPay = summary?.by_payment || {};

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="report-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Ээлжийн тайлан</Text>
        <Text style={styles.sub}>Өнөөдрийн борлуулалт</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>НИЙТ ОРЛОГО</Text>
          <Text style={styles.heroAmount} testID="report-total">{fmtMNT(summary?.total_amount || 0)}</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroBlock}>
              <Text style={styles.heroBlockVal}>{(summary?.total_liters || 0).toFixed(1)} L</Text>
              <Text style={styles.heroBlockLbl}>Нийт литр</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroBlock}>
              <Text style={styles.heroBlockVal}>{summary?.transaction_count || 0}</Text>
              <Text style={styles.heroBlockLbl}>Гүйлгээ</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Шатахуунаар</Text>
        <View style={styles.fuelGrid}>
          {Object.keys(byFuel).length === 0 && (
            <Text style={styles.empty}>Гүйлгээ алга байна</Text>
          )}
          {Object.entries(byFuel).map(([fuel, d]: any) => (
            <View key={fuel} style={styles.fuelCard}>
              <View style={[styles.fuelBadge, { backgroundColor: FUEL_COLORS[fuel] || COLORS.primary }]}>
                <Text style={styles.fuelBadgeText}>{fuel}</Text>
              </View>
              <Text style={styles.fuelAmount}>{fmtMNT(d.amount)}</Text>
              <Text style={styles.fuelMeta}>{d.liters.toFixed(1)} L • {d.count} гүйлгээ</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Төлбөрийн хэлбэрээр</Text>
        <View style={styles.payRow}>
          {(["cash", "card", "membership"] as const).map((m) => (
            <View key={m} style={styles.payCard}>
              <Text style={styles.payLabel}>{PAY_LABEL[m]}</Text>
              <Text style={styles.payAmount}>{fmtMNT(byPay[m] || 0)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Сүүлийн гүйлгээнүүд</Text>
        {txs.length === 0 ? (
          <Text style={styles.empty}>Гүйлгээ алга байна</Text>
        ) : (
          txs.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.txRow}
              onPress={() => router.push(`/receipt/${t.id}`)}
              testID={`tx-row-${t.id}`}
            >
              <View style={[styles.txIcon, { backgroundColor: (FUEL_COLORS[t.fuel_type] || COLORS.primary) + "22" }]}>
                <MaterialCommunityIcons name="gas-station" size={18} color={FUEL_COLORS[t.fuel_type] || COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle}>№{t.pump_number} • {t.fuel_type} • {t.liters.toFixed(2)}L</Text>
                <Text style={styles.txSub}>
                  {PAY_LABEL[t.payment_method]} • {new Date(t.created_at).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              <Text style={styles.txAmount}>{fmtMNT(t.amount)}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingTop: 8, paddingBottom: 16, paddingHorizontal: 20 },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  heroCard: { backgroundColor: COLORS.primary, borderRadius: RADIUS.xxl, padding: 20, marginBottom: 20 },
  heroLabel: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  heroAmount: { color: "#fff", fontSize: 36, fontWeight: "800", marginTop: 6, letterSpacing: -1 },
  heroRow: { flexDirection: "row", marginTop: 18, alignItems: "center" },
  heroBlock: { flex: 1 },
  heroBlockVal: { color: "#fff", fontSize: 18, fontWeight: "800" },
  heroBlockLbl: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "600", marginTop: 2 },
  heroDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.3)" },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 10, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  fuelGrid: { gap: 10, marginBottom: 16 },
  fuelCard: { backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  fuelBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  fuelBadgeText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  fuelAmount: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary, marginTop: 8 },
  fuelMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  payRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  payCard: { flex: 1, backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  payLabel: { fontSize: 11, color: COLORS.textSecondary, fontWeight: "700" },
  payAmount: { fontSize: 14, color: COLORS.textPrimary, fontWeight: "800", marginTop: 4 },
  txRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", padding: 12, borderRadius: RADIUS.lg, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  txIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary },
  txSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  empty: { textAlign: "center", color: COLORS.textMuted, padding: 16 },
});
