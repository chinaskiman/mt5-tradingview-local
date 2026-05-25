import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, createChart } from 'lightweight-charts';
import { CHART_COLORS, INDICATOR_COLORS } from '../utils/chartColors.js';

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

const PANEL_PRESETS = {
  compact: {
    label: 'Compact',
    price: 60,
    atr: 15,
    adx: 25,
    rsi: 15
  },
  balanced: {
    label: 'Balanced',
    price: 65,
    atr: 15,
    adx: 20,
    rsi: 15
  },
  largePrice: {
    label: 'Large Price',
    price: 75,
    atr: 10,
    adx: 15,
    rsi: 10
  }
};

const DEFAULT_PANEL_HEIGHTS = {
  price: 520,
  atr: 120,
  adx: 160,
  rsi: 120
};

const MIN_PANEL_HEIGHTS = {
  price: 250,
  atr: 90,
  adx: 120,
  rsi: 90
};

const COLLAPSED_PANEL_HEIGHT = 44;
const RESIZE_HANDLE_HEIGHT = 7;

export default function TradingDashboard({
  snapshot,
  autoScroll,
  layoutPreset,
  chartSpacing,
  visible,
  collapsedPanels,
  panelHeights,
  onAutoScrollChange,
  onLayoutPresetChange,
  onPanelHeightsChange,
  onTogglePanelCollapsed
}) {
  const dashboardRef = useRef(null);
  const priceRef = useRef(null);
  const atrRef = useRef(null);
  const adxRef = useRef(null);
  const rsiRef = useRef(null);
  const priceCrosshairRef = useRef(null);
  const atrCrosshairRef = useRef(null);
  const adxCrosshairRef = useRef(null);
  const rsiCrosshairRef = useRef(null);
  const chartsRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const syncingRangeRef = useRef(false);
  const rangeSyncFrameRef = useRef(null);
  const lastLogicalRangeRef = useRef(null);
  const lastTimeRangeRef = useRef(null);
  const syncingCrosshairRef = useRef(false);
  const activeCrosshairTimeRef = useRef(null);
  const activeCrosshairCoordinateRef = useRef(null);
  const hasFitContentRef = useRef(false);
  const lastDatasetKeyRef = useRef(null);
  const lastChartIdentityRef = useRef(null);
  const lastDatasetMetaRef = useRef(null);
  const dataRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [fullscreenPanel, setFullscreenPanel] = useState(null);
  const [dashboardHeight, setDashboardHeight] = useState(0);
  const [draftPanelHeights, setDraftPanelHeights] = useState(null);
  const [crosshairTime, setCrosshairTime] = useState(null);

  const seriesData = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);
  dataRef.current = seriesData;

  useEffect(() => {
    if (!dashboardRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      setDashboardHeight(Math.floor(entry.contentRect.height));
    });

    observer.observe(dashboardRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!priceRef.current || !atrRef.current || !adxRef.current || !rsiRef.current) {
      return undefined;
    }

    const priceChart = createPanelChart(priceRef.current, chartSpacing);
    const atrChart = createPanelChart(atrRef.current, chartSpacing);
    const adxChart = createPanelChart(adxRef.current, chartSpacing);
    const rsiChart = createPanelChart(rsiRef.current, chartSpacing);

    const priceSeries = priceChart.addCandlestickSeries({
      upColor: CHART_COLORS.up,
      downColor: CHART_COLORS.down,
      borderVisible: false,
      wickUpColor: CHART_COLORS.up,
      wickDownColor: CHART_COLORS.down,
      priceFormat: PRICE_FORMAT
    });

    const smaFastSeries = priceChart.addLineSeries(lineOptions(INDICATOR_COLORS.smaFast, 1));
    const smaMidSeries = priceChart.addLineSeries(lineOptions(INDICATOR_COLORS.smaMid, 1));
    const smaSlowSeries = priceChart.addLineSeries(lineOptions(INDICATOR_COLORS.smaSlow, 1));
    const atrSeries = atrChart.addLineSeries(lineOptions(INDICATOR_COLORS.atr, 2));
    const adxSeries = adxChart.addLineSeries(lineOptions(INDICATOR_COLORS.adx, 2));
    const plusDISeries = adxChart.addLineSeries(lineOptions(INDICATOR_COLORS.diPlus, 1));
    const minusDISeries = adxChart.addLineSeries(lineOptions(INDICATOR_COLORS.diMinus, 1));
    const rsiSeries = rsiChart.addLineSeries(lineOptions(INDICATOR_COLORS.rsi, 2));
    const priceSyncSeries = priceChart.addLineSeries(syncSeriesOptions());
    const atrSyncSeries = atrChart.addLineSeries(syncSeriesOptions());
    const adxSyncSeries = adxChart.addLineSeries(syncSeriesOptions());
    const rsiSyncSeries = rsiChart.addLineSeries(syncSeriesOptions());

    const chartEntries = [
      { name: 'price', chart: priceChart, element: priceRef.current, crosshairElement: priceCrosshairRef.current, primarySeries: priceSeries, primaryKey: 'price' },
      { name: 'atr', chart: atrChart, element: atrRef.current, crosshairElement: atrCrosshairRef.current, primarySeries: atrSeries, primaryKey: 'atr' },
      { name: 'adx', chart: adxChart, element: adxRef.current, crosshairElement: adxCrosshairRef.current, primarySeries: adxSeries, primaryKey: 'adx' },
      { name: 'rsi', chart: rsiChart, element: rsiRef.current, crosshairElement: rsiCrosshairRef.current, primarySeries: rsiSeries, primaryKey: 'rsi' }
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
      const rangeHandler = (range) => handleVisibleRangeChange(entry.name, range);
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
      if (rangeSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(rangeSyncFrameRef.current);
        rangeSyncFrameRef.current = null;
      }

      priceChart.remove();
      atrChart.remove();
      adxChart.remove();
      rsiChart.remove();
      chartsRef.current = null;
      hasFitContentRef.current = false;
      lastDatasetKeyRef.current = null;
      lastChartIdentityRef.current = null;
      lastDatasetMetaRef.current = null;
      lastLogicalRangeRef.current = null;
      lastTimeRangeRef.current = null;
      activeCrosshairTimeRef.current = null;
      activeCrosshairCoordinateRef.current = null;
      setCrosshairTime(null);
    };
  }, []);

  useEffect(() => () => {
    const listeners = resizeDragRef.current?.listeners;
    if (listeners) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.stop);
      window.removeEventListener('pointercancel', listeners.stop);
    }
    document.body.classList.remove('is-resizing-panel');
    resizeDragRef.current = null;
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
      datasetMeta.length < (previousDatasetMeta?.length || 0)
    );
    const capturedLogicalRange = getCurrentLogicalRange('price') || lastLogicalRangeRef.current;
    const capturedTimeRange = getCurrentTimeRange('price') || lastTimeRangeRef.current;

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
      lastLogicalRangeRef.current = null;
      lastTimeRangeRef.current = null;
      clearCrosshairs();
      return;
    }

    if (!hasFitContentRef.current || shouldResetRange) {
      applyDefaultVisibleRange();
      hasFitContentRef.current = true;
    } else if (autoScroll && datasetChanged) {
      scrollAllToLatest();
    } else if (!autoScroll && capturedLogicalRange) {
      // Snapshot updates replace every series. When Auto-scroll is OFF, restore
      // the visible logical range captured from the price chart before setData
      // so MT5 updates do not pull the user back to the newest candle.
      applyVisibleLogicalRange(capturedLogicalRange, null, { rememberTimeRange: true });
    } else if (!autoScroll && capturedTimeRange) {
      preserveVisibleTimeRange(capturedTimeRange);
    } else if (lastLogicalRangeRef.current) {
      applyVisibleLogicalRange(lastLogicalRangeRef.current, null, { rememberTimeRange: true });
    }

    lastDatasetKeyRef.current = datasetKey;
    lastChartIdentityRef.current = chartIdentity;
    lastDatasetMetaRef.current = datasetMeta;
  }, [seriesData, snapshot, visible, autoScroll]);

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
    // Preset/collapse/fullscreen changes alter container geometry only. Resize
    // all Lightweight Charts instances and then restore the remembered visible
    // logical range so panel sizing never changes the user's time window.
    window.requestAnimationFrame(() => resizeAllCharts());
  }, [fullscreenPanel, visible, collapsedPanels, layoutPreset, panelHeights, draftPanelHeights, dashboardHeight]);

  const hasSnapshot = Boolean(snapshot);
  const settings = snapshot?.settings || {};
  const showAtrPanel = isEnabled(settings.atr) && isVisible(visible, 'atr');
  const showAdxPanel = (isEnabled(settings.adx) && isVisible(visible, 'adx')) ||
    (isEnabled(settings.di) && (isVisible(visible, 'diPlus') || isVisible(visible, 'diMinus')));
  const showRsiPanel = isEnabled(settings.rsi) && isVisible(visible, 'rsi');
  const isAtrCollapsed = Boolean(collapsedPanels?.atr);
  const isAdxCollapsed = Boolean(collapsedPanels?.adx);
  const isRsiCollapsed = Boolean(collapsedPanels?.rsi);
  const displayedValues = crosshairTime ? valuesAtTime(seriesData, crosshairTime) : seriesData.latest;
  const showCrosshairReadouts = Boolean(crosshairTime);
  const panelLayout = resolvePanelLayout({
    panelHeights: draftPanelHeights || panelHeights,
    dashboardHeight,
    showAtrPanel,
    showAdxPanel,
    showRsiPanel,
    isAtrCollapsed,
    isAdxCollapsed,
    isRsiCollapsed
  });
  const dashboardRows = panelLayout.rows.join(' ');

  return (
    <section className="dashboard-shell" aria-label="MT5 chart dashboard">
      <ChartToolbar
        autoScroll={autoScroll}
        layoutPreset={layoutPreset}
        disabled={!seriesData.candles.length}
        onAutoScrollChange={onAutoScrollChange}
        onLayoutPresetChange={applyLayoutPreset}
        onFitContent={fitAllContent}
        onGoToLatest={scrollAllToLatest}
        onResetView={applyDefaultVisibleRange}
      />

      <div ref={dashboardRef} className="dashboard" style={{ gridTemplateRows: dashboardRows }}>
        <ChartPanel
          id="price"
          title="Price"
          subtitle={priceLegend(settings, visible, displayedValues)}
          crosshairReadout={showCrosshairReadouts ? priceCrosshairReadout(displayedValues) : null}
          hostRef={priceRef}
          crosshairRef={priceCrosshairRef}
          isEmpty={!hasSnapshot || !seriesData.candles.length}
          emptyText="Waiting for MT5 data..."
          fullscreenPanel={fullscreenPanel}
          onToggleFullscreen={toggleFullscreen}
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={clearCrosshairs}
        />
        {panelLayout.handles.priceAtr ? (
          <ResizeHandle id="price-atr" label="Resize price and ATR panels" onPointerDown={startPanelResize} />
        ) : null}
        <ChartPanel
          id="atr"
          title="ATR"
          subtitle={indicatorLegend(settings.atr, 'ATR', displayedValues.atr)}
          crosshairReadout={showCrosshairReadouts ? indicatorCrosshairReadout(settings.atr, 'ATR', displayedValues.atr, INDICATOR_COLORS.atr) : null}
          hostRef={atrRef}
          crosshairRef={atrCrosshairRef}
          hidden={!showAtrPanel}
          collapsed={isAtrCollapsed}
          collapsible
          isEmpty={hasSnapshot && !seriesData.atr.length}
          emptyText="No ATR values in the latest MT5 snapshot"
          fullscreenPanel={fullscreenPanel}
          onToggleFullscreen={toggleFullscreen}
          onToggleCollapsed={() => onTogglePanelCollapsed('atr')}
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={clearCrosshairs}
        />
        {panelLayout.handles.atrAdx ? (
          <ResizeHandle id="atr-adx" label="Resize ATR and ADX/DI panels" onPointerDown={startPanelResize} />
        ) : null}
        <ChartPanel
          id="adx"
          title="ADX / DI"
          subtitle={diLegend(settings, visible, displayedValues)}
          crosshairReadout={showCrosshairReadouts ? diLegend(settings, visible, displayedValues) : null}
          hostRef={adxRef}
          crosshairRef={adxCrosshairRef}
          hidden={!showAdxPanel}
          collapsed={isAdxCollapsed}
          collapsible
          isEmpty={hasSnapshot && !seriesData.adx.length && !seriesData.plusDI.length && !seriesData.minusDI.length}
          emptyText="No ADX or DI values in the latest MT5 snapshot"
          fullscreenPanel={fullscreenPanel}
          onToggleFullscreen={toggleFullscreen}
          onToggleCollapsed={() => onTogglePanelCollapsed('adx')}
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={clearCrosshairs}
        />
        <ChartPanel
          id="rsi"
          title="RSI"
          subtitle={indicatorLegend(settings.rsi, 'RSI', displayedValues.rsi)}
          crosshairReadout={showCrosshairReadouts ? indicatorCrosshairReadout(settings.rsi, 'RSI', displayedValues.rsi, INDICATOR_COLORS.rsi) : null}
          hostRef={rsiRef}
          crosshairRef={rsiCrosshairRef}
          hidden={!showRsiPanel}
          collapsed={isRsiCollapsed}
          collapsible
          isEmpty={hasSnapshot && !seriesData.rsi.length}
          emptyText="No RSI values in the latest MT5 snapshot"
          fullscreenPanel={fullscreenPanel}
          onToggleFullscreen={toggleFullscreen}
          onToggleCollapsed={() => onTogglePanelCollapsed('rsi')}
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={clearCrosshairs}
        />
      </div>
    </section>
  );

  function toggleFullscreen(panelId) {
    setFullscreenPanel((current) => (current === panelId ? null : panelId));
  }

  function applyLayoutPreset(presetKey) {
    const nextHeights = heightsFromPreset(presetKey, {
      dashboardHeight,
      showAtrPanel,
      showAdxPanel,
      showRsiPanel,
      isAtrCollapsed,
      isAdxCollapsed,
      isRsiCollapsed
    });

    setDraftPanelHeights(null);
    onLayoutPresetChange(presetKey, nextHeights);
    window.requestAnimationFrame(() => resizeAllCharts());
  }

  function startPanelResize(handleId, event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();

    const startHeights = {
      ...normalizePanelHeights(panelLayout.heights)
    };

    const listeners = {
      move: (moveEvent) => handlePanelResize(moveEvent),
      stop: () => stopPanelResize()
    };

    resizeDragRef.current = {
      handleId,
      startY: event.clientY,
      startHeights,
      lastHeights: startHeights,
      listeners
    };

    document.body.classList.add('is-resizing-panel');
    window.addEventListener('pointermove', listeners.move);
    window.addEventListener('pointerup', listeners.stop, { once: true });
    window.addEventListener('pointercancel', listeners.stop, { once: true });
  }

  function handlePanelResize(event) {
    const drag = resizeDragRef.current;
    if (!drag) {
      return;
    }

    const deltaY = event.clientY - drag.startY;
    const nextHeights = resizePanelPair(drag.handleId, drag.startHeights, deltaY);

    drag.lastHeights = nextHeights;
    setDraftPanelHeights(nextHeights);
    window.requestAnimationFrame(() => resizeAllCharts());
  }

  function stopPanelResize() {
    const drag = resizeDragRef.current;
    const listeners = drag?.listeners;

    if (listeners) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.stop);
      window.removeEventListener('pointercancel', listeners.stop);
    }
    document.body.classList.remove('is-resizing-panel');

    if (drag?.lastHeights) {
      onPanelHeightsChange?.(drag.lastHeights);
    }

    resizeDragRef.current = null;
    setDraftPanelHeights(null);
    window.requestAnimationFrame(() => resizeAllCharts());
  }

  function handleVisibleRangeChange(sourceName, range) {
    if (!chartsRef.current || syncingRangeRef.current) {
      return;
    }

    if (range) {
      lastLogicalRangeRef.current = cloneLogicalRange(range);
    }

    rememberCurrentTimeRange(sourceName);
    applyVisibleLogicalRange(range, sourceName, { rememberTimeRange: false });
  }

  function handlePanelPointerMove(sourceName, event) {
    const entry = chartsRef.current?.entries.find((item) => item.name === sourceName);
    if (!entry || syncingCrosshairRef.current) {
      return;
    }

    const rect = entry.element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      clearCrosshairs(sourceName);
      return;
    }

    const time = normalizeTime(entry.chart.timeScale().coordinateToTime(x));
    if (!time || !dataRef.current.lookup.price.has(time)) {
      clearCrosshairs(sourceName);
      return;
    }

    applyCrosshairTime(sourceName, time, x);
  }

  function syncCrosshair(sourceName, param) {
    const chartsState = chartsRef.current;
    if (!chartsState || syncingCrosshairRef.current) {
      return;
    }

    const time = normalizeTime(param?.time);
    if (!time || !param?.point || param.point.x < 0 || param.point.y < 0) {
      clearCrosshairs(sourceName);
      return;
    }

    const data = dataRef.current;
    if (!data.lookup.price.has(time)) {
      clearCrosshairs(sourceName);
      return;
    }

    applyCrosshairTime(sourceName, time, param.point.x);
  }

  function applyCrosshairTime(sourceName, time, coordinate = null) {
    const chartsState = chartsRef.current;
    if (!chartsState || syncingCrosshairRef.current) {
      return;
    }

    const data = dataRef.current;
    syncingCrosshairRef.current = true;
    activeCrosshairTimeRef.current = time;
    activeCrosshairCoordinateRef.current = Number.isFinite(coordinate) ? coordinate : null;
    setCrosshairTime((current) => (current === time ? current : time));

    // Native Lightweight Charts crosshair sync needs a series value in the
    // target pane. MT5 indicator values can be null, so this is best-effort.
    // The DOM overlay below is the reliable vertical time marker for every
    // panel and is driven from the same MT5 candle timestamp.
    for (const entry of chartsState.entries) {
      if (entry.name === sourceName) {
        continue;
      }

      const value = data.lookup[entry.primaryKey].get(time);
      if (Number.isFinite(value)) {
        entry.chart.setCrosshairPosition?.(value, time, entry.primarySeries);
      } else {
        entry.chart.clearCrosshairPosition?.();
      }
    }

    updateCrosshairOverlays(time, activeCrosshairCoordinateRef.current);
    syncingCrosshairRef.current = false;
  }

  function clearCrosshairs(sourceName = null) {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    syncingCrosshairRef.current = true;
    activeCrosshairTimeRef.current = null;
    activeCrosshairCoordinateRef.current = null;
    setCrosshairTime(null);

    for (const entry of chartsState.entries) {
      if (entry.name !== sourceName) {
        entry.chart.clearCrosshairPosition?.();
      }

      hideCrosshairOverlay(entry);
    }

    syncingCrosshairRef.current = false;
  }

  function updateCrosshairOverlays(time = activeCrosshairTimeRef.current, coordinate = null) {
    const chartsState = chartsRef.current;
    if (!chartsState || !time) {
      return;
    }

    let sharedCoordinate = Number.isFinite(coordinate) ? coordinate : null;
    if (!Number.isFinite(sharedCoordinate)) {
      const referenceEntry = chartsState.entries.find((entry) => entry.name === 'price') || chartsState.entries[0];
      sharedCoordinate = referenceEntry?.chart.timeScale().timeToCoordinate(time);
    }

    if (!Number.isFinite(sharedCoordinate)) {
      for (const entry of chartsState.entries) {
        hideCrosshairOverlay(entry);
      }
      return;
    }

    activeCrosshairCoordinateRef.current = sharedCoordinate;

    for (const entry of chartsState.entries) {
      showCrosshairOverlay(entry, sharedCoordinate);
    }
  }

  function applyToAllTimeScales(callback, { rememberRange = true } = {}) {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    beginRangeSync();
    for (const entry of chartsState.entries) {
      callback(entry.chart.timeScale());
    }

    if (rememberRange) {
      window.requestAnimationFrame(() => rememberCurrentLogicalRange());
    }
  }

  function fitAllContent() {
    applyToAllTimeScales((timeScale) => timeScale.fitContent());
  }

  function scrollAllToLatest() {
    applyToAllTimeScales((timeScale) => {
      if (typeof timeScale.scrollToRealTime === 'function') {
        timeScale.scrollToRealTime();
      } else {
        timeScale.fitContent();
      }
    });
  }

  function applyDefaultVisibleRange() {
    if (!seriesData.candles.length) {
      fitAllContent();
      return;
    }

    const visibleBars = 180;
    const lastIndex = seriesData.candles.length - 1;
    const from = Math.max(0, lastIndex - visibleBars + 1);
    const to = lastIndex + 4;

    applyVisibleLogicalRange({ from, to }, null, { rememberTimeRange: true });
  }

  function beginRangeSync() {
    // Guard programmatic range copies. Calling setVisibleLogicalRange on the
    // other charts emits their own range-change events; this guard prevents an
    // infinite feedback loop while still allowing the next user gesture through.
    syncingRangeRef.current = true;

    if (rangeSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(rangeSyncFrameRef.current);
    }

    rangeSyncFrameRef.current = window.requestAnimationFrame(() => {
      rangeSyncFrameRef.current = window.requestAnimationFrame(() => {
        syncingRangeRef.current = false;
        rangeSyncFrameRef.current = null;
      });
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

    if (lastLogicalRangeRef.current) {
      window.requestAnimationFrame(() => applyVisibleLogicalRange(lastLogicalRangeRef.current));
    }

    if (activeCrosshairTimeRef.current) {
      window.requestAnimationFrame(() => updateCrosshairOverlays());
    }
  }

  // Visible logical range is the live synchronization source of truth.
  // Lightweight Charts emits range changes for both scroll and zoom, so copying
  // that exact range to every other panel keeps price and oscillator time axes
  // locked together without creating candles or recalculating indicators.
  function applyVisibleLogicalRange(range, sourceName = null, { rememberTimeRange = false } = {}) {
    const chartsState = chartsRef.current;
    if (!chartsState) {
      return;
    }

    beginRangeSync();

    if (range) {
      lastLogicalRangeRef.current = cloneLogicalRange(range);
    }

    for (const entry of chartsState.entries) {
      if (entry.name === sourceName) {
        continue;
      }

      if (range) {
        entry.chart.timeScale().setVisibleLogicalRange(range);
      } else {
        entry.chart.timeScale().fitContent();
      }
    }

    if (rememberTimeRange) {
      window.requestAnimationFrame(() => rememberCurrentTimeRange());
    }

    if (activeCrosshairTimeRef.current) {
      window.requestAnimationFrame(() => updateCrosshairOverlays());
    }
  }

  function rememberCurrentLogicalRange() {
    const range = getCurrentLogicalRange('price');
    if (range) {
      lastLogicalRangeRef.current = cloneLogicalRange(range);
      applyVisibleLogicalRange(range, 'price', { rememberTimeRange: true });
    }
  }

  function rememberCurrentTimeRange(sourceName = null) {
    const timeRange = getCurrentTimeRange(sourceName);
    if (timeRange) {
      lastTimeRangeRef.current = cloneTimeRange(timeRange);
    }
  }

  // MT5 sends a fixed HistoryBars window. When the oldest candle rolls off,
  // logical indexes can point at a slightly different time. For Auto-scroll OFF,
  // convert the previously visible time window back to logical indexes after
  // setData so the user's actual candle window is preserved when possible.
  function preserveVisibleTimeRange(timeRange) {
    const range = logicalRangeForTimeRange(timeRange);
    if (range) {
      applyVisibleLogicalRange(range, null, { rememberTimeRange: true });
    } else if (lastLogicalRangeRef.current) {
      applyVisibleLogicalRange(lastLogicalRangeRef.current, null, { rememberTimeRange: true });
    }
  }

  function logicalRangeForTimeRange(timeRange) {
    if (!timeRange || !seriesData.candles.length) {
      return null;
    }

    const fromTime = normalizeTime(timeRange.from);
    const toTime = normalizeTime(timeRange.to);
    if (!fromTime || !toTime) {
      return null;
    }

    const fromIndex = firstIndexAtOrAfter(seriesData.candles, fromTime);
    const toIndex = lastIndexAtOrBefore(seriesData.candles, toTime);
    if (fromIndex === null || toIndex === null || fromIndex > toIndex) {
      return null;
    }

    return { from: fromIndex, to: toIndex };
  }

  function getChartByName(name) {
    if (!name) {
      return null;
    }

    return chartsRef.current?.entries.find((entry) => entry.name === name)?.chart || null;
  }

  function getCurrentLogicalRange(sourceName = null) {
    const chart = getChartByName(sourceName) || chartsRef.current?.entries[0]?.chart;
    const range = chart?.timeScale().getVisibleLogicalRange?.();
    return range ? cloneLogicalRange(range) : null;
  }

  function getCurrentTimeRange(sourceName = null) {
    const chart = getChartByName(sourceName) || chartsRef.current?.entries[0]?.chart;
    const range = chart?.timeScale().getVisibleRange?.();
    return range ? cloneTimeRange(range) : null;
  }
}

function cloneLogicalRange(range) {
  return {
    from: range.from,
    to: range.to
  };
}

function cloneTimeRange(range) {
  return {
    from: range.from,
    to: range.to
  };
}

function ChartToolbar({
  autoScroll,
  layoutPreset,
  disabled,
  onAutoScrollChange,
  onLayoutPresetChange,
  onFitContent,
  onGoToLatest,
  onResetView
}) {
  return (
    <div className="chart-toolbar" aria-label="Chart controls">
      <button
        type="button"
        className={`toolbar-button ${autoScroll ? 'is-active' : ''}`}
        onClick={() => onAutoScrollChange(!autoScroll)}
        aria-pressed={autoScroll}
        title="Keep new MT5 snapshots at the latest candle"
      >
        Auto-scroll {autoScroll ? 'ON' : 'OFF'}
      </button>
      <button type="button" className="toolbar-button" onClick={onFitContent} disabled={disabled}>
        Fit content
      </button>
      <button type="button" className="toolbar-button" onClick={onGoToLatest} disabled={disabled}>
        Go to latest
      </button>
      <button type="button" className="toolbar-button" onClick={onResetView} disabled={disabled}>
        Reset view
      </button>
      <div className="preset-control" aria-label="Panel height presets">
        {Object.entries(PANEL_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            className={`preset-button ${layoutPreset === key ? 'is-active' : ''}`}
            onClick={() => onLayoutPresetChange(key)}
            aria-pressed={layoutPreset === key}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResizeHandle({ id, label, onPointerDown }) {
  return (
    <button
      type="button"
      className="panel-resize-handle"
      aria-label={label}
      title={label}
      onPointerDown={(event) => onPointerDown(id, event)}
    />
  );
}

function ChartPanel({
  id,
  title,
  subtitle,
  crosshairReadout,
  hostRef,
  crosshairRef,
  hidden,
  collapsed,
  collapsible,
  isEmpty,
  emptyText,
  fullscreenPanel,
  onToggleFullscreen,
  onToggleCollapsed,
  onPointerMove,
  onPointerLeave
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
    <div
      className={className}
      onMouseMove={collapsed || hidden ? undefined : (event) => onPointerMove?.(id, event)}
      onMouseLeave={collapsed || hidden ? undefined : () => onPointerLeave?.(id)}
      {...collapsedProps}
    >
      <div className="chart-title">
        <strong>{title}</strong>
        {subtitle ? <span className="chart-subtitle">{subtitle}</span> : null}
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
      <div ref={crosshairRef} className="synced-crosshair" aria-hidden="true">
        <div className="synced-crosshair-line" />
        {crosshairReadout ? <div className="synced-crosshair-readout">{crosshairReadout}</div> : null}
      </div>
      {isEmpty && !collapsed ? <div className="empty-state">{emptyText}</div> : null}
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

function showCrosshairOverlay(entry, coordinate) {
  if (!entry.crosshairElement) {
    return;
  }

  const width = entry.element?.clientWidth || 0;
  if (coordinate < 0 || coordinate > width) {
    hideCrosshairOverlay(entry);
    return;
  }

  entry.crosshairElement.style.display = 'block';
  entry.crosshairElement.style.transform = `translateX(${Math.round(coordinate)}px)`;
  entry.crosshairElement.classList.toggle('is-near-right', coordinate > width - 280);
}

function hideCrosshairOverlay(entry) {
  if (!entry.crosshairElement) {
    return;
  }

  entry.crosshairElement.style.display = 'none';
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
      smaFast: latestValue(smaFast, 'value'),
      smaMid: latestValue(smaMid, 'value'),
      smaSlow: latestValue(smaSlow, 'value'),
      atr: latestValue(atr, 'value'),
      adx: latestValue(adx, 'value'),
      plusDI: latestValue(plusDI, 'value'),
      minusDI: latestValue(minusDI, 'value'),
      rsi: latestValue(rsi, 'value')
    },
    lookup: {
      price: createLookup(candles, 'close'),
      smaFast: createLookup(smaFast, 'value'),
      smaMid: createLookup(smaMid, 'value'),
      smaSlow: createLookup(smaSlow, 'value'),
      atr: createLookup(atr, 'value'),
      adx: createLookup(adx, 'value'),
      plusDI: createLookup(plusDI, 'value'),
      minusDI: createLookup(minusDI, 'value'),
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

function firstIndexAtOrAfter(candles, targetTime) {
  for (let index = 0; index < candles.length; index += 1) {
    if (candles[index].time >= targetTime) {
      return index;
    }
  }

  return null;
}

function lastIndexAtOrBefore(candles, targetTime) {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index].time <= targetTime) {
      return index;
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

function priceLegend(settings, visible, values) {
  const labels = [];

  if (isEnabled(settings.smaFast) && isVisible(visible, 'smaFast')) labels.push(`SMA Fast ${formatValue(values.smaFast)}`);
  if (isEnabled(settings.smaMid) && isVisible(visible, 'smaMid')) labels.push(`SMA Mid ${formatValue(values.smaMid)}`);
  if (isEnabled(settings.smaSlow) && isVisible(visible, 'smaSlow')) labels.push(`SMA Slow ${formatValue(values.smaSlow)}`);

  const close = formatValue(values.close);
  const layerText = labels.length ? labels.join(' / ') : 'Candles only';

  return close === '--' ? layerText : `Close ${close} | ${layerText}`;
}

function indicatorLegend(setting, label, value) {
  return isEnabled(setting) ? `${label} ${formatValue(value)}` : `${label} disabled in MT5`;
}

function priceCrosshairReadout(values) {
  return <span>{`Close ${formatValue(values.close)}`}</span>;
}

function indicatorCrosshairReadout(setting, label, value, color) {
  if (!isEnabled(setting)) {
    return null;
  }

  return <span style={{ color }}>{`${label} ${formatValue(value)}`}</span>;
}

function diLegend(settings, visible, latest) {
  const labels = [];

  if (isEnabled(settings.adx) && isVisible(visible, 'adx')) {
    labels.push({
      key: 'adx',
      color: INDICATOR_COLORS.adx,
      text: `ADX ${formatValue(latest.adx)}`
    });
  }

  if (isEnabled(settings.di) && isVisible(visible, 'diPlus')) {
    labels.push({
      key: 'diPlus',
      color: INDICATOR_COLORS.diPlus,
      text: `DI+ ${formatValue(latest.plusDI)}`
    });
  }

  if (isEnabled(settings.di) && isVisible(visible, 'diMinus')) {
    labels.push({
      key: 'diMinus',
      color: INDICATOR_COLORS.diMinus,
      text: `DI- ${formatValue(latest.minusDI)}`
    });
  }

  return labels.length ? (
    <>
      {labels.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <span className="legend-separator"> / </span> : null}
          <span className="legend-value" style={{ color: item.color }}>{item.text}</span>
        </Fragment>
      ))}
    </>
  ) : 'Hidden';
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

function valuesAtTime(seriesData, time) {
  const lookup = seriesData.lookup;

  return {
    close: lookup.price.get(time) ?? null,
    smaFast: lookup.smaFast.get(time) ?? null,
    smaMid: lookup.smaMid.get(time) ?? null,
    smaSlow: lookup.smaSlow.get(time) ?? null,
    atr: lookup.atr.get(time) ?? null,
    adx: lookup.adx.get(time) ?? null,
    plusDI: lookup.plusDI.get(time) ?? null,
    minusDI: lookup.minusDI.get(time) ?? null,
    rsi: lookup.rsi.get(time) ?? null
  };
}

function normalizePanelHeights(value) {
  return {
    price: clampNumber(Number(value?.price), MIN_PANEL_HEIGHTS.price, 1400, DEFAULT_PANEL_HEIGHTS.price),
    atr: clampNumber(Number(value?.atr), MIN_PANEL_HEIGHTS.atr, 800, DEFAULT_PANEL_HEIGHTS.atr),
    adx: clampNumber(Number(value?.adx), MIN_PANEL_HEIGHTS.adx, 900, DEFAULT_PANEL_HEIGHTS.adx),
    rsi: clampNumber(Number(value?.rsi), MIN_PANEL_HEIGHTS.rsi, 800, DEFAULT_PANEL_HEIGHTS.rsi)
  };
}

function resolvePanelLayout({
  panelHeights,
  dashboardHeight,
  showAtrPanel,
  showAdxPanel,
  showRsiPanel,
  isAtrCollapsed,
  isAdxCollapsed,
  isRsiCollapsed
}) {
  const normalized = normalizePanelHeights(panelHeights);
  const handles = {
    priceAtr: showAtrPanel && !isAtrCollapsed,
    atrAdx: showAtrPanel && showAdxPanel && !isAtrCollapsed && !isAdxCollapsed
  };
  const expandedKeys = ['price'];
  const fixedRows = [];

  if (showAtrPanel) {
    if (isAtrCollapsed) {
      fixedRows.push(COLLAPSED_PANEL_HEIGHT);
    } else {
      expandedKeys.push('atr');
    }
  }

  if (showAdxPanel) {
    if (isAdxCollapsed) {
      fixedRows.push(COLLAPSED_PANEL_HEIGHT);
    } else {
      expandedKeys.push('adx');
    }
  }

  if (showRsiPanel) {
    if (isRsiCollapsed) {
      fixedRows.push(COLLAPSED_PANEL_HEIGHT);
    } else {
      expandedKeys.push('rsi');
    }
  }

  const handleSpace = [handles.priceAtr, handles.atrAdx].filter(Boolean).length * RESIZE_HANDLE_HEIGHT;
  const fixedSpace = fixedRows.reduce((total, height) => total + height, 0) + handleSpace;
  const rawPanelSpace = expandedKeys.reduce((total, key) => total + normalized[key], 0);
  const minPanelSpace = expandedKeys.reduce((total, key) => total + MIN_PANEL_HEIGHTS[key], 0);
  const availablePanelSpace = dashboardHeight > 0
    ? Math.max(minPanelSpace, dashboardHeight - fixedSpace)
    : rawPanelSpace;
  const heights = fitHeightsToSpace(expandedKeys, normalized, availablePanelSpace);
  const rows = [
    `${heights.price}px`,
    handles.priceAtr ? `${RESIZE_HANDLE_HEIGHT}px` : null,
    showAtrPanel ? panelRow(isAtrCollapsed, heights.atr) : null,
    handles.atrAdx ? `${RESIZE_HANDLE_HEIGHT}px` : null,
    showAdxPanel ? panelRow(isAdxCollapsed, heights.adx) : null,
    showRsiPanel ? panelRow(isRsiCollapsed, heights.rsi) : null
  ].filter(Boolean);

  return {
    rows,
    heights,
    handles
  };
}

function heightsFromPreset(presetKey, options) {
  const preset = PANEL_PRESETS[presetKey] || PANEL_PRESETS.balanced;
  const keys = ['price'];
  const fixedRows = [];

  if (options.showAtrPanel) {
    if (options.isAtrCollapsed) {
      fixedRows.push(COLLAPSED_PANEL_HEIGHT);
    } else {
      keys.push('atr');
    }
  }

  if (options.showAdxPanel) {
    if (options.isAdxCollapsed) {
      fixedRows.push(COLLAPSED_PANEL_HEIGHT);
    } else {
      keys.push('adx');
    }
  }

  if (options.showRsiPanel) {
    if (options.isRsiCollapsed) {
      fixedRows.push(COLLAPSED_PANEL_HEIGHT);
    } else {
      keys.push('rsi');
    }
  }

  const handleSpace = [
    options.showAtrPanel && !options.isAtrCollapsed,
    options.showAtrPanel && options.showAdxPanel && !options.isAtrCollapsed && !options.isAdxCollapsed
  ].filter(Boolean).length * RESIZE_HANDLE_HEIGHT;
  const fixedSpace = fixedRows.reduce((total, height) => total + height, 0) + handleSpace;
  const minPanelSpace = keys.reduce((total, key) => total + MIN_PANEL_HEIGHTS[key], 0);
  const availablePanelSpace = options.dashboardHeight > 0
    ? Math.max(minPanelSpace, options.dashboardHeight - fixedSpace)
    : keys.reduce((total, key) => total + DEFAULT_PANEL_HEIGHTS[key], 0);
  const weights = {
    ...DEFAULT_PANEL_HEIGHTS,
    price: preset.price,
    atr: preset.atr,
    adx: preset.adx,
    rsi: preset.rsi
  };

  return fitHeightsToSpace(keys, weights, availablePanelSpace);
}

function fitHeightsToSpace(keys, weights, availableSpace) {
  const result = { ...normalizePanelHeights(weights) };
  const minTotal = keys.reduce((total, key) => total + MIN_PANEL_HEIGHTS[key], 0);
  const space = Math.max(minTotal, Math.floor(availableSpace));
  let remainingSpace = space;
  let remainingWeight = keys.reduce((total, key) => total + Math.max(1, Number(weights[key]) || 1), 0);

  for (const key of keys) {
    const weight = Math.max(1, Number(weights[key]) || 1);
    const ideal = Math.round((remainingSpace * weight) / remainingWeight);
    const height = Math.max(MIN_PANEL_HEIGHTS[key], Math.min(remainingSpace, ideal));

    result[key] = height;
    remainingSpace -= height;
    remainingWeight -= weight;
  }

  if (keys.length && remainingSpace > 0) {
    result[keys[0]] += remainingSpace;
  }

  return result;
}

function resizePanelPair(handleId, startHeights, deltaY) {
  const next = { ...startHeights };

  if (handleId === 'price-atr') {
    const minDelta = MIN_PANEL_HEIGHTS.price - startHeights.price;
    const maxDelta = startHeights.atr - MIN_PANEL_HEIGHTS.atr;
    const adjustedDelta = clampNumber(deltaY, minDelta, maxDelta, 0);

    next.price = Math.round(startHeights.price + adjustedDelta);
    next.atr = Math.round(startHeights.atr - adjustedDelta);
  }

  if (handleId === 'atr-adx') {
    const minDelta = MIN_PANEL_HEIGHTS.atr - startHeights.atr;
    const maxDelta = startHeights.adx - MIN_PANEL_HEIGHTS.adx;
    const adjustedDelta = clampNumber(deltaY, minDelta, maxDelta, 0);

    next.atr = Math.round(startHeights.atr + adjustedDelta);
    next.adx = Math.round(startHeights.adx - adjustedDelta);
  }

  return normalizePanelHeights(next);
}

function panelRow(collapsed, height) {
  return collapsed ? `${COLLAPSED_PANEL_HEIGHT}px` : `${Math.round(height)}px`;
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
