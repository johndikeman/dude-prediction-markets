/**
 * Portfolio - tracks the agent's crypto wallet / polymarket positions.
 *
 * Read-only tracking uses Polymarket's public data API (no auth):
 *   GET https://data-api.polymarket.com/value?address=<addr>   -> total portfolio value
 *   GET https://data-api.polymarket.com/positions?user=<addr>  -> open positions
 *
 * Balance history is appended to state/portfolio-history.json so we can
 * chart value over time and compute realized P&L for the autonomy loop
 * (the wallet exists so the agent can fund its own openrouter key).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const DATA_API = "https://data-api.polymarket.com";
const POLYGON_RPC_BALANCE = "https://polygon-rpc.com";

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export class Portfolio {
  constructor({ stateDir = "./state", address = process.env.PM_WALLET_ADDRESS } = {}) {
    this.stateDir = stateDir;
    this.address = address;
    this.historyPath = `${stateDir}/portfolio-history.json`;
  }

  /** Total portfolio value in USD (polymarket positions). */
  async getValue() {
    if (!this.address) throw new Error("PM_WALLET_ADDRESS not set");
    const data = await fetchJson(`${DATA_API}/value?address=${this.address}`);
    // api returns an array with a single { user, value } object
    const entry = Array.isArray(data) ? data[0] : data;
    return parseFloat(entry?.value ?? "0");
  }

  /** Open positions on polymarket. */
  async getPositions() {
    if (!this.address) throw new Error("PM_WALLET_ADDRESS not set");
    return fetchJson(`${DATA_API}/positions?user=${this.address}`);
  }

  /** Native POL/MATIC balance via public polygon rpc. */
  async getNativeBalance() {
    if (!this.address) throw new Error("PM_WALLET_ADDRESS not set");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [this.address, "latest"],
    });
    const res = await fetch(POLYGON_RPC_BALANCE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`polygon rpc HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`polygon rpc error: ${json.error.message}`);
    // wei -> matic/poll
    return parseInt(json.result, 16) / 1e18;
  }

  /** Full snapshot; individual failures degrade to nulls rather than throwing. */
  async snapshot() {
    const ts = new Date().toISOString();
    const snap = {
      timestamp: ts,
      address: this.address || null,
      valueUsd: null,
      nativeBalance: null,
      positionCount: null,
      errors: [],
    };
    try {
      snap.valueUsd = await this.getValue();
    } catch (e) {
      snap.errors.push(`value: ${e.message}`);
    }
    try {
      snap.nativeBalance = await this.getNativeBalance();
    } catch (e) {
      snap.errors.push(`native balance: ${e.message}`);
    }
    try {
      const positions = await this.getPositions();
      snap.positionCount = positions.length;
      snap.positions = positions.map((p) => ({
        title: p.title ?? p.market?.question ?? p.slug,
        size: p.size,
        avgPrice: p.avgPrice,
        curPrice: p.curPrice,
        cashPnl: p.cashPnl,
        percentPnl: p.percentPnl,
        redeemable: p.redeemable ?? false,
      }));
    } catch (e) {
      snap.errors.push(`positions: ${e.message}`);
    }
    return snap;
  }

  async recordSnapshot(snap) {
    let history = [];
    try {
      history = JSON.parse(await readFile(this.historyPath, "utf8"));
    } catch {
      // first run
    }
    history.push({
      timestamp: snap.timestamp,
      valueUsd: snap.valueUsd,
      nativeBalance: snap.nativeBalance,
    });
    // keep it bounded
    if (history.length > 5000) history = history.slice(-4000);
    await mkdir(dirname(this.historyPath), { recursive: true });
    await writeFile(this.historyPath, JSON.stringify(history, null, 2));
    return history;
  }

  /**
   * Compute P&L over recorded history. Returns nulls when insufficient data.
   */
    static pnl(history) {
    if (!Array.isArray(history) || history.length < 2) {
      return { changeUsd: null, changePct: null };
    }
    const first = history.find((h) => typeof h.valueUsd === "number");
    const last = [...history].reverse().find((h) => typeof h.valueUsd === "number");
    if (first == null || last == null || first.valueUsd === 0) {
      return { changeUsd: null, changePct: null };
    }
    const changeUsd = last.valueUsd - first.valueUsd;
    return {
      changeUsd: Math.round(changeUsd * 100) / 100,
      changePct: Math.round((changeUsd / first.valueUsd) * 10000) / 100,
    };
  }

  async getPnl() {
    try {
      const history = JSON.parse(await readFile(this.historyPath, "utf8"));
      return Portfolio.pnl(history);
    } catch {
      return { changeUsd: null, changePct: null };
    }
  }
}
