# POS Android-app — Туршилт хийх заавар

Энэ документ нь POS терминалын Android app хөгжүүлж буй хүнд
зориулагдсан. Каждый endpoint-ыг дуудсаны дараа dashboard-ын аль
хуудсанд / DB-ийн аль хүснэгтэд юу үлдэхийг харуулна.

> Server: **https://uboil.flux.mn**
> Документ хослол: [POS_API.md](POS_API.md)

---

## 0. Бэлтгэл

Туршилт эхлэхийн өмнө сервер дээр нэг удаа ажиллуулна:

```bash
ssh root@uboil.flux.mn 'cd /opt/flux && bash scripts/seed_pos_test.sh'
```

Энэ нь дараах өгөгдлийг үүсгэнэ:

| | Утга |
|---|---|
| Web admin login | `pos-test@flux.mn` / `Pos2026!` |
| Attendant NFC tag | `04A1B2C3D4E5F6` |
| Loyalty test карт NFC | `AA11BB22CC33` (10% хөнгөлөлт) |
| Corporate test карт NFC | `DD44EE55FF66` (500,000₮ үлдэгдэлтэй) |

Баруун дээд буланд (web дээр) `pos-test@flux.mn`-ээр нэвтрээд **/attendant**
хуудсыг нээлттэй үлдээж туршилт эхлэхэд live update хараарай.

---

## 1. Attendant NFC login

```http
POST /api/auth/pos-nfc-login
Content-Type: application/json

{ "nfc_tag": "04A1B2C3D4E5F6", "device_id": "your-device-id" }
```

### ✅ DB дээр юу үлдэх

Энэ endpoint нь **DB-д юм бичихгүй** (зөвхөн уншина). Backend log-д
харагдана:

```bash
docker compose logs --tail=50 backend | grep pos-nfc-login
# → INFO: 172.x.x.x - "POST /api/auth/pos-nfc-login HTTP/1.1" 200 OK
```

### Хариу

```json
{
  "access_token": "eyJ...",
  "user_id": 7,
  "full_name": "POS Тест Ажилтан",
  "role": "attendant",
  "station_id": 10,
  "station_name": "UB OIL Станц #1"
}
```

JWT-ийг дараагийн бүх API дуудлагад `Authorization: Bearer ...` header-эр илгээнэ.

---

## 2. Хэрэглэгчийн карт уншуулах

```http
POST /api/pos/lookup-card
Authorization: Bearer <token>
Content-Type: application/json

{ "nfc_tag": "AA11BB22CC33" }
```

### ✅ DB дээр юу үлдэх

Зөвхөн уншина. Хариунд нь карт олдсон бол `card_id`, `card_type`,
`balance`, `discount_percent` буцаана.

### Тест шалгалт

| `nfc_tag` оруулсан | Хариу |
|---|---|
| `AA11BB22CC33` | `found:true`, `card_type:"loyalty"`, `discount_percent:10`, `balance:0` |
| `DD44EE55FF66` | `found:true`, `card_type:"corporate"`, `balance:500000` |
| (өөр аль ч tag) | `found:false` |

---

## 3. Live pump grid

```http
GET /api/pos/pumps?station_id=10
Authorization: Bearer <token>
```

### ✅ Dashboard дээр харах

Web admin-аар (өөр tab-д) **/attendant** хуудсаас pump grid-ийг live харагдах болно
(5 секундийн интервалаар auto-refresh). Таны GET-ийн хариу нь яг ижил
өгөгдөл — `status: "ready" | "idle" | "busy" | "offline"`.

`status: "ready"` гэдэг нь **хошуу сугалсан** төлөв — POS app дээр
зөвхөн энэ төлөвт байгаа pump-уудыг сонгох боломжтой болгоно уу.

> Хэрэв тестлэхэд бодит PTS-2 байхгүй (хошуу сугалаагүй) бол бүх pump
> `idle` төлөвтэй харагдана. Тэгвэл тест хийхдээ `start-dispense`-ийг
> шууд `idle` pump-руу илгээж болно — бодит controller байхгүй учир
> алдаа гарахгүй, ердөө simulator горимд ажиллана.

---

## 4. Start dispense (corporate карт-аар жишээ)

```http
POST /api/pos/start-dispense
Authorization: Bearer <token>
Content-Type: application/json

{
  "station_id": 10,
  "pump": 2,
  "fuel_grade_id": 1,
  "dose_type": "Amount",
  "dose": 50000,
  "card_id": <CARD_ID>,
  "nfc_tag": "DD44EE55FF66"
}
```

### ✅ DB дээр юу үлдэх

3 хүснэгтэд бичигдэнэ:

#### а) `pts_command_logs` — PumpAuthorize команд
```sql
SELECT id, command_type, status, payload FROM pts_command_logs ORDER BY id DESC LIMIT 1;
```
| id | command_type | status | payload (excerpt) |
|---|---|---|---|
| 31 | PumpAuthorize | pending → sent | `{"Pump":2,"Type":"Amount","Dose":50000,"FuelGradeId":1,"_pos":{"card_id":42,"locked_amount":50000}}` |

#### б) `card_balance_movements` — corporate балансын lock
```sql
SELECT id, card_id, direction, reason, amount, balance_after, notes FROM card_balance_movements ORDER BY id DESC LIMIT 1;
```
| id | card_id | direction | reason | amount | balance_after |
|---|---|---|---|---|---|
| 1 | 42 | debit | sale | 50000 | 450000 |

#### в) `fuel_cards` — карт балансын утга
```sql
SELECT id, card_number, balance FROM fuel_cards WHERE id = <CARD_ID>;
```
Балансыг 500,000 → 450,000 болж буурсан байна.

### ✅ Dashboard-д харах

- **`/fuel-cards`** хуудсанд тест карт дээр "Хөдөлгөөн" 🔄 товч дарсаар
  шинэ debit хөдөлгөөн харагдана.
- **`/attendant`** хуудсанд хэвээрээ — тэр зөвхөн дууссан Transaction-уудыг харна.

---

## 5. Dispense status (poll)

```http
GET /api/pos/dispense/{command_id}/status?pump=2&station_id=10
Authorization: Bearer <token>
```

### Status хувьсал

| Status | Утга | Үргэлжлэл |
|---|---|---|
| `pending` | Queue-д орсон, PTS-2 руу илгээгүй | 0-2 сек |
| `sent` | PTS-2 руу OK ack-аар дамжуулсан | <1 сек |
| `acknowledged` | PTS-2 confirm хийсэн (PumpAuthorizeConfirmation) | 1-5 сек |
| `filling` | Pump одоо шахаж байна (engine running) | preset / flow rate (30-90 сек) |
| `eot` | Шахалт дуусчилсан, хошуу буугаагүй (`fill_snapshot` populated) | 1-10 сек (жинхэнэ pump-д үргэлжилнэ) |
| `completed` | UploadPumpTransaction ирсэн, `transaction.id` буцаана | terminal |
| `failed` | PTS-2 алдаа | terminal |

### ✅ DB дээр юу үлдэх

Гүйлгээ дууссан үед:

1. **`transactions` хүснэгтэд шинэ мөр үүснэ.** PTS-2 нь
   `UploadPumpTransaction` packet илгээх үед `_handle_pump_transaction`
   нь автоматаар үүсгэнэ.
2. **`pts_command_logs` дотор холбогдох PumpAuthorize-ийн status**
   `acknowledged` → `completed`-руу шилжинэ (PR #46).

Шалгах:

```bash
docker exec flux_db psql -U flux -d flux -c \
  "SELECT id, command_type, status, created_at FROM pts_command_logs
   WHERE command_type='PumpAuthorize' ORDER BY id DESC LIMIT 5;"
```

Сүүлчийн дууссан гүйлгээний PumpAuthorize-ийн status нь **`completed`**
байх ёстой.

### Backend log дотор гарах мөр

```bash
docker compose logs backend --since 5m | grep -iE "PumpTransaction saved|marked completed"
```

Хүлээгдэж буй мөрүүд:

```
[jsonPTS] PumpTransaction saved: station=10 pump=1 pts_tx=47 dispenser_id=40 vol=12.940
[jsonPTS] PumpAuthorize cmd_id=99 pump=1 marked completed (fill done)
```

Хоёр мөр хоёулаа байх ёстой — нэг нь backend Transaction үүсгэсэн,
нөгөө нь PumpAuthorize-г "completed" болгож шилжүүлсэн.

> **Туршилт хийхэд PTS-2 байхгүй бол:** тест-attendant-ээр web дээрх
> `/attendant` хуудсаас гар-аар transaction үүсгэхгүй. Гэхдээ
> `/pos/dispense/.../status` нь `sent` дээр хатах болно. POS app-ыг
> end-to-end тестлэхэд `uboil` controller холбогдсон байх хэрэгтэй.

### ⚠️ Edge case: PumpAuthorize-р авторизаци өгөөд шахалт хийгээгүй

POS-аас pump авторизаци өгөөд **жинхэнэ шахалт хийгээгүй** бол
(simulator-ийн trigger pull хийгээгүй):

- PumpAuthorize нь 5 минут `acknowledged`-д үлдэх (cutoff)
- `/api/pos/pumps`-аас тэр насос нь `status='busy'` гэж буцаах
- POS UI дээр насос "Шахаж байна"-д үлдэнэ

**Шийдэл:**
- (а) Жинхэнэ шахалт хий — simulator-аас trigger pull
- (б) Админ DB-аас гараар цэвэрлэ:

```sql
UPDATE pts_command_logs SET status='completed'
WHERE id=<command_id> AND command_type='PumpAuthorize';
```

Бодит үйлчлүүлэгч заавал шахалт хийдэг тул энэ edge case нь зөвхөн
тестийн нөхцөлд гардаг.

---

## 6. Finalize

```http
POST /api/pos/finalize
Authorization: Bearer <token>
Content-Type: application/json

{
  "transaction_id": <TX_ID>,
  "payment_method": "fuel_card",
  "card_id": <CARD_ID>,
  "bank_approval_code": null,
  "vat_receipt_number": "ДДТД2026050000123",
  "vat_type": "Иргэн",
  "vat_register": ""
}
```

### ✅ DB дээр юу үлдэх

#### `transactions` — finalize stamps:
```sql
SELECT id, payment_method, card_id, bank_approval_code,
       vat_receipt_number, vat_type, pos_finalized_at
FROM transactions WHERE id = <TX_ID>;
```
- `payment_method`: `fuel_card`
- `card_id`: 42
- `vat_receipt_number`: 'ДДТД...'
- `pos_finalized_at`: одоогийн цаг

#### `card_balance_movements` — true-up entry (хэрэв lock дээр зөрүү бол)
```sql
SELECT * FROM card_balance_movements WHERE transaction_id = <TX_ID>;
```
Lock-аас бага fill бол `direction:credit, reason:adjustment` нэмэгдэнэ
(хэрэглэгчид буцааж олгох). Илүү fill бол debit нэмэгдэнэ.

### ✅ Dashboard-д харах

- **`/attendant`** "Сүүлийн 50 борлуулалт" хүснэгтэд тэр гүйлгээ
  гарна. `payment_method`, `card_number` бичигдсэн.
- **`/manager`** хуудсанд:
  - "Өнөөдрийн борлуулалт" KPI зөв тоонд тохирсон.
  - "Шатахуунаар" хэсэгт нэмэгдсэн.
  - "Цуцлалт" хоосон.
- **`/finance`** → **Өдөр тутам** tab-д цаг тутамдаа автоматаар
  нэгтгэгдэнэ.
- **`/fuel-cards`** дээр карт-ын "Хөдөлгөөн" товч дарж нийт audit
  тэмдэглэгээ харагдана.

---

## 7. Гүйлгээ цуцлах (хэрэв шаардлагатай бол)

```http
POST /api/transactions/{tx_id}/void
Authorization: Bearer <token>
Content-Type: application/json

{ "reason": "Баримт хэвлэгдээгүй" }
```

### ✅ DB дээр юу үлдэх

#### `transactions`:
- `voided_at`: одоогийн цаг
- `voided_by_id`: танай user_id
- `void_reason`: текст

#### `card_balance_movements` — auto-refund (corporate карт бол):
```sql
SELECT * FROM card_balance_movements WHERE transaction_id=<TX_ID> AND reason='void_refund';
```
- `direction`: credit
- `amount`: оригинал sale-ын дүнтэй тэнцүү
- балансыг back to original

### ✅ Dashboard-д харах

- **`/attendant`**: гүйлгээ улаан фон + line-through дүнтэй "Цуцлагдсан" гэсэн badge-тэй харагдана.
- **`/manager`**: "Сүүлд цуцалсан гүйлгээнүүд" хүснэгтэд хамгийн дээр гарч ирнэ — шалтгаан, хэн цуцалсан хамт.
- **`/fuel-cards`** карт-ын хөдөлгөөнд `void_refund` гэсэн credit мөр нэмэгдэнэ.

---

## 8. Live мониторинг — Backend log-аар

POS app-ийн дуудлагууд real-time-д нь хэвлэгдэхийг хаях:

```bash
docker compose logs -f backend | grep -E '/api/(pos|auth/pos|transactions/[0-9]+/void)'
```

Хүлээж буй жишээ output:
```
INFO: 172.x.x.x:55432 - "POST /api/auth/pos-nfc-login HTTP/1.1" 200 OK
INFO: 172.x.x.x:55432 - "POST /api/pos/lookup-card HTTP/1.1" 200 OK
INFO: 172.x.x.x:55432 - "GET /api/pos/pumps?station_id=10 HTTP/1.1" 200 OK
INFO: 172.x.x.x:55432 - "POST /api/pos/start-dispense HTTP/1.1" 200 OK
[POS] PumpAuthorize queued: cmd=33 pump=2 card=42 locked=50000 attendant=7
INFO: 172.x.x.x:55432 - "GET /api/pos/dispense/33/status?pump=2&station_id=10 HTTP/1.1" 200 OK
...
INFO: 172.x.x.x:55432 - "POST /api/pos/finalize HTTP/1.1" 200 OK
```

---

## 9. Тест дата-г шинэчлэх (карт reset)

Хэрэв corporate картын баланс 0 болж дууссан бол cleanup + дахин seed:

```bash
# Карт устгаж дахин үүсгэх
ssh root@uboil.flux.mn 'cd /opt/flux && bash scripts/seed_pos_test.sh'
```

---

## 10. Тулгуурлах асуултууд

### "ZERO transactions ирж байна, миний POS app-аас ирэх ёстой биш гэж үү?"
Үгүй. POS-ийн `start-dispense` зөвхөн PumpAuthorize командыг queue-д
оруулна. **`Transaction` мөр** нь PTS-2 controller-аас
`UploadPumpTransaction` packet ирсний дараа л үүсэх юм. Тиймээс live
PTS-2 контроллер байхгүй бол тест хийхэд transaction үүсгэхгүй.

### "Endpoint 401 Unauthorized гэдэг хариу ирлээ"
Token expired эсвэл буруу. POS NFC login-оор шинэ token авна уу. Token
12 цагийн настай.

### "Карт олдохгүй гэж буцаах болсон"
NFC tag-ыг **uppercase + spaces / dashes хасаж** илгээж байгаа эсэхийг
шалгаарай. `04 A1 B2 C3 D4 E5 F6` биш `04A1B2C3D4E5F6`.

### "Хэрхэн corporate картын балансыг нэмэх вэ?"
Web admin-аар `/fuel-cards` хуудаст орж тэр карт дээр "Цэнэглэх"
🟢 товч дарж дүн оруулна.

---

## Холбогдох

- API заавар: [POS_API.md](POS_API.md) — endpoint бүрд request /
  response жишээ + retry policy
- Backend log: `docker compose logs -f backend`
- DB SQL prompt: `docker compose exec db psql -U flux -d flux`
