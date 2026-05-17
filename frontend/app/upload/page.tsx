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
  ShoppingBag, Building2, FolderOpen,
} from "lucide-react";

interface Batch { id: number; filename: string; source: string; row_count: number; }

const SOURCES = [
  {
    value: "shopify",
    label: "Shopify Sales / Payouts",
    hint: "Shopify Admin → Orders or Finances → Payouts",
    color: "#34d399",
    icon: ShoppingBag,
    example: "Order_ID, Date, Subtotal, Total_Amount, GST_Rate …",
  },
  {
    value: "bank",
    label: "Bank Statement",
    hint: "Download CSV from your net-banking portal",
    color: "#60a5fa",
    icon: Building2,
    example: "Date, Narration, Debit, Credit, Balance …",
  },
  {
    value: "manual",
    label: "Manual / Other",
    hint: "Any CSV that has an amount or total column",
    color: "#a78bfa",
    icon: FolderOpen,
    example: "date, description, amount, currency …",
  },
];

/** Step indicator */
function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  const color = done ? "#34d399" : active ? "#f1f5f9" : "#334155";
  const bg    = done ? "rgba(52,211,153,0.15)" : active ? "rgba(241,245,249,0.08)" : "transparent";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        border: `1.5px solid ${color}`,
        background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color,
        flexShrink: 0,
      }}>
        {done ? <CheckCircle2 size={13} /> : n}
      </div>
      <span style={{ fontSize: 12, color, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
}

export default function UploadPage() {
  const router    = useRouter();
  const fileRef   = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [org,       setOrg]       = useState<Org | null>(null);
  const [batches,   setBatches]   = useState<Batch[]>([]);
  // null = not chosen yet — this is the key UX fix
  const [source,    setSource]    = useState<string | null>(null);
  const [file,      setFile]      = useState<File | null>(null);
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [success,   setSuccess]   = useState<Batch | null>(null);

  // current step: 1 = choose org, 2 = choose type, 3 = upload file
  const step = !org ? 1 : !source ? 2 : 3;

  useEffect(() => { if (!localStorage.getItem("smb_token")) router.push("/login"); }, []);
  useEffect(() => { if (!org) return; setBatches([]); setSuccess(null); loadBatches(org.id); }, [org]);

  async function loadBatches(orgId: number) {
    try { setBatches(await apiFetch<Batch[]>(`/transactions/batches/${orgId}`)); }
    catch { setBatches([]); }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    if (!source) { toast("Please choose a file type first", "error"); return; }
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) setFile(f);
    else toast("Please drop a .csv file", "error");
  }

  async function handleUpload() {
    if (!file || !org || !source) return;
    setUploading(true); setSuccess(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("source", source);
      const batch = await apiUpload<Batch>(`/transactions/upload/${org.id}`, fd);
      setSuccess(batch); setFile(null);
      toast(`${batch.row_count} transactions imported`, "success");
      loadBatches(org.id);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally { setUploading(false); }
  }

  async function handleDelete(batch: Batch) {
    if (!org || deletingId) return;
    if (!confirm(`Delete "${batch.filename}" and its ${batch.row_count} transactions? This cannot be undone.`)) return;
    setDeletingId(batch.id);
    try {
      await apiFetch(`/transactions/batches/${org.id}/${batch.id}`, { method: "DELETE" });
      setBatches(prev => prev.filter(b => b.id !== batch.id));
      setSuccess(prev => prev?.id === batch.id ? null : prev);
      toast("Deleted", "success");
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Delete failed", "error"); }
    finally { setDeletingId(null); }
  }

  const selectedSrc = SOURCES.find(s => s.value === source) ?? null;
  const canUpload   = !!file && !!org && !!source && !uploading;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#f8fafc", fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
      .src-card:hover { border-color: var(--hc) !important; background: var(--hbg) !important; }
      `}</style>
      <Nav />

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "36px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 32 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, color: "#f8fafc", margin: "0 0 6px", lineHeight: 1 }}>
              Import <em style={{ color: "#475569", fontStyle: "italic" }}>CSV</em>
            </h1>
            <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>Shopify orders, bank statements, or any amount-based CSV</p>
          </div>
          <OrgSelector selected={org} onSelect={setOrg} />
        </div>

        {/* Step progress */}
        <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 32, padding: "14px 18px", borderRadius: 12, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.4)" }}>
          <Step n={1} label="Organisation" active={step === 1} done={step > 1} />
          <ChevronRight size={13} style={{ color: "#1e293b", flexShrink: 0 }} />
          <Step n={2} label="File type"    active={step === 2} done={step > 2} />
          <ChevronRight size={13} style={{ color: "#1e293b", flexShrink: 0 }} />
          <Step n={3} label="Upload file"  active={step === 3} done={!!success} />
        </div>

        {/* ── STEP 1: must pick org ─────────────────────────────────────── */}
        {!org && (
          <div style={{ textAlign: "center", padding: "80px 24px", borderRadius: 16, border: "1px dashed rgba(30,41,59,0.8)", color: "#334155", fontSize: 14 }}>
            Select an organisation above to begin.
          </div>
        )}

        {org && (
          <>
            {/* ── STEP 2: choose file type ─────────────────────────────── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: `1.5px solid ${step === 2 ? "#f1f5f9" : "#34d399"}`,
                  background: step === 2 ? "rgba(241,245,249,0.08)" : "rgba(52,211,153,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: step === 2 ? "#f1f5f9" : "#34d399",
                }}>2</div>
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
                    <button
                      key={s.value}
                      className="src-card"
                      onClick={() => { setSource(s.value); setFile(null); }}
                      style={{
                        // @ts-ignore
                        "--hc": s.color + "88",
                        "--hbg": s.color + "12",
                        textAlign: "left", padding: "14px",
                        borderRadius: 12,
                        border: `1.5px solid ${active ? s.color + "88" : "rgba(30,41,59,0.8)"}`,
                        background: active ? s.color + "10" : "rgba(15,23,42,0.4)",
                        cursor: "pointer", transition: "all 150ms",
                        position: "relative",
                      }}>
                      {active && (
                        <div style={{
                          position: "absolute", top: 8, right: 8,
                          width: 16, height: 16, borderRadius: "50%",
                          background: s.color,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <CheckCircle2 size={10} style={{ color: "#0a0e1a" }} />
                        </div>
                      )}
                      <Icon size={18} style={{ color: active ? s.color : "#334155", marginBottom: 8 }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: active ? s.color : "#94a3b8", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.4 }}>{s.hint}</div>
                    </button>
                  );
                })}
              </div>

              {/* Selected type detail */}
              {selectedSrc && (
                <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, background: "rgba(15,23,42,0.5)", border: `1px solid ${selectedSrc.color}22` }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>Expected columns: </span>
                  <code style={{ fontSize: 11, color: selectedSrc.color, fontFamily: "'JetBrains Mono', monospace" }}>{selectedSrc.example}</code>
                </div>
              )}
            </div>

            {/* ── STEP 3: drop zone (only shown after type is chosen) ─── */}
            {!source ? (
              <div style={{
                padding: "40px 24px", borderRadius: 16, textAlign: "center",
                border: "2px dashed rgba(30,41,59,0.5)", background: "rgba(15,23,42,0.2)",
                color: "#1e293b", fontSize: 13, userSelect: "none",
              }}>
                ↑ Choose a file type above to unlock the upload area
              </div>
            ) : (
              <>
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    cursor: "pointer", borderRadius: 16, padding: "48px 24px", textAlign: "center",
                    border: `2px dashed ${dragging ? "#34d399" : file ? "#34d39955" : "rgba(30,41,59,0.8)"}`,
                    background: dragging ? "rgba(52,211,153,0.05)" : file ? "rgba(52,211,153,0.03)" : "rgba(15,23,42,0.3)",
                    transition: "all 150ms", marginBottom: 16,
                  }}>
                  <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
                  {file ? (
                    <>
                      <FileText size={36} style={{ color: "#34d399", margin: "0 auto 12px" }} />
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>{file.name}</div>
                      <div style={{ fontSize: 12, color: "#475569" }}>
                        {(file.size / 1024).toFixed(1)} KB ·{" "}
                        <span style={{ color: selectedSrc?.color }}>Tagged as {selectedSrc?.label}</span>
                        {" "}· Click to change file
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 56, height: 56, borderRadius: 16, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                        <Upload size={22} style={{ color: selectedSrc?.color ?? "#334155" }} />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8", marginBottom: 6 }}>
                        Drop your <span style={{ color: selectedSrc?.color }}>{selectedSrc?.label}</span> CSV here
                      </div>
                      <div style={{ fontSize: 12, color: "#334155" }}>or click to browse · .csv files only</div>
                    </>
                  )}
                </div>

                <button onClick={handleUpload} disabled={!canUpload} style={{
                  width: "100%", padding: "13px", borderRadius: 12, border: "none",
                  cursor: canUpload ? "pointer" : "not-allowed",
                  background: canUpload ? "#f1f5f9" : "rgba(30,41,59,0.6)",
                  color: canUpload ? "#0f172a" : "#334155",
                  fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all 150ms", marginBottom: 24,
                  opacity: canUpload ? 1 : 0.55,
                }}>
                  {uploading
                    ? <><Loader2 size={16} className="animate-spin" />Analysing…</>
                    : !file
                      ? "Drop or browse a CSV file first"
                      : <><Sparkles size={16} />Upload & Analyse as {selectedSrc?.label}</>}
                </button>
              </>
            )}

            {/* Success banner */}
            {success && (
              <div style={{
                padding: 20, borderRadius: 14, marginBottom: 24,
                border: "1px solid rgba(52,211,153,0.25)", background: "rgba(52,211,153,0.06)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#34d399", fontWeight: 600, fontSize: 14, marginBottom: 14 }}>
                  <CheckCircle2 size={16} /> Imported successfully!
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                  {[["File", success.filename], ["Rows", success.row_count.toLocaleString("en-IN")]].map(([k, v]) => (
                    <div key={k} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(15,23,42,0.5)" }}>
                      <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{k}</div>
                      <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#34d399", textDecoration: "none", fontWeight: 500 }}>
                    View Dashboard <ArrowRight size={13} />
                  </Link>
                  <Link href="/reconcile" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#60a5fa", textDecoration: "none", fontWeight: 500 }}>
                    Reconcile <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            )}

            {/* Format hint — shown after type is chosen */}
            {selectedSrc && (
              <div style={{ borderRadius: 14, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.3)", padding: 20, marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <AlertTriangle size={13} style={{ color: "#fbbf24" }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fbbf24" }}>
                    Expected {selectedSrc.label} Format
                  </span>
                </div>
                <pre style={{ borderRadius: 8, border: "1px solid rgba(30,41,59,0.8)", background: "#0a0e1a", padding: "12px 14px", fontSize: 11, color: "#64748b", overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", margin: 0, lineHeight: 1.7 }}>
                  {selectedSrc.value === "shopify"
                    ? `Order_ID,Date,Customer,Subtotal,GST_Rate,GST_Amount,Total_Amount,Payment_Status,Gateway\nORD-01-1000,2024-01-21,Ravi Kumar,847.46,18,152.54,1000.00,Paid,Razorpay`
                    : selectedSrc.value === "bank"
                      ? `Date,Narration,Ref No,Debit,Credit,Balance\n01-01-2024,UPI-Vendor Payment,xxx,-15000,,485000`
                      : `date,description,amount,currency\n2024-03-01,Google Ads Campaign,-15000,INR\n2024-03-02,Shopify Payout,85000,INR`}
                </pre>
              </div>
            )}

            {/* Upload history */}
            {batches.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                  <Clock size={13} style={{ color: "#475569" }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#475569" }}>Upload History</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>{batches.length} file{batches.length !== 1 ? "s" : ""}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {batches.map(b => (
                    <div key={b.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 14px", borderRadius: 10,
                      border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.3)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <FileText size={13} style={{ color: "#334155", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.filename}</span>
                        <SourceBadge source={b.source} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 12 }}>
                        <span style={{ fontSize: 11, color: "#334155", display: "flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                          <Hash size={10} />{b.row_count.toLocaleString("en-IN")}
                        </span>
                        <button
                          onClick={() => handleDelete(b)}
                          disabled={deletingId !== null}
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(30,41,59,0.8)",
                            background: "transparent", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#475569", transition: "all 150ms",
                          }}
                          onMouseEnter={e => { (e.currentTarget.style.color = "#fb7185"); (e.currentTarget.style.borderColor = "rgba(251,113,133,0.4)"); (e.currentTarget.style.background = "rgba(251,113,133,0.08)"); }}
                          onMouseLeave={e => { (e.currentTarget.style.color = "#475569"); (e.currentTarget.style.borderColor = "rgba(30,41,59,0.8)"); (e.currentTarget.style.background = "transparent"); }}
                        >
                          {deletingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
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
}  const [file,     setFile]     = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [success,  setSuccess]  = useState<Batch | null>(null);

  useEffect(() => { if (!localStorage.getItem("smb_token")) router.push("/login"); }, []);
  useEffect(() => { if (!org) return; setBatches([]); setSuccess(null); loadBatches(org.id); }, [org]);

  async function loadBatches(orgId: number) {
    try { setBatches(await apiFetch<Batch[]>(`/transactions/batches/${orgId}`)); }
    catch { setBatches([]); }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) setFile(f);
    else toast("Please drop a .csv file", "error");
  }

  async function handleUpload() {
    if (!file || !org) return;
    setUploading(true); setSuccess(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("source", source);
      const batch = await apiUpload<Batch>(`/transactions/upload/${org.id}`, fd);
      setSuccess(batch); setFile(null);
      toast(`${batch.row_count} transactions imported`, "success");
      loadBatches(org.id);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally { setUploading(false); }
  }

  async function handleDelete(batch: Batch) {
    if (!org || deletingId) return;
    if (!confirm(`Delete "${batch.filename}" and its ${batch.row_count} transactions? This cannot be undone.`)) return;
    setDeletingId(batch.id);
    try {
      await apiFetch(`/transactions/batches/${org.id}/${batch.id}`, { method: "DELETE" });
      setBatches(prev => prev.filter(b => b.id !== batch.id));
      setSuccess(prev => prev?.id === batch.id ? null : prev);
      toast("Deleted", "success");
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Delete failed", "error"); }
    finally { setDeletingId(null); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#f8fafc", fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>
      <Nav />

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "36px 24px 60px" }}>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 36 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, color: "#f8fafc", margin: "0 0 6px", lineHeight: 1 }}>
              Upload <em style={{ color: "#475569", fontStyle: "italic" }}>CSV</em>
            </h1>
            <p style={{ fontSize: 13, color: "#475569" }}>Shopify payouts, bank statements, or any CSV with an amount column</p>
          </div>
          <OrgSelector selected={org} onSelect={setOrg} />
        </div>

        {!org ? (
          <div style={{ textAlign: "center", padding: "80px 24px", borderRadius: 16, border: "1px dashed rgba(30,41,59,0.8)", color: "#334155", fontSize: 14 }}>
            Select an organisation above to begin uploading.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: "#475569", marginBottom: 10 }}>
                Statement Type
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {SOURCES.map(s => (
                  <button key={s.value} onClick={() => setSource(s.value)} style={{
                    textAlign: "left", padding: "14px 14px",
                    borderRadius: 12, border: `1px solid ${source === s.value ? s.color + "55" : "rgba(30,41,59,0.8)"}`,
                    background: source === s.value ? s.color + "0d" : "rgba(15,23,42,0.4)",
                    cursor: "pointer", transition: "all 150ms",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: source === s.value ? s.color : "#94a3b8", marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.4 }}>{s.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                cursor: "pointer", borderRadius: 16, padding: "48px 24px", textAlign: "center",
                border: `2px dashed ${dragging ? "#34d399" : file ? "#34d39955" : "rgba(30,41,59,0.8)"}`,
                background: dragging ? "rgba(52,211,153,0.05)" : file ? "rgba(52,211,153,0.03)" : "rgba(15,23,42,0.3)",
                transition: "all 150ms", marginBottom: 16,
              }}>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
              {file ? (
                <>
                  <FileText size={36} style={{ color: "#34d399", margin: "0 auto 12px" }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>{file.name}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{(file.size / 1024).toFixed(1)} KB · Click to change</div>
                </>
              ) : (
                <>
                  <div style={{ width: 56, height: 56, borderRadius: 16, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <Upload size={22} style={{ color: "#334155" }} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8", marginBottom: 6 }}>Drop your CSV here</div>
                  <div style={{ fontSize: 12, color: "#334155" }}>or click to browse · .csv files only</div>
                </>
              )}
            </div>

            <button onClick={handleUpload} disabled={!file || uploading} style={{
              width: "100%", padding: "13px", borderRadius: 12, border: "none", cursor: file ? "pointer" : "not-allowed",
              background: file ? "#f1f5f9" : "rgba(30,41,59,0.6)", color: file ? "#0f172a" : "#334155",
              fontSize: 14, fontWeight: 700, fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 150ms", marginBottom: 24, opacity: !file || uploading ? 0.6 : 1,
            }}>
              {uploading ? <><Loader2 size={16} className="animate-spin" />Analysing…</> : <><Sparkles size={16} />Upload & Analyse</>}
            </button>

            {success && (
              <div style={{
                padding: 20, borderRadius: 14, marginBottom: 24,
                border: "1px solid rgba(52,211,153,0.25)", background: "rgba(52,211,153,0.06)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#34d399", fontWeight: 600, fontSize: 14, marginBottom: 14 }}>
                  <CheckCircle2 size={16} /> Imported successfully!
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                  {[["File", success.filename], ["Rows", success.row_count.toLocaleString("en-IN")]].map(([k, v]) => (
                    <div key={k} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(15,23,42,0.5)" }}>
                      <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{k}</div>
                      <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#34d399", textDecoration: "none", fontWeight: 500 }}>
                    View Dashboard <ArrowRight size={13} />
                  </Link>
                  <Link href="/reconcile" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#60a5fa", textDecoration: "none", fontWeight: 500 }}>
                    Reconcile <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            )}

            <div style={{ borderRadius: 14, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.3)", padding: 20, marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                <AlertTriangle size={13} style={{ color: "#fbbf24" }} />
                <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fbbf24" }}>Expected CSV Format</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
                {EXPECTED_COLS.map(r => (
                  <div key={r.col} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(15,23,42,0.6)" }}>
                    <div style={{ fontSize: 12, color: r.req ? "#34d399" : "#94a3b8", fontWeight: 600, marginBottom: 3 }}>
                      {r.col} {r.req && <span style={{ color: "#fb7185" }}>*</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>{r.kw}</div>
                  </div>
                ))}
              </div>
              <pre style={{ borderRadius: 8, border: "1px solid rgba(30,41,59,0.8)", background: "#0a0e1a", padding: "12px 14px", fontSize: 11, color: "#64748b", overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", margin: 0, lineHeight: 1.7 }}>{`date,description,amount,currency
2024-03-01,Google Ads Campaign,-15000,INR
2024-03-02,Shopify Payout,85000,INR
2024-03-03,Delhivery Courier,-3200,INR`}</pre>
            </div>

            {batches.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                  <Clock size={13} style={{ color: "#475569" }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#475569" }}>Upload History</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>{batches.length} file{batches.length !== 1 ? "s" : ""}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {batches.map(b => (
                    <div key={b.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 14px", borderRadius: 10,
                      border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.3)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <FileText size={13} style={{ color: "#334155", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.filename}</span>
                        <SourceBadge source={b.source} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 12 }}>
                        <span style={{ fontSize: 11, color: "#334155", display: "flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                          <Hash size={10} />{b.row_count.toLocaleString("en-IN")}
                        </span>
                        <button
                          onClick={() => handleDelete(b)}
                          disabled={deletingId !== null}
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(30,41,59,0.8)",
                            background: "transparent", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#475569", transition: "all 150ms",
                          }}
                          onMouseEnter={e => { (e.currentTarget.style.color = "#fb7185"); (e.currentTarget.style.borderColor = "rgba(251,113,133,0.4)"); (e.currentTarget.style.background = "rgba(251,113,133,0.08)"); }}
                          onMouseLeave={e => { (e.currentTarget.style.color = "#475569"); (e.currentTarget.style.borderColor = "rgba(30,41,59,0.8)"); (e.currentTarget.style.background = "transparent"); }}
                        >
                          {deletingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
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
