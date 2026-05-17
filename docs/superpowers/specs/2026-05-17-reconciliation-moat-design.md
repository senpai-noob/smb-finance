# Reconciliation Moat — Design

**Date**: 2026-05-17
**Status**: Approved, awaiting implementation plan
**Author**: Piyush Barik + Claude
**Sub-project of**: ClarityBooks

---

## Context

A product review identified ClarityBooks's biggest unaddressed weakness as the absence of a true automated reconciliation workflow. The existing implementation (`backend/app/services/reconciliation.py`) is a greedy O(N×M) first-match-wins matcher that pairs source-batch and bank-batch transactions on exact amount + word overlap. It has no fuzzy amount tolerance, no date window, no awareness of Shopify-style payout-minus-fee patterns, and produces no anomaly signal beyond unmatched counts.

The reviewer explicitly called this out as the differentiator the product should be built around: *"Automated reconciliation workflow (Shopify payouts, bank credits, refunds, gateway fees, GST mismatch) — this should become core differentiator."* In parallel they flagged "no real actionable AI workflows" — meaning anomalies and explanations should be surfaced in plain English, not as raw counts.

This spec is for the work that turns reconciliation from a CSV-pairing utility into the product's defensible moat. It commits to a **hybrid architecture**: a deterministic multi-pass matcher and a deterministic anomaly rule engine, wrapped by an optional Claude-powered explainer that produces human-readable narrative. The deterministic layer is the contract; the LLM layer is the polish.

## Goals

1. Replace the single-pass matcher with a 4-pass engine that handles exact, fuzzy, fee-inferred, and leftover transactions distinctly.
2. Introduce a deterministic anomaly detector with 5 rules covering the most common SMB / D2C failure modes.
3. Layer optional LLM explanations on top, gracefully falling back to deterministic templates when the API key is absent or the call fails (mirroring the existing `services/llm_insights.py` pattern).
4. Replace the existing single-run `/reconcile` page with a persistent triage queue UI that shows matched / needs-review / anomalies as distinct streams, each with accept/reject/dismiss controls.
5. Persist runs, matches, and anomalies so users can return to past reconciliations and track the state of each flagged item.

## Non-goals

- No Shopify API integration (still CSV-only — the API sync work is a separate spec).
- No bank API integration (Account Aggregator etc.).
- No background job queue. Runs execute synchronously in the request; budget is 2–8 seconds for ≤500-row reconciliations. Queue work deferred until run sizes justify it.
- No embedding-based matching (Approach 3 considered and rejected — current data does not show description-mismatch as the dominant unmatched cause).
- No retroactive cleanup of pre-existing `transactions.is_reconciled` flags. New code reads from the `matches` table; the legacy boolean stays as a denormalization for fast queries.
- No mobile-specific UI in this spec. Desktop-first; mobile pass is part of Thread B.

---

## Architecture

Four layers, each calling only the one below:

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend: /reconcile triage queue (Next.js page)                │
└─────────────────────────────────────────────────────────────────┘
                            ↓ REST
┌─────────────────────────────────────────────────────────────────┐
│  routes/reconcile.py                                             │
│   start run · list runs · get run · patch match                  │
│   patch anomaly · scan anomalies                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────┐    ┌──────────────────────────┐
│ services/                │    │ services/anomaly.py       │
│ reconciliation_v2.py     │    │  5 deterministic rules    │
│  4 passes, returns Run   │    │  Returns Anomaly[]        │
└──────────────────────────┘    └──────────────────────────┘
                            ↓
              ┌────────────────────────────────────────┐
              │ services/reconciliation_llm.py          │
              │  Optional Claude explainer · batched    │
              │  Falls back to templates if no key      │
              └────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ DB: ReconciliationRun · Match · Anomaly                          │
└─────────────────────────────────────────────────────────────────┘
```

Boundary rules: passes don't know about anomalies, anomalies don't know about passes, the LLM doesn't know about either — it consumes a structured payload and returns a sentence. Each layer is independently testable.

## Data model

Three new tables, added via a single Alembic migration. Backwards-compatible — no existing tables modified except for adding indexes.

```python
# backend/app/models/reconciliation.py
class ReconciliationRun(Base):
    id              # PK
    org_id          # FK organizations
    source_batch_id # FK upload_batches
    bank_batch_id   # FK upload_batches
    started_by      # FK users
    status          # running | complete | failed
    summary         # JSON: pass counts, durations, totals, pass_3_partial flag
    created_at, completed_at

class Match(Base):
    id              # PK
    run_id          # FK reconciliation_runs
    source_txn_id   # FK transactions
    bank_txn_id     # FK transactions
    confidence      # high | medium | low
    pass_no         # 1=exact, 2=fuzzy, 3=fee_inference
    inferred_fee    # nullable — populated by pass 3
    explanation     # nullable — LLM output or template
    status          # pending | accepted | rejected
    created_at, updated_at

class Anomaly(Base):
    id              # PK
    org_id          # FK organizations (anomalies are org-wide, not run-scoped)
    rule_id         # vendor_spike | payout_cadence_gap | duplicate_within_window
                    # | gst_mismatch | refund_without_charge
    severity        # low | medium | high
    transaction_ids # JSON list of involved txn ids
    detail          # JSON: rule-specific evidence schema
    explanation     # nullable — LLM output or template
    status          # open | accepted | dismissed | snoozed_until_<iso_date>
    detected_at, updated_at
    evidence_hash   # for dedup on repeated scans
```

**Design choice**: anomalies are org-wide, matches are run-scoped. Rationale: an anomaly is a fact about the data (a vendor spike happened) and should survive across reconciliation sessions. A match is a hypothesis about a specific pair of batches and is meaningless outside its run.

Existing `transactions.is_reconciled` and `transactions.reconciled_with` are retained as denormalizations for legacy code paths.

**Indexes added in the same migration**:
- `(org_id, created_at)` on `reconciliation_runs` — list view
- `(run_id, status)` on `matches` — triage filtering
- `(org_id, status, severity)` on `anomalies` — queue ordering
- `(org_id, date)` on `transactions` — was missing; affects all summary queries
- `(org_id, category)` on `transactions` — was missing; affects category aggregations

## Reconciliation passes

`backend/app/services/reconciliation_v2.py` — top-level `run(source_txns, bank_txns) -> ReconciliationRun`. Each pass mutates a shared `unmatched_source` / `unmatched_bank` list and produces `Match` rows. Later passes only see what earlier passes missed.

**Pass 1 — Exact (high confidence)**
```
For each source_txn s in unmatched_source:
  candidates = bank_txns where
    abs(s.amount) == abs(b.amount)
    AND abs((s.date - b.date).days) <= 1
  If exactly 1 candidate → Match(confidence=high, pass=1)
  If >1 → defer to pass 2 (ambiguous, needs scoring)
```

**Pass 2 — Fuzzy amount + date window (medium confidence)**
```
For each remaining s:
  candidates = bank_txns where
    abs(abs(s.amount) - abs(b.amount)) <= max(2.00, abs(s.amount) * 0.02)
    AND abs((s.date - b.date).days) <= 3
  Score each by:
    amount_proximity    (0..1, 1 - delta / tolerance)
    date_proximity      (0..1, 1 - days / 3)
    description_overlap (Jaccard on normalised tokens, 0..1)
  Take best if combined score > 0.55 → Match(confidence=medium, pass=2)
```

**Pass 3 — Fee inference (medium confidence)**
Captures the Shopify pattern where one bank credit equals the sum of several source line-items minus a fee row.
```
For each remaining bank_txn b where b.amount > 0:
  Search source for a subset S of txns such that
    abs(sum(S.amount) - b.amount) <= max(5.00, b.amount * 0.005)
    AND all S.date within ±2 days of b.date
    AND S contains at least one txn categorised as "Banking & Finance"
        or with description matching /fee|charge|commission/i
  If found → one Match per s in S
            (confidence=medium, pass=3, inferred_fee=delta)
```
Subset search is bounded to ≤8 source items per bank credit (meet-in-the-middle for sizes ≤16). 500ms budget per credit; on exceedance, that credit is skipped and `pass_3_partial=true` is written to the run summary.

**Pass 4 — Leftover collection**
Whatever remained unmatched after passes 1–3 is recorded in `run.summary.unmatched_source` / `unmatched_bank` and surfaced as candidates to the anomaly detector.

## Anomaly rules

`backend/app/services/anomaly.py` — each rule is a pure function `(org_id, db) -> list[Anomaly]`. Rules run on reconciliation completion AND on the manual scan endpoint. Idempotent: dedupes via `evidence_hash` (SHA-256 of `rule_id + transaction_ids + key evidence fields`).

| rule_id | Logic | Severity | Evidence JSON |
|---|---|---|---|
| `vendor_spike` | Cluster txns by vendor (normalised description tokens). Compute 6-month rolling mean and stddev of monthly spend. If current-month spend > mean + 3σ → flag. | high if >5σ, else medium | `{vendor, current, mean, stddev, deviation_sigma, month}` |
| `payout_cadence_gap` | For Shopify-source batches, infer cadence (daily/weekly) from history. If expected payout date passed by 3+ days with no credit found → flag. | high | `{expected_date, days_late, last_payout_amount, cadence}` |
| `duplicate_within_window` | Same `abs(amount)` + matching description token-set + within 7 days → possible double charge. | medium | `{amount, vendor, txn_ids, days_apart}` |
| `gst_mismatch` | For each expense txn with `gst_amount`, recompute `18/118 * abs(amount)`. If stored vs recomputed differ by >₹1 → flag. | low | `{txn_id, stored_gst, recomputed_gst, delta}` |
| `refund_without_charge` | Positive-amount refund-categorised txn with no preceding negative txn of similar amount and same vendor within 60 days → flag. | medium | `{refund_txn_id, amount, vendor, searched_window_days}` |

Strict evidence schema per rule — the UI doesn't have to guess. New rules added later get their own row in this table.

## LLM explainer

`backend/app/services/reconciliation_llm.py`:

```python
def explain_batch(items: list[Match | Anomaly]) -> dict[id, str]:
    if not settings.ANTHROPIC_API_KEY:
        return {i.id: _template(i) for i in items}
    # cache lookup by evidence_hash
    # one Claude call for all uncached items
    # write to cache, return merged result
```

- **Batched**: all medium-confidence matches + new anomalies from one run → one Claude call. Predictable cost (~₹0.30 per run for ≤50 items).
- **Cached**: keyed by `hash(rule_id + relevant evidence fields)`. Repeat anomalies (same vendor spike pattern) reuse explanations.
- **Falls back** to deterministic templates per rule, mirroring `services/llm_insights.py`. Example template for `vendor_spike`: `f"{vendor} spent ₹{current:,.0f} this month — {deviation_sigma:.1f}σ above the 6-month average of ₹{mean:,.0f}."`
- **Never blocks the run**: explainer failure → template → user sees the data, just less polished prose.

## Routes

Replace the existing `POST /api/transactions/reconcile/{org_id}` with a new router at `/api/reconcile/`:

```
POST   /api/reconcile/runs/{org_id}              start a run; body: {source_batch_id, bank_batch_id}
GET    /api/reconcile/runs/{org_id}              list past runs (paginated)
GET    /api/reconcile/runs/{org_id}/{run_id}     full run: matches + anomalies (joined)
PATCH  /api/reconcile/matches/{match_id}         body: {status: accepted | rejected}
PATCH  /api/reconcile/anomalies/{anomaly_id}     body: {status: accepted | dismissed | snoozed_until}
POST   /api/reconcile/anomalies/{org_id}/scan    manual anomaly re-scan; idempotent
```

Permission rules: viewer cannot start a run or PATCH; admin/owner can. Enforced via existing `check_org_membership` + role check.

The old `POST /api/transactions/reconcile` route is kept for one release as a deprecated wrapper that delegates to the new run endpoint, then removed.

## Triage queue UI

`frontend/app/reconcile/page.tsx` — full rewrite.

**Layout**:

```
┌──────────────────────────────────────────────────────────────────┐
│  Run history (last 5) — click to switch                          │
│  ● 17 May · Shopify Apr ↔ Bank Apr · 87% matched · 3 anomalies   │
├──────────────────────────────────────────────────────────────────┤
│ Auto-matched (124) ▸  │  Needs review (6)        │  Anomalies (3)│
│ collapsed by default  │  cards                    │  cards        │
└───────────────────────┴──────────────────────────┴───────────────┘
```

**Card composition** — same primitives for matches and anomalies, differ only by header and badge:

- Header: amount in Instrument Serif (large display), parties in Manrope
- Badge: emerald for high confidence / accepted, amber for medium, coral for high-severity anomaly
- Evidence row: JetBrains Mono, tabular-nums (date deltas, σ values, inferred fees)
- Explanation paragraph: Manrope 13px (LLM output or template fallback)
- Action row: Accept / Reject (matches) or Accept / Dismiss / Snooze (anomalies)

**Drilldown drawer** — clicking a card opens a right-side slide-in showing raw transaction JSON (both sides for matches), audit log entries, similar past anomalies (queried by `rule_id + vendor_hash`), and a deep-link to the Ledger.

**Empty / loading / error states**:
- Loading: skeleton cards matching the column layout, no spinner (perceived performance)
- Empty: "All caught up. Last reconciled [date]."
- Error: "Couldn't load this run. [Retry]"

These three live inline in the page initially. When Thread B (SaaS shell) happens, they get promoted to `frontend/components/states/`.

## Error handling

| Failure | Behaviour | Surface |
|---|---|---|
| LLM API timeout / 5xx | Templates used for the batch | Small "explained without AI" indicator on card |
| Pass 3 subset search exceeds 500ms per credit | Skip pass 3 for that credit, fall through to leftover | AuditLog entry; `pass_3_partial: true` in run summary |
| Anomaly rule throws | Skip that rule, continue others | AuditLog `anomaly.rule_failed` with rule_id and exception |
| Run created but pass execution dies | Run.status = "failed", error stored in summary | "This run failed. [View error]" |
| Concurrent PATCH on same Match | Optimistic locking via `updated_at` → 409 Conflict | Toast: "Someone else updated this. Refresh." |
| Source/bank batches empty | 400 before run is created | Inline error on the run-start form |

**Critical invariant**: the explainer never blocks the run. Three degradation layers: Claude → templates → raw evidence JSON.

## Testing

**Unit (pure functions, no DB)**
- `backend/tests/services/test_reconciliation_v2.py` — fixture CSVs with known matches. One test per pass + one full-pipeline test.
- `backend/tests/services/test_anomaly.py` — one test per rule with synthetic transaction lists; assert correct anomalies AND correct evidence schema.
- `backend/tests/services/test_reconciliation_llm.py` — mock `anthropic.Anthropic`; verify batched prompt shape, template fallback when key absent, cache hits on repeated input.

**Integration (real DB, FastAPI TestClient)**
- `backend/tests/routes/test_reconcile.py` — start run → poll status → fetch result → PATCH a match → PATCH an anomaly → assert state transitions.
- Permission test: viewer is forbidden from start and PATCH; admin succeeds.

**Test fixtures**
- `backend/tests/fixtures/shopify_payouts_test.csv` — 50 rows, known fee patterns (for pass 3).
- `backend/tests/fixtures/bank_test.csv` — 40 rows with intentional ±2% noise and 2 seeded anomalies.

**Frontend testing** — manual until Playwright is added in a separate workstream. Storybook stories per card state are optional but cheap.

---

## Open questions deferred to plan stage

1. **Migration ordering**: the new `(org_id, date)` index on `transactions` will scan-build over the existing rows. For large existing customers (millions of rows) this needs `CONCURRENTLY` on Postgres. Plan stage will decide the migration form.
2. **Pass-3 fee-pattern keywords are English-only** today. Indian banks sometimes use Hindi/regional terms ("शुल्क", "प्रभार"). Adding multilingual keywords is a follow-up after we have real data showing the gap.
3. **Snooze duration UI** — fixed presets (1 week / 1 month / forever) vs date picker. Plan stage decides; my default is the presets.

## Glossary

- **Run**: one reconciliation session between a specific source batch and a specific bank batch.
- **Match**: a paired source+bank transaction produced by one of the 4 passes; has confidence and status.
- **Anomaly**: a flagged transaction or pattern produced by a rule; persists across runs.
- **Pass**: one stage of the reconciliation engine (1=exact, 2=fuzzy, 3=fee_inference, 4=leftover).
- **Evidence**: rule-specific JSON describing what triggered an anomaly, used by both the UI and the LLM explainer.
- **Triage**: the user's act of accepting, rejecting, dismissing, or snoozing matches and anomalies.
