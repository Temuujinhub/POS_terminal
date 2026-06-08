"""Flux Monitor proxy endpoints tests.

We DO NOT have real Flux credentials, so we only validate:
1) /api/flux/* endpoints are reachable (no 404 routing issues).
2) Errors from Flux are surfaced (login with garbage creds → 401/4xx).
3) Session-bound endpoints reject missing/invalid X-Session-Id.
4) Existing demo /api/* endpoints are not regressed (backward compat).
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ============ Flux: AUTH ERROR PROXY ============
class TestFluxAuthProxy:
    def test_login_with_invalid_creds_returns_4xx(self, s):
        r = s.post(f"{API}/flux/auth/login",
                   json={"email": "foo@bar.mn", "password": "wrong-pass-xyz-123"},
                   timeout=35)
        assert r.status_code != 404, "Route /api/flux/auth/login is not registered"
        assert 400 <= r.status_code < 500, f"Expected 4xx from Flux upstream, got {r.status_code}: {r.text}"
        body = r.json()
        assert "detail" in body, f"Response missing 'detail': {body}"
        # Detail must be non-empty string forwarded from Flux
        assert isinstance(body["detail"], (str, list, dict))
        if isinstance(body["detail"], str):
            assert len(body["detail"]) > 0

    def test_nfc_login_with_garbage_tag_returns_4xx(self, s):
        r = s.post(f"{API}/flux/auth/nfc-login",
                   json={"nfc_tag": "DEADBEEFCAFE0000"},
                   timeout=35)
        assert r.status_code != 404, "Route /api/flux/auth/nfc-login is not registered"
        assert 400 <= r.status_code < 500, f"Expected 4xx, got {r.status_code}: {r.text}"
        body = r.json()
        assert "detail" in body

    def test_login_validation_missing_password(self, s):
        r = s.post(f"{API}/flux/auth/login", json={"email": "x@y.z"}, timeout=10)
        assert r.status_code == 422


# ============ Flux: SESSION-PROTECTED ENDPOINTS ============
class TestFluxSessionGuard:
    def test_pumps_without_session_header_returns_422(self, s):
        # Header is required via Header(..., alias="X-Session-Id"), so 422 expected
        r = s.get(f"{API}/flux/pumps", timeout=10)
        assert r.status_code in (401, 422), f"Got {r.status_code}: {r.text}"

    def test_pumps_with_invalid_session_returns_401(self, s):
        r = s.get(f"{API}/flux/pumps",
                  headers={"X-Session-Id": "not-a-real-session-uuid"}, timeout=10)
        assert r.status_code == 401
        body = r.json()
        assert "detail" in body
        # Should be the localized "session not found" message
        assert "Session" in body["detail"] or "session" in body["detail"].lower()

    def test_me_without_session_header_returns_422(self, s):
        r = s.get(f"{API}/flux/me", timeout=10)
        assert r.status_code in (401, 422)

    def test_me_with_invalid_session_returns_401(self, s):
        r = s.get(f"{API}/flux/me",
                  headers={"X-Session-Id": "00000000-0000-0000-0000-000000000000"},
                  timeout=10)
        assert r.status_code == 401

    def test_lookup_card_with_invalid_session_returns_401(self, s):
        r = s.post(f"{API}/flux/lookup-card",
                   json={"session_id": "invalid-session", "nfc_tag": "AABBCCDD"},
                   timeout=10)
        assert r.status_code == 401
        assert "detail" in r.json()

    def test_logout_without_session_returns_422(self, s):
        r = s.post(f"{API}/flux/auth/logout", timeout=10)
        assert r.status_code in (401, 422)


# ============ Flux: ROUTE REGISTRATION ============
class TestFluxRoutesRegistered:
    """Ensure all /api/flux/* routes exist (no 404)."""

    @pytest.mark.parametrize("method,path,body", [
        ("POST", "/flux/auth/login", {"email": "a@b.c", "password": "x"}),
        ("POST", "/flux/auth/nfc-login", {"nfc_tag": "AABB"}),
        ("POST", "/flux/auth/logout", None),
        ("GET", "/flux/pumps", None),
        ("POST", "/flux/lookup-card", {"session_id": "x", "nfc_tag": "AA"}),
        ("POST", "/flux/start-dispense",
         {"session_id": "x", "pump": 1, "dose_type": "Amount", "auto_close": True}),
        ("GET", "/flux/me", None),
    ])
    def test_route_not_404(self, s, method, path, body):
        r = s.request(method, f"{API}{path}", json=body, timeout=35)
        assert r.status_code != 404, f"{method} {path} returned 404 (route missing)"


# ============ Backward compat: existing demo endpoints ============
class TestExistingApisStillWork:
    def test_health(self, s):
        r = s.get(f"{API}/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_pumps_demo(self, s):
        r = s.get(f"{API}/pumps", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert "number" in data[0] and "name" in data[0]

    def test_pin_login_valid(self, s):
        r = s.post(f"{API}/auth/pin-login", json={"pin": "1234"}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "operator" in body
        assert body["operator"]["pin"] == "1234"

    def test_pin_login_invalid(self, s):
        r = s.post(f"{API}/auth/pin-login", json={"pin": "9999"}, timeout=10)
        assert r.status_code == 401

    def test_org_lookup_valid(self, s):
        r = s.get(f"{API}/organizations/lookup", params={"register": "6123456"}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("register_number") == "6123456"

    def test_org_lookup_404(self, s):
        r = s.get(f"{API}/organizations/lookup", params={"register": "0000000"}, timeout=10)
        assert r.status_code == 404
