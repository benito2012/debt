// lib/claude-with-payments.ts
// Extends the base Claude lib to include payment links in every message
// Drop-in replacement for lib/claude.ts

import Anthropic from "@anthropic-ai/sdk";
import { createPaymentLink } from "./payments";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface DebtorContextWithPayment {
  id: string;           // debtor ID — needed to generate payment link
  name: string;
  company?: string;
  amountOwed: number;
  currency: string;
  daysOverdue: number;
  totalAttempts: number;
  lastResponse?: string;
  channel: "whatsapp" | "sms" | "call" | "email";
  tone: "friendly" | "firm" | "urgent" | "legal";
  language?: string;
  clientBusinessName: string;
}

export async function generateMessageWithPaymentLink(ctx: DebtorContextWithPayment): Promise<{
  message: string;
  paymentUrl: string;
  reasoning: string;
}> {
  // Generate payment link for this debtor
  const { url: paymentUrl } = await createPaymentLink(ctx.id);

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: ctx.currency,
    minimumFractionDigits: 0,
  }).format(ctx.amountOwed);

  const channelNote = ctx.channel === "sms"
    ? "Keep under 160 chars. Include the payment link on its own line."
    : "2-3 short paragraphs. End with the payment link prominently.";

  const toneGuide = {
    friendly: "Warm and empathetic. Makes paying feel easy and non-confrontational.",
    firm: "Professional and direct. Clear that payment is needed. Not aggressive.",
    urgent: "Creates urgency. Specific deadline. Clear consequences if ignored.",
    legal: "Formal tone. Final notice language. References potential legal action.",
  };

  const prompt = `You are a debt collection AI for ${ctx.clientBusinessName}.

Generate a ${ctx.channel} message to collect a payment. ALWAYS end with the payment link.

DEBTOR: ${ctx.name}${ctx.company ? ` (${ctx.company})` : ""}
AMOUNT: ${formattedAmount}
DAYS OVERDUE: ${ctx.daysOverdue}
PREVIOUS ATTEMPTS: ${ctx.totalAttempts}
LAST RESPONSE: ${ctx.lastResponse || "None"}
LANGUAGE: ${ctx.language || "English"}
TONE: ${toneGuide[ctx.tone]}
CHANNEL: ${channelNote}

PAYMENT LINK: ${paymentUrl}

RULES:
1. Use debtor's first name
2. Be specific: ${formattedAmount}
3. The payment link is the CALL TO ACTION — make it prominent
4. Frame the link as easy: "Pay instantly here:" or "Click to pay now:"
5. Never threaten illegal action
6. Sound human, not robotic

Return JSON:
{
  "message": "full message with payment link included",
  "reasoning": "why this approach"
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const text = (response.content[0] as { text: string }).text;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return { ...parsed, paymentUrl };
  } catch {
    return {
      message: `Hi ${ctx.name}, your outstanding balance of ${formattedAmount} is overdue. Pay now: ${paymentUrl}`,
      paymentUrl,
      reasoning: "Fallback message",
    };
  }
}
