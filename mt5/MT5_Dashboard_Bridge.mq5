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
   V1/V3A/V3B is view/read-only. This EA does not place, modify, or close trades.
   V3A only adds read-only account, quote, symbol property, and open position
   monitor data to the local dashboard payload.
   V3B can poll local calculator commands and return broker-normalized lot-size
   estimates. This command path is calculation-only, not a trading path.
*/

input int    HistoryBars   = 500;
input string ServerUrl     = "http://127.0.0.1:3001/mt5/update";
input int    UpdateSeconds = 2;
input bool   EnableRiskCalculatorCommands = true;

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

datetime lastAttemptedClosedTime = 0;
bool sendOnStartup = true;

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

   if(EnableRiskCalculatorCommands)
      PollRiskCalculatorCommands();
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
   json += "\"rsi\":{\"enabled\":" + JsonBool(EnableRSI) + ",\"length\":" + IntegerToString(RSILength) + "}";
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
         json += "\"diMinus\":" + JsonBufferNumber(EnableDI, diMinusValues, diMinusCopied, i, JSON_DECIMALS) + ",";
         json += "\"rsi\":" + JsonBufferNumber(EnableRSI, rsiValues, rsiCopied, i, JSON_DECIMALS);
         json += "}";
      }

      json += "],";
   }

   json += "\"account\":" + BuildAccountJson() + ",";
   json += "\"quote\":" + BuildQuoteJson() + ",";
   json += "\"positions\":" + BuildPositionsJson();
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

void PollRiskCalculatorCommands()
{
   string url = ServerBaseUrl() + "/mt5/commands";
   char body[];
   char response[];
   string responseHeaders = "";

   ResetLastError();
   int status = WebRequest("GET", url, "", 5000, body, response, responseHeaders);
   if(status == -1)
   {
      Print("Risk calculator command poll failed. Error: ", GetLastError());
      return;
   }

   if(status < 200 || status >= 300)
   {
      Print("Risk calculator command poll returned HTTP ", status, ".");
      return;
   }

   string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
   string commands[];
   int commandCount = ExtractJsonObjectsFromArray(responseText, "commands", commands);

   for(int i = 0; i < commandCount; i++)
      ProcessRiskCalculatorCommand(commands[i]);
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
