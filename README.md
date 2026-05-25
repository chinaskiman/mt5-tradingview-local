# MT5 TradingView Local

Local Windows dashboard that mirrors the currently open MetaTrader 5 chart in a TradingView-style browser UI.

The dashboard scope is deliberately narrow:

- Local-only: MT5, Node.js server, and browser run on the same Windows machine.
- Read-only: no order execution, no order closing, and no order modification.
- Chart-attached: the dashboard mirrors only the chart where `MT5_Dashboard_Bridge.mq5` is attached.
- Closed candles only: the EA sends shift `1` and older candles, not the unfinished live candle.
- MT5-calculated indicators only: the browser displays indicator values sent by MT5.
- V3A monitor data is read-only: account summary, chart-symbol quote/properties, and open positions.
- No frontend symbol/timeframe selector and no volume panel.

## Architecture

```text
MetaTrader 5 chart
  attached EA: mt5/MT5_Dashboard_Bridge.mq5
  uses _Symbol and _Period only
  calculates SMA, ATR, ADX, DI+, DI- and RSI
  sends closed candles only
  sends read-only account, quote, and open position monitor data
        |
        | HTTP POST http://127.0.0.1:3001/mt5/update
        v
Node.js local bridge
  server/server.js
  Express validates the MT5 payload
  latest valid snapshot is kept in memory
  indicators are not calculated or modified
  queues calculation-only risk commands for MT5 polling
        |
        | WebSocket ws://127.0.0.1:3001
        v
React browser dashboard
  web/src/*
  Vite app at http://127.0.0.1:5173
  Lightweight Charts renders price, ATR, ADX/DI, and RSI panels

Risk calculator verification:
  React POST /risk/calculate -> backend queue
  MT5 GET /mt5/commands -> broker-normalized calculation
  MT5 POST /mt5/risk-result -> backend WebSocket riskResult
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
|       |   `-- TradingMonitor.jsx
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
MT5 commands: http://127.0.0.1:3001/mt5/commands
Risk result:  http://127.0.0.1:3001/mt5/risk-result
WebSocket:    ws://127.0.0.1:3001
```

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

## Attach the EA

1. Start the backend.
2. Open MT5.
3. Open the chart you want mirrored.
4. For the default test, use `EURUSD` on `M15`.
5. Attach `MT5_Dashboard_Bridge.mq5` to that chart.
6. Keep MT5 open and logged in.

The dashboard symbol and timeframe come from the attached chart. V1 intentionally has no browser-side symbol or timeframe picker.

The MT5 EA inputs control which indicators are calculated. The browser settings panel can hide or show already-received chart layers locally, but it does not send indicator changes back to MT5 in V1. Oscillator panels can also be collapsed to a compact row that keeps the latest MT5-sent value visible; click a compact row to expand it again. The chart toolbar controls browser view only: auto-scroll, fit content, go to latest, reset view, panel height presets, and saved panel heights.

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

The frontend uses a right-side menu with three sections: `Trading Monitor`, `Indicators`, and `Risk Calculator`. The whole side panel can be collapsed to give more width to the charts, and the active section is saved in `localStorage`. `Trading Monitor` shows account summary, chart-symbol quote, and an open-positions table. The position filter defaults to `Current symbol only` and can be switched to `All symbols`; the filter is also saved in `localStorage`.

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
14. Refresh the browser and confirm the selected filter is restored.
15. Switch the side menu between `Trading Monitor` and `Indicators`.
16. Collapse the right side panel and confirm the chart area expands.
17. Reopen the side panel and confirm the last selected section is restored.
18. Confirm no Buy/Sell/Close buttons exist.
19. Confirm `http://127.0.0.1:3001/health` shows `hasAccount`, `hasQuote`, and `positionCount`.
20. Confirm no frontend indicator calculations were added.
21. Confirm chart sync, crosshair sync, and draggable panels still work.

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
22. Use the browser indicator toggles to hide/show SMA, ATR, ADX, DI, and RSI layers.
23. Change EA inputs for indicator lengths or enabled state.
24. Reattach or restart the EA.
25. Confirm the frontend receives the new settings and values.

## Troubleshooting

- `Backend unavailable or WebSocket disconnected`: start `server/server.js` with `npm start`.
- `MT5 data not received yet`: MT5 has not posted a valid snapshot. Check that the EA is attached and WebRequest is allowed.
- `Invalid MT5 payload`: the backend rejected the POST. Check the server console for the validation error.
- `No candles in payload`: the EA/server received no closed candles. Make sure the chart has loaded history.
- `WebRequest failed` in MT5: add `http://127.0.0.1:3001` to MT5 WebRequest allowed URLs.
- `No MT5 verification response received`: start the backend, keep the EA attached, and confirm `EnableRiskCalculatorCommands` is enabled in EA inputs.
- `Invalid WebRequest URL`: MT5 must allow exactly `http://127.0.0.1:3001`, not only the individual endpoint URLs.
- `Waiting for account data` or `Waiting for quote data`: keep MT5 open and logged in, attach the EA to a live chart, and wait for the next timer update.
- `Invalid symbol properties`: the broker did not provide valid tick size, tick value, or volume step for the symbol. Confirm the symbol is selected and tradable in MT5 Market Watch.

## Known Limitations

- Dashboard mirrors only the chart where EA is attached.
- Indicators are controlled from MT5 EA inputs, not the browser.
- Account, quote, and position monitor fields are read-only.
- Risk Calculator frontend results are preliminary estimates until `Verify with MT5` returns.
- MT5 risk verification is calculation-only and depends on the EA polling `/mt5/commands`.
- Browser indicator toggles only hide/show local layers; they do not change MT5 calculations.
- Collapsed oscillator panels show the latest received values only; they do not calculate summaries in the browser.
- Panel height presets and dragged panel heights are browser-local UI preferences.
- Auto-scroll and chart view controls are browser-local preferences/actions.
- Only closed candles are displayed.
- MT5 must be open and logged in.
- Broker candle data may differ from TradingView.
- V3A/V3B are read-only and do not place, close, or modify trades yet.

## Future Improvements

- Frontend-controlled indicator settings.
- Multiple charts.
- Symbol/timeframe selector.
- Unfinished live candle mode.
- Alerts.
- Support/resistance.
- Account/position risk tools.
- Packaged Windows `.exe`.
