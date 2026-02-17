const path = require('node:path');
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, session } = require('electron');

const DESKTOP_MODE = process.env.DESKTOP_MODE === 'development' ? 'development' : 'production';
const BACKEND_DEV_URL = process.env.DESKTOP_BACKEND_URL || 'http://localhost:5173';
const BACKEND_PORT = Number.parseInt(process.env.DESKTOP_BACKEND_PORT || '5180', 10);
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let backendProcess = null;

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

function createMainWindow() {
  mainWindow = new BrowserWindow({
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
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const appUrl = resolveAppUrl();
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function resolveAppUrl() {
  return DESKTOP_MODE === 'development' ? BACKEND_DEV_URL : BACKEND_URL;
}

async function startProductionBackend() {
  const serveCliPath = require.resolve('@react-router/serve/bin.js');
  const serverBuildPath = path.resolve(process.cwd(), 'build', 'server', 'index.js');
  if (!existsSync(serverBuildPath)) {
    throw new Error('Server build is missing. Run `npm run build` first.');
  }

  backendProcess = spawn(process.execPath, [serveCliPath, serverBuildPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      NODE_ENV: 'production',
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
  await mainWindow.loadURL(encoded);
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

app.whenReady().then(async () => {
  configureContentSecurityPolicy();

  if (DESKTOP_MODE === 'production') {
    try {
      await startProductionBackend();
    } catch (error) {
      const message = `Failed to start local backend at ${BACKEND_URL}.`;
      const detail = readErrorMessage(error);
      createMainWindow();
      await showErrorPage(message, detail);
      return;
    }
  }

  createMainWindow();

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
  stopBackendProcess();
});
