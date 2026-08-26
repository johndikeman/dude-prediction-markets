import { test } from "node:test";
import assert from "node:assert/strict";
import { Portfolio } from "../src/wallet/portfolio.js";
import { getCredits, shouldRecharge, affordableRecharge } from "../src/tools/openrouter.js";
import { Trader } from "../src/wallet/trader.js";

// ---------- portfolio ----------

test("portfolio.pnl returns nulls with insufficient history", () => {
  assert.deepEqual(Portfolio.pnl([]), { changeUsd: null, changePct: null });
  assert.deepEqual(Portfolio.pnl([{ valueUsd: 10 }]), { changeUsd: null, changePct: null });
});

test("portfolio.pnl computes change over history", () => {
  const h = [
    { timestamp: "a", valueUsd: 100 },
    { timestamp: "b", valueUsd: null }, // gaps tolerated
    { timestamp: "c", valueUsd: 110.5 },
  ];
  const r = Portfolio.pnl(h);
  assert.equal(r.changeUsd, 10.5);
  assert.equal(r.changePct, 10.5);
});

test("portfolio.pnl handles zero start", () => {
  assert.deepEqual(Portfolio.pnl([{ valueUsd: 0 }, { valueUsd: 50 }]), {
    changeUsd: null,
    changePct: null,
  });
});

test("portfolio requires address for api calls", async () => {
  const p = new Portfolio({ stateDir: "/tmp/pm-test-state" });
  await assert.rejects(() => p.getValue(), /PM_WALLET_ADDRESS not set/);
});

// ---------- openrouter ----------

test("getCredits throws without key", async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(() => getCredits(), /OPENROUTER_API_KEY not set/);
  if (saved) process.env.OPENROUTER_API_KEY = saved;
});

test("shouldRecharge triggers below threshold", () => {
  assert.equal(shouldRecharge({ remaining: 5 }, 10).needed, true);
  assert.equal(shouldRecharge({ remaining: 15 }, 10).needed, false);
});

test("affordableRecharge respects reserve and floors at 0", () => {
  assert.equal(affordableRecharge(100, 5), 95);
  assert.equal(affordableRecharge(3, 5), 0);
  assert.equal(affordableRecharge(null, 5), 0);
});

// ---------- trader gating ----------

test("trader refuses to trade when disabled", async () => {
  const t = new Trader({ tradingEnabled: "false" });
  await assert.rejects(() => t.placeOrder({ tokenId: "x", side: "BUY", price: 0.5, size: 10 }), /trading disabled/);
});

test("trader validates orders before enabling client", async () => {
  const t = new Trader({ tradingEnabled: "true", privateKey: "0xdeadbeef" });
  await assert.rejects(
    () => t.placeOrder({ tokenId: "x", side: "LONG", price: 0.5, size: 10 }),
    /invalid order/
  );
  await assert.rejects(
    () => t.placeOrder({ tokenId: "x", side: "BUY", price: 1.5, size: 10 }),
    /invalid price/
  );
});
