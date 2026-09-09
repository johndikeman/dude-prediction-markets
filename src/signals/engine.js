/**
 * Paper-signal engine.
 *
 * Computes signals purely from consecutive market snapshots — no trading,
 * no wallet, no external calls. Each cycle's marketItems are compared to the
 * previous snapshot's items (matched by id); markets whose probability moved
 * at least PM_SIGNAL_MIN_DELTA (default 0.05) produce a "price-movement"
 * paper signal. These go into the strategy's snapshot `signals` array, which
 * is what the 20-cycle backtest gate can eventually be scored against.
 */

const DEFAULT_MIN_DELTA = 0.05;

/**
 * Compare current marketItems to previous snapshot's marketItems.
 * Returns [{type: "price-movement", ...}] — empty when no pairs are
 * comparable. Items without a numeric probability on both sides are skipped.
 */
export function computePaperSignals(marketItems, prevItems, options = {}) {
  const envDelta = Number(process.env.PM_SIGNAL_MIN_DELTA);
  const minDelta = options.minDelta ?? (Number.isFinite(envDelta) && envDelta > 0 ? envDelta : DEFAULT_MIN_DELTA);
  const prevById = new Map(
    (Array.isArray(prevItems) ? prevItems : [])
      .filter((i) => i && i.id !== undefined && i.id !== "")
      .map((i) => [i.id, i])
  );

  const signals = [];
  for (const item of Array.isArray(marketItems) ? marketItems : []) {
    if (!item || item.id === undefined || item.id === "") continue;
    const prev = prevById.get(item.id);
    if (!prev) continue; // new market this cycle, no baseline yet

    // neg-risk groups (e.g. "Fed Decision in September?"): the recorded
    // probability is the Yes of whichever sub-market was highest-volume
    // this cycle. when probabilityMarket flips between snapshots the delta
    // compares two different sub-markets — skip instead of emitting a fake
    // "price-movement". items without probabilityMarket (metaculus, etc.)
    // behave exactly as before.
    const pm = item.probabilityMarket;
    const prevPm = prev.probabilityMarket;
    if (pm !== undefined && prevPm !== undefined && pm !== prevPm) continue;

    const rawTo = item.probability;
    const rawFrom = prev.probability;
    if (rawTo == null || rawFrom == null) continue;
    const to = Number(rawTo);
    const from = Number(rawFrom);
    if (Number.isNaN(to) || Number.isNaN(from) || from === to) continue;

    const delta = to - from;
    if (Math.abs(delta) < minDelta) continue;

    signals.push({
      type: "price-movement",
      marketId: item.id,
      title: item.title || prev.title || "",
      url: item.url || prev.url || "",
      source: item.source || prev.source || "",
      from,
      to,
      delta: Math.round(delta * 1000) / 1000,
      direction: delta > 0 ? "up" : "down",
      probabilityMarket: item.probabilityMarket || prev.probabilityMarket || undefined,
      detectedAt: new Date().toISOString(),
    });
  }

  return signals;
}
