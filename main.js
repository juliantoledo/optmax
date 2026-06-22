'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const { findClosestDate, computeHV, computeIVR, detectMeanReversion, computeScore } = require('./lib/strategies');

const CACHE_FILE      = path.join(app.getPath('userData'), 'data.json');
const SETTINGS_FILE   = path.join(app.getPath('userData'), 'settings.json');
const DISC_CACHE_FILE = path.join(app.getPath('userData'), 'discovery-cache.json');

const DEFAULT_SETTINGS = {
  refreshIntervalDays: 14,
  minMarginPct: 5,
  priceRefreshHours: 24,
  watchlists: { ivr: [], iv_hv: [], mean_reversion: [] }
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        watchlists: { ...DEFAULT_SETTINGS.watchlists, ...(saved.watchlists || {}) }
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s), 'utf8');
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(parsed)) return {
        fetchedAt: new Date().toISOString(),
        pricedAt:  new Date().toISOString(),
        ivHistory: {},
        data: parsed
      };
      return { ivHistory: {}, ...parsed };
    }
  } catch {}
  return null;
}

// Full options scan — resets fetchedAt and pricedAt
function saveCache(data, ivHistory) {
  const settings = loadSettings();
  const now = new Date().toISOString();
  const payload = {
    fetchedAt: now, pricedAt: now,
    minMarginPct: settings.minMarginPct,
    ivHistory: ivHistory || {},
    data
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf8');
}

// Price update only — preserves fetchedAt / minMarginPct / ivHistory
function savePriceUpdate(data) {
  const cache = loadCache() || {};
  const payload = { ...cache, pricedAt: new Date().toISOString(), data };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf8');
}

// ── Discovery cache ───────────────────────────────────────────────────────────
function loadDiscoveryCache() {
  try {
    if (fs.existsSync(DISC_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DISC_CACHE_FILE, 'utf8'));
      // Prune entries older than 3 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 3);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const pruned = {};
      for (const [sym, entry] of Object.entries(raw)) {
        if (entry.date >= cutoffStr) pruned[sym] = entry;
      }
      return pruned;
    }
  } catch {}
  return {};
}

function saveDiscoveryCache(cache) {
  fs.writeFileSync(DISC_CACHE_FILE, JSON.stringify(cache), 'utf8');
}

// ── Per-symbol analysis (shared by watchlist scan and discovery) ──────────────
async function analyzeSingleSymbol(symbol, minMarginMultiplier, ivHistory) {
  const target = new Date();
  target.setDate(target.getDate() + 30);

  const quote = await yahooFinance.quote(symbol);
  const currentPrice = quote.regularMarketPrice;
  if (!currentPrice || currentPrice <= 0) return null;

  const histEnd   = new Date();
  const histStart = new Date();
  histStart.setDate(histStart.getDate() - 35);
  const history = await yahooFinance.historical(symbol, {
    period1: histStart, period2: histEnd, interval: '1d'
  });
  const closes = history.map(h => h.close).filter(c => c > 0);
  const hv = computeHV(closes);

  const chain = await yahooFinance.options(symbol);
  if (!chain.expirationDates || chain.expirationDates.length === 0) return null;

  const closestDate = findClosestDate(chain.expirationDates, target);
  const dte = Math.round((closestDate - new Date()) / (1000 * 60 * 60 * 24));
  if (dte <= 0) return null;

  const earningsTs = quote.earningsTimestamp;
  if (earningsTs && earningsTs > 0) {
    const earningsDate = new Date(earningsTs * 1000);
    if (earningsDate >= new Date() && earningsDate <= closestDate) return null;
  }

  const dated = await yahooFinance.options(symbol, { date: closestDate });
  if (!dated.options || dated.options.length === 0 || !dated.options[0].puts) return null;

  const maxAllowedStrike = currentPrice * minMarginMultiplier;
  const puts = dated.options[0].puts.filter(p => {
    if (!p.strike || p.strike <= 0 || p.strike > maxAllowedStrike) return false;
    if (!p.lastPrice || p.lastPrice <= 0) return false;
    if ((p.openInterest || 0) <= 500) return false;
    if ((p.impliedVolatility || 0) <= 0.15) return false;
    if (p.bid > 0 && p.ask > 0 && (p.ask - p.bid) > 0.50) return false;
    return true;
  });
  if (puts.length === 0) return null;

  puts.sort((a, b) => b.strike - a.strike);
  const best      = puts[0];
  const currentIV = best.impliedVolatility || 0;

  if (!ivHistory[symbol]) ivHistory[symbol] = [];
  const today = new Date().toISOString().split('T')[0];
  if (!ivHistory[symbol].some(h => h.date === today)) {
    ivHistory[symbol].push({ date: today, iv: currentIV });
    if (ivHistory[symbol].length > 104) ivHistory[symbol] = ivHistory[symbol].slice(-104);
  }

  const ivr                 = computeIVR(currentIV, ivHistory[symbol]);
  const ivHvRatio           = hv && hv > 0 ? currentIV / hv : null;
  const meanReversionSignal = detectMeanReversion(currentIV, ivHistory[symbol]);
  const score               = computeScore(ivr, ivHvRatio, meanReversionSignal);

  const premium         = best.lastPrice;
  const strike          = best.strike;
  const capitalRequired = strike * 100;
  const marginOfSafety  = ((currentPrice - strike) / currentPrice) * 100;
  const breakEven       = strike - premium;
  const monthlyYield    = (premium / strike) * (30 / dte) * 100;
  const annualizedYield = monthlyYield * 12;
  const monthlyIncome   = premium * 100 * (30 / dte);

  return {
    symbol,
    companyName: quote.longName || quote.shortName || symbol,
    exchange:    quote.fullExchangeName || quote.exchange || '',
    currentPrice, strike, dte, premium, capitalRequired,
    monthlyYield, annualizedYield, monthlyIncome,
    marginOfSafety, breakEven,
    impliedVolatility: currentIV,
    hv:               hv || 0,
    ivHvRatio:        ivHvRatio || 0,
    ivr, meanReversionSignal, score,
    volume:       best.volume || 0,
    openInterest: best.openInterest || 0,
    expirationDate: closestDate.toISOString().split('T')[0]
  };
}

// ── Full options scan ─────────────────────────────────────────────────────────
async function fetchOptionsData(symbolsOverride = null, onProgress = null) {
  const settings = loadSettings();
  const minMarginMultiplier = 1 - (parseFloat(settings.minMarginPct) / 100);

  const watchlists = settings.watchlists || { ivr: [], iv_hv: [], mean_reversion: [] };
  const isDiscovery = symbolsOverride !== null;
  const allSymbols = isDiscovery ? symbolsOverride : [...new Set([
    ...watchlists.ivr,
    ...watchlists.iv_hv,
    ...watchlists.mean_reversion
  ])];

  const cache = loadCache() || {};
  const ivHistory = cache.ivHistory || {};

  const opportunities = [];
  let processed = 0;

  for (const symbol of allSymbols) {
    try {
      const opp = await analyzeSingleSymbol(symbol, minMarginMultiplier, ivHistory);
      if (opp) {
        opp.strategies = [];
        if (isDiscovery) {
          opp.strategies.push('ivr', 'iv_hv', 'mean_reversion');
        } else {
          if (watchlists.ivr.includes(symbol))            opp.strategies.push('ivr');
          if (watchlists.iv_hv.includes(symbol))          opp.strategies.push('iv_hv');
          if (watchlists.mean_reversion.includes(symbol)) opp.strategies.push('mean_reversion');
        }
        opportunities.push(opp);
      }
    } catch (err) {
      console.warn(`Skipping ${symbol}:`, err.message);
    }
    processed++;
    if (onProgress) onProgress({ done: processed, total: allSymbols.length, symbol });
  }

  opportunities.sort((a, b) => b.annualizedYield - a.annualizedYield);
  return { opportunities, ivHistory };
}

// ── Lightweight price update ──────────────────────────────────────────────────
async function fetchCurrentPrices(onProgress = null) {
  const cache = loadCache();
  if (!cache?.data?.length) return null;

  const updatedData = [...cache.data];
  for (let i = 0; i < updatedData.length; i++) {
    if (onProgress) onProgress({ done: i, total: updatedData.length, symbol: updatedData[i].symbol });
    try {
      const quote    = await yahooFinance.quote(updatedData[i].symbol);
      const newPrice = quote.regularMarketPrice;
      if (!newPrice || newPrice <= 0) continue;
      updatedData[i] = {
        ...updatedData[i],
        currentPrice:   newPrice,
        marginOfSafety: ((newPrice - updatedData[i].strike) / newPrice) * 100
      };
    } catch (err) {
      console.warn(`Price update skipped for ${updatedData[i].symbol}:`, err.message);
    }
  }
  if (onProgress) onProgress({ done: updatedData.length, total: updatedData.length, symbol: '' });
  return updatedData;
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, payload));
}

function getNextDate(fromNow_days) {
  const d = new Date();
  d.setDate(d.getDate() + fromNow_days);
  return d.toISOString();
}

function getNextHour(fromNow_hours) {
  const d = new Date();
  d.setHours(d.getHours() + fromNow_hours);
  return d.toISOString();
}

// ── Scheduled full scan ───────────────────────────────────────────────────────
async function runScheduledFetch() {
  console.log('Running scheduled list refresh...');
  broadcast('auto-fetch-start', null);
  try {
    const { opportunities, ivHistory } = await fetchOptionsData();
    saveCache(opportunities, ivHistory);
    const settings = loadSettings();
    broadcast('auto-fetch-done', {
      data:           opportunities,
      fetchedAt:      new Date().toISOString(),
      pricedAt:       new Date().toISOString(),
      minMarginPct:   settings.minMarginPct,
      nextRefresh:    getNextDate(settings.refreshIntervalDays),
      nextPriceUpdate: getNextHour(settings.priceRefreshHours)
    });
  } catch (e) {
    console.error('Scheduled fetch failed:', e.message);
    broadcast('auto-fetch-error', e.message);
  }
}

// ── Scheduled price update ────────────────────────────────────────────────────
async function runScheduledPriceUpdate() {
  console.log('Running scheduled price update...');
  broadcast('auto-price-start', null);
  try {
    const updatedData = await fetchCurrentPrices();
    if (!updatedData) { broadcast('auto-price-error', 'No cached list'); return; }
    savePriceUpdate(updatedData);
    const settings = loadSettings();
    broadcast('auto-price-done', {
      data:           updatedData,
      pricedAt:       new Date().toISOString(),
      nextPriceUpdate: getNextHour(settings.priceRefreshHours)
    });
  } catch (e) {
    console.error('Scheduled price update failed:', e.message);
    broadcast('auto-price-error', e.message);
  }
}

// ── Schedulers ────────────────────────────────────────────────────────────────
function initScheduler() {
  const settings = loadSettings();
  const cache     = loadCache();
  const listMs    = settings.refreshIntervalDays * 24 * 60 * 60 * 1000;
  const lastFetch = cache?.fetchedAt ? new Date(cache.fetchedAt) : null;

  if (!lastFetch || (Date.now() - lastFetch) >= listMs)
    setTimeout(() => runScheduledFetch(), 3000);

  setInterval(() => {
    const s    = loadSettings();
    const c    = loadCache();
    const ms   = s.refreshIntervalDays * 24 * 60 * 60 * 1000;
    const last = c?.fetchedAt ? new Date(c.fetchedAt) : null;
    if (!last || (Date.now() - last) >= ms) runScheduledFetch();
  }, 60 * 60 * 1000);
}

function initPriceScheduler() {
  const settings    = loadSettings();
  const cache       = loadCache();
  if (!cache?.data?.length) return;

  const priceMs     = settings.priceRefreshHours * 60 * 60 * 1000;
  const lastPriced  = cache?.pricedAt ? new Date(cache.pricedAt) : null;

  if (!lastPriced || (Date.now() - lastPriced) >= priceMs)
    setTimeout(() => runScheduledPriceUpdate(), 5000);

  setInterval(() => {
    const s    = loadSettings();
    if (s.priceRefreshHours === 0) return;
    const c    = loadCache();
    const ms   = s.priceRefreshHours * 60 * 60 * 1000;
    const last = c?.pricedAt ? new Date(c.pricedAt) : null;
    if (!last || (Date.now() - last) >= ms) runScheduledPriceUpdate();
  }, 30 * 60 * 1000);
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: false,
    backgroundColor: '#070911',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ── IPC ───────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ipcMain.handle('load-initial-data', () => {
    const cache    = loadCache();
    const settings = loadSettings();
    if (!cache) return null;

    const daysAgo  = Math.floor((Date.now() - new Date(cache.fetchedAt)) / (24 * 60 * 60 * 1000));
    const hoursAgo = Math.floor((Date.now() - new Date(cache.pricedAt || cache.fetchedAt)) / (60 * 60 * 1000));

    return {
      data:           cache.data,
      fetchedAt:      cache.fetchedAt,
      pricedAt:       cache.pricedAt || cache.fetchedAt,
      minMarginPct:   cache.minMarginPct ?? null,
      nextRefresh:    getNextDate(settings.refreshIntervalDays - daysAgo),
      nextPriceUpdate: settings.priceRefreshHours > 0
        ? getNextHour(settings.priceRefreshHours - hoursAgo)
        : null
    };
  });

  ipcMain.handle('fetch-data', async (event) => {
    try {
      const onProgress = (p) => event.sender.send('fetch-progress', p);
      const { opportunities, ivHistory } = await fetchOptionsData(null, onProgress);
      saveCache(opportunities, ivHistory);
      const settings = loadSettings();
      const now = new Date().toISOString();
      return {
        success: true, data: opportunities,
        fetchedAt: now, pricedAt: now,
        minMarginPct:   settings.minMarginPct,
        nextRefresh:    getNextDate(settings.refreshIntervalDays),
        nextPriceUpdate: getNextHour(settings.priceRefreshHours)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fetch-prices', async (event) => {
    try {
      const onProgress = (p) => event.sender.send('price-progress', p);
      const updatedData = await fetchCurrentPrices(onProgress);
      if (!updatedData) return { success: false, error: 'No cached list to update' };
      savePriceUpdate(updatedData);
      const settings = loadSettings();
      const pricedAt = new Date().toISOString();
      return {
        success: true, data: updatedData, pricedAt,
        nextPriceUpdate: getNextHour(settings.priceRefreshHours)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.on('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window-close', () => BrowserWindow.getFocusedWindow()?.close());

  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_event, newSettings) => {
    const merged = { ...loadSettings(), ...newSettings };
    saveSettings(merged);
    return merged;
  });

  ipcMain.handle('fetch-history', async (_event, symbol) => {
    try {
      const end   = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const result = await yahooFinance.historical(symbol, { period1: start, period2: end, interval: '1d' });
      return result.map(d => ({ date: d.date.toISOString().split('T')[0], close: d.close }));
    } catch { return []; }
  });

  // ── Watchlist management ──────────────────────────────────────────────────
  ipcMain.handle('get-watchlists', () => {
    return loadSettings().watchlists || { ivr: [], iv_hv: [], mean_reversion: [] };
  });

  ipcMain.handle('add-to-watchlist', async (_event, { strategy, symbol }) => {
    const sym = (symbol || '').toUpperCase().trim();
    if (!sym) return { success: false, error: 'Symbol is required' };
    try {
      const quote = await yahooFinance.quote(sym);
      if (!quote || !quote.regularMarketPrice) return { success: false, error: 'Symbol not found' };
    } catch {
      return { success: false, error: 'Could not validate symbol' };
    }
    const settings   = loadSettings();
    const watchlists = settings.watchlists || { ivr: [], iv_hv: [], mean_reversion: [] };
    if (!watchlists[strategy]) watchlists[strategy] = [];
    if (!watchlists[strategy].includes(sym)) {
      watchlists[strategy] = [...watchlists[strategy], sym];
      saveSettings({ ...settings, watchlists });
    }
    return { success: true, watchlists };
  });

  ipcMain.handle('remove-from-watchlist', (_event, { strategy, symbol }) => {
    const settings   = loadSettings();
    const watchlists = settings.watchlists || { ivr: [], iv_hv: [], mean_reversion: [] };
    if (watchlists[strategy]) {
      watchlists[strategy] = watchlists[strategy].filter(s => s !== symbol);
      saveSettings({ ...settings, watchlists });
    }
    return { success: true, watchlists };
  });

  // ── Discovery ────────────────────────────────────────────────────────────────
  let discoveryRunning = false;
  ipcMain.handle('run-discovery', async (event) => {
    if (discoveryRunning) return { success: false, error: 'Scan already in progress' };
    discoveryRunning = true;
    try {
      const screens = ['most_actives', 'day_losers', 'growth_technology_stocks'];
      const batches = await Promise.allSettled(
        screens.map(scrId => yahooFinance.screener({ scrIds: scrId, count: 100 }))
      );
      const universe = [...new Set(
        batches
          .filter(r => r.status === 'fulfilled')
          .flatMap(r => (r.value?.quotes || []).map(q => q.symbol))
          .filter(s => s && /^[A-Z]{1,5}$/.test(s))
      )];

      if (universe.length === 0)
        return { success: false, error: 'Screener returned no results — try again later' };

      // Split into already-cached (today) vs needs fetching
      const discCache = loadDiscoveryCache();
      const today     = new Date().toISOString().split('T')[0];
      const cached    = universe.filter(s => discCache[s]?.date === today);
      const toFetch   = universe.filter(s => discCache[s]?.date !== today);

      // Report initial state so UI can show totals immediately
      event.sender.send('discovery-progress', {
        phase: 'scanning', done: cached.length, total: universe.length,
        symbol: '', fromCache: cached.length, toFetch: toFetch.length, fetched: 0,
      });

      // Collect cached opportunities (excluding nulls = didn't pass filters)
      const cachedOpps = cached.map(s => discCache[s].opp).filter(Boolean);

      // Fetch fresh symbols one by one, updating cache after each
      const settings           = loadSettings();
      const minMarginMultiplier = 1 - (parseFloat(settings.minMarginPct) / 100);
      const mainCache          = loadCache() || {};
      const ivHistory          = mainCache.ivHistory || {};
      const freshOpps          = [];
      let fetched              = 0;

      for (const symbol of toFetch) {
        let opp = null;
        try {
          opp = await analyzeSingleSymbol(symbol, minMarginMultiplier, ivHistory);
          if (opp) {
            opp.strategies = ['ivr', 'iv_hv', 'mean_reversion'];
            freshOpps.push(opp);
          }
        } catch (err) {
          console.warn(`Discovery skipping ${symbol}:`, err.message);
        }
        discCache[symbol] = { date: today, opp };
        fetched++;
        event.sender.send('discovery-progress', {
          phase: 'scanning',
          done: cached.length + fetched, total: universe.length,
          symbol, fromCache: cached.length, toFetch: toFetch.length, fetched,
        });
      }

      // Persist updated caches
      saveDiscoveryCache(discCache);
      if (Object.keys(ivHistory).length > 0) {
        const mc = loadCache() || {};
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...mc, ivHistory }), 'utf8');
      }

      const opportunities = [...cachedOpps, ...freshOpps];
      const top = 25;
      const results = {
        ivr: [...opportunities]
          .sort((a, b) => (b.ivr ?? b.impliedVolatility * 100) - (a.ivr ?? a.impliedVolatility * 100))
          .slice(0, top),
        iv_hv: [...opportunities]
          .sort((a, b) => (b.ivHvRatio || 0) - (a.ivHvRatio || 0))
          .slice(0, top),
        mean_reversion: [...opportunities]
          .sort((a, b) => {
            if (b.meanReversionSignal !== a.meanReversionSignal) return b.meanReversionSignal ? 1 : -1;
            return b.score - a.score;
          })
          .slice(0, top),
      };

      // Auto-add discovered stocks to watchlists
      const settings2   = loadSettings();
      const watchlists2 = { ivr: [], iv_hv: [], mean_reversion: [], ...(settings2.watchlists || {}) };
      let totalAdded = 0;
      for (const [strategyId, items] of Object.entries(results)) {
        const existing = new Set(watchlists2[strategyId] || []);
        for (const opp of items) {
          if (!existing.has(opp.symbol)) { existing.add(opp.symbol); totalAdded++; }
        }
        watchlists2[strategyId] = [...existing];
      }
      saveSettings({ ...settings2, watchlists: watchlists2 });

      return {
        success: true, results, watchlists: watchlists2,
        scanned: universe.length, found: opportunities.length,
        fromCache: cached.length, fetched: toFetch.length, totalAdded,
      };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      discoveryRunning = false;
    }
  });

  createWindow();
  initScheduler();
  initPriceScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
