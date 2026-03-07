// app/api/payments/mpesa-webhook/route.ts
// Safaricom calls this when STK push payment completes or fails

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { processSuccessfulPayment } from "@/lib/payments";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Safaricom STK Push callback structure
  const result = body?.Body?.stkCallback;
  if (!result) return NextResponse.json({ ok: true });

  const checkoutRequestId = result.CheckoutRequestID;
  const resultCode = result.ResultCode;

  const db = createServiceClient();

  // Find the payment link by checkout request ID
  const { data: link } = await db
    .from("payment_links")
    .select("id, amount, currency")
    .eq("mpesa_checkout_request_id", checkoutRequestId)
    .single();

  if (!link) {
    console.error("No payment link found for M-Pesa checkout:", checkoutRequestId);
    return NextResponse.json({ ok: true });
  }

  if (resultCode === 0) {
    // Success — extract receipt
    const items = result.CallbackMetadata?.Item || [];
    const get = (name: string) => items.find((i: { Name: string; Value: string }) => i.Name === name)?.Value;

    const mpesaReceipt = get("MpesaReceiptNumber");
    const amount = parseFloat(get("Amount") || link.amount);
    const phoneNumber = get("PhoneNumber");

    await processSuccessfulPayment({
      paymentLinkId: link.id,
      grossAmount: amount,
      currency: "KES",
      paymentMethod: "mpesa",
      mpesaReceipt,
    });

    console.log(`✅ M-Pesa payment received: ${mpesaReceipt} — KES ${amount}`);

  } else {
    // Failed or cancelled
    console.log(`M-Pesa payment failed for ${checkoutRequestId}: Code ${resultCode}`);
    // Optionally notify debtor that payment failed
  }

  // Safaricom expects this exact response
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Success" });
}
