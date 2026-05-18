"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, apiUpload } from "@/lib/api";
import Nav from "@/components/Nav";
import OrgSelector, { Org } from "@/components/OrgSelector";
import { SourceBadge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import {
  Upload, CheckCircle2, Loader2, FileText, ArrowRight,
  Clock, Hash, Trash2, Sparkles, AlertTriangle, ChevronRight,
  ShoppingBag, Building2, FolderOpen, X,
} from "lucide-react";

interface Batch { id: number; filename: string; source: string; row_count: number; }

interface UploadJob {
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  result?: Batch;
  error?: string;
}

const SOURCES = [
  { value: "shopify", label: "Shopify Sales / Payouts", hint: "Shopify Admin → Orders or Finances → Payouts", color: "#34d399", icon: ShoppingBag, example: "Order_ID, Date, Subtotal, Total_Amount, GST_Rate …" },
  { value: "bank",    label: "Bank Statement",           hint: "Download CSV from your net-banking portal",    color: "#60a5fa", icon: Building2,   example: "Date, Narration, Debit, Credit, Balance …" },
  { value: "manual",  label: "Manual / Other",           hint: "Any CSV that has an amount or total column",   color: "#a78bfa", icon: FolderOpen,  example: "date, description, amount, currency …" },
];

function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  const color = done ? "#34d399" : active ? "#f1f5f9" : "#334155";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: `1.5px solid ${color}`, background: done ? "rgba(52,211,153,0.15)" : active ? "rgba(241,245,249,0.08)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>
        {done ? <CheckCircle2 size={13} /> : n}
      </div>
      <span style={{ fontSize: 12, color, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ height: 3, background: "rgba(30,41,59,0.8)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${value}%`, background: "#34d399", transition: "width 300ms ease", borderRadius: 2 }} />
    </div>
  );
}

export default function UploadPage() {
  const router    = useRouter();
  const fileRef   = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [org,      setOrg]      = useState<Org | null>(null);
  const [batches,  setBatches]  = useState<Batch[]>([]);
  const [source,   setSource]   = useState<string | null>(null);
  const [jobs,     setJobs]     = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Bulk delete state
  const [checkedBatches, setCheckedBatches] = useState<Set<number>>(new Set());
  const [deletingIds,    setDeletingIds]    = useState<Set<number>>(new Set());

  const step = !org ? 1 : !source ? 2 : 3;

  useEffect(() => { if (!localStorage.getItem("smb_token")) router.push("/login"); }, []);
  useEffect(() => { if (!org) return; loadBatches(org.id); }, [org]);

  async function loadBatches(orgId: number) {
    try { setBatches(await apiFetch<Batch[]>(`/transactions/batches/${orgId}`)); }
    catch { setBatches([]); }
  }

  function addFiles(incoming: FileList | File[]) {
    if (!source) { toast("Choose a file type first", "error"); return; }
    const csvs = Array.from(incoming).filter(f => f.name.endsWith(".csv"));
    if (csvs.length === 0) { toast("Only .csv files accepted", "error"); return; }
    const nonCsv = Array.from(incoming).length - csvs.length;
    if (nonCsv > 0) toast(`${nonCsv} non-CSV file(s) skipped`, "error");
    setJobs(prev => [
      ...prev,
      ...csvs.map(f => ({ file: f, status: "queued" as const })),
    ]);
  }

  function removeJob(idx: number) {
    setJobs(prev => prev.filter((_, i) => i !== idx));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function handleUploadAll() {
    if (!org || !source || jobs.length === 0 || uploading) return;
    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (job.status === "done") continue;

      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "uploading" } : j));

      try {
        const fd = new FormData();
        fd.append("file", job.file);
        fd.append("source", source);
        const batch = await apiUpload<Batch>(`/transactions/upload/${org.id}`, fd);
        setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "done", result: batch } : j));
        successCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "error", error: msg } : j));
        failCount++;
      }
    }

    await loadBatches(org.id);
    setUploading(false);
    if (successCount > 0) toast(`${successCount} file${successCount > 1 ? "s" : ""} imported`, "success");
    if (failCount > 0) toast(`${failCount} file${failCount > 1 ? "s" : ""} failed`, "error");
    // Clear done jobs after a moment
    setTimeout(() => setJobs(prev => prev.filter(j => j.status !== "done")), 2000);
  }

  // ── Batch deletion ────────────────────────────────────────────────────────

  function toggleCheck(id: number) {
    setCheckedBatches(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleCheckAll() {
    if (checkedBatches.size === batches.length) {
      setCheckedBatches(new Set());
    } else {
      setCheckedBatches(new Set(batches.map(b => b.id)));
    }
  }

  async function deleteSingle(batch: Batch) {
    if (!org || deletingIds.size > 0) return;
    if (!confirm(`Delete "${batch.filename}" and its ${batch.row_count} transactions?`)) return;
    setDeletingIds(new Set([batch.id]));
    try {
      await apiFetch(`/transactions/batches/${org.id}/${batch.id}`, { method: "DELETE" });
      setBatches(prev => prev.filter(b => b.id !== batch.id));
      setCheckedBatches(prev => { const n = new Set(prev); n.delete(batch.id); return n; });
      toast("Deleted", "success");
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Delete failed", "error"); }
    finally { setDeletingIds(new Set()); }
  }

  async function deleteBulk() {
    if (!org || checkedBatches.size === 0 || deletingIds.size > 0) return;
    const count = checkedBatches.size;
    if (!confirm(`Delete ${count} batch${count > 1 ? "es" : ""} and all their transactions? This cannot be undone.`)) return;

    const ids = Array.from(checkedBatches);
    setDeletingIds(new Set(ids));
    let ok = 0, fail = 0;

    await Promise.allSettled(ids.map(async id => {
      try {
        await apiFetch(`/transactions/batches/${org.id}/${id}`, { method: "DELETE" });
        ok++;
      } catch { fail++; }
    }));

    await loadBatches(org.id);
    setCheckedBatches(new Set());
    setDeletingIds(new Set());
    if (ok > 0) toast(`${ok} batch${ok > 1 ? "es" : ""} deleted`, "success");
    if (fail > 0) toast(`${fail} deletion${fail > 1 ? "s" : ""} failed`, "error");
  }

  const selectedSrc   = SOURCES.find(s => s.value === source) ?? null;
  const queuedCount   = jobs.filter(j => j.status === "queued").length;
  const doneCount     = jobs.filter(j => j.status === "done").length;
  const errorCount    = jobs.filter(j => j.status === "error").length;
  const uploadingIdx  = jobs.findIndex(j => j.status === "uploading");
  const canUpload     = jobs.some(j => j.status === "queued") && !!org && !!source && !uploading;

  const progressPct = jobs.length === 0 ? 0
    : Math.round((doneCount / jobs.length) * 100);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#f8fafc", fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .src-card:hover { border-color: var(--hc) !important; background: var(--hbg) !important; }
      `}</style>
      <Nav />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 32 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, color: "#f8fafc", margin: "0 0 6px", lineHeight: 1 }}>
              Import <em style={{ color: "#475569" }}>CSV</em>
            </h1>
            <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>Upload one or many CSVs — Shopify, bank statements, or any amount-based file</p>
          </div>
          <OrgSelector selected={org} onSelect={setOrg} />
        </div>

        {/* Step progress */}
        <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 32, padding: "14px 18px", borderRadius: 12, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.4)" }}>
          <Step n={1} label="Organisation" active={step === 1} done={step > 1} />
          <ChevronRight size={13} style={{ color: "#1e293b", flexShrink: 0 }} />
          <Step n={2} label="File type"    active={step === 2} done={step > 2} />
          <ChevronRight size={13} style={{ color: "#1e293b", flexShrink: 0 }} />
          <Step n={3} label="Upload files" active={step === 3} done={jobs.some(j => j.status === "done")} />
        </div>

        {!org ? (
          <div style={{ textAlign: "center", padding: "80px 24px", borderRadius: 16, border: "1px dashed rgba(30,41,59,0.8)", color: "#334155", fontSize: 14 }}>
            Select an organisation above to begin.
          </div>
        ) : (
          <>
            {/* Step 2: choose file type */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.08em" }}>
                  CHOOSE FILE TYPE
                  {!source && <span style={{ marginLeft: 8, color: "#fb7185", fontWeight: 500 }}>← required</span>}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {SOURCES.map(s => {
                  const Icon = s.icon;
                  const active = source === s.value;
                  return (
                    <button key={s.value} className="src-card" onClick={() => setSource(s.value)}
                      style={{
                        // @ts-ignore
                        "--hc": s.color + "88", "--hbg": s.color + "12",
                        textAlign: "left", padding: "14px", borderRadius: 12, position: "relative",
                        border: `1.5px solid ${active ? s.color + "88" : "rgba(30,41,59,0.8)"}`,
                        background: active ? s.color + "10" : "rgba(15,23,42,0.4)",
                        cursor: "pointer", transition: "all 150ms",
                      }}>
                      {active && <div style={{ position: "absolute", top: 8, right: 8, width: 16, height: 16, borderRadius: "50%", background: s.color, display: "flex", alignItems: "center", justifyContent: "center" }}><CheckCircle2 size={10} style={{ color: "#0a0e1a" }} /></div>}
                      <Icon size={18} style={{ color: active ? s.color : "#334155", marginBottom: 8 }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: active ? s.color : "#94a3b8", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.4 }}>{s.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: drop zone */}
            {!source ? (
              <div style={{ padding: "40px 24px", borderRadius: 16, textAlign: "center", border: "2px dashed rgba(30,41,59,0.5)", background: "rgba(15,23,42,0.2)", color: "#1e293b", fontSize: 13, userSelect: "none", marginBottom: 24 }}>
                ↑ Choose a file type to unlock the upload area
              </div>
            ) : (
              <>
                {/* Drop zone — accepts multiple */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    cursor: "pointer", borderRadius: 16, padding: "40px 24px", textAlign: "center",
                    border: `2px dashed ${dragging ? "#34d399" : jobs.length > 0 ? "#34d39955" : "rgba(30,41,59,0.8)"}`,
                    background: dragging ? "rgba(52,211,153,0.05)" : "rgba(15,23,42,0.3)",
                    transition: "all 150ms", marginBottom: 12,
                  }}>
                  <input
                    ref={fileRef} type="file" accept=".csv"
                    multiple   // ← KEY FIX: enable multi-select
                    style={{ display: "none" }}
                    onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
                  />
                  <div style={{ width: 48, height: 48, borderRadius: 14, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                    <Upload size={20} style={{ color: selectedSrc?.color ?? "#334155" }} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8", marginBottom: 4 }}>
                    Drop one or more <span style={{ color: selectedSrc?.color }}>{selectedSrc?.label}</span> CSVs
                  </div>
                  <div style={{ fontSize: 12, color: "#334155" }}>or click to browse · multiple files supported</div>
                </div>

                {/* Queue */}
                {jobs.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {uploading && jobs.length > 1 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569", marginBottom: 4 }}>
                          <span>Uploading {doneCount + (uploadingIdx >= 0 ? 1 : 0)} of {jobs.length}</span>
                          <span>{progressPct}%</span>
                        </div>
                        <ProgressBar value={progressPct} />
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {jobs.map((job, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                          borderRadius: 10, border: `1px solid ${job.status === "error" ? "rgba(251,113,133,0.3)" : job.status === "done" ? "rgba(52,211,153,0.3)" : "rgba(30,41,59,0.8)"}`,
                          background: job.status === "error" ? "rgba(251,113,133,0.05)" : job.status === "done" ? "rgba(52,211,153,0.05)" : "rgba(15,23,42,0.4)",
                        }}>
                          {job.status === "uploading" ? <Loader2 size={13} className="animate-spin" style={{ color: "#60a5fa", flexShrink: 0 }} />
                           : job.status === "done"     ? <CheckCircle2 size={13} style={{ color: "#34d399", flexShrink: 0 }} />
                           : job.status === "error"    ? <AlertTriangle size={13} style={{ color: "#fb7185", flexShrink: 0 }} />
                           : <FileText size={13} style={{ color: "#475569", flexShrink: 0 }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.file.name}</div>
                            {job.status === "error" && <div style={{ fontSize: 11, color: "#fb7185", marginTop: 2 }}>{job.error}</div>}
                            {job.status === "done" && job.result && <div style={{ fontSize: 11, color: "#34d399", marginTop: 2 }}>{job.result.row_count} rows imported</div>}
                          </div>
                          <span style={{ fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                            {(job.file.size / 1024).toFixed(1)} KB
                          </span>
                          {!uploading && job.status !== "done" && (
                            <button onClick={() => removeJob(i)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center", padding: 2 }}>
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                  <button onClick={handleUploadAll} disabled={!canUpload} style={{
                    flex: 1, padding: "13px", borderRadius: 12, border: "none",
                    cursor: canUpload ? "pointer" : "not-allowed",
                    background: canUpload ? "#f1f5f9" : "rgba(30,41,59,0.6)",
                    color: canUpload ? "#0f172a" : "#334155",
                    fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    transition: "all 150ms", opacity: canUpload ? 1 : 0.55,
                  }}>
                    {uploading ? <><Loader2 size={16} className="animate-spin" />Uploading…</>
                     : jobs.length === 0 ? "Drop or browse CSV files"
                     : <><Sparkles size={16} />Upload {jobs.filter(j => j.status === "queued").length} file{jobs.filter(j => j.status === "queued").length !== 1 ? "s" : ""} as {selectedSrc?.label}</>}
                  </button>
                  {jobs.length > 0 && !uploading && (
                    <button onClick={() => setJobs([])} style={{ padding: "13px 16px", borderRadius: 12, border: "1px solid rgba(30,41,59,0.8)", background: "transparent", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
                      Clear queue
                    </button>
                  )}
                </div>

                {/* Success shortcuts */}
                {jobs.some(j => j.status === "done") && (
                  <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                    <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#34d399", textDecoration: "none", fontWeight: 500 }}>
                      View Dashboard <ArrowRight size={13} />
                    </Link>
                    <Link href="/reconcile" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#60a5fa", textDecoration: "none", fontWeight: 500 }}>
                      Reconcile <ArrowRight size={13} />
                    </Link>
                  </div>
                )}

                {/* Format hint */}
                {selectedSrc && (
                  <div style={{ borderRadius: 14, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.3)", padding: 20, marginBottom: 28 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                      <AlertTriangle size={13} style={{ color: "#fbbf24" }} />
                      <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fbbf24" }}>Expected {selectedSrc.label} Format</span>
                    </div>
                    <pre style={{ borderRadius: 8, border: "1px solid rgba(30,41,59,0.8)", background: "#0a0e1a", padding: "12px 14px", fontSize: 11, color: "#64748b", overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", margin: 0, lineHeight: 1.7 }}>
                      {selectedSrc.value === "shopify"
                        ? `Order_ID,Date,Customer,Subtotal,GST_Rate,GST_Amount,Total_Amount,Payment_Status,Gateway\nORD-01-1000,2024-01-21,Ravi Kumar,847.46,18,152.54,1000.00,Paid,Razorpay`
                        : selectedSrc.value === "bank"
                          ? `Date,Narration,Ref No,Debit,Credit,Balance\n01-01-2024,UPI-Vendor Payment,xxx,-15000,,485000`
                          : `date,description,amount,currency\n2024-03-01,Google Ads Campaign,-15000,INR`}
                    </pre>
                  </div>
                )}
              </>
            )}

            {/* Upload history with bulk delete */}
            {batches.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                  <Clock size={13} style={{ color: "#475569" }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#475569" }}>Upload History</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>
                    {batches.length} file{batches.length !== 1 ? "s" : ""}
                  </span>
                  {checkedBatches.size > 0 && (
                    <button
                      onClick={deleteBulk}
                      disabled={deletingIds.size > 0}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "4px 10px", borderRadius: 6,
                        border: "1px solid rgba(251,113,133,0.4)",
                        background: "rgba(251,113,133,0.06)",
                        color: "#fda4af", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
                      }}>
                      {deletingIds.size > 0 ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Delete {checkedBatches.size} selected
                    </button>
                  )}
                </div>

                {/* Select all row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 14px 8px", marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={checkedBatches.size === batches.length && batches.length > 0}
                    onChange={toggleCheckAll}
                    style={{ cursor: "pointer", accentColor: "#34d399" }}
                  />
                  <span style={{ fontSize: 11, color: "#475569" }}>
                    {checkedBatches.size > 0 ? `${checkedBatches.size} selected` : "Select all"}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {batches.map(b => (
                    <div key={b.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", borderRadius: 10,
                      border: `1px solid ${checkedBatches.has(b.id) ? "rgba(52,211,153,0.3)" : "rgba(30,41,59,0.8)"}`,
                      background: checkedBatches.has(b.id) ? "rgba(52,211,153,0.04)" : "rgba(15,23,42,0.3)",
                      transition: "all 120ms",
                    }}>
                      <input
                        type="checkbox"
                        checked={checkedBatches.has(b.id)}
                        onChange={() => toggleCheck(b.id)}
                        disabled={deletingIds.size > 0}
                        style={{ cursor: "pointer", accentColor: "#34d399", flexShrink: 0 }}
                      />
                      <FileText size={13} style={{ color: "#334155", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{b.filename}</span>
                      <SourceBadge source={b.source} />
                      <span style={{ fontSize: 11, color: "#334155", display: "flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                        <Hash size={10} />{b.row_count.toLocaleString("en-IN")}
                      </span>
                      <button
                        onClick={() => deleteSingle(b)}
                        disabled={deletingIds.size > 0}
                        style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(30,41,59,0.8)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", transition: "all 150ms", flexShrink: 0 }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#fb7185"; e.currentTarget.style.borderColor = "rgba(251,113,133,0.4)"; e.currentTarget.style.background = "rgba(251,113,133,0.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#475569"; e.currentTarget.style.borderColor = "rgba(30,41,59,0.8)"; e.currentTarget.style.background = "transparent"; }}
                      >
                        {deletingIds.has(b.id) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
