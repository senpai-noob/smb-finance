import io
import json
import csv as csv_mod
from typing import List, Optional
from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_db, get_current_user, check_org_membership
from app.models.transaction import Transaction, UploadBatch
from app.models.user import User
from app.schemas.transactions import (
    CategoryPatchRequest, SummaryResponse, CategoryTotal,
    MonthlyPoint, ReconcileResult, TransactionOut,
    TransactionListResponse, UploadBatchOut,
    GSTSummaryResponse, GSTLine,
)
from app.services.categorization import categorize, RULES
from app.services.shopify_detect import detect_shopify, normalise_shopify
from app.services.reconciliation import reconcile_batches
from app.services.llm_insights import generate_llm_insights
from app.services.audit import log_action

router = APIRouter(prefix="/transactions", tags=["transactions"])

ALL_CATEGORIES = ["All"] + [r[0] for r in RULES] + ["Uncategorised"]

UPLOAD_ROLES  = {"owner", "admin"}   # viewers cannot upload
EDIT_ROLES    = {"owner", "admin"}   # viewers cannot edit categories


# ── helpers ───────────────────────────────────────────────────────────────────

def _detect_col(df: pd.DataFrame, keywords: list[str]) -> Optional[str]:
    for col in df.columns:
        if any(k in col.lower() for k in keywords):
            return col
    return None


def _parse_amount(val) -> Optional[float]:
    if pd.isna(val):
        return None
    try:
        return float(str(val).replace(",", "").replace("₹", "").replace("$", "").replace("Rs.", "").strip())
    except (ValueError, TypeError):
        return None


def _parse_date(val) -> Optional[date]:
    if pd.isna(val):
        return None
    try:
        from dateutil import parser as dparser
        import re as _re
        s = str(val).strip()
        if _re.match(r"\d{4}-\d{2}-\d{2}", s):
            return dparser.parse(s, dayfirst=False).date()
        return dparser.parse(s, dayfirst=True).date()
    except Exception:
        return None


def _monthly_trend(txns: List[Transaction]) -> List[MonthlyPoint]:
    from collections import defaultdict
    import calendar
    buckets: dict[str, dict] = defaultdict(lambda: {"income": 0.0, "expenses": 0.0})
    for t in txns:
        if not t.date:
            continue
        key = t.date.strftime("%Y-%m")
        if t.amount > 0:
            buckets[key]["income"] += t.amount
        else:
            buckets[key]["expenses"] += t.amount
    result = []
    for key in sorted(buckets.keys()):
        yr, mo = key.split("-")
        label = f"{calendar.month_abbr[int(mo)]} {yr}"
        inc = buckets[key]["income"]
        exp = buckets[key]["expenses"]
        result.append(MonthlyPoint(month=key, month_label=label, income=inc, expenses=exp, net=inc + exp))
    return result


# ── upload ────────────────────────────────────────────────────────────────────

@router.post("/upload/{org_id}", response_model=UploadBatchOut, status_code=201)
async def upload_csv(
    org_id: int,
    file: UploadFile = File(...),
    source: str = Form(default="manual"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # FIX 1: Only owner/admin can upload — viewers are blocked
    m = check_org_membership(org_id, current_user, db)
    if m.role not in UPLOAD_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Viewers cannot upload files. Ask an admin to upload."
        )

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    contents = await file.read()

    if len(contents) > settings.MAX_CSV_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max {settings.MAX_CSV_SIZE_MB} MB.")

    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    if len(df) > settings.MAX_CSV_ROWS:
        raise HTTPException(status_code=400, detail=f"CSV too large. Max {settings.MAX_CSV_ROWS:,} rows.")

    # FIX 2: Duplicate detection — same filename already uploaded for this org
    existing = db.query(UploadBatch).filter(
        UploadBatch.org_id   == org_id,
        UploadBatch.filename == file.filename,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"File '{file.filename}' was already uploaded (batch #{existing.id}). "
                   f"Rename the file or delete the existing batch to re-upload."
        )

    # ── Step 1: Generic column detection ──────────────────────────────────────
    amount_col = _detect_col(df, ["amount", "total", "price", "debit", "credit", "value", "net", "fee"])
    date_col   = _detect_col(df, ["date", "time", "posted", "transaction_date"])
    desc_col   = _detect_col(df, ["description", "narration", "name", "merchant", "particulars",
                                   "lineitem", "title", "details", "remarks"])

    # ── Step 2: Shopify normalisation (with fallback column) ──────────────────
    parse_warnings: list[str] = []
    gst_rate_col:   Optional[str] = None
    gst_amount_col: Optional[str] = None

    if source == "shopify" or detect_shopify(df):
        if source != "shopify":
            source = "shopify"
        # Pass the already-detected amount_col as fallback so normalise_shopify
        # never returns a phantom column name that doesn't exist in df
        from app.services.shopify_detect import normalise_shopify_rich
        result = normalise_shopify_rich(df, fallback_amount_col=amount_col)
        df             = result.df
        amount_col     = result.amount_col
        gst_rate_col   = result.gst_rate_col
        gst_amount_col = result.gst_amount_col
        parse_warnings.extend(result.warnings)
        # Prefer Shopify-detected desc/date but don't discard generic if better
        desc_col = result.desc_col or desc_col
        date_col = result.date_col or date_col

    # ── Step 3: Validate that we actually have an amount column ───────────────
    if not amount_col or amount_col not in df.columns:
        raise HTTPException(
            status_code=422,
            detail=(
                "No amount column found. Ensure your CSV has a column named "
                "'Amount', 'Total', 'Net', 'Subtotal', or similar."
            ),
        )

    batch = UploadBatch(
        org_id=org_id, uploaded_by=current_user.id,
        filename=file.filename, source=source, row_count=0,
    )
    db.add(batch)
    db.flush()

    txns_to_add  = []
    skipped_rows = 0

    for _, row in df.iterrows():
        amount = _parse_amount(row.get(amount_col))
        if amount is None:
            skipped_rows += 1
            continue

        description = (
            str(row[desc_col]).strip()
            if desc_col and not pd.isna(row.get(desc_col, float("nan")))
            else None
        )
        txn_date = _parse_date(row.get(date_col)) if date_col else None
        category = categorize(description, amount)

        # Use real GST data from the row if available (Shopify India exports),
        # otherwise fall back to the 18% reverse-calculation estimate
        gst_est: Optional[float] = None
        if amount < 0:
            if gst_amount_col and gst_amount_col in df.columns:
                raw_gst = _parse_amount(row.get(gst_amount_col))
                if raw_gst is not None:
                    gst_est = round(abs(raw_gst), 2)
            if gst_est is None and gst_rate_col and gst_rate_col in df.columns:
                try:
                    rate = float(str(row.get(gst_rate_col, "")).replace("%", "").strip())
                    gst_est = round(abs(amount) * rate / (100 + rate), 2)
                except (ValueError, TypeError):
                    pass
            if gst_est is None:
                gst_est = round(abs(amount) * 18 / 118, 2)

        txns_to_add.append(Transaction(
            batch_id=batch.id, org_id=org_id,
            date=txn_date, description=description,
            amount=amount, category=category, gst_amount=gst_est,
            raw_row=json.dumps(row.to_dict(), default=str),
        ))

    db.bulk_save_objects(txns_to_add)
    batch.row_count = len(txns_to_add)

    if len(txns_to_add) == 0:
        db.rollback()
        col_list = ", ".join(f"'{c}'" for c in df.columns[:8])
        raise HTTPException(
            status_code=422,
            detail=(
                f"No rows could be imported — the amount column contained no valid numbers. "
                f"Columns detected: [{col_list}{'…' if len(df.columns) > 8 else ''}]. "
                f"Hints: {'; '.join(parse_warnings) if parse_warnings else 'Check that the file type selected matches your CSV.'}"
            ),
        )

    log_action(db, "upload.csv", user_id=current_user.id, org_id=org_id,
               resource=f"batch:{file.filename}",
               detail={
                   "rows":       len(txns_to_add),
                   "skipped":    skipped_rows,
                   "source":     source,
                   "warnings":   parse_warnings,
                   "amount_col": amount_col,
                   "date_col":   date_col,
                   "desc_col":   desc_col,
               })

    db.commit()
    db.refresh(batch)
    return batch


# ── list transactions ─────────────────────────────────────────────────────────

@router.get("/list/{org_id}", response_model=TransactionListResponse)
def list_transactions(
    org_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    reconciled: Optional[bool] = Query(None),
    source: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(Transaction.org_id == org_id)
    if category and category != "All":
        q = q.filter(Transaction.category == category)
    if search:
        q = q.filter(Transaction.description.ilike(f"%{search}%"))
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    if reconciled is not None:
        q = q.filter(Transaction.is_reconciled == reconciled)
    if source:
        batch_ids = [b.id for b in db.query(UploadBatch).filter(
            UploadBatch.org_id == org_id, UploadBatch.source == source).all()]
        q = q.filter(Transaction.batch_id.in_(batch_ids))

    q = q.order_by(Transaction.date.desc(), Transaction.id.desc())
    total = q.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return TransactionListResponse(
        items=items, total=total,
        page=page, page_size=page_size, total_pages=total_pages,
    )


# ── update category ───────────────────────────────────────────────────────────

@router.patch("/{txn_id}/category", response_model=TransactionOut)
def update_category(
    txn_id: int,
    payload: CategoryPatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(Transaction.id == txn_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # FIX 1: viewers cannot edit categories
    m = check_org_membership(txn.org_id, current_user, db)
    if m.role not in EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Viewers cannot edit categories")

    old_cat = txn.category
    txn.category = payload.category

    log_action(db, "txn.category_edit", user_id=current_user.id, org_id=txn.org_id,
               resource=f"txn:{txn_id}",
               detail={"from": old_cat, "to": payload.category})

    db.commit()
    db.refresh(txn)
    return txn


# ── summary ───────────────────────────────────────────────────────────────────

@router.get("/summary/{org_id}", response_model=SummaryResponse)
def get_summary(
    org_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(Transaction.org_id == org_id)
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    txns: List[Transaction] = q.all()

    if date_from and date_to:
        period_label = f"{date_from.strftime('%d %b %Y')} – {date_to.strftime('%d %b %Y')}"
    elif date_from:
        period_label = f"From {date_from.strftime('%d %b %Y')}"
    elif date_to:
        period_label = f"Up to {date_to.strftime('%d %b %Y')}"
    else:
        period_label = "All time"

    if not txns:
        return SummaryResponse(
            org_id=org_id, period_label=period_label,
            total_income=0, total_expenses=0, net_cashflow=0,
            transaction_count=0, category_totals=[], monthly_trend=[],
            insights=["No transactions yet. Upload a CSV to get started."],
        )

    total_income   = sum(t.amount for t in txns if t.amount > 0)
    total_expenses = sum(t.amount for t in txns if t.amount < 0)
    net_cashflow   = total_income + total_expenses

    cat_map: dict[str, dict] = {}
    for t in txns:
        cat = t.category or "Uncategorised"
        if cat not in cat_map:
            cat_map[cat] = {"total": 0.0, "count": 0}
        cat_map[cat]["total"] += t.amount
        cat_map[cat]["count"] += 1

    expense_total = abs(total_expenses) or 1
    category_totals = []
    for k, v in sorted(cat_map.items(), key=lambda x: x[1]["total"]):
        pct = abs(v["total"]) / expense_total * 100 if v["total"] < 0 else 0
        category_totals.append(CategoryTotal(
            category=k, total=round(v["total"], 2),
            count=v["count"], percentage=round(pct, 1),
        ))

    # Phase 3: Claude-powered insights (falls back to rules if no API key)
    insights = generate_llm_insights(
        category_totals={c.category: c.total for c in category_totals},
        total_income=total_income,
        total_expenses=total_expenses,
        net_cashflow=net_cashflow,
        period_label=period_label,
        transaction_count=len(txns),
    )

    return SummaryResponse(
        org_id=org_id, period_label=period_label,
        total_income=round(total_income, 2),
        total_expenses=round(total_expenses, 2),
        net_cashflow=round(net_cashflow, 2),
        transaction_count=len(txns),
        category_totals=category_totals,
        monthly_trend=_monthly_trend(txns),
        insights=insights,
    )


# ── GST summary ───────────────────────────────────────────────────────────────

@router.get("/gst-summary/{org_id}", response_model=GSTSummaryResponse)
def gst_summary(
    org_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(
        Transaction.org_id == org_id,
        Transaction.gst_amount != None,  # noqa
        Transaction.amount < 0,
    )
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    txns = q.all()

    period_label = "All time"
    if date_from and date_to:
        period_label = f"{date_from.strftime('%b %Y')} – {date_to.strftime('%b %Y')}"

    cat_map: dict[str, dict] = {}
    for t in txns:
        cat = t.category or "Uncategorised"
        if cat not in cat_map:
            cat_map[cat] = {"taxable": 0.0, "gst": 0.0}
        gst = t.gst_amount or 0
        cat_map[cat]["taxable"] += abs(t.amount) - gst
        cat_map[cat]["gst"]     += gst

    lines = [
        GSTLine(
            category=cat,
            taxable_amount=round(v["taxable"], 2),
            gst_amount=round(v["gst"], 2),
            cgst=round(v["gst"] / 2, 2),
            sgst=round(v["gst"] / 2, 2),
            igst=0.0,
        )
        for cat, v in cat_map.items()
    ]

    return GSTSummaryResponse(
        org_id=org_id, period_label=period_label,
        total_taxable=round(sum(l.taxable_amount for l in lines), 2),
        total_gst=round(sum(l.gst_amount for l in lines), 2),
        total_cgst=round(sum(l.cgst for l in lines), 2),
        total_sgst=round(sum(l.sgst for l in lines), 2),
        total_igst=0.0,
        lines=sorted(lines, key=lambda x: -x.gst_amount),
    )


# ── export CSV ────────────────────────────────────────────────────────────────

@router.get("/export/{org_id}")
def export_transactions(
    org_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(Transaction.org_id == org_id)
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    if category and category != "All":
        q = q.filter(Transaction.category == category)
    txns = q.order_by(Transaction.date.asc()).all()

    output = io.StringIO()
    writer = csv_mod.writer(output)
    writer.writerow(["Date", "Description", "Amount", "Currency", "Category", "GST Amount", "Reconciled"])
    for t in txns:
        writer.writerow([
            t.date or "", t.description or "", t.amount, t.currency,
            t.category or "", t.gst_amount or "", "Yes" if t.is_reconciled else "No",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=claritybooks_{org_id}.csv"},
    )


# ── reconcile ─────────────────────────────────────────────────────────────────

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
    summary = new.get("summary") or {}
    unmatched_src = len(summary.get("unmatched_source") or [])
    unmatched_bank = len(summary.get("unmatched_bank") or [])
    total_src = matched + unmatched_src
    return ReconcileResult(
        matched_pairs=matched,
        unmatched_source=unmatched_src,
        unmatched_bank=unmatched_bank,
        match_rate=round(matched / total_src * 100, 1) if total_src else 0,
        details=[],
    )


# ── batch list ────────────────────────────────────────────────────────────────

@router.get("/batches/{org_id}", response_model=List[UploadBatchOut])
def list_batches(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)
    return db.query(UploadBatch).filter(
        UploadBatch.org_id == org_id
    ).order_by(UploadBatch.id.desc()).all()


@router.delete("/batches/{org_id}/{batch_id}", response_model=dict)
def delete_batch(
    org_id: int,
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = check_org_membership(org_id, current_user, db)
    if m.role not in UPLOAD_ROLES:
        raise HTTPException(status_code=403, detail="Viewers cannot delete uploaded files")

    batch = db.query(UploadBatch).filter(
        UploadBatch.id == batch_id,
        UploadBatch.org_id == org_id,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Upload batch not found")

    txn_ids = [
        row[0] for row in db.query(Transaction.id).filter(
            Transaction.batch_id == batch.id,
            Transaction.org_id == org_id,
        ).all()
    ]

    if txn_ids:
        db.query(Transaction).filter(
            Transaction.org_id == org_id,
            Transaction.reconciled_with.in_(txn_ids),
        ).update(
            {"is_reconciled": False, "reconciled_with": None},
            synchronize_session=False,
        )

    filename = batch.filename
    source = batch.source
    row_count = batch.row_count

    db.query(Transaction).filter(
        Transaction.batch_id == batch.id,
        Transaction.org_id == org_id,
    ).delete(synchronize_session=False)
    db.delete(batch)

    log_action(
        db,
        "upload.batch_delete",
        user_id=current_user.id,
        org_id=org_id,
        resource=f"batch:{filename}",
        detail={"batch_id": batch_id, "rows": row_count, "source": source},
    )
    db.commit()
    return {"ok": True, "deleted_batch_id": batch_id}


# ── categories list ───────────────────────────────────────────────────────────

@router.get("/categories", tags=["meta"])
def list_categories():
    return {"categories": ALL_CATEGORIES}
def _detect_col(df: pd.DataFrame, keywords: list[str]) -> Optional[str]:
    for col in df.columns:
        if any(k in col.lower() for k in keywords):
            return col
    return None


def _parse_amount(val) -> Optional[float]:
    if pd.isna(val):
        return None
    try:
        return float(str(val).replace(",", "").replace("₹", "").replace("$", "").replace("Rs.", "").strip())
    except (ValueError, TypeError):
        return None


def _parse_date(val) -> Optional[date]:
    if pd.isna(val):
        return None
    try:
        from dateutil import parser as dparser
        import re as _re
        s = str(val).strip()
        if _re.match(r"\d{4}-\d{2}-\d{2}", s):
            return dparser.parse(s, dayfirst=False).date()
        return dparser.parse(s, dayfirst=True).date()
    except Exception:
        return None


def _monthly_trend(txns: List[Transaction]) -> List[MonthlyPoint]:
    from collections import defaultdict
    import calendar
    buckets: dict[str, dict] = defaultdict(lambda: {"income": 0.0, "expenses": 0.0})
    for t in txns:
        if not t.date:
            continue
        key = t.date.strftime("%Y-%m")
        if t.amount > 0:
            buckets[key]["income"] += t.amount
        else:
            buckets[key]["expenses"] += t.amount
    result = []
    for key in sorted(buckets.keys()):
        yr, mo = key.split("-")
        label = f"{calendar.month_abbr[int(mo)]} {yr}"
        inc = buckets[key]["income"]
        exp = buckets[key]["expenses"]
        result.append(MonthlyPoint(month=key, month_label=label, income=inc, expenses=exp, net=inc + exp))
    return result


# ── upload ────────────────────────────────────────────────────────────────────

@router.post("/upload/{org_id}", response_model=UploadBatchOut, status_code=201)
async def upload_csv(
    org_id: int,
    file: UploadFile = File(...),
    source: str = Form(default="manual"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # FIX 1: Only owner/admin can upload — viewers are blocked
    m = check_org_membership(org_id, current_user, db)
    if m.role not in UPLOAD_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Viewers cannot upload files. Ask an admin to upload."
        )

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    contents = await file.read()

    if len(contents) > settings.MAX_CSV_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max {settings.MAX_CSV_SIZE_MB} MB.")

    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    if len(df) > settings.MAX_CSV_ROWS:
        raise HTTPException(status_code=400, detail=f"CSV too large. Max {settings.MAX_CSV_ROWS:,} rows.")

    # FIX 2: Duplicate detection — same filename already uploaded for this org
    existing = db.query(UploadBatch).filter(
        UploadBatch.org_id   == org_id,
        UploadBatch.filename == file.filename,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"File '{file.filename}' was already uploaded (batch #{existing.id}). "
                   f"Rename the file or delete the existing batch to re-upload."
        )

    # Auto-detect columns
    amount_col = _detect_col(df, ["amount", "total", "price", "debit", "credit", "value", "net", "fee"])
    if not amount_col:
        raise HTTPException(
            status_code=400,
            detail="No amount column found. Ensure your CSV has a column named 'amount', 'total', 'net', or similar.",
        )
    date_col = _detect_col(df, ["date", "time", "posted", "transaction_date"])
    desc_col = _detect_col(df, ["description", "narration", "name", "merchant", "particulars",
                                 "lineitem", "title", "details", "remarks"])

    # Phase 3: Shopify auto-detect — normalise columns automatically
    if source == "shopify" or detect_shopify(df):
        if source != "shopify":
            source = "shopify"   # correct the label
        df, amount_col, desc_col_raw, date_col_raw = normalise_shopify(df)
        if not desc_col:
            desc_col = desc_col_raw or desc_col
        if not date_col:
            date_col = date_col_raw or date_col

    batch = UploadBatch(
        org_id=org_id, uploaded_by=current_user.id,
        filename=file.filename, source=source, row_count=0,
    )
    db.add(batch)
    db.flush()

    txns_to_add = []
    for _, row in df.iterrows():
        amount = _parse_amount(row.get(amount_col))
        if amount is None:
            continue
        description = str(row[desc_col]).strip() if desc_col and not pd.isna(row.get(desc_col, float("nan"))) else None
        txn_date    = _parse_date(row.get(date_col)) if date_col else None
        category    = categorize(description, amount)
        gst_est     = round(abs(amount) * 18 / 118, 2) if amount < 0 else None

        txns_to_add.append(Transaction(
            batch_id=batch.id, org_id=org_id,
            date=txn_date, description=description,
            amount=amount, category=category, gst_amount=gst_est,
            raw_row=json.dumps(row.to_dict(), default=str),
        ))

    db.bulk_save_objects(txns_to_add)
    batch.row_count = len(txns_to_add)

    # FIX 3: Audit log for upload
    log_action(db, "upload.csv", user_id=current_user.id, org_id=org_id,
               resource=f"batch:{file.filename}",
               detail={"rows": len(txns_to_add), "source": source})

    db.commit()
    db.refresh(batch)
    return batch


# ── list transactions ─────────────────────────────────────────────────────────

@router.get("/list/{org_id}", response_model=TransactionListResponse)
def list_transactions(
    org_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    reconciled: Optional[bool] = Query(None),
    source: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(Transaction.org_id == org_id)
    if category and category != "All":
        q = q.filter(Transaction.category == category)
    if search:
        q = q.filter(Transaction.description.ilike(f"%{search}%"))
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    if reconciled is not None:
        q = q.filter(Transaction.is_reconciled == reconciled)
    if source:
        batch_ids = [b.id for b in db.query(UploadBatch).filter(
            UploadBatch.org_id == org_id, UploadBatch.source == source).all()]
        q = q.filter(Transaction.batch_id.in_(batch_ids))

    q = q.order_by(Transaction.date.desc(), Transaction.id.desc())
    total = q.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return TransactionListResponse(
        items=items, total=total,
        page=page, page_size=page_size, total_pages=total_pages,
    )


# ── update category ───────────────────────────────────────────────────────────

@router.patch("/{txn_id}/category", response_model=TransactionOut)
def update_category(
    txn_id: int,
    payload: CategoryPatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(Transaction.id == txn_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # FIX 1: viewers cannot edit categories
    m = check_org_membership(txn.org_id, current_user, db)
    if m.role not in EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Viewers cannot edit categories")

    old_cat = txn.category
    txn.category = payload.category

    log_action(db, "txn.category_edit", user_id=current_user.id, org_id=txn.org_id,
               resource=f"txn:{txn_id}",
               detail={"from": old_cat, "to": payload.category})

    db.commit()
    db.refresh(txn)
    return txn


# ── summary ───────────────────────────────────────────────────────────────────

@router.get("/summary/{org_id}", response_model=SummaryResponse)
def get_summary(
    org_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(Transaction.org_id == org_id)
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    txns: List[Transaction] = q.all()

    if date_from and date_to:
        period_label = f"{date_from.strftime('%d %b %Y')} – {date_to.strftime('%d %b %Y')}"
    elif date_from:
        period_label = f"From {date_from.strftime('%d %b %Y')}"
    elif date_to:
        period_label = f"Up to {date_to.strftime('%d %b %Y')}"
    else:
        period_label = "All time"

    if not txns:
        return SummaryResponse(
            org_id=org_id, period_label=period_label,
            total_income=0, total_expenses=0, net_cashflow=0,
            transaction_count=0, category_totals=[], monthly_trend=[],
            insights=["No transactions yet. Upload a CSV to get started."],
        )

    total_income   = sum(t.amount for t in txns if t.amount > 0)
    total_expenses = sum(t.amount for t in txns if t.amount < 0)
    net_cashflow   = total_income + total_expenses

    cat_map: dict[str, dict] = {}
    for t in txns:
        cat = t.category or "Uncategorised"
        if cat not in cat_map:
            cat_map[cat] = {"total": 0.0, "count": 0}
        cat_map[cat]["total"] += t.amount
        cat_map[cat]["count"] += 1

    expense_total = abs(total_expenses) or 1
    category_totals = []
    for k, v in sorted(cat_map.items(), key=lambda x: x[1]["total"]):
        pct = abs(v["total"]) / expense_total * 100 if v["total"] < 0 else 0
        category_totals.append(CategoryTotal(
            category=k, total=round(v["total"], 2),
            count=v["count"], percentage=round(pct, 1),
        ))

    # Phase 3: Claude-powered insights (falls back to rules if no API key)
    insights = generate_llm_insights(
        category_totals={c.category: c.total for c in category_totals},
        total_income=total_income,
        total_expenses=total_expenses,
        net_cashflow=net_cashflow,
        period_label=period_label,
        transaction_count=len(txns),
    )

    return SummaryResponse(
        org_id=org_id, period_label=period_label,
        total_income=round(total_income, 2),
        total_expenses=round(total_expenses, 2),
        net_cashflow=round(net_cashflow, 2),
        transaction_count=len(txns),
        category_totals=category_totals,
        monthly_trend=_monthly_trend(txns),
        insights=insights,
    )


# ── GST summary ───────────────────────────────────────────────────────────────

@router.get("/gst-summary/{org_id}", response_model=GSTSummaryResponse)
def gst_summary(
    org_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(
        Transaction.org_id == org_id,
        Transaction.gst_amount != None,  # noqa
        Transaction.amount < 0,
    )
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    txns = q.all()

    period_label = "All time"
    if date_from and date_to:
        period_label = f"{date_from.strftime('%b %Y')} – {date_to.strftime('%b %Y')}"

    cat_map: dict[str, dict] = {}
    for t in txns:
        cat = t.category or "Uncategorised"
        if cat not in cat_map:
            cat_map[cat] = {"taxable": 0.0, "gst": 0.0}
        gst = t.gst_amount or 0
        cat_map[cat]["taxable"] += abs(t.amount) - gst
        cat_map[cat]["gst"]     += gst

    lines = [
        GSTLine(
            category=cat,
            taxable_amount=round(v["taxable"], 2),
            gst_amount=round(v["gst"], 2),
            cgst=round(v["gst"] / 2, 2),
            sgst=round(v["gst"] / 2, 2),
            igst=0.0,
        )
        for cat, v in cat_map.items()
    ]

    return GSTSummaryResponse(
        org_id=org_id, period_label=period_label,
        total_taxable=round(sum(l.taxable_amount for l in lines), 2),
        total_gst=round(sum(l.gst_amount for l in lines), 2),
        total_cgst=round(sum(l.cgst for l in lines), 2),
        total_sgst=round(sum(l.sgst for l in lines), 2),
        total_igst=0.0,
        lines=sorted(lines, key=lambda x: -x.gst_amount),
    )


# ── export CSV ────────────────────────────────────────────────────────────────

@router.get("/export/{org_id}")
def export_transactions(
    org_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)

    q = db.query(Transaction).filter(Transaction.org_id == org_id)
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    if category and category != "All":
        q = q.filter(Transaction.category == category)
    txns = q.order_by(Transaction.date.asc()).all()

    output = io.StringIO()
    writer = csv_mod.writer(output)
    writer.writerow(["Date", "Description", "Amount", "Currency", "Category", "GST Amount", "Reconciled"])
    for t in txns:
        writer.writerow([
            t.date or "", t.description or "", t.amount, t.currency,
            t.category or "", t.gst_amount or "", "Yes" if t.is_reconciled else "No",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=claritybooks_{org_id}.csv"},
    )


# ── reconcile ─────────────────────────────────────────────────────────────────

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
    summary = new.get("summary") or {}
    unmatched_src = len(summary.get("unmatched_source") or [])
    unmatched_bank = len(summary.get("unmatched_bank") or [])
    total_src = matched + unmatched_src
    return ReconcileResult(
        matched_pairs=matched,
        unmatched_source=unmatched_src,
        unmatched_bank=unmatched_bank,
        match_rate=round(matched / total_src * 100, 1) if total_src else 0,
        details=[],
    )


# ── batch list ────────────────────────────────────────────────────────────────

@router.get("/batches/{org_id}", response_model=List[UploadBatchOut])
def list_batches(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    check_org_membership(org_id, current_user, db)
    return db.query(UploadBatch).filter(
        UploadBatch.org_id == org_id
    ).order_by(UploadBatch.id.desc()).all()


@router.delete("/batches/{org_id}/{batch_id}", response_model=dict)
def delete_batch(
    org_id: int,
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = check_org_membership(org_id, current_user, db)
    if m.role not in UPLOAD_ROLES:
        raise HTTPException(status_code=403, detail="Viewers cannot delete uploaded files")

    batch = db.query(UploadBatch).filter(
        UploadBatch.id == batch_id,
        UploadBatch.org_id == org_id,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Upload batch not found")

    txn_ids = [
        row[0] for row in db.query(Transaction.id).filter(
            Transaction.batch_id == batch.id,
            Transaction.org_id == org_id,
        ).all()
    ]

    if txn_ids:
        db.query(Transaction).filter(
            Transaction.org_id == org_id,
            Transaction.reconciled_with.in_(txn_ids),
        ).update(
            {"is_reconciled": False, "reconciled_with": None},
            synchronize_session=False,
        )

    filename = batch.filename
    source = batch.source
    row_count = batch.row_count

    db.query(Transaction).filter(
        Transaction.batch_id == batch.id,
        Transaction.org_id == org_id,
    ).delete(synchronize_session=False)
    db.delete(batch)

    log_action(
        db,
        "upload.batch_delete",
        user_id=current_user.id,
        org_id=org_id,
        resource=f"batch:{filename}",
        detail={"batch_id": batch_id, "rows": row_count, "source": source},
    )
    db.commit()
    return {"ok": True, "deleted_batch_id": batch_id}


# ── categories list ───────────────────────────────────────────────────────────

@router.get("/categories", tags=["meta"])
def list_categories():
    return {"categories": ALL_CATEGORIES}
