# MT5 Dashboard Local Server

Local-only Express and WebSocket bridge between MetaTrader 5 and the browser dashboard.

The server does not calculate indicators and does not modify indicator values. It validates MT5 snapshots, stores the latest valid snapshot in memory, and broadcasts that snapshot to connected browser clients.

V3A also supports read-only trading monitor sections from MT5: `account`, `quote`, `positions`, and `orders`. The server validates and relays those sections only.

V3B adds a calculation-only risk command queue. The browser can queue a lot-size calculation request, MT5 polls it, MT5 calculates broker-normalized volume, and the server broadcasts the result. The server does not calculate PnL or calculate lot size.

V3C adds backend order command queue support. The backend validates and queues `PLACE_ORDER` commands for MT5 polling, but it does not place trades itself. MT5 controls final execution with the Algo Trading button, EA live-trading permission, and account expert-trading permission.

V3D adds a separate trade-management command queue for closing positions, partial close, modifying position SL/TP, moving SL to breakeven, cancelling pending orders, and modifying pending order entry/SL/TP. It is disabled by default with `ENABLE_TRADE_MANAGEMENT=false`.

## Endpoints

- `POST /mt5/update` receives the full MT5 chart snapshot.
- `POST /risk/calculate` queues a calculation-only lot-size request from the browser.
- `POST /orders/place` validates and queues an order placement command for MT5 polling.
- `POST /positions/close` validates and queues full or partial position close commands when trade management is enabled.
- `POST /positions/modify` validates and queues position SL/TP modification commands when trade management is enabled.
- `POST /positions/breakeven` validates and queues position breakeven commands when trade management is enabled.
- `POST /orders/cancel` validates and queues pending order cancel commands when trade management is enabled.
- `POST /orders/modify` validates and queues pending order entry/SL/TP modification commands when trade management is enabled.
- `GET /mt5/commands` returns pending calculator and order commands for the EA to poll.
- `POST /mt5/risk-result` receives MT5 broker-normalized calculator results.
- `POST /mt5/order-result` receives MT5 order placement results.
- `POST /mt5/trade-management-result` receives MT5 trade-management results.
- `GET /health` returns server state:

```json
{
  "ok": true,
  "hasSnapshot": false,
  "hasAccount": false,
  "hasQuote": false,
  "positionCount": 0,
  "orderCount": 0,
  "pendingRiskCommands": 0,
  "riskResultCount": 0,
  "pendingOrderCommands": 0,
  "orderResultCount": 0,
  "tradeManagementCommandsEnabled": false,
  "pendingTradeManagementCommands": 0,
  "tradeManagementResultCount": 0,
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

## Order Execution Control

The backend order endpoint is only a local command queue. It does not place, close, modify, or cancel trades.

Final execution is controlled inside MT5:

- The MT5 Algo Trading button must be ON.
- Live trading must be allowed for the attached EA.
- The account and broker must allow expert trading on the symbol.
- The browser confirmation modal must be accepted with frontend Trading Mode ON.

If MT5 trading permission is OFF, the EA posts an `ORDER_RESULT` failure instead of calling `OrderSend`.

## Trade Management Control

V3D trade-management endpoints are disabled by default. Start the backend with this environment variable only when you are ready to test management commands on a demo account:

```powershell
$env:ENABLE_TRADE_MANAGEMENT='true'
npm start
```

When disabled, all V3D management endpoints return:

```json
{
  "ok": false,
  "error": "Trade management commands are disabled on the backend."
}
```

This gate controls only existing-trade management commands:

- Close position
- Partial close position
- Modify position SL/TP
- Move position SL to breakeven
- Cancel pending order
- Modify pending order entry/SL/TP

It is separate from order placement. The current V3C order placement queue is controlled by the dashboard confirmation flow and final MT5 trading permissions. The backend still never directly trades.

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
  ],
  "orders": [
    {
      "ticket": 123456789,
      "symbol": "EURUSD",
      "type": "BUY_LIMIT",
      "volumeInitial": 0.1,
      "volumeCurrent": 0.1,
      "openPrice": 1.08000,
      "sl": 1.07500,
      "tp": 1.09000,
      "openTime": 1710000000,
      "expirationTime": 0,
      "magic": 2026001,
      "comment": "dashboard"
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
- Optional `orders` must be an array. Empty arrays are valid. Each pending order uses number-or-string `ticket` and `magic`, string `symbol`, `type`, and `comment`, numeric volume, price, open time, and expiration fields, and nullable numeric `sl` and `tp`.

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

## V3C Order Command Queue

The V3C backend order flow is a queue only:

```text
Browser POST /orders/place
  -> server validates request
  -> server queues PLACE_ORDER for MT5 polling
  -> MT5 EA polls GET /mt5/commands
  -> MT5 EA places the order only when Algo Trading and EA live trading are allowed
  -> MT5 POST /mt5/order-result
  -> server broadcasts { type: "ORDER_RESULT", payload: ... } over WebSocket
```

The backend never sends orders to the broker. It only validates, stores, exposes commands to the EA poll endpoint, accepts results, and broadcasts those results.

If MT5 Algo Trading or EA live trading is disabled, MT5 posts:

```json
{
  "type": "ORDER_RESULT",
  "requestId": "order-unique-id",
  "ok": false,
  "symbol": "EURUSD",
  "orderKind": "MARKET",
  "side": "BUY",
  "volume": 0.1,
  "entryPrice": 1.085,
  "sl": 1.08,
  "tp": 1.095,
  "retcode": 0,
  "message": "MT5 Algo Trading is disabled."
}
```

Browser request:

```json
{
  "requestId": "order-unique-id",
  "clientTradingMode": true,
  "confirmationAccepted": true,
  "symbol": "EURUSD",
  "orderKind": "MARKET",
  "side": "BUY",
  "volume": 0.1,
  "entryPrice": 1.085,
  "sl": 1.08,
  "tp": 1.095,
  "comment": "dashboard",
  "magic": 2026001
}
```

`clientTradingMode` and `confirmationAccepted` are dashboard safety flags. They are required by the backend before queueing an order command, but they are not forwarded to MT5.

Queued response:

```json
{
  "ok": true,
  "requestId": "order-unique-id",
  "status": "queued",
  "warnings": []
}
```

When the latest MT5 quote matches the request symbol, the server adds broker-aware validation:

- Market entries are compared with current bid/ask and may return warnings if the quote has drifted.
- Buy Limit entry must be below current ask.
- Sell Limit entry must be above current bid.
- Volume must respect broker min, max, and step.

MT5 command poll response may include both risk and order commands:

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
    },
    {
      "type": "PLACE_ORDER",
      "requestId": "order-unique-id",
      "symbol": "EURUSD",
      "orderKind": "MARKET",
      "side": "BUY",
      "volume": 0.1,
      "entryPrice": 1.085,
      "sl": 1.08,
      "tp": 1.095,
      "comment": "dashboard",
      "magic": 2026001
    }
  ]
}
```

MT5 success result:

```json
{
  "type": "ORDER_RESULT",
  "requestId": "order-unique-id",
  "ok": true,
  "symbol": "EURUSD",
  "orderKind": "MARKET",
  "side": "BUY",
  "volume": 0.1,
  "entryPrice": 1.085,
  "sl": 1.08,
  "tp": 1.095,
  "ticket": 123456789,
  "retcode": 10009,
  "message": "Order placed"
}
```

MT5 failure result:

```json
{
  "type": "ORDER_RESULT",
  "requestId": "order-unique-id",
  "ok": false,
  "symbol": "EURUSD",
  "orderKind": "LIMIT",
  "side": "BUY",
  "volume": 0.1,
  "entryPrice": 1.08,
  "sl": 1.075,
  "tp": 1.09,
  "retcode": 10016,
  "message": "Invalid stops"
}
```

Order commands expire after 10 minutes. Stored order results expire after 30 minutes. Commands returned by `/mt5/commands` are marked delivered to avoid duplicate processing.

## V3D Trade Management Command Queue

The V3D backend management flow is also a queue only:

```text
Browser POST management endpoint
  -> server checks ENABLE_TRADE_MANAGEMENT
  -> server validates request
  -> server queues command for MT5 polling
  -> MT5 EA polls GET /mt5/commands
  -> MT5 EA performs the management action only after its own safety checks
  -> MT5 POST /mt5/trade-management-result
  -> server broadcasts { type: "TRADE_MANAGEMENT_RESULT", payload: ... } over WebSocket
```

The backend never closes, modifies, or cancels trades itself.

### Close or Partial Close Position

`POST /positions/close`

```json
{
  "requestId": "close-unique-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "volume": null
}
```

`volume: null` means full close. A positive number means partial close. When the latest positions snapshot is available, the server verifies the ticket exists. For partial closes, the volume must be less than the current position volume and must respect broker `volumeMin` / `volumeStep` when the matching quote is available.

Queued MT5 command:

```json
{
  "type": "CLOSE_POSITION",
  "requestId": "close-unique-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "volume": null
}
```

### Modify Position SL/TP

`POST /positions/modify`

```json
{
  "requestId": "modify-position-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "sl": 1.08,
  "tp": 1.095
}
```

`sl` and `tp` may be `null`, but at least one must be provided. When the latest position is available, the server validates side-aware stop placement against the current price.

Queued MT5 command:

```json
{
  "type": "MODIFY_POSITION",
  "requestId": "modify-position-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "sl": 1.08,
  "tp": 1.095
}
```

### Move Position SL to Breakeven

`POST /positions/breakeven`

```json
{
  "requestId": "breakeven-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "offsetPoints": 0
}
```

When latest position and matching quote data are available, the server calculates the rough proposed SL from open price and `quote.point` for validation. Final broker normalization belongs in MT5.

Queued MT5 command:

```json
{
  "type": "MOVE_TO_BREAKEVEN",
  "requestId": "breakeven-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "offsetPoints": 0
}
```

### Cancel Pending Order

`POST /orders/cancel`

```json
{
  "requestId": "cancel-order-id",
  "ticket": 123456789,
  "symbol": "EURUSD"
}
```

When the latest pending orders snapshot is available, the server verifies the ticket exists.

Queued MT5 command:

```json
{
  "type": "CANCEL_ORDER",
  "requestId": "cancel-order-id",
  "ticket": 123456789,
  "symbol": "EURUSD"
}
```

### Modify Pending Order

`POST /orders/modify`

```json
{
  "requestId": "modify-order-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "entryPrice": 1.08,
  "sl": 1.075,
  "tp": 1.09
}
```

`entryPrice` must be positive. `sl` and `tp` may be `null`. When the latest pending order and matching quote are available, the server validates Buy Limit below current ask, Sell Limit above current bid, and side-aware SL/TP placement around entry.

Queued MT5 command:

```json
{
  "type": "MODIFY_ORDER",
  "requestId": "modify-order-id",
  "ticket": 123456789,
  "symbol": "EURUSD",
  "entryPrice": 1.08,
  "sl": 1.075,
  "tp": 1.09
}
```

### Management Result

`POST /mt5/trade-management-result`

Success:

```json
{
  "type": "TRADE_MANAGEMENT_RESULT",
  "requestId": "close-unique-id",
  "commandType": "CLOSE_POSITION",
  "ok": true,
  "ticket": "123456789",
  "symbol": "EURUSD",
  "retcode": 10009,
  "message": "Position closed"
}
```

Failure:

```json
{
  "type": "TRADE_MANAGEMENT_RESULT",
  "requestId": "modify-position-id",
  "commandType": "MODIFY_POSITION",
  "ok": false,
  "ticket": "123456789",
  "symbol": "EURUSD",
  "retcode": 10016,
  "message": "Invalid stops"
}
```

Trade-management commands expire after 10 minutes. Stored trade-management results expire after 30 minutes. Commands returned by `/mt5/commands` are marked delivered to avoid duplicate processing.

## V3A Integration Checks

Manual MT5 flow:

1. Start the backend with `npm start`.
2. Start the frontend from `web` with `npm run dev`.
3. Open MT5 and attach the EA to `EURUSD` `M15`.
4. Confirm `GET /health` reports `hasAccount: true`, `hasQuote: true`, and a `positionCount` number.
5. Open a small demo position manually in MT5 and confirm `positionCount` updates.
6. Place a demo pending limit order manually in MT5 and confirm `orderCount` updates.
7. Keep `ENABLE_TRADE_MANAGEMENT` unset and confirm management endpoints reject with the disabled message.

Useful health response after V3A data is flowing:

```json
{
  "ok": true,
  "hasSnapshot": true,
  "hasAccount": true,
  "hasQuote": true,
  "positionCount": 1,
  "orderCount": 1,
  "pendingRiskCommands": 0,
  "riskResultCount": 0,
  "pendingOrderCommands": 0,
  "orderResultCount": 0,
  "tradeManagementCommandsEnabled": false,
  "pendingTradeManagementCommands": 0,
  "tradeManagementResultCount": 0,
  "clients": 1,
  "lastUpdate": "2026-05-25T12:00:00.000Z",
  "lastTradingUpdate": "2026-05-25T12:00:00.000Z"
}
```

## WebSocket Behavior

When a browser connects, the server immediately sends the latest valid snapshot if one is available. The server pings clients every 30 seconds and terminates dead connections.
