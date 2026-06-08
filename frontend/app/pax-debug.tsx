// PAX EPOS Native Module Debug
//
// EAS build үед native EPOS module автоматаар суулгагдана. Энэ дэлгэц нь:
//   - Native module-ийн төлөв
//   - Health Check / SALE / NFC / QR / Settle тест
//   - Лог

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  paxCharge,
  paxReadCard,
  paxQpay,
  paxConfig,
  paxHealthCheck,
  paxSettle,
  paxVoid,
  EPOS_CATEGORY,
  EPOS_COMMAND_TYPE,
  resetEposAvailability,
} from "../src/paxPayment";
import { isEposNativeAvailable } from "../src/paxPayment";
import { Platform } from "react-native";
import { printReceipt } from "../src/printReceipt";
import { COLORS } from "../src/theme";

const STORAGE_KEY = "pax_debug_overrides";

type CfgOverrides = {
  useNative?: boolean;
};

export default function PaxDebug() {
  const router = useRouter();
  const [useNative, setUseNative] = useState<boolean>(true);
  const [testAmount, setTestAmount] = useState("100");
  const [testRef, setTestRef] = useState("");
  const [log, setLog] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [nativeAvail, setNativeAvail] = useState<boolean>(isEposNativeAvailable());

  const refreshAvail = () => setNativeAvail(isEposNativeAvailable());

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const o: CfgOverrides = JSON.parse(raw);
          if (o.useNative !== undefined) setUseNative(o.useNative);
        }
      } catch (_) {}
    })();
  }, []);

  const saveAndApply = async () => {
    const o: CfgOverrides = { useNative };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(o));
    Alert.alert("Хадгалагдсан", `useNative = ${useNative}`);
  };

  const fmt = (obj: any) => { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } };

  const wrap = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    setLog(`▶ ${label}...\n  cfg = ${fmt(paxConfig())}\n`);
    try {
      const res = await fn();
      setLog((p) => p + "\n✓ Хариу:\n" + fmt(res));
    } catch (e: any) {
      setLog((p) => p + "\n✗ Алдаа:\n" + (e?.message || String(e)));
    } finally {
      setBusy(false);
      refreshAvail();
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>EPOS Native Debug</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <View style={[styles.infoBox, nativeAvail ? styles.infoOk : styles.infoWarn]}>
          <Text style={styles.infoTitle}>
            {Platform.OS !== "android"
              ? "💻 ANDROID БУС — SIMULATION ГОРИМ"
              : nativeAvail
              ? "✅ EPOS INTENT БЭЛЭН"
              : "⚠️ EPOS APP ОЛДОХГҮЙ БАЙНА"}
          </Text>
          <Text style={styles.infoLine}>
            {Platform.OS !== "android"
              ? "Web / iOS дээр зөвхөн mock хариу буцаана"
              : nativeAvail
              ? "Intent action: mn.databank.epos.openapi.action.TRANS\nPackage: mn.databank.epos.openapi.app"
              : "Өмнөх Intent дуудалт амжилтгүй боллоо. EPOS app суулгасан эсэхээ шалгана уу."}
          </Text>
          <Text style={styles.infoLine}>SDK: DATABANK EPOS Open API v26 (Intent bridge)</Text>
          {Platform.OS === "android" && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => {
                resetEposAvailability();
                refreshAvail();
                setLog("ℹ️ EPOS бэлэн байдлын кэш цэвэрлэгдлээ. Дахин тест явуулна уу.");
              }}
            >
              <MaterialCommunityIcons name="refresh" size={14} color="#1E40AF" />
              <Text style={styles.resetBtnText}>Кэш цэвэрлэх / Дахин шалгах</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionTitle}>Тохиргоо</Text>

        <View style={[styles.toggle, useNative && styles.toggleActive]}>
          <TouchableOpacity
            style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
            onPress={() => setUseNative(!useNative)}
          >
            <MaterialCommunityIcons
              name={useNative ? "checkbox-marked" : "checkbox-blank-outline"}
              size={22}
              color={useNative ? COLORS.primary : COLORS.textSecondary}
            />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={[styles.toggleText, useNative && { color: COLORS.primary }]}>
                Native EPOS SDK ашиглах
              </Text>
              <Text style={styles.toggleHint}>
                Унтраавал бүх дуудлага mock болж буцаана (туршилт)
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: COLORS.primary }]}
          onPress={saveAndApply}
        >
          <MaterialCommunityIcons name="content-save" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>Хадгалах</Text>
        </TouchableOpacity>

        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>Тест</Text>

        <Text style={styles.fieldLabel}>Тест дүн (₮)</Text>
        <TextInput style={styles.input} value={testAmount} onChangeText={setTestAmount} keyboardType="numeric" />

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#0EA5E9" }]}
          disabled={busy}
          onPress={() => wrap("Health Check", () => paxHealthCheck())}
        >
          <MaterialCommunityIcons name="heart-pulse" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>1. Health Check</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#1E40AF" }]}
          disabled={busy}
          onPress={() => wrap("SALE", () => paxCharge(parseFloat(testAmount), `DEBUG-${Date.now()}`))}
        >
          <MaterialCommunityIcons name="credit-card-scan-outline" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>2. SALE (Банкны карт)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#7C3AED" }]}
          disabled={busy}
          onPress={() => wrap("Read RF Card (NFC)", () => paxReadCard())}
        >
          <MaterialCommunityIcons name="nfc-tap" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>3. NFC / Read RF Card</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#059669" }]}
          disabled={busy}
          onPress={() => wrap("Scan Code (QR)", () => paxQpay(parseFloat(testAmount), `DEBUG-${Date.now()}`))}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>4. QR / Scan Code</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#DC2626" }]}
          disabled={busy}
          onPress={() => wrap("Settlement", () => paxSettle())}
        >
          <MaterialCommunityIcons name="cash-register" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>5. Settlement (Тооцоо)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#0B3D2E" }]}
          disabled={busy}
          onPress={() => wrap("Print Receipt", () => printReceipt({
            station_name: "UBOIL ШАТАХУУН СТАНЦ",
            terminal_id: "TEST-001",
            date: new Date().toLocaleString("mn-MN"),
            receipt_no: "TEST" + Math.floor(Math.random() * 99999),
            pump_no: 1,
            fuel_label: "АИ-92",
            volume_liters: parseFloat(testAmount) / 3000,
            unit_price: 3000,
            amount: parseFloat(testAmount),
            payment_method: "Бэлэн",
            vat_type: "Иргэн",
            vat_receipt_number: "ABC123XYZ456",
          }))}
        >
          <MaterialCommunityIcons name="printer" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>6. Print Receipt (Баримт хэвлэх)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: "#475569" }]}
          disabled={busy}
          onPress={() => {
            setLog("Одоогийн cfg:\n" + fmt(paxConfig()) +
              "\n\nCategory constants:\n" + fmt(EPOS_CATEGORY) +
              "\n\nCommandType constants:\n" + fmt(EPOS_COMMAND_TYPE));
          }}
        >
          <MaterialCommunityIcons name="information-outline" size={20} color="#fff" />
          <Text style={styles.bigBtnText}>Cfg / Constants харах</Text>
        </TouchableOpacity>

        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>Лог</Text>
        <View style={styles.logBox}>
          <Text style={styles.logText} selectable>
            {log || "(тест явуулаагүй)"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderColor: COLORS.border, backgroundColor: "#fff",
  },
  backBtn: {
    width: 36, height: 36, alignItems: "center", justifyContent: "center",
    borderRadius: 10, backgroundColor: "#F1F5F9",
  },
  title: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  infoBox: { borderRadius: 10, padding: 12, borderWidth: 1, marginBottom: 8 },
  infoOk: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  infoWarn: { backgroundColor: "#FFFBEB", borderColor: "#FCD34D" },
  infoTitle: { fontWeight: "800", color: COLORS.textPrimary, marginBottom: 6 },
  infoLine: { fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 },
  sectionTitle: {
    fontSize: 13, fontWeight: "800", color: COLORS.textSecondary,
    marginTop: 14, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase",
  },
  fieldLabel: { fontSize: 11, color: COLORS.textSecondary, fontWeight: "700", marginTop: 8, marginBottom: 4 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, fontFamily: "monospace", color: COLORS.textPrimary,
  },
  toggle: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, padding: 12, marginTop: 6,
  },
  toggleActive: { borderColor: COLORS.primary, backgroundColor: "#F0F9FF" },
  toggleText: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  toggleHint: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  bigBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
    paddingVertical: 12, borderRadius: 12, marginTop: 8,
  },
  bigBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 16 },
  logBox: { backgroundColor: "#0F172A", borderRadius: 12, padding: 12, minHeight: 200 },
  logText: { color: "#A7F3D0", fontFamily: "monospace", fontSize: 11 },
  resetBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: "#DBEAFE", borderWidth: 1, borderColor: "#93C5FD",
  },
  resetBtnText: { fontSize: 11, color: "#1E40AF", fontWeight: "700" },
});
