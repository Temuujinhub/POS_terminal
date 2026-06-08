/**
 * eposNative.ts — Databank EPOS SDK v26 native module bridge
 *
 * Wraps the Java EposModule registered via the withEposSDK config plugin.
 * Returns the same PaxResult shape used by the rest of the app so existing
 * screens work without changes.
 *
 * Types verified against EposOpenAPIv26_release.jar via `javap`.
 *
 * Note on amounts:
 *   All amount parameters are in MNT (whole tugrik).
 *   The Java layer converts to mönggö (×100) before calling the SDK.
 */

import { NativeModules, Platform } from 'react-native';
import type { PaxResult } from './paxPayment';

const { EposModule } = NativeModules as {
  EposModule: EposNativeInterface | undefined;
};

// ─── Raw shapes from EposModule.java ─────────────────────────────────────────

/** Fields present on every response (BaseResponse) */
interface EposBaseRaw {
  rspCode: number;   // int: 0 = success
  rspMsg: string;
  prgName?: string;
  appId?: string;
}

/** TransResponse fields (Sale, Void, VoidCard, CheckTrans, HealthCheck) */
interface EposTransRaw extends EposBaseRaw {
  commandType?: number;
  sdkVersion?: string;
  eposVersion?: string;
  merchantName?: string;
  merchantId?: string;
  terminalId?: string;
  cardNo?: string;
  cardType?: number;     // int: TransResponse.MAG=1, ICC=2, PICC=3, MANUAL=4, QR=6
  amount?: string;
  authCode?: string;
  refNo?: string;        // Retrieval Reference Number (RRN)
  transTime?: string;
  dbRefNo?: string;
  entryModeText?: string;
  issuerName?: string;
  transactionNo?: string;
  tradeNo?: string;
  transactionType?: string;
  origAuthNo?: string;
  origTraceNo?: string;
  origRefNo?: string;
  origTransTime?: string;
  cashbackAmount?: string;
  fee?: string;
  jsonRet?: string;
  hasLoyalty?: string;
  noTxnAmount?: string;
  yesTxnAmount?: string;
  usableLp?: string;
  loyaltyProviderName?: string;
  traceNo?: number;      // long → double in JS
  batchNo?: number;
}

/** SettleResponse fields (Settlement) */
interface EposSettleRaw extends EposBaseRaw {
  terminalId?: string;
  merchantId?: string;
  batchNo?: string;
  dbRefNo?: string;
  date?: string;
  time?: string;
  startDate?: string;
  endDate?: string;
  saleCount?: string;
  saleTotal?: string;
  voidCount?: string;
  voidTotal?: string;
  qpayCount?: string;
  qpayTotal?: string;
  passSaleCount?: string;
  passSaleTotal?: string;
  passVoidCount?: string;
  passVoidTotal?: string;
}

/** TaskResponse fields (RFCard, ScanCode) */
interface EposTaskRaw extends EposBaseRaw {
  commandType?: number;
  sdkVersion?: string;
  eposVersion?: string;
  qrCode?: string;
  dbRefNo?: string;
  jsonRet?: string;
  cameraType?: number;
}

type EposRawResponse = EposTransRaw | EposSettleRaw | EposTaskRaw;

// ─── Native interface ──────────────────────────────────────────────────────────

interface EposNativeInterface {
  healthCheck(): Promise<EposRawResponse>;
  sale(amount: number, dbRefNo: string): Promise<EposRawResponse>;
  voidCard(dbRefNo: string): Promise<EposRawResponse>;
  voidByTrace(traceNo: string, dbRefNo: string): Promise<EposRawResponse>;
  settlement(terminalId: string, dbRefNo: string): Promise<EposRawResponse>;
  checkTrans(dbRefNo: string): Promise<EposRawResponse>;
  qpay(amount: number, dbRefNo: string): Promise<EposRawResponse>;
  readRfCard(): Promise<EposRawResponse>;
  scanCode(cameraType: number): Promise<EposRawResponse>;
}

// ─── Availability ──────────────────────────────────────────────────────────────

export function isEposNativeModuleAvailable(): boolean {
  return Platform.OS === 'android' && EposModule != null;
}

// ─── Card type constants (matches TransResponse static fields) ─────────────────

export const EPOS_CARD_TYPE = {
  NO_CARD: 0,
  MAG:     1,
  ICC:     2,
  PICC:    3,
  MANUAL:  4,
  FALLBACK: 5,
  QR:      6,
} as const;

// ─── Normalise raw response → PaxResult ───────────────────────────────────────

function toResult(raw: EposRawResponse): PaxResult {
  const ok = raw.rspCode === 0;
  const t = raw as EposTransRaw;
  return {
    ok,
    approval_code:   t.authCode,
    rrn:             t.refNo,
    trace_no:        t.traceNo != null ? String(t.traceNo) : undefined,
    batch_no:        t.batchNo != null ? String(t.batchNo) : undefined,
    masked_pan:      t.cardNo,
    card_type:       t.cardType != null ? String(t.cardType) : undefined,
    entry_mode:      t.entryModeText,
    terminal_id:     t.terminalId ?? (raw as EposSettleRaw).terminalId,
    merchant_id:     t.merchantId ?? (raw as EposSettleRaw).merchantId,
    merchant_name:   t.merchantName,
    rsp_code:        String(raw.rspCode),
    rsp_msg:         raw.rspMsg,
    amount:          t.amount,
    trans_time:      t.transTime,
    raw,
    error:           ok ? undefined : raw.rspMsg || String(raw.rspCode),
  };
}

function handleError(e: any): PaxResult {
  const code: string = e?.code ?? 'EPOS_ERROR';
  const msg: string  = e?.message ?? 'Гүйлгээ амжилтгүй';
  const raw = e?.userInfo as EposRawResponse | undefined;
  return { ok: false, rsp_code: code, rsp_msg: msg, error: msg, raw };
}

function requireModule(): EposNativeInterface {
  if (!isEposNativeModuleAvailable()) {
    throw new Error(
      'EposModule native module байхгүй байна. ' +
      'Android build дээр ажиллаж байгаа эсэхийг шалгана уу.'
    );
  }
  return EposModule!;
}

// ─── Settlement-specific result type ──────────────────────────────────────────

export type SettleResult = PaxResult & {
  saleCount?: string;
  saleTotal?: string;
  voidCount?: string;
  voidTotal?: string;
  qpayCount?: string;
  qpayTotal?: string;
  date?: string;
  time?: string;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** HEALTH_CHECK — терминал бэлэн эсэхийг шалгах */
export async function eposHealthCheck(): Promise<PaxResult> {
  try {
    return toResult(await requireModule().healthCheck());
  } catch (e) {
    return handleError(e);
  }
}

/**
 * SALE — картаар төлбөр авах
 * @param amount  Төлбөрийн дүн MNT-ээр (жишээ нь 5000)
 * @param dbRefNo Дотоод лавлах дугаар
 */
export async function eposSale(amount: number, dbRefNo: string): Promise<PaxResult> {
  try {
    return toResult(await requireModule().sale(amount, dbRefNo));
  } catch (e) {
    return handleError(e);
  }
}

/**
 * VOID_CARD — карт дахин тавиад буцаалт
 * @param dbRefNo Эх гүйлгээний dbRefNo
 */
export async function eposVoidCard(dbRefNo: string): Promise<PaxResult> {
  try {
    return toResult(await requireModule().voidCard(dbRefNo));
  } catch (e) {
    return handleError(e);
  }
}

/**
 * VOID — trace дугаараар буцаалт
 * @param traceNo Эх гүйлгээний trace_no (PaxResult.trace_no утга)
 * @param dbRefNo Шинэ дотоод лавлах дугаар
 */
export async function eposVoidByTrace(traceNo: string, dbRefNo: string): Promise<PaxResult> {
  try {
    return toResult(await requireModule().voidByTrace(traceNo, dbRefNo));
  } catch (e) {
    return handleError(e);
  }
}

/**
 * SETTLE — өдрийн тооцоо хаах
 * @param terminalId EPOS терминалын ID
 * @param dbRefNo    Дотоод лавлах дугаар
 */
export async function eposSettlement(terminalId: string, dbRefNo: string): Promise<SettleResult> {
  try {
    const raw = await requireModule().settlement(terminalId, dbRefNo);
    const s = raw as EposSettleRaw;
    return {
      ...toResult(raw),
      saleCount: s.saleCount,
      saleTotal: s.saleTotal,
      voidCount: s.voidCount,
      voidTotal: s.voidTotal,
      qpayCount: s.qpayCount,
      qpayTotal: s.qpayTotal,
      date:      s.date,
      time:      s.time,
    };
  } catch (e) {
    return handleError(e);
  }
}

/**
 * CHECK_TRANS — гүйлгээний төлөв шалгах
 * @param dbRefNo Шалгах гүйлгээний dbRefNo
 */
export async function eposCheckTrans(dbRefNo: string): Promise<PaxResult> {
  try {
    return toResult(await requireModule().checkTrans(dbRefNo));
  } catch (e) {
    return handleError(e);
  }
}

/**
 * QPAY — QPay QR-кодоор төлбөр авах
 * @param amount  Төлбөрийн дүн MNT-ээр
 * @param dbRefNo Дотоод лавлах дугаар
 */
export async function eposQpay(amount: number, dbRefNo: string): Promise<PaxResult> {
  try {
    return toResult(await requireModule().qpay(amount, dbRefNo));
  } catch (e) {
    return handleError(e);
  }
}

/** READ_RF_CARD — NFC картны мэдээлэл унших */
export async function eposReadRfCard(): Promise<PaxResult> {
  try {
    return toResult(await requireModule().readRfCard());
  } catch (e) {
    return handleError(e);
  }
}

/**
 * SCAN_CODE — QR / barcode уншигч нээх
 * @param cameraType 0 = арын камер (SdkConstants.REAR), 1 = урд камер (SdkConstants.FRONT)
 */
export async function eposScanCode(cameraType = 0): Promise<PaxResult> {
  try {
    return toResult(await requireModule().scanCode(cameraType));
  } catch (e) {
    return handleError(e);
  }
}
