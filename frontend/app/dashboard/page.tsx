"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, apiDownload } from "@/lib/api";
import Nav from "@/components/Nav";
import { DashboardSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import {
  Building2, Plus, Loader2, Upload, Download, X, ChevronDown,
  TrendingUp, ArrowUpRight,
} from "lucide-react";

const PieChartWidget   = dynamic(() => import("@/components/Charts").then(m => ({ default: m.PieChartWidget   })), { ssr: false });
const BarChartWidget   = dynamic(() => import("@/components/Charts").then(m => ({ default: m.BarChartWidget   })), { ssr: false });
const TrendChartWidget = dynamic(() => import("@/components/Charts").then(m => ({ default: m.TrendChartWidget })), { ssr: false });

interface Org { id: number; name: string; slug: string; gst_number?: string; }
interface CategoryTotal { category: string; total: number; count: number; percentage: number; }
interface MonthlyPoint  { month: string; month_label: string; income: number; expenses: number; net: number; }
interface Summary {
  org_id: number; period_label: string;
  total_income: number; total_expenses: number; net_cashflow: number;
  transaction_count: number;
  category_totals: CategoryTotal[];
  monthly_trend: MonthlyPoint[];
  insights: string[];
}

const fmtINR = (v: number) => `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function DashboardPage() {
  const router    = useRouter();
  const { toast } = useToast();

  const [orgs, setOrgs]               = useState<Org[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [orgDropOpen, setOrgDropOpen] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [summary, setSummary]         = useState<Summary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showCreate, setShowCreate]   = useState(false);
  const [newOrgName, setNewOrgName]   = useState("");
  const [newGST, setNewGST]           = useState("");
  const [creating, setCreating]       = useState(false);
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [activeTab, setActiveTab]     = useState<"pie"|"bar"|"trend">("pie");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("smb_token")) { router.push("/login"); return; }
    apiFetch<Org[]>("/orgs/")
      .then(data => { setOrgs(data); if (data.length > 0) setSelectedOrg(data[0]); else setLoadingOrgs(false); })
      .catch(() => router.push("/login"));
  }, []);

  useEffect(() => {
    if (!selectedOrg) return;
    setLoadingOrgs(false);
    loadSummary(selectedOrg.id, dateFrom, dateTo);
  }, [selectedOrg, dateFrom, dateTo]);

  async function loadSummary(orgId: number, from: string, to: string) {
    setLoadingSummary(true); setSummary(null);
    try {
      const p = new URLSearchParams();
      if (from) p.set("date_from", from);
      if (to)   p.set("date_to",   to);
      const data = await apiFetch<Summary>(`/transactions/summary/${orgId}${p.toString() ? `?${p}` : ""}`);
      setSummary(data);
    } catch { toast("Could not load summary", "error"); }
    finally  { setLoadingSummary(false); }
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault(); setCreating(true);
    try {
      const org = await apiFetch<Org>("/orgs/", { method: "POST", body: JSON.stringify({ name: newOrgName, gst_number: newGST || undefined }) });
      setOrgs(prev => [...prev, org]); setSelectedOrg(org);
      setShowCreate(false); setNewOrgName(""); setNewGST("");
      toast("Organisation created", "success");
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
    finally { setCreating(false); }
  }

  async function handleExport() {
    if (!selectedOrg) return;
    setDownloading(true);
    try {
      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo)   p.set("date_to",   dateTo);
      const qs = p.toString() ? `?${p}` : "";
      await apiDownload(`/transactions/export/${selectedOrg.id}${qs}`, `claritybooks-${selectedOrg.slug || selectedOrg.id}.csv`);
      toast("CSV exported", "success");
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Export failed", "error"); }
    finally { setDownloading(false); }
  }

  if (loadingOrgs) return (
    <div style={pageBg}>
      <FontImport />
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 size={28} style={{ color: "#34d399" }} className="animate-spin" />
      </div>
    </div>
  );

  const netPositive = summary ? summary.net_cashflow >= 0 : true;
  const margin = summary && summary.total_income > 0
    ? (summary.net_cashflow / summary.total_income) * 100
    : null;

  return (
    <div style={pageBg}>
      <FontImport />

      {/* Background atmosphere */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        zIndex: 0,
      }} />
      <div aria-hidden style={{
        position: "fixed", top: -200, right: "20%", width: 700, height: 400,
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        background: netPositive
          ? "radial-gradient(ellipse, rgba(52,211,153,0.08), transparent 70%)"
          : "radial-gradient(ellipse, rgba(251,113,133,0.08), transparent 70%)",
        filter: "blur(20px)",
      }} />

      <Nav />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "0 auto", padding: "32px 28px 80px" }}>

        {/* Masthead */}
        <header style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          paddingBottom: 24, borderBottom: "1px solid rgba(30,41,59,0.55)",
          marginBottom: 36, flexWrap: "wrap", gap: 16,
          opacity: 0, animation: "rise 600ms ease-out forwards",
        }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
            {orgs.length > 0 && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setOrgDropOpen(o => !o)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    border: "none", background: "transparent", cursor: "pointer", padding: 0,
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    fontSize: 42, lineHeight: 1, color: "#f1f5f9", fontStyle: "italic",
                  }}>
                  {selectedOrg?.name ?? "Select org"}
                  <ChevronDown size={18} style={{ color: "#475569", marginBottom: 6 }} />
                </button>
                {orgDropOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 8px)", left: 0,
                    minWidth: 220, padding: 6, zIndex: 30,
                    border: "1px solid rgba(30,41,59,0.8)",
                    background: "rgba(10,14,26,0.95)",
                    backdropFilter: "blur(12px)",
                    borderRadius: 10,
                    boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
                  }}>
                    {orgs.map(org => (
                      <button key={org.id} onClick={() => { setSelectedOrg(org); setOrgDropOpen(false); }}
                        style={{
                          width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 6,
                          border: "none", background: selectedOrg?.id === org.id ? "rgba(52,211,153,0.1)" : "transparent",
                          color: selectedOrg?.id === org.id ? "#34d399" : "#cbd5e1",
                          fontSize: 13, cursor: "pointer",
                          fontFamily: "'Manrope', system-ui, sans-serif",
                        }}>
                        {org.name}
                        {org.gst_number && (
                          <div style={{ fontSize: 10, color: "#475569", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
                            {org.gst_number}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setShowCreate(o => !o)} style={tinyBtn}>
              <Plus size={11} /> New org
            </button>
          </div>

          {/* Right-side meta — date stamp + actions */}
          <div style={{ display: "flex", alignItems: "flex-end", flexDirection: "column", gap: 12 }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#52525b",
            }}>
              {summary?.period_label ?? "—"} · {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <DateField value={dateFrom} onChange={setDateFrom} placeholder="From" />
              <span style={{ color: "#334155", fontSize: 11 }}>→</span>
              <DateField value={dateTo} onChange={setDateTo} placeholder="To" />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={iconGhost}>
                  <X size={11} />
                </button>
              )}
              <button onClick={handleExport} disabled={downloading} style={smallBtn("slate")}>
                {downloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Export
              </button>
              <Link href="/upload" style={{ ...smallBtn("emerald"), textDecoration: "none" }}>
                <Upload size={11} /> Upload
              </Link>
            </div>
          </div>
        </header>

        {showCreate && (
          <form onSubmit={createOrg} style={{
            display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
            padding: 16, marginBottom: 28,
            border: "1px solid rgba(30,41,59,0.6)",
            background: "rgba(15,23,42,0.4)", borderRadius: 12,
          }}>
            <Field label="Business Name">
              <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} required
                placeholder="My Shop Pvt Ltd" style={inputStyle} />
            </Field>
            <Field label="GSTIN (optional)">
              <input value={newGST} onChange={e => setNewGST(e.target.value.toUpperCase())}
                placeholder="27AAPFU0939F1ZV" style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
            </Field>
            <button type="submit" disabled={creating} style={primaryBtn(creating)}>
              {creating ? <Loader2 size={13} className="animate-spin" /> : null}
              Create
            </button>
          </form>
        )}

        {orgs.length === 0 && (
          <div style={{
            textAlign: "center", padding: "120px 24px",
            border: "1px dashed rgba(30,41,59,0.8)", borderRadius: 16,
          }}>
            <Building2 size={48} style={{ color: "#1e293b", marginBottom: 16 }} />
            <p style={{ color: "#475569", fontSize: 14, marginBottom: 22 }}>Create your first business to get started.</p>
            <button onClick={() => setShowCreate(true)} style={primaryBtn(false)}>
              Create organisation
            </button>
          </div>
        )}

        {selectedOrg && loadingSummary && <DashboardSkeleton />}

        {selectedOrg && !loadingSummary && summary && summary.transaction_count === 0 && (
          <div style={{
            textAlign: "center", padding: "100px 24px",
            border: "1px dashed rgba(30,41,59,0.6)", borderRadius: 16,
          }}>
            <Upload size={40} style={{ color: "#1e293b", marginBottom: 14 }} />
            <h2 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 28, color: "#94a3b8", fontStyle: "italic", margin: "0 0 6px",
            }}>
              No transactions yet
            </h2>
            <p style={{ color: "#475569", fontSize: 13, marginBottom: 22 }}>
              Upload a Shopify payout or bank CSV to see your dashboard.
            </p>
            <Link href="/upload" style={{ ...primaryBtn(false), textDecoration: "none", display: "inline-flex" }}>
              <Upload size={13} /> Upload CSV
            </Link>
          </div>
        )}

        {selectedOrg && !loadingSummary && summary && summary.transaction_count > 0 && (
          <>
            {/* Broadsheet KPI strip */}
            <section style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
              borderTop: "1px solid rgba(30,41,59,0.55)",
              borderBottom: "1px solid rgba(30,41,59,0.55)",
              marginBottom: 36,
            }}>
              <Kpi
                eyebrow="Income"
                value={fmtINR(summary.total_income)}
                accent="#34d399"
                sub={`${summary.transaction_count.toLocaleString("en-IN")} transactions`}
                delay={50}
              />
              <Kpi
                eyebrow="Expenses"
                value={fmtINR(summary.total_expenses)}
                accent="#fb7185"
                sub="across all categories"
                divider
                delay={150}
              />
              <Kpi
                eyebrow="Net cashflow"
                value={(summary.net_cashflow >= 0 ? "+" : "−") + fmtINR(summary.net_cashflow)}
                accent={summary.net_cashflow >= 0 ? "#34d399" : "#fb7185"}
                sub={summary.net_cashflow >= 0 ? "surplus" : "deficit"}
                divider
                delay={250}
              />
              <Kpi
                eyebrow="Net margin"
                value={margin != null ? `${margin.toFixed(1)}%` : "—"}
                accent={summary.net_cashflow >= 0 ? "#60a5fa" : "#fb7185"}
                sub={margin != null
                  ? margin > 20 ? "healthy" : margin > 10 ? "modest" : margin > 0 ? "tight" : "negative"
                  : "no income"}
                divider
                delay={350}
              />
            </section>

            {/* Chart panel */}
            {summary.category_totals.length > 0 && (
              <section style={{ marginBottom: 36, opacity: 0, animation: "rise 700ms 400ms ease-out forwards" }}>
                <div role="tablist" style={{
                  display: "flex", alignItems: "flex-end", gap: 28,
                  borderBottom: "1px solid rgba(30,41,59,0.7)",
                }}>
                  {([
                    { id: "pie",   label: "Expense Breakdown", suffix: "breakdown" },
                    { id: "bar",   label: "By Category",       suffix: "category"  },
                    { id: "trend", label: "Monthly Trend",     suffix: "trend"     },
                  ] as const).map(t => {
                    const active = activeTab === t.id;
                    return (
                      <button key={t.id} role="tab" aria-selected={active}
                        onClick={() => setActiveTab(t.id)}
                        style={{
                          position: "relative", border: "none", background: "transparent",
                          paddingBottom: 12, cursor: "pointer",
                          fontFamily: "'Manrope', system-ui, sans-serif", fontSize: 13.5,
                          color: active ? "#f1f5f9" : "#64748b",
                        }}>
                        {t.label}
                        <span style={{
                          fontFamily: "'Instrument Serif', Georgia, serif",
                          fontStyle: "italic", marginLeft: 8,
                          color: active ? "#6ee7b7" : "#3f3f46",
                        }}>{t.suffix}</span>
                        {active && (
                          <span style={{
                            position: "absolute", left: 0, right: 0, bottom: -1,
                            height: 1, background: "#34d399",
                          }} />
                        )}
                      </button>
                    );
                  })}
                  <span style={{
                    marginLeft: "auto", paddingBottom: 12,
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                    letterSpacing: "0.16em", textTransform: "uppercase", color: "#475569",
                  }}>
                    Click to switch view
                  </span>
                </div>
                <div key={activeTab} style={{
                  paddingTop: 24, minHeight: 360,
                  animation: "fade-up 220ms ease-out",
                }}>
                  {activeTab === "pie"   && <PieChartWidget   key="pie"   data={summary.category_totals} />}
                  {activeTab === "bar"   && <BarChartWidget   key="bar"   data={summary.category_totals} />}
                  {activeTab === "trend" && <TrendChartWidget key="trend" data={summary.monthly_trend}   />}
                </div>
              </section>
            )}

            {/* Editorial insights */}
            <section style={{
              opacity: 0, animation: "rise 800ms 600ms ease-out forwards",
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 14,
                marginBottom: 22,
              }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
                  color: "#475569",
                }}>
                  Editor's read
                </span>
                <div style={{ flex: 1, height: 1, background: "rgba(30,41,59,0.5)" }} />
                <Link href="/reports" style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 11, color: "#34d399", textDecoration: "none",
                  fontFamily: "'Manrope', system-ui, sans-serif",
                }}>
                  Full report <ArrowUpRight size={11} />
                </Link>
              </div>

              <h2 style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 30, color: "#e2e8f0", fontStyle: "italic",
                margin: "0 0 28px", lineHeight: 1.15, maxWidth: 760,
              }}>
                What your numbers <span style={{ color: "#34d399" }}>say</span>
              </h2>

              <div style={{
                display: "grid", gap: 18,
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              }}>
                {summary.insights.map((ins, i) => {
                  const dropMark = ins.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u)?.[0] ?? "·";
                  const body = ins.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, "");
                  return (
                    <article key={i} style={{
                      display: "grid", gridTemplateColumns: "auto 1fr", gap: 14,
                      padding: "16px 18px 16px 16px",
                      borderLeft: "1px solid rgba(52,211,153,0.3)",
                      background: "linear-gradient(90deg, rgba(52,211,153,0.04), transparent 30%)",
                      borderRadius: "0 8px 8px 0",
                      opacity: 0, animation: `rise 500ms ${700 + i * 80}ms ease-out forwards`,
                    }}>
                      <span style={{
                        fontFamily: "'Instrument Serif', Georgia, serif",
                        fontSize: 30, lineHeight: 1, fontStyle: "italic",
                        color: "#34d399", alignSelf: "flex-start",
                      }}>
                        {dropMark}
                      </span>
                      <p style={{
                        margin: 0, fontSize: 14, lineHeight: 1.55,
                        color: "#cbd5e1",
                        fontFamily: "'Manrope', system-ui, sans-serif",
                      }}>
                        {body}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>

      <style>{`
        @keyframes rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ───────── sub-components ───────── */

function Kpi({
  eyebrow, value, accent, sub, divider, delay,
}: {
  eyebrow: string; value: string; accent: string;
  sub: string; divider?: boolean; delay?: number;
}) {
  return (
    <div style={{
      padding: "26px 24px 22px",
      borderLeft: divider ? "1px solid rgba(30,41,59,0.55)" : "none",
      display: "flex", flexDirection: "column", gap: 10,
      opacity: 0, animation: `rise 600ms ${delay ?? 0}ms ease-out forwards`,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
        color: "#52525b",
      }}>
        {eyebrow}
      </div>
      <div style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: "italic", fontSize: 38, lineHeight: 1,
        color: accent, fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: "'Manrope', system-ui, sans-serif",
        fontSize: 11, color: "#52525b",
      }}>
        {sub}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "#475569",
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function DateField({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="date" value={value} onChange={e => onChange(e.target.value)}
      title={placeholder}
      style={{
        padding: "5px 8px", borderRadius: 6,
        border: "1px solid rgba(30,41,59,0.7)",
        background: "rgba(15,23,42,0.5)", color: "#cbd5e1",
        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
      }}
    />
  );
}

/* ───────── styles ───────── */

const pageBg: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0e1a",
  color: "#f8fafc",
  fontFamily: "'Manrope', system-ui, sans-serif",
  position: "relative",
  overflow: "hidden",
};

function FontImport() {
  return (
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>
  );
}

const tinyBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "5px 10px", borderRadius: 6,
  border: "1px dashed rgba(71,85,105,0.7)", background: "transparent",
  color: "#52525b", fontSize: 11, cursor: "pointer",
  fontFamily: "'Manrope', system-ui, sans-serif",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 7,
  border: "1px solid rgba(30,41,59,0.8)",
  background: "rgba(15,23,42,0.6)", color: "#e2e8f0",
  fontSize: 13, fontFamily: "'Manrope', system-ui, sans-serif",
  minWidth: 210,
};

const iconGhost: React.CSSProperties = {
  padding: 5, borderRadius: 6,
  border: "1px solid rgba(30,41,59,0.7)",
  background: "transparent", cursor: "pointer", color: "#64748b",
};

const primaryBtn = (busy: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 7,
  padding: "8px 14px", borderRadius: 8, border: "none",
  cursor: busy ? "wait" : "pointer",
  background: "#34d399", color: "#0f172a",
  fontSize: 13, fontWeight: 700,
  fontFamily: "'Manrope', system-ui, sans-serif",
  opacity: busy ? 0.6 : 1,
});

function smallBtn(tone: "emerald" | "slate"): React.CSSProperties {
  const c = tone === "emerald"
    ? { border: "rgba(52,211,153,0.4)", text: "#6ee7b7", bg: "rgba(52,211,153,0.05)" }
    : { border: "rgba(30,41,59,0.7)",   text: "#cbd5e1", bg: "transparent" };
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${c.border}`, background: c.bg,
    color: c.text, fontSize: 11.5, cursor: "pointer",
    fontFamily: "'Manrope', system-ui, sans-serif",
  };
}
