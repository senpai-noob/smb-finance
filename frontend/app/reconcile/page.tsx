"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import OrgSelector, { Org } from "@/components/OrgSelector";
import { useToast } from "@/components/Toast";
import {
  RunDetail, RunSummary, MatchRow, AnomalyRow,
  startRun, listRuns, getRun, scanAnomalies,
  patchMatch, patchAnomaly,
} from "@/lib/reconcile";
import { apiFetch } from "@/lib/api";
import { LoadingState, EmptyState, ErrorState } from "@/components/reconcile/states";
import { InboxRow, InboxItem } from "@/components/reconcile/InboxRow";
import { DetailPane } from "@/components/reconcile/DetailPane";
import {
  Loader2, Play, Search, Inbox, CheckCircle2, XCircle, Sparkles, RefreshCw,
} from "lucide-react";

interface Batch { id: number; filename: string; source: string; row_count: number; }

type Segment = "triage" | "auto" | "accepted" | "dismissed";

const SEGMENTS: Array<{
  id: Segment; label: string; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}> = [
  { id: "triage",    label: "Triage",       icon: Inbox },
  { id: "auto",      label: "Auto-matched", icon: Sparkles },
  { id: "accepted",  label: "Accepted",     icon: CheckCircle2 },
  { id: "dismissed", label: "Dismissed",    icon: XCircle },
];

export default function ReconcilePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [org, setOrg]                     = useState<Org | null>(null);
  const [batches, setBatches]             = useState<Batch[]>([]);
  const [sourceBatchId, setSourceBatchId] = useState<number | null>(null);
  const [bankBatchId, setBankBatchId]     = useState<number | null>(null);

  const [runs, setRuns]             = useState<RunSummary[]>([]);
  const [currentRun, setCurrentRun] = useState<RunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [starting, setStarting]     = useState(false);

  const [segment, setSegment]       = useState<Segment>("triage");
  const [search, setSearch]         = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy]     = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("smb_token")) { router.push("/login"); return; }
  }, []);

  const loadBatches = useCallback(async (orgId: number) => {
    try {
      const bs = await apiFetch<Batch[]>(`/transactions/batches/${orgId}`);
      setBatches(bs);
      return bs;
    } catch {
      setBatches([]);
      return [];
    }
  }, []);

  const loadRuns = useCallback(async (orgId: number) => {
    try {
      const list = await listRuns(orgId);
      setRuns(list);
      return list;
    } catch {
      setRuns([]);
      return [];
    }
  }, []);

  // Initial load when org changes
  useEffect(() => {
    if (!org) return;
    setSourceBatchId(null);
    setBankBatchId(null);
    setCurrentRun(null);
    setError(null);
    Promise.all([loadBatches(org.id), loadRuns(org.id)]);
  }, [org]);

  // KEY FIX: when source+bank selection changes, find the matching run automatically.
  // This means switching dropdowns instantly shows the right reconciliation result
  // instead of always showing the latest run.
  useEffect(() => {
    if (!org || !sourceBatchId || !bankBatchId) {
      setCurrentRun(null);
      return;
    }
    // Find the most recent run for this exact batch pair
    const matchingRun = runs.find(
      r => r.source_batch_id === sourceBatchId && r.bank_batch_id === bankBatchId
    );
    if (!matchingRun) {
      setCurrentRun(null);
      return;
    }
    setRunLoading(true);
    getRun(org.id, matchingRun.id)
      .then(detail => { setCurrentRun(detail); setSegment("triage"); setSelectedId(null); })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load run"))
      .finally(() => setRunLoading(false));
  }, [sourceBatchId, bankBatchId, runs, org]);

  async function handleStart() {
    if (!org || !sourceBatchId || !bankBatchId) return;
    setStarting(true);
    try {
      const detail = await startRun(org.id, sourceBatchId, bankBatchId);
      const list   = await loadRuns(org.id);
      setCurrentRun(detail);
      setSegment("triage");
      setSelectedId(null);
      toast(`Reconciliation complete — ${detail.matches.length} match${detail.matches.length !== 1 ? "es" : ""} · ${detail.anomalies.length} anomal${detail.anomalies.length !== 1 ? "ies" : "y"}`, "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Reconciliation failed", "error");
    } finally {
      setStarting(false);
    }
  }

  async function handleScan() {
    if (!org) return;
    try {
      const r = await scanAnomalies(org.id);
      toast(`Scanned — ${r.new_anomalies} new anomalies found`, "success");
      if (sourceBatchId && bankBatchId) {
        // Reload current run to get fresh anomalies
        const matchingRun = runs.find(r => r.source_batch_id === sourceBatchId && r.bank_batch_id === bankBatchId);
        if (matchingRun) {
          const detail = await getRun(org.id, matchingRun.id);
          setCurrentRun(detail);
        }
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Scan failed", "error");
    }
  }

  // ── Normalise matches + anomalies into a single inbox list ─────────────────
  const allItems: InboxItem[] = useMemo(() => {
    if (!currentRun) return [];
    return [
      ...currentRun.matches.map<InboxItem>(m => ({ kind: "match", data: m })),
      ...currentRun.anomalies.map<InboxItem>(a => ({ kind: "anomaly", data: a })),
    ];
  }, [currentRun]);

  function inSegment(item: InboxItem, seg: Segment): boolean {
    if (seg === "triage") {
      if (item.kind === "anomaly") return item.data.status === "open";
      return item.data.status === "pending" && item.data.confidence !== "high";
    }
    if (seg === "auto") {
      if (item.kind === "anomaly") return false;
      return item.data.status === "pending" && item.data.confidence === "high";
    }
    if (seg === "accepted") return item.data.status === "accepted";
    if (seg === "dismissed") {
      return item.kind === "anomaly"
        ? item.data.status === "dismissed" || item.data.status === "snoozed"
        : item.data.status === "rejected";
    }
    return false;
  }

  const counts = useMemo(() => {
    const c: Record<Segment, number> = { triage: 0, auto: 0, accepted: 0, dismissed: 0 };
    for (const it of allItems) for (const s of SEGMENTS) if (inSegment(it, s.id)) c[s.id]++;
    return c;
  }, [allItems]);

  function matchesSearch(item: InboxItem, q: string): boolean {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (item.kind === "anomaly") {
      return [item.data.rule_id, item.data.explanation, JSON.stringify(item.data.detail)]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    }
    return (item.data.explanation ?? "").toLowerCase().includes(needle);
  }

  function priority(item: InboxItem): number {
    if (item.kind === "anomaly") {
      return item.data.severity === "high" ? 100 : item.data.severity === "medium" ? 60 : 30;
    }
    return item.data.confidence === "high" ? 5 : item.data.confidence === "medium" ? 40 : 50;
  }

  const visibleItems = useMemo(() => {
    return allItems
      .filter(it => inSegment(it, segment))
      .filter(it => matchesSearch(it, search))
      .sort((a, b) => {
        const p = priority(b) - priority(a);
        if (p !== 0) return p;
        const da = a.kind === "anomaly" ? a.data.detected_at : a.data.updated_at;
        const db_ = b.kind === "anomaly" ? b.data.detected_at : b.data.updated_at;
        return new Date(db_).getTime() - new Date(da).getTime();
      });
  }, [allItems, segment, search]);

  const idOf = (it: InboxItem) => `${it.kind}-${it.data.id}`;
  const selectedItem = useMemo(
    () => allItems.find(it => idOf(it) === selectedId) ?? null,
    [allItems, selectedId],
  );

  function updateInState(updated: MatchRow | AnomalyRow) {
    setCurrentRun(r => {
      if (!r) return r;
      if ("rule_id" in updated) {
        return { ...r, anomalies: r.anomalies.map(a => a.id === updated.id ? updated : a) };
      }
      return { ...r, matches: r.matches.map(m => m.id === updated.id ? updated : m) };
    });
  }

  function toggleCheck(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function checkAllVisible() {
    setCheckedIds(prev => {
      const next = new Set(prev);
      visibleItems.forEach(it => next.add(idOf(it)));
      return next;
    });
  }

  function clearChecks() { setCheckedIds(new Set()); }

  async function bulk(action: "accept" | "dismiss") {
    if (checkedIds.size === 0) return;
    setBulkBusy(true);
    const targets = visibleItems.filter(it => checkedIds.has(idOf(it)));
    const ops = targets.map(it => {
      if (it.kind === "match") return patchMatch(it.data.id, action === "accept" ? "accepted" : "rejected");
      return patchAnomaly(it.data.id, action === "accept" ? "accepted" : "dismissed");
    });
    try {
      const updates = await Promise.allSettled(ops);
      const ok = updates.filter(u => u.status === "fulfilled").length;
      const fail = updates.length - ok;
      updates.forEach(u => { if (u.status === "fulfilled") updateInState(u.value); });
      clearChecks();
      toast(`${ok} ${action}ed${fail ? ` · ${fail} failed` : ""}`, fail ? "error" : "success");
    } finally { setBulkBusy(false); }
  }

  // ── Determine if the current batch pair has an existing run ────────────────
  const hasRunForSelection = useMemo(() => {
    if (!sourceBatchId || !bankBatchId) return false;
    return runs.some(r => r.source_batch_id === sourceBatchId && r.bank_batch_id === bankBatchId);
  }, [sourceBatchId, bankBatchId, runs]);

  const canRun = !!sourceBatchId && !!bankBatchId && !starting;

  const sourceBatches = batches.filter(b => b.source !== "bank");
  const bankBatches   = batches.filter(b => b.source === "bank");

  if (!org) {
    return (
      <div style={pageStyle}>
        <FontImport />
        <Nav />
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "36px 24px" }}>
          <Header onSelectOrg={setOrg} org={null} />
          <EmptyState title="Pick an organisation" subtitle="Select one above to view reconciliations." />
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <FontImport />
      <Nav />

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "28px 24px 60px" }}>
        <Header onSelectOrg={setOrg} org={org} />

        {/* Run-start form */}
        <div style={{
          padding: "12px 14px", borderRadius: 12,
          border: "1px solid rgba(30,41,59,0.6)",
          background: "rgba(15,23,42,0.4)",
          display: "flex", alignItems: "center", gap: 10,
          flexWrap: "wrap", marginBottom: 22,
        }}>
          {/* Source batch selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#475569" }}>Shopify / Source</span>
            <select
              value={sourceBatchId ?? ""}
              onChange={e => { setSourceBatchId(Number(e.target.value) || null); clearChecks(); }}
              style={selectStyle}
            >
              <option value="">Select Shopify batch…</option>
              {sourceBatches.map(b => (
                <option key={b.id} value={b.id}>{b.filename} ({b.row_count} rows)</option>
              ))}
            </select>
          </div>

          {/* Bank batch selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#475569" }}>Bank Statement</span>
            <select
              value={bankBatchId ?? ""}
              onChange={e => { setBankBatchId(Number(e.target.value) || null); clearChecks(); }}
              style={selectStyle}
            >
              <option value="">Select bank batch…</option>
              {bankBatches.map(b => (
                <option key={b.id} value={b.id}>{b.filename} ({b.row_count} rows)</option>
              ))}
            </select>
          </div>

          {/* Run button */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "transparent" }}>Run</span>
            <button onClick={handleStart} disabled={!canRun} style={primaryBtn(starting || !canRun)}>
              {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {hasRunForSelection ? "Re-run reconciliation" : "Run reconciliation"}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "transparent" }}>.</span>
            <button onClick={handleScan} style={ghostBtn}>
              <RefreshCw size={12} />
              Rescan anomalies
            </button>
          </div>

          {/* Run count badge */}
          {sourceBatchId && bankBatchId && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              {hasRunForSelection ? (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  letterSpacing: "0.14em", textTransform: "uppercase", color: "#475569",
                }}>
                  {runs.filter(r => r.source_batch_id === sourceBatchId && r.bank_batch_id === bankBatchId).length} run(s) for this pair · latest #{
                    runs.find(r => r.source_batch_id === sourceBatchId && r.bank_batch_id === bankBatchId)?.id
                  }
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "#475569" }}>No run yet for this pair</span>
              )}
            </div>
          )}
        </div>

        {runLoading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={() => org && loadRuns(org.id)} />}

        {!runLoading && !error && !currentRun && (
          <EmptyState
            title={
              !sourceBatchId || !bankBatchId
                ? "Select both batches above"
                : "No reconciliation for this pair yet"
            }
            subtitle={
              !sourceBatchId || !bankBatchId
                ? "Choose a Shopify source batch and a bank batch, then click Run."
                : "Click 'Run reconciliation' to match transactions and detect anomalies."
            }
          />
        )}

        {!runLoading && !error && currentRun && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "172px 1fr auto",
            border: "1px solid rgba(30,41,59,0.55)",
            borderRadius: 14,
            background: "rgba(10,14,26,0.7)",
            overflow: "hidden",
            minHeight: 580,
          }}>
            <SegmentRail
              segment={segment}
              onSelect={s => { setSegment(s); clearChecks(); setSelectedId(null); }}
              counts={counts}
            />

            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <Banner segment={segment} count={visibleItems.length} totalTriage={counts.triage} />
              <Toolbar
                search={search}
                onSearch={setSearch}
                selectedCount={checkedIds.size}
                visibleCount={visibleItems.length}
                onCheckAll={checkAllVisible}
                onClear={clearChecks}
                onBulkAccept={() => bulk("accept")}
                onBulkDismiss={() => bulk("dismiss")}
                bulkBusy={bulkBusy}
              />
              <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 340px)", minHeight: 280 }}>
                {visibleItems.length === 0
                  ? <div style={{ padding: 60 }}><EmptyState title={emptyTitleFor(segment)} /></div>
                  : visibleItems.map((it, i) => (
                      <InboxRow
                        key={idOf(it) + "-" + i}
                        item={it}
                        selected={idOf(it) === selectedId}
                        checked={checkedIds.has(idOf(it))}
                        onClick={() => setSelectedId(idOf(it))}
                        onToggleCheck={() => toggleCheck(idOf(it))}
                      />
                    ))}
              </div>
            </div>

            <DetailPane
              item={selectedItem}
              onClose={() => setSelectedId(null)}
              onChange={updateInState}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── sub-components ───────── */

function Header({ org, onSelectOrg }: { org: Org | null; onSelectOrg: (o: Org | null) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
      <div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 38, margin: "0 0 6px", lineHeight: 1, color: "#f8fafc" }}>
          Reconcile <em style={{ color: "#475569" }}>triage</em>
        </h1>
        <p style={{ fontSize: 13, color: "#475569" }}>
          Match Shopify payouts to bank credits, review anomalies, take action.
        </p>
      </div>
      <OrgSelector selected={org} onSelect={onSelectOrg} />
    </div>
  );
}

function Banner({ segment, count, totalTriage }: { segment: Segment; count: number; totalTriage: number }) {
  const headline =
    segment === "triage"   ? `${totalTriage} ${totalTriage === 1 ? "item wants" : "items want"} your attention`
  : segment === "auto"     ? `${count} ${count === 1 ? "match was" : "matches were"} auto-matched with high confidence`
  : segment === "accepted" ? `${count} ${count === 1 ? "item" : "items"} accepted`
  :                          `${count} ${count === 1 ? "item" : "items"} dismissed`;

  return (
    <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid rgba(30,41,59,0.5)" }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#52525b", marginBottom: 6 }}>
        {segment}
      </div>
      <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 24, fontStyle: "italic", color: "#e2e8f0", lineHeight: 1.2 }}>
        {headline}
      </div>
    </div>
  );
}

function SegmentRail({ segment, onSelect, counts }: { segment: Segment; onSelect: (s: Segment) => void; counts: Record<Segment, number> }) {
  return (
    <nav style={{ borderRight: "1px solid rgba(30,41,59,0.55)", padding: "20px 0", display: "flex", flexDirection: "column", gap: 4, background: "rgba(15,23,42,0.4)" }}>
      {SEGMENTS.map(({ id, label, icon: Icon }) => {
        const active = segment === id;
        return (
          <button key={id} onClick={() => onSelect(id)} style={{
            position: "relative", display: "flex", alignItems: "center", gap: 10,
            padding: "9px 18px 9px 22px", border: "none", background: "transparent",
            color: active ? "#f1f5f9" : "#64748b",
            fontFamily: "'Manrope', system-ui, sans-serif", fontSize: 13, fontWeight: active ? 600 : 500,
            cursor: "pointer", textAlign: "left", transition: "color 120ms",
          }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = "#cbd5e1"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = "#64748b"; }}
          >
            {active && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2, background: "#34d399", borderRadius: "0 2px 2px 0" }} />}
            <Icon size={13} style={{ color: active ? "#34d399" : "#475569" }} />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: active ? "#34d399" : "#475569", fontVariantNumeric: "tabular-nums" }}>
              {counts[id]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Toolbar({ search, onSearch, selectedCount, visibleCount, onCheckAll, onClear, onBulkAccept, onBulkDismiss, bulkBusy }: {
  search: string; onSearch: (s: string) => void;
  selectedCount: number; visibleCount: number;
  onCheckAll: () => void; onClear: () => void;
  onBulkAccept: () => void; onBulkDismiss: () => void; bulkBusy: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid rgba(30,41,59,0.45)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 360, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(30,41,59,0.6)", background: "rgba(15,23,42,0.6)" }}>
        <Search size={13} style={{ color: "#475569" }} />
        <input
          value={search} onChange={e => onSearch(e.target.value)}
          placeholder="Search vendor, explanation, evidence…"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "#e2e8f0", fontSize: 12.5, fontFamily: "'Manrope', system-ui, sans-serif" }}
        />
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {selectedCount > 0 ? (
          <>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#34d399", marginRight: 4 }}>
              {selectedCount} selected
            </span>
            <button onClick={onBulkAccept} disabled={bulkBusy} style={smallBtn("emerald")}>
              {bulkBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Accept
            </button>
            <button onClick={onBulkDismiss} disabled={bulkBusy} style={smallBtn("rose")}>
              {bulkBusy ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />} Dismiss
            </button>
            <button onClick={onClear} style={smallBtn("slate")}>Clear</button>
          </>
        ) : (
          <button onClick={onCheckAll} style={smallBtn("slate")}>Select all ({visibleCount})</button>
        )}
      </div>
    </div>
  );
}

/* ── styles ── */
const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#0a0e1a", color: "#f8fafc", fontFamily: "'Manrope', system-ui, sans-serif" };

function FontImport() {
  return <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>;
}

const selectStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 7,
  border: "1px solid rgba(30,41,59,0.8)",
  background: "rgba(15,23,42,0.7)", color: "#e2e8f0",
  fontSize: 12.5, fontFamily: "inherit", minWidth: 220,
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "7px 13px", borderRadius: 7, border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? "rgba(30,41,59,0.6)" : "#34d399",
  color: disabled ? "#475569" : "#0f172a",
  fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
  opacity: disabled ? 0.6 : 1, transition: "all 150ms",
});

const ghostBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "7px 13px", borderRadius: 7,
  border: "1px solid rgba(30,41,59,0.8)", background: "transparent",
  color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

function smallBtn(tone: "emerald" | "rose" | "slate"): React.CSSProperties {
  const colors = {
    emerald: { border: "rgba(52,211,153,0.4)",  text: "#6ee7b7" },
    rose:    { border: "rgba(251,113,133,0.4)", text: "#fda4af" },
    slate:   { border: "rgba(148,163,184,0.3)", text: "#cbd5e1" },
  }[tone];
  return {
    display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${colors.border}`, background: "transparent",
    color: colors.text, fontSize: 11.5, cursor: "pointer", fontFamily: "'Manrope', system-ui, sans-serif",
  };
}

function emptyTitleFor(segment: Segment): string {
  return segment === "triage"   ? "Nothing needs your attention"
       : segment === "auto"     ? "No auto-matched items"
       : segment === "accepted" ? "Nothing accepted yet"
       :                          "Nothing dismissed yet";
}  const [org, setOrg]                 = useState<Org | null>(null);
  const [batches, setBatches]         = useState<Batch[]>([]);
  const [sourceBatchId, setSourceBatchId] = useState<number | null>(null);
  const [bankBatchId, setBankBatchId] = useState<number | null>(null);

  const [runs, setRuns]               = useState<RunSummary[]>([]);
  const [currentRun, setCurrentRun]   = useState<RunDetail | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [starting, setStarting]       = useState(false);

  // UI state
  const [segment, setSegment]         = useState<Segment>("triage");
  const [search, setSearch]           = useState("");
  const [selectedId, setSelectedId]   = useState<string | null>(null);   // "match-12" or "anomaly-7"
  const [checkedIds, setCheckedIds]   = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy]       = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("smb_token")) { router.push("/login"); return; }
  }, []);

  useEffect(() => {
    if (!org) return;
    apiFetch<Batch[]>(`/transactions/batches/${org.id}`).then(setBatches).catch(() => setBatches([]));
    refreshRuns(org.id);
  }, [org]);

  async function refreshRuns(orgId: number) {
    try {
      const list = await listRuns(orgId);
      setRuns(list);
      if (list.length > 0) {
        const detail = await getRun(orgId, list[0].id);
        setCurrentRun(detail);
      } else {
        setCurrentRun(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    }
  }

  async function handleStart() {
    if (!org || !sourceBatchId || !bankBatchId) return;
    setStarting(true);
    try {
      const detail = await startRun(org.id, sourceBatchId, bankBatchId);
      setCurrentRun(detail);
      const list = await listRuns(org.id);
      setRuns(list);
      toast("Reconciliation complete", "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Reconciliation failed", "error");
    } finally {
      setStarting(false);
    }
  }

  async function handleScan() {
    if (!org) return;
    try {
      const r = await scanAnomalies(org.id);
      toast(`Scanned ${r.scanned} — ${r.new_anomalies} new anomalies`, "success");
      await refreshRuns(org.id);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Scan failed", "error");
    }
  }

  // ── Normalise matches + anomalies into a single inbox list ─────────────────
  const allItems: InboxItem[] = useMemo(() => {
    if (!currentRun) return [];
    return [
      ...currentRun.matches.map<InboxItem>(m => ({ kind: "match", data: m })),
      ...currentRun.anomalies.map<InboxItem>(a => ({ kind: "anomaly", data: a })),
    ];
  }, [currentRun]);

  // ── Per-segment filter ─────────────────────────────────────────────────────
  function inSegment(item: InboxItem, seg: Segment): boolean {
    if (seg === "triage") {
      if (item.kind === "anomaly") return item.data.status === "open";
      return item.data.status === "pending" && item.data.confidence !== "high";
    }
    if (seg === "auto") {
      if (item.kind === "anomaly") return false;
      return item.data.status === "pending" && item.data.confidence === "high";
    }
    if (seg === "accepted") return item.data.status === "accepted";
    if (seg === "dismissed") {
      return item.kind === "anomaly"
        ? item.data.status === "dismissed" || item.data.status === "snoozed"
        : item.data.status === "rejected";
    }
    return false;
  }

  const counts = useMemo(() => {
    const c: Record<Segment, number> = { triage: 0, auto: 0, accepted: 0, dismissed: 0 };
    for (const it of allItems) {
      for (const s of SEGMENTS) if (inSegment(it, s.id)) c[s.id]++;
    }
    return c;
  }, [allItems]);

  // ── Search filter ─────────────────────────────────────────────────────────
  function matchesSearch(item: InboxItem, q: string): boolean {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (item.kind === "anomaly") {
      const a = item.data;
      return [a.rule_id, a.explanation, JSON.stringify(a.detail)]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    }
    return (item.data.explanation ?? "").toLowerCase().includes(needle);
  }

  // ── Sort: anomalies > low-conf matches > high-conf matches, then date desc ─
  function priority(item: InboxItem): number {
    if (item.kind === "anomaly") {
      return item.data.severity === "high"   ? 100
           : item.data.severity === "medium" ? 60
           :                                   30;
    }
    return item.data.confidence === "high"   ? 5
         : item.data.confidence === "medium" ? 40
         :                                     50;
  }

  const visibleItems = useMemo(() => {
    return allItems
      .filter(it => inSegment(it, segment))
      .filter(it => matchesSearch(it, search))
      .sort((a, b) => {
        const p = priority(b) - priority(a);
        if (p !== 0) return p;
        const da = a.kind === "anomaly" ? a.data.detected_at : a.data.updated_at;
        const db = b.kind === "anomaly" ? b.data.detected_at : b.data.updated_at;
        return new Date(db).getTime() - new Date(da).getTime();
      });
  }, [allItems, segment, search]);

  const idOf = (it: InboxItem) => `${it.kind}-${it.data.id}`;
  const selectedItem = useMemo(
    () => allItems.find(it => idOf(it) === selectedId) ?? null,
    [allItems, selectedId],
  );

  function updateInState(updated: MatchRow | AnomalyRow) {
    setCurrentRun(r => {
      if (!r) return r;
      if ("rule_id" in updated) {
        return { ...r, anomalies: r.anomalies.map(a => a.id === updated.id ? updated : a) };
      }
      return { ...r, matches: r.matches.map(m => m.id === updated.id ? updated : m) };
    });
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  function toggleCheck(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function checkAllVisible() {
    setCheckedIds(prev => {
      const next = new Set(prev);
      visibleItems.forEach(it => next.add(idOf(it)));
      return next;
    });
  }

  function clearChecks() { setCheckedIds(new Set()); }

  // ── Bulk operations ───────────────────────────────────────────────────────
  async function bulk(action: "accept" | "dismiss") {
    if (checkedIds.size === 0) return;
    setBulkBusy(true);
    const targets = visibleItems.filter(it => checkedIds.has(idOf(it)));
    const ops = targets.map(it => {
      if (it.kind === "match") {
        return patchMatch(it.data.id, action === "accept" ? "accepted" : "rejected");
      }
      return patchAnomaly(it.data.id, action === "accept" ? "accepted" : "dismissed");
    });
    try {
      const updates = await Promise.allSettled(ops);
      const ok = updates.filter(u => u.status === "fulfilled").length;
      const fail = updates.length - ok;
      updates.forEach(u => { if (u.status === "fulfilled") updateInState(u.value); });
      clearChecks();
      toast(`${ok} ${action}ed${fail ? ` · ${fail} failed` : ""}`, fail ? "error" : "success");
    } finally {
      setBulkBusy(false);
    }
  }

  if (!org) {
    return (
      <div style={pageStyle}>
        <FontImport />
        <Nav />
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "36px 24px" }}>
          <Header onSelectOrg={setOrg} org={null} />
          <EmptyState title="Pick an organisation" subtitle="Select one above to view reconciliations." />
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <FontImport />
      <Nav />

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "28px 24px 60px" }}>
        <Header onSelectOrg={setOrg} org={org} />

        {/* Run-start form */}
        <div style={{
          padding: 14, borderRadius: 12,
          border: "1px solid rgba(30,41,59,0.6)",
          background: "rgba(15,23,42,0.4)",
          display: "flex", alignItems: "center", gap: 10,
          flexWrap: "wrap", marginBottom: 22,
        }}>
          <select value={sourceBatchId ?? ""} onChange={e => setSourceBatchId(Number(e.target.value) || null)} style={selectStyle}>
            <option value="">Source batch (Shopify…)</option>
            {batches.filter(b => b.source !== "bank").map(b => (
              <option key={b.id} value={b.id}>{b.filename} ({b.row_count} rows)</option>
            ))}
          </select>
          <select value={bankBatchId ?? ""} onChange={e => setBankBatchId(Number(e.target.value) || null)} style={selectStyle}>
            <option value="">Bank batch</option>
            {batches.filter(b => b.source === "bank").map(b => (
              <option key={b.id} value={b.id}>{b.filename} ({b.row_count} rows)</option>
            ))}
          </select>
          <button onClick={handleStart} disabled={!sourceBatchId || !bankBatchId || starting} style={primaryBtn(starting)}>
            {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run reconciliation
          </button>
          <button onClick={handleScan} style={ghostBtn}>Rescan anomalies</button>
          {runs.length > 0 && (
            <span style={{
              marginLeft: "auto",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              letterSpacing: "0.14em", textTransform: "uppercase", color: "#475569",
            }}>
              {runs.length} run{runs.length !== 1 ? "s" : ""} · latest #{runs[0]?.id}
            </span>
          )}
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={() => org && refreshRuns(org.id)} />}

        {!loading && !error && !currentRun && (
          <EmptyState title="No reconciliations yet" subtitle="Start one above to begin." />
        )}

        {!loading && !error && currentRun && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "172px 1fr auto",
            border: "1px solid rgba(30,41,59,0.55)",
            borderRadius: 14,
            background: "rgba(10,14,26,0.7)",
            overflow: "hidden",
            minHeight: 580,
          }}>
            <SegmentRail
              segment={segment}
              onSelect={s => { setSegment(s); clearChecks(); setSelectedId(null); }}
              counts={counts}
            />

            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <Banner segment={segment} count={visibleItems.length} totalTriage={counts.triage} />
              <Toolbar
                search={search}
                onSearch={setSearch}
                selectedCount={checkedIds.size}
                visibleCount={visibleItems.length}
                onCheckAll={checkAllVisible}
                onClear={clearChecks}
                onBulkAccept={() => bulk("accept")}
                onBulkDismiss={() => bulk("dismiss")}
                bulkBusy={bulkBusy}
              />
              <div style={{ overflowY: "auto", maxHeight: "70vh" }}>
                {visibleItems.length === 0
                  ? <div style={{ padding: 60 }}><EmptyState title={emptyTitleFor(segment)} /></div>
                  : visibleItems.map((it, i) => (
                      <InboxRow
                        key={idOf(it) + "-" + i}
                        item={it}
                        selected={idOf(it) === selectedId}
                        checked={checkedIds.has(idOf(it))}
                        onClick={() => setSelectedId(idOf(it))}
                        onToggleCheck={() => toggleCheck(idOf(it))}
                      />
                    ))}
              </div>
            </div>

            <DetailPane
              item={selectedItem}
              onClose={() => setSelectedId(null)}
              onChange={updateInState}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── sub-components ───────── */

function Header({ org, onSelectOrg }: { org: Org | null; onSelectOrg: (o: Org | null) => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      flexWrap: "wrap", gap: 16, marginBottom: 22,
    }}>
      <div>
        <h1 style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 38, margin: "0 0 6px", lineHeight: 1, color: "#f8fafc",
        }}>
          Reconcile <em style={{ color: "#475569" }}>triage</em>
        </h1>
        <p style={{ fontSize: 13, color: "#475569" }}>
          Match Shopify payouts to bank credits, review anomalies, take action.
        </p>
      </div>
      <OrgSelector selected={org} onSelect={onSelectOrg} />
    </div>
  );
}

function Banner({ segment, count, totalTriage }: { segment: Segment; count: number; totalTriage: number }) {
  const headline =
    segment === "triage"    ? `${totalTriage} ${totalTriage === 1 ? "item wants" : "items want"} your attention`
  : segment === "auto"      ? `${count} ${count === 1 ? "match was" : "matches were"} auto-matched with high confidence`
  : segment === "accepted"  ? `${count} ${count === 1 ? "item" : "items"} accepted`
  :                           `${count} ${count === 1 ? "item" : "items"} dismissed`;

  return (
    <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid rgba(30,41,59,0.5)" }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
        color: "#52525b", marginBottom: 6,
      }}>
        {segment}
      </div>
      <div style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontSize: 24, fontStyle: "italic", color: "#e2e8f0",
        lineHeight: 1.2,
      }}>
        {headline}
      </div>
    </div>
  );
}

function SegmentRail({
  segment, onSelect, counts,
}: {
  segment: Segment;
  onSelect: (s: Segment) => void;
  counts: Record<Segment, number>;
}) {
  return (
    <nav style={{
      borderRight: "1px solid rgba(30,41,59,0.55)",
      padding: "20px 0",
      display: "flex", flexDirection: "column", gap: 4,
      background: "rgba(15,23,42,0.4)",
    }}>
      {SEGMENTS.map(({ id, label, icon: Icon }) => {
        const active = segment === id;
        return (
          <button key={id} onClick={() => onSelect(id)} style={{
            position: "relative",
            display: "flex", alignItems: "center", gap: 10,
            padding: "9px 18px 9px 22px",
            border: "none", background: "transparent",
            color: active ? "#f1f5f9" : "#64748b",
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: 13, fontWeight: active ? 600 : 500,
            cursor: "pointer", textAlign: "left",
            transition: "color 120ms",
          }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = "#cbd5e1"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = "#64748b"; }}
          >
            {active && (
              <span style={{
                position: "absolute", left: 0, top: 8, bottom: 8, width: 2,
                background: "#34d399", borderRadius: "0 2px 2px 0",
              }} />
            )}
            <Icon size={13} style={{ color: active ? "#34d399" : "#475569" }} />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: active ? "#34d399" : "#475569",
              fontVariantNumeric: "tabular-nums",
            }}>
              {counts[id]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Toolbar({
  search, onSearch,
  selectedCount, visibleCount,
  onCheckAll, onClear,
  onBulkAccept, onBulkDismiss, bulkBusy,
}: {
  search: string;
  onSearch: (s: string) => void;
  selectedCount: number;
  visibleCount: number;
  onCheckAll: () => void;
  onClear: () => void;
  onBulkAccept: () => void;
  onBulkDismiss: () => void;
  bulkBusy: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 18px",
      borderBottom: "1px solid rgba(30,41,59,0.45)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 360,
        padding: "6px 10px", borderRadius: 8,
        border: "1px solid rgba(30,41,59,0.6)",
        background: "rgba(15,23,42,0.6)",
      }}>
        <Search size={13} style={{ color: "#475569" }} />
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search vendor, explanation, evidence…"
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            color: "#e2e8f0", fontSize: 12.5,
            fontFamily: "'Manrope', system-ui, sans-serif",
          }}
        />
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {selectedCount > 0 ? (
          <>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "#34d399", marginRight: 4,
            }}>
              {selectedCount} selected
            </span>
            <button onClick={onBulkAccept} disabled={bulkBusy} style={smallBtn("emerald")}>
              {bulkBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Accept
            </button>
            <button onClick={onBulkDismiss} disabled={bulkBusy} style={smallBtn("rose")}>
              {bulkBusy ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
              Dismiss
            </button>
            <button onClick={onClear} style={smallBtn("slate")}>Clear</button>
          </>
        ) : (
          <button onClick={onCheckAll} style={smallBtn("slate")}>
            Select all ({visibleCount})
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────── styles & helpers ───────── */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0e1a",
  color: "#f8fafc",
  fontFamily: "'Manrope', system-ui, sans-serif",
};

function FontImport() {
  return (
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 7,
  border: "1px solid rgba(30,41,59,0.8)",
  background: "rgba(15,23,42,0.7)", color: "#e2e8f0",
  fontSize: 12.5, fontFamily: "inherit", minWidth: 220,
};

const primaryBtn = (busy: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "7px 13px", borderRadius: 7, border: "none",
  cursor: busy ? "wait" : "pointer",
  background: "#34d399", color: "#0f172a",
  fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
  opacity: busy ? 0.6 : 1,
});

const ghostBtn: React.CSSProperties = {
  padding: "7px 13px", borderRadius: 7,
  border: "1px solid rgba(30,41,59,0.8)", background: "transparent",
  color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

function smallBtn(tone: "emerald" | "rose" | "slate"): React.CSSProperties {
  const colors = {
    emerald: { border: "rgba(52,211,153,0.4)",  text: "#6ee7b7" },
    rose:    { border: "rgba(251,113,133,0.4)", text: "#fda4af" },
    slate:   { border: "rgba(148,163,184,0.3)", text: "#cbd5e1" },
  }[tone];
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${colors.border}`, background: "transparent",
    color: colors.text, fontSize: 11.5, cursor: "pointer",
    fontFamily: "'Manrope', system-ui, sans-serif",
  };
}

function emptyTitleFor(segment: Segment): string {
  return segment === "triage"    ? "Nothing needs your attention"
       : segment === "auto"      ? "No auto-matched items"
       : segment === "accepted"  ? "Nothing accepted yet"
       :                            "Nothing dismissed yet";
}
