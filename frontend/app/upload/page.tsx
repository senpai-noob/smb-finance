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
  Clock, Hash, Trash2, Sparkles, AlertTriangle,
} from "lucide-react";

interface Batch { id: number; filename: string; source: string; row_count: number; }

const SOURCES = [
  { value: "shopify", label: "Shopify Payout",  hint: "Shopify Admin → Finances → Payouts",           color: "#34d399" },
  { value: "bank",    label: "Bank Statement",   hint: "Net banking portal CSV download",               color: "#60a5fa" },
  { value: "manual",  label: "Manual / Other",   hint: "Any CSV with amount column",                    color: "#a78bfa" },
];

const EXPECTED_COLS = [
  { col: "Amount",      kw: "amount · total · net · price", req: true  },
  { col: "Date",        kw: "date · posted · txn_date",     req: false },
  { col: "Description", kw: "description · narration",      req: false },
];

export default function UploadPage() {
  const router    = useRouter();
  const fileRef   = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [org,      setOrg]      = useState<Org | null>(null);
  const [batches,  setBatches]  = useState<Batch[]>([]);
  const [source,   setSource]   = useState("shopify");
  const [file,     setFile]     = useState<File | null>(null);
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
