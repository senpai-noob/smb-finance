"""add reconciliation tables and indexes

Revision ID: 9a043a6a8193
Revises: 284f8d2fb44b
Create Date: 2026-05-17 15:16:30.320480

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9a043a6a8193'
down_revision: Union[str, None] = '284f8d2fb44b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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
