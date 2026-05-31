# MT5 TradingView Dashboard Desktop Shell

This folder contains the Electron desktop shell for the local MT5 dashboard.

The existing workflows still work:

```powershell
cd ..\server
npm start

cd ..\web
npm run dev
```

## Install

Install desktop dependencies from this folder:

```powershell
cd desktop
npm install
```

If you need proxy access, configure npm/proxy settings before installing.

## Development

Start the Vite dev server first:

```powershell
cd ..\web
npm run dev
```

Then run Electron:

```powershell
cd ..\desktop
npm run dev
```

The desktop shell loads `http://127.0.0.1:5173` in development.

## Production Run

Build the React frontend:

```powershell
cd ..\web
npm run build
```

Run the Electron shell:

```powershell
cd ..\desktop
npm start
```

In production mode, Electron loads `web/dist/index.html`.

## Backend Behavior

The desktop shell checks `http://127.0.0.1:3001/health`.

- If the dashboard backend is already running, Electron reuses it and does not start a duplicate.
- If the port is free, Electron starts the existing `server/server.js` as a managed child process.
- When the Electron app closes, it stops the backend process it started.
- If another process is using port `3001`, Electron shows a clear error instead of starting a duplicate backend.

Desktop logs are stored under Electron `userData/logs`:

```text
%APPDATA%\mt5-tradingview-local-desktop\logs\desktop.log
%APPDATA%\mt5-tradingview-local-desktop\logs\backend.log
```

Use `App > Open Logs Folder` in the desktop menu to open this folder.

## App Menu

The desktop app menu contains:

- `Reload`
- `Toggle DevTools`
- `Open Logs Folder`
- `Open MT5 EA Folder`
- `Installation Help`
- `Quit`

`Open MT5 EA Folder` opens the packaged `mt5/` resource folder in production, or the project `mt5/` folder during development.

To disable backend autostart:

```powershell
$env:DESKTOP_START_BACKEND='false'
npm start
```

## Root Build Scripts

From the project root:

```powershell
npm run dev:desktop
npm run build:web
npm run build:desktop
npm run dist:windows
```

`build:desktop` builds the React frontend and verifies that the Electron production files are ready.

## Package Windows App

Build the frontend and package the desktop app:

```powershell
cd ..
npm run dist:windows
```

The packaged output is written to `release/`.

The packaged app includes:

- `web/dist`
- the backend files needed by Electron from `server/`
- the `mt5/` folder for user access to the EA source

The Windows build intentionally sets `win.signAndEditExecutable=false` and `win.forceCodeSigning=false`. This avoids electron-builder downloading/extracting `winCodeSign`, which can fail on Windows accounts without symlink privileges. The NSIS installer still uses `assets/icon.ico`.

Before packaging, make sure dependencies are installed in:

- `server/`
- `web/`
- `desktop/`

## Installed App

Run the installer from the project root:

```text
release\MT5 TradingView Dashboard Setup 0.1.0.exe
```

Default install path:

```text
%LOCALAPPDATA%\Programs\mt5-tradingview-local-desktop\
```

The installed app starts the backend on `127.0.0.1:3001` and stops the backend when the app closes normally.

MT5 WebRequest URL remains:

```text
http://127.0.0.1:3001
```

Packaged EA source:

```text
%LOCALAPPDATA%\Programs\mt5-tradingview-local-desktop\resources\mt5\MT5_Dashboard_Bridge.mq5
```

Logs:

```text
%APPDATA%\MT5 TradingView Dashboard\logs\
```
