/**
 * Electron desktop-shell module.
 */
const path = require('node:path');
const { existsSync, readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, dialog, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const DESKTOP_MODE = process.env.DESKTOP_MODE === 'development' ? 'development' : 'production';
const BACKEND_DEV_URL = process.env.DESKTOP_BACKEND_URL || 'http://localhost:5173';
const BACKEND_PORT = Number.parseInt(process.env.DESKTOP_BACKEND_PORT || '5180', 10);
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const APP_ICON_PATH = path.resolve(__dirname, 'assets', 'icon.png');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let backendProcess = null;
/** @type {NodeJS.Timeout | null} */
let updateCheckTimer = null;
let hasShownUpdateAvailableDialog = false;
let hasShownUpdateReadyDialog = false;

function configureContentSecurityPolicy() {
  const csp = [
    "default-src 'self' http: https: data: blob:",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' http: https:",
    "style-src 'self' 'unsafe-inline' http: https:",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data: http: https:",
    "connect-src 'self' http: https: ws: wss:",
    "frame-src 'self' http: https:",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived(
    {
      urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'],
    },
    (details, callback) => {
      const headers = {
        ...(details.responseHeaders || {}),
        'Content-Security-Policy': [csp],
      };
      callback({ responseHeaders: headers });
    },
  );
}

function createMainWindow({ loadAppUrl = true } = {}) {
  const browserWindowOptions = {
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: 'Local Playground',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (existsSync(APP_ICON_PATH)) {
    browserWindowOptions.icon = APP_ICON_PATH;
  }

  mainWindow = new BrowserWindow(browserWindowOptions);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const appUrl = resolveAppUrl();
  const appOrigin = readUrlOrigin(appUrl);
  configureExternalLinkHandling(appOrigin);
  if (loadAppUrl) {
    mainWindow.loadURL(appUrl).catch((error) => {
      const summary =
        DESKTOP_MODE === 'development'
          ? `Could not connect to ${appUrl}.`
          : `Could not open ${appUrl}.`;
      const guide =
        DESKTOP_MODE === 'development'
          ? 'Run `npm run desktop:dev` or start the web app with `npm run dev`.'
          : 'Run `npm run desktop:start` again after a successful build.';
      void showErrorPage(`${summary} ${guide}`, readErrorMessage(error));
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function configureExternalLinkHandling(appOrigin) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenInExternalBrowser(url, appOrigin)) {
      openInExternalBrowser(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!shouldOpenInExternalBrowser(url, appOrigin)) {
      return;
    }

    event.preventDefault();
    openInExternalBrowser(url);
  });
}

function resolveAppUrl() {
  return DESKTOP_MODE === 'development' ? BACKEND_DEV_URL : BACKEND_URL;
}

function shouldOpenInExternalBrowser(url, appOrigin) {
  const targetOrigin = readUrlOrigin(url);
  if (!targetOrigin) {
    return false;
  }

  return targetOrigin !== appOrigin;
}

function readUrlOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function openInExternalBrowser(url) {
  void shell.openExternal(url).catch((error) => {
    console.error(`[desktop-shell] Failed to open external URL: ${readErrorMessage(error)}`);
  });
}

function initializeAutoUpdater() {
  if (DESKTOP_MODE !== 'production' || !app.isPackaged) {
    return;
  }

  autoUpdater.on('update-available', () => {
    if (hasShownUpdateAvailableDialog) {
      return;
    }

    hasShownUpdateAvailableDialog = true;
    void showUpdateDialog({
      title: 'Update Available',
      message: 'A new version of Local Playground is available.',
      detail: 'The update is downloading in the background.',
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-downloaded', () => {
    if (hasShownUpdateReadyDialog) {
      return;
    }

    hasShownUpdateReadyDialog = true;
    void showUpdateDialog({
      title: 'Update Ready',
      message: 'A new version of Local Playground has been downloaded.',
      detail: 'Restart now to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (error) => {
    console.error(`[desktop-updater] ${readErrorMessage(error)}`);
  });

  void checkForUpdates();
  updateCheckTimer = setInterval(() => {
    void checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error(`[desktop-updater] Failed to check for updates: ${readErrorMessage(error)}`);
  }
}

function showUpdateDialog(options) {
  const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const dialogOptions = {
    type: 'info',
    noLink: true,
    ...options,
  };

  if (targetWindow) {
    return dialog.showMessageBox(targetWindow, dialogOptions);
  }

  return dialog.showMessageBox(dialogOptions);
}

async function startProductionBackend() {
  const appRootPath = resolveRuntimeAppRootPath();
  const serveCliPath = resolveReactRouterServeCliPath();
  const serverBuildPath = resolveServerBuildPath(appRootPath);
  if (!existsSync(serverBuildPath)) {
    throw new Error(`Server build is missing at ${serverBuildPath}. Run \`npm run build\` first.`);
  }

  backendProcess = spawn(process.execPath, [serveCliPath, serverBuildPath], {
    cwd: resolveBackendWorkingDirectory(appRootPath),
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      NODE_ENV: 'production',
      NODE_PATH: resolveBackendNodePath(appRootPath),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (line) {
      console.log(`[desktop-backend] ${line}`);
    }
  });

  backendProcess.stderr?.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (line) {
      console.error(`[desktop-backend] ${line}`);
    }
  });

  backendProcess.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    console.error(`[desktop-backend] exited with ${reason}`);
    backendProcess = null;
  });

  await waitForBackend(BACKEND_URL, 30_000);
}

async function waitForBackend(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Ignore retryable connection errors.
    }

    await delay(300);
  }

  throw new Error(`Timed out waiting for ${url}.`);
}

async function showErrorPage(message, details) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Local Playground</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f9fb;
        color: #1f2937;
      }
      main {
        max-width: 820px;
        margin: 56px auto;
        padding: 0 24px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.5;
      }
      pre {
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #d1d5db;
        background: #ffffff;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Unable to open Local Playground</h1>
      <p>${escapeHtml(message)}</p>
      <pre>${escapeHtml(details)}</pre>
    </main>
  </body>
</html>`;

  const encoded = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  try {
    await mainWindow.loadURL(encoded);
  } catch (error) {
    console.error(`[desktop-ui] Failed to render error page: ${readErrorMessage(error)}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stopBackendProcess() {
  if (!backendProcess) {
    return;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child.killed) {
    child.kill();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unknown error.';
}

function resolveReactRouterServeCliPath() {
  const servePackageJsonPath = require.resolve('@react-router/serve/package.json');
  const servePackageDir = path.dirname(servePackageJsonPath);
  const servePackageJson = JSON.parse(readFileSync(servePackageJsonPath, 'utf8'));
  const binField = servePackageJson?.bin;

  let relativeCliPath = null;
  if (typeof binField === 'string') {
    relativeCliPath = binField;
  } else if (binField && typeof binField === 'object') {
    relativeCliPath = binField['react-router-serve'] || Object.values(binField)[0] || null;
  }

  if (!relativeCliPath) {
    throw new Error('Could not resolve @react-router/serve CLI path from package metadata.');
  }

  const serveCliPath = path.resolve(servePackageDir, relativeCliPath);
  if (!existsSync(serveCliPath)) {
    throw new Error(`React Router serve CLI not found at ${serveCliPath}.`);
  }

  return serveCliPath;
}

function resolveBackendWorkingDirectory(appRootPath) {
  return app.isPackaged ? process.resourcesPath : appRootPath;
}

function resolveServerBuildPath(appRootPath) {
  if (app.isPackaged) {
    return path.resolve(process.resourcesPath, 'app.asar', 'build', 'server', 'index.js');
  }

  return path.resolve(appRootPath, 'build', 'server', 'index.js');
}

function resolveRuntimeAppRootPath() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }

  return path.resolve(__dirname, '..', '..');
}

function resolveBackendNodePath(appRootPath) {
  const nodePaths = app.isPackaged
    ? [
        path.resolve(process.resourcesPath, 'app.asar', 'node_modules'),
        path.resolve(process.resourcesPath, 'node_modules'),
      ]
    : [path.resolve(appRootPath, 'node_modules')];

  if (process.env.NODE_PATH) {
    nodePaths.push(process.env.NODE_PATH);
  }

  return nodePaths.join(path.delimiter);
}

function setDockIconIfAvailable() {
  if (process.platform !== 'darwin' || !app.dock || !existsSync(APP_ICON_PATH)) {
    return;
  }

  app.dock.setIcon(APP_ICON_PATH);
}

app.whenReady().then(async () => {
  configureContentSecurityPolicy();
  setDockIconIfAvailable();

  if (DESKTOP_MODE === 'production') {
    try {
      await startProductionBackend();
    } catch (error) {
      const message = `Failed to start local backend at ${BACKEND_URL}.`;
      const detail = readErrorMessage(error);
      createMainWindow({ loadAppUrl: false });
      await showErrorPage(message, detail);
      return;
    }
  }

  createMainWindow();
  initializeAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }

  stopBackendProcess();
});
