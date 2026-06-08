# POS app — Түгээгүүр / нозул / шатахуун логик

POS app хөгжүүлж буй хүний асуултанд бэлдсэн handover. Pump-Nozzle-FuelGrade
гурвуулын харьцаа Flux Monitor систем дотор хэрхэн илэрхийлэгдэх, POS app
ямар бүтэцтэйгээр харуулах, manual ямар flow-аар бичигдсэн талаар.

---

## 1. Үндсэн ойлголтууд (3 түвшин)

```
┌──────── ШТС ─────────┐
│                       │
│  ┌────── PUMP ──────┐ │   ← Түгээгүүр (1..100). Бие физик "багана"
│  │                  │ │
│  │  ┌── NOZZLE ──┐  │ │   ← Хошуу (1..6 на нэг pump).
│  │  │  АИ-92     │  │ │     Хошуу бүр өөрийн шатахууны төрөлтэй.
│  │  └────────────┘  │ │
│  │  ┌── NOZZLE ──┐  │ │
│  │  │  АИ-95     │  │ │
│  │  └────────────┘  │ │
│  │                  │ │
│  └──────────────────┘ │
└───────────────────────┘
```

- **PUMP** (Түгээгүүр) — биет түгээгүүр (1-ээс 100 хүртэлх логик дугаартай).
  Нэг pump-д **1-6 хошуу** байж болно.
- **NOZZLE** (Хошуу) — хошуу нь шатахууны нэг **FuelGrade**-тэй холбогдсон.
  Хошуу 1 = АИ-92 байж магадгүй, хошуу 2 = АИ-95.
- **FUEL GRADE** — шатахууны төрөл (АИ-92, АИ-95, ДТ, LPG г.м.). PTS-2-д
  тохируулсан **FuelGradeId** (1..20) бөгөөд үнэтэй холбогддог.

PTS-2 контроллер нь pump бүрийн **бодит цагийн төлвийг** тогтмол явуулдаг:

| PTS-2 status | Тайлбар |
|---|---|
| `IdleStatus` | Pump хоосон зогсоо. Хэрэв `Nozzle > 0` бол **хошуу сугалсан** (хүлээж байна) |
| `FillingStatus` | Pump шахаж байна. `Nozzle` = аль хошуугаар |
| `EndOfTransactionStatus` | Шахаж дууссан, гүйлгээ хаагдаагүй |
| `OfflineStatus` | Pump-тай холбоо алга |

## 2. Pump хэдэн хошуутайг хаанаас мэдэх вэ

Хоёр эх сурвалж:

### 2a. Бодит цагийн live state (`/api/pos/pumps`-ээс)

PTS-2-ийн `IdleStatus[pumpN].Nozzle` талбар нь **тухайн агшинд** аль хошууг
сугалсаныг харуулна. Тэгэхээр POS app-н flow:
1. Customer/cashier нь физикийн **тэр хошуунуудаас сонгож** сугална
2. PTS-2 нь даруй `IdleStatus.Nozzle = N` болгож илгээнэ
3. POS app `/api/pos/pumps`-аас тэр pump-ыг `status: "ready"` гэж хардаг
4. POS app тэр pump-ыг сонгуулах боломжтой

Энэ flow-д **POS app өөрөө хошуу сонгож илгээх шаардлагагүй** — physical
сугалга нь PTS-2-руу тэр хошууг хэлдэг.

### 2b. Configured тохиргоо (хариу татахад дутуу)

PTS-2-д `SetPumpNozzlesConfiguration` packet-аар pump бүрийн нозлуудыг
тохируулдаг (нэг удаа суулгахдаа):
- Pump 2 → нозул 1 = АИ-92, нозул 2 = АИ-95
- Pump 3 → нозул 1 = ДТ

Энэ тохиргоог манай систем одоохондоо `pump_status_json.fuel_grades`-аас
бүх нийт available шатахууны төрлийг буцаадаг (per-nozzle mapping биш).
Per-nozzle mapping-ийг хэрэгтэй болохоор PTS-2-ээс дамжуулан татах
endpoint нэмэх хэрэгтэй болно (доор PR санал).

## 3. POS app дээр pump эсвэл хошуу аль аль харуулах вэ?

**Богино хариу: pump-ыг харуулна уу**.

Шалтгаан:
1. Хэрэглэгч/жолооч нь физикийн pump-ийг хайж очдог
2. Хүн **тэр pump дээрээ** өөрийн хүссэн хошууг (АИ-92 эсвэл АИ-95) сугална
3. PTS-2 даруй "Pump 2 → Nozzle 1 (АИ-92)" гэж тогтооно
4. POS app тэр pump-ийг `status: "ready"` гэж хардаг → cashier "Pump 2 — АИ-92" гэж зүгээр баталгаажуулна

Тэгэхээр UX:
- Top grid: **pump-ууд** + бодит цагийн status (4 төлөв) + хошуу сугалсан
  бол `nozzle` тоо + `fuel_grade_name` (АИ-92 г.м.)
- "ready" pump дарахаар → дүн оруулах screen
- `start-dispense` дуудахад `fuel_grade_id` биш `nozzle` дамжуулна

## 4. `/api/pos/pumps` API хариу — баримттай мэдээлэл

```http
GET /api/pos/pumps?station_id=10
Authorization: Bearer <token>
```

```json
[
  {
    "pump_number": 1,
    "nozzle": null,
    "status": "idle",
    "fuel_grade_id": null,
    "fuel_grade_name": null,
    "fuel_grade_price": null,
    "current_volume": null,
    "current_amount": null,

    "last_fuel_grade_id": null,
    "last_fuel_grade": null
  },
  {
    "pump_number": 2,
    "nozzle": 1,
    "status": "ready",
    "fuel_grade_id": 1,
    "fuel_grade_name": "АИ-92",
    "fuel_grade_price": 2490,
    "current_volume": null,
    "current_amount": null,

    "last_fuel_grade_id": 1,
    "last_fuel_grade": "АИ-92"
  },
  {
    "pump_number": 3,
    "nozzle": 1,
    "status": "busy",
    "fuel_grade_id": 1,
    "fuel_grade_name": "АИ-92",
    "fuel_grade_price": 2490,
    "current_volume": 12.5,
    "current_amount": 31125,

    "last_fuel_grade_id": 1,
    "last_fuel_grade": "АИ-92"
  },
  {
    "pump_number": 4,
    "nozzle": null,
    "status": "offline",
    ...
  }
]
```

### POS app status filtering

| Status | UX | Actionable? |
|---|---|---|
| `ready` | Ногоон, хошуу сугалсан, fuel_grade нэртэй | ✅ Дарахад дүн оруулах screen |
| `busy` | Шар/улаан, current_volume харагдана | ❌ Хүлээх — "filling" |
| `idle` | Саарал | ❌ Хошуугаа сугалаагүй учир |
| `offline` | Хар саарал | ❌ Контроллер харагдахгүй |

## 5. Жинхэнэ гайхмаар нөхцөлүүд

### "Сая 4 pump-ыг бүгдийг 'idle' гэж буцааж байна"
Энэ нь backend-ийн bug байсан (commit `12daab0`-ийн дараа засагдсан).
Шалтгаан: `/api/pos/pumps` нь `pump_status_json.idle["2"]` гэдэг dict-ийг
list гэж бодон давтаж байсан. Одоо direct dict access болсон.

### "Pump 2 дээр хошуу 1 сугалсан, гэвч `nozzle: null` ирж байна"
- PTS-2 simulator нь `Nozzle: 1` field-ийг IdleStatus-д хийж байгаа эсэхийг
  шалга. Жишээгээр `"State": "Nozzle"` биш `IdleStatus.Nozzle = 1` бичигдсэн
  байх ёстой.
- `pump_status_json` дотор юу байгааг шалгах:
  ```sql
  SELECT pump_status_json::jsonb #>> '{idle}' FROM pts_controllers WHERE id=1;
  ```
- Хэрэв firmware-аас зөв ирж байгаа ч API-аас дутуу бол — log тавиад
  явуулна уу, жижиг засвар хийнэ.

### "Pump-ыг сонгож хошуугаа сонгох" логик
Хэрэв нэг pump дээр **2+ хошуу сугалсан** (физик байж болно?)... PTS-2 нь
ердөө 1-ийг л report-доорно (хамгийн сүүлд сугалсныг). Хэрэв POS app
давхар сонголт өгмөөр бол client-side dropdown нэмж болно — pump бүрийн
бүх available хошуунуудыг харуулах. Тэр logic ирэх PR-д орно (per-nozzle
config endpoint).

## 6. End-to-end flow — POS app хийх ёстой алхам

```
┌─────────────────────────┐
│ 1. NFC employee login   │ POST /api/auth/pos-nfc-login
│    → JWT (12h)          │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ 2. Customer карт уншуул │ POST /api/pos/lookup-card
│    → loyalty/corporate  │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ 3. Live pump grid       │ GET /api/pos/pumps?station_id=10
│    (every 2-3 sec)      │ Filter status='ready' for tappable pumps
└─────────┬───────────────┘
          │
          │ Cashier picks 'ready' pump (e.g. #2)
          ▼
┌─────────────────────────┐
│ 4. Дүн оруулах          │ Numpad UI, 0-9
│                         │ pump.nozzle тогтоосон
│                         │ pump.fuel_grade_id тогтоосон
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ 5. Эхлэх                │ POST /api/pos/start-dispense
│                         │ {station_id, pump=2, nozzle=1,
│                         │  fuel_grade_id=1, dose=50000,
│                         │  card_id=<from step 2>}
│                         │ → command_id
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ 6. Status poll          │ GET /api/pos/dispense/{cmd_id}/status
│    every 1.5-2 s        │ ?pump=2&station_id=10
│                         │
│  pending → sent →       │
│  acknowledged →         │
│  filling → completed    │
└─────────┬───────────────┘
          │
          │ Wait until status='completed' OR 'failed'
          ▼
┌─────────────────────────┐
│ 7. Төлбөр (bank SDK)    │ Local bank/eBarimt SDK call
│    → approval_code      │
│    → vat_receipt_number │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ 8. Finalize             │ POST /api/pos/finalize
│                         │ {transaction_id, payment_method,
│                         │  bank_approval_code,
│                         │  vat_receipt_number, vat_type, ...}
└─────────────────────────┘
```

## 7. Тест alh ay

PTS-2 Unipump simulator → pump 2 дээр nozzle 1 сугалаад "Trigger ON" болго
→ /api/pos/pumps дуудаад pump 2 дээр `status: "ready"`, `nozzle: 1`,
`fuel_grade_id: 1`, `fuel_grade_name: "АИ-92"` ирж байгааг шалга.

```bash
TOKEN=$(curl -s -X POST https://uboil.flux.mn/api/auth/pos-nfc-login \
  -H 'Content-Type: application/json' \
  -d '{"nfc_tag":"04A1B2C3D4E5F6"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')

curl -s "https://uboil.flux.mn/api/pos/pumps?station_id=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

POS app handler-аас энэ JSON-ийг авсаны дараа `status === 'ready'` гэсэн
pump-уудыг л дарагдах боломжтой болгож харуул. `idle` хэвээр байгаа
бусдыг саарал болгож, `busy`-аар фон шар болгож "..." progress нэмж
харуулж болно.
