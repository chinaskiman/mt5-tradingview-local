const INDICATOR_ROWS = [
  ['SMA Fast', 'smaFast'],
  ['SMA Mid', 'smaMid'],
  ['SMA Slow', 'smaSlow'],
  ['ATR', 'atr'],
  ['ADX', 'adx'],
  ['DI', 'di']
];

export default function IndicatorSettings({
  snapshot,
  collapsed,
  chartSpacing,
  onToggleCollapsed,
  onChartSpacingChange
}) {
  const settings = snapshot?.settings || {};

  return (
    <aside className={`settings-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="Indicator settings">
      <div className="settings-header">
        <h2>Indicators</h2>
        <button type="button" className="icon-button" onClick={onToggleCollapsed} title={collapsed ? 'Expand settings' : 'Collapse settings'}>
          {collapsed ? '>' : '<'}
        </button>
      </div>

      {collapsed ? null : (
        <>
          <p className="settings-note">Indicator settings are controlled from the MT5 EA inputs.</p>

          <div className="indicator-list">
            {INDICATOR_ROWS.map(([label, key]) => (
              <IndicatorRow key={key} label={label} setting={settings[key]} />
            ))}
          </div>

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
        </>
      )}
    </aside>
  );
}

function IndicatorRow({ label, setting }) {
  const enabled = Boolean(setting?.enabled);
  const length = setting?.length ?? '--';

  return (
    <div className="indicator-row">
      <span className={`indicator-state ${enabled ? 'enabled' : 'disabled'}`} />
      <span className="indicator-name">{label}</span>
      <span className="indicator-meta">{enabled ? `Length ${length}` : 'Disabled'}</span>
    </div>
  );
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
