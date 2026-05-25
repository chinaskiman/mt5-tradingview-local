export default function RiskCalculator({ snapshot, prefs, onPrefsChange, verification, onVerify }) {
  const account = snapshot?.account || null;
  const quote = snapshot?.quote || null;
  const calculation = calculateRisk({ account, quote, prefs });
  const canVerify = Boolean(account && quote && calculation.errors.length === 0);
  const requestPayload = account && quote ? toRiskRequestPayload({ snapshot, prefs, calculation, quote }) : null;
  const requestSignature = requestPayload ? createRequestSignature(requestPayload) : null;
  const verificationStale = Boolean(
    verification?.requestSignature
    && requestSignature
    && verification.requestSignature !== requestSignature
  );

  function updateField(key, value) {
    onPrefsChange({
      ...prefs,
      [key]: value
    });
  }

  return (
    <section className="risk-calculator" aria-label="Risk Calculator">
      <div className="risk-header">
        <div>
          <h2>Risk Calculator</h2>
          <p>Preliminary lot-size estimate</p>
        </div>
      </div>

      {!account || !quote ? (
        <div className="monitor-empty">
          {!account ? <p>Waiting for account data...</p> : null}
          {!quote ? <p>Waiting for quote data...</p> : null}
        </div>
      ) : (
        <>
          <p className="settings-note">
            Calculations only. Preliminary estimate - final broker-normalized calculation will be verified by MT5.
          </p>

          <section className="risk-form" aria-label="Risk calculator inputs">
            <Field label="Risk basis">
              <SegmentedControl
                value={prefs.riskBasis}
                options={[
                  ['equity', 'Equity'],
                  ['balance', 'Balance']
                ]}
                onChange={(value) => updateField('riskBasis', value)}
              />
            </Field>

            <Field label="Risk mode">
              <SegmentedControl
                value={prefs.riskMode}
                options={[
                  ['percent', 'Percent'],
                  ['fixed', 'Fixed money']
                ]}
                onChange={(value) => updateField('riskMode', value)}
              />
            </Field>

            <Field label={prefs.riskMode === 'percent' ? 'Risk value (%)' : `Risk value (${account.currency || 'money'})`}>
              <NumberInput
                value={prefs.riskValue}
                min="0"
                step="0.01"
                onChange={(value) => updateField('riskValue', value)}
              />
            </Field>

            <Field label="Order side">
              <select value={prefs.orderSide} onChange={(event) => updateField('orderSide', event.target.value)}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </Field>

            <Field label="Entry price mode">
              <SegmentedControl
                value={prefs.entryPriceMode}
                options={[
                  ['market', 'Current market'],
                  ['manual', 'Manual']
                ]}
                onChange={(value) => updateField('entryPriceMode', value)}
              />
            </Field>

            {prefs.entryPriceMode === 'manual' ? (
              <Field label="Manual entry price">
                <NumberInput
                  value={prefs.manualEntryPrice}
                  min="0"
                  step={priceStep(quote)}
                  onChange={(value) => updateField('manualEntryPrice', value)}
                />
              </Field>
            ) : null}

            <Field label="Stop-loss mode">
              <SegmentedControl
                value={prefs.stopLossMode}
                options={[
                  ['price', 'SL price'],
                  ['points', 'Distance points']
                ]}
                onChange={(value) => updateField('stopLossMode', value)}
              />
            </Field>

            {prefs.stopLossMode === 'price' ? (
              <Field label="Stop-loss price">
                <NumberInput
                  value={prefs.stopLossPrice}
                  min="0"
                  step={priceStep(quote)}
                  onChange={(value) => updateField('stopLossPrice', value)}
                />
              </Field>
            ) : (
              <Field label="Stop distance points">
                <NumberInput
                  value={prefs.stopDistancePoints}
                  min="0"
                  step="1"
                  onChange={(value) => updateField('stopDistancePoints', value)}
                />
              </Field>
            )}
          </section>

          <section className="risk-output" aria-label="Risk calculator output">
            <h3>Preliminary Estimate</h3>
            <OutputGrid
              items={[
                ['Symbol', quote.symbol || snapshot?.symbol || '--'],
                ['Account currency', account.currency || '--'],
                ['Risk basis value', formatMoney(calculation.riskBasisValue, account.currency)],
                ['Risk amount', formatMoney(calculation.riskAmount, account.currency)],
                ['Entry price', formatPrice(calculation.entryPrice, quote.digits)],
                ['Stop-loss price', formatPrice(calculation.stopLossPrice, quote.digits)],
                ['Stop distance points', formatPoints(calculation.stopDistancePoints)],
                ['Tick size', formatRawNumber(quote.tickSize)],
                ['Tick value', formatMoney(quote.tickValue, account.currency)],
                ['Volume min', formatVolume(quote.volumeMin, quote.volumeStep)],
                ['Volume max', formatVolume(quote.volumeMax, quote.volumeStep)],
                ['Volume step', formatVolume(quote.volumeStep, quote.volumeStep)],
                ['Raw calculated volume', formatVolume(calculation.rawVolume, quote.volumeStep, 2)],
                ['Normalized volume', formatVolume(calculation.normalizedVolume, quote.volumeStep)],
                ['Estimated loss at SL', formatMoney(calculation.estimatedLoss, account.currency)]
              ]}
            />

            <div className={`risk-status ${calculation.errors.length ? 'has-errors' : calculation.warnings.length ? 'has-warnings' : 'is-ok'}`}>
              <strong>Status</strong>
              {calculation.errors.length || calculation.warnings.length ? (
                <ul>
                  {[...calculation.errors, ...calculation.warnings].map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : (
                <p>Ready. This is a preliminary frontend estimate.</p>
              )}
            </div>

            <button
              type="button"
              className="risk-verify-button"
              disabled={!canVerify || verification?.status === 'queued' || verification?.status === 'waiting'}
              onClick={() => {
                if (canVerify && requestPayload) {
                  onVerify(requestPayload);
                }
              }}
            >
              {verifyButtonText(verification?.status)}
            </button>

            <VerifiedResult
              result={verification?.result}
              status={verification?.status}
              error={verification?.error}
              currency={account.currency || ''}
              digits={quote.digits}
              stale={verificationStale}
            />
          </section>
        </>
      )}
    </section>
  );
}

function VerifiedResult({ result, status, error, currency, digits, stale }) {
  if (status === 'idle' || !status) {
    return null;
  }

  if (status === 'queued') {
    return <p className="risk-verification pending">Queued. Waiting for backend confirmation.</p>;
  }

  if (status === 'waiting') {
    return (
      <p className="risk-verification pending">
        Waiting for MT5. The EA must be running and `EnableRiskCalculatorCommands` must be enabled.
      </p>
    );
  }

  if (status === 'failed' && !result) {
    return (
      <section className="risk-verified-result" aria-label="MT5 verified risk result">
        <h3>MT5 Verified Result</h3>
        <p className="risk-verification error">{error || 'MT5 verification failed.'}</p>
        {stale ? <p className="risk-verification stale">Inputs changed - verify again.</p> : null}
      </section>
    );
  }

  if (!result) {
    return null;
  }

  if (!result.ok) {
    return (
      <section className="risk-verified-result" aria-label="MT5 verified risk result">
        <h3>MT5 Verified Result</h3>
        <p className="risk-verification error">{result.error || 'MT5 verification failed.'}</p>
        <WarningList warnings={result.warnings} />
        {stale ? <p className="risk-verification stale">Inputs changed - verify again.</p> : null}
      </section>
    );
  }

  return (
    <section className={`risk-verified-result is-final ${stale ? 'is-stale' : ''}`} aria-label="MT5 verified risk result">
      <h3>MT5 Verified Result</h3>
      <OutputGrid
        items={[
          ['Request', result.requestId],
          ['Risk basis amount', formatMoney(result.riskBasisAmount, currency)],
          ['Risk amount', formatMoney(result.riskAmount, currency)],
          ['Entry price', formatPrice(result.entryPrice, digits)],
          ['Stop-loss price', formatPrice(result.stopLossPrice, digits)],
          ['Stop distance points', formatPoints(result.stopDistancePoints)],
          ['Tick size', formatRawNumber(result.tickSize)],
          ['Tick value', formatMoney(result.tickValue, currency)],
          ['Broker volume min', formatVolume(result.volumeMin, result.volumeStep)],
          ['Broker volume max', formatVolume(result.volumeMax, result.volumeStep)],
          ['Broker volume step', formatVolume(result.volumeStep, result.volumeStep)],
          ['Raw volume', formatVolume(result.rawVolume, result.volumeStep, 2)],
          ['Normalized volume', formatVolume(result.normalizedVolume, result.volumeStep)],
          ['Estimated loss', formatMoney(result.estimatedLoss, currency)]
        ]}
      />
      {stale ? <p className="risk-verification stale">Inputs changed - verify again.</p> : null}
      <p className="risk-verification ok">
        Verified. Treat this MT5 result as the final broker-normalized value.
        {Array.isArray(result.warnings) && result.warnings.length ? ' Review warnings below.' : ''}
      </p>
      <WarningList warnings={result.warnings} />
    </section>
  );
}

function WarningList({ warnings }) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return null;
  }

  return (
    <div className="risk-status has-warnings">
      <strong>MT5 warnings</strong>
      <ul>
        {warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>
    </div>
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

function OutputGrid({ items }) {
  return (
    <dl className="risk-output-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function calculateRisk({ account, quote, prefs }) {
  const errors = [];
  const warnings = [];
  const riskBasisValue = numeric(prefs.riskBasis === 'balance' ? account?.balance : account?.equity);
  const accountEquity = numeric(account?.equity);
  const riskValue = numeric(prefs.riskValue);
  const point = numeric(quote?.point);
  const tickSize = numeric(quote?.tickSize);
  const tickValue = numeric(quote?.tickValue);
  const volumeMin = numeric(quote?.volumeMin);
  const volumeMax = numeric(quote?.volumeMax);
  const volumeStep = numeric(quote?.volumeStep);
  const entryPrice = prefs.entryPriceMode === 'manual'
    ? numeric(prefs.manualEntryPrice)
    : marketEntryPrice(quote, prefs.orderSide);
  const stopLossPrice = prefs.stopLossMode === 'points'
    ? stopFromDistance(entryPrice, numeric(prefs.stopDistancePoints), point, prefs.orderSide)
    : numeric(prefs.stopLossPrice);
  const stopDistancePrice = entryPrice > 0 && stopLossPrice > 0 ? Math.abs(entryPrice - stopLossPrice) : null;
  const stopDistancePoints = point > 0 && stopDistancePrice > 0 ? stopDistancePrice / point : null;
  const riskAmount = prefs.riskMode === 'percent'
    ? (riskBasisValue > 0 && riskValue > 0 ? riskBasisValue * (riskValue / 100) : null)
    : riskValue;
  const lossPerVolume = tickSize > 0 && tickValue > 0 && stopDistancePrice > 0
    ? (stopDistancePrice / tickSize) * tickValue
    : null;
  const rawVolume = lossPerVolume > 0 ? riskAmount / lossPerVolume : null;
  const normalizedVolume = normalizeVolume(rawVolume, volumeMin, volumeMax, volumeStep);
  const estimatedLoss = normalizedVolume !== null && lossPerVolume > 0 ? normalizedVolume * lossPerVolume : null;

  if (!(riskValue > 0)) errors.push('Risk value must be greater than 0.');
  if (!(riskBasisValue > 0)) errors.push('Risk basis value is missing or not greater than 0.');
  if (prefs.riskMode === 'fixed' && accountEquity > 0 && riskValue > accountEquity) {
    errors.push('Fixed risk amount must not exceed account equity.');
  }
  if (!(entryPrice > 0)) errors.push('Entry price must be greater than 0.');
  if (!(stopLossPrice > 0)) errors.push('Stop-loss price must be greater than 0.');
  if (!(stopDistancePrice > 0)) errors.push('Stop distance must be greater than 0.');
  if (!(tickSize > 0)) errors.push('Quote tick size must be a valid positive number.');
  if (!(tickValue > 0)) errors.push('Quote tick value must be a valid positive number.');
  if (!(volumeStep > 0)) errors.push('Quote volume step must be a valid positive number.');
  if (!(volumeMin > 0)) warnings.push('Quote volume minimum is missing or invalid.');
  if (!(volumeMax > 0)) warnings.push('Quote volume maximum is missing or invalid.');

  if (prefs.riskMode === 'percent' && riskValue > 5) {
    warnings.push('Risk percent is above 5%.');
  }

  if (stopDistancePoints !== null && stopDistancePoints > 0 && stopDistancePoints < 10) {
    warnings.push('Stop distance is very small.');
  }

  if (stopDistancePrice !== null && tickSize > 0 && stopDistancePrice < tickSize) {
    warnings.push('Stop distance is smaller than one tick.');
  }

  if (entryPrice > 0 && stopLossPrice > 0) {
    if (prefs.orderSide === 'buy' && stopLossPrice >= entryPrice) {
      errors.push('For Buy, stop-loss must be below entry.');
    }

    if (prefs.orderSide === 'sell' && stopLossPrice <= entryPrice) {
      errors.push('For Sell, stop-loss must be above entry.');
    }
  }

  if (rawVolume !== null && volumeMin > 0 && rawVolume < volumeMin) {
    warnings.push('Calculated volume is below broker minimum volume.');
  }

  if (rawVolume !== null && volumeMax > 0 && rawVolume > volumeMax) {
    warnings.push('Calculated volume is above broker maximum volume.');
  }

  if (estimatedLoss !== null && riskAmount > 0 && estimatedLoss > riskAmount) {
    warnings.push('Normalized volume may risk more than requested because of broker volume limits.');
  }

  return {
    riskBasisValue,
    riskAmount,
    entryPrice,
    stopLossPrice,
    stopDistancePoints,
    rawVolume,
    normalizedVolume,
    estimatedLoss,
    errors,
    warnings
  };
}

function toRiskRequestPayload({ snapshot, prefs, calculation, quote }) {
  return {
    symbol: quote?.symbol || snapshot?.symbol || '',
    side: prefs.orderSide === 'sell' ? 'SELL' : 'BUY',
    riskBasis: prefs.riskBasis === 'balance' ? 'BALANCE' : 'EQUITY',
    riskMode: prefs.riskMode === 'fixed' ? 'FIXED' : 'PERCENT',
    riskValue: Number(prefs.riskValue),
    entryPrice: Number(calculation.entryPrice),
    stopLossPrice: Number(calculation.stopLossPrice)
  };
}

function createRequestSignature(payload) {
  return JSON.stringify({
    symbol: payload.symbol,
    side: payload.side,
    riskBasis: payload.riskBasis,
    riskMode: payload.riskMode,
    riskValue: payload.riskValue,
    entryPrice: payload.entryPrice,
    stopLossPrice: payload.stopLossPrice
  });
}

function verifyButtonText(status) {
  if (status === 'queued') {
    return 'Queued';
  }

  if (status === 'waiting') {
    return 'Waiting for MT5...';
  }

  return 'Verify with MT5';
}

function marketEntryPrice(quote, orderSide) {
  return orderSide === 'sell' ? numeric(quote?.bid) : numeric(quote?.ask);
}

function stopFromDistance(entryPrice, distancePoints, point, orderSide) {
  if (!(entryPrice > 0) || !(distancePoints > 0) || !(point > 0)) {
    return null;
  }

  const distance = distancePoints * point;
  return orderSide === 'sell' ? entryPrice + distance : entryPrice - distance;
}

function normalizeVolume(rawVolume, volumeMin, volumeMax, volumeStep) {
  if (!(rawVolume > 0) || !(volumeStep > 0)) {
    return null;
  }

  const decimals = decimalPlaces(volumeStep);
  let normalized = Math.floor(rawVolume / volumeStep) * volumeStep;

  if (volumeMin > 0 && normalized < volumeMin) {
    normalized = volumeMin;
  }

  if (volumeMax > 0 && normalized > volumeMax) {
    normalized = volumeMax;
  }

  return Number(normalized.toFixed(decimals));
}

function priceStep(quote) {
  const point = numeric(quote?.point);
  return point > 0 ? String(point) : '0.00001';
}

function decimalPlaces(value) {
  const text = String(value);
  if (text.includes('e-')) {
    return Number(text.split('e-')[1]) || 0;
  }

  return text.includes('.') ? text.split('.')[1].length : 0;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value, currency) {
  const parsed = numeric(value);
  if (parsed === null) {
    return '--';
  }

  return `${parsed.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}

function formatPrice(value, digits) {
  const parsed = numeric(value);
  if (parsed === null) {
    return '--';
  }

  return parsed.toFixed(clampDigits(digits));
}

function formatNumber(value, decimals = 2) {
  const parsed = numeric(value);
  return parsed === null ? '--' : parsed.toFixed(decimals);
}

function formatPoints(value) {
  const parsed = numeric(value);
  return parsed === null ? '--' : String(Math.round(parsed));
}

function formatRawNumber(value) {
  const parsed = numeric(value);
  return parsed === null ? '--' : Number.parseFloat(parsed.toFixed(10)).toString();
}

function formatVolume(value, volumeStep, extraDecimals = 0) {
  const parsed = numeric(value);
  if (parsed === null) {
    return '--';
  }

  const stepDecimals = volumeStep > 0 ? decimalPlaces(volumeStep) : 2;
  const decimals = Math.min(8, Math.max(2, stepDecimals + extraDecimals));
  return Number.parseFloat(parsed.toFixed(decimals)).toString();
}

function clampDigits(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }

  return Math.min(8, Math.max(0, Math.trunc(parsed)));
}
