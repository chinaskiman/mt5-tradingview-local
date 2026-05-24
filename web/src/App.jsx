import { useEffect, useMemo, useState } from 'react';
import TradingDashboard from './chart/TradingDashboard.jsx';
import StatusBar from './components/StatusBar.jsx';
import IndicatorSettings from './components/IndicatorSettings.jsx';
import { createDashboardSocket } from './utils/wsClient.js';

const WS_URL = import.meta.env.VITE_DASHBOARD_WS_URL || 'ws://127.0.0.1:3001';
const PREFS_KEY = 'mt5-dashboard-ui-preferences';
const DEFAULT_PREFS = {
  settingsCollapsed: false,
  chartSpacing: 6
};

export default function App() {
  const [connectionState, setConnectionState] = useState('connecting');
  const [backendStatus, setBackendStatus] = useState('Waiting for backend');
  const [snapshot, setSnapshot] = useState(null);
  const [lastBackendUpdateAt, setLastBackendUpdateAt] = useState(null);
  const [uiPrefs, setUiPrefs] = useState(() => loadPreferences());

  useEffect(() => {
    const socket = createDashboardSocket({
      url: WS_URL,
      onOpen: () => {
        setConnectionState('connected');
        setBackendStatus('Backend connected; MT5 data not received yet');
      },
      onClose: () => {
        setConnectionState('disconnected');
        setBackendStatus('WebSocket disconnected; reconnecting to backend');
      },
      onError: () => {
        setConnectionState('error');
        setBackendStatus('Backend unavailable or WebSocket connection failed');
      },
      onReconnect: (attempt) => {
        setConnectionState('connecting');
        setBackendStatus(attempt > 0 ? `Reconnecting to backend (attempt ${attempt + 1})` : 'Connecting to backend');
      },
      onSnapshot: (nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setLastBackendUpdateAt(new Date());
        setBackendStatus(Array.isArray(nextSnapshot?.candles) && nextSnapshot.candles.length > 0
          ? 'MT5 snapshot received'
          : 'Invalid MT5 payload: no candles in payload');
      }
    });

    return () => socket.close();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(uiPrefs));
  }, [uiPrefs]);

  const meta = useMemo(() => ({
    symbol: snapshot?.symbol || '--',
    timeframe: snapshot?.timeframe || '--',
    candleCount: Array.isArray(snapshot?.candles) ? snapshot.candles.length : 0,
    lastClosedTime: snapshot?.lastClosedTime || null,
    backendUpdateTime: lastBackendUpdateAt?.toISOString() || null
  }), [snapshot, lastBackendUpdateAt]);

  function updatePreference(key, value) {
    setUiPrefs((current) => ({
      ...current,
      [key]: value
    }));
  }

  return (
    <main className="app-shell">
      <StatusBar
        connectionState={connectionState}
        backendStatus={backendStatus}
        symbol={meta.symbol}
        timeframe={meta.timeframe}
        candleCount={meta.candleCount}
        lastClosedTime={meta.lastClosedTime}
        backendUpdateTime={meta.backendUpdateTime}
      />

      {!snapshot ? (
        <div className="app-banner">
          {connectionState === 'connected'
            ? 'MT5 data not received yet. Start MT5, allow WebRequest, and attach the EA to a chart.'
            : 'Backend unavailable or WebSocket disconnected. Start the local server and keep this page open to auto-reconnect.'}
        </div>
      ) : null}

      <section className="workspace">
        <TradingDashboard snapshot={snapshot} chartSpacing={uiPrefs.chartSpacing} />
        <IndicatorSettings
          snapshot={snapshot}
          collapsed={uiPrefs.settingsCollapsed}
          chartSpacing={uiPrefs.chartSpacing}
          onToggleCollapsed={() => updatePreference('settingsCollapsed', !uiPrefs.settingsCollapsed)}
          onChartSpacingChange={(value) => updatePreference('chartSpacing', value)}
        />
      </section>
    </main>
  );
}

function loadPreferences() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY));

    return {
      ...DEFAULT_PREFS,
      ...parsed,
      chartSpacing: clamp(Number(parsed?.chartSpacing), 3, 14)
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREFS.chartSpacing;
  }

  return Math.min(max, Math.max(min, value));
}
