"""Pytest suite for Gas Station POS backend APIs."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://inventory-track-pos.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ============= AUTH =============
class TestAuth:
    def test_pin_login_valid(self, s):
        r = s.post(f"{API}/auth/pin-login", json={"pin": "1234"})
        assert r.status_code == 200
        op = r.json()["operator"]
        assert op["name"] == "Бат-Эрдэнэ"
        assert op["role"] == "cashier"
        assert "id" in op

    def test_pin_login_other_users(self, s):
        for pin, name in [("5678", "Дөлгөөн"), ("0000", "Энхбаяр")]:
            r = s.post(f"{API}/auth/pin-login", json={"pin": pin})
            assert r.status_code == 200, f"pin {pin} failed"
            assert r.json()["operator"]["name"] == name

    def test_pin_login_invalid(self, s):
        r = s.post(f"{API}/auth/pin-login", json={"pin": "9999"})
        assert r.status_code == 401


# ============= PUMPS / PRICES =============
class TestPumpsPrices:
    def test_pumps(self, s):
        r = s.get(f"{API}/pumps")
        assert r.status_code == 200
        pumps = r.json()
        assert len(pumps) == 8
        nums = [p["number"] for p in pumps]
        assert nums == sorted(nums)
        assert all("Түгээгүүр" in p["name"] for p in pumps)
        assert set(pumps[0]["fuel_types"]) == {"АИ-92", "АИ-95", "Дизель"}

    def test_fuel_prices(self, s):
        r = s.get(f"{API}/fuel-prices")
        assert r.status_code == 200
        prices = r.json()
        types = {p["fuel_type"]: p for p in prices}
        assert "АИ-92" in types and "АИ-95" in types and "Дизель" in types
        assert types["АИ-92"]["price_per_liter"] == 2850
        assert types["АИ-95"]["price_per_liter"] == 3050
        assert types["Дизель"]["price_per_liter"] == 3200


# ============= MEMBERSHIP =============
class TestMembership:
    def test_lookup_valid(self, s):
        r = s.post(f"{API}/membership/lookup", json={"card_number": "1000000001"})
        assert r.status_code == 200
        c = r.json()
        assert c["holder_name"] == "Болормаа Б."
        assert c["customer_type"] == "individual"
        assert c["balance"] == 250000

    def test_lookup_invalid(self, s):
        r = s.post(f"{API}/membership/lookup", json={"card_number": "9999999999"})
        assert r.status_code == 404


# ============= TRANSACTIONS =============
@pytest.fixture(scope="class")
def ctx(s):
    op_id = s.post(f"{API}/auth/pin-login", json={"pin": "1234"}).json()["operator"]["id"]
    pumps = s.get(f"{API}/pumps").json()
    return {"operator_id": op_id, "pump_id": pumps[0]["id"]}


class TestTransactions:
    def test_create_cash(self, s, ctx):
        payload = {
            "operator_id": ctx["operator_id"],
            "pump_id": ctx["pump_id"],
            "fuel_type": "АИ-92",
            "liters": 10.0,
            "amount": 28500,
            "payment_method": "cash",
            "customer_type": "individual",
            "register_number": "УБ12345678",
        }
        r = s.post(f"{API}/transactions", json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["payment_method"] == "cash"
        assert tx["amount"] == 28500
        assert tx["ebarimt_lottery"] and len(tx["ebarimt_lottery"]) == 10
        assert tx["ebarimt_bill_id"] and len(tx["ebarimt_bill_id"]) == 33
        assert tx["ebarimt_qr_data"].startswith("https://ebarimt.mn/")
        # Verify persistence
        g = s.get(f"{API}/transactions/{tx['id']}")
        assert g.status_code == 200
        assert g.json()["id"] == tx["id"]
        # Save for mark_printed test
        pytest.tx_id_for_print = tx["id"]

    def test_create_membership_success(self, s, ctx):
        # Get current balance first
        before = s.post(f"{API}/membership/lookup", json={"card_number": "1000000001"}).json()["balance"]
        payload = {
            "operator_id": ctx["operator_id"],
            "pump_id": ctx["pump_id"],
            "fuel_type": "АИ-95",
            "liters": 5.0,
            "amount": 15250,
            "payment_method": "membership",
            "membership_card": "1000000001",
            "customer_type": "individual",
        }
        r = s.post(f"{API}/transactions", json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["payment_method"] == "membership"
        assert tx["customer_name"] == "Болормаа Б."
        # Verify deduction
        after = s.post(f"{API}/membership/lookup", json={"card_number": "1000000001"}).json()["balance"]
        assert after == before - 15250

    def test_create_membership_insufficient(self, s, ctx):
        # card 1000000005 has 42000 balance
        payload = {
            "operator_id": ctx["operator_id"],
            "pump_id": ctx["pump_id"],
            "fuel_type": "Дизель",
            "liters": 100,
            "amount": 320000,
            "payment_method": "membership",
            "membership_card": "1000000005",
            "customer_type": "individual",
        }
        r = s.post(f"{API}/transactions", json=payload)
        assert r.status_code == 400
        assert "Үлдэгдэл" in r.json()["detail"]

    def test_list_today(self, s):
        r = s.get(f"{API}/transactions", params={"today": "true"})
        assert r.status_code == 200
        txs = r.json()
        assert isinstance(txs, list)
        assert len(txs) >= 1

    def test_mark_printed(self, s):
        tx_id = getattr(pytest, "tx_id_for_print", None)
        assert tx_id, "tx_id missing"
        r = s.post(f"{API}/transactions/mark-printed", json={"transaction_id": tx_id})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        g = s.get(f"{API}/transactions/{tx_id}").json()
        assert g["printed"] is True


# ============= SHIFT =============
class TestShift:
    def test_summary(self, s):
        r = s.get(f"{API}/shift/summary")
        assert r.status_code == 200
        d = r.json()
        for k in ["total_amount", "total_liters", "by_fuel", "by_payment", "transaction_count"]:
            assert k in d
        assert "cash" in d["by_payment"]
        assert "membership" in d["by_payment"]
