"""
Reconciliation v2 routes.

POST   /api/reconcile/runs/{org_id}              — start a run (synchronous)
GET    /api/reconcile/runs/{org_id}              — list past runs
GET    /api/reconcile/runs/{org_id}/{run_id}     — get run detail with matches + anomalies
PATCH  /api/reconcile/matches/{match_id}          — accept | reject (Task 16)
PATCH  /api/reconcile/anomalies/{anomaly_id}      — accept | dismiss | snooze (Task 16)
POST   /api/reconcile/anomalies/{org_id}/scan     — manual anomaly re-scan (Task 16)
"""
import json
from datetime import date, datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user, check_org_membership
from app.models.user import User
from app.models.transaction import Transaction
from app.models.reconciliation import ReconciliationRun, Match, Anomaly
from app.schemas.reconciliation import (
    StartRunRequest, RunSummaryOut, RunDetailOut,
    MatchOut, AnomalyOut, PatchMatchRequest, PatchAnomalyRequest,
)
from app.services.reconciliation_v2 import run_passes
from app.services.anomaly import detect, evidence_hash
from app.services.reconciliation_llm import explain_anomaly, explain_match
from app.services.audit import log_action


router = APIRouter(prefix="/reconcile", tags=["reconcile"])

WRITE_ROLES = {"owner", "admin"}


def _run_detail_dict(run: ReconciliationRun, matches: list, anomalies: list) -> dict:
    return {
        "id": run.id,
        "org_id": run.org_id,
        "source_batch_id": run.source_batch_id,
        "bank_batch_id": run.bank_batch_id,
        "status": run.status,
        "summary": json.loads(run.summary) if run.summary else None,
        "created_at": run.created_at,
        "completed_at": run.completed_at,
        "matches": [
            MatchOut.model_validate(m) for m in matches
        ],
        "anomalies": [
            AnomalyOut(
                id=a.id, rule_id=a.rule_id, severity=a.severity,
                transaction_ids=json.loads(a.transaction_ids),
                detail=json.loads(a.detail),
                explanation=a.explanation, status=a.status,
                snoozed_until=a.snoozed_until,
                detected_at=a.detected_at, updated_at=a.updated_at,
            ) for a in anomalies
        ],
    }


@router.post("/runs/{org_id}", response_model=RunDetailOut, status_code=201)
def start_run(
    org_id: int,
    payload: StartRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = check_org_membership(org_id, current_user, db)
    if m.role not in WRITE_ROLES:
        raise HTTPException(403, "Viewers cannot run reconciliation")

    source_txns = db.query(Transaction).filter(Transaction.batch_id == payload.source_batch_id,
                                               Transaction.org_id == org_id).all()
    bank_txns   = db.query(Transaction).filter(Transaction.batch_id == payload.bank_batch_id,
                                               Transaction.org_id == org_id).all()
    if not source_txns or not bank_txns:
        raise HTTPException(400, "Both batches must contain transactions")

    run = ReconciliationRun(
        org_id=org_id, source_batch_id=payload.source_batch_id,
        bank_batch_id=payload.bank_batch_id, started_by=current_user.id,
        status="running",
    )
    db.add(run)
    db.flush()

    try:
        result = run_passes(source_txns, bank_txns)
    except Exception as e:
        run.status = "failed"
        run.summary = json.dumps({"error": str(e)})
        run.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(500, f"Reconciliation failed: {e}")

    # Persist matches
    match_rows: list = []
    for m_dict in result["matches"]:
        explanation = explain_match(m_dict)
        row = Match(
            run_id=run.id,
            source_txn_id=m_dict["source_id"],
            bank_txn_id=m_dict["bank_id"],
            confidence=m_dict["confidence"],
            pass_no=m_dict["pass_no"],
            inferred_fee=m_dict.get("inferred_fee"),
            explanation=explanation,
        )
        db.add(row)
        match_rows.append(row)

    # Run anomaly detection across the whole org
    all_org_txns = db.query(Transaction).filter(Transaction.org_id == org_id).all()
    detected = detect(all_org_txns, current_month=date.today().replace(day=1), as_of=date.today())

    anomaly_rows: list = []
    for a in detected:
        h = evidence_hash(a)
        existing = db.query(Anomaly).filter(Anomaly.evidence_hash == h).first()
        if existing:
            anomaly_rows.append(existing)
            continue
        explanation = explain_anomaly(a)
        row = Anomaly(
            org_id=org_id, rule_id=a["rule_id"], severity=a["severity"],
            transaction_ids=json.dumps(a["transaction_ids"]),
            detail=json.dumps(a["detail"], default=str),
            explanation=explanation, evidence_hash=h,
        )
        db.add(row)
        anomaly_rows.append(row)

    # Count new anomalies before flush (they won't have id yet)
    new_anomaly_count = len([a for a in anomaly_rows if not hasattr(a, 'id') or a.id is None])

    run.status = "complete"
    run.summary = json.dumps({
        "matches_by_pass":   {str(k): v for k, v in result["matches_by_pass"].items()},
        "unmatched_source":  result["unmatched_source"],
        "unmatched_bank":    result["unmatched_bank"],
        "new_anomalies":     new_anomaly_count,
    })
    run.completed_at = datetime.utcnow()

    log_action(db, "reconcile.run", user_id=current_user.id, org_id=org_id,
               resource=f"run:{run.id}",
               detail={"matches": len(match_rows), "anomalies": len(anomaly_rows)})
    db.commit()
    db.refresh(run)
    for row in match_rows:
        db.refresh(row)
    for row in anomaly_rows:
        db.refresh(row)

    return _run_detail_dict(run, match_rows, anomaly_rows)


@router.get("/runs/{org_id}", response_model=List[RunSummaryOut])
def list_runs(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)
    runs = db.query(ReconciliationRun).filter(ReconciliationRun.org_id == org_id) \
                                      .order_by(ReconciliationRun.created_at.desc()) \
                                      .limit(50).all()
    return [
        RunSummaryOut(
            id=r.id, org_id=r.org_id, source_batch_id=r.source_batch_id,
            bank_batch_id=r.bank_batch_id, status=r.status,
            summary=json.loads(r.summary) if r.summary else None,
            created_at=r.created_at, completed_at=r.completed_at,
        )
        for r in runs
    ]


@router.get("/runs/{org_id}/{run_id}", response_model=RunDetailOut)
def get_run(
    org_id: int, run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)
    run = db.query(ReconciliationRun).filter(
        ReconciliationRun.id == run_id, ReconciliationRun.org_id == org_id
    ).first()
    if not run:
        raise HTTPException(404, "Run not found")
    matches   = db.query(Match).filter(Match.run_id == run.id).all()
    anomalies = db.query(Anomaly).filter(Anomaly.org_id == org_id, Anomaly.status != "dismissed") \
                                 .order_by(Anomaly.detected_at.desc()).limit(50).all()
    return _run_detail_dict(run, matches, anomalies)


@router.patch("/matches/{match_id}", response_model=MatchOut)
def patch_match(
    match_id: int,
    payload: PatchMatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m_row = db.query(Match).filter(Match.id == match_id).first()
    if not m_row:
        raise HTTPException(404, "Match not found")
    run = db.query(ReconciliationRun).filter(ReconciliationRun.id == m_row.run_id).first()
    membership = check_org_membership(run.org_id, current_user, db)
    if membership.role not in WRITE_ROLES:
        raise HTTPException(403, "Viewers cannot triage matches")
    m_row.status = payload.status
    db.commit()
    db.refresh(m_row)
    return m_row


@router.patch("/anomalies/{anomaly_id}", response_model=AnomalyOut)
def patch_anomaly(
    anomaly_id: int,
    payload: PatchAnomalyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    a = db.query(Anomaly).filter(Anomaly.id == anomaly_id).first()
    if not a:
        raise HTTPException(404, "Anomaly not found")
    membership = check_org_membership(a.org_id, current_user, db)
    if membership.role not in WRITE_ROLES:
        raise HTTPException(403, "Viewers cannot triage anomalies")
    a.status = payload.status
    a.snoozed_until = payload.snoozed_until
    db.commit()
    db.refresh(a)
    return AnomalyOut(
        id=a.id, rule_id=a.rule_id, severity=a.severity,
        transaction_ids=json.loads(a.transaction_ids),
        detail=json.loads(a.detail),
        explanation=a.explanation, status=a.status,
        snoozed_until=a.snoozed_until,
        detected_at=a.detected_at, updated_at=a.updated_at,
    )


@router.post("/anomalies/{org_id}/scan")
def scan_anomalies(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = check_org_membership(org_id, current_user, db)
    if m.role not in WRITE_ROLES:
        raise HTTPException(403, "Viewers cannot trigger scans")

    all_org_txns = db.query(Transaction).filter(Transaction.org_id == org_id).all()
    detected = detect(all_org_txns, current_month=date.today().replace(day=1), as_of=date.today())

    new_count = 0
    for a in detected:
        h = evidence_hash(a)
        if db.query(Anomaly).filter(Anomaly.evidence_hash == h).first():
            continue
        explanation = explain_anomaly(a)
        db.add(Anomaly(
            org_id=org_id, rule_id=a["rule_id"], severity=a["severity"],
            transaction_ids=json.dumps(a["transaction_ids"]),
            detail=json.dumps(a["detail"], default=str),
            explanation=explanation, evidence_hash=h,
        ))
        new_count += 1
    db.commit()
    return {"new_anomalies": new_count, "scanned": len(detected)}
