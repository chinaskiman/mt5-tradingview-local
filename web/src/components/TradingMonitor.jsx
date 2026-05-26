import { useEffect, useState } from 'react';

const FILTERS = {
  current: 'Current symbol only',
  all: 'All symbols'
};

const TRADING_MODE_KEY = 'mt5-dashboard-trading-mode-enabled';

export default function TradingMonitor({ snapshot, filter, onFilterChange, tradeManagement, onSendTradeManagement }) {
  const account = snapshot?.account || null;
  const quote = snapshot?.quote || null;
  const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
  const orders = Array.isArray(snapshot?.orders) ? snapshot.orders : [];
  const [tradingModeEnabled, setTradingModeEnabled] = useState(() => window.sessionStorage.getItem(TRADING_MODE_KEY) === 'true');
  const [activeAction, setActiveAction] = useState(null);
  const [draft, setDraft] = useState({});
  const hasSnapshot = Boolean(snapshot);
  const activeFilter = filter === 'all' ? 'all' : 'current';
  const currentSymbol = String(snapshot?.symbol || quote?.symbol || '').trim();
  const displayedPositions = activeFilter === 'current' && currentSymbol
    ? positions.filter((position) => String(position?.symbol || '').toUpperCase() === currentSymbol.toUpperCase())
    : positions;
  const displayedOrders = activeFilter === 'current' && currentSymbol
    ? orders.filter((order) => String(order?.symbol || '').toUpperCase() === currentSymbol.toUpperCase())
    : orders;
  const positionsEmptyText = activeFilter === 'current'
    ? 'No open positions for current symbol'
    : 'No open positions';
  const ordersEmptyText = activeFilter === 'current'
    ? 'No pending orders for current symbol'
    : 'No pending orders';
  const currency = account?.currency || '';
  const digits = Number.isInteger(quote?.digits) ? quote.digits : 5;

  useEffect(() => {
    window.sessionStorage.setItem(TRADING_MODE_KEY, tradingModeEnabled ? 'true' : 'false');
  }, [tradingModeEnabled]);

  function openAction(kind, item) {
    setActiveAction({ kind, item });
    setDraft(createDraft(kind, item));
  }

  function closeAction() {
    setActiveAction(null);
    setDraft({});
  }

  function updateDraft(key, value) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  return (
    <section className="trading-monitor" aria-label="Trading Monitor">
      <div className="monitor-header">
        <div>
          <h2>Trading Monitor</h2>
          <p>Account, position, pending order, and management controls</p>
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

      <MonitorBlock title="Trade Management">
        <div className="trade-management-safety">
          <label className="trading-mode-toggle compact">
            <input
              type="checkbox"
              checked={tradingModeEnabled}
              onChange={(event) => setTradingModeEnabled(event.target.checked)}
            />
            <span>Trading Mode {tradingModeEnabled ? 'ON' : 'OFF'}</span>
          </label>
          <p>
            {tradingModeEnabled
              ? 'Actions can be reviewed and sent after confirmation when backend and EA management gates are enabled.'
              : 'Trading Mode is OFF. Actions can be previewed, but final confirm is disabled.'}
          </p>
        </div>
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
                  <th>Actions</th>
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
                    <td>
                      <ActionMenu
                        options={[
                          { value: 'position-close', label: 'Close', danger: true },
                          { value: 'position-partial-close', label: 'Partial Close' },
                          { value: 'position-modify', label: 'Modify SL/TP' },
                          { value: 'position-breakeven', label: 'Breakeven' }
                        ]}
                        onSelect={(kind) => openAction(kind, position)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="monitor-empty">{positionsEmptyText}</p>
        )}
      </MonitorBlock>

      <MonitorBlock title="Pending Orders">
        {!hasSnapshot ? (
          <p className="monitor-empty">Waiting for MT5 data...</p>
        ) : displayedOrders.length ? (
          <div className="positions-table-wrap">
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Volume</th>
                  <th>Entry price</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Open time</th>
                  <th>Expiration</th>
                  <th>Magic</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedOrders.map((order) => (
                  <tr key={`${order.ticket}-${order.symbol}-${order.openTime}`}>
                    <td>{formatText(order.ticket)}</td>
                    <td>{order.symbol || '--'}</td>
                    <td>
                      <span className={`position-type ${String(order.type || '').includes('SELL') ? 'sell' : 'buy'}`}>
                        {formatOrderType(order.type)}
                      </span>
                    </td>
                    <td>{formatVolume(order.volumeCurrent)}</td>
                    <td>{formatPrice(order.openPrice, digitsForPosition(order, quote, digits))}</td>
                    <td>{formatNullablePrice(order.sl, digitsForPosition(order, quote, digits))}</td>
                    <td>{formatNullablePrice(order.tp, digitsForPosition(order, quote, digits))}</td>
                    <td>{formatTime(order.openTime)}</td>
                    <td>{formatExpiration(order.expirationTime)}</td>
                    <td>{formatText(order.magic)}</td>
                    <td>
                      <ActionMenu
                        options={[
                          { value: 'order-cancel', label: 'Cancel', danger: true },
                          { value: 'order-modify', label: 'Modify Order' }
                        ]}
                        onSelect={(kind) => openAction(kind, order)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="monitor-empty">{ordersEmptyText}</p>
        )}
      </MonitorBlock>

      {activeAction ? (
        <TradeManagementModal
          action={activeAction}
          draft={draft}
          snapshot={snapshot}
          quote={quote}
          account={account}
          tradingModeEnabled={tradingModeEnabled}
          tradeManagement={tradeManagement}
          onDraftChange={updateDraft}
          onConfirm={onSendTradeManagement}
          onClose={closeAction}
        />
      ) : null}
    </section>
  );
}

function ActionMenu({ options, onSelect }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="trade-action-menu">
      <button
        type="button"
        className="trade-action-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Actions
        <span aria-hidden="true">v</span>
      </button>
      {open ? (
        <div className="trade-action-popover" role="menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              className={option.danger ? 'is-danger' : ''}
              onClick={() => {
                setOpen(false);
                onSelect(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TradeManagementModal({
  action,
  draft,
  snapshot,
  quote,
  account,
  tradingModeEnabled,
  tradeManagement,
  onDraftChange,
  onConfirm,
  onClose
}) {
  const item = action?.item;
  const quoteMatches = symbolsMatch(item?.symbol, quote?.symbol);
  const digits = quoteMatches ? clampDigits(quote?.digits) : 5;
  const currency = account?.currency || '';
  const validation = validateTradeAction({ action, draft, quote, quoteMatches });
  const title = actionTitle(action.kind);
  const contextKey = tradeActionContextKey(action);
  const matchingRequest = tradeManagement?.contextKey === contextKey ? tradeManagement : null;
  const hasOtherPendingRequest = isPendingStatus(tradeManagement?.status) && tradeManagement?.contextKey !== contextKey;
  const isPending = isPendingStatus(matchingRequest?.status);
  const alreadySucceeded = matchingRequest?.status === 'success';
  const canConfirm = Boolean(onConfirm) && tradingModeEnabled && validation.errors.length === 0 && !isPending && !hasOtherPendingRequest && !alreadySucceeded;
  const sendLabel = actionSendLabel(action.kind, matchingRequest?.status);

  function handleConfirm() {
    if (!canConfirm || !onConfirm) {
      return;
    }

    onConfirm(buildTradeManagementRequest(action, draft, contextKey));
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-modal trade-management-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="confirmation-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close confirmation">x</button>
        </div>

        <dl className="risk-output-grid confirmation-grid">
          {summaryItems(action, draft, quote, quoteMatches, digits, currency).map(([label, value]) => (
            <Info key={label} label={label} value={value} />
          ))}
        </dl>

        {action.kind === 'position-partial-close' ? (
          <TradeField label="Partial close volume">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step={quoteMatches && quote?.volumeStep > 0 ? String(quote.volumeStep) : '0.01'}
              value={draft.partialVolume || ''}
              onChange={(event) => onDraftChange('partialVolume', event.target.value)}
            />
          </TradeField>
        ) : null}

        {action.kind === 'position-modify' ? (
          <div className="trade-modal-grid">
            <TradeField label="New SL">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={quoteMatches && quote?.point > 0 ? String(quote.point) : '0.00001'}
                value={draft.newSl || ''}
                onChange={(event) => onDraftChange('newSl', event.target.value)}
              />
            </TradeField>
            <TradeField label="New TP">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={quoteMatches && quote?.point > 0 ? String(quote.point) : '0.00001'}
                value={draft.newTp || ''}
                onChange={(event) => onDraftChange('newTp', event.target.value)}
              />
            </TradeField>
          </div>
        ) : null}

        {action.kind === 'position-breakeven' ? (
          <TradeField label="Offset points">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={draft.offsetPoints ?? '0'}
              onChange={(event) => onDraftChange('offsetPoints', event.target.value)}
            />
          </TradeField>
        ) : null}

        {action.kind === 'order-modify' ? (
          <div className="trade-modal-grid">
            <TradeField label="New entry price">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={quoteMatches && quote?.point > 0 ? String(quote.point) : '0.00001'}
                value={draft.newEntry || ''}
                onChange={(event) => onDraftChange('newEntry', event.target.value)}
              />
            </TradeField>
            <TradeField label="New SL">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={quoteMatches && quote?.point > 0 ? String(quote.point) : '0.00001'}
                value={draft.newSl || ''}
                onChange={(event) => onDraftChange('newSl', event.target.value)}
              />
            </TradeField>
            <TradeField label="New TP">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={quoteMatches && quote?.point > 0 ? String(quote.point) : '0.00001'}
                value={draft.newTp || ''}
                onChange={(event) => onDraftChange('newTp', event.target.value)}
              />
            </TradeField>
          </div>
        ) : null}

        {!tradingModeEnabled ? (
          <p className="risk-verification error">Trading Mode is OFF.</p>
        ) : null}

        <ValidationSummary validation={validation} />

        {hasOtherPendingRequest ? (
          <p className="risk-verification stale">Another trade-management request is already pending. Wait for its MT5 result before sending a new action.</p>
        ) : null}

        <TradeManagementStatus request={matchingRequest} />

        <div className="confirmation-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="risk-verify-button"
            disabled={!canConfirm}
            title={sendLabel}
            onClick={handleConfirm}
          >
            {sendLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function TradeField({ label, children }) {
  return (
    <label className="risk-field trade-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TradeManagementStatus({ request }) {
  if (!request || request.status === 'idle') {
    return null;
  }

  const isDisabledBackend = request.error === 'Trade management commands are disabled on the backend.';
  const isDisabledEa = request.error === 'Trade management disabled in EA inputs.'
    || request.result?.message === 'Trade management disabled in EA inputs.';
  const result = request.result;

  if (request.status === 'sending') {
    return <p className="risk-verification">Sending trade-management request to backend...</p>;
  }

  if (request.status === 'queued') {
    return <p className="risk-verification">Queued. Waiting for MT5 command polling...</p>;
  }

  if (request.status === 'waiting') {
    return <p className="risk-verification">Waiting for MT5 trade-management result...</p>;
  }

  return (
    <div className={`risk-verification ${request.status === 'success' ? 'ok' : 'error'}`}>
      <p>
        {request.status === 'success'
          ? 'Action succeeded. Waiting for next MT5 snapshot to refresh positions/orders.'
          : request.error || 'Trade-management action failed.'}
      </p>
      {isDisabledBackend ? (
        <p>Enable backend <code>ENABLE_TRADE_MANAGEMENT=true</code> and EA input <code>EnableTradeManagement=true</code>.</p>
      ) : null}
      {isDisabledEa ? (
        <p>EA trade management is disabled. Set EA input <code>EnableTradeManagement=true</code> and make sure MT5 Algo Trading is enabled.</p>
      ) : null}
      {result ? (
        <dl className="risk-output-grid confirmation-grid">
          <Info label="Command" value={formatText(result.commandType || request.commandType)} />
          <Info label="Ticket" value={formatText(result.ticket)} />
          <Info label="Symbol" value={formatText(result.symbol)} />
          <Info label="Retcode" value={formatText(result.retcode)} />
          <Info label="Message" value={formatText(result.message || result.error)} />
        </dl>
      ) : null}
    </div>
  );
}

function ValidationSummary({ validation }) {
  if (!validation.errors.length && !validation.warnings.length) {
    return <p className="order-validation is-ok">Validation passed. Confirm only after checking the action summary.</p>;
  }

  return (
    <details className={`order-validation ${validation.errors.length ? 'has-errors' : 'has-warnings'}`} open>
      <summary>
        <span>{validation.errors.length ? 'Validation issues' : 'Warnings'}</span>
        <strong>{validation.errors[0] || validation.warnings[0]}</strong>
      </summary>
      <ul>
        {[...validation.errors.slice(1), ...validation.warnings.slice(validation.errors.length ? 0 : 1)].map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </details>
  );
}

function buildTradeManagementRequest(action, draft, contextKey) {
  const item = action.item;
  const ticket = item?.ticket;
  const symbol = item?.symbol;

  if (action.kind === 'position-close') {
    return {
      endpoint: '/positions/close',
      commandType: 'CLOSE_POSITION',
      contextKey,
      body: { ticket, symbol, volume: null }
    };
  }

  if (action.kind === 'position-partial-close') {
    return {
      endpoint: '/positions/close',
      commandType: 'CLOSE_POSITION',
      contextKey,
      body: { ticket, symbol, volume: parseOptionalNumber(draft.partialVolume) }
    };
  }

  if (action.kind === 'position-modify') {
    return {
      endpoint: '/positions/modify',
      commandType: 'MODIFY_POSITION',
      contextKey,
      body: {
        ticket,
        symbol,
        sl: parseOptionalNumber(draft.newSl),
        tp: parseOptionalNumber(draft.newTp)
      }
    };
  }

  if (action.kind === 'position-breakeven') {
    return {
      endpoint: '/positions/breakeven',
      commandType: 'MOVE_TO_BREAKEVEN',
      contextKey,
      body: {
        ticket,
        symbol,
        offsetPoints: parseOptionalNumber(draft.offsetPoints) ?? 0
      }
    };
  }

  if (action.kind === 'order-cancel') {
    return {
      endpoint: '/orders/cancel',
      commandType: 'CANCEL_ORDER',
      contextKey,
      body: { ticket, symbol }
    };
  }

  return {
    endpoint: '/orders/modify',
    commandType: 'MODIFY_ORDER',
    contextKey,
    body: {
      ticket,
      symbol,
      entryPrice: parseOptionalNumber(draft.newEntry),
      sl: parseOptionalNumber(draft.newSl),
      tp: parseOptionalNumber(draft.newTp)
    }
  };
}

function tradeActionContextKey(action) {
  return `${action.kind}:${formatText(action.item?.ticket)}`;
}

function isPendingStatus(status) {
  return ['sending', 'queued', 'waiting'].includes(status);
}

function actionSendLabel(kind, status) {
  if (status === 'sending') return 'Sending...';
  if (status === 'queued') return 'Queued';
  if (status === 'waiting') return 'Waiting for MT5';
  if (status === 'success') return 'Action Sent';

  const labels = {
    'position-close': 'Confirm Close',
    'position-partial-close': 'Confirm Partial Close',
    'position-modify': 'Confirm Modify SL/TP',
    'position-breakeven': 'Confirm Breakeven',
    'order-cancel': 'Confirm Cancel',
    'order-modify': 'Confirm Modify Order'
  };

  return labels[kind] || 'Confirm Action';
}

function Info({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

function createDraft(kind, item) {
  if (kind === 'position-partial-close') {
    return { partialVolume: '' };
  }

  if (kind === 'position-modify') {
    return {
      newSl: valueOrEmpty(item.sl),
      newTp: valueOrEmpty(item.tp)
    };
  }

  if (kind === 'position-breakeven') {
    return { offsetPoints: '0' };
  }

  if (kind === 'order-modify') {
    return {
      newEntry: valueOrEmpty(item.openPrice),
      newSl: valueOrEmpty(item.sl),
      newTp: valueOrEmpty(item.tp)
    };
  }

  return {};
}

function actionTitle(kind) {
  const titles = {
    'position-close': 'Close Position',
    'position-partial-close': 'Partial Close Position',
    'position-modify': 'Modify SL/TP',
    'position-breakeven': 'Move SL to Breakeven',
    'order-cancel': 'Cancel Pending Order',
    'order-modify': 'Modify Pending Order'
  };

  return titles[kind] || 'Trade Management';
}

function summaryItems(action, draft, quote, quoteMatches, digits, currency) {
  const item = action.item;
  const point = quoteMatches ? Number(quote?.point) : null;

  if (action.kind === 'position-close') {
    return [
      ['Ticket', formatText(item.ticket)],
      ['Symbol', item.symbol || '--'],
      ['Type', item.type || '--'],
      ['Current volume', formatVolume(item.volume)],
      ['Floating PnL', <PnLValue key="pnl" value={item.profit} currency={currency} />],
      ['Action', 'Close full position']
    ];
  }

  if (action.kind === 'position-partial-close') {
    const partialVolume = parseOptionalNumber(draft.partialVolume);
    const remainingVolume = partialVolume !== null ? Number(item.volume) - Number(partialVolume) : null;

    return [
      ['Ticket', formatText(item.ticket)],
      ['Symbol', item.symbol || '--'],
      ['Type', item.type || '--'],
      ['Current volume', formatVolume(item.volume)],
      ['Close volume', formatVolume(partialVolume)],
      ['Remaining volume', Number.isFinite(remainingVolume) ? formatVolume(remainingVolume) : '--'],
      ['Floating PnL', <PnLValue key="pnl" value={item.profit} currency={currency} />],
      ['Action', 'Partial close']
    ];
  }

  if (action.kind === 'position-modify') {
    const newSl = parseOptionalNumber(draft.newSl);
    const newTp = parseOptionalNumber(draft.newTp);

    return [
      ['Ticket', formatText(item.ticket)],
      ['Symbol', item.symbol || '--'],
      ['Type', item.type || '--'],
      ['Open price', formatPrice(item.openPrice, digits)],
      ['Current price', formatPrice(item.currentPrice, digits)],
      ['Current SL', formatNullablePrice(item.sl, digits)],
      ['New SL', formatOptionalTradePrice(newSl, digits)],
      ['Current TP', formatNullablePrice(item.tp, digits)],
      ['New TP', formatOptionalTradePrice(newTp, digits)]
    ];
  }

  if (action.kind === 'position-breakeven') {
    return [
      ['Ticket', formatText(item.ticket)],
      ['Symbol', item.symbol || '--'],
      ['Type', item.type || '--'],
      ['Open price', formatPrice(item.openPrice, digits)],
      ['Current SL', formatNullablePrice(item.sl, digits)],
      ['Proposed SL', formatOptionalTradePrice(breakevenStop(item, draft, point), digits)]
    ];
  }

  if (action.kind === 'order-cancel') {
    return [
      ['Ticket', formatText(item.ticket)],
      ['Symbol', item.symbol || '--'],
      ['Type', formatOrderType(item.type)],
      ['Volume', formatVolume(item.volumeCurrent)],
      ['Entry price', formatPrice(item.openPrice, digits)],
      ['SL', formatNullablePrice(item.sl, digits)],
      ['TP', formatNullablePrice(item.tp, digits)],
      ['Action', 'Confirm cancel']
    ];
  }

  const newEntry = parseOptionalNumber(draft.newEntry);
  const newSl = parseOptionalNumber(draft.newSl);
  const newTp = parseOptionalNumber(draft.newTp);

  return [
    ['Ticket', formatText(item.ticket)],
    ['Symbol', item.symbol || '--'],
    ['Type', formatOrderType(item.type)],
    ['Volume', formatVolume(item.volumeCurrent)],
    ['Current entry', formatPrice(item.openPrice, digits)],
    ['New entry', formatOptionalTradePrice(newEntry, digits)],
    ['Current SL', formatNullablePrice(item.sl, digits)],
    ['New SL', formatOptionalTradePrice(newSl, digits)],
    ['Current TP', formatNullablePrice(item.tp, digits)],
    ['New TP', formatOptionalTradePrice(newTp, digits)]
  ];
}

function validateTradeAction({ action, draft, quote, quoteMatches }) {
  const errors = [];
  const warnings = [];
  const item = action?.item;
  const digits = quoteMatches ? clampDigits(quote?.digits) : 5;

  if (!action || !item) {
    return { errors: ['Missing trade action context.'], warnings };
  }

  if (!hasValue(item.ticket)) {
    errors.push('Ticket is required.');
  }

  if (!hasValue(item.symbol)) {
    errors.push('Symbol is required.');
  }

  if (!quoteMatches) {
    warnings.push('Current chart quote is unavailable for this symbol; broker-side price validation will be required later.');
  }

  if (action.kind === 'position-partial-close') {
    validatePartialClose({ position: item, volume: parseOptionalNumber(draft.partialVolume), quote, quoteMatches, errors, warnings });
  }

  if (action.kind === 'position-modify') {
    const sl = parseOptionalNumber(draft.newSl);
    const tp = parseOptionalNumber(draft.newTp);

    if (sl === null && tp === null) {
      errors.push('At least one of SL or TP is required.');
    }

    validatePositionStops({ position: item, sl, tp, errors });
  }

  if (action.kind === 'position-breakeven') {
    const offset = parseOptionalNumber(draft.offsetPoints);
    const proposedSl = breakevenStop(item, draft, quoteMatches ? Number(quote?.point) : null);

    if (!(offset >= 0)) {
      errors.push('Offset points must be 0 or greater.');
    }

    if (!Number.isFinite(proposedSl)) {
      errors.push('Cannot calculate breakeven SL without a valid point size.');
    } else {
      validatePositionStops({ position: item, sl: Number(proposedSl.toFixed(digits)), tp: null, errors });
    }
  }

  if (action.kind === 'order-modify') {
    validatePendingOrderEdit({
      order: item,
      entry: parseOptionalNumber(draft.newEntry),
      sl: parseOptionalNumber(draft.newSl),
      tp: parseOptionalNumber(draft.newTp),
      quote,
      quoteMatches,
      errors
    });
  }

  return { errors, warnings };
}

function validatePartialClose({ position, volume, quote, quoteMatches, errors, warnings }) {
  const currentVolume = Number(position.volume);

  if (!(volume > 0)) {
    errors.push('Partial close volume must be greater than 0.');
    return;
  }

  if (!(currentVolume > 0)) {
    errors.push('Current position volume is invalid.');
    return;
  }

  if (volume >= currentVolume) {
    errors.push('Partial close volume must be less than current position volume.');
  }

  if (!quoteMatches) {
    return;
  }

  const volumeStep = Number(quote?.volumeStep);
  const volumeMin = Number(quote?.volumeMin);
  const remaining = currentVolume - volume;

  if (volumeStep > 0 && !isAlignedToStep(volume, volumeStep)) {
    errors.push(`Partial close volume must respect broker step ${formatVolume(volumeStep)}.`);
  }

  if (volumeMin > 0 && remaining > 0 && remaining < volumeMin) {
    errors.push(`Remaining position volume must be at least broker minimum ${formatVolume(volumeMin)}.`);
  }

  if (!(volumeStep > 0)) {
    warnings.push('Broker volume step is unavailable; final validation will be required later.');
  }
}

function validatePositionStops({ position, sl, tp, errors }) {
  const type = String(position.type || '').toUpperCase();
  const reference = Number(position.currentPrice) > 0 ? Number(position.currentPrice) : Number(position.openPrice);

  if (!(reference > 0)) {
    errors.push('Current/open price is invalid.');
    return;
  }

  if (sl !== null && sl <= 0) {
    errors.push('New SL must be greater than 0 or left blank.');
  }

  if (tp !== null && tp <= 0) {
    errors.push('New TP must be greater than 0 or left blank.');
  }

  if (type === 'BUY') {
    if (sl > 0 && sl >= reference) errors.push('For BUY positions, SL must be below current price.');
    if (tp > 0 && tp <= reference) errors.push('For BUY positions, TP must be above current price.');
  } else if (type === 'SELL') {
    if (sl > 0 && sl <= reference) errors.push('For SELL positions, SL must be above current price.');
    if (tp > 0 && tp >= reference) errors.push('For SELL positions, TP must be below current price.');
  } else {
    errors.push('Position type must be BUY or SELL.');
  }
}

function validatePendingOrderEdit({ order, entry, sl, tp, quote, quoteMatches, errors }) {
  const isBuy = isBuyOrderType(order.type);
  const isSell = isSellOrderType(order.type);

  if (!(entry > 0)) {
    errors.push('Entry price must be greater than 0.');
    return;
  }

  if (quoteMatches && isBuy && Number(quote?.ask) > 0 && entry >= Number(quote.ask)) {
    errors.push('Buy Limit entry must stay below current ask.');
  }

  if (quoteMatches && isSell && Number(quote?.bid) > 0 && entry <= Number(quote.bid)) {
    errors.push('Sell Limit entry must stay above current bid.');
  }

  if (sl !== null && sl <= 0) {
    errors.push('New SL must be greater than 0 or left blank.');
  }

  if (tp !== null && tp <= 0) {
    errors.push('New TP must be greater than 0 or left blank.');
  }

  if (isBuy) {
    if (sl > 0 && sl >= entry) errors.push('For buy-side pending orders, SL must be below entry.');
    if (tp > 0 && tp <= entry) errors.push('For buy-side pending orders, TP must be above entry.');
  } else if (isSell) {
    if (sl > 0 && sl <= entry) errors.push('For sell-side pending orders, SL must be above entry.');
    if (tp > 0 && tp >= entry) errors.push('For sell-side pending orders, TP must be below entry.');
  } else {
    errors.push('Only Buy Limit and Sell Limit validation is available in this UI step.');
  }
}

function breakevenStop(position, draft, point) {
  const openPrice = Number(position.openPrice);
  const offsetPoints = parseOptionalNumber(draft.offsetPoints) ?? 0;

  if (!(openPrice > 0) || !(point > 0) || !(offsetPoints >= 0)) {
    return null;
  }

  return String(position.type || '').toUpperCase() === 'SELL'
    ? openPrice - offsetPoints * point
    : openPrice + offsetPoints * point;
}

function isBuyOrderType(type) {
  return String(type || '').toUpperCase().includes('BUY');
}

function isSellOrderType(type) {
  return String(type || '').toUpperCase().includes('SELL');
}

function isAlignedToStep(value, step) {
  if (!(step > 0)) {
    return false;
  }

  const units = value / step;
  return Math.abs(units - Math.round(units)) < 1e-6;
}

function symbolsMatch(left, right) {
  return String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
}

function valueOrEmpty(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : '';
}

function parseOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatOptionalTradePrice(value, digits) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatPrice(numeric, digits) : '--';
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
  if (value === null || value === undefined || value === '') {
    return '--';
  }

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

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function formatTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '--';
  }

  return new Date(numeric * 1000).toLocaleString();
}

function formatExpiration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'GTC';
  }

  return formatTime(numeric);
}

function formatOrderType(value) {
  if (!value) {
    return '--';
  }

  return String(value).replaceAll('_', ' ');
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
