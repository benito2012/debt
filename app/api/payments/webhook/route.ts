// app/api/payments/webhook/route.ts
// Stripe fires this when a debtor successfully pays
// This is the trigger for the full automatic payout loop

import { NextRequest, NextResponse } from "next/server";
import { stripe, processSuccessfulPayment } from "@/lib/payments";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_PAYMENT_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Webhook signature invalid" }, { status: 400 });
  }

  switch (event.type) {

    case "payment_intent.succeeded": {
      const pi = event.data.object as {
        id: string;
        amount: number;
        currency: string;
        metadata: { paymentLinkId: string };
        latest_charge: string;
      };

      const paymentLinkId = pi.metadata?.paymentLinkId;
      if (!paymentLinkId) break;

      // Get processing fee from charge
      const charge = await stripe.charges.retrieve(pi.latest_charge);
      const balanceTx = await stripe.balanceTransactions.retrieve(
        charge.balance_transaction as string
      );
      const processingFee = balanceTx.fee / 100; // cents → dollars

      await processSuccessfulPayment({
        paymentLinkId,
        grossAmount: pi.amount / 100,   // Stripe uses cents
        currency: pi.currency.toUpperCase(),
        paymentMethod: "card",
        stripeChargeId: charge.id,
        processingFee,
      });

      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as { metadata: { paymentLinkId: string } };
      console.log("Payment failed for link:", pi.metadata?.paymentLinkId);
      // Could send debtor a "payment failed" message here
      break;
    }
  }

  return NextResponse.json({ received: true });
}
