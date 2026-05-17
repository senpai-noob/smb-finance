from datetime import date
from types import SimpleNamespace

from app.services.reconciliation_v2 import pass_exact, pass_fuzzy, pass_fee_inference, run_passes


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
