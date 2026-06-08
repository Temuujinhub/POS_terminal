// Simple session helper (operator persisted via AsyncStorage)
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Operator = { id: string; name: string; role: string };

const KEY = "gs_pos_operator";

export async function saveOperator(op: Operator) {
  await AsyncStorage.setItem(KEY, JSON.stringify(op));
}

export async function loadOperator(): Promise<Operator | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearOperator() {
  await AsyncStorage.removeItem(KEY);
}
