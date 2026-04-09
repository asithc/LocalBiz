import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { handleApiRequest } from './ipc/router';
import { closeDatabase, getDatabase } from './db';

let mainWindow: BrowserWindow | null = null;

const resolveAppIconPath = () => {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icons', 'icon-512.png'),
    path.join(process.cwd(), 'build', 'icons', 'icon-512.png')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
};

const createWindow = () => {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    icon: iconPath,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.whenReady().then(() => {
  getDatabase();
  const iconPath = resolveAppIconPath();
  if (process.platform === 'darwin' && iconPath && app.dock) {
    app.dock.setIcon(iconPath);
  }

  ipcMain.handle('api:request', async (_, req) => handleApiRequest(req));

  app.on('web-contents-created', (_, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, navigationUrl) => {
      const isLocal =
        navigationUrl.startsWith('file://') ||
        navigationUrl.startsWith('data:') ||
        navigationUrl.startsWith('http://localhost:5173');

      if (!isLocal) {
        event.preventDefault();
      }
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
