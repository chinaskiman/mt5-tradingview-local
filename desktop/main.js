const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const WINDOW_TITLE = 'MT5 TradingView Dashboard';
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 3001;
const BACKEND_HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`;
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://127.0.0.1:5173';
const BACKEND_START_TIMEOUT_MS = 12000;

const isDev = process.argv.includes('--dev') || process.env.ELECTRON_DEV === 'true';
let mainWindow = null;
let backendProcess = null;
let backendLogStream = null;
let backendLogPath = null;
let appLogStream = null;
let appLogPath = null;

app.setName(WINDOW_TITLE);

function resolveResourcePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }

  return path.join(__dirname, '..', ...segments);
}

function resolveWebIndexPath() {
  return resolveResourcePath('web', 'dist', 'index.html');
}

function resolveBackendEntryPath() {
  return resolveResourcePath('server', 'server.js');
}

function resolveMt5EaFolderPath() {
  return resolveResourcePath('mt5');
}

function resolveWindowIconPath() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  return fs.existsSync(iconPath) ? iconPath : null;
}

function createWindow() {
  const icon = resolveWindowIconPath();
  mainWindow = new BrowserWindow({
    title: WINDOW_TITLE,
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    writeAppLog('Main window ready.');
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function loadFrontend(window) {
  if (isDev) {
    writeAppLog(`Loading Vite dev server: ${DEV_SERVER_URL}`);
    const devReady = await waitForUrl(DEV_SERVER_URL, 30000);

    if (devReady) {
      await window.loadURL(DEV_SERVER_URL);
      window.webContents.openDevTools({ mode: 'detach' });
      return;
    }

    await loadMessage(window, [
      'Vite dev server is not reachable.',
      `Start it with: cd web && npm run dev`,
      `Expected URL: ${DEV_SERVER_URL}`
    ]);
    return;
  }

  const indexPath = resolveWebIndexPath();

  if (!fs.existsSync(indexPath)) {
    writeAppLog(`Built frontend missing: ${indexPath}`);
    await loadMessage(window, [
      'Built frontend was not found.',
      'Run: cd web && npm run build',
      `Expected file: ${indexPath}`
    ]);
    return;
  }

  writeAppLog(`Loading built frontend: ${indexPath}`);
  await window.loadFile(indexPath);
}

async function startBackendIfNeeded() {
  if (String(process.env.DESKTOP_START_BACKEND || 'true').toLowerCase() === 'false') {
    console.log('Desktop backend autostart disabled with DESKTOP_START_BACKEND=false.');
    writeAppLog('Desktop backend autostart disabled with DESKTOP_START_BACKEND=false.');
    return { ok: true, mode: 'disabled' };
  }

  const probe = await probeBackend();

  if (probe.status === 'ready') {
    console.log(`Using existing backend at ${BACKEND_HEALTH_URL}.`);
    writeAppLog(`Using existing backend at ${BACKEND_HEALTH_URL}.`);
    return { ok: true, mode: 'external' };
  }

  if (probe.status === 'occupied') {
    return {
      ok: false,
      mode: 'blocked',
      lines: [
        `Port ${BACKEND_PORT} is already in use.`,
        'The process using that port is not the MT5 dashboard backend.',
        `Close the other process or free ${BACKEND_HOST}:${BACKEND_PORT}, then restart the desktop app.`
      ]
    };
  }

  const backendEntry = resolveBackendEntryPath();

  if (!fs.existsSync(backendEntry)) {
    return {
      ok: false,
      mode: 'missing',
      lines: [
        'Backend entry file was not found.',
        `Expected file: ${backendEntry}`
      ]
    };
  }

  try {
    openBackendLog();
    writeAppLog(`Starting managed backend utility process: ${backendEntry}`);
    writeBackendLog(`Starting backend utility process: ${backendEntry}`);
    backendProcess = utilityProcess.fork(backendEntry, [], {
      cwd: path.dirname(backendEntry),
      env: process.env,
      stdio: 'pipe',
      serviceName: 'MT5 Dashboard Backend'
    });

    backendProcess.stdout?.on('data', (chunk) => {
      writeBackendLog(chunk);
    });

    backendProcess.stderr?.on('data', (chunk) => {
      writeBackendLog(chunk);
    });

    backendProcess.on('error', (error) => {
      writeBackendLog(`Backend process error: ${error.stack || error.message || JSON.stringify(error)}`);
    });

    backendProcess.on('exit', (code) => {
      writeBackendLog(`Backend process exited with code=${code}`);
      backendProcess = null;
      closeBackendLog();
    });

    const started = await waitForBackendReady(BACKEND_START_TIMEOUT_MS);

    if (!started) {
      stopBackendProcess();
      return {
        ok: false,
        mode: 'failed',
        lines: [
          'Backend did not start successfully.',
          `Check the backend log: ${backendLogPath || 'not available'}`
        ]
      };
    }

    console.log('Started local backend process for the desktop app.');
    writeAppLog('Started local backend process for the desktop app.');
    return { ok: true, mode: 'spawned' };
  } catch (error) {
    console.error('Failed to start embedded backend:', error);
    writeAppLog(`Failed to start local backend: ${error.stack || error.message || String(error)}`);
    writeBackendLog(`Failed to start backend: ${error.stack || error.message}`);
    return {
      ok: false,
      mode: 'failed',
      lines: [
        'Failed to start the local backend.',
        error.message || String(error),
        `Check the backend log: ${backendLogPath || 'not available'}`
      ]
    };
  }
}

function openBackendLog() {
  const logDir = getLogDir();
  backendLogPath = path.join(logDir, 'backend.log');
  backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
  writeBackendLog(`\n--- ${new Date().toISOString()} desktop backend launch ---`);
}

function writeBackendLog(chunk) {
  if (!backendLogStream) {
    return;
  }

  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  backendLogStream.write(text.endsWith('\n') ? text : `${text}\n`);
}

function stopBackendProcess() {
  if (!backendProcess) {
    closeBackendLog();
    return;
  }

  const child = backendProcess;
  backendProcess = null;
  writeBackendLog('Stopping backend process because the desktop app is closing.');

  try {
    child.kill();
  } catch (error) {
    writeBackendLog(`Failed to stop backend process cleanly: ${error.message}`);
  }
}

function closeBackendLog() {
  if (!backendLogStream) {
    return;
  }

  backendLogStream.end();
  backendLogStream = null;
}

function getLogDir() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}

function openAppLog() {
  const logDir = getLogDir();
  appLogPath = path.join(logDir, 'desktop.log');
  appLogStream = fs.createWriteStream(appLogPath, { flags: 'a' });
  writeAppLog('Desktop app starting.');
}

function writeAppLog(message) {
  if (!appLogStream) {
    return;
  }

  appLogStream.write(`[${new Date().toISOString()}] ${message}\n`);
}

function closeAppLog() {
  if (!appLogStream) {
    return;
  }

  writeAppLog('Desktop app exiting.');
  appLogStream.end();
  appLogStream = null;
}

async function openLogsFolder() {
  const result = await shell.openPath(getLogDir());

  if (result) {
    dialog.showErrorBox(WINDOW_TITLE, `Could not open logs folder:\n${result}`);
  }
}

async function openMt5EaFolder() {
  const mt5Folder = resolveMt5EaFolderPath();

  if (!fs.existsSync(mt5Folder)) {
    dialog.showErrorBox(WINDOW_TITLE, `MT5 EA folder was not found:\n${mt5Folder}`);
    return;
  }

  const result = await shell.openPath(mt5Folder);

  if (result) {
    dialog.showErrorBox(WINDOW_TITLE, `Could not open MT5 EA folder:\n${result}`);
  }
}

function showInstallHelp() {
  const options = {
    type: 'info',
    title: `${WINDOW_TITLE} Help`,
    message: 'Installation and MT5 setup',
    detail: [
      '1. In MT5, allow WebRequest for http://127.0.0.1:3001.',
      '2. Compile and attach MT5_Dashboard_Bridge.mq5 to the chart you want to mirror.',
      '3. Keep MT5 open and logged in.',
      '4. The desktop app starts the local backend on 127.0.0.1:3001 when that port is free.',
      '5. If the dashboard shows disconnected, use Open Logs Folder and check backend.log and desktop.log.',
      '',
      'Trading actions still require the existing frontend Trading Mode, backend gates, EA inputs, MT5 Algo Trading, and account permissions.'
    ].join('\n'),
    buttons: ['OK']
  };

  if (mainWindow) {
    dialog.showMessageBox(mainWindow, options);
    return;
  }

  dialog.showMessageBox(options);
}

function createApplicationMenu() {
  const template = [
    {
      label: 'App',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Ctrl+R',
          click: () => mainWindow?.reload()
        },
        {
          label: 'Toggle DevTools',
          accelerator: 'Ctrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools()
        },
        { type: 'separator' },
        {
          label: 'Open Logs Folder',
          click: () => {
            void openLogsFolder();
          }
        },
        {
          label: 'Open MT5 EA Folder',
          click: () => {
            void openMt5EaFolder();
          }
        },
        {
          label: 'Installation Help',
          click: showInstallHelp
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function probeBackend() {
  return new Promise((resolve) => {
    const request = http.get(BACKEND_HEALTH_URL, { timeout: 900 }, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed && parsed.ok === true ? { status: 'ready' } : { status: 'occupied' });
        } catch {
          resolve({ status: 'occupied' });
        }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      resolve({ status: 'occupied' });
    });

    request.on('error', (error) => {
      resolve(error.code === 'ECONNREFUSED' ? { status: 'free' } : { status: 'occupied' });
    });
  });
}

async function waitForBackendReady(timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const probe = await probeBackend();

    if (probe.status === 'ready') {
      return true;
    }

    if (probe.status === 'occupied') {
      return false;
    }

    await delay(300);
  }

  return false;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const request = http.get(url, { timeout: 700 }, (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 500);
      });

      request.on('timeout', () => {
        request.destroy();
      });

      request.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(check, 500);
      });
    };

    check();
  });
}

function loadMessage(window, lines) {
  const safeLines = lines.map((line) => escapeHtml(line));
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${WINDOW_TITLE}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b111a;
        color: #d6dde8;
        font-family: Segoe UI, Arial, sans-serif;
      }
      main {
        max-width: 680px;
        padding: 32px;
        border: 1px solid #223044;
        background: #111926;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 22px;
      }
      p {
        margin: 8px 0;
        color: #9aa7b8;
      }
      code {
        color: #d6dde8;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${WINDOW_TITLE}</h1>
      ${safeLines.map((line) => `<p><code>${line}</code></p>`).join('')}
    </main>
  </body>
</html>`;

  return window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.whenReady().then(async () => {
  openAppLog();
  createApplicationMenu();

  const backendState = await startBackendIfNeeded();
  writeAppLog(`Backend state: ${backendState.mode || 'unknown'} (${backendState.ok ? 'ok' : 'failed'}).`);
  const window = createWindow();

  if (backendState.ok) {
    await loadFrontend(window);
  } else {
    await loadMessage(window, backendState.lines);
    dialog.showErrorBox(WINDOW_TITLE, backendState.lines.join('\n'));
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWindow = createWindow();

      if (backendState.ok) {
        await loadFrontend(nextWindow);
      } else {
        await loadMessage(nextWindow, backendState.lines);
      }
    }
  });
});

app.on('before-quit', () => {
  stopBackendProcess();
  closeAppLog();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
