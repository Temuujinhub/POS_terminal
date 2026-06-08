// Home / entry screen — Flux Monitor Live mode
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS } from "../src/theme";
import { flux } from "../src/fluxApi";
import { saveFluxSession, loadFluxSession, setMode } from "../src/fluxSession";

export default function Home() {
  const router = useRouter();
  const [mode, setLocalMode] = useState<"demo" | "email" | "nfc">("demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nfcTag, setNfcTag] = useState("");
  const [stationId, setStationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode("live");
    (async () => {
      const s = await loadFluxSession();
      if (s) router.replace("/live/dashboard");
      else setBootstrapping(false);
    })();
  }, []);

  const onDemo = async () => {
    setError(null); setLoading(true);
    try {
      const s = await flux.loginDemo();
      await saveFluxSession(s);
      router.replace("/live/dashboard");
    } catch (e: any) { setError(e.message || "Алдаа"); }
    finally { setLoading(false); }
  };

  const onEmailLogin = async () => {
    setError(null);
    if (!email.trim() || !password) { setError("И-мэйл болон нууц үгээ оруулна уу"); return; }
    setLoading(true);
    try {
      const s = await flux.loginEmail(email.trim(), password);
      await saveFluxSession(s);
      router.replace("/live/dashboard");
    } catch (e: any) { setError(e.message || "Алдаа"); }
    finally { setLoading(false); }
  };

  const onNfcLogin = async () => {
    setError(null);
    if (nfcTag.replace(/[^a-fA-F0-9]/g, "").length < 4) { setError("NFC tag оруулна уу"); return; }
    setLoading(true);
    try {
      const tag = nfcTag.toUpperCase().replace(/[^A-F0-9]/g, "");
      const sid = stationId ? parseInt(stationId, 10) : undefined;
      const s = await flux.loginNfc(tag, sid);
      await saveFluxSession(s);
      router.replace("/live/dashboard");
    } catch (e: any) { setError(e.message || "Алдаа"); }
    finally { setLoading(false); }
  };

  if (bootstrapping) {
    return (
      <SafeAreaView style={styles.bootstrap}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="home-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Brand */}
          <View style={styles.brandRow}>
            <Image
              source={require("../assets/images/uboil-logo.png")}
              style={styles.logoImg}
              resizeMode="contain"
            />
            <View>
              <Text style={styles.brand}>UBoil POS</Text>
              <Text style={styles.brandSub}>Flux Monitor холболттой</Text>
            </View>
          </View>

          {/* Hero / Demo highlight */}
          <View style={styles.heroCard} testID="hero-demo">
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveTagText}>LIVE ТУРШИЛТ</Text>
            </View>
            <Text style={styles.heroTitle}>Бэлэн өгөгдөлтэй туршиж үзэх</Text>
            <Text style={styles.heroSub}>
              NFC, нууц үг шаардлагагүй. 8 түгээгүүр, шахалт симуляц, НӨАТ-ын баримт бүгд live горимоор ажиллана.
            </Text>
            <TouchableOpacity
              style={[styles.heroBtn, loading && { opacity: 0.6 }]}
              onPress={onDemo}
              disabled={loading}
              activeOpacity={0.85}
              testID="demo-login-btn"
            >
              {loading && mode === "demo" ? <ActivityIndicator color="#fff" /> : (
                <>
                  <MaterialCommunityIcons name="play-circle" size={22} color="#fff" />
                  <Text style={styles.heroBtnText}>Туршилт эхлүүлэх</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorBanner} testID="error-banner">
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={COLORS.accentRed} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Real auth tabs */}
          <Text style={styles.sectionLabel}>БОДИТ FLUX АККАУНТААР НЭВТРЭХ</Text>
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, mode === "email" && styles.tabActive]}
              onPress={() => setLocalMode("email")} testID="tab-email"
            >
              <MaterialCommunityIcons name="email-outline" size={16} color={mode === "email" ? "#fff" : COLORS.textSecondary} />
              <Text style={[styles.tabText, mode === "email" && styles.tabTextActive]}>И-мэйл</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, mode === "nfc" && styles.tabActive]}
              onPress={() => setLocalMode("nfc")} testID="tab-nfc"
            >
              <MaterialCommunityIcons name="nfc" size={16} color={mode === "nfc" ? "#fff" : COLORS.textSecondary} />
              <Text style={[styles.tabText, mode === "nfc" && styles.tabTextActive]}>NFC</Text>
            </TouchableOpacity>
          </View>

          {mode === "email" ? (
            <View>
              <TextInput
                style={styles.input}
                value={email} onChangeText={setEmail}
                placeholder="И-мэйл"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none" keyboardType="email-address"
                testID="email-input"
              />
              <TextInput
                style={styles.input}
                value={password} onChangeText={setPassword}
                placeholder="Нууц үг"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                testID="password-input"
              />
              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.6 }]}
                onPress={onEmailLogin} disabled={loading}
                activeOpacity={0.85} testID="email-submit-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <MaterialCommunityIcons name="login" size={18} color="#fff" />
                    <Text style={styles.submitText}>Нэвтрэх</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TextInput
                style={styles.input}
                value={nfcTag} onChangeText={(v) => setNfcTag(v.toUpperCase())}
                placeholder="NFC tag (HEX)"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                testID="nfc-tag-input"
              />
              <TextInput
                style={styles.input}
                value={stationId} onChangeText={(v) => setStationId(v.replace(/[^0-9]/g, ""))}
                placeholder="Station ID (сонгоно)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
                testID="station-id-input"
              />
              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.6 }]}
                onPress={onNfcLogin} disabled={loading}
                activeOpacity={0.85} testID="nfc-submit-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <MaterialCommunityIcons name="nfc-tap" size={18} color="#fff" />
                    <Text style={styles.submitText}>NFC-р нэвтрэх</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.footerText}>
            Backend → <Text style={styles.mono}>uboil.flux.mn</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bootstrap: { flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center" },
  container: { flex: 1, backgroundColor: COLORS.background },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, marginBottom: 24 },
  logoBadge: { width: 52, height: 52, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  logoImg: { width: 56, height: 56, borderRadius: 14 },
  brand: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: -0.3 },
  brandSub: { fontSize: 12, color: COLORS.textSecondary, fontWeight: "600", marginTop: 2 },
  heroCard: {
    backgroundColor: "#0F172A",
    borderRadius: RADIUS.xxl, padding: 22, marginBottom: 20,
  },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(239,68,68,0.18)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginBottom: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  liveTagText: { color: "#FCA5A5", fontWeight: "800", fontSize: 10, letterSpacing: 1 },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  heroSub: { fontSize: 13, color: "#CBD5E1", marginTop: 6, lineHeight: 19 },
  heroBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
    backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.xl, marginTop: 18,
  },
  heroBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FEF2F2", padding: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "#FECACA", marginBottom: 16,
  },
  errorText: { flex: 1, color: COLORS.accentRed, fontSize: 12, fontWeight: "700" },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 10 },
  tabs: { flexDirection: "row", backgroundColor: "#F1F5F9", padding: 4, borderRadius: RADIUS.lg, marginBottom: 12 },
  tab: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 9, borderRadius: RADIUS.md },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: "700", color: COLORS.textSecondary },
  tabTextActive: { color: "#fff" },
  input: {
    backgroundColor: "#fff", padding: 14, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    fontSize: 15, fontWeight: "700", color: COLORS.textPrimary, marginBottom: 10,
  },
  submitBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
    backgroundColor: COLORS.textPrimary, paddingVertical: 14, borderRadius: RADIUS.xl, marginTop: 4,
  },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  footerText: { textAlign: "center", color: COLORS.textMuted, fontSize: 11, marginTop: 24, fontWeight: "600" },
  mono: { fontFamily: "monospace", color: COLORS.textSecondary },
});
