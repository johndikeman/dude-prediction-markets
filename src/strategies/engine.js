/**
 * StrategyEngine - manages creation, execution, backtesting,
 * maintenance, and tracking of prediction-market research strategies.
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_STRATEGIES } from "./registry.js";

const STATE_FILE = "strategies.json";
const HISTORY_FILE = "snapshots.jsonl";

export class StrategyEngine {
  constructor(stateDir = "./state") {
    this.stateDir = stateDir;
    this.stateFile = join(stateDir, STATE_FILE);
    this.historyFile = join(stateDir, HISTORY_FILE);
    this.strategies = [];
  }

  async init() {
    await mkdir(this.stateDir, { recursive: true });
    await this.load();
    if (this.strategies.length === 0) {
      this.strategies = DEFAULT_STRATEGIES.map((def) => ({
        ...structuredClone(def),
        createdAt: new Date().toISOString(),
        lastRun: null,
        runs: 0,
        results: [],
      }));
      await this.save();
    }
  }

  async load() {
    try {
      await access(this.stateFile);
      const raw = await readFile(this.stateFile, "utf-8");
      this.strategies = JSON.parse(raw);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
      this.strategies = [];
    }
  }

  async save() {
    const tmp = this.stateFile + ".tmp";
    await writeFile(tmp, JSON.stringify(this.strategies, null, 2));
    await writeFile(this.stateFile, await readFile(tmp));
  }

  list() {
    return this.strategies.map((s) => ({ ...s }));
  }

  get(id) {
    return this.strategies.find((s) => s.id === id);
  }

  create(def) {
    const id = def.id || `strategy-${Date.now()}`;
    if (this.strategies.some((s) => s.id === id)) {
      throw new Error(`strategy ${id} already exists`);
    }
    const strategy = {
      id,
      name: def.name || id,
      description: def.description || "",
      query: def.query || "",
      newsSources: def.newsSources || [],
      marketSources: def.marketSources || [],
      status: def.status || "active",
      createdAt: new Date().toISOString(),
      lastRun: null,
      runs: 0,
      results: [],
      ...def,
    };
    this.strategies.push(strategy);
    return strategy;
  }

  update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    Object.assign(s, patch, { id });
    return s;
  }

  deactivate(id) {
    return this.update(id, { status: "inactive" });
  }

  activate(id) {
    return this.update(id, { status: "active" });
  }

  /**
   * Record a snapshot for a strategy after a data run.
   */
  async recordSnapshot(strategyId, dataBundle, signals) {
    const s = this.get(strategyId);
    if (!s) return;

    const snapshot = {
      strategyId,
      timestamp: new Date().toISOString(),
      query: dataBundle.query,
      newsCount: dataBundle.news.reduce(
        (sum, r) => sum + (r.items?.length || 0),
        0
      ),
      marketsCount: dataBundle.markets.reduce(
        (sum, r) => sum + (r.items?.length || 0),
        0
      ),
      signals: signals || [],
    };

    s.lastRun = snapshot.timestamp;
    s.runs += 1;
    s.results.push(snapshot);

    // Keep last 50 results in memory; full history goes to jsonl.
    if (s.results.length > 50) {
      s.results = s.results.slice(-50);
    }

    const line = JSON.stringify(snapshot) + "\n";
    await writeFile(this.historyFile, line, { flag: "a" });
  }

  /**
   * Evaluate whether a strategy should be reconfigured.
   * Returns an array of suggested config changes.
   */
  evaluateMaintenance(strategyId) {
    const s = this.get(strategyId);
    if (!s || s.status !== "active") return [];

    const recentRuns = s.results.slice(-5);
    const suggestions = [];

    if (recentRuns.length >= 3) {
      const avgNews =
        recentRuns.reduce((sum, r) => sum + r.newsCount, 0) /
        recentRuns.length;
      if (avgNews < 2) {
        suggestions.push({
          type: "expand_sources",
          reason: `avg news items ${avgNews.toFixed(1)} is very low`,
          suggestion: "consider adding more news sources or a broader query",
        });
      }

      const errorRuns = recentRuns.filter((r) =>
        r.signals.some((sig) => sig.type === "error")
      );
      if (errorRuns.length >= 2) {
        suggestions.push({
          type: "review_sources",
          reason: `${errorRuns.length} of last 5 runs had source errors`,
          suggestion: "disable failing sources or check rate limits",
          metadata: { failingSources: this.failingSources(errorRuns) },
        });
      }
    }

    return suggestions;
  }

  /**
   * Extract the source names behind error signals.
   * Error signals use the `${source}: ${error}` message format (see runner.js);
   * non-source errors (e.g. a whole-pipeline failure) don't match and are skipped.
   */
  failingSources(errorRuns) {
    const failing = new Set();
    for (const run of errorRuns) {
      for (const sig of run.signals || []) {
        if (sig.type !== "error") continue;
        const m = /^([a-z0-9_-]+): /.exec(sig.message || "");
        if (m) failing.add(m[1]);
      }
    }
    return [...failing];
  }

  applySuggestions(strategyId, suggestions) {
    const s = this.get(strategyId);
    if (!s) return false;

    let changed = false;
    for (const sug of suggestions) {
      if (sug.type !== "review_sources") continue;
      // prune sources that have been erroring, from both news and market lists
      const failing = (sug.metadata?.failingSources || []).filter(
        (src) =>
          s.newsSources?.includes(src) || s.marketSources?.includes(src)
      );
      if (failing.length) {
        if (Array.isArray(s.newsSources)) {
          s.newsSources = s.newsSources.filter(
            (src) => !failing.includes(src)
          );
        }
        if (Array.isArray(s.marketSources)) {
          s.marketSources = s.marketSources.filter(
            (src) => !failing.includes(src)
          );
        }
        s.prunedSources = s.prunedSources || [];
        s.prunedSources.push({
          sources: failing,
          reason: sug.reason,
          prunedAt: new Date().toISOString(),
        });
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Simple backtest summary: compare latest market snapshots
   * to any cached community predictions and score hypothetical
   * accuracy if resolutions are available.
   */
  backtestSummary(strategyId) {
    const s = this.get(strategyId);
    if (!s) return null;

    const snapshots = s.results.slice(-30);
    return {
      strategyId,
      totalRuns: s.runs,
      snapshotsEvaluated: snapshots.length,
      avgNewsPerRun:
        snapshots.length > 0
          ? snapshots.reduce((sum, r) => sum + r.newsCount, 0) /
            snapshots.length
          : 0,
      avgMarketsPerRun:
        snapshots.length > 0
          ? snapshots.reduce((sum, r) => sum + r.marketsCount, 0) /
            snapshots.length
          : 0,
      lastRun: s.lastRun,
    };
  }
}
