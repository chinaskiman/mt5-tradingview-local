import express from 'express';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = 3001;
const HOST = '127.0.0.1';
const HEARTBEAT_MS = 30000;
const RISK_COMMAND_TTL_MS = 10 * 60 * 1000;
const RISK_RESULT_TTL_MS = 30 * 60 * 1000;
const ORDER_COMMAND_TTL_MS = 10 * 60 * 1000;
const ORDER_RESULT_TTL_MS = 30 * 60 * 1000;
const TRADE_MANAGEMENT_COMMAND_TTL_MS = 10 * 60 * 1000;
const TRADE_MANAGEMENT_RESULT_TTL_MS = 30 * 60 * 1000;
const INDICATOR_FIELDS = ['smaFast', 'smaMid', 'smaSlow', 'atr', 'adx', 'diPlus', 'diMinus', 'rsi'];
const LOCAL_BROWSER_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const TRADE_MANAGEMENT_DISABLED_ERROR = 'Trade management commands are disabled on the backend.';
const TRADE_MANAGEMENT_COMMAND_TYPES = new Set([
  'CLOSE_POSITION',
  'MODIFY_POSITION',
  'MOVE_TO_BREAKEVEN',
  'CANCEL_ORDER',
  'MODIFY_ORDER'
]);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let latestSnapshot = null;
let lastUpdate = null;
let lastTradingUpdate = null;
const pendingRiskCommands = new Map();
const riskResults = new Map();
const pendingOrderCommands = new Map();
const orderResults = new Map();
const pendingTradeManagementCommands = new Map();
const tradeManagementResults = new Map();

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
  cleanupCommandState();

  res.json({
    ok: true,
    hasSnapshot: Boolean(latestSnapshot),
    hasAccount: Boolean(latestSnapshot?.account),
    hasQuote: Boolean(latestSnapshot?.quote),
    positionCount: Array.isArray(latestSnapshot?.positions) ? latestSnapshot.positions.length : 0,
    orderCount: Array.isArray(latestSnapshot?.orders) ? latestSnapshot.orders.length : 0,
    pendingRiskCommands: pendingRiskCommands.size,
    riskResultCount: riskResults.size,
    pendingOrderCommands: pendingOrderCommands.size,
    orderResultCount: orderResults.size,
    tradeManagementCommandsEnabled: isTradeManagementEnabled(),
    pendingTradeManagementCommands: pendingTradeManagementCommands.size,
    tradeManagementResultCount: tradeManagementResults.size,
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
  console.log(`  pending orders: ${Array.isArray(latestSnapshot.orders) ? latestSnapshot.orders.length : 0}`);
  console.log(`  broadcast clients: ${broadcastCount}`);

  res.json({ ok: true, clients: getConnectedClientCount(), broadcastCount });
});

app.post('/risk/calculate', (req, res) => {
  cleanupCommandState();

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

app.post('/orders/place', (req, res) => {
  cleanupCommandState();

  const validation = validateOrderRequest(req.body);
  if (!validation.ok) {
    console.warn(`Rejected order placement request: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  const normalizedOrder = normalizeOrderRequest(req.body);
  if (pendingOrderCommands.has(normalizedOrder.requestId) || orderResults.has(normalizedOrder.requestId)) {
    console.warn(`Rejected duplicate order placement requestId: ${normalizedOrder.requestId}`);
    res.status(409).json({ ok: false, error: 'Duplicate order requestId.' });
    return;
  }

  const snapshotValidation = validateOrderAgainstLatestSnapshot(normalizedOrder);
  if (!snapshotValidation.ok) {
    console.warn(`Rejected order placement request: ${snapshotValidation.error}`);
    res.status(400).json({ ok: false, error: snapshotValidation.error });
    return;
  }

  const command = {
    type: 'PLACE_ORDER',
    ...normalizedOrder,
    queuedAt: new Date().toISOString(),
    deliveredAt: null
  };

  pendingOrderCommands.set(command.requestId, command);
  orderResults.delete(command.requestId);

  console.log('Order placement command queued');
  console.log(`  requestId: ${command.requestId}`);
  console.log(`  symbol/order: ${command.symbol} ${command.orderKind} ${command.side}`);
  console.log(`  volume: ${command.volume}`);
  if (snapshotValidation.warnings.length) {
    console.log(`  warnings: ${snapshotValidation.warnings.join(' | ')}`);
  }

  res.json({
    ok: true,
    requestId: command.requestId,
    status: 'queued',
    warnings: snapshotValidation.warnings
  });
});

app.post('/positions/close', (req, res) => {
  handleTradeManagementRequest(req, res, {
    commandType: 'CLOSE_POSITION',
    validate: validateClosePositionRequest,
    normalize: normalizeClosePositionRequest
  });
});

app.post('/positions/modify', (req, res) => {
  handleTradeManagementRequest(req, res, {
    commandType: 'MODIFY_POSITION',
    validate: validateModifyPositionRequest,
    normalize: normalizeModifyPositionRequest
  });
});

app.post('/positions/breakeven', (req, res) => {
  handleTradeManagementRequest(req, res, {
    commandType: 'MOVE_TO_BREAKEVEN',
    validate: validateBreakevenRequest,
    normalize: normalizeBreakevenRequest
  });
});

app.post('/orders/cancel', (req, res) => {
  handleTradeManagementRequest(req, res, {
    commandType: 'CANCEL_ORDER',
    validate: validateCancelOrderRequest,
    normalize: normalizeCancelOrderRequest
  });
});

app.post('/orders/modify', (req, res) => {
  handleTradeManagementRequest(req, res, {
    commandType: 'MODIFY_ORDER',
    validate: validateModifyOrderRequest,
    normalize: normalizeModifyOrderRequest
  });
});

app.get('/mt5/commands', (_req, res) => {
  cleanupCommandState();

  const now = new Date().toISOString();
  const commands = [];

  for (const command of pendingRiskCommands.values()) {
    if (command.deliveredAt) {
      continue;
    }

    command.deliveredAt = now;
    commands.push(toMt5RiskCommand(command));
  }

  for (const command of pendingOrderCommands.values()) {
    if (command.deliveredAt) {
      continue;
    }

    command.deliveredAt = now;
    commands.push(toMt5OrderCommand(command));
  }

  for (const command of pendingTradeManagementCommands.values()) {
    if (command.deliveredAt) {
      continue;
    }

    command.deliveredAt = now;
    commands.push(toMt5TradeManagementCommand(command));
  }

  if (commands.length) {
    console.log(`Delivered ${commands.length} MT5 command(s).`);
  }

  res.json({ commands });
});

app.post('/mt5/risk-result', (req, res) => {
  cleanupCommandState();

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

app.post('/mt5/order-result', (req, res) => {
  cleanupCommandState();

  const validation = validateOrderResult(req.body);
  if (!validation.ok) {
    console.warn(`Rejected MT5 order result: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  const result = {
    ...req.body,
    receivedAt: new Date().toISOString()
  };

  pendingOrderCommands.delete(result.requestId);
  orderResults.set(result.requestId, result);

  const sent = broadcastOrderResult(result);

  console.log('MT5 order result received');
  console.log(`  requestId: ${result.requestId}`);
  console.log(`  ok: ${result.ok}`);
  console.log(`  symbol/order: ${result.symbol} ${result.orderKind} ${result.side}`);
  console.log(`  retcode: ${result.retcode}`);
  console.log(`  message: ${result.message}`);
  console.log(`  broadcast clients: ${sent}`);

  res.json({ ok: true, requestId: result.requestId, broadcastCount: sent });
});

app.post('/mt5/trade-management-result', (req, res) => {
  cleanupCommandState();

  const validation = validateTradeManagementResult(req.body);
  if (!validation.ok) {
    console.warn(`Rejected MT5 trade-management result: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  const result = {
    ...req.body,
    receivedAt: new Date().toISOString()
  };

  pendingTradeManagementCommands.delete(result.requestId);
  tradeManagementResults.set(result.requestId, result);

  const sent = broadcastTradeManagementResult(result);

  console.log('MT5 trade-management result received');
  console.log(`  requestId: ${result.requestId}`);
  console.log(`  commandType: ${result.commandType}`);
  console.log(`  ok: ${result.ok}`);
  console.log(`  ticket/symbol: ${result.ticket} ${result.symbol}`);
  console.log(`  retcode: ${result.retcode}`);
  console.log(`  message: ${result.message}`);
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

  const ordersValidation = validateOrders(payload.orders);
  if (!ordersValidation.ok) {
    return ordersValidation;
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

function validateOrderRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object order placement request.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return invalid('requestId must be a non-empty string.');
  }

  if (payload.clientTradingMode !== true) {
    return invalid('clientTradingMode must be true.');
  }

  if (payload.confirmationAccepted !== true) {
    return invalid('confirmationAccepted must be true.');
  }

  if (!isNonEmptyString(payload.symbol)) {
    return invalid('symbol must be a non-empty string.');
  }

  if (payload.orderKind !== 'MARKET' && payload.orderKind !== 'LIMIT') {
    return invalid('orderKind must be MARKET or LIMIT.');
  }

  if (payload.side !== 'BUY' && payload.side !== 'SELL') {
    return invalid('side must be BUY or SELL.');
  }

  if (!isPositiveNumber(payload.volume)) {
    return invalid('volume must be a positive number.');
  }

  if (!isPositiveNumber(payload.entryPrice)) {
    return invalid('entryPrice must be a positive number.');
  }

  for (const field of ['sl', 'tp']) {
    if (payload[field] !== undefined && payload[field] !== null && !isPositiveNumber(payload[field])) {
      return invalid(`${field} must be null or a positive number.`);
    }
  }

  if (payload.comment !== undefined && typeof payload.comment !== 'string') {
    return invalid('comment must be a string when provided.');
  }

  if (payload.magic !== undefined && !isNumberOrString(payload.magic)) {
    return invalid('magic must be a number or string when provided.');
  }

  return { ok: true };
}

function validateOrderAgainstLatestSnapshot(order) {
  const warnings = [];
  const quote = latestSnapshot?.quote;

  if (!quote || quote.symbol !== order.symbol) {
    return { ok: true, warnings };
  }

  const tolerance = getMarketPriceTolerance(quote);
  const referencePrice = order.side === 'BUY' ? quote.ask : quote.bid;

  if (order.orderKind === 'MARKET') {
    const drift = Math.abs(order.entryPrice - referencePrice);
    if (drift > tolerance) {
      warnings.push(
        `Market ${order.side} entry ${order.entryPrice} differs from current ${order.side === 'BUY' ? 'ask' : 'bid'} ${referencePrice}.`
      );
    }
  }

  if (order.orderKind === 'LIMIT' && order.side === 'BUY' && order.entryPrice >= quote.ask) {
    return invalid('Buy Limit entry price must be below the current ask.');
  }

  if (order.orderKind === 'LIMIT' && order.side === 'SELL' && order.entryPrice <= quote.bid) {
    return invalid('Sell Limit entry price must be above the current bid.');
  }

  if (Number.isFinite(quote.volumeMin) && order.volume < quote.volumeMin) {
    return invalid(`volume must be greater than or equal to broker minimum ${quote.volumeMin}.`);
  }

  if (Number.isFinite(quote.volumeMax) && order.volume > quote.volumeMax) {
    return invalid(`volume must be less than or equal to broker maximum ${quote.volumeMax}.`);
  }

  if (Number.isFinite(quote.volumeStep) && quote.volumeStep > 0 && !isVolumeStepAligned(order.volume, quote.volumeMin, quote.volumeStep)) {
    return invalid(`volume must respect broker volume step ${quote.volumeStep}.`);
  }

  return { ok: true, warnings };
}

function validateOrderResult(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object order result.');
  }

  if (payload.type !== 'ORDER_RESULT') {
    return invalid('order result type must be ORDER_RESULT.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return invalid('order result requestId must be a non-empty string.');
  }

  if (typeof payload.ok !== 'boolean') {
    return invalid('order result ok must be a boolean.');
  }

  if (!isNonEmptyString(payload.symbol)) return invalid('order result symbol must be a non-empty string.');
  if (payload.orderKind !== 'MARKET' && payload.orderKind !== 'LIMIT') return invalid('order result orderKind must be MARKET or LIMIT.');
  if (payload.side !== 'BUY' && payload.side !== 'SELL') return invalid('order result side must be BUY or SELL.');
  if (!isPositiveNumber(payload.volume)) return invalid('order result volume must be a positive number.');
  if (!isPositiveNumber(payload.entryPrice)) return invalid('order result entryPrice must be a positive number.');

  for (const field of ['sl', 'tp']) {
    if (payload[field] !== undefined && payload[field] !== null && !isPositiveNumber(payload[field])) {
      return invalid(`order result ${field} must be null or a positive number.`);
    }
  }

  if (!Number.isFinite(payload.retcode)) {
    return invalid('order result retcode must be a number.');
  }

  if (typeof payload.message !== 'string') {
    return invalid('order result message must be a string.');
  }

  if (payload.ok && !isNumberOrString(payload.ticket)) {
    return invalid('successful order result ticket must be a number or string.');
  }

  return { ok: true };
}

function handleTradeManagementRequest(req, res, config) {
  cleanupCommandState();

  if (!isTradeManagementEnabled()) {
    console.warn(`Rejected ${config.commandType}: ${TRADE_MANAGEMENT_DISABLED_ERROR}`);
    res.status(403).json({ ok: false, error: TRADE_MANAGEMENT_DISABLED_ERROR });
    return;
  }

  const validation = config.validate(req.body);
  if (!validation.ok) {
    console.warn(`Rejected ${config.commandType}: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  const command = {
    type: config.commandType,
    ...config.normalize(req.body),
    queuedAt: new Date().toISOString(),
    deliveredAt: null
  };

  if (pendingTradeManagementCommands.has(command.requestId) || tradeManagementResults.has(command.requestId)) {
    console.warn(`Rejected duplicate trade-management requestId: ${command.requestId}`);
    res.status(409).json({ ok: false, error: 'Duplicate trade-management requestId.' });
    return;
  }

  pendingTradeManagementCommands.set(command.requestId, command);
  tradeManagementResults.delete(command.requestId);

  console.log('Trade-management command queued');
  console.log(`  requestId: ${command.requestId}`);
  console.log(`  type: ${command.type}`);
  console.log(`  ticket/symbol: ${command.ticket} ${command.symbol}`);

  res.json({
    ok: true,
    requestId: command.requestId,
    status: 'queued',
    commandType: command.type,
    warnings: validation.warnings || []
  });
}

function validateClosePositionRequest(payload) {
  const common = validateTradeManagementCommon(payload);
  if (!common.ok) return common;

  if (payload.volume !== undefined && payload.volume !== null && !isPositiveNumber(payload.volume)) {
    return invalid('volume must be null or a positive number.');
  }

  const position = findLatestPosition(payload.ticket);
  if (Array.isArray(latestSnapshot?.positions) && !position) {
    return invalid('position ticket was not found in the latest MT5 snapshot.');
  }

  if (position && payload.volume !== undefined && payload.volume !== null) {
    if (payload.volume >= position.volume) {
      return invalid('partial close volume must be less than current position volume.');
    }

    const quote = getMatchingQuote(payload.symbol);
    const volumeValidation = validateVolumeAgainstQuote(payload.volume, quote, 'partial close volume');
    if (!volumeValidation.ok) return volumeValidation;

    if (quote?.volumeMin > 0) {
      const remainingVolume = position.volume - payload.volume;
      if (remainingVolume > 0 && remainingVolume < quote.volumeMin) {
        return invalid(`remaining position volume must be at least broker minimum ${quote.volumeMin}.`);
      }
    }
  }

  return { ok: true, warnings: [] };
}

function validateModifyPositionRequest(payload) {
  const common = validateTradeManagementCommon(payload);
  if (!common.ok) return common;

  const stops = validateNullableStops(payload);
  if (!stops.ok) return stops;

  if (payload.sl === undefined && payload.tp === undefined) {
    return invalid('at least one of sl or tp must be provided.');
  }

  const position = findLatestPosition(payload.ticket);
  if (Array.isArray(latestSnapshot?.positions) && !position) {
    return invalid('position ticket was not found in the latest MT5 snapshot.');
  }

  if (position) {
    return validatePositionStopsAgainstSnapshot(position, payload.sl ?? null, payload.tp ?? null);
  }

  return { ok: true, warnings: [] };
}

function validateBreakevenRequest(payload) {
  const common = validateTradeManagementCommon(payload);
  if (!common.ok) return common;

  if (payload.offsetPoints !== undefined && (!Number.isFinite(payload.offsetPoints) || payload.offsetPoints < 0)) {
    return invalid('offsetPoints must be a number greater than or equal to 0.');
  }

  const position = findLatestPosition(payload.ticket);
  if (Array.isArray(latestSnapshot?.positions) && !position) {
    return invalid('position ticket was not found in the latest MT5 snapshot.');
  }

  if (position) {
    const quote = getMatchingQuote(payload.symbol);
    if (quote?.point > 0) {
      const offsetPoints = payload.offsetPoints ?? 0;
      const proposedSl = position.type === 'SELL'
        ? position.openPrice - offsetPoints * quote.point
        : position.openPrice + offsetPoints * quote.point;

      return validatePositionStopsAgainstSnapshot(position, proposedSl, null);
    }
  }

  return { ok: true, warnings: [] };
}

function validateCancelOrderRequest(payload) {
  const common = validateTradeManagementCommon(payload);
  if (!common.ok) return common;

  const order = findLatestPendingOrder(payload.ticket);
  if (Array.isArray(latestSnapshot?.orders) && !order) {
    return invalid('pending order ticket was not found in the latest MT5 snapshot.');
  }

  return { ok: true, warnings: [] };
}

function validateModifyOrderRequest(payload) {
  const common = validateTradeManagementCommon(payload);
  if (!common.ok) return common;

  if (!isPositiveNumber(payload.entryPrice)) {
    return invalid('entryPrice must be a positive number.');
  }

  const stops = validateNullableStops(payload);
  if (!stops.ok) return stops;

  const order = findLatestPendingOrder(payload.ticket);
  if (Array.isArray(latestSnapshot?.orders) && !order) {
    return invalid('pending order ticket was not found in the latest MT5 snapshot.');
  }

  if (order) {
    return validatePendingOrderEditAgainstSnapshot(order, payload.entryPrice, payload.sl ?? null, payload.tp ?? null);
  }

  return { ok: true, warnings: [] };
}

function validateTradeManagementCommon(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object trade-management request.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return invalid('requestId must be a non-empty string.');
  }

  if (!isValidTicket(payload.ticket)) {
    return invalid('ticket must be a number or non-empty string.');
  }

  if (!isNonEmptyString(payload.symbol)) {
    return invalid('symbol must be a non-empty string.');
  }

  return { ok: true };
}

function validateNullableStops(payload) {
  for (const field of ['sl', 'tp']) {
    if (payload[field] !== undefined && payload[field] !== null && !isPositiveNumber(payload[field])) {
      return invalid(`${field} must be null or a positive number.`);
    }
  }

  return { ok: true };
}

function validatePositionStopsAgainstSnapshot(position, sl, tp) {
  const reference = Number.isFinite(position.currentPrice) && position.currentPrice > 0
    ? position.currentPrice
    : position.openPrice;

  if (!(reference > 0)) {
    return invalid('position current/open price is invalid.');
  }

  if (position.type === 'BUY') {
    if (sl !== null && sl >= reference) return invalid('For BUY positions, SL must be below current price.');
    if (tp !== null && tp <= reference) return invalid('For BUY positions, TP must be above current price.');
  } else if (position.type === 'SELL') {
    if (sl !== null && sl <= reference) return invalid('For SELL positions, SL must be above current price.');
    if (tp !== null && tp >= reference) return invalid('For SELL positions, TP must be below current price.');
  } else {
    return invalid('position type must be BUY or SELL.');
  }

  return { ok: true, warnings: [] };
}

function validatePendingOrderEditAgainstSnapshot(order, entryPrice, sl, tp) {
  const quote = getMatchingQuote(order.symbol);
  const type = String(order.type || '').toUpperCase();
  const isBuy = type.includes('BUY');
  const isSell = type.includes('SELL');

  if (quote && isBuy && entryPrice >= quote.ask) {
    return invalid('Buy Limit entry price must be below the current ask.');
  }

  if (quote && isSell && entryPrice <= quote.bid) {
    return invalid('Sell Limit entry price must be above the current bid.');
  }

  if (isBuy) {
    if (sl !== null && sl >= entryPrice) return invalid('For buy-side pending orders, SL must be below entry.');
    if (tp !== null && tp <= entryPrice) return invalid('For buy-side pending orders, TP must be above entry.');
  } else if (isSell) {
    if (sl !== null && sl <= entryPrice) return invalid('For sell-side pending orders, SL must be above entry.');
    if (tp !== null && tp >= entryPrice) return invalid('For sell-side pending orders, TP must be below entry.');
  } else {
    return invalid('pending order type must be buy-side or sell-side.');
  }

  return { ok: true, warnings: [] };
}

function validateVolumeAgainstQuote(volume, quote, label) {
  if (!quote) {
    return { ok: true };
  }

  if (Number.isFinite(quote.volumeMin) && volume < quote.volumeMin) {
    return invalid(`${label} must be greater than or equal to broker minimum ${quote.volumeMin}.`);
  }

  if (Number.isFinite(quote.volumeStep) && quote.volumeStep > 0 && !isVolumeStepAligned(volume, quote.volumeMin, quote.volumeStep)) {
    return invalid(`${label} must respect broker volume step ${quote.volumeStep}.`);
  }

  return { ok: true };
}

function validateTradeManagementResult(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Expected a JSON object trade-management result.');
  }

  if (payload.type !== 'TRADE_MANAGEMENT_RESULT') {
    return invalid('trade-management result type must be TRADE_MANAGEMENT_RESULT.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return invalid('trade-management result requestId must be a non-empty string.');
  }

  if (!TRADE_MANAGEMENT_COMMAND_TYPES.has(payload.commandType)) {
    return invalid('trade-management result commandType is not supported.');
  }

  if (typeof payload.ok !== 'boolean') {
    return invalid('trade-management result ok must be a boolean.');
  }

  if (!isValidTicket(payload.ticket)) {
    return invalid('trade-management result ticket must be a number or non-empty string.');
  }

  if (!isNonEmptyString(payload.symbol)) {
    return invalid('trade-management result symbol must be a non-empty string.');
  }

  if (!Number.isFinite(payload.retcode)) {
    return invalid('trade-management result retcode must be a number.');
  }

  if (typeof payload.message !== 'string') {
    return invalid('trade-management result message must be a string.');
  }

  return { ok: true };
}

function normalizeClosePositionRequest(payload) {
  return {
    requestId: payload.requestId.trim(),
    ticket: payload.ticket,
    symbol: payload.symbol.trim(),
    volume: payload.volume ?? null
  };
}

function normalizeModifyPositionRequest(payload) {
  return {
    requestId: payload.requestId.trim(),
    ticket: payload.ticket,
    symbol: payload.symbol.trim(),
    sl: payload.sl ?? null,
    tp: payload.tp ?? null
  };
}

function normalizeBreakevenRequest(payload) {
  return {
    requestId: payload.requestId.trim(),
    ticket: payload.ticket,
    symbol: payload.symbol.trim(),
    offsetPoints: payload.offsetPoints ?? 0
  };
}

function normalizeCancelOrderRequest(payload) {
  return {
    requestId: payload.requestId.trim(),
    ticket: payload.ticket,
    symbol: payload.symbol.trim()
  };
}

function normalizeModifyOrderRequest(payload) {
  return {
    requestId: payload.requestId.trim(),
    ticket: payload.ticket,
    symbol: payload.symbol.trim(),
    entryPrice: payload.entryPrice,
    sl: payload.sl ?? null,
    tp: payload.tp ?? null
  };
}

function normalizeOrderRequest(payload) {
  return {
    requestId: payload.requestId.trim(),
    symbol: payload.symbol.trim(),
    orderKind: payload.orderKind,
    side: payload.side,
    volume: payload.volume,
    entryPrice: payload.entryPrice,
    sl: payload.sl ?? null,
    tp: payload.tp ?? null,
    comment: payload.comment ?? '',
    magic: payload.magic ?? 0
  };
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

  if (Object.hasOwn(payload, 'orders')) {
    normalized.orders = normalizeOrders(payload.orders);
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

function normalizeOrders(orders) {
  if (!Array.isArray(orders)) {
    return orders;
  }

  return orders.map((order) => {
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      return order;
    }

    return {
      ...order,
      sl: order.sl ?? null,
      tp: order.tp ?? null
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

function validateOrders(orders) {
  if (orders === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(orders)) {
    return invalid('orders must be an array when present.');
  }

  for (let index = 0; index < orders.length; index += 1) {
    const validation = validatePendingOrder(orders[index], index);
    if (!validation.ok) {
      return validation;
    }
  }

  return { ok: true };
}

function validatePendingOrder(order, index) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return invalid(`orders[${index}] must be an object.`);
  }

  if (!isNumberOrString(order.ticket)) {
    return invalid(`orders[${index}].ticket must be a number or string.`);
  }

  if (typeof order.symbol !== 'string') {
    return invalid(`orders[${index}].symbol must be a string.`);
  }

  if (typeof order.type !== 'string') {
    return invalid(`orders[${index}].type must be a string.`);
  }

  for (const field of ['volumeInitial', 'volumeCurrent', 'openPrice', 'openTime', 'expirationTime']) {
    if (!Number.isFinite(order[field])) {
      return invalid(`orders[${index}].${field} must be a number.`);
    }
  }

  for (const field of ['sl', 'tp']) {
    if (order[field] !== null && !Number.isFinite(order[field])) {
      return invalid(`orders[${index}].${field} must be a number or null.`);
    }
  }

  if (!isNumberOrString(order.magic)) {
    return invalid(`orders[${index}].magic must be a number or string.`);
  }

  if (typeof order.comment !== 'string') {
    return invalid(`orders[${index}].comment must be a string.`);
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

function broadcastOrderResult(result) {
  let sent = 0;

  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      sendJson(socket, {
        type: 'ORDER_RESULT',
        payload: result
      });
      sent += 1;
    }
  }

  return sent;
}

function broadcastTradeManagementResult(result) {
  let sent = 0;

  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      sendJson(socket, {
        type: 'TRADE_MANAGEMENT_RESULT',
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

function toMt5OrderCommand(command) {
  return {
    type: command.type,
    requestId: command.requestId,
    symbol: command.symbol,
    orderKind: command.orderKind,
    side: command.side,
    volume: command.volume,
    entryPrice: command.entryPrice,
    sl: command.sl,
    tp: command.tp,
    comment: command.comment,
    magic: command.magic
  };
}

function toMt5TradeManagementCommand(command) {
  const base = {
    type: command.type,
    requestId: command.requestId,
    ticket: command.ticket,
    symbol: command.symbol
  };

  if (command.type === 'CLOSE_POSITION') {
    return {
      ...base,
      volume: command.volume
    };
  }

  if (command.type === 'MODIFY_POSITION') {
    return {
      ...base,
      sl: command.sl,
      tp: command.tp
    };
  }

  if (command.type === 'MOVE_TO_BREAKEVEN') {
    return {
      ...base,
      offsetPoints: command.offsetPoints
    };
  }

  if (command.type === 'MODIFY_ORDER') {
    return {
      ...base,
      entryPrice: command.entryPrice,
      sl: command.sl,
      tp: command.tp
    };
  }

  return base;
}

function cleanupCommandState() {
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

  for (const [requestId, command] of pendingOrderCommands.entries()) {
    if (ageMs(command.queuedAt, now) > ORDER_COMMAND_TTL_MS) {
      pendingOrderCommands.delete(requestId);
    }
  }

  for (const [requestId, result] of orderResults.entries()) {
    if (ageMs(result.receivedAt, now) > ORDER_RESULT_TTL_MS) {
      orderResults.delete(requestId);
    }
  }

  for (const [requestId, command] of pendingTradeManagementCommands.entries()) {
    if (ageMs(command.queuedAt, now) > TRADE_MANAGEMENT_COMMAND_TTL_MS) {
      pendingTradeManagementCommands.delete(requestId);
    }
  }

  for (const [requestId, result] of tradeManagementResults.entries()) {
    if (ageMs(result.receivedAt, now) > TRADE_MANAGEMENT_RESULT_TTL_MS) {
      tradeManagementResults.delete(requestId);
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

function isValidTicket(value) {
  return Number.isFinite(value) || isNonEmptyString(value);
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function isTradeManagementEnabled() {
  return String(process.env.ENABLE_TRADE_MANAGEMENT || '').toLowerCase() === 'true';
}

function findLatestPosition(ticket) {
  if (!Array.isArray(latestSnapshot?.positions)) {
    return null;
  }

  const target = String(ticket);
  return latestSnapshot.positions.find((position) => String(position.ticket) === target) || null;
}

function findLatestPendingOrder(ticket) {
  if (!Array.isArray(latestSnapshot?.orders)) {
    return null;
  }

  const target = String(ticket);
  return latestSnapshot.orders.find((order) => String(order.ticket) === target) || null;
}

function getMatchingQuote(symbol) {
  const quote = latestSnapshot?.quote;
  if (!quote || String(quote.symbol || '').toUpperCase() !== String(symbol || '').toUpperCase()) {
    return null;
  }

  return quote;
}

function getMarketPriceTolerance(quote) {
  if (Number.isFinite(quote.point) && quote.point > 0) {
    return quote.point * 10;
  }

  return Math.max(Math.abs(quote.ask || quote.bid || 1) * 0.0001, 0.00001);
}

function isVolumeStepAligned(volume, volumeMin, volumeStep) {
  const base = Number.isFinite(volumeMin) ? volumeMin : 0;
  const steps = (volume - base) / volumeStep;
  return Math.abs(steps - Math.round(steps)) < 1e-8;
}

function hasTradingMonitorData(snapshot) {
  return Boolean(snapshot?.account || snapshot?.quote || snapshot?.positions || snapshot?.orders);
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
  console.log('Order command queue enabled. MT5 Algo Trading controls final execution.');
  console.log(`Trade management command queue: ${isTradeManagementEnabled() ? 'enabled' : 'disabled'} (ENABLE_TRADE_MANAGEMENT=true to enable).`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}`);
});
