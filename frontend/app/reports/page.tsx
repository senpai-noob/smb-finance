"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiDownload } from "@/lib/api";
import Nav from "@/components/Nav";
import OrgSelector, { Org } from "@/components/OrgSelector";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import {
  TrendingUp, TrendingDown, Minus, Mail, Loader2, Sparkles,
  FileSpreadsheet, X, ArrowUpRight,
} from "lucide-react";

const MonthlyTrendChart = dynamic(
  () => import("@/components/ExpenseChart").then(m => ({ default: m.MonthlyTrendChart })),
  { ssr: false, loading: () => (
    <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Loader2 size={20} style={{ color: "#34d399" }} className="animate-spin" />
    </div>
  ) }
);

interface CategoryTotal { category: string; total: number; count: number; percentage: number; }
interface MonthlyPoint  { month: string; month_label: string; income: number; expenses: number; net: number; }
interface Summary {
  period_label: string;
  total_income: number; total_expenses: number; net_cashflow: number;
  transaction_count: number;
  category_totals: CategoryTotal[];
  monthly_trend: MonthlyPoint[];
  insights: string[];
}
interface GSTLine { category: string; taxable_amount: number; gst_amount: number; cgst: number; sgst: number; igst: number; }
interface GSTSummary {
  period_label: string;
  total_taxable: number; total_gst: number; total_cgst: number; total_sgst: number; total_igst: number;
  lines: GSTLine[];
}

const fmt = (v: number) => `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtSigned = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

type Tab = "pl" | "gst" | "monthly";

export default function ReportsPage() {
  const router    = useRouter();
  const { toast } = useToast();

  const [org, setOrg]             = useState<Org | null>(null);
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [gst, setGST]             = useState<GSTSummary | null>(null);
  const [loading, setLoading]     = useState(false);
  const [tab, setTab]             = useState<Tab>("pl");
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [insights, setInsights]   = useState<string[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [llmUsed, setLlmUsed]     = useState(false);
  const [emailTo, setEmailTo]     = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  useEffect(() => { if (!localStorage.getItem("smb_token")) router.push("/login"); }, []);

  useEffect(() => {
    if (!org) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo)   p.set("date_to",   dateTo);
    const qs = p.toString() ? `?${p}` : "";
    Promise.all([
      apiFetch<Summary>(`/transactions/summary/${org.id}${qs}`),
      apiFetch<GSTSummary>(`/transactions/gst-summary/${org.id}${qs}`),
    ]).then(([s, g]) => { setSummary(s); setGST(g); setInsights(s.insights); setLlmUsed(false); })
      .finally(() => setLoading(false));
  }, [org, dateFrom, dateTo]);

  async function downloadExcel() {
    if (!org) return;
    setDownloadingExcel(true);
    try {
      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo)   p.set("date_to",   dateTo);
      const qs = p.toString() ? `?${p}` : "";
      const filename = `claritybooks-${org.slug || org.id}-${summary?.period_label?.replace(/[^a-z0-9]/gi, "-") || "report"}.xlsx`;
      await apiDownload(`/reports/excel/${org.id}${qs}`, filename);
      toast("Excel downloaded", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Download failed", "error");
    } finally { setDownloadingExcel(false); }
  }

  async function refreshInsights() {
    if (!org) return;
    setLoadingInsights(true);
    try {
      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo)   p.set("date_to",   dateTo);
      const qs = p.toString() ? `?${p}` : "";
      const r = await apiFetch<{ insights: string[]; llm_used: boolean; period_label: string }>(
        `/reports/insights/${org.id}${qs}`
      );
      setInsights(r.insights);
      setLlmUsed(r.llm_used);
      toast(r.llm_used ? "AI insights refreshed" : "Insights refreshed", "success");
    } catch { toast("Failed to refresh insights", "error"); }
    finally  { setLoadingInsights(false); }
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !emailTo) return;
    setSendingEmail(true);
    try {
      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo)   p.set("date_to",   dateTo);
      const qs = p.toString() ? `?${p}` : "";
      await apiFetch(`/reports/email/${org.id}${qs}`, {
        method: "POST",
        body: JSON.stringify({ to_email: emailTo, attach_excel: true }),
      });
      toast(`Report sent to ${emailTo}`, "success");
      setShowEmailForm(false); setEmailTo("");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to send", "error");
    } finally { setSendingEmail(false); }
  }

  const currentFY = (() => {
    const now = new Date();
    const yr  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: `${yr}-04-01`, to: `${yr + 1}-03-31`, label: `FY ${yr}–${String(yr + 1).slice(2)}` };
  })();

  const expenseLines = summary?.category_totals.filter(c => c.total < 0 && c.category !== "Income / Revenue") ?? [];
  const incomeLine   = summary?.category_totals.find(c => c.category === "Income / Revenue");
  const margin = summary && summary.total_income > 0
    ? (summary.net_cashflow / summary.total_income) * 100
    : null;

  return (
    <div style={pageBg}>
      <FontImport />

      {/* Atmosphere */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        zIndex: 0,
      }} />

      <Nav />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1080, margin: "0 auto", padding: "32px 28px 80px" }}>

        {/* Masthead */}
        <header style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          paddingBottom: 18, borderBottom: "1px solid rgba(30,41,59,0.55)",
          marginBottom: 28, flexWrap: "wrap", gap: 16,
          opacity: 0, animation: "rise 500ms ease-out forwards",
        }}>
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#52525b", marginBottom: 8,
            }}>
              Statement of accounts
            </div>
            <h1 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38, lineHeight: 1, fontStyle: "italic",
              color: "#f1f5f9", margin: 0,
            }}>
              Reports
            </h1>
            <div style={{
              marginTop: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#475569",
            }}>
              {summary?.period_label ?? "—"}
            </div>
          </div>
          <OrgSelector selected={org} onSelect={setOrg} />
        </header>

        {/* Period controls + actions */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
          padding: "10px 12px", marginBottom: 22,
          border: "1px solid rgba(30,41,59,0.6)",
          background: "rgba(15,23,42,0.4)",
          borderRadius: 12,
        }}>
          <button onClick={() => { setDateFrom(currentFY.from); setDateTo(currentFY.to); }} style={chipBtn(false)}>
            {currentFY.label}
          </button>
          <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={chipBtn(false)}>
            All time
          </button>
          <DateField value={dateFrom} onChange={setDateFrom} title="From" />
          <span style={{ color: "#334155", fontSize: 11 }}>→</span>
          <DateField value={dateTo} onChange={setDateTo} title="To" />

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {org && summary && summary.transaction_count > 0 && (
              <>
                <button onClick={refreshInsights} disabled={loadingInsights} style={smallBtn("amber")}>
                  {loadingInsights ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {llmUsed ? "Refresh AI insights" : "Generate insights"}
                </button>
                <button onClick={() => setShowEmailForm(f => !f)} style={smallBtn("slate")}>
                  <Mail size={11} /> Email
                </button>
                <button onClick={downloadExcel} disabled={downloadingExcel} style={smallBtn("emerald")}>
                  {downloadingExcel ? <Loader2 size={11} className="animate-spin" /> : <FileSpreadsheet size={11} />}
                  Excel
                </button>
              </>
            )}
          </div>
        </div>

        {showEmailForm && (
          <form onSubmit={sendEmail} style={{
            display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end",
            padding: 14, marginBottom: 22,
            border: "1px solid rgba(56,189,248,0.25)",
            background: "rgba(56,189,248,0.04)", borderRadius: 12,
          }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={{
                display: "block",
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                letterSpacing: "0.14em", textTransform: "uppercase",
                color: "#475569", marginBottom: 6,
              }}>
                Send P&L to
              </label>
              <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} required
                placeholder="accountant@example.com"
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 7,
                  border: "1px solid rgba(56,189,248,0.3)",
                  background: "rgba(15,23,42,0.6)", color: "#e2e8f0",
                  fontSize: 13, fontFamily: "'Manrope', system-ui, sans-serif",
                }} />
            </div>
            <button type="submit" disabled={sendingEmail} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
              background: "#38bdf8", color: "#0f172a",
              fontSize: 12.5, fontWeight: 700,
              fontFamily: "'Manrope', system-ui, sans-serif",
              opacity: sendingEmail ? 0.6 : 1,
            }}>
              {sendingEmail ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
              Send with Excel attachment
            </button>
            <button type="button" onClick={() => setShowEmailForm(false)} style={smallBtn("slate")}>
              <X size={11} /> Cancel
            </button>
            <p style={{
              width: "100%", margin: 0, marginTop: 4,
              fontSize: 11, color: "#475569",
              fontFamily: "'Manrope', system-ui, sans-serif",
            }}>
              Requires SMTP config in <code style={{ color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>backend/.env</code>.
            </p>
          </form>
        )}

        {!org ? (
          <div style={emptyState}>Select an organisation to view reports.</div>
        ) : loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-96" />
          </div>
        ) : (
          <>
            {/* Editorial tab strip */}
            <div role="tablist" style={{
              display: "flex", alignItems: "flex-end", gap: 28,
              borderBottom: "1px solid rgba(30,41,59,0.7)",
              marginBottom: 28,
            }}>
              {([
                { id: "pl",      label: "Profit & Loss",  suffix: "statement" },
                { id: "gst",     label: "GST",            suffix: "input credit" },
                { id: "monthly", label: "Monthly",        suffix: "trend" },
              ] as const).map(t => {
                const active = tab === t.id;
                return (
                  <button key={t.id} role="tab" aria-selected={active}
                    onClick={() => setTab(t.id)}
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
                {summary ? `${summary.transaction_count.toLocaleString("en-IN")} txns` : "—"}
              </span>
            </div>

            <div key={tab} style={{ animation: "rise 350ms ease-out" }}>
              {tab === "pl" && summary && (
                <PLStatement
                  summary={summary}
                  expenseLines={expenseLines}
                  incomeLine={incomeLine}
                  margin={margin}
                  insights={insights}
                  llmUsed={llmUsed}
                />
              )}
              {tab === "gst" && gst && <GSTReport gst={gst} />}
              {tab === "monthly" && summary && <MonthlyReport summary={summary} />}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ───────── Profit & Loss ───────── */

function PLStatement({
  summary, expenseLines, incomeLine, margin, insights, llmUsed,
}: {
  summary: Summary;
  expenseLines: CategoryTotal[];
  incomeLine?: CategoryTotal;
  margin: number | null;
  insights: string[];
  llmUsed: boolean;
}) {
  return (
    <article style={{
      padding: "32px 0",
    }}>
      {/* REVENUE */}
      <SectionHeading kicker="01" title="Revenue" accent="#34d399" />
      <Row
        label="Total income"
        sub={incomeLine ? `${incomeLine.count.toLocaleString("en-IN")} transactions` : undefined}
        value={fmt(summary.total_income)}
        accent="#34d399"
      />

      {/* EXPENSES */}
      <SectionHeading kicker="02" title="Expenses" accent="#fb7185" />
      {expenseLines.map(c => (
        <Row
          key={c.category}
          label={c.category}
          sub={`${c.count} txns · ${c.percentage.toFixed(1)}% of spend`}
          value={fmt(c.total)}
          accent="#fb7185"
        />
      ))}
      <Row
        label="Total expenses"
        value={fmt(summary.total_expenses)}
        accent="#fb7185"
        emphasised
      />

      {/* NET */}
      <div style={{
        marginTop: 28, paddingTop: 22,
        borderTop: "1px solid rgba(30,41,59,0.55)",
        display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 16,
      }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
            color: "#52525b", marginBottom: 8,
          }}>
            Bottom line
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontStyle: "italic", fontSize: 30, color: "#f1f5f9",
            lineHeight: 1,
          }}>
            {summary.net_cashflow > 0 ? <TrendingUp size={22} style={{ color: "#34d399" }} />
              : summary.net_cashflow < 0 ? <TrendingDown size={22} style={{ color: "#fb7185" }} />
              : <Minus size={22} style={{ color: "#94a3b8" }} />}
            Net cashflow
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontStyle: "italic", fontSize: 56, lineHeight: 1,
            color: summary.net_cashflow >= 0 ? "#6ee7b7" : "#fda4af",
            fontVariantNumeric: "tabular-nums",
          }}>
            {fmtSigned(summary.net_cashflow)}
          </div>
          {margin != null && (
            <div style={{
              marginTop: 6,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "#52525b",
            }}>
              {margin.toFixed(1)}% net margin
            </div>
          )}
        </div>
      </div>

      {/* CFO insights */}
      {insights.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 18,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#475569",
            }}>
              {llmUsed ? "AI commentary" : "Commentary"}
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(30,41,59,0.5)" }} />
          </div>

          <div style={{
            display: "grid", gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          }}>
            {insights.map((ins, i) => {
              const drop = ins.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u)?.[0] ?? "·";
              const body = ins.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, "");
              return (
                <article key={i} style={{
                  display: "grid", gridTemplateColumns: "auto 1fr", gap: 12,
                  padding: "12px 14px 12px 12px",
                  borderLeft: "1px solid rgba(52,211,153,0.3)",
                  background: "linear-gradient(90deg, rgba(52,211,153,0.04), transparent 30%)",
                  borderRadius: "0 8px 8px 0",
                }}>
                  <span style={{
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    fontStyle: "italic", fontSize: 26, color: "#34d399",
                    lineHeight: 1, alignSelf: "flex-start",
                  }}>
                    {drop}
                  </span>
                  <p style={{
                    margin: 0, fontSize: 13, lineHeight: 1.55,
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
      )}
    </article>
  );
}

function SectionHeading({ kicker, title, accent }: { kicker: string; title: string; accent: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 14,
      marginTop: 28, marginBottom: 6,
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.2em", color: "#3f3f46",
      }}>
        {kicker}
      </span>
      <h2 style={{
        margin: 0,
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontSize: 22, fontStyle: "italic",
        color: accent,
      }}>
        {title}
      </h2>
      <div style={{ flex: 1, height: 1, background: `${accent}1f`, marginBottom: 6 }} />
    </div>
  );
}

function Row({
  label, sub, value, accent, emphasised,
}: {
  label: string;
  sub?: string;
  value: string;
  accent?: string;
  emphasised?: boolean;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto", alignItems: "baseline",
      gap: 16, padding: "12px 4px",
      borderBottom: emphasised ? "none" : "1px dotted rgba(30,41,59,0.55)",
      borderTop: emphasised ? "1px solid rgba(30,41,59,0.6)" : "none",
      marginTop: emphasised ? 6 : 0,
    }}>
      <div>
        <div style={{
          fontFamily: "'Manrope', system-ui, sans-serif",
          fontSize: emphasised ? 14 : 13.5,
          fontWeight: emphasised ? 600 : 500,
          color: emphasised ? "#e2e8f0" : "#cbd5e1",
        }}>
          {label}
        </div>
        {sub && (
          <div style={{
            marginTop: 2,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
            color: "#52525b",
          }}>
            {sub}
          </div>
        )}
      </div>
      <div style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: "italic", fontSize: emphasised ? 26 : 20,
        color: accent ?? "#cbd5e1",
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
      }}>
        {value}
      </div>
    </div>
  );
}

/* ───────── GST report ───────── */

function GSTReport({ gst }: { gst: GSTSummary }) {
  return (
    <article style={{ padding: "16px 0" }}>
      {/* Top summary strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        borderTop: "1px solid rgba(30,41,59,0.55)",
        borderBottom: "1px solid rgba(30,41,59,0.55)",
        marginBottom: 28,
      }}>
        <GSTBlock label="Taxable"     value={fmt(gst.total_taxable)} accent="#94a3b8" />
        <GSTBlock label="GST (ITC)"   value={fmt(gst.total_gst)}     accent="#fbbf24" divider />
        <GSTBlock label="CGST (9%)"   value={fmt(gst.total_cgst)}    accent="#94a3b8" divider />
        <GSTBlock label="SGST (9%)"   value={fmt(gst.total_sgst)}    accent="#94a3b8" divider />
      </div>

      <SectionHeading kicker="·" title="By category" accent="#fbbf24" />

      <div style={{ marginTop: 8, marginBottom: 18 }}>
        {/* Column header */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 140px 130px 110px 110px",
          gap: 12, padding: "8px 4px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
          color: "#475569",
          borderBottom: "1px solid rgba(30,41,59,0.5)",
        }}>
          <span>Category</span>
          <span style={{ textAlign: "right" }}>Taxable</span>
          <span style={{ textAlign: "right" }}>GST 18%</span>
          <span style={{ textAlign: "right" }}>CGST</span>
          <span style={{ textAlign: "right" }}>SGST</span>
        </div>
        {gst.lines.map(l => (
          <div key={l.category} style={{
            display: "grid", gridTemplateColumns: "1fr 140px 130px 110px 110px",
            gap: 12, padding: "11px 4px",
            borderBottom: "1px dotted rgba(30,41,59,0.55)",
            alignItems: "baseline",
          }}>
            <span style={{
              fontFamily: "'Manrope', system-ui, sans-serif", fontSize: 13,
              color: "#cbd5e1",
            }}>
              {l.category}
            </span>
            <span style={cellSerif("#94a3b8")}>{fmt(l.taxable_amount)}</span>
            <span style={cellSerif("#fbbf24")}>{fmt(l.gst_amount)}</span>
            <span style={cellSerif("#94a3b8")}>{fmt(l.cgst)}</span>
            <span style={cellSerif("#94a3b8")}>{fmt(l.sgst)}</span>
          </div>
        ))}
        {/* Total row */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 140px 130px 110px 110px",
          gap: 12, padding: "14px 4px 6px",
          borderTop: "1px solid rgba(30,41,59,0.6)",
          alignItems: "baseline",
        }}>
          <span style={{
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: 13.5, fontWeight: 600, color: "#e2e8f0",
          }}>
            Total
          </span>
          <span style={cellSerif("#cbd5e1", 22)}>{fmt(gst.total_taxable)}</span>
          <span style={cellSerif("#fbbf24", 24)}>{fmt(gst.total_gst)}</span>
          <span style={cellSerif("#cbd5e1", 22)}>{fmt(gst.total_cgst)}</span>
          <span style={cellSerif("#cbd5e1", 22)}>{fmt(gst.total_sgst)}</span>
        </div>
      </div>

      <p style={{
        marginTop: 18, padding: "10px 12px",
        borderLeft: "2px solid rgba(251,191,36,0.4)",
        background: "linear-gradient(90deg, rgba(251,191,36,0.04), transparent 30%)",
        fontFamily: "'Manrope', system-ui, sans-serif",
        fontSize: 12, color: "#94a3b8", fontStyle: "italic",
      }}>
        GST estimated at 18%. Verify with your CA before GSTR-3B filing.
      </p>
    </article>
  );
}

function GSTBlock({
  label, value, accent, divider,
}: { label: string; value: string; accent: string; divider?: boolean }) {
  return (
    <div style={{
      padding: "22px 22px 18px",
      borderLeft: divider ? "1px solid rgba(30,41,59,0.55)" : "none",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
        color: "#52525b",
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: "italic", fontSize: 32, lineHeight: 1,
        color: accent, fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
    </div>
  );
}

function cellSerif(color: string, size: number = 18): React.CSSProperties {
  return {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontStyle: "italic", fontSize: size,
    color, fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  };
}

/* ───────── Monthly report ───────── */

function MonthlyReport({ summary }: { summary: Summary }) {
  return (
    <article style={{ padding: "8px 0" }}>
      <section style={{
        padding: 20,
        border: "1px solid rgba(30,41,59,0.55)",
        borderRadius: 12,
        background: "rgba(15,23,42,0.3)",
        marginBottom: 28,
      }}>
        <MonthlyTrendChart data={summary.monthly_trend} />
      </section>

      {summary.monthly_trend.length > 0 && (
        <section>
          <SectionHeading kicker="·" title="Month by month" accent="#60a5fa" />
          <div style={{ marginTop: 10 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr 80px",
              gap: 12, padding: "8px 4px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
              color: "#475569",
              borderBottom: "1px solid rgba(30,41,59,0.5)",
            }}>
              <span>Month</span>
              <span style={{ textAlign: "right" }}>Income</span>
              <span style={{ textAlign: "right" }}>Expenses</span>
              <span style={{ textAlign: "right" }}>Net</span>
              <span style={{ textAlign: "right" }}>Margin</span>
            </div>
            {summary.monthly_trend.map(m => {
              const margin = m.income > 0 ? (m.net / m.income * 100) : 0;
              return (
                <div key={m.month} style={{
                  display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr 80px",
                  gap: 12, padding: "11px 4px",
                  borderBottom: "1px dotted rgba(30,41,59,0.55)",
                  alignItems: "baseline",
                }}>
                  <span style={{
                    fontFamily: "'Manrope', system-ui, sans-serif",
                    fontSize: 13, color: "#cbd5e1",
                  }}>
                    {m.month_label}
                  </span>
                  <span style={cellSerif("#6ee7b7", 17)}>{fmt(m.income)}</span>
                  <span style={cellSerif("#fda4af", 17)}>{fmt(m.expenses)}</span>
                  <span style={cellSerif(m.net >= 0 ? "#6ee7b7" : "#fda4af", 19)}>
                    {fmtSigned(m.net)}
                  </span>
                  <span style={{
                    textAlign: "right",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, color: margin >= 0 ? "#94a3b8" : "#fda4af",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {margin.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </article>
  );
}

/* ───────── sub-components ───────── */

function DateField({
  value, onChange, title,
}: { value: string; onChange: (v: string) => void; title: string }) {
  return (
    <input type="date" value={value} onChange={e => onChange(e.target.value)} title={title}
      style={{
        padding: "5px 8px", borderRadius: 6,
        border: "1px solid rgba(30,41,59,0.7)",
        background: "rgba(15,23,42,0.5)", color: "#cbd5e1",
        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
      }} />
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

function chipBtn(active: boolean): React.CSSProperties {
  return {
    padding: "5px 11px", borderRadius: 99,
    border: `1px solid ${active ? "rgba(52,211,153,0.4)" : "rgba(30,41,59,0.7)"}`,
    background: active ? "rgba(52,211,153,0.06)" : "transparent",
    color: active ? "#6ee7b7" : "#94a3b8",
    fontSize: 11, cursor: "pointer",
    fontFamily: "'Manrope', system-ui, sans-serif",
  };
}

function smallBtn(tone: "emerald" | "slate" | "amber"): React.CSSProperties {
  const c = tone === "emerald" ? { border: "rgba(52,211,153,0.4)", text: "#6ee7b7", bg: "rgba(52,211,153,0.05)" }
          : tone === "amber"   ? { border: "rgba(251,191,36,0.4)", text: "#fcd34d", bg: "rgba(251,191,36,0.04)" }
          :                       { border: "rgba(30,41,59,0.7)",  text: "#cbd5e1", bg: "transparent" };
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${c.border}`, background: c.bg,
    color: c.text, fontSize: 11.5, cursor: "pointer",
    fontFamily: "'Manrope', system-ui, sans-serif",
  };
}

const emptyState: React.CSSProperties = {
  textAlign: "center",
  padding: "100px 24px",
  border: "1px dashed rgba(30,41,59,0.7)",
  borderRadius: 14,
  color: "#475569", fontSize: 13,
  fontFamily: "'Manrope', system-ui, sans-serif",
};
