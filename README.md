# MT5 TradingView Local

Local Windows dashboard that mirrors the currently open MetaTrader 5 chart in a TradingView-style browser UI.

The dashboard scope is deliberately narrow:

- Local-only: MT5, Node.js server, and browser run on the same Windows machine.
- V3C order entry: market and limit order placement exists behind explicit frontend, backend, and EA safety gates.
- V3D trade management: close, partial close, SL/TP modification, breakeven, pending cancel, and pending modify exist behind explicit frontend, backend, and EA safety gates.
- No bulk management, trailing stop, or automated trade management.
- Chart-attached: the dashboard mirrors only the chart where `MT5_Dashboard_Bridge.mq5` is attached.
- Closed candles only: the EA sends shift `1` and older candles, not the unfinished live candle.
- MT5-calculated indicators only: the browser displays indicator values sent by MT5.
- Monitor data includes account summary, chart-symbol quote/properties, open positions, and pending orders.
- No frontend symbol/timeframe selector and no volume panel.

## Architecture

```text
MetaTrader 5 chart
  attached EA: mt5/MT5_Dashboard_Bridge.mq5
  uses _Symbol and _Period only
  calculates SMA, ATR, ADX, DI+, DI-, RSI, and S/R + ATR Buffer
  sends closed candles only
  sends read-only account, quote, open position, and pending order monitor data
  polls local command queue for risk verification and gated order placement
        |
        | HTTP POST http://127.0.0.1:3001/mt5/update
        v
Node.js local bridge
  server/server.js
  Express validates the MT5 payload
  latest valid snapshot is kept in memory
  indicators are not calculated or modified
  queues calculation-only risk commands for MT5 polling
  validates and queues PLACE_ORDER commands for MT5 polling
  validates and queues gated trade-management commands for MT5 polling
        |
        | WebSocket ws://127.0.0.1:3001
        v
React browser dashboard
  web/src/*
  Vite app at http://127.0.0.1:5173
  Lightweight Charts renders price overlays plus ATR, ADX/DI, and RSI panels

Electron desktop shell
  desktop/main.js
  loads Vite dev server in development
  loads web/dist in production
  can start or reuse the local backend at http://127.0.0.1:3001

Risk calculator verification:
  React POST /risk/calculate -> backend queue
  MT5 GET /mt5/commands -> broker-normalized calculation
  MT5 POST /mt5/risk-result -> backend WebSocket riskResult

V3C order placement:
  React confirmation modal POST /orders/place
  backend validates and queues PLACE_ORDER locally
  MT5 executes only when Algo Trading and EA live trading are allowed
  MT5 POST /mt5/order-result -> backend WebSocket ORDER_RESULT
```

## Project Layout

```text
mt5-tradingview-local/
|-- mt5/
|   `-- MT5_Dashboard_Bridge.mq5
|-- server/
|   |-- package.json
|   |-- server.js
|   `-- README.md
|-- desktop/
|   |-- package.json
|   |-- main.js
|   `-- README.md
|-- web/
|   |-- package.json
|   |-- index.html
|   |-- vite.config.js
|   `-- src/
|       |-- App.jsx
|       |-- main.jsx
|       |-- styles.css
|       |-- chart/
|       |   `-- TradingDashboard.jsx
|       |-- components/
|       |   |-- StatusBar.jsx
|       |   |-- IndicatorSettings.jsx
|       |   |-- TradingMonitor.jsx
|       |   |-- RiskCalculator.jsx
|       |   `-- OrderEntry.jsx
|       `-- utils/
|           `-- wsClient.js
`-- README.md
```

## Prerequisites

- Windows
- MetaTrader 5
- Node.js LTS from `https://nodejs.org/`

## Install Dependencies

From the project root:

```powershell
cd server
npm install

cd ..\web
npm install

cd ..\desktop
npm install
```

If your network requires a proxy, run npm through that proxy. Example:

```powershell
$env:npm_config_proxy="socks5h://127.0.0.1:10808"
$env:npm_config_https_proxy="socks5h://127.0.0.1:10808"
npm install
```

## Compile the MT5 EA

1. Open MetaTrader 5.
2. Open MetaEditor.
3. Open `mt5/MT5_Dashboard_Bridge.mq5`.
4. Compile the file.
5. Confirm MetaEditor reports `0 errors`.

Command-line compile can also be used when MetaEditor is installed:

```powershell
& "C:\Program Files\MetaTrader 5\metaeditor64.exe" /compile:"D:\trading strategy\mt5-tradingview-local\mt5\MT5_Dashboard_Bridge.mq5"
```

If MetaEditor does not compile from an external folder, copy the EA into your MT5 data folder under `MQL5\Experts`, then compile that copy.

## Allow MT5 WebRequest

In MT5:

1. Open `Tools > Options > Expert Advisors`.
2. Enable `Allow WebRequest for listed URL`.
3. Add this URL:

```text
http://127.0.0.1:3001
```

Without this permission, MT5 will reject the EA's local HTTP POST.

## Run the Server

From the project root:

```powershell
cd server
npm start
```

Expected local endpoints:

```text
HTTP health:  http://127.0.0.1:3001/health
MT5 POST:     http://127.0.0.1:3001/mt5/update
Risk request: http://127.0.0.1:3001/risk/calculate
Order request: http://127.0.0.1:3001/orders/place
MT5 commands: http://127.0.0.1:3001/mt5/commands
Risk result:  http://127.0.0.1:3001/mt5/risk-result
Order result: http://127.0.0.1:3001/mt5/order-result
WebSocket:    ws://127.0.0.1:3001
```

Order command queuing is local and always validated by the backend. Final execution is controlled in MT5 by the Algo Trading button, EA live-trading permission, account trading permission, and broker symbol rules.

## Run the Frontend

Open a second terminal from the project root:

```powershell
cd web
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The page auto-reconnects if the backend is unavailable or the WebSocket disconnects.

## Run the Desktop App

The Electron layer is optional and does not replace the existing server/web commands.

From the project root, the desktop scripts are:

```powershell
npm run dev:desktop
npm run build:web
npm run build:desktop
npm run dist:windows
```

Development mode loads the Vite dev server:

```powershell
cd web
npm run dev

cd ..\desktop
npm run dev
```

Production mode loads the built frontend from `web/dist`:

```powershell
cd web
npm run build

cd ..\desktop
npm start
```

The desktop window title is `MT5 TradingView Dashboard`, starts around `1500x900`, and can be resized or maximized normally.

The desktop app menu contains `Reload`, `Toggle DevTools`, `Open Logs Folder`, `Open MT5 EA Folder`, `Installation Help`, and `Quit`. `Installation Help` shows the basic MT5 WebRequest, EA attach, backend, and safety-gate instructions inside the app.

Backend behavior:

- If `http://127.0.0.1:3001/health` is already running, Electron reuses that backend.
- If port `3001` is free, Electron starts the existing `server/server.js` as a managed child process.
- When the Electron app closes, it stops the backend process it started.
- If another non-dashboard process owns port `3001`, Electron shows a clear error instead of starting a duplicate backend.
- Desktop logs are written to `%APPDATA%\mt5-tradingview-local-desktop\logs\desktop.log`.
- Backend stdout/stderr is written to `%APPDATA%\mt5-tradingview-local-desktop\logs\backend.log`.
- To disable desktop backend autostart, run `$env:DESKTOP_START_BACKEND='false'` before `npm start`.

To create a Windows package:

```powershell
npm run dist:windows
```

The package output is written to `release/`. The packaged app includes:

- the built frontend from `web/dist`
- the backend files needed by Electron from `server/`
- the `mt5/` folder so the EA source is available to the user

The Windows build skips executable signing/resource editing with `win.signAndEditExecutable=false` and `win.forceCodeSigning=false`. This avoids electron-builder's `winCodeSign` extraction path, which can fail on Windows accounts without symlink privileges. The NSIS installer still uses the project icon from `desktop/assets/icon.ico`.

Install dependencies in `server`, `web`, and `desktop` before packaging.

## Install the Windows App

After `npm run dist:windows` finishes, run:

```text
release\MT5 TradingView Dashboard Setup 0.1.0.exe
```

The installer is a per-user Windows installer. By default it installs under:

```text
%LOCALAPPDATA%\Programs\mt5-tradingview-local-desktop\
```

Launch:

```text
%LOCALAPPDATA%\Programs\mt5-tradingview-local-desktop\MT5 TradingView Dashboard.exe
```

The installed app starts the local backend automatically on:

```text
http://127.0.0.1:3001
ws://127.0.0.1:3001
```

If the app is closed normally, the backend process it started is stopped.

## Installed App Logs

Use `App > Open Logs Folder` from the desktop menu, or open:

```text
%APPDATA%\MT5 TradingView Dashboard\logs\
```

Files:

- `desktop.log`: Electron startup, frontend loading, and backend lifecycle messages.
- `backend.log`: backend stdout/stderr, including MT5 update logs and WebSocket connection logs.

## Connect MT5 to the Installed App

The installed app still uses the same local backend URL:

```text
http://127.0.0.1:3001
```

In MT5:

1. Open `Tools > Options > Expert Advisors`.
2. Enable `Allow WebRequest for listed URL`.
3. Add `http://127.0.0.1:3001`.
4. Compile or copy the EA from the packaged resources:

```text
%LOCALAPPDATA%\Programs\mt5-tradingview-local-desktop\resources\mt5\MT5_Dashboard_Bridge.mq5
```

5. Attach `MT5_Dashboard_Bridge.mq5` to the MT5 chart you want mirrored.

Known limitation: MT5 must still be installed, open, logged in, and running the EA on the chart. The desktop app does not replace MT5 and does not attach the EA automatically.

## Windows App Test Checklist

Automated smoke checks that were run:

- Existing standalone `server/npm start` and `web/npm run dev` workflow starts and serves local endpoints.
- Electron dev mode starts the local backend automatically when Vite is running.
- `npm run dist:windows` builds `release\MT5 TradingView Dashboard Setup 0.1.0.exe`.
- The installer installs the app under `%LOCALAPPDATA%\Programs\mt5-tradingview-local-desktop`.
- The installed app starts the backend automatically.
- `POST http://127.0.0.1:3001/mt5/update` accepts an MT5-shaped snapshot through the installed app backend.
- The packaged EA source exists under `resources\mt5`.
- The desktop/backend log folder is created.
- Closing the installed app stops the backend process it started.

Manual checks that still require live MT5 and a demo account:

- Confirm real MT5 EA posts chart data to the installed app.
- Confirm chart, account, Trading Monitor, Order Entry, Risk Calculator, and Trade Management work with live MT5 snapshots.
- Confirm settings persist after app restart by changing a browser preference, closing the app, and reopening it.
- Confirm `App > Open Logs Folder`, `App > Open MT5 EA Folder`, and `App > Installation Help` from the desktop menu.
- Confirm trading safety gates: frontend Trading Mode is OFF by default per session; backend order commands remain disabled unless configured; backend trade management remains disabled unless configured; EA order placement and trade management remain disabled unless explicitly enabled.

## Attach the EA

1. Start the backend.
2. Open MT5.
3. Open the chart you want mirrored.
4. For the default test, use `EURUSD` on `M15`.
5. Attach `MT5_Dashboard_Bridge.mq5` to that chart.
6. Keep MT5 open and logged in.

The dashboard symbol and timeframe come from the attached chart. V1 intentionally has no browser-side symbol or timeframe picker.

The MT5 EA inputs control which indicators are calculated. The browser settings panel can hide or show already-received chart layers locally, but it does not send indicator changes back to MT5 in V1. Oscillator panels can also be collapsed to a compact row that keeps the latest MT5-sent value visible; click a compact row to expand it again. The chart toolbar controls browser view only: auto-scroll, fit content, go to latest, reset view, panel height presets, and saved panel heights.

The price chart can also display the MT5-calculated `S/R + ATR Buffer` overlay. Defaults are lookback `14`, source timeframe `H4`, ATR length `14`, and ATR multiplier `0.20`. The EA uses only closed source-timeframe candles and sends `resistance`, `support`, and their upper/lower ATR buffer values as nullable candle fields.

## S/R + ATR Buffer

This overlay is calculated in MT5, not in the browser. The frontend only displays the values already present on each candle.

Calculation logic:

- Source timeframe default: `H4`.
- Lookback default: `14` closed source-timeframe candles.
- ATR buffer default: `ATR(14) * 0.20`.
- Resistance pattern: a bullish source candle followed by a bearish source candle. From valid patterns inside the lookback, the EA picks the pattern with the highest previous bullish close. The resistance level is the following bearish candle's open.
- Support pattern: a bearish source candle followed by a bullish source candle. From valid patterns inside the lookback, the EA picks the pattern with the lowest previous bearish close. The support level is the following bullish candle's open.
- Buffer lines:
  - Resistance upper/lower: `resistance +/- buffer`.
  - Support upper/lower: `support +/- buffer`.
- Closed candles only: the EA does not use the currently forming chart candle or the currently forming source-timeframe candle. There is no lookahead.

MT5 EA inputs:

- `EnableSRIndicator`
- `SRLookbackCandles`
- `SRSourceTimeframe`
- `SRATRLength`
- `SRATRMultiplier`
- `ShowOriginalResistance`
- `ShowOriginalSupport`
- `ShowResistanceBuffer`
- `ShowSupportBuffer`

Frontend display controls:

- `Resistance`
- `Support`
- `Resistance buffer`
- `Support buffer`

These browser controls are visibility toggles only and are saved in `localStorage`. They do not change MT5 inputs, do not change backend payloads, and do not calculate replacement values. To change the S/R logic, edit the EA inputs in MT5 and reattach/restart the EA.

## V2B Chart Controls

The V2B toolbar is frontend-only. It changes the browser view, not the MT5 chart, backend payload, indicator calculations, or trading state.

- `Auto-scroll ON/OFF`: when ON, new MT5 snapshots keep all chart panels at the latest candle. When OFF, candles and indicators update without moving the current visible range.
- `Fit content`: shows all loaded closed candles across the price, ATR, and ADX/DI panels.
- `Go to latest`: moves all panels to the newest received candle without changing the saved Auto-scroll setting.
- `Reset view`: returns all panels to the default recent range, roughly the latest 150-200 candles when enough history exists.
- Panel height presets: `Compact`, `Balanced`, and `Large Price` resize the chart layout. `Balanced` is the default and the selected preset is restored from `localStorage`.
- Draggable panel heights: drag the horizontal handle between Price/ATR or ATR/ADX to resize those panels. Saved heights are restored from `localStorage`.
- Synchronized scrolling and zooming: price, ATR, and ADX/DI use the same MT5 candle timestamps and shared visible logical range synchronization, so scrolling or zooming one panel should move the others with it.
- Synchronized crosshair: moving the mouse over Price, ATR, or ADX/DI shows the vertical crosshair marker on all panels at the same candle time.

V2B intentionally does not add indicator color settings, screenshot/export tools, trade controls, frontend indicator calculations, or a browser symbol/timeframe selector.

## V2C Chart Polish

V2C is still frontend-only. It does not change the MT5 EA, backend bridge, indicator calculations, closed-candle-only behavior, or trading scope.

- Draggable panel resizing: use the horizontal separators between `Price / ATR` and `ATR / ADX/DI` to adjust panel heights. Minimum heights are enforced and saved in `localStorage`.
- Synced crosshair across panels: moving the mouse over Price, ATR, or ADX/DI displays one aligned vertical marker across all visible chart panels at the same candle time, with a small per-panel value readout attached to the marker.
- ADX/DI matching colors: ADX, DI+, and DI- header/settings text use the same shared color constants as their chart lines.

Manual V2C checks:

1. Start backend and frontend.
2. Confirm MT5 candles appear in the browser.
3. Drag the `Price / ATR` separator and confirm the panels resize without overlapping.
4. Drag the `ATR / ADX/DI` separator and confirm minimum heights are respected.
5. Refresh the browser and confirm the resized heights are restored.
6. Move the mouse over Price, ATR, and ADX/DI; confirm the vertical crosshair appears on all panels at the same candle and each panel shows the matching value readout.
7. Move the mouse out of the chart area and confirm the synced crosshair clears.
8. Confirm ADX text matches the ADX line color, DI+ text matches the DI+ line color, and DI- text matches the DI- line color.
9. Use `Fit content`, `Go to latest`, and `Reset view`; confirm all panels remain synchronized.

## V3A Read-Only Trading Monitor

V3A extends the MT5 payload with read-only trading monitor data:

- `account`: login, server, currency, balance, equity, profit, margin, free margin, margin level, and leverage.
- `quote`: current attached-chart symbol bid/ask, spread, digits, and symbol properties needed later for lot-size calculation: point, tick size, tick value, minimum volume, maximum volume, volume step, and contract size.
- `positions`: all open account positions, including positions from symbols other than the attached chart.

The EA sends monitor data every `UpdateSeconds` so PnL and quote values can refresh between closed candles. Candle history remains optimized: the EA sends the full candle array only on startup or when a new candle closes. The backend keeps the last candle snapshot and merges monitor-only updates before broadcasting to browsers.

The frontend uses a right-side menu with sections for `Trading Monitor`, `Indicators`, `Risk Calculator`, and `Order Entry`. The whole side panel can be collapsed to give more width to the charts, and the active section is saved in `localStorage`. `Trading Monitor` shows account summary, chart-symbol quote, open positions, and pending orders. The filter defaults to `Current symbol only` and can be switched to `All symbols`; the filter applies to both positions and pending orders and is saved in `localStorage`.

V3A is still read-only. It does not place, close, or modify trades.

V3A payload additions:

```json
{
  "account": {
    "login": 123456,
    "server": "Broker-Server",
    "currency": "USD",
    "balance": 10000,
    "equity": 10050.25,
    "profit": 50.25,
    "margin": 200,
    "freeMargin": 9850.25,
    "marginLevel": 5025.12,
    "leverage": 100
  },
  "quote": {
    "symbol": "EURUSD",
    "bid": 1.08500,
    "ask": 1.08512,
    "spreadPoints": 12,
    "digits": 5,
    "point": 0.00001,
    "tickSize": 0.00001,
    "tickValue": 1,
    "volumeMin": 0.01,
    "volumeMax": 100,
    "volumeStep": 0.01,
    "contractSize": 100000
  },
  "positions": [
    {
      "ticket": 123456789,
      "symbol": "EURUSD",
      "type": "BUY",
      "volume": 0.1,
      "openPrice": 1.08000,
      "sl": 1.07500,
      "tp": 1.09000,
      "currentPrice": 1.08500,
      "profit": 50,
      "swap": 0,
      "commission": -0.5,
      "openTime": 1710000000,
      "magic": 0,
      "comment": "manual"
    }
  ]
}
```

Position filter behavior:

- `Current symbol only`: shows positions whose `position.symbol` matches `snapshot.symbol` or `quote.symbol`.
- `All symbols`: shows every open position sent by MT5.
- Empty states distinguish between no current-symbol positions and no open positions.
- The selected filter is restored after browser refresh.

## V3E Chart Trade Visuals

V3E renders frontend-only trade reference lines on the price chart from the same read-only MT5 snapshot used by Trading Monitor.

- Open positions:
  - Entry line.
  - SL line when `sl` is present and greater than zero.
  - TP line when `tp` is present and greater than zero.
  - Entry label is compact: `BUY 0.10 #123456 +$24.50`.
- Pending orders:
  - Entry line.
  - SL line when present.
  - TP line when present.
  - Entry label is compact: `BUY LIMIT 0.10 #123456`.
- SL and TP labels are compact: `SL #ticket` and `TP #ticket`.
- Trade line prices use the latest `quote.digits` from MT5.
- PnL uses `account.currency`, with positive and negative PnL visually distinguished on the price axis label.
- BUY and SELL position entry lines use different colors.
- Pending order entry lines use a separate dashed style.
- SL and TP lines use their own colors/styles.
- The `Indicators` side-menu section includes `Chart Trade Visuals` controls for position lines, pending order lines, SL lines, TP lines, PnL labels, and symbol filtering.
- The filter defaults to `Current symbol only`, can be changed to `All symbols`, saves in `localStorage`, and only changes the browser overlay.
- Trading Monitor row action menus include `Focus on chart`. It is frontend-only and briefly highlights the matching position or pending-order entry line. If the focused trade is on another symbol, the chart trade-visual filter switches to `All symbols` so the line can be shown.

These lines are display-only. They do not send close, modify, cancel, or drag commands, and they do not change backend or MT5 trading logic. Existing line handles are updated from each latest snapshot, and disappeared positions/orders are removed so stale chart lines do not remain.

### V3E Manual Testing Checklist

Run these checks on a demo account only:

1. Open a demo market BUY with SL/TP.
2. Confirm entry, SL, and TP lines appear on the price chart.
3. Confirm the PnL label updates with MT5 snapshots.
4. Open a demo market SELL with SL/TP.
5. Confirm SELL line styling is distinct from BUY.
6. Place a BUY LIMIT with SL/TP.
7. Confirm pending order entry, SL, and TP lines appear.
8. Place a SELL LIMIT with SL/TP.
9. Confirm pending order visuals work.
10. Toggle position lines off/on in `Indicators` -> `Chart Trade Visuals`.
11. Toggle pending order lines off/on.
12. Toggle SL and TP lines off/on.
13. Toggle PnL labels off/on.
14. Test `Current symbol only` vs `All symbols` filter.
15. Close a position and confirm its lines disappear after the next MT5 snapshot.
16. Cancel a pending order and confirm its lines disappear after the next MT5 snapshot.
17. Modify SL/TP and confirm the lines update after the next MT5 snapshot.
18. Confirm chart sync, crosshair sync, panel resize, and right panel collapse still work.
19. Confirm no drag-to-modify exists yet.
20. Confirm no chart close/modify buttons exist yet.

## V3A Manual Testing Checklist

1. Start backend.
2. Start frontend.
3. Open MT5.
4. Attach the EA to `EURUSD` `M15`.
5. Confirm the chart still works.
6. Confirm account summary appears in `Trading Monitor`.
7. Confirm the quote card shows EURUSD bid/ask/spread.
8. Open a small demo position manually in MT5.
9. Confirm the position appears in the `Trading Monitor`.
10. Confirm floating PnL updates every `UpdateSeconds`.
11. Open a position on another symbol manually in MT5.
12. Confirm `Current symbol only` hides the other symbol.
13. Confirm `All symbols` shows both positions.
14. Confirm the price chart shows position entry, SL, and TP lines for the current symbol.
15. In `Indicators` -> `Chart Trade Visuals`, switch the filter from `Current symbol only` to `All symbols` and confirm other-symbol trade lines appear if their prices are in view.
16. Place or keep a pending order and confirm pending entry, SL, and TP lines appear with pending-order styling.
17. Close or cancel a test trade in MT5 and confirm stale chart lines disappear after the next snapshot.
18. Use a row `Actions` menu and click `Focus on chart`; confirm the matching entry line briefly highlights and no trade command is sent.
19. Refresh the browser and confirm the selected filters are restored.
20. Switch the side menu between `Trading Monitor` and `Indicators`.
21. Collapse the right side panel and confirm the chart area expands.
22. Reopen the side panel and confirm the last selected section is restored.
23. Confirm no chart drag-to-modify, close, or cancel controls were added.
24. Confirm `http://127.0.0.1:3001/health` shows `hasAccount`, `hasQuote`, and `positionCount`.
25. Confirm no frontend indicator calculations were added.
26. Confirm chart sync, crosshair sync, and draggable panels still work.

## V3B Risk Calculator

V3B adds a `Risk Calculator` section to the right-side menu. It uses the latest MT5 snapshot fields from `account` and `quote` to estimate position size, then can ask MT5 to verify the calculation with broker account and symbol properties.

- Account basis: balance or equity.
- Risk mode: percent or fixed account-currency amount.
- Order side: buy or sell.
- Entry price: current market price or manual entry price.
- Stop-loss: manual SL price or distance in points.
- Broker symbol properties: point, tick size, tick value, min/max volume, volume step, and contract size.

The calculator displays symbol, account currency, risk basis value, risk amount, entry price, SL price, stop distance, tick details, volume limits, raw calculated volume, normalized volume, estimated loss at SL, and validation status/warnings.

The frontend estimate is labeled: `Preliminary estimate - final broker-normalized calculation will be verified by MT5.`

Validation rules:

- Buy stop-loss must be below entry.
- Sell stop-loss must be above entry.
- Risk value must be positive.
- Fixed money risk must not exceed account equity.
- Invalid tick size, tick value, or volume step blocks calculation.
- Percent risk above 5% shows a warning.
- Very small stop distance shows a warning.

The `Verify with MT5` button uses a calculation-only polling flow:

```text
Frontend POST /risk/calculate
  -> backend stores pending CALCULATE_RISK_LOT command
  -> MT5 EA polls GET /mt5/commands
  -> MT5 calculates with AccountInfo* and SymbolInfo* values
  -> MT5 POST /mt5/risk-result
  -> backend broadcasts a WebSocket riskResult message
  -> frontend shows the MT5 verified result
```

The MT5 verified result includes:

- Risk basis amount and risk amount.
- Entry and stop-loss prices.
- Stop distance in points.
- Tick size and tick value.
- Broker volume min, max, and step.
- Raw volume.
- Normalized volume, rounded down to the broker volume step where possible.
- Estimated loss at SL.
- Warnings from MT5, such as broker min/max volume adjustment or high percent risk.

MT5 uses this calculator formula:

```text
lossPerLot = abs(entryPrice - stopLossPrice) / tickSize * tickValue
rawVolume = riskAmount / lossPerLot
normalizedVolume = rawVolume rounded down to broker volume step, then constrained by broker min/max volume
estimatedLoss = normalizedVolume * lossPerLot
```

The frontend preliminary estimate uses the same basic formula for immediate feedback, but the MT5 verified result should be treated as the final broker-normalized value because it uses live MT5 account and broker symbol properties.

While verification is pending, the button is disabled and the status shows `Queued` or `Waiting for MT5`. If no result arrives within about 30 seconds, the frontend shows: `No MT5 verification response received. Check that the EA is running and command polling is enabled.` If calculator inputs change after a result is received, the previous MT5 result is marked stale with `Inputs changed - verify again.`

V3B is still read-only. It does not place, close, or modify trades, and it does not add backend trading endpoints. `/risk/calculate`, `/mt5/commands`, and `/mt5/risk-result` are calculator endpoints only. Calculator preferences are saved in `localStorage`.

Manual V3B checks:

1. Start backend.
2. Start frontend.
3. Open MT5 and attach EA to EURUSD M15.
4. Confirm account, quote, and chart data are visible.
5. Open Risk Calculator.
6. Set risk basis to Equity.
7. Set risk mode to Percent.
8. Set risk value to 1%.
9. Set side to Buy.
10. Use current market entry.
11. Set SL distance to 500 points.
12. Confirm preliminary estimate appears.
13. Click Verify with MT5.
14. Confirm MT5 verified result appears.
15. Confirm normalized volume respects broker min/max/step.
16. Change risk to fixed money and verify again.
17. Test Sell with SL above entry.
18. Test invalid Buy SL above entry and confirm error.
19. Test invalid Sell SL below entry and confirm error.
20. Refresh browser and confirm saved calculator preferences restore.
21. Confirm no order is placed in MT5.
22. Confirm no Buy/Sell trade buttons exist yet.
23. Confirm existing chart sync and Trading Monitor still work.

## V3C Order Entry

V3C starts the order-entry workflow. The frontend can prepare an order, the backend validates and queues `PLACE_ORDER` commands locally, and the MT5 EA can execute market/limit entries only when MT5 trading permissions allow it.

Test V3C on a demo account first. Do not enable order placement on a live account until you have verified the full flow, broker behavior, symbol settings, lot sizing, stop validation, and failure handling.

Supported order types:

- Market Buy
- Market Sell
- Buy Limit
- Sell Limit

Unsupported order-entry actions:

- Buy Stop / Sell Stop
- Stop Limit
- Trailing stop

Real order placement has these safety gates:

1. Frontend `Trading Mode` must be ON for the current browser session.
2. The confirmation modal must be accepted.
3. The MT5 Algo Trading button must be ON.
4. Live trading must be allowed for the attached EA.
5. The account and broker must allow expert trading on the symbol.

The frontend gate resets to OFF when the browser session closes. MT5 controls final execution through its normal Algo Trading and live-trading permissions. Buy Stop, Sell Stop, Stop Limit, trailing stop, and automated trade management are not implemented.

Start the backend normally:

```powershell
cd server
npm start
```

Then use MT5 to control execution: keep the Algo Trading button OFF to block order execution, or turn it ON on a demo account when you are ready to test real order placement.

The right-side menu now includes `Order Entry` with:

- Order type: Market Buy, Market Sell, Buy Limit, Sell Limit.
- Volume mode: use the latest successful MT5 verified Risk Calculator volume, or enter manual volume.
- Market entry price: read-only ask for Market Buy and bid for Market Sell.
- Pending entry price: manual entry for Buy Limit and Sell Limit.
- Stop Loss with `Require SL`, enabled by default and saved in localStorage.
- Optional Take Profit.
- Optional comment saved in localStorage.
- Optional magic number saved in localStorage.
- `Trading Mode` safety toggle, OFF by default and saved only in sessionStorage.
- `Prepare Order`, which validates locally and opens a confirmation modal.

The confirmation modal shows symbol, order type, side, volume, entry, SL, TP, estimated risk when available from Risk Calculator, account currency, comment, and magic number.

`Send Order` posts the confirmed order to `POST /orders/place`. The request includes dashboard safety flags showing that Trading Mode was enabled and the confirmation modal was accepted; the backend rejects order requests without those flags. The modal then shows `Sending`, `Queued`, `Waiting for MT5`, `Filled / placed`, or `Failed`. The result displays ticket when available, retcode, message, final volume, entry price, SL, and TP. Duplicate sending is blocked for a prepared order after the button is clicked; close and prepare a new order if you need to send another command.

V3C validation includes:

- Quote and account data must be available.
- Manual volume must fit broker min/max/step.
- Risk Calculator volume requires a successful MT5 verified result.
- Stale Risk Calculator results are warned.
- Buy Limit entry must be below current ask.
- Sell Limit entry must be above current bid.
- Buy SL must be below entry; Buy TP must be above entry.
- Sell SL must be above entry; Sell TP must be below entry.
- If `Require SL` is enabled, SL must be provided and valid.

Market order behavior:

- Market Buy uses the current ask.
- Market Sell uses the current bid.
- If the market price changes while the modal is open, the modal warns that the price may have changed.

Limit order behavior:

- Buy Limit entry must be below current ask.
- Sell Limit entry must be above current bid.
- Successful limit orders appear in the read-only `Pending Orders` table after MT5 sends the updated `orders` snapshot.

MT5-side V3C execution safety:

- MT5 Algo Trading OFF rejects every `PLACE_ORDER` command and posts `ORDER_RESULT` with `ok=false`.
- EA live-trading permission OFF rejects every `PLACE_ORDER` command and posts `ORDER_RESULT` with `ok=false`.
- `RequireStopLossForOrders=true` blocks orders without SL.
- `MaxAllowedVolume` caps the maximum accepted command volume.
- `DefaultMagicNumber` is used when a command has no magic number or magic is `0`.
- Market Buy uses current ask; Market Sell uses current bid.
- Buy Limit must be below current ask; Sell Limit must be above current bid.
- Broker stops level, freeze level where relevant, volume min/max/step, and margin checks are validated before `OrderSend`.
- Duplicate frontend send attempts are blocked after the modal sends once.
- Backend rejects duplicate order `requestId`s while a command/result is still stored.
- The EA remembers recently processed order `requestId`s in memory and ignores repeats.

The Trading Monitor also shows pending orders after MT5 reports them in the `orders` payload section. Pending orders use the same `Current symbol only` / `All symbols` filter as positions.

## V3D Trade Management

V3D adds the trade-management interface and the backend/MT5 command path for managing existing positions and pending orders. The frontend sends explicitly confirmed management requests to the backend, the backend queues them for MT5 polling, and MT5 posts a `TRADE_MANAGEMENT_RESULT` back through the WebSocket feed.

Trade-management execution is disabled by default in both the backend and the EA:

- Backend: `ENABLE_TRADE_MANAGEMENT=true` is required before management commands are queued.
- MT5 EA: `EnableTradeManagement=true` is required before the EA executes management commands.
- MT5 Algo Trading and EA live-trading permission must also be enabled.

Open position row actions:

- `Close`
- `Partial Close`
- `Modify SL/TP`
- `Breakeven`

Pending order row actions:

- `Cancel`
- `Modify Order`

Trade-management actions use the same session-based `Trading Mode` safety concept as Order Entry. When Trading Mode is OFF, row action menus can still open preview/validation modals, but final confirmation is disabled and the modal clearly shows `Trading Mode is OFF.` Trading Mode resets when the browser session closes.

Each action opens a compact confirmation modal with a summary table and local validation:

- Full close shows ticket, symbol, type, volume, and floating PnL.
- Partial close validates volume is greater than `0`, less than current position volume, respects `volumeStep` when available, and leaves a valid remaining volume when `volumeMin` is known.
- Position SL/TP modification validates buy-side stops below/current take-profit above current price, and sell-side stops above/current take-profit below current price.
- Breakeven proposes SL from open price plus/minus optional offset points.
- Pending cancel shows the order summary.
- Pending modification validates Buy Limit below current ask, Sell Limit above current bid, and SL/TP on the correct side of the new entry.

When confirmed, the frontend sends the action to the matching backend endpoint:

- Full or partial close: `POST /positions/close`
- Position SL/TP modification: `POST /positions/modify`
- Breakeven: `POST /positions/breakeven`
- Pending order cancel: `POST /orders/cancel`
- Pending order entry/SL/TP modification: `POST /orders/modify`

The modal shows `Sending`, `Queued`, `Waiting for MT5`, `Success`, or `Failed`. On success, wait for the next MT5 snapshot before assuming the positions or orders table has refreshed.

If the backend returns `Trade management commands are disabled on the backend.`, start the backend with `ENABLE_TRADE_MANAGEMENT=true` and enable EA input `EnableTradeManagement=true`. If the EA returns `Trade management disabled in EA inputs.`, update the EA inputs and confirm MT5 Algo Trading is enabled.

Backend command types:

- `CLOSE_POSITION`
- `MODIFY_POSITION`
- `MOVE_TO_BREAKEVEN`
- `CANCEL_ORDER`
- `MODIFY_ORDER`

MT5 posts results to `/mt5/trade-management-result` and the backend broadcasts `TRADE_MANAGEMENT_RESULT` to WebSocket clients.

V3D intentionally does not add close-all, cancel-all, trailing stop, or automated trade management.

### Enable V3D Management

Use a demo account first. V3D can close, partially close, modify, and cancel real trades when every safety gate is enabled.

Backend management is disabled unless the backend process is started with:

```powershell
$env:ENABLE_TRADE_MANAGEMENT='true'
npm start
```

That environment variable is local to the current PowerShell session. Starting the backend normally keeps management disabled.

EA management is disabled unless the attached EA input is set to:

```text
EnableTradeManagement = true
```

The MT5 Algo Trading button and the EA `Allow live trading` permission must also be enabled before MT5 can execute the management command. Frontend `Trading Mode` must be ON for the current browser session, and each action still requires a confirmation modal.

### V3D Manual Demo Checklist

Setup:

1. Start backend with `ENABLE_TRADE_MANAGEMENT=false` or start it normally without the environment variable.
2. Start frontend.
3. Attach the EA to EURUSD M15.
4. Confirm chart, account, positions, and pending orders still update.

Backend disabled:

5. Try a close, modify, or cancel action.
6. Confirm the backend blocks it with `Trade management commands are disabled on the backend.`

EA disabled:

7. Restart backend with `ENABLE_TRADE_MANAGEMENT=true`.
8. Keep EA input `EnableTradeManagement=false`.
9. Try a close, modify, or cancel action.
10. Confirm MT5 blocks it with `Trade management disabled in EA inputs.`

Enable on demo:

11. Set EA input `EnableTradeManagement=true`.
12. Open a small demo market position.
13. Modify SL/TP.
14. Confirm MT5 updates position SL/TP.
15. Move SL to breakeven.
16. Confirm SL changes.
17. Partial close a small portion.
18. Confirm position volume reduces.
19. Close the remaining position.
20. Confirm the position disappears after the next MT5 snapshot.

Pending orders:

21. Place a Buy Limit using V3C Order Entry.
22. Modify pending order entry/SL/TP.
23. Confirm the pending order updates after the next MT5 snapshot.
24. Cancel the pending order.
25. Confirm the pending order disappears.
26. Repeat with a Sell Limit if practical.

Validation:

27. Try invalid SL/TP direction and confirm the frontend or backend blocks it.
28. Try partial close volume larger than position volume and confirm it is blocked.
29. Try partial close that would leave invalid remaining volume and confirm it is blocked.
30. Try modifying an unsupported pending order type if one exists and confirm a clear rejection.

Regression:

31. Confirm Risk Calculator still verifies with MT5.
32. Confirm Order Entry still places market and limit orders on demo.
33. Confirm Trading Monitor `Current symbol only` / `All symbols` filter still works.
34. Confirm chart scroll/zoom sync still works.
35. Confirm crosshair sync still works.
36. Confirm draggable chart panel heights still work.
37. Confirm right panel collapse/resize still works.
38. Confirm Auto-scroll, Fit content, Go latest, and Reset view still work.
39. Confirm duplicate command execution does not occur when clicking once and waiting.
40. Refresh the browser and confirm Trading Mode resets to OFF.

### V3D Known Limitations

- No bulk close.
- No bulk cancel.
- No trailing stop.
- No automated management.
- Only supported pending order types can be modified. The MT5 EA currently supports modifying Buy Limit and Sell Limit pending orders for V3D.
- Management results do not immediately mutate the frontend table. The table updates when the next MT5 snapshot arrives.

### V3D Troubleshooting

- `Invalid stops` / retcode `10016`: SL/TP, breakeven SL, or pending entry is too close, on the wrong side, or violates broker stops/freeze levels.
- `Market closed` / retcode `10018`: the symbol is not currently tradable.
- `Invalid volume` / retcode `10014`: partial close volume is outside broker min/max/step or would leave an invalid remaining volume.
- `Trade disabled` / retcode `10017`: trading is disabled for the account, terminal, EA, or symbol.
- `No money` / retcode `10019`: free margin is insufficient for the requested operation.
- `Trade management commands are disabled on the backend.`: restart the backend with `ENABLE_TRADE_MANAGEMENT=true`.
- `Trade management disabled in EA inputs.`: set EA input `EnableTradeManagement=true`, confirm Algo Trading is ON, and confirm live trading is allowed for the EA.
- No result arrives: confirm the EA is still attached, MT5 WebRequest includes `http://127.0.0.1:3001`, backend is running, and the EA is polling `/mt5/commands`.

### Right Panel Workspace Behavior

The right-side panel is a workspace menu, not a fixed narrow sidebar. It contains:

- `Trading Monitor`
- `Indicators`
- `Risk Calculator`
- `Order Entry`

Panel behavior:

- The panel can be collapsed to give the charts more horizontal space.
- Expanding restores the previous panel state.
- The left edge of the panel can be dragged between about `280px` and `560px`.
- Panel width, collapsed/expanded state, and active section are saved in `localStorage`.
- The panel header and menu stay visible at the top.
- Section content scrolls internally when needed.
- Trading Monitor tables scroll horizontally instead of squeezing columns into unreadable text.
- Chart instances resize after panel width or collapsed state changes, and the current chart time range is preserved.

### Order Entry Usability Notes

The Order Entry section is intentionally compact because it shares the workspace with the chart. The form is split into:

- `Order`
- `Volume`
- `Prices`
- `Protection`
- `Execution Safety`
- `Validation / Result`

The layout uses two columns where the panel is wide enough and falls back to one column when the panel is narrow. The sticky footer keeps `Trading Mode`, validation status, placement status, and `Prepare Order` reachable. Validation messages are compact; multiple issues are grouped into a small expandable block. The confirmation modal uses a compact summary table and keeps `Cancel` and `Send Order` visible.

Order Entry behavior remains unchanged by the layout pass:

- Market Buy uses `ask`.
- Market Sell uses `bid`.
- Buy Limit must be below current ask.
- Sell Limit must be above current bid.
- `Require SL` still blocks preparation without a valid stop-loss.
- Manual volume must respect broker min/max/step.
- Risk Calculator volume requires a current successful MT5 verified result.
- `Send Order` is available only from the confirmation modal after frontend validation passes and Trading Mode is ON.

### Crosshair Across All Chart Panels

The dashboard uses synchronized crosshair overlays so the same candle/time can be inspected across Price, ATR, ADX/DI, RSI, and future oscillator panels.

- Moving the mouse over any expanded chart panel shows a vertical dashed marker on every expanded chart panel.
- The marker is synchronized by exact MT5 candle timestamp, not by copying a pixel coordinate from one panel.
- Each panel converts the selected time to its own x-coordinate with Lightweight Charts `timeScale().timeToCoordinate(time)`.
- The crosshair data/readout panel continues to show values for the selected candle.
- The marker clears when the mouse leaves the whole chart area.
- Scroll, zoom, chart panel resizing, and right panel collapse/expand update the overlay positions without desynchronizing the time scales.

Common order troubleshooting:

- `MT5 Algo Trading is disabled`: turn on the Algo Trading button in MT5 when testing on demo.
- `Live trading is not allowed for this EA`: allow live trading for the EA in MT5 Expert properties.
- `Trading is disabled for this account` or `Expert trading is disabled for this account`: check account/broker permissions.
- `Invalid stops` / retcode `10016`: SL/TP or pending entry is too close, on the wrong side, or violates broker stop-level rules.
- `Invalid volume` / retcode `10014`: volume is outside broker min/max/step or above the EA `MaxAllowedVolume`.
- `Market closed` / retcode `10018`: the symbol is not currently tradable.
- `No money` / retcode `10019`: free margin is insufficient for the requested order.
- `Price changed` / retcode `10020` or `Requote` / retcode `10004`: market moved before execution; refresh quote and prepare again.
- `Trade disabled` / retcode `10017`: trading is disabled for the account, terminal, or symbol.

Manual V3C demo-account checklist:

1. Start backend normally with `npm start`.
2. Keep MT5 Algo Trading OFF.
3. Try to send an order and confirm MT5 blocks it with `ORDER_RESULT ok=false`.
4. Turn MT5 Algo Trading ON on a demo account.
5. Confirm live trading is allowed for the attached EA.
6. Send a small Market Buy with SL/TP.
7. Confirm `ORDER_RESULT` success or clear failure.
8. Confirm the position appears in Trading Monitor.
9. Send a small Market Sell with SL/TP if appropriate.
10. Place a Buy Limit below market with SL/TP.
11. Confirm pending order appears in Trading Monitor.
12. Place a Sell Limit above market with SL/TP.
13. Confirm pending order appears in Trading Monitor.
14. Try invalid Buy Limit above market and confirm rejection.
15. Try invalid Sell Limit below market and confirm rejection.
16. Try missing SL when Require SL is enabled and confirm rejection.
17. Try volume above `MaxAllowedVolume` and confirm rejection.
18. Refresh browser and confirm Trading Mode resets to OFF.
19. Confirm Risk Calculator still works.
20. Confirm chart, crosshair sync, panel resize, and Trading Monitor still work.

## Regression Checklist After UI/Layout Changes

Use this checklist after changing Order Entry, the right panel, or chart crosshair synchronization.

Order Entry UI:

1. At 100% browser zoom, all fields are readable.
2. At 90% and 75% browser zoom, fields remain readable and do not clip.
3. `Prepare Order` remains reachable in the sticky footer.
4. `Trading Mode` status remains visible.
5. Validation messages stay compact and do not consume excessive vertical space.
6. The confirmation modal is readable and shows a compact order summary.
7. `Send Order` is only available from the confirmation modal.
8. Market Buy uses ask and Market Sell uses bid.
9. Buy Limit and Sell Limit validation still works.
10. `Require SL` still works.
11. Manual volume validation still works.
12. Risk Calculator verified volume still works.

Right panel:

1. Switch between `Trading Monitor`, `Indicators`, `Risk Calculator`, and `Order Entry`.
2. Collapse the panel and confirm charts gain space.
3. Expand the panel and confirm the previous section/state is restored.
4. Drag the panel left edge and confirm width is clamped between about `280px` and `560px`.
5. Refresh the browser and confirm panel width and collapsed state persist.
6. Confirm chart area resizes after panel changes.
7. Confirm no layout overlap or clipped fields.
8. Confirm Trading Monitor tables scroll horizontally when needed.

Crosshair:

1. Hover Price and confirm the vertical marker appears on Price, ATR, ADX/DI, and RSI.
2. Hover ATR and confirm the marker appears on Price, ATR, ADX/DI, and RSI.
3. Hover ADX/DI and confirm the marker appears on Price, ATR, ADX/DI, and RSI.
4. Hover RSI and confirm the marker appears on Price, ATR, ADX/DI, and RSI.
5. Confirm the crosshair data/readout values match the selected candle.
6. Scroll and zoom, then confirm the marker remains aligned by candle time.
7. Drag chart panel height handles and confirm the marker remains aligned.
8. Collapse/expand the right panel and confirm the marker remains aligned.

Trading safety:

1. Frontend Trading Mode OFF blocks order preparation/sending.
2. Backend rejects order requests that do not include dashboard confirmation flags.
3. MT5 Algo Trading OFF or EA live-trading permission OFF blocks execution in MT5.
4. Duplicate order sends are blocked by the modal/backend request ID checks.
5. With backend `ENABLE_TRADE_MANAGEMENT` disabled, confirm management actions are rejected.
6. With EA `EnableTradeManagement` disabled, confirm management actions are rejected by MT5.
7. Confirm no close-all, cancel-all, trailing-stop, or automated-management controls exist.

Existing features:

1. Chart data still updates from MT5.
2. Account data still updates.
3. Open positions still update.
4. Pending orders still display.
5. Risk Calculator still verifies with MT5.
6. Auto-scroll still works.
7. `Fit content`, `Go to latest`, and `Reset view` still work.
8. Draggable chart panel heights still work.

## V2B Manual Testing Checklist

1. Start backend.
2. Start frontend.
3. Open MT5 and attach the EA to EURUSD M15.
4. Confirm candles appear.
5. Scroll price chart and confirm ATR and ADX/DI move with it.
6. Scroll ATR and confirm price and ADX/DI move with it.
7. Scroll ADX/DI and confirm price and ATR move with it.
8. Zoom each panel and confirm all panels stay aligned.
9. Move the mouse over Price and confirm the crosshair appears on ATR and ADX/DI at the same candle.
10. Move the mouse over ATR and confirm the crosshair appears on Price and ADX/DI at the same candle.
11. Move the mouse over ADX/DI and confirm the crosshair appears on Price and ATR at the same candle.
12. Turn Auto-scroll ON and wait for a new closed candle. Confirm chart follows the latest candle.
13. Turn Auto-scroll OFF, scroll back in history, wait for a new closed candle. Confirm chart updates but does not jump.
14. Click Fit content and confirm all panels show all candles.
15. Click Go to latest and confirm all panels move to the newest candle.
16. Click Reset view and confirm all panels show the default recent range.
17. Change panel height preset and confirm chart alignment is preserved.
18. Drag the Price/ATR handle and confirm both panels resize without losing chart alignment.
19. Drag the ATR/ADX handle and confirm both panels resize without losing chart alignment.
20. Refresh browser and confirm Auto-scroll, panel preset, and dragged panel heights are restored from localStorage.

## Test with EURUSD M15

1. Start backend:

```powershell
cd server
npm start
```

2. Start frontend:

```powershell
cd web
npm run dev
```

3. Open MT5.
4. Open an `EURUSD` `M15` chart.
5. Allow WebRequest to `http://127.0.0.1:3001`.
6. Attach the EA to the EURUSD M15 chart.
7. Confirm the browser status changes from `MT5 data not received yet` to `MT5 snapshot received`.
8. Confirm candles appear in the price chart.
9. Scroll the price chart and confirm ATR and ADX/DI move with it.
10. Scroll ATR and confirm price and ADX/DI move with it.
11. Zoom the price chart and confirm oscillator panels stay aligned.
12. Confirm RSI values appear when RSI is enabled in the EA inputs.
13. Click `Full` on each chart panel and confirm the panel expands and exits cleanly.
14. Click `Collapse` on ATR, ADX/DI, and RSI panels and confirm the latest values remain visible without chart control buttons on the compact row.
15. Switch between `Compact`, `Balanced`, and `Large Price` presets and confirm panels resize cleanly.
16. Move the crosshair over Price, ATR, and ADX/DI, then confirm the vertical marker appears on all panels at the same candle.
17. Drag the horizontal resize handles between Price/ATR and ATR/ADX, then confirm all chart panels stay aligned.
18. Refresh the browser and confirm the dragged heights are restored.
19. Turn `Auto-scroll OFF`, scroll back, wait for the next MT5 snapshot, and confirm the visible range does not jump.
20. Turn `Auto-scroll ON`, then confirm new MT5 snapshots keep the chart at the latest candle.
21. Click `Fit content`, `Go to latest`, and `Reset view`, and confirm all chart panels move together.
22. Use the browser indicator toggles to hide/show SMA, S/R + ATR Buffer, ATR, ADX, DI, and RSI layers.
23. Confirm Resistance, Support, and buffer lines appear as horizontal/step levels on the price chart when MT5 sends non-null S/R values.
24. Move the crosshair over historical candles and confirm the price readout shows S/R values with text colors matching the S/R line colors.
25. Refresh the browser and confirm the S/R visibility toggles are restored.
26. Change EA inputs for indicator lengths, S/R settings, or enabled state.
27. Reattach or restart the EA.
28. Confirm the frontend receives the new settings and values.

## Troubleshooting

- `Backend unavailable or WebSocket disconnected`: start `server/server.js` with `npm start`.
- `MT5 data not received yet`: MT5 has not posted a valid snapshot. Check that the EA is attached and WebRequest is allowed.
- `Invalid MT5 payload`: the backend rejected the POST. Check the server console for the validation error.
- `No candles in payload`: the EA/server received no closed candles. Make sure the chart has loaded history.
- `WebRequest failed` in MT5: add `http://127.0.0.1:3001` to MT5 WebRequest allowed URLs.
- `No MT5 verification response received`: start the backend, keep the EA attached, and confirm `EnableRiskCalculatorCommands` is enabled in EA inputs.
- `Failed to fetch` or `Could not reach backend risk endpoint`: restart the backend after updating, confirm it is listening on `http://127.0.0.1:3001`, then refresh the browser.
- `MT5 Algo Trading is disabled`: turn on the Algo Trading button in MT5 when testing on demo, then prepare a new order.
- `Live trading is not allowed for this EA`: allow live trading in the EA properties and confirm AutoTrading is enabled.
- `Invalid WebRequest URL`: MT5 must allow exactly `http://127.0.0.1:3001`, not only the individual endpoint URLs.
- `Waiting for account data` or `Waiting for quote data`: keep MT5 open and logged in, attach the EA to a live chart, and wait for the next timer update.
- `Invalid symbol properties`: the broker did not provide valid tick size, tick value, or volume step for the symbol. Confirm the symbol is selected and tradable in MT5 Market Watch.

## Known Limitations

- Dashboard mirrors only the chart where EA is attached.
- Indicators are controlled from MT5 EA inputs, not the browser.
- Account, quote, and position monitor fields are read-only.
- Pending order monitor fields are read-only.
- Risk Calculator frontend results are preliminary estimates until `Verify with MT5` returns.
- MT5 risk verification is calculation-only and depends on the EA polling `/mt5/commands`.
- V3C order entry and V3D trade management are controlled by MT5 Algo Trading, EA live-trading permission, account permissions, frontend Trading Mode, and the relevant backend/EA safety gates.
- V3D supports only individual position/order management actions. No bulk close, bulk cancel, trailing stop, or automated management exists.
- V3D pending order modification currently supports only supported pending order types, primarily Buy Limit and Sell Limit.
- V3E chart trade visuals are visual-only. There is no drag-to-modify, chart close button, chart modify button, or chart cancel button yet.
- Browser indicator toggles only hide/show local layers; they do not change MT5 calculations.
- S/R + ATR Buffer settings are controlled from the MT5 EA inputs; the frontend only displays or locally hides/shows the MT5-sent lines.
- Collapsed oscillator panels show the latest received values only; they do not calculate summaries in the browser.
- Panel height presets and dragged panel heights are browser-local UI preferences.
- Auto-scroll and chart view controls are browser-local preferences/actions.
- Only closed candles are displayed.
- MT5 must be open and logged in.
- Broker candle data may differ from TradingView.
- V3A monitor and V3B risk verification remain non-execution features. V3C order placement is limited to explicitly confirmed market/limit entry only.

## Future Improvements

- Frontend-controlled indicator settings.
- Multiple charts.
- Symbol/timeframe selector.
- Unfinished live candle mode.
- Alerts.
- Advanced support/resistance tools.
- Account/position risk tools.
- Packaged Windows `.exe`.
