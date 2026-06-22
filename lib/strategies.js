'use strict';

function findClosestDate(dates, target) {
  return dates.reduce((best, d) =>
    Math.abs(d - target) < Math.abs(best - target) ? d : best
  );
}

// 30-day annualized historical volatility from daily closes
function computeHV(closes) {
  if (!closes || closes.length < 5) return null;
  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0)
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (logReturns.length < 4) return null;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// IV Rank (0–100) from stored history. Returns null until enough data is accumulated.
function computeIVR(currentIV, symbolHistory) {
  if (!symbolHistory || symbolHistory.length < 10) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const yearData = symbolHistory.filter(h => new Date(h.date) >= cutoff);
  if (yearData.length < 5) return null;
  const vals = yearData.map(h => h.iv);
  const minIV = Math.min(...vals);
  const maxIV = Math.max(...vals);
  if (maxIV === minIV) return 50;
  return ((currentIV - minIV) / (maxIV - minIV)) * 100;
}

// Mean reversion: IV has spiked recently and is now declining
function detectMeanReversion(currentIV, symbolHistory) {
  if (!symbolHistory || symbolHistory.length < 2) return false;
  const recent = symbolHistory.slice(-5);
  const peak = Math.max(...recent.map(h => h.iv));
  return peak >= 0.40 && currentIV < peak * 0.85 && currentIV > 0.15;
}

// Composite score 0–5
function computeScore(ivr, ivHvRatio, meanReversionSignal) {
  let score = 0;
  if (ivr != null && ivr >= 50) score += 2;
  if (ivHvRatio != null && ivHvRatio >= 1.3) score += 2;
  if (meanReversionSignal) score += 1;
  return score;
}

module.exports = { findClosestDate, computeHV, computeIVR, detectMeanReversion, computeScore };
