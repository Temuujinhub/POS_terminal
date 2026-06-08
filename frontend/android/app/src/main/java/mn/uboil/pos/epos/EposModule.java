package mn.uboil.pos.epos;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;

// Package names verified against EposOpenAPIv26_release.jar via `jar tf`
import mn.databank.eposopenapi.factory.EposTransAPIFactory;
import mn.databank.eposopenapi.factory.IEposTransAPI;
import mn.databank.eposopenapi.message.BaseRequest;
import mn.databank.eposopenapi.message.BaseResponse;
import mn.databank.eposopenapi.message.TransResponse;
import mn.databank.eposopenapi.message.SettleResponse;
import mn.databank.eposopenapi.message.TaskResponse;
import mn.databank.eposopenapi.message.HealthCheckMsg;
import mn.databank.eposopenapi.message.SaleNoReceiptMsg;
import mn.databank.eposopenapi.message.VoidCardNoReceiptMsg;
import mn.databank.eposopenapi.message.VoidNoReceiptMsg;
import mn.databank.eposopenapi.message.SettleNoReceiptMsg;
import mn.databank.eposopenapi.message.CheckTransMsg;
import mn.databank.eposopenapi.message.QpayPaymentMsg;
import mn.databank.eposopenapi.message.RFCardMsg;
import mn.databank.eposopenapi.message.ScanCodeMsg;
import mn.databank.eposopenapi.sdkconstants.SdkConstants;

@ReactModule(name = EposModule.NAME)
public class EposModule extends ReactContextBaseJavaModule implements ActivityEventListener {

    public static final String NAME = "EposModule";

    private IEposTransAPI eposTransAPI;
    private Promise pendingPromise;

    public EposModule(@NonNull ReactApplicationContext reactContext) {
        super(reactContext);
        reactContext.addActivityEventListener(this);
    }

    @Override
    public void initialize() {
        super.initialize();
        eposTransAPI = EposTransAPIFactory.createTransAPI();
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ──────────────────────────────────────────────────────────────────────────

    private boolean checkReady(Promise promise) {
        if (getCurrentActivity() == null) {
            promise.reject("NO_ACTIVITY", "Activity тодорхойлогдоогүй байна");
            return false;
        }
        if (pendingPromise != null) {
            promise.reject("BUSY", "Өөр гүйлгээ хийгдэж байна, түр хүлээнэ үү");
            return false;
        }
        return true;
    }

    // IEposTransAPI.startTrans takes (Context, BaseRequest)
    private void startTx(BaseRequest req, Promise promise) {
        pendingPromise = promise;
        try {
            eposTransAPI.startTrans((Context) getCurrentActivity(), req);
        } catch (Exception e) {
            pendingPromise = null;
            promise.reject("START_ERROR", e.getMessage());
        }
    }

    private static void ps(WritableMap m, String k, @Nullable String v) {
        if (v != null) m.putString(k, v);
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  Exposed transaction methods
    // ──────────────────────────────────────────────────────────────────────────

    @ReactMethod
    public void healthCheck(Promise promise) {
        if (!checkReady(promise)) return;
        HealthCheckMsg.Request req = new HealthCheckMsg.Request();
        req.setCategory(SdkConstants.CATEGORY_HEALTH_CHECK);
        startTx(req, promise);
    }

    /**
     * @param amount Amount in MNT — converted to mönggö (×100) internally
     */
    @ReactMethod
    public void sale(double amount, String dbRefNo, Promise promise) {
        if (!checkReady(promise)) return;
        SaleNoReceiptMsg.Request req = new SaleNoReceiptMsg.Request();
        req.setAmount(Math.round(amount * 100));  // setAmount(long) — SDK uses mönggö
        req.setDbRefNo(dbRefNo);
        req.setCategory(SdkConstants.CATEGORY_SALE_NO_RECEIPT);
        startTx(req, promise);
    }

    /** Void with card tap (no trace number needed) */
    @ReactMethod
    public void voidCard(String dbRefNo, Promise promise) {
        if (!checkReady(promise)) return;
        VoidCardNoReceiptMsg.Request req = new VoidCardNoReceiptMsg.Request();
        req.setDbRefNo(dbRefNo);
        req.setCategory(SdkConstants.CATEGORY_VOID_CARD_NO_RECEIPT);
        startTx(req, promise);
    }

    /** Void by original trace number */
    @ReactMethod
    public void voidByTrace(String traceNo, String dbRefNo, Promise promise) {
        if (!checkReady(promise)) return;
        VoidNoReceiptMsg.Request req = new VoidNoReceiptMsg.Request();
        req.setTraceNo(traceNo);   // setTraceNo(String) — confirmed in JAR
        req.setDbRefNo(dbRefNo);
        req.setCategory(SdkConstants.CATEGORY_VOID_NO_RECEIPT);
        startTx(req, promise);
    }

    @ReactMethod
    public void settlement(String terminalId, String dbRefNo, Promise promise) {
        if (!checkReady(promise)) return;
        SettleNoReceiptMsg.Request req = new SettleNoReceiptMsg.Request();
        req.setTerminalId(terminalId);
        req.setDbRefNo(dbRefNo);
        req.setCategory(SdkConstants.CATEGORY_SETTLE_NO_RECEIPT);
        startTx(req, promise);
    }

    @ReactMethod
    public void checkTrans(String dbRefNo, Promise promise) {
        if (!checkReady(promise)) return;
        CheckTransMsg.Request req = new CheckTransMsg.Request();
        req.setDbRefNo(dbRefNo);
        req.setCategory(SdkConstants.CATEGORY_CHECK_TRANS);
        startTx(req, promise);
    }

    /**
     * @param amount Amount in MNT — converted to mönggö (×100) internally
     */
    @ReactMethod
    public void qpay(double amount, String dbRefNo, Promise promise) {
        if (!checkReady(promise)) return;
        QpayPaymentMsg.Request req = new QpayPaymentMsg.Request();
        req.setAmount(Math.round(amount * 100));
        req.setDbRefNo(dbRefNo);
        req.setCategory(SdkConstants.CATEGORY_QPAY_PAYMENT);
        startTx(req, promise);
    }

    @ReactMethod
    public void readRfCard(Promise promise) {
        if (!checkReady(promise)) return;
        RFCardMsg.Request req = new RFCardMsg.Request();
        req.setCategory(SdkConstants.CATEGORY_READ_RF_CARD);
        startTx(req, promise);
    }

    @ReactMethod
    public void scanCode(int cameraType, Promise promise) {
        if (!checkReady(promise)) return;
        ScanCodeMsg.Request req = new ScanCodeMsg.Request();
        req.setCameraType(cameraType);   // setCameraType(Integer) — takes boxed Integer
        req.setCategory(SdkConstants.CATEGORY_SCAN_CODE);
        startTx(req, promise);
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  onActivityResult — SDK хариу боловсруулах
    // ──────────────────────────────────────────────────────────────────────────

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, @Nullable Intent data) {
        if (pendingPromise == null || eposTransAPI == null) return;

        BaseResponse base;
        try {
            base = eposTransAPI.onResult(requestCode, resultCode, data);
        } catch (Exception e) {
            Promise p = pendingPromise;
            pendingPromise = null;
            p.reject("RESULT_ERROR", e.getMessage());
            return;
        }

        // onResult returns null when the result doesn't belong to the EPOS SDK
        if (base == null) return;

        Promise p = pendingPromise;
        pendingPromise = null;

        WritableMap out = Arguments.createMap();

        // BaseResponse fields (available on all response types)
        // getRspCode() returns int: 0 = success
        out.putInt("rspCode",  base.getRspCode());
        out.putString("rspMsg", base.getRspMsg() != null ? base.getRspMsg() : "");
        ps(out, "prgName", base.getPrgName());
        ps(out, "appId",   base.getAppId());

        if (base instanceof TransResponse) {
            // Sale, Void, VoidCard, CheckTrans, HealthCheck responses all extend TransResponse
            TransResponse t = (TransResponse) base;
            out.putInt("commandType",  t.getCommandType());
            ps(out, "sdkVersion",      t.getSdkVersion());
            ps(out, "eposVersion",     t.getEposVersion());
            ps(out, "merchantName",    t.getMerchantName());
            ps(out, "merchantId",      t.getMerchantId());
            ps(out, "terminalId",      t.getTerminalId());
            ps(out, "cardNo",          t.getCardNo());
            out.putInt("cardType",     t.getCardType());  // int constant (MAG=1, ICC=2, PICC=3...)
            ps(out, "amount",          t.getAmount());
            ps(out, "authCode",        t.getAuthCode());
            ps(out, "refNo",           t.getRefNo());     // Retrieval Reference Number (RRN)
            ps(out, "transTime",       t.getTransTime()); // String — no .toString() needed
            ps(out, "dbRefNo",         t.getDbRefNo());
            // getEntry_mode_text() — underscore in method name, confirmed in JAR
            ps(out, "entryModeText",   t.getEntry_mode_text());
            ps(out, "issuerName",      t.getIssuerName());
            ps(out, "transactionNo",   t.getTransactionNo());
            ps(out, "tradeNo",         t.getTradeNo());
            ps(out, "transactionType", t.getTransactionType());
            ps(out, "origAuthNo",      t.getOrigAuthNo());
            ps(out, "origTraceNo",     t.getOrigTraceNo());
            ps(out, "origRefNo",       t.getOrigRefNo());
            ps(out, "origTransTime",   t.getOrigTransTime());
            ps(out, "cashbackAmount",  t.getCashbackAmount());
            ps(out, "fee",             t.getFee());
            ps(out, "jsonRet",         t.getJsonRet());
            ps(out, "hasLoyalty",      t.getHasLoyalty());
            ps(out, "noTxnAmount",     t.getNoTxnAmount());
            ps(out, "yesTxnAmount",    t.getYesTxnAmount());
            ps(out, "usableLp",        t.getUsableLp());
            ps(out, "loyaltyProviderName", t.getLoyaltyProviderName());
            out.putDouble("traceNo",   (double) t.getTraceNo());
            out.putDouble("batchNo",   (double) t.getBatchNo());

        } else if (base instanceof SettleResponse) {
            // Settlement response — own hierarchy, no commandType/sdkVersion
            SettleResponse s = (SettleResponse) base;
            ps(out, "terminalId",      s.getTerminalId());
            ps(out, "merchantId",      s.getMerchantId());
            ps(out, "batchNo",         s.getBatchNo());
            ps(out, "dbRefNo",         s.getDbRefNo());
            ps(out, "date",            s.getDate());
            ps(out, "time",            s.getTime());
            ps(out, "startDate",       s.getStartDate());
            ps(out, "endDate",         s.getEndDate());
            ps(out, "saleCount",       s.getSaleCount());
            ps(out, "saleTotal",       s.getSaleTotal());
            ps(out, "voidCount",       s.getVoidCount());
            ps(out, "voidTotal",       s.getVoidTotal());
            ps(out, "qpayCount",       s.getQpayCount());
            ps(out, "qpayTotal",       s.getQpayTotal());
            ps(out, "passSaleCount",   s.getPassSaleCount());
            ps(out, "passSaleTotal",   s.getPassSaleTotal());
            ps(out, "passVoidCount",   s.getPassVoidCount());
            ps(out, "passVoidTotal",   s.getPassVoidTotal());

        } else if (base instanceof TaskResponse) {
            // RFCard, ScanCode responses
            TaskResponse t = (TaskResponse) base;
            out.putInt("commandType",  t.getCommandType());
            ps(out, "sdkVersion",      t.getSdkVersion());
            ps(out, "eposVersion",     t.getEposVersion());
            ps(out, "qrCode",          t.getQrCode());
            ps(out, "dbRefNo",         t.getDbRefNo());
            ps(out, "jsonRet",         t.getJsonRet());
            out.putInt("cameraType",   t.getCameraType());
        }
        // QpayPaymentMsg.Response extends BaseResponse directly — only base fields above

        if (base.getRspCode() == 0) {
            p.resolve(out);
        } else {
            p.reject(
                String.valueOf(base.getRspCode()),
                base.getRspMsg() != null ? base.getRspMsg() : "Гүйлгээ амжилтгүй",
                out
            );
        }
    }

    @Override
    public void onNewIntent(Intent intent) {}
}
