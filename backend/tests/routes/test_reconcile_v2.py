import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.core.deps import get_db
from app.models.base import Base
from app.models.user import User
from app.models.organization import Organization, OrganizationMember
from app.models.transaction import UploadBatch, Transaction
from app.core.security import hash_password, create_access_token
from datetime import date


@pytest.fixture
def db_session():
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    app.dependency_overrides[get_db] = lambda: db
    yield db
    db.close()
    app.dependency_overrides.clear()


@pytest.fixture
def client(db_session):
    return TestClient(app)


@pytest.fixture
def seeded(db_session):
    user = User(name="A", email="a@a.com", hashed_password=hash_password("x"))
    db_session.add(user)
    db_session.flush()
    org = Organization(name="My Shop", slug="my-shop")
    db_session.add(org)
    db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=user.id, role="owner"))
    sb = UploadBatch(org_id=org.id, uploaded_by=user.id, filename="shopify.csv", source="shopify", row_count=2)
    bb = UploadBatch(org_id=org.id, uploaded_by=user.id, filename="bank.csv", source="bank", row_count=2)
    db_session.add_all([sb, bb])
    db_session.flush()
    db_session.add_all([
        Transaction(batch_id=sb.id, org_id=org.id, amount=5000, date=date(2024, 4, 5), description="Order 1"),
        Transaction(batch_id=sb.id, org_id=org.id, amount=-100, date=date(2024, 4, 5), description="Shopify fee"),
        Transaction(batch_id=bb.id, org_id=org.id, amount=4900, date=date(2024, 4, 6), description="NEFT CR SHOPIFY"),
        Transaction(batch_id=bb.id, org_id=org.id, amount=-3000, date=date(2024, 4, 7), description="Salary"),
    ])
    db_session.commit()
    token = create_access_token({"sub": str(user.id)})
    return {"user": user, "org": org, "sb": sb, "bb": bb, "token": token}


def test_start_run_creates_complete_run(client, seeded):
    headers = {"Authorization": f"Bearer {seeded['token']}"}
    r = client.post(
        f"/api/reconcile/runs/{seeded['org'].id}",
        json={"source_batch_id": seeded["sb"].id, "bank_batch_id": seeded["bb"].id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "complete"
    assert body["summary"]["matches_by_pass"]["3"] >= 1


def test_list_runs_returns_history(client, seeded):
    headers = {"Authorization": f"Bearer {seeded['token']}"}
    client.post(
        f"/api/reconcile/runs/{seeded['org'].id}",
        json={"source_batch_id": seeded["sb"].id, "bank_batch_id": seeded["bb"].id},
        headers=headers,
    )
    r = client.get(f"/api/reconcile/runs/{seeded['org'].id}", headers=headers)
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_get_run_detail_includes_matches_and_anomalies(client, seeded):
    headers = {"Authorization": f"Bearer {seeded['token']}"}
    started = client.post(
        f"/api/reconcile/runs/{seeded['org'].id}",
        json={"source_batch_id": seeded["sb"].id, "bank_batch_id": seeded["bb"].id},
        headers=headers,
    ).json()
    r = client.get(f"/api/reconcile/runs/{seeded['org'].id}/{started['id']}", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "matches" in body
    assert "anomalies" in body


def test_patch_match_status(client, seeded):
    headers = {"Authorization": f"Bearer {seeded['token']}"}
    started = client.post(
        f"/api/reconcile/runs/{seeded['org'].id}",
        json={"source_batch_id": seeded["sb"].id, "bank_batch_id": seeded["bb"].id},
        headers=headers,
    ).json()
    assert started["matches"], "expected matches"
    match_id = started["matches"][0]["id"]

    r = client.patch(
        f"/api/reconcile/matches/{match_id}",
        json={"status": "accepted"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"


def test_patch_anomaly_dismiss(client, db_session, seeded):
    from app.models.reconciliation import Anomaly
    import json as _json
    from datetime import date
    a = Anomaly(
        org_id=seeded["org"].id, rule_id="duplicate_within_window", severity="medium",
        transaction_ids=_json.dumps([1, 2]),
        detail=_json.dumps({"amount": 15000, "vendor": "google", "days_apart": 1}),
        evidence_hash="hash-test-1",
    )
    db_session.add(a); db_session.commit(); db_session.refresh(a)

    headers = {"Authorization": f"Bearer {seeded['token']}"}
    r = client.patch(
        f"/api/reconcile/anomalies/{a.id}",
        json={"status": "dismissed"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "dismissed"


def test_scan_anomalies_is_idempotent(client, seeded):
    headers = {"Authorization": f"Bearer {seeded['token']}"}
    r1 = client.post(f"/api/reconcile/anomalies/{seeded['org'].id}/scan", headers=headers)
    r2 = client.post(f"/api/reconcile/anomalies/{seeded['org'].id}/scan", headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r2.json()["new_anomalies"] == 0   # second scan creates none


def test_viewer_cannot_patch_or_scan(client, db_session):
    from app.models.user import User
    from app.models.organization import Organization, OrganizationMember
    from app.core.security import hash_password, create_access_token
    user = User(name="V", email="v@v.com", hashed_password=hash_password("x"))
    db_session.add(user); db_session.flush()
    org = Organization(name="X", slug="x")
    db_session.add(org); db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=user.id, role="viewer"))
    db_session.commit()
    token = create_access_token({"sub": str(user.id)})
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post(f"/api/reconcile/anomalies/{org.id}/scan", headers=headers)
    assert r.status_code == 403
