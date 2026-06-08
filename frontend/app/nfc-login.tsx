// NFC card login screen
// PAX A8900-д EPOS SDK ашиглан NFC уншдаг тул react-native-nfc-manager
// шаардлагагүй болж хасагдсан. Энэ дэлгэц одоо демо горимоор л ажиллана
// (NFC хэрэгсэлгүй устсанд жагсаалтаас сонгох).
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, API } from "../src/theme";
import { saveOperator } from "../src/session";

type Op = { id: string; name: string; nfc_uid?: string; role: string };

// react-native-nfc-manager хасагдсан тул бүх төхөөрөмжид демо list ашиглана
const isNativeWithNfc = false;

// Lazy-loaded NFC manager — disabled
const NfcManager: any = null;
const NfcTech: any = null;

export default function NfcLogin() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [demoOps, setDemoOps] = useState<Op[]>([]);

  useEffect(() => {
    // Load demo operator list (used in simulation mode)
    fetch(`${API}/operators/nfc-list`).then((r) => r.json()).then(setDemoOps).catch(() => {});
    return () => {
      if (NfcManager) {
        try { NfcManager.cancelTechnologyRequest(); } catch (_) {}
      }
    };
  }, []);

  const loginWithUid = async (uid: string) => {
    try {
      const r = await fetch(`${API}/auth/nfc-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nfc_uid: uid }),
      });
      const d = await r.json();
      if (!r.ok) {
        Alert.alert("Алдаа", d.detail || "Нэвтрэх боломжгүй");
        return;
      }
      await saveOperator(d.operator);
      router.replace("/(tabs)/dashboard");
    } catch {
      Alert.alert("Алдаа", "Сервертэй холбогдож чадсангүй");
    }
  };

  const handleNfcScan = async () => {
    if (!NfcManager) {
      Alert.alert(
        "NFC боломжгүй",
        Platform.OS === "web"
          ? "NFC нь зөвхөн төхөөрөмж дээр ажиллана. Доорх жагсаалтаас сонгож туршина уу."
          : "Бодит NFC уншигч ашиглахын тулд аппликейшнийг dev build хийнэ үү. Доорх симуляц горимыг ашиглана уу."
      );
      return;
    }
    setScanning(true);
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      const id = (tag?.id || "").toString();
      const formatted = id
        .toUpperCase()
        .match(/.{1,2}/g)
        ?.join(":") || id;
      if (!formatted) {
        Alert.alert("Алдаа", "Картын ID уншигдсангүй");
        return;
      }
      await loginWithUid(formatted);
    } catch (e: any) {
      Alert.alert("Уншиж чадсангүй", e?.message || "Дахин оролдоно уу");
    } finally {
      try { await NfcManager.cancelTechnologyRequest(); } catch (_) {}
      setScanning(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="nfc-login-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>NFC картаар нэвтрэх</Text>
          <Text style={styles.sub}>Картаа уншигчид ойртуулна уу</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.scanBox} testID="nfc-scan-box">
          <View style={[styles.pulseRing, scanning && styles.pulseActive]}>
            <View style={styles.pulseInner}>
              <MaterialCommunityIcons
                name={scanning ? "nfc-search-variant" : "nfc"}
                size={64}
                color={COLORS.primary}
              />
            </View>
          </View>
          <Text style={styles.scanText}>
            {scanning ? "Картаа уншигчид ойртуул..." : "NFC уншуулах товч"}
          </Text>
          <TouchableOpacity
            style={[styles.scanBtn, scanning && { opacity: 0.6 }]}
            onPress={handleNfcScan}
            disabled={scanning}
            activeOpacity={0.85}
            testID="start-scan-btn"
          >
            {scanning ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="nfc-tap" size={22} color="#fff" />
                <Text style={styles.scanBtnText}>Уншуулж эхлэх</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {!isNativeWithNfc && (
          <View style={styles.notice}>
            <MaterialCommunityIcons name="information-outline" size={20} color="#92400E" />
            <Text style={styles.noticeText}>
              {Platform.OS === "web"
                ? "Web хувилбар дээр бодит NFC ажиллахгүй. Доорх симуляцыг ашиглана уу."
                : "Expo Go дээр NFC симуляц горимтой. Бодит уншуулалтанд dev build шаардана."}
            </Text>
          </View>
        )}

        <Text style={styles.demoLabel}>СИМУЛЯЦ — БҮРТГЭЛТЭЙ КАРТУУД</Text>
        {demoOps.map((op) => (
          <TouchableOpacity
            key={op.id}
            style={styles.demoCard}
            onPress={() => op.nfc_uid && loginWithUid(op.nfc_uid)}
            activeOpacity={0.85}
            testID={`demo-card-${op.id}`}
          >
            <View style={styles.demoIcon}>
              <MaterialCommunityIcons name="card-account-details" size={26} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.demoName}>{op.name}</Text>
              <Text style={styles.demoUid}>{op.nfc_uid}</Text>
            </View>
            <MaterialCommunityIcons name="nfc-tap" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  scanBox: {
    backgroundColor: "#fff", borderRadius: RADIUS.xxl, padding: 28,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center", marginBottom: 16,
  },
  pulseRing: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: "#F0FDFA",
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: "#CCFBF1",
  },
  pulseActive: { borderColor: COLORS.primary },
  pulseInner: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  scanText: { fontSize: 14, fontWeight: "700", color: COLORS.textSecondary, marginTop: 18, marginBottom: 14 },
  scanBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    backgroundColor: COLORS.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: RADIUS.xl,
  },
  scanBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  notice: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: "#FFFBEB", padding: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "#FDE68A", marginBottom: 16,
  },
  noticeText: { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 18 },
  demoLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 8 },
  demoCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", padding: 14, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  demoIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center" },
  demoName: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  demoUid: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, fontFamily: "monospace" },
});
