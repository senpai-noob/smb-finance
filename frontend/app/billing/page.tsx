"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import Nav from "@/components/Nav";
import { useToast } from "@/components/Toast";
import { CheckCircle2, Loader2, Zap, Crown, Building2, Sparkles, X, ArrowRight } from "lucide-react";

interface Plan {
  id: number; name: string; display_name: string;
  price_monthly: number; price_yearly: number;
  max_orgs: number; max_txns_month: number; max_team_members: number;
  ai_insights: boolean; excel_export: boolean;
  email_reports: boolean; api_access: boolean;
}
interface SubscriptionOut {
  plan: Plan; status: string; billing_cycle: string;
  cancel_at_period_end: boolean; current_period_end?: string;
}

const PLAN_META: Record<string, { icon: React.ReactNode; accent: string; glow: string; badge?: string }> = {
  free:     { icon: <Building2 size={18} />, accent: "#64748b", glow: "rgba(100,116,139,0.12)" },
  starter:  { icon: <Zap       size={18} />, accent: "#38bdf8", glow: "rgba(56,189,248,0.12)" },
  pro:      { icon: <Sparkles  size={18} />, accent: "#a78bfa", glow: "rgba(167,139,250,0.12)", badge: "Most popular" },
  business: { icon: <Crown     size={18} />, accent: "#fbbf24", glow: "rgba(251,191,36,0.12)" },
};

const FEATURES: Array<{ key: keyof Plan; label: string }> = [
  { key: "ai_insights",   label: "AI CFO Insights" },
  { key: "excel_export",  label: "Excel P&L Export" },
  { key: "email_reports", label: "Email Reports"     },
  { key: "api_access",    label: "API Access"        },
];

function fmt(n: number) { return n === -1 ? "Unlimited" : n.toLocaleString("en-IN"); }

function BillingContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { toast }    = useToast();

  const [plans,     setPlans]     = useState<Plan[]>([]);
  const [sub,       setSub]       = useState<SubscriptionOut | null>(null);
  const [billing,   setBilling]   = useState<"monthly"|"yearly">("monthly");
  const [loading,   setLoading]   = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [cancelling,setCancelling]= useState(false);

  useEffect(() => {
    if (!localStorage.getItem("smb_token")) { router.push("/login"); return; }
    if (searchParams.get("success")   === "1") toast("Subscription activated!", "success");
    if (searchParams.get("cancelled") === "1") toast("Checkout cancelled", "info");
    Promise.all([
      apiFetch<Plan[]>("/billing/plans"),
      apiFetch<SubscriptionOut>("/billing/subscription"),
    ]).then(([p, s]) => { setPlans(p); setSub(s); })
      .catch(() => apiFetch<Plan[]>("/billing/plans").then(setPlans))
      .finally(() => setLoading(false));
  }, []);

  async function upgrade(planName: string) {
    if (planName === "free") return;
    setUpgrading(planName);
    try {
      const r = await apiFetch<{ url?: string; demo?: boolean; message?: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan_name: planName, billing_cycle: billing }),
      });
      if (r.demo || !r.url) toast(r.message || "Demo mode: plan upgraded locally", "success");
      else window.location.href = r.url;
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Upgrade failed", "error"); }
    finally { setUpgrading(null); }
  }

  async function cancel() {
    if (!confirm("Cancel subscription? You'll be downgraded to Free at period end.")) return;
    setCancelling(true);
    try {
      await apiFetch("/billing/cancel", { method: "POST" });
      toast("Subscription cancelled", "success");
      setSub(await apiFetch<SubscriptionOut>("/billing/subscription"));
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
    finally { setCancelling(false); }
  }

  const currentPlan = sub?.plan.name || "free";

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Loader2 size={28} style={{ color: "#34d399" }} className="animate-spin" />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#f8fafc", fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />

      <Nav />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px 80px" }}>

        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#475569", marginBottom: 16 }}>Pricing</div>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: "clamp(32px,5vw,52px)", color: "#f8fafc", margin: "0 0 12px", lineHeight: 1.1 }}>
            Simple, <em style={{ fontStyle: "italic", color: "#475569" }}>transparent</em> pricing
          </h1>
          <p style={{ fontSize: 14, color: "#475569", maxWidth: 460, margin: "0 auto 28px" }}>
            Built for Indian SMBs and Shopify sellers. No hidden fees. Cancel anytime.
          </p>

          <div style={{
            display: "inline-flex", padding: 4, borderRadius: 99,
            border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.6)",
          }}>
            {(["monthly", "yearly"] as const).map(cycle => (
              <button key={cycle} onClick={() => setBilling(cycle)} style={{
                padding: "7px 18px", borderRadius: 99, border: "none", cursor: "pointer",
                background: billing === cycle ? "#f1f5f9" : "transparent",
                color: billing === cycle ? "#0f172a" : "#475569",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                transition: "all 150ms", display: "flex", alignItems: "center", gap: 6,
              }}>
                {cycle === "yearly" ? "Yearly" : "Monthly"}
                {cycle === "yearly" && billing === "yearly" && (
                  <span style={{ fontSize: 10, color: "#34d399", background: "rgba(52,211,153,0.12)", padding: "2px 6px", borderRadius: 99 }}>Save 17%</span>
                )}
                {cycle === "yearly" && billing !== "yearly" && (
                  <span style={{ fontSize: 10, color: "#34d399" }}>−17%</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {sub && (
          <div style={{
            marginBottom: 40, padding: "14px 20px",
            borderRadius: 14, border: "1px solid rgba(30,41,59,0.8)",
            background: "rgba(15,23,42,0.5)",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ color: PLAN_META[currentPlan]?.accent ?? "#64748b" }}>
                {PLAN_META[currentPlan]?.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>
                  Current plan: <span style={{ color: PLAN_META[currentPlan]?.accent ?? "#64748b" }}>{sub.plan.display_name}</span>
                </div>
                <div style={{ fontSize: 11, color: "#475569" }}>
                  Status: {sub.status}
                  {sub.cancel_at_period_end && " · Cancels at period end"}
                  {sub.current_period_end && ` · Renews ${new Date(sub.current_period_end).toLocaleDateString("en-IN")}`}
                </div>
              </div>
            </div>
            {sub.plan.name !== "free" && !sub.cancel_at_period_end && (
              <button onClick={cancel} disabled={cancelling} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                borderRadius: 8, border: "1px solid rgba(30,41,59,0.8)", background: "transparent",
                color: "#475569", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                transition: "all 150ms",
              }}
                onMouseEnter={e => { (e.currentTarget.style.color = "#fb7185"); (e.currentTarget.style.borderColor = "rgba(251,113,133,0.4)"); }}
                onMouseLeave={e => { (e.currentTarget.style.color = "#475569"); (e.currentTarget.style.borderColor = "rgba(30,41,59,0.8)"); }}
              >
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                Cancel subscription
              </button>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 48 }}>
          {plans.map(plan => {
            const meta     = PLAN_META[plan.name] ?? PLAN_META.free;
            const isCurrent= plan.name === currentPlan;
            const price    = billing === "yearly" ? Math.round(plan.price_yearly / 12) : plan.price_monthly;

            return (
              <div key={plan.name} style={{
                position: "relative", overflow: "hidden",
                borderRadius: 18, padding: "28px 24px",
                border: `1px solid ${isCurrent ? meta.accent + "44" : "rgba(30,41,59,0.8)"}`,
                background: "rgba(15,23,42,0.5)",
                display: "flex", flexDirection: "column",
                boxShadow: isCurrent ? `0 0 40px ${meta.glow}` : "none",
                transition: "all 200ms",
              }}>
                <div style={{ position: "absolute", top: -40, right: -40, width: 100, height: 100,
                  borderRadius: "50%", background: meta.glow, filter: "blur(28px)", opacity: 0.9 }} />

                {meta.badge && (
                  <div style={{
                    position: "absolute", top: 16, right: 16,
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    color: meta.accent, background: meta.accent + "18",
                    padding: "3px 8px", borderRadius: 99,
                  }}>
                    {meta.badge}
                  </div>
                )}

                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, color: meta.accent }}>
                    {meta.icon}
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>{plan.display_name}</span>
                    {isCurrent && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "#34d399", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 99, padding: "2px 8px" }}>
                        Current
                      </span>
                    )}
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, color: "#f8fafc", lineHeight: 1 }}>
                      {price === 0 ? "Free" : `₹${price.toLocaleString("en-IN")}`}
                    </div>
                    {price > 0 && (
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                        /month{billing === "yearly" ? " · billed yearly" : ""}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid rgba(30,41,59,0.8)", display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      `${fmt(plan.max_orgs)} org${plan.max_orgs !== 1 ? "s" : ""}`,
                      `${fmt(plan.max_txns_month)} txns/month`,
                      `${fmt(plan.max_team_members)} member${plan.max_team_members !== 1 ? "s" : ""}`,
                    ].map(l => (
                      <div key={l} style={{ fontSize: 12, color: "#64748b" }}>{l}</div>
                    ))}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24, flex: 1 }}>
                    {FEATURES.map(({ key, label }) => (
                      <div key={String(key)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: plan[key] ? "#cbd5e1" : "#334155" }}>
                        {plan[key]
                          ? <CheckCircle2 size={12} style={{ color: "#34d399", flexShrink: 0 }} />
                          : <span style={{ width: 12, height: 12, borderRadius: "50%", border: "1px solid #1e293b", display: "inline-block", flexShrink: 0 }} />
                        }
                        {label}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => upgrade(plan.name)}
                    disabled={isCurrent || !!upgrading || plan.name === "free"}
                    style={{
                      width: "100%", padding: "11px", borderRadius: 10, border: "none", cursor: isCurrent || plan.name === "free" ? "default" : "pointer",
                      background: isCurrent ? "rgba(30,41,59,0.6)" : plan.name === "free" ? "rgba(30,41,59,0.4)" : meta.accent,
                      color: isCurrent || plan.name === "free" ? "#334155" : plan.name === "business" ? "#0f172a" : "#0f172a",
                      fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                      transition: "all 150ms", opacity: !!upgrading && upgrading !== plan.name ? 0.5 : 1,
                    }}>
                    {upgrading === plan.name
                      ? <><Loader2 size={13} className="animate-spin" />Processing…</>
                      : isCurrent ? "Current plan"
                      : plan.name === "free" ? "Free forever"
                      : <>{`Upgrade to ${plan.display_name}`}<ArrowRight size={13} /></>
                    }
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ borderRadius: 16, border: "1px solid rgba(30,41,59,0.8)", background: "rgba(15,23,42,0.3)", overflow: "hidden", overflowX: "auto", marginBottom: 32 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(30,41,59,0.8)" }}>
                <th style={{ padding: "14px 20px", textAlign: "left", fontSize: 11, color: "#475569", fontWeight: 500 }}>Feature</th>
                {plans.map(p => (
                  <th key={p.name} style={{ padding: "14px 16px", textAlign: "center", fontSize: 11, fontWeight: 600,
                    color: p.name === currentPlan ? PLAN_META[p.name]?.accent ?? "#64748b" : "#475569" }}>
                    {p.display_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Organisations",      vals: plans.map(p => fmt(p.max_orgs)) },
                { label: "Transactions/month", vals: plans.map(p => fmt(p.max_txns_month)) },
                { label: "Team members",       vals: plans.map(p => fmt(p.max_team_members)) },
                { label: "AI CFO Insights",    vals: plans.map(p => p.ai_insights) },
                { label: "Excel P&L Export",   vals: plans.map(p => p.excel_export) },
                { label: "Email Reports",      vals: plans.map(p => p.email_reports) },
                { label: "API Access",         vals: plans.map(p => p.api_access) },
                { label: "GST Reconciliation", vals: plans.map(() => true) },
                { label: "CSV Upload",         vals: plans.map(() => true) },
              ].map((row, ri) => (
                <tr key={row.label} style={{ borderBottom: "1px solid rgba(30,41,59,0.5)", background: ri % 2 === 0 ? "transparent" : "rgba(30,41,59,0.1)" }}>
                  <td style={{ padding: "11px 20px", color: "#94a3b8" }}>{row.label}</td>
                  {row.vals.map((v, i) => (
                    <td key={i} style={{ padding: "11px 16px", textAlign: "center" }}>
                      {typeof v === "boolean"
                        ? v
                          ? <CheckCircle2 size={14} style={{ color: "#34d399", margin: "0 auto" }} />
                          : <span style={{ color: "#1e293b" }}>—</span>
                        : <span style={{ fontSize: 12, color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>{v}</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#1e293b" }}>
          Payments powered by Stripe · All prices in INR + GST applicable ·{" "}
          <button onClick={() => router.push("/settings")} style={{ background: "none", border: "none", cursor: "pointer", color: "#334155", fontSize: 11, textDecoration: "underline", fontFamily: "inherit" }}>
            Manage billing
          </button>
        </p>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={28} style={{ color: "#34d399" }} className="animate-spin" /></div>}>
      <BillingContent />
    </Suspense>
  );
}
