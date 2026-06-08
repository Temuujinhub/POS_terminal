// Settings - bluetooth printer + logout
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, RADIUS } from "../../src/theme";
import { clearOperator, loadOperator, Operator } from "../../src/session";

export default function Settings() {
  const router = useRouter();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    (async () => setOperator(await loadOperator()))();
  }, []);

  const doLogout = async () => {
    setConfirmOpen(false);
    await clearOperator();
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="settings-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Тохиргоо</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>АЖИЛТАН</Text>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <MaterialCommunityIcons name="account" size={28} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName} testID="settings-operator-name">{operator?.name}</Text>
              <Text style={styles.profileRole}>Түгээгүүрийн ажилтан</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ТӨХӨӨРӨМЖ</Text>
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => router.push("/printer")}
          testID="settings-bluetooth-row"
        >
          <View style={[styles.iconBox, { backgroundColor: "#EFF6FF" }]}>
            <MaterialCommunityIcons name="printer-pos" size={22} color="#1D4ED8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Bluetooth принтер</Text>
            <Text style={styles.rowSub}>НӨАТ-ын баримт хэвлэх</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.row, { borderColor: "#FECACA" }]}
          activeOpacity={0.7}
          onPress={() => setConfirmOpen(true)}
          testID="logout-btn"
        >
          <View style={[styles.iconBox, { backgroundColor: "#FEF2F2" }]}>
            <MaterialCommunityIcons name="logout" size={22} color={COLORS.accentRed} />
          </View>
          <Text style={[styles.rowTitle, { color: COLORS.accentRed, flex: 1 }]}>Ээлжээс гарах</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.accentRed} />
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Petrol POS v1.1</Text>

      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="logout-confirm-modal">
            <View style={styles.modalIcon}>
              <MaterialCommunityIcons name="logout" size={28} color={COLORS.accentRed} />
            </View>
            <Text style={styles.modalTitle}>Ээлжээс гарах уу?</Text>
            <Text style={styles.modalText}>
              Та ээлжээсээ гарах гэж байна. Дахин нэвтрэхдээ ПИН код шаардана.
            </Text>
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setConfirmOpen(false)}
                activeOpacity={0.8}
                testID="logout-cancel"
              >
                <Text style={styles.modalCancelText}>Болих</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalConfirm]}
                onPress={doLogout}
                activeOpacity={0.8}
                testID="logout-confirm"
              >
                <Text style={styles.modalConfirmText}>Гарах</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 20 },
  header: { paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center" },
  profileName: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary },
  profileRole: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", padding: 14, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border,
  },
  iconBox: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  rowSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  footer: { textAlign: "center", color: COLORS.textMuted, fontSize: 11, marginTop: "auto", paddingVertical: 12 },
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  modalCard: {
    width: "100%", maxWidth: 360, backgroundColor: "#fff",
    borderRadius: RADIUS.xxl, padding: 24, alignItems: "center",
  },
  modalIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: "#FEF2F2",
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary, textAlign: "center" },
  modalText: { fontSize: 13, color: COLORS.textSecondary, textAlign: "center", marginTop: 8, lineHeight: 19 },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 20, width: "100%" },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: "center" },
  modalCancel: { backgroundColor: "#F1F5F9" },
  modalCancelText: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 14 },
  modalConfirm: { backgroundColor: COLORS.accentRed },
  modalConfirmText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
