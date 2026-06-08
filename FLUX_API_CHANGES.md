# Flux Monitor API — POS app-ийн шинэ боломжуудыг дэмжих өөрчлөлтүүд

Дата: 2026-05  
Бэлдсэн: Petrol POS frontend/proxy team  
Зориулсан: Flux Monitor (`uboil.flux.mn`) backend team

---

## ⚡ Эрэмбэлсэн өөрчлөлтийн жагсаалт (priority order)

| # | Өөрчлөлт | Endpoint | Priority | Тайлбар |
|---|---|---|---|---|
| 1 | EPOS SDK төлбөрийн талбарууд хадгалах | `POST /api/pos/finalize` | 🔴 P0 | Approval, RRN, trace, batch, cardholder, entry mode, merchant id хадгалах |
| 2 | Хэсэгчилсэн (split) төлбөр | `POST /api/pos/finalize` | 🔴 P0 | `payment_lines[]` array хүлээж авах |
| 3 | QPay invoice ID-г хадгалах | `POST /api/pos/finalize` | 🟡 P1 | EPOS QPay-аас гарсан `invoice_id` |
| 4 | Тайлан endpoint-д split breakdown харуулах | `GET /api/reports/transactions/{id}` | 🟢 P2 | Receipt-д хосолсон төлбөр харуулах |
| 5 | Hold endpoint (optional) | `POST/GET/DELETE /api/pos/holds` | ⚪ P3 | Манай backend-д аль хэдийн хэрэгжүүлсэн; Flux талд төвлөрүүлэх боломж |

---

## 1️⃣ EPOS SDK төлбөрийн талбарууд (P0)

### Шаардлагатай шалтгаан
DATABANK EPOS SDK 1.4-аар PAX A8900 терминалаас карт болон QPay төлбөр авч байгаа. Уг SDK нь `authCode`, `traceNo`, `rrn`, `batchNo`, `cardHolderName`, `entryModeText`, `terminalId`, `merchantId`, `merchantName` зэрэг талбаруудыг буцааж байна. Эдгээрийг **финансын аудит, маргаан шийдвэрлэлт, e-Barimt тайлан**-д заавал хадгалах ёстой.

### `POST /api/pos/finalize` — body schema нэмэлт

```json
{
  "transaction_id": 854153,
  "payment_method": "bank_card",
  "vat_receipt_number": "DD17786604984532907262933",
  "vat_type": "Иргэн",
  "vat_register": "",

  // ✨ ШИНЭ: EPOS-аас ирсэн төлбөрийн дэлгэрэнгүй
  "bank_payment": {
    "approval_code": "299581",        // authCode
    "rrn": "RRN7267497",
    "trace_no": "190354",             // traceNo
    "batch_no": "001",                // batchNo
    "masked_pan": "**** **** **** 4321",  // cardNo
    "card_type": "VISA",               // cardType (VISA/MASTER/MIR/...)
    "cardholder_name": "TEST/CUSTOMER",   // cardHolderName
    "entry_mode": "Contactless",         // entryModeText (Contactless/Chip/Mag/Manual)
    "terminal_id": "EPOSDEMO",
    "merchant_id": "990000000001",
    "merchant_name": "PETROL POS",
    "rsp_code": "000",                 // EPOS rspCode (000=success)
    "amount": "10000.00"
  }
}
```

### SQLAlchemy/Django ORM model жишээ

```python
# models/transaction_payment.py
from sqlalchemy import Column, BigInteger, String, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime

class TransactionPayment(Base):
    __tablename__ = "transaction_payments"
    
    id = Column(BigInteger, primary_key=True)
    transaction_id = Column(BigInteger, ForeignKey("transactions.id"), index=True, nullable=False)
    payment_method = Column(String(20), nullable=False)  # cash/bank_card/qpay/fuel_card/invoice
    amount = Column(BigInteger, nullable=False)
    
    # EPOS SDK fields (bank_card only)
    approval_code = Column(String(20))     # authCode
    rrn = Column(String(32))
    trace_no = Column(String(16))
    batch_no = Column(String(8))
    masked_pan = Column(String(24))
    card_type = Column(String(16))
    cardholder_name = Column(String(64))
    entry_mode = Column(String(16))
    terminal_id = Column(String(16))
    merchant_id = Column(String(20))
    merchant_name = Column(String(64))
    rsp_code = Column(String(8))
    
    # QPay
    qpay_invoice_id = Column(String(32))
    qpay_invoice_status = Column(String(16))
    
    # Fuel card
    fuel_card_id = Column(BigInteger)
    fuel_card_number = Column(String(32))
    
    raw_response = Column(JSONB)  # бүх raw data
    created_at = Column(DateTime, default=datetime.utcnow)
```

### Alembic migration

```python
"""Add transaction_payments table for EPOS SDK fields

Revision ID: a1b2c3d4e5f6
"""
def upgrade():
    op.create_table(
        "transaction_payments",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("payment_method", sa.String(20), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("approval_code", sa.String(20)),
        sa.Column("rrn", sa.String(32)),
        sa.Column("trace_no", sa.String(16)),
        sa.Column("batch_no", sa.String(8)),
        sa.Column("masked_pan", sa.String(24)),
        sa.Column("card_type", sa.String(16)),
        sa.Column("cardholder_name", sa.String(64)),
        sa.Column("entry_mode", sa.String(16)),
        sa.Column("terminal_id", sa.String(16)),
        sa.Column("merchant_id", sa.String(20)),
        sa.Column("merchant_name", sa.String(64)),
        sa.Column("rsp_code", sa.String(8)),
        sa.Column("qpay_invoice_id", sa.String(32)),
        sa.Column("qpay_invoice_status", sa.String(16)),
        sa.Column("fuel_card_id", sa.BigInteger()),
        sa.Column("fuel_card_number", sa.String(32)),
        sa.Column("raw_response", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"]),
    )
    op.create_index("ix_txn_payments_txn", "transaction_payments", ["transaction_id"])
```

### `/finalize` endpoint жишээ код (FastAPI)

```python
# routes/pos.py
from pydantic import BaseModel
from typing import Optional, List, Literal

class BankPaymentDetail(BaseModel):
    approval_code: Optional[str] = None
    rrn: Optional[str] = None
    trace_no: Optional[str] = None
    batch_no: Optional[str] = None
    masked_pan: Optional[str] = None
    card_type: Optional[str] = None
    cardholder_name: Optional[str] = None
    entry_mode: Optional[str] = None
    terminal_id: Optional[str] = None
    merchant_id: Optional[str] = None
    merchant_name: Optional[str] = None
    rsp_code: Optional[str] = None
    amount: Optional[str] = None


class QpayPaymentDetail(BaseModel):
    invoice_id: Optional[str] = None
    invoice_status: Optional[str] = None  # PAID / FAILED / EXPIRED
    rsp_code: Optional[str] = None


class PaymentLine(BaseModel):
    method: Literal["cash", "bank_card", "qpay", "fuel_card", "invoice"]
    amount: float
    card_id: Optional[int] = None
    card_number: Optional[str] = None
    bank_payment: Optional[BankPaymentDetail] = None
    qpay_payment: Optional[QpayPaymentDetail] = None


class FinalizeReq(BaseModel):
    transaction_id: int
    payment_method: Literal["cash", "bank_card", "qpay", "fuel_card", "invoice"]
    vat_receipt_number: str
    vat_type: Literal["Иргэн", "Бараа худалдан авагч", "Байгууллага"]
    vat_register: str = ""
    # Карт
    card_id: Optional[int] = None
    card_number: Optional[str] = None
    # Bank/QPay
    bank_payment: Optional[BankPaymentDetail] = None
    qpay_payment: Optional[QpayPaymentDetail] = None
    # ✨ Хэсэгчилсэн төлбөр
    payment_lines: Optional[List[PaymentLine]] = None


@router.post("/finalize")
async def finalize(req: FinalizeReq, user=Depends(auth_user)):
    tx = await db.fetch_transaction(req.transaction_id)
    if not tx:
        raise HTTPException(404, "Гүйлгээ олдсонгүй")
    if tx.station_id != user.station_id:
        raise HTTPException(403, "Эрх байхгүй")

    # 1. Validate
    lines = req.payment_lines or [
        PaymentLine(
            method=req.payment_method,
            amount=tx.total_amount,
            card_id=req.card_id,
            card_number=req.card_number,
            bank_payment=req.bank_payment,
            qpay_payment=req.qpay_payment,
        )
    ]
    total_paid = sum(l.amount for l in lines)
    if abs(total_paid - tx.total_amount) > 0.5:
        raise HTTPException(400,
            f"Төлбөрийн нийлбэр гүйлгээтэй тэнцэхгүй: {total_paid} ≠ {tx.total_amount}")

    # 2. Хадгалах
    async with db.transaction():
        await db.update_transaction(tx.id, 
            payment_method=req.payment_method,
            vat_receipt_number=req.vat_receipt_number,
            vat_type=req.vat_type,
            vat_register=req.vat_register,
            finalized_at=datetime.utcnow(),
            finalized_by=user.id,
        )
        for line in lines:
            await db.insert_payment(
                transaction_id=tx.id,
                method=line.method,
                amount=line.amount,
                card_id=line.card_id,
                card_number=line.card_number,
                **(line.bank_payment.dict(exclude_none=True) if line.bank_payment else {}),
                qpay_invoice_id=line.qpay_payment.invoice_id if line.qpay_payment else None,
                qpay_invoice_status=line.qpay_payment.invoice_status if line.qpay_payment else None,
            )

    # 3. Шатахуун картын үлдэгдэл хасах (хэрвээ fuel_card line байгаа бол)
    for line in lines:
        if line.method == "fuel_card" and line.card_id:
            await fuel_cards.debit(line.card_id, line.amount, ref_tx=tx.id)

    return {
        "transaction_id": tx.id,
        "total_amount": tx.total_amount,
        "volume_liters": tx.volume_liters,
        "payment_lines": [l.dict() for l in lines],
        "vat_receipt_number": req.vat_receipt_number,
        "pos_finalized_at": datetime.utcnow().isoformat(),
    }
```

---

## 2️⃣ Хэсэгчилсэн (split) төлбөр (P0)

### Шаардлагатай шалтгаан
Үйлчлүүлэгч нэг гүйлгээг 2 төрлийн төлбөрөөр төлөх боломжтой (жишээ: 5,000₮ бэлэн + 5,000₮ карт). Одоогоор Flux нь зөвхөн нэг `payment_method` хадгалдаг бөгөөд тайланд бүрэн харагдахгүй.

### Шинэ field: `payment_lines[]`

Дээрх Pydantic model болон жишээ кодыг үзнэ үү. Нэг гүйлгээнд **дээд тал нь 5 line** (одоогоор UI 2 line зөвшөөрнө).

### Validation rules
1. `sum(payment_lines[].amount) == transaction.total_amount` (±0.5₮ tolerance)
2. Тус бүр line дотор `method` ялгаатай байх ёстой (давтагдашгүй)
3. `bank_card` line бол `bank_payment` block шаардлагатай
4. `fuel_card` line бол `card_id` шаардлагатай ба үлдэгдэл хүрэлцэх ёстой
5. `qpay` line бол `qpay_payment.invoice_status == "PAID"` байх ёстой

---

## 3️⃣ QPay invoice ID хадгалалт (P1)

### Шинэ field
- `qpay_payment.invoice_id` — EPOS QPay-аас үүсгэсэн invoice
- `qpay_payment.invoice_status` — PAID/FAILED/EXPIRED

QPay API-тэй reconcile хийх боломжтой (өөр өдрийн тайланд орлого зөрсөн тохиолдолд).

### QPay tracking endpoint жишээ (optional)

```python
@router.get("/api/pos/qpay-status/{invoice_id}")
async def qpay_check(invoice_id: str, user=Depends(auth_user)):
    """QPay invoice статусыг тогтмол шалгана"""
    # QPay merchant API-руу хүсэлт явуулна
    status = await qpay_client.check(invoice_id)
    return {"invoice_id": invoice_id, "status": status}
```

---

## 4️⃣ Тайлан endpoint sсhema (P2)

### `GET /api/reports/transactions/{id}` response жишээ

```json
{
  "id": 854153,
  "station_id": 99,
  "pump_number": 1,
  "fuel_grade_name": "АИ-92",
  "volume_liters": 3.39,
  "total_amount": 10000,
  "unit_price": 2950,
  "started_at": "2026-05-13T08:00:00Z",
  "finalized_at": "2026-05-13T08:01:23Z",
  
  "vat_receipt_number": "DD17786604984532907262933",
  "vat_type": "Иргэн",
  "vat_register": "",
  
  "payment_method": "bank_card",  // primary method (first line)
  "payment_lines": [
    {
      "method": "cash",
      "amount": 5000
    },
    {
      "method": "bank_card",
      "amount": 5000,
      "bank_payment": {
        "approval_code": "299581",
        "rrn": "RRN7267497",
        "trace_no": "190354",
        "batch_no": "001",
        "masked_pan": "**** **** **** 4321",
        "card_type": "VISA",
        "cardholder_name": "TEST/CUSTOMER",
        "entry_mode": "Contactless",
        "terminal_id": "EPOSDEMO",
        "merchant_id": "990000000001"
      }
    }
  ]
}
```

---

## 5️⃣ Hold endpoint (P3, optional)

Манай proxy backend талд MongoDB `pos_holds` collection-д хэрэгжүүлсэн. Flux талд төвлөрүүлэх шаардлагагүй боловч хэрвээ хүсвэл:

```
POST   /api/pos/holds       Body: { tx_id, payload }     → { hold_id }
GET    /api/pos/holds       → { items: [...], count }   (station_wide, max 3, 24h expire)
DELETE /api/pos/holds/{id}                              → { deleted }
```

Манай талын schema (reference):
```json
{
  "hold_id": "uuid",
  "station_id": 99,
  "user_id": 123,
  "user_email": "cashier@example.com",
  "payload": {
    "tx_id": 854153,
    "total": 10000,
    "liters": 3.39,
    "fuel_grade_name": "АИ-92",
    "pump": 1, "nozzle": 2,
    "transaction": { ... },
    "paymentMethod": "cash",
    "vatType": "Иргэн", "vatRegister": "", "vatReceipt": "DD...",
    "splitMode": false, "secondMethod": "bank_card", "firstAmount": "",
    "paxStatus": "idle", "paxResult": null,
    "cardStatus": "idle", "card": null,
    "saved_at": "2026-05-13T08:21:49Z"
  },
  "created_at": "...",
  "expires_at": "..."
}
```

---

## 6️⃣ Жижиг засварууд (хэдийн ажиллаж байгаа боловч баримтжуулах)

### EOT state — fill_snapshot хариу хэлбэр

`GET /api/pos/dispense/{cmd_id}/status` нь `eot` state үед `fill_snapshot` field-г бүрэн буцаах ёстой (одоогоор зөв ажиллаж байна):

```json
{
  "command_id": 70,
  "status": "eot",
  "transaction": null,
  "fill_snapshot": {
    "pump": 1,
    "nozzle": 2,
    "volume": 3.39,
    "amount": 10000,
    "price": 2950,
    "fuel_grade_id": 1,
    "fuel_grade_name": "АИ-92"
  }
}
```

POS app нь EOT-ийг хүлээж авмагц receipt дэлгэцийг урьдаж нээж дараа `completed` event дээр transaction.id-аар update хийнэ (Strategy A — POS_APP_DEVELOPER_GUIDE.md §2.3).

### Pump grid response — pump_state field

Pump grid response-д `pump_state` field (`idle/auth/filling/eot/offline`) аль хэдийн орж байна. POS app нь үүнийг өөрийн UI-руу мап хийдэг (`auth` → tappable, `idle` → disabled).

---

## 📋 Migration checklist

Хэрэгжүүлэх дарааллын санал (Flux team-д):

- [ ] **P0a** Migration: `transaction_payments` table нэмэх
- [ ] **P0b** `/api/pos/finalize` body schema-д `bank_payment`, `qpay_payment`, `payment_lines` field нэмэх
- [ ] **P0c** Backward compatible: хуучин client-аас `payment_method` талбараар л ирсэн хүсэлт ажиллах
- [ ] **P0d** Тайлан query-д `payment_lines`-ийг join хийж буцаах
- [ ] **P1** QPay invoice reconciliation cron (тогтсон тутамд PAID статус шалгах)
- [ ] **P2** Хуучин `transactions.bank_approval_code` column-ийг `transaction_payments` руу migrate хийх (optional, deprecate it)
- [ ] **Test** `/finalize` integration тест: 1 line, 2 line split, fuel card, QPay invoice, bank+cash split

---

## 🔐 Backward compatibility

Бүх шинэ field-үүд **optional** учир хуучин POS client-аас ирсэн `bank_approval_code` шиг хуурамчуудтай хүсэлт мөн адил хүлээн авна. Бид proxy талд хуучин field-ыг шинэ schema-руу map хийж дамжуулна:

```python
# Манай talд (POS proxy)
if req.bank_approval_code and not req.bank_payment:
    req.bank_payment = BankPaymentDetail(approval_code=req.bank_approval_code)
```

---

## 📞 Холбоо

Асуулт байвал POS app team-руу холбогдоно уу. EPOS SDK 1.4 документ болон POS_APP_DEVELOPER_GUIDE-ийг хуваалцана.

**EPOS SDK action references:**
- `android.epos.payment.sale`
- `android.epos.payment.qpayPayment`  
- `android.epos.payment.readRfCard`
- `android.epos.payment.void`
