'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let allData    = [];
let watchlists = { ivr: [], iv_hv: [], mean_reversion: [] };
let currentModal = null;
let priceChart   = null;

// sort state keyed by tableId: { col, dir }  ('asc' | 'desc')
const tableSortState = {};

// ─── Strategy metadata ────────────────────────────────────────────────────────
const STRATEGIES = {
  ivr: {
    id: 'ivr', tbodyId: 'tbody-ivr', chipsId: 'chips-ivr',
    inputId: 'add-input-ivr', btnId: 'add-btn-ivr', errorId: 'add-error-ivr',
    label: 'IV Rank', badgeCls: 'badge-ivr', badgeLabel: 'IVR'
  },
  iv_hv: {
    id: 'iv_hv', tbodyId: 'tbody-iv-hv', chipsId: 'chips-iv-hv',
    inputId: 'add-input-iv-hv', btnId: 'add-btn-iv-hv', errorId: 'add-error-iv-hv',
    label: 'IV vs HV', badgeCls: 'badge-iv-hv', badgeLabel: 'IV/HV'
  },
  mean_reversion: {
    id: 'mean_reversion', tbodyId: 'tbody-mr', chipsId: 'chips-mr',
    inputId: 'add-input-mr', btnId: 'add-btn-mr', errorId: 'add-error-mr',
    label: 'Mean Reversion', badgeCls: 'badge-mr', badgeLabel: 'MR'
  }
};

// ─── Format helpers ───────────────────────────────────────────────────────────
const fmt = {
  currency: v => v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct:      v => v == null ? '—' : v.toFixed(2) + '%',
  num:      v => v == null ? '—' : v.toLocaleString('en-US'),
};

function el(id) { return document.getElementById(id); }

// ─── Score rendering ──────────────────────────────────────────────────────────
function renderScore(score) {
  const s = score ?? 0;
  return `<span class="score-dots score-${s}" title="Signal score: ${s}/5">${'●'.repeat(s)}${'○'.repeat(5 - s)}</span>`;
}

// ─── Strategy badge rendering ─────────────────────────────────────────────────
function renderStrategyBadges(strategies) {
  if (!strategies?.length) return '';
  return strategies.map(sid => {
    const m = STRATEGIES[sid];
    return m ? `<span class="strategy-badge ${m.badgeCls}">${m.badgeLabel}</span>` : '';
  }).join('');
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const view = el('view-' + viewId);
  if (view) view.classList.add('active');
  const link = document.querySelector(`.nav-link[data-view="${viewId}"]`);
  if (link) link.classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => navigate(link.dataset.view));
});

// ─── Status indicator ─────────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot   = el('status-dot');
  const label = el('status-text');
  dot.className     = 'status-dot ' + state;
  label.textContent = text;
}

// ─── Metric cards ─────────────────────────────────────────────────────────────
function renderMetricCards(data) {
  const top25 = data.slice(0, 25);
  const container = el('metric-cards');

  if (top25.length === 0) {
    container.innerHTML = `
      <div class="metric-card"><div class="metric-label">Avg. Monthly Yield</div><div class="metric-value">—</div></div>
      <div class="metric-card"><div class="metric-label">Avg. Annualized Yield</div><div class="metric-value">—</div></div>
      <div class="metric-card"><div class="metric-label">Top Premium Available</div><div class="metric-value">—</div></div>
      <div class="metric-card"><div class="metric-label">Active Opportunities</div><div class="metric-value">0</div></div>
    `;
    return;
  }

  const avgMonthly  = top25.reduce((s, d) => s + d.monthlyYield, 0) / top25.length;
  const avgAnnual   = top25.reduce((s, d) => s + d.annualizedYield, 0) / top25.length;
  const topPremium  = Math.max(...top25.map(d => d.premium * 100));
  const count       = data.length;

  container.innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Avg. Monthly Yield</div>
      <div class="metric-value">${fmt.pct(avgMonthly)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Avg. Annualized Yield</div>
      <div class="metric-value">${fmt.pct(avgAnnual)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Top Premium Available</div>
      <div class="metric-value">${fmt.currency(topPremium)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Opportunities</div>
      <div class="metric-value">${count}</div>
    </div>
  `;
}

// ─── Preview lists ────────────────────────────────────────────────────────────
function renderPreviewList(containerId, items) {
  const container = el(containerId);
  if (!items.length) {
    container.innerHTML = '<p class="preview-empty">No data available.</p>';
    return;
  }
  container.innerHTML = items.slice(0, 3).map((d, i) => `
    <div class="preview-item" data-idx="${allData.indexOf(d)}">
      <div class="preview-item-left">
        <span class="preview-rank">${i + 1}</span>
        <span class="preview-symbol">${d.symbol}</span>
        ${renderStrategyBadges(d.strategies || [])}
        <span class="preview-info">${fmt.currency(d.strike)} strike · ${d.dte}d</span>
      </div>
      <span class="preview-yield">${fmt.pct(d.annualizedYield)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', () => openModal(allData[+item.dataset.idx]));
  });
}

// ─── Standard tables (Top 25 / Under $10k) ───────────────────────────────────
function buildTableRows(items, tbodyId, sortState) {
  const tbody = el(tbodyId);
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No opportunities found.</td></tr>';
    return;
  }

  let sorted = items.slice(0, 25);
  if (sortState?.col && sortState.col !== 'rank') {
    const { col, dir } = sortState;
    sorted = [...sorted].sort((a, b) => {
      const av = col === 'symbol' ? (a[col] || '').toLowerCase() : (a[col] ?? -Infinity);
      const bv = col === 'symbol' ? (b[col] || '').toLowerCase() : (b[col] ?? -Infinity);
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  tbody.innerHTML = sorted.map((d, i) => `
    <tr>
      <td class="td-rank">${i + 1}</td>
      <td class="td-symbol">${d.symbol}${renderStrategyBadges(d.strategies || [])}</td>
      <td class="td-score">${renderScore(d.score)}</td>
      <td class="td-price">${fmt.currency(d.currentPrice)}</td>
      <td class="td-strike">${fmt.currency(d.strike)}</td>
      <td class="td-dte">${d.dte}d</td>
      <td class="td-premium">${fmt.currency(d.premium)}</td>
      <td class="td-capital">${fmt.currency(d.capitalRequired)}</td>
      <td class="td-yield-mo">${fmt.pct(d.monthlyYield)}</td>
      <td class="td-yield-ann">${fmt.pct(d.annualizedYield)}</td>
      <td class="td-income">${fmt.currency(d.monthlyIncome)}</td>
      <td><button class="analyze-btn" data-idx="${allData.indexOf(d)}">Analyze</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(allData[+btn.dataset.idx]));
  });
}

function renderTables(data) {
  const under10k = data.filter(d => d.currentPrice <= 100);
  buildTableRows(data,      'tbody-top25',    tableSortState['table-top25']);
  buildTableRows(under10k,  'tbody-under10k', tableSortState['table-under10k']);
}

function initSortableTable(tableId, getItems) {
  const table = el(tableId);
  if (!table) return;
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const prev = tableSortState[tableId];
      const dir  = prev?.col === col && prev.dir === 'desc' ? 'asc' : 'desc';
      tableSortState[tableId] = { col, dir };

      table.querySelectorAll('thead th').forEach(h => h.removeAttribute('data-sort'));
      th.setAttribute('data-sort', dir);

      const tbodyId = table.querySelector('tbody')?.id;
      if (tbodyId) buildTableRows(getItems(), tbodyId, tableSortState[tableId]);
    });
  });
}

// ─── Strategy tables ──────────────────────────────────────────────────────────
function renderStrategyTable(strategyId) {
  const meta  = STRATEGIES[strategyId];
  const tbody = el(meta.tbodyId);
  if (!tbody) return;

  const items = allData.filter(d => (d.strategies || []).includes(strategyId)).slice(0, 25);

  if (!items.length) {
    const hasWatchlist = (watchlists[strategyId] || []).length > 0;
    tbody.innerHTML = `<tr><td colspan="11" class="empty-row">${
      hasWatchlist
        ? 'No qualifying opportunities — run a scan or adjust your watchlist.'
        : 'Add stocks to your watchlist to get started.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((d, i) => {
    const ivPct   = d.impliedVolatility > 0 ? (d.impliedVolatility * 100).toFixed(0) + '%' : '—';
    const ivhvStr = d.ivHvRatio > 0          ? d.ivHvRatio.toFixed(2) + 'x'              : '—';
    const ivrStr  = d.ivr != null             ? d.ivr.toFixed(0)                          : '—';
    const ivrCls  = d.ivr != null && d.ivr >= 50 ? 'td-highlight' : '';
    const ivhvCls = d.ivHvRatio >= 1.3           ? 'td-highlight' : '';
    return `
      <tr>
        <td class="td-rank">${i + 1}</td>
        <td class="td-symbol">${d.symbol}${renderStrategyBadges(d.strategies || [])}</td>
        <td class="td-score">${renderScore(d.score)}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-strike">${fmt.currency(d.strike)}</td>
        <td class="td-dte">${d.dte}d</td>
        <td class="td-iv">${ivPct}</td>
        <td class="td-ivhv ${ivhvCls}">${ivhvStr}</td>
        <td class="td-ivr ${ivrCls}">${ivrStr}</td>
        <td class="td-yield-ann">${fmt.pct(d.annualizedYield)}</td>
        <td><button class="analyze-btn" data-idx="${allData.indexOf(d)}">Analyze</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(allData[+btn.dataset.idx]));
  });
}

// ─── Watchlist chips ──────────────────────────────────────────────────────────
function renderWatchlistChips(strategyId) {
  const meta      = STRATEGIES[strategyId];
  const container = el(meta.chipsId);
  if (!container) return;

  const symbols = watchlists[strategyId] || [];
  if (!symbols.length) {
    container.innerHTML = '<span class="chips-empty">No stocks added yet.</span>';
    return;
  }

  container.innerHTML = symbols.map(sym => `
    <span class="watchlist-chip">
      ${sym}
      <button class="chip-remove" data-strategy="${strategyId}" data-symbol="${sym}" title="Remove">×</button>
    </span>
  `).join('');

  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromWatchlist(btn.dataset.strategy, btn.dataset.symbol));
  });
}

// ─── Add / Remove stocks ──────────────────────────────────────────────────────
async function addToWatchlist(strategyId) {
  const meta   = STRATEGIES[strategyId];
  const input  = el(meta.inputId);
  const errEl  = el(meta.errorId);
  const btn    = el(meta.btnId);
  if (!input?.value.trim()) return;

  const symbol = input.value.trim().toUpperCase();
  btn.disabled     = true;
  btn.textContent  = '…';
  if (errEl) errEl.textContent = '';

  try {
    const result = await window.electronAPI.addToWatchlist({ strategy: strategyId, symbol });
    if (result.success) {
      watchlists = result.watchlists;
      input.value = '';
      renderWatchlistChips(strategyId);
      renderStrategyTable(strategyId);
    } else {
      if (errEl) errEl.textContent = result.error || 'Invalid symbol';
    }
  } catch {
    if (errEl) errEl.textContent = 'Failed to add';
  } finally {
    btn.disabled    = false;
    btn.textContent = '+ Add';
  }
}

async function removeFromWatchlist(strategyId, symbol) {
  try {
    const result = await window.electronAPI.removeFromWatchlist({ strategy: strategyId, symbol });
    if (result.success) {
      watchlists = result.watchlists;
      renderWatchlistChips(strategyId);
      renderStrategyTable(strategyId);
    }
  } catch (e) {
    console.warn('Remove failed:', e);
  }
}

// ─── Full render ──────────────────────────────────────────────────────────────
function renderAll(data) {
  allData = data;
  const isEmpty = data.length === 0;
  el('empty-state').style.display  = isEmpty ? 'flex' : 'none';
  el('preview-grid').style.display = isEmpty ? 'none' : 'grid';

  renderMetricCards(data);
  renderTables(data);
  renderPreviewList('preview-overall', data);
  renderPreviewList('preview-under10k', data.filter(d => d.currentPrice <= 100));
  Object.keys(STRATEGIES).forEach(sid => renderStrategyTable(sid));
}

// ─── Watchlist init ───────────────────────────────────────────────────────────
async function initWatchlists() {
  try { watchlists = await window.electronAPI.getWatchlists(); } catch {}

  Object.values(STRATEGIES).forEach(meta => {
    renderWatchlistChips(meta.id);

    const btn   = el(meta.btnId);
    const input = el(meta.inputId);
    if (btn)   btn.addEventListener('click', () => addToWatchlist(meta.id));
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addToWatchlist(meta.id); });
  });
}

// ─── Analysis Modal ───────────────────────────────────────────────────────────
async function openModal(d) {
  if (!d) return;
  currentModal = d;

  el('modal-company').textContent  = d.companyName || d.symbol;
  el('modal-exchange').textContent = d.exchange || '';
  el('modal-symbol-badge').textContent = d.symbol;
  el('modal-strategy-badges').innerHTML = renderStrategyBadges(d.strategies || []);

  el('mechanics-text').textContent =
    `Sell 1 put contract with a $${d.strike.toFixed(2)} strike expiring in ${d.dte} days ` +
    `for a premium of $${(d.premium * 100).toFixed(2)} (${fmt.pct(d.marginOfSafety)} below current price). ` +
    `If assigned, you will be obligated to buy 100 shares at $${d.strike.toFixed(2)}, ` +
    `requiring $${d.capitalRequired.toLocaleString()} in capital. ` +
    `Your break-even price is $${d.breakEven.toFixed(2)}.`;

  const volStr  = d.impliedVolatility > 0 ? fmt.pct(d.impliedVolatility * 100) : 'N/A';
  const voiStr  = d.openInterest > 0 ? (d.volume / d.openInterest).toFixed(2) + 'x' : 'N/A';
  const hvStr   = d.hv > 0 ? fmt.pct(d.hv * 100) : 'N/A';
  const ivhvStr = d.ivHvRatio > 0 ? d.ivHvRatio.toFixed(2) + 'x' : 'N/A';
  const ivrStr  = d.ivr != null ? d.ivr.toFixed(0) : 'Insufficient history';
  const ivrCls  = d.ivr != null && d.ivr >= 50 ? 'green' : '';
  const ivhvCls = d.ivHvRatio >= 1.3 ? 'green' : '';
  const mrStr   = d.meanReversionSignal ? 'Active' : 'Not detected';
  const mrCls   = d.meanReversionSignal ? 'green' : '';
  const scoreStr = `${d.score ?? 0}/5`;
  const scoreCls = (d.score ?? 0) >= 4 ? 'green' : (d.score ?? 0) >= 2 ? 'cyan' : '';

  el('stats-grid').innerHTML = [
    { label: 'Implied Volatility',   value: volStr,  cls: 'cyan'   },
    { label: 'Historical Vol (30d)', value: hvStr,   cls: ''       },
    { label: 'IV / HV Ratio',        value: ivhvStr, cls: ivhvCls  },
    { label: 'IV Rank (IVR)',        value: ivrStr,  cls: ivrCls   },
    { label: 'Mean Rev. Signal',     value: mrStr,   cls: mrCls    },
    { label: 'Signal Score',         value: scoreStr,cls: scoreCls },
    { label: 'Break-Even Price',     value: fmt.currency(d.breakEven), cls: '' },
    { label: 'Margin of Safety',     value: fmt.pct(d.marginOfSafety), cls: 'green' },
    { label: 'Vol / OI Ratio',       value: voiStr,  cls: ''       },
    { label: 'Open Interest',        value: fmt.num(d.openInterest), cls: '' },
    { label: 'Volume',               value: fmt.num(d.volume),       cls: '' },
    { label: 'Expiration',           value: d.expirationDate,        cls: '' },
  ].map(s => `
    <div class="stat-item">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value ${s.cls}">${s.value}</div>
    </div>
  `).join('');

  el('modal-overlay').classList.remove('hidden');
  renderChart([], d.symbol);

  try {
    const history = await window.electronAPI.fetchHistory(d.symbol);
    renderChart(history, d.symbol);
  } catch (e) {
    console.warn('History fetch failed:', e);
  }
}

function closeModal() {
  el('modal-overlay').classList.add('hidden');
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  currentModal = null;
}

function renderChart(history, symbol) {
  const canvas = el('price-chart');
  if (priceChart) { priceChart.destroy(); priceChart = null; }

  if (!history.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const ctx      = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 180);
  gradient.addColorStop(0, 'rgba(0, 240, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        label: symbol + ' Close',
        data: history.map(h => h.close),
        borderColor: '#00f0ff',
        borderWidth: 2,
        backgroundColor: gradient,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13, 17, 23, 0.95)',
          borderColor: 'rgba(0, 240, 255, 0.3)',
          borderWidth: 1,
          titleColor: '#6b7280',
          bodyColor: '#e8eaf0',
          callbacks: { label: ctx => ' $' + ctx.parsed.y.toFixed(2) }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#6b7280', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 6 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#6b7280', font: { family: 'JetBrains Mono', size: 10 }, callback: v => '$' + v.toFixed(0) }
        }
      }
    }
  });
}

el('modal-close').addEventListener('click', closeModal);
el('modal-overlay').addEventListener('click', e => {
  if (e.target === el('modal-overlay')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!el('modal-overlay').classList.contains('hidden')) { closeModal(); return; }
    if (!el('help-overlay').classList.contains('hidden'))  { closeHelp(); }
  }
});

// ─── Help modal ───────────────────────────────────────────────────────────────
function openHelp()  { el('help-overlay').classList.remove('hidden'); }
function closeHelp() { el('help-overlay').classList.add('hidden'); }

el('help-btn').addEventListener('click', openHelp);
el('help-close').addEventListener('click', closeHelp);
el('help-overlay').addEventListener('click', e => {
  if (e.target === el('help-overlay')) closeHelp();
});

// ─── Settings UI ─────────────────────────────────────────────────────────────
const DATE_FMT = { month: 'short', day: 'numeric', year: 'numeric' };
const TIME_FMT = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

const INTERVAL_DESCS = {
  '7':  'Full options scan every week.',
  '14': 'Full options scan every 2 weeks.',
  '21': 'Full options scan every 3 weeks.',
  '30': 'Full options scan once a month.'
};

const MARGIN_DESCS = {
  '0':    'Picks the strike closest to the current price. Max premium, minimal cushion.',
  '5':    'Strike ≥5% below price. Balanced premium and downside protection.',
  '7.5':  'Strike ≥7.5% below price. Moderate cushion with decent yield.',
  '10':   'Strike ≥10% below price. Conservative — stock needs a 10% drop to be at risk.',
  '12.5': 'Strike ≥12.5% below price. Wide buffer, noticeably lower yield.',
  '15':   'Strike ≥15% below price. Maximum protection, lowest yield.'
};

const PRICE_INTERVAL_DESCS = {
  '6':  'Current stock prices refresh every 6 hours.',
  '12': 'Current stock prices refresh every 12 hours.',
  '24': 'Current stock prices refresh once a day.',
  '0':  'Prices only update when you click Update Prices.'
};

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', DATE_FMT) : '—';
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-US', TIME_FMT) : '—';

function updateIntervalDesc(val)      { const e = el('interval-desc');       if (e) e.textContent = INTERVAL_DESCS[val] || ''; }
function updateMarginDesc(val)        { const e = el('margin-desc');         if (e) e.textContent = MARGIN_DESCS[String(val)] || ''; }
function updatePriceIntervalDesc(val) { const e = el('price-interval-desc'); if (e) e.textContent = PRICE_INTERVAL_DESCS[String(val)] || ''; }

function setListLabels(fetchedAt, minMarginPct, nextRefresh) {
  const dateEl    = el('last-updated-date');
  const marginEl  = el('last-margin-used');
  const marginRow = el('last-margin-row');
  const nextEl    = el('next-refresh-date');
  if (dateEl)  dateEl.textContent  = fmtDate(fetchedAt);
  if (nextEl)  nextEl.textContent  = fmtDate(nextRefresh);
  if (minMarginPct != null && marginEl && marginRow) {
    marginEl.textContent      = minMarginPct + '% OTM margin';
    marginRow.style.display   = '';
  }
}

function setPriceLabels(pricedAt, nextPriceUpdate) {
  const lastEl = el('last-priced-date');
  const nextEl = el('next-price-date');
  if (lastEl) lastEl.textContent = fmtTime(pricedAt);
  if (nextEl) nextEl.textContent = nextPriceUpdate ? fmtTime(nextPriceUpdate) : 'Manual';
}

function setListBtnsState(loading) {
  ['refresh-btn', 'sidebar-refresh-btn'].forEach(id => {
    const b = el(id); if (!b) return;
    b.disabled = loading;
    loading ? b.classList.add('spinning') : b.classList.remove('spinning');
  });
}

function setPriceBtnState(loading) {
  const b = el('price-refresh-btn'); if (!b) return;
  b.disabled = loading;
  loading ? b.classList.add('spinning') : b.classList.remove('spinning');
}

async function initSettingsUI() {
  try {
    const settings    = await window.electronAPI.getSettings();
    const intervalSel = el('interval-select');
    const marginSel   = el('margin-select');
    const priceSel    = el('price-interval-select');
    if (intervalSel && settings.refreshIntervalDays) {
      intervalSel.value = String(settings.refreshIntervalDays);
      updateIntervalDesc(String(settings.refreshIntervalDays));
    }
    if (marginSel && settings.minMarginPct != null) {
      marginSel.value = String(settings.minMarginPct);
      updateMarginDesc(settings.minMarginPct);
    }
    if (priceSel && settings.priceRefreshHours != null) {
      priceSel.value = String(settings.priceRefreshHours);
      updatePriceIntervalDesc(String(settings.priceRefreshHours));
    }
  } catch {}
}

el('interval-select').addEventListener('change', async e => {
  await window.electronAPI.saveSettings({ refreshIntervalDays: parseInt(e.target.value, 10) });
  updateIntervalDesc(e.target.value);
});

el('margin-select').addEventListener('change', async e => {
  await window.electronAPI.saveSettings({ minMarginPct: parseFloat(e.target.value) });
  updateMarginDesc(e.target.value);
});

el('price-interval-select').addEventListener('change', async e => {
  await window.electronAPI.saveSettings({ priceRefreshHours: parseFloat(e.target.value) });
  updatePriceIntervalDesc(e.target.value);
});

// ─── List refresh ─────────────────────────────────────────────────────────────
async function loadInitialData() {
  setStatus('loading', 'Loading cache…');
  try {
    const result = await window.electronAPI.loadInitialData();
    if (result?.data?.length) {
      renderAll(result.data);
      setStatus('live', 'Live');
      setListLabels(result.fetchedAt, result.minMarginPct, result.nextRefresh);
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
    } else {
      renderAll([]);
      setStatus('', 'No data — add stocks and refresh');
    }
  } catch {
    setStatus('error', 'Cache error');
  }
}

function showSettingsProgress(wrapId, fillId, countId, symbolId) {
  el(wrapId).classList.remove('hidden');
  el(fillId).style.width = '0%';
  el(countId).textContent = '';
  el(symbolId).textContent = '';
}
function updateSettingsProgress(fillId, countId, symbolId, done, total, symbol) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  el(fillId).style.width = pct + '%';
  el(countId).textContent = total > 0 ? `${done} / ${total}` : '';
  el(symbolId).textContent = symbol || '';
}
function hideSettingsProgress(wrapId) {
  el(wrapId).classList.add('hidden');
}

async function refreshData() {
  setListBtnsState(true);
  setStatus('loading', 'Scanning options chains…');
  showSettingsProgress('fetch-progress-wrap', 'fetch-progress-fill', 'fetch-progress-count', 'fetch-progress-symbol');
  window.electronAPI.onFetchProgress(({ done, total, symbol }) => {
    updateSettingsProgress('fetch-progress-fill', 'fetch-progress-count', 'fetch-progress-symbol', done, total, symbol);
  });
  try {
    const result = await window.electronAPI.fetchData();
    if (result.success) {
      renderAll(result.data);
      setListLabels(result.fetchedAt, result.minMarginPct, result.nextRefresh);
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
      setStatus(result.data.length ? 'live' : '', result.data.length ? 'Live' : 'No results — add stocks to your watchlists');
    } else {
      setStatus('error', result.error || 'Fetch failed');
    }
  } catch {
    setStatus('error', 'Network error');
  } finally {
    window.electronAPI.offFetchProgress();
    hideSettingsProgress('fetch-progress-wrap');
    setListBtnsState(false);
  }
}

// ─── Price update ─────────────────────────────────────────────────────────────
async function updatePrices() {
  setPriceBtnState(true);
  setStatus('loading', 'Updating prices…');
  showSettingsProgress('price-progress-wrap', 'price-progress-fill', 'price-progress-count', 'price-progress-symbol');
  window.electronAPI.onPriceProgress(({ done, total, symbol }) => {
    updateSettingsProgress('price-progress-fill', 'price-progress-count', 'price-progress-symbol', done, total, symbol);
  });
  try {
    const result = await window.electronAPI.fetchPrices();
    if (result.success) {
      renderAll(result.data);
      setStatus('live', 'Live');
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
    } else {
      setStatus('error', result.error || 'Price update failed');
    }
  } catch {
    setStatus('error', 'Network error');
  } finally {
    window.electronAPI.offPriceProgress();
    hideSettingsProgress('price-progress-wrap');
    setPriceBtnState(false);
  }
}

// ─── Push events from main ────────────────────────────────────────────────────
window.electronAPI.onAutoFetchStart(() => {
  setListBtnsState(true);
  setStatus('loading', 'Auto-scanning…');
});
window.electronAPI.onAutoFetchDone(({ data, fetchedAt, pricedAt, minMarginPct, nextRefresh, nextPriceUpdate }) => {
  renderAll(data);
  setStatus('live', 'Live');
  setListLabels(fetchedAt, minMarginPct, nextRefresh);
  setPriceLabels(pricedAt, nextPriceUpdate);
  setListBtnsState(false);
});
window.electronAPI.onAutoFetchError(() => { setStatus('error', 'Auto-refresh failed'); setListBtnsState(false); });

window.electronAPI.onAutoPriceStart(() => { setPriceBtnState(true); });
window.electronAPI.onAutoPriceDone(({ data, pricedAt, nextPriceUpdate }) => {
  renderAll(data);
  setPriceLabels(pricedAt, nextPriceUpdate);
  setPriceBtnState(false);
});
window.electronAPI.onAutoPriceError(() => { setPriceBtnState(false); });

// ─── Discover View ────────────────────────────────────────────────────────────
const DISCOVER_TBODIES = {
  ivr:            'discover-tbody-ivr',
  iv_hv:          'discover-tbody-iv-hv',
  mean_reversion: 'discover-tbody-mr',
};

function renderDiscoverTable(strategyId, items) {
  const tbody = el(DISCOVER_TBODIES[strategyId]);
  if (!tbody) return;
  if (!items?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No qualifying candidates found.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map((d, i) => {
    const ivPct   = d.impliedVolatility > 0 ? (d.impliedVolatility * 100).toFixed(1) + '%' : '—';
    const ivhvStr = d.ivHvRatio > 0          ? d.ivHvRatio.toFixed(2) + 'x'              : '—';
    const ivrStr  = d.ivr != null             ? d.ivr.toFixed(0)                          : '—';
    const ivrCls  = d.ivr != null && d.ivr >= 50 ? 'td-highlight' : '';
    const ivhvCls = d.ivHvRatio >= 1.3           ? 'td-highlight' : '';

    let metric3;
    if (strategyId === 'ivr') {
      metric3 = `<td class="td-ivr ${ivrCls}">${ivrStr}</td><td class="td-ivhv ${ivhvCls}">${ivhvStr}</td>`;
    } else if (strategyId === 'iv_hv') {
      metric3 = `<td class="td-ivhv ${ivhvCls}">${ivhvStr}</td><td class="td-ivr ${ivrCls}">${ivrStr}</td>`;
    } else {
      const mrHtml = d.meanReversionSignal
        ? '<span class="discover-signal-active">● Active</span>'
        : '<span class="discover-signal-none">—</span>';
      metric3 = `<td class="td-ivhv ${ivhvCls}">${ivhvStr}</td><td>${mrHtml}</td>`;
    }

    return `
      <tr>
        <td class="td-rank">${i + 1}</td>
        <td class="td-symbol">${d.symbol}<div class="discover-company">${d.companyName || ''}</div></td>
        <td class="td-score">${renderScore(d.score)}</td>
        <td class="td-iv">${ivPct}</td>
        ${metric3}
        <td class="td-yield-ann">${fmt.pct(d.annualizedYield)}</td>
      </tr>`;
  }).join('');
}

function setDiscoverProgress({ phase, done, total, symbol, fromCache, toFetch, fetched }) {
  const titleEl  = el('discover-progress-title');
  const countEl  = el('discover-progress-count');
  const fillEl   = el('discover-progress-fill');
  const symbolEl = el('discover-progress-symbol');

  if (phase === 'scanning' && total > 0) {
    const pct = Math.round((done / total) * 100);
    if (titleEl) titleEl.textContent = 'Scanning options chains…';

    if (fromCache != null && toFetch != null) {
      const cachedPart  = `<span class="dp-cached">✓ ${fromCache} cached</span>`;
      const fetchPart   = `<span class="dp-fetching">⟳ ${fetched ?? 0} / ${toFetch} fetching</span>`;
      if (countEl) countEl.innerHTML = `${cachedPart}&ensp;·&ensp;${fetchPart}`;
    } else {
      if (countEl) countEl.textContent = `${done} / ${total}`;
    }

    if (fillEl)   fillEl.style.width   = pct + '%';
    if (symbolEl) symbolEl.textContent = symbol || '';
  } else {
    if (titleEl)  titleEl.textContent  = 'Fetching stock universe…';
    if (countEl)  countEl.textContent  = '';
    if (fillEl)   fillEl.style.width   = '0%';
    if (symbolEl) symbolEl.textContent = '';
  }
}

function initDiscoverView() {
  async function runScan(options = {}) {
    const runBtn      = el('discover-run-btn');
    const forceBtn    = el('discover-force-btn');
    const runAgainBtn = el('discover-run-again-btn');
    [runBtn, forceBtn, runAgainBtn].forEach(b => { if (b) { b.disabled = true; b.classList.add('spinning'); } });
    el('discover-results').classList.add('hidden');
    el('discover-progress').classList.remove('hidden');
    setDiscoverProgress({ phase: 'fetching', done: 0, total: 0, symbol: '' });

    try {
      const result = await window.electronAPI.runDiscovery(options);
      el('discover-progress').classList.add('hidden');
      if (result.success) {
        Object.keys(DISCOVER_TBODIES).forEach(sid => renderDiscoverTable(sid, result.results[sid]));
        el('discover-results').classList.remove('hidden');

        if (result.watchlists) {
          watchlists = result.watchlists;
          Object.keys(STRATEGIES).forEach(sid => {
            renderWatchlistChips(sid);
            renderStrategyTable(sid);
          });
        }

        const sumEl = el('discover-summary');
        if (sumEl) {
          const cacheNote = result.fromCache > 0 ? ` (${result.fromCache} from cache, ${result.fetched} fetched fresh)` : '';
          const addNote   = result.totalAdded  > 0 ? ` · ${result.totalAdded} new stocks added to watchlists` : '';
          sumEl.textContent = `Scanned ${result.scanned} stocks · ${result.found} passed filters${cacheNote}${addNote}`;
        }
      } else {
        const titleEl = el('discover-progress-title');
        if (titleEl) titleEl.textContent = 'Scan failed: ' + (result.error || 'Unknown error');
        el('discover-progress').classList.remove('hidden');
      }
    } catch (e) {
      const titleEl = el('discover-progress-title');
      if (titleEl) titleEl.textContent = 'Scan failed: ' + e.message;
      el('discover-progress').classList.remove('hidden');
    } finally {
      const runBtn      = el('discover-run-btn');
      const forceBtn    = el('discover-force-btn');
      const runAgainBtn = el('discover-run-again-btn');
      [runBtn, forceBtn, runAgainBtn].forEach(b => { if (b) { b.disabled = false; b.classList.remove('spinning'); } });
    }
  }

  const runBtn = el('discover-run-btn');
  const forceBtn = el('discover-force-btn');
  const runAgainBtn = el('discover-run-again-btn');
  if (runBtn) runBtn.addEventListener('click', () => runScan());
  if (forceBtn) forceBtn.addEventListener('click', () => runScan({ force: true }));
  if (runAgainBtn) runAgainBtn.addEventListener('click', () => runScan());

  window.electronAPI.onDiscoveryProgress(setDiscoverProgress);
}

// ─── Button wiring ────────────────────────────────────────────────────────────
el('refresh-btn').addEventListener('click', refreshData);
el('sidebar-refresh-btn').addEventListener('click', refreshData);
el('price-refresh-btn').addEventListener('click', updatePrices);

// ─── Window controls ─────────────────────────────────────────────────────────
el('wc-minimize').addEventListener('click', () => window.electronAPI.minimizeWindow());
el('wc-maximize').addEventListener('click', () => window.electronAPI.maximizeWindow());
el('wc-close').addEventListener('click',    () => window.electronAPI.closeWindow());

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSettingsUI();
initWatchlists();
initDiscoverView();
initSortableTable('table-top25',    () => allData);
initSortableTable('table-under10k', () => allData.filter(d => d.currentPrice <= 100));
loadInitialData();
