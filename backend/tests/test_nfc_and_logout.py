# Tests for NFC login endpoints + regression checks for existing PIN/transactions flows
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -------- NFC login: happy path --------
class TestNfcLogin:
    def test_nfc_login_valid_uid(self, api):
        r = api.post(f"{BASE_URL}/api/auth/nfc-login",
                     json={"nfc_uid": "04:A1:B2:C3:D4:E5:F0"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "operator" in data
        op = data["operator"]
        assert op["name"] == "Бат-Эрдэнэ"
        assert op["nfc_uid"] == "04:A1:B2:C3:D4:E5:F0"
        assert "id" in op
        assert "_id" not in op

    def test_nfc_login_invalid_uid(self, api):
        r = api.post(f"{BASE_URL}/api/auth/nfc-login",
                     json={"nfc_uid": "FF:FF:FF:FF:FF:FF:FF"})
        assert r.status_code == 401
        assert r.json().get("detail") == "NFC карт бүртгэлгүй байна"

    def test_nfc_login_case_insensitive_lower(self, api):
        r = api.post(f"{BASE_URL}/api/auth/nfc-login",
                     json={"nfc_uid": "04:a1:b2:c3:d4:e5:f0"})
        assert r.status_code == 200, r.text
        assert r.json()["operator"]["name"] == "Бат-Эрдэнэ"

    def test_nfc_login_dashes_accepted(self, api):
        r = api.post(f"{BASE_URL}/api/auth/nfc-login",
                     json={"nfc_uid": "04-a1-b2-c3-d4-e5-f0"})
        assert r.status_code == 200, r.text
        assert r.json()["operator"]["name"] == "Бат-Эрдэнэ"

    def test_nfc_login_second_operator(self, api):
        r = api.post(f"{BASE_URL}/api/auth/nfc-login",
                     json={"nfc_uid": "04:11:22:33:44:55:66"})
        assert r.status_code == 200
        assert r.json()["operator"]["name"] == "Дөлгөөн"


# -------- NFC list (must not expose pin) --------
class TestNfcList:
    def test_nfc_list_returns_three_operators(self, api):
        r = api.get(f"{BASE_URL}/api/operators/nfc-list")
        assert r.status_code == 200
        ops = r.json()
        assert isinstance(ops, list)
        assert len(ops) == 3

    def test_nfc_list_no_pin_field(self, api):
        r = api.get(f"{BASE_URL}/api/operators/nfc-list")
        ops = r.json()
        for op in ops:
            assert "pin" not in op, f"pin leaked: {op}"
            assert "_id" not in op
            assert "id" in op
            assert "name" in op
            assert "role" in op
            assert "nfc_uid" in op
            assert op["nfc_uid"] is not None


# -------- Regression: PIN login + transactions endpoints still work --------
class TestRegression:
    def test_pin_login_still_works(self, api):
        r = api.post(f"{BASE_URL}/api/auth/pin-login", json={"pin": "1234"})
        assert r.status_code == 200
        assert r.json()["operator"]["name"] == "Бат-Эрдэнэ"

    def test_pin_login_invalid(self, api):
        r = api.post(f"{BASE_URL}/api/auth/pin-login", json={"pin": "9999"})
        assert r.status_code == 401

    def test_pumps_list(self, api):
        r = api.get(f"{BASE_URL}/api/pumps")
        assert r.status_code == 200
        assert len(r.json()) == 8

    def test_fuel_prices(self, api):
        r = api.get(f"{BASE_URL}/api/fuel-prices")
        assert r.status_code == 200
        assert len(r.json()) >= 3

    def test_membership_list(self, api):
        r = api.get(f"{BASE_URL}/api/membership")
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_shift_summary(self, api):
        r = api.get(f"{BASE_URL}/api/shift/summary")
        assert r.status_code == 200
        data = r.json()
        for k in ("total_amount", "total_liters", "transaction_count", "by_fuel", "by_payment"):
            assert k in data
