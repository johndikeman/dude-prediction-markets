/**
 * StrategyEngine - manages creation, execution, backtesting,
 * maintenance, and tracking of prediction-market research strategies.
 */

import { readFile, writeFile, mkdir, rm, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_STRATEGIES } from "./registry.js";

const STATE_FILE = "strategies.json";
const HISTORY_FILE = "snapshots.jsonl";

/**
 * Find the extent of the top-level JSON object starting at raw[start].
 * Returns index one past the closing brace, or null if truncated.
 * String-aware (braces inside string literals don't count).
 */
function scanObjectEnd(raw, start) {
  if (raw[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/**
 * JSON-aware scanner for snapshots.jsonl.
 *
 * Recovers entries even when the file was corrupted by interleaved writers
 * — a snapshot written without its trailing newline gets the next entry
 * concatenated onto it (observed 2026-11-06, snapshots.jsonl line 1235).
 * A plain split("\\n") mangles such files; this scans for object extents.
 *
 * Returns { entries, corruptedLines, truncatedTail }.
 */
export function parseHistoryBuffer(raw) {
  const entries = [];
  let corruptedLines = 0;
  let truncatedTail = false;
  let i = 0;
  let currentLineHasEntry = false;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\n" || c === "\r") {
      currentLineHasEntry = false;
      i++;
      continue;
    }
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    const end = scanObjectEnd(raw, i);
    if (end === null) {
      truncatedTail = true;
      break;
    }
    try {
      entries.push(JSON.parse(raw.slice(i, end)));
    } catch {
      truncatedTail = true;
      break;
    }
    if (currentLineHasEntry) corruptedLines++;
    currentLineHasEntry = true;
    i = end;
  }
  return { entries, corruptedLines, truncatedTail };
}

export class StrategyEngine {
  // lock-directory is considered abandoned after this long without touch
  LOCK_STALE_MS = 10 * 60 * 1000;
  // how long withHistoryLock waits for a competing process before throwing
  LOCK_MAX_WAIT_MS = 60 * 1000;

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
   *
   * The slim snapshot (counts + signals) is kept in memory / strategies.json;
   * the line appended to snapshots.jsonl also carries trimmed raw news and
   * market items (title, url, prices, etc.) so paper signals and backtests
   * can be computed from history. Raw items can be disabled by setting
   * PM_SNAPSHOT_RAW_ITEMS=false.
   */
  async recordSnapshot(strategyId, dataBundle, signals) {
    const s = this.get(strategyId);
    if (!s) return;

    const slim = {
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

    const lineObj = { ...slim };
    if (process.env.PM_SNAPSHOT_RAW_ITEMS !== "false") {
      Object.assign(lineObj, this.trimRawItems(dataBundle));
    }

    s.lastRun = slim.timestamp;
    s.runs += 1;
    s.results.push(slim);

    // Keep last 50 results in memory; full history goes to jsonl.
    if (s.results.length > 50) {
      s.results = s.results.slice(-50);
    }

    const line = JSON.stringify(lineObj) + "\n";
    await this.withHistoryLock(async () => {
      await this.repairHistoryFileIfCorrupt();
      await writeFile(this.historyFile, line, { flag: "a" });
    });
  }

  /**
   * Serialize history-file appends across concurrent in-process calls
   * and across overlapping processes (scheduled runs, hung sessions).
   *
   * Cross-process safety uses an exclusive lock directory with stale-
   * takeover after LOCK_STALE_MS (a crashed process leaks the lock dir;
   * without it a deadlock would stall every future snapshot).
   */
  async withHistoryLock(fn) {
    const run = async () => {
      const lockDir = this.historyFile + ".lock";
      for (let attempt = 0; ; attempt++) {
        try {
          await mkdir(lockDir);
          break;
        } catch (err) {
          if (err.code !== "EEXIST") throw err;
          try {
            const st = await stat(lockDir);
            if (Date.now() - st.mtimeMs > this.LOCK_STALE_MS) {
              await rm(lockDir, { recursive: true, force: true });
              continue;
            }
          } catch {
            continue; // vanished between mkdir and stat
          }
          if (attempt > this.LOCK_MAX_WAIT_MS / 250) {
            throw new Error(`history lock timeout: ${lockDir}`);
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      try {
        return await fn();
      } finally {
        await rm(lockDir, { recursive: true, force: true });
      }
    };
    const result = (this._historyWriteQueue || Promise.resolve()).then(run, run);
    this._historyWriteQueue = result.catch(() => {});
    return result;
  }

  /**
   * Detect and fix snapshots.jsonl corruption: entries missing their
   * trailing newline (interleaved/partial writer) or a truncated tail.
   * Rewrites the file canonical (one object per line, all terminated)
   * with a timestamped backup kept alongside. No-op on a healthy file.
   */
  async repairHistoryFileIfCorrupt() {
    let raw;
    try {
      raw = await readFile(this.historyFile, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    if (raw.length === 0) return null;

    const { entries, corruptedLines, truncatedTail } = parseHistoryBuffer(raw);
    const needsRewrite =
      corruptedLines > 0 || truncatedTail || !raw.endsWith("\n");
    if (!needsRewrite) return null;

    const report = { corruptedLines, truncatedTail, recovered: entries.length };
    const backupPath = `${this.historyFile}.corrupt-${Date.now()}.bak`;
    await writeFile(backupPath, raw);
    await writeFile(
      this.historyFile,
      entries.map((e) => JSON.stringify(e) + "\n").join(""),
    );
    report.backupPath = backupPath;
    return report;
  }

  /**
   * Return the most recent snapshot line for a strategy from
   * snapshots.jsonl (slim record + trimmed raw items), or null.
   */
  async lastSnapshotFor(strategyId) {
    let raw;
    try {
      raw = await readFile(this.historyFile, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    const lines = parseHistoryBuffer(raw).entries
      .filter((obj) => obj.strategyId === strategyId);
    return lines.length > 0 ? lines[lines.length - 1] : null;
  }

  /**
   * Trim raw items from a data bundle down to compact, history-friendly
   * objects (drop long descriptions/summaries, cap item counts).
   */
  trimRawItems(dataBundle) {
    const pick = (obj, keys) => {
      const out = {};
      for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
          out[k] = obj[k];
        }
      }
      return out;
    };

    const newsKeys = ["title", "url", "source", "publishedAt"];
    const marketKeys = [
      "id",
      "title",
      "url",
      "probability",
      "probabilityMarket",
      "communityPrediction",
      "closeDate",
      "resolutionDate",
      "category",
      "status",
      "source",
      "volume24h",
      "totalVolume",
    ];

    return {
      newsItems: dataBundle.news.flatMap((r) =>
        (r.items || []).slice(0, 15).map((i) => pick(i, newsKeys))
      ),
      marketItems: dataBundle.markets.flatMap((r) =>
        (r.items || []).slice(0, 30).map((i) => pick(i, marketKeys))
      ),
    };
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

      const errors = recentRuns.filter(
        (r) => r.signals.some((sig) => sig.type === "error")
      ).length;
      if (errors >= 2) {
        suggestions.push({
          type: "review_sources",
          reason: `${errors} of last 5 runs had source errors`,
          suggestion: "disable failing sources or check rate limits",
        });
      }
    }

    return suggestions;
  }

  applySuggestions(strategyId, suggestions) {
    const s = this.get(strategyId);
    if (!s) return false;

    let changed = false;
    for (const sug of suggestions) {
      if (sug.type === "review_sources" && Array.isArray(s.newsSources)) {
        // prune sources that have been erroring
        const failing = (sug.metadata?.failingSources || []).filter((src) =>
          s.newsSources.includes(src)
        );
        if (failing.length) {
          s.newsSources = s.newsSources.filter(
            (src) => !failing.includes(src)
          );
          changed = true;
        }
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
