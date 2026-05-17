"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import Nav from "@/components/Nav";
import OrgSelector, { Org } from "@/components/OrgSelector";
import { TableSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import {
  Search, ChevronLeft, ChevronRight, Edit2, Check, X, Download,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface Txn {
  id: number; date?: string; description?: string;
  amount: number; currency: string; category?: string;
  gst_amount?: number; is_reconciled: boolean; batch_id: number;
}
interface TxnList {
  items: Txn[]; total: number; page: number;
  page_size: number; total_pages: number;
}

const CATEGORIES = [
  "All","Income / Revenue","Advertising & Marketing","Software & Subscriptions",
  "Logistics & Shipping","Inventory & COGS","Salaries & Payroll",
  "Rent & Utilities","GST & Tax","Banking & Finance","Travel & Meals","Uncategorised",
];

const CAT_COLOR: Record<string, string> = {
  "Income / Revenue":         "#34d399",
  "Inventory & COGS":         "#fb7185",
  "Salaries & Payroll":       "#f472b6",
  "Advertising & Marketing":  "#fbbf24",
  "GST & Tax":                "#a78bfa",
  "Logistics & Shipping":     "#60a5fa",
  "Rent & Utilities":         "#34d399",
  "Software & Subscriptions": "#22d3ee",
  "Travel & Meals":           "#f87171",
  "Banking & Finance":        "#94a3b8",
  "Uncategorised":            "#64748b",
};

const fmtINR = (v: number) => {
  const abs = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${v < 0 ? "−" : ""}₹${abs}`;
};

export default function TransactionsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [org, setOrg]           = useState<Org | null>(null);
  const [data, setData]         = useState<TxnList | null>(null);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [editId, setEditId]     = useState<number | null>(null);
  const [editCat, setEditCat]   = useState("");

  useEffect(() => { if (!localStorage.getItem("smb_token")) router.push("/login"); }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), page_size: "50" });
      if (debouncedSearch)    p.set("search",    debouncedSearch);
      if (category !== "All") p.set("category",  category);
      if (dateFrom)           p.set("date_from", dateFrom);
      if (dateTo)             p.set("date_to",   dateTo);
      const d = await apiFetch<TxnList>(`/transactions/list/${org.id}?${p}`);
      setData(d);
    } finally { setLoading(false); }
  }, [org, page, debouncedSearch, category, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [org, debouncedSearch, category, dateFrom, dateTo]);
  useEffect(() => { load(); }, [load]);

  async function saveCategory(id: number) {
    try {
      await apiFetch(`/transactions/${id}/category`, {
        method: "PATCH",
        body: JSON.stringify({ category: editCat }),
      });
      toast("Category updated", "success");
      setEditId(null);
      load();
    } catch {
      toast("Failed to update", "error");
    }
  }

  const clearFilters = () => {
    setSearch(""); setCategory("All"); setDateFrom(""); setDateTo("");
  };
  const hasFilters = !!(search || category !== "All" || dateFrom || dateTo);

  // Running totals of the current page (cheap; full-set totals would need a separate endpoint)
  const totals = useMemo(() => {
    const items = data?.items ?? [];
    let income = 0, expense = 0;
    for (const t of items) {
      if (t.amount >= 0) income += t.amount;
      else expense += t.amount;
    }
    return { income, expense, net: income + expense, count: items.length };
  }, [data]);

  const exportUrl = `${API}/transactions/export/${org?.id}${dateFrom ? `?date_from=${dateFrom}` : ""}${dateTo ? `${dateFrom ? "&" : "?"}date_to=${dateTo}` : ""}`;

  return (
    <div style={pageBg}>
      <FontImport />

      {/* Atmosphere */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        zIndex: 0,
      }} />

      <Nav />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "0 auto", padding: "32px 28px 80px" }}>

        {/* Masthead */}
        <header style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          paddingBottom: 18, borderBottom: "1px solid rgba(30,41,59,0.55)",
          marginBottom: 24, flexWrap: "wrap", gap: 16,
          opacity: 0, animation: "rise 500ms ease-out forwards",
        }}>
          <div>
            <h1 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38, lineHeight: 1, fontStyle: "italic",
              color: "#f1f5f9", margin: 0,
            }}>
              Ledger
            </h1>
            <div style={{
              marginTop: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#52525b",
            }}>
              {data ? `${data.total.toLocaleString("en-IN")} transactions` : "—"}
              {data && (debouncedSearch || category !== "All" || dateFrom || dateTo) &&
                <> · filtered view</>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {org && (
              <a href={exportUrl} download style={{
                ...smallBtn("slate"), textDecoration: "none",
              }}>
                <Download size={11} /> Export CSV
              </a>
            )}
            <OrgSelector selected={org} onSelect={setOrg} />
          </div>
        </header>

        {/* Filter bar */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
          padding: "10px 12px", marginBottom: 18,
          border: "1px solid rgba(30,41,59,0.6)",
          background: "rgba(15,23,42,0.4)",
          borderRadius: 12,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 300,
            padding: "5px 10px", borderRadius: 7,
            border: "1px solid rgba(30,41,59,0.7)",
            background: "rgba(15,23,42,0.6)",
          }}>
            <Search size={12} style={{ color: "#475569" }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search description…"
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                color: "#e2e8f0", fontSize: 12.5,
                fontFamily: "'Manrope', system-ui, sans-serif",
              }} />
          </div>
          <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <DateField value={dateFrom} onChange={setDateFrom} title="From" />
          <span style={{ color: "#334155", fontSize: 11 }}>→</span>
          <DateField value={dateTo} onChange={setDateTo} title="To" />
          {hasFilters && (
            <button onClick={clearFilters} style={smallBtn("slate")}>
              <X size={11} /> Clear filters
            </button>
          )}

          {/* Running totals chip */}
          <div style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 16,
            paddingLeft: 12, borderLeft: "1px solid rgba(30,41,59,0.6)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "#52525b", letterSpacing: "0.06em",
          }}>
            <TotalChip label="Page in" value={fmtINR(totals.income)} accent="#34d399" />
            <TotalChip label="Page out" value={fmtINR(totals.expense)} accent="#fb7185" />
            <TotalChip label="Net" value={fmtINR(totals.net)} accent={totals.net >= 0 ? "#60a5fa" : "#fb7185"} />
          </div>
        </div>

        {/* Content */}
        {!org ? (
          <div style={emptyState}>Select an organisation to view transactions.</div>
        ) : loading ? (
          <TableSkeleton rows={14} />
        ) : !data?.items.length ? (
          <div style={emptyState}>
            {hasFilters ? "No transactions match your filters." : "No transactions yet. Upload a CSV to get started."}
          </div>
        ) : (
          <>
            {/* Inbox-style row list */}
            <div style={{
              border: "1px solid rgba(30,41,59,0.6)",
              borderRadius: 12, overflow: "hidden",
              background: "rgba(10,14,26,0.4)",
            }}>
              {data.items.map((t, i) => {
                const isIncome   = t.amount >= 0;
                const isUncat    = !t.category || t.category === "Uncategorised";
                const railColor  = isUncat ? "#64748b" : isIncome ? "#34d399" : "#fb7185";
                const catColor   = t.category ? CAT_COLOR[t.category] ?? "#94a3b8" : "#64748b";
                const editing    = editId === t.id;
                return (
                  <div key={t.id} style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: "5px 86px 1fr 200px 100px 110px 28px",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 14px 10px 0",
                    borderTop: i === 0 ? "none" : "1px solid rgba(30,41,59,0.4)",
                    transition: "background 120ms",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(15,23,42,0.6)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Severity rail */}
                    <div style={{
                      width: 3, height: 28, marginLeft: 4,
                      background: railColor, borderRadius: "0 2px 2px 0",
                    }} />

                    {/* Date */}
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11, color: "#475569",
                      letterSpacing: "0.06em", textTransform: "uppercase",
                    }}>
                      {t.date ? new Date(t.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                    </div>

                    {/* Description */}
                    <div style={{
                      fontFamily: "'Manrope', system-ui, sans-serif",
                      fontSize: 13, color: "#cbd5e1",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={t.description ?? ""}>
                      {t.description || "—"}
                    </div>

                    {/* Category chip / edit */}
                    <div>
                      {editing ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <select value={editCat} onChange={e => setEditCat(e.target.value)}
                            style={{ ...selectStyle, padding: "4px 8px", fontSize: 11, minWidth: 0 }}>
                            {CATEGORIES.filter(c => c !== "All").map(c => <option key={c}>{c}</option>)}
                          </select>
                          <button onClick={() => saveCategory(t.id)} style={iconBtn("emerald")}>
                            <Check size={12} />
                          </button>
                          <button onClick={() => setEditId(null)} style={iconBtn("slate")}>
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "3px 10px", borderRadius: 99,
                          background: `${catColor}14`,
                          border: `1px solid ${catColor}33`,
                          color: catColor, fontSize: 11,
                          fontFamily: "'Manrope', system-ui, sans-serif",
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: catColor }} />
                          {t.category || "Uncategorised"}
                        </span>
                      )}
                    </div>

                    {/* GST */}
                    <div style={{
                      textAlign: "right",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11, color: "#475569",
                    }}>
                      {t.gst_amount
                        ? `₹${t.gst_amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                        : "—"}
                    </div>

                    {/* Amount in serif italic */}
                    <div style={{
                      fontFamily: "'Instrument Serif', Georgia, serif",
                      fontStyle: "italic", fontSize: 17,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: t.amount >= 0 ? "#6ee7b7" : "#fda4af",
                    }}>
                      {fmtINR(t.amount)}
                    </div>

                    {/* Edit button */}
                    <button
                      onClick={() => { setEditId(t.id); setEditCat(t.category || "Uncategorised"); }}
                      style={{
                        background: "transparent", border: "none", cursor: "pointer",
                        color: "#3f3f46", padding: 4,
                        opacity: editing ? 0 : 0.6,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#3f3f46")}
                      title="Edit category"
                    >
                      <Edit2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {data.total_pages > 1 && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginTop: 18, padding: "0 4px",
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                  color: "#475569",
                }}>
                  Page {data.page} of {data.total_pages} · {data.total.toLocaleString("en-IN")} total
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    style={{ ...pagerBtn, opacity: page === 1 ? 0.3 : 1 }}>
                    <ChevronLeft size={13} />
                  </button>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                    color: "#cbd5e1", padding: "0 10px",
                  }}>{page}</span>
                  <button onClick={() => setPage(p => Math.min(data.total_pages, p + 1))} disabled={page === data.total_pages}
                    style={{ ...pagerBtn, opacity: page === data.total_pages ? 0.3 : 1 }}>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
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

/* ───────── sub-components ───────── */

function TotalChip({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase",
        color: "#52525b",
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: "italic", fontSize: 14,
        color: accent, fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </span>
  );
}

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

const selectStyle: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 7,
  border: "1px solid rgba(30,41,59,0.7)",
  background: "rgba(15,23,42,0.6)", color: "#e2e8f0",
  fontSize: 12, fontFamily: "'Manrope', system-ui, sans-serif",
  cursor: "pointer", minWidth: 170,
};

function smallBtn(tone: "emerald" | "slate" | "rose"): React.CSSProperties {
  const c = tone === "emerald" ? { border: "rgba(52,211,153,0.4)", text: "#6ee7b7", bg: "rgba(52,211,153,0.05)" }
          : tone === "rose"    ? { border: "rgba(251,113,133,0.4)", text: "#fda4af", bg: "transparent" }
          :                       { border: "rgba(30,41,59,0.7)",  text: "#cbd5e1", bg: "transparent" };
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${c.border}`, background: c.bg,
    color: c.text, fontSize: 11.5, cursor: "pointer",
    fontFamily: "'Manrope', system-ui, sans-serif",
  };
}

function iconBtn(tone: "emerald" | "slate"): React.CSSProperties {
  const c = tone === "emerald"
    ? { color: "#34d399", border: "rgba(52,211,153,0.3)" }
    : { color: "#94a3b8", border: "rgba(30,41,59,0.7)" };
  return {
    width: 24, height: 24, borderRadius: 5,
    border: `1px solid ${c.border}`, background: "transparent",
    color: c.color, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  };
}

const pagerBtn: React.CSSProperties = {
  padding: 6, borderRadius: 6,
  border: "1px solid rgba(30,41,59,0.7)",
  background: "transparent", color: "#94a3b8", cursor: "pointer",
};

const emptyState: React.CSSProperties = {
  textAlign: "center",
  padding: "100px 24px",
  border: "1px dashed rgba(30,41,59,0.7)",
  borderRadius: 14,
  color: "#475569", fontSize: 13,
  fontFamily: "'Manrope', system-ui, sans-serif",
};
