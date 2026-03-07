// app/api/stripe/connect/route.ts
// Starts Stripe Connect onboarding for a client (business owner)
// They go through Stripe's flow to connect their bank account

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createConnectAccount, getConnectAccountStatus } from "@/lib/payments";

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: org } = await db.from("organizations").select("id").eq("owner_id", user.id).single();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 404 });

  const url = await createConnectAccount(org.id, user.email!);
  return NextResponse.json({ url });
}

export async function GET(req: NextRequest) {
  const cookieStore = cookies();
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: org } = await db.from("organizations").select("id").eq("owner_id", user.id).single();
  if (!org) return NextResponse.json({ status: null });

  const status = await getConnectAccountStatus(org.id);
  return NextResponse.json({ status });
}
