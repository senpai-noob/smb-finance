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
        current = months[cur_key]
        if current <= mean:
            continue

        if stddev == 0:
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
