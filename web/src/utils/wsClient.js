const RECONNECT_DELAY_MS = 1500;

export function createDashboardSocket({ url, onOpen, onClose, onError, onReconnect, onSnapshot, onRiskResult }) {
  let socket = null;
  let closedByClient = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;

  function connect() {
    onReconnect?.(reconnectAttempts);
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      reconnectAttempts = 0;
      onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      const message = parseMessage(event.data);

      if (message?.type === 'snapshot') {
        onSnapshot?.(message.payload);
      }

      if (message?.type === 'riskResult') {
        onRiskResult?.(message.payload);
      }

      if (message?.type === 'RISK_LOT_RESULT') {
        onRiskResult?.(message);
      }
    });

    socket.addEventListener('error', () => {
      onError?.();
    });

    socket.addEventListener('close', () => {
      onClose?.();

      if (!closedByClient) {
        reconnectAttempts += 1;
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  connect();

  return {
    close() {
      closedByClient = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    }
  };
}

function parseMessage(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
