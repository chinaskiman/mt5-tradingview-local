import { useEffect, useMemo, useState } from 'react';
import TradingDashboard from './chart/TradingDashboard.jsx';
import StatusBar from './components/StatusBar.jsx';
import IndicatorSettings from './components/IndicatorSettings.jsx';
import RiskCalculator from './components/RiskCalculator.jsx';
import TradingMonitor from './components/TradingMonitor.jsx';
import { createDashboardSocket } from './utils/wsClient.js';

const WS_URL = import.meta.env.VITE_DASHBOARD_WS_URL || 'ws://127.0.0.1:3001';
const API_URL = import.meta.env.VITE_DASHBOARD_API_URL || wsToHttpUrl(WS_URL);
const PREFS_KEY = 'mt5-dashboard-ui-preferences';
const RISK_VERIFICATION_TIMEOUT_MS = 30000;
const DEFAULT_PREFS = {
  sidePanelOpen: true,
  sidePanelActive: 'monitor',
  tradingMonitorFilter: 'current',
  riskCalculator: {
    riskBasis: 'equity',
    riskMode: 'percent',
    riskValue: 1,
    orderSide: 'buy',
    entryPriceMode: 'market',
    manualEntryPrice: '',
    stopLossMode: 'price',
    stopLossPrice: '',
    stopDistancePoints: 100
  },
  autoScroll: true,
  layoutPreset: 'balanced',
  chartSpacing: 6,
  panelHeights: {
    price: 520,
    atr: 120,
    adx: 160,
    rsi: 120
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
  const [riskVerification, setRiskVerification] = useState({
    status: 'idle',
    requestId: null,
    requestSignature: null,
    result: null,
    error: null
  });
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
      },
      onRiskResult: (result) => {
        setRiskVerification((current) => {
          if (current.requestId && result?.requestId !== current.requestId) {
            return current;
          }

          return {
            ...current,
            status: result?.ok ? 'verified' : 'failed',
            requestId: result?.requestId || current.requestId,
            result,
            error: result?.ok ? null : result?.error || 'MT5 risk calculation failed.'
          };
        });
      }
    });

    return () => socket.close();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(uiPrefs));
  }, [uiPrefs]);

  useEffect(() => {
    if (!['queued', 'waiting'].includes(riskVerification.status) || !riskVerification.requestId) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setRiskVerification((current) => {
        if (current.requestId !== riskVerification.requestId || !['queued', 'waiting'].includes(current.status)) {
          return current;
        }

        return {
          ...current,
          status: 'failed',
          result: null,
          error: 'No MT5 verification response received. Check that the EA is running and command polling is enabled.'
        };
      });
    }, RISK_VERIFICATION_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [riskVerification.status, riskVerification.requestId]);

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

  function updateLayoutPreset(layoutPreset, panelHeights) {
    setUiPrefs((current) => ({
      ...current,
      layoutPreset,
      panelHeights: {
        ...DEFAULT_PREFS.panelHeights,
        ...current.panelHeights,
        ...panelHeights
      }
    }));
  }

  function updatePanelHeights(panelHeights) {
    setUiPrefs((current) => ({
      ...current,
      panelHeights: {
        ...DEFAULT_PREFS.panelHeights,
        ...current.panelHeights,
        ...panelHeights
      }
    }));
  }

  async function requestRiskVerification(payload) {
    const requestId = createRequestId();
    const requestSignature = createRiskRequestSignature(payload);
    const requestBody = {
      ...payload,
      requestId
    };

    setRiskVerification({ status: 'queued', requestId, requestSignature, result: null, error: null });

    try {
      const response = await fetch(`${API_URL}/risk/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `Risk calculation request failed with HTTP ${response.status}`);
      }

      setRiskVerification({ status: 'waiting', requestId, requestSignature, result: null, error: null });
    } catch (error) {
      setRiskVerification({
        status: 'failed',
        requestId,
        requestSignature,
        result: null,
        error: error instanceof Error ? error.message : 'Risk calculation request failed.'
      });
    }
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

      <section className={`workspace ${uiPrefs.sidePanelOpen ? '' : 'is-side-panel-collapsed'}`}>
        <TradingDashboard
          snapshot={snapshot}
          autoScroll={uiPrefs.autoScroll}
          layoutPreset={uiPrefs.layoutPreset}
          chartSpacing={uiPrefs.chartSpacing}
          visible={uiPrefs.visible}
          collapsedPanels={uiPrefs.collapsedPanels}
          panelHeights={uiPrefs.panelHeights}
          onAutoScrollChange={(value) => updatePreference('autoScroll', value)}
          onLayoutPresetChange={updateLayoutPreset}
          onPanelHeightsChange={updatePanelHeights}
          onTogglePanelCollapsed={togglePanelCollapsed}
        />
        <SidePanel
          open={uiPrefs.sidePanelOpen}
          active={uiPrefs.sidePanelActive}
          onToggleOpen={() => updatePreference('sidePanelOpen', !uiPrefs.sidePanelOpen)}
          onActiveChange={(value) => setUiPrefs((current) => ({
            ...current,
            sidePanelOpen: true,
            sidePanelActive: value
          }))}
        >
          {uiPrefs.sidePanelActive === 'monitor' ? (
            <TradingMonitor
              snapshot={snapshot}
              filter={uiPrefs.tradingMonitorFilter}
              onFilterChange={(value) => updatePreference('tradingMonitorFilter', value)}
            />
          ) : null}
          {uiPrefs.sidePanelActive === 'indicators' ? (
            <IndicatorSettings
              snapshot={snapshot}
              chartSpacing={uiPrefs.chartSpacing}
              visible={uiPrefs.visible}
              onChartSpacingChange={(value) => updatePreference('chartSpacing', value)}
              onVisibilityChange={updateVisibility}
            />
          ) : null}
          {uiPrefs.sidePanelActive === 'risk' ? (
            <RiskCalculator
              snapshot={snapshot}
              prefs={uiPrefs.riskCalculator}
              onPrefsChange={(value) => updatePreference('riskCalculator', value)}
              verification={riskVerification}
              onVerify={requestRiskVerification}
            />
          ) : null}
        </SidePanel>
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
      sidePanelOpen: parsed?.sidePanelOpen !== false,
      sidePanelActive: normalizeSidePanelActive(parsed?.sidePanelActive),
      tradingMonitorFilter: normalizeTradingMonitorFilter(parsed?.tradingMonitorFilter),
      riskCalculator: normalizeRiskCalculatorPrefs(parsed?.riskCalculator),
      autoScroll: parsed?.autoScroll !== false,
      layoutPreset: normalizeLayoutPreset(parsed?.layoutPreset),
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

function normalizeLayoutPreset(value) {
  return ['compact', 'balanced', 'largePrice'].includes(value) ? value : DEFAULT_PREFS.layoutPreset;
}

function normalizeTradingMonitorFilter(value) {
  return ['current', 'all'].includes(value) ? value : DEFAULT_PREFS.tradingMonitorFilter;
}

function normalizeSidePanelActive(value) {
  return ['monitor', 'indicators', 'risk'].includes(value) ? value : DEFAULT_PREFS.sidePanelActive;
}

function normalizeRiskCalculatorPrefs(value) {
  const defaults = DEFAULT_PREFS.riskCalculator;

  return {
    riskBasis: ['equity', 'balance'].includes(value?.riskBasis) ? value.riskBasis : defaults.riskBasis,
    riskMode: ['percent', 'fixed'].includes(value?.riskMode) ? value.riskMode : defaults.riskMode,
    riskValue: normalizePositiveInput(value?.riskValue, defaults.riskValue),
    orderSide: ['buy', 'sell'].includes(value?.orderSide) ? value.orderSide : defaults.orderSide,
    entryPriceMode: ['market', 'manual'].includes(value?.entryPriceMode) ? value.entryPriceMode : defaults.entryPriceMode,
    manualEntryPrice: normalizeTextInput(value?.manualEntryPrice),
    stopLossMode: ['price', 'points'].includes(value?.stopLossMode) ? value.stopLossMode : defaults.stopLossMode,
    stopLossPrice: normalizeTextInput(value?.stopLossPrice),
    stopDistancePoints: normalizePositiveInput(value?.stopDistancePoints, defaults.stopDistancePoints)
  };
}

function normalizePanelHeights(value) {
  return {
    price: clamp(Number(value?.price), 250, 1200, DEFAULT_PREFS.panelHeights.price),
    atr: clamp(Number(value?.atr), 90, 700, DEFAULT_PREFS.panelHeights.atr),
    adx: clamp(Number(value?.adx), 120, 800, DEFAULT_PREFS.panelHeights.adx),
    rsi: clamp(Number(value?.rsi), 90, 700, DEFAULT_PREFS.panelHeights.rsi)
  };
}

function clamp(value, min, max, fallback = DEFAULT_PREFS.chartSpacing) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizePositiveInput(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeTextInput(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function wsToHttpUrl(url) {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

function createRequestId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `risk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createRiskRequestSignature(payload) {
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

function SidePanel({ open, active, onToggleOpen, onActiveChange, children }) {
  const tabs = [
    ['monitor', 'Trading Monitor', 'Monitor'],
    ['indicators', 'Indicators', 'Ind'],
    ['risk', 'Risk Calculator', 'Risk']
  ];

  return (
    <aside className={`side-panel ${open ? '' : 'is-collapsed'}`} aria-label="Dashboard side panel">
      <div className="side-panel-tabs" role="tablist" aria-label="Dashboard sections">
        <button
          type="button"
          className="side-panel-toggle"
          onClick={onToggleOpen}
          title={open ? 'Close side panel' : 'Open side panel'}
          aria-label={open ? 'Close side panel' : 'Open side panel'}
        >
          {open ? '>' : '<'}
        </button>
        {tabs.map(([key, label, shortLabel]) => (
          <button
            key={key}
            type="button"
            className={`side-panel-tab ${active === key ? 'is-active' : ''}`}
            onClick={() => onActiveChange(key)}
            role="tab"
            aria-selected={active === key}
            title={label}
          >
            {open ? label : shortLabel}
          </button>
        ))}
      </div>
      {open ? <div className="side-panel-content">{children}</div> : null}
    </aside>
  );
}
