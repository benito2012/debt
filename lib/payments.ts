// lib/payments.ts
// Full payment processing: Stripe Connect, M-Pesa, Flutterwave
// Money flows IN from debtors, commission deducted, balance OUT to clients

import Stripe from "stripe";
import { createServiceClient } from "./supabase-server";
import { sendWhatsApp, sendSMS } from "./twilio";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

// ─────────────────────────────────────────────────────────────────
// 1. STRIPE CONNECT — Onboard client's bank account
// ─────────────────────────────────────────────────────────────────

export async function createConnectAccount(orgId: string, email: string): Promise<string> {
  // Create Express account for the client
  const account = await stripe.accounts.create({
    type: "express",
    email,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    metadata: { orgId },
  });

  // Save to DB
  const db = createServiceClient();
  await db.from("payout_accounts").upsert({
    org_id: orgId,
    stripe_account_id: account.id,
    stripe_onboarding_complete: false,
  });

  // Return onboarding link
  const link = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${APP_URL}/dashboard/settings?connect=refresh`,
    return_url: `${APP_URL}/dashboard/settings?connect=success`,
    type: "account_onboarding",
  });

  return link.url;
}

export async function getConnectAccountStatus(orgId: string) {
  const db = createServiceClient();
  const { data: pa } = await db
    .from("payout_accounts")
    .select("stripe_account_id")
    .eq("org_id", orgId)
    .single();

  if (!pa?.stripe_account_id) return null;

  const account = await stripe.accounts.retrieve(pa.stripe_account_id);

  // Update DB with current status
  await db.from("payout_accounts").update({
    stripe_onboarding_complete: account.details_submitted,
    stripe_payouts_enabled: account.payouts_enabled,
  }).eq("org_id", orgId);

  return {
    connected: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    accountId: account.id,
  };
}

// ─────────────────────────────────────────────────────────────────
// 2. PAYMENT LINK GENERATION
//    Creates a unique payment link per debtor, sent in WhatsApp/SMS
// ─────────────────────────────────────────────────────────────────

export async function createPaymentLink(debtorId: string): Promise<{
  url: string;
  token: string;
  shortUrl: string;
}> {
  const db = createServiceClient();

  const { data: debtor } = await db
    .from("debtors")
    .select("*, organizations(name, commission_rate)")
    .eq("id", debtorId)
    .single();

  if (!debtor) throw new Error("Debtor not found");

  // Check for existing active link
  const { data: existing } = await db
    .from("payment_links")
    .select("token")
    .eq("debtor_id", debtorId)
    .eq("status", "active")
    .single();

  if (existing) {
    return {
      url: `${APP_URL}/pay/${existing.token}`,
      token: existing.token,
      shortUrl: `${APP_URL}/pay/${existing.token}`,
    };
  }

  // Create new payment link record
  const { data: link } = await db
    .from("payment_links")
    .insert({
      debtor_id: debtorId,
      org_id: debtor.org_id,
      amount: debtor.amount_owed,
      currency: debtor.currency,
    })
    .select()
    .single();

  const url = `${APP_URL}/pay/${link.token}`;
  return { url, token: link.token, shortUrl: url };
}

// ─────────────────────────────────────────────────────────────────
// 3. STRIPE PAYMENT INTENT — Card payments
// ─────────────────────────────────────────────────────────────────

export async function createStripePaymentIntent(token: string): Promise<{
  clientSecret: string;
  amount: number;
  currency: string;
  debtorName: string;
  orgName: string;
}> {
  const db = createServiceClient();

  const { data: link } = await db
    .from("payment_links")
    .select("*, debtors(name, amount_owed, currency), organizations(name, commission_rate)")
    .eq("token", token)
    .eq("status", "active")
    .single();

  if (!link) throw new Error("Payment link not found or expired");

  // Convert to cents for Stripe
  const amountCents = Math.round(link.debtors.amount_owed * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: link.debtors.currency.toLowerCase(),
    metadata: {
      token,
      debtorId: link.debtor_id,
      orgId: link.org_id,
      paymentLinkId: link.id,
    },
    description: `Debt recovery — ${link.organizations.name}`,
  });

  // Save payment intent ID
  await db.from("payment_links").update({
    stripe_payment_intent_id: paymentIntent.id,
  }).eq("id", link.id);

  return {
    clientSecret: paymentIntent.client_secret!,
    amount: link.debtors.amount_owed,
    currency: link.debtors.currency,
    debtorName: link.debtors.name,
    orgName: link.organizations.name,
  };
}

// ─────────────────────────────────────────────────────────────────
// 4. M-PESA STK PUSH — Mobile money (Kenya)
// ─────────────────────────────────────────────────────────────────

async function getMpesaToken(): Promise<string> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY!;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET!;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await fetch(
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const data = await res.json();
  return data.access_token;
}

export async function initiateMpesaPayment(
  token: string,
  phoneNumber: string  // Format: 254712345678
): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  const db = createServiceClient();

  const { data: link } = await db
    .from("payment_links")
    .select("*, debtors(name, amount_owed), organizations(name)")
    .eq("token", token)
    .single();

  if (!link) throw new Error("Link not found");

  const mpesaToken = await getMpesaToken();
  const shortcode = process.env.MPESA_SHORTCODE!;
  const passkey = process.env.MPESA_PASSKEY!;
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

  const res = await fetch(
    "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpesaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.round(link.debtors.amount_owed),
        PartyA: phoneNumber,
        PartyB: shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: `${APP_URL}/api/payments/mpesa-webhook`,
        AccountReference: `DA-${link.id.slice(0, 8).toUpperCase()}`,
        TransactionDesc: `Payment to ${link.organizations.name}`,
      }),
    }
  );

  const data = await res.json();

  if (data.ResponseCode !== "0") {
    throw new Error(data.CustomerMessage || "M-Pesa request failed");
  }

  // Save checkout request ID
  await db.from("payment_links").update({
    mpesa_checkout_request_id: data.CheckoutRequestID,
  }).eq("id", link.id);

  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
  };
}

// ─────────────────────────────────────────────────────────────────
// 5. PROCESS SUCCESSFUL PAYMENT — Core payout logic
//    Called by both Stripe webhook and M-Pesa webhook
// ─────────────────────────────────────────────────────────────────

export async function processSuccessfulPayment({
  paymentLinkId,
  grossAmount,
  currency,
  paymentMethod,
  stripeChargeId,
  mpesaReceipt,
  processingFee = 0,
}: {
  paymentLinkId: string;
  grossAmount: number;
  currency: string;
  paymentMethod: string;
  stripeChargeId?: string;
  mpesaReceipt?: string;
  processingFee?: number;
}): Promise<void> {
  const db = createServiceClient();

  // Get link + org details
  const { data: link } = await db
    .from("payment_links")
    .select(`
      *,
      debtors(id, name, phone, org_id),
      organizations(id, name, commission_rate, whatsapp_number)
    `)
    .eq("id", paymentLinkId)
    .single();

  if (!link || link.status === "paid") return; // Idempotency check

  const commissionRate = link.organizations.commission_rate / 100;
  const commissionAmount = grossAmount * commissionRate;
  const netAmount = grossAmount - commissionAmount - processingFee;

  // 1. Log the transaction
  const { data: transaction } = await db.from("transactions").insert({
    payment_link_id: paymentLinkId,
    debtor_id: link.debtor_id,
    org_id: link.org_id,
    gross_amount: grossAmount,
    currency,
    commission_rate: link.organizations.commission_rate,
    commission_amount: commissionAmount,
    net_amount: netAmount,
    processing_fee: processingFee,
    payment_method: paymentMethod,
    stripe_charge_id: stripeChargeId,
    mpesa_receipt: mpesaReceipt,
    payout_status: "pending",
  }).select().single();

  // 2. Mark payment link as paid
  await db.from("payment_links").update({
    status: "paid",
    paid_at: new Date().toISOString(),
    amount_paid: grossAmount,
    payment_method_used: paymentMethod,
  }).eq("id", paymentLinkId);

  // 3. Mark debtor as recovered
  await db.from("debtors").update({
    status: "recovered",
    amount_recovered: grossAmount,
  }).eq("id", link.debtor_id);

  // 4. Initiate payout to client
  await initiateClientPayout(link.org_id, transaction!.id, netAmount, currency);

  // 5. Notify debtor — payment confirmed
  if (link.debtors.phone) {
    const debtorMsg = `✅ Payment confirmed!\n\nHi ${link.debtors.name}, we've received your payment of ${currency} ${grossAmount.toLocaleString()}. Your account is now clear.\n\nThank you!`;
    await sendWhatsApp(link.debtors.phone, debtorMsg);
  }

  // 6. Notify business client
  const businessMsg = `💰 *Payment Received!*\n\n${link.debtors.name} paid ${currency} ${grossAmount.toLocaleString()}.\n\nYour payout: ${currency} ${netAmount.toFixed(2)}\nOur fee: ${currency} ${commissionAmount.toFixed(2)} (${link.organizations.commission_rate}%)\n\nTransfer is processing to your account.`;

  if (link.organizations.whatsapp_number) {
    await sendWhatsApp(link.organizations.whatsapp_number, businessMsg);
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. CLIENT PAYOUT — Send net amount to business
// ─────────────────────────────────────────────────────────────────

async function initiateClientPayout(
  orgId: string,
  transactionId: string,
  netAmount: number,
  currency: string
): Promise<void> {
  const db = createServiceClient();

  // Get payout account
  const { data: pa } = await db
    .from("payout_accounts")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (!pa) {
    console.error(`No payout account for org ${orgId}`);
    return;
  }

  let payoutReference = "";
  let payoutStatus = "processing";

  try {
    if (pa.preferred_method === "stripe" && pa.stripe_account_id && pa.stripe_payouts_enabled) {
      // Stripe Connect Transfer
      const transfer = await stripe.transfers.create({
        amount: Math.round(netAmount * 100),  // cents
        currency: currency.toLowerCase(),
        destination: pa.stripe_account_id,
        metadata: { orgId, transactionId },
      });
      payoutReference = transfer.id;
      payoutStatus = "sent";

    } else if (pa.preferred_method === "mpesa" && pa.mpesa_paybill) {
      // M-Pesa B2B payout — Safaricom Business to Business
      await sendMpesaB2B(pa.mpesa_paybill, netAmount, transactionId);
      payoutReference = `MPESA-${transactionId.slice(0, 8)}`;
      payoutStatus = "processing";

    } else if (pa.preferred_method === "flutterwave" && pa.flutterwave_recipient_id) {
      // Flutterwave transfer
      const fwRef = await sendFlutterwaveTransfer(pa.flutterwave_recipient_id, netAmount, currency, transactionId);
      payoutReference = fwRef;
      payoutStatus = "processing";

    } else {
      // No payout method — queue for manual processing
      payoutStatus = "pending";
      console.warn(`Org ${orgId} has no configured payout method — queued for manual payout`);
    }

    // Create payout record
    await db.from("payouts").insert({
      org_id: orgId,
      transaction_ids: [transactionId],
      total_gross: netAmount / (1 - 0.03),
      total_commission: netAmount / (1 - 0.03) * 0.03,
      total_net: netAmount,
      currency,
      method: pa.preferred_method,
      stripe_transfer_id: payoutReference.startsWith("tr_") ? payoutReference : null,
      mpesa_reference: payoutReference.startsWith("MPESA") ? payoutReference : null,
      status: payoutStatus,
      sent_at: payoutStatus === "sent" ? new Date().toISOString() : null,
    });

    // Update transaction
    await db.from("transactions").update({
      payout_status: payoutStatus,
      payout_id: payoutReference,
      payout_sent_at: payoutStatus === "sent" ? new Date().toISOString() : null,
    }).eq("id", transactionId);

  } catch (err) {
    console.error("Payout failed:", err);
    await db.from("transactions").update({ payout_status: "failed" }).eq("id", transactionId);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7. M-PESA B2B PAYOUT
// ─────────────────────────────────────────────────────────────────

async function sendMpesaB2B(
  receiverShortcode: string,
  amount: number,
  reference: string
): Promise<void> {
  const token = await getMpesaToken();

  await fetch("https://api.safaricom.co.ke/mpesa/b2b/v1/paymentrequest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Initiator: process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayBill",
      Amount: Math.round(amount),
      PartyA: process.env.MPESA_SHORTCODE,
      PartyB: receiverShortcode,
      AccountReference: reference.slice(0, 12),
      Remarks: "DebtAgent payout",
      QueueTimeOutURL: `${APP_URL}/api/payments/mpesa-webhook`,
      ResultURL: `${APP_URL}/api/payments/mpesa-webhook`,
    }),
  });
}

// ─────────────────────────────────────────────────────────────────
// 8. FLUTTERWAVE TRANSFER
// ─────────────────────────────────────────────────────────────────

async function sendFlutterwaveTransfer(
  recipientId: string,
  amount: number,
  currency: string,
  reference: string
): Promise<string> {
  const res = await fetch("https://api.flutterwave.com/v3/transfers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account_bank: recipientId,
      amount,
      currency,
      reference: `DA-${reference.slice(0, 8)}`,
      callback_url: `${APP_URL}/api/payments/flutterwave-webhook`,
      debit_currency: currency,
    }),
  });

  const data = await res.json();
  return data.data?.id || "FW-" + reference.slice(0, 8);
}
