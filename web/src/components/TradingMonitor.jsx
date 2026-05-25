const FILTERS = {
  current: 'Current symbol only',
  all: 'All symbols'
};

export default function TradingMonitor({ snapshot, filter, onFilterChange }) {
  const account = snapshot?.account || null;
  const quote = snapshot?.quote || null;
  const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
  const hasSnapshot = Boolean(snapshot);
  const activeFilter = filter === 'all' ? 'all' : 'current';
  const currentSymbol = String(snapshot?.symbol || quote?.symbol || '').trim();
  const displayedPositions = activeFilter === 'current' && currentSymbol
    ? positions.filter((position) => String(position?.symbol || '').toUpperCase() === currentSymbol.toUpperCase())
    : positions;
  const emptyText = activeFilter === 'current'
    ? 'No open positions for current symbol'
    : 'No open positions';
  const currency = account?.currency || '';
  const digits = Number.isInteger(quote?.digits) ? quote.digits : 5;

  return (
    <section className="trading-monitor" aria-label="Trading Monitor">
      <div className="monitor-header">
        <div>
          <h2>Trading Monitor</h2>
          <p>Read-only account and position data</p>
        </div>
      </div>

      <MonitorBlock title="Account">
        {account ? (
          <>
            <MetricGrid
              items={[
                ['Balance', formatMoney(account.balance, currency)],
                ['Equity', formatMoney(account.equity, currency)],
                ['Floating profit', <PnLValue key="profit" value={account.profit} currency={currency} />],
                ['Margin', formatMoney(account.margin, currency)],
                ['Free margin', formatMoney(account.freeMargin, currency)],
                ['Margin level', formatPercent(account.marginLevel)],
                ['Currency', account.currency || '--'],
                ['Leverage', formatLeverage(account.leverage)]
              ]}
            />
            <dl className="monitor-details">
              <dt>Server</dt>
              <dd>{account.server || '--'}</dd>
              <dt>Login</dt>
              <dd>{formatText(account.login)}</dd>
            </dl>
          </>
        ) : (
          <p className="monitor-empty">Waiting for account data...</p>
        )}
      </MonitorBlock>

      <MonitorBlock title="Quote">
        {quote ? (
          <MetricGrid
            items={[
              ['Symbol', quote.symbol || '--'],
              ['Bid', formatPrice(quote.bid, digits)],
              ['Ask', formatPrice(quote.ask, digits)],
              ['Spread points', formatNumber(quote.spreadPoints, 0)],
              ['Digits', formatNumber(quote.digits, 0)]
            ]}
          />
        ) : (
          <p className="monitor-empty">Waiting for quote data...</p>
        )}
      </MonitorBlock>

      <MonitorBlock
        title="Positions"
        action={(
          <div className="monitor-toggle" aria-label="Position filter">
            {Object.entries(FILTERS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={activeFilter === key ? 'is-active' : ''}
                onClick={() => onFilterChange(key)}
                aria-pressed={activeFilter === key}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      >
        {!hasSnapshot ? (
          <p className="monitor-empty">Waiting for MT5 data...</p>
        ) : displayedPositions.length ? (
          <div className="positions-table-wrap">
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Volume</th>
                  <th>Open</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Current</th>
                  <th>PnL</th>
                  <th>Swap</th>
                  <th>Commission</th>
                  <th>Open time</th>
                </tr>
              </thead>
              <tbody>
                {displayedPositions.map((position) => (
                  <tr key={`${position.ticket}-${position.symbol}-${position.openTime}`}>
                    <td>{formatText(position.ticket)}</td>
                    <td>{position.symbol || '--'}</td>
                    <td>
                      <span className={`position-type ${position.type === 'SELL' ? 'sell' : 'buy'}`}>
                        {position.type || '--'}
                      </span>
                    </td>
                    <td>{formatVolume(position.volume)}</td>
                    <td>{formatPrice(position.openPrice, digitsForPosition(position, quote, digits))}</td>
                    <td>{formatNullablePrice(position.sl, digitsForPosition(position, quote, digits))}</td>
                    <td>{formatNullablePrice(position.tp, digitsForPosition(position, quote, digits))}</td>
                    <td>{formatPrice(position.currentPrice, digitsForPosition(position, quote, digits))}</td>
                    <td><PnLValue value={position.profit} currency={currency} /></td>
                    <td>{formatMoney(position.swap, currency)}</td>
                    <td>{formatMoney(position.commission, currency)}</td>
                    <td>{formatTime(position.openTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="monitor-empty">{emptyText}</p>
        )}
      </MonitorBlock>
    </section>
  );
}

function MonitorBlock({ title, action, children }) {
  return (
    <section className="monitor-block">
      <div className="monitor-block-header">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricGrid({ items }) {
  return (
    <dl className="metric-grid">
      {items.map(([label, value]) => (
        <div key={label} className="metric-item">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PnLValue({ value, currency }) {
  const numeric = Number(value);
  const className = [
    'pnl-value',
    numeric > 0 ? 'positive' : '',
    numeric < 0 ? 'negative' : ''
  ].filter(Boolean).join(' ');

  return <span className={className}>{formatMoney(value, currency)}</span>;
}

function formatMoney(value, currency) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '--';
  }

  const suffix = currency ? ` ${currency}` : '';
  return `${numeric.toFixed(2)}${suffix}`;
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : '--';
}

function formatLeverage(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `1:${Math.trunc(numeric)}` : '--';
}

function formatPrice(value, digits) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(clampDigits(digits)) : '--';
}

function formatNullablePrice(value, digits) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return '--';
  }

  return numeric.toFixed(clampDigits(digits));
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '--';
}

function formatVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '--';
  }

  return Number.parseFloat(numeric.toFixed(8)).toString();
}

function formatText(value) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return String(value);
}

function formatTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '--';
  }

  return new Date(numeric * 1000).toLocaleString();
}

function digitsForPosition(position, quote, fallbackDigits) {
  if (position?.symbol && quote?.symbol && position.symbol !== quote.symbol) {
    return 5;
  }

  return fallbackDigits;
}

function clampDigits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }

  return Math.min(8, Math.max(0, Math.trunc(numeric)));
}
