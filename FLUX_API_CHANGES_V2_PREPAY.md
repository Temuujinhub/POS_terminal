# 🆕 Flux POS API — Prepay/Postpay Flow Шаардлага (V2)

> **Зорилго:** POS аппын талаас (Mongolian POS app) Flux API серверт нэмэх ёстой өөрчлөлтийг flux-api багт явуулах техникийн тодорхойлолт.
> **Огноо:** 2026-05-22  
> **Хариуцагч:** Flux API team (`uboil.flux.mn`)  
> **Хүсэлт явуулсан:** UBoil POS app team

---

## 📋 Хураангуй

POS аппад **prepay (урьдчилсан төлбөр)** болон **postpay (дараа төлбөр)** хоёр урсгалыг **нэг гүйлгээний моделд** дэмжих хэрэгцээ гарсан. Одоо Flux API нь зөвхөн "шахалт → finalize" гэсэн ерөнхий урсгалтай. Үүнийг өргөтгөж дараах өөрчлөлтийг хийнэ үү.

### Яагаад хэрэгтэй вэ?

| Урсгал | Хэзээ хэрэглэгдэх | Жишээ |
|--------|------------------|-------|
| **Prepay** | Үйлчлүүлэгч урьдчилж бэлэн/QPay/банк картаар төлсний дараа жолооч шахдаг | "₮20,000 АИ-92 авна" → касс төлбөр авна → жолооч шахна → дуусахад илүүдэл буцаах |
| **Postpay** | Шахалт хийгдсэний дараа төлбөр авдаг (одоогийн ердийн урсгал) | Хошуу авна → шахалт → дуусахад дүн нь тогтоход төлбөр авна |
| **Postpay + Fuel Card** | Корпорацын шатахуун карт — `start-dispense`-д balance lock хийнэ, finalize-д true-up | Одоогийн `card_type=corporate` урсгал |

---

## 1. Transaction model — Шинэ талбарууд

```python
class Transaction(Base):
    # ... existing fields ...
    
    # 🆕 NEW
    payment_flow = Column(String(16), nullable=False, default="postpay")
    # values: "prepay" | "postpay"
    
    prepaid_amount = Column(Numeric(12, 2), nullable=True)
    # prepay горимд хэрэглэгчээс авсан үнэ (₮). postpay үед NULL
    
    prepaid_at = Column(DateTime(timezone=True), nullable=True)
    # prepay төлбөр амжилттай авагдсан timestamp. NULL = төлөөгүй буюу postpay
    
    vat_printed_at = Column(DateTime(timezone=True), nullable=True)
    # НӨАТ-ийн баримт хэвлэгдсэн timestamp (eBarimt SDK амжилттай дууссанаар)
    # `vat_receipt_number` ирэхтэй давхар, гэхдээ үнэн зөв хугацааг хадгална.
```

### Database migration (PostgreSQL)

```sql
-- /backend/alembic/versions/xxx_add_prepay_flow.py
ALTER TABLE transactions
    ADD COLUMN payment_flow VARCHAR(16) NOT NULL DEFAULT 'postpay',
    ADD COLUMN prepaid_amount NUMERIC(12, 2) NULL,
    ADD COLUMN prepaid_at TIMESTAMPTZ NULL,
    ADD COLUMN vat_printed_at TIMESTAMPTZ NULL;

-- Index для запросов "active prepay-ed but not yet dispensed":
CREATE INDEX idx_tx_payment_flow_state
    ON transactions (payment_flow, state)
    WHERE payment_flow = 'prepay';
```

---

## 2. POS Router (`pos.py`) — endpoint өөрчлөлтүүд

### 2.1 `POST /api/pos/start-dispense` — `payment_flow` нэмнэ

```python
class StartDispenseRequest(BaseModel):
    pump: int
    nozzle: Optional[int] = None
    fuel_grade_id: Optional[int] = None
    dose_type: Literal["Amount", "Volume", "FullTank"]
    dose: Optional[float] = None
    card_id: Optional[int] = None
    nfc_tag: Optional[str] = None
    auto_close: bool = True
    
    # 🆕 NEW
    payment_flow: Literal["prepay", "postpay"] = "postpay"
    # Урьдчилсан төлбөрөөр шахах эсэх. Default postpay (одоогийн зан үйл).
    
    prepayment: Optional[PrepaymentBlock] = None
    # payment_flow="prepay" үед заавал илгээнэ
```

```python
class PrepaymentBlock(BaseModel):
    """Prepay урсгалд жолоочийн төлсөн төлбөрийн мэдээлэл."""
    amount: float  # ₮. Эерэг тоо.
    method: Literal["cash", "bank_card", "qpay", "fuel_card"]
    
    # Payment SDK-аас ирсэн confirm мэдээлэл
    bank_approval_code: Optional[str] = None
    bank_rrn: Optional[str] = None
    bank_masked_pan: Optional[str] = None
    bank_terminal_id: Optional[str] = None
    qpay_invoice_id: Optional[str] = None
    qpay_payment_id: Optional[str] = None
    
    # eBarimt SDK-аас ирсэн НӨАТ-ийн баримтын дугаар (хэвлэсэн бол)
    vat_receipt_number: Optional[str] = None
    vat_type: Optional[Literal["Иргэн", "Бараа худалдан авагч", "Байгууллага"]] = "Иргэн"
    vat_register: Optional[str] = None
```

**Backend логик:**

```python
@router.post("/start-dispense")
async def start_dispense(req: StartDispenseRequest, ...):
    if req.payment_flow == "prepay":
        if not req.prepayment:
            raise HTTPException(400, "prepayment is required for payment_flow=prepay")
        if req.dose_type == "FullTank":
            raise HTTPException(400, "FullTank cannot be used with prepay flow")
        if req.prepayment.amount <= 0:
            raise HTTPException(400, "prepayment.amount must be > 0")
        
        # Бэлэн төлбөр аль хэдийн авагдсаныг үндэслэн транзакц үүсгэнэ
        # (DB-д бичигдэх боловч pump-руу одоогоор illy командыг илгээж эхэлнэ).
        tx = Transaction(
            state="prepaid",  # шинэ state
            payment_flow="prepay",
            prepaid_amount=req.prepayment.amount,
            prepaid_at=datetime.now(timezone.utc),
            vat_receipt_number=req.prepayment.vat_receipt_number,
            vat_type=req.prepayment.vat_type,
            ...
        )
    else:
        # одоогийн "postpay" урсгал
        ...
    
    return {
        "command_id": cmd_id,
        "transaction_id": tx.id,   # 🆕 prepay үед бичигдсэн tx.id-г буцаана (postpay үед None)
        "payment_flow": req.payment_flow,
        "pump": req.pump,
        ...
    }
```

### 2.2 `POST /api/pos/finalize` — 2 урсгал салгана

```python
@router.post("/finalize")
async def finalize_transaction(req: FinalizeRequest, ...):
    tx = await get_transaction(req.transaction_id)
    
    if tx.payment_flow == "prepay":
        # 🆕 Prepay урсгал
        # Төлбөр аль хэдийн авагдсан тул зөвхөн зөрүүг тооцоолно
        actual_amount = tx.total_amount  # шахалт дууссаны дараа Flux-д бичигдсэн
        diff = tx.prepaid_amount - actual_amount
        
        if diff > 0:
            # Хэрэглэгч илүү төлсөн → буцаах ёстой
            tx.refund_amount = diff
            tx.refund_method = req.refund_method  # "cash" | "bank_reverse" | "fuel_card"
            tx.refund_at = datetime.now(timezone.utc)
        elif diff < 0:
            # Үнэ өсөж бага шахагдсан тохиолдол шахалт автомат зогссон бол энд хүрэхгүй.
            # Хэрэв энэ tier-д хүрвэл "additional_charge" талбар нэмж тэмдэглэнэ.
            raise HTTPException(409, "Prepay underfunded; should not happen if auto_close=True")
        
        tx.state = "completed"
        tx.completed_at = datetime.now(timezone.utc)
    else:
        # одоогийн "postpay" урсгал
        ...
    
    return tx.to_dict()
```

**`FinalizeRequest`-д нэмэх:**

```python
class FinalizeRequest(BaseModel):
    transaction_id: int
    
    # Prepay урсгалд illy ашиглах:
    refund_method: Optional[Literal["cash", "bank_reverse", "fuel_card"]] = None
    
    # Postpay урсгалд (одоогийнхтой адил):
    payment_method: Optional[Literal["cash", "bank_card", "qpay", "fuel_card", "invoice"]] = None
    vat_receipt_number: Optional[str] = None
    vat_type: Optional[str] = None
    payment_lines: Optional[List[PaymentLine]] = None
    ...
```

### 2.3 `GET /api/pos/dispense/{command_id}/status` — урсгалын мэдээлэл

Хариунд `payment_flow` мэдээллийг буцаана:

```json
{
  "command_id": 12345,
  "status": "filling",
  "transaction": null,
  "fill_snapshot": { ... },
  "payment_flow": "prepay",
  "prepaid_amount": 20000,
  "prepaid_at": "2026-05-22T03:00:00Z"
}
```

POS клиент апп нь энэ мэдээллээр UI-д "Урьдчилж 20,000₮ төлсөн" гэж харуулна.

### 2.4 🆕 Шинэ endpoint: `GET /api/pos/active-dispenses`

**Зорилго:** Олон pump-ийг зэрэг ажиллуулахын тулд UI-д бүх ажиллаж буй гүйлгээний нэгдсэн жагсаалт хэрэгтэй (мини UI).

```python
@router.get("/active-dispenses")
async def list_active_dispenses(
    station_id: int = Query(...),
    user=Depends(current_user),
):
    """
    Тухайн станц дээр одоо ажиллаж буй (pending/sent/acknowledged/filling/eot)
    бүх dispense-уудыг буцаана. POS клиент аппын `/dashboard`-д mini-card-уудаар
    харуулна.
    """
    return {
        "items": [
            {
                "command_id": 1234,
                "transaction_id": 56789,  # хэрэв үүссэн бол
                "pump": 1,
                "nozzle": 2,
                "fuel_grade_name": "АИ-92",
                "status": "filling",
                "payment_flow": "prepay",
                "preset_dose_type": "Amount",
                "preset_dose": 20000,
                "current_volume": 3.45,
                "current_amount": 11730,
                "prepaid_amount": 20000,
                "started_at": "2026-05-22T03:00:00Z",
                "user_email": "...@example.mn",
            },
            ...
        ]
    }
```

**Хариу JSON-д заавал багтаах талбарууд:**
- `command_id`, `pump`, `nozzle`, `fuel_grade_name`
- `status` — Flux state machine-ийн ямар нэг state
- `payment_flow`
- `preset_dose_type`, `preset_dose` — progress bar тооцоход
- `current_volume`, `current_amount` — live snapshot
- `prepaid_amount` — prepay үед

---

## 3. PTS (Pump Terminal Service) Handler — `pts_jsonpts.py`

Pump controller-аас "шахалт дууссан" дохио ирэхэд Transaction үүсэх үед prepayment мэдээллийг шилжүүлнэ:

```python
async def on_eot_received(cmd: PendingCommand, fill_snapshot: dict):
    """End-of-Transaction үед pump-аас ирсэн бодит шахалтын мэдээгээр
    Transaction үүсгэх юм уу update хийнэ."""
    
    tx = cmd.transaction  # 🆕 prepay үед start-dispense-д аль хэдийн үүссэн байж болно
    
    if tx is None:
        # postpay урсгал — энд шинээр үүсгэнэ (одоогийнхтой адил)
        tx = Transaction(
            state="dispensed",
            payment_flow="postpay",
            volume_liters=fill_snapshot["volume"],
            total_amount=fill_snapshot["amount"],
            ...
        )
    else:
        # 🆕 prepay урсгал — аль хэдийн байгаа tx-ыг update хийнэ
        tx.volume_liters = fill_snapshot["volume"]
        tx.total_amount = fill_snapshot["amount"]
        tx.unit_price = fill_snapshot["price"]
        tx.fuel_grade_id = fill_snapshot["fuel_grade_id"]
        tx.fuel_grade_name = fill_snapshot["fuel_grade_name"]
        tx.dispensed_at = datetime.now(timezone.utc)
        tx.state = "dispensed"
        # prepaid_amount, prepaid_at нь өөрчлөгдөхгүй (start-dispense-д бичигдсэн)
    
    await db.commit()
    publish_to_websocket(cmd.command_id, "eot", tx)
```

---

## 4. `POS_API.md` — Documentation update

Дараах хэсгүүдийг шинэчлэх хэрэгтэй:

1. **Section 5 (start-dispense)** — `payment_flow` + `prepayment` request schema, prepay response sample
2. **Section 6 (dispense status)** — `payment_flow` хариунд орсон тухай
3. **Section 7 (finalize)** — Prepay vs Postpay салгасан хариу schema, refund logic
4. **Section 9 (active-dispenses)** — Шинэ endpoint document
5. **Section 11 (Walkthrough)** — Prepay сценарийн end-to-end жишээ:

```text
PREPAY WALKTHROUGH:
1. Касс жолоочоос ₮20,000 авна (cash/qpay/bank)
2. POS apps → eBarimt SDK → НӨАТ баримт хэвлэнэ
3. POS apps → POST /start-dispense с payment_flow="prepay", prepayment={amount: 20000, method:"cash", vat_receipt_number:"DD..."}
4. → Flux: transaction.id үүснэ, state="prepaid", дараа нь pump-руу команд илгээгдэнэ
5. POS apps → polling /dispense/{cmd}/status — fill_snapshot live харуулна
6. → "eot" ирэх үед шахалт дуусна (auto_close-аас илүү яваагүй учир нийт ≤ 20000₮)
7. POS apps → POST /finalize с transaction_id, refund_method="cash" (хэрэв шахагдсан < 20000 бол)
8. → Flux response: refund_amount = 20000 - actual. Касс зөрүүг буцаана.
```

---

## 5. Хариуцлагын хуваарь

| Тал | Үүрэг |
|-----|-------|
| **Flux API team** | 1-4-р хэсэгт заагдсан backend өөрчлөлт, DB migration, документаци |
| **POS App team (бид)** | Шинэ flow-г frontend дээр UI хийх, proxy backend-д endpoint-уудыг проксидох, prepay screen зурах |

---

## 6. Тестийн хүрээ

- [ ] `payment_flow=prepay` + `dose_type=Amount` + бэлэн → tx үүсэх, шахалт дуусахад refund тооцоо
- [ ] `payment_flow=prepay` + QPay payment → vat_receipt_number-ийг хадгална
- [ ] `payment_flow=postpay` (default) → одоогийн зан үйл өөрчлөгдөхгүй (regression test)
- [ ] `payment_flow=prepay` + `dose_type=FullTank` → 400 алдаа гарах
- [ ] `GET /active-dispenses` — 2 хошуу зэрэг ажиллахад хоёуланг буцаах
- [ ] `prepay` транзакц `void` хийгдэхэд `prepaid_amount`-г бүрэн буцаах

---

## 7. Хуваарь

| Алхам | Хариуцагч | Тооцоолсон хугацаа |
|------|-----------|--------------------|
| 1. Transaction model + migration | Flux backend | 1-2 өдөр |
| 2. `start-dispense` + `finalize` updates | Flux backend | 2-3 өдөр |
| 3. `active-dispenses` endpoint | Flux backend | 1 өдөр |
| 4. `pts_jsonpts.py` integration | Flux backend | 1 өдөр |
| 5. POS App proxy update | POS team | 1 өдөр |
| 6. POS App UI prepay flow | POS team | 2-3 өдөр |
| 7. End-to-end testing | Both | 2 өдөр |

---

> ❓ **Асуулт байвал** POS app team-тэй холбогдоно уу.
