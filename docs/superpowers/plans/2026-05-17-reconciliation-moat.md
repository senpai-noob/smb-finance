# Reconciliation Moat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single-pass keyword matcher with a 4-pass deterministic reconciliation engine + 5-rule anomaly detector + optional Claude explainer, and rebuild the `/reconcile` page as a persistent triage queue.

**Architecture:** Backend gains three new tables (`reconciliation_runs`, `matches`, `anomalies`) and three new services (`reconciliation_v2.py`, `anomaly.py`, `reconciliation_llm.py`) behind a new `/api/reconcile/` router. The LLM explainer wraps deterministic findings and falls back to templates when `ANTHROPIC_API_KEY` is absent, mirroring `services/llm_insights.py`. Frontend replaces the existing reconcile page with a 3-column triage queue (auto-matched / needs-review / anomalies) plus a slide-in drilldown drawer.

**Tech Stack:** Python 3.11 · FastAPI 0.111 · SQLAlchemy 2.0 · Alembic 1.13 · pytest · Anthropic SDK · Next.js 16 · React 19 · TypeScript 5 · Tailwind 3.4 · Recharts 3.

**Spec:** `docs/superpowers/specs/2026-05-17-reconciliation-moat-design.md`

---

## File structure

### Backend — create

| File | Responsibility |
|---|---|
| `backend/app/models/reconciliation.py` | ORM: `ReconciliationRun`, `Match`, `Anomaly` |
| `backend/app/schemas/reconciliation.py` | Pydantic DTOs for routes |
| `backend/app/services/reconciliation_v2.py` | 4-pass matcher; top-level `run()` |
| `backend/app/services/anomaly.py` | 5 deterministic rules + `detect()` orchestrator |
| `backend/app/services/reconciliation_llm.py` | Batched Claude explainer + templates + cache |
| `backend/app/api/routes/reconcile_v2.py` | New router under `/api/reconcile/` |
| `backend/alembic/versions/XXXX_reconciliation_tables.py` | Migration: 3 tables + 5 indexes |
| `backend/tests/conftest.py` (if missing) | Shared pytest fixtures (db, client) |
| `backend/tests/fixtures/shopify_payouts_test.csv` | 50 rows, known fee patterns |
| `backend/tests/fixtures/bank_test.csv` | 40 rows, ±2% noise, 2 seeded anomalies |
| `backend/tests/services/test_reconciliation_v2.py` | Per-pass + full-pipeline tests |
| `backend/tests/services/test_anomaly.py` | One test per rule |
| `backend/tests/services/test_reconciliation_llm.py` | Mocked Claude + fallback + cache |
| `backend/tests/routes/test_reconcile_v2.py` | Route integration tests |

### Backend — modify

| File | What changes |
|---|---|
| `backend/app/db/base.py` | Import the three new models |
| `backend/app/main.py` | Register the new router |
| `backend/app/api/routes/transactions.py` | Deprecate the legacy `/transactions/reconcile/...` route (keep for one release as a shim) |

### Frontend — create

| File | Responsibility |
|---|---|
| `frontend/lib/reconcile.ts` | Typed API client helpers |
| `frontend/components/reconcile/states.tsx` | `LoadingState`, `EmptyState`, `ErrorState` inline primitives |
| `frontend/components/reconcile/MatchCard.tsx` | Single match card with accept/reject |
| `frontend/components/reconcile/AnomalyCard.tsx` | Single anomaly card with accept/dismiss/snooze |
| `frontend/components/reconcile/TriageColumn.tsx` | Column wrapper (header + count + scrollable cards) |
| `frontend/components/reconcile/RunHistoryStrip.tsx` | Last-5-runs selector |
| `frontend/components/reconcile/DrilldownDrawer.tsx` | Right-side slide-in for raw JSON + audit trail |

### Frontend — modify

| File | What changes |
|---|---|
| `frontend/app/reconcile/page.tsx` | Full rewrite — wire all triage components together |

---

## Tasks

### Task 1: Add reconciliation ORM models + Alembic migration

**Files:**
- Create: `backend/app/models/reconciliation.py`
- Modify: `backend/app/db/base.py`
- Create: `backend/alembic/versions/0001_reconciliation_tables.py` (rename if conflicts)

- [ ] **Step 1: Create the models file**

Write `backend/app/models/reconciliation.py`:

```python
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from app.models.base import Base


class ReconciliationRun(Base):
    __tablename__ = "reconciliation_runs"

    id              = Column(Integer, primary_key=True, index=True)
    org_id          = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    source_batch_id = Column(Integer, ForeignKey("upload_batches.id"), nullable=False)
    bank_batch_id   = Column(Integer, ForeignKey("upload_batches.id"), nullable=False)
    started_by      = Column(Integer, ForeignKey("users.id"), nullable=False)
    status          = Column(String, default="running")   # running | complete | failed
    summary         = Column(Text, nullable=True)         # JSON
    created_at      = Column(DateTime, default=datetime.utcnow)
    completed_at    = Column(DateTime, nullable=True)

    matches = relationship("Match", back_populates="run", cascade="all, delete-orphan")


class Match(Base):
    __tablename__ = "matches"

    id            = Column(Integer, primary_key=True, index=True)
    run_id        = Column(Integer, ForeignKey("reconciliation_runs.id"), nullable=False)
    source_txn_id = Column(Integer, ForeignKey("transactions.id"), nullable=False)
    bank_txn_id   = Column(Integer, ForeignKey("transactions.id"), nullable=False)
    confidence    = Column(String, nullable=False)        # high | medium | low
    pass_no       = Column(Integer, nullable=False)       # 1 | 2 | 3
    inferred_fee  = Column(Float, nullable=True)
    explanation   = Column(Text, nullable=True)
    status        = Column(String, default="pending")     # pending | accepted | rejected
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    run = relationship("ReconciliationRun", back_populates="matches")


class Anomaly(Base):
    __tablename__ = "anomalies"

    id              = Column(Integer, primary_key=True, index=True)
    org_id          = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    rule_id         = Column(String, nullable=False)
    severity        = Column(String, nullable=False)      # low | medium | high
    transaction_ids = Column(Text, nullable=False)        # JSON list
    detail          = Column(Text, nullable=False)        # JSON
    explanation     = Column(Text, nullable=True)
    status          = Column(String, default="open")      # open | accepted | dismissed | snoozed
    snoozed_until   = Column(DateTime, nullable=True)
    evidence_hash   = Column(String, nullable=False, unique=True, index=True)
    detected_at     = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: Wire into `db/base.py`**

Read `backend/app/db/base.py`. Append two lines:

```python
from app.models.reconciliation import ReconciliationRun, Match, Anomaly  # noqa
```

- [ ] **Step 3: Generate the Alembic migration**

```
cd backend
alembic revision --autogenerate -m "add reconciliation tables and indexes"
```

Open the generated file under `backend/alembic/versions/`. Replace its body with an explicit migration that creates the three tables AND adds the five indexes (the autogenerator may miss some indexes; verify manually):

```python
"""add reconciliation tables and indexes

Revision ID: XXXX
Revises: <previous>
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa

revision = "XXXX"            # leave whatever was generated
down_revision = "<previous>" # leave whatever was generated
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reconciliation_runs",
        sa.Column("id",              sa.Integer, primary_key=True),
        sa.Column("org_id",          sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("source_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id"), nullable=False),
        sa.Column("bank_batch_id",   sa.Integer, sa.ForeignKey("upload_batches.id"), nullable=False),
        sa.Column("started_by",      sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status",          sa.String, server_default="running"),
        sa.Column("summary",         sa.Text, nullable=True),
        sa.Column("created_at",      sa.DateTime, server_default=sa.func.now()),
        sa.Column("completed_at",    sa.DateTime, nullable=True),
    )
    op.create_index("ix_reconciliation_runs_org_created", "reconciliation_runs", ["org_id", "created_at"])

    op.create_table(
        "matches",
        sa.Column("id",            sa.Integer, primary_key=True),
        sa.Column("run_id",        sa.Integer, sa.ForeignKey("reconciliation_runs.id"), nullable=False),
        sa.Column("source_txn_id", sa.Integer, sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("bank_txn_id",   sa.Integer, sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("confidence",    sa.String, nullable=False),
        sa.Column("pass_no",       sa.Integer, nullable=False),
        sa.Column("inferred_fee",  sa.Float, nullable=True),
        sa.Column("explanation",   sa.Text, nullable=True),
        sa.Column("status",        sa.String, server_default="pending"),
        sa.Column("created_at",    sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at",    sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_matches_run_status", "matches", ["run_id", "status"])

    op.create_table(
        "anomalies",
        sa.Column("id",              sa.Integer, primary_key=True),
        sa.Column("org_id",          sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("rule_id",         sa.String, nullable=False),
        sa.Column("severity",        sa.String, nullable=False),
        sa.Column("transaction_ids", sa.Text, nullable=False),
        sa.Column("detail",          sa.Text, nullable=False),
        sa.Column("explanation",     sa.Text, nullable=True),
        sa.Column("status",          sa.String, server_default="open"),
        sa.Column("snoozed_until",   sa.DateTime, nullable=True),
        sa.Column("evidence_hash",   sa.String, nullable=False),
        sa.Column("detected_at",     sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at",      sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("evidence_hash", name="uq_anomaly_evidence_hash"),
    )
    op.create_index("ix_anomalies_org_status_severity", "anomalies", ["org_id", "status", "severity"])

    # Missing indexes on existing transactions table
    op.create_index("ix_transactions_org_date", "transactions", ["org_id", "date"])
    op.create_index("ix_transactions_org_category", "transactions", ["org_id", "category"])


def downgrade() -> None:
    op.drop_index("ix_transactions_org_category", table_name="transactions")
    op.drop_index("ix_transactions_org_date", table_name="transactions")
    op.drop_index("ix_anomalies_org_status_severity", table_name="anomalies")
    op.drop_table("anomalies")
    op.drop_index("ix_matches_run_status", table_name="matches")
    op.drop_table("matches")
    op.drop_index("ix_reconciliation_runs_org_created", table_name="reconciliation_runs")
    op.drop_table("reconciliation_runs")
```

- [ ] **Step 4: Run the migration**

```
cd backend
alembic upgrade head
```

Expected: three new tables created. Verify with:

```
sqlite3 smb_finance.db ".tables" | tr ' ' '\n' | grep -E "reconciliation_runs|matches|anomalies"
```

Expected output: all three names.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/reconciliation.py backend/app/db/base.py backend/alembic/versions/
git commit -m "feat(reconcile): add reconciliation tables and indexes"
```

---

### Task 2: Test fixtures (sample CSVs)

**Files:**
- Create: `backend/tests/fixtures/shopify_payouts_test.csv`
- Create: `backend/tests/fixtures/bank_test.csv`

- [ ] **Step 1: Create the Shopify fixture**

Write `backend/tests/fixtures/shopify_payouts_test.csv`:

```csv
Payout Date,Description,Type,Amount,Fee,Net,Currency
2024-04-01,Order #1001,sale,5000,150,4850,INR
2024-04-01,Order #1002,sale,3200,96,3104,INR
2024-04-02,Order #1003,sale,8500,255,8245,INR
2024-04-02,Refund #1003,refund,-2000,0,-2000,INR
2024-04-03,Order #1004,sale,12000,360,11640,INR
2024-04-03,Order #1005,sale,4500,135,4365,INR
2024-04-04,Order #1006,sale,7800,234,7566,INR
2024-04-05,Payout,payout,0,0,38770,INR
2024-04-08,Order #1007,sale,15000,450,14550,INR
2024-04-08,Order #1008,sale,2200,66,2134,INR
2024-04-10,Order #1009,sale,9300,279,9021,INR
2024-04-12,Payout,payout,0,0,25705,INR
```

- [ ] **Step 2: Create the bank fixture**

Write `backend/tests/fixtures/bank_test.csv`. Includes ±2% amount noise on some rows to exercise the fuzzy pass, plus two seeded anomalies (a duplicate-within-window and a refund-without-charge):

```csv
Date,Description,Amount,Currency
2024-04-05,NEFT CR SHOPIFY PAYMENTS,38770,INR
2024-04-12,NEFT CR SHOPIFY PAYMENTS,25710,INR
2024-04-15,GOOGLE ADS DEBIT,-15000,INR
2024-04-16,GOOGLE ADS DEBIT,-15000,INR
2024-04-18,REFUND CUSTOMER ABC,2500,INR
2024-04-20,SALARY APR JANE,-45000,INR
2024-04-20,DELHIVERY COURIER,-3200,INR
2024-04-22,AWS INVOICE,-4500,INR
2024-04-25,RENT APR,-25000,INR
2024-04-28,GST PAYMENT GSTR-3B,-12000,INR
2024-04-30,NEFT CR SHOPIFY PAYMENTS,15050,INR
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/fixtures/
git commit -m "test(reconcile): add Shopify + bank CSV fixtures"
```

---

### Task 3: Pass 1 — exact matcher (TDD)

**Files:**
- Create: `backend/app/services/reconciliation_v2.py`
- Create: `backend/tests/services/test_reconciliation_v2.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/services/test_reconciliation_v2.py`:

```python
from datetime import date
from types import SimpleNamespace

from app.services.reconciliation_v2 import pass_exact


def _txn(id, amount, dt, description=""):
    return SimpleNamespace(id=id, amount=amount, date=dt, description=description)


def test_pass_exact_pairs_same_amount_same_day():
    source = [_txn(1, -5000, date(2024, 4, 5), "Google Ads")]
    bank   = [_txn(2,  5000, date(2024, 4, 5), "GOOGLE ADS DEBIT")]

    matches, unmatched_src, unmatched_bank = pass_exact(source, bank)

    assert len(matches) == 1
    assert matches[0]["source_id"] == 1
    assert matches[0]["bank_id"] == 2
    assert matches[0]["confidence"] == "high"
    assert matches[0]["pass_no"] == 1
    assert unmatched_src == []
    assert unmatched_bank == []


def test_pass_exact_pairs_within_one_day_window():
    source = [_txn(1, -5000, date(2024, 4, 5))]
    bank   = [_txn(2,  5000, date(2024, 4, 6))]
    matches, _, _ = pass_exact(source, bank)
    assert len(matches) == 1


def test_pass_exact_does_not_pair_outside_window():
    source = [_txn(1, -5000, date(2024, 4, 5))]
    bank   = [_txn(2,  5000, date(2024, 4, 7))]
    matches, unmatched_src, unmatched_bank = pass_exact(source, bank)
    assert matches == []
    assert len(unmatched_src) == 1
    assert len(unmatched_bank) == 1


def test_pass_exact_defers_ambiguous_to_later_pass():
    source = [_txn(1, -5000, date(2024, 4, 5))]
    bank   = [_txn(2, 5000, date(2024, 4, 5)),
              _txn(3, 5000, date(2024, 4, 5))]
    matches, unmatched_src, unmatched_bank = pass_exact(source, bank)
    # Ambiguous → no match, source returned for pass 2
    assert matches == []
    assert len(unmatched_src) == 1
    assert len(unmatched_bank) == 2
```

- [ ] **Step 2: Run test to verify it fails**

```
cd backend
pytest tests/services/test_reconciliation_v2.py -v
```

Expected: `ImportError: cannot import name 'pass_exact'`.

- [ ] **Step 3: Implement pass 1**

Write `backend/app/services/reconciliation_v2.py`:

```python
"""
Reconciliation v2 — 4-pass deterministic matcher.

Each pass is a pure function operating on plain lists of transaction-like
objects (anything with .id, .amount, .date, .description). Passes return
(matches, unmatched_source, unmatched_bank) so the orchestrator can chain
them. Matches are dicts (not ORM rows) so passes stay DB-agnostic.
"""
from typing import List, Tuple, Any


def pass_exact(
    source: List[Any],
    bank: List[Any],
) -> Tuple[List[dict], List[Any], List[Any]]:
    """Pass 1: exact abs(amount) match within ±1 day. High confidence.
    Ambiguous candidates (>1 match) are deferred to later passes.
    """
    matches: List[dict] = []
    matched_src_ids: set[int] = set()
    matched_bank_ids: set[int] = set()

    for s in source:
        candidates = [
            b for b in bank
            if b.id not in matched_bank_ids
            and abs(s.amount) == abs(b.amount)
            and abs((s.date - b.date).days) <= 1
        ]
        if len(candidates) == 1:
            b = candidates[0]
            matches.append({
                "source_id": s.id,
                "bank_id":   b.id,
                "confidence": "high",
                "pass_no":   1,
                "inferred_fee": None,
            })
            matched_src_ids.add(s.id)
            matched_bank_ids.add(b.id)

    unmatched_src  = [s for s in source if s.id not in matched_src_ids]
    unmatched_bank = [b for b in bank   if b.id not in matched_bank_ids]
    return matches, unmatched_src, unmatched_bank
```

- [ ] **Step 4: Run test to verify it passes**

```
pytest tests/services/test_reconciliation_v2.py -v
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reconciliation_v2.py backend/tests/services/test_reconciliation_v2.py
git commit -m "feat(reconcile): pass 1 exact matcher with date window"
```

---

### Task 4: Pass 2 — fuzzy amount + date window (TDD)

**Files:**
- Modify: `backend/app/services/reconciliation_v2.py`
- Modify: `backend/tests/services/test_reconciliation_v2.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_reconciliation_v2.py`:

```python
from app.services.reconciliation_v2 import pass_fuzzy


def test_pass_fuzzy_matches_within_two_percent_amount():
    source = [_txn(1, -5000, date(2024, 4, 5), "Google Ads Campaign")]
    bank   = [_txn(2,  5050, date(2024, 4, 5), "GOOGLE ADS DEBIT")]   # +1%

    matches, _, _ = pass_fuzzy(source, bank)
    assert len(matches) == 1
    assert matches[0]["confidence"] == "medium"
    assert matches[0]["pass_no"] == 2


def test_pass_fuzzy_matches_within_three_day_window():
    source = [_txn(1, -5000, date(2024, 4, 5), "Google Ads")]
    bank   = [_txn(2,  5000, date(2024, 4, 8), "GOOGLE ADS DEBIT")]
    matches, _, _ = pass_fuzzy(source, bank)
    assert len(matches) == 1


def test_pass_fuzzy_rejects_low_combined_score():
    # Amount close but description has zero overlap and date 3 days off
    source = [_txn(1, -5000, date(2024, 4, 5), "Salary Jane")]
    bank   = [_txn(2,  5000, date(2024, 4, 8), "AWS Invoice")]
    matches, unmatched_src, unmatched_bank = pass_fuzzy(source, bank)
    assert matches == []
    assert len(unmatched_src) == 1
    assert len(unmatched_bank) == 1


def test_pass_fuzzy_picks_best_score_when_multiple_candidates():
    source = [_txn(1, -5000, date(2024, 4, 5), "Google Ads")]
    bank   = [
        _txn(2,  5000, date(2024, 4, 8), "Random thing"),   # date far, no overlap
        _txn(3,  5050, date(2024, 4, 5), "GOOGLE ADS DEBIT"),  # close date + overlap
    ]
    matches, _, _ = pass_fuzzy(source, bank)
    assert len(matches) == 1
    assert matches[0]["bank_id"] == 3
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_reconciliation_v2.py -v
```

Expected: `ImportError: cannot import name 'pass_fuzzy'`.

- [ ] **Step 3: Implement pass 2**

Append to `backend/app/services/reconciliation_v2.py`:

```python
import re


_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str | None) -> set[str]:
    if not text:
        return set()
    return {t for t in _WORD_RE.findall(text.lower()) if len(t) > 2}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / max(1, len(a | b))


def pass_fuzzy(
    source: List[Any],
    bank: List[Any],
) -> Tuple[List[dict], List[Any], List[Any]]:
    """Pass 2: fuzzy amount (±2% or ±₹2 absolute) + date window (±3 days).
    Score = 0.4*amount + 0.3*date + 0.3*description-overlap. Threshold 0.55."""
    matches: List[dict] = []
    matched_src_ids: set[int] = set()
    matched_bank_ids: set[int] = set()

    for s in source:
        s_amt = abs(s.amount)
        tolerance = max(2.0, s_amt * 0.02)
        s_toks = _tokens(s.description)
        best: tuple[float, Any] | None = None
        for b in bank:
            if b.id in matched_bank_ids:
                continue
            amt_delta = abs(s_amt - abs(b.amount))
            if amt_delta > tolerance:
                continue
            day_delta = abs((s.date - b.date).days)
            if day_delta > 3:
                continue
            amount_proximity = 1.0 - (amt_delta / tolerance if tolerance else 0)
            date_proximity   = 1.0 - (day_delta / 3.0)
            overlap          = _jaccard(s_toks, _tokens(b.description))
            score = 0.4 * amount_proximity + 0.3 * date_proximity + 0.3 * overlap
            if score >= 0.55 and (best is None or score > best[0]):
                best = (score, b)

        if best:
            _, b = best
            matches.append({
                "source_id":   s.id,
                "bank_id":     b.id,
                "confidence":  "medium",
                "pass_no":     2,
                "inferred_fee": None,
            })
            matched_src_ids.add(s.id)
            matched_bank_ids.add(b.id)

    unmatched_src  = [s for s in source if s.id not in matched_src_ids]
    unmatched_bank = [b for b in bank   if b.id not in matched_bank_ids]
    return matches, unmatched_src, unmatched_bank
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_reconciliation_v2.py -v
```

Expected: all eight tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reconciliation_v2.py backend/tests/services/test_reconciliation_v2.py
git commit -m "feat(reconcile): pass 2 fuzzy matcher with weighted score"
```

---

### Task 5: Pass 3 — fee inference for Shopify payouts (TDD)

**Files:**
- Modify: `backend/app/services/reconciliation_v2.py`
- Modify: `backend/tests/services/test_reconciliation_v2.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_reconciliation_v2.py`:

```python
from app.services.reconciliation_v2 import pass_fee_inference


def test_pass_fee_inference_groups_orders_minus_fee_to_one_credit():
    # Three orders + one fee row, summed = a single bank credit
    source = [
        _txn(1, 5000, date(2024, 4, 5), "Order #1"),
        _txn(2, 3000, date(2024, 4, 5), "Order #2"),
        _txn(3, 2000, date(2024, 4, 5), "Order #3"),
        _txn(4, -250, date(2024, 4, 5), "Shopify processing fee"),
    ]
    # 5000+3000+2000-250 = 9750
    bank = [_txn(99, 9750, date(2024, 4, 6), "NEFT CR SHOPIFY PAYMENTS")]

    matches, unmatched_src, unmatched_bank = pass_fee_inference(source, bank)

    assert len(matches) == 4   # all four source rows paired to one bank credit
    assert all(m["pass_no"] == 3 for m in matches)
    assert all(m["confidence"] == "medium" for m in matches)
    assert unmatched_bank == []


def test_pass_fee_inference_requires_fee_row_in_group():
    source = [
        _txn(1, 5000, date(2024, 4, 5), "Order #1"),
        _txn(2, 3000, date(2024, 4, 5), "Order #2"),
    ]
    # Sum is 8000, bank shows 8000 — but no fee row → not pass-3 (pass 1 should handle one of these)
    bank = [_txn(99, 8000, date(2024, 4, 6), "NEFT CR")]

    matches, unmatched_src, unmatched_bank = pass_fee_inference(source, bank)
    assert matches == []


def test_pass_fee_inference_respects_date_window():
    source = [
        _txn(1, 5000, date(2024, 4, 1), "Order #1"),
        _txn(2, -100, date(2024, 4, 1), "Shopify fee"),
    ]
    bank = [_txn(99, 4900, date(2024, 4, 10), "NEFT CR")]   # 9 days away
    matches, _, _ = pass_fee_inference(source, bank)
    assert matches == []
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_reconciliation_v2.py -v -k fee_inference
```

Expected: `ImportError`.

- [ ] **Step 3: Implement pass 3**

Append to `backend/app/services/reconciliation_v2.py`:

```python
from itertools import combinations


_FEE_PATTERN = re.compile(r"\b(fee|fees|charge|charges|commission)\b", re.IGNORECASE)


def _contains_fee(txns: List[Any]) -> bool:
    for t in txns:
        if t.description and _FEE_PATTERN.search(t.description):
            return True
        if getattr(t, "category", None) == "Banking & Finance":
            return True
    return False


def pass_fee_inference(
    source: List[Any],
    bank: List[Any],
    max_subset_size: int = 8,
) -> Tuple[List[dict], List[Any], List[Any]]:
    """Pass 3: a single bank credit ≈ sum of N source line-items minus a fee row.

    For each positive bank credit b, search source for a subset S where:
      |sum(S.amount) - b.amount| <= max(5, b.amount*0.005)
      all S.date within ±2 days of b.date
      S contains at least one fee-flavoured row
    Bounded to subset size <= max_subset_size.
    """
    matches: List[dict] = []
    matched_src_ids: set[int] = set()
    matched_bank_ids: set[int] = set()

    for b in bank:
        if b.amount <= 0:
            continue
        candidate_src = [
            s for s in source
            if s.id not in matched_src_ids
            and abs((s.date - b.date).days) <= 2
        ]
        tolerance = max(5.0, b.amount * 0.005)
        found_subset: list[Any] | None = None

        for size in range(2, min(max_subset_size, len(candidate_src)) + 1):
            for combo in combinations(candidate_src, size):
                total = sum(t.amount for t in combo)
                if abs(total - b.amount) <= tolerance and _contains_fee(list(combo)):
                    found_subset = list(combo)
                    break
            if found_subset:
                break

        if found_subset:
            inferred_fee = b.amount - sum(t.amount for t in found_subset)
            for s in found_subset:
                matches.append({
                    "source_id":    s.id,
                    "bank_id":      b.id,
                    "confidence":   "medium",
                    "pass_no":      3,
                    "inferred_fee": round(inferred_fee, 2) if abs(inferred_fee) > 0.01 else None,
                })
                matched_src_ids.add(s.id)
            matched_bank_ids.add(b.id)

    unmatched_src  = [s for s in source if s.id not in matched_src_ids]
    unmatched_bank = [b for b in bank   if b.id not in matched_bank_ids]
    return matches, unmatched_src, unmatched_bank
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_reconciliation_v2.py -v
```

Expected: all eleven tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reconciliation_v2.py backend/tests/services/test_reconciliation_v2.py
git commit -m "feat(reconcile): pass 3 fee-inference for Shopify payouts"
```

---

### Task 6: End-to-end `run()` orchestrator (TDD)

**Files:**
- Modify: `backend/app/services/reconciliation_v2.py`
- Modify: `backend/tests/services/test_reconciliation_v2.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_reconciliation_v2.py`:

```python
from app.services.reconciliation_v2 import run_passes


def test_run_passes_chains_all_three_passes():
    source = [
        # pass 1 hit
        _txn(1, -5000, date(2024, 4, 5), "Google Ads"),
        # pass 2 hit (off by 1%)
        _txn(2, -10000, date(2024, 4, 6), "AWS Invoice March"),
        # pass 3 group
        _txn(3, 4000, date(2024, 4, 8), "Order A"),
        _txn(4, 3000, date(2024, 4, 8), "Order B"),
        _txn(5, -100, date(2024, 4, 8), "Shopify fee"),
        # leftover
        _txn(6, -777, date(2024, 4, 9), "Random"),
    ]
    bank = [
        _txn(11, 5000,  date(2024, 4, 5), "GOOGLE ADS"),
        _txn(12, 10100, date(2024, 4, 6), "AWS INVOICE"),
        _txn(13, 6900,  date(2024, 4, 9), "NEFT CR SHOPIFY PAYMENTS"),
    ]
    result = run_passes(source, bank)

    assert result["matches_by_pass"] == {1: 1, 2: 1, 3: 3}
    assert result["unmatched_source"] == [6]
    assert result["unmatched_bank"]   == []
    assert len(result["matches"]) == 5
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_reconciliation_v2.py::test_run_passes_chains_all_three_passes -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement orchestrator**

Append to `backend/app/services/reconciliation_v2.py`:

```python
def run_passes(source: List[Any], bank: List[Any]) -> dict:
    """Orchestrate the 4 passes and return a result dict consumed by the route."""
    all_matches: List[dict] = []
    s, b = source, bank
    by_pass = {1: 0, 2: 0, 3: 0}

    matches_1, s, b = pass_exact(s, b)
    all_matches.extend(matches_1)
    by_pass[1] = len(matches_1)

    matches_2, s, b = pass_fuzzy(s, b)
    all_matches.extend(matches_2)
    by_pass[2] = len(matches_2)

    matches_3, s, b = pass_fee_inference(s, b)
    all_matches.extend(matches_3)
    by_pass[3] = len(matches_3)

    return {
        "matches":           all_matches,
        "matches_by_pass":   by_pass,
        "unmatched_source":  [t.id for t in s],
        "unmatched_bank":    [t.id for t in b],
    }
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_reconciliation_v2.py -v
```

Expected: all twelve tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reconciliation_v2.py backend/tests/services/test_reconciliation_v2.py
git commit -m "feat(reconcile): run_passes orchestrator chains all 3 passes"
```

---

### Task 7: Anomaly rule — `vendor_spike` (TDD)

**Files:**
- Create: `backend/app/services/anomaly.py`
- Create: `backend/tests/services/test_anomaly.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/services/test_anomaly.py`:

```python
import json
from datetime import date
from types import SimpleNamespace

from app.services.anomaly import vendor_spike


def _txn(id, amount, dt, description=""):
    return SimpleNamespace(id=id, amount=amount, date=dt, description=description, category="Advertising & Marketing")


def test_vendor_spike_flags_three_sigma_deviation():
    # Six months of ~₹10,000 Google Ads spend, then April spike to ₹50,000
    txns = []
    next_id = 1
    for m in range(10, 4, -1):       # Oct..Apr-1 of prior year, stable spend
        txns.append(_txn(next_id, -10000, date(2023, m, 15), "Google Ads"))
        next_id += 1
    for m in range(1, 4):            # Jan, Feb, Mar 2024
        txns.append(_txn(next_id, -10000, date(2024, m, 15), "Google Ads"))
        next_id += 1
    # April spike
    txns.append(_txn(next_id, -50000, date(2024, 4, 15), "Google Ads"))

    anomalies = vendor_spike(txns, current_month=date(2024, 4, 1))
    assert len(anomalies) == 1
    a = anomalies[0]
    assert a["rule_id"] == "vendor_spike"
    assert a["severity"] in ("medium", "high")
    detail = a["detail"]
    assert detail["vendor"].lower().startswith("google")
    assert detail["current"] == 50000.0
    assert detail["mean"] == 10000.0
    assert detail["deviation_sigma"] >= 3.0


def test_vendor_spike_ignores_within_normal_range():
    txns = [_txn(i, -10000, date(2024, m, 15), "Google Ads")
            for i, m in enumerate(range(1, 5), 1)]
    anomalies = vendor_spike(txns, current_month=date(2024, 4, 1))
    assert anomalies == []
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_anomaly.py -v
```

Expected: `ImportError: cannot import name 'vendor_spike'`.

- [ ] **Step 3: Implement the rule**

Write `backend/app/services/anomaly.py`:

```python
"""
Deterministic anomaly rules. Each rule is a pure function:
  (transactions: list, **rule-specific-args) -> list[dict]

Returned dicts are NOT ORM rows — orchestrator persists them.
Schema per rule:
  {
    "rule_id":         str,
    "severity":        "low" | "medium" | "high",
    "transaction_ids": list[int],
    "detail":          dict (rule-specific evidence schema),
  }
"""
import hashlib
import json
import re
import statistics
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _vendor_key(description: str | None) -> str:
    """Cluster vendor identity by the longest non-trivial token."""
    if not description:
        return "unknown"
    toks = [t for t in _TOKEN_RE.findall(description.lower()) if len(t) > 3]
    if not toks:
        return description.lower()[:32]
    # Use longest as canonical — usually the brand name beats noise like "DEBIT".
    return max(toks, key=len)


def vendor_spike(
    transactions: list[Any],
    current_month: date,
) -> list[dict]:
    """3σ rule on monthly vendor spend.

    Group expenses (amount < 0) by vendor + month. For each vendor with at
    least 4 prior months of data, compute mean+stddev and flag current-month
    spend > mean + 3σ.
    """
    # Group: vendor -> {month_str -> total_abs_spend}
    by_vendor: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    by_vendor_ids: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))

    cur_key = current_month.strftime("%Y-%m")

    for t in transactions:
        if t.amount >= 0 or not t.date:
            continue
        vendor = _vendor_key(t.description)
        m_key = t.date.strftime("%Y-%m")
        by_vendor[vendor][m_key] += abs(t.amount)
        by_vendor_ids[vendor][m_key].append(t.id)

    anomalies: list[dict] = []
    for vendor, months in by_vendor.items():
        if cur_key not in months:
            continue
        prior_months = {k: v for k, v in months.items() if k < cur_key}
        if len(prior_months) < 4:
            continue
        prior_values = list(prior_months.values())
        mean = statistics.mean(prior_values)
        stddev = statistics.stdev(prior_values) if len(prior_values) > 1 else 0.0
        if stddev == 0:
            continue
        current = months[cur_key]
        if current <= mean:
            continue
        deviation = (current - mean) / stddev
        if deviation < 3.0:
            continue

        anomalies.append({
            "rule_id":         "vendor_spike",
            "severity":        "high" if deviation >= 5.0 else "medium",
            "transaction_ids": by_vendor_ids[vendor][cur_key],
            "detail": {
                "vendor":           vendor,
                "current":          round(current, 2),
                "mean":             round(mean, 2),
                "stddev":           round(stddev, 2),
                "deviation_sigma":  round(deviation, 2),
                "month":            cur_key,
            },
        })

    return anomalies


def evidence_hash(anomaly: dict) -> str:
    """Deterministic hash for dedup: rule_id + sorted transaction_ids + key detail fields."""
    txn_ids = sorted(anomaly["transaction_ids"])
    detail_str = json.dumps(anomaly["detail"], sort_keys=True, default=str)
    return hashlib.sha256(
        f"{anomaly['rule_id']}:{txn_ids}:{detail_str}".encode()
    ).hexdigest()
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_anomaly.py -v
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anomaly.py backend/tests/services/test_anomaly.py
git commit -m "feat(anomaly): vendor_spike rule with 3σ threshold"
```

---

### Task 8: Anomaly rule — `payout_cadence_gap` (TDD)

**Files:**
- Modify: `backend/app/services/anomaly.py`
- Modify: `backend/tests/services/test_anomaly.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_anomaly.py`:

```python
from app.services.anomaly import payout_cadence_gap


def _payout(id, amount, dt):
    return SimpleNamespace(id=id, amount=amount, date=dt,
                           description="NEFT CR SHOPIFY PAYMENTS", category="Income / Revenue")


def test_payout_cadence_gap_flags_missing_weekly_payout():
    # 4 weekly payouts, then a 14-day gap
    payouts = [
        _payout(1, 30000, date(2024, 4, 1)),
        _payout(2, 32000, date(2024, 4, 8)),
        _payout(3, 28000, date(2024, 4, 15)),
        _payout(4, 31000, date(2024, 4, 22)),
        # Expected next payout ~ Apr 29; nothing till May 6
    ]
    anomalies = payout_cadence_gap(payouts, as_of=date(2024, 5, 5))
    assert len(anomalies) == 1
    detail = anomalies[0]["detail"]
    assert detail["days_late"] >= 3
    assert detail["cadence"] == 7


def test_payout_cadence_gap_silent_when_on_time():
    payouts = [
        _payout(1, 30000, date(2024, 4, 1)),
        _payout(2, 30000, date(2024, 4, 8)),
        _payout(3, 30000, date(2024, 4, 15)),
        _payout(4, 30000, date(2024, 4, 22)),
    ]
    anomalies = payout_cadence_gap(payouts, as_of=date(2024, 4, 24))
    assert anomalies == []
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_anomaly.py::test_payout_cadence_gap_flags_missing_weekly_payout -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

Append to `backend/app/services/anomaly.py`:

```python
_PAYOUT_PATTERN = re.compile(r"\b(payout|settlement|shopify.*payments?)\b", re.IGNORECASE)


def payout_cadence_gap(
    transactions: list[Any],
    as_of: date,
) -> list[dict]:
    """Detect Shopify-style payout cadence breaks.

    Filter to positive 'payout-like' txns, infer cadence as median day-gap,
    flag if as_of - last_payout >= cadence + 3.
    """
    payouts = [
        t for t in transactions
        if t.amount > 0
        and t.date
        and t.description
        and _PAYOUT_PATTERN.search(t.description)
    ]
    if len(payouts) < 3:
        return []

    payouts.sort(key=lambda t: t.date)
    gaps = [(payouts[i].date - payouts[i-1].date).days for i in range(1, len(payouts))]
    cadence = int(statistics.median(gaps))
    if cadence < 1:
        return []

    last = payouts[-1]
    days_since = (as_of - last.date).days
    if days_since < cadence + 3:
        return []

    expected = last.date + timedelta(days=cadence)
    return [{
        "rule_id":         "payout_cadence_gap",
        "severity":        "high",
        "transaction_ids": [last.id],
        "detail": {
            "expected_date":       expected.isoformat(),
            "days_late":           days_since - cadence,
            "last_payout_amount":  last.amount,
            "cadence":             cadence,
        },
    }]
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_anomaly.py -v
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anomaly.py backend/tests/services/test_anomaly.py
git commit -m "feat(anomaly): payout_cadence_gap rule"
```

---

### Task 9: Anomaly rule — `duplicate_within_window` (TDD)

**Files:**
- Modify: `backend/app/services/anomaly.py`
- Modify: `backend/tests/services/test_anomaly.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_anomaly.py`:

```python
from app.services.anomaly import duplicate_within_window


def test_duplicate_flags_same_amount_same_vendor_within_7_days():
    txns = [
        _txn(1, -15000, date(2024, 4, 16), "Google Ads Campaign"),
        _txn(2, -15000, date(2024, 4, 17), "Google Ads"),
    ]
    anomalies = duplicate_within_window(txns)
    assert len(anomalies) == 1
    assert anomalies[0]["detail"]["amount"] == 15000.0
    assert set(anomalies[0]["transaction_ids"]) == {1, 2}


def test_duplicate_ignores_outside_window():
    txns = [
        _txn(1, -15000, date(2024, 4, 1), "Google Ads"),
        _txn(2, -15000, date(2024, 4, 10), "Google Ads"),
    ]
    anomalies = duplicate_within_window(txns)
    assert anomalies == []


def test_duplicate_ignores_different_vendor():
    txns = [
        _txn(1, -15000, date(2024, 4, 1), "Google Ads"),
        _txn(2, -15000, date(2024, 4, 2), "Salary Jane"),
    ]
    anomalies = duplicate_within_window(txns)
    assert anomalies == []
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_anomaly.py -k duplicate -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

Append to `backend/app/services/anomaly.py`:

```python
def duplicate_within_window(
    transactions: list[Any],
    window_days: int = 7,
) -> list[dict]:
    """Same abs(amount) + same vendor cluster + within window_days = possible double charge."""
    anomalies: list[dict] = []
    seen_pairs: set[tuple[int, int]] = set()

    for i, t1 in enumerate(transactions):
        if t1.amount >= 0 or not t1.date:
            continue
        for t2 in transactions[i+1:]:
            if t2.amount >= 0 or not t2.date:
                continue
            if abs(t1.amount) != abs(t2.amount):
                continue
            if abs((t1.date - t2.date).days) > window_days:
                continue
            if _vendor_key(t1.description) != _vendor_key(t2.description):
                continue
            pair = (min(t1.id, t2.id), max(t1.id, t2.id))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            anomalies.append({
                "rule_id":         "duplicate_within_window",
                "severity":        "medium",
                "transaction_ids": [t1.id, t2.id],
                "detail": {
                    "amount":      abs(t1.amount),
                    "vendor":      _vendor_key(t1.description),
                    "days_apart":  abs((t1.date - t2.date).days),
                },
            })
    return anomalies
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_anomaly.py -v
```

Expected: all seven tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anomaly.py backend/tests/services/test_anomaly.py
git commit -m "feat(anomaly): duplicate_within_window rule"
```

---

### Task 10: Anomaly rule — `gst_mismatch` (TDD)

**Files:**
- Modify: `backend/app/services/anomaly.py`
- Modify: `backend/tests/services/test_anomaly.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_anomaly.py`:

```python
from app.services.anomaly import gst_mismatch


def _gst_txn(id, amount, gst_amount):
    return SimpleNamespace(id=id, amount=amount, gst_amount=gst_amount,
                           date=date(2024, 4, 1), description="x", category="Software & Subscriptions")


def test_gst_mismatch_flags_when_stored_diverges_from_recomputed():
    # 1000 expense → expected GST = 1000 * 18/118 = 152.54
    # Stored 200 → delta 47.46 → flag
    txns = [_gst_txn(1, -1000, 200)]
    anomalies = gst_mismatch(txns)
    assert len(anomalies) == 1
    d = anomalies[0]["detail"]
    assert d["stored_gst"] == 200
    assert abs(d["recomputed_gst"] - 152.54) < 0.01


def test_gst_mismatch_silent_when_within_one_rupee():
    # 1000 expense, stored 152.50 (≈152.54) → delta < 1 → no flag
    txns = [_gst_txn(1, -1000, 152.50)]
    anomalies = gst_mismatch(txns)
    assert anomalies == []
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_anomaly.py -k gst -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

Append to `backend/app/services/anomaly.py`:

```python
def gst_mismatch(transactions: list[Any]) -> list[dict]:
    """For expense txns with a stored gst_amount, recompute 18/118 and flag if diff > ₹1."""
    anomalies: list[dict] = []
    for t in transactions:
        gst = getattr(t, "gst_amount", None)
        if gst is None or t.amount >= 0:
            continue
        recomputed = round(abs(t.amount) * 18 / 118, 2)
        delta = abs(gst - recomputed)
        if delta <= 1.0:
            continue
        anomalies.append({
            "rule_id":         "gst_mismatch",
            "severity":        "low",
            "transaction_ids": [t.id],
            "detail": {
                "txn_id":         t.id,
                "stored_gst":     gst,
                "recomputed_gst": recomputed,
                "delta":          round(delta, 2),
            },
        })
    return anomalies
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_anomaly.py -v
```

Expected: all nine tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anomaly.py backend/tests/services/test_anomaly.py
git commit -m "feat(anomaly): gst_mismatch rule"
```

---

### Task 11: Anomaly rule — `refund_without_charge` (TDD)

**Files:**
- Modify: `backend/app/services/anomaly.py`
- Modify: `backend/tests/services/test_anomaly.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_anomaly.py`:

```python
from app.services.anomaly import refund_without_charge


def test_refund_without_prior_charge_is_flagged():
    txns = [
        SimpleNamespace(id=1, amount=2500, date=date(2024, 4, 20),
                        description="REFUND CUSTOMER ABC", category="Income / Revenue", gst_amount=None),
    ]
    anomalies = refund_without_charge(txns)
    assert len(anomalies) == 1
    assert anomalies[0]["detail"]["amount"] == 2500


def test_refund_with_matching_prior_charge_is_not_flagged():
    txns = [
        SimpleNamespace(id=1, amount=-2500, date=date(2024, 3, 1),
                        description="ABC CUSTOMER ORDER", category="Inventory & COGS", gst_amount=None),
        SimpleNamespace(id=2, amount=2500, date=date(2024, 4, 20),
                        description="REFUND CUSTOMER ABC", category="Income / Revenue", gst_amount=None),
    ]
    anomalies = refund_without_charge(txns)
    assert anomalies == []


def test_refund_categorised_as_income_with_refund_keyword_required():
    # No "refund" keyword in description → not flagged as a refund
    txns = [
        SimpleNamespace(id=1, amount=2500, date=date(2024, 4, 20),
                        description="Some sale", category="Income / Revenue", gst_amount=None),
    ]
    anomalies = refund_without_charge(txns)
    assert anomalies == []
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_anomaly.py -k refund -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

Append to `backend/app/services/anomaly.py`:

```python
_REFUND_PATTERN = re.compile(r"\brefund\b", re.IGNORECASE)


def refund_without_charge(
    transactions: list[Any],
    lookback_days: int = 60,
) -> list[dict]:
    """Positive refund-like txn with no matching prior negative same-vendor txn within window."""
    anomalies: list[dict] = []
    refunds = [
        t for t in transactions
        if t.amount > 0
        and t.date
        and t.description
        and _REFUND_PATTERN.search(t.description)
    ]
    for r in refunds:
        r_vendor = _vendor_key(r.description)
        r_amt = r.amount
        prior = [
            t for t in transactions
            if t.amount < 0
            and t.date
            and (r.date - t.date).days >= 0
            and (r.date - t.date).days <= lookback_days
            and _vendor_key(t.description) == r_vendor
            and abs(abs(t.amount) - r_amt) <= max(2.0, r_amt * 0.02)
        ]
        if prior:
            continue
        anomalies.append({
            "rule_id":         "refund_without_charge",
            "severity":        "medium",
            "transaction_ids": [r.id],
            "detail": {
                "refund_txn_id":         r.id,
                "amount":                r_amt,
                "vendor":                r_vendor,
                "searched_window_days":  lookback_days,
            },
        })
    return anomalies
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_anomaly.py -v
```

Expected: all twelve tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anomaly.py backend/tests/services/test_anomaly.py
git commit -m "feat(anomaly): refund_without_charge rule"
```

---

### Task 12: `detect()` orchestrator with idempotency (TDD)

**Files:**
- Modify: `backend/app/services/anomaly.py`
- Modify: `backend/tests/services/test_anomaly.py`

- [ ] **Step 1: Append the failing test**

Add to `backend/tests/services/test_anomaly.py`:

```python
from app.services.anomaly import detect


def test_detect_runs_all_rules_and_returns_unique_anomalies():
    # Construct data triggering vendor_spike and duplicate_within_window simultaneously
    txns = []
    # Build a vendor history (5 months @ ₹1000)
    for i, m in enumerate(range(11, 16), start=1):
        yy, mm = (2023, m) if m <= 12 else (2024, m - 12)
        txns.append(SimpleNamespace(id=i, amount=-1000, date=date(yy, mm, 15),
                                    description="Google Ads", category="Advertising & Marketing",
                                    gst_amount=None))
    # April spike — two duplicates of ₹20,000 within 7 days
    txns.append(SimpleNamespace(id=100, amount=-20000, date=date(2024, 4, 5),
                                description="Google Ads", category="Advertising & Marketing", gst_amount=None))
    txns.append(SimpleNamespace(id=101, amount=-20000, date=date(2024, 4, 8),
                                description="Google Ads", category="Advertising & Marketing", gst_amount=None))

    result = detect(txns, current_month=date(2024, 4, 1), as_of=date(2024, 4, 10))
    rules_fired = {a["rule_id"] for a in result}
    assert "vendor_spike" in rules_fired
    assert "duplicate_within_window" in rules_fired


def test_detect_dedups_by_evidence_hash_on_repeat_run():
    txns = [
        SimpleNamespace(id=1, amount=-15000, date=date(2024, 4, 16),
                        description="Google Ads", category="Advertising & Marketing", gst_amount=None),
        SimpleNamespace(id=2, amount=-15000, date=date(2024, 4, 17),
                        description="Google Ads", category="Advertising & Marketing", gst_amount=None),
    ]
    r1 = detect(txns, current_month=date(2024, 4, 1), as_of=date(2024, 4, 20))
    r2 = detect(txns, current_month=date(2024, 4, 1), as_of=date(2024, 4, 20))
    # Each anomaly produces the same evidence_hash both times
    from app.services.anomaly import evidence_hash
    hashes_1 = {evidence_hash(a) for a in r1}
    hashes_2 = {evidence_hash(a) for a in r2}
    assert hashes_1 == hashes_2
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_anomaly.py -k detect -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

Append to `backend/app/services/anomaly.py`:

```python
def detect(
    transactions: list[Any],
    current_month: date,
    as_of: date,
) -> list[dict]:
    """Run all 5 rules and return their union. Each rule may throw — failures
    are isolated; the others still run. Caller is responsible for persisting
    and deduping via evidence_hash."""
    all_anomalies: list[dict] = []

    rule_fns = [
        ("vendor_spike",            lambda t: vendor_spike(t, current_month=current_month)),
        ("payout_cadence_gap",      lambda t: payout_cadence_gap(t, as_of=as_of)),
        ("duplicate_within_window", lambda t: duplicate_within_window(t)),
        ("gst_mismatch",            lambda t: gst_mismatch(t)),
        ("refund_without_charge",   lambda t: refund_without_charge(t)),
    ]

    for rule_id, fn in rule_fns:
        try:
            all_anomalies.extend(fn(transactions))
        except Exception as e:
            # Rules are isolated; one failing rule does not stop the others.
            print(f"[anomaly] rule {rule_id} failed: {e}")

    return all_anomalies
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_anomaly.py -v
```

Expected: all fourteen tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anomaly.py backend/tests/services/test_anomaly.py
git commit -m "feat(anomaly): detect() orchestrator with rule isolation"
```

---

### Task 13: LLM explainer with template fallback + caching (TDD)

**Files:**
- Create: `backend/app/services/reconciliation_llm.py`
- Create: `backend/tests/services/test_reconciliation_llm.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/services/test_reconciliation_llm.py`:

```python
from unittest.mock import MagicMock, patch

from app.services.reconciliation_llm import explain_anomaly, explain_match, _template_for_anomaly


def test_template_for_vendor_spike_includes_numbers():
    a = {
        "rule_id": "vendor_spike",
        "detail": {"vendor": "google", "current": 50000, "mean": 10000,
                   "stddev": 1500, "deviation_sigma": 26.6, "month": "2024-04"},
    }
    txt = _template_for_anomaly(a)
    assert "google" in txt.lower()
    assert "50,000" in txt or "50000" in txt
    assert "26.6" in txt or "26" in txt


def test_explain_anomaly_uses_template_when_no_api_key():
    a = {
        "rule_id": "vendor_spike",
        "detail": {"vendor": "google", "current": 50000, "mean": 10000,
                   "stddev": 1500, "deviation_sigma": 26.6, "month": "2024-04"},
        "transaction_ids": [1, 2],
    }
    with patch("app.services.reconciliation_llm.settings") as mock_settings:
        mock_settings.ANTHROPIC_API_KEY = None
        result = explain_anomaly(a)
    assert "google" in result.lower()


def test_explain_anomaly_calls_anthropic_when_key_present():
    a = {
        "rule_id": "vendor_spike",
        "detail": {"vendor": "google", "current": 50000, "mean": 10000,
                   "stddev": 1500, "deviation_sigma": 26.6, "month": "2024-04"},
        "transaction_ids": [1],
    }
    fake_client = MagicMock()
    fake_response = MagicMock()
    fake_response.content = [MagicMock(text="Google Ads spending tripled in April — investigate budget changes.")]
    fake_client.messages.create.return_value = fake_response

    with patch("app.services.reconciliation_llm.settings") as mock_settings, \
         patch("app.services.reconciliation_llm.anthropic") as mock_anth:
        mock_settings.ANTHROPIC_API_KEY = "sk-test"
        mock_anth.Anthropic.return_value = fake_client
        result = explain_anomaly(a)

    assert "Google Ads" in result
    fake_client.messages.create.assert_called_once()


def test_explain_match_uses_template_when_no_key():
    m = {
        "source_id": 1, "bank_id": 99,
        "confidence": "medium", "pass_no": 3, "inferred_fee": 250.0,
    }
    with patch("app.services.reconciliation_llm.settings") as mock_settings:
        mock_settings.ANTHROPIC_API_KEY = None
        result = explain_match(m)
    assert "₹250" in result or "250" in result
    assert "fee" in result.lower()
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/services/test_reconciliation_llm.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

Write `backend/app/services/reconciliation_llm.py`:

```python
"""
LLM explainer for matches and anomalies.

Falls back to deterministic templates when ANTHROPIC_API_KEY is absent or
the call raises. Mirrors the pattern in services/llm_insights.py.
"""
from app.core.config import settings


_ANOMALY_TEMPLATES = {
    "vendor_spike":
        "{vendor} spent ₹{current:,.0f} this month — {deviation_sigma:.1f}σ above the "
        "6-month average of ₹{mean:,.0f}.",
    "payout_cadence_gap":
        "A Shopify payout was expected around {expected_date} but hasn't arrived. "
        "{days_late} days overdue based on a {cadence}-day cadence.",
    "duplicate_within_window":
        "Two ₹{amount:,.0f} charges to {vendor} within {days_apart} days — possible double charge.",
    "gst_mismatch":
        "Stored GST ₹{stored_gst:,.2f} differs from recomputed 18/118 = ₹{recomputed_gst:,.2f} "
        "(delta ₹{delta:,.2f}).",
    "refund_without_charge":
        "Refund of ₹{amount:,.0f} to {vendor} with no matching prior charge "
        "in the last {searched_window_days} days.",
}


def _template_for_anomaly(anomaly: dict) -> str:
    tpl = _ANOMALY_TEMPLATES.get(anomaly["rule_id"])
    if not tpl:
        return f"Anomaly: {anomaly['rule_id']}"
    return tpl.format(**anomaly["detail"])


def _template_for_match(match: dict) -> str:
    pass_no = match.get("pass_no")
    fee = match.get("inferred_fee")
    if pass_no == 1:
        return "Exact amount and date match."
    if pass_no == 2:
        return "Fuzzy match: amount and date within tolerance and descriptions overlap."
    if pass_no == 3 and fee:
        return f"Bank credit reconstructed from multiple source items with an inferred fee of ₹{abs(fee):,.0f}."
    return "Reconciled."


def explain_anomaly(anomaly: dict) -> str:
    if not settings.ANTHROPIC_API_KEY:
        return _template_for_anomaly(anomaly)
    try:
        return _call_claude_for_anomaly(anomaly)
    except Exception as e:
        print(f"[reconcile_llm] explain_anomaly fell back to template: {e}")
        return _template_for_anomaly(anomaly)


def explain_match(match: dict) -> str:
    if not settings.ANTHROPIC_API_KEY:
        return _template_for_match(match)
    try:
        return _call_claude_for_match(match)
    except Exception as e:
        print(f"[reconcile_llm] explain_match fell back to template: {e}")
        return _template_for_match(match)


def _call_claude_for_anomaly(anomaly: dict) -> str:
    import anthropic
    prompt = (
        "You are an Indian SMB CFO assistant. Explain this anomaly in one plain-English "
        "sentence (max 25 words). Be specific, use the numbers, and suggest one action. "
        "Do NOT use markdown.\n\n"
        f"Rule: {anomaly['rule_id']}\n"
        f"Evidence: {anomaly['detail']}\n"
    )
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=120,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def _call_claude_for_match(match: dict) -> str:
    import anthropic
    prompt = (
        "You are an Indian SMB CFO assistant. Explain this reconciliation match in one "
        "plain-English sentence (max 20 words). Do NOT use markdown.\n\n"
        f"Pass: {match.get('pass_no')}\n"
        f"Confidence: {match.get('confidence')}\n"
        f"Inferred fee: ₹{match.get('inferred_fee')}\n"
    )
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=80,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/services/test_reconciliation_llm.py -v
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reconciliation_llm.py backend/tests/services/test_reconciliation_llm.py
git commit -m "feat(reconcile): LLM explainer with template fallback"
```

---

### Task 14: Pydantic schemas

**Files:**
- Create: `backend/app/schemas/reconciliation.py`

- [ ] **Step 1: Write the schemas**

Write `backend/app/schemas/reconciliation.py`:

```python
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel


class StartRunRequest(BaseModel):
    source_batch_id: int
    bank_batch_id:   int


class MatchOut(BaseModel):
    id:            int
    source_txn_id: int
    bank_txn_id:   int
    confidence:    Literal["high", "medium", "low"]
    pass_no:       int
    inferred_fee:  Optional[float]
    explanation:   Optional[str]
    status:        Literal["pending", "accepted", "rejected"]
    updated_at:    datetime

    class Config:
        from_attributes = True


class AnomalyOut(BaseModel):
    id:              int
    rule_id:         str
    severity:        Literal["low", "medium", "high"]
    transaction_ids: List[int]
    detail:          dict
    explanation:     Optional[str]
    status:          Literal["open", "accepted", "dismissed", "snoozed"]
    snoozed_until:   Optional[datetime]
    detected_at:     datetime
    updated_at:      datetime

    class Config:
        from_attributes = True


class RunSummaryOut(BaseModel):
    id:              int
    org_id:          int
    source_batch_id: int
    bank_batch_id:   int
    status:          Literal["running", "complete", "failed"]
    summary:         Optional[dict]
    created_at:      datetime
    completed_at:    Optional[datetime]

    class Config:
        from_attributes = True


class RunDetailOut(RunSummaryOut):
    matches:   List[MatchOut]
    anomalies: List[AnomalyOut]


class PatchMatchRequest(BaseModel):
    status: Literal["accepted", "rejected"]


class PatchAnomalyRequest(BaseModel):
    status:        Literal["accepted", "dismissed", "snoozed"]
    snoozed_until: Optional[datetime] = None
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/reconciliation.py
git commit -m "feat(reconcile): Pydantic schemas for routes"
```

---

### Task 15: Routes — start / list / get (TDD)

**Files:**
- Create: `backend/app/api/routes/reconcile_v2.py`
- Create: `backend/tests/routes/test_reconcile_v2.py`

- [ ] **Step 1: Write the failing route tests**

Write `backend/tests/routes/test_reconcile_v2.py`:

```python
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
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
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
    assert body["summary"]["matches_by_pass"][3] >= 1


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
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/routes/test_reconcile_v2.py -v
```

Expected: 404 — route doesn't exist yet.

- [ ] **Step 3: Implement the routes**

Write `backend/app/api/routes/reconcile_v2.py`:

```python
"""
Reconciliation v2 routes.

POST   /api/reconcile/runs/{org_id}              — start a run (synchronous)
GET    /api/reconcile/runs/{org_id}              — list past runs
GET    /api/reconcile/runs/{org_id}/{run_id}     — get run detail with matches + anomalies
PATCH  /api/reconcile/matches/{match_id}          — accept | reject
PATCH  /api/reconcile/anomalies/{anomaly_id}      — accept | dismiss | snooze
POST   /api/reconcile/anomalies/{org_id}/scan     — manual anomaly re-scan (idempotent)
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


def _run_detail_dict(run: ReconciliationRun, matches: list[Match], anomalies: list[Anomaly]) -> dict:
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
    match_rows: list[Match] = []
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

    anomaly_rows: list[Anomaly] = []
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

    run.status = "complete"
    run.summary = json.dumps({
        "matches_by_pass":   result["matches_by_pass"],
        "unmatched_source":  result["unmatched_source"],
        "unmatched_bank":    result["unmatched_bank"],
        "new_anomalies":     len([a for a in anomaly_rows if a.id is None]),
    })
    run.completed_at = datetime.utcnow()

    log_action(db, "reconcile.run", user_id=current_user.id, org_id=org_id,
               resource=f"run:{run.id}",
               detail={"matches": len(match_rows), "anomalies": len(anomaly_rows)})
    db.commit()
    db.refresh(run)
    for m in match_rows:
        db.refresh(m)
    for a in anomaly_rows:
        db.refresh(a)

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
```

- [ ] **Step 4: Register the router in `main.py`**

Open `backend/app/main.py`. Add the import line at the top of the imports block:

```python
from app.api.routes import auth, orgs, transactions, invites, api_keys, audit, reports, billing, reconcile_v2
```

Add the include at the end of the router section:

```python
app.include_router(reconcile_v2.router, prefix="/api")
```

- [ ] **Step 5: Run to verify passing**

```
pytest tests/routes/test_reconcile_v2.py -v
```

Expected: all three tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/reconcile_v2.py backend/app/main.py backend/tests/routes/test_reconcile_v2.py
git commit -m "feat(reconcile): start/list/get run routes"
```

---

### Task 16: Routes — patch match / patch anomaly / scan (TDD)

**Files:**
- Modify: `backend/app/api/routes/reconcile_v2.py`
- Modify: `backend/tests/routes/test_reconcile_v2.py`

- [ ] **Step 1: Append the failing tests**

Add to `backend/tests/routes/test_reconcile_v2.py`:

```python
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


def test_patch_anomaly_dismiss(client, seeded):
    # Create an anomaly manually for the test
    from app.models.reconciliation import Anomaly
    import json
    a = Anomaly(
        org_id=seeded["org"].id, rule_id="duplicate_within_window", severity="medium",
        transaction_ids=json.dumps([1, 2]),
        detail=json.dumps({"amount": 15000, "vendor": "google", "days_apart": 1}),
        evidence_hash="hash-test-1",
    )
    from sqlalchemy.orm import Session
    db = next(iter(app.dependency_overrides[get_db]() for _ in range(1)))   # reuse the override
    # Easier: just patch via existing client lifecycle
    # ... use the existing db_session fixture indirectly:
    # NOTE: simpler form — directly access fixture by recreating
    # If this gets fiddly, use the run-start path and dismiss the first anomaly produced.
    pass   # placeholder; see implementation below for a more direct approach


def test_scan_anomalies_is_idempotent(client, seeded):
    headers = {"Authorization": f"Bearer {seeded['token']}"}
    r1 = client.post(f"/api/reconcile/anomalies/{seeded['org'].id}/scan", headers=headers)
    r2 = client.post(f"/api/reconcile/anomalies/{seeded['org'].id}/scan", headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r2.json()["new_anomalies"] == 0   # second scan creates none


def test_viewer_cannot_patch_or_scan(client, db_session):
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
```

Note: the `test_patch_anomaly_dismiss` body above is left as a placeholder reminder — replace it with a working test that creates an anomaly directly through the `db_session` fixture (similar to how `seeded` works) and then PATCHes it. Specifically:

```python
def test_patch_anomaly_dismiss(client, db_session, seeded):
    from app.models.reconciliation import Anomaly
    import json
    a = Anomaly(
        org_id=seeded["org"].id, rule_id="duplicate_within_window", severity="medium",
        transaction_ids=json.dumps([1, 2]),
        detail=json.dumps({"amount": 15000, "vendor": "google", "days_apart": 1}),
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
```

- [ ] **Step 2: Run to verify failure**

```
pytest tests/routes/test_reconcile_v2.py -v
```

Expected: new tests 404.

- [ ] **Step 3: Implement the patch + scan routes**

Append to `backend/app/api/routes/reconcile_v2.py`:

```python
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
```

- [ ] **Step 4: Run to verify passing**

```
pytest tests/routes/test_reconcile_v2.py -v
```

Expected: all six tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/reconcile_v2.py backend/tests/routes/test_reconcile_v2.py
git commit -m "feat(reconcile): patch match/anomaly + scan endpoints"
```

---

### Task 17: Deprecate the legacy reconcile route

**Files:**
- Modify: `backend/app/api/routes/transactions.py`

- [ ] **Step 1: Replace the existing `reconcile` function body**

Open `backend/app/api/routes/transactions.py`. Find the `def reconcile(...)` function (currently around lines 448-490). Replace its body to be a deprecation wrapper that delegates to the new endpoint:

```python
@router.post("/reconcile/{org_id}", response_model=ReconcileResult, deprecated=True)
def reconcile(
    org_id: int,
    source_batch_id: int,
    bank_batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """DEPRECATED — use POST /api/reconcile/runs/{org_id} instead."""
    from app.api.routes.reconcile_v2 import start_run
    from app.schemas.reconciliation import StartRunRequest
    new = start_run(
        org_id=org_id,
        payload=StartRunRequest(source_batch_id=source_batch_id, bank_batch_id=bank_batch_id),
        db=db,
        current_user=current_user,
    )
    # Map new RunDetail back to the legacy ReconcileResult shape
    matched = len([m for m in new["matches"]])
    total_src = matched + len(new["summary"]["unmatched_source"]) if new.get("summary") else matched
    return ReconcileResult(
        matched_pairs=matched,
        unmatched_source=len(new["summary"]["unmatched_source"]) if new.get("summary") else 0,
        unmatched_bank=len(new["summary"]["unmatched_bank"]) if new.get("summary") else 0,
        match_rate=round(matched / total_src * 100, 1) if total_src else 0,
        details=[],   # legacy details list intentionally empty; old clients should migrate
    )
```

- [ ] **Step 2: Verify the existing tests still pass**

```
pytest tests/ -v
```

Expected: full suite green; no regressions in old reconcile-related tests if any exist.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/transactions.py
git commit -m "refactor(transactions): deprecate legacy reconcile route (shim)"
```

---

### Task 18: Frontend — typed API client (`lib/reconcile.ts`)

**Files:**
- Create: `frontend/lib/reconcile.ts`

- [ ] **Step 1: Write the client helpers**

Write `frontend/lib/reconcile.ts`:

```ts
import { apiFetch } from "./api";

export type Confidence = "high" | "medium" | "low";
export type MatchStatus = "pending" | "accepted" | "rejected";
export type AnomalyStatus = "open" | "accepted" | "dismissed" | "snoozed";
export type Severity = "low" | "medium" | "high";
export type RunStatus = "running" | "complete" | "failed";

export interface RunSummary {
  id: number;
  org_id: number;
  source_batch_id: number;
  bank_batch_id: number;
  status: RunStatus;
  summary: {
    matches_by_pass?: Record<string, number>;
    unmatched_source?: number[];
    unmatched_bank?: number[];
    error?: string;
  } | null;
  created_at: string;
  completed_at: string | null;
}

export interface MatchRow {
  id: number;
  source_txn_id: number;
  bank_txn_id: number;
  confidence: Confidence;
  pass_no: number;
  inferred_fee: number | null;
  explanation: string | null;
  status: MatchStatus;
  updated_at: string;
}

export interface AnomalyRow {
  id: number;
  rule_id: string;
  severity: Severity;
  transaction_ids: number[];
  detail: Record<string, unknown>;
  explanation: string | null;
  status: AnomalyStatus;
  snoozed_until: string | null;
  detected_at: string;
  updated_at: string;
}

export interface RunDetail extends RunSummary {
  matches: MatchRow[];
  anomalies: AnomalyRow[];
}

export function startRun(orgId: number, sourceBatchId: number, bankBatchId: number) {
  return apiFetch<RunDetail>(`/reconcile/runs/${orgId}`, {
    method: "POST",
    body: JSON.stringify({ source_batch_id: sourceBatchId, bank_batch_id: bankBatchId }),
  });
}

export function listRuns(orgId: number) {
  return apiFetch<RunSummary[]>(`/reconcile/runs/${orgId}`);
}

export function getRun(orgId: number, runId: number) {
  return apiFetch<RunDetail>(`/reconcile/runs/${orgId}/${runId}`);
}

export function patchMatch(matchId: number, status: "accepted" | "rejected") {
  return apiFetch<MatchRow>(`/reconcile/matches/${matchId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function patchAnomaly(
  anomalyId: number,
  status: "accepted" | "dismissed" | "snoozed",
  snoozedUntil?: string,
) {
  return apiFetch<AnomalyRow>(`/reconcile/anomalies/${anomalyId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, snoozed_until: snoozedUntil ?? null }),
  });
}

export function scanAnomalies(orgId: number) {
  return apiFetch<{ new_anomalies: number; scanned: number }>(
    `/reconcile/anomalies/${orgId}/scan`,
    { method: "POST" },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/reconcile.ts
git commit -m "feat(reconcile): typed frontend API client"
```

---

### Task 19: Frontend — inline state primitives

**Files:**
- Create: `frontend/components/reconcile/states.tsx`

- [ ] **Step 1: Write the three primitives**

Write `frontend/components/reconcile/states.tsx`:

```tsx
"use client";
import { Loader2, Inbox, AlertCircle } from "lucide-react";

export function LoadingState({ message = "Loading reconciliation…" }: { message?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          minHeight: 160, borderRadius: 14,
          border: "1px solid rgba(30,41,59,0.6)",
          background: "rgba(15,23,42,0.4)",
          animation: `pulse 1.6s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
      <style>{`@keyframes pulse { 0%,100% { opacity: 0.35 } 50% { opacity: 0.7 } }`}</style>
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8,
        color: "#475569", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
        <Loader2 size={12} className="animate-spin" /> {message}
      </div>
    </div>
  );
}

export function EmptyState({
  title = "All caught up",
  subtitle,
}: { title?: string; subtitle?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px",
      border: "1px dashed rgba(30,41,59,0.6)", borderRadius: 14 }}>
      <Inbox size={32} style={{ color: "#334155", margin: "0 auto 12px" }} />
      <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22,
        color: "#94a3b8", marginBottom: 4 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#475569",
          fontFamily: "'Manrope', system-ui, sans-serif" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  message, onRetry,
}: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 24px",
      border: "1px solid rgba(251,113,133,0.3)", background: "rgba(251,113,133,0.05)",
      borderRadius: 14 }}>
      <AlertCircle size={24} style={{ color: "#fb7185", margin: "0 auto 10px" }} />
      <div style={{ fontSize: 13, color: "#fda4af",
        fontFamily: "'Manrope', system-ui, sans-serif", marginBottom: 12 }}>
        {message}
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: "transparent", border: "1px solid rgba(251,113,133,0.4)",
          color: "#fda4af", padding: "6px 14px", borderRadius: 8,
          fontSize: 12, fontFamily: "inherit", cursor: "pointer",
        }}>
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/reconcile/states.tsx
git commit -m "feat(reconcile): inline loading/empty/error states"
```

---

### Task 20: Frontend — `MatchCard` component

**Files:**
- Create: `frontend/components/reconcile/MatchCard.tsx`

- [ ] **Step 1: Write the component**

Write `frontend/components/reconcile/MatchCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import { MatchRow, patchMatch } from "@/lib/reconcile";

const CONF_COLOR = {
  high:   { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)", text: "#34d399" },
  medium: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)", text: "#fbbf24" },
  low:    { bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)", text: "#94a3b8" },
};

const PASS_LABEL: Record<number, string> = {
  1: "Exact match",
  2: "Fuzzy match",
  3: "Fee-inferred match",
};

export function MatchCard({
  match,
  onChange,
  onOpenDrilldown,
}: {
  match: MatchRow;
  onChange: (updated: MatchRow) => void;
  onOpenDrilldown: (matchId: number) => void;
}) {
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const conf = CONF_COLOR[match.confidence];

  async function act(status: "accepted" | "rejected") {
    setBusy(status === "accepted" ? "accept" : "reject");
    try {
      const updated = await patchMatch(match.id, status);
      onChange(updated);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div onClick={() => onOpenDrilldown(match.id)} style={{
      cursor: "pointer",
      border: `1px solid ${conf.border}`,
      borderRadius: 12,
      background: conf.bg,
      padding: 16,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: match.status === "rejected" ? 0.4 : 1,
      transition: "opacity 150ms",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: conf.text,
        }}>
          {PASS_LABEL[match.pass_no] ?? "Match"} · {match.confidence}
        </span>
        {match.inferred_fee != null && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "#94a3b8",
          }}>
            fee ₹{Math.abs(match.inferred_fee).toLocaleString("en-IN")}
          </span>
        )}
      </div>

      <div style={{
        fontFamily: "'Manrope', system-ui, sans-serif",
        fontSize: 13, color: "#e2e8f0", lineHeight: 1.5,
      }}>
        {match.explanation ?? "Reconciled."}
      </div>

      <div style={{ display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => act("accepted")}
          disabled={busy !== null || match.status === "accepted"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 7,
            border: "1px solid rgba(52,211,153,0.3)",
            background: match.status === "accepted" ? "rgba(52,211,153,0.15)" : "transparent",
            color: "#6ee7b7", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {busy === "accept" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          {match.status === "accepted" ? "Accepted" : "Accept"}
        </button>
        <button
          onClick={() => act("rejected")}
          disabled={busy !== null || match.status === "rejected"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 7,
            border: "1px solid rgba(251,113,133,0.3)",
            background: "transparent",
            color: "#fda4af", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {busy === "reject" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
          Reject
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/reconcile/MatchCard.tsx
git commit -m "feat(reconcile): MatchCard component"
```

---

### Task 21: Frontend — `AnomalyCard` component

**Files:**
- Create: `frontend/components/reconcile/AnomalyCard.tsx`

- [ ] **Step 1: Write the component**

Write `frontend/components/reconcile/AnomalyCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Loader2, Check, X, Clock, AlertTriangle } from "lucide-react";
import { AnomalyRow, patchAnomaly } from "@/lib/reconcile";

const SEV_COLOR = {
  low:    { bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)", text: "#94a3b8" },
  medium: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)", text: "#fbbf24" },
  high:   { bg: "rgba(251,113,133,0.08)", border: "rgba(251,113,133,0.35)", text: "#fb7185" },
};

const RULE_LABEL: Record<string, string> = {
  vendor_spike:            "Vendor spike",
  payout_cadence_gap:      "Payout overdue",
  duplicate_within_window: "Possible duplicate",
  gst_mismatch:            "GST mismatch",
  refund_without_charge:   "Refund without charge",
};

export function AnomalyCard({
  anomaly,
  onChange,
  onOpenDrilldown,
}: {
  anomaly: AnomalyRow;
  onChange: (updated: AnomalyRow) => void;
  onOpenDrilldown: (anomalyId: number) => void;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | "snooze" | null>(null);
  const sev = SEV_COLOR[anomaly.severity];

  async function act(status: "accepted" | "dismissed" | "snoozed", days?: number) {
    setBusy(status === "accepted" ? "accept" : status === "dismissed" ? "dismiss" : "snooze");
    try {
      const until = days
        ? new Date(Date.now() + days * 86400_000).toISOString()
        : undefined;
      const updated = await patchAnomaly(anomaly.id, status, until);
      onChange(updated);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div onClick={() => onOpenDrilldown(anomaly.id)} style={{
      cursor: "pointer",
      border: `1px solid ${sev.border}`,
      borderRadius: 12,
      background: sev.bg,
      padding: 16,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: anomaly.status === "dismissed" ? 0.4 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={13} style={{ color: sev.text }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          letterSpacing: "0.12em", textTransform: "uppercase", color: sev.text,
        }}>
          {anomaly.severity} · {RULE_LABEL[anomaly.rule_id] ?? anomaly.rule_id}
        </span>
      </div>

      <div style={{
        fontFamily: "'Manrope', system-ui, sans-serif",
        fontSize: 13, color: "#e2e8f0", lineHeight: 1.5,
      }}>
        {anomaly.explanation ?? `Anomaly: ${anomaly.rule_id}`}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
        <button onClick={() => act("accepted")} disabled={busy !== null} style={btnStyle("emerald")}>
          {busy === "accept" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Accept
        </button>
        <button onClick={() => act("dismissed")} disabled={busy !== null} style={btnStyle("rose")}>
          {busy === "dismiss" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
          Dismiss
        </button>
        <button onClick={() => act("snoozed", 7)} disabled={busy !== null} style={btnStyle("slate")}>
          {busy === "snooze" ? <Loader2 size={11} className="animate-spin" /> : <Clock size={11} />}
          Snooze 1w
        </button>
      </div>
    </div>
  );
}

function btnStyle(tone: "emerald" | "rose" | "slate"): React.CSSProperties {
  const colors = {
    emerald: { border: "rgba(52,211,153,0.3)",  text: "#6ee7b7" },
    rose:    { border: "rgba(251,113,133,0.3)", text: "#fda4af" },
    slate:   { border: "rgba(148,163,184,0.3)", text: "#cbd5e1" },
  }[tone];
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 7,
    border: `1px solid ${colors.border}`, background: "transparent",
    color: colors.text, fontSize: 12, cursor: "pointer",
    fontFamily: "inherit",
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/reconcile/AnomalyCard.tsx
git commit -m "feat(reconcile): AnomalyCard component"
```

---

### Task 22: Frontend — `TriageColumn` component

**Files:**
- Create: `frontend/components/reconcile/TriageColumn.tsx`

- [ ] **Step 1: Write the component**

Write `frontend/components/reconcile/TriageColumn.tsx`:

```tsx
"use client";
import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function TriageColumn({
  title,
  count,
  accent,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  count: number;
  accent: "emerald" | "amber" | "rose";
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const accentColor = accent === "emerald" ? "#34d399"
                    : accent === "amber"   ? "#fbbf24"
                    : "#fb7185";

  return (
    <section style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 0", borderBottom: `1px solid ${accentColor}33`,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {open ? <ChevronDown size={13} style={{ color: accentColor }} />
                : <ChevronRight size={13} style={{ color: accentColor }} />}
          <span style={{
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: 13, color: "#e2e8f0", fontWeight: 600,
          }}>
            {title}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "#64748b", fontVariantNumeric: "tabular-nums",
          }}>
            {count}
          </span>
        </div>
      </header>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {children}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/reconcile/TriageColumn.tsx
git commit -m "feat(reconcile): TriageColumn collapsible wrapper"
```

---

### Task 23: Frontend — `RunHistoryStrip` component

**Files:**
- Create: `frontend/components/reconcile/RunHistoryStrip.tsx`

- [ ] **Step 1: Write the component**

Write `frontend/components/reconcile/RunHistoryStrip.tsx`:

```tsx
"use client";
import { RunSummary } from "@/lib/reconcile";

export function RunHistoryStrip({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: RunSummary[];
  selectedRunId: number | null;
  onSelect: (id: number) => void;
}) {
  if (runs.length === 0) return null;

  return (
    <div style={{
      display: "flex", overflowX: "auto", gap: 8,
      paddingBottom: 12, marginBottom: 16,
      borderBottom: "1px solid rgba(30,41,59,0.7)",
    }}>
      {runs.slice(0, 5).map(r => {
        const active = r.id === selectedRunId;
        const matchedCount = r.summary?.matches_by_pass
          ? Object.values(r.summary.matches_by_pass).reduce((a, b) => a + b, 0)
          : 0;
        const totalSrc = matchedCount + (r.summary?.unmatched_source?.length ?? 0);
        const rate = totalSrc > 0 ? Math.round((matchedCount / totalSrc) * 100) : 0;

        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            style={{
              flexShrink: 0,
              border: active ? "1px solid #34d399" : "1px solid rgba(30,41,59,0.7)",
              background: active ? "rgba(52,211,153,0.05)" : "transparent",
              borderRadius: 10, padding: "10px 14px",
              display: "flex", flexDirection: "column", gap: 4,
              cursor: "pointer", textAlign: "left", minWidth: 180,
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: active ? "#34d399" : "#475569",
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {" · "}{r.status}
            </div>
            <div style={{
              fontFamily: "'Manrope', system-ui, sans-serif",
              fontSize: 12, color: "#cbd5e1",
            }}>
              {rate}% matched
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/reconcile/RunHistoryStrip.tsx
git commit -m "feat(reconcile): RunHistoryStrip selector"
```

---

### Task 24: Frontend — `DrilldownDrawer` component

**Files:**
- Create: `frontend/components/reconcile/DrilldownDrawer.tsx`

- [ ] **Step 1: Write the component**

Write `frontend/components/reconcile/DrilldownDrawer.tsx`:

```tsx
"use client";
import { X } from "lucide-react";
import { MatchRow, AnomalyRow } from "@/lib/reconcile";

export function DrilldownDrawer({
  open, onClose, kind, data,
}: {
  open: boolean;
  onClose: () => void;
  kind: "match" | "anomaly" | null;
  data: MatchRow | AnomalyRow | null;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(2,6,23,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms", zIndex: 60,
        }}
      />
      <aside style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480,
        background: "#0a0e1a", borderLeft: "1px solid rgba(30,41,59,0.8)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 220ms ease-out",
        zIndex: 70, padding: 24, overflowY: "auto",
        fontFamily: "'Manrope', system-ui, sans-serif", color: "#e2e8f0",
      }}>
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 20,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase",
          }}>
            {kind ?? "Detail"}
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "#64748b",
            cursor: "pointer", padding: 4,
          }}>
            <X size={16} />
          </button>
        </header>

        {data && (
          <pre style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, color: "#94a3b8",
            background: "rgba(15,23,42,0.6)",
            border: "1px solid rgba(30,41,59,0.7)",
            borderRadius: 10, padding: 14,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
{JSON.stringify(data, null, 2)}
          </pre>
        )}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/reconcile/DrilldownDrawer.tsx
git commit -m "feat(reconcile): DrilldownDrawer slide-in"
```

---

### Task 25: Frontend — new `reconcile/page.tsx` wiring it all

**Files:**
- Modify (full rewrite): `frontend/app/reconcile/page.tsx`

- [ ] **Step 1: Replace the existing page**

Read the current `frontend/app/reconcile/page.tsx` once for context, then overwrite with the new version:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import OrgSelector, { Org } from "@/components/OrgSelector";
import { useToast } from "@/components/Toast";
import {
  RunDetail, RunSummary, MatchRow, AnomalyRow,
  startRun, listRuns, getRun, scanAnomalies,
} from "@/lib/reconcile";
import { apiFetch } from "@/lib/api";
import { LoadingState, EmptyState, ErrorState } from "@/components/reconcile/states";
import { MatchCard } from "@/components/reconcile/MatchCard";
import { AnomalyCard } from "@/components/reconcile/AnomalyCard";
import { TriageColumn } from "@/components/reconcile/TriageColumn";
import { RunHistoryStrip } from "@/components/reconcile/RunHistoryStrip";
import { DrilldownDrawer } from "@/components/reconcile/DrilldownDrawer";
import { Loader2, Play } from "lucide-react";

interface Batch { id: number; filename: string; source: string; row_count: number; }

export default function ReconcilePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [org, setOrg] = useState<Org | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [sourceBatchId, setSourceBatchId] = useState<number | null>(null);
  const [bankBatchId, setBankBatchId] = useState<number | null>(null);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [currentRun, setCurrentRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKind, setDrawerKind] = useState<"match" | "anomaly" | null>(null);
  const [drawerData, setDrawerData] = useState<MatchRow | AnomalyRow | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("smb_token")) { router.push("/login"); return; }
  }, []);

  useEffect(() => {
    if (!org) return;
    apiFetch<Batch[]>(`/transactions/batches/${org.id}`).then(setBatches).catch(() => setBatches([]));
    refreshRuns(org.id);
  }, [org]);

  async function refreshRuns(orgId: number) {
    try {
      const list = await listRuns(orgId);
      setRuns(list);
      if (list.length > 0) {
        const detail = await getRun(orgId, list[0].id);
        setCurrentRun(detail);
      } else {
        setCurrentRun(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    }
  }

  async function handleStart() {
    if (!org || !sourceBatchId || !bankBatchId) return;
    setStarting(true);
    try {
      const detail = await startRun(org.id, sourceBatchId, bankBatchId);
      setCurrentRun(detail);
      const list = await listRuns(org.id);
      setRuns(list);
      toast("Reconciliation complete", "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Reconciliation failed", "error");
    } finally {
      setStarting(false);
    }
  }

  async function handleSelectRun(runId: number) {
    if (!org) return;
    setLoading(true);
    try {
      const detail = await getRun(org.id, runId);
      setCurrentRun(detail);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }

  async function handleScan() {
    if (!org) return;
    try {
      const r = await scanAnomalies(org.id);
      toast(`Scanned ${r.scanned} — ${r.new_anomalies} new anomalies`, "success");
      await refreshRuns(org.id);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Scan failed", "error");
    }
  }

  function updateMatch(updated: MatchRow) {
    setCurrentRun(r => r ? { ...r, matches: r.matches.map(m => m.id === updated.id ? updated : m) } : r);
  }

  function updateAnomaly(updated: AnomalyRow) {
    setCurrentRun(r => r ? { ...r, anomalies: r.anomalies.map(a => a.id === updated.id ? updated : a) } : r);
  }

  function openDrilldown(kind: "match" | "anomaly", id: number) {
    if (!currentRun) return;
    const data = kind === "match"
      ? currentRun.matches.find(m => m.id === id) ?? null
      : currentRun.anomalies.find(a => a.id === id) ?? null;
    setDrawerKind(kind);
    setDrawerData(data);
    setDrawerOpen(true);
  }

  const matches = currentRun?.matches ?? [];
  const anomalies = currentRun?.anomalies ?? [];

  const accepted   = matches.filter(m => m.status === "accepted");
  const pending    = matches.filter(m => m.status === "pending" && m.confidence === "high");
  const reviewable = matches.filter(m => m.status === "pending" && m.confidence !== "high");
  const openAnomalies = anomalies.filter(a => a.status === "open");

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#f8fafc",
      fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>
      <Nav />

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "36px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          flexWrap: "wrap", gap: 16, marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36,
              margin: "0 0 6px", lineHeight: 1 }}>
              Reconcile <em style={{ color: "#475569" }}>triage</em>
            </h1>
            <p style={{ fontSize: 13, color: "#475569" }}>
              Match Shopify payouts to bank credits, review anomalies, take action.
            </p>
          </div>
          <OrgSelector selected={org} onSelect={setOrg} />
        </div>

        {!org ? (
          <EmptyState title="Pick an organisation" subtitle="Select one above to view reconciliations." />
        ) : (
          <>
            {/* Run-start form */}
            <div style={{
              padding: 18, borderRadius: 14,
              border: "1px solid rgba(30,41,59,0.7)",
              background: "rgba(15,23,42,0.4)",
              display: "flex", alignItems: "center", gap: 12,
              flexWrap: "wrap", marginBottom: 24,
            }}>
              <select
                value={sourceBatchId ?? ""}
                onChange={e => setSourceBatchId(Number(e.target.value) || null)}
                style={selectStyle}
              >
                <option value="">Source batch (Shopify…)</option>
                {batches.filter(b => b.source !== "bank").map(b => (
                  <option key={b.id} value={b.id}>{b.filename} ({b.row_count} rows)</option>
                ))}
              </select>
              <select
                value={bankBatchId ?? ""}
                onChange={e => setBankBatchId(Number(e.target.value) || null)}
                style={selectStyle}
              >
                <option value="">Bank batch</option>
                {batches.filter(b => b.source === "bank").map(b => (
                  <option key={b.id} value={b.id}>{b.filename} ({b.row_count} rows)</option>
                ))}
              </select>
              <button
                onClick={handleStart}
                disabled={!sourceBatchId || !bankBatchId || starting}
                style={primaryBtn(starting)}
              >
                {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Run reconciliation
              </button>
              <button onClick={handleScan} style={ghostBtn}>
                Rescan anomalies
              </button>
            </div>

            <RunHistoryStrip runs={runs} selectedRunId={currentRun?.id ?? null} onSelect={handleSelectRun} />

            {loading && <LoadingState />}
            {error && <ErrorState message={error} onRetry={() => org && refreshRuns(org.id)} />}

            {!loading && !error && !currentRun && (
              <EmptyState title="No reconciliations yet" subtitle="Start one above to begin." />
            )}

            {!loading && !error && currentRun && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
                <TriageColumn title="Auto-matched" count={accepted.length + pending.length} accent="emerald" defaultCollapsed>
                  {[...pending, ...accepted].map(m => (
                    <MatchCard key={m.id} match={m} onChange={updateMatch}
                      onOpenDrilldown={id => openDrilldown("match", id)} />
                  ))}
                </TriageColumn>

                <TriageColumn title="Needs review" count={reviewable.length} accent="amber">
                  {reviewable.length === 0
                    ? <EmptyState title="Nothing to review" />
                    : reviewable.map(m => (
                        <MatchCard key={m.id} match={m} onChange={updateMatch}
                          onOpenDrilldown={id => openDrilldown("match", id)} />
                      ))}
                </TriageColumn>

                <TriageColumn title="Anomalies" count={openAnomalies.length} accent="rose">
                  {openAnomalies.length === 0
                    ? <EmptyState title="No open anomalies" />
                    : openAnomalies.map(a => (
                        <AnomalyCard key={a.id} anomaly={a} onChange={updateAnomaly}
                          onOpenDrilldown={id => openDrilldown("anomaly", id)} />
                      ))}
                </TriageColumn>
              </div>
            )}
          </>
        )}
      </div>

      <DrilldownDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        kind={drawerKind}
        data={drawerData}
      />
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 8,
  border: "1px solid rgba(30,41,59,0.8)",
  background: "rgba(15,23,42,0.7)", color: "#e2e8f0",
  fontSize: 13, fontFamily: "inherit", minWidth: 220,
};

const primaryBtn = (busy: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8, border: "none", cursor: busy ? "wait" : "pointer",
  background: "#34d399", color: "#0f172a", fontSize: 13, fontWeight: 700,
  fontFamily: "inherit", opacity: busy ? 0.6 : 1,
});

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8,
  border: "1px solid rgba(30,41,59,0.8)", background: "transparent",
  color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
```

- [ ] **Step 2: Start the dev server and verify visually**

```
cd frontend
npm run dev
```

Open `http://localhost:3000/reconcile`. With an org selected and two batches uploaded:
1. Pick source + bank batches → click "Run reconciliation"
2. Three columns populate
3. Click a card → drawer slides in with JSON detail
4. Accept/Reject/Dismiss buttons update state without page reload

- [ ] **Step 3: Commit**

```bash
git add frontend/app/reconcile/page.tsx
git commit -m "feat(reconcile): triage queue UI"
```

---

### Task 26: Final integration smoke test

**Files:**
- Manual verification only

- [ ] **Step 1: Run the full backend test suite**

```
cd backend
pytest -v
```

Expected: all reconciliation + anomaly + LLM + route tests green. No regressions in existing tests.

- [ ] **Step 2: End-to-end browser smoke test**

```
cd backend && uvicorn app.main:app --reload --port 8000 &
cd frontend && npm run dev
```

Steps:
1. Register or log in.
2. Upload `tests/fixtures/shopify_payouts_test.csv` as Shopify Payout.
3. Upload `tests/fixtures/bank_test.csv` as Bank Statement.
4. Navigate to `/reconcile`.
5. Select both batches, click "Run reconciliation".
6. Verify three columns populate.
7. Click a match card — drawer opens with JSON.
8. Accept one match, dismiss one anomaly — UI updates.
9. Reload page — state persists from the DB.

- [ ] **Step 3: If ANTHROPIC_API_KEY is set, verify LLM path**

Set `ANTHROPIC_API_KEY=sk-ant-...` in `backend/.env`, restart server, run another reconciliation. Card explanations should now be Claude-generated (more colloquial, action-suggesting) rather than template strings.

- [ ] **Step 4: Commit nothing — this is verification only**

```bash
# No files changed in this task.
```

---

## Self-review

**Spec coverage:**
- Multi-pass matcher (4 passes) → Tasks 3–6 ✓
- 5 anomaly rules → Tasks 7–11 ✓
- Anomaly orchestrator with idempotency → Task 12 ✓
- LLM explainer with template fallback → Task 13 ✓
- Three new tables + indexes → Task 1 ✓
- Pydantic schemas → Task 14 ✓
- Six routes (start/list/get + patch×2 + scan) → Tasks 15–16 ✓
- Legacy route deprecation shim → Task 17 ✓
- Triage UI with columns + drawer + run history → Tasks 18–25 ✓
- Inline state primitives → Task 19 ✓
- Testing strategy (unit + integration) → Built into every backend task ✓
- Test fixtures → Task 2 ✓

**Placeholder scan:**
- The Task 16 anomaly-dismiss test originally contained an early-draft placeholder body; the corrected `db_session`-based version follows it inline. Engineer should use the corrected version, not the placeholder.
- No "TBD", "implement later", or vague-error-handling instructions remain.

**Type consistency check:**
- Pass functions all return `(matches: list[dict], unmatched_src, unmatched_bank)` — consistent across passes 1–3.
- Match dict keys: `source_id`, `bank_id`, `confidence`, `pass_no`, `inferred_fee` — consistent.
- Anomaly dict keys: `rule_id`, `severity`, `transaction_ids`, `detail` — consistent.
- `evidence_hash()` defined in Task 7, referenced in Task 12 — consistent name.
- Frontend types in `lib/reconcile.ts` (Task 18) match the Pydantic schemas in Task 14 (`MatchOut` → `MatchRow`, etc.).
- Route paths used by frontend client match those defined in the backend routes.

Plan is internally consistent. Ready for execution.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-17-reconciliation-moat.md`.

Two execution options:

1. **Subagent-Driven** (recommended) — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each subagent gets a clean context window and just one task.

2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review.

Subagent-driven is the right call here: 26 tasks is enough that a single-session context window would degrade. Subagents stay sharp per task.
