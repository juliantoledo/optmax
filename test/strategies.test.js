'use strict';

const assert = require('assert');
const { findClosestDate, computeHV, computeIVR, detectMeanReversion, computeScore } = require('../lib/strategies');

// ─── Minimal test runner ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Build a history array with entries spaced ~14 days apart, all within the past year
function makeHistory(ivValues) {
  const now = Date.now();
  const spacingMs = 14 * 24 * 60 * 60 * 1000;
  return ivValues.map((iv, i) => ({
    date: new Date(now - (ivValues.length - i) * spacingMs).toISOString().split('T')[0],
    iv
  }));
}

// ─── findClosestDate ──────────────────────────────────────────────────────────
section('findClosestDate');

test('returns the only date when given one option', () => {
  const d = new Date('2026-02-01');
  assert.strictEqual(findClosestDate([d], new Date('2026-01-15')), d);
});

test('picks the closer of two dates', () => {
  const near = new Date('2026-01-20');
  const far  = new Date('2026-03-01');
  const target = new Date('2026-01-22');
  assert.strictEqual(findClosestDate([near, far], target), near);
});

test('picks the closer date even when it comes second in the array', () => {
  const far  = new Date('2026-03-01');
  const near = new Date('2026-01-20');
  const target = new Date('2026-01-22');
  assert.strictEqual(findClosestDate([far, near], target), near);
});

test('handles exact match', () => {
  const exact = new Date('2026-02-14');
  const other = new Date('2026-03-21');
  assert.strictEqual(findClosestDate([other, exact], new Date('2026-02-14')), exact);
});

// ─── computeHV ───────────────────────────────────────────────────────────────
section('computeHV');

test('returns null for fewer than 5 prices', () => {
  assert.strictEqual(computeHV([100, 101, 99, 102]), null);
});

test('returns null for empty array', () => {
  assert.strictEqual(computeHV([]), null);
});

test('returns null when called with null', () => {
  assert.strictEqual(computeHV(null), null);
});

test('returns 0 for completely flat prices', () => {
  const flat = Array(30).fill(100);
  assert.strictEqual(computeHV(flat), 0);
});

test('returns a positive number for real price movement', () => {
  // Simulate roughly 50% annualized vol: daily moves of ~3%
  const prices = [100, 103, 100, 97, 100, 103, 100, 97, 100, 103,
                  100,  97, 100, 103, 100,  97, 100, 103, 100, 97,
                  100, 103, 100,  97, 100, 103, 100,  97, 100, 103];
  const hv = computeHV(prices);
  assert.ok(hv > 0,   `expected HV > 0, got ${hv}`);
  assert.ok(hv < 20,  `expected HV < 20 (annualized decimal), got ${hv}`); // sanity upper bound
});

test('higher volatility prices produce higher HV', () => {
  const lowVol  = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101];
  const highVol = [100, 115,  85, 115,  85, 115,  85, 115,  85, 115];
  assert.ok(computeHV(highVol) > computeHV(lowVol));
});

test('skips zero prices without crashing', () => {
  const prices = [100, 0, 101, 102, 103, 104, 105, 106, 107, 108];
  const hv = computeHV(prices);
  assert.ok(hv === null || hv >= 0);
});

// ─── computeIVR ──────────────────────────────────────────────────────────────
section('computeIVR');

test('returns null with fewer than 10 history entries', () => {
  const history = makeHistory([0.30, 0.35, 0.40, 0.28, 0.32, 0.38, 0.41, 0.29, 0.33]);
  assert.strictEqual(computeIVR(0.35, history), null);
});

test('returns null when called with null history', () => {
  assert.strictEqual(computeIVR(0.35, null), null);
});

test('returns 0 when currentIV equals the historical minimum', () => {
  const history = makeHistory([0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.45, 0.40, 0.35]);
  const ivr = computeIVR(0.20, history);
  assert.strictEqual(ivr, 0);
});

test('returns 100 when currentIV equals the historical maximum', () => {
  const history = makeHistory([0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.45, 0.40, 0.35]);
  const ivr = computeIVR(0.50, history);
  assert.strictEqual(ivr, 100);
});

test('returns 50 when all history values are identical', () => {
  const history = makeHistory(Array(10).fill(0.30));
  assert.strictEqual(computeIVR(0.30, history), 50);
});

test('returns a midpoint value for a price in the middle of the range', () => {
  // min=0.20, max=0.60, current=0.40 → IVR = 50
  const ivValues = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.35];
  const history = makeHistory(ivValues);
  const ivr = computeIVR(0.40, history);
  assert.ok(Math.abs(ivr - 50) < 0.01, `expected ~50, got ${ivr}`);
});

test('returns > 50 when currentIV is above the historical midpoint', () => {
  const history = makeHistory([0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32, 0.34, 0.36, 0.38]);
  const ivr = computeIVR(0.35, history); // above midpoint of 0.20–0.38
  assert.ok(ivr > 50, `expected ivr > 50, got ${ivr}`);
});

// ─── detectMeanReversion ─────────────────────────────────────────────────────
section('detectMeanReversion');

test('returns false with fewer than 2 history entries', () => {
  assert.strictEqual(detectMeanReversion(0.30, [{ date: '2026-01-01', iv: 0.50 }]), false);
});

test('returns false with null history', () => {
  assert.strictEqual(detectMeanReversion(0.30, null), false);
});

test('returns true for a classic fear spike and decline', () => {
  // Peak of 0.80 in recent history, now at 0.30 (declined well below 85% of peak)
  const history = [
    { date: '2025-11-01', iv: 0.25 },
    { date: '2025-11-15', iv: 0.28 },
    { date: '2025-12-01', iv: 0.80 }, // spike
    { date: '2025-12-15', iv: 0.55 },
    { date: '2026-01-01', iv: 0.35 },
  ];
  assert.strictEqual(detectMeanReversion(0.30, history), true);
});

test('returns false when peak is below the 0.40 threshold', () => {
  const history = [
    { date: '2025-11-01', iv: 0.20 },
    { date: '2025-11-15', iv: 0.22 },
    { date: '2025-12-01', iv: 0.38 }, // peak below 0.40
    { date: '2025-12-15', iv: 0.28 },
    { date: '2026-01-01', iv: 0.22 },
  ];
  assert.strictEqual(detectMeanReversion(0.20, history), false);
});

test('returns false when current IV has not declined enough from the peak', () => {
  // Peak 0.60, current 0.52 — 0.52 >= 0.60 * 0.85 = 0.51, not enough decline
  const history = [
    { date: '2025-11-01', iv: 0.30 },
    { date: '2025-11-15', iv: 0.40 },
    { date: '2025-12-01', iv: 0.60 }, // peak
    { date: '2025-12-15', iv: 0.58 },
    { date: '2026-01-01', iv: 0.55 },
  ];
  assert.strictEqual(detectMeanReversion(0.52, history), false);
});

test('returns false when current IV is below 0.15 (absolute IV filter)', () => {
  const history = [
    { date: '2025-12-01', iv: 0.50 },
    { date: '2025-12-15', iv: 0.45 },
    { date: '2026-01-01', iv: 0.40 },
    { date: '2026-01-15', iv: 0.30 },
    { date: '2026-02-01', iv: 0.10 }, // current IV too low
  ];
  assert.strictEqual(detectMeanReversion(0.10, history), false);
});

test('only looks at the last 5 history entries for the peak', () => {
  // Spike is in old history (entry 0), recent entries are flat
  const history = [
    { date: '2025-01-01', iv: 0.90 }, // old spike — outside the recent-5 window
    { date: '2025-06-01', iv: 0.25 },
    { date: '2025-08-01', iv: 0.27 },
    { date: '2025-10-01', iv: 0.26 },
    { date: '2025-11-01', iv: 0.28 },
    { date: '2025-12-01', iv: 0.25 },
  ];
  assert.strictEqual(detectMeanReversion(0.20, history), false);
});

// ─── computeScore ─────────────────────────────────────────────────────────────
section('computeScore');

test('returns 0 when all signals are absent', () => {
  assert.strictEqual(computeScore(null, null, false), 0);
});

test('returns 0 when IVR is below 50', () => {
  assert.strictEqual(computeScore(49, null, false), 0);
});

test('returns 0 when IV/HV is below 1.3', () => {
  assert.strictEqual(computeScore(null, 1.29, false), 0);
});

test('awards +2 when IVR is exactly 50', () => {
  assert.strictEqual(computeScore(50, null, false), 2);
});

test('awards +2 when IVR exceeds 50', () => {
  assert.strictEqual(computeScore(75, null, false), 2);
});

test('awards +2 when IV/HV is exactly 1.3', () => {
  assert.strictEqual(computeScore(null, 1.3, false), 2);
});

test('awards +2 when IV/HV exceeds 1.3', () => {
  assert.strictEqual(computeScore(null, 2.0, false), 2);
});

test('awards +1 for mean reversion signal only', () => {
  assert.strictEqual(computeScore(null, null, true), 1);
});

test('awards +4 when IVR ≥ 50 and IV/HV ≥ 1.3', () => {
  assert.strictEqual(computeScore(70, 1.5, false), 4);
});

test('returns maximum score of 5 when all three signals fire', () => {
  assert.strictEqual(computeScore(80, 1.8, true), 5);
});

test('does not exceed 5 for extreme values', () => {
  assert.ok(computeScore(100, 10, true) <= 5);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(1);
}
