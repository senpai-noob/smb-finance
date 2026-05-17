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
