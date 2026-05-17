"""
Reconciliation v2 — 4-pass deterministic matcher.

Each pass is a pure function operating on plain lists of transaction-like
objects (anything with .id, .amount, .date, .description). Passes return
(matches, unmatched_source, unmatched_bank) so the orchestrator can chain
them. Matches are dicts (not ORM rows) so passes stay DB-agnostic.
"""
import re
from itertools import combinations
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
    max_subset_size: int = 5,
) -> Tuple[List[dict], List[Any], List[Any]]:
    """Pass 3: a single bank credit ≈ sum of N source line-items minus a fee row.

    For each positive bank credit b, search source for a subset S where:
      |sum(S.amount) - b.amount| <= max(5, b.amount*0.005)
      all S.date within ±2 days of b.date
      S contains at least one fee-flavoured row
    Bounded to subset size <= max_subset_size.

    Optimisation: the search space is restricted to subsets that include at
    least one fee-flavoured row. We iterate fee rows × combinations(non-fee
    rows, k-1) instead of the full C(N, k) — orders of magnitude smaller
    when most candidates aren't fees.
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
        # Split candidates into fee-flavoured and non-fee rows up front.
        # If there are no fee rows, pass 3 cannot match this credit — skip.
        fee_rows     = [s for s in candidate_src if _contains_fee([s])]
        non_fee_rows = [s for s in candidate_src if not _contains_fee([s])]
        if not fee_rows:
            continue

        tolerance = max(5.0, b.amount * 0.005)
        found_subset: list[Any] | None = None

        # For each subset size k (2..max), pick one fee row and combine it
        # with k-1 non-fee rows. This is C(F, 1) * C(N-F, k-1), which is much
        # smaller than C(N, k) when fees are rare.
        for size in range(2, min(max_subset_size, len(candidate_src)) + 1):
            for fee in fee_rows:
                others_needed = size - 1
                if others_needed > len(non_fee_rows):
                    continue
                for others in combinations(non_fee_rows, others_needed):
                    combo = (fee,) + others
                    total = sum(t.amount for t in combo)
                    if abs(total - b.amount) <= tolerance:
                        found_subset = list(combo)
                        break
                if found_subset:
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


def run_passes(source: List[Any], bank: List[Any]) -> dict:
    """Orchestrate the 3 passes and return a result dict consumed by the route."""
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
