# MT5 Dashboard Local Server

Local-only Express and WebSocket bridge between MetaTrader 5 and the browser dashboard.

The server does not calculate indicators and does not modify indicator values. It validates MT5 snapshots, stores the latest valid snapshot in memory, and broadcasts that snapshot to connected browser clients.

V3A also supports read-only trading monitor sections from MT5: `account`, `quote`, and `positions`. The server validates and relays those sections only.

V3B adds a calculation-only risk command queue. The browser can queue a lot-size calculation request, MT5 polls it, MT5 calculates broker-normalized volume, and the server broadcasts the result. The server does not calculate PnL, calculate lot size, place orders, close orders, or modify trades.

## Endpoints

- `POST /mt5/update` receives the full MT5 chart snapshot.
- `POST /risk/calculate` queues a calculation-only lot-size request from the browser.
- `GET /mt5/commands` returns pending calculator commands for the EA to poll.
- `POST /mt5/risk-result` receives MT5 broker-normalized calculator results.
- `GET /health` returns server state:

```json
{
  "ok": true,
  "hasSnapshot": false,
  "hasAccount": false,
  "hasQuote": false,
  "positionCount": 0,
  "pendingRiskCommands": 0,
  "riskResultCount": 0,
  "clients": 0,
  "lastUpdate": null,
  "lastTradingUpdate": null
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
  "chartUpdated": true,
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
  ],
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

Required validation:

- `source` must be `"mt5"`.
- `symbol` and `timeframe` must be non-empty strings.
- `timeframeSeconds` and `lastClosedTime` must be numbers.
- `settings` must be an object.
- `candles` must be an array.
- Every candle must have numeric `time`, `open`, `high`, `low`, and `close`.
- Indicator fields may be numbers, `null`, or omitted.
- Optional `account` must contain string `server` and `currency`, number `balance`, `equity`, `profit`, `margin`, and `freeMargin`, nullable number `marginLevel` and `leverage`, and number-or-string `login`.
- Optional `quote` must contain string `symbol` and numeric bid/ask, spread, digits, point, tick size/value, volume limits, volume step, and contract size.
- Optional `positions` must be an array. Empty arrays are valid. Each position uses `BUY` or `SELL`, number-or-string `ticket` and `magic`, string `symbol` and `comment`, numeric prices/PnL fields, and nullable numeric `sl` and `tp`.

For monitor-only updates, MT5 may send `chartUpdated: false` without a `candles` array after the server already has a complete chart snapshot. The server merges the read-only monitor data into the latest stored chart snapshot and broadcasts the complete merged snapshot.

## V3B Risk Calculator Command Flow

The V3B flow is calculation-only:

```text
Browser POST /risk/calculate
  -> server queues CALCULATE_RISK_LOT
  -> MT5 EA polls GET /mt5/commands
  -> MT5 calculates with broker account/symbol properties
  -> MT5 POST /mt5/risk-result
  -> server broadcasts { type: "riskResult", payload: ... } over WebSocket
```

Browser request:

```json
{
  "requestId": "risk-unique-id",
  "symbol": "EURUSD",
  "side": "BUY",
  "riskBasis": "EQUITY",
  "riskMode": "PERCENT",
  "riskValue": 1,
  "entryPrice": 1.085,
  "stopLossPrice": 1.08
}
```

Queued response:

```json
{
  "ok": true,
  "requestId": "risk-unique-id",
  "status": "queued"
}
```

MT5 command poll response:

```json
{
  "commands": [
    {
      "type": "CALCULATE_RISK_LOT",
      "requestId": "risk-unique-id",
      "symbol": "EURUSD",
      "side": "BUY",
      "riskBasis": "EQUITY",
      "riskMode": "PERCENT",
      "riskValue": 1,
      "entryPrice": 1.085,
      "stopLossPrice": 1.08
    }
  ]
}
```

MT5 result:

```json
{
  "type": "RISK_LOT_RESULT",
  "requestId": "risk-unique-id",
  "ok": true,
  "symbol": "EURUSD",
  "side": "BUY",
  "riskBasis": "EQUITY",
  "riskMode": "PERCENT",
  "riskValue": 1,
  "riskBasisAmount": 10000,
  "riskAmount": 100,
  "entryPrice": 1.085,
  "stopLossPrice": 1.08,
  "stopDistancePoints": 500,
  "tickSize": 0.00001,
  "tickValue": 1,
  "volumeMin": 0.01,
  "volumeMax": 100,
  "volumeStep": 0.01,
  "rawVolume": 0.2,
  "normalizedVolume": 0.2,
  "estimatedLoss": 100,
  "warnings": []
}
```

Failed MT5 result:

```json
{
  "type": "RISK_LOT_RESULT",
  "requestId": "risk-unique-id",
  "ok": false,
  "error": "Stop-loss must be below entry for BUY",
  "warnings": []
}
```

Risk commands expire after 10 minutes. Stored results expire after 30 minutes. Commands returned by `/mt5/commands` are marked delivered to avoid duplicate processing.

## V3A Integration Checks

Manual MT5 flow:

1. Start the backend with `npm start`.
2. Start the frontend from `web` with `npm run dev`.
3. Open MT5 and attach the EA to `EURUSD` `M15`.
4. Confirm `GET /health` reports `hasAccount: true`, `hasQuote: true`, and a `positionCount` number.
5. Open a small demo position manually in MT5 and confirm `positionCount` updates.
6. Confirm no backend routes exist for placing, closing, or modifying trades.

Useful health response after V3A data is flowing:

```json
{
  "ok": true,
  "hasSnapshot": true,
  "hasAccount": true,
  "hasQuote": true,
  "positionCount": 1,
  "pendingRiskCommands": 0,
  "riskResultCount": 0,
  "clients": 1,
  "lastUpdate": "2026-05-25T12:00:00.000Z",
  "lastTradingUpdate": "2026-05-25T12:00:00.000Z"
}
```

## WebSocket Behavior

When a browser connects, the server immediately sends the latest valid snapshot if one is available. The server pings clients every 30 seconds and terminates dead connections.
