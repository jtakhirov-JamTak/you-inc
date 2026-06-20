// Operational kill switches.
//
// Env flags that let us HALT a cost-bearing or risky operation without
// shipping a code fix. When something is actively going wrong (runaway AI
// spend, a payment bug, a vendor outage), flip the flag and the app refuses
// that operation *gracefully* — the user's work is still saved where
// applicable, no coins are debited, and no money is taken.
//
// HOW TO FLIP (Vercel): Project → Settings → Environment Variables → set the
// flag to `1` (Production), then redeploy (or use "Redeploy" on the latest
// deployment). NOTE: Vercel does not hot-reload env vars into running
// functions, so a redeploy IS required for the change to take effect — but
// that's ~90 seconds and needs no code change, no PR, and no review, versus
// the much slower and riskier path of writing + shipping an emergency patch.
// To turn an operation back on, clear the flag (or set it to `0`) and redeploy.
//
// SCOPE — DISABLE_AI covers the PAID coaching generations: the Coach modules
// (Prepare/Review/Before-You-Send via run-module.ts) and the weekly Insights
// reflection. These are the Claude calls that cost coins and are the
// runaway-spend surface.
//
// DISABLE_WEBHOOK is the SAFE form of a payment-webhook halt: the webhook
// returns 503 (NOT a silent 200) for an authentic, paid, not-yet-credited
// purchase, so Stripe QUEUES the event and retries with backoff (~72h). No
// coins are granted and the event is NOT logged as processed while the switch
// is on, so when you clear it Stripe's retries credit correctly — nothing is
// stranded *within the retry window*. Past ~3 days, manually "Resend" the
// events from the Stripe dashboard. NEVER reimplement this as ack-200-and-skip:
// that would tell Stripe the delivery succeeded and permanently strand a paid
// purchase. Use it to stop crediting while fixing a crediting-logic bug; do not
// leave it on for days (Stripe warns on, and may disable, a persistently
// failing endpoint).

function isOn(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * AI coaching generation (Coach modules + weekly Insights). When ON, the app
 * still SAVES the user's entry for free but refuses to generate AI feedback,
 * and never reserves/debits coins. Halts all paid Claude calls.
 */
export function isAIDisabled(): boolean {
  return isOn(process.env.DISABLE_AI);
}

/**
 * New Stripe checkout sessions. When ON, the checkout endpoint refuses to start
 * a new coin purchase (existing balances and the webhook are untouched). Use to
 * stop taking new payments during a pricing mistake or a payment-system problem.
 */
export function isCheckoutDisabled(): boolean {
  return isOn(process.env.DISABLE_CHECKOUT);
}

/**
 * Stripe webhook crediting. When ON, the webhook returns 503 for an authentic,
 * paid, not-yet-credited purchase so Stripe retries later (NEVER a silent 200 —
 * see the SCOPE note above). Halts coin grants without stranding payments within
 * Stripe's retry window. Use to pause crediting while fixing a crediting bug.
 */
export function isWebhookDisabled(): boolean {
  return isOn(process.env.DISABLE_WEBHOOK);
}
