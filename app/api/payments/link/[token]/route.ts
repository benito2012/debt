// app/api/payments/link/[token]/route.ts
// Public endpoint — returns payment link data for the debtor payment page

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const db = createServiceClient();

  const { data: link } = await db
    .from("payment_links")
    .select(`
      id, token, amount, currency, status,
      debtors(name),
      organizations(name)
    `)
    .eq("token", params.token)
    .single();

  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (link.status === "paid") {
    return NextResponse.json({ status: "paid" });
  }

  if (new Date() > new Date((link as { expires_at?: string }).expires_at || "")) {
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  // Track view
  await db.from("payment_links").update({
    times_viewed: ((link as { times_viewed?: number }).times_viewed || 0) + 1,
    last_viewed_at: new Date().toISOString(),
  }).eq("id", link.id);

  return NextResponse.json({
    debtorName: (link.debtors as { name: string })?.name,
    orgName: (link.organizations as { name: string })?.name,
    amount: link.amount,
    currency: link.currency,
    token: link.token,
    status: link.status,
  });
}

// app/api/payments/status/[token]/route.ts (inline for brevity)
// Polls payment status — used by M-Pesa flow
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const db = createServiceClient();
  const { data: link } = await db
    .from("payment_links")
    .select("status")
    .eq("token", params.token)
    .single();

  return NextResponse.json({ status: link?.status });
}
