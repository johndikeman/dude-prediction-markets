/**
 * Runner - main orchestrator for dude-prediction-markets.
 *
 * Fetches news and market data for each active strategy,
 * records snapshots, evaluates maintenance, applies reconfigs,
 * writes an obsidian report, and exits.
 *
 * Usage: node src/runner.js [--once]
 *   --once   run a single cycle then exit (for systemd oneshot).
 */

import { DataSourcer } from "./markets/data-sourcer.js";
import { ContextFormatter } from "./markets/formatter.js";
import { StrategyEngine } from "./strategies/engine.js";
import { computePaperSignals } from "./signals/engine.js";
import { ObsidianReporter } from "./reports/obsidian.js";
import { Portfolio } from "./wallet/portfolio.js";
import { getCredits, shouldRecharge, affordableRecharge } from "./tools/openrouter.js";

const STATE_DIR = process.env.PM_STATE_DIR || "./state";
const VAULT_DIR = process.env.OBSIDIAN_DIR || "/home/ubuntu/vault";
const RUN_INTERVAL_MS = parseInt(process.env.PM_RUN_INTERVAL_MS || "1800000", 10);

async function runCycle(engine, reporter) {
  const timestamp = new Date().toISOString();
  const strategies = engine.list().filter((s) => s.status === "active");
  const snapshots = [];
  const maintenanceActions = [];

  for (const strategy of strategies) {
    const enabledSources = [
      ...strategy.newsSources,
      ...strategy.marketSources,
    ];
    const sourcer = new DataSourcer({ enabledSources });

    let data;
    let signals = [];
    try {
      data = await sourcer.fetchAll(strategy.query, { limit: 15 });
    } catch (err) {
      signals.push({ type: "error", message: err.message });
      data = {
        query: strategy.query,
        timestamp: new Date().toISOString(),
        news: [],
        markets: [],
      };
    }

    // paper signals: probability movement vs the previous snapshot.
    // must be computed before recordSnapshot appends the new line.
    const prevSnapshot = await engine.lastSnapshotFor(strategy.id);
    const currentMarketItems = data.markets.flatMap((r) => r.items || []);
    const paperSignals = computePaperSignals(
      currentMarketItems,
      prevSnapshot?.marketItems || [],
    );

    // Identify failing sources
    const allResults = [...data.news, ...data.markets];
    for (const r of allResults) {
      if (r.error) {
        signals.push({
          type: "error",
          message: `${r.source}: ${r.error}`,
        });
      }
    }
    signals.push(...paperSignals);

    await engine.recordSnapshot(strategy.id, data, signals);
    snapshots.push({
      strategyId: strategy.id,
      newsCount: data.news.reduce((sum, r) => sum + (r.items?.length || 0), 0),
      marketsCount: data.markets.reduce(
        (sum, r) => sum + (r.items?.length || 0),
        0
      ),
      signals,
    });

    // Maintenance evaluation
    const suggestions = engine.evaluateMaintenance(strategy.id);
    if (suggestions.length) {
      const applied = engine.applySuggestions(strategy.id, suggestions);
      maintenanceActions.push({
        strategy: strategy.id,
        description: suggestions.map((s) => s.reason).join("; "),
        applied,
      });
    }
  }

  // backtest summaries
  const backtests = strategies.map((s) => engine.backtestSummary(s.id));

  // wallet / autonomy status
  const portfolio = new Portfolio({ stateDir: STATE_DIR });
  let wallet = null;
  let openrouter = null;
  try {
    const snap = await portfolio.snapshot();
    await portfolio.recordSnapshot(snap);
    const pnl = await portfolio.getPnl();
    wallet = { ...snap, pnl };
  } catch (err) {
    wallet = { error: err.message };
  }

  try {
    const credits = await getCredits();
    const recharge = shouldRecharge(credits);
    openrouter = {
      ...credits,
      rechargeNeeded: recharge.needed,
      affordableRechargeUsd: affordableRecharge(wallet?.valueUsd),
    };
  } catch (err) {
    openrouter = { error: err.message };
  }

  const reportData = {
    timestamp,
    strategies: engine.list(),
    snapshots,
    maintenanceActions,
    backtests,
    wallet,
    openrouter,
  };

  const reportPath = await reporter.writeReport(reportData);
  await reporter.linkToTaskDoc(reportPath);

  console.error(`[runner] cycle complete. report written: ${reportPath}`);
  return reportData;
}

async function main() {
  const once = process.argv.includes("--once");

  const engine = new StrategyEngine(STATE_DIR);
  await engine.init();

  const reporter = new ObsidianReporter(VAULT_DIR);

  do {
    try {
      await runCycle(engine, reporter);
      await engine.save();
    } catch (err) {
      console.error(`[runner] cycle error: ${err.message}`);
    }

    if (once) {
      console.error("[runner] --once set, exiting.");
      break;
    }

    console.error(`[runner] sleeping ${RUN_INTERVAL_MS}ms...`);
    await sleep(RUN_INTERVAL_MS);
  } while (true);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(`[runner] fatal: ${err.message}`);
  process.exit(1);
});
