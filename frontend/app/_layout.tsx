import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ReceiptPrinterProvider } from "../src/printReceipt";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ReceiptPrinterProvider>
        <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sale/[pumpId]" />
          <Stack.Screen name="payment" />
          <Stack.Screen name="membership" />
          <Stack.Screen name="noat" />
          <Stack.Screen name="receipt/[txId]" />
          <Stack.Screen name="printer" />
          <Stack.Screen name="nfc-login" />
          <Stack.Screen name="flux-login" />
          <Stack.Screen name="live" />
        </Stack>
      </ReceiptPrinterProvider>
    </SafeAreaProvider>
  );
}
