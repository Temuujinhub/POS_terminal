// Flux API login (email/password OR NFC) - real https://uboil.flux.mn integration
import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS } from "../src/theme";
import { flux } from "../src/fluxApi";
import { saveFluxSession, setMode } from "../src/fluxSession";

export default function FluxLogin() {
  const router = useRouter();
  const [tab, setTab] = useState<"email" | "nfc">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nfcTag, setNfcTag] = useState("");
  const [stationId, setStationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMode("live"); }, []);

  const onEmailLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("И-мэйл болон нууц үгээ оруулна уу"); return;
    }
    setLoading(true);
    try {
      const s = await flux.loginEmail(email.trim(), password);
      await saveFluxSession(s);
      router.replace("/live/dashboard");
    } catch (e: any) {
      setError(e.message || "Алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  };

  const onNfcLogin = async () => {
    setError(null);
    if (nfcTag.replace(/[^a-fA-F0-9]/g, "").length < 4) {
      setError("NFC tag (hex) оруулна уу"); return;
    }
    setLoading(true);
    try {
      const tag = nfcTag.toUpperCase().replace(/[^A-F0-9]/g, "");
      const sid = stationId ? parseInt(stationId, 10) : undefined;
      const s = await flux.loginNfc(tag, sid);
      await saveFluxSession(s);
      router.replace("/live/dashboard");
    } catch (e: any) {
      setError(e.message || "Алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="flux-login-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={styles.brandRow}>
            <View style={styles.logoBadge}>
              <MaterialCommunityIcons name="lightning-bolt" size={20} color="#fff" />
            </View>
            <View>
              <Text style={styles.title}>Flux Monitor</Text>
              <Text style={styles.sub}>uboil.flux.mn</Text>
            </View>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>Live горимоор нэвтрэх</Text>
          <Text style={styles.h1Sub}>Бодит шатахуун станцын систем</Text>

          {error && (
            <View style={styles.errorBanner} testID="error-banner">
              <MaterialCommunityIcons name="alert-circle-outline" size={20} color={COLORS.accentRed} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === "email" && styles.tabActive]}
              onPress={() => setTab("email")}
              testID="tab-email"
            >
              <MaterialCommunityIcons name="email-outline" size={18} color={tab === "email" ? "#fff" : COLORS.textSecondary} />
              <Text style={[styles.tabText, tab === "email" && styles.tabTextActive]}>И-мэйл</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === "nfc" && styles.tabActive]}
              onPress={() => setTab("nfc")}
              testID="tab-nfc"
            >
              <MaterialCommunityIcons name="nfc" size={18} color={tab === "nfc" ? "#fff" : COLORS.textSecondary} />
              <Text style={[styles.tabText, tab === "nfc" && styles.tabTextActive]}>NFC карт</Text>
            </TouchableOpacity>
          </View>

          {tab === "email" ? (
            <>
              <Text style={styles.label}>И-МЭЙЛ</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="attendant@uboil.mn"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                testID="email-input"
              />
              <Text style={styles.label}>НУУЦ ҮГ</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                testID="password-input"
              />
              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.6 }]}
                onPress={onEmailLogin}
                disabled={loading}
                activeOpacity={0.85}
                testID="email-submit-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <MaterialCommunityIcons name="login" size={20} color="#fff" />
                    <Text style={styles.submitText}>Нэвтрэх</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>NFC TAG (HEX)</Text>
              <TextInput
                style={styles.input}
                value={nfcTag}
                onChangeText={(v) => setNfcTag(v.toUpperCase())}
                placeholder="04A1B2C3D4E5F6"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                testID="nfc-tag-input"
              />
              <Text style={styles.label}>STATION ID (СОНГОНО)</Text>
              <TextInput
                style={styles.input}
                value={stationId}
                onChangeText={(v) => setStationId(v.replace(/[^0-9]/g, ""))}
                placeholder="10"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
                testID="station-id-input"
              />
              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.6 }]}
                onPress={onNfcLogin}
                disabled={loading}
                activeOpacity={0.85}
                testID="nfc-submit-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <MaterialCommunityIcons name="nfc-tap" size={20} color="#fff" />
                    <Text style={styles.submitText}>NFC-р нэвтрэх</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          <View style={styles.notice}>
            <MaterialCommunityIcons name="information-outline" size={18} color="#1E40AF" />
            <Text style={styles.noticeText}>
              Энэ горим нь Flux Monitor сервертэй шууд холбогдоно. Демо горим руу буцахдаа Тохиргоо → Горим солих.
            </Text>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>эсвэл</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.demoBtn, loading && { opacity: 0.5 }]}
            onPress={async () => {
              setError(null);
              setLoading(true);
              try {
                const s = await flux.loginDemo();
                await saveFluxSession(s);
                router.replace("/live/dashboard");
              } catch (e: any) {
                setError(e.message || "Алдаа гарлаа");
              } finally { setLoading(false); }
            }}
            disabled={loading}
            activeOpacity={0.85}
            testID="demo-login-btn"
          >
            <MaterialCommunityIcons name="test-tube" size={20} color={COLORS.primary} />
            <Text style={styles.demoBtnText}>Туршилтын Live горим</Text>
          </TouchableOpacity>
          <Text style={styles.demoHint}>
            NFC/email-гүйгээр UI-г турших — мок өгөгдлөөр шахалт + finalize ажиллана
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBadge: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#1D4ED8", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, fontFamily: "monospace" },
  h1: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary, marginTop: 4 },
  h1Sub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, marginBottom: 20 },
  tabs: { flexDirection: "row", backgroundColor: "#F1F5F9", padding: 4, borderRadius: RADIUS.lg, marginBottom: 16 },
  tab: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 10, borderRadius: RADIUS.md },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: "700", color: COLORS.textSecondary },
  tabTextActive: { color: "#fff" },
  label: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 6, marginTop: 6 },
  input: {
    backgroundColor: "#fff", padding: 16, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    fontSize: 16, fontWeight: "700", color: COLORS.textPrimary, marginBottom: 12,
  },
  submitBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.xl, marginTop: 8,
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  notice: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: "#EFF6FF", padding: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "#BFDBFE", marginTop: 24,
  },
  noticeText: { flex: 1, fontSize: 12, color: "#1E3A8A", lineHeight: 18 },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FEF2F2", padding: 14, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "#FECACA", marginBottom: 16,
  },
  errorText: { flex: 1, color: COLORS.accentRed, fontSize: 13, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { fontSize: 11, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1 },
  demoBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
    backgroundColor: "#F0FDFA", paddingVertical: 14, borderRadius: RADIUS.xl,
    borderWidth: 2, borderColor: "#CCFBF1",
  },
  demoBtnText: { color: COLORS.primary, fontSize: 14, fontWeight: "800" },
  demoHint: { fontSize: 11, color: COLORS.textMuted, textAlign: "center", marginTop: 8, lineHeight: 16 },
});
