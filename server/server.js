import express from 'express';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = 3001;
const HOST = '127.0.0.1';
const HEARTBEAT_MS = 30000;
const INDICATOR_FIELDS = ['smaFast', 'smaMid', 'smaSlow', 'atr', 'adx', 'diPlus', 'diMinus'];

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let latestSnapshot = null;
let lastUpdate = null;

app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasSnapshot: Boolean(latestSnapshot),
    clients: getConnectedClientCount(),
    lastUpdate
  });
});

app.post('/mt5/update', (req, res) => {
  const validation = validateSnapshot(req.body);
  if (!validation.ok) {
    console.warn(`Rejected MT5 update: ${validation.error}`);
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }

  latestSnapshot = req.body;
  lastUpdate = new Date().toISOString();

  const broadcastCount = broadcastSnapshot(latestSnapshot);

  console.log('MT5 update received');
  console.log(`  symbol/timeframe: ${latestSnapshot.symbol} ${latestSnapshot.timeframe}`);
  console.log(`  candles: ${latestSnapshot.candles.length}`);
  console.log(`  last closed candle time: ${latestSnapshot.lastClosedTime ?? 'not provided'}`);
  console.log(`  broadcast clients: ${broadcastCount}`);

  res.json({ ok: true, clients: getConnectedClientCount(), broadcastCount });
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

function sendJson(socket, message) {
  socket.send(JSON.stringify(message));
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

function invalid(error) {
  return { ok: false, error };
}

server.listen(PORT, HOST, () => {
  console.log(`MT5 dashboard bridge started at http://${HOST}:${PORT}`);
  console.log(`MT5 endpoint: POST http://${HOST}:${PORT}/mt5/update`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}`);
});
