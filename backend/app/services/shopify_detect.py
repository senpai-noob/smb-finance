"""
Shopify CSV auto-detection and normalisation — SaaS-grade rewrite.

Handles two major Shopify export shapes:
  A) Shopify Payments / Payout CSV
       Headers: Payout Date, Description, Amount, Currency, Fee, Net …
  B) Shopify Orders / Sales CSV
       Headers: Order_ID, Date, Customer, Subtotal, GST_Rate, GST_Amount,
                Total_Amount, Payment_Status, Gateway …

Key fix over the previous version:
  _find_col() now uses SUBSTRING matching (same as the main _detect_col)
  so columns like "Total_Amount" match the keyword "total" and
  "GST_Amount" / "Subtotal" are handled correctly.
"""
from __future__ import annotations

import pandas as pd
from typing import Optional, Tuple


# ── keyword lists (substring-matched, lowercase) ──────────────────────────────

# For AMOUNT: prefer Total_Amount > Net > Amount > Subtotal
SHOPIFY_AMOUNT_KW   = ["total_amount", "net", "amount", "gross", "subtotal", "settlement", "total"]
SHOPIFY_DATE_KW     = ["payout date", "transaction date", "date", "created"]
SHOPIFY_DESC_KW     = ["description", "type", "order_id", "order", "source", "reference", "customer"]
SHOPIFY_CURRENCY_KW = ["currency"]
SHOPIFY_FEE_KW      = ["fee", "shopify fee", "processing fee"]

# GST / tax columns (Shopify India orders export)
SHOPIFY_GST_RATE_KW  = ["gst_rate", "tax_rate", "gst rate", "tax rate"]
SHOPIFY_GST_AMT_KW   = ["gst_amount", "tax_amount", "gst amount", "tax amount"]


# ── detection signatures ──────────────────────────────────────────────────────

SHOPIFY_PAYOUT_SIGS = [
    {"payout date", "net"},
    {"payout date", "amount"},
    {"transaction date", "type", "order"},
    {"source", "currency", "net"},
    {"shopify payments"},
]

SHOPIFY_SALES_SIGS = [
    # Each entry: list of substrings that must ALL appear in the joined col string
    ["order_id", "payment_status"],
    ["order_id", "gst"],
    ["order_id", "gateway"],
    ["subtotal", "payment_status", "gateway"],
    ["total_amount", "payment_status"],
]


def _cols_joined(df: pd.DataFrame) -> str:
    return " ".join(c.lower().strip() for c in df.columns)


def detect_shopify(df: pd.DataFrame) -> bool:
    """Return True if the DataFrame looks like any Shopify export."""
    cols_lower = {c.lower().strip() for c in df.columns}
    joined = _cols_joined(df)

    for sig in SHOPIFY_PAYOUT_SIGS:
        if sig.issubset(cols_lower):
            return True
    for sig in SHOPIFY_SALES_SIGS:
        if all(kw in joined for kw in sig):
            return True
    return False


def detect_shopify_type(df: pd.DataFrame) -> str:
    """Return 'payout', 'sales', or 'unknown'."""
    cols_lower = {c.lower().strip() for c in df.columns}
    joined = _cols_joined(df)
    for sig in SHOPIFY_PAYOUT_SIGS:
        if sig.issubset(cols_lower):
            return "payout"
    for sig in SHOPIFY_SALES_SIGS:
        if all(kw in joined for kw in sig):
            return "sales"
    return "unknown"


# ── column finder (substring-aware) ──────────────────────────────────────────

def _find_col(df: pd.DataFrame, keywords: list) -> Optional[str]:
    """
    Substring match — tries keywords in order, returns first column that
    contains the keyword in its lowercased name.  Mirrors _detect_col in
    transactions.py so both code paths agree on which column to use.
    """
    for kw in keywords:
        for col in df.columns:
            if kw in col.lower():
                return col
    return None


# ── normalisation result ──────────────────────────────────────────────────────

class ShopifyNormaliseResult:
    def __init__(self, df, amount_col, desc_col, date_col,
                 gst_rate_col, gst_amount_col, shopify_type, warnings):
        self.df             = df
        self.amount_col     = amount_col
        self.desc_col       = desc_col
        self.date_col       = date_col
        self.gst_rate_col   = gst_rate_col
        self.gst_amount_col = gst_amount_col
        self.shopify_type   = shopify_type
        self.warnings       = warnings


def normalise_shopify(
    df: pd.DataFrame,
    fallback_amount_col: Optional[str] = None,
) -> Tuple[pd.DataFrame, str, Optional[str], Optional[str]]:
    """
    Normalise a Shopify CSV. Returns (df, amount_col, desc_col, date_col).
    Pass fallback_amount_col from the generic _detect_col pass so we never
    end up with a phantom column that doesn't exist in df.
    """
    r = normalise_shopify_rich(df, fallback_amount_col=fallback_amount_col)
    return r.df, r.amount_col, r.desc_col, r.date_col


def normalise_shopify_rich(
    df: pd.DataFrame,
    fallback_amount_col: Optional[str] = None,
) -> ShopifyNormaliseResult:
    warnings: list = []
    shopify_type = detect_shopify_type(df)

    amount_col     = _find_col(df, SHOPIFY_AMOUNT_KW)
    date_col       = _find_col(df, SHOPIFY_DATE_KW)
    desc_col       = _find_col(df, SHOPIFY_DESC_KW)
    gst_rate_col   = _find_col(df, SHOPIFY_GST_RATE_KW)
    gst_amount_col = _find_col(df, SHOPIFY_GST_AMT_KW)

    # Fallback: use generic detector's result rather than yielding no column
    if not amount_col:
        if fallback_amount_col:
            amount_col = fallback_amount_col
            warnings.append(
                f"Using '{fallback_amount_col}' as amount column (no standard "
                f"Shopify amount column found). Consider renaming it to 'Amount' or 'Total'."
            )
        else:
            warnings.append(
                "No amount column found. Rows will be skipped. "
                "Ensure a column named 'Amount', 'Total', 'Net', or 'Subtotal' is present."
            )
            return ShopifyNormaliseResult(
                df=df, amount_col="amount", desc_col=desc_col,
                date_col=date_col, gst_rate_col=gst_rate_col,
                gst_amount_col=gst_amount_col,
                shopify_type=shopify_type, warnings=warnings,
            )

    # Payout-specific: subtract fees from gross amount
    fee_col = _find_col(df, SHOPIFY_FEE_KW)
    if shopify_type == "payout" and fee_col and amount_col:
        df = df.copy()
        df[amount_col] = pd.to_numeric(df[amount_col], errors="coerce").fillna(0)
        df[fee_col]    = pd.to_numeric(df[fee_col],    errors="coerce").fillna(0)
        df[amount_col] = df.apply(
            lambda r: r[amount_col] - abs(r[fee_col])
            if r[fee_col] > 0 else r[amount_col],
            axis=1,
        )

    # Rename to canonical "amount" for downstream consistency
    if amount_col.lower() != "amount":
        df = df.copy()
        df = df.rename(columns={amount_col: "amount"})
        amount_col = "amount"

    return ShopifyNormaliseResult(
        df=df, amount_col=amount_col, desc_col=desc_col,
        date_col=date_col, gst_rate_col=gst_rate_col,
        gst_amount_col=gst_amount_col,
        shopify_type=shopify_type, warnings=warnings,
    )
