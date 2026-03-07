# DebtAgent — Full Payment Loop Architecture

## The Money Flow

```
DEBTOR                    DEBTAGENT                  BUSINESS CLIENT
  │                           │                            │
  │  Receives WhatsApp msg    │                            │
  │  with payment link        │                            │
  │                           │                            │
  │──── Clicks link ─────────►│                            │
  │                           │                            │
  │  /pay/[debtorId] page     │                            │
  │  Shows: amount owed       │                            │
  │  Payment methods:         │                            │
  │  - Card (Stripe)          │                            │
  │  - M-Pesa (Safaricom)     │                            │
  │  - Bank Transfer          │                            │
  │  - Flutterwave (Africa)   │                            │
  │                           │                            │
  │──── Pays $1,000 ─────────►│                            │
  │                           │                            │
  │                    Stripe webhook fires                 │
  │                    on payment_intent.succeeded          │
  │                           │                            │
  │                    System calculates:                   │
  │                    - Commission: $30 (3%)               │
  │                    - Client payout: $970               │
  │                           │                            │
  │                    Logs recovery event                  │
  │                    Updates debtor → "recovered"         │
  │                           │                            │
  │  ✅ "Payment confirmed"    │──── $970 transfer ────────►│
  │     WhatsApp sent          │    via Stripe Connect      │
  │                           │    or bank payout          │
  │                           │                            │
  │                           │  WhatsApp to business:     │
  │                           │──► "$970 sent to your      │
  │                           │    account. Recovery from  │
  │                           │    [Debtor]. Our fee: $30" │
```

## Stripe Connect — The Core Mechanism

Stripe Connect is a marketplace product that lets you:
1. Collect money from debtors INTO your Stripe account
2. Automatically split: keep your commission, send rest to client
3. Client connects their bank account once — payouts are automatic forever

Two models:
- **Express**: Client connects Stripe in 5 minutes. Stripe handles their KYC.
- **Standard**: Client has full Stripe account. More control.

For DebtAgent, use Express — fastest onboarding.

## M-Pesa Integration (Kenya + East Africa)

Safaricom Daraja API:
- STK Push: sends payment prompt directly to debtor's phone
- Debtor enters M-Pesa PIN on their phone
- Money arrives in your M-Pesa business account
- Webhook confirms payment
- You manually (or via API) send client their share

## Flutterwave (Pan-Africa + Global)

Handles: M-Pesa, Airtel Money, MTN Mobile Money, bank transfers,
cards across 34 African countries + global.
Single API for all African payment methods.

## The Business Model Upgrade

Before payments integration:
- You rely on client to tell you when debtor paid
- Client could lie about amount to reduce commission
- No audit trail
- Manual, error-prone

After payments integration:
- Money flows THROUGH you — you see every cent
- Commission is taken automatically, no disputes
- Client gets paid faster (automatic transfer vs. waiting)
- You become a payment processor — regulated, trusted, valuable
- Exit valuation goes from "SaaS tool" to "fintech infrastructure"
