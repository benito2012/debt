// app/dashboard/payouts/page.tsx
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

interface Transaction {
  id: string;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  currency: string;
  payment_method: string;
  payout_status: string;
  created_at: string;
  debtor_name?: string;
}

interface ConnectStatus {
  connected: boolean;
  payoutsEnabled: boolean;
}

export default function PayoutsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [totals, setTotals] = useState({ gross: 0, commission: 0, net: 0, pending: 0 });
  const db = createClient();

  useEffect(() => {
    loadData();
    checkConnect();
  }, []);

  const loadData = async () => {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    const { data: org } = await db.from("organizations").select("id").eq("owner_id", user.id).single();
    if (!org) return;

    const { data: txns } = await db
      .from("transactions")
      .select("*, debtors(name)")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false });

    const enriched = (txns || []).map((t: { debtors: { name: string } | null } & Transaction) => ({ ...t, debtor_name: t.debtors?.name }));
    setTransactions(enriched);

    const gross = enriched.reduce((s: number, t: Transaction) => s + t.gross_amount, 0);
    const commission = enriched.reduce((s: number, t: Transaction) => s + t.commission_amount, 0);
    const net = enriched.reduce((s: number, t: Transaction) => s + t.net_amount, 0);
    const pending = enriched.filter((t: Transaction) => t.payout_status === "pending").reduce((s: number, t: Transaction) => s + t.net_amount, 0);
    setTotals({ gross, commission, net, pending });
  };

  const checkConnect = async () => {
    const res = await fetch("/api/stripe/connect");
    const { status } = await res.json();
    setConnectStatus(status);
  };

  const startOnboarding = async () => {
    setOnboarding(true);
    const res = await fetch("/api/stripe/connect", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };

  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);

  const PAYOUT_COLORS: Record<string, string> = {
    pending: "#f59e0b",
    processing: "#818cf8",
    sent: "#00d4a0",
    failed: "#f43f5e",
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: "-.5px" }}>Payouts</h1>
        <p style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>Money collected from debtors, your commission, and transfers to your bank</p>
      </div>

      {/* Connect Bank Account Banner */}
      {!connectStatus?.payoutsEnabled && (
        <div style={{ background: "linear-gradient(135deg,#0a1f1a,#0a1020)", border: "1px solid rgba(0,212,160,.3)", borderRadius: 12, padding: "20px 24px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              {connectStatus?.connected ? "⚠️ Complete bank setup to receive payouts" : "🏦 Connect your bank account to receive payouts"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 300 }}>
              Debtors can pay now, but your share will be held until you connect a payout account.
            </div>
          </div>
          <button onClick={startOnboarding} disabled={onboarding} style={{ padding: "10px 22px", background: "linear-gradient(135deg,#00d4a0,#0066ff)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            {onboarding ? "Redirecting..." : "Connect Bank →"}
          </button>
        </div>
      )}

      {connectStatus?.payoutsEnabled && (
        <div style={{ background: "rgba(0,212,160,.06)", border: "1px solid rgba(0,212,160,.2)", borderRadius: 10, padding: "12px 18px", marginBottom: 20, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#00d4a0" }}>✅</span>
          <span style={{ fontSize: 12, color: "#00d4a0" }}>Bank account connected. Payouts transfer automatically within 2 business days.</span>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Collected", val: fmt(totals.gross), color: "#dde4f0", icon: "💰", sub: "From debtors" },
          { label: "Your Commission", val: fmt(totals.commission), color: "#00d4a0", icon: "⚡", sub: "Your earnings" },
          { label: "Paid to Clients", val: fmt(totals.net), color: "#818cf8", icon: "🏦", sub: "Transferred out" },
          { label: "Pending Payout", val: fmt(totals.pending), color: "#fb923c", icon: "⏳", sub: "Awaiting transfer" },
        ].map((s, i) => (
          <div key={i} style={{ background: "#0d1420", border: "1px solid #1a2540", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em" }}>{s.label}</span>
              <span>{s.icon}</span>
            </div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: "-.5px" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Transaction table */}
      <div style={{ background: "#0d1420", border: "1px solid #1a2540", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid #1a2540" }}>
          <span style={{ fontSize: 10, color: "#dde4f0", textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 500 }}>Transaction History</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#07090f" }}>
                {["Debtor", "Collected", "Commission", "Client Payout", "Method", "Payout Status", "Date"].map(h => (
                  <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: ".08em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 48, textAlign: "center", color: "#475569", fontSize: 13 }}>
                  No transactions yet. The agent will collect payments and they'll appear here automatically.
                </td></tr>
              ) : transactions.map(t => (
                <tr key={t.id} style={{ borderBottom: "1px solid #0e1520" }}>
                  <td style={{ padding: "11px 16px", fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 600, color: "#dde4f0" }}>{t.debtor_name || "—"}</td>
                  <td style={{ padding: "11px 16px", fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#dde4f0", fontSize: 13 }}>{t.currency} {t.gross_amount.toLocaleString()}</td>
                  <td style={{ padding: "11px 16px", fontSize: 12, color: "#00d4a0", fontWeight: 600 }}>+{t.currency} {t.commission_amount.toFixed(2)}</td>
                  <td style={{ padding: "11px 16px", fontSize: 12, color: "#818cf8" }}>{t.currency} {t.net_amount.toFixed(2)}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(129,140,248,.1)", color: "#818cf8" }}>{t.payment_method || "card"}</span>
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${PAYOUT_COLORS[t.payout_status] || "#64748b"}18`, color: PAYOUT_COLORS[t.payout_status] || "#64748b" }}>
                      {t.payout_status}
                    </span>
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 11, color: "#475569" }}>
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
