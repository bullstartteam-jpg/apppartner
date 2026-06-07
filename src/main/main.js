const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'BullStart Partner',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // Load the dev server ONLY when explicitly asked via BS_DEV=1 — NOT the
  // global NODE_ENV (which may leak from other apps and make us load their
  // dev-server on :3000). Default: always load this app's own build.
  if (!app.isPackaged && process.env.BS_DEV === '1') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Auto-update — pulls latest release from GitHub and installs on next quit.
// ---------------------------------------------------------------------------
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

autoUpdater.on('checking-for-update', () => {
  notifyRenderer('updater-status', { status: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  notifyRenderer('updater-status', { status: 'available', version: info?.version });
});
autoUpdater.on('update-not-available', () => {
  notifyRenderer('updater-status', { status: 'up-to-date' });
});
autoUpdater.on('download-progress', (progress) => {
  notifyRenderer('updater-status', {
    status: 'downloading',
    percent: Math.round(progress.percent || 0),
    bytesPerSecond: progress.bytesPerSecond,
  });
});
autoUpdater.on('update-downloaded', (info) => {
  notifyRenderer('updater-status', { status: 'downloaded', version: info?.version });
  // Prompt user to restart and install. If they decline, the update is
  // applied on the next app quit anyway (autoInstallOnAppQuit = true).
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: `BullStart Partner ${info?.version} đã tải xong. Khởi động lại để cài đặt?`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then((res) => {
      if (res.response === 0) autoUpdater.quitAndInstall();
    })
    .catch(() => {});
});
autoUpdater.on('error', (err) => {
  notifyRenderer('updater-status', { status: 'error', message: err?.message || String(err) });
});

app.whenReady().then(() => {
  createWindow();
  // Skip update check in dev — only run for packaged builds.
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[updater] check failed', err?.message || err);
      });
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-app-version', () => app.getVersion());

// Manual recheck — frontend can wire this to a "Check for updates" button.
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev', message: 'Skipped in dev build' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return {
      status: r?.updateInfo ? 'available' : 'up-to-date',
      version: r?.updateInfo?.version,
    };
  } catch (err) {
    return { status: 'error', message: err?.message || String(err) };
  }
});

// Open a URL in the user's default external browser.
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
  return false;
});
