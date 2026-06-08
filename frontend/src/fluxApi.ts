// Flux API client (calls our backend proxy at /api/flux/*)
import { API } from "./theme";
import { loadFluxSession } from "./fluxSession";

// 🆕 V2: Prepay/postpay flow types (FLUX_API_CHANGES_V2_PREPAY.md)
export type PaymentMethod = "cash" | "bank_card" | "qpay" | "fuel_card" | "invoice";

export interface PrepaymentBlock {
  amount: number;
  method: Exclude<PaymentMethod, "invoice">;
  bank_approval_code?: string;
  bank_rrn?: string;
  bank_masked_pan?: string;
  bank_terminal_id?: string;
  qpay_invoice_id?: string;
  qpay_payment_id?: string;
  vat_receipt_number?: string;
  vat_type?: "Иргэн" | "Бараа худалдан авагч" | "Байгууллага";
  vat_register?: string;
}

export interface ActiveDispenseItem {
  command_id: number;
  transaction_id: number | null;
  pump: number;
  nozzle: number | null;
  fuel_grade_name: string | null;
  status: "pending" | "sent" | "acknowledged" | "filling" | "eot" | "completed" | "failed";
  payment_flow: "prepay" | "postpay";
  preset_dose_type: "Amount" | "Volume" | "FullTank" | null;
  preset_dose: number | null;
  current_volume: number | null;
  current_amount: number | null;
  prepaid_amount: number | null;
  started_at: string | null;
  user_email?: string;
}

async function call<T = any>(method: string, path: string, body?: any): Promise<T> {
  const session = await loadFluxSession();
  const headers: any = { "Content-Type": "application/json" };
  if (session) headers["X-Session-Id"] = session.session_id;

  // Retry once on transient network/5xx errors (backend may briefly restart on file change)
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${API}/flux${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      let data: any = null;
      try { data = await r.json(); } catch (_) {}
      if (!r.ok) {
        const detail = data?.detail;
        let msg: string;
        if (typeof detail === "string") msg = detail;
        else if (Array.isArray(detail)) msg = "Хүсэлтийн өгөгдөл буруу байна";
        else if (r.status >= 500) msg = "Серверт түр алдаа гарлаа. Дахин оролдоно уу";
        else if (r.status === 401) msg = "Эрх байхгүй эсвэл session дууссан";
        else if (r.status === 404) msg = "Олдсонгүй";
        else if (r.status === 422) msg = "Шаардлагатай мэдээлэл дутуу байна";
        else msg = `HTTP ${r.status}`;
        // Don't retry on client errors (4xx) — those won't change on retry
        if (r.status < 500) throw new Error(msg);
        lastErr = new Error(msg);
        continue;
      }
      return data;
    } catch (e: any) {
      // Network failure (TypeError: Failed to fetch / Network request failed)
      const isNetwork = e?.name === "TypeError" || /fetch|network/i.test(e?.message || "");
      lastErr = isNetwork ? new Error("Сүлжээний алдаа. Холболтоо шалгана уу") : e;
      if (!isNetwork && !/Серверт түр алдаа/.test(lastErr.message)) throw lastErr;
      // small backoff before retry
      if (attempt === 0) await new Promise((res) => setTimeout(res, 600));
    }
  }
  throw lastErr || new Error("Алдаа гарлаа");
}

export const flux = {
  loginEmail: (email: string, password: string) =>
    call("POST", "/auth/login", { email, password }),
  loginNfc: (nfc_tag: string, station_id?: number) =>
    call("POST", "/auth/nfc-login", { nfc_tag, station_id }),
  loginDemo: () => call("POST", "/auth/demo-login"),
  logout: () => call("POST", "/auth/logout"),
  me: () => call("GET", "/me"),
  pumps: (station_id?: number) =>
    call("GET", `/pumps${station_id ? `?station_id=${station_id}` : ""}`),
  lookupCard: (nfc_tag: string) => {
    return loadFluxSession().then((s) =>
      call("POST", "/lookup-card", { session_id: s?.session_id, nfc_tag })
    );
  },
  startDispense: (params: {
    pump: number;
    dose_type: "Amount" | "Volume" | "FullTank";
    dose?: number;
    nozzle?: number;
    fuel_grade_id?: number;
    auto_close?: boolean;
    card_id?: number;
    nfc_tag?: string;
    // 🆕 V2: Prepay/postpay flow (FLUX_API_CHANGES_V2_PREPAY.md)
    payment_flow?: "prepay" | "postpay";
    prepayment?: PrepaymentBlock;
  }) => {
    return loadFluxSession().then((s) =>
      call("POST", "/start-dispense", {
        session_id: s?.session_id,
        auto_close: true,
        ...params,
      })
    );
  },
  dispenseStatus: (command_id: number, pump: number) =>
    call("GET", `/dispense/${command_id}/status?pump=${pump}`),
  // 🆕 V2: Active dispenses listing — multi-pump зэрэг ажиллахад mini-dashboard-д
  // зориулагдсан endpoint. Flux backend дэмжээгүй бол {items: []} буцаана.
  activeDispenses: (): Promise<{ items: ActiveDispenseItem[] }> =>
    call("GET", `/active-dispenses`),
  finalize: (params: {
    transaction_id: number;
    payment_method: "cash" | "bank_card" | "qpay" | "fuel_card" | "invoice";
    vat_receipt_number: string;
    vat_type: "Иргэн" | "Бараа худалдан авагч" | "Байгууллага";
    vat_register?: string;
    card_id?: number;
    card_number?: string;
    bank_approval_code?: string;
    payment_lines?: Array<{
      method: "cash" | "bank_card" | "qpay" | "fuel_card" | "invoice";
      amount: number;
      card_id?: number;
      card_number?: string;
      bank_approval_code?: string;
      bank_rrn?: string;
      bank_masked_pan?: string;
      bank_terminal_id?: string;
    }>;
  }) => {
    return loadFluxSession().then((s) =>
      call("POST", "/finalize", { session_id: s?.session_id, ...params })
    );
  },
  voidTx: (transaction_id: number, reason: string) => {
    return loadFluxSession().then((s) =>
      call("POST", "/void", { session_id: s?.session_id, transaction_id, reason })
    );
  },
  // ----- HOLDS (Хүлээлгэх) -----
  holds: {
    save: (payload: any) => call("POST", "/holds", payload),
    list: () => call<{ items: Array<{ hold_id: string; user_email?: string; created_at: string; expires_at: string; payload: any }>; count: number }>("GET", "/holds"),
    remove: (hold_id: string) => call("DELETE", `/holds/${hold_id}`),
  },
};

export const FUEL_GRADE_LABELS: Record<number, string> = {
  1: "АИ-92",
  2: "АИ-95",
  3: "ДТ",
  4: "LPG",
};
