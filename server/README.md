# MT5 Dashboard Local Server

Local-only Express and WebSocket bridge between MetaTrader 5 and the browser dashboard.

The server does not calculate indicators and does not modify indicator values. It validates MT5 snapshots, stores the latest valid snapshot in memory, and broadcasts that snapshot to connected browser clients.

## Endpoints

- `POST /mt5/update` receives the full MT5 chart snapshot.
- `GET /health` returns server state:

```json
{
  "ok": true,
  "hasSnapshot": false,
  "clients": 0,
  "lastUpdate": null
}
```

- `ws://127.0.0.1:3001` streams snapshots to browsers.

## Run

```powershell
cd server
npm install
npm start
```

For development:

```powershell
npm run dev
```

Both scripts run `node server.js`.

## Snapshot Contract

`POST /mt5/update` expects JSON from the MT5 EA:

```json
{
  "source": "mt5",
  "symbol": "EURUSD",
  "timeframe": "M15",
  "timeframeSeconds": 900,
  "lastClosedTime": 1710000000,
  "settings": {},
  "candles": [
    {
      "time": 1710000000,
      "open": 1.09000,
      "high": 1.09100,
      "low": 1.08900,
      "close": 1.09050,
      "smaFast": 1.09020,
      "smaMid": null,
      "smaSlow": null,
      "atr": 0.0012,
      "adx": 24.5,
      "diPlus": 18.1,
      "diMinus": 14.9,
      "rsi": 52.34567
    }
  ]
}
```

Required validation:

- `source` must be `"mt5"`.
- `symbol` and `timeframe` must be non-empty strings.
- `timeframeSeconds` and `lastClosedTime` must be numbers.
- `settings` must be an object.
- `candles` must be an array.
- Every candle must have numeric `time`, `open`, `high`, `low`, and `close`.
- Indicator fields may be numbers, `null`, or omitted.

## WebSocket Behavior

When a browser connects, the server immediately sends the latest valid snapshot if one is available. The server pings clients every 30 seconds and terminates dead connections.
