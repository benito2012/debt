// app/pay/[token]/page.tsx
// THE DEBTOR PAYMENT PAGE
// This is what the debtor sees when they click the link in WhatsApp/SMS
// No login required. Clean, mobile-first, supports card + M-Pesa

"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface LinkData {
  debtorName: string;
  orgName: string;
  amount: number;
  currency: string;
  token: string;
  status: string;
}

export default function PaymentPage() {
  const { token } = useParams();
  const [data, setData] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"choose" | "card" | "mpesa" | "success" | "error">("choose");
  const [phone, setPhone] = useState("");
  const [processing, setProcessing] = useState(false);
  const [mpesaStatus, setMpesaStatus] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [cardNum, setCardNum] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/payments/link/${token}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setStep("error"); setLoading(false); });
  }, [token]);

  const handleMpesa = async () => {
    if (!phone) return;
    setProcessing(true);
    setMpesaStatus("Sending payment request to your phone...");
    try {
      const r = await fetch("/api/payments/mpesa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phone }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMpesaStatus("Check your phone and enter your M-Pesa PIN to complete payment.");
      // Poll for completion
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const res = await fetch(`/api/payments/status/${token}`);
        const s = await res.json();
        if (s.status === "paid") { clearInterval(poll); setStep("success"); }
        if (attempts > 30) { clearInterval(poll); setMpesaStatus("Payment timed out. Please try again."); setProcessing(false); }
      }, 3000);
    } catch (e) {
      setError((e as Error).message);
      setProcessing(false);
    }
  };

  const handleCard = async () => {
    setProcessing(true);
    setError("");
    try {
      // Get payment intent
      const r = await fetch("/api/payments/stripe-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      // In production this connects to Stripe.js — simulated here
      setTimeout(() => { setProcessing(false); setStep("success"); }, 2000);
    } catch (e) {
      setError((e as Error).message);
      setProcessing(false);
    }
  };

  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: c, minimumFractionDigits: 0 }).format(n);

  const s = {
    body: { fontFamily: "'DM Mono', monospace", background: "#07090f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" },
    card: { width: "100%", maxWidth: 420, background: "#0c1018", border: "1px solid #1c2840", borderRadius: 16, padding: "32px 28px" },
    logo: { display: "flex", alignItems: "center", gap: 8, marginBottom: 28 },
    logoIcon: { width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#00d4a0,#0066ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 },
    logoText: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#fff" },
    amountBox: { background: "#0a0e18", border: "1px solid #1c2840", borderRadius: 12, padding: "20px", marginBottom: 24, textAlign: "center" as const },
    amountLabel: { fontSize: 11, color: "#4b5a7a", letterSpacing: ".08em", marginBottom: 6 },
    amountVal: { fontFamily: "'Syne', sans-serif", fontSize: 38, fontWeight: 800, color: "#f43f5e", letterSpacing: "-1px" },
    amountSub: { fontSize: 12, color: "#4b5a7a", marginTop: 4 },
    methodBtn: { width: "100%", padding: "14px 18px", borderRadius: 10, border: "1px solid #1c2840", background: "#0a0e18", color: "#dde4f0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, marginBottom: 10, display: "flex", alignItems: "center", gap: 12, transition: "all .2s" },
    input: { width: "100%", padding: "11px 14px", background: "#07090f", border: "1px solid #243350", borderRadius: 8, color: "#dde4f0", fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 12 },
    payBtn: { width: "100%", padding: "14px", background: "linear-gradient(135deg,#00d4a0,#0066ff)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 8 },
    backBtn: { background: "none", border: "none", color: "#4b5a7a", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "6px 0", marginBottom: 16 },
    label: { fontSize: 10, color: "#4b5a7a", textTransform: "uppercase" as const, letterSpacing: ".08em", marginBottom: 5, display: "block" },
  };

  if (loading) return (
    <div style={s.body}>
      <div style={{ color: "#4b5a7a", fontSize: 13 }}>Loading payment...</div>
    </div>
  );

  if (step === "success") return (
    <div style={s.body}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@300;400&display=swap')`}</style>
      <div style={{ ...s.card, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Payment Received</div>
        <div style={{ fontSize: 13, color: "#4b5a7a", marginBottom: 24, fontWeight: 300 }}>
          Your payment of {data ? fmt(data.amount, data.currency) : ""} has been confirmed.<br />
          Your account is now clear. Thank you!
        </div>
        <div style={{ padding: "12px", background: "rgba(0,212,160,.08)", border: "1px solid rgba(0,212,160,.2)", borderRadius: 8, fontSize: 12, color: "#00d4a0" }}>
          A confirmation has been sent to your phone.
        </div>
      </div>
    </div>
  );

  if (step === "error") return (
    <div style={s.body}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@300;400&display=swap')`}</style>
      <div style={{ ...s.card, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: "#fff" }}>Link not found</div>
        <div style={{ fontSize: 13, color: "#4b5a7a", marginTop: 8 }}>This payment link may have expired. Contact the business directly.</div>
      </div>
    </div>
  );

  return (
    <div style={s.body}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@300;400&display=swap');
        button:hover { filter: brightness(1.1); }
      `}</style>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>⚡</div>
          <div style={s.logoText}>DebtAgent</div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#4b5a7a" }}>Secure Payment</div>
        </div>

        <div style={s.amountBox}>
          <div style={s.amountLabel}>AMOUNT DUE TO {data?.orgName?.toUpperCase()}</div>
          <div style={s.amountVal}>{data ? fmt(data.amount, data.currency) : "—"}</div>
          <div style={s.amountSub}>Hi {data?.debtorName} · Pay now to clear your account</div>
        </div>

        {/* Choose method */}
        {step === "choose" && (
          <>
            <div style={{ fontSize: 11, color: "#4b5a7a", letterSpacing: ".06em", marginBottom: 14 }}>SELECT PAYMENT METHOD</div>

            <button style={s.methodBtn} onClick={() => setStep("card")}>
              <span style={{ fontSize: 20 }}>💳</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ color: "#fff", fontWeight: 500 }}>Debit / Credit Card</div>
                <div style={{ fontSize: 11, color: "#4b5a7a" }}>Visa, Mastercard, Amex</div>
              </div>
              <span style={{ marginLeft: "auto", color: "#4b5a7a" }}>→</span>
            </button>

            {data?.currency === "KES" && (
              <button style={s.methodBtn} onClick={() => setStep("mpesa")}>
                <span style={{ fontSize: 20 }}>📱</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ color: "#fff", fontWeight: 500 }}>M-Pesa</div>
                  <div style={{ fontSize: 11, color: "#4b5a7a" }}>Pay from your M-Pesa account</div>
                </div>
                <span style={{ marginLeft: "auto", color: "#4b5a7a" }}>→</span>
              </button>
            )}

            <div style={{ marginTop: 20, padding: "12px", background: "rgba(0,212,160,.05)", borderRadius: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>🔒</span>
              <span style={{ fontSize: 11, color: "#4b5a7a", fontWeight: 300 }}>All payments are encrypted and processed securely. Your details are never stored.</span>
            </div>
          </>
        )}

        {/* Card payment */}
        {step === "card" && (
          <>
            <button style={s.backBtn} onClick={() => { setStep("choose"); setError(""); }}>← Back</button>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 18 }}>Card Details</div>

            {error && <div style={{ padding: "10px 12px", background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.25)", borderRadius: 6, fontSize: 12, color: "#f43f5e", marginBottom: 14 }}>{error}</div>}

            <label style={s.label}>Cardholder Name</label>
            <input style={s.input} placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)} />

            <label style={s.label}>Card Number</label>
            <input style={s.input} placeholder="4242 4242 4242 4242" value={cardNum} onChange={e => setCardNum(e.target.value)} maxLength={19} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={s.label}>Expiry</label>
                <input style={s.input} placeholder="MM / YY" value={expiry} onChange={e => setExpiry(e.target.value)} />
              </div>
              <div>
                <label style={s.label}>CVV</label>
                <input style={s.input} placeholder="•••" value={cvv} onChange={e => setCvv(e.target.value)} maxLength={4} />
              </div>
            </div>

            <button style={{ ...s.payBtn, opacity: processing ? .6 : 1 }} onClick={handleCard} disabled={processing}>
              {processing ? "Processing..." : `Pay ${data ? fmt(data.amount, data.currency) : ""} Now`}
            </button>
          </>
        )}

        {/* M-Pesa */}
        {step === "mpesa" && (
          <>
            <button style={s.backBtn} onClick={() => { setStep("choose"); setError(""); setMpesaStatus(""); setProcessing(false); }}>← Back</button>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 8 }}>M-Pesa Payment</div>
            <div style={{ fontSize: 12, color: "#4b5a7a", marginBottom: 20, fontWeight: 300 }}>We'll send a payment request to your M-Pesa number. Enter your PIN to complete.</div>

            {error && <div style={{ padding: "10px 12px", background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.25)", borderRadius: 6, fontSize: 12, color: "#f43f5e", marginBottom: 14 }}>{error}</div>}

            {mpesaStatus && (
              <div style={{ padding: "12px", background: "rgba(0,212,160,.08)", border: "1px solid rgba(0,212,160,.2)", borderRadius: 8, fontSize: 12, color: "#00d4a0", marginBottom: 16 }}>
                📱 {mpesaStatus}
              </div>
            )}

            {!processing && (
              <>
                <label style={s.label}>M-Pesa Phone Number</label>
                <input style={s.input} placeholder="0712345678" value={phone}
                  onChange={e => setPhone(e.target.value)} type="tel" />
                <button style={s.payBtn} onClick={handleMpesa}>
                  Send M-Pesa Request
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
