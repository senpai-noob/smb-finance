"""
LLM explainer for matches and anomalies.

Falls back to deterministic templates when ANTHROPIC_API_KEY is absent or
the call raises. Mirrors the pattern in services/llm_insights.py.
"""
import anthropic

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
