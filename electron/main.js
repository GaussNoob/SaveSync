import { app, BrowserWindow, Menu, shell, dialog, ipcMain, utilityProcess } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow;
let serverProcess;
let dashboardUrl;
let dashboardOrigin;
let dashboardLoadAttempts = 0;
let dashboardRetryTimer = null;
let quitting = false;

async function startServer() {
  const externalDashboard = process.env.SAVESYNC_DASHBOARD_URL;
  if (isDev || process.env.SAVESYNC_EXTERNAL_SERVER === '1') {
    setDashboardUrl(externalDashboard || (isDev ? 'http://localhost:5173' : `http://localhost:${process.env.PORT || 3000}`));
    return;
  }

  const env = {
    ...process.env,
    PORT: process.env.PORT || (app.isPackaged ? '0' : '3000'),
    SAVESYNC_CONFIG: process.env.SAVESYNC_CONFIG || path.join(app.getPath('userData'), 'config.yaml')
  };
  const externalNode = process.env.SAVESYNC_NODE_BIN;
  if (!app.isPackaged || externalNode) {
    serverProcess = spawn(externalNode || 'node', ['server/index.js'], {
      cwd: rootDir,
      env,
      stdio: 'inherit',
      windowsHide: true
    });
    serverProcess.once('error', error => {
      console.error(`Não foi possível iniciar o backend do SaveSync: ${error.message}`);
    });
    serverProcess.once('exit', (code, signal) => {
      handleServerExit(code, signal);
    });
    setDashboardUrl(externalDashboard || `http://localhost:${env.PORT}`);
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    let startupTimeout;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      callback(value);
    };

    startupTimeout = setTimeout(() => {
      settle(reject, new Error('O backend não informou que estava pronto em 15 segundos.'));
    }, 15_000);

    serverProcess = utilityProcess.fork(
      path.join(app.getAppPath(), 'server', 'index.js'),
      [],
      {
        cwd: path.dirname(process.execPath),
        env,
        stdio: 'inherit',
        serviceName: 'SaveSync Backend'
      }
    );
    serverProcess.once('error', (type, location, report) => {
      const detail = report || location || type || 'erro desconhecido';
      settle(reject, new Error(`Falha fatal no backend do SaveSync: ${detail}`));
    });
    serverProcess.once('exit', code => {
      handleServerExit(code, null);
      settle(reject, new Error(`O backend encerrou durante a inicialização (código ${code}).`));
    });
    serverProcess.on('message', message => {
      if (message?.type !== 'savesync:ready' || !Number.isInteger(message.port)) return;
      try {
        const host = normalizeDashboardHost(message.host);
        setDashboardUrl(externalDashboard || `http://${host}:${message.port}`);
        settle(resolve);
      } catch (error) {
        settle(reject, error);
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'SaveSync',
    backgroundColor: '#f7f8fb',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  void loadDashboard();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = safeProtocol(url);
    if (['http:', 'https:', 'steam:'].includes(protocol)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (safeOrigin(url) !== dashboardOrigin) event.preventDefault();
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await startServer();
      createWindow();
    } catch (error) {
      console.error(error);
      await dialog.showMessageBox({
        type: 'error',
        title: 'SaveSync',
        message: 'Não foi possível iniciar o SaveSync.',
        detail: error.message
      });
      app.quit();
    }

    app.on('activate', () => {
      if (dashboardUrl && BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  clearTimeout(dashboardRetryTimer);
  if (serverProcess) serverProcess.kill();
});

ipcMain.handle('savesync:select-folder', async event => {
  if (safeOrigin(event.senderFrame?.url) !== dashboardOrigin) throw new Error('Origem IPC não autorizada.');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('savesync:open-external', async (event, value) => {
  if (safeOrigin(event.senderFrame?.url) !== dashboardOrigin) throw new Error('Origem IPC não autorizada.');
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Link externo não permitido.');
  await shell.openExternal(url.href);
  return true;
});

function safeOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function safeProtocol(url) {
  try { return new URL(url).protocol; } catch { return null; }
}

function setDashboardUrl(value) {
  dashboardUrl = new URL(value).href.replace(/\/$/, '');
  dashboardOrigin = new URL(dashboardUrl).origin;
}

function normalizeDashboardHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized || normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]') return '127.0.0.1';
  return normalized.includes(':') && !normalized.startsWith('[') ? `[${normalized}]` : normalized;
}

async function loadDashboard() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.loadURL(dashboardUrl);
    dashboardLoadAttempts = 0;
  } catch (error) {
    dashboardLoadAttempts += 1;
    const canRetry = !isDev && dashboardLoadAttempts <= 30 && !quitting;
    if (!canRetry) {
      console.error(`Não foi possível carregar o dashboard: ${error.message}`);
      return;
    }
    clearTimeout(dashboardRetryTimer);
    dashboardRetryTimer = setTimeout(() => void loadDashboard(), 500);
  }
}

function handleServerExit(code, signal) {
  if (!quitting && code !== 0) {
    console.error(`O backend do SaveSync encerrou inesperadamente (código ${code}, sinal ${signal || 'nenhum'}).`);
  }
  serverProcess = null;
}
