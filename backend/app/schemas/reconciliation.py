from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel


class StartRunRequest(BaseModel):
    source_batch_id: int
    bank_batch_id:   int


class MatchOut(BaseModel):
    id:            int
    source_txn_id: int
    bank_txn_id:   int
    confidence:    Literal["high", "medium", "low"]
    pass_no:       int
    inferred_fee:  Optional[float]
    explanation:   Optional[str]
    status:        Literal["pending", "accepted", "rejected"]
    updated_at:    datetime

    class Config:
        from_attributes = True


class AnomalyOut(BaseModel):
    id:              int
    rule_id:         str
    severity:        Literal["low", "medium", "high"]
    transaction_ids: List[int]
    detail:          dict
    explanation:     Optional[str]
    status:          Literal["open", "accepted", "dismissed", "snoozed"]
    snoozed_until:   Optional[datetime]
    detected_at:     datetime
    updated_at:      datetime

    class Config:
        from_attributes = True


class RunSummaryOut(BaseModel):
    id:              int
    org_id:          int
    source_batch_id: int
    bank_batch_id:   int
    status:          Literal["running", "complete", "failed"]
    summary:         Optional[dict]
    created_at:      datetime
    completed_at:    Optional[datetime]

    class Config:
        from_attributes = True


class RunDetailOut(RunSummaryOut):
    matches:   List[MatchOut]
    anomalies: List[AnomalyOut]


class PatchMatchRequest(BaseModel):
    status: Literal["accepted", "rejected"]


class PatchAnomalyRequest(BaseModel):
    status:        Literal["accepted", "dismissed", "snoozed"]
    snoozed_until: Optional[datetime] = None
