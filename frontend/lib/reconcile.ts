import { apiFetch } from "./api";

export type Confidence = "high" | "medium" | "low";
export type MatchStatus = "pending" | "accepted" | "rejected";
export type AnomalyStatus = "open" | "accepted" | "dismissed" | "snoozed";
export type Severity = "low" | "medium" | "high";
export type RunStatus = "running" | "complete" | "failed";

export interface RunSummary {
  id: number;
  org_id: number;
  source_batch_id: number;
  bank_batch_id: number;
  status: RunStatus;
  summary: {
    matches_by_pass?: Record<string, number>;
    unmatched_source?: number[];
    unmatched_bank?: number[];
    error?: string;
  } | null;
  created_at: string;
  completed_at: string | null;
}

export interface MatchRow {
  id: number;
  source_txn_id: number;
  bank_txn_id: number;
  confidence: Confidence;
  pass_no: number;
  inferred_fee: number | null;
  explanation: string | null;
  status: MatchStatus;
  updated_at: string;
}

export interface AnomalyRow {
  id: number;
  rule_id: string;
  severity: Severity;
  transaction_ids: number[];
  detail: Record<string, unknown>;
  explanation: string | null;
  status: AnomalyStatus;
  snoozed_until: string | null;
  detected_at: string;
  updated_at: string;
}

export interface RunDetail extends RunSummary {
  matches: MatchRow[];
  anomalies: AnomalyRow[];
}

export function startRun(orgId: number, sourceBatchId: number, bankBatchId: number) {
  return apiFetch<RunDetail>(`/reconcile/runs/${orgId}`, {
    method: "POST",
    body: JSON.stringify({ source_batch_id: sourceBatchId, bank_batch_id: bankBatchId }),
  });
}

export function listRuns(orgId: number) {
  return apiFetch<RunSummary[]>(`/reconcile/runs/${orgId}`);
}

export function getRun(orgId: number, runId: number) {
  return apiFetch<RunDetail>(`/reconcile/runs/${orgId}/${runId}`);
}

export function patchMatch(matchId: number, status: "accepted" | "rejected") {
  return apiFetch<MatchRow>(`/reconcile/matches/${matchId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function patchAnomaly(
  anomalyId: number,
  status: "accepted" | "dismissed" | "snoozed",
  snoozedUntil?: string,
) {
  return apiFetch<AnomalyRow>(`/reconcile/anomalies/${anomalyId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, snoozed_until: snoozedUntil ?? null }),
  });
}

export function scanAnomalies(orgId: number) {
  return apiFetch<{ new_anomalies: number; scanned: number }>(
    `/reconcile/anomalies/${orgId}/scan`,
    { method: "POST" },
  );
}
