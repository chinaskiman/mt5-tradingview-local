export const INDICATOR_COLORS = {
  smaFast: '#facc15',
  smaMid: '#38bdf8',
  smaSlow: '#c084fc',
  atr: '#f59e0b',
  adx: '#60a5fa',
  diPlus: '#22c55e',
  diMinus: '#ef4444',
  rsi: '#fb7185',
  resistance: '#f87171',
  support: '#4ade80',
  resistanceBuffer: 'rgba(248, 113, 113, 0.58)',
  supportBuffer: 'rgba(74, 222, 128, 0.58)',
  positionBuy: '#22c55e',
  positionSell: '#ef4444',
  pendingOrder: '#f59e0b',
  tradeStopLoss: '#fb7185',
  tradeTakeProfit: '#34d399'
};

export const CHART_COLORS = {
  up: '#26a69a',
  down: '#ef5350',
  ...INDICATOR_COLORS
};
