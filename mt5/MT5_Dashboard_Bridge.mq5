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
   V1 is view-only. This EA does not place, modify, or close trades.
*/

input int    HistoryBars   = 500;
input string ServerUrl     = "http://127.0.0.1:3001/mt5/update";
input int    UpdateSeconds = 2;

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

int smaFastHandle = INVALID_HANDLE;
int smaMidHandle  = INVALID_HANDLE;
int smaSlowHandle = INVALID_HANDLE;
int atrHandle     = INVALID_HANDLE;
int adxHandle     = INVALID_HANDLE;
int diHandle      = INVALID_HANDLE;

datetime lastAttemptedClosedTime = 0;
bool sendOnStartup = true;

int OnInit()
{
   if(HistoryBars < 1)
   {
      Print("HistoryBars must be greater than 0.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(UpdateSeconds < 1)
   {
      Print("UpdateSeconds must be greater than 0.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(!CreateIndicatorHandles())
      return(INIT_FAILED);

   EventSetTimer(UpdateSeconds);
   Print("MT5 Dashboard Bridge attached to ", _Symbol, " ", TimeframeToString(_Period));
   Print("Dashboard mirrors this chart only. Endpoint: ", ServerUrl);

   SendIfNeeded();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ReleaseIndicatorHandles();
   Print("MT5 Dashboard Bridge removed. Reason: ", reason);
}

void OnTimer()
{
   SendIfNeeded();
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
}

void SendIfNeeded()
{
   datetime newestClosedTime = iTime(_Symbol, _Period, 1);
   if(newestClosedTime <= 0)
   {
      Print("No closed candle is available yet for ", _Symbol, " ", TimeframeToString(_Period));
      return;
   }

   if(!sendOnStartup && newestClosedTime == lastAttemptedClosedTime)
      return;

   string payload = BuildSnapshotJson(newestClosedTime);
   if(payload == "")
      return;

   SendJson(payload);
   lastAttemptedClosedTime = newestClosedTime;
   sendOnStartup = false;
}

string BuildSnapshotJson(const datetime newestClosedTime)
{
   int barsToCopy = MathMax(1, HistoryBars);

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copiedRates = CopyRates(_Symbol, _Period, 1, barsToCopy, rates);
   if(copiedRates <= 0)
   {
      Print("CopyRates failed or returned no closed bars. Error: ", GetLastError());
      return "";
   }

   double smaFastValues[];
   double smaMidValues[];
   double smaSlowValues[];
   double atrValues[];
   double adxValues[];
   double diPlusValues[];
   double diMinusValues[];

   int smaFastCopied = CopyEnabledBuffer(EnableSMAFast, smaFastHandle, 0, copiedRates, smaFastValues, "SMA fast");
   int smaMidCopied  = CopyEnabledBuffer(EnableSMAMid,  smaMidHandle,  0, copiedRates, smaMidValues,  "SMA mid");
   int smaSlowCopied = CopyEnabledBuffer(EnableSMASlow, smaSlowHandle, 0, copiedRates, smaSlowValues, "SMA slow");
   int atrCopied     = CopyEnabledBuffer(EnableATR,     atrHandle,     0, copiedRates, atrValues,     "ATR");
   int adxCopied     = CopyEnabledBuffer(EnableADX,     adxHandle,     0, copiedRates, adxValues,     "ADX");
   int diPlusCopied  = CopyEnabledBuffer(EnableDI,      diHandle,      1, copiedRates, diPlusValues,  "DI+");
   int diMinusCopied = CopyEnabledBuffer(EnableDI,      diHandle,      2, copiedRates, diMinusValues, "DI-");

   string json = "{";
   json += "\"source\":\"mt5\",";
   json += "\"symbol\":" + JsonString(_Symbol) + ",";
   json += "\"timeframe\":" + JsonString(TimeframeToString(_Period)) + ",";
   json += "\"timeframeSeconds\":" + IntegerToString(PeriodSeconds(_Period)) + ",";
   json += "\"lastClosedTime\":" + IntegerToString((long)newestClosedTime) + ",";
   json += "\"settings\":{";
   json += "\"smaFast\":{\"enabled\":" + JsonBool(EnableSMAFast) + ",\"length\":" + IntegerToString(SMAFastLength) + "},";
   json += "\"smaMid\":{\"enabled\":" + JsonBool(EnableSMAMid) + ",\"length\":" + IntegerToString(SMAMidLength) + "},";
   json += "\"smaSlow\":{\"enabled\":" + JsonBool(EnableSMASlow) + ",\"length\":" + IntegerToString(SMASlowLength) + "},";
   json += "\"atr\":{\"enabled\":" + JsonBool(EnableATR) + ",\"length\":" + IntegerToString(ATRLength) + "},";
   json += "\"adx\":{\"enabled\":" + JsonBool(EnableADX) + ",\"length\":" + IntegerToString(ADXLength) + "},";
   json += "\"di\":{\"enabled\":" + JsonBool(EnableDI) + ",\"length\":" + IntegerToString(DILength) + "}";
   json += "},";
   json += "\"candles\":[";

   for(int i = copiedRates - 1; i >= 0; i--)
   {
      if(i < copiedRates - 1)
         json += ",";

      json += "{";
      json += "\"time\":" + IntegerToString((long)rates[i].time) + ",";
      json += "\"open\":" + JsonNumber(rates[i].open, _Digits) + ",";
      json += "\"high\":" + JsonNumber(rates[i].high, _Digits) + ",";
      json += "\"low\":" + JsonNumber(rates[i].low, _Digits) + ",";
      json += "\"close\":" + JsonNumber(rates[i].close, _Digits) + ",";
      json += "\"smaFast\":" + JsonBufferNumber(EnableSMAFast, smaFastValues, smaFastCopied, i, _Digits) + ",";
      json += "\"smaMid\":" + JsonBufferNumber(EnableSMAMid, smaMidValues, smaMidCopied, i, _Digits) + ",";
      json += "\"smaSlow\":" + JsonBufferNumber(EnableSMASlow, smaSlowValues, smaSlowCopied, i, _Digits) + ",";
      json += "\"atr\":" + JsonBufferNumber(EnableATR, atrValues, atrCopied, i, _Digits) + ",";
      json += "\"adx\":" + JsonBufferNumber(EnableADX, adxValues, adxCopied, i, 4) + ",";
      json += "\"diPlus\":" + JsonBufferNumber(EnableDI, diPlusValues, diPlusCopied, i, 4) + ",";
      json += "\"diMinus\":" + JsonBufferNumber(EnableDI, diMinusValues, diMinusCopied, i, 4);
      json += "}";
   }

   json += "]}";
   return json;
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

void SendJson(const string payload)
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
      return;
   }

   if(status < 200 || status >= 300)
   {
      string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
      Print("Server returned HTTP ", status, ". Response: ", responseText);
      return;
   }

   Print("Sent ", _Symbol, " ", TimeframeToString(_Period), " snapshot. Payload bytes: ", ArraySize(body), ". HTTP: ", status);
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

string JsonString(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return "\"" + value + "\"";
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
