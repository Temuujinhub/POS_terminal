from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from contextlib import asynccontextmanager
import os
import asyncio
import logging
import random
import string
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
# Load .env if present (local dev). In production, env comes from the runtime.
_env_file = ROOT_DIR / '.env'
if _env_file.exists():
    load_dotenv(_env_file)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'test_database')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

app = FastAPI(title="Gas Station POS API")
api_router = APIRouter(prefix="/api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Run seeding in background so a slow Atlas connection never blocks readiness.
    asyncio.create_task(_safe_seed())
    yield
    # Cleanup: close shared Flux HTTP client + Mongo
    try:
        from flux_client import close_flux_client
        await close_flux_client()
    except Exception:
        pass
    client.close()


async def _safe_seed():
    try:
        await seed_data()
        logger.info("Seed data ensured.")
    except Exception as e:  # noqa: BLE001
        logger.exception("Seed data failed (non-fatal): %s", e)


# ============= MODELS =============
class Operator(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    pin: str
    nfc_uid: Optional[str] = None
    role: str = "cashier"


class Pump(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    number: int
    name: str
    fuel_types: List[str]
    status: Literal["free", "in_use", "offline"] = "free"


class FuelPrice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    fuel_type: str
    price_per_liter: float
    color: str


class MembershipCard(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    card_number: str
    holder_name: str
    customer_type: Literal["individual", "organization"]
    register_number: str
    balance: float


class Organization(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    register_number: str
    name: str


class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    operator_id: str
    operator_name: str
    pump_id: str
    pump_number: int
    fuel_type: str
    liters: float
    price_per_liter: float
    amount: float
    payment_method: Literal["cash", "card", "membership"]
    membership_card: Optional[str] = None
    customer_type: Literal["individual", "organization"] = "individual"
    register_number: Optional[str] = None
    customer_name: Optional[str] = None
    ebarimt_lottery: str
    ebarimt_bill_id: str
    ebarimt_qr_data: str
    status: Literal["completed", "cancelled"] = "completed"
    printed: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ============= REQUEST MODELS =============
class PinLoginReq(BaseModel):
    pin: str


class MembershipLookupReq(BaseModel):
    card_number: str


class NfcLoginReq(BaseModel):
    nfc_uid: str


class CreateTransactionReq(BaseModel):
    operator_id: str
    pump_id: str
    fuel_type: str
    liters: float
    amount: float
    payment_method: Literal["cash", "card", "membership"]
    membership_card: Optional[str] = None
    customer_type: Literal["individual", "organization"] = "individual"
    register_number: Optional[str] = None
    customer_name: Optional[str] = None


class MarkPrintedReq(BaseModel):
    transaction_id: str


# ============= HELPERS =============
def gen_lottery():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=10))


def gen_bill_id():
    return "".join(random.choices(string.digits, k=33))


def build_qr_data(bill_id: str, lottery: str, amount: float, register: str = ""):
    # Mock e-barimt QR data
    return f"https://ebarimt.mn/?billId={bill_id}&lottery={lottery}&amount={amount}&reg={register}"


# ============= SEED =============
async def seed_data():
    if await db.operators.count_documents({}) == 0:
        ops = [
            Operator(name="Бат-Эрдэнэ", pin="1234", nfc_uid="04:A1:B2:C3:D4:E5:F0"),
            Operator(name="Дөлгөөн", pin="5678", nfc_uid="04:11:22:33:44:55:66"),
            Operator(name="Энхбаяр", pin="0000", nfc_uid="04:AA:BB:CC:DD:EE:FF"),
        ]
        await db.operators.insert_many([o.model_dump() for o in ops])
    else:
        # Backfill nfc_uid for existing operators (idempotent migration)
        nfc_map = {
            "Бат-Эрдэнэ": "04:A1:B2:C3:D4:E5:F0",
            "Дөлгөөн": "04:11:22:33:44:55:66",
            "Энхбаяр": "04:AA:BB:CC:DD:EE:FF",
        }
        for name, uid in nfc_map.items():
            await db.operators.update_one(
                {"name": name, "$or": [{"nfc_uid": None}, {"nfc_uid": {"$exists": False}}]},
                {"$set": {"nfc_uid": uid}}
            )

    if await db.pumps.count_documents({}) == 0:
        fuels = ["АИ-92", "АИ-95", "Дизель"]
        pumps = [
            Pump(number=i, name=f"Түгээгүүр №{i}", fuel_types=fuels, status="free")
            for i in range(1, 9)
        ]
        await db.pumps.insert_many([p.model_dump() for p in pumps])

    if await db.fuel_prices.count_documents({}) == 0:
        prices = [
            FuelPrice(fuel_type="АИ-92", price_per_liter=2850, color="#10B981"),
            FuelPrice(fuel_type="АИ-95", price_per_liter=3050, color="#0F766E"),
            FuelPrice(fuel_type="Дизель", price_per_liter=3200, color="#F97316"),
        ]
        await db.fuel_prices.insert_many([p.model_dump() for p in prices])

    if await db.membership_cards.count_documents({}) == 0:
        cards = [
            MembershipCard(card_number="1000000001", holder_name="Болормаа Б.",
                           customer_type="individual", register_number="УБ12345678", balance=250000),
            MembershipCard(card_number="1000000002", holder_name="Очир Д.",
                           customer_type="individual", register_number="УЕ87654321", balance=85000),
            MembershipCard(card_number="1000000003", holder_name='"Тэнгэр Тээвэр" ХХК',
                           customer_type="organization", register_number="6123456", balance=1500000),
            MembershipCard(card_number="1000000004", holder_name='"Алтан Зам" ХХК',
                           customer_type="organization", register_number="5987654", balance=720000),
            MembershipCard(card_number="1000000005", holder_name="Сүхбаатар П.",
                           customer_type="individual", register_number="ХА19920512", balance=42000),
        ]
        await db.membership_cards.insert_many([c.model_dump() for c in cards])

    if await db.organizations.count_documents({}) == 0:
        orgs = [
            Organization(register_number="6123456", name='"Тэнгэр Тээвэр" ХХК'),
            Organization(register_number="5987654", name='"Алтан Зам" ХХК'),
            Organization(register_number="2034567", name='"Монгол Газрын Тос" ХХК'),
            Organization(register_number="2876543", name='"Эрдэнэт Үйлдвэр" ХК'),
            Organization(register_number="5712398", name='"Шунхлай Групп" ХХК'),
            Organization(register_number="4456789", name='"Ноёд Логистикс" ХХК'),
            Organization(register_number="3678901", name='"Тэнхлэг Барилга" ХХК'),
            Organization(register_number="6234567", name='"МСС Холдинг" ХХК'),
            Organization(register_number="7890123", name='"Капитрон Банк" ХХК'),
            Organization(register_number="2345678", name='"Гоё Бүтээгдэхүүн" ХХК'),
        ]
        await db.organizations.insert_many([o.model_dump() for o in orgs])


# ============= AUTH =============
@api_router.post("/auth/pin-login")
async def pin_login(req: PinLoginReq):
    op = await db.operators.find_one({"pin": req.pin}, {"_id": 0})
    if not op:
        raise HTTPException(status_code=401, detail="ПИН код буруу байна")
    return {"operator": op}


@api_router.post("/auth/nfc-login")
async def nfc_login(req: NfcLoginReq):
    uid = req.nfc_uid.upper().replace("-", ":").strip()
    op = await db.operators.find_one({"nfc_uid": uid}, {"_id": 0})
    if not op:
        raise HTTPException(status_code=401, detail="NFC карт бүртгэлгүй байна")
    return {"operator": op}


@api_router.get("/operators/nfc-list")
async def list_nfc_cards():
    """Demo helper - lists registered NFC UIDs (for Expo Go simulation only)."""
    ops = await db.operators.find({}, {"_id": 0, "pin": 0}).to_list(100)
    return ops


# ============= PUMPS =============
@api_router.get("/pumps")
async def get_pumps():
    pumps = await db.pumps.find({}, {"_id": 0}).sort("number", 1).to_list(100)
    return pumps


@api_router.get("/fuel-prices")
async def get_fuel_prices():
    prices = await db.fuel_prices.find({}, {"_id": 0}).to_list(100)
    return prices


@api_router.get("/organizations/lookup")
async def organization_lookup(register: str):
    org = await db.organizations.find_one({"register_number": register.strip()}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="Байгууллага олдсонгүй")
    return org



# ============= MEMBERSHIP =============
@api_router.post("/membership/lookup")
async def membership_lookup(req: MembershipLookupReq):
    card = await db.membership_cards.find_one({"card_number": req.card_number}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Карт олдсонгүй")
    return card


@api_router.get("/membership")
async def list_membership():
    cards = await db.membership_cards.find({}, {"_id": 0}).to_list(100)
    return cards


# ============= TRANSACTIONS =============
@api_router.post("/transactions")
async def create_transaction(req: CreateTransactionReq):
    op = await db.operators.find_one({"id": req.operator_id}, {"_id": 0})
    if not op:
        raise HTTPException(status_code=404, detail="Ажилтан олдсонгүй")
    pump = await db.pumps.find_one({"id": req.pump_id}, {"_id": 0})
    if not pump:
        raise HTTPException(status_code=404, detail="Түгээгүүр олдсонгүй")
    price_doc = await db.fuel_prices.find_one({"fuel_type": req.fuel_type}, {"_id": 0})
    if not price_doc:
        raise HTTPException(status_code=404, detail="Шатахууны үнэ олдсонгүй")

    # Membership balance check & deduct
    membership_holder_name = None
    if req.payment_method == "membership":
        if not req.membership_card:
            raise HTTPException(status_code=400, detail="Гишүүний картын дугаар оруулна уу")
        card = await db.membership_cards.find_one({"card_number": req.membership_card}, {"_id": 0})
        if not card:
            raise HTTPException(status_code=404, detail="Гишүүний карт олдсонгүй")
        if card["balance"] < req.amount:
            raise HTTPException(
                status_code=400,
                detail=f"Үлдэгдэл хүрэлцэхгүй байна. Үлдэгдэл: {card['balance']:,.0f}₮"
            )
        await db.membership_cards.update_one(
            {"card_number": req.membership_card},
            {"$inc": {"balance": -req.amount}}
        )
        membership_holder_name = card["holder_name"]

    lottery = gen_lottery()
    bill_id = gen_bill_id()
    qr_data = build_qr_data(bill_id, lottery, req.amount, req.register_number or "")

    customer_name = req.customer_name or membership_holder_name

    tx = Transaction(
        operator_id=req.operator_id,
        operator_name=op["name"],
        pump_id=req.pump_id,
        pump_number=pump["number"],
        fuel_type=req.fuel_type,
        liters=req.liters,
        price_per_liter=price_doc["price_per_liter"],
        amount=req.amount,
        payment_method=req.payment_method,
        membership_card=req.membership_card,
        customer_type=req.customer_type,
        register_number=req.register_number,
        customer_name=customer_name,
        ebarimt_lottery=lottery,
        ebarimt_bill_id=bill_id,
        ebarimt_qr_data=qr_data,
    )
    await db.transactions.insert_one(tx.model_dump())
    return tx.model_dump()


@api_router.get("/transactions")
async def list_transactions(operator_id: Optional[str] = None, today: bool = False, limit: int = 100):
    q = {}
    if operator_id:
        q["operator_id"] = operator_id
    if today:
        today_str = datetime.now(timezone.utc).date().isoformat()
        q["created_at"] = {"$regex": f"^{today_str}"}
    txs = await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return txs


@api_router.get("/transactions/{tx_id}")
async def get_transaction(tx_id: str):
    tx = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Гүйлгээ олдсонгүй")
    return tx


@api_router.post("/transactions/mark-printed")
async def mark_printed(req: MarkPrintedReq):
    res = await db.transactions.update_one(
        {"id": req.transaction_id},
        {"$set": {"printed": True}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Гүйлгээ олдсонгүй")
    return {"ok": True}


# ============= SHIFT SUMMARY =============
@api_router.get("/shift/summary")
async def shift_summary(operator_id: Optional[str] = None):
    q = {"status": "completed"}
    if operator_id:
        q["operator_id"] = operator_id
    today_str = datetime.now(timezone.utc).date().isoformat()
    q["created_at"] = {"$regex": f"^{today_str}"}

    txs = await db.transactions.find(q, {"_id": 0}).to_list(1000)

    by_fuel = {}
    by_payment = {"cash": 0, "card": 0, "membership": 0}
    total_amount = 0
    total_liters = 0
    for t in txs:
        ft = t["fuel_type"]
        by_fuel.setdefault(ft, {"liters": 0, "amount": 0, "count": 0})
        by_fuel[ft]["liters"] += t["liters"]
        by_fuel[ft]["amount"] += t["amount"]
        by_fuel[ft]["count"] += 1
        by_payment[t["payment_method"]] += t["amount"]
        total_amount += t["amount"]
        total_liters += t["liters"]

    return {
        "total_amount": total_amount,
        "total_liters": total_liters,
        "transaction_count": len(txs),
        "by_fuel": by_fuel,
        "by_payment": by_payment,
    }


# ============= ROOT =============
@api_router.get("/")
async def root():
    return {"message": "Gas Station POS API", "status": "ok"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(api_router)

# Mount Flux Monitor proxy routes (real https://uboil.flux.mn API integration)
from flux_client import make_router as _make_flux_router  # noqa: E402
app.include_router(_make_flux_router(db), prefix="/api")

# Attach lifespan (replaces deprecated on_event handlers)
app.router.lifespan_context = lifespan

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
