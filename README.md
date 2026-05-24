# MT5 TradingView Local

Local Windows dashboard that mirrors the currently open MetaTrader 5 chart in a TradingView-style browser UI.

V1 is deliberately narrow:

- Local-only: MT5, Node.js server, and browser run on the same Windows machine.
- View-only: no order execution, no order modification, and no account access.
- Chart-attached: the dashboard mirrors only the chart where `MT5_Dashboard_Bridge.mq5` is attached.
- Closed candles only: the EA sends shift `1` and older candles, not the unfinished live candle.
- MT5-calculated indicators only: the browser displays indicator values sent by MT5.
- No frontend symbol/timeframe selector and no volume panel.

## Architecture

```text
MetaTrader 5 chart
  attached EA: mt5/MT5_Dashboard_Bridge.mq5
  uses _Symbol and _Period only
  calculates SMA, ATR, ADX, DI+ and DI-
  sends closed candles only
        |
        | HTTP POST http://127.0.0.1:3001/mt5/update
        v
Node.js local bridge
  server/server.js
  Express validates the MT5 payload
  latest valid snapshot is kept in memory
  indicators are not calculated or modified
        |
        | WebSocket ws://127.0.0.1:3001
        v
React browser dashboard
  web/src/*
  Vite app at http://127.0.0.1:5173
  Lightweight Charts renders price, ATR, and ADX/DI panels
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
|       |   `-- IndicatorSettings.jsx
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
12. Change EA inputs for indicator lengths.
13. Reattach or restart the EA.
14. Confirm the frontend receives the new settings and values.

## Troubleshooting

- `Backend unavailable or WebSocket disconnected`: start `server/server.js` with `npm start`.
- `MT5 data not received yet`: MT5 has not posted a valid snapshot. Check that the EA is attached and WebRequest is allowed.
- `Invalid MT5 payload`: the backend rejected the POST. Check the server console for the validation error.
- `No candles in payload`: the EA/server received no closed candles. Make sure the chart has loaded history.
- `WebRequest failed` in MT5: add `http://127.0.0.1:3001` to MT5 WebRequest allowed URLs.

## Known Limitations

- Dashboard mirrors only the chart where EA is attached.
- Indicators are controlled from MT5 EA inputs, not the browser.
- Only closed candles are displayed.
- MT5 must be open and logged in.
- Broker candle data may differ from TradingView.
- This version does not place trades.

## Future Improvements

- Frontend-controlled indicator settings.
- Multiple charts.
- Symbol/timeframe selector.
- Unfinished live candle mode.
- Alerts.
- Support/resistance.
- Account/position monitor.
- Packaged Windows `.exe`.
