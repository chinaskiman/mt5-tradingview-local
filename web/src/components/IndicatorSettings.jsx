import { INDICATOR_COLORS } from '../utils/chartColors.js';

const PRICE_ROWS = [
  ['SMA Fast', 'smaFast', 'smaFast'],
  ['SMA Mid', 'smaMid', 'smaMid'],
  ['SMA Slow', 'smaSlow', 'smaSlow'],
  ['Resistance', 'srResistance', 'sr', 'showOriginalResistance', INDICATOR_COLORS.resistance],
  ['Support', 'srSupport', 'sr', 'showOriginalSupport', INDICATOR_COLORS.support],
  ['Resistance buffer', 'srResistanceBuffer', 'sr', 'showResistanceBuffer', INDICATOR_COLORS.resistanceBuffer],
  ['Support buffer', 'srSupportBuffer', 'sr', 'showSupportBuffer', INDICATOR_COLORS.supportBuffer]
];

const OSCILLATOR_ROWS = [
  ['ATR panel', 'atr', 'atr'],
  ['ADX line', 'adx', 'adx', INDICATOR_COLORS.adx],
  ['DI+ line', 'diPlus', 'di', INDICATOR_COLORS.diPlus],
  ['DI- line', 'diMinus', 'di', INDICATOR_COLORS.diMinus],
  ['RSI panel', 'rsi', 'rsi']
];

export default function IndicatorSettings({
  snapshot,
  chartSpacing,
  visible,
  onChartSpacingChange,
  onVisibilityChange
}) {
  const settings = snapshot?.settings || {};

  return (
    <section className="settings-panel" aria-label="Indicator settings">
      <div className="settings-header">
        <h2>Indicators</h2>
      </div>

      <p className="settings-note">Indicator settings are controlled from the MT5 EA inputs. Browser toggles only hide or show local chart layers.</p>

      <section className="indicator-group" aria-label="Price overlays">
        <h3>Price overlays</h3>
        <div className="indicator-list">
          {PRICE_ROWS.map(([label, visibleKey, settingKey, settingEnabledKey, color]) => (
            <IndicatorRow
              key={visibleKey}
              label={label}
              color={color}
              setting={settings[settingKey]}
              settingEnabledKey={settingEnabledKey}
              visible={visible?.[visibleKey] !== false}
              onVisibleChange={(checked) => onVisibilityChange(visibleKey, checked)}
            />
          ))}
        </div>
      </section>

      <section className="indicator-group" aria-label="Oscillator panels">
        <h3>Oscillators</h3>
        <div className="indicator-list">
          {OSCILLATOR_ROWS.map(([label, visibleKey, settingKey, color]) => (
            <IndicatorRow
              key={visibleKey}
              label={label}
              color={color}
              setting={settings[settingKey]}
              visible={visible?.[visibleKey] !== false}
              onVisibleChange={(checked) => onVisibilityChange(visibleKey, checked)}
            />
          ))}
        </div>
      </section>

      <section className="frontend-prefs" aria-label="Frontend preferences">
        <h3>Display</h3>
        <label className="range-row">
          <span>Bar spacing</span>
          <input
            type="range"
            min="3"
            max="14"
            step="1"
            value={chartSpacing}
            onChange={(event) => onChartSpacingChange(Number(event.target.value))}
          />
          <span className="range-value">{chartSpacing}</span>
        </label>
      </section>

      <dl className="snapshot-details">
        <dt>Source</dt>
        <dd>{snapshot?.source || '--'}</dd>

        <dt>Candles</dt>
        <dd>{count(snapshot?.candles)}</dd>

        <dt>Last closed</dt>
        <dd>{formatUnixTime(snapshot?.lastClosedTime)}</dd>
      </dl>
    </section>
  );
}

function IndicatorRow({ label, color, setting, settingEnabledKey, visible, onVisibleChange }) {
  const enabled = Boolean(setting?.enabled) && (!settingEnabledKey || settingFlagEnabled(setting, settingEnabledKey));
  const meta = settingMeta(setting);

  return (
    <label className={`indicator-row ${enabled ? '' : 'is-disabled'}`}>
      <span className={`indicator-state ${enabled ? 'enabled' : 'disabled'}`} />
      <span className="indicator-name" style={color ? { color } : undefined}>{label}</span>
      <span className="indicator-meta">{enabled ? meta : 'MT5 off'}</span>
      <input
        type="checkbox"
        checked={enabled && visible}
        disabled={!enabled}
        onChange={(event) => onVisibleChange(event.target.checked)}
        aria-label={`Show ${label}`}
      />
    </label>
  );
}

function settingMeta(setting) {
  if (setting?.sourceTimeframe) {
    const multiplier = Number.isFinite(setting.atrMultiplier) ? Number(setting.atrMultiplier).toFixed(2) : '--';
    return `TF ${setting.sourceTimeframe} / LB ${setting.lookback ?? '--'} / ATR ${setting.atrLength ?? '--'} x${multiplier}`;
  }

  return `Length ${setting?.length ?? '--'}`;
}

function settingFlagEnabled(setting, settingKey) {
  const aliases = {
    showOriginalResistance: ['showOriginalResistance', 'showResistance'],
    showOriginalSupport: ['showOriginalSupport', 'showSupport']
  };

  const keys = aliases[settingKey] || [settingKey];

  for (const key of keys) {
    if (setting?.[key] !== undefined) {
      return setting[key] !== false;
    }
  }

  return true;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function formatUnixTime(value) {
  if (!Number.isFinite(Number(value))) {
    return '--';
  }

  return new Date(Number(value) * 1000).toLocaleString();
}
