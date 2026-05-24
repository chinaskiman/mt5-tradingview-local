import { useEffect, useMemo, useState } from 'react';
import TradingDashboard from './chart/TradingDashboard.jsx';
import StatusBar from './components/StatusBar.jsx';
import IndicatorSettings from './components/IndicatorSettings.jsx';
import { createDashboardSocket } from './utils/wsClient.js';

const WS_URL = import.meta.env.VITE_DASHBOARD_WS_URL || 'ws://127.0.0.1:3001';
const PREFS_KEY = 'mt5-dashboard-ui-preferences';
const DEFAULT_PREFS = {
  settingsCollapsed: false,
  chartSpacing: 6,
  panelHeights: {
    price: 420,
    atr: 170,
    adx: 190,
    rsi: 170
  },
  visible: {
    smaFast: true,
    smaMid: true,
    smaSlow: true,
    atr: true,
    adx: true,
    diPlus: true,
    diMinus: true,
    rsi: true
  },
  collapsedPanels: {
    atr: false,
    adx: false,
    rsi: false
  }
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

  function updateVisibility(key, value) {
    setUiPrefs((current) => ({
      ...current,
      visible: {
        ...DEFAULT_PREFS.visible,
        ...current.visible,
        [key]: value
      }
    }));
  }

  function togglePanelCollapsed(panelId) {
    setUiPrefs((current) => ({
      ...current,
      collapsedPanels: {
        ...DEFAULT_PREFS.collapsedPanels,
        ...current.collapsedPanels,
        [panelId]: !(current.collapsedPanels?.[panelId] ?? DEFAULT_PREFS.collapsedPanels[panelId])
      }
    }));
  }

  function updatePanelHeight(panelId, height) {
    setUiPrefs((current) => ({
      ...current,
      panelHeights: {
        ...DEFAULT_PREFS.panelHeights,
        ...current.panelHeights,
        [panelId]: height
      }
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
        <TradingDashboard
          snapshot={snapshot}
          chartSpacing={uiPrefs.chartSpacing}
          visible={uiPrefs.visible}
          collapsedPanels={uiPrefs.collapsedPanels}
          panelHeights={uiPrefs.panelHeights}
          onTogglePanelCollapsed={togglePanelCollapsed}
          onPanelHeightChange={updatePanelHeight}
        />
        <IndicatorSettings
          snapshot={snapshot}
          collapsed={uiPrefs.settingsCollapsed}
          chartSpacing={uiPrefs.chartSpacing}
          visible={uiPrefs.visible}
          onToggleCollapsed={() => updatePreference('settingsCollapsed', !uiPrefs.settingsCollapsed)}
          onChartSpacingChange={(value) => updatePreference('chartSpacing', value)}
          onVisibilityChange={updateVisibility}
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
      chartSpacing: clamp(Number(parsed?.chartSpacing), 3, 14),
      panelHeights: normalizePanelHeights(parsed?.panelHeights),
      visible: {
        ...DEFAULT_PREFS.visible,
        ...parsed?.visible
      },
      collapsedPanels: {
        ...DEFAULT_PREFS.collapsedPanels,
        ...parsed?.collapsedPanels
      }
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function normalizePanelHeights(value) {
  return {
    price: clamp(Number(value?.price), 260, 900, DEFAULT_PREFS.panelHeights.price),
    atr: clamp(Number(value?.atr), 80, 520, DEFAULT_PREFS.panelHeights.atr),
    adx: clamp(Number(value?.adx), 90, 560, DEFAULT_PREFS.panelHeights.adx),
    rsi: clamp(Number(value?.rsi), 80, 520, DEFAULT_PREFS.panelHeights.rsi)
  };
}

function clamp(value, min, max, fallback = DEFAULT_PREFS.chartSpacing) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
