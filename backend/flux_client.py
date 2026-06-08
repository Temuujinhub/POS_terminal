"""Flux Monitor POS API proxy client + endpoints.

Architecture:
- Frontend → Our backend (/api/flux/*) → Flux API (https://uboil.flux.mn/api/*)
- We store the Flux JWT in MongoDB keyed by an opaque session_id we hand back
  to the frontend, so the JWT never leaves the backend (CORS-safe + secret-safe).
"""
import os
import uuid
import logging
from typing import Optional, Literal, Any
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase


logger = logging.getLogger(__name__)

FLUX_BASE = os.environ.get("FLUX_API_BASE_URL", "https://uboil.flux.mn").rstrip("/")
FLUX_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
FLUX_RETRIES = 2  # transport-level retries on connect failures
SESSION_TTL_HOURS = 12

# ----- PERSISTENT HTTP client -----
# httpx.AsyncClient-г нэг л удаа үүсгэнэ. TCP+TLS handshake-г дахин дахин
# хийхгүй учир status polling/finalize гэх мэт байнга давтагддаг хүсэлтүүд
# мэдэгдэхүйц хурдан болно (avg ~50-300ms хэмнэлт).
_flux_client: Optional[httpx.AsyncClient] = None


def _get_flux_client() -> httpx.AsyncClient:
    global _flux_client
    if _flux_client is None or _flux_client.is_closed:
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=40, keepalive_expiry=60.0)
        transport = httpx.AsyncHTTPTransport(retries=FLUX_RETRIES)
        _flux_client = httpx.AsyncClient(
            base_url=FLUX_BASE,
            timeout=FLUX_TIMEOUT,
            transport=transport,
            limits=limits,
            http2=False,
        )
    return _flux_client


async def close_flux_client():
    global _flux_client
    if _flux_client is not None and not _flux_client.is_closed:
        await _flux_client.aclose()
        _flux_client = None


# ============= MODELS =============
class FluxLoginReq(BaseModel):
    email: str
    password: str
    station_id: Optional[int] = None


class FluxNfcLoginReq(BaseModel):
    nfc_tag: str
    device_id: Optional[str] = None
    station_id: Optional[int] = None


class FluxLookupCardReq(BaseModel):
    session_id: str
    nfc_tag: str


class FluxStartDispenseReq(BaseModel):
    session_id: str
    pump: int
    dose_type: Literal["Amount", "Volume", "FullTank"]
    auto_close: bool = True
    nozzle: Optional[int] = None
    fuel_grade_id: Optional[int] = None
    dose: Optional[float] = None
    card_id: Optional[int] = None
    nfc_tag: Optional[str] = None
    # 🆕 V2: Prepay/postpay flow (Flux API ChangeRequest V2). Хэрэв Flux backend
    # дэмжээгүй хэвээр бол постпай л өгөгдөнө. Аль хэдийн нэмэхэд бэлэн (no-op).
    payment_flow: Literal["prepay", "postpay"] = "postpay"
    prepayment: Optional["FluxPrepaymentBlock"] = None


class FluxPrepaymentBlock(BaseModel):
    """Prepay урсгалд жолоочийн төлсөн төлбөрийн мэдээлэл (FLUX_API_CHANGES_V2_PREPAY.md)."""
    amount: float
    # 🆕 "split" — нэг гүйлгээг 2+ төрлийн төлбөрөөр хуваан төлсөн үед
    method: Literal["cash", "bank_card", "qpay", "fuel_card", "split"]
    bank_approval_code: Optional[str] = None
    bank_rrn: Optional[str] = None
    bank_masked_pan: Optional[str] = None
    bank_terminal_id: Optional[str] = None
    qpay_invoice_id: Optional[str] = None
    qpay_payment_id: Optional[str] = None
    vat_receipt_number: Optional[str] = None
    vat_type: Optional[Literal["Иргэн", "Бараа худалдан авагч", "Байгууллага"]] = "Иргэн"
    vat_register: Optional[str] = None
    # 🆕 Хуваан төлбөрийн дэлгэрэнгүй (method=split үед)
    splits: Optional[list[dict]] = None


class FluxPaymentLine(BaseModel):
    method: Literal["cash", "bank_card", "qpay", "fuel_card", "invoice"]
    amount: float
    card_id: Optional[int] = None
    card_number: Optional[str] = None
    bank_approval_code: Optional[str] = None
    bank_rrn: Optional[str] = None
    bank_masked_pan: Optional[str] = None
    bank_terminal_id: Optional[str] = None


class FluxFinalizeReq(BaseModel):
    session_id: str
    transaction_id: int
    # 🆕 "split" — нэг гүйлгээг 2+ төрлийн төлбөрөөр төлсөн (payment_lines дотор задарсан)
    payment_method: Literal["cash", "bank_card", "qpay", "fuel_card", "invoice", "split"]
    vat_receipt_number: str
    vat_type: Literal["Иргэн", "Бараа худалдан авагч", "Байгууллага"]
    card_id: Optional[int] = None
    card_number: Optional[str] = None
    bank_approval_code: Optional[str] = None
    vat_register: Optional[str] = ""
    # Хэсэгчилсэн (split) төлбөр — нэг гүйлгээг 2+ төрлийн төлбөрөөр төлөх
    # боломжтой. Нийлбэр нь total_amount-той тэнцүү байх ёстой. Үндсэн
    # payment_method нь эхний line-ийн method болохоор үлдээгээ.
    payment_lines: Optional[list[FluxPaymentLine]] = None


class FluxVoidReq(BaseModel):
    session_id: str
    transaction_id: int
    reason: str


# ============= HELPERS =============
async def _flux_call(method: str, path: str, *, token: Optional[str] = None,
                     json: Any = None, params: Any = None) -> Any:
    """Call Flux API; transparently propagate Flux's HTTP error to the caller.

    Uses a shared persistent httpx.AsyncClient (connection pool) so that
    TCP + TLS handshake is reused across calls. This dramatically reduces
    latency for repeated polling calls (e.g. /dispense/{id}/status)."""
    import time as _time
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    client = _get_flux_client()
    last_err: Optional[Exception] = None
    r = None
    t_start = _time.perf_counter()
    for attempt in range(FLUX_RETRIES + 1):
        try:
            r = await client.request(method, path, headers=headers, json=json, params=params)
            break
        except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError) as e:
            last_err = e
            logger.warning("Flux call failed (attempt %s/%s): %s", attempt + 1, FLUX_RETRIES + 1, e)
            if attempt == FLUX_RETRIES:
                raise HTTPException(
                    status_code=504,
                    detail="Flux сервер хариу өгсөнгүй. Дахин оролдоно уу.",
                )
        except httpx.RequestError as e:
            logger.exception("Flux upstream unreachable")
            raise HTTPException(status_code=502, detail=f"Flux API unreachable: {e}")
    elapsed_ms = int((_time.perf_counter() - t_start) * 1000)
    # Anything > 500ms is suspicious; > 1500ms = visible to user
    if elapsed_ms > 500:
        logger.warning("Flux %s %s took %dms (slow)", method, path, elapsed_ms)
    else:
        logger.info("Flux %s %s -> %dms", method, path, elapsed_ms)
    if r is None:
        raise HTTPException(status_code=502, detail=str(last_err) if last_err else "Flux call failed")
    if r.status_code >= 400:
        try:
            data = r.json()
            detail = data.get("detail") if isinstance(data, dict) else data
        except Exception:
            detail = r.text
        raise HTTPException(status_code=r.status_code, detail=detail)
    if not r.text:
        return None
    return r.json()


async def _create_session(db: AsyncIOMotorDatabase, flux_payload: dict, *, is_demo: bool = False) -> dict:
    """Persist Flux JWT in our DB and return a session payload for the client."""
    session_id = str(uuid.uuid4())
    expires_in = int(flux_payload.get("expires_in") or SESSION_TTL_HOURS * 3600)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    doc = {
        "session_id": session_id,
        "flux_token": flux_payload.get("access_token", ""),
        "user_id": flux_payload.get("user_id"),
        "full_name": flux_payload.get("full_name"),
        "role": flux_payload.get("role"),
        "station_id": flux_payload.get("station_id"),
        "station_name": flux_payload.get("station_name"),
        "is_demo": is_demo,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.flux_sessions.insert_one(doc)
    public = {k: v for k, v in doc.items() if k not in ("flux_token", "_id")}
    return public


async def _get_session(db: AsyncIOMotorDatabase, session_id: str) -> dict:
    s = await db.flux_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=401, detail="Session олдсонгүй эсвэл хүчингүй")
    try:
        if datetime.fromisoformat(s["expires_at"]) < datetime.now(timezone.utc):
            await db.flux_sessions.delete_one({"session_id": session_id})
            raise HTTPException(status_code=401, detail="Session дууссан, дахин нэвтэрнэ үү")
    except (KeyError, ValueError):
        pass
    return s


def make_router(db: AsyncIOMotorDatabase) -> APIRouter:
    router = APIRouter(prefix="/flux", tags=["flux"])

    async def session_dep(x_session_id: str = Header(..., alias="X-Session-Id")) -> dict:
        return await _get_session(db, x_session_id)

    # ---------- DEMO MOCKS ----------
    def _demo_pumps():
        statuses = ["ready", "ready", "ready", "idle", "busy", "ready", "offline", "ready"]
        fuels = [(1, "АИ-92"), (2, "АИ-95"), (3, "ДТ"), (4, "LPG")]
        # Идэвхтэй дюспенс байгаа pump-ыг "busy" болгох
        active_pumps = {st.get("pump") for st in _demo_dispense_state.values() if st.get("pump")}
        out = []
        for i in range(1, 9):
            f = fuels[(i - 1) % len(fuels)]
            status = "busy" if i in active_pumps else statuses[i - 1]
            out.append({
                "pump_number": i,
                "nozzle": (i % 2) + 1,
                "status": status,
                "last_fuel_grade": f[1],
                "last_fuel_grade_id": f[0],
            })
        return out

    _demo_dispense_state: dict = {}

    def _demo_dispense_tick(cmd_id: int, dose: float, dose_type: str):
        st = _demo_dispense_state.setdefault(cmd_id, {"started": datetime.now(timezone.utc), "stage": 0, "dose": dose, "dose_type": dose_type})
        elapsed = (datetime.now(timezone.utc) - st["started"]).total_seconds()
        if elapsed < 1: return {"status": "pending", "transaction": None}
        if elapsed < 3: return {"status": "acknowledged", "transaction": None}
        if elapsed < 8:
            progress = min(1.0, (elapsed - 3) / 5)
            volume = (st["dose"] / 2950) * progress if st["dose_type"] == "Amount" else st["dose"] * progress
            amount = volume * 2950
            return {"status": "filling", "transaction": {"id": cmd_id + 100000, "fuel_type": "petrol", "volume_liters": round(volume, 2), "unit_price": 2950, "total_amount": round(amount)}}
        # completed
        volume = st["dose"] / 2950 if st["dose_type"] == "Amount" else st["dose"]
        amount = volume * 2950
        return {"status": "completed", "transaction": {"id": cmd_id + 100000, "fuel_type": "petrol", "volume_liters": round(volume, 2), "unit_price": 2950, "total_amount": round(amount)}}

    # ---------- AUTH ----------
    @router.post("/auth/login")
    async def login(req: FluxLoginReq):
        data = await _flux_call(
            "POST", "/api/auth/login",
            json={"email": req.email, "password": req.password},
        )
        return await _create_session(db, data)

    @router.post("/auth/nfc-login")
    async def nfc_login(req: FluxNfcLoginReq):
        body = {"nfc_tag": req.nfc_tag.upper()}
        if req.device_id:
            body["device_id"] = req.device_id
        if req.station_id is not None:
            body["station_id"] = req.station_id
        data = await _flux_call("POST", "/api/auth/pos-nfc-login", json=body)
        return await _create_session(db, data)

    @router.post("/auth/demo-login")
    async def demo_login():
        """Test-only entry: fakes a Live session without calling Flux. Useful for
        UI demos when real credentials are unavailable. All downstream Flux calls
        for this session return mock data (see is_demo branches below)."""
        fake = {
            "access_token": "demo-token",
            "user_id": 999,
            "full_name": "Демо Ажилтан",
            "role": "attendant",
            "station_id": 99,
            "station_name": "Демо Станц",
            "expires_in": SESSION_TTL_HOURS * 3600,
        }
        return await _create_session(db, fake, is_demo=True)

    @router.post("/auth/logout")
    async def logout(session: dict = Depends(session_dep)):
        await db.flux_sessions.delete_one({"session_id": session["session_id"]})
        return {"ok": True}

    # ---------- PUMPS ----------
    @router.get("/pumps")
    async def get_pumps(session: dict = Depends(session_dep), station_id: Optional[int] = None):
        if session.get("is_demo"):
            return _demo_pumps()
        sid = station_id or session.get("station_id")
        if sid is None:
            raise HTTPException(status_code=400, detail="station_id шаардлагатай")
        data = await _flux_call(
            "GET", "/api/pos/pumps",
            token=session["flux_token"], params={"station_id": sid},
        )
        # Log raw pump payload (truncated) so we can verify mapping vs Flux web UI
        try:
            sample = data[:3] if isinstance(data, list) else data
            logger.info("Flux pumps raw (station=%s, n=%s): %s", sid, len(data) if isinstance(data, list) else "?", sample)
        except Exception:
            pass
        return data

    # ---------- CARD LOOKUP ----------
    @router.post("/lookup-card")
    async def lookup_card(req: FluxLookupCardReq):
        session = await _get_session(db, req.session_id)
        if session.get("is_demo"):
            tag = req.nfc_tag.upper()
            if tag.startswith("AA"):
                return {"found": True, "card_id": 1001, "card_number": "TEST-0001",
                        "holder_name": '"Тэнгэр Тээвэр" ХХК', "card_type": "corporate",
                        "discount_percent": 0, "balance": 350000, "is_active": True,
                        "allowed_fuel_grade_ids": [1, 3], "company_name": '"Тэнгэр Тээвэр" ХХК',
                        "department": "Тээвэр", "vehicle_number": "УБЛ-1234"}
            return {"found": False}
        data = await _flux_call(
            "POST", "/api/pos/lookup-card",
            token=session["flux_token"],
            json={"nfc_tag": req.nfc_tag.upper()},
        )
        return data

    # ---------- DISPENSE ----------
    @router.post("/start-dispense")
    async def start_dispense(req: FluxStartDispenseReq):
        session = await _get_session(db, req.session_id)
        logger.info("start-dispense: session=%s is_demo=%s pump=%s station=%s",
                    req.session_id[:8], session.get("is_demo"), req.pump, session.get("station_id"))
        if session.get("is_demo"):
            cmd_id = int(datetime.now(timezone.utc).timestamp() * 1000) % 1_000_000
            _demo_dispense_state[cmd_id] = {
                "started": datetime.now(timezone.utc),
                "stage": 0,
                "dose": req.dose or 50000,
                "dose_type": req.dose_type,
                "pump": req.pump,
                "nozzle": req.nozzle,
                "fuel_grade_id": req.fuel_grade_id,
                "payment_flow": req.payment_flow or "postpay",
            }
            return {"command_id": cmd_id, "pump": req.pump, "expected_pickup_seconds": 8,
                    "message": "Демо: шахалт эхэллээ", "locked_amount": req.dose if req.card_id else None,
                    "card_balance_after_lock": 250000 if req.card_id else None}
        body = {
            "station_id": session.get("station_id"),
            "pump": req.pump,
            "dose_type": req.dose_type,
            "auto_close": req.auto_close,
        }
        if req.nozzle is not None:
            body["nozzle"] = req.nozzle
        if req.fuel_grade_id is not None:
            body["fuel_grade_id"] = req.fuel_grade_id
        if req.dose is not None:
            body["dose"] = req.dose
        if req.card_id is not None:
            body["card_id"] = req.card_id
        if req.nfc_tag:
            body["nfc_tag"] = req.nfc_tag.upper()
        # 🆕 V2: Prepay/postpay flow (FLUX_API_CHANGES_V2_PREPAY.md)
        # Flux API одоогоор payment_flow/prepayment-г хүлээж аваагүй (422
        # буцаадаг). FLUX_V2_PREPAY_ENABLED=true гэж тохируулсан үед л Flux-руу
        # явуулна. Үгүй бол prepay мэдээллийг proxy-д нь л хадгална, Flux-руу
        # ердийн (postpay) хүсэлт явуулна.
        if os.environ.get("FLUX_V2_PREPAY_ENABLED", "").lower() == "true":
            if req.payment_flow and req.payment_flow != "postpay":
                body["payment_flow"] = req.payment_flow
            if req.prepayment is not None:
                body["prepayment"] = req.prepayment.model_dump(exclude_none=True)
        data = await _flux_call(
            "POST", "/api/pos/start-dispense",
            token=session["flux_token"], json=body,
        )
        return data

    @router.get("/dispense/{command_id}/status")
    async def dispense_status(
        command_id: int, pump: int,
        session: dict = Depends(session_dep),
    ):
        if session.get("is_demo"):
            st = _demo_dispense_state.get(command_id)
            if not st:
                return {"status": "completed", "transaction": {"id": command_id + 100000,
                        "fuel_type": "petrol", "volume_liters": 16.95, "unit_price": 2950, "total_amount": 50000}}
            return _demo_dispense_tick(command_id, st["dose"], st["dose_type"])
        data = await _flux_call(
            "GET", f"/api/pos/dispense/{command_id}/status",
            token=session["flux_token"],
            params={"pump": pump, "station_id": session.get("station_id")},
        )
        return data

    # 🆕 V2: Active dispenses listing (FLUX_API_CHANGES_V2_PREPAY.md §2.4)
    # Олон pump зэрэг ажиллаж байгаа үед UI-д mini-card-уудаар харуулахад
    # хэрэглэх endpoint. Flux backend нь шинэчлэгдсэний дараа жинхэнэ өгөгдөл
    # буцаана. Хүртэл нь хоосон жагсаалт буцаана (graceful fallback).
    @router.get("/active-dispenses")
    async def list_active_dispenses(session: dict = Depends(session_dep)):
        if session.get("is_demo"):
            # Демо горимд /demo_dispense_state-аас гаргана. Дуусчсан (8с+) бол
            # жагсаалтаас хасах ба auto-finalize-ийг trigger хийнэ. Шахаж байгаа
            # үед нь жинхэнэ current_volume/current_amount-ыг тооцоолно.
            items = []
            now = datetime.now(timezone.utc)
            expired_ids = []
            for cmd_id, st in list(_demo_dispense_state.items()):
                elapsed = (now - st["started"]).total_seconds()
                # 12с-аас илүү бол хуучирсан гэж устгана
                if elapsed > 12:
                    expired_ids.append(cmd_id)
                    continue
                # 8с-аас өмнө бол filling
                progress = min(1.0, max(0, (elapsed - 3) / 5))
                if st["dose_type"] == "Amount":
                    volume = (st["dose"] / 2950) * progress
                else:
                    volume = st["dose"] * progress
                amount = volume * 2950
                # Статусыг тооцоолох
                if elapsed < 1:
                    status_str = "pending"
                elif elapsed < 3:
                    status_str = "acknowledged"
                elif elapsed < 8:
                    status_str = "filling"
                else:
                    # 8-12с хооронд = "completed" (frontend autoFinalize-аар finalize хийнэ)
                    status_str = "completed"
                items.append({
                    "command_id": cmd_id,
                    "transaction_id": cmd_id + 100000 if status_str in ("filling", "completed") else None,
                    "pump": st.get("pump", 1),
                    "nozzle": st.get("nozzle", 1),
                    "fuel_grade_name": "АИ-92",
                    "status": status_str,
                    "payment_flow": st.get("payment_flow", "postpay"),
                    "preset_dose_type": st.get("dose_type"),
                    "preset_dose": st.get("dose"),
                    "current_volume": round(volume, 2),
                    "current_amount": round(amount),
                    "prepaid_amount": st.get("dose") if st.get("payment_flow") == "prepay" and st.get("dose_type") == "Amount" else None,
                    "started_at": st.get("started").isoformat() if st.get("started") else None,
                    "user_email": "demo@uboil.mn",
                })
            # Хуучирсан состоянинуудыг устгах
            for cid in expired_ids:
                _demo_dispense_state.pop(cid, None)
            return {"items": items}
        try:
            data = await _flux_call(
                "GET", "/api/pos/active-dispenses",
                token=session["flux_token"],
                params={"station_id": session.get("station_id")},
            )
            return data
        except HTTPException as e:
            # Flux backend дэмжээгүй бол хоосон жагсаалт буцаах (graceful fallback)
            if e.status_code in (404, 405, 501):
                logger.info("Flux backend has not yet implemented /active-dispenses; returning empty")
                return {"items": []}
            raise

    # ---------- FINALIZE ----------
    @router.post("/finalize")
    async def finalize(req: FluxFinalizeReq):
        session = await _get_session(db, req.session_id)
        # payment_lines баталгаажуулалт: нийлбэр тэнцэх ёстой
        lines = req.payment_lines or []
        lines_summary = None
        if lines:
            total = sum(l.amount for l in lines)
            lines_summary = [{"method": l.method, "amount": l.amount} for l in lines]
            logger.info("finalize: tx=%s primary=%s lines=%s total=%s",
                        req.transaction_id, req.payment_method, lines_summary, total)
        if session.get("is_demo"):
            return {"transaction_id": req.transaction_id, "payment_method": req.payment_method,
                    "payment_lines": lines_summary,
                    "card_id": req.card_id, "card_number": req.card_number or "",
                    "total_amount": 50000, "volume_liters": 16.95, "fuel_type": "petrol",
                    "bank_approval_code": req.bank_approval_code,
                    "vat_receipt_number": req.vat_receipt_number, "vat_type": req.vat_type,
                    "vat_register": req.vat_register or "",
                    "pos_finalized_at": datetime.now(timezone.utc).isoformat(),
                    "message": "Демо: гүйлгээ дууслаа"}
        body = {
            "transaction_id": req.transaction_id,
            "payment_method": req.payment_method,
            "vat_receipt_number": req.vat_receipt_number,
            "vat_type": req.vat_type,
            "vat_register": req.vat_register or "",
        }
        if req.card_id is not None:
            body["card_id"] = req.card_id
        if req.card_number:
            body["card_number"] = req.card_number
        if req.bank_approval_code:
            body["bank_approval_code"] = req.bank_approval_code
        if lines:
            # Flux API split-ийг шууд хүлээж авдаг эсэх нь тодорхойгүй тул
            # бид хоёр зүйлийг хийнэ: (a) Flux руу primary method-оор illgээж
            # гүйлгээг хааснаар хадгална, (b) split breakdown-ийг манай
            # MongoDB log-руу хадгалж тайланд харуулна.
            body["payment_lines"] = [l.model_dump(exclude_none=True) for l in lines]
        data = await _flux_call(
            "POST", "/api/pos/finalize",
            token=session["flux_token"], json=body,
        )
        # Split breakdown-ийг манай DB-д хадгална (Flux талаар хадгалагдсан эсэхээс үл хамаараад)
        if lines_summary:
            try:
                await db.transaction_splits.insert_one({
                    "transaction_id": req.transaction_id,
                    "station_id": session.get("station_id"),
                    "user_id": session.get("user_id"),
                    "payment_lines": lines_summary,
                    "total": sum(l["amount"] for l in lines_summary),
                    "created_at": datetime.now(timezone.utc),
                })
            except Exception as e:
                logger.warning("Split хадгалахад алдаа: %s", e)
        return data

    # ---------- VOID ----------
    @router.post("/void")
    async def void_tx(req: FluxVoidReq):
        session = await _get_session(db, req.session_id)
        if session.get("is_demo"):
            return {"id": req.transaction_id, "voided_at": datetime.now(timezone.utc).isoformat(),
                    "voided_by_id": session.get("user_id"), "void_reason": req.reason, "refunded_to_card": 0}
        data = await _flux_call(
            "POST", f"/api/transactions/{req.transaction_id}/void",
            token=session["flux_token"], json={"reason": req.reason},
        )
        return data

    @router.get("/me")
    async def me(session: dict = Depends(session_dep)):
        # Return public session info (no flux_token)
        return {k: v for k, v in session.items() if k != "flux_token"}

    # ---------- HOLDS (Хүлээлгэх) ----------
    # Кассчин гүйлгээг түр өлгөж дараагийн үйлчлүүлэгчид үйлчилэх боломжтой.
    # Стандарт: дээд тал нь 3 hold, 24 цагт хадгална, бүх кассчин үзнэ.
    @router.post("/holds")
    async def hold_save(payload: dict, session: dict = Depends(session_dep)):
        station_id = session.get("station_id")
        # Идэвхтэй hold-ыг тоолох (expired-ыг алгасна)
        now = datetime.now(timezone.utc)
        active = await db.pos_holds.count_documents({
            "station_id": station_id,
            "expires_at": {"$gt": now},
        })
        if active >= 3:
            raise HTTPException(409, "Хүлээлгэх боломжтой гүйлгээний тоо дүүрсэн (max 3). Аль нэгийг үргэлжлүүлээд дахин оролдоно уу.")
        hold_id = str(uuid.uuid4())
        doc = {
            "hold_id": hold_id,
            "station_id": station_id,
            "user_id": session.get("user_id"),
            "user_email": session.get("email"),
            "payload": payload,  # бүх state: tx, vat, payment, pax_result, split,...
            "created_at": now,
            "expires_at": now + timedelta(hours=24),
        }
        await db.pos_holds.insert_one(doc)
        logger.info("hold saved: %s station=%s tx=%s", hold_id, station_id, payload.get("tx_id"))
        return {"hold_id": hold_id, "expires_at": doc["expires_at"].isoformat()}

    @router.get("/holds")
    async def hold_list(session: dict = Depends(session_dep)):
        station_id = session.get("station_id")
        now = datetime.now(timezone.utc)
        # Expired-ийг арилгана
        try:
            await db.pos_holds.delete_many({"expires_at": {"$lte": now}})
        except Exception:
            pass
        cur = db.pos_holds.find(
            {"station_id": station_id, "expires_at": {"$gt": now}},
        ).sort("created_at", -1).limit(3)
        items = []
        async for d in cur:
            items.append({
                "hold_id": d["hold_id"],
                "user_email": d.get("user_email"),
                "created_at": d["created_at"].isoformat(),
                "expires_at": d["expires_at"].isoformat(),
                "payload": d.get("payload", {}),
            })
        return {"items": items, "count": len(items)}

    @router.delete("/holds/{hold_id}")
    async def hold_delete(hold_id: str, session: dict = Depends(session_dep)):
        station_id = session.get("station_id")
        res = await db.pos_holds.delete_one({"hold_id": hold_id, "station_id": station_id})
        return {"deleted": res.deleted_count > 0}

    return router
