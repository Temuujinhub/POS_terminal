# POS Android App — Хөгжүүлэгчдэд зориулсан заавар

Энэ документ Flux Monitor-ийн POS terminal Android app-ыг
хөгжүүлж буй багт зориулсан. Backend сервер шинэ event-ээр өгөгдөл
буцаах боллоо — POS app-ын side-аас одоогийн UI flow-ыг өргөтгөн
**EOT auto-advance**, **acknowledged chip**, **fill progress bar**
зэргийг нэмэх ёстой.

> **Backend version:** branch `claude/debug-controller-data-flow-ND9Jl`
> сүүлийн commit `d0d7649` (PR #46 merge — PumpAuthorize completed
> status). Энэ doc нь 2026-05-19-ний live тестийн дараа шинэчлэгдсэн.
>
> **Сервер:** `https://uboil.flux.mn`

---

## 0. Үүгийн ноцтой шинэчлэлүүд (2026-05-19)

Live тестийн дараа дараах юмс **батлагдсан / шинэчлэгдсэн**:

1. **`AutoCloseTransaction: true` нь Технотрейд PTS-2 firmware (build
   743.0002.TR.0.1) дээр **зөв ажиллаж байна**. Транзакц нь хошуу
   буусны дараа автоматаар хаагдах ба сервер `PumpCloseTransaction`
   тушаалаа явуулах **шаардлагагүй**. Бид одоохондоо аюулгүй гэдэг
   утгаар явуулсаар байгаа гэхдээ `JSONPTS_ERROR_PUMP_STATUS_NOT_END_OF_TRANSACTION`
   гэж буцаах нь хэвийн зүйл — POS app үүнийг анхаарах хэрэггүй.

2. **`status='completed'` нэр гарч ирлээ.** Шахалт дуусах төдийд
   backend нь дотооддоо PumpAuthorize-ийг `acknowledged` → `completed`
   болгож шилжүүлнэ. POS app-ын side-аас энэ нь `status='completed'`
   гарч ирэхэд **POS UI нь `Хүчинтэй`/`Бэлэн`-руу буцах** ёстой гэсэн
   үг.

3. **`Шахаж байна` хүлээх хугацаа: ~3-5 мин → ~1-3 секунд.**

4. **Тестийн edge case:** Хэрэв POS-аас pump авторизаци өгөөд **бодит
   шахалт хийгээгүй бол** (зөвхөн авторизаци, шатахуун шахаагүй) →
   PumpAuthorize нь 5 минут `acknowledged`-д үлдэх ба насос ч мөн
   `Шахаж байна`-д үлдэнэ. Жинхэнэ үйлчлүүлэгч заавал шахалт хийдэг
   тул бодит ашиглалт дээр нөлөөгүй.

---

## 1. Шахалтын state diagram (шинэчлэгдсэн)

```
┌──────────┐  POST /pos/start-dispense  ┌─────────┐
│ READY    │  ─────────────────────►    │ PENDING │
│ (POS UI) │                             └────┬────┘
└──────────┘                                  │ status='pending'
                                              ▼
                                         ┌─────────┐
                                         │  SENT   │  ← server piggy-backed
                                         └────┬────┘    onto next PTS-2 ack
                                              │ status='sent'
                                              ▼
                                        ┌─────────────┐
                                        │ACKNOWLEDGED │  ← PumpAuthorize
                                        └──────┬──────┘    Confirmation ирсэн
                                               │ status='acknowledged'
                                               │ (POS UI: "Контроллер хүлээж авлаа")
                                               ▼
                                        ┌──────────┐
                                        │ FILLING  │  ← pump engine running,
                                        └────┬─────┘    Volume/Amount нэмэгдэнэ
                                             │ status='filling'
                                             │ fill_snapshot != null
                                             │ (POS UI: progress bar live)
                                             ▼
                                        ┌──────────┐
                                        │   EOT    │  ← preset hit / autostop;
                                        └────┬─────┘    pump waiting for nozzle
                                             │ status='eot'
                                             │ fill_snapshot != null
                                             │ (POS UI: receipt screen — НЭМЭХ ШААРДЛАГАТАЙ)
                                             ▼
                                       ┌─────────────┐
                                       │ COMPLETED   │  ← UploadPumpTransaction
                                       └──────┬──────┘    ирсэн, tx.id олгогдсон
                                              │ status='completed'
                                              │ transaction.id populated
                                              ▼
                                       POS-аас POST /pos/finalize
                                              │
                                              ▼
                              ┌────────────────────────────────┐
                              │ Backend дотооддоо:              │
                              │   PumpAuthorize → 'completed'   │ ← PR #46
                              │   /api/pos/pumps насосыг        │
                              │   `idle`/`ready` гэж буцаана    │
                              └────────────────────────────────┘
```

| Backend state | POS UI screen | Шилжих агшин |
| --- | --- | --- |
| `pending` | Spinner "Командыг queue-д оруулсан" | dispense эхлүүлсэн |
| `sent` | Spinner "Контроллер руу илгээж байна" | server packet attached |
| `acknowledged` | Spinner "Контроллер хүлээж авлаа" | PumpAuthorizeConfirmation ирсэн |
| `filling` | **Progress bar** (preset / current) | FillingStatus.Ids contains pump |
| **`eot`** | **Receipt screen** (Шахагдсан) | EndOfTransactionStatus.Ids |
| `completed` | Receipt + finalize товч enable | UploadPumpTransaction → tx.id |
| `failed` | Error message + Retry товч | PTS-2 error packet |

### Realistic timing budget (2026-05-19 туршилтаар)

| Гүйлгээний шилжилт | Үргэлжлэл |
|---|---|
| `pending` → `sent` | 0-2 сек (дараагийн UploadStatus packet) |
| `sent` → `acknowledged` | < 1 сек (PumpAuthorizeConfirmation шууд) |
| `acknowledged` → `filling` | 1-5 сек (engine spin-up, preset write) |
| `filling` хугацаа | preset / flow-rate (Мон: 30-90 сек ердийн) |
| `filling` → `eot` | Шууд (хошуу буухад) |
| `eot` → `completed` | 1-5 сек (PTS-2 UploadPumpTransaction) |
| /finalize → насос ready (next sale) | **1-3 сек** ← PR #46 |

> Энэ доорх шилжилт `acknowledged` → `filling` ховор удаан үргэлжилэх
> магадлалтай (preset эхэлсэн ч engine тогтвортой эргэх хүртэл). POS
> UI энэ үед "Шахалт эхэлж байна..." spinner үлдээж болно.

---

## 2. API contract

### 2.1 `POST /api/pos/start-dispense`

**Request:**
```json
{
  "station_id": 10,
  "pump": 2,
  "nozzle": 3,
  "dose_type": "Amount",
  "dose": 50000,
  "auto_close": true,
  "nfc_tag": null
}
```

`auto_close: true` нь `AutoCloseTransaction=true`-г PumpAuthorize-руу
оруулна. Энэ нь нэн чухал — Technotrade PTS-2 firmware ёсоор тэр flag
тавиагүй бол хошуу буусны дараа транзакц **нээлттэй** үлдэнэ.

**Response:**
```json
{
  "command_id": 70,
  "status": "pending",
  "message": "Команд queue-д орлоо"
}
```

POS app `command_id`-ыг хадгалаад дараагийн polling endpoint-руу
дамжуулна.

### 2.2 `GET /api/pos/dispense/{command_id}/status?pump=2&station_id=10`

**Polling-ийн давтамж**: 1-2 секунд тутамд (1 сек заагаар PTS-2
UploadStatus packet ирдэг тул тэрнээс илүү шинэчлэх утгагүй).

**Response (бүх state-уудад нэг shape):**
```json
{
  "command_id": 70,
  "command_type": "PumpAuthorize",
  "status": "filling",
  "error_message": null,
  "sent_at": "2026-05-09T05:00:00Z",
  "acknowledged_at": "2026-05-09T05:00:01Z",
  "transaction": null,
  "fill_snapshot": {
    "pump": 2,
    "nozzle": 3,
    "volume": 7.94,
    "amount": 27000,
    "price": 3400,
    "fuel_grade_id": 2,
    "fuel_grade_name": "DT"
  }
}
```

Боломжит `status` утгууд: `pending` | `sent` | `acknowledged` |
`filling` | `eot` | `completed` | `failed`.

| Field | `pending`/`sent`/`acknowledged` | `filling`/`eot` | `completed` | `failed` |
| --- | --- | --- | --- | --- |
| `status` | string | string | `"completed"` | `"failed"` |
| `acknowledged_at` | null/timestamp | timestamp | timestamp | timestamp |
| `fill_snapshot` | null | **populated** | null | null |
| `transaction` | null | null | **populated** | null |
| `error_message` | null | null | null | string |

#### Polling-г хэзээ зогсоох вэ

- `completed` ирэхэд: `transaction.id`-ыг хадгалаад finalize товчийг
  enable, polling-ийг зогсооно
- `failed` ирэхэд: алдаа дэлгэц гаргаж polling зогсооно
- 5 минутаас илүү `pending`/`sent`/`acknowledged` хариу ирвэл: timeout
  алдаа гаргана (PTS-2 controller offline байх магадтай)

### 2.3 `POST /api/pos/finalize`

**Request:**
```json
{
  "transaction_id": 1182,
  "payment_method": "cash",
  "amount": 45000,
  "vat_receipt_number": "ABC123",
  "vat_type": 1
}
```

`payment_method` боломжит утга: `cash`, `bank_card`, `qpay`,
`corporate_card`, `loyalty_card`.

**Response:**
```json
{
  "transaction_id": 1182,
  "status": "finalized",
  "message": "Гүйлгээ амжилттай"
}
```

#### EOT state үед finalize товчтой холбоотой стратегиуд

`fill_snapshot`-аас `transaction.id` авах боломжгүй — `eot` state-д
энэ id хараахан байхгүй. Тиймээс finalize-ийг **`completed`-руу
шилжих хүртэл түр түдгэлзүүлэх** ёстой. Хоёр стратеги:

- **Стратеги A** (зөвлөмжтэй): `eot` state-д receipt screen
  нээгээд **"Гүйлгээ баталгаажуулах" товч disabled** үлдээх. Status
  `completed`-руу шилжихэд (1-5 секундийн дотор) товч enable.
- **Стратеги B**: `eot` state-д шууд "Шахагдсан" screen нээгээд
  background-д status polling үргэлжлүүлэх. `completed` ирэхэд
  `transaction.id`-г snapshot-аар сольж finalize хийж болно.

#### Finalize дуудсаны дараа backend дотооддоо

PR #46 ёсоор:
1. Транзакцыг finalize гэж тэмдэглэнэ (`pos_finalized_at` сэт)
2. `pts_command_logs` дахь холбогдох PumpAuthorize-г `acknowledged`
   → **`completed`** болгож сольно (энэ нь шахалт дуусах төдийд
   автомат хийгддэг — finalize-аас өмнө ч хийгдсэн байж болзошгүй)
3. `/api/pos/pumps` дараагийн poll-д насосыг **`ready`/`idle`**-руу
   буцаана

POS app side-аас: finalize амжилттай 200 OK ирсний дараа pump grid
1-3 секундын дотор шинэчлэгдэх ёстой.

---

## 3. Pump status grid

POS app `/api/pos/pumps?station_id=X` endpoint-аас pump-уудын
сүүлийн төлвийг авч 1-2 секунд тутамд шинэчлэхийг зөвлөж байна.

```json
{
  "pump_number": 2,
  "status": "busy",
  "pump_state": "filling",
  "nozzle": 3,
  "fuel_grade_name": "DT",
  "fuel_grade_price": 3400,
  "current_volume": 7.94,
  "current_amount": 27000,
  "preset_dose": 36500,
  "preset_dose_type": "Amount",
  "preset_command_id": 70,
  "last_volume": 4.41,
  "last_amount": 15000,
  "last_nozzle": 2
}
```

### `status` field-ийн дэлгэрэнгүй

| `status` | Утга | POS app зөвлөмж |
| --- | --- | --- |
| `idle` | Хоосон, хошуу авагдаагүй | "ИДЭВХГҮЙ" чип, шахах товч disabled |
| `ready` | Хошуу авагдсан, шахах боломжтой | "ХОШУУ АВСАН" чип, "Шахах" товч enable |
| `busy` | PumpAuthorize idэвхтэй / FillingStatus / EndOfTransactionStatus | "Шахаж байна" чип + live progress |
| `offline` | PTS-2 контроллер насосыг харахгүй | "Холбоо алга" чип, disabled |

### `pump_state` field — illa low-level firmware status

`pump_state` нь jsonPTS-ийн strictly-defined enum-ийг харуулна
(`idle`, `auth`, `filling`, `eot`, `offline`). Энэ нь
**дотоод diagnostic** зорилгоор олгож байгаа. UI-д `status`-ийг
ашиглах нь зүйтэй.

| `pump_state` | Утга |
| --- | --- |
| `idle` | Хоосон, хошуу авагдаагүй |
| `auth` | PumpAuthorize-р idle-нozzle-up болсон |
| `filling` | Шатхуун идэвхтэй шахагдаж байна |
| `eot` | Шахалт дуусчилсан, хошуу буугаагүй |
| `offline` | PTS-2 контроллер харахгүй |

### `current_*` vs `last_*` field-ийн ялгаа

- `current_volume` / `current_amount` — **live** утга, зөвхөн
  `status='busy'` үед populate болно
- `last_volume` / `last_amount` — хамгийн сүүлчийн **дууссан**
  транзакцийн утга, харагдсан хэвээр ч **live биш**

POS app side-аас зөвхөн `current_*` field-ийг live progress bar-руу
дамжуулна.

---

## 4. Kotlin code snippets

### 4.1 Sealed state class

```kotlin
sealed class DispenseState {
    object Pending : DispenseState()
    object Sent : DispenseState()
    object Acknowledged : DispenseState()
    data class Filling(val snapshot: FillSnapshot) : DispenseState()
    data class Eot(val snapshot: FillSnapshot) : DispenseState()
    data class Completed(val transaction: TransactionDto) : DispenseState()
    data class Failed(val message: String) : DispenseState()
}

data class FillSnapshot(
    val pump: Int,
    val nozzle: Int?,
    val volume: Double?,
    val amount: Double?,
    val price: Double?,
    val fuelGradeId: Int?,
    val fuelGradeName: String?,
)
```

### 4.2 Polling + parsing

```kotlin
suspend fun pollDispense(
    commandId: Long,
    pump: Int,
    stationId: Long,
): Flow<DispenseState> = flow {
    var elapsedMs = 0L
    while (true) {
        val resp = api.getDispenseStatus(commandId, pump, stationId)
        val state = when (resp.status) {
            "pending"      -> DispenseState.Pending
            "sent"         -> DispenseState.Sent
            "acknowledged" -> DispenseState.Acknowledged
            "filling"      -> DispenseState.Filling(resp.fillSnapshot!!)
            "eot"          -> DispenseState.Eot(resp.fillSnapshot!!)
            "completed"    -> DispenseState.Completed(resp.transaction!!)
            "failed"       -> DispenseState.Failed(resp.errorMessage ?: "Алдаа")
            else           -> DispenseState.Pending
        }
        emit(state)
        if (state is DispenseState.Completed || state is DispenseState.Failed) break
        delay(1500)
        elapsedMs += 1500
        // 5 минутаас илүү хүлээгдэх нь PTS-2 offline байх дохио
        if (elapsedMs > 300_000) {
            emit(DispenseState.Failed("PTS-2 хариу удаан байна"))
            break
        }
    }
}
```

### 4.3 UI — Compose жишээ

```kotlin
@Composable
fun DispenseScreen(state: DispenseState, onFinalize: (TransactionDto) -> Unit) {
    when (state) {
        is DispenseState.Pending,
        is DispenseState.Sent -> SpinnerScreen("Контроллер руу илгээж байна")

        is DispenseState.Acknowledged -> SpinnerScreen("Контроллер хүлээж авлаа")

        is DispenseState.Filling -> FillProgressScreen(
            snapshot = state.snapshot,
            label = "Шахаж байна",
        )

        is DispenseState.Eot -> ReceiptScreen(
            volume = state.snapshot.volume ?: 0.0,
            amount = state.snapshot.amount ?: 0.0,
            fuelGrade = state.snapshot.fuelGradeName,
            finalizeEnabled = false,
            note = "Транзакцийн дугаар хүлээж байна...",
        )

        is DispenseState.Completed -> ReceiptScreen(
            volume = state.transaction.volumeLiters,
            amount = state.transaction.totalAmount,
            fuelGrade = state.transaction.fuelType,
            finalizeEnabled = true,
            onFinalize = { onFinalize(state.transaction) },
        )

        is DispenseState.Failed -> ErrorScreen(state.message)
    }
}
```

### 4.4 Жинхэнэ pump vs симулятор UX

| Симулятор | Жинхэнэ pump |
| --- | --- |
| EOT phase **<1сек** үргэлжилнэ | EOT phase **3-10сек** үргэлжилнэ |
| Trigger Off гар аргаар хийнэ | Үйлчлүүлэгч хошуу буулгана |
| `eot` state бараг харагдахгүй | `eot` state мэдрэгдэхүйц |

`eot` state дотор **Receipt screen-ыг урьтаж нээх нь** жинхэнэ pump
дээр хэрэглэгчийн хүлээх 5-10 секунд хэмнэнэ.

---

## 5. Алхам алхмаар туршилтын дараалал

```
1. /api/pos/pumps           → pump.status="ready" эсвэл "idle" харах
2. POST /api/pos/start-dispense → command_id авах
3. /api/pos/dispense/{cmd}/status polling эхлүүлэх
4. Backend response state шилжилт:
   pending → sent → acknowledged → filling → eot → completed
5. /api/pos/finalize (status='completed' болсны дараа)
6. /api/pos/pumps дараагийн poll-д тэр pump-ийн status="ready"/"idle"
   1-3 сек дотор буцах эсэхийг шалга
```

---

## 6. Backend-ийн "зөв ажиллаж байгаа" дохио

POS app contract зөв ажиллаж байгааг **backend deploy** хийгдсэн
эсэхээс эхэлж нягтлах хэрэгтэй:

```bash
BASE="https://uboil.flux.mn"
TOKEN="<JWT token>"

# Сүүлийн PumpAuthorize-г олох
CMD_ID=$(curl -s "$BASE/api/pts/commands?command_type=PumpAuthorize&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].id')

# Status шалгах
curl -s "$BASE/api/pos/dispense/$CMD_ID/status?pump=1&station_id=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Шалгах зүйлс:
- Хариунд `fill_snapshot` field байгаа эсэх
- `eot` state ирэх эсэх
- Шахалт дуусахад `status` нь `completed` болж `transaction.id`-тай
  хариу буцаах эсэх
- Finalize хийсний дараа `/api/pos/pumps`-аас тэр pump нь
  `status="ready"` эсвэл `status="idle"`-руу 1-3 сек дотор шилжих эсэх

### `pts_command_logs`-аас PR #46 ажиллаж байгаа эсэх

Backend-ийн жинхэнэ зан үйлсийг operator (admin) DB-аас шалгаж болно:

```sql
SELECT id, command_type, status, created_at
FROM pts_command_logs
WHERE command_type='PumpAuthorize'
ORDER BY id DESC LIMIT 5;
```

Сүүлийн дууссан гүйлгээний PumpAuthorize-ийн status нь **`completed`**
байх ёстой. Хэрэв `acknowledged` хэвээр үлдсэн бол:
- Гүйлгээ хараахан дуусаагүй (нормальd дамжиж буй)
- Эсвэл шахалт хийгээгүй (зөвхөн авторизаци, edge case)

---

## 7. Test fixtures

`scripts/seed_pos_test.sh` нь дараах account, картыг үүсгэдэг:

| | Утга |
|---|---|
| Attendant NFC tag | `04A1B2C3D4E5F6` |
| Loyalty card NFC | `AA11BB22CC33` (10% хөнгөлөлт) |
| Corporate card NFC | `DD44EE55FF66` (500,000₮ үлдэгдэлтэй) |

Тестийн pump-уудыг зөвхөн HQ дээрх PTS-2 simulator (192.168.0.117)
ашиглан туршина.

---

## 8. Сэргээх / алдаа гарсан тохиолдол

### Pump "Шахаж байна"-д хэт удаан үлдсэн

Хэрэв `Шахаж байна` статус 30 секундээс илүү үргэлжилсэн ч `filling`
эсвэл `eot` state-руу шилжихгүй бол:

1. **PTS-2 контроллер offline байж магадгүй** —
   `/api/pts/controllers` шалгаж `connection_status='ONLINE'` эсэхийг
   нягтла
2. **PumpAuthorize огт ирээгүй магадгүй** — `pts_command_logs`-аас
   тухайн `command_id` олж status шалгана
3. **Шахалт огт хийгээгүй (edge case)** — PumpAuthorize ирсэн ч
   simulator-аас trigger pull хийгээгүй. Энэ үед PumpAuthorize 5
   минут `acknowledged`-д үлдэх ба насос `Шахаж байна`-д хэвээр.
   Шийдэл: жинхэнэ шахалт хийх эсвэл админ DB-аас гараар цэвэрлэх:
   ```sql
   UPDATE pts_command_logs SET status='completed'
   WHERE id=<command_id> AND command_type='PumpAuthorize';
   ```

### POS app side-аас 401 Unauthorized

JWT token timeout — POS app re-login flow дуудна.

### POS app side-аас 503 Service Unavailable

Backend нь дотооддоо restart хийгдсэн магадгүй — 5 секундийн дараа
дахин оролдоно.

---

## 9. Хувилбарын түүх

| Огноо | Өөрчлөлт |
|---|---|
| 2026-05-09 | EOT auto-advance, PumpAuthorizeConfirmation handler, fill_snapshot |
| 2026-05-19 | PR #46: PumpAuthorize → completed status; "Шахаж байна" stuck issue зассан |

---

## 10. Холбоо барих

Backend асуудал гарвал DB шалгалт хийгээд (§6.1) backend log
шалгана:

```bash
# uboil сервер дээр
docker compose logs backend --since 10m | grep -iE "PumpAuthorize|PumpTransaction|finalize|error"
```

`PumpAuthorize cmd_id=NN pump=N marked completed (fill done)`
гэсэн мөр шинэ гүйлгээ бүрд гарах ёстой — энэ нь backend
ажиллаж байгаагийн дохио.
