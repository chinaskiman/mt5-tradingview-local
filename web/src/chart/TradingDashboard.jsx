import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, createChart } from 'lightweight-charts';

const PRICE_FORMAT = {
  type: 'price',
  precision: 5,
  minMove: 0.00001
};

const BASE_CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#0f141d' },
    textColor: '#9ca3af'
  },
  localization: {
    priceFormatter: (price) => Number(price).toFixed(5)
  },
  grid: {
    vertLines: { color: '#1e2835' },
    horzLines: { color: '#1e2835' }
  },
  rightPriceScale: {
    borderColor: '#263241',
    scaleMargins: {
      top: 0.14,
      bottom: 0.16
    }
  },
  timeScale: {
    borderColor: '#263241',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 4,
    fixLeftEdge: true,
    lockVisibleTimeRangeOnResize: true
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#2b3440'
    },
    horzLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#2b3440'
    }
  },
  handleScroll: true,
  handleScale: true
};

const COLORS = {
  up: '#26a69a',
  down: '#ef5350',
  smaFast: '#facc15',
  smaMid: '#38bdf8',
  smaSlow: '#c084fc',
  atr: '#f59e0b',
  adx: '#60a5fa',
  diPlus: '#22c55e',
  diMinus: '#ef4444',
  rsi: '#fb7185'
};

const PANEL_LIMITS = {
  price: { min: 260, max: 900 },
  atr: { min: 80, max: 520 },
  adx: { min: 90, max: 560 },
  rsi: { min: 80, max: 520 }
};

const DEFAULT_PANEL_HEIGHTS = {
  price: 420,
  atr: 170,
  adx: 190,
  rsi: 170
};

export default function TradingDashboard({
  snapshot,
  chartSpacing,
  visible,
  collapsedPanels,
  panelHeights,
  onTogglePanelCollapsed,
  onPanelHeightChange
}) {
  const dashboardRef = useRef(null);
  const priceRef = useRef(null);
  const atrRef = useRef(null);
  const adxRef = useRef(null);
  const rsiRef = useRef(null);
  const chartsRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const syncingRangeRef = useRef(false);
  const syncingCrosshairRef = useRef(false);
  const hasFitContentRef = useRef(false);
  const lastDatasetKeyRef = useRef(null);
  const lastChartIdentityRef = useRef(null);
  const lastDatasetMetaRef = useRef(null);
  const dataRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [fullscreenPanel, setFullscreenPanel] = useState(null);

  const seriesData = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);
  dataRef.current = seriesData;

  useEffect(() => {
    if (!priceRef.current || !atrRef.current || !adxRef.current || !rsiRef.current) {
      return undefined;
    }

    const priceChart = createPanelChart(priceRef.current, chartSpacing);
    const atrChart = createPanelChart(atrRef.current, chartSpacing);
    const adxChart = createPanelChart(adxRef.current, chartSpacing);
    const rsiChart = createPanelChart(rsiRef.current, chartSpacing);

    const priceSeries = priceChart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      priceFormat: PRICE_FORMAT
    });

    const smaFastSeries = priceChart.addLineSeries(lineOptions(COLORS.smaFast, 1));
    const smaMidSeries = priceChart.addLineSeries(lineOptions(COLORS.smaMid, 1));
    const smaSlowSeries = priceChart.addLineSeries(lineOptions(COLORS.smaSlow, 1));
    const atrSeries = atrChart.addLineSeries(lineOptions(COLORS.atr, 2));
    const adxSeries = adxChart.addLineSeries(lineOptions(COLORS.adx, 2));
    const plusDISeries = adxChart.addLineSeries(lineOptions(COLORS.diPlus, 1));
    const minusDISeries = adxChart.addLineSeries(lineOptions(COLORS.diMinus, 1));
    const rsiSeries = rsiChart.addLineSeries(lineOptions(COLORS.rsi, 2));
    const priceSyncSeries = priceChart.addLineSeries(syncSeriesOptions());
    const atrSyncSeries = atrChart.addLineSeries(syncSeriesOptions());
    const adxSyncSeries = adxChart.addLineSeries(syncSeriesOptions());
    const rsiSyncSeries = rsiChart.addLineSeries(syncSeriesOptions());

    const chartEntries = [
      { name: 'price', chart: priceChart, element: priceRef.current, primarySeries: priceSeries, primaryKey: 'price' },
      { name: 'atr', chart: atrChart, element: atrRef.current, primarySeries: atrSeries, primaryKey: 'atr' },
      { name: 'adx', chart: adxChart, element: adxRef.current, primarySeries: adxSeries, primaryKey: 'adx' },
      { name: 'rsi', chart: rsiChart, element: rsiRef.current, primarySeries: rsiSeries, primaryKey: 'rsi' }
    ];

    chartsRef.current = {
      entries: chartEntries,
      series: {
        priceSeries,
        smaFastSeries,
        smaMidSeries,
        smaSlowSeries,
        atrSeries,
        adxSeries,
        plusDISeries,
        minusDISeries,
        rsiSeries,
        priceSyncSeries,
        atrSyncSeries,
        adxSyncSeries,
        rsiSyncSeries
      },
      unsubscribers: []
    };

    for (const entry of chartEntries) {
      const rangeHandler = (range) => syncVisibleRange(entry.name, range);
      const crosshairHandler = (param) => syncCrosshair(entry.name, param);

      entry.chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
      entry.chart.subscribeCrosshairMove(crosshairHandler);

      chartsRef.current.unsubscribers.push(() => {
        entry.chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler);
        entry.chart.unsubscribeCrosshairMove(crosshairHandler);
      });
    }

    resizeObserverRef.current = new ResizeObserver(() => resizeAllCharts());

    for (const entry of chartEntries) {
      resizeObserverRef.current.observe(entry.element);
    }

    resizeAllCharts();

    return () => {
      for (const unsubscribe of chartsRef.current?.unsubscribers || []) {
        unsubscribe();
      }

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      priceChart.remove();
      atrChart.remove();
      adxChart.remove();
      rsiChart.remove();
      chartsRef.current = null;
      hasFitContentRef.current = false;
      lastDatasetKeyRef.current = null;
      lastChartIdentityRef.current = null;
      lastDatasetMetaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    const datasetMeta = {
      firstTime: seriesData.candles[0]?.time || null,
      lastTime: seriesData.candles.at(-1)?.time || null,
      length: seriesData.candles.length
    };
    const previousDatasetMeta = lastDatasetMetaRef.current;
    const datasetKey = [
      snapshot?.symbol || '',
      snapshot?.timeframe || '',
      datasetMeta.firstTime || '',
      datasetMeta.lastTime || '',
      datasetMeta.length
    ].join('|');
    const chartIdentity = `${snapshot?.symbol || ''}|${snapshot?.timeframe || ''}`;
    const datasetChanged = datasetKey !== lastDatasetKeyRef.current;
    const shouldResetRange = datasetChanged && (
      lastDatasetKeyRef.current === null ||
      chartIdentity !== lastChartIdentityRef.current ||
      datasetMeta.firstTime !== previousDatasetMeta?.firstTime ||
      datasetMeta.length < (previousDatasetMeta?.length || 0)
    );

    const settings = snapshot?.settings || {};
    chartsState.series.priceSyncSeries.setData(seriesData.timeScale);
    chartsState.series.atrSyncSeries.setData(seriesData.timeScale);
    chartsState.series.adxSyncSeries.setData(seriesData.timeScale);
    chartsState.series.rsiSyncSeries.setData(seriesData.timeScale);
    chartsState.series.priceSeries.setData(seriesData.candles);
    chartsState.series.smaFastSeries.setData(isEnabled(settings.smaFast) && isVisible(visible, 'smaFast') ? seriesData.smaFast : []);
    chartsState.series.smaMidSeries.setData(isEnabled(settings.smaMid) && isVisible(visible, 'smaMid') ? seriesData.smaMid : []);
    chartsState.series.smaSlowSeries.setData(isEnabled(settings.smaSlow) && isVisible(visible, 'smaSlow') ? seriesData.smaSlow : []);
    chartsState.series.atrSeries.setData(isEnabled(settings.atr) && isVisible(visible, 'atr') ? seriesData.atr : []);
    chartsState.series.adxSeries.setData(isEnabled(settings.adx) && isVisible(visible, 'adx') ? seriesData.adx : []);
    chartsState.series.plusDISeries.setData(isEnabled(settings.di) && isVisible(visible, 'diPlus') ? seriesData.plusDI : []);
    chartsState.series.minusDISeries.setData(isEnabled(settings.di) && isVisible(visible, 'diMinus') ? seriesData.minusDI : []);
    chartsState.series.rsiSeries.setData(isEnabled(settings.rsi) && isVisible(visible, 'rsi') ? seriesData.rsi : []);

    if (!seriesData.candles.length) {
      applyToAllTimeScales((timeScale) => timeScale.fitContent());
      hasFitContentRef.current = false;
      lastDatasetKeyRef.current = datasetKey;
      lastChartIdentityRef.current = chartIdentity;
      lastDatasetMetaRef.current = datasetMeta;
      return;
    }

    if (!hasFitContentRef.current || shouldResetRange) {
      applyToAllTimeScales((timeScale) => timeScale.fitContent());
      hasFitContentRef.current = true;
    }

    lastDatasetKeyRef.current = datasetKey;
    lastChartIdentityRef.current = chartIdentity;
    lastDatasetMetaRef.current = datasetMeta;
  }, [seriesData, snapshot, visible]);

  useEffect(() => {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    for (const entry of chartsState.entries) {
      entry.chart.applyOptions({
        timeScale: {
          barSpacing: chartSpacing
        }
      });
    }
  }, [chartSpacing]);

  useEffect(() => {
    window.requestAnimationFrame(() => resizeAllCharts());
  }, [fullscreenPanel, visible, collapsedPanels, panelHeights]);

  useEffect(() => () => stopPanelResize(), []);

  const hasSnapshot = Boolean(snapshot);
  const settings = snapshot?.settings || {};
  const showAtrPanel = isEnabled(settings.atr) && isVisible(visible, 'atr');
  const showAdxPanel = (isEnabled(settings.adx) && isVisible(visible, 'adx')) ||
    (isEnabled(settings.di) && (isVisible(visible, 'diPlus') || isVisible(visible, 'diMinus')));
  const showRsiPanel = isEnabled(settings.rsi) && isVisible(visible, 'rsi');
  const isAtrCollapsed = Boolean(collapsedPanels?.atr);
  const isAdxCollapsed = Boolean(collapsedPanels?.adx);
  const isRsiCollapsed = Boolean(collapsedPanels?.rsi);
  const heights = normalizePanelHeights(panelHeights);
  const dashboardRows = [
    `minmax(${heights.price}px, 1fr)`,
    showAtrPanel ? collapsedRow(isAtrCollapsed, heights.atr) : null,
    showAdxPanel ? collapsedRow(isAdxCollapsed, heights.adx) : null,
    showRsiPanel ? collapsedRow(isRsiCollapsed, heights.rsi) : null
  ].filter(Boolean).join(' ');

  return (
    <section ref={dashboardRef} className="dashboard" style={{ gridTemplateRows: dashboardRows }} aria-label="MT5 chart dashboard">
      <ChartPanel
        id="price"
        title="Price"
        subtitle={priceLegend(settings, visible, seriesData)}
        hostRef={priceRef}
        isEmpty={!hasSnapshot || !seriesData.candles.length}
        emptyText="Waiting for MT5 data..."
        fullscreenPanel={fullscreenPanel}
        onToggleFullscreen={toggleFullscreen}
        onResizeStart={beginPanelResize}
      />
      <ChartPanel
        id="atr"
        title="ATR"
        subtitle={indicatorLegend(settings.atr, 'ATR', seriesData.latest.atr)}
        hostRef={atrRef}
        hidden={!showAtrPanel}
        collapsed={isAtrCollapsed}
        collapsible
        isEmpty={hasSnapshot && !seriesData.atr.length}
        emptyText="No ATR values in the latest MT5 snapshot"
        fullscreenPanel={fullscreenPanel}
        onToggleFullscreen={toggleFullscreen}
        onToggleCollapsed={() => onTogglePanelCollapsed('atr')}
        onResizeStart={beginPanelResize}
      />
      <ChartPanel
        id="adx"
        title="ADX / DI"
        subtitle={diLegend(settings, visible, seriesData.latest)}
        hostRef={adxRef}
        hidden={!showAdxPanel}
        collapsed={isAdxCollapsed}
        collapsible
        isEmpty={hasSnapshot && !seriesData.adx.length && !seriesData.plusDI.length && !seriesData.minusDI.length}
        emptyText="No ADX or DI values in the latest MT5 snapshot"
        fullscreenPanel={fullscreenPanel}
        onToggleFullscreen={toggleFullscreen}
        onToggleCollapsed={() => onTogglePanelCollapsed('adx')}
        onResizeStart={beginPanelResize}
      />
      <ChartPanel
        id="rsi"
        title="RSI"
        subtitle={indicatorLegend(settings.rsi, 'RSI', seriesData.latest.rsi)}
        hostRef={rsiRef}
        hidden={!showRsiPanel}
        collapsed={isRsiCollapsed}
        collapsible
        isEmpty={hasSnapshot && !seriesData.rsi.length}
        emptyText="No RSI values in the latest MT5 snapshot"
        fullscreenPanel={fullscreenPanel}
        onToggleFullscreen={toggleFullscreen}
        onToggleCollapsed={() => onTogglePanelCollapsed('rsi')}
        onResizeStart={beginPanelResize}
      />
    </section>
  );

  function toggleFullscreen(panelId) {
    setFullscreenPanel((current) => (current === panelId ? null : panelId));
  }

  function beginPanelResize(panelId, event) {
    if (!onPanelHeightChange || fullscreenPanel) {
      return;
    }

    const panel = event.currentTarget.closest('.chart-panel');
    if (!panel) {
      return;
    }

    event.preventDefault();
    resizeDragRef.current = {
      panelId,
      startY: event.clientY,
      startHeight: panel.getBoundingClientRect().height
    };

    document.body.classList.add('is-resizing-panel');
    window.addEventListener('pointermove', handlePanelResize);
    window.addEventListener('pointerup', stopPanelResize, { once: true });
    window.addEventListener('pointercancel', stopPanelResize, { once: true });
  }

  function handlePanelResize(event) {
    const drag = resizeDragRef.current;
    if (!drag) {
      return;
    }

    const limits = PANEL_LIMITS[drag.panelId] || PANEL_LIMITS.price;
    const nextHeight = clampNumber(drag.startHeight + event.clientY - drag.startY, limits.min, limits.max);
    onPanelHeightChange(drag.panelId, Math.round(nextHeight));
    window.requestAnimationFrame(() => resizeAllCharts());
  }

  function stopPanelResize() {
    resizeDragRef.current = null;
    document.body.classList.remove('is-resizing-panel');
    window.removeEventListener('pointermove', handlePanelResize);
    window.removeEventListener('pointerup', stopPanelResize);
    window.removeEventListener('pointercancel', stopPanelResize);
    window.requestAnimationFrame(() => resizeAllCharts());
  }

  function syncVisibleRange(sourceName, range) {
    const chartsState = chartsRef.current;
    if (!chartsState || syncingRangeRef.current) {
      return;
    }

    beginRangeSync();

    for (const entry of chartsState.entries) {
      if (entry.name !== sourceName) {
        if (range) {
          entry.chart.timeScale().setVisibleLogicalRange(range);
        } else {
          entry.chart.timeScale().fitContent();
        }
      }
    }
  }

  function syncCrosshair(sourceName, param) {
    const chartsState = chartsRef.current;
    if (!chartsState || syncingCrosshairRef.current) {
      return;
    }

    if (!param?.time || !param.point || param.point.x < 0 || param.point.y < 0) {
      clearCrosshairs(sourceName);
      return;
    }

    const data = dataRef.current;
    syncingCrosshairRef.current = true;

    for (const entry of chartsState.entries) {
      if (entry.name === sourceName) {
        continue;
      }

      const value = data.lookup[entry.primaryKey].get(param.time);
      if (Number.isFinite(value)) {
        entry.chart.setCrosshairPosition?.(value, param.time, entry.primarySeries);
      } else {
        entry.chart.clearCrosshairPosition?.();
      }
    }

    syncingCrosshairRef.current = false;
  }

  function clearCrosshairs(sourceName) {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    syncingCrosshairRef.current = true;
    for (const entry of chartsState.entries) {
      if (entry.name !== sourceName) {
        entry.chart.clearCrosshairPosition?.();
      }
    }
    syncingCrosshairRef.current = false;
  }

  function applyToAllTimeScales(callback) {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    beginRangeSync();
    for (const entry of chartsState.entries) {
      callback(entry.chart.timeScale());
    }
  }

  function beginRangeSync() {
    syncingRangeRef.current = true;

    window.requestAnimationFrame(() => {
      syncingRangeRef.current = false;
    });
  }

  function resizeAllCharts() {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    for (const entry of chartsState.entries) {
      resizeChart(entry.chart, entry.element);
    }
  }
}

function ChartPanel({
  id,
  title,
  subtitle,
  hostRef,
  hidden,
  collapsed,
  collapsible,
  isEmpty,
  emptyText,
  fullscreenPanel,
  onToggleFullscreen,
  onToggleCollapsed,
  onResizeStart
}) {
  const isFullscreen = fullscreenPanel === id;
  const className = [
    'chart-panel',
    hidden ? 'is-hidden' : '',
    collapsed ? 'is-collapsed' : '',
    isFullscreen ? 'is-fullscreen' : ''
  ].filter(Boolean).join(' ');
  const collapsedProps = collapsed && collapsible ? {
    role: 'button',
    tabIndex: 0,
    title: 'Expand panel chart',
    onClick: () => onToggleCollapsed?.(),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggleCollapsed?.();
      }
    }
  } : {};

  return (
    <div className={className} {...collapsedProps}>
      <div className="chart-title">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {!collapsed ? (
        <div className="panel-actions">
          {collapsible ? (
            <button
              type="button"
              className="panel-action"
              onClick={onToggleCollapsed}
              title="Collapse panel to latest values"
            >
              Collapse
            </button>
          ) : null}
          <button
            type="button"
            className="panel-action"
            onClick={() => onToggleFullscreen(id)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen panel'}
          >
            {isFullscreen ? 'Exit' : 'Full'}
          </button>
        </div>
      ) : null}
      <div ref={hostRef} className="chart-host" />
      {isEmpty && !collapsed ? <div className="empty-state">{emptyText}</div> : null}
      {!hidden && !collapsed && !isFullscreen ? (
        <div
          className="panel-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title} panel`}
          tabIndex={0}
          onPointerDown={(event) => onResizeStart?.(id, event)}
        />
      ) : null}
    </div>
  );
}

function createPanelChart(element, chartSpacing) {
  return createChart(element, {
    ...BASE_CHART_OPTIONS,
    width: element.clientWidth,
    height: element.clientHeight,
    timeScale: {
      ...BASE_CHART_OPTIONS.timeScale,
      barSpacing: chartSpacing
    }
  });
}

function lineOptions(color, lineWidth) {
  return {
    color,
    lineWidth,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: PRICE_FORMAT
  };
}

function syncSeriesOptions() {
  return {
    color: 'rgba(0, 0, 0, 0)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: PRICE_FORMAT
  };
}

function normalizeSnapshot(snapshot) {
  const candles = normalizeCandles(snapshot?.candles);
  const timeScale = candles.map((candle) => ({ time: candle.time }));
  const smaFast = normalizeLine(snapshot?.candles, 'smaFast');
  const smaMid = normalizeLine(snapshot?.candles, 'smaMid');
  const smaSlow = normalizeLine(snapshot?.candles, 'smaSlow');
  const atr = normalizeLine(snapshot?.candles, 'atr');
  const adx = normalizeLine(snapshot?.candles, 'adx');
  const plusDI = normalizeLine(snapshot?.candles, 'diPlus');
  const minusDI = normalizeLine(snapshot?.candles, 'diMinus');
  const rsi = normalizeLine(snapshot?.candles, 'rsi');

  return {
    candles,
    timeScale,
    smaFast,
    smaMid,
    smaSlow,
    atr,
    adx,
    plusDI,
    minusDI,
    rsi,
    latest: {
      close: latestValue(candles, 'close'),
      atr: latestValue(atr, 'value'),
      adx: latestValue(adx, 'value'),
      plusDI: latestValue(plusDI, 'value'),
      minusDI: latestValue(minusDI, 'value'),
      rsi: latestValue(rsi, 'value')
    },
    lookup: {
      price: createLookup(candles, 'close'),
      atr: createLookup(atr, 'value'),
      adx: createLookup(adx, 'value'),
      rsi: createLookup(rsi, 'value')
    }
  };
}

function normalizeCandles(candles) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles
    .map((bar) => ({
      time: normalizeTime(bar.time),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close)
    }))
    .filter((bar) => bar.time && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

function normalizeLine(candles, candleField) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles
    .filter((candle) => candle[candleField] !== null && candle[candleField] !== undefined)
    .map((candle) => ({
      time: normalizeTime(candle.time),
      value: Number(candle[candleField])
    }))
    .filter((point) => point.time && Number.isFinite(point.value));
}

function normalizeTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function createLookup(data, valueField) {
  const map = new Map();

  for (const item of data) {
    map.set(item.time, item[valueField]);
  }

  return map;
}

function isEnabled(setting) {
  return setting?.enabled !== false;
}

function isVisible(visible, key) {
  return visible?.[key] !== false;
}

function priceLegend(settings, visible, seriesData) {
  const labels = [];

  if (isEnabled(settings.smaFast) && isVisible(visible, 'smaFast')) labels.push('SMA Fast');
  if (isEnabled(settings.smaMid) && isVisible(visible, 'smaMid')) labels.push('SMA Mid');
  if (isEnabled(settings.smaSlow) && isVisible(visible, 'smaSlow')) labels.push('SMA Slow');

  const close = formatValue(seriesData.latest.close);
  const layerText = labels.length ? labels.join(' / ') : 'Candles only';

  return close === '--' ? layerText : `Close ${close} | ${layerText}`;
}

function indicatorLegend(setting, label, value) {
  return isEnabled(setting) ? `${label} ${formatValue(value)}` : `${label} disabled in MT5`;
}

function diLegend(settings, visible, latest) {
  const labels = [];

  if (isEnabled(settings.adx) && isVisible(visible, 'adx')) labels.push(`ADX ${formatValue(latest.adx)}`);
  if (isEnabled(settings.di) && isVisible(visible, 'diPlus')) labels.push(`DI+ ${formatValue(latest.plusDI)}`);
  if (isEnabled(settings.di) && isVisible(visible, 'diMinus')) labels.push(`DI- ${formatValue(latest.minusDI)}`);

  return labels.length ? labels.join(' / ') : 'Hidden';
}

function latestValue(data, valueField) {
  if (!Array.isArray(data) || !data.length) {
    return null;
  }

  return data[data.length - 1]?.[valueField] ?? null;
}

function formatValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(5) : '--';
}

function collapsedRow(collapsed, expandedSize) {
  return collapsed ? '44px' : `${expandedSize}px`;
}

function normalizePanelHeights(panelHeights) {
  return {
    price: panelHeight(panelHeights, 'price'),
    atr: panelHeight(panelHeights, 'atr'),
    adx: panelHeight(panelHeights, 'adx'),
    rsi: panelHeight(panelHeights, 'rsi')
  };
}

function panelHeight(panelHeights, panelId) {
  const limits = PANEL_LIMITS[panelId];
  const fallback = DEFAULT_PANEL_HEIGHTS[panelId];
  return clampNumber(Number(panelHeights?.[panelId]), limits.min, limits.max, fallback);
}

function clampNumber(value, min, max, fallback = min) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function resizeChart(chart, element) {
  if (!element) {
    return;
  }

  chart.applyOptions({
    width: element.clientWidth,
    height: element.clientHeight
  });
}
