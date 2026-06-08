// Live mode dashboard - real-time pump grid from Flux Monitor API
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Modal, Pressable, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, FUEL_COLORS, RADIUS, fmtMNT } from "../../src/theme";
import { flux, ActiveDispenseItem } from "../../src/fluxApi";
import { loadFluxSession, clearFluxSession, FluxSession } from "../../src/fluxSession";
import { dispenseCtx, DispenseContext } from "../../src/dispenseContext";

type Pump = {
  pump_number: number;
  nozzle: number | null;
  status: "ready" | "idle" | "busy" | "offline";
  last_fuel_grade: string | null;
  last_fuel_grade_id: number | null;
};

const STATUS_BG: Record<string, string> = {
  ready: "#FEF3C7", idle: "#F1F5F9", busy: "#DBEAFE", offline: "#FEE2E2",
};
const STATUS_FG: Record<string, string> = {
  ready: "#92400E", idle: "#64748B", busy: "#1E40AF", offline: "#991B1B",
};
const STATUS_LABEL: Record<string, string> = {
  ready: "ХОШУУ АВСАН", idle: "ИДЭВХГҮЙ", busy: "Шахаж байна", offline: "Холбогдоогүй",
};

// Зөвхөн "ready" (хошуу авсан) төлөвт борлуулалт хийнэ
const TAPPABLE = new Set(["ready"]);

export default function LiveDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<FluxSession | null>(null);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  // Хүлээлгэсэн гүйлгээнүүд
  const [holds, setHolds] = useState<Array<{ hold_id: string; user_email?: string; created_at: string; payload: any }>>([]);
  const [holdsModal, setHoldsModal] = useState(false);

  // 🆕 Active dispenses (multi-customer) — pump_number → status info
  // map: pump → { current_volume, current_amount, status }
  const [active, setActive] = useState<Record<number, ActiveDispenseItem>>({});
  // Дөнгөж дуусаад finalize хийгдсэн pump-уудыг түр зуур "ДУУССАН" гэж
  // харуулна (1.5с тутамд автоматаар арилна)
  const [justCompleted, setJustCompleted] = useState<Record<number, { amount: number; expiresAt: number }>>({});

  const fetchHolds = async () => {
    try {
      const res = await flux.holds.list();
      setHolds(res.items || []);
    } catch (_) {}
  };

  // 🆕 Active dispenses-уудыг татаж, дуусчсан байгаа бүгдийг автоматаар
  // finalize хийнэ. Демо горимд /active-dispenses нь шахалт явагдаж байх
  // үед өгөгдөл буцаах ба дуусахад жагсаалтаас алга болно. Тиймээс бид
  // local AsyncStorage-ийн dispenseCtx-тэй харьцуулна.
  const fetchActiveAndAutoFinalize = async () => {
    try {
      const res = await flux.activeDispenses();
      const items: ActiveDispenseItem[] = res.items || [];
      // pump → item map
      const byPump: Record<number, ActiveDispenseItem> = {};
      const activeCmdIds = new Set<number>();
      for (const it of items) {
        byPump[it.pump] = it;
        activeCmdIds.add(it.command_id);
      }
      setActive(byPump);

      // Pending дотроос идэвхгүй болсон context-уудыг олж finalize-руу шилжүүлнэ.
      // Дөрвөн нөхцлийн нэгийг хангаж байх:
      //   1) Server-ийн active list-д байхгүй → шахалт дууссан гэж үзнэ
      //   2) Эсвэл server-ийн item.status === "completed"
      const pending = await dispenseCtx.list();
      for (const ctx of pending) {
        const liveItem = items.find((x) => x.command_id === ctx.command_id);
        const isCompleted =
          !liveItem ||
          liveItem.status === "completed" ||
          liveItem.status === "failed";
        if (!isCompleted) continue;
        // Шахалт дууссан — finalize хийнэ.
        try {
          // Шахалтын тоо хэмжээ / дүнг хамгийн сүүлийн status-аас авна
          let txStatus: any = null;
          try {
            txStatus = await flux.dispenseStatus(ctx.command_id, ctx.pump);
          } catch (_) {}
          const tx = txStatus?.transaction;
          if (!tx || !tx.id) {
            // Транзакц байхгүй — context-ыг устгана
            await dispenseCtx.remove(ctx.command_id);
            continue;
          }
          // 🆕 Prepay тул бодит дүнг prepaid_amount-аар тооцоолно (Flux
          // backend-ийн default 50k гарахаас сэргийлнэ). Volume prepay үед
          // Flux-ийн буцаасан дүнг хүлээж авна.
          const overrideTotal =
            ctx.dose_type === "Amount" ? ctx.prepaid_amount : tx.total_amount;
          const overrideVolume =
            ctx.dose_type === "Volume"
              ? ctx.dose
              : ctx.dose_type === "Amount"
              ? overrideTotal / (tx.unit_price || 2950)
              : tx.volume_liters;
          await flux.finalize({
            transaction_id: tx.id,
            payment_method: ctx.payment_method,
            vat_receipt_number: ctx.vat_receipt_number,
            vat_type: ctx.vat_type,
            vat_register: ctx.vat_register,
            bank_approval_code: ctx.bank_approval_code,
          });
          await dispenseCtx.markFinalized(ctx.command_id);
          // "ДУУССАН" badge харуулна
          setJustCompleted((p) => ({
            ...p,
            [ctx.pump]: {
              amount: Math.round(overrideTotal || 0),
              expiresAt: Date.now() + 5000,
            },
          }));
          // 5 секундын дараа context-ыг устгана
          setTimeout(() => {
            dispenseCtx.remove(ctx.command_id).catch(() => {});
            setJustCompleted((p) => {
              const next = { ...p };
              delete next[ctx.pump];
              return next;
            });
          }, 5000);
        } catch (e: any) {
          // Алдаа гарвал тэр context-д finalized=true тэмдэглэлгүйгээр
          // дараагийн poll-д дахин оролдоно
        }
      }
    } catch (_) {}
  };

  const fetchPumps = async () => {
    try {
      const data = await flux.pumps();
      setPumps(data || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
      if ((e.message || "").includes("Session")) {
        await clearFluxSession();
        router.replace("/");
      }
    }
  };

  const onResumeHold = async (hold_id: string) => {
    setHoldsModal(false);
    router.push(`/live/sale?resumeHold=${hold_id}&pump=0`);
  };

  const onDeleteHold = (hold_id: string) => {
    Alert.alert(
      "Хүлээлгэсэн гүйлгээ устгах",
      "Энэ гүйлгээг бүрэн арилгах уу? (буцаах боломжгүй)",
      [
        { text: "Болих", style: "cancel" },
        {
          text: "Устгах", style: "destructive", onPress: async () => {
            try {
              await flux.holds.remove(hold_id);
              setHolds((p) => p.filter((h) => h.hold_id !== hold_id));
            } catch (e: any) {
              Alert.alert("Алдаа", e?.message || "Устгахад алдаа гарлаа");
            }
          }
        },
      ]
    );
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const s = await loadFluxSession();
        if (!s) { router.replace("/"); return; }
        if (!active) return;
        setSession(s);
        await dispenseCtx.cleanup(); // хуучирсан context-уудыг цэвэрлэх
        await Promise.all([fetchPumps(), fetchHolds(), fetchActiveAndAutoFinalize()]);
        setLoading(false);
        // Poll every 2 seconds — active dispense progress хурдан шинэчлэгдэхэд
        pollRef.current = setInterval(() => {
          fetchPumps();
          fetchHolds();
          fetchActiveAndAutoFinalize();
        }, 2000);
      })();
      return () => {
        active = false;
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPumps();
    setRefreshing(false);
  };

  const onPumpPress = (p: Pump) => {
    if (!TAPPABLE.has(p.status)) {
      Alert.alert(
        "Бэлэн биш",
        p.status === "idle"
          ? "Энэ түгээгүүр идэвхгүй байна. Жолооч хошууг авч, нэмж борлуулалт эхлэхийг хүлээнэ үү."
          : `Энэ түгээгүүр "${STATUS_LABEL[p.status]}" төлөвт байна.`
      );
      return;
    }
    router.push(`/live/sale?pump=${p.pump_number}&nozzle=${p.nozzle}&fuel_grade_id=${p.last_fuel_grade_id || ""}&fuel=${encodeURIComponent(p.last_fuel_grade || "")}`);
  };

  const onLogout = async () => {
    try { await flux.logout(); } catch (_) {}
    await clearFluxSession();
    router.replace("/");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        <Text style={{ marginTop: 12, color: COLORS.textSecondary }}>Flux серверт холбогдож байна...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="live-dashboard">
      <View style={styles.header}>
        <Image
          source={require("../../assets/images/uboil-logo.png")}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={{ flex: 1 }}>
          <View style={[styles.liveBadge, session?.station_id === 99 && styles.demoBadge]}>
            <View style={[styles.liveDot, session?.station_id === 99 && { backgroundColor: "#F59E0B" }]} />
            <Text style={[styles.liveText, session?.station_id === 99 && { color: "#92400E" }]}>
              {session?.station_id === 99 ? "ДЕМО ГОРИМ" : "LIVE"}
            </Text>
          </View>
          <Text style={styles.name} testID="header-operator-name">{session?.full_name}</Text>
          <Text style={styles.station}>{session?.station_name} • Station #{session?.station_id}</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/pax-debug")}
          style={[styles.logoutBtn, { backgroundColor: "#EFF6FF", marginRight: 6 }]}
          testID="pax-debug-btn"
        >
          <MaterialCommunityIcons name="wrench-outline" size={20} color="#2563EB" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogout} style={styles.logoutBtn} testID="logout-btn">
          <MaterialCommunityIcons name="logout" size={22} color={COLORS.accentRed} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {error && (
          <View style={styles.errorBox} testID="error-box">
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={COLORS.accentRed} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Түгээгүүрүүд (real-time)</Text>

        {holds.length > 0 && (
          <TouchableOpacity
            style={styles.holdsPill}
            onPress={() => setHoldsModal(true)}
            testID="holds-pill"
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="pause-circle" size={20} color="#B45309" />
            <Text style={styles.holdsPillText}>Хүлээлгэсэн ({holds.length})</Text>
            <Text style={styles.holdsPillHint}>дарж үргэлжлүүлэх</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#B45309" />
          </TouchableOpacity>
        )}

        {pumps.length === 0 ? (
          <Text style={styles.empty}>Түгээгүүр олдсонгүй</Text>
        ) : (
          <View style={styles.grid}>
            {pumps.map((p) => {
              const liveItem = active[p.pump_number];
              const completed = justCompleted[p.pump_number];
              // Дашиглах боломжтой эсэх: completed-аас гадна, шахаж буй pump
              // дээр шинэ үйлчилгээ хийхгүй.
              const isFilling = !!liveItem && (liveItem.status === "filling" || liveItem.status === "eot" || liveItem.status === "acknowledged" || liveItem.status === "sent");
              const disabled = !TAPPABLE.has(p.status) || isFilling;
              return (
                <TouchableOpacity
                  key={`${p.pump_number}-${p.nozzle}`}
                  style={[styles.tile, disabled && styles.tileDisabled, isFilling && styles.tileFilling, completed && styles.tileCompleted]}
                  activeOpacity={disabled ? 1 : 0.7}
                  onPress={() => onPumpPress(p)}
                  testID={`live-pump-${p.pump_number}`}
                >
                  <View style={styles.tileTop}>
                    <View style={[styles.tileIcon, disabled && { backgroundColor: "#F1F5F9" }, isFilling && { backgroundColor: "#DBEAFE" }]}>
                      <MaterialCommunityIcons name="gas-station" size={22} color={isFilling ? "#1E40AF" : disabled ? COLORS.textMuted : COLORS.primary} />
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: completed ? "#D1FAE5" : isFilling ? "#DBEAFE" : STATUS_BG[p.status] }]}>
                      <Text style={[styles.statusText, { color: completed ? "#065F46" : isFilling ? "#1E40AF" : STATUS_FG[p.status] }]}>
                        {completed ? "ДУУССАН" : isFilling ? "ШАХАЖ БАЙНА" : STATUS_LABEL[p.status]}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.pumpNum, disabled && { color: COLORS.textMuted }]}>№{p.pump_number}</Text>
                  {p.nozzle !== null && p.nozzle !== undefined && <Text style={styles.nozzle}>Хошуу {p.nozzle}</Text>}
                  {p.last_fuel_grade && (
                    <View style={styles.fuelRow}>
                      <View style={[styles.fuelDot, { backgroundColor: FUEL_COLORS[p.last_fuel_grade] || COLORS.primary }]} />
                      <Text style={styles.fuelLabel}>{p.last_fuel_grade}</Text>
                    </View>
                  )}
                  {/* 🆕 Live volume / Completed amount */}
                  {isFilling && (
                    <View style={styles.liveBox}>
                      <MaterialCommunityIcons name="water-pump" size={14} color="#1E40AF" />
                      <Text style={styles.liveVolText}>
                        {(liveItem.current_volume || 0).toFixed(2)} L
                      </Text>
                    </View>
                  )}
                  {completed && (
                    <View style={[styles.liveBox, { backgroundColor: "#D1FAE5" }]}>
                      <MaterialCommunityIcons name="check-circle" size={14} color="#065F46" />
                      <Text style={[styles.liveVolText, { color: "#065F46" }]}>
                        {fmtMNT(completed.amount)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Holds Modal */}
      <Modal visible={holdsModal} transparent animationType="fade" onRequestClose={() => setHoldsModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHoldsModal(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Хүлээлгэсэн гүйлгээнүүд</Text>
            <Text style={styles.modalHint}>Үргэлжлүүлэх гүйлгээгээ сонгоно уу</Text>
            {holds.length === 0 ? (
              <Text style={styles.modalEmpty}>Хүлээлгэсэн гүйлгээ алга</Text>
            ) : (
              holds.map((h) => {
                const p = h.payload || {};
                const created = new Date(h.created_at);
                const hhmm = `${String(created.getHours()).padStart(2, "0")}:${String(created.getMinutes()).padStart(2, "0")}`;
                return (
                  <View key={h.hold_id} style={styles.holdItem}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => onResumeHold(h.hold_id)} testID={`hold-${h.hold_id}`}>
                      <View style={styles.holdItemRow}>
                        <View style={styles.holdItemIcon}>
                          <MaterialCommunityIcons name="gas-station" size={20} color={COLORS.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.holdItemTitle}>
                            №{p.pump || "?"} • {p.fuel_grade_name || "?"} • {fmtMNT(p.total || 0)}
                          </Text>
                          <Text style={styles.holdItemSub}>
                            {(p.liters || 0).toFixed(2)} L • {hhmm} • {h.user_email || "?"}
                          </Text>
                        </View>
                        <MaterialCommunityIcons name="play-circle" size={26} color={COLORS.primary} />
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.holdDelBtn} onPress={() => onDeleteHold(h.hold_id)} testID={`hold-del-${h.hold_id}`}>
                      <MaterialCommunityIcons name="trash-can-outline" size={18} color={COLORS.accentRed} />
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
            <TouchableOpacity style={styles.modalClose} onPress={() => setHoldsModal(false)}>
              <Text style={styles.modalCloseText}>Хаах</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
    paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6,
  },
  headerLogo: { width: 36, height: 36, borderRadius: 10 },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999, backgroundColor: "#DCFCE7", marginBottom: 2,
  },
  demoBadge: { backgroundColor: "#FEF3C7" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#16A34A" },
  liveText: { fontSize: 9, fontWeight: "900", color: "#15803D", letterSpacing: 0.5 },
  name: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary, lineHeight: 16 },
  station: { fontSize: 10, color: COLORS.textSecondary, fontWeight: "600", lineHeight: 12 },
  logoutBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
  errorBox: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#FEF2F2", padding: 10, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: "#FECACA", marginBottom: 10 },
  errorText: { flex: 1, color: COLORS.accentRed, fontSize: 12, fontWeight: "600" },
  sectionTitle: {
    fontSize: 12, fontWeight: "800", color: COLORS.textSecondary,
    marginTop: 4, marginBottom: 8, letterSpacing: 0.5,
  },
  empty: { textAlign: "center", color: COLORS.textMuted, paddingVertical: 30, fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  tile: {
    width: "49%",
    backgroundColor: "#fff",
    borderRadius: RADIUS.lg,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tileDisabled: { backgroundColor: "#F8FAFC", opacity: 0.6 },
  tileFilling: { borderColor: "#60A5FA", borderWidth: 2, backgroundColor: "#EFF6FF" },
  tileCompleted: { borderColor: "#34D399", borderWidth: 2, backgroundColor: "#ECFDF5" },
  liveBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  liveVolText: { fontSize: 11, fontWeight: "800", color: "#1E40AF" },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  tileIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center" },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  statusText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.2 },
  pumpNum: { fontSize: 22, fontWeight: "900", color: COLORS.textPrimary, marginTop: 2, lineHeight: 24 },
  nozzle: { fontSize: 10, color: COLORS.textSecondary, fontWeight: "700" },
  fuelRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  fuelDot: { width: 7, height: 7, borderRadius: 3.5 },
  fuelLabel: { fontSize: 10, color: COLORS.textSecondary, fontWeight: "700" },
  // Holds pill + modal
  holdsPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF3C7", borderColor: "#FDE68A", borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.lg, marginBottom: 14,
  },
  holdsPillText: { fontSize: 13, fontWeight: "800", color: "#92400E" },
  holdsPillHint: { fontSize: 11, color: "#92400E", flex: 1, marginLeft: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: "80%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: COLORS.textPrimary, marginBottom: 4 },
  modalHint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 14 },
  modalEmpty: { fontSize: 13, color: COLORS.textMuted, textAlign: "center", paddingVertical: 20 },
  holdItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  holdItemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  holdItemIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center" },
  holdItemTitle: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  holdItemSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, fontWeight: "600" },
  holdDelBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#FEF2F2" },
  modalClose: { marginTop: 14, paddingVertical: 12, alignItems: "center", borderRadius: RADIUS.lg, backgroundColor: "#F1F5F9" },
  modalCloseText: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
});
