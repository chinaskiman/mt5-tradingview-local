import { useEffect, useMemo, useRef, useState } from 'react';
import TradingDashboard from './chart/TradingDashboard.jsx';
import StatusBar from './components/StatusBar.jsx';
import IndicatorSettings from './components/IndicatorSettings.jsx';
import OrderEntry from './components/OrderEntry.jsx';
import RiskCalculator from './components/RiskCalculator.jsx';
import TradingMonitor from './components/TradingMonitor.jsx';
import { createDashboardSocket } from './utils/wsClient.js';

const WS_URL = import.meta.env.VITE_DASHBOARD_WS_URL || 'ws://127.0.0.1:3001';
const API_URL = import.meta.env.VITE_DASHBOARD_API_URL || wsToHttpUrl(WS_URL);
const PREFS_KEY = 'mt5-dashboard-ui-preferences';
const RISK_VERIFICATION_TIMEOUT_MS = 30000;
const ORDER_PLACEMENT_TIMEOUT_MS = 30000;
const TRADE_MANAGEMENT_TIMEOUT_MS = 30000;
const DEFAULT_SIDE_PANEL_WIDTH = 390;
const MIN_SIDE_PANEL_WIDTH = 280;
const MAX_SIDE_PANEL_WIDTH = 560;
const DEFAULT_PREFS = {
  sidePanelOpen: true,
  sidePanelActive: 'monitor',
  sidePanelWidth: DEFAULT_SIDE_PANEL_WIDTH,
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
  orderEntry: {
    orderType: 'marketBuy',
    volumeMode: 'risk',
    manualVolume: '',
    entryPrice: '',
    requireStopLoss: true,
    stopLossPrice: '',
    takeProfitPrice: '',
    comment: '',
    magicNumber: 2026001
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
  const [orderPlacement, setOrderPlacement] = useState({
    status: 'idle',
    requestId: null,
    result: null,
    error: null,
    warnings: []
  });
  const [tradeManagement, setTradeManagement] = useState({
    status: 'idle',
    requestId: null,
    contextKey: null,
    commandType: null,
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
      },
      onOrderResult: (result) => {
        setOrderPlacement((current) => {
          if (!current.requestId || result?.requestId !== current.requestId) {
            return current;
          }

          const successStatus = result?.orderKind === 'LIMIT' ? 'placed' : 'filled';

          return {
            ...current,
            status: result?.ok ? successStatus : 'failed',
            requestId: result?.requestId || current.requestId,
            result,
            error: result?.ok ? null : result?.message || 'MT5 order placement failed.'
          };
        });
      },
      onTradeManagementResult: (result) => {
        setTradeManagement((current) => {
          if (!current.requestId || result?.requestId !== current.requestId) {
            return current;
          }

          return {
            ...current,
            status: result?.ok ? 'success' : 'failed',
            requestId: result?.requestId || current.requestId,
            commandType: result?.commandType || current.commandType,
            result,
            error: result?.ok ? null : result?.message || 'MT5 trade-management command failed.'
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

  useEffect(() => {
    if (!['sending', 'queued', 'waiting'].includes(orderPlacement.status) || !orderPlacement.requestId) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setOrderPlacement((current) => {
        if (current.requestId !== orderPlacement.requestId || !['sending', 'queued', 'waiting'].includes(current.status)) {
          return current;
        }

        return {
          ...current,
          status: 'failed',
          result: null,
          error: 'No MT5 order response received. Check that the EA is running, command polling is enabled, and MT5 Algo Trading is ON.'
        };
      });
    }, ORDER_PLACEMENT_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [orderPlacement.status, orderPlacement.requestId]);

  useEffect(() => {
    if (!['sending', 'queued', 'waiting'].includes(tradeManagement.status) || !tradeManagement.requestId) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setTradeManagement((current) => {
        if (current.requestId !== tradeManagement.requestId || !['sending', 'queued', 'waiting'].includes(current.status)) {
          return current;
        }

        return {
          ...current,
          status: 'failed',
          result: null,
          error: 'No MT5 trade-management response received. Check that the EA is running, command polling is enabled, backend ENABLE_TRADE_MANAGEMENT=true, and EA EnableTradeManagement=true.'
        };
      });
    }, TRADE_MANAGEMENT_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [tradeManagement.status, tradeManagement.requestId]);

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
        error: formatRiskRequestError(error)
      });
    }
  }

  async function requestOrderPlacement(payload) {
    const requestId = createRequestId('order');
    const requestBody = {
      ...payload,
      requestId
    };

    setOrderPlacement({ status: 'sending', requestId, result: null, error: null, warnings: [] });

    try {
      const response = await fetch(`${API_URL}/orders/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `Order placement request failed with HTTP ${response.status}`);
      }

      setOrderPlacement({
        status: 'queued',
        requestId,
        result: null,
        error: null,
        warnings: Array.isArray(body.warnings) ? body.warnings : []
      });

      window.setTimeout(() => {
        setOrderPlacement((current) => (
          current.requestId === requestId && current.status === 'queued'
            ? { ...current, status: 'waiting' }
            : current
        ));
      }, 350);
    } catch (error) {
      setOrderPlacement({
        status: 'failed',
        requestId,
        result: null,
        error: formatOrderRequestError(error),
        warnings: []
      });
    }
  }

  async function requestTradeManagement(payload) {
    const requestId = createRequestId('management');
    const { endpoint, commandType, contextKey, body } = payload;
    const requestBody = {
      ...body,
      requestId
    };

    setTradeManagement({
      status: 'sending',
      requestId,
      contextKey,
      commandType,
      result: null,
      error: null
    });

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const responseBody = await response.json().catch(() => null);

      if (!response.ok || !responseBody?.ok) {
        throw new Error(responseBody?.error || `Trade-management request failed with HTTP ${response.status}`);
      }

      setTradeManagement({
        status: 'queued',
        requestId,
        contextKey,
        commandType,
        result: null,
        error: null
      });

      window.setTimeout(() => {
        setTradeManagement((current) => (
          current.requestId === requestId && current.status === 'queued'
            ? { ...current, status: 'waiting' }
            : current
        ));
      }, 350);
    } catch (error) {
      setTradeManagement({
        status: 'failed',
        requestId,
        contextKey,
        commandType,
        result: null,
        error: formatTradeManagementRequestError(error)
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

      <section
        className={`workspace ${uiPrefs.sidePanelOpen ? '' : 'is-side-panel-collapsed'}`}
        style={{ '--side-panel-width': `${uiPrefs.sidePanelWidth}px` }}
      >
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
          width={uiPrefs.sidePanelWidth}
          onToggleOpen={() => updatePreference('sidePanelOpen', !uiPrefs.sidePanelOpen)}
          onWidthChange={(value) => updatePreference('sidePanelWidth', value)}
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
              tradeManagement={tradeManagement}
              onSendTradeManagement={requestTradeManagement}
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
          {uiPrefs.sidePanelActive === 'order' ? (
            <OrderEntry
              snapshot={snapshot}
              prefs={uiPrefs.orderEntry}
              onPrefsChange={(value) => updatePreference('orderEntry', value)}
              riskPrefs={uiPrefs.riskCalculator}
              riskVerification={riskVerification}
              orderPlacement={orderPlacement}
              onSendOrder={requestOrderPlacement}
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
      sidePanelWidth: clamp(Number(parsed?.sidePanelWidth), MIN_SIDE_PANEL_WIDTH, MAX_SIDE_PANEL_WIDTH, DEFAULT_SIDE_PANEL_WIDTH),
      tradingMonitorFilter: normalizeTradingMonitorFilter(parsed?.tradingMonitorFilter),
      riskCalculator: normalizeRiskCalculatorPrefs(parsed?.riskCalculator),
      orderEntry: normalizeOrderEntryPrefs(parsed?.orderEntry),
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
  return ['monitor', 'indicators', 'risk', 'order'].includes(value) ? value : DEFAULT_PREFS.sidePanelActive;
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

function normalizeOrderEntryPrefs(value) {
  const defaults = DEFAULT_PREFS.orderEntry;

  return {
    orderType: ['marketBuy', 'marketSell', 'buyLimit', 'sellLimit'].includes(value?.orderType) ? value.orderType : defaults.orderType,
    volumeMode: ['risk', 'manual'].includes(value?.volumeMode) ? value.volumeMode : defaults.volumeMode,
    manualVolume: normalizeTextInput(value?.manualVolume),
    entryPrice: normalizeTextInput(value?.entryPrice),
    requireStopLoss: value?.requireStopLoss !== false,
    stopLossPrice: normalizeTextInput(value?.stopLossPrice),
    takeProfitPrice: normalizeTextInput(value?.takeProfitPrice),
    comment: normalizeTextInput(value?.comment),
    magicNumber: normalizeIntegerInput(value?.magicNumber, defaults.magicNumber)
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

function normalizeIntegerInput(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function wsToHttpUrl(url) {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

function createRequestId(prefix = 'risk') {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function formatRiskRequestError(error) {
  const message = error instanceof Error ? error.message : '';

  if (message === 'Failed to fetch') {
    return 'Could not reach backend risk endpoint. Check that the backend is running, then refresh the browser and try again.';
  }

  return message || 'Risk calculation request failed.';
}

function formatOrderRequestError(error) {
  const message = error instanceof Error ? error.message : '';

  if (message === 'Failed to fetch') {
    return 'Could not reach backend order endpoint. Check that the backend is running, then refresh the browser and try again.';
  }

  return message || 'Order placement request failed.';
}

function formatTradeManagementRequestError(error) {
  const message = error instanceof Error ? error.message : '';

  if (message === 'Failed to fetch') {
    return 'Could not reach backend trade-management endpoint. Check that the backend is running, then refresh the browser and try again.';
  }

  return message || 'Trade-management request failed.';
}

function SidePanel({ open, active, width, onToggleOpen, onWidthChange, onActiveChange, children }) {
  const resizeRef = useRef(null);
  const tabs = [
    ['monitor', 'Trading Monitor', 'Monitor'],
    ['indicators', 'Indicators', 'Ind'],
    ['risk', 'Risk Calculator', 'Risk'],
    ['order', 'Order Entry', 'Order']
  ];

  useEffect(() => () => {
    const listeners = resizeRef.current?.listeners;
    if (listeners) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.stop);
      window.removeEventListener('pointercancel', listeners.stop);
    }
    document.body.classList.remove('is-resizing-side-panel');
  }, []);

  function startResize(event) {
    if (!open || (event.button !== undefined && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    const listeners = {
      move: (moveEvent) => {
        const delta = event.clientX - moveEvent.clientX;
        const nextWidth = clamp(width + delta, MIN_SIDE_PANEL_WIDTH, MAX_SIDE_PANEL_WIDTH, DEFAULT_SIDE_PANEL_WIDTH);
        onWidthChange(Math.round(nextWidth));
      },
      stop: () => {
        window.removeEventListener('pointermove', listeners.move);
        window.removeEventListener('pointerup', listeners.stop);
        window.removeEventListener('pointercancel', listeners.stop);
        document.body.classList.remove('is-resizing-side-panel');
        resizeRef.current = null;
        window.dispatchEvent(new Event('resize'));
      }
    };

    resizeRef.current = { listeners };
    document.body.classList.add('is-resizing-side-panel');
    window.addEventListener('pointermove', listeners.move);
    window.addEventListener('pointerup', listeners.stop, { once: true });
    window.addEventListener('pointercancel', listeners.stop, { once: true });
  }

  return (
    <aside className={`side-panel ${open ? '' : 'is-collapsed'}`} aria-label="Dashboard side panel">
      {open ? (
        <div
          className="side-panel-width-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          title="Drag to resize right panel"
          onPointerDown={startResize}
        />
      ) : null}
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
