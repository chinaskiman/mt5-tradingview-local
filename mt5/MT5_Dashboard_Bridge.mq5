//+------------------------------------------------------------------+
//| MT5_Dashboard_Bridge.mq5                                        |
//| Local view-only chart mirror for mt5-tradingview-local.          |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Mirrors the MT5 chart this EA is attached to into the local web dashboard."

/*
   Setup:
   1. In MT5, open Tools > Options > Expert Advisors.
   2. Enable "Allow WebRequest for listed URL".
   3. Add this allowed URL exactly: http://127.0.0.1:3001
   4. Compile this EA and attach it to the chart you want to mirror.

   The web dashboard mirrors only the chart where this EA is attached.
   V1/V3A/V3B is view/read-only.
   V3A only adds read-only account, quote, symbol property, and open position
   monitor data to the local dashboard payload.
   V3B can poll local calculator commands and return broker-normalized lot-size
   estimates. This command path is calculation-only, not a trading path.

   V3C can process PLACE_ORDER commands. Real order execution is controlled by
   MT5 trade permissions: the Algo Trading button must be enabled, live trading
   must be allowed for this EA, and the account must allow expert trading. This
   version supports only market and limit entries.

   V3D trade-management commands are disabled by default. EnableTradeManagement
   must be explicitly set to true before this EA will close positions, modify
   SL/TP, move stops to breakeven, cancel pending orders, or modify pending
   orders. Bulk close/cancel, trailing stops, and automated management are not
   implemented.

   The monitor payload also includes read-only active pending orders. This is
   for display only unless EnableTradeManagement is explicitly enabled.
*/

input int    HistoryBars   = 500;
input string ServerUrl     = "http://127.0.0.1:3001/mt5/update";
input int    UpdateSeconds = 2;
input bool   EnableRiskCalculatorCommands = true;
input int    MaxDeviationPoints = 20;
input double MaxAllowedVolume = 5.0;
input bool   RequireStopLossForOrders = true;
input int    DefaultMagicNumber = 2026001;
input bool   EnableTradeManagement = false;

input bool EnableSMAFast = true;
input int  SMAFastLength = 7;
input bool EnableSMAMid  = true;
input int  SMAMidLength  = 12;
input bool EnableSMASlow = true;
input int  SMASlowLength = 50;
input bool EnableATR     = true;
input int  ATRLength     = 14;
input bool EnableADX     = true;
input int  ADXLength     = 14;
input bool EnableDI      = true;
input int  DILength      = 14;
input bool EnableRSI     = true;
input int  RSILength     = 14;
input bool EnableSRIndicator = true;
input int  SRLookbackCandles = 14;
input ENUM_TIMEFRAMES SRSourceTimeframe = PERIOD_H4;
input int  SRATRLength = 14;
input double SRATRMultiplier = 0.20;
input bool ShowOriginalResistance = true;
input bool ShowOriginalSupport = true;
input bool ShowResistanceBuffer = true;
input bool ShowSupportBuffer = true;

const string STATUS_LABEL_PREFIX = "MT5_Dashboard_Bridge_Status_";
const string LEGACY_STATUS_LABEL_NAME = "MT5_Dashboard_Bridge_Status";
const int JSON_DECIMALS = 5;

int smaFastHandle = INVALID_HANDLE;
int smaMidHandle  = INVALID_HANDLE;
int smaSlowHandle = INVALID_HANDLE;
int atrHandle     = INVALID_HANDLE;
int adxHandle     = INVALID_HANDLE;
int diHandle      = INVALID_HANDLE;
int rsiHandle     = INVALID_HANDLE;
int srAtrHandle   = INVALID_HANDLE;

datetime lastAttemptedClosedTime = 0;
bool sendOnStartup = true;
string processedOrderRequestIds[];
const int MAX_PROCESSED_ORDER_IDS = 100;
string processedTradeManagementRequestIds[];
const int MAX_PROCESSED_TRADE_MANAGEMENT_IDS = 100;

struct PlaceOrderCommand
{
   string requestId;
   string symbol;
   string orderKind;
   string side;
   double volume;
   double entryPrice;
   double sl;
   double tp;
   bool slProvided;
   bool tpProvided;
   string comment;
   long magic;
};

struct TradeManagementCommand
{
   string requestId;
   string commandType;
   string symbol;
   ulong ticket;
   double volume;
   bool volumeProvided;
   double sl;
   bool slProvided;
   double tp;
   bool tpProvided;
   double entryPrice;
   bool entryPriceProvided;
   double offsetPoints;
};

struct SRLevels
{
   bool hasResistance;
   bool hasSupport;
   bool hasAtr;
   double resistance;
   double support;
   double buffer;
};

int OnInit()
{
   CreateStatusLabel();
   UpdateStatusLabel("Attached. Initializing...", clrDodgerBlue);

   if(HistoryBars < 1)
   {
      Print("HistoryBars must be greater than 0.");
      UpdateStatusLabel("Input error: HistoryBars must be greater than 0", clrTomato);
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(UpdateSeconds < 1)
   {
      Print("UpdateSeconds must be greater than 0.");
      UpdateStatusLabel("Input error: UpdateSeconds must be greater than 0", clrTomato);
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(EnableSRIndicator && SRLookbackCandles < 3)
   {
      Print("SRLookbackCandles must be at least 3.");
      UpdateStatusLabel("Input error: SRLookbackCandles must be at least 3", clrTomato);
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(EnableSRIndicator && SRATRLength < 1)
   {
      Print("SRATRLength must be greater than 0.");
      UpdateStatusLabel("Input error: SRATRLength must be greater than 0", clrTomato);
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(EnableSRIndicator && SRATRMultiplier < 0.0)
   {
      Print("SRATRMultiplier must be 0 or greater.");
      UpdateStatusLabel("Input error: SRATRMultiplier must be 0 or greater", clrTomato);
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(!CreateIndicatorHandles())
   {
      UpdateStatusLabel("Indicator handle error. Check Experts tab.", clrTomato);
      return(INIT_FAILED);
   }

   EventSetTimer(UpdateSeconds);
   Print("MT5 Dashboard Bridge attached to ", _Symbol, " ", TimeframeToString(_Period));
   Print("Dashboard mirrors this chart only. Endpoint: ", ServerUrl);
   UpdateStatusLabel("Attached to " + _Symbol + " " + TimeframeToString(_Period) + ". Waiting for closed candle...", clrDodgerBlue);

   SendIfNeeded();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ReleaseIndicatorHandles();
   DeleteStatusLabels();
   Print("MT5 Dashboard Bridge removed. Reason: ", reason);
}

void OnTimer()
{
   SendIfNeeded();

   PollBackendCommands();
}

void OnTick()
{
   // Intentionally empty. Updates are timer-based to avoid tick spam.
}

bool CreateIndicatorHandles()
{
   if(EnableSMAFast)
   {
      smaFastHandle = iMA(_Symbol, _Period, SMAFastLength, 0, MODE_SMA, PRICE_CLOSE);
      if(smaFastHandle == INVALID_HANDLE)
         return PrintHandleError("SMA fast", SMAFastLength);
   }

   if(EnableSMAMid)
   {
      smaMidHandle = iMA(_Symbol, _Period, SMAMidLength, 0, MODE_SMA, PRICE_CLOSE);
      if(smaMidHandle == INVALID_HANDLE)
         return PrintHandleError("SMA mid", SMAMidLength);
   }

   if(EnableSMASlow)
   {
      smaSlowHandle = iMA(_Symbol, _Period, SMASlowLength, 0, MODE_SMA, PRICE_CLOSE);
      if(smaSlowHandle == INVALID_HANDLE)
         return PrintHandleError("SMA slow", SMASlowLength);
   }

   if(EnableATR)
   {
      atrHandle = iATR(_Symbol, _Period, ATRLength);
      if(atrHandle == INVALID_HANDLE)
         return PrintHandleError("ATR", ATRLength);
   }

   if(EnableADX)
   {
      adxHandle = iADX(_Symbol, _Period, ADXLength);
      if(adxHandle == INVALID_HANDLE)
         return PrintHandleError("ADX", ADXLength);
   }

   if(EnableDI)
   {
      diHandle = iADX(_Symbol, _Period, DILength);
      if(diHandle == INVALID_HANDLE)
         return PrintHandleError("DI", DILength);
   }

   if(EnableRSI)
   {
      rsiHandle = iRSI(_Symbol, _Period, RSILength, PRICE_CLOSE);
      if(rsiHandle == INVALID_HANDLE)
         return PrintHandleError("RSI", RSILength);
   }

   if(EnableSRIndicator)
   {
      srAtrHandle = iATR(_Symbol, SRSourceTimeframe, SRATRLength);
      if(srAtrHandle == INVALID_HANDLE)
         return PrintHandleError("S/R ATR", SRATRLength);
   }

   return true;
}

bool PrintHandleError(const string name, const int length)
{
   Print("Failed to create ", name, " indicator handle. Length: ", length, ". Error: ", GetLastError());
   return false;
}

void ReleaseIndicatorHandles()
{
   if(smaFastHandle != INVALID_HANDLE) IndicatorRelease(smaFastHandle);
   if(smaMidHandle  != INVALID_HANDLE) IndicatorRelease(smaMidHandle);
   if(smaSlowHandle != INVALID_HANDLE) IndicatorRelease(smaSlowHandle);
   if(atrHandle     != INVALID_HANDLE) IndicatorRelease(atrHandle);
   if(adxHandle     != INVALID_HANDLE) IndicatorRelease(adxHandle);
   if(diHandle      != INVALID_HANDLE) IndicatorRelease(diHandle);
   if(rsiHandle     != INVALID_HANDLE) IndicatorRelease(rsiHandle);
   if(srAtrHandle   != INVALID_HANDLE) IndicatorRelease(srAtrHandle);
}

void SendIfNeeded()
{
   datetime newestClosedTime = iTime(_Symbol, _Period, 1);
   if(newestClosedTime <= 0)
   {
      Print("No closed candle is available yet for ", _Symbol, " ", TimeframeToString(_Period));
      UpdateStatusLabel("No closed candle available yet", clrOrange);
      return;
   }

   bool chartUpdated = (sendOnStartup || newestClosedTime != lastAttemptedClosedTime);

   string payload = BuildSnapshotJson(newestClosedTime, chartUpdated);
   if(payload == "")
   {
      UpdateStatusLabel("Snapshot build failed. Check Experts tab.", clrTomato);
      return;
   }

   if(!SendJson(payload, newestClosedTime))
      return;

   if(chartUpdated)
      lastAttemptedClosedTime = newestClosedTime;

   sendOnStartup = false;
}

string BuildSnapshotJson(const datetime newestClosedTime, const bool chartUpdated)
{
   MqlRates rates[];
   int copiedRates = 0;

   double smaFastValues[];
   double smaMidValues[];
   double smaSlowValues[];
   double atrValues[];
   double adxValues[];
   double diPlusValues[];
   double diMinusValues[];
   double rsiValues[];

   int smaFastCopied = 0;
   int smaMidCopied  = 0;
   int smaSlowCopied = 0;
   int atrCopied     = 0;
   int adxCopied     = 0;
   int diPlusCopied  = 0;
   int diMinusCopied = 0;
   int rsiCopied     = 0;

   if(chartUpdated)
   {
      int barsToCopy = MathMax(1, HistoryBars);

      ArraySetAsSeries(rates, true);
      copiedRates = CopyRates(_Symbol, _Period, 1, barsToCopy, rates);
      if(copiedRates <= 0)
      {
         Print("CopyRates failed or returned no closed bars. Error: ", GetLastError());
         UpdateStatusLabel("CopyRates failed. Check chart history.", clrTomato);
         return "";
      }

      smaFastCopied = CopyEnabledBuffer(EnableSMAFast, smaFastHandle, 0, copiedRates, smaFastValues, "SMA fast");
      smaMidCopied  = CopyEnabledBuffer(EnableSMAMid,  smaMidHandle,  0, copiedRates, smaMidValues,  "SMA mid");
      smaSlowCopied = CopyEnabledBuffer(EnableSMASlow, smaSlowHandle, 0, copiedRates, smaSlowValues, "SMA slow");
      atrCopied     = CopyEnabledBuffer(EnableATR,     atrHandle,     0, copiedRates, atrValues,     "ATR");
      adxCopied     = CopyEnabledBuffer(EnableADX,     adxHandle,     0, copiedRates, adxValues,     "ADX");
      diPlusCopied  = CopyEnabledBuffer(EnableDI,      diHandle,      1, copiedRates, diPlusValues,  "DI+");
      diMinusCopied = CopyEnabledBuffer(EnableDI,      diHandle,      2, copiedRates, diMinusValues, "DI-");
      rsiCopied     = CopyEnabledBuffer(EnableRSI,     rsiHandle,     0, copiedRates, rsiValues,     "RSI");
   }

   string json = "{";
   json += "\"source\":\"mt5\",";
   json += "\"symbol\":" + JsonString(_Symbol) + ",";
   json += "\"timeframe\":" + JsonString(TimeframeToString(_Period)) + ",";
   json += "\"timeframeSeconds\":" + IntegerToString(PeriodSeconds(_Period)) + ",";
   json += "\"lastClosedTime\":" + IntegerToString((long)newestClosedTime) + ",";
   json += "\"chartUpdated\":" + JsonBool(chartUpdated) + ",";
   json += "\"settings\":{";
   json += "\"smaFast\":{\"enabled\":" + JsonBool(EnableSMAFast) + ",\"length\":" + IntegerToString(SMAFastLength) + "},";
   json += "\"smaMid\":{\"enabled\":" + JsonBool(EnableSMAMid) + ",\"length\":" + IntegerToString(SMAMidLength) + "},";
   json += "\"smaSlow\":{\"enabled\":" + JsonBool(EnableSMASlow) + ",\"length\":" + IntegerToString(SMASlowLength) + "},";
   json += "\"atr\":{\"enabled\":" + JsonBool(EnableATR) + ",\"length\":" + IntegerToString(ATRLength) + "},";
   json += "\"adx\":{\"enabled\":" + JsonBool(EnableADX) + ",\"length\":" + IntegerToString(ADXLength) + "},";
   json += "\"di\":{\"enabled\":" + JsonBool(EnableDI) + ",\"length\":" + IntegerToString(DILength) + "},";
   json += "\"rsi\":{\"enabled\":" + JsonBool(EnableRSI) + ",\"length\":" + IntegerToString(RSILength) + "},";
   json += "\"sr\":{";
   json += "\"enabled\":" + JsonBool(EnableSRIndicator) + ",";
   json += "\"lookback\":" + IntegerToString(SRLookbackCandles) + ",";
   json += "\"sourceTimeframe\":" + JsonString(TimeframeToString(SRSourceTimeframe)) + ",";
   json += "\"atrLength\":" + IntegerToString(SRATRLength) + ",";
   json += "\"atrMultiplier\":" + JsonNumber(SRATRMultiplier, 5) + ",";
   json += "\"showOriginalResistance\":" + JsonBool(ShowOriginalResistance) + ",";
   json += "\"showOriginalSupport\":" + JsonBool(ShowOriginalSupport) + ",";
   json += "\"showResistanceBuffer\":" + JsonBool(ShowResistanceBuffer) + ",";
   json += "\"showSupportBuffer\":" + JsonBool(ShowSupportBuffer);
   json += "}";
   json += "},";

   if(chartUpdated)
   {
      json += "\"candles\":[";

      for(int i = copiedRates - 1; i >= 0; i--)
      {
         if(i < copiedRates - 1)
            json += ",";

         json += "{";
         json += "\"time\":" + IntegerToString((long)rates[i].time) + ",";
         json += "\"open\":" + JsonNumber(rates[i].open, JSON_DECIMALS) + ",";
         json += "\"high\":" + JsonNumber(rates[i].high, JSON_DECIMALS) + ",";
         json += "\"low\":" + JsonNumber(rates[i].low, JSON_DECIMALS) + ",";
         json += "\"close\":" + JsonNumber(rates[i].close, JSON_DECIMALS) + ",";
         json += "\"smaFast\":" + JsonBufferNumber(EnableSMAFast, smaFastValues, smaFastCopied, i, JSON_DECIMALS) + ",";
         json += "\"smaMid\":" + JsonBufferNumber(EnableSMAMid, smaMidValues, smaMidCopied, i, JSON_DECIMALS) + ",";
         json += "\"smaSlow\":" + JsonBufferNumber(EnableSMASlow, smaSlowValues, smaSlowCopied, i, JSON_DECIMALS) + ",";
         json += "\"atr\":" + JsonBufferNumber(EnableATR, atrValues, atrCopied, i, JSON_DECIMALS) + ",";
         json += "\"adx\":" + JsonBufferNumber(EnableADX, adxValues, adxCopied, i, JSON_DECIMALS) + ",";
         json += "\"diPlus\":" + JsonBufferNumber(EnableDI, diPlusValues, diPlusCopied, i, JSON_DECIMALS) + ",";
         SRLevels srLevels;
         bool srAvailable = CalculateSRLevelsForChartCandle(rates[i].time, srLevels);

         json += "\"diMinus\":" + JsonBufferNumber(EnableDI, diMinusValues, diMinusCopied, i, JSON_DECIMALS) + ",";
         json += "\"rsi\":" + JsonBufferNumber(EnableRSI, rsiValues, rsiCopied, i, JSON_DECIMALS) + ",";
         json += "\"resistance\":" + JsonSRNumber(srAvailable && ShowOriginalResistance && srLevels.hasResistance, srLevels.resistance) + ",";
         json += "\"support\":" + JsonSRNumber(srAvailable && ShowOriginalSupport && srLevels.hasSupport, srLevels.support) + ",";
         json += "\"resistanceUpperBuffer\":" + JsonSRNumber(srAvailable && ShowResistanceBuffer && srLevels.hasResistance && srLevels.hasAtr, srLevels.resistance + srLevels.buffer) + ",";
         json += "\"resistanceLowerBuffer\":" + JsonSRNumber(srAvailable && ShowResistanceBuffer && srLevels.hasResistance && srLevels.hasAtr, srLevels.resistance - srLevels.buffer) + ",";
         json += "\"supportUpperBuffer\":" + JsonSRNumber(srAvailable && ShowSupportBuffer && srLevels.hasSupport && srLevels.hasAtr, srLevels.support + srLevels.buffer) + ",";
         json += "\"supportLowerBuffer\":" + JsonSRNumber(srAvailable && ShowSupportBuffer && srLevels.hasSupport && srLevels.hasAtr, srLevels.support - srLevels.buffer);
         json += "}";
      }

      json += "],";
   }

   json += "\"account\":" + BuildAccountJson() + ",";
   json += "\"quote\":" + BuildQuoteJson() + ",";
   json += "\"positions\":" + BuildPositionsJson() + ",";
   json += "\"orders\":" + BuildOrdersJson();
   json += "}";
   return json;
}

string BuildAccountJson()
{
   string json = "{";
   json += "\"login\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += "\"server\":" + JsonString(AccountInfoString(ACCOUNT_SERVER)) + ",";
   json += "\"currency\":" + JsonString(AccountInfoString(ACCOUNT_CURRENCY)) + ",";
   json += "\"balance\":" + JsonNumber(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\"equity\":" + JsonNumber(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   json += "\"profit\":" + JsonNumber(AccountInfoDouble(ACCOUNT_PROFIT), 2) + ",";
   json += "\"margin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   json += "\"freeMargin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   json += "\"marginLevel\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ",";
   json += "\"leverage\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE));
   json += "}";
   return json;
}

string BuildQuoteJson()
{
   string json = "{";
   json += "\"symbol\":" + JsonString(_Symbol) + ",";
   json += "\"bid\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_BID), JSON_DECIMALS) + ",";
   json += "\"ask\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_ASK), JSON_DECIMALS) + ",";
   json += "\"spreadPoints\":" + IntegerToString((long)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD)) + ",";
   json += "\"digits\":" + IntegerToString((long)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS)) + ",";
   json += "\"point\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_POINT), 8) + ",";
   json += "\"tickSize\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), 8) + ",";
   json += "\"tickValue\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), 8) + ",";
   json += "\"volumeMin\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), 8) + ",";
   json += "\"volumeMax\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), 8) + ",";
   json += "\"volumeStep\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), 8) + ",";
   json += "\"contractSize\":" + JsonNumber(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE), 2);
   json += "}";
   return json;
}

string BuildPositionsJson()
{
   string json = "[";
   int emitted = 0;

   // Read-only monitor data: this loop only reads open positions. It does not
   // place, close, or modify trades.
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
      {
         Print("PositionSelectByTicket failed for ticket ", ticket, ". Error: ", GetLastError());
         continue;
      }

      if(emitted > 0)
         json += ",";

      long positionType = PositionGetInteger(POSITION_TYPE);

      json += "{";
      json += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      json += "\"symbol\":" + JsonString(PositionGetString(POSITION_SYMBOL)) + ",";
      json += "\"type\":" + JsonString(PositionTypeToString(positionType)) + ",";
      json += "\"volume\":" + JsonNumber(PositionGetDouble(POSITION_VOLUME), 8) + ",";
      json += "\"openPrice\":" + JsonNumber(PositionGetDouble(POSITION_PRICE_OPEN), JSON_DECIMALS) + ",";
      json += "\"sl\":" + JsonNumber(PositionGetDouble(POSITION_SL), JSON_DECIMALS) + ",";
      json += "\"tp\":" + JsonNumber(PositionGetDouble(POSITION_TP), JSON_DECIMALS) + ",";
      json += "\"currentPrice\":" + JsonNumber(PositionGetDouble(POSITION_PRICE_CURRENT), JSON_DECIMALS) + ",";
      json += "\"profit\":" + JsonNumber(PositionGetDouble(POSITION_PROFIT), 2) + ",";
      json += "\"swap\":" + JsonNumber(PositionGetDouble(POSITION_SWAP), 2) + ",";
      // Some MT5 builds do not expose commission as a position property.
      // Keep this read-only field stable and set it to 0 for compatibility.
      json += "\"commission\":0,";
      json += "\"openTime\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME)) + ",";
      json += "\"magic\":" + IntegerToString((long)PositionGetInteger(POSITION_MAGIC)) + ",";
      json += "\"comment\":" + JsonString(PositionGetString(POSITION_COMMENT));
      json += "}";

      emitted++;
   }

   json += "]";
   return json;
}

string PositionTypeToString(const long positionType)
{
   if(positionType == POSITION_TYPE_BUY)
      return "BUY";

   if(positionType == POSITION_TYPE_SELL)
      return "SELL";

   return "UNKNOWN";
}

string BuildOrdersJson()
{
   string json = "[";
   int emitted = 0;

   // Read-only pending order monitor data. This loop only reads active
   // pending orders. It does not cancel or modify orders.
   for(int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0)
         continue;

      if(!OrderSelect(ticket))
      {
         Print("OrderSelect failed for ticket ", ticket, ". Error: ", GetLastError());
         continue;
      }

      long orderType = OrderGetInteger(ORDER_TYPE);
      if(!IsPendingOrderType(orderType))
         continue;

      if(emitted > 0)
         json += ",";

      json += "{";
      json += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      json += "\"symbol\":" + JsonString(OrderGetString(ORDER_SYMBOL)) + ",";
      json += "\"type\":" + JsonString(OrderTypeToString(orderType)) + ",";
      json += "\"volumeInitial\":" + JsonNumber(OrderGetDouble(ORDER_VOLUME_INITIAL), 8) + ",";
      json += "\"volumeCurrent\":" + JsonNumber(OrderGetDouble(ORDER_VOLUME_CURRENT), 8) + ",";
      json += "\"openPrice\":" + JsonNumber(OrderGetDouble(ORDER_PRICE_OPEN), JSON_DECIMALS) + ",";
      json += "\"sl\":" + JsonNumber(OrderGetDouble(ORDER_SL), JSON_DECIMALS) + ",";
      json += "\"tp\":" + JsonNumber(OrderGetDouble(ORDER_TP), JSON_DECIMALS) + ",";
      json += "\"openTime\":" + IntegerToString((long)OrderGetInteger(ORDER_TIME_SETUP)) + ",";
      json += "\"expirationTime\":" + IntegerToString((long)OrderGetInteger(ORDER_TIME_EXPIRATION)) + ",";
      json += "\"magic\":" + IntegerToString((long)OrderGetInteger(ORDER_MAGIC)) + ",";
      json += "\"comment\":" + JsonString(OrderGetString(ORDER_COMMENT));
      json += "}";

      emitted++;
   }

   json += "]";
   return json;
}

bool IsPendingOrderType(const long orderType)
{
   return orderType == ORDER_TYPE_BUY_LIMIT ||
          orderType == ORDER_TYPE_SELL_LIMIT ||
          orderType == ORDER_TYPE_BUY_STOP ||
          orderType == ORDER_TYPE_SELL_STOP ||
          orderType == ORDER_TYPE_BUY_STOP_LIMIT ||
          orderType == ORDER_TYPE_SELL_STOP_LIMIT;
}

string OrderTypeToString(const long orderType)
{
   switch((ENUM_ORDER_TYPE)orderType)
   {
      case ORDER_TYPE_BUY_LIMIT:       return "BUY_LIMIT";
      case ORDER_TYPE_SELL_LIMIT:      return "SELL_LIMIT";
      case ORDER_TYPE_BUY_STOP:        return "BUY_STOP";
      case ORDER_TYPE_SELL_STOP:       return "SELL_STOP";
      case ORDER_TYPE_BUY_STOP_LIMIT:  return "BUY_STOP_LIMIT";
      case ORDER_TYPE_SELL_STOP_LIMIT: return "SELL_STOP_LIMIT";
      default:                         return EnumToString((ENUM_ORDER_TYPE)orderType);
   }
}

int CopyEnabledBuffer(const bool enabled,
                      const int handle,
                      const int bufferIndex,
                      const int count,
                      double &values[],
                      const string label)
{
   if(!enabled)
      return 0;

   if(handle == INVALID_HANDLE)
   {
      Print(label, " indicator handle is invalid.");
      return 0;
   }

   ArraySetAsSeries(values, true);
   ResetLastError();
   int copied = CopyBuffer(handle, bufferIndex, 1, count, values);
   if(copied <= 0)
   {
      Print("Failed to copy ", label, " buffer. Buffer: ", bufferIndex, ". Requested: ", count, ". Error: ", GetLastError());
      return 0;
   }

   if(copied < count)
      Print("Copied only ", copied, " of ", count, " values for ", label, ". Missing values will be sent as null.");

   return copied;
}

bool CalculateSRLevelsForChartCandle(const datetime chartCandleOpenTime, SRLevels &levels)
{
   levels.hasResistance = false;
   levels.hasSupport = false;
   levels.hasAtr = false;
   levels.resistance = 0.0;
   levels.support = 0.0;
   levels.buffer = 0.0;

   if(!EnableSRIndicator)
      return false;

   if(srAtrHandle == INVALID_HANDLE)
      return false;

   int chartSeconds = PeriodSeconds(_Period);
   datetime chartCandleCloseTime = chartCandleOpenTime + (chartSeconds > 0 ? chartSeconds : 1);

   // Pick the source-timeframe candle that was closed by this chart candle's
   // close. This avoids using an unfinished source candle and avoids lookahead.
   int containingSourceShift = iBarShift(_Symbol, SRSourceTimeframe, chartCandleCloseTime, false);
   if(containingSourceShift < 0)
      return false;

   int latestClosedSourceShift = containingSourceShift + 1;
   int sourceBars = Bars(_Symbol, SRSourceTimeframe);
   if(sourceBars <= 0 || latestClosedSourceShift + SRLookbackCandles > sourceBars)
      return false;

   bool hasBestBullClose = false;
   bool hasBestBearClose = false;
   double bestBullClose = 0.0;
   double bestBearClose = 0.0;

   for(int offset = 0; offset <= SRLookbackCandles - 2; offset++)
   {
      int currentShift = latestClosedSourceShift + offset;
      int previousShift = currentShift + 1;

      double previousOpen = iOpen(_Symbol, SRSourceTimeframe, previousShift);
      double previousClose = iClose(_Symbol, SRSourceTimeframe, previousShift);
      double currentOpen = iOpen(_Symbol, SRSourceTimeframe, currentShift);
      double currentClose = iClose(_Symbol, SRSourceTimeframe, currentShift);

      if(!MathIsValidNumber(previousOpen) || !MathIsValidNumber(previousClose) ||
         !MathIsValidNumber(currentOpen) || !MathIsValidNumber(currentClose))
      {
         continue;
      }

      bool bullBear = previousClose > previousOpen && currentClose < currentOpen;
      if(bullBear && (!hasBestBullClose || previousClose > bestBullClose))
      {
         hasBestBullClose = true;
         bestBullClose = previousClose;
         levels.hasResistance = true;
         levels.resistance = currentOpen;
      }

      bool bearBull = previousClose < previousOpen && currentClose > currentOpen;
      if(bearBull && (!hasBestBearClose || previousClose < bestBearClose))
      {
         hasBestBearClose = true;
         bestBearClose = previousClose;
         levels.hasSupport = true;
         levels.support = currentOpen;
      }
   }

   double atrBuffer[];
   ArraySetAsSeries(atrBuffer, true);
   ResetLastError();
   int atrCopied = CopyBuffer(srAtrHandle, 0, latestClosedSourceShift, 1, atrBuffer);
   if(atrCopied == 1 && MathIsValidNumber(atrBuffer[0]) && atrBuffer[0] != EMPTY_VALUE)
   {
      levels.hasAtr = true;
      levels.buffer = atrBuffer[0] * SRATRMultiplier;
   }

   return true;
}

bool SendJson(const string payload, const datetime newestClosedTime)
{
   char body[];
   int bodyLength = StringToCharArray(payload, body, 0, WHOLE_ARRAY, CP_UTF8);
   if(bodyLength > 0)
      ArrayResize(body, bodyLength - 1);

   char response[];
   string responseHeaders = "";
   string headers = "Content-Type: application/json\r\n";

   ResetLastError();
   int status = WebRequest("POST", ServerUrl, headers, 5000, body, response, responseHeaders);
   if(status == -1)
   {
      int errorCode = GetLastError();
      Print("WebRequest failed. Error: ", errorCode, ". Allow http://127.0.0.1:3001 in MT5 Tools > Options > Expert Advisors > WebRequest URLs.");
      UpdateStatusLabel("WebRequest failed. Allow http://127.0.0.1:3001", clrTomato);
      return false;
   }

   if(status < 200 || status >= 300)
   {
      string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
      Print("Server returned HTTP ", status, ". Response: ", responseText);
      if(status == 1003)
         UpdateStatusLabel("HTTP 1003. Start backend: cd server && npm start", clrTomato);
      else
         UpdateStatusLabel("Server returned HTTP " + IntegerToString(status), clrTomato);
      return false;
   }

   Print("Sent ", _Symbol, " ", TimeframeToString(_Period), " snapshot. Payload bytes: ", ArraySize(body), ". HTTP: ", status);
   UpdateStatusLabel("OK " + _Symbol + " " + TimeframeToString(_Period) + " sent " + TimeToString(newestClosedTime, TIME_DATE | TIME_MINUTES), clrLimeGreen);
   return true;
}

void PollBackendCommands()
{
   string url = ServerBaseUrl() + "/mt5/commands";
   char body[];
   char response[];
   string responseHeaders = "";

   ResetLastError();
   int status = WebRequest("GET", url, "", 5000, body, response, responseHeaders);
   if(status == -1)
   {
      Print("Backend command poll failed. Error: ", GetLastError());
      return;
   }

   if(status < 200 || status >= 300)
   {
      Print("Backend command poll returned HTTP ", status, ".");
      return;
   }

   string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
   string commands[];
   int commandCount = ExtractJsonObjectsFromArray(responseText, "commands", commands);

   for(int i = 0; i < commandCount; i++)
      ProcessBackendCommand(commands[i]);
}

void ProcessBackendCommand(const string commandJson)
{
   string type = JsonGetStringValue(commandJson, "type");

   if(type == "CALCULATE_RISK_LOT")
   {
      if(EnableRiskCalculatorCommands)
         ProcessRiskCalculatorCommand(commandJson);
      else
         PostDisabledRiskCalculatorResult(commandJson);
      return;
   }

   if(type == "PLACE_ORDER")
   {
      ProcessPlaceOrderCommand(commandJson);
      return;
   }

   if(IsTradeManagementCommandType(type))
   {
      if(EnableTradeManagement)
         ProcessTradeManagementCommand(commandJson, type);
      else
         PostDisabledTradeManagementResult(commandJson, type);
      return;
   }

   if(type != "")
      Print("Unknown backend command ignored: ", type);
}

void ProcessRiskCalculatorCommand(const string commandJson)
{
   string type = JsonGetStringValue(commandJson, "type");
   if(type != "CALCULATE_RISK_LOT")
      return;

   string requestId = JsonGetStringValue(commandJson, "requestId");
   if(requestId == "")
   {
      Print("Risk calculator command ignored: missing requestId.");
      return;
   }

   string symbol = JsonGetStringValue(commandJson, "symbol");
   string side = JsonGetStringValue(commandJson, "side");
   string riskBasis = JsonGetStringValue(commandJson, "riskBasis");
   string riskMode = JsonGetStringValue(commandJson, "riskMode");
   double riskValue = JsonGetDoubleValue(commandJson, "riskValue");
   double entryPrice = JsonGetDoubleValue(commandJson, "entryPrice");
   double stopLossPrice = JsonGetDoubleValue(commandJson, "stopLossPrice");

   string error = "";
   string warnings[];
   string result = BuildRiskLotResult(requestId, symbol, side, riskBasis, riskMode, riskValue, entryPrice, stopLossPrice, error, warnings);

   if(!PostRiskCalculatorResult(result))
      Print("Failed to post risk calculator result for request ", requestId);
}

void PostDisabledRiskCalculatorResult(const string commandJson)
{
   string requestId = JsonGetStringValue(commandJson, "requestId");
   if(requestId == "")
   {
      Print("Risk calculator command ignored: missing requestId.");
      return;
   }

   string warnings[];
   string result = BuildRiskErrorJson(requestId, "Risk calculator commands disabled in EA inputs.", warnings);
   PostRiskCalculatorResult(result);
}

void ProcessPlaceOrderCommand(const string commandJson)
{
   PlaceOrderCommand command;
   command.requestId = JsonGetStringValue(commandJson, "requestId");
   command.symbol = JsonGetStringValue(commandJson, "symbol");
   command.orderKind = JsonGetStringValue(commandJson, "orderKind");
   command.side = JsonGetStringValue(commandJson, "side");
   command.volume = JsonGetDoubleValue(commandJson, "volume");
   command.entryPrice = JsonGetDoubleValue(commandJson, "entryPrice");
   command.sl = JsonGetDoubleValue(commandJson, "sl");
   command.tp = JsonGetDoubleValue(commandJson, "tp");
   command.slProvided = JsonHasUsableNumber(commandJson, "sl") && command.sl > 0;
   command.tpProvided = JsonHasUsableNumber(commandJson, "tp") && command.tp > 0;
   command.comment = JsonGetStringValue(commandJson, "comment");
   command.magic = (long)JsonGetDoubleValue(commandJson, "magic");

   if(command.requestId == "")
   {
      Print("PLACE_ORDER command ignored: missing requestId.");
      return;
   }

   if(IsProcessedOrderRequest(command.requestId))
   {
      Print("Duplicate PLACE_ORDER command ignored. requestId: ", command.requestId);
      return;
   }

   RememberProcessedOrderRequest(command.requestId);

   string result = ExecutePlaceOrder(command);
   if(!PostOrderResult(result))
      Print("Failed to post order result for request ", command.requestId);
}

bool IsTradeManagementCommandType(const string type)
{
   return type == "CLOSE_POSITION" ||
          type == "MODIFY_POSITION" ||
          type == "MOVE_TO_BREAKEVEN" ||
          type == "CANCEL_ORDER" ||
          type == "MODIFY_ORDER";
}

void ProcessTradeManagementCommand(const string commandJson, const string commandType)
{
   TradeManagementCommand command;
   command.requestId = JsonGetStringValue(commandJson, "requestId");
   command.commandType = commandType;
   command.symbol = JsonGetStringValue(commandJson, "symbol");
   command.ticket = JsonGetTicketValue(commandJson, "ticket");
   command.volume = JsonGetDoubleValue(commandJson, "volume");
   command.volumeProvided = JsonHasUsableNumber(commandJson, "volume") && command.volume > 0;
   command.sl = JsonGetDoubleValue(commandJson, "sl");
   command.slProvided = JsonHasUsableNumber(commandJson, "sl") && command.sl > 0;
   command.tp = JsonGetDoubleValue(commandJson, "tp");
   command.tpProvided = JsonHasUsableNumber(commandJson, "tp") && command.tp > 0;
   command.entryPrice = JsonGetDoubleValue(commandJson, "entryPrice");
   command.entryPriceProvided = JsonHasUsableNumber(commandJson, "entryPrice") && command.entryPrice > 0;
   command.offsetPoints = JsonHasUsableNumber(commandJson, "offsetPoints") ? JsonGetDoubleValue(commandJson, "offsetPoints") : 0;

   if(command.requestId == "")
   {
      Print(commandType, " command ignored: missing requestId.");
      return;
   }

   if(IsProcessedTradeManagementRequest(command.requestId))
   {
      Print("Duplicate ", commandType, " command ignored. requestId: ", command.requestId);
      return;
   }

   RememberProcessedTradeManagementRequest(command.requestId);

   string result = ExecuteTradeManagementCommand(command);
   if(!PostTradeManagementResult(result))
      Print("Failed to post trade-management result for request ", command.requestId);
}

void PostDisabledTradeManagementResult(const string commandJson, const string commandType)
{
   string requestId = JsonGetStringValue(commandJson, "requestId");
   string symbol = JsonGetStringValue(commandJson, "symbol");
   ulong ticket = JsonGetTicketValue(commandJson, "ticket");

   if(requestId == "")
   {
      Print(commandType, " command ignored: missing requestId.");
      return;
   }

   string result = BuildTradeManagementResultJson(requestId,
                                                  commandType,
                                                  false,
                                                  ticket,
                                                  symbol,
                                                  0,
                                                  "Trade management disabled in EA inputs.");
   PostTradeManagementResult(result);
}

string ExecuteTradeManagementCommand(TradeManagementCommand &command)
{
   string error = ValidateTradeManagementCommandBase(command);
   if(error != "")
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, error);

   if(command.commandType == "CLOSE_POSITION")
      return ExecuteClosePositionCommand(command);

   if(command.commandType == "MODIFY_POSITION")
      return ExecuteModifyPositionCommand(command);

   if(command.commandType == "MOVE_TO_BREAKEVEN")
      return ExecuteMoveToBreakevenCommand(command);

   if(command.commandType == "CANCEL_ORDER")
      return ExecuteCancelOrderCommand(command);

   if(command.commandType == "MODIFY_ORDER")
      return ExecuteModifyOrderCommand(command);

   return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Unsupported trade-management command type.");
}

string ValidateTradeManagementCommandBase(TradeManagementCommand &command)
{
   if(command.requestId == "")
      return "requestId is required";
   if(command.ticket == 0)
      return "ticket is required";
   if(command.symbol == "")
      return "symbol is required";
   if(!SymbolSelect(command.symbol, true))
      return "Symbol is not available";
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      return "MT5 Algo Trading is disabled.";
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
      return "Live trading is not allowed for this EA.";
   if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
      return "Trading is disabled for this account.";
   if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      return "Expert trading is disabled for this account.";

   return "";
}

string ExecuteClosePositionCommand(TradeManagementCommand &command)
{
   if(!PositionSelectByTicket(command.ticket))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position ticket was not found.");

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   if(positionSymbol != command.symbol)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position symbol does not match command symbol.");

   MqlTick tick;
   ZeroMemory(tick);
   if(!SymbolInfoTick(command.symbol, tick))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Symbol tick is not available.");

   double currentVolume = PositionGetDouble(POSITION_VOLUME);
   long positionType = PositionGetInteger(POSITION_TYPE);
   double volumeMin = SymbolInfoDouble(command.symbol, SYMBOL_VOLUME_MIN);
   double volumeStep = SymbolInfoDouble(command.symbol, SYMBOL_VOLUME_STEP);

   if(currentVolume <= 0 || !MathIsValidNumber(currentVolume))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position volume is invalid.");

   if(volumeStep <= 0 || !MathIsValidNumber(volumeStep))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Volume step must be greater than 0.");

   bool partialClose = command.volumeProvided;
   double closeVolume = partialClose ? command.volume : currentVolume;

   if(closeVolume <= 0 || !MathIsValidNumber(closeVolume))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Close volume must be greater than 0.");

   if(closeVolume > currentVolume + 0.00000001)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Close volume exceeds current position volume.");

   if(partialClose && closeVolume >= currentVolume - 0.00000001)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Partial close volume must be less than current position volume.");

   closeVolume = NormalizeOrderVolumeDown(closeVolume, volumeStep);
   if(volumeMin > 0 && closeVolume < volumeMin)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Close volume is below broker minimum.");

   if(partialClose)
   {
      double remainingVolume = NormalizeDouble(currentVolume - closeVolume, VolumeDigitsFromStep(volumeStep));
      if(volumeMin > 0 && remainingVolume > 0 && remainingVolume < volumeMin)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Remaining position volume would be below broker minimum.");
   }

   MqlTradeRequest request;
   ZeroMemory(request);

   request.action = TRADE_ACTION_DEAL;
   request.position = command.ticket;
   request.symbol = command.symbol;
   request.volume = closeVolume;
   request.deviation = MaxDeviationPoints;
   request.type_filling = GetOrderFillingMode(command.symbol);

   if(positionType == POSITION_TYPE_BUY)
   {
      request.type = ORDER_TYPE_SELL;
      request.price = NormalizeDouble(tick.bid, (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS));
   }
   else if(positionType == POSITION_TYPE_SELL)
   {
      request.type = ORDER_TYPE_BUY;
      request.price = NormalizeDouble(tick.ask, (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS));
   }
   else
   {
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Unsupported position type.");
   }

   return SendTradeManagementRequest(command, request, partialClose ? "Position partially closed" : "Position closed");
}

string ExecuteModifyPositionCommand(TradeManagementCommand &command)
{
   if(!PositionSelectByTicket(command.ticket))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position ticket was not found.");

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   if(positionSymbol != command.symbol)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position symbol does not match command symbol.");

   if(!command.slProvided && !command.tpProvided)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "At least one of SL or TP must be provided.");

   int digits = (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS);
   double sl = command.slProvided ? NormalizeDouble(command.sl, digits) : PositionGetDouble(POSITION_SL);
   double tp = command.tpProvided ? NormalizeDouble(command.tp, digits) : PositionGetDouble(POSITION_TP);
   bool effectiveSlProvided = sl > 0 && MathIsValidNumber(sl);
   bool effectiveTpProvided = tp > 0 && MathIsValidNumber(tp);

   string error = ValidatePositionStopLevels(command.symbol, PositionGetInteger(POSITION_TYPE), sl, effectiveSlProvided, tp, effectiveTpProvided);
   if(error != "")
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, error);

   MqlTradeRequest request;
   ZeroMemory(request);

   request.action = TRADE_ACTION_SLTP;
   request.position = command.ticket;
   request.symbol = command.symbol;
   request.sl = sl;
   request.tp = tp;

   return SendTradeManagementRequest(command, request, "Position SL/TP modified");
}

string ExecuteMoveToBreakevenCommand(TradeManagementCommand &command)
{
   if(!PositionSelectByTicket(command.ticket))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position ticket was not found.");

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   if(positionSymbol != command.symbol)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Position symbol does not match command symbol.");

   if(command.offsetPoints < 0 || !MathIsValidNumber(command.offsetPoints))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "offsetPoints must be greater than or equal to 0.");

   double point = SymbolInfoDouble(command.symbol, SYMBOL_POINT);
   if(point <= 0 || !MathIsValidNumber(point))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Symbol point must be greater than 0.");

   long positionType = PositionGetInteger(POSITION_TYPE);
   double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
   int digits = (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS);
   double newSl = positionType == POSITION_TYPE_SELL
      ? openPrice - command.offsetPoints * point
      : openPrice + command.offsetPoints * point;
   newSl = NormalizeDouble(newSl, digits);

   string error = ValidatePositionStopLevels(command.symbol, positionType, newSl, true, PositionGetDouble(POSITION_TP), false);
   if(error != "")
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, error);

   MqlTradeRequest request;
   ZeroMemory(request);

   request.action = TRADE_ACTION_SLTP;
   request.position = command.ticket;
   request.symbol = command.symbol;
   request.sl = newSl;
   request.tp = PositionGetDouble(POSITION_TP);

   return SendTradeManagementRequest(command, request, "Position moved to breakeven");
}

string ExecuteCancelOrderCommand(TradeManagementCommand &command)
{
   if(!OrderSelect(command.ticket))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Pending order ticket was not found.");

   string orderSymbol = OrderGetString(ORDER_SYMBOL);
   if(orderSymbol != command.symbol)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Pending order symbol does not match command symbol.");

   long orderType = OrderGetInteger(ORDER_TYPE);
   if(!IsPendingOrderType(orderType))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Ticket is not an active pending order.");

   MqlTradeRequest request;
   ZeroMemory(request);

   request.action = TRADE_ACTION_REMOVE;
   request.order = command.ticket;
   request.symbol = command.symbol;

   return SendTradeManagementRequest(command, request, "Pending order canceled");
}

string ExecuteModifyOrderCommand(TradeManagementCommand &command)
{
   if(!OrderSelect(command.ticket))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Pending order ticket was not found.");

   string orderSymbol = OrderGetString(ORDER_SYMBOL);
   if(orderSymbol != command.symbol)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Pending order symbol does not match command symbol.");

   long orderType = OrderGetInteger(ORDER_TYPE);
   if(orderType != ORDER_TYPE_BUY_LIMIT && orderType != ORDER_TYPE_SELL_LIMIT)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Only BUY_LIMIT and SELL_LIMIT pending orders are supported.");

   if(!command.entryPriceProvided)
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "entryPrice is required.");

   MqlTick tick;
   ZeroMemory(tick);
   if(!SymbolInfoTick(command.symbol, tick))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Symbol tick is not available.");

   int digits = (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS);
   double entryPrice = NormalizeDouble(command.entryPrice, digits);
   double sl = command.slProvided ? NormalizeDouble(command.sl, digits) : OrderGetDouble(ORDER_SL);
   double tp = command.tpProvided ? NormalizeDouble(command.tp, digits) : OrderGetDouble(ORDER_TP);
   bool effectiveSlProvided = sl > 0 && MathIsValidNumber(sl);
   bool effectiveTpProvided = tp > 0 && MathIsValidNumber(tp);

   if(entryPrice <= 0 || !MathIsValidNumber(entryPrice))
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Entry price must be greater than 0.");

   if(orderType == ORDER_TYPE_BUY_LIMIT)
   {
      if(entryPrice >= tick.ask)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Buy Limit entry must be below current ask.");
      if(effectiveSlProvided && sl >= entryPrice)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Stop loss must be below entry for BUY_LIMIT.");
      if(effectiveTpProvided && tp <= entryPrice)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Take profit must be above entry for BUY_LIMIT.");
   }
   else
   {
      if(entryPrice <= tick.bid)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Sell Limit entry must be above current bid.");
      if(effectiveSlProvided && sl <= entryPrice)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Stop loss must be above entry for SELL_LIMIT.");
      if(effectiveTpProvided && tp >= entryPrice)
         return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, "Take profit must be below entry for SELL_LIMIT.");
   }

   string distanceError = ValidatePendingModificationDistances(command.symbol, orderType, entryPrice, sl, effectiveSlProvided, tp, effectiveTpProvided, tick);
   if(distanceError != "")
      return BuildTradeManagementResultJson(command.requestId, command.commandType, false, command.ticket, command.symbol, 0, distanceError);

   MqlTradeRequest request;
   ZeroMemory(request);

   request.action = TRADE_ACTION_MODIFY;
   request.order = command.ticket;
   request.symbol = command.symbol;
   request.price = entryPrice;
   request.sl = sl;
   request.tp = tp;
   request.type_time = (ENUM_ORDER_TYPE_TIME)OrderGetInteger(ORDER_TYPE_TIME);
   request.expiration = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);

   return SendTradeManagementRequest(command, request, "Pending order modified");
}

string ExecutePlaceOrder(PlaceOrderCommand &command)
{
   string error = "";
   MqlTick tick;
   ZeroMemory(tick);

   if(command.symbol == "")
      error = "Symbol is required";
   else if(!SymbolSelect(command.symbol, true))
      error = "Symbol is not available";
   else if(!SymbolInfoTick(command.symbol, tick))
      error = "Symbol tick is not available";
   else if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      error = "MT5 Algo Trading is disabled.";
   else if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
      error = "Live trading is not allowed for this EA.";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
      error = "Trading is disabled for this account.";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      error = "Expert trading is disabled for this account.";
   else if(command.orderKind != "MARKET" && command.orderKind != "LIMIT")
      error = "Order kind must be MARKET or LIMIT";
   else if(command.side != "BUY" && command.side != "SELL")
      error = "Side must be BUY or SELL";
   else if(command.volume <= 0 || !MathIsValidNumber(command.volume))
      error = "Volume must be greater than 0";
   else if(command.volume > MaxAllowedVolume)
      error = "Volume exceeds MaxAllowedVolume EA input";
   else if(command.orderKind == "LIMIT" && (command.entryPrice <= 0 || !MathIsValidNumber(command.entryPrice)))
      error = "Limit entry price must be greater than 0";
   else if(RequireStopLossForOrders && !command.slProvided)
      error = "Stop loss is required by EA inputs";

   int digits = 0;
   double point = 0;
   double volumeMin = 0;
   double volumeMax = 0;
   double volumeStep = 0;
   long stopsLevel = 0;
   long freezeLevel = 0;

   if(error == "")
   {
      digits = (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS);
      point = SymbolInfoDouble(command.symbol, SYMBOL_POINT);
      volumeMin = SymbolInfoDouble(command.symbol, SYMBOL_VOLUME_MIN);
      volumeMax = SymbolInfoDouble(command.symbol, SYMBOL_VOLUME_MAX);
      volumeStep = SymbolInfoDouble(command.symbol, SYMBOL_VOLUME_STEP);
      stopsLevel = SymbolInfoInteger(command.symbol, SYMBOL_TRADE_STOPS_LEVEL);
      freezeLevel = SymbolInfoInteger(command.symbol, SYMBOL_TRADE_FREEZE_LEVEL);

      if(point <= 0 || !MathIsValidNumber(point))
         error = "Symbol point must be greater than 0";
      else if(volumeStep <= 0 || !MathIsValidNumber(volumeStep))
         error = "Volume step must be greater than 0";
   }

   double normalizedVolume = 0;
   double entryPrice = 0;
   double sl = 0;
   double tp = 0;
   ENUM_ORDER_TYPE tradeType = ORDER_TYPE_BUY;
   ENUM_TRADE_REQUEST_ACTIONS action = TRADE_ACTION_DEAL;

   if(error == "")
   {
      normalizedVolume = NormalizeOrderVolumeDown(command.volume, volumeStep);

      if(volumeMin > 0 && normalizedVolume < volumeMin)
         error = "Volume is below broker minimum after normalization";
      else if(volumeMax > 0 && normalizedVolume > volumeMax)
         error = "Volume exceeds broker maximum";
   }

   if(error == "")
   {
      if(command.orderKind == "MARKET")
      {
         action = TRADE_ACTION_DEAL;
         if(command.side == "BUY")
         {
            tradeType = ORDER_TYPE_BUY;
            entryPrice = tick.ask;
         }
         else
         {
            tradeType = ORDER_TYPE_SELL;
            entryPrice = tick.bid;
         }
      }
      else
      {
         action = TRADE_ACTION_PENDING;
         if(command.side == "BUY")
            tradeType = ORDER_TYPE_BUY_LIMIT;
         else
            tradeType = ORDER_TYPE_SELL_LIMIT;

         entryPrice = command.entryPrice;
      }

      entryPrice = NormalizeDouble(entryPrice, digits);
      sl = command.slProvided ? NormalizeDouble(command.sl, digits) : 0;
      tp = command.tpProvided ? NormalizeDouble(command.tp, digits) : 0;

      if(entryPrice <= 0 || !MathIsValidNumber(entryPrice))
         error = "Entry price must be greater than 0";
   }

   if(error == "")
   {
      if(command.orderKind == "LIMIT" && command.side == "BUY" && entryPrice >= tick.ask)
         error = "Buy Limit entry must be below current ask";
      else if(command.orderKind == "LIMIT" && command.side == "SELL" && entryPrice <= tick.bid)
         error = "Sell Limit entry must be above current bid";
      else if(command.side == "BUY" && command.slProvided && sl >= entryPrice)
         error = "Stop loss must be below entry for BUY";
      else if(command.side == "SELL" && command.slProvided && sl <= entryPrice)
         error = "Stop loss must be above entry for SELL";
      else if(command.side == "BUY" && command.tpProvided && tp <= entryPrice)
         error = "Take profit must be above entry for BUY";
      else if(command.side == "SELL" && command.tpProvided && tp >= entryPrice)
         error = "Take profit must be below entry for SELL";
   }

   if(error == "")
      error = ValidateOrderDistances(command, entryPrice, sl, tp, tick, point, stopsLevel, freezeLevel);

   if(error == "")
   {
      double requiredMargin = 0;
      if(OrderCalcMargin(tradeType, command.symbol, normalizedVolume, entryPrice, requiredMargin))
      {
         double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
         if(requiredMargin > freeMargin)
            error = "Not enough free margin for order";
      }
      else
      {
         Print("OrderCalcMargin failed for ", command.symbol, ". Error: ", GetLastError());
      }
   }

   if(error != "")
      return BuildOrderResultJson(command, false, 0, 0, entryPrice, sl, tp, 0, error);

   MqlTradeRequest request;
   MqlTradeResult result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action = action;
   request.symbol = command.symbol;
   request.volume = normalizedVolume;
   request.type = tradeType;
   request.price = entryPrice;
   request.sl = command.slProvided ? sl : 0;
   request.tp = command.tpProvided ? tp : 0;
   request.deviation = MaxDeviationPoints;
   request.magic = (ulong)(command.magic > 0 ? command.magic : DefaultMagicNumber);
   request.comment = command.comment;

   if(action == TRADE_ACTION_PENDING)
   {
      request.type_time = ORDER_TIME_GTC;
      request.expiration = 0;
      request.type_filling = ORDER_FILLING_RETURN;
   }
   else
   {
      request.type_filling = GetOrderFillingMode(command.symbol);
   }

   ResetLastError();
   bool sent = OrderSend(request, result);
   int lastError = GetLastError();
   bool ok = sent && IsSuccessfulTradeRetcode(result.retcode);
   ulong ticket = result.order > 0 ? result.order : result.deal;
   string message = result.comment;

   if(message == "")
      message = ok ? "Order placed" : "OrderSend failed";

   if(!sent || !ok)
      message = message + " | GetLastError=" + IntegerToString(lastError) + " | retcode=" + IntegerToString((long)result.retcode);

   Print("PLACE_ORDER result requestId=", command.requestId,
         " ok=", ok,
         " retcode=", result.retcode,
         " ticket=", ticket,
         " message=", message);

   return BuildOrderResultJson(command,
                               ok,
                               ticket,
                               result.retcode,
                               entryPrice,
                               request.sl,
                               request.tp,
                               normalizedVolume,
                               message);
}

string ValidateOrderDistances(PlaceOrderCommand &command,
                              const double entryPrice,
                              const double sl,
                              const double tp,
                              const MqlTick &tick,
                              const double point,
                              const long stopsLevel,
                              const long freezeLevel)
{
   double minStopDistance = stopsLevel > 0 ? stopsLevel * point : 0;
   double minFreezeDistance = freezeLevel > 0 ? freezeLevel * point : 0;

   if(minStopDistance > 0)
   {
      if(command.orderKind == "LIMIT")
      {
         if(command.side == "BUY" && (tick.ask - entryPrice) < minStopDistance)
            return "Buy Limit entry is inside broker stops level";

         if(command.side == "SELL" && (entryPrice - tick.bid) < minStopDistance)
            return "Sell Limit entry is inside broker stops level";
      }

      if(command.slProvided && MathAbs(entryPrice - sl) < minStopDistance)
         return "Stop loss is inside broker stops level";

      if(command.tpProvided && MathAbs(entryPrice - tp) < minStopDistance)
         return "Take profit is inside broker stops level";
   }

   if(minFreezeDistance > 0 && command.orderKind == "LIMIT")
   {
      if(command.side == "BUY" && (tick.ask - entryPrice) < minFreezeDistance)
         return "Buy Limit entry is inside broker freeze level";

      if(command.side == "SELL" && (entryPrice - tick.bid) < minFreezeDistance)
         return "Sell Limit entry is inside broker freeze level";
   }

   return "";
}

double NormalizeOrderVolumeDown(const double volume, const double volumeStep)
{
   if(volume <= 0 || volumeStep <= 0)
      return 0;

   double normalized = MathFloor((volume / volumeStep) + 0.000000001) * volumeStep;
   return NormalizeDouble(normalized, VolumeDigitsFromStep(volumeStep));
}

ENUM_ORDER_TYPE_FILLING GetOrderFillingMode(const string symbol)
{
   long filling = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);

   if((filling & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      return ORDER_FILLING_FOK;

   if((filling & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      return ORDER_FILLING_IOC;

   return ORDER_FILLING_RETURN;
}

bool IsSuccessfulTradeRetcode(const uint retcode)
{
   return retcode == TRADE_RETCODE_DONE ||
          retcode == TRADE_RETCODE_PLACED ||
          retcode == TRADE_RETCODE_DONE_PARTIAL;
}

string BuildOrderResultJson(PlaceOrderCommand &command,
                            const bool ok,
                            const ulong ticket,
                            const uint retcode,
                            const double entryPrice,
                            const double sl,
                            const double tp,
                            const double volume,
                            const string message)
{
   int digits = 5;
   if(command.symbol != "" && SymbolSelect(command.symbol, true))
      digits = (int)SymbolInfoInteger(command.symbol, SYMBOL_DIGITS);

   double resultVolume = volume > 0 ? volume : command.volume;

   string json = "{";
   json += "\"type\":\"ORDER_RESULT\",";
   json += "\"requestId\":" + JsonString(command.requestId) + ",";
   json += "\"ok\":" + JsonBool(ok) + ",";
   json += "\"symbol\":" + JsonString(command.symbol) + ",";
   json += "\"orderKind\":" + JsonString(command.orderKind) + ",";
   json += "\"side\":" + JsonString(command.side) + ",";
   json += "\"volume\":" + JsonNumber(resultVolume, 8) + ",";
   json += "\"entryPrice\":" + JsonNumber(entryPrice > 0 ? entryPrice : command.entryPrice, digits) + ",";
   json += "\"sl\":" + JsonNullableOrderPrice(sl, command.slProvided, digits) + ",";
   json += "\"tp\":" + JsonNullableOrderPrice(tp, command.tpProvided, digits) + ",";
   if(ok)
      json += "\"ticket\":" + IntegerToString((long)ticket) + ",";
   json += "\"retcode\":" + IntegerToString((long)retcode) + ",";
   json += "\"message\":" + JsonString(message);
   json += "}";
   return json;
}

string JsonNullableOrderPrice(const double value, const bool provided, const int digits)
{
   if(!provided || value <= 0 || !MathIsValidNumber(value))
      return "null";

   return JsonNumber(value, digits);
}

bool PostOrderResult(const string payload)
{
   char body[];
   int bodyLength = StringToCharArray(payload, body, 0, WHOLE_ARRAY, CP_UTF8);
   if(bodyLength > 0)
      ArrayResize(body, bodyLength - 1);

   char response[];
   string responseHeaders = "";
   string headers = "Content-Type: application/json\r\n";
   string url = ServerBaseUrl() + "/mt5/order-result";

   ResetLastError();
   int status = WebRequest("POST", url, headers, 5000, body, response, responseHeaders);
   if(status == -1)
   {
      Print("Order result WebRequest failed. Error: ", GetLastError());
      return false;
   }

   if(status < 200 || status >= 300)
   {
      Print("Order result post returned HTTP ", status, ". Response: ", CharArrayToString(response, 0, -1, CP_UTF8));
      return false;
   }

   return true;
}

string SendTradeManagementRequest(TradeManagementCommand &command,
                                  MqlTradeRequest &request,
                                  const string successMessage)
{
   MqlTradeResult result;
   ZeroMemory(result);

   ResetLastError();
   bool sent = OrderSend(request, result);
   int lastError = GetLastError();
   bool ok = sent && IsSuccessfulTradeRetcode(result.retcode);
   string message = result.comment;

   if(message == "")
      message = ok ? successMessage : "Trade-management OrderSend failed";

   if(!sent || !ok)
      message = message + " | GetLastError=" + IntegerToString(lastError) + " | retcode=" + IntegerToString((long)result.retcode);

   Print(command.commandType, " result requestId=", command.requestId,
         " ok=", ok,
         " retcode=", result.retcode,
         " ticket=", command.ticket,
         " message=", message);

   return BuildTradeManagementResultJson(command.requestId,
                                         command.commandType,
                                         ok,
                                         command.ticket,
                                         command.symbol,
                                         result.retcode,
                                         message);
}

string ValidatePositionStopLevels(const string symbol,
                                  const long positionType,
                                  const double sl,
                                  const bool slProvided,
                                  const double tp,
                                  const bool tpProvided)
{
   MqlTick tick;
   ZeroMemory(tick);
   if(!SymbolInfoTick(symbol, tick))
      return "Symbol tick is not available.";

   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freezeLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minStopDistance = stopsLevel > 0 && point > 0 ? stopsLevel * point : 0;
   double minFreezeDistance = freezeLevel > 0 && point > 0 ? freezeLevel * point : 0;

   double reference = positionType == POSITION_TYPE_BUY ? tick.bid : tick.ask;
   if(reference <= 0 || !MathIsValidNumber(reference))
      return "Current price is invalid.";

   if(positionType == POSITION_TYPE_BUY)
   {
      if(slProvided && sl >= reference)
         return "Stop loss must be below current bid for BUY position.";
      if(tpProvided && tp <= reference)
         return "Take profit must be above current bid for BUY position.";
   }
   else if(positionType == POSITION_TYPE_SELL)
   {
      if(slProvided && sl <= reference)
         return "Stop loss must be above current ask for SELL position.";
      if(tpProvided && tp >= reference)
         return "Take profit must be below current ask for SELL position.";
   }
   else
   {
      return "Unsupported position type.";
   }

   if(minStopDistance > 0)
   {
      if(slProvided && MathAbs(reference - sl) < minStopDistance)
         return "Stop loss is inside broker stops level.";
      if(tpProvided && MathAbs(reference - tp) < minStopDistance)
         return "Take profit is inside broker stops level.";
   }

   if(minFreezeDistance > 0)
   {
      if(slProvided && MathAbs(reference - sl) < minFreezeDistance)
         return "Stop loss is inside broker freeze level.";
      if(tpProvided && MathAbs(reference - tp) < minFreezeDistance)
         return "Take profit is inside broker freeze level.";
   }

   return "";
}

string ValidatePendingModificationDistances(const string symbol,
                                            const long orderType,
                                            const double entryPrice,
                                            const double sl,
                                            const bool slProvided,
                                            const double tp,
                                            const bool tpProvided,
                                            const MqlTick &tick)
{
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freezeLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minStopDistance = stopsLevel > 0 && point > 0 ? stopsLevel * point : 0;
   double minFreezeDistance = freezeLevel > 0 && point > 0 ? freezeLevel * point : 0;

   if(minStopDistance > 0)
   {
      if(orderType == ORDER_TYPE_BUY_LIMIT && (tick.ask - entryPrice) < minStopDistance)
         return "Buy Limit entry is inside broker stops level.";
      if(orderType == ORDER_TYPE_SELL_LIMIT && (entryPrice - tick.bid) < minStopDistance)
         return "Sell Limit entry is inside broker stops level.";
      if(slProvided && MathAbs(entryPrice - sl) < minStopDistance)
         return "Stop loss is inside broker stops level.";
      if(tpProvided && MathAbs(entryPrice - tp) < minStopDistance)
         return "Take profit is inside broker stops level.";
   }

   if(minFreezeDistance > 0)
   {
      if(orderType == ORDER_TYPE_BUY_LIMIT && (tick.ask - entryPrice) < minFreezeDistance)
         return "Buy Limit entry is inside broker freeze level.";
      if(orderType == ORDER_TYPE_SELL_LIMIT && (entryPrice - tick.bid) < minFreezeDistance)
         return "Sell Limit entry is inside broker freeze level.";
   }

   return "";
}

string BuildTradeManagementResultJson(const string requestId,
                                      const string commandType,
                                      const bool ok,
                                      const ulong ticket,
                                      const string symbol,
                                      const uint retcode,
                                      const string message)
{
   string json = "{";
   json += "\"type\":\"TRADE_MANAGEMENT_RESULT\",";
   json += "\"requestId\":" + JsonString(requestId) + ",";
   json += "\"commandType\":" + JsonString(commandType) + ",";
   json += "\"ok\":" + JsonBool(ok) + ",";
   json += "\"ticket\":" + JsonString(IntegerToString((long)ticket)) + ",";
   json += "\"symbol\":" + JsonString(symbol) + ",";
   json += "\"retcode\":" + IntegerToString((long)retcode) + ",";
   json += "\"message\":" + JsonString(message);
   json += "}";
   return json;
}

bool PostTradeManagementResult(const string payload)
{
   char body[];
   int bodyLength = StringToCharArray(payload, body, 0, WHOLE_ARRAY, CP_UTF8);
   if(bodyLength > 0)
      ArrayResize(body, bodyLength - 1);

   char response[];
   string responseHeaders = "";
   string headers = "Content-Type: application/json\r\n";
   string url = ServerBaseUrl() + "/mt5/trade-management-result";

   ResetLastError();
   int status = WebRequest("POST", url, headers, 5000, body, response, responseHeaders);
   if(status == -1)
   {
      Print("Trade-management result WebRequest failed. Error: ", GetLastError());
      return false;
   }

   if(status < 200 || status >= 300)
   {
      Print("Trade-management result post returned HTTP ", status, ". Response: ", CharArrayToString(response, 0, -1, CP_UTF8));
      return false;
   }

   return true;
}

bool IsProcessedOrderRequest(const string requestId)
{
   for(int i = 0; i < ArraySize(processedOrderRequestIds); i++)
   {
      if(processedOrderRequestIds[i] == requestId)
         return true;
   }

   return false;
}

void RememberProcessedOrderRequest(const string requestId)
{
   int size = ArraySize(processedOrderRequestIds);
   if(size >= MAX_PROCESSED_ORDER_IDS)
   {
      for(int i = 1; i < size; i++)
         processedOrderRequestIds[i - 1] = processedOrderRequestIds[i];
      size = MAX_PROCESSED_ORDER_IDS - 1;
      ArrayResize(processedOrderRequestIds, size);
   }

   ArrayResize(processedOrderRequestIds, size + 1);
   processedOrderRequestIds[size] = requestId;
}

bool IsProcessedTradeManagementRequest(const string requestId)
{
   for(int i = 0; i < ArraySize(processedTradeManagementRequestIds); i++)
   {
      if(processedTradeManagementRequestIds[i] == requestId)
         return true;
   }

   return false;
}

void RememberProcessedTradeManagementRequest(const string requestId)
{
   int size = ArraySize(processedTradeManagementRequestIds);
   if(size >= MAX_PROCESSED_TRADE_MANAGEMENT_IDS)
   {
      for(int i = 1; i < size; i++)
         processedTradeManagementRequestIds[i - 1] = processedTradeManagementRequestIds[i];
      size = MAX_PROCESSED_TRADE_MANAGEMENT_IDS - 1;
      ArrayResize(processedTradeManagementRequestIds, size);
   }

   ArrayResize(processedTradeManagementRequestIds, size + 1);
   processedTradeManagementRequestIds[size] = requestId;
}

string BuildRiskLotResult(const string requestId,
                          const string symbol,
                          const string side,
                          const string riskBasis,
                          const string riskMode,
                          const double riskValue,
                          const double entryPrice,
                          const double stopLossPrice,
                          string &error,
                          string &warnings[])
{
   if(symbol == "")
      error = "Symbol is required";
   else if(!SymbolSelect(symbol, true))
      error = "Symbol is not available";
   else if(side != "BUY" && side != "SELL")
      error = "Side must be BUY or SELL";
   else if(riskBasis != "EQUITY" && riskBasis != "BALANCE")
      error = "Risk basis must be EQUITY or BALANCE";
   else if(riskMode != "PERCENT" && riskMode != "FIXED")
      error = "Risk mode must be PERCENT or FIXED";
   else if(riskValue <= 0 || !MathIsValidNumber(riskValue))
      error = "Risk value must be greater than 0";
   else if(entryPrice <= 0 || !MathIsValidNumber(entryPrice))
      error = "Entry price must be greater than 0";
   else if(stopLossPrice <= 0 || !MathIsValidNumber(stopLossPrice))
      error = "Stop-loss price must be greater than 0";
   else if(side == "BUY" && stopLossPrice >= entryPrice)
      error = "Stop-loss must be below entry for BUY";
   else if(side == "SELL" && stopLossPrice <= entryPrice)
      error = "Stop-loss must be above entry for SELL";

   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double volumeMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double volumeMax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volumeStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   long digits = SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double accountEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskBasisAmount = riskBasis == "BALANCE" ? AccountInfoDouble(ACCOUNT_BALANCE) : AccountInfoDouble(ACCOUNT_EQUITY);
   double riskAmount = riskMode == "PERCENT" ? riskBasisAmount * riskValue / 100.0 : riskValue;
   double stopDistancePrice = MathAbs(entryPrice - stopLossPrice);
   double stopDistancePoints = point > 0 ? stopDistancePrice / point : 0;
   double lossPerLot = tickSize > 0 && tickValue > 0 ? stopDistancePrice / tickSize * tickValue : 0;
   double rawVolume = lossPerLot > 0 ? riskAmount / lossPerLot : 0;
   double normalizedVolume = 0;
   double estimatedLoss = 0;

   if(error == "")
   {
      if(tickSize <= 0 || !MathIsValidNumber(tickSize))
         error = "Tick size must be greater than 0";
      else if(tickValue <= 0 || !MathIsValidNumber(tickValue))
         error = "Tick value must be greater than 0";
      else if(volumeStep <= 0 || !MathIsValidNumber(volumeStep))
         error = "Volume step must be greater than 0";
      else if(riskBasisAmount <= 0 || !MathIsValidNumber(riskBasisAmount))
         error = "Risk basis amount must be greater than 0";
      else if(riskAmount <= 0 || !MathIsValidNumber(riskAmount))
         error = "Risk amount must be greater than 0";
      else if(riskMode == "FIXED" && accountEquity > 0 && riskValue > accountEquity)
         error = "Fixed risk amount must not exceed account equity";
      else if(lossPerLot <= 0 || !MathIsValidNumber(lossPerLot))
         error = "Loss per lot must be greater than 0";
   }

   if(error == "")
   {
      if(riskMode == "PERCENT" && riskValue > 5.0)
         AddWarning(warnings, "Risk percent is above 5%.");

      if(point > 0 && (tickSize > point * 100.0 || tickSize < point / 10.0))
         AddWarning(warnings, "Tick size is unusual compared with point size.");

      if(stopDistancePoints > 0 && stopDistancePoints < 10.0)
         AddWarning(warnings, "Stop distance is very small.");

      if(tickSize > 0 && stopDistancePrice < tickSize)
         AddWarning(warnings, "Stop distance is smaller than one tick.");

      normalizedVolume = NormalizeRiskVolume(rawVolume, volumeMin, volumeMax, volumeStep);

      if(volumeMin > 0 && rawVolume < volumeMin)
         AddWarning(warnings, "Normalized volume was raised to broker minimum.");

      if(volumeMax > 0 && rawVolume > volumeMax)
         AddWarning(warnings, "Raw volume exceeded broker maximum and was capped.");

      estimatedLoss = normalizedVolume * lossPerLot;
      if(MathAbs(estimatedLoss - riskAmount) > MathMax(0.01, riskAmount * 0.01))
         AddWarning(warnings, "Estimated loss differs materially from target risk after volume normalization.");
   }

   if(error != "")
      return BuildRiskErrorJson(requestId, error, warnings);

   string json = "{";
   json += "\"type\":\"RISK_LOT_RESULT\",";
   json += "\"requestId\":" + JsonString(requestId) + ",";
   json += "\"ok\":true,";
   json += "\"symbol\":" + JsonString(symbol) + ",";
   json += "\"side\":" + JsonString(side) + ",";
   json += "\"riskBasis\":" + JsonString(riskBasis) + ",";
   json += "\"riskMode\":" + JsonString(riskMode) + ",";
   json += "\"riskValue\":" + JsonNumber(riskValue, 8) + ",";
   json += "\"riskBasisAmount\":" + JsonNumber(riskBasisAmount, 2) + ",";
   json += "\"riskAmount\":" + JsonNumber(riskAmount, 2) + ",";
   json += "\"entryPrice\":" + JsonNumber(entryPrice, (int)digits) + ",";
   json += "\"stopLossPrice\":" + JsonNumber(stopLossPrice, (int)digits) + ",";
   json += "\"stopDistancePoints\":" + JsonNumber(stopDistancePoints, 2) + ",";
   json += "\"tickSize\":" + JsonNumber(tickSize, 8) + ",";
   json += "\"tickValue\":" + JsonNumber(tickValue, 8) + ",";
   json += "\"volumeMin\":" + JsonNumber(volumeMin, 8) + ",";
   json += "\"volumeMax\":" + JsonNumber(volumeMax, 8) + ",";
   json += "\"volumeStep\":" + JsonNumber(volumeStep, 8) + ",";
   json += "\"rawVolume\":" + JsonNumber(rawVolume, 8) + ",";
   json += "\"normalizedVolume\":" + JsonNumber(normalizedVolume, 8) + ",";
   json += "\"estimatedLoss\":" + JsonNumber(estimatedLoss, 2) + ",";
   json += "\"warnings\":" + JsonStringArray(warnings);
   json += "}";
   return json;
}

double NormalizeRiskVolume(const double rawVolume, const double volumeMin, const double volumeMax, const double volumeStep)
{
   if(rawVolume <= 0 || volumeStep <= 0)
      return 0;

   double normalized = MathFloor(rawVolume / volumeStep) * volumeStep;

   if(volumeMin > 0 && normalized < volumeMin)
      normalized = volumeMin;

   if(volumeMax > 0 && normalized > volumeMax)
      normalized = volumeMax;

   return NormalizeDouble(normalized, VolumeDigitsFromStep(volumeStep));
}

int VolumeDigitsFromStep(const double step)
{
   string text = DoubleToString(step, 8);
   int dot = StringFind(text, ".");
   if(dot < 0)
      return 0;

   int digits = StringLen(text) - dot - 1;
   while(digits > 0 && StringGetCharacter(text, dot + digits) == '0')
      digits--;

   return digits;
}

string BuildRiskErrorJson(const string requestId, const string error, string &warnings[])
{
   string json = "{";
   json += "\"type\":\"RISK_LOT_RESULT\",";
   json += "\"requestId\":" + JsonString(requestId) + ",";
   json += "\"ok\":false,";
   json += "\"error\":" + JsonString(error) + ",";
   json += "\"warnings\":" + JsonStringArray(warnings);
   json += "}";
   return json;
}

bool PostRiskCalculatorResult(const string payload)
{
   char body[];
   int bodyLength = StringToCharArray(payload, body, 0, WHOLE_ARRAY, CP_UTF8);
   if(bodyLength > 0)
      ArrayResize(body, bodyLength - 1);

   char response[];
   string responseHeaders = "";
   string headers = "Content-Type: application/json\r\n";
   string url = ServerBaseUrl() + "/mt5/risk-result";

   ResetLastError();
   int status = WebRequest("POST", url, headers, 5000, body, response, responseHeaders);
   if(status == -1)
   {
      Print("Risk result WebRequest failed. Error: ", GetLastError());
      return false;
   }

   if(status < 200 || status >= 300)
   {
      Print("Risk result post returned HTTP ", status, ". Response: ", CharArrayToString(response, 0, -1, CP_UTF8));
      return false;
   }

   return true;
}

void CreateStatusLabel()
{
   ObjectDelete(0, LEGACY_STATUS_LABEL_NAME);

   for(int i = 0; i < 3; i++)
   {
      string name = StatusLabelName(i);
      if(ObjectFind(0, name) >= 0)
         ObjectDelete(0, name);

      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, 12);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, 18 + (i * 15));
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 10);
      ObjectSetInteger(0, name, OBJPROP_BACK, false);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
      ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   }
}

void UpdateStatusLabel(const string message, const color textColor)
{
   if(ObjectFind(0, StatusLabelName(0)) < 0)
      CreateStatusLabel();

   SetStatusLine(0, "MT5 Dashboard Bridge", clrWhite);
   SetStatusLine(1, ShortenStatusText(message, 78), textColor);
   SetStatusLine(2, "Chart: " + _Symbol + " " + TimeframeToString(_Period) + " | mirrors this chart only", clrSilver);
   ChartRedraw(0);
}

void SetStatusLine(const int line, const string text, const color textColor)
{
   string name = StatusLabelName(line);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, textColor);
}

void DeleteStatusLabels()
{
   ObjectDelete(0, LEGACY_STATUS_LABEL_NAME);
   for(int i = 0; i < 3; i++)
      ObjectDelete(0, StatusLabelName(i));
}

string StatusLabelName(const int line)
{
   return STATUS_LABEL_PREFIX + IntegerToString(line);
}

string ShortenStatusText(const string text, const int maxLength)
{
   if(StringLen(text) <= maxLength)
      return text;

   return StringSubstr(text, 0, maxLength - 3) + "...";
}

string JsonBufferNumber(const bool enabled,
                        const double &values[],
                        const int copied,
                        const int index,
                        const int digits)
{
   if(!enabled || copied <= 0 || index < 0 || index >= copied)
      return "null";

   return JsonNumber(values[index], digits);
}

string JsonSRNumber(const bool enabled, const double value)
{
   if(!enabled)
      return "null";

   return JsonNumber(value, JSON_DECIMALS);
}

string JsonNumber(const double value, const int digits)
{
   if(!MathIsValidNumber(value) || value == EMPTY_VALUE)
      return "null";

   return DoubleToString(value, digits);
}

string JsonBool(const bool value)
{
   return value ? "true" : "false";
}

string JsonStringArray(string &values[])
{
   string json = "[";
   for(int i = 0; i < ArraySize(values); i++)
   {
      if(i > 0)
         json += ",";
      json += JsonString(values[i]);
   }
   json += "]";
   return json;
}

string JsonString(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return "\"" + value + "\"";
}

void AddWarning(string &warnings[], const string warning)
{
   int size = ArraySize(warnings);
   ArrayResize(warnings, size + 1);
   warnings[size] = warning;
}

string ServerBaseUrl()
{
   int marker = StringFind(ServerUrl, "/mt5/update");
   if(marker >= 0)
      return StringSubstr(ServerUrl, 0, marker);

   return "http://127.0.0.1:3001";
}

int ExtractJsonObjectsFromArray(const string json, const string key, string &objects[])
{
   ArrayResize(objects, 0);

   int keyPos = StringFind(json, "\"" + key + "\"");
   if(keyPos < 0)
      return 0;

   int arrayStart = StringFind(json, "[", keyPos);
   if(arrayStart < 0)
      return 0;

   bool inString = false;
   bool escaped = false;
   int depth = 0;
   int objectStart = -1;

   for(int i = arrayStart + 1; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);

      if(inString)
      {
         if(escaped)
            escaped = false;
         else if(ch == '\\')
            escaped = true;
         else if(ch == '"')
            inString = false;
         continue;
      }

      if(ch == '"')
      {
         inString = true;
         continue;
      }

      if(ch == '{')
      {
         if(depth == 0)
            objectStart = i;
         depth++;
         continue;
      }

      if(ch == '}')
      {
         depth--;
         if(depth == 0 && objectStart >= 0)
         {
            int size = ArraySize(objects);
            ArrayResize(objects, size + 1);
            objects[size] = StringSubstr(json, objectStart, i - objectStart + 1);
            objectStart = -1;
         }
         continue;
      }

      if(ch == ']' && depth == 0)
         break;
   }

   return ArraySize(objects);
}

string JsonGetStringValue(const string json, const string key)
{
   int colon = JsonFindValueStart(json, key);
   if(colon < 0)
      return "";

   int start = SkipWhitespace(json, colon);
   if(start >= StringLen(json) || StringGetCharacter(json, start) != '"')
      return "";

   string value = "";
   bool escaped = false;

   for(int i = start + 1; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);

      if(escaped)
      {
         if(ch == 'n')
            value += "\n";
         else if(ch == 'r')
            value += "\r";
         else if(ch == 't')
            value += "\t";
         else
            value += ShortToString(ch);
         escaped = false;
         continue;
      }

      if(ch == '\\')
      {
         escaped = true;
         continue;
      }

      if(ch == '"')
         break;

      value += ShortToString(ch);
   }

   return value;
}

double JsonGetDoubleValue(const string json, const string key)
{
   int colon = JsonFindValueStart(json, key);
   if(colon < 0)
      return 0;

   int start = SkipWhitespace(json, colon);
   int end = start;

   while(end < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, end);
      if(ch == ',' || ch == '}' || ch == ']')
         break;
      end++;
   }

   return StringToDouble(StringSubstr(json, start, end - start));
}

ulong JsonGetTicketValue(const string json, const string key)
{
   string textValue = JsonGetStringValue(json, key);
   if(textValue != "")
      return (ulong)StringToInteger(textValue);

   double numericValue = JsonGetDoubleValue(json, key);
   if(numericValue <= 0 || !MathIsValidNumber(numericValue))
      return 0;

   return (ulong)numericValue;
}

bool JsonHasUsableNumber(const string json, const string key)
{
   int colon = JsonFindValueStart(json, key);
   if(colon < 0)
      return false;

   int start = SkipWhitespace(json, colon);
   if(start >= StringLen(json))
      return false;

   if(StringSubstr(json, start, 4) == "null")
      return false;

   return true;
}

int JsonFindValueStart(const string json, const string key)
{
   int keyPos = StringFind(json, "\"" + key + "\"");
   if(keyPos < 0)
      return -1;

   int colon = StringFind(json, ":", keyPos);
   if(colon < 0)
      return -1;

   return colon + 1;
}

int SkipWhitespace(const string text, int pos)
{
   while(pos < StringLen(text))
   {
      ushort ch = StringGetCharacter(text, pos);
      if(ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n')
         break;
      pos++;
   }

   return pos;
}

string TimeframeToString(const ENUM_TIMEFRAMES timeframe)
{
   switch(timeframe)
   {
      case PERIOD_M1:  return "M1";
      case PERIOD_M2:  return "M2";
      case PERIOD_M3:  return "M3";
      case PERIOD_M4:  return "M4";
      case PERIOD_M5:  return "M5";
      case PERIOD_M6:  return "M6";
      case PERIOD_M10: return "M10";
      case PERIOD_M12: return "M12";
      case PERIOD_M15: return "M15";
      case PERIOD_M20: return "M20";
      case PERIOD_M30: return "M30";
      case PERIOD_H1:  return "H1";
      case PERIOD_H2:  return "H2";
      case PERIOD_H3:  return "H3";
      case PERIOD_H4:  return "H4";
      case PERIOD_H6:  return "H6";
      case PERIOD_H8:  return "H8";
      case PERIOD_H12: return "H12";
      case PERIOD_D1:  return "D1";
      case PERIOD_W1:  return "W1";
      case PERIOD_MN1: return "MN1";
      default:         return EnumToString(timeframe);
   }
}
