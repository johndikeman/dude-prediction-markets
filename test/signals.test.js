import { test } from "node:test";
import assert from "node:assert";
import {
  relevanceScore,
  filterItemsByRelevance,
} from "../src/markets/data-sourcer.js";
import { computePaperSignals } from "../src/signals/engine.js";

test("relevanceScore: full match scores 1", () => {
  assert.strictEqual(relevanceScore("fed rate decision", "Fed rate decision odds"), 1);
});

test("relevanceScore: partial match scores fraction", () => {
  const score = relevanceScore("fed rate decision", "Fed watch: everything to know");
  assert.ok(score > 0 && score < 1, `expected partial, got ${score}`);
});

test("relevanceScore: no meaningful tokens returns 0", () => {
  assert.strictEqual(relevanceScore("the of and", "fed rate"), 0);
  assert.strictEqual(relevanceScore("", "fed rate"), 0);
});

test("filterItemsByRelevance keeps passing items, drops noise", () => {
  const items = [
    { title: "Will the Fed cut rates in September?" },
    { title: "LoL Worlds grand final winner" },
    { title: "SMU vs FSU college football spread" },
    { title: "Federal funds rate after September meeting" },
  ];
  const out = filterItemsByRelevance(items, "fed rate decision inflation cpi", 0.34);
  const titles = out.map((i) => i.title);
  assert.ok(titles.includes("Will the Fed cut rates in September?"));
  assert.ok(titles.includes("Federal funds rate after September meeting"));
  assert.ok(!titles.includes("LoL Worlds grand final winner"));
  assert.ok(out.length < items.length);
});

test("filterItemsByRelevance: keeps top-N scored items when nothing passes", () => {
  // nothing matches "quantum" at all -> top fallbackCount items by score (original order here)
  const items = [
    { title: "LoL Worlds winner" },
    { title: "Quantum computing roadmap" },
    { title: "SMU vs FSU" },
  ];
  const out = filterItemsByRelevance(items, "quantum computing breakthroughs", 0.9);
  assert.notStrictEqual(out, items);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].title, "Quantum computing roadmap");
});

test("filterItemsByRelevance: fallback caps at fallbackCount and preserves score order", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    title: i === 7 ? "Quantum computing roadmap 2030" : `Sports match ${i}`,
  }));
  const out = filterItemsByRelevance(items, "quantum computing", 0.34, 5);
  // note: query tokens both appear in item 7 -> score 1.0 passes 0.34, so this
  // goes through the passing path; craft a zero-pass case instead:
  const out2 = filterItemsByRelevance(items, "quantum computing breakthroughs", 0.9, 5);
  assert.strictEqual(out2.length, 5);
  assert.strictEqual(out2[0].title, "Quantum computing roadmap 2030");
});

test("filterItemsByRelevance: handles empty input", () => {
  assert.deepStrictEqual(filterItemsByRelevance([], "fed"), []);
  assert.deepStrictEqual(filterItemsByRelevance(undefined, "fed"), []);
});

test("filterItemsByRelevance scores title + category", () => {
  const items = [
    { title: "September FOMC", category: "Federal Reserve" },
    { title: "NBA finals winner", category: "sports" },
  ];
  const out = filterItemsByRelevance(items, "federal reserve inflation", 0.34);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, "September FOMC");
});

const mkItem = (id, probability, extra = {}) => ({
  id,
  probability,
  title: `market ${id}`,
  url: `https://example.com/${id}`,
  source: "polymarket",
  ...extra,
});

test("computePaperSignals: no prev snapshot → no signals", () => {
  assert.deepStrictEqual(
    computePaperSignals([mkItem("a", 0.7)], []),
    []
  );
  assert.deepStrictEqual(
    computePaperSignals([mkItem("a", 0.7)], null),
    []
  );
});

test("computePaperSignals: movement above threshold emits signal", () => {
  const signals = computePaperSignals(
    [mkItem("a", 0.72)],
    [mkItem("a", 0.6)]
  );
  assert.strictEqual(signals.length, 1);
  const s = signals[0];
  assert.strictEqual(s.type, "price-movement");
  assert.strictEqual(s.marketId, "a");
  assert.strictEqual(s.from, 0.6);
  assert.strictEqual(s.to, 0.72);
  assert.strictEqual(s.delta, 0.12);
  assert.strictEqual(s.direction, "up");
});

test("computePaperSignals: small movement below threshold emits nothing", () => {
  assert.deepStrictEqual(
    computePaperSignals([mkItem("a", 0.62)], [mkItem("a", 0.6)]),
    []
  );
});

test("computePaperSignals: honors minDelta option", () => {
  const signals = computePaperSignals(
    [mkItem("a", 0.62)],
    [mkItem("a", 0.6)],
    { minDelta: 0.01 }
  );
  assert.strictEqual(signals.length, 1);
});

test("computePaperSignals: down movement direction", () => {
  const signals = computePaperSignals(
    [mkItem("a", 0.4)],
    [mkItem("a", 0.6)]
  );
  assert.strictEqual(signals[0].direction, "down");
  assert.strictEqual(signals[0].delta, -0.2);
});

test("computePaperSignals: skips when probabilityMarket flips inside a group (neg-risk)", () => {
  // fed decision: cut-25 yes was the highest-volume sub-market last cycle,
  // hike-25 yes is top now. 0.0045 -> 0.545 is sub-market rotation, not a price move.
  const signals = computePaperSignals(
    [mkItem("fed", 0.545, { probabilityMarket: "Will the Fed increase interest rates by 25 bps after the September 2026 meeting?" })],
    [mkItem("fed", 0.0045, { probabilityMarket: "Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?" })]
  );
  assert.deepStrictEqual(signals, []);
});

test("computePaperSignals: real movement under a stable probabilityMarket still emits", () => {
  const pm = "Will there be no change in Fed interest rates after the September 2026 meeting?";
  const signals = computePaperSignals(
    [mkItem("fed", 0.52, { probabilityMarket: pm })],
    [mkItem("fed", 0.42, { probabilityMarket: pm })]
  );
  assert.strictEqual(signals.length, 1);
  assert.strictEqual(signals[0].delta, 0.1);
});

test("computePaperSignals: items without probabilityMarket behave as before", () => {
  const signals = computePaperSignals([mkItem("m", 0.72)], [mkItem("m", 0.6)]);
  assert.strictEqual(signals.length, 1);
});

test("computePaperSignals: skips items without numeric probabilities", () => {
  const signals = computePaperSignals(
    [mkItem("a", null), mkItem("b", 0.9)],
    [mkItem("a", 0.5), mkItem("b", 0.2)]
  );
  assert.strictEqual(signals.length, 1);
  assert.strictEqual(signals[0].marketId, "b");
});

test("computePaperSignals: new market this cycle produces no signal", () => {
  assert.deepStrictEqual(
    computePaperSignals([mkItem("new", 0.8)], [mkItem("other", 0.8)]),
    []
  );
});

test("computePaperSignals: unchanged probability emits nothing", () => {
  assert.deepStrictEqual(
    computePaperSignals([mkItem("a", 0.5)], [mkItem("a", 0.5)]),
    []
  );
});

test("computePaperSignals: handles malformed current items", () => {
  assert.deepStrictEqual(
    computePaperSignals([null, {}, { id: "" }, [mkItem("a", 0.9)]].flat(), [mkItem("a", 0.9)]),
    []
  );
});
