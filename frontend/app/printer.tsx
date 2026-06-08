// Bluetooth printer (MOCKED - real Bluetooth needs dev build)
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS } from "../src/theme";

type Device = { id: string; name: string; mac: string };

const MOCK_DEVICES: Device[] = [
  { id: "1", name: "POS-58 Mini Printer", mac: "00:11:22:33:44:55" },
  { id: "2", name: "Goojprt PT-210", mac: "AA:BB:CC:11:22:33" },
  { id: "3", name: "Xprinter XP-58IIH", mac: "DE:AD:BE:EF:00:01" },
];

export default function Printer() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedId, setConnectedId] = useState<string | null>(null);

  const onScan = () => {
    setScanning(true);
    setDevices([]);
    setTimeout(() => {
      setDevices(MOCK_DEVICES);
      setScanning(false);
    }, 1500);
  };

  const onConnect = (d: Device) => {
    setConnectedId(d.id);
    Alert.alert("Холбогдлоо", `${d.name}-тэй амжилттай холбогдлоо.\n(Симуляц - бодит хэвлэлт хийхэд expo dev build шаардана)`);
  };

  const onTestPrint = () => {
    Alert.alert("Тест хэвлэлт", "Тест хуудас илгээгдлээ. (Симуляц)");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="printer-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Bluetooth принтер</Text>
          <Text style={styles.sub}>Хэвлэх төхөөрөмжтэй холбогдох</Text>
        </View>
      </View>

      <View style={{ padding: 20 }}>
        <View style={styles.notice}>
          <MaterialCommunityIcons name="information-outline" size={20} color="#92400E" />
          <Text style={styles.noticeText}>
            Bluetooth холболт нь симуляц байна. Бодит принтертэй холбогдохын тулд аппликейшнийг dev build хийх шаардлагатай.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.scanBtn}
          onPress={onScan}
          disabled={scanning}
          activeOpacity={0.85}
          testID="scan-btn"
        >
          {scanning ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="bluetooth" size={20} color="#fff" />}
          <Text style={styles.scanText}>{scanning ? "Хайж байна..." : "Төхөөрөмж хайх"}</Text>
        </TouchableOpacity>

        {devices.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionLabel}>ОЛДСОН ТӨХӨӨРӨМЖҮҮД</Text>
            {devices.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={[styles.deviceRow, connectedId === d.id && styles.deviceConnected]}
                onPress={() => onConnect(d)}
                activeOpacity={0.85}
                testID={`device-${d.id}`}
              >
                <View style={[styles.devIcon, connectedId === d.id && { backgroundColor: COLORS.primary }]}>
                  <MaterialCommunityIcons
                    name="printer-pos"
                    size={22}
                    color={connectedId === d.id ? "#fff" : COLORS.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.devName}>{d.name}</Text>
                  <Text style={styles.devMac}>{d.mac}</Text>
                </View>
                {connectedId === d.id ? (
                  <View style={styles.connectedBadge}>
                    <Text style={styles.connectedText}>Холбогдсон</Text>
                  </View>
                ) : (
                  <Text style={styles.connectText}>Холбох</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {connectedId && (
          <TouchableOpacity
            style={styles.testBtn}
            onPress={onTestPrint}
            activeOpacity={0.85}
            testID="test-print-btn"
          >
            <MaterialCommunityIcons name="text-box-check" size={20} color={COLORS.primary} />
            <Text style={styles.testText}>Тест хэвлэх</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  notice: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: "#FFFBEB", padding: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "#FDE68A", marginBottom: 16,
  },
  noticeText: { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 18 },
  scanBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.xl,
  },
  scanText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: COLORS.textMuted, letterSpacing: 1, marginBottom: 8 },
  deviceRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", padding: 14, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  deviceConnected: { borderColor: COLORS.primary, borderWidth: 2 },
  devIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#F0FDFA", alignItems: "center", justifyContent: "center" },
  devName: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  devMac: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, fontFamily: "monospace" },
  connectText: { fontSize: 12, color: COLORS.primary, fontWeight: "800" },
  connectedBadge: { backgroundColor: "#ECFDF5", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  connectedText: { fontSize: 11, fontWeight: "800", color: "#065F46" },
  testBtn: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    backgroundColor: "#fff", paddingVertical: 14, borderRadius: RADIUS.xl,
    borderWidth: 2, borderColor: COLORS.primary, marginTop: 14,
  },
  testText: { color: COLORS.primary, fontSize: 14, fontWeight: "800" },
});
