export default function StatusBar({
  connectionState,
  backendStatus,
  symbol,
  timeframe,
  candleCount,
  lastClosedTime,
  backendUpdateTime
}) {
  return (
    <header className="status-bar">
      <div className="status-item">
        <span className={`connection-dot ${connectionState}`} aria-hidden="true" />
        <span className="status-value">{formatConnection(connectionState)}</span>
      </div>
      <div className="status-item">
        <span>Symbol</span>
        <span className="status-value">{symbol}</span>
      </div>
      <div className="status-item">
        <span>Timeframe</span>
        <span className="status-value">{timeframe}</span>
      </div>
      <div className="status-item">
        <span>Candles</span>
        <span className="status-value">{candleCount}</span>
      </div>
      <div className="status-item">
        <span>Last closed</span>
        <span className="status-value">{formatUnixTime(lastClosedTime)}</span>
      </div>
      <div className="status-item">
        <span>Backend</span>
        <span className="status-value">{backendStatus}</span>
      </div>
      <div className="status-item">
        <span>Updated</span>
        <span className="status-value">{formatDateTime(backendUpdateTime)}</span>
      </div>
    </header>
  );
}

function formatConnection(state) {
  if (state === 'connected') {
    return 'Connected';
  }

  if (state === 'connecting') {
    return 'Connecting';
  }

  if (state === 'error') {
    return 'Connection error';
  }

  return 'Disconnected';
}

function formatDateTime(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatUnixTime(value) {
  if (!Number.isFinite(Number(value))) {
    return '--';
  }

  return formatDateTime(Number(value) * 1000);
}
