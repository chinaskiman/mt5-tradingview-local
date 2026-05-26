import { useEffect, useMemo, useState } from 'react';

const TRADING_MODE_KEY = 'mt5-dashboard-trading-mode-enabled';

export default function OrderEntry({ snapshot, prefs, onPrefsChange, riskPrefs, riskVerification, orderPlacement, onSendOrder }) {
  const account = snapshot?.account || null;
  const quote = snapshot?.quote || null;
  const [tradingModeEnabled, setTradingModeEnabled] = useState(() => window.sessionStorage.getItem(TRADING_MODE_KEY) === 'true');
  const [confirmation, setConfirmation] = useState(null);

  const riskState = useMemo(() => getRiskState({ snapshot, riskPrefs, riskVerification }), [snapshot, riskPrefs, riskVerification]);
  const preparedOrder = useMemo(
    () => buildPreparedOrder({ account, quote, prefs, riskState }),
    [account, quote, prefs, riskState]
  );

  useEffect(() => {
    window.sessionStorage.setItem(TRADING_MODE_KEY, tradingModeEnabled ? 'true' : 'false');
  }, [tradingModeEnabled]);

  function updateField(key, value) {
    setConfirmation(null);
    onPrefsChange({
      ...prefs,
      [key]: value
    });
  }

  function prepareOrder() {
    if (!tradingModeEnabled || preparedOrder.errors.length > 0) {
      return;
    }

    setConfirmation({
      ...preparedOrder.order,
      submitted: false
    });
  }

  function sendOrder() {
    if (!confirmation || confirmation.submitted || !tradingModeEnabled || preparedOrder.errors.length > 0) {
      return;
    }

    const payload = toOrderRequestPayload(confirmation);
    setConfirmation({
      ...confirmation,
      submitted: true
    });
    onSendOrder(payload);
  }

  return (
    <section className="order-entry" aria-label="Order Entry">
      <div className="order-entry-header">
        <div>
          <h2>Order Entry</h2>
          <p>{quote?.symbol || snapshot?.symbol || 'Waiting for symbol'} - Backend queue</p>
        </div>
      </div>

      {!account || !quote ? (
        <div className="monitor-empty">
          {!account ? <p>Waiting for account data...</p> : null}
          {!quote ? <p>Waiting for quote data...</p> : null}
        </div>
      ) : (
        <>
          <div className="order-entry-body">
            <OrderSection title="Order">
              <div className="order-compact-grid">
                <Field label="Order type">
                  <select value={prefs.orderType} onChange={(event) => updateField('orderType', event.target.value)}>
                    <option value="marketBuy">Market Buy</option>
                    <option value="marketSell">Market Sell</option>
                    <option value="buyLimit">Buy Limit</option>
                    <option value="sellLimit">Sell Limit</option>
                  </select>
                </Field>
                <ReadOnlyValue label="Side" value={preparedOrder.order.side} />
              </div>
            </OrderSection>

            <OrderSection title="Volume">
              <div className="order-compact-grid">
                <Field label="Volume mode">
                  <SegmentedControl
                    value={prefs.volumeMode}
                    options={[
                      ['risk', 'Risk verified'],
                      ['manual', 'Manual']
                    ]}
                    onChange={(value) => updateField('volumeMode', value)}
                  />
                </Field>
                {prefs.volumeMode === 'risk' ? (
                  <ReadOnlyValue
                    label="Volume"
                    value={riskState.hasVerifiedResult ? formatVolume(riskState.volume, quote.volumeStep) : 'No verified result'}
                  />
                ) : (
                  <Field label="Manual volume">
                    <NumberInput
                      value={prefs.manualVolume}
                      min="0"
                      step={volumeStep(quote)}
                      onChange={(value) => updateField('manualVolume', value)}
                    />
                  </Field>
                )}
              </div>
            </OrderSection>

            <OrderSection title="Prices">
              <div className="order-compact-grid">
                {isMarketOrder(prefs.orderType) ? (
                  <ReadOnlyValue
                    label={prefs.orderType === 'marketBuy' ? 'Entry ask' : 'Entry bid'}
                    value={formatPrice(preparedOrder.order.entryPrice, quote.digits)}
                  />
                ) : (
                  <Field label="Entry price">
                    <NumberInput
                      value={prefs.entryPrice}
                      min="0"
                      step={priceStep(quote)}
                      onChange={(value) => updateField('entryPrice', value)}
                    />
                  </Field>
                )}
                <ReadOnlyValue label="Spread" value={`${quote.spreadPoints ?? '--'} pts`} />
              </div>
            </OrderSection>

            <OrderSection title="Protection">
              <div className="order-compact-grid">
                <Field label="Stop Loss">
                  <NumberInput
                    value={prefs.stopLossPrice}
                    min="0"
                    step={priceStep(quote)}
                    onChange={(value) => updateField('stopLossPrice', value)}
                  />
                </Field>
                <Field label="Take Profit">
                  <NumberInput
                    value={prefs.takeProfitPrice}
                    min="0"
                    step={priceStep(quote)}
                    onChange={(value) => updateField('takeProfitPrice', value)}
                  />
                </Field>
              </div>
              <label className="order-toggle compact">
                <input
                  type="checkbox"
                  checked={prefs.requireStopLoss}
                  onChange={(event) => updateField('requireStopLoss', event.target.checked)}
                />
                <span>Require Stop Loss</span>
              </label>
            </OrderSection>

            <OrderSection title="Execution Safety">
              <div className="order-compact-grid">
                <Field label="Magic number">
                  <NumberInput
                    value={prefs.magicNumber}
                    min="0"
                    step="1"
                    onChange={(value) => updateField('magicNumber', value)}
                  />
                </Field>
                <Field label="Comment">
                  <input
                    type="text"
                    maxLength="64"
                    value={prefs.comment}
                    onChange={(event) => updateField('comment', event.target.value)}
                  />
                </Field>
              </div>
              <p className="order-mini-note">Final execution depends on MT5 Algo Trading and EA live-trading permission.</p>
            </OrderSection>
          </div>

          <section className="order-sticky-footer" aria-label="Order entry validation and actions">
            <div className="order-footer-label">Validation / Result</div>
            <div className="order-footer-topline">
              <label className="trading-mode-toggle compact">
                <input
                  type="checkbox"
                  checked={tradingModeEnabled}
                  onChange={(event) => setTradingModeEnabled(event.target.checked)}
                />
                <span>Trading Mode {tradingModeEnabled ? 'ON' : 'OFF'}</span>
              </label>
              <span className={`order-footer-state ${tradingModeEnabled ? 'is-on' : 'is-off'}`}>
                {tradingModeEnabled ? 'Can prepare' : 'Locked'}
              </span>
            </div>
            <ValidationMessages errors={preparedOrder.errors} warnings={preparedOrder.warnings} tradingModeEnabled={tradingModeEnabled} />
            <OrderFooterPlacementStatus placement={orderPlacement} />
            <button
              type="button"
              className="risk-verify-button order-prepare-button"
              disabled={!tradingModeEnabled || preparedOrder.errors.length > 0}
              onClick={prepareOrder}
            >
              Prepare Order
            </button>
          </section>
        </>
      )}

      {confirmation ? (
        <OrderConfirmationModal
          order={confirmation}
          quote={quote}
          currency={account?.currency || ''}
          digits={quote?.digits}
          volumeStep={quote?.volumeStep}
          tradingModeEnabled={tradingModeEnabled}
          validationErrors={preparedOrder.errors}
          placement={orderPlacement}
          onSend={sendOrder}
          onClose={() => setConfirmation(null)}
        />
      ) : null}
    </section>
  );
}

function OrderFooterPlacementStatus({ placement }) {
  if (!placement || placement.status === 'idle') {
    return null;
  }

  const textByStatus = {
    sending: 'Sending order request...',
    queued: 'Queued for MT5 polling.',
    waiting: 'Waiting for MT5 result.',
    filled: 'Market order result received.',
    placed: 'Pending order result received.',
    failed: placement.error || placement.result?.message || 'Order failed.'
  };

  const statusText = textByStatus[placement.status] || null;
  if (!statusText) {
    return null;
  }

  return (
    <p className={`order-footer-result ${placement.status === 'failed' ? 'is-error' : ''}`}>
      {statusText}
    </p>
  );
}

function OrderSection({ title, children }) {
  return (
    <section className="order-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="risk-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, min, step, onChange }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SegmentedControl({ value, options, onChange }) {
  return (
    <div className="risk-segmented">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={value === key ? 'is-active' : ''}
          onClick={() => onChange(key)}
          aria-pressed={value === key}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ReadOnlyValue({ label, value }) {
  return (
    <div className="order-readonly">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ValidationMessages({ errors, warnings, tradingModeEnabled }) {
  if (!tradingModeEnabled) {
    return <p className="order-validation is-locked">Trading Mode is OFF. Enable it to prepare an order.</p>;
  }

  if (!errors.length && !warnings.length) {
    return <p className="order-validation is-ok">Ready. Send happens only from the confirmation modal.</p>;
  }

  const issues = [...errors, ...warnings];
  const first = issues[0];
  const remaining = issues.slice(1);
  const label = errors.length ? 'Validation issues' : 'Warnings';

  return (
    <details className={`order-validation ${errors.length ? 'has-errors' : 'has-warnings'}`} open={remaining.length === 0}>
      <summary>
        <span>{label}</span>
        <strong>{first}</strong>
      </summary>
      {remaining.length ? (
        <ul>
          {remaining.map((message) => <li key={message}>{message}</li>)}
        </ul>
      ) : null}
    </details>
  );
}

function OrderConfirmationModal({
  order,
  quote,
  currency,
  digits,
  volumeStep,
  tradingModeEnabled,
  validationErrors,
  placement,
  onSend,
  onClose
}) {
  const pending = order.submitted && ['sending', 'queued', 'waiting'].includes(placement?.status);
  const hasResult = order.submitted && ['filled', 'placed', 'failed'].includes(placement?.status);
  const quoteWarning = getQuoteChangeWarning(order, quote, digits);
  const canSend = tradingModeEnabled && validationErrors.length === 0 && !order.submitted;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-modal" role="dialog" aria-modal="true" aria-label="Order confirmation">
        <div className="confirmation-header">
          <h2>Confirm Order Details</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close confirmation">x</button>
        </div>

        <dl className="risk-output-grid confirmation-grid">
          <Info label="Symbol" value={order.symbol} />
          <Info label="Order type" value={order.orderTypeLabel} />
          <Info label="Side" value={order.side} />
          <Info label="Volume" value={formatVolume(order.volume, volumeStep)} />
          <Info label="Entry price" value={formatPrice(order.entryPrice, digits)} />
          <Info label="SL" value={formatOptionalPrice(order.stopLossPrice, digits)} />
          <Info label="TP" value={formatOptionalPrice(order.takeProfitPrice, digits)} />
          <Info label="Estimated risk" value={order.estimatedRisk !== null ? formatMoney(order.estimatedRisk, currency) : '--'} />
          <Info label="Currency" value={currency || '--'} />
          <Info label="Comment" value={order.comment || '--'} />
          <Info label="Magic number" value={String(order.magicNumber)} />
        </dl>

        {quoteWarning ? <p className="risk-verification stale">{quoteWarning}</p> : null}

        {Array.isArray(order.warnings) && order.warnings.length ? (
          <div className="risk-status has-warnings">
            <strong>Warnings</strong>
            <ul>
              {order.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        ) : null}

        {!tradingModeEnabled ? (
          <p className="risk-verification error">Trading Mode is OFF. Enable it before sending an order.</p>
        ) : null}

        <OrderPlacementStatus
          placement={order.submitted ? placement : null}
          pending={pending}
          hasResult={hasResult}
          currency={currency}
          digits={digits}
          volumeStep={volumeStep}
        />

        <div className="confirmation-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="risk-verify-button"
            disabled={!canSend}
            onClick={onSend}
          >
            {sendButtonText(order, placement)}
          </button>
        </div>
      </section>
    </div>
  );
}

function OrderPlacementStatus({ placement, currency, digits, volumeStep }) {
  if (!placement || placement.status === 'idle') {
    return (
      <p className="risk-verification pending">
        Review details carefully. This will queue a real order command if both backend and EA safety gates are enabled.
      </p>
    );
  }

  if (placement.status === 'sending') {
    return <p className="risk-verification pending">Sending order request to backend...</p>;
  }

  if (placement.status === 'queued') {
    return <p className="risk-verification pending">Queued. Waiting for backend command delivery.</p>;
  }

  if (placement.status === 'waiting') {
    return <p className="risk-verification pending">Waiting for MT5 order result...</p>;
  }

  if (placement.status === 'failed' && !placement.result) {
    return (
      <section className="risk-verified-result">
        <h3>Order Result</h3>
        <p className="risk-verification error">{placement.error || 'Order request failed.'}</p>
      </section>
    );
  }

  if (!placement.result) {
    return null;
  }

  const result = placement.result;
  const ok = result.ok === true;
  const title = ok
    ? (result.orderKind === 'LIMIT' ? 'Pending order placed' : 'Market order filled / placed')
    : 'Order failed';

  return (
    <section className={`risk-verified-result ${ok ? 'is-final' : ''}`}>
      <h3>{title}</h3>
      <dl className="risk-output-grid confirmation-grid">
        <Info label="Ticket" value={result.ticket ? String(result.ticket) : '--'} />
        <Info label="Retcode" value={String(result.retcode ?? '--')} />
        <Info label="Final volume" value={formatVolume(result.volume, volumeStep)} />
        <Info label="Entry price" value={formatPrice(result.entryPrice, digits)} />
        <Info label="SL" value={formatOptionalPrice(result.sl, digits)} />
        <Info label="TP" value={formatOptionalPrice(result.tp, digits)} />
      </dl>
      <p className={`risk-verification ${ok ? 'ok' : 'error'}`}>{result.message || placement.error || 'No message returned.'}</p>
      {!ok && isMt5TradingDisabledError(result.message) ? (
        <div className="risk-status has-warnings">
          <strong>MT5 trading is disabled</strong>
          <ul>
            <li>Turn on the Algo Trading button in MT5.</li>
            <li>Confirm live trading is allowed for this EA.</li>
            <li>Prepare a new order after changing settings.</li>
          </ul>
        </div>
      ) : null}
      {Array.isArray(placement.warnings) && placement.warnings.length ? (
        <div className="risk-status has-warnings">
          <strong>Backend warnings</strong>
          <ul>
            {placement.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
      {currency ? <p className="settings-note">Account currency: {currency}</p> : null}
    </section>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function toOrderRequestPayload(order) {
  return {
    clientTradingMode: true,
    confirmationAccepted: true,
    symbol: order.symbol,
    orderKind: order.orderKind,
    side: order.side,
    volume: Number(order.volume),
    entryPrice: Number(order.entryPrice),
    sl: order.stopLossPrice > 0 ? Number(order.stopLossPrice) : null,
    tp: order.takeProfitPrice > 0 ? Number(order.takeProfitPrice) : null,
    comment: order.comment,
    magic: order.magicNumber
  };
}

function getQuoteChangeWarning(order, quote) {
  if (!quote || !isMarketOrder(order.orderType)) {
    return null;
  }

  const currentEntry = marketEntryPrice(quote, order.orderType);
  const point = numeric(quote.point);
  const tolerance = point > 0 ? point / 2 : 0;

  if (currentEntry > 0 && Math.abs(currentEntry - order.entryPrice) > tolerance) {
    return 'Market price may have changed. Reconfirm before sending.';
  }

  return null;
}

function sendButtonText(order, placement) {
  if (order.submitted) {
    if (placement?.status === 'sending') return 'Sending...';
    if (placement?.status === 'queued') return 'Queued';
    if (placement?.status === 'waiting') return 'Waiting for MT5';
    if (placement?.status === 'filled') return 'Filled';
    if (placement?.status === 'placed') return 'Placed';
    if (placement?.status === 'failed') return 'Send locked';
    return 'Sent';
  }

  return 'Send Order';
}

function isMt5TradingDisabledError(message) {
  const value = String(message || '');
  return value.includes('Algo Trading is disabled')
    || value.includes('Live trading is not allowed')
    || value.includes('Trading is disabled')
    || value.includes('Expert trading is disabled');
}

function buildPreparedOrder({ account, quote, prefs, riskState }) {
  const errors = [];
  const warnings = [];
  const side = orderSide(prefs.orderType);
  const entryPrice = isMarketOrder(prefs.orderType) ? marketEntryPrice(quote, prefs.orderType) : numeric(prefs.entryPrice);
  const stopLossPrice = numericOrNull(prefs.stopLossPrice);
  const takeProfitPrice = numericOrNull(prefs.takeProfitPrice);
  const volume = prefs.volumeMode === 'risk' ? riskState.volume : numeric(prefs.manualVolume);

  if (!account) errors.push('Account data is required.');
  if (!quote) errors.push('Quote data is required.');

  if (prefs.volumeMode === 'risk') {
    if (!riskState.hasVerifiedResult) {
      errors.push('No successful MT5 verified Risk Calculator result exists.');
    }
    if (riskState.isStale) {
      warnings.push('Risk Calculator inputs changed; verified result is stale.');
    }
  }

  validateVolume({ volume, quote, errors });
  validateEntryPrice({ orderType: prefs.orderType, entryPrice, quote, errors });
  validateStops({ side, entryPrice, stopLossPrice, takeProfitPrice, requireStopLoss: prefs.requireStopLoss, errors });

  return {
    errors,
    warnings,
    order: {
      symbol: quote?.symbol || '',
      orderType: prefs.orderType,
      orderKind: isMarketOrder(prefs.orderType) ? 'MARKET' : 'LIMIT',
      orderTypeLabel: orderTypeLabel(prefs.orderType),
      side,
      volume,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      estimatedRisk: riskState.estimatedRisk,
      comment: String(prefs.comment || '').trim(),
      magicNumber: Math.max(0, Math.trunc(Number(prefs.magicNumber) || 0)),
      warnings
    }
  };
}

function validateVolume({ volume, quote, errors }) {
  const min = numeric(quote?.volumeMin);
  const max = numeric(quote?.volumeMax);
  const step = numeric(quote?.volumeStep);

  if (!(volume > 0)) {
    errors.push('Volume must be greater than 0.');
    return;
  }

  if (!(step > 0)) {
    errors.push('Quote volume step must be valid.');
    return;
  }

  if (min > 0 && volume < min) {
    errors.push(`Volume is below broker minimum ${formatVolume(min, step)}.`);
  }

  if (max > 0 && volume > max) {
    errors.push(`Volume is above broker maximum ${formatVolume(max, step)}.`);
  }

  if (!isAlignedToStep(volume, step)) {
    errors.push(`Volume must align to broker step ${formatVolume(step, step)}.`);
  }
}

function validateEntryPrice({ orderType, entryPrice, quote, errors }) {
  if (!(entryPrice > 0)) {
    errors.push('Entry price must be greater than 0.');
    return;
  }

  if (orderType === 'buyLimit' && quote?.ask > 0 && entryPrice >= quote.ask) {
    errors.push('Buy Limit entry must be below current ask.');
  }

  if (orderType === 'sellLimit' && quote?.bid > 0 && entryPrice <= quote.bid) {
    errors.push('Sell Limit entry must be above current bid.');
  }
}

function validateStops({ side, entryPrice, stopLossPrice, takeProfitPrice, requireStopLoss, errors }) {
  if (requireStopLoss && !(stopLossPrice > 0)) {
    errors.push('Stop Loss is required.');
  }

  if (stopLossPrice > 0) {
    if (side === 'BUY' && stopLossPrice >= entryPrice) errors.push('For Buy orders, SL must be below entry.');
    if (side === 'SELL' && stopLossPrice <= entryPrice) errors.push('For Sell orders, SL must be above entry.');
  }

  if (takeProfitPrice > 0) {
    if (side === 'BUY' && takeProfitPrice <= entryPrice) errors.push('For Buy orders, TP must be above entry.');
    if (side === 'SELL' && takeProfitPrice >= entryPrice) errors.push('For Sell orders, TP must be below entry.');
  }
}

function getRiskState({ snapshot, riskPrefs, riskVerification }) {
  const result = riskVerification?.result;
  const hasVerifiedResult = riskVerification?.status === 'verified' && result?.ok === true && numeric(result.normalizedVolume) > 0;
  const currentSignature = createRiskRequestSignature({ snapshot, prefs: riskPrefs });
  const isStale = Boolean(hasVerifiedResult && riskVerification?.requestSignature && currentSignature && riskVerification.requestSignature !== currentSignature);

  return {
    hasVerifiedResult,
    isStale,
    volume: hasVerifiedResult ? numeric(result.normalizedVolume) : null,
    estimatedRisk: hasVerifiedResult ? numeric(result.estimatedLoss) : null
  };
}

function createRiskRequestSignature({ snapshot, prefs }) {
  const quote = snapshot?.quote;
  if (!quote || !prefs) return null;

  const entryPrice = prefs.entryPriceMode === 'manual'
    ? numeric(prefs.manualEntryPrice)
    : (prefs.orderSide === 'sell' ? numeric(quote.bid) : numeric(quote.ask));
  const point = numeric(quote.point);
  const stopLossPrice = prefs.stopLossMode === 'points'
    ? stopFromDistance(entryPrice, numeric(prefs.stopDistancePoints), point, prefs.orderSide)
    : numeric(prefs.stopLossPrice);

  return JSON.stringify({
    symbol: quote?.symbol || snapshot?.symbol || '',
    side: prefs.orderSide === 'sell' ? 'SELL' : 'BUY',
    riskBasis: prefs.riskBasis === 'balance' ? 'BALANCE' : 'EQUITY',
    riskMode: prefs.riskMode === 'fixed' ? 'FIXED' : 'PERCENT',
    riskValue: Number(prefs.riskValue),
    entryPrice: Number(entryPrice),
    stopLossPrice: Number(stopLossPrice)
  });
}

function stopFromDistance(entryPrice, distancePoints, point, orderSide) {
  if (!(entryPrice > 0) || !(distancePoints > 0) || !(point > 0)) return null;
  const distance = distancePoints * point;
  return orderSide === 'sell' ? entryPrice + distance : entryPrice - distance;
}

function orderSide(orderType) {
  return orderType === 'marketSell' || orderType === 'sellLimit' ? 'SELL' : 'BUY';
}

function orderTypeLabel(orderType) {
  const labels = {
    marketBuy: 'Market Buy',
    marketSell: 'Market Sell',
    buyLimit: 'Buy Limit',
    sellLimit: 'Sell Limit'
  };

  return labels[orderType] || orderType;
}

function isMarketOrder(orderType) {
  return orderType === 'marketBuy' || orderType === 'marketSell';
}

function marketEntryPrice(quote, orderType) {
  if (!quote) return null;
  return orderType === 'marketSell' ? numeric(quote.bid) : numeric(quote.ask);
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  return numeric(value);
}

function isAlignedToStep(value, step) {
  if (!(step > 0)) return false;
  const units = value / step;
  return Math.abs(units - Math.round(units)) < 1e-6;
}

function priceStep(quote) {
  const point = numeric(quote?.point);
  return point > 0 ? String(point) : '0.00001';
}

function volumeStep(quote) {
  const step = numeric(quote?.volumeStep);
  return step > 0 ? String(step) : '0.01';
}

function decimalPlaces(value) {
  const text = String(value);
  if (text.includes('e-')) return Number(text.split('e-')[1]) || 0;
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function formatPrice(value, digits) {
  const parsed = numeric(value);
  if (parsed === null) return '--';
  const safeDigits = Number.isFinite(Number(digits)) ? Math.min(8, Math.max(0, Math.trunc(Number(digits)))) : 5;
  return parsed.toFixed(safeDigits);
}

function formatOptionalPrice(value, digits) {
  return value > 0 ? formatPrice(value, digits) : '--';
}

function formatVolume(value, volumeStepValue) {
  const parsed = numeric(value);
  if (parsed === null) return '--';
  const stepDecimals = volumeStepValue > 0 ? decimalPlaces(volumeStepValue) : 2;
  return Number.parseFloat(parsed.toFixed(Math.min(8, Math.max(2, stepDecimals)))).toString();
}

function formatMoney(value, currency) {
  const parsed = numeric(value);
  if (parsed === null) return '--';
  return `${parsed.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}
