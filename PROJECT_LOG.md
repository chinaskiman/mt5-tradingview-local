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
- Tests/checks run: `node --check server.js`; `node --check src\utils\wsClient.js`; `npm run build` in `web`.
- Result: Backend and WebSocket utility syntax checks passed. Web production build passed.
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
