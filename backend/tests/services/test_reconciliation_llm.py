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
