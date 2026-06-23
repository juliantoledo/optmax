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

// ─── Seed Data Validation ────────────────────────────────────────────────────
section('Seed Data Validation');

test('lib/discovery-seed.json exists and is valid', () => {
  const fs = require('fs');
  const path = require('path');
  const seedPath = path.join(__dirname, '..', 'lib', 'discovery-seed.json');

  if (!fs.existsSync(seedPath)) {
    console.warn('    ! Seed file missing, skipping validation');
    return;
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const symbols = Object.keys(seed);
  assert.ok(symbols.length > 0, 'Seed file should contain at least one symbol');

  // Validate a random entry
  const firstSym = symbols[0];
  const entry = seed[firstSym];
  assert.ok(entry.date, 'Entry should have a date');
  assert.ok(entry.opp, 'Entry should have an opportunity object');
  assert.strictEqual(entry.opp.symbol, firstSym, 'Symbol mismatch');
  assert.ok(entry.opp.annualizedYield > 0, 'Should have positive yield');
});

// ─── scoreStock — 100-Point Scoring Engine ────────────────────────────────────
section('scoreStock — 100-Point Scoring Engine');

// Load src/scoring.js into a mock window object (it targets the browser via window.scoreStock)
{
  const fs   = require('fs');
  const path = require('path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring.js'), 'utf8');
  const win  = {};
  // eslint-disable-next-line no-new-func
  new Function('window', code)(win);
  var scoreStock = win.scoreStock;
}

// High-quality stock data that should produce a Grade A score
const HIGH_QUALITY = {
  symbol:            'TST',
  ivr:               65,          // 18 pts
  ivHvRatio:         1.4,         // 13 pts
  monthlyYield:      1.2,         // 12 pts
  impliedVolatility: 0.40,        // absoluteIV=40% → 10 pts
  delta:            -0.30,        // in sweet spot 0.25–0.35 → 10 pts
  atSupport:         true,        // 10 pts
  openInterest:      1500,        // 6 pts
  bidAskSpread:      0.08,        // 6 pts
  aboveMA50:         true,        // 4 pts
  earningsClear:     true,        // 4 pts
};                                // total: 93 → Grade A

// Moderate data targeting grade B (~46 pts)
const MODERATE = {
  symbol:            'MOD',
  ivr:               40,          // 11 pts
  ivHvRatio:         1.4,         // 13 pts
  monthlyYield:      0.9,         // 8 pts
  impliedVolatility: 0.30,        // absoluteIV=30% → 8 pts
  delta:             null,
  atSupport:         false,
  openInterest:      100,
  bidAskSpread:      0.30,        // 2 pts
  aboveMA50:         false,
  earningsClear:     true,        // 4 pts
};                                // total: 46 → Grade B

// Marginal data targeting grade C (~31 pts)
const MARGINAL = {
  symbol:            'MRG',
  ivr:               35,          // 6 pts
  ivHvRatio:         1.1,         // 7 pts
  monthlyYield:      0.7,         // 4 pts
  impliedVolatility: 0.22,        // absoluteIV=22% → 6 pts
  delta:             null,
  atSupport:         false,
  openInterest:      300,         // 2 pts
  bidAskSpread:      0.25,        // 2 pts
  aboveMA50:         false,
  earningsClear:     true,        // 4 pts
};                                // total: 31 → Grade C

// Weak data targeting grade D (~26 pts)
const WEAK = {
  symbol:            'WK',
  ivr:               30,          // 6 pts
  ivHvRatio:         null,
  monthlyYield:      0.6,         // 4 pts
  impliedVolatility: 0.18,        // absoluteIV=18% → 3 pts
  delta:             0.12,        // abs=0.12 → 5 pts
  atSupport:         false,
  openInterest:      250,         // 2 pts
  bidAskSpread:      0.35,        // 2 pts
  aboveMA50:         false,
  earningsClear:     true,        // 4 pts
};                                // total: 26 → Grade D

test('returns a result object with expected shape', () => {
  const r = scoreStock(HIGH_QUALITY);
  assert.ok(r && typeof r === 'object');
  assert.strictEqual(r.ticker, 'TST');
  assert.ok(typeof r.totalScore  === 'number');
  assert.ok(typeof r.grade       === 'string');
  assert.ok(typeof r.gradeLabel  === 'string');
  assert.ok(Array.isArray(r.killSwitches));
  assert.ok(r.breakdown && typeof r.breakdown === 'object');
});

test('breakdown contains all 10 dimension keys', () => {
  const { breakdown } = scoreStock(HIGH_QUALITY);
  const expected = ['ivRank','ivHvRatio','monthlyYield','absoluteIV',
                    'delta','atSupport','openInterest','bidAskSpread',
                    'aboveMA50','earningsClear'];
  for (const key of expected) {
    assert.ok(key in breakdown, `missing breakdown key: ${key}`);
  }
});

test('absent data scores only earningsClear (4 pts → grade E, no kill switch)', () => {
  // earningsClear defaults to true when undefined, contributing 4 pts; all other signals are 0
  const r = scoreStock({ symbol: 'X' });
  assert.strictEqual(r.totalScore, 4);
  assert.strictEqual(r.grade, 'E');
  assert.strictEqual(r.killSwitches.length, 0);
});

test('bid-ask kill switch fires when bidAskSpread > 0.50', () => {
  const r = scoreStock({ ...HIGH_QUALITY, bidAskSpread: 0.51 });
  assert.strictEqual(r.totalScore, 0);
  assert.strictEqual(r.grade, 'F');
  assert.ok(r.killSwitches.some(s => s.includes('Bid-ask')));
});

test('bid-ask kill switch does not fire at exactly 0.50', () => {
  const r = scoreStock({ ...HIGH_QUALITY, bidAskSpread: 0.50 });
  assert.ok(r.killSwitches.every(s => !s.includes('Bid-ask')));
  assert.ok(r.totalScore > 0);
});

test('earnings kill switch fires when earningsClear is false', () => {
  const r = scoreStock({ ...HIGH_QUALITY, earningsClear: false });
  assert.strictEqual(r.totalScore, 0);
  assert.ok(r.killSwitches.some(s => s.includes('Earnings')));
});

test('high-IV kill switch fires when absoluteIV > 80%', () => {
  const r = scoreStock({ ...HIGH_QUALITY, impliedVolatility: 0.81 });
  assert.strictEqual(r.totalScore, 0);
  assert.ok(r.killSwitches.some(s => s.includes('IV')));
});

test('kill switch disabled via config does not block the score', () => {
  const r = scoreStock(
    { ...HIGH_QUALITY, bidAskSpread: 0.60 },
    { blockBidAsk: false }
  );
  assert.ok(r.killSwitches.every(s => !s.includes('Bid-ask')));
  assert.ok(r.totalScore > 0);
});

test('multiple kill switches can fire simultaneously', () => {
  const r = scoreStock({ ...HIGH_QUALITY, bidAskSpread: 0.99, earningsClear: false, impliedVolatility: 0.90 });
  assert.ok(r.killSwitches.length >= 2);
  assert.strictEqual(r.totalScore, 0);
});

test('totalScore is always 0 when any kill switch is active', () => {
  const r = scoreStock({ ...HIGH_QUALITY, bidAskSpread: 0.99 });
  assert.strictEqual(r.totalScore, 0);
});

test('high quality data produces grade A', () => {
  const r = scoreStock(HIGH_QUALITY);
  assert.strictEqual(r.grade, 'A');
  assert.strictEqual(r.gradeLabel, 'Strong buy');
  assert.ok(r.totalScore >= 50);
});

test('moderate data produces grade B', () => {
  const r = scoreStock(MODERATE);
  assert.strictEqual(r.grade, 'B');
  assert.strictEqual(r.gradeLabel, 'Good entry');
  assert.ok(r.totalScore >= 40 && r.totalScore < 50);
});

test('marginal data produces grade C', () => {
  const r = scoreStock(MARGINAL);
  assert.strictEqual(r.grade, 'C');
  assert.strictEqual(r.gradeLabel, 'Marginal');
  assert.ok(r.totalScore >= 30 && r.totalScore < 40);
});

test('weak data produces grade D', () => {
  const r = scoreStock(WEAK);
  assert.strictEqual(r.grade, 'D');
  assert.strictEqual(r.gradeLabel, 'Weak');
  assert.ok(r.totalScore >= 20 && r.totalScore < 30);
});

test('IVR below 30 scores 0 for the ivRank dimension', () => {
  const r = scoreStock({ symbol: 'X', ivr: 29 });
  assert.strictEqual(r.breakdown.ivRank, 0);
});

test('IVR in 60–70 range scores 18 for the ivRank dimension', () => {
  const r = scoreStock({ symbol: 'X', ivr: 65, earningsClear: true });
  assert.strictEqual(r.breakdown.ivRank, 18);
});

test('IVR at 80+ triggers danger-zone penalty (16 pts, not max 20)', () => {
  const r20 = scoreStock({ symbol: 'X', ivr: 75, earningsClear: true });
  const r16 = scoreStock({ symbol: 'X', ivr: 80, earningsClear: true });
  assert.strictEqual(r20.breakdown.ivRank, 20);
  assert.strictEqual(r16.breakdown.ivRank, 16);
});

test('delta in sweet spot (default 0.25–0.35) scores 10 pts', () => {
  const r = scoreStock({ symbol: 'X', delta: -0.30, earningsClear: true });
  assert.strictEqual(r.breakdown.delta, 10);
});

test('delta above sweet spot scores fewer than 10 pts', () => {
  const r = scoreStock({ symbol: 'X', delta: -0.40, earningsClear: true });
  assert.ok(r.breakdown.delta < 10);
});

test('earningsClear = true contributes 4 pts to trend dimension', () => {
  const with_clear    = scoreStock({ symbol: 'X', earningsClear: true  });
  const without_clear = scoreStock({ symbol: 'X', earningsClear: false, blockEarnings: false });
  const cfg_no_block  = { blockEarnings: false };
  const r_clear    = scoreStock({ symbol: 'X', earningsClear: true  }, cfg_no_block);
  const r_noclear  = scoreStock({ symbol: 'X', earningsClear: false }, cfg_no_block);
  assert.ok(r_clear.breakdown.earningsClear   === 4);
  assert.ok(r_noclear.breakdown.earningsClear === 0);
});

test('aboveMA50 = true contributes 4 pts to trend dimension', () => {
  const cfg = { blockEarnings: false };
  const r_above = scoreStock({ symbol: 'X', aboveMA50: true,  earningsClear: false }, cfg);
  const r_below = scoreStock({ symbol: 'X', aboveMA50: false, earningsClear: false }, cfg);
  assert.strictEqual(r_above.breakdown.aboveMA50, 4);
  assert.strictEqual(r_below.breakdown.aboveMA50, 0);
});

test('custom grade thresholds in config are respected', () => {
  // With default thresholds, 25 pts → grade D (≥20).
  // Override to require 30 for D → should now be grade E (≥1).
  const r_default = scoreStock(WEAK);
  assert.strictEqual(r_default.grade, 'D');

  const r_custom = scoreStock(WEAK, { gradeA: 80, gradeB: 60, gradeC: 40, gradeD: 30, gradeE: 1 });
  assert.strictEqual(r_custom.grade, 'E');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(1);
}
