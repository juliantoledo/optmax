# OptMax

A desktop application for finding and tracking cash-secured put opportunities. OptMax scans options chains in real time, scores each opportunity across three volatility strategies, and surfaces the top 25 candidates — so you spend less time screening and more time trading.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)
![License](https://img.shields.io/badge/license-ISC-green)

---

## Features

### Opportunity Discovery
- **Market Scanner** — scans Yahoo Finance screeners (Most Active, Day Losers, Growth Tech) to find fresh put-selling candidates across three strategies
- **Per-symbol caching** — already-scanned symbols are reused for the day; only new ones are fetched, with a live progress bar showing cached vs. fetching counts
- **Auto-add to watchlists** — discovered stocks are automatically added to the relevant strategy watchlists

### Strategy Views
Three distinct strategy lenses, each ranking up to 25 stocks:

| Strategy | Signal | Best for |
|---|---|---|
| **IV Rank (IVR)** | Current IV is high relative to its 52-week range | Selling premium when volatility is historically elevated |
| **IV vs HV** | Implied volatility exceeds historical volatility | Options are overpriced relative to realized moves |
| **Mean Reversion** | IV spiked then pulled back, suggesting a vol crush | Fading panic — selling puts after a volatility event |

### Rankings
- **Top 25 Overall** — all watchlist stocks ranked by annualized yield
- **Under $10k Capital** — same ranking filtered to stocks ≤ $100 (capital requirement ≤ $10,000)
- Both tables include a **signal score** (●●●●○) and **click-to-sort** on every column

### Deep-Dive Analysis
Click **Analyze** on any row to open a modal with:
- 30-day price chart with gradient fill
- Trade mechanics explained in plain English
- Implied Volatility, IV Rank, IV/HV ratio, Break-Even, Margin of Safety

### Settings
- Configure scan interval and minimum OTM margin
- Live progress bars for both List Refresh and Price Update operations
- Last run / next scheduled run timestamps

---

## Screenshots

> Add screenshots here after first launch.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | [Electron](https://www.electronjs.org/) 42 |
| Frontend | Vanilla HTML5 / CSS3 / JavaScript (ES6+) |
| Data | [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) |
| Charts | [Chart.js](https://www.chartjs.org/) (CDN) |
| Packaging | [electron-builder](https://www.electron.build/) |

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- npm

### Install & Run

```bash
git clone https://github.com/juliantoledo/optmax.git
cd optmax
npm install
npm start
```

### Build Installer (Windows)

```bash
npm run build
# Output: dist/OptMax Setup 1.0.0.exe
```

---

## How It Works

### Scoring (1–5 dots)
Every opportunity gets a composite signal score based on:
- IV Rank ≥ 50 → high historical premium
- IV/HV ratio ≥ 1.3 → market overpricing volatility
- Mean reversion signal active → vol spike cooling off
- Annualized yield ≥ 30%
- DTE within the 21–45 day sweet spot

### Options Selection
For each symbol, OptMax:
1. Fetches the options chain closest to 30 days out
2. Filters puts that are Out-of-The-Money by at least the configured margin (default 5%)
3. Selects the highest qualifying strike (maximum premium while staying OTM)
4. Calculates yield metrics normalized to a 30-day period

### Key Formulas
```
Monthly Yield      = (Premium / Strike) × (30 / DTE) × 100
Annualized Yield   = Monthly Yield × 12
Monthly Income     = (Premium × 100) × (30 / DTE)
Break Even         = Strike − Premium
Margin of Safety   = ((Stock Price − Strike) / Stock Price) × 100
Historical Vol     = StdDev(daily log returns, 30d) × √252
IV Rank            = (Current IV − 52w Low IV) / (52w High IV − 52w Low IV) × 100
```

### Data & Caching
- Full options scans are cached to disk; subsequent loads are instant
- Price updates refresh quotes only, skipping the expensive options fetch
- Discovery cache stores per-symbol results for 3 days to avoid redundant API calls

---

## Project Structure

```
optmax/
├── main.js          # Electron main process — IPC handlers, data fetching, caching
├── preload.js       # Context bridge — secure renderer ↔ main API surface
├── src/
│   ├── index.html   # App shell and all view markup
│   ├── app.js       # Renderer — state, rendering, event wiring
│   └── style.css    # Dark glassmorphism design system
├── lib/
│   └── strategies.js # Pure functions: HV, IVR, mean reversion, scoring
├── assets/
│   ├── icon.ico     # Windows app icon
│   └── icon.png     # Source icon (256×256)
└── test/
    └── strategies.test.js  # Unit tests for all strategy logic
```

---

## Running Tests

```bash
npm test
```

36 unit tests covering HV calculation, IVR, mean reversion signal detection, and composite scoring.

---

## Disclaimer

OptMax is a personal research tool. Nothing in this application constitutes financial advice. Options trading involves substantial risk of loss. Always do your own due diligence before entering any trade.

---

## License

ISC
