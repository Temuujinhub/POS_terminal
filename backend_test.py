"""Backend tests for Flux API integration end-to-end.

Tests run against the public ingress URL from frontend/.env (EXPO_PUBLIC_BACKEND_URL).
All backend Flux routes are exposed at {BASE}/api/flux/*.

NOTE on review-request vs actual implementation contract (verified by reading
/app/backend/flux_client.py):
  * Session header is X-Session-Id (not X-Flux-Session). Tested with X-Session-Id.
  * lookup-card / start-dispense / finalize / void take session_id in BODY, not
    via header.
  * start-dispense body shape: {session_id, pump, dose_type, auto_close, nozzle?,
    fuel_grade_id?, dose?, card_id?, nfc_tag?}.
  * Pump fields: pump_number, nozzle, status, last_fuel_grade, last_fuel_grade_id
    (no fuel_grade_price / last_volume / last_amount in current schema).
  * Dispense status returns: {status, transaction: {id, fuel_type, volume_liters,
    unit_price, total_amount}}.
  * Finalize payment_method enum: cash | bank_card | qpay | fuel_card | invoice
    (NOT "card" or "membership").
"""
from __future__ import annotations

import os
import sys
import time
import json
import uuid
import asyncio
from typing import Any

import requests
from pymongo import MongoClient
from dotenv import dotenv_values

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND_ENV = dotenv_values(os.path.join(ROOT, "frontend", ".env"))
BACKEND_ENV = dotenv_values(os.path.join(ROOT, "backend", ".env"))

BASE = (FRONTEND_ENV.get("EXPO_PUBLIC_BACKEND_URL")
        or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
        or "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
MONGO_URL = BACKEND_ENV.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = BACKEND_ENV.get("DB_NAME", "test_database")

print(f"[CONFIG] BASE={BASE}")
print(f"[CONFIG] MONGO={MONGO_URL} DB={DB_NAME}")

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, info: str = "") -> None:
    badge = "PASS" if ok else "FAIL"
    print(f"[{badge}] {name} :: {info[:300]}")
    results.append((name, ok, info))


def short(obj: Any, lim: int = 280) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        s = str(obj)
    return s if len(s) <= lim else s[:lim] + "…"


# ---------- 1. Health ----------
def test_health() -> None:
    t0 = time.time()
    try:
        r = requests.get(f"{API}/health", timeout=15)
        record("health", r.status_code == 200 and r.json().get("status") == "ok",
               f"{r.status_code} in {time.time() - t0:.2f}s body={short(r.json())}")
    except Exception as e:
        record("health", False, f"exc {e}")


# ---------- 2. Demo login ----------
def test_demo_login() -> dict:
    sid = ""
    payload: dict = {}
    try:
        t0 = time.time()
        r = requests.post(f"{API}/flux/auth/demo-login", json={}, timeout=20)
        elapsed = time.time() - t0
        if r.status_code != 200:
            record("flux.auth.demo-login", False, f"{r.status_code} {r.text[:200]}")
            return {}
        payload = r.json()
        sid = payload.get("session_id", "")
        ok = bool(sid) and payload.get("is_demo") is True and payload.get("station_id") == 99
        record("flux.auth.demo-login", ok,
               f"200 in {elapsed:.2f}s sid={sid[:8]}.. is_demo={payload.get('is_demo')} "
               f"station={payload.get('station_id')}/{payload.get('station_name')}")
    except Exception as e:
        record("flux.auth.demo-login", False, f"exc {e}")
    return payload


# ---------- 3. Real login (negative-only — no real creds available) ----------
def test_real_login_negative() -> None:
    try:
        t0 = time.time()
        r = requests.post(f"{API}/flux/auth/login",
                          json={"email": "no-such-user@example.com",
                                "password": "definitely-wrong"},
                          timeout=30)
        elapsed = time.time() - t0
        # Expect upstream Flux to reject -> we propagate 4xx (401/422 etc.)
        ok = r.status_code in (400, 401, 403, 422)
        record("flux.auth.login (bad creds → upstream propagation)", ok,
               f"{r.status_code} in {elapsed:.2f}s body={r.text[:160]}")
    except Exception as e:
        record("flux.auth.login (bad creds)", False, f"exc {e}")


# ---------- 4. Me ----------
def test_me(sid: str) -> None:
    if not sid:
        record("flux.me", False, "no session")
        return
    try:
        r = requests.get(f"{API}/flux/me", headers={"X-Session-Id": sid}, timeout=15)
        if r.status_code != 200:
            record("flux.me", False, f"{r.status_code} {r.text[:200]}")
            return
        d = r.json()
        ok = (d.get("session_id") == sid and d.get("user_id") == 999
              and "flux_token" not in d and d.get("is_demo") is True)
        record("flux.me", ok, f"200 body={short(d)}")
    except Exception as e:
        record("flux.me", False, f"exc {e}")


def test_me_invalid() -> None:
    try:
        r = requests.get(f"{API}/flux/me",
                         headers={"X-Session-Id": "deadbeef-0000-0000-0000-000000000000"},
                         timeout=15)
        record("flux.me invalid session → 401", r.status_code == 401,
               f"{r.status_code} {r.text[:120]}")
    except Exception as e:
        record("flux.me invalid", False, f"exc {e}")


def test_me_missing_header() -> None:
    try:
        r = requests.get(f"{API}/flux/me", timeout=15)
        # FastAPI Header(...) → 422 when missing
        record("flux.me missing header → 422", r.status_code == 422,
               f"{r.status_code} {r.text[:120]}")
    except Exception as e:
        record("flux.me missing header", False, f"exc {e}")


# ---------- 5. Pumps ----------
def test_pumps(sid: str) -> None:
    if not sid:
        record("flux.pumps", False, "no session")
        return
    try:
        t0 = time.time()
        r = requests.get(f"{API}/flux/pumps",
                         headers={"X-Session-Id": sid}, timeout=20)
        elapsed = time.time() - t0
        if r.status_code != 200:
            record("flux.pumps", False, f"{r.status_code} {r.text[:200]}")
            return
        data = r.json()
        if not isinstance(data, list) or len(data) == 0:
            record("flux.pumps", False, f"unexpected payload {short(data)}")
            return
        sample = data[0]
        required = {"pump_number", "nozzle", "status"}
        miss = required - sample.keys()
        statuses = {p.get("status") for p in data}
        # Verify "idle" appears in demo mock so frontend can show ИДЭВХГҮЙ
        idle_present = "idle" in statuses
        record("flux.pumps", not miss and idle_present,
               f"200 in {elapsed:.2f}s n={len(data)} statuses={statuses} miss={miss} "
               f"sample={short(sample)}")
    except Exception as e:
        record("flux.pumps", False, f"exc {e}")


# ---------- 6. Lookup card ----------
def test_lookup_card_found(sid: str) -> None:
    if not sid:
        record("flux.lookup-card found", False, "no session")
        return
    try:
        r = requests.post(f"{API}/flux/lookup-card",
                          json={"session_id": sid, "nfc_tag": "AABBCCDD"},
                          timeout=15)
        if r.status_code != 200:
            record("flux.lookup-card found", False, f"{r.status_code} {r.text[:200]}")
            return
        d = r.json()
        ok = (d.get("found") is True and d.get("card_id") and d.get("card_number")
              and d.get("balance") is not None and d.get("holder_name"))
        record("flux.lookup-card found", ok, f"body={short(d)}")
    except Exception as e:
        record("flux.lookup-card found", False, f"exc {e}")


def test_lookup_card_notfound(sid: str) -> None:
    if not sid:
        return
    try:
        r = requests.post(f"{API}/flux/lookup-card",
                          json={"session_id": sid, "nfc_tag": "ZZZZZZZZ"},
                          timeout=15)
        ok = r.status_code == 200 and r.json().get("found") is False
        record("flux.lookup-card not-found", ok, f"{r.status_code} {r.text[:160]}")
    except Exception as e:
        record("flux.lookup-card not-found", False, f"exc {e}")


def test_lookup_card_bad_session() -> None:
    try:
        r = requests.post(f"{API}/flux/lookup-card",
                          json={"session_id": "bogus", "nfc_tag": "AABBCCDD"},
                          timeout=15)
        record("flux.lookup-card invalid session → 401", r.status_code == 401,
               f"{r.status_code} {r.text[:120]}")
    except Exception as e:
        record("flux.lookup-card invalid session", False, f"exc {e}")


def test_lookup_card_missing_field() -> None:
    try:
        r = requests.post(f"{API}/flux/lookup-card",
                          json={"session_id": "anything"}, timeout=15)
        record("flux.lookup-card missing nfc_tag → 422", r.status_code == 422,
               f"{r.status_code} {r.text[:120]}")
    except Exception as e:
        record("flux.lookup-card missing field", False, f"exc {e}")


# ---------- 7. Start dispense ----------
def test_start_dispense(sid: str) -> int:
    if not sid:
        record("flux.start-dispense", False, "no session")
        return 0
    try:
        body = {
            "session_id": sid,
            "pump": 1,
            "dose_type": "Amount",
            "auto_close": True,
            "nozzle": 1,
            "fuel_grade_id": 1,
            "dose": 5000,
        }
        r = requests.post(f"{API}/flux/start-dispense", json=body, timeout=20)
        if r.status_code != 200:
            record("flux.start-dispense", False, f"{r.status_code} {r.text[:200]}")
            return 0
        d = r.json()
        cmd_id = d.get("command_id")
        ok = bool(cmd_id) and d.get("pump") == 1
        record("flux.start-dispense", ok, f"body={short(d)}")
        return cmd_id or 0
    except Exception as e:
        record("flux.start-dispense", False, f"exc {e}")
        return 0


def test_start_dispense_locked(sid: str) -> None:
    """Verify card_id locks an amount in demo mode (fuel-card flow)."""
    if not sid:
        return
    try:
        r = requests.post(f"{API}/flux/start-dispense",
                          json={"session_id": sid, "pump": 2, "dose_type": "Amount",
                                "auto_close": True, "nozzle": 1, "fuel_grade_id": 2,
                                "dose": 30000, "card_id": 1001}, timeout=20)
        if r.status_code != 200:
            record("flux.start-dispense (with card)", False,
                   f"{r.status_code} {r.text[:200]}")
            return
        d = r.json()
        ok = d.get("locked_amount") == 30000 and d.get("card_balance_after_lock") is not None
        record("flux.start-dispense (with card_id locks amount)", ok, f"body={short(d)}")
    except Exception as e:
        record("flux.start-dispense (with card)", False, f"exc {e}")


# ---------- 8. Dispense status ----------
def test_dispense_status(sid: str, cmd_id: int) -> int:
    if not sid or not cmd_id:
        record("flux.dispense.status", False, "no session/cmd_id")
        return 0
    last_tx_id = 0
    try:
        seen_states: list[str] = []
        for i in range(12):
            r = requests.get(f"{API}/flux/dispense/{cmd_id}/status",
                             params={"pump": 1},
                             headers={"X-Session-Id": sid}, timeout=15)
            if r.status_code != 200:
                record("flux.dispense.status", False, f"{r.status_code} {r.text[:200]}")
                return 0
            d = r.json()
            st = d.get("status")
            seen_states.append(st)
            tx = d.get("transaction") or {}
            if tx.get("id"):
                last_tx_id = tx["id"]
            if st == "completed":
                ok = bool(last_tx_id) and tx.get("volume_liters") and tx.get("total_amount")
                record("flux.dispense.status (completed)", ok,
                       f"states={seen_states} final_tx={short(tx)}")
                return last_tx_id
            time.sleep(1)
        record("flux.dispense.status (completed)", False,
               f"never completed in 12s; states={seen_states}")
        return last_tx_id
    except Exception as e:
        record("flux.dispense.status", False, f"exc {e}")
        return last_tx_id


# ---------- 9. Finalize ----------
def test_finalize(sid: str, tx_id: int) -> None:
    if not sid:
        record("flux.finalize", False, "no session")
        return
    if not tx_id:
        tx_id = 999999  # demo branch ignores; just needs an int
    try:
        body = {
            "session_id": sid,
            "transaction_id": tx_id,
            "payment_method": "cash",
            "vat_receipt_number": "DD123",
            "vat_type": "Иргэн",
        }
        r = requests.post(f"{API}/flux/finalize", json=body, timeout=15)
        if r.status_code != 200:
            record("flux.finalize", False, f"{r.status_code} {r.text[:200]}")
            return
        d = r.json()
        ok = (d.get("transaction_id") == tx_id and d.get("payment_method") == "cash"
              and d.get("vat_receipt_number") == "DD123" and d.get("total_amount"))
        record("flux.finalize", ok, f"body={short(d)}")
    except Exception as e:
        record("flux.finalize", False, f"exc {e}")


def test_finalize_bad_payment_method(sid: str) -> None:
    if not sid:
        return
    try:
        r = requests.post(f"{API}/flux/finalize",
                          json={"session_id": sid, "transaction_id": 1,
                                "payment_method": "card",   # invalid enum
                                "vat_receipt_number": "X", "vat_type": "Иргэн"},
                          timeout=15)
        record("flux.finalize invalid payment_method → 422", r.status_code == 422,
               f"{r.status_code} {r.text[:200]}")
    except Exception as e:
        record("flux.finalize bad payment_method", False, f"exc {e}")


# ---------- Mongo verification ----------
def test_mongo_session(sid: str) -> None:
    if not sid:
        record("mongo flux_sessions", False, "no session")
        return
    try:
        cli = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        col = cli[DB_NAME]["flux_sessions"]
        doc = col.find_one({"session_id": sid})
        if not doc:
            record("mongo flux_sessions", False, "session not found in DB")
            return
        ok = (doc.get("flux_token") == "demo-token" and doc.get("is_demo") is True
              and doc.get("station_id") == 99 and doc.get("user_id") == 999
              and doc.get("expires_at"))
        record("mongo flux_sessions row", ok,
               f"keys={list(doc.keys())} expires_at={doc.get('expires_at')}")
    except Exception as e:
        record("mongo flux_sessions", False, f"exc {e}")


# ---------- Real Flux API reachability ----------
def test_real_flux_reachable() -> None:
    try:
        t0 = time.time()
        r = requests.post("https://uboil.flux.mn/api/auth/login",
                          json={"email": "x@x", "password": "y"},
                          timeout=15, allow_redirects=True)
        elapsed = time.time() - t0
        # We expect a 4xx (validation/unauth) which proves the API is up
        ok = 400 <= r.status_code < 500
        record("uboil.flux.mn reachable", ok,
               f"{r.status_code} in {elapsed:.2f}s body={r.text[:120]}")
    except Exception as e:
        record("uboil.flux.mn reachable", False, f"exc {e}")


def main() -> int:
    test_health()
    test_real_flux_reachable()
    sess = test_demo_login()
    sid = sess.get("session_id", "")
    test_real_login_negative()
    test_me(sid)
    test_me_invalid()
    test_me_missing_header()
    test_pumps(sid)
    test_lookup_card_found(sid)
    test_lookup_card_notfound(sid)
    test_lookup_card_bad_session()
    test_lookup_card_missing_field()
    cmd_id = test_start_dispense(sid)
    test_start_dispense_locked(sid)
    tx_id = test_dispense_status(sid, cmd_id)
    test_finalize(sid, tx_id)
    test_finalize_bad_payment_method(sid)
    test_mongo_session(sid)

    print("\n========== SUMMARY ==========")
    failed = [n for n, ok, _ in results if not ok]
    for n, ok, info in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {n}")
    print(f"\nTOTAL: {len(results)}  PASS: {len(results) - len(failed)}  FAIL: {len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
