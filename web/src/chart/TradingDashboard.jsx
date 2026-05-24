import { useEffect, useMemo, useRef } from 'react';
import { ColorType, CrosshairMode, createChart } from 'lightweight-charts';

const BASE_CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#0f141d' },
    textColor: '#9ca3af'
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
  diMinus: '#ef4444'
};

export default function TradingDashboard({ snapshot, chartSpacing }) {
  const priceRef = useRef(null);
  const atrRef = useRef(null);
  const adxRef = useRef(null);
  const chartsRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const syncingRangeRef = useRef(false);
  const syncingCrosshairRef = useRef(false);
  const hasFitContentRef = useRef(false);
  const lastDatasetKeyRef = useRef(null);
  const lastChartIdentityRef = useRef(null);
  const lastDatasetMetaRef = useRef(null);
  const dataRef = useRef(null);

  const seriesData = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);
  dataRef.current = seriesData;

  useEffect(() => {
    if (!priceRef.current || !atrRef.current || !adxRef.current) {
      return undefined;
    }

    const priceChart = createPanelChart(priceRef.current, chartSpacing);
    const atrChart = createPanelChart(atrRef.current, chartSpacing);
    const adxChart = createPanelChart(adxRef.current, chartSpacing);

    const priceSeries = priceChart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down
    });

    const smaFastSeries = priceChart.addLineSeries(lineOptions(COLORS.smaFast, 1));
    const smaMidSeries = priceChart.addLineSeries(lineOptions(COLORS.smaMid, 1));
    const smaSlowSeries = priceChart.addLineSeries(lineOptions(COLORS.smaSlow, 1));
    const atrSeries = atrChart.addLineSeries(lineOptions(COLORS.atr, 2));
    const adxSeries = adxChart.addLineSeries(lineOptions(COLORS.adx, 2));
    const plusDISeries = adxChart.addLineSeries(lineOptions(COLORS.diPlus, 1));
    const minusDISeries = adxChart.addLineSeries(lineOptions(COLORS.diMinus, 1));
    const priceSyncSeries = priceChart.addLineSeries(syncSeriesOptions());
    const atrSyncSeries = atrChart.addLineSeries(syncSeriesOptions());
    const adxSyncSeries = adxChart.addLineSeries(syncSeriesOptions());

    const chartEntries = [
      { name: 'price', chart: priceChart, element: priceRef.current, primarySeries: priceSeries, primaryKey: 'price' },
      { name: 'atr', chart: atrChart, element: atrRef.current, primarySeries: atrSeries, primaryKey: 'atr' },
      { name: 'adx', chart: adxChart, element: adxRef.current, primarySeries: adxSeries, primaryKey: 'adx' }
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
        priceSyncSeries,
        atrSyncSeries,
        adxSyncSeries
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

    resizeObserverRef.current = new ResizeObserver(() => {
      for (const entry of chartEntries) {
        resizeChart(entry.chart, entry.element);
      }
    });

    for (const entry of chartEntries) {
      resizeObserverRef.current.observe(entry.element);
      resizeChart(entry.chart, entry.element);
    }

    return () => {
      for (const unsubscribe of chartsRef.current?.unsubscribers || []) {
        unsubscribe();
      }

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      priceChart.remove();
      atrChart.remove();
      adxChart.remove();
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
    chartsState.series.priceSeries.setData(seriesData.candles);
    chartsState.series.smaFastSeries.setData(isEnabled(settings.smaFast) ? seriesData.smaFast : []);
    chartsState.series.smaMidSeries.setData(isEnabled(settings.smaMid) ? seriesData.smaMid : []);
    chartsState.series.smaSlowSeries.setData(isEnabled(settings.smaSlow) ? seriesData.smaSlow : []);
    chartsState.series.atrSeries.setData(isEnabled(settings.atr) ? seriesData.atr : []);
    chartsState.series.adxSeries.setData(isEnabled(settings.adx) ? seriesData.adx : []);
    chartsState.series.plusDISeries.setData(isEnabled(settings.di) ? seriesData.plusDI : []);
    chartsState.series.minusDISeries.setData(isEnabled(settings.di) ? seriesData.minusDI : []);

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
  }, [seriesData, snapshot]);

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

  const hasSnapshot = Boolean(snapshot);
  const settings = snapshot?.settings || {};

  return (
    <section className="dashboard" aria-label="MT5 chart dashboard">
      <ChartPanel
        title="Price"
        subtitle={priceLegend(settings)}
        hostRef={priceRef}
        isEmpty={!hasSnapshot || !seriesData.candles.length}
        emptyText="Waiting for MT5 data..."
      />
      <ChartPanel
        title="ATR"
        subtitle={indicatorLegend(settings.atr, 'ATR')}
        hostRef={atrRef}
        isEmpty={hasSnapshot && !seriesData.atr.length}
        emptyText="No ATR values in the latest MT5 snapshot"
      />
      <ChartPanel
        title="ADX / DI"
        subtitle={diLegend(settings)}
        hostRef={adxRef}
        isEmpty={hasSnapshot && !seriesData.adx.length && !seriesData.plusDI.length && !seriesData.minusDI.length}
        emptyText="No ADX or DI values in the latest MT5 snapshot"
      />
    </section>
  );

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

    const sourceEntry = chartsState.entries.find((entry) => entry.name === sourceName);
    if (!sourceEntry || !param?.time || !param.point || param.point.x < 0 || param.point.y < 0) {
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
}

function ChartPanel({ title, subtitle, hostRef, isEmpty, emptyText }) {
  return (
    <div className="chart-panel">
      <div className="chart-title">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <div ref={hostRef} className="chart-host" />
      {isEmpty ? <div className="empty-state">{emptyText}</div> : null}
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
    lastValueVisible: true
  };
}

function syncSeriesOptions() {
  return {
    color: 'rgba(0, 0, 0, 0)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
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

  return {
    symbol: snapshot?.symbol || '',
    timeframe: snapshot?.timeframe || '',
    candles,
    timeScale,
    smaFast,
    smaMid,
    smaSlow,
    atr,
    adx,
    plusDI,
    minusDI,
    lookup: {
      price: createLookup(candles, 'close'),
      atr: createLookup(atr, 'value'),
      adx: createLookup(adx, 'value')
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

function priceLegend(settings) {
  const labels = [];

  if (isEnabled(settings.smaFast)) labels.push('SMA Fast');
  if (isEnabled(settings.smaMid)) labels.push('SMA Mid');
  if (isEnabled(settings.smaSlow)) labels.push('SMA Slow');

  return labels.length ? labels.join(' / ') : 'Candles only';
}

function indicatorLegend(setting, label) {
  return isEnabled(setting) ? label : `${label} disabled`;
}

function diLegend(settings) {
  const labels = [];

  if (isEnabled(settings.adx)) labels.push('ADX');
  if (isEnabled(settings.di)) labels.push('DI+ / DI-');

  return labels.length ? labels.join(' / ') : 'Disabled';
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
