# Project Log

## 2026-05-23 - Project log created

- Files changed: `PROJECT_LOG.md`
- What changed: Created the project work-history file required by `AGENTS.md`.
- Why: Future sessions need a concise running record of changes, checks, known issues, and next steps.
- Tests/checks run: Not applicable.
- Result: Log file is ready for future entries.
- Next steps: Scaffold the local MT5-to-browser dashboard project.

## 2026-05-24 - GitHub repository initialized locally

- Files changed: `.git/config`, `PROJECT_LOG.md`
- What changed: Initialized the folder as a Git repository on branch `main`, added `origin` as `https://github.com/chinaskiman/mt5-tradingview-local.git`, and configured a repo-local GitHub proxy at `socks5h://127.0.0.1:10808`.
- Why: Connect the local project to the new GitHub repository while routing GitHub access through the available SOCKS proxy.
- Tests/checks run: `git remote -v`, `git config --local --get-regexp '^(http|https)\.'`, `git status --short --branch`, `git ls-remote origin`.
- Result: Remote access succeeded through the proxy. `git ls-remote origin` returned no refs, indicating the GitHub repository is currently empty.
- Known issues: No commits exist locally or remotely yet.
- Next steps: Add project files, make the initial commit, then push `main` to `origin`.

## 2026-05-24 - Added Python hello world script

- Files changed: `hello_world.py`, `PROJECT_LOG.md`
- What changed: Added a minimal Python script that prints `Hello, world!`.
- Why: Confirm local file creation in the repository works.
- Tests/checks run: `python hello_world.py`
- Result: Script printed `Hello, world!`.
- Next steps: Continue scaffolding the MT5 dashboard project when ready.

## 2026-05-24 - Created MT5 dashboard starter scaffold

- Files changed: `README.md`, `mt5/MT5_Dashboard_Bridge.mq5`, `server/package.json`, `server/server.js`, `server/README.md`, `web/package.json`, `web/index.html`, `web/vite.config.js`, `web/src/App.jsx`, `web/src/main.jsx`, `web/src/styles.css`, `web/src/chart/TradingDashboard.jsx`, `web/src/components/StatusBar.jsx`, `web/src/components/IndicatorSettings.jsx`, `web/src/utils/wsClient.js`, `PROJECT_LOG.md`
- What changed: Added a local-only backend using Express and WebSocket on `127.0.0.1:3001`, a React/Vite frontend shell with TradingView Lightweight Charts containers, a placeholder MT5 EA file, and setup documentation.
- Why: Establish the V1 view-only project structure before implementing the full MT5 bridge EA.
- Decisions: The browser does not choose symbol or timeframe; snapshots are accepted from MT5 and displayed as sent. Indicators are not calculated in JavaScript.
- Tests/checks run: `node --check server.js`, JSON parse checks for `server/package.json` and `web/package.json`, recursive file listing for `mt5`, `server`, and `web`.
- Result: Backend syntax and package JSON checks passed. Dependencies were not installed and the Vite app was not built yet.
- Known issues: Full MT5 EA posting logic is intentionally not implemented. No live browser build/test has been run because dependencies have not been installed.
- Next steps: Run `npm install` in `server` and `web`, start both apps, then implement MT5 snapshot export in the EA.

## 2026-05-24 - Implemented MT5 chart mirror EA

- Files changed: `mt5/MT5_Dashboard_Bridge.mq5`, `server/server.js`, `server/README.md`, `README.md`, `web/src/chart/TradingDashboard.jsx`, `web/src/components/IndicatorSettings.jsx`, `PROJECT_LOG.md`
- What changed: Replaced the placeholder EA with a view-only timer-based chart mirror that uses `_Symbol` and `_Period`, sends only closed candles from shift 1 and older, calculates SMA 7/12/50, ATR 14, ADX 14, DI+ 14, and DI- 14 in MT5, and POSTs JSON to `http://127.0.0.1:3001/mt5/update`. Added `/mt5/update` compatibility to the server and adjusted the frontend to read inline indicator values from EA candle payloads.
- Why: The dashboard needs MT5 to be the source of chart, timeframe, candle, and indicator data while avoiding tick spam and keeping V1 view-only.
- Decisions: Updates run from `OnTimer`; the EA sends on startup and once per newly closed candle. If indicator buffers have fewer values than candles, missing values are serialized as `null`.
- Tests/checks run: `node --check server.js`; MetaEditor command-line compile after copying the EA into the local MT5 `MQL5/Experts` folder.
- Result: Server syntax check passed. MetaEditor compiled `MT5_Dashboard_Bridge.mq5` with 0 errors and 0 warnings.
- Known issues: Dependencies have still not been installed, and the full server/web runtime flow has not been tested with a live MT5 chart.
- Next steps: Run `npm install` in `server` and `web`, start both apps, add `http://127.0.0.1:3001` to MT5 allowed WebRequest URLs, then attach the EA to a chart and verify snapshots reach the dashboard.

## 2026-05-24 - Hardened backend MT5 bridge

- Files changed: `server/server.js`, `server/package.json`, `server/README.md`, `PROJECT_LOG.md`
- What changed: Reworked the backend as a strict local bridge on `127.0.0.1:3001` with `POST /mt5/update`, payload validation, latest-valid-snapshot memory storage, WebSocket broadcast, connection count logging, and 30-second heartbeat pings for dead client cleanup.
- Why: The server should only accept valid MT5 snapshots and relay them to browsers without calculating or mutating indicator values.
- Decisions: Removed the old compatibility POST endpoint from the active server path. `lastUpdate` is tracked separately for `/health` instead of being added to the MT5 snapshot.
- Tests/checks run: `node --check server.js`; parsed `server/package.json` and confirmed scripts are `start: node server.js` and `dev: node server.js`; checked for `server/node_modules`.
- Result: Syntax and package script checks passed. `server/node_modules` is missing, so runtime endpoint/WebSocket testing was not run.
- Known issues: Server dependencies still need installation before live testing.
- Next steps: Run `npm install` in `server`, start the server, POST a sample MT5 payload to `/mt5/update`, and verify a browser WebSocket client receives the snapshot.

## 2026-05-24 - Implemented synchronized React dashboard frontend

- Files changed: `.gitignore`, `README.md`, `server/server.js`, `server/README.md`, `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/components/StatusBar.jsx`, `web/src/components/IndicatorSettings.jsx`, `web/src/utils/wsClient.js`, `web/src/styles.css`, `PROJECT_LOG.md`
- What changed: Built the React/Vite dashboard UI with dark TradingView-like styling, WebSocket auto-reconnect, status metadata, read-only MT5 indicator settings, saved UI preferences, and three Lightweight Charts panels for price, ATR, and ADX/DI.
- Why: The browser dashboard needs to display only closed MT5 candles and MT5-calculated indicators without sending setting changes back to MT5.
- Decisions: The frontend connects to `ws://127.0.0.1:3001`, so the backend WebSocket server now accepts root WebSocket connections. Chart panels synchronize visible logical ranges and perform best-effort crosshair synchronization using shared candle times.
- Tests/checks run: `node --check server.js`, parsed `web/package.json`, checked for lingering `npm`/`node` processes, checked `web` directory for install artifacts.
- Result: Static checks passed. Attempted `npm install` in `web`, but it hung for over five minutes and was stopped; no `node_modules` or lockfile were produced, so a Vite build was not run.
- Known issues: Frontend runtime/build still needs dependency installation. The chart sync logic has not yet been verified in a live browser.
- Next steps: Resolve npm install/network issue, run `npm install` in `web`, run `npm run build`, then start server and web app to verify live MT5 snapshots and chart synchronization.

## 2026-05-24 - Audited and hardened chart synchronization

- Files changed: `web/src/chart/TradingDashboard.jsx`, `README.md`, `PROJECT_LOG.md`
- What changed: Added hidden whitespace sync series to every chart panel so price, ATR, and ADX/DI share the full MT5 candle time scale even when indicator values are `null`. Strengthened visible logical range synchronization, recursive sync guarding, shared reset/refit behavior, resize handling, and dataset reset detection.
- Why: Oscillator panels can drift if their visible series omit early/null indicator points; all panels must scroll and zoom together using the same MT5 candle timestamps.
- Decisions: Visible logical range sync remains the priority. Crosshair sync is best-effort using `setCrosshairPosition` when supported. All chart data uses Unix-second numeric timestamps from MT5.
- Tests/checks run: `node --check server.js`, `node --check web/src/utils/wsClient.js`, parsed `web/package.json`, checked for lingering `npm`/`node` processes, reviewed Lightweight Charts 4.2 docs for `subscribeVisibleLogicalRangeChange`.
- Result: Static checks passed. A proxied `npm install` in `web` using `socks5h://127.0.0.1:10808` still timed out and was stopped, so no Vite build/runtime sync test was run.
- Known issues: Frontend dependencies are still not installed. Chart sync must be verified manually in the browser after npm install works.
- Next steps: Fix npm proxy/install access, run `npm install` and `npm run build` in `web`, then follow the README manual sync test steps.

## 2026-05-24 - Final V1 polish and readiness pass

- Files changed: `README.md`, `server/server.js`, `server/package.json`, `server/package-lock.json`, `web/package.json`, `web/package-lock.json`, `web/src/App.jsx`, `PROJECT_LOG.md`
- What changed: Rewrote the root README with purpose, architecture, setup, MT5 WebRequest, EA compile/attach, EURUSD M15 test steps, known limitations, and future improvements. Improved frontend/backend error messages and made the backend reject empty candle payloads clearly. Removed the temporary hello-world script from the workspace.
- Why: Prepare V1 as a clean local-only, view-only MT5 chart mirror with clear operator instructions and commit-ready project files.
- Decisions: Kept V1 scope strict: no order execution, no account access, no browser symbol/timeframe selector, no unfinished candle, no volume panel, and no browser-side indicator calculations. Updated package versions to install cleanly with the available npm cache/proxy path.
- Tests/checks run: proxied `npm install` in `server`; proxied `npm install` in `web`; `npm run build` in `web`; `npm start` in `server` plus `/health` and empty-payload validation check; `npm run dev` in `web` plus HTTP 200 check on `http://127.0.0.1:5173`; `node --check server.js`; `node --check web/src/utils/wsClient.js`; MetaEditor compile of `MT5_Dashboard_Bridge.mq5`; `npm ls --depth=0` in both `server` and `web`; final Git status and dead-code searches.
- Result: Server install/start works. Web install/dev/build works. EA compiles with 0 errors and 0 warnings. `node_modules/` is ignored; source files and lockfiles are commit-ready.
- Known issues: Live end-to-end MT5 chart data has not been manually verified in the browser yet. `npm audit` endpoint was unreliable over the current network, but the final web install reported 0 vulnerabilities.
- Next steps: Attach the EA to EURUSD M15 in MT5 and run the README manual testing checklist, especially chart panel scroll/zoom synchronization.

## 2026-05-24 - Synced initial project to GitHub

- Files changed: `PROJECT_LOG.md`
- What changed: Committed the V1 project files and pushed branch `main` to `origin`.
- Why: Publish the local repository to `https://github.com/chinaskiman/mt5-tradingview-local`.
- Commands run: `git config --local user.name`, `git config --local user.email`, `git ls-remote origin`, `git add`, `git commit -m "Initial V1 MT5 TradingView local dashboard"`, `git push -u origin main`.
- Result: Initial commit `e8e923d` pushed successfully and local `main` now tracks `origin/main`.
- Known issues: None for Git sync. `node_modules/` remains local and ignored.
- Next steps: Push this project-log sync entry.

## 2026-05-24 - Added MT5 chart attachment status label

- Files changed: `mt5/MT5_Dashboard_Bridge.mq5`, `PROJECT_LOG.md`
- What changed: Added an `OBJ_LABEL` status badge in the upper-left of the MT5 chart when the EA is attached. The label shows initialization, attached chart, send success, WebRequest errors, server HTTP errors, and snapshot/history failures. The label is removed when the EA is detached.
- Why: Make it visually obvious in MT5 that `MT5_Dashboard_Bridge.mq5` is attached to the current chart and whether it is sending data.
- Tests/checks run: MetaEditor command-line compile after copying the EA into the local MT5 `MQL5/Experts` folder.
- Result: EA compiled with 0 errors and 0 warnings.
- Known issues: Visual label placement has not yet been checked manually on a live chart.
- Next steps: Recompile/reload the EA in MT5, attach it to a chart, and confirm the label appears in the upper-left chart corner.

## 2026-05-24 - Fixed MT5 status label wrapping and HTTP 1003 hint

- Files changed: `mt5/MT5_Dashboard_Bridge.mq5`, `PROJECT_LOG.md`
- What changed: Replaced the single multiline MT5 chart label with three separate `OBJ_LABEL` lines so MT5 does not flatten the text. Added a shorter HTTP 1003 status message telling the user to start the backend.
- Why: The chart rendered multiline label text as one long line, making the attachment/error status hard to read.
- Tests/checks run: MetaEditor command-line compile after copying the EA into the local MT5 `MQL5/Experts` folder; checked `http://127.0.0.1:3001/health`.
- Result: EA compiled with 0 errors and 0 warnings. Backend health check timed out, so the local server was not reachable at the time of diagnosis.
- Known issues: The EA needs to be reloaded in MT5 to show the improved label. The backend must be running before MT5 can post snapshots successfully.
- Next steps: Start the backend with `cd server && npm start`, then reattach or restart the EA.

## 2026-05-24 - Added RSI, 5-decimal display, fullscreen panels, and local indicator toggles

- Files changed: `mt5/MT5_Dashboard_Bridge.mq5`, `server/server.js`, `server/README.md`, `README.md`, `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/components/IndicatorSettings.jsx`, `web/src/styles.css`, `PROJECT_LOG.md`
- What changed: Added MT5-calculated RSI 14 with EA inputs and JSON payload support; changed EA numeric output and frontend chart price formatting to 5 decimals; added an RSI panel; added per-panel fullscreen controls; added local browser hide/show toggles for SMA, ATR, ADX, DI+, DI-, and RSI.
- Why: The dashboard needs RSI from MT5, clearer numeric precision, expandable chart sections, and user-controlled display visibility without changing V1's MT5-owned indicator calculations.
- Decisions: Browser toggles are local display preferences saved in `localStorage`; they do not send settings to MT5 or stop MT5 calculations. EA inputs remain the source of enabled/disabled indicator state.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`; temporary `node server.js` health check; MetaEditor command-line compile after copying the EA into the local MT5 `MQL5\Experts` folder; `git diff --check`.
- Result: Backend syntax check passed. Web production build passed. Temporary backend health check returned OK. EA compiled with 0 errors and 0 warnings. Diff check found no whitespace errors, only expected CRLF conversion warnings.
- Known issues: Live MT5-to-browser verification of the new RSI panel, fullscreen buttons, and local visibility toggles still needs to be done on the running dashboard.
- Next steps: Restart/recompile the EA in MT5, start backend/frontend, attach the EA, then confirm RSI values appear and each panel's `Full`/`Exit` and visibility toggles work as expected.

## 2026-05-24 - Added collapsible oscillator panels with latest values

- Files changed: `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Added saved frontend collapse state for ATR, ADX/DI, and RSI panels. Collapsed panels become compact rows showing the latest MT5-sent values to 5 decimals while keeping the full chart available through `Expand`.
- Why: Sometimes the dashboard only needs the current oscillator number, such as ATR, without dedicating full vertical space to the oscillator chart.
- Decisions: Collapse is separate from hide/show. Hiding removes the panel; collapsing keeps the latest value visible. The browser still does not calculate indicators or send indicator setting changes to MT5.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`; started Vite dev server and checked `http://127.0.0.1:5173`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed. Vite dev server returned HTTP 200.
- Known issues: Manual browser check with live MT5 data is still needed to confirm the collapsed rows display the expected latest values during updates.
- Next steps: Start backend/frontend, attach or restart the EA, then collapse ATR/ADX/RSI panels and confirm the compact values update with each MT5 snapshot.

## 2026-05-24 - Added draggable chart panel heights

- Files changed: `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Added browser-saved panel height preferences and bottom-edge drag handles for expanded chart panels, including price, ATR, ADX/DI, and RSI.
- Why: The dashboard needs adjustable vertical space so a user can emphasize the price chart or specific oscillator panels without changing MT5 data or calculations.
- Decisions: Resizing is frontend-only and stored in `localStorage`. Collapsed panels keep their compact 44px row and are not draggable until expanded.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Pointer dragging still needs a manual browser check with the running Vite app.
- Next steps: Start backend/frontend, then drag each expanded panel's bottom edge and confirm the saved heights persist after refresh.

## 2026-05-24 - Kept chart controls off collapsed value rows

- Files changed: `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Removed `Full` and `Collapse/Expand` buttons from collapsed oscillator value rows. Collapsed rows now show only the latest values and can be clicked or keyboard-expanded back into chart panels.
- Why: Chart controls should sit on the expanded chart area, not on compact number-only rows.
- Decisions: Fullscreen is available only from expanded chart panels. Compact rows are intentionally simple readouts.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Manual browser check is still needed to confirm compact ATR/ADX/RSI rows are clean and click-to-expand works with live data.
- Next steps: Start backend/frontend, collapse each oscillator panel, confirm no chart control buttons appear on the compact value rows, then click rows to expand.

## 2026-05-24 - Added V2B chart control toolbar

- Files changed: `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Added a dark chart toolbar with Auto-scroll ON/OFF, Fit content, Go to latest, and Reset view controls. Auto-scroll is saved in browser `localStorage`; the chart actions apply shared time-scale changes across all chart panels.
- Why: The dashboard needs manual browser-side view controls without changing the MT5-owned data and indicator calculation architecture.
- Decisions: Auto-scroll defaults to ON. When OFF, new snapshots update series data without forcing the user's visible range, including normal fixed-history rolling-window updates where the oldest candle changes. Reset view shows approximately the latest 180 loaded candles. The controls also include the RSI panel so all visible panels remain aligned.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Manual browser testing with live snapshots is still needed.
- Next steps: Start backend/frontend, verify Auto-scroll OFF preserves scroll position, Auto-scroll ON follows the latest candle on new snapshots, and Fit content/Go to latest/Reset view move all panels together.

## 2026-05-25 - Hardened chart time synchronization

- Files changed: `web/src/chart/TradingDashboard.jsx`, `PROJECT_LOG.md`
- What changed: Strengthened visible logical range synchronization with a dedicated recursive-update guard, canonical remembered logical range, remembered visible time range, and comments explaining the sync path. Snapshot updates now preserve the user's actual candle time window when Auto-scroll is off, even when MT5 sends a fixed-size rolling history window.
- Why: Price, ATR, and ADX/DI panels must remain synchronized through scroll, zoom, toolbar actions, new snapshots, browser resize, reconnect, and data reset.
- Decisions: Kept all series on the same MT5 candle timestamps and continued using hidden whitespace sync series. RSI remains included in the same synchronization group because it exists in the current dashboard, but the required price/ATR/ADX behavior is unchanged.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Manual browser testing with live MT5 data is still needed for wheel/drag scroll and zoom behavior.
- Next steps: Start backend/frontend, then verify scroll, zoom, Fit content, Go to latest, Reset view, resize, reconnect, and new snapshots keep all panels aligned.

## 2026-05-25 - Replaced draggable heights with layout presets

- Files changed: `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Removed the manual draggable panel-height implementation and added a small toolbar preset control with `Compact`, `Balanced`, and `Large Price`. The selected preset is saved in browser `localStorage`, with `Balanced` as the default.
- Why: The current requirement calls for simple preset-based layout sizing and explicitly avoids draggable resizing for now.
- Decisions: Presets resize chart rows using fractional grid tracks. Changing presets only changes frontend layout; it does not reload MT5 data, does not calculate indicators, and keeps the current visible chart range by resizing all chart instances and reapplying the remembered range. The existing RSI panel remains in the layout and uses matching preset proportions when visible.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Manual browser check is still needed for preset switching with live charts.
- Next steps: Start backend/frontend, switch Compact/Balanced/Large Price, and confirm all chart containers resize without changing the visible range or desyncing.

## 2026-05-25 - Hardened new snapshot range handling

- Files changed: `web/src/chart/TradingDashboard.jsx`, `PROJECT_LOG.md`
- What changed: Updated the MT5 snapshot application path to capture the price chart's current visible logical range before applying new series data, then restore that range across all chart panels when Auto-scroll is off. When Auto-scroll is on and data changes, all panels scroll to the latest candle together.
- Why: New MT5 snapshots must update candles and MT5-calculated indicators without pulling the user away from their current view when Auto-scroll is disabled.
- Decisions: Kept the existing time-range fallback for rolling fixed-history snapshots, but made the captured visible logical range the primary restore path requested for snapshot updates. No backend or EA behavior changed.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Live browser testing is still needed after reconnect/full snapshot replacement.
- Next steps: Verify Auto-scroll OFF preserves the current visible logical range on new MT5 snapshots and Auto-scroll ON moves all panels to the latest candle.

## 2026-05-25 - Final V2B documentation polish

- Files changed: `README.md`, `PROJECT_LOG.md`
- What changed: Added a dedicated `V2B Chart Controls` README section covering Auto-scroll, Fit content, Go to latest, Reset view, panel height presets, and synchronized price/ATR/ADX scrolling and zooming. Added a 15-step V2B manual testing checklist.
- Why: V2B chart controls need clear operator documentation and a focused verification path without expanding project scope.
- Decisions: Documented that V2B remains frontend-only and intentionally excludes indicator color settings, screenshot/export tools, trade controls, frontend indicator calculations, and browser symbol/timeframe selectors.
- Tests/checks run: Scope search for forbidden additions in `web/src`; `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Scope search found only expected matches such as CSS color constants, module `export`, and chart crosshair API names. Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: V2B still needs manual live MT5 browser verification using the README checklist.
- Next steps: Run the V2B manual testing checklist with MT5 attached to EURUSD M15.

## 2026-05-25 - Added draggable vertical chart panel resizing

- Files changed: `web/src/App.jsx`, `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Added horizontal drag handles between Price/ATR and ATR/ADX panels, saved panel heights in `localStorage`, restored saved heights on load, and kept minimum expanded heights of Price 250px, ATR 90px, and ADX/DI 120px. Presets now write saved pixel heights and resizing triggers Lightweight Charts resize handling without changing chart data.
- Why: The dashboard needs smooth browser-local vertical resizing while preserving the MT5-owned data architecture and synchronized chart time ranges.
- Decisions: Resizing is frontend-only. Collapsed panels remain compact and are not draggable until expanded. RSI remains supported by the existing dashboard layout, but the requested draggable handles are limited to Price/ATR and ATR/ADX.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Manual browser testing is still needed to verify pointer dragging feel, height persistence after refresh, and live chart alignment with MT5 data.
- Next steps: Start backend/frontend, drag both resize handles, refresh the browser, and confirm panel heights persist and all panels stay time-synchronized.

## 2026-05-25 - Improved synchronized crosshair across chart panels

- Files changed: `web/src/chart/TradingDashboard.jsx`, `web/src/styles.css`, `README.md`, `PROJECT_LOG.md`
- What changed: Added synchronized vertical crosshair overlays for all chart panels, kept best-effort Lightweight Charts native `setCrosshairPosition` syncing when target panel values exist, and updated chart legends to show MT5-sent values for the candle under the active crosshair.
- Why: Price, ATR, and ADX/DI need to show the same candle/time under the crosshair even when an oscillator has missing/null values and native crosshair positioning cannot be applied.
- Decisions: The overlay is driven by `timeScale().timeToCoordinate()` using the exact MT5 candle timestamp. It does not interpolate data, create unfinished candles, or calculate indicators in the frontend. RSI remains included in the existing dashboard sync group.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
- Known issues: Manual browser testing with live MT5 data is still needed to verify mouse movement over Price, ATR, and ADX/DI, plus behavior after scroll, zoom, and panel resize.
- Next steps: Start backend/frontend, move the crosshair over each chart panel, and confirm all visible panels show the same candle-time marker.

## 2026-05-25 - Matched ADX/DI text colors to chart lines

- Files changed: `web/src/utils/chartColors.js`, `web/src/chart/TradingDashboard.jsx`, `web/src/components/IndicatorSettings.jsx`, `web/src/styles.css`, `PROJECT_LOG.md`
- What changed: Centralized chart and indicator colors in `chartColors.js`, reused ADX/DI colors for line series, ADX/DI legend values, crosshair-driven header values, and settings panel labels.
- Why: ADX, DI+, and DI- text should exactly match the corresponding chart line colors without duplicated hardcoded values.
- Decisions: Kept colors fixed and did not add frontend color pickers. No MT5 payload, backend bridge, indicator calculation, synchronization, or resizing behavior changed.
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; searched frontend color usage for ADX/DI constants; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Color usage now points to shared constants. Web production build passed.
- Known issues: Manual browser check is still needed to visually confirm the ADX/DI text contrast with live data.
- Next steps: Start frontend and confirm ADX, DI+, and DI- header/settings text matches the chart line colors.

## 2026-05-25 - V2C integration test and bug-fix pass

- Files changed: `web/src/chart/TradingDashboard.jsx`, `web/index.html`, `README.md`, `PROJECT_LOG.md`
- What changed: Added a mouse-event fallback for synchronized crosshair overlays, changed crosshair overlays to use one canonical x-coordinate across all panels, and added an inline favicon to remove browser 404 console noise. Added a README V2C section with manual test steps.
- Why: Headless browser testing showed native Lightweight Charts crosshair events were not enough under synthetic input, and per-panel `timeToCoordinate()` could differ by a few pixels because price-scale widths differ.
- Decisions: The crosshair still uses the MT5 candle timestamp for data lookup and uses a shared overlay x-position for exact visual alignment. No MT5 EA or backend files changed. No frontend indicator calculations, trading features, color pickers, unfinished candles, or payload changes were added.
- Tests/checks run: Started local backend/frontend; posted a realistic 220-candle MT5-style snapshot to `POST /mt5/update`; headless Chrome CDP smoke test for panel dragging, min heights, height persistence after refresh, crosshair from Price/ATR/ADX, crosshair clear-on-leave, ADX/DI color text, toolbar actions, and console errors; `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend/frontend responded with HTTP 200. MT5 snapshot POST returned OK. Browser smoke test passed with no console errors. Web production build passed.
- Known issues: Live MT5 manual testing is still recommended because the automated test uses a synthetic snapshot rather than a running MT5 terminal.
- Next steps: Run the V2C manual checks with MT5 attached to EURUSD M15.
