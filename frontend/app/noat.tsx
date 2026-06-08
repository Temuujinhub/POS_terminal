// NOAT - customer type + register number with auto-name lookup for organizations
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, API, fmtMNT } from "../src/theme";
import { saleStore } from "../src/saleStore";
import { loadOperator } from "../src/session";

type LookupState = "idle" | "loading" | "found" | "notfound";

export default function NOAT() {
  const router = useRouter();
  const sale = saleStore.get();
  const [customerType, setCustomerType] = useState<"individual" | "organization">(
    sale.customerType || "individual"
  );
  const [registerNumber, setRegisterNumber] = useState(
    customerType === "organization" ? (sale.registerNumber || "") : ""
  );
  const [orgName, setOrgName] = useState(sale.customerName || "");
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<any>(null);

  // Auto-lookup organization name when register changes
  useEffect(() => {
    if (customerType !== "organization") {
      setLookupState("idle");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (registerNumber.trim().length < 5) {
      setLookupState("idle");
      setOrgName("");
      return;
    }
    setLookupState("loading");
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/organizations/lookup?register=${encodeURIComponent(registerNumber.trim())}`);
        if (r.ok) {
          const d = await r.json();
          setOrgName(d.name);
          setLookupState("found");
        } else {
          setOrgName("");
          setLookupState("notfound");
        }
      } catch {
        setLookupState("notfound");
      }
    }, 400);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [registerNumber, customerType]);

  const submit = async () => {
    if (customerType === "organization") {
      if (lookupState !== "found") {
        Alert.alert("Алдаа", "Байгууллагын регистр буруу эсвэл бүртгэлгүй");
        return;
      }
    }
    setCreating(true);
    try {
      const op = await loadOperator();
      const isOrg = customerType === "organization";
      const body = {
        operator_id: op?.id,
        pump_id: sale.pumpId,
        fuel_type: sale.fuelType,
        liters: sale.liters,
        amount: sale.amount,
        payment_method: sale.paymentMethod,
        membership_card: sale.membershipCard,
        customer_type: customerType,
        // Хувь хүнээс регистр асуухгүй
        register_number: isOrg ? registerNumber.trim() : null,
        customer_name: isOrg ? orgName : null,
      };
      const r = await fetch(`${API}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        Alert.alert("Алдаа", d.detail || "Гүйлгээ үүсгэх амжилтгүй");
        return;
      }
      saleStore.reset();
      router.replace(`/receipt/${d.id}`);
    } catch {
      Alert.alert("Алдаа", "Сервертэй холбогдож чадсангүй");
    } finally {
      setCreating(false);
    }
  };

  const canSubmit =
    customerType === "individual" ||
    (customerType === "organization" && lookupState === "found");

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="noat-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>НӨАТ-ын баримт</Text>
          <Text style={styles.sub}>Худалдан авагчийн төрлийг сонгоно уу</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>ТӨЛӨХ ДҮН</Text>
            <Text style={styles.amountValue}>{fmtMNT(sale.amount || 0)}</Text>
            <Text style={styles.amountSub}>{sale.fuelType} • {(sale.liters || 0).toFixed(2)} L</Text>
          </View>

          <Text style={styles.sectionLabel}>ХУДАЛДАН АВАГЧИЙН ТӨРӨЛ</Text>
          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[styles.typeCard, customerType === "individual" && styles.typeActive]}
              onPress={() => { setCustomerType("individual"); setRegisterNumber(""); setOrgName(""); }}
              testID="type-individual"
            >
              <MaterialCommunityIcons
                name="account"
                size={28}
                color={customerType === "individual" ? "#fff" : COLORS.primary}
              />
              <Text style={[styles.typeText, customerType === "individual" && styles.typeTextActive]}>
                Хувь хүн
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeCard, customerType === "organization" && styles.typeActive]}
              onPress={() => setCustomerType("organization")}
              testID="type-organization"
            >
              <MaterialCommunityIcons
                name="office-building"
                size={28}
                color={customerType === "organization" ? "#fff" : COLORS.primary}
              />
              <Text style={[styles.typeText, customerType === "organization" && styles.typeTextActive]}>
                Байгууллага
              </Text>
            </TouchableOpacity>
          </View>

          {customerType === "individual" ? (
            <View style={styles.individualBox} testID="individual-info-box">
              <View style={styles.individualIcon}>
                <Ionicons name="checkmark-circle" size={28} color={COLORS.success} />
              </View>
              <Text style={styles.individualTitle}>Хувь хүний баримт бэлэн</Text>
              <Text style={styles.individualSub}>
                Регистрийн дугаар шаардахгүй. e-Barimt лотерейн дугаар автоматаар үүснэ.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.sectionLabel}>БАЙГУУЛЛАГЫН ТТД</Text>
              <View style={styles.inputBox}>
                <TextInput
                  style={styles.input}
                  value={registerNumber}
                  onChangeText={(t) => setRegisterNumber(t.replace(/[^0-9]/g, ""))}
                  placeholder="6123456"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="number-pad"
                  maxLength={7}
                  testID="register-input"
                />
                <View style={styles.statusIcon}>
                  {lookupState === "loading" && <ActivityIndicator size="small" color={COLORS.primary} />}
                  {lookupState === "found" && <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />}
                  {lookupState === "notfound" && <Ionicons name="close-circle" size={24} color={COLORS.accentRed} />}
                </View>
              </View>
              <Text style={styles.hint}>Жишээ: 6123456, 2034567, 5712398</Text>

              {lookupState === "found" && orgName && (
                <View style={styles.orgFoundBox} testID="org-found-box">
                  <MaterialCommunityIcons name="office-building-marker" size={22} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orgLabel}>БАЙГУУЛЛАГЫН НЭР</Text>
                    <Text style={styles.orgName} testID="org-name-display">{orgName}</Text>
                  </View>
                </View>
              )}
              {lookupState === "notfound" && (
                <View style={styles.orgNotFoundBox} testID="org-notfound-box">
                  <MaterialCommunityIcons name="alert-circle-outline" size={20} color={COLORS.accentRed} />
                  <Text style={styles.orgNotFoundText}>
                    Энэ ТТД-аар байгууллага олдсонгүй. Регистрээ шалгана уу.
                  </Text>
                </View>
              )}
            </>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (!canSubmit || creating) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!canSubmit || creating}
            activeOpacity={0.85}
            testID="create-transaction-btn"
          >
            {creating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="receipt" size={22} color="#fff" />
                <Text style={styles.submitText}>Баримт үүсгэх</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  amountCard: { backgroundColor: COLORS.primary, padding: 18, borderRadius: RADIUS.xxl, alignItems: "center", marginBottom: 20 },
  amountLabel: { color: "rgba(255,255,255,0.85)", fontWeight: "800", letterSpacing: 1, fontSize: 11 },
  amountValue: { color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 4 },
  amountSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2, fontWeight: "600" },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  typeRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  typeCard: {
    flex: 1, paddingVertical: 22, alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: RADIUS.xl, borderWidth: 2, borderColor: COLORS.border,
  },
  typeActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  typeText: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  typeTextActive: { color: "#fff" },
  individualBox: {
    backgroundColor: "#ECFDF5", borderRadius: RADIUS.xl, padding: 18,
    borderWidth: 1, borderColor: "#A7F3D0", alignItems: "center", marginBottom: 8,
  },
  individualIcon: { marginBottom: 8 },
  individualTitle: { fontSize: 15, fontWeight: "800", color: "#065F46" },
  individualSub: { fontSize: 12, color: "#047857", marginTop: 6, textAlign: "center", lineHeight: 18 },
  inputBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, paddingRight: 12,
  },
  input: {
    flex: 1, padding: 16,
    fontSize: 18, fontWeight: "700", color: COLORS.textPrimary, letterSpacing: 1,
  },
  statusIcon: { width: 28, alignItems: "center" },
  hint: { fontSize: 11, color: COLORS.textMuted, marginTop: 6, marginLeft: 4 },
  orgFoundBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#F0FDFA", borderRadius: RADIUS.lg, padding: 14,
    borderWidth: 1, borderColor: "#CCFBF1", marginTop: 12,
  },
  orgLabel: { fontSize: 10, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1 },
  orgName: { fontSize: 16, fontWeight: "800", color: COLORS.primary, marginTop: 2 },
  orgNotFoundBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FEF2F2", borderRadius: RADIUS.lg, padding: 12,
    borderWidth: 1, borderColor: "#FECACA", marginTop: 12,
  },
  orgNotFoundText: { flex: 1, fontSize: 12, color: COLORS.accentRed, fontWeight: "600" },
  submitBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    backgroundColor: COLORS.primary, paddingVertical: 18, borderRadius: RADIUS.xl, marginTop: 24,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
