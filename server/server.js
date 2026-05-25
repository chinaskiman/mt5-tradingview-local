import express from 'express';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = 3001;
const HOST = '127.0.0.1';
const HEARTBEAT_MS = 30000;
const RISK_COMMAND_TTL_MS = 10 * 60 * 1000;
const RISK_RESULT_TTL_MS = 30 * 60 * 1000;
const INDICATOR_FIELDS = ['smaFast', 'smaMid', 'smaSlow', 'atr', 'adx', 'diPlus', 'diMinus', 'rsi'];
const LOCAL_BROWSER_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let latestSnapshot = null;
let lastUpdate = null;
let lastTradingUpdate = null;
const pendingRiskCommands = new Map();
const riskResults = new Map();

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && LOCAL_BROWSER_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasSnapshot: Boolean(latestSnapshot),
    hasAccount: Boolean(latestSnapshot?.account),
    hasQuote: Boolean(latestSnapshot?.quote),
    positionCount: Array.isArray(latestSnapshot?.positions) ? latestSnapshot.positions.length : 0,
    pendingRiskCommands: pendingRiskCommands.size,
    riskResultCount: riskResults.size,
    clients: getConnectedClientCount(),
    lastUpdate,
    lastTradingUpdate
  });
});

app.post('/mt5/update', (req, res) => {
  const snapshot = normalizeSnapshot(req.body);
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    console.warn(`Rejected MT5 update: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  latestSnapshot = mergeSnapshot(snapshot);
  lastUpdate = new Date().toISOString();
  if (hasTradingMonitorData(snapshot)) {
    lastTradingUpdate = lastUpdate;
  }

  const broadcastCount = broadcastSnapshot(latestSnapshot);

  console.log('MT5 update received');
  console.log(`  symbol/timeframe: ${latestSnapshot.symbol} ${latestSnapshot.timeframe}`);
  console.log(`  chart updated: ${latestSnapshot.chartUpdated !== false}`);
  console.log(`  candles: ${latestSnapshot.candles.length}`);
  console.log(`  last closed candle time: ${latestSnapshot.lastClosedTime ?? 'not provided'}`);
  console.log(`  account equity: ${formatOptionalNumber(latestSnapshot.account?.equity)}`);
  console.log(`  quote: ${formatQuoteLog(latestSnapshot.quote)}`);
  console.log(`  open positions: ${Array.isArray(latestSnapshot.positions) ? latestSnapshot.positions.length : 0}`);
  console.log(`  broadcast clients: ${broadcastCount}`);

  res.json({ ok: true, clients: getConnectedClientCount(), broadcastCount });
});

app.post('/risk/calculate', (req, res) => {
  cleanupRiskState();

  const validation = validateRiskCalculationRequest(req.body);
  if (!validation.ok) {
    console.warn(`Rejected risk calculation request: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  const command = {
    type: 'CALCULATE_RISK_LOT',
    requestId: req.body.requestId,
    symbol: req.body.symbol,
    side: req.body.side,
    riskBasis: req.body.riskBasis,
    riskMode: req.body.riskMode,
    riskValue: req.body.riskValue,
    entryPrice: req.body.entryPrice,
    stopLossPrice: req.body.stopLossPrice,
    queuedAt: new Date().toISOString(),
    deliveredAt: null
  };

  pendingRiskCommands.set(command.requestId, command);
  riskResults.delete(command.requestId);

  console.log('Risk calculation command queued');
  console.log(`  requestId: ${command.requestId}`);
  console.log(`  symbol/side: ${command.symbol} ${command.side}`);

  res.json({ ok: true, requestId: command.requestId, status: 'queued' });
});

app.get('/mt5/commands', (_req, res) => {
  cleanupRiskState();

  const now = new Date().toISOString();
  const commands = [];

  for (const command of pendingRiskCommands.values()) {
    if (command.deliveredAt) {
      continue;
    }

    command.deliveredAt = now;
    commands.push(toMt5RiskCommand(command));
  }

  if (commands.length) {
    console.log(`Delivered ${commands.length} MT5 command(s).`);
  }

  res.json({ commands });
});

app.post('/mt5/risk-result', (req, res) => {
  cleanupRiskState();

  const validation = validateRiskResult(req.body);
  if (!validation.ok) {
    console.warn(`Rejected MT5 risk result: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  const result = {
    ...req.body,
    receivedAt: new Date().toISOString()
  };

  pendingRiskCommands.delete(result.requestId);
  riskResults.set(result.requestId, result);

  const sent = broadcastRiskResult(result);

  console.log('MT5 risk result received');
  console.log(`  requestId: ${result.requestId}`);
  console.log(`  ok: ${result.ok}`);
  console.log(`  broadcast clients: ${sent}`);

  res.json({ ok: true, requestId: result.requestId, broadcastCount: sent });
});

app.use((err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
    return;
  }

  console.error('Unhandled server error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

wss.on('connection', (socket) => {
  socket.isAlive = true;

  console.log(`WebSocket client connected. Clients: ${getConnectedClientCount()}`);

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('close', () => {
    console.log(`WebSocket client disconnected. Clients: ${getConnectedClientCount()}`);
  });

  socket.on('error', (error) => {
    console.warn(`WebSocket client error: ${error.message}`);
  });

  if (latestSnapshot) {
    sendJson(socket, {
      type: 'snapshot',
      payload: latestSnapshot
    });
  }
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);

wss.on('close', () => {
  clearInterval(heartbeat);
});

function validateSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object snapshot.');
  }

  if (payload.source !== 'mt5') {
    return invalid('source must be "mt5".');
  }

  if (!isNonEmptyString(payload.symbol)) {
    return invalid('symbol must be a non-empty string.');
  }

  if (!isNonEmptyString(payload.timeframe)) {
    return invalid('timeframe must be a non-empty string.');
  }

  if (!Number.isFinite(payload.timeframeSeconds)) {
    return invalid('timeframeSeconds must be a number.');
  }

  if (!Number.isFinite(payload.lastClosedTime)) {
    return invalid('lastClosedTime must be a number.');
  }

  if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
    return invalid('settings must be an object.');
  }

  const accountValidation = validateAccount(payload.account);
  if (!accountValidation.ok) {
    return accountValidation;
  }

  const quoteValidation = validateQuote(payload.quote);
  if (!quoteValidation.ok) {
    return quoteValidation;
  }

  const positionsValidation = validatePositions(payload.positions);
  if (!positionsValidation.ok) {
    return positionsValidation;
  }

  const chartUpdated = payload.chartUpdated !== false;

  if (!chartUpdated && !latestSnapshot) {
    return invalid('chartUpdated false requires an existing chart snapshot.');
  }

  if (!chartUpdated && payload.candles === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(payload.candles)) {
    return invalid('candles must be an array.');
  }

  if (payload.candles.length === 0) {
    return invalid('No candles in payload. MT5 must send at least one closed candle.');
  }

  for (let index = 0; index < payload.candles.length; index += 1) {
    const candle = payload.candles[index];
    const candleValidation = validateCandle(candle, index);

    if (!candleValidation.ok) {
      return candleValidation;
    }
  }

  return { ok: true };
}

function validateRiskCalculationRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object risk calculation request.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return invalid('requestId must be a non-empty string.');
  }

  if (!isNonEmptyString(payload.symbol)) {
    return invalid('symbol must be a non-empty string.');
  }

  if (payload.side !== 'BUY' && payload.side !== 'SELL') {
    return invalid('side must be BUY or SELL.');
  }

  if (payload.riskBasis !== 'EQUITY' && payload.riskBasis !== 'BALANCE') {
    return invalid('riskBasis must be EQUITY or BALANCE.');
  }

  if (payload.riskMode !== 'PERCENT' && payload.riskMode !== 'FIXED') {
    return invalid('riskMode must be PERCENT or FIXED.');
  }

  for (const field of ['riskValue', 'entryPrice', 'stopLossPrice']) {
    if (!Number.isFinite(payload[field]) || payload[field] <= 0) {
      return invalid(`${field} must be a positive number.`);
    }
  }

  if (payload.side === 'BUY' && payload.stopLossPrice >= payload.entryPrice) {
    return invalid('Stop-loss must be below entry for BUY.');
  }

  if (payload.side === 'SELL' && payload.stopLossPrice <= payload.entryPrice) {
    return invalid('Stop-loss must be above entry for SELL.');
  }

  return { ok: true };
}

function validateRiskResult(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object risk result.');
  }

  if (payload.type !== 'RISK_LOT_RESULT') {
    return invalid('risk result type must be RISK_LOT_RESULT.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return invalid('risk result requestId must be a non-empty string.');
  }

  if (typeof payload.ok !== 'boolean') {
    return invalid('risk result ok must be a boolean.');
  }

  if (!Array.isArray(payload.warnings)) {
    return invalid('risk result warnings must be an array.');
  }

  if (!payload.ok) {
    if (!isNonEmptyString(payload.error)) {
      return invalid('failed risk result must include an error string.');
    }

    return { ok: true };
  }

  if (!isNonEmptyString(payload.symbol)) return invalid('risk result symbol must be a non-empty string.');
  if (payload.side !== 'BUY' && payload.side !== 'SELL') return invalid('risk result side must be BUY or SELL.');
  if (payload.riskBasis !== 'EQUITY' && payload.riskBasis !== 'BALANCE') return invalid('risk result riskBasis must be EQUITY or BALANCE.');
  if (payload.riskMode !== 'PERCENT' && payload.riskMode !== 'FIXED') return invalid('risk result riskMode must be PERCENT or FIXED.');

  for (const field of [
    'riskValue',
    'riskBasisAmount',
    'riskAmount',
    'entryPrice',
    'stopLossPrice',
    'stopDistancePoints',
    'tickSize',
    'tickValue',
    'volumeMin',
    'volumeMax',
    'volumeStep',
    'rawVolume',
    'normalizedVolume',
    'estimatedLoss'
  ]) {
    if (!Number.isFinite(payload[field])) {
      return invalid(`risk result ${field} must be a number.`);
    }
  }

  return { ok: true };
}

function normalizeSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const normalized = { ...payload };

  if (Object.hasOwn(payload, 'account')) {
    normalized.account = normalizeAccount(payload.account);
  }

  if (Object.hasOwn(payload, 'positions')) {
    normalized.positions = normalizePositions(payload.positions);
  }

  return normalized;
}

function normalizeAccount(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    return account;
  }

  return {
    ...account,
    marginLevel: account.marginLevel ?? null,
    leverage: account.leverage ?? null
  };
}

function normalizePositions(positions) {
  if (!Array.isArray(positions)) {
    return positions;
  }

  return positions.map((position) => {
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      return position;
    }

    return {
      ...position,
      sl: position.sl ?? null,
      tp: position.tp ?? null
    };
  });
}

function mergeSnapshot(payload) {
  if (payload.chartUpdated === false && latestSnapshot) {
    return {
      ...latestSnapshot,
      ...payload,
      candles: latestSnapshot.candles,
      settings: payload.settings || latestSnapshot.settings
    };
  }

  return payload;
}

function validateAccount(account) {
  if (account === undefined) {
    return { ok: true };
  }

  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    return invalid('account must be an object when present.');
  }

  if (!isNumberOrString(account.login)) {
    return invalid('account.login must be a number or string.');
  }

  for (const field of ['server', 'currency']) {
    if (typeof account[field] !== 'string') {
      return invalid(`account.${field} must be a string.`);
    }
  }

  for (const field of ['balance', 'equity', 'profit', 'margin', 'freeMargin']) {
    if (!Number.isFinite(account[field])) {
      return invalid(`account.${field} must be a number.`);
    }
  }

  for (const field of ['marginLevel', 'leverage']) {
    if (account[field] !== null && !Number.isFinite(account[field])) {
      return invalid(`account.${field} must be a number or null.`);
    }
  }

  return { ok: true };
}

function validateQuote(quote) {
  if (quote === undefined) {
    return { ok: true };
  }

  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    return invalid('quote must be an object when present.');
  }

  if (typeof quote.symbol !== 'string') {
    return invalid('quote.symbol must be a string.');
  }

  for (const field of [
    'bid',
    'ask',
    'spreadPoints',
    'digits',
    'point',
    'tickSize',
    'tickValue',
    'volumeMin',
    'volumeMax',
    'volumeStep',
    'contractSize'
  ]) {
    if (!Number.isFinite(quote[field])) {
      return invalid(`quote.${field} must be a number.`);
    }
  }

  return { ok: true };
}

function validatePositions(positions) {
  if (positions === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(positions)) {
    return invalid('positions must be an array when present.');
  }

  for (let index = 0; index < positions.length; index += 1) {
    const validation = validatePosition(positions[index], index);
    if (!validation.ok) {
      return validation;
    }
  }

  return { ok: true };
}

function validatePosition(position, index) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    return invalid(`positions[${index}] must be an object.`);
  }

  if (!isNumberOrString(position.ticket)) {
    return invalid(`positions[${index}].ticket must be a number or string.`);
  }

  if (typeof position.symbol !== 'string') {
    return invalid(`positions[${index}].symbol must be a string.`);
  }

  if (position.type !== 'BUY' && position.type !== 'SELL') {
    return invalid(`positions[${index}].type must be BUY or SELL.`);
  }

  for (const field of ['volume', 'openPrice', 'currentPrice', 'profit', 'swap', 'commission', 'openTime']) {
    if (!Number.isFinite(position[field])) {
      return invalid(`positions[${index}].${field} must be a number.`);
    }
  }

  for (const field of ['sl', 'tp']) {
    if (position[field] !== null && !Number.isFinite(position[field])) {
      return invalid(`positions[${index}].${field} must be a number or null.`);
    }
  }

  if (!isNumberOrString(position.magic)) {
    return invalid(`positions[${index}].magic must be a number or string.`);
  }

  if (typeof position.comment !== 'string') {
    return invalid(`positions[${index}].comment must be a string.`);
  }

  return { ok: true };
}

function validateCandle(candle, index) {
  if (!candle || typeof candle !== 'object' || Array.isArray(candle)) {
    return invalid(`candles[${index}] must be an object.`);
  }

  for (const field of ['time', 'open', 'high', 'low', 'close']) {
    if (!Number.isFinite(candle[field])) {
      return invalid(`candles[${index}].${field} must be a number.`);
    }
  }

  for (const field of INDICATOR_FIELDS) {
    if (candle[field] !== undefined && candle[field] !== null && !Number.isFinite(candle[field])) {
      return invalid(`candles[${index}].${field} must be a number or null.`);
    }
  }

  return { ok: true };
}

function broadcastSnapshot(snapshot) {
  let sent = 0;

  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      sendJson(socket, {
        type: 'snapshot',
        payload: snapshot
      });
      sent += 1;
    }
  }

  return sent;
}

function broadcastRiskResult(result) {
  let sent = 0;

  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      sendJson(socket, {
        type: 'riskResult',
        payload: result
      });
      sent += 1;
    }
  }

  return sent;
}

function sendJson(socket, message) {
  socket.send(JSON.stringify(message));
}

function toMt5RiskCommand(command) {
  return {
    type: command.type,
    requestId: command.requestId,
    symbol: command.symbol,
    side: command.side,
    riskBasis: command.riskBasis,
    riskMode: command.riskMode,
    riskValue: command.riskValue,
    entryPrice: command.entryPrice,
    stopLossPrice: command.stopLossPrice
  };
}

function cleanupRiskState() {
  const now = Date.now();

  for (const [requestId, command] of pendingRiskCommands.entries()) {
    if (ageMs(command.queuedAt, now) > RISK_COMMAND_TTL_MS) {
      pendingRiskCommands.delete(requestId);
    }
  }

  for (const [requestId, result] of riskResults.entries()) {
    if (ageMs(result.receivedAt, now) > RISK_RESULT_TTL_MS) {
      riskResults.delete(requestId);
    }
  }
}

function ageMs(isoDate, now) {
  const timestamp = Date.parse(isoDate);
  return Number.isFinite(timestamp) ? now - timestamp : Number.POSITIVE_INFINITY;
}

function getConnectedClientCount() {
  let count = 0;

  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      count += 1;
    }
  }

  return count;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumberOrString(value) {
  return Number.isFinite(value) || typeof value === 'string';
}

function hasTradingMonitorData(snapshot) {
  return Boolean(snapshot?.account || snapshot?.quote || snapshot?.positions);
}

function formatOptionalNumber(value) {
  return Number.isFinite(value) ? value : 'not provided';
}

function formatQuoteLog(quote) {
  if (!quote) {
    return 'not provided';
  }

  return `${quote.symbol} bid=${quote.bid} ask=${quote.ask}`;
}

function invalid(error) {
  return { ok: false, error };
}

server.listen(PORT, HOST, () => {
  console.log(`MT5 dashboard bridge started at http://${HOST}:${PORT}`);
  console.log(`MT5 endpoint: POST http://${HOST}:${PORT}/mt5/update`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}`);
});
