// Reusable numeric keypad
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS } from "./theme";

type Props = {
  onPress: (digit: string) => void;
  onBackspace: () => void;
  onSubmit?: () => void;
  showSubmit?: boolean;
  submitLabel?: string;
  submitDisabled?: boolean;
};

export default function Keypad({
  onPress,
  onBackspace,
  onSubmit,
  showSubmit = false,
  submitLabel = "OK",
  submitDisabled = false,
}: Props) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <View style={styles.wrap} testID="keypad">
      <View style={styles.grid}>
        {keys.map((k) => (
          <TouchableOpacity
            key={k}
            style={styles.key}
            activeOpacity={0.6}
            onPress={() => onPress(k)}
            testID={`keypad-key-${k}`}
          >
            <Text style={styles.keyText}>{k}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.key}
          activeOpacity={0.6}
          onPress={onBackspace}
          testID="keypad-backspace"
        >
          <Ionicons name="backspace-outline" size={28} color={COLORS.accentRed} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.key}
          activeOpacity={0.6}
          onPress={() => onPress("0")}
          testID="keypad-key-0"
        >
          <Text style={styles.keyText}>0</Text>
        </TouchableOpacity>
        {showSubmit ? (
          <TouchableOpacity
            style={[
              styles.key,
              styles.submit,
              submitDisabled && { opacity: 0.4 },
            ]}
            activeOpacity={0.7}
            disabled={submitDisabled}
            onPress={onSubmit}
            testID="keypad-submit"
          >
            <Text style={styles.submitText}>{submitLabel}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.key}
            activeOpacity={0.6}
            onPress={() => onPress(".")}
            testID="keypad-key-dot"
          >
            <Text style={styles.keyText}>.</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  key: {
    width: "31.5%",
    height: 54,
    backgroundColor: COLORS.keypadBg,
    borderRadius: RADIUS.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontSize: 24, fontWeight: "700", color: COLORS.textPrimary },
  submit: { backgroundColor: COLORS.primary },
  submitText: { color: "#fff", fontSize: 20, fontWeight: "800" },
});
