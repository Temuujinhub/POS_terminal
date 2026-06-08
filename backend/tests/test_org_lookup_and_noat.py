"""Tests for the new organizations/lookup endpoint and updated NOAT (individual w/o register)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://inventory-track-pos.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def ctx(s):
    op = s.post(f"{API}/auth/pin-login", json={"pin": "1234"}).json()["operator"]
    pumps = s.get(f"{API}/pumps").json()
    return {"operator_id": op["id"], "pump_id": pumps[0]["id"]}


# ============= ORGANIZATION LOOKUP =============
class TestOrgLookup:
    def test_lookup_tenger_teever(self, s):
        r = s.get(f"{API}/organizations/lookup", params={"register": "6123456"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["register_number"] == "6123456"
        assert "Тэнгэр Тээвэр" in d["name"]
        assert "_id" not in d

    def test_lookup_mongol_gazriin_tos(self, s):
        r = s.get(f"{API}/organizations/lookup", params={"register": "2034567"})
        assert r.status_code == 200
        d = r.json()
        assert "Монгол Газрын Тос" in d["name"]

    def test_lookup_other_seeded(self, s):
        for reg, frag in [("5987654", "Алтан Зам"),
                          ("5712398", "Шунхлай"),
                          ("7890123", "Капитрон")]:
            r = s.get(f"{API}/organizations/lookup", params={"register": reg})
            assert r.status_code == 200, f"{reg} -> {r.status_code}"
            assert frag in r.json()["name"]

    def test_lookup_invalid_returns_404(self, s):
        r = s.get(f"{API}/organizations/lookup", params={"register": "9999999"})
        assert r.status_code == 404
        assert r.json()["detail"] == "Байгууллага олдсонгүй"

    def test_lookup_with_whitespace_trimmed(self, s):
        r = s.get(f"{API}/organizations/lookup", params={"register": "  6123456  "})
        assert r.status_code == 200
        assert "Тэнгэр Тээвэр" in r.json()["name"]


# ============= NOAT — individual w/o register =============
class TestIndividualNoRegister:
    def test_create_individual_without_register(self, s, ctx):
        """Хувь хүн: register_number/customer_name omitted entirely."""
        payload = {
            "operator_id": ctx["operator_id"],
            "pump_id": ctx["pump_id"],
            "fuel_type": "АИ-92",
            "liters": 5.0,
            "amount": 14250,
            "payment_method": "cash",
            "customer_type": "individual",
            # Note: no register_number, no customer_name
        }
        r = s.post(f"{API}/transactions", json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["customer_type"] == "individual"
        assert tx["register_number"] is None
        assert tx["customer_name"] is None
        assert tx["amount"] == 14250
        assert tx["ebarimt_lottery"] and len(tx["ebarimt_lottery"]) == 10

        # Persistence verify
        g = s.get(f"{API}/transactions/{tx['id']}")
        assert g.status_code == 200
        gd = g.json()
        assert gd["register_number"] is None
        assert gd["customer_name"] is None

    def test_create_individual_explicit_nulls(self, s, ctx):
        """Frontend sends register_number=null, customer_name=null for individuals."""
        payload = {
            "operator_id": ctx["operator_id"],
            "pump_id": ctx["pump_id"],
            "fuel_type": "АИ-95",
            "liters": 3.0,
            "amount": 9150,
            "payment_method": "cash",
            "customer_type": "individual",
            "register_number": None,
            "customer_name": None,
        }
        r = s.post(f"{API}/transactions", json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["register_number"] is None
        assert tx["customer_name"] is None


# ============= NOAT — organization with register =============
class TestOrgTransaction:
    def test_create_org_with_lookup_name(self, s, ctx):
        """Frontend looks up name from /organizations/lookup, then sends both."""
        lk = s.get(f"{API}/organizations/lookup", params={"register": "6123456"}).json()
        payload = {
            "operator_id": ctx["operator_id"],
            "pump_id": ctx["pump_id"],
            "fuel_type": "Дизель",
            "liters": 10.0,
            "amount": 32000,
            "payment_method": "cash",
            "customer_type": "organization",
            "register_number": "6123456",
            "customer_name": lk["name"],
        }
        r = s.post(f"{API}/transactions", json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["customer_type"] == "organization"
        assert tx["register_number"] == "6123456"
        assert "Тэнгэр Тээвэр" in tx["customer_name"]
        # QR contains register
        assert "reg=6123456" in tx["ebarimt_qr_data"]


# ============= REGRESSION =============
class TestExistingHealthRegression:
    def test_root(self, s):
        r = s.get(f"{API}/")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_pin_login_regression(self, s):
        r = s.post(f"{API}/auth/pin-login", json={"pin": "1234"})
        assert r.status_code == 200

    def test_pumps_regression(self, s):
        r = s.get(f"{API}/pumps")
        assert r.status_code == 200
        assert len(r.json()) == 8

    def test_fuel_prices_regression(self, s):
        r = s.get(f"{API}/fuel-prices")
        assert r.status_code == 200

    def test_membership_lookup_regression(self, s):
        r = s.post(f"{API}/membership/lookup", json={"card_number": "1000000001"})
        assert r.status_code == 200

    def test_shift_summary_regression(self, s):
        r = s.get(f"{API}/shift/summary")
        assert r.status_code == 200
