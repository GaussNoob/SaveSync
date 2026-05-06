import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const dashboardUrl = process.env.SAVESYNC_DASHBOARD_URL || (isDev ? 'http://localhost:5173' : 'http://localhost:3000');

let mainWindow;
let serverProcess;

function startServer() {
  if (isDev || process.env.SAVESYNC_EXTERNAL_SERVER === '1') return;
  serverProcess = spawn(process.env.SAVESYNC_NODE_BIN || 'node', ['server/index.js'], {
    cwd: rootDir,
    env: { ...process.env, PORT: process.env.PORT || '3000' },
    stdio: 'inherit'
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
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.loadURL(dashboardUrl);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

ipcMain.handle('savesync:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});
