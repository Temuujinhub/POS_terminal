# Flux Monitor — POS Terminal Android App API Reference

This document describes the HTTP API the **Android POS terminal app**
must consume to talk to the Flux Monitor backend running at
`https://uboil.flux.mn`. Read it end-to-end before writing code; the
sample workflow at the bottom is the same flow the real cashier will
follow on the device.

> Document version: 2026-05-19
> Backend branch deployed: `claude/fix-nozzle-pump-issue-JFqj1`
> Audience: Android (Kotlin) developer

> **What's new in 2026-05-19** — pumps no longer hang in "busy" for
> several minutes after a sale finalises. The backend now sends a
> `PumpCloseTransaction` jsonPTS request to the PTS-2 as part of
> `/api/pos/finalize`, so the next customer can fuel within seconds
> instead of waiting for the controller's internal EOT timer. The
> `/api/pos/pumps` response gained a new `ended` status (see §4) and
> dropped the legacy "EOT == busy" overload. See §14 for the full
> background.

---

## 1. Base setup

| | |
|---|---|
| **Production base URL** | `https://uboil.flux.mn` |
| **API prefix** | `/api` |
| **Auth scheme** | `Authorization: Bearer <jwt>` on every request except `/api/auth/*` |
| **Content type** | `application/json; charset=utf-8` |
| **Min Android API** | 26 (Android 8.0) |
| **NFC** | Built-in `android.nfc` API; tags returned **uppercase hex** without spaces |

All examples below use `curl` so they're easy to verify from a laptop
or Postman before wiring into Retrofit.

### Error response shape

Every 4xx/5xx returns:

```json
{ "detail": "Human-readable Mongolian/English error message" }
```

Some validation errors come back as a list (FastAPI default):

```json
{ "detail": [{ "loc": ["body","fuel_type"], "msg": "field required", "type": "value_error.missing" }] }
```

The app should display `detail` if it's a string, and a generic
"Алдаа гарлаа" if it's a list — the device cashier doesn't need the
field path.

---

## 2. Authentication

### 2.1 Attendant NFC login

The attendant taps their employee NFC card on the device's reader.
The app reads the hex tag and POSTs it.

```
POST /api/auth/pos-nfc-login
Content-Type: application/json

{
  "nfc_tag": "04A1B2C3D4E5F6",
  "device_id": "TPS320-SN-12345",      // optional, free-form
  "station_id": 10                      // optional override
}
```

**Success** → `200`:

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "expires_in": 43200,
  "user_id": 7,
  "full_name": "Б.Дорж",
  "role": "attendant",
  "station_id": 10,
  "station_name": "UB OIL Станц #1"
}
```

**Errors**:
- `401 NFC карт танигдсангүй эсвэл идэвхгүй ажилтан` — tag isn't bound to a user, or `is_active=false`
- `403 Энэ POS төхөөрөмж дээр нэвтрэх эрхгүй ажилтан` — role is `super_admin` (web-only)

**Token lifetime**: 12 hours, so the attendant rarely re-auths during
a shift. Store in encrypted DataStore. On 401 from any later call,
re-prompt for NFC.

### 2.2 Attendant onboarding (one-time, web side)

The web admin creates the attendant user and writes their NFC tag
through the `/users` page (or temporarily via SQL):

```sql
UPDATE users SET nfc_tag = '04A1B2C3D4E5F6' WHERE email = 'dorj@uboil.mn';
```

The hex tag must be **uppercase**, no spaces, no `0x` prefix,
4–48 chars. The same value the Android NFC API returns from
`Tag.id.toHexString().uppercase()`.

### 2.3 Authenticated request example

```
GET /api/pos/pumps?station_id=10
Authorization: Bearer eyJhbGciOi...
```

---

## 3. Customer card lookup

The cashier scans the customer's loyalty / corporate fuel card.

```
POST /api/pos/lookup-card
Authorization: Bearer ...
Content-Type: application/json

{ "nfc_tag": "F1E2D3C4B5A6" }
```

**Success** when card exists:

```json
{
  "found": true,
  "card_id": 42,
  "card_number": "FC-2026-0001",
  "holder_name": "Шуудан ХХК",
  "card_type": "corporate",                 // 'loyalty' | 'corporate' | 'attendant'
  "discount_percent": 0.0,                  // > 0 only for loyalty
  "balance": 250000.0,                      // > 0 for corporate (₮)
  "is_active": true,
  "allowed_fuel_grade_ids": [1, 3],         // empty = all grades allowed
  "company_name": "Монгол Шуудан ХХК",
  "department": "Тээврийн алба",
  "vehicle_number": "УБА-1234"
}
```

**Card not found**:

```json
{ "found": false }
```

When `found=false`, the app should fall back to a "no card" sale flow
(plain bank-card or cash payment). When `found=true` but
`is_active=false`, show an error and refuse the sale.

### Card type behaviour

| `card_type` | App behaviour |
|---|---|
| `loyalty` | Apply `discount_percent` to per-litre price; payment can be cash / bank card / QPay |
| `corporate` | Pre-paid balance: deduct `total_amount` from `balance` at finalize. Bank card not required |
| `attendant` | Internal staff card — not used for customer purchases on POS |

### Fuel-grade allowlist

If `allowed_fuel_grade_ids` is **non-empty**, the app must reject
pumps whose nozzle is for a different grade. The mapping is
station-specific but the typical UB OIL convention is:

| ID | Mongolian | English |
|---|---|---|
| 1 | АИ-92 | Petrol AI-92 |
| 2 | АИ-95 | Petrol AI-95 |
| 3 | ДТ | Diesel |
| 4 | LPG | LPG |

---

## 4. Live pump grid

After scanning the card, show the attendant a grid of pumps. Refresh
every 2–3 seconds while the screen is visible.

```
GET /api/pos/pumps?station_id=10
Authorization: Bearer ...
```

Response (one entry per physical pump the controller knows about):

```json
[
  { "pump_number": 1, "nozzle": null, "status": "idle",     "last_fuel_grade": null,    "last_fuel_grade_id": null },
  { "pump_number": 2, "nozzle": 1,    "status": "ready",    "last_fuel_grade": "АИ-92", "last_fuel_grade_id": 1    },
  { "pump_number": 3, "nozzle": null, "status": "busy",     "last_fuel_grade": "ДТ",    "last_fuel_grade_id": 3    },
  { "pump_number": 4, "nozzle": null, "status": "ended",    "last_fuel_grade": "АИ-92", "last_fuel_grade_id": 1    },
  { "pump_number": 5, "nozzle": null, "status": "offline",  "last_fuel_grade": null,    "last_fuel_grade_id": null }
]
```

| `status` | Meaning | Suggested Mongolian label | Tap allowed? |
|---|---|---|---|
| `ready` | Idle and a nozzle is lifted (хошуу сугалсан) | "Хошуу авсан" | **Yes** — authorise |
| `idle` | Idle, no nozzle lifted | "Идэвхгүй" | No — wait for customer |
| `busy` | Actively dispensing (PTS-2 `FillingStatus`) | "Шахаж байна" | No — already in use |
| `ended` | Finished dispensing, awaiting close (PTS-2 `EndOfTransactionStatus`) | "Дуусаж байна" | No — transient (~5–15 s) |
| `offline` | Controller doesn't see this pump | "Холбоо алга" | No — cannot fuel |

The app should grey out pumps that aren't `ready` and only let the
cashier tap a `ready` pump.

> **`ended` is new in 2026-05-19.** Previously the backend folded
> EndOfTransactionStatus into `busy`, which made cashiers think the
> pump was still filling. EOT now has its own status. The state is
> transient — the backend queues `PumpCloseTransaction` automatically
> as part of `/api/pos/finalize`, so within a single PTS-2 upload
> cycle the pump transitions to `idle` (or `ready` if the next
> customer's nozzle is already up). See §14 for the timing details.

---

## 5. Start dispense

```
POST /api/pos/start-dispense
Authorization: Bearer ...
Content-Type: application/json

{
  "station_id": 10,
  "pump": 2,
  "nozzle": 1,                       // OR fuel_grade_id, at least one required
  "fuel_grade_id": 1,                // optional if nozzle is set
  "dose_type": "Amount",             // 'Amount' | 'Volume' | 'FullTank'
  "dose": 50000,                     // ₮ when Amount, litres when Volume, ignored for FullTank
  "auto_close": true,
  "card_id": 42,                     // present iff customer presented a card
  "nfc_tag": "F1E2D3C4B5A6"          // optional, helps PTS-2 audit
}
```

**Success** → `200`:

```json
{
  "command_id": 31,
  "pump": 2,
  "expected_pickup_seconds": 30,
  "message": "Команд queue-д орлоо. Pump 1-30 сек дотор асна.",
  "locked_amount": 50000,            // funds locked from corporate card balance
  "card_balance_after_lock": 200000  // null for non-corporate
}
```

**Errors**:
- `400 dose_type нь Amount | Volume | FullTank`
- `400 nozzle эсвэл fuel_grade_id-г оруулна уу`
- `402 Картын үлдэгдэл хүрэлцэхгүй (250000 ₮)` — corporate balance < dose
- `403 Карт идэвхгүй`
- `404 Энэ станцад идэвхтэй PTS-2 контроллер олдсонгүй`

**Behaviour**:
- Server queues a `PumpAuthorize` command for the PTS-2 controller. PTS-2 picks it up on its next status cycle (typically 1–10 s) and starts the pump.
- For corporate cards, the dose amount is **locked** (deducted from balance) immediately so concurrent sales can't overspend.
- On finalize the lock is true-up'd: actual fill amount may be smaller (refund) or larger (extra debit) than the lock.
- If the customer never finishes (lifts nozzle, doesn't squeeze) the lock remains until void or admin adjustment.

Save the `command_id` — you need it for the next call.

### `dose_type` semantics

| Value | `dose` field | Cashier UI label |
|---|---|---|
| `Amount` | Money in tugrik (most common) | "Дүн" — 50000 ₮ |
| `Volume` | Litres | "Литр" — 20.0 л |
| `FullTank` | (ignored) | "Бак дүүртэл" |

---

## 6. Poll dispense status

After `start-dispense`, poll this endpoint **every 1.5–2 seconds**
until you see `"status": "completed"` or `"failed"`. Stop polling if
the screen is closed.

```
GET /api/pos/dispense/{command_id}/status?pump=2&station_id=10
Authorization: Bearer ...
```

Response evolves through these states:

```json
{ "status": "pending",     "transaction": null, ... }
{ "status": "sent",        "transaction": null, "sent_at": "2026-05-01T12:00:01Z", ... }
{ "status": "acknowledged","transaction": null, "acknowledged_at": "...", ... }
{ "status": "filling",     "transaction": null, ... }
{ "status": "ended",       "transaction": null, ... }
{ "status": "completed",   "transaction": { "id": 1234, "fuel_type": "petrol", "volume_liters": 16.95, "unit_price": 2950, "total_amount": 50000, ... }, ... }
{ "status": "failed",      "error_message": "JSONPTS_ERROR_PUMP_BUSY", ... }
```

When `status="completed"`, save `transaction.id` — that's what you
pass to `/finalize`.

| `status` | UI behaviour |
|---|---|
| `pending` / `sent` / `acknowledged` | "Команд илгээгдлээ, шахалт эхлэхийг хүлээж байна" |
| `filling` | "Шахаж байна" + live volume/amount from `transaction` if present |
| `ended` | "Шахалт дууслаа, гүйлгээ бүртгэж байна…" — pump hung up the nozzle, awaiting `PumpTransactionInformation` (usually <1 s; max 5 s) |
| `completed` | Show summary and prompt for payment |
| `failed` | Show `error_message` |

**Timeouts**:
- A normal fill takes 30–120 s. Stop polling and raise an error after **5 min** with no transition past `acknowledged`.
- Show "Шахалт эхэлсэн" once you see `acknowledged` or `filling`.
- Show the live volume/amount from `transaction` once `completed`.
- `ended` is a brief intermediate state — keep polling, do not show an error.

---

## 7. Finalize transaction

After the customer pays (cash / card / QPay / corporate balance) and
the eBarimt module on the device prints the VAT receipt, send:

```
POST /api/pos/finalize
Authorization: Bearer ...
Content-Type: application/json

{
  "transaction_id": 1234,
  "payment_method": "bank_card",         // cash | bank_card | qpay | fuel_card | invoice
  "card_id": null,                       // present iff fuel_card payment OR customer card linked
  "card_number": "**** **** **** 1234",  // masked PAN for bank card / QPay phone
  "bank_approval_code": "AUTH123456",    // EMV/QPay approval, optional for cash
  "vat_receipt_number": "ДДТД2026050000123",
  "vat_type": "Иргэн",                   // "Иргэн" | "Бараа худалдан авагч" | "Байгууллага"
  "vat_register": "УУ12345678"           // person / company register, blank for "Иргэн" no-receipt
}
```

**Payment method mapping**:

| `payment_method` | When to use |
|---|---|
| `cash` | Бэлэн төгрөг |
| `bank_card` | EMV / contactless bank card via local SDK |
| `qpay` | QPay QR code scanned & confirmed |
| `fuel_card` | Corporate balance card (charges from `card_id`) |
| `invoice` | Бэлэн бус нэхэмжлэхээр (post-paid) |

**Success** → `200`:

```json
{
  "transaction_id": 1234,
  "payment_method": "bank_card",
  "card_id": null,
  "card_number": "**** **** **** 1234",
  "total_amount": 50000,
  "volume_liters": 16.95,
  "fuel_type": "petrol",
  "bank_approval_code": "AUTH123456",
  "vat_receipt_number": "ДДТД2026050000123",
  "vat_type": "Иргэн",
  "vat_register": "УУ12345678",
  "pos_finalized_at": "2026-05-01T12:05:30Z",
  "message": "Гүйлгээ амжилттай finalize хийгдлээ"
}
```

**Errors**:
- `400 Unknown payment_method '...'`
- `404 Гүйлгээ олдсонгүй`
- `409 Гүйлгээ аль хэдийн finalize хийгдсэн байна` — guard against double-finalize on retry

The server will:
1. Stamp payment_method, bank_approval_code, vat_* on the transaction
2. For `fuel_card` payments on corporate cards, **true up** the locked balance against the actual fill (refund overlock, debit underlock)
3. Tag any pending `card_balance_movements` with the real `transaction_id` so the audit join works
4. Queue a `PumpCloseTransaction` jsonPTS request (R137 §124) so the PTS-2 releases the pump from `EndOfTransactionStatus` (R137 §114). Without this the controller holds the pump in EOT until its internal timer fires — observed at ~3 minutes on the bundled simulator — blocking the next sale.

The `PumpCloseTransaction` is queued, not sent synchronously, so the
`/finalize` response returns immediately. The PTS-2 picks the command
up on its next jsonPTS upload (typically 1–5 seconds), processes it,
and the next `UploadStatus` reports the pump back in `IdleStatus` /
`PumpIdleStatus`. End-to-end the pump returns to `ready`/`idle` on
`/api/pos/pumps` within ~5–15 seconds of `/finalize` returning 200.

### eBarimt receipt source

The POS device's TaxApp / eBarimt module issues the receipt locally
and returns the receipt number to your app. **Do not** call any
flux.mn API to issue receipts — the server only stores the number for
reporting.

The `vat_type` values to use match the eBarimt SDK:
- `Иргэн` — citizen, no register
- `Бараа худалдан авагч` — citizen with register (РД)
- `Байгууллага` — organization (РТД)

---

## 8. Voiding a transaction

If the receipt fails to print, the customer disputes, or the cashier
needs to redo the sale, void it:

```
POST /api/transactions/{id}/void
Authorization: Bearer ...
Content-Type: application/json

{ "reason": "Баримт хэвлэгдээгүй" }
```

Response:

```json
{
  "id": 1234,
  "voided_at": "2026-05-01T12:10:00Z",
  "voided_by_id": 7,
  "void_reason": "Баримт хэвлэгдээгүй",
  "refunded_to_card": 50000        // 0 if not paid by corporate card
}
```

Server side:
- Sets `voided_at`, preserves the row (soft delete) for audit
- For corporate-card payments, automatically credits the card and writes a `void_refund` movement
- Reports filter on `voided_at IS NULL` so the void no longer counts toward sales

**Errors**:
- `404 Гүйлгээ олдсонгүй`
- `409 Гүйлгээ аль хэдийн цуцлагдсан`
- `403 Энэ станцын гүйлгээг та цуцлах эрхгүй`

---

## 9. Error & retry policy

| HTTP code | Meaning | App action |
|---|---|---|
| `200` | OK | Continue |
| `201` | Created | Continue |
| `400` | Bad request | Show `detail` in a toast; let cashier fix input |
| `401` | Token expired/invalid | Re-prompt for NFC login, retry once |
| `402` | Insufficient balance | Show "Балaнс хүрэлцэхгүй", let cashier pick another payment method |
| `403` | Permission / inactive | Hard error; sale cannot continue |
| `404` | Resource not found | Refresh list, retry |
| `409` | Conflict (already finalised, already voided) | Treat as success on idempotent retries |
| `500` / `502` / `503` | Server problem | Retry with exponential backoff (1s, 2s, 4s, max 3) before giving up |

Network errors (no HTTP response): retry **only on idempotent GET**
(pump list, dispense status, lookup-card). Never retry POSTs blindly
— at worst the cashier should see "Холбоо тасарлаа, дахин оролдоно уу"
and decide manually.

---

## 10. End-to-end test walkthrough

The following commands let you verify the full flow without an
Android device. Run them on a Linux/macOS terminal with a JWT in
`$TOKEN`.

### 10.1 Get a token

Web user with role `attendant` is the simplest:

```bash
curl -s -X POST https://uboil.flux.mn/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"attendant@uboil.mn","password":"changeme"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])'
```

Or test the NFC path (must seed a tag first via SQL — see §2.2):

```bash
TOKEN=$(curl -s -X POST https://uboil.flux.mn/api/auth/pos-nfc-login \
  -H 'Content-Type: application/json' \
  -d '{"nfc_tag":"04A1B2C3D4E5F6"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
```

### 10.2 Seed a test customer card

Via `/fuel-cards` web UI, or directly:

```bash
curl -X POST https://uboil.flux.mn/api/fuel-cards \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "card_number":"TEST-0001",
    "holder_name":"Тест Хэрэглэгч",
    "card_type":"corporate",
    "nfc_tag":"AA11BB22CC33",
    "balance":200000,
    "allowed_fuel_grade_ids":[1,3]
  }'
```

### 10.3 Top up

```bash
curl -X POST https://uboil.flux.mn/api/pos/cards/<CARD_ID>/topup \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount":100000,"notes":"Test topup"}'
```

### 10.4 Lookup

```bash
curl -X POST https://uboil.flux.mn/api/pos/lookup-card \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nfc_tag":"AA11BB22CC33"}'
```

### 10.5 Pumps

```bash
curl "https://uboil.flux.mn/api/pos/pumps?station_id=10" \
  -H "Authorization: Bearer $TOKEN"
```

### 10.6 Start dispense

```bash
CMD_ID=$(curl -s -X POST https://uboil.flux.mn/api/pos/start-dispense \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "station_id":10,"pump":2,"nozzle":1,"fuel_grade_id":1,
    "dose_type":"Amount","dose":50000,
    "card_id":<CARD_ID>
  }' | python3 -c 'import json,sys;print(json.load(sys.stdin)["command_id"])')
echo "command_id=$CMD_ID"
```

### 10.7 Poll status

```bash
while true; do
  curl -s "https://uboil.flux.mn/api/pos/dispense/$CMD_ID/status?pump=2&station_id=10" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"], d.get("transaction",{}) and d["transaction"].get("id"))'
  sleep 2
done
```

When `status=completed`, copy the `transaction.id`.

### 10.8 Finalize

```bash
curl -X POST https://uboil.flux.mn/api/pos/finalize \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "transaction_id":<TX_ID>,"payment_method":"fuel_card",
    "card_id":<CARD_ID>,
    "vat_receipt_number":"ДДТД2026050000123","vat_type":"Иргэн"
  }'
```

### 10.9 Verify movements

```bash
curl "https://uboil.flux.mn/api/pos/cards/<CARD_ID>/movements" \
  -H "Authorization: Bearer $TOKEN"
```

Should show three rows: `topup` credit, `sale` debit (initial lock),
plus a true-up adjustment if the actual fill differed from the
lock.

### 10.10 Void (optional)

```bash
curl -X POST https://uboil.flux.mn/api/transactions/<TX_ID>/void \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Тестийн цуцлалт"}'
```

`refunded_to_card` should equal the original sale amount; check
`/cards/<CARD_ID>/movements` and you'll see the new credit row.

---

## 11. Recommended Android stack

| Concern | Library |
|---|---|
| HTTP | `retrofit2` 2.11+ |
| JSON | `kotlinx.serialization` (or `moshi`) |
| Auth interceptor | OkHttp `Interceptor` reading from `DataStore` |
| Token refresh | On 401, fall back to NFC login screen |
| NFC | `android.nfc.NfcAdapter` foreground dispatch |
| State | `ViewModel` + `Flow`, no Redux/MVI overkill needed |
| DI | `Hilt` |
| UI | `Jetpack Compose` |
| Navigation | `compose-navigation` |
| Polling | `LaunchedEffect` + `delay()` in a coroutine, scoped to the dispense screen |

Retrofit interface skeleton:

```kotlin
interface FluxPosApi {
    @POST("/api/auth/pos-nfc-login")
    suspend fun nfcLogin(@Body req: NfcLoginRequest): PosToken

    @POST("/api/pos/lookup-card")
    suspend fun lookupCard(@Body req: LookupCardRequest): LookupCardResponse

    @GET("/api/pos/pumps")
    suspend fun pumps(@Query("station_id") stationId: Int): List<Pump>

    @POST("/api/pos/start-dispense")
    suspend fun startDispense(@Body req: StartDispenseRequest): StartDispenseResponse

    @GET("/api/pos/dispense/{commandId}/status")
    suspend fun dispenseStatus(
        @Path("commandId") commandId: Int,
        @Query("pump") pump: Int,
        @Query("station_id") stationId: Int,
    ): DispenseStatus

    @POST("/api/pos/finalize")
    suspend fun finalize(@Body req: FinalizeRequest): FinalizeResponse

    @POST("/api/transactions/{id}/void")
    suspend fun voidTransaction(
        @Path("id") txId: Int,
        @Body req: VoidRequest,
    ): VoidResponse
}
```

---

## 12. Open questions / device-specific work

The Android dev's responsibility (not the backend's):

1. **Bank SDK integration**: each Mongolian bank ships its own EMV / contactless SDK (Хаан, Голомт, etc.). Pick the one matching the customer's bank-acquired POS device.
2. **eBarimt SDK**: TaxApp module on the device prints the VAT receipt and returns `vat_receipt_number`.
3. **QPay**: the bank SDK usually wraps QPay too; otherwise integrate the QPay merchant API directly (separate project).
4. **Receipt printer**: vendor SDK for the specific device (Telpo, PAX, Sunmi).
5. **Offline behaviour**: queue start-dispense / finalize calls locally and replay when connectivity returns. The backend is idempotent on `start-dispense` only by `command_id` (each call creates a new command), so the client must avoid double-tap.

---

## 13. Contact

Backend questions → server-side (this repo).
API changes are versioned via the document version at the top — when
you see a new version, re-read the section that changed.

---

## 14. Pump lifecycle & the EOT state

This section exists because the bundled PTS-2 simulator surfaced a
~3-minute lag between "customer paid" and "the next customer can
fuel" — and the same bug exists in real Technotrade PTS-2 firmware
when `AutoCloseTransaction=true` is not honoured. Both are now fixed
by the backend; the section below documents what the device sees so
the POS app can render the right Mongolian-language status.

### 14.1 Five PTS-2 pump states (per jsonPTS R137 §111-§115)

| PTS-2 state | When | `/api/pos/pumps` status |
|---|---|---|
| `PumpIdleStatus`, no nozzle up | Pump is parked, no customer interacting | `idle` |
| `PumpIdleStatus`, `NozzleUp` > 0 | Customer lifted a nozzle, awaits authorisation | `ready` |
| `PumpFillingStatus` | Fuel is flowing | `busy` |
| `PumpEndOfTransactionStatus` | Fuel stopped, transaction not yet closed | `ended` |
| `PumpOfflineStatus` | Controller can't see the pump | `offline` |

### 14.2 What `EndOfTransactionStatus` means

Per R137 §114 note 1:

> The PTS-2 controller will keep sending PumpEndOfTransactionStatus
> response to PumpGetStatus request until current transaction is
> closed using PumpCloseTransaction request with the same transaction
> number as in PumpEndOfTransactionStatus response.

So the pump does **not** transition to `idle` on its own once the
nozzle is hung up — it sits in EOT until the server says "I've taken
your transaction, you can close it". That close is the
`PumpCloseTransaction` request (R137 §124), which carries the same
`Transaction` number that the EOT status reported.

Some firmwares and the simulator do support `AutoCloseTransaction:
true` on `PumpAuthorize` (R137 §116) and will auto-close the moment
the fill ends — but the auto-close path is unreliable in practice
(observed ~3 min stall on the simulator). The backend now sends
`PumpCloseTransaction` explicitly, which both shortens the wait to
seconds and works against firmwares that ignore `AutoCloseTransaction`.

### 14.3 Where the backend sends `PumpCloseTransaction`

| Trigger | Effect |
|---|---|
| `POST /api/pos/finalize` succeeds | Queues `PumpCloseTransaction` for the pump that produced the transaction |
| `POST /api/transactions/{id}/void` succeeds | Same — covers the "customer walked away, attendant voids" case where no `/finalize` ever ran |
| `POST /api/pts/commands/close-transaction` | Manual admin recovery (next section) |

The `Transaction` number used by the close is the value PTS-2
reported in `UploadPumpTransaction` / `PumpTransactionInformation`'s
`Transaction` field. The backend stores it on the `transactions` row
as `pts_transaction_number` and `pts_pump_number` when the fill
event is received, then reads it back at finalize time. No POS-app
work is required.

### 14.4 Admin recovery: `POST /api/pts/commands/close-transaction`

For pumps that got stuck before this fix shipped, or for fills that
were never finalised and never voided, attendants and managers can
force-close from the web admin:

```
POST /api/pts/commands/close-transaction?station_id=10&pump_number=1
Authorization: Bearer <jwt>
```

`transaction` is optional — when omitted, the backend reads
`LastTransactions[i]` from the controller's most recent
`UploadStatus` so the operator doesn't have to look the number up by
hand. Pass `transaction=<n>` to override.

```json
{
  "command_id": 91,
  "status": "pending",
  "pump_number": 1,
  "transaction": 17,
  "message": "PumpCloseTransaction queue-д орлоо."
}
```

Available to: `super_admin`, `brand_admin`, `station_manager`,
`attendant`. The command is queued, not sent synchronously — see
§14.5 for timing.

### 14.5 End-to-end timing the cashier will see

```
t=0.0s   Cashier taps Finalize  →  POST /api/pos/finalize  →  200 OK
t=0.0s   Server queues PumpCloseTransaction (pts_command_logs.status='pending')
t≈1–5s   PTS-2's next jsonPTS upload arrives; server attaches the close request
         as SetRequestType=PumpCloseTransaction on the response (R137 §213)
t≈1–5s   PTS-2 receives, closes the transaction internally
t≈2–10s  PTS-2's next UploadStatus reports pump as PumpIdleStatus
         (or PumpIdleStatus with NozzleUp > 0 if the next customer already
         lifted a nozzle)
t≈2–10s  /api/pos/pumps starts returning status='idle' or status='ready'
```

So the cashier sees the pump grid update within ~10 s of pressing
Finalize, instead of ~3 min before this fix.

### 14.6 Why some firmwares still send `AutoCloseTransaction`

`AutoCloseTransaction: true` on `PumpAuthorize` is still set by the
backend (it's part of the `PumpAuthorize` payload built in
`/api/pos/start-dispense`). It's harmless to send both
`AutoCloseTransaction` and an explicit `PumpCloseTransaction` — the
controller is idempotent here. We keep the flag for the firmwares
that do honour it (one less round-trip to wait for) and rely on the
explicit close for the firmwares that don't.

### 14.7 Recommended POS-app behaviour on `ended`

When `/api/pos/pumps` reports `status: "ended"`:

1. Show "Дуусаж байна" with a small spinner — make it visually
   different from `busy` ("Шахаж байна") so the cashier doesn't think
   the pump is still actively pumping.
2. Don't enable the **Эхлэх** (Authorise) button.
3. Keep polling at the usual 2–3 s cadence; the state will flip to
   `idle` / `ready` within seconds.
4. If the state stays `ended` for more than 30 seconds, surface a
   "Сэргээх" (Recover) button that calls
   `POST /api/pts/commands/close-transaction` — this is the recovery
   path for fills that finished before the previous fix shipped.
