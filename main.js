const { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, Menu, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { createStore } = require('./src/task-store');

app.setName('tdy');

let tray = null;
let mainWindow = null;
let settingsWindow = null;

const DATA_DIR = process.env.TDY_ENV === 'test'
  ? path.join(app.getPath('appData'), 'tdy-test')
  : app.getPath('userData');

const store = createStore(DATA_DIR, {
  legacyDataDir: path.join(app.getPath('appData'), 'menutodo'),
});
const DATA_FILE = store.dataFile;

function processRollover(data) {
  return data;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    vibrancy: 'popover',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('src/index.html');


  mainWindow.on('blur', () => {
    mainWindow.hide();
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 820,
    height: 540,
    title: 'Settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  settingsWindow.loadFile('src/settings.html');
  app.dock?.show();

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (app.isPackaged) app.dock?.hide();
  });
}

function checkForUpdates() {
  let responded = false;

  const onNotAvailable = () => {
    if (responded) return;
    responded = true;
    dialog.showMessageBox({ type: 'info', title: 'tdy', message: 'You\'re up to date!', detail: `Version ${app.getVersion()} is the latest.`, buttons: ['OK'] });
  };

  const onAvailable = () => { responded = true; };

  const onDownloaded = () => {
    responded = true;
    dialog.showMessageBox({ type: 'info', title: 'tdy', message: 'Update ready', detail: 'A new version has been downloaded. Restart to apply it.', buttons: ['Restart Now', 'Later'] })
      .then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  };

  const onError = (err) => {
    if (responded) return;
    responded = true;
    dialog.showMessageBox({ type: 'error', title: 'tdy', message: 'Update check failed', detail: err.message, buttons: ['OK'] });
  };

  autoUpdater.once('update-not-available', onNotAvailable);
  autoUpdater.once('update-available', onAvailable);
  autoUpdater.once('update-downloaded', onDownloaded);
  autoUpdater.once('error', onError);
  autoUpdater.checkForUpdates();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('tdy');

  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: `tdy v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Settings…', click: () => createSettingsWindow() },
      { type: 'separator' },
      { label: 'Restart', click: () => { app.relaunch(); app.quit(); } },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.popUpContextMenu(menu);
  });

  tray.on('click', (event, bounds) => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      // Position window below the tray icon
      const { x, y } = bounds;
      const { width, height } = mainWindow.getBounds();

      const windowX = Math.round(x - width / 2);
      const windowY = y;

      mainWindow.setPosition(windowX, windowY);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('window-shown');
    }
  });
}

// IPC handlers
ipcMain.handle('load-tasks', () => {
  const data = store.read();
  const processed = processRollover(data);
  if (JSON.stringify(data) !== JSON.stringify(processed)) store.write(processed);
  return processed;
});

ipcMain.handle('save-tasks', (event, data) => {
  store.write(data);
  return true;
});

ipcMain.handle('show-in-finder', () => {
  shell.showItemInFolder(DATA_FILE);
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('get-settings', () => ({
  loginItem: app.getLoginItemSettings().openAtLogin,
  dataPath: DATA_FILE,
  version: app.getVersion(),
}));

ipcMain.handle('set-login-item', (event, value) => {
  app.setLoginItemSettings({ openAtLogin: value });
});

ipcMain.handle('check-for-updates', () => {
  checkForUpdates();
});

ipcMain.handle('get-labels', () => store.read());

ipcMain.handle('update-labels', (event, data) => {
  store.write(data);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('reload-tasks');
  }
});

// Update the badge count on the tray icon

ipcMain.handle('update-badge', (event, count) => {
  if (tray) {
    tray.setTitle(count > 0 ? String(count) : '');
  }
  return true;
});

ipcMain.handle('show-context-menu', (event, taskId, { isFirst, isLast, bucket, hasProject, hasDeadline, completed }) => {
  const send = (action) => event.sender.send('context-action', { action, taskId });
  const template = [];
  if (!completed) {
    if (!isFirst) template.push({ label: '↑ Move to top',    click: () => send('move-top') });
    if (!isLast)  template.push({ label: '↓ Move to bottom', click: () => send('move-bottom') });
    if (template.length) template.push({ type: 'separator' });
    if (bucket === 'today') {
      template.push({ label: '→ Move to Anytime', click: () => send('move-anytime') });
    } else {
      template.push({ label: '→ Move to Today', click: () => send('move-today') });
    }
    template.push({ type: 'separator' });
    template.push({ label: hasProject  ? '🏷 Change label'    : '🏷 Add label',    click: () => send(hasProject  ? 'change-label'    : 'add-label') });
    template.push({ label: hasDeadline ? '📅 Change deadline' : '📅 Set deadline', click: () => send(hasDeadline ? 'change-deadline' : 'set-deadline') });
    template.push({ type: 'separator' });
  }
  template.push({ label: '✕ Delete', click: () => send('delete') });
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

function buildAppMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'tdy',
      submenu: [
        { label: 'About tdy', role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => createSettingsWindow() },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ]);
}

app.whenReady().then(() => {
  if (app.isPackaged) app.dock?.hide();

  Menu.setApplicationMenu(buildAppMenu());
  createWindow();
  createTray();
  startFileWatcher();

  if (!app.isPackaged) {
    createSettingsWindow();
  } else {
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// File watcher — picks up external writes (e.g. MCP) and reloads the renderer
let fileWatcherDebounce = null;

function startFileWatcher() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.watch(DATA_DIR, (eventType, filename) => {
    if (filename !== 'tasks.json') return;
    clearTimeout(fileWatcherDebounce);
    fileWatcherDebounce = setTimeout(() => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('reload-tasks');
      }
    }, 200);
  });
}

// Check for rollover at midnight
function scheduleRolloverCheck() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    // Reload tasks with rollover processing
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('reload-tasks');
    }
    scheduleRolloverCheck(); // Schedule next check
  }, msUntilMidnight);
}

app.whenReady().then(() => {
  scheduleRolloverCheck();
});
