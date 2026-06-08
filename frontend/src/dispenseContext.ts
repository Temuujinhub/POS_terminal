// Multi-customer dispense context tracker.
//
// PROBLEM: Кассчин нэг pump дээр шахалт эхлүүлээд, шахалт дуустал хүлээхгүйгээр
// дараагийн pump дээр шинэ үйлчилгээ эхлүүлж болох ёстой. Шахалт нь олон pump
// дээр зэрэг ажиллана. Шахалт дуусахад нь автоматаар finalize хийгдэх ёстой.
//
// SOLUTION: Бид prepay flow-ийн VAT/payment context-ыг бүх command_id-аар нь
// AsyncStorage-д хадгалаад, Dashboard background-аар polling хийж, шахалт
// дуусахад autoFinalize-ийг ажиллуулна.

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "pending_dispense_contexts_v1";

export type DispenseContext = {
  command_id: number;
  pump: number;
  fuel_grade_id?: number;
  fuel_label?: string;
  dose_type: "Amount" | "Volume" | "FullTank";
  dose: number;
  // Prepay payment info
  payment_method: "cash" | "bank_card" | "qpay" | "fuel_card" | "split";
  prepaid_amount: number;
  bank_approval_code?: string;
  bank_rrn?: string;
  bank_masked_pan?: string;
  qpay_invoice_id?: string;
  qpay_payment_id?: string;
  // 🆕 Хуваан төлбөрийн дэлгэрэнгүй (split mode үед)
  splits?: Array<{
    method: "cash" | "bank_card" | "qpay" | "fuel_card";
    amount: number;
    approval_code?: string;
    rrn?: string;
    masked_pan?: string;
    qpay_invoice_id?: string;
  }>;
  // VAT info
  vat_type: "Иргэн" | "Бараа худалдан авагч" | "Байгууллага";
  vat_register?: string;
  vat_receipt_number: string;
  // Hold id (resume-ээс эхэлсэн бол)
  hold_id?: string | null;
  // Metadata
  started_at: number;
  finalized?: boolean; // true болсон бол autoFinalize амжилттай дуусаад устгана
};

type ContextMap = Record<string, DispenseContext>;

let _cache: ContextMap | null = null;

async function load(): Promise<ContextMap> {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch (_) {
    _cache = {};
  }
  return _cache!;
}

async function save(map: ContextMap) {
  _cache = map;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export const dispenseCtx = {
  /** Шинэ dispense эхлэхэд VAT/payment context-ыг хадгалах */
  async add(ctx: DispenseContext): Promise<void> {
    const map = await load();
    map[String(ctx.command_id)] = ctx;
    await save(map);
  },

  /** Бүх pending dispense-ийн context-уудыг авах */
  async list(): Promise<DispenseContext[]> {
    const map = await load();
    return Object.values(map).filter((c) => !c.finalized);
  },

  /** Command_id-аар context авах */
  async get(command_id: number): Promise<DispenseContext | null> {
    const map = await load();
    return map[String(command_id)] || null;
  },

  /** Шахалт дуусаад finalize-ийг тэмдэглэх */
  async markFinalized(command_id: number): Promise<void> {
    const map = await load();
    if (map[String(command_id)]) {
      map[String(command_id)].finalized = true;
      await save(map);
    }
  },

  /** Бүрэн устгах (3+ мин дууссан context-уудыг цэвэрлэх) */
  async remove(command_id: number): Promise<void> {
    const map = await load();
    delete map[String(command_id)];
    await save(map);
  },

  /** Хуучирсан (1 цагаас илүү байсан) context-уудыг цэвэрлэх */
  async cleanup(): Promise<void> {
    const map = await load();
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(map)) {
      const c = map[key];
      if (c.finalized || now - c.started_at > 60 * 60 * 1000) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) await save(map);
  },

  /** Pump number-аар лookup (нэг pump дээр идэвхтэй dispense байгаа эсэх) */
  async getByPump(pump: number): Promise<DispenseContext | null> {
    const list = await this.list();
    return list.find((c) => c.pump === pump) || null;
  },
};
