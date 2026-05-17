"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import Nav from "@/components/Nav";
import { useToast } from "@/components/Toast";
import {
  CheckCircle2, XCircle, Loader2, Shield, Building2,
  Users, Plus, Trash2, Copy, RefreshCw, Crown,
  Eye, Pencil, Key, AlertTriangle, Clock,
  User as UserIcon,
} from "lucide-react";

interface UserMe   { id: number; name: string; email: string; }
interface Org      { id: number; name: string; slug: string; gst_number?: string; }
interface Member   { id: number; user_id: number; role: string; name: string; email: string; }
interface Invite   { id: number; email: string; role: string; accepted: boolean; expires_at: string; invite_url?: string; }
interface GSTINRes { valid: boolean; state?: string; pan?: string; state_code?: string; error?: string; }
interface AuditLog { id: number; action: string; user_id?: number; resource?: string; detail?: string; ip_address?: string; created_at: string; }
interface APIKey   { id: number; name: string; key_prefix: string; is_active: boolean; created_at: string; last_used?: string; }

type Tab = "org" | "team" | "keys" | "audit" | "gstin";

const TABS: Array<{
  id: Tab;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  kicker: string;
}> = [
  { id: "org",   label: "Organisation", icon: Building2, kicker: "01" },
  { id: "team",  label: "Team",         icon: Users,     kicker: "02" },
  { id: "keys",  label: "API Keys",     icon: Key,       kicker: "03" },
  { id: "audit", label: "Audit Log",    icon: Clock,     kicker: "04" },
  { id: "gstin", label: "GSTIN Tool",   icon: Shield,    kicker: "05" },
];

const ROLE_COLOR: Record<string, { border: string; text: string; bg: string }> = {
  owner:  { border: "rgba(251,191,36,0.35)", text: "#fcd34d", bg: "rgba(251,191,36,0.06)" },
  admin:  { border: "rgba(56,189,248,0.35)", text: "#7dd3fc", bg: "rgba(56,189,248,0.06)" },
  viewer: { border: "rgba(148,163,184,0.3)", text: "#cbd5e1", bg: "transparent" },
};

const ROLE_ICON: Record<string, React.ReactNode> = {
  owner:  <Crown  size={11} />,
  admin:  <Pencil size={11} />,
  viewer: <Eye    size={11} />,
};

export default function SettingsPage() {
  const router    = useRouter();
  const { toast } = useToast();

  const [me, setMe]       = useState<UserMe | null>(null);
  const [orgs, setOrgs]   = useState<Org[]>([]);
  const [org, setOrg]     = useState<Org | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgGST, setOrgGST]   = useState("");
  const [saving, setSaving]   = useState(false);

  const [members, setMembers]   = useState<Member[]>([]);
  const [invites, setInvites]   = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState("viewer");
  const [inviting, setInviting]       = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState("");

  const [gstinInput, setGstinInput]     = useState("");
  const [gstinResult, setGstinResult]   = useState<GSTINRes | null>(null);
  const [validating, setValidating]     = useState(false);

  const [apiKeys, setApiKeys]           = useState<APIKey[]>([]);
  const [newKeyName, setNewKeyName]     = useState("");
  const [creatingKey, setCreatingKey]   = useState(false);
  const [revealedKey, setRevealedKey]   = useState<string>("");

  const [auditLogs, setAuditLogs]       = useState<AuditLog[]>([]);

  const [tab, setTab] = useState<Tab>("org");

  useEffect(() => {
    if (!localStorage.getItem("smb_token")) { router.push("/login"); return; }
    apiFetch<UserMe>("/auth/me").then(setMe).catch(() => router.push("/login"));
    apiFetch<Org[]>("/orgs/").then(data => { setOrgs(data); if (data.length > 0) setOrg(data[0]); });
  }, []);

  useEffect(() => {
    if (!org) return;
    setOrgName(org.name); setOrgGST(org.gst_number || "");
    loadTeam(org.id);
    loadKeys(org.id);
    loadAudit(org.id);
  }, [org]);

  const loadTeam = useCallback(async (id: number) => {
    const [m, i] = await Promise.all([
      apiFetch<Member[]>(`/invites/${id}/members`).catch(() => []),
      apiFetch<Invite[]>(`/invites/${id}`).catch(() => []),
    ]);
    setMembers(m); setInvites(i);
  }, []);

  const loadKeys = useCallback(async (id: number) => {
    apiFetch<APIKey[]>(`/api-keys/${id}`).then(setApiKeys).catch(() => {});
  }, []);

  const loadAudit = useCallback(async (id: number) => {
    apiFetch<AuditLog[]>(`/audit/${id}?limit=50`).then(setAuditLogs).catch(() => {});
  }, []);

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault(); if (!org) return; setSaving(true);
    try {
      await apiFetch<Org>(`/orgs/${org.id}`, { method: "PATCH", body: JSON.stringify({ name: orgName, gst_number: orgGST || undefined }) });
      toast("Saved", "success");
      apiFetch<Org[]>("/orgs/").then(setOrgs);
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
    finally { setSaving(false); }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault(); if (!org) return; setInviting(true); setNewInviteUrl("");
    try {
      const inv = await apiFetch<Invite>(`/invites/${org.id}`, { method: "POST", body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
      toast(`Invite sent to ${inviteEmail}`, "success");
      setNewInviteUrl(inv.invite_url || ""); setInviteEmail(""); loadTeam(org.id);
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
    finally { setInviting(false); }
  }

  async function removeM(mid: number) {
    if (!org) return;
    try { await apiFetch(`/invites/${org.id}/members/${mid}`, { method: "DELETE" }); toast("Member removed", "success"); loadTeam(org.id); }
    catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }

  async function changeRole(mid: number, role: string) {
    if (!org) return;
    try { await apiFetch(`/invites/${org.id}/members/${mid}?role=${role}`, { method: "PATCH" }); toast("Role updated", "success"); loadTeam(org.id); }
    catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }

  async function revokeInvite(id: number) {
    try { await apiFetch(`/invites/revoke/${id}`, { method: "DELETE" }); toast("Revoked", "success"); if (org) loadTeam(org.id); }
    catch { toast("Failed", "error"); }
  }

  async function createAPIKey(e: React.FormEvent) {
    e.preventDefault(); if (!org) return; setCreatingKey(true); setRevealedKey("");
    try {
      const k = await apiFetch<{ full_key: string } & APIKey>(`/api-keys/${org.id}`, { method: "POST", body: JSON.stringify({ name: newKeyName }) });
      setRevealedKey(k.full_key); setNewKeyName(""); toast("API key created — copy it now!", "success");
      loadKeys(org.id); loadAudit(org.id);
    } catch (err: unknown) { toast(err instanceof Error ? err.message : "Failed", "error"); }
    finally { setCreatingKey(false); }
  }

  async function revokeKey(keyId: number) {
    if (!org) return;
    try { await apiFetch(`/api-keys/${org.id}/${keyId}`, { method: "DELETE" }); toast("Key revoked", "success"); loadKeys(org.id); loadAudit(org.id); }
    catch { toast("Failed", "error"); }
  }

  async function validateGSTIN() {
    if (gstinInput.length < 15) return; setValidating(true); setGstinResult(null);
    try { const r = await apiFetch<GSTINRes>("/orgs/validate-gstin", { method: "POST", body: JSON.stringify({ gstin: gstinInput.trim().toUpperCase() }) }); setGstinResult(r); }
    finally { setValidating(false); }
  }

  const myRole  = members.find(m => m.user_id === me?.id)?.role || "owner";
  const canAdmin = ["owner", "admin"].includes(myRole);

  return (
    <div style={pageBg}>
      <FontImport />

      {/* Atmosphere */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04, zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />

      <Nav />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1180, margin: "0 auto", padding: "32px 28px 80px" }}>

        {/* Masthead */}
        <header style={{
          paddingBottom: 20, marginBottom: 28,
          borderBottom: "1px solid rgba(30,41,59,0.55)",
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          flexWrap: "wrap", gap: 16,
          opacity: 0, animation: "rise 500ms ease-out forwards",
        }}>
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#52525b", marginBottom: 8,
            }}>
              Workspace control
            </div>
            <h1 style={{
              margin: 0,
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38, lineHeight: 1, fontStyle: "italic",
              color: "#f1f5f9",
            }}>
              Settings
            </h1>
          </div>

          {/* Org switcher chips */}
          {orgs.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {orgs.map(o => {
                const active = org?.id === o.id;
                return (
                  <button key={o.id} onClick={() => setOrg(o)} style={{
                    padding: "6px 12px", borderRadius: 99,
                    border: active ? "1px solid rgba(52,211,153,0.4)" : "1px solid rgba(30,41,59,0.7)",
                    background: active ? "rgba(52,211,153,0.06)" : "transparent",
                    color: active ? "#6ee7b7" : "#94a3b8",
                    fontSize: 12, cursor: "pointer",
                    fontFamily: "'Manrope', system-ui, sans-serif",
                  }}>
                    {o.name}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Split: rail + content */}
        <div style={{
          display: "grid", gridTemplateColumns: "200px 1fr", gap: 36,
          alignItems: "flex-start",
        }} className="settings-split">

          {/* Vertical rail */}
          <nav style={{
            position: "sticky", top: 84,
            display: "flex", flexDirection: "column", gap: 2,
            paddingRight: 16,
            borderRight: "1px solid rgba(30,41,59,0.55)",
          }}>
            {TABS.map(({ id, label, icon: Icon, kicker }) => {
              const active = tab === id;
              return (
                <button key={id} onClick={() => setTab(id)} style={{
                  position: "relative",
                  display: "grid", gridTemplateColumns: "20px 16px 1fr",
                  alignItems: "center", gap: 10,
                  padding: "10px 8px",
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
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                    letterSpacing: "0.14em",
                    color: active ? "#34d399" : "#3f3f46",
                  }}>{kicker}</span>
                  <Icon size={13} style={{ color: active ? "#34d399" : "#475569" }} />
                  <span>{label}</span>
                  {active && (
                    <span style={{
                      position: "absolute", right: -1, top: 8, bottom: 8, width: 2,
                      background: "#34d399", borderRadius: "2px 0 0 2px",
                    }} />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div style={{ minWidth: 0 }}>
            {tab === "org" && (
              <Section kicker={tabKicker("org")} title="Organisation">
                <Subsection icon={UserIcon} title="Profile">
                  {me ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <ReadOnly label="Name" value={me.name} />
                      <ReadOnly label="Email" value={me.email} mono />
                    </div>
                  ) : (
                    <div style={{ height: 56, background: "rgba(30,41,59,0.4)", borderRadius: 8 }} />
                  )}
                </Subsection>

                {org && (
                  <Subsection icon={Building2} title="Business details">
                    <form onSubmit={saveOrg} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <Field label="Business Name">
                        <input value={orgName} onChange={e => setOrgName(e.target.value)} required style={inputStyle} />
                      </Field>
                      <Field label="GSTIN (15 characters)">
                        <input value={orgGST} onChange={e => setOrgGST(e.target.value.toUpperCase())}
                          placeholder="27AAPFU0939F1ZV"
                          style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.02em" }} />
                      </Field>
                      <button type="submit" disabled={saving} style={{
                        ...primaryBtn(saving), alignSelf: "flex-start",
                      }}>
                        {saving && <Loader2 size={13} className="animate-spin" />}
                        Save changes
                      </button>
                    </form>
                  </Subsection>
                )}
              </Section>
            )}

            {tab === "team" && org && (
              <Section kicker={tabKicker("team")} title="Team">
                <Subsection icon={Users} title={`Members (${members.length})`}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {members.map((m, i) => (
                      <div key={m.id} style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto auto",
                        alignItems: "center", gap: 12,
                        padding: "12px 4px",
                        borderTop: i === 0 ? "none" : "1px dotted rgba(30,41,59,0.5)",
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: "rgba(30,41,59,0.7)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "'Instrument Serif', Georgia, serif",
                          fontStyle: "italic", fontSize: 16,
                          color: "#cbd5e1",
                        }}>
                          {m.name[0].toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontFamily: "'Manrope', system-ui, sans-serif",
                            fontSize: 13, color: "#e2e8f0", fontWeight: 500,
                          }}>
                            {m.name}
                            {m.user_id === me?.id && (
                              <span style={{ marginLeft: 8, fontSize: 10, color: "#52525b", fontStyle: "italic" }}>
                                you
                              </span>
                            )}
                          </div>
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                            color: "#52525b", marginTop: 2,
                          }}>
                            {m.email}
                          </div>
                        </div>
                        <RolePill role={m.role} />
                        {canAdmin && m.user_id !== me?.id ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <select value={m.role} onChange={e => changeRole(m.id, e.target.value)}
                              style={{ ...selectStyle, minWidth: 0, padding: "4px 8px", fontSize: 11 }}>
                              <option value="viewer">viewer</option>
                              <option value="admin">admin</option>
                              <option value="owner">owner</option>
                            </select>
                            <button onClick={() => removeM(m.id)} style={iconGhost} title="Remove">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ) : <span />}
                      </div>
                    ))}
                  </div>
                </Subsection>

                {invites.length > 0 && (
                  <Subsection icon={Clock} title="Pending invites">
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {invites.map((inv, i) => (
                        <div key={inv.id} style={{
                          display: "grid", gridTemplateColumns: "1fr auto auto",
                          alignItems: "center", gap: 12,
                          padding: "11px 4px",
                          borderTop: i === 0 ? "none" : "1px dotted rgba(30,41,59,0.5)",
                        }}>
                          <div>
                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#cbd5e1",
                            }}>
                              {inv.email}
                            </div>
                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                              color: "#52525b", marginTop: 2, letterSpacing: "0.1em", textTransform: "uppercase",
                            }}>
                              {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString("en-IN")}
                            </div>
                          </div>
                          <span style={{
                            padding: "2px 10px", borderRadius: 99,
                            border: "1px solid rgba(251,191,36,0.35)",
                            color: "#fcd34d", fontSize: 10,
                            fontFamily: "'JetBrains Mono', monospace",
                            letterSpacing: "0.12em", textTransform: "uppercase",
                          }}>
                            Pending
                          </span>
                          {canAdmin && (
                            <button onClick={() => revokeInvite(inv.id)} style={iconGhost}>
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </Subsection>
                )}

                {canAdmin && (
                  <Subsection icon={Plus} title="Invite new member">
                    <form onSubmit={sendInvite} style={{
                      display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
                    }}>
                      <Field label="Email address" style={{ flex: 1, minWidth: 200 }}>
                        <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                          required placeholder="accountant@example.com" style={inputStyle} />
                      </Field>
                      <Field label="Role">
                        <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={selectStyle}>
                          <option value="viewer">Viewer — read-only</option>
                          <option value="admin">Admin — upload &amp; reconcile</option>
                          <option value="owner">Owner — full access</option>
                        </select>
                      </Field>
                      <button type="submit" disabled={inviting} style={primaryBtn(inviting)}>
                        {inviting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        Send invite
                      </button>
                    </form>
                    {newInviteUrl && (
                      <div style={{
                        marginTop: 14, padding: 12,
                        border: "1px solid rgba(52,211,153,0.3)",
                        background: "linear-gradient(90deg, rgba(52,211,153,0.06), transparent 60%)",
                        borderRadius: 10,
                      }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                          letterSpacing: "0.14em", textTransform: "uppercase",
                          color: "#34d399", marginBottom: 8,
                        }}>
                          Share this link · valid 7 days
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <code style={{
                            flex: 1,
                            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                            color: "#cbd5e1",
                            padding: "8px 10px", borderRadius: 7,
                            background: "rgba(15,23,42,0.6)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {newInviteUrl}
                          </code>
                          <button onClick={() => { navigator.clipboard.writeText(newInviteUrl); toast("Copied", "success"); }}
                            style={iconGhost}>
                            <Copy size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </Subsection>
                )}

                <Subsection icon={Shield} title="Role permissions">
                  <div style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}>
                    {[
                      { role: "viewer", body: "View dashboard, ledger, reports" },
                      { role: "admin",  body: "Upload CSV, reconcile, edit categories" },
                      { role: "owner",  body: "All + manage team, API keys, org settings" },
                    ].map(r => (
                      <div key={r.role} style={{
                        padding: 14, borderRadius: 10,
                        background: "rgba(15,23,42,0.4)",
                        border: "1px solid rgba(30,41,59,0.6)",
                      }}>
                        <RolePill role={r.role} />
                        <p style={{
                          margin: "10px 0 0", fontSize: 12, color: "#94a3b8",
                          fontFamily: "'Manrope', system-ui, sans-serif", lineHeight: 1.55,
                        }}>
                          {r.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </Subsection>
              </Section>
            )}

            {tab === "keys" && org && (
              <Section kicker={tabKicker("keys")} title="API Keys">
                <div style={{
                  display: "flex", gap: 10,
                  padding: 14, borderRadius: 10, marginBottom: 22,
                  border: "1px solid rgba(251,191,36,0.3)",
                  background: "rgba(251,191,36,0.04)",
                }}>
                  <AlertTriangle size={14} style={{ color: "#fcd34d", flexShrink: 0, marginTop: 2 }} />
                  <p style={{
                    margin: 0, fontSize: 12.5, color: "#fcd34d",
                    fontFamily: "'Manrope', system-ui, sans-serif", lineHeight: 1.55,
                  }}>
                    API keys grant programmatic access to your org&apos;s data. Stored hashed — they&apos;re shown only once. Rotate regularly and revoke any you don&apos;t use.
                  </p>
                </div>

                <Subsection icon={Key} title={`Active keys (${apiKeys.length})`}>
                  {apiKeys.length === 0 ? (
                    <div style={{
                      textAlign: "center", padding: "32px 12px",
                      fontSize: 12, color: "#52525b",
                      fontFamily: "'Manrope', system-ui, sans-serif",
                    }}>
                      No API keys yet.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {apiKeys.map((k, i) => (
                        <div key={k.id} style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto auto",
                          alignItems: "center", gap: 12,
                          padding: "12px 4px",
                          borderTop: i === 0 ? "none" : "1px dotted rgba(30,41,59,0.5)",
                        }}>
                          <div>
                            <div style={{
                              fontFamily: "'Manrope', system-ui, sans-serif",
                              fontSize: 13, color: "#e2e8f0", fontWeight: 500,
                            }}>
                              {k.name}
                            </div>
                            <div style={{ display: "flex", gap: 10, marginTop: 3, alignItems: "center" }}>
                              <code style={{
                                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                                color: "#52525b",
                              }}>
                                {k.key_prefix}•••••••••••••
                              </code>
                              {k.last_used && (
                                <span style={{ fontSize: 10, color: "#52525b" }}>
                                  Last used {new Date(k.last_used).toLocaleDateString("en-IN")}
                                </span>
                              )}
                            </div>
                          </div>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                            letterSpacing: "0.1em", textTransform: "uppercase",
                            color: "#52525b",
                          }}>
                            {new Date(k.created_at).toLocaleDateString("en-IN")}
                          </span>
                          {canAdmin && (
                            <button onClick={() => revokeKey(k.id)} style={iconGhost} title="Revoke">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Subsection>

                {revealedKey && (
                  <div style={{
                    margin: "16px 0",
                    padding: 14, borderRadius: 12,
                    border: "1px solid rgba(52,211,153,0.4)",
                    background: "linear-gradient(90deg, rgba(52,211,153,0.06), transparent 60%)",
                  }}>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                      letterSpacing: "0.16em", textTransform: "uppercase",
                      color: "#34d399", marginBottom: 8,
                    }}>
                      New API key · copy it now, it won&apos;t be shown again
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <code style={{
                        flex: 1,
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                        color: "#e2e8f0",
                        padding: "10px 12px", borderRadius: 8,
                        background: "rgba(10,14,26,0.7)",
                        border: "1px solid rgba(30,41,59,0.7)",
                        wordBreak: "break-all",
                      }}>
                        {revealedKey}
                      </code>
                      <button onClick={() => { navigator.clipboard.writeText(revealedKey); toast("Copied", "success"); }}
                        style={iconGhost}>
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>
                )}

                {canAdmin && (
                  <Subsection icon={Plus} title="Generate new key">
                    <form onSubmit={createAPIKey} style={{
                      display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
                    }}>
                      <Field label="Key name" style={{ flex: 1, minWidth: 220 }}>
                        <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} required
                          placeholder="e.g. Shopify Webhook, Zapier" style={inputStyle} />
                      </Field>
                      <button type="submit" disabled={creatingKey} style={primaryBtn(creatingKey)}>
                        {creatingKey ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
                        Generate key
                      </button>
                    </form>
                  </Subsection>
                )}
              </Section>
            )}

            {tab === "audit" && org && (
              <Section kicker={tabKicker("audit")} title="Audit Log">
                <Subsection
                  icon={Clock}
                  title={`Last 50 events`}
                  action={
                    <button onClick={() => loadAudit(org.id)} style={iconGhost}>
                      <RefreshCw size={13} />
                    </button>
                  }
                >
                  {auditLogs.length === 0 ? (
                    <div style={{
                      textAlign: "center", padding: "32px 12px",
                      fontSize: 12, color: "#52525b",
                      fontFamily: "'Manrope', system-ui, sans-serif",
                    }}>
                      No audit events yet. Uploads, reconciliations and team changes will land here.
                    </div>
                  ) : (
                    <div style={{
                      display: "flex", flexDirection: "column",
                      maxHeight: 520, overflowY: "auto",
                    }}>
                      {auditLogs.map((log, i) => (
                        <div key={log.id} style={{
                          display: "grid", gridTemplateColumns: "1fr auto",
                          alignItems: "flex-start", gap: 14,
                          padding: "10px 4px",
                          borderTop: i === 0 ? "none" : "1px dotted rgba(30,41,59,0.4)",
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <code style={{
                                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                                color: "#34d399",
                              }}>
                                {log.action}
                              </code>
                              {log.resource && (
                                <span style={{
                                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                                  color: "#52525b",
                                }}>
                                  {log.resource}
                                </span>
                              )}
                            </div>
                            {log.detail && (
                              <p style={{
                                margin: "3px 0 0", fontSize: 11, color: "#52525b",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                {log.detail}
                              </p>
                            )}
                          </div>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                            letterSpacing: "0.1em", textTransform: "uppercase",
                            color: "#475569", whiteSpace: "nowrap",
                          }}>
                            {new Date(log.created_at).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Subsection>
              </Section>
            )}

            {tab === "gstin" && (
              <Section kicker={tabKicker("gstin")} title="GSTIN Tool">
                <Subsection icon={Shield} title="Validate a GSTIN"
                  action={
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      letterSpacing: "0.16em", textTransform: "uppercase",
                      color: "#52525b",
                      padding: "3px 8px", borderRadius: 99,
                      border: "1px solid rgba(30,41,59,0.7)",
                    }}>
                      Free
                    </span>
                  }
                >
                  <p style={{
                    margin: "0 0 14px", fontSize: 13, color: "#94a3b8", lineHeight: 1.55,
                    fontFamily: "'Manrope', system-ui, sans-serif",
                  }}>
                    Verify any GSTIN before raising an invoice or filing GSTR-1 / GSTR-3B.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={gstinInput} onChange={e => setGstinInput(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === "Enter" && validateGSTIN()}
                      placeholder="27AAPFU0939F1ZV" maxLength={15}
                      style={{
                        ...inputStyle,
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.06em",
                        flex: 1,
                      }} />
                    <button onClick={validateGSTIN} disabled={validating || gstinInput.length < 15}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "10px 16px", borderRadius: 8, border: "none",
                        background: "#38bdf8", color: "#0f172a",
                        fontSize: 13, fontWeight: 700, cursor: "pointer",
                        fontFamily: "'Manrope', system-ui, sans-serif",
                        opacity: validating || gstinInput.length < 15 ? 0.5 : 1,
                      }}>
                      {validating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      Check
                    </button>
                  </div>

                  {gstinResult && (
                    <div style={{
                      marginTop: 14,
                      padding: 14, borderRadius: 10,
                      border: `1px solid ${gstinResult.valid ? "rgba(52,211,153,0.35)" : "rgba(251,113,133,0.35)"}`,
                      background: gstinResult.valid ? "rgba(52,211,153,0.06)" : "rgba(251,113,133,0.05)",
                    }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                      }}>
                        {gstinResult.valid
                          ? <CheckCircle2 size={15} style={{ color: "#34d399" }} />
                          : <XCircle size={15} style={{ color: "#fb7185" }} />}
                        <span style={{
                          fontFamily: "'Manrope', system-ui, sans-serif",
                          fontSize: 13.5, fontWeight: 600,
                          color: gstinResult.valid ? "#6ee7b7" : "#fda4af",
                        }}>
                          {gstinResult.valid ? "Valid GSTIN" : "Invalid GSTIN"}
                        </span>
                      </div>
                      {gstinResult.valid ? (
                        <div style={{
                          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                          gap: 12, fontSize: 11, color: "#94a3b8",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          <div><span style={{ color: "#52525b" }}>State · </span>{gstinResult.state}</div>
                          <div><span style={{ color: "#52525b" }}>Code · </span>{gstinResult.state_code}</div>
                          <div><span style={{ color: "#52525b" }}>PAN · </span>{gstinResult.pan}</div>
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: 12, color: "#fda4af" }}>{gstinResult.error}</p>
                      )}
                    </div>
                  )}

                  <details style={{ marginTop: 18 }}>
                    <summary style={{
                      cursor: "pointer", fontSize: 12, color: "#64748b",
                      fontFamily: "'Manrope', system-ui, sans-serif",
                    }}>
                      View state codes
                    </summary>
                    <div style={{
                      marginTop: 12,
                      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                      gap: 4,
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                    }}>
                      {[["01","J&K"],["02","Himachal"],["03","Punjab"],["06","Haryana"],["07","Delhi"],["08","Rajasthan"],["09","UP"],["10","Bihar"],["19","West Bengal"],["20","Jharkhand"],["21","Odisha"],["22","Chhattisgarh"],["23","MP"],["24","Gujarat"],["27","Maharashtra"],["29","Karnataka"],["30","Goa"],["32","Kerala"],["33","Tamil Nadu"],["36","Telangana"],["37","Andhra Pradesh"]].map(([code, name]) => (
                        <div key={code} style={{ display: "flex", gap: 6 }}>
                          <span style={{ color: "#3f3f46", width: 22 }}>{code}</span>
                          <span style={{ color: "#94a3b8" }}>{name}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                </Subsection>
              </Section>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .settings-split {
            grid-template-columns: 1fr !important;
            gap: 24px !important;
          }
          .settings-split > nav {
            position: static !important;
            border-right: none !important;
            border-bottom: 1px solid rgba(30,41,59,0.55);
            padding-right: 0 !important;
            padding-bottom: 12px;
            flex-direction: row !important;
            flex-wrap: wrap;
          }
        }
        @keyframes rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ───────── sub-components ───────── */

function Section({
  kicker, title, children,
}: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ opacity: 0, animation: "rise 400ms ease-out forwards" }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 14, marginBottom: 22,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, letterSpacing: "0.2em", color: "#3f3f46",
        }}>
          {kicker}
        </span>
        <h2 style={{
          margin: 0,
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 26, fontStyle: "italic", lineHeight: 1,
          color: "#f1f5f9",
        }}>
          {title}
        </h2>
        <div style={{ flex: 1, height: 1, background: "rgba(30,41,59,0.45)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {children}
      </div>
    </div>
  );
}

function Subsection({
  icon: Icon, title, children, action,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
      }}>
        <Icon size={13} style={{ color: "#475569" }} />
        <h3 style={{
          margin: 0,
          fontFamily: "'Manrope', system-ui, sans-serif",
          fontSize: 12.5, fontWeight: 600, letterSpacing: "0.04em",
          color: "#cbd5e1",
        }}>
          {title}
        </h3>
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      <div style={{
        padding: 18, borderRadius: 12,
        border: "1px solid rgba(30,41,59,0.6)",
        background: "rgba(15,23,42,0.4)",
      }}>
        {children}
      </div>
    </section>
  );
}

function Field({
  label, children, style,
}: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "#52525b",
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ReadOnly({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "#52525b", marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        padding: "9px 12px", borderRadius: 8,
        border: "1px solid rgba(30,41,59,0.7)",
        background: "rgba(15,23,42,0.5)",
        fontFamily: mono ? "'JetBrains Mono', monospace" : "'Manrope', system-ui, sans-serif",
        fontSize: mono ? 12 : 13, color: "#e2e8f0",
      }}>
        {value}
      </div>
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const c = ROLE_COLOR[role] ?? ROLE_COLOR.viewer;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99,
      border: `1px solid ${c.border}`,
      background: c.bg,
      color: c.text, fontSize: 10.5,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: "0.12em", textTransform: "uppercase",
    }}>
      {ROLE_ICON[role]} {role}
    </span>
  );
}

function tabKicker(id: Tab): string {
  return TABS.find(t => t.id === id)?.kicker ?? "";
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px", borderRadius: 8,
  border: "1px solid rgba(30,41,59,0.7)",
  background: "rgba(15,23,42,0.6)",
  color: "#e2e8f0", fontSize: 13,
  fontFamily: "'Manrope', system-ui, sans-serif",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 8,
  border: "1px solid rgba(30,41,59,0.7)",
  background: "rgba(15,23,42,0.6)",
  color: "#e2e8f0", fontSize: 13,
  fontFamily: "'Manrope', system-ui, sans-serif",
  cursor: "pointer",
};

const iconGhost: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: "1px solid rgba(30,41,59,0.7)",
  background: "transparent", color: "#64748b",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const primaryBtn = (busy: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 7,
  padding: "9px 14px", borderRadius: 8, border: "none",
  cursor: busy ? "wait" : "pointer",
  background: "#34d399", color: "#0f172a",
  fontSize: 12.5, fontWeight: 700,
  fontFamily: "'Manrope', system-ui, sans-serif",
  opacity: busy ? 0.6 : 1,
});
