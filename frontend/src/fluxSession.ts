// Flux session helpers (real API integration via backend proxy)
import AsyncStorage from "@react-native-async-storage/async-storage";

export type FluxSession = {
  session_id: string;
  user_id: number;
  full_name: string;
  role: string;
  station_id: number;
  station_name: string;
  expires_at: string;
};

const KEY = "gs_pos_flux_session";
const MODE_KEY = "gs_pos_mode";

export type AppMode = "demo" | "live";

export async function saveFluxSession(s: FluxSession) {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

export async function loadFluxSession(): Promise<FluxSession | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearFluxSession() {
  await AsyncStorage.removeItem(KEY);
}

export async function getMode(): Promise<AppMode> {
  const v = await AsyncStorage.getItem(MODE_KEY);
  return (v === "live" ? "live" : "demo") as AppMode;
}

export async function setMode(m: AppMode) {
  await AsyncStorage.setItem(MODE_KEY, m);
}
