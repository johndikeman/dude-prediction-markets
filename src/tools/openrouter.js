/**
 * OpenRouter - credit balance checking and low-balance handling.
 *
 * The agent's autonomy loop: it earns money via its prediction market
 * wallet and spends money on openrouter credits for LLM calls. this
 * module checks the credit balance; the recharge *decision* is made by
 * the agent following instructions in src/prompts/cycle-instructions.md.
 *
 * API: GET https://openrouter.ai/api/v1/credits (Bearer OPENROUTER_API_KEY)
 */

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";

export async function getCredits(apiKey = process.env.OPENROUTER_API_KEY) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch(CREDITS_URL, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openrouter credits HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const d = json.data ?? {};
  return {
    totalCredits: Number(d.total_credits ?? 0),
    totalUsage: Number(d.total_usage ?? 0),
    // purchased credits minus usage = what's actually left to burn
    remaining: Number(d.total_credits ?? 0) - Number(d.total_usage ?? 0),
  };
}

/**
 * Decide whether a recharge action is warranted.
 * thresholdUsd: alert/act when remaining credits fall below this.
 */
export function shouldRecharge(credits, thresholdUsd = parseFloat(process.env.PM_RECHARGE_THRESHOLD_USD || "10")) {
  return { needed: credits.remaining < thresholdUsd, thresholdUsd, remaining: credits.remaining };
}

/**
 * Estimate how much usd the agent can safely spend on recharging:
 * wallet value minus a safety reserve we keep for trading.
 */
export function affordableRecharge(portfolioValueUsd, reserveUsd = parseFloat(process.env.PM_TRADE_RESERVE_USD || "5")) {
  const spendable = (portfolioValueUsd ?? 0) - reserveUsd;
  return Math.max(0, Math.round(spendable * 100) / 100);
}
