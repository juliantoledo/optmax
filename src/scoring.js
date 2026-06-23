'use strict';

/**
 * scoreStock — pure 100-point scoring function for cash-secured put candidates.
 * No side effects, no API calls. Safe to call in renderer or tests.
 *
 * @param {object} data - Stock/option data object from the fetch layer
 * @param {object} [config={}] - Overrides for grade thresholds, kill switches, delta range
 * @returns {{ ticker, totalScore, grade, gradeLabel, killSwitches, breakdown }}
 *   totalScore: 0–100 (0 if a kill switch is triggered)
 *   grade: 'A'|'B'|'C'|'D'|'F'
 */
window.scoreStock = function scoreStock(data, config = {}) {
  const cfg = {
    gradeA:        config.gradeA        ?? 50,
    gradeB:        config.gradeB        ?? 40,
    gradeC:        config.gradeC        ?? 30,
    gradeD:        config.gradeD        ?? 20,
    gradeE:        config.gradeE        ?? 1,
    blockEarnings: config.blockEarnings !== false,
    blockBidAsk:   config.blockBidAsk   !== false,
    blockHighIV:   config.blockHighIV   !== false,
    deltaMin:      config.deltaMin      ?? 0.25,
    deltaMax:      config.deltaMax      ?? 0.35,
  };

  // ── Map incoming data fields ─────────────────────────────────────────────
  const ivRank        = data.ivr ?? null;
  const ivHvRatio     = data.ivHvRatio ?? 0;
  const monthlyYield  = data.monthlyYield ?? 0;
  const absoluteIV    = data.impliedVolatility != null ? data.impliedVolatility * 100 : 0;
  const delta         = data.delta ?? null;
  const atSupport     = data.atSupport || false;
  const openInterest  = data.openInterest ?? 0;
  const bidAskSpread  = data.bidAskSpread ?? null;
  const aboveMA50     = data.aboveMA50 || false;
  const earningsClear = data.earningsClear !== false;

  // ── Kill switches ────────────────────────────────────────────────────────
  const killSwitches = [];
  if (cfg.blockEarnings && !earningsClear)    killSwitches.push('Earnings inside expiry window');
  if (cfg.blockBidAsk   && bidAskSpread != null && bidAskSpread > 0.50) killSwitches.push('Bid-ask spread > $0.50');
  if (cfg.blockHighIV   && absoluteIV > 80)   killSwitches.push('Absolute IV > 80%');

  // ── Per-dimension scores ─────────────────────────────────────────────────
  function scoreIvRank(v) {
    if (v == null) return 0;
    if (v < 30)  return 0;
    if (v < 40)  return 6;
    if (v < 50)  return 11;
    if (v < 60)  return 15;
    if (v < 70)  return 18;
    if (v < 80)  return 20;
    return 16; // ≥80 — danger zone penalty
  }

  function scoreIvHvRatio(v) {
    if (!v || v < 1.0)   return 0;
    if (v < 1.1)         return 3;
    if (v < 1.2)         return 7;
    if (v < 1.3)         return 10;
    if (v < 1.5)         return 13;
    if (v < 2.0)         return 15;
    if (v < 2.5)         return 12;
    return 8; // ≥2.5
  }

  function scoreMonthlyYield(v) {
    if (v < 0.5)  return 0;
    if (v < 0.8)  return 4;
    if (v < 1.0)  return 8;
    if (v < 1.5)  return 12;
    if (v < 2.5)  return 15;
    if (v < 3.5)  return 13;
    return 10; // ≥3.5
  }

  function scoreAbsoluteIV(v) {
    if (v < 15)  return 0;
    if (v < 20)  return 3;
    if (v < 25)  return 6;
    if (v < 35)  return 8;
    if (v < 50)  return 10;
    if (v < 65)  return 7;
    return 3; // ≥65
  }

  function scoreDelta(v) {
    if (v == null) return 0;
    const abs = Math.abs(v);
    // Sweet spot uses config delta range
    if (abs >= cfg.deltaMin && abs <= cfg.deltaMax) return 10;
    if (abs < 0.10)  return 2;
    if (abs < 0.20)  return 5;
    if (abs < 0.25)  return 8;
    // Between sweet spot max and 0.39
    if (abs < 0.40)  return 7;
    if (abs < 0.45)  return 4;
    return 1; // ≥0.45
  }

  function scoreOpenInterest(v) {
    if (v < 200)   return 0;
    if (v < 500)   return 2;
    if (v < 1000)  return 4;
    return 6; // ≥1000
  }

  function scoreBidAsk(v) {
    if (v == null || v > 0.50) return 0;
    if (v > 0.20)  return 2;
    if (v > 0.10)  return 4;
    return 6; // ≤0.10
  }

  const breakdown = {
    ivRank:        scoreIvRank(ivRank),
    ivHvRatio:     scoreIvHvRatio(ivHvRatio),
    monthlyYield:  scoreMonthlyYield(monthlyYield),
    absoluteIV:    scoreAbsoluteIV(absoluteIV),
    delta:         scoreDelta(delta),
    atSupport:     atSupport ? 10 : 0,
    openInterest:  scoreOpenInterest(openInterest),
    bidAskSpread:  scoreBidAsk(bidAskSpread),
    aboveMA50:     aboveMA50 ? 4 : 0,
    earningsClear: earningsClear ? 4 : 0,
  };

  // ── Total & grade ────────────────────────────────────────────────────────
  const rawTotal = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const totalScore = killSwitches.length > 0 ? 0 : rawTotal;

  let grade, gradeLabel;
  if (killSwitches.length > 0 || totalScore === 0) {
    grade = 'F'; gradeLabel = 'Blocked';
  } else if (totalScore >= cfg.gradeA) {
    grade = 'A'; gradeLabel = 'Strong buy';
  } else if (totalScore >= cfg.gradeB) {
    grade = 'B'; gradeLabel = 'Good entry';
  } else if (totalScore >= cfg.gradeC) {
    grade = 'C'; gradeLabel = 'Marginal';
  } else if (totalScore >= cfg.gradeD) {
    grade = 'D'; gradeLabel = 'Weak';
  } else if (totalScore >= cfg.gradeE) {
    grade = 'E'; gradeLabel = 'Avoid';
  } else {
    grade = 'F'; gradeLabel = 'Blocked';
  }

  return {
    ticker: data.symbol,
    totalScore,
    grade,
    gradeLabel,
    killSwitches,
    breakdown,
  };
};
