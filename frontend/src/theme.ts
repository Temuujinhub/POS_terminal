// Shared theme & constants for Gas Station POS
export const COLORS = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  primary: "#0F766E",
  primaryDark: "#115E59",
  primaryFg: "#FFFFFF",
  secondary: "#F97316",
  secondaryFg: "#FFFFFF",
  accentRed: "#E11D48",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#94A3B8",
  border: "#E2E8F0",
  success: "#10B981",
  keypadBg: "#F1F5F9",
  keypadActive: "#E2E8F0",
};

export const FUEL_COLORS: Record<string, string> = {
  "АИ-92": "#10B981",
  "АИ-95": "#0F766E",
  "Дизель": "#F97316",
};

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };

export const fmtMNT = (n: number) =>
  `${Math.round(n).toLocaleString("en-US")}₮`;

export const API = process.env.EXPO_PUBLIC_BACKEND_URL + "/api";
