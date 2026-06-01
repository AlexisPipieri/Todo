const { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let mainWindow = null;

const DATA_DIR = process.env.MENUTODO_ENV === 'test'
  ? path.join(app.getPath('appData'), 'menutodo-test')
  : app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

// Migrate v1 tasks to v2 data model
function migrateTasks(data) {
  let changed = false;
  data.tasks = (data.tasks || []).map(task => {
    const t = { ...task };
    if ('text' in t) { t.title = t.text; delete t.text; changed = true; }
    if (!t.bucket) { t.bucket = 'anytime'; changed = true; }
    if ('dueDate' in t) { t.deadline = t.dueDate ?? null; delete t.dueDate; changed = true; }
    if ('priority' in t) { delete t.priority; changed = true; }
    return t;
  });
  return changed;
}

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  }
}

// Load tasks from file
function loadTasks() {
  ensureDataDir();
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(data);
    const changed = migrateTasks(parsed);
    if (changed) saveTasks(parsed);
    return parsed;
  } catch (e) {
    return { tasks: [], projects: [] };
  }
}

// Save tasks to file
function saveTasks(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Process rollover: uncompleted tasks from previous days carry over automatically.
// Completed tasks are kept in full for history display.
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

  if (!app.isPackaged) {
    mainWindow.once('ready-to-show', () => mainWindow.show());
  }

  mainWindow.on('blur', () => {
    mainWindow.hide();
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('MenuTodo');

  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: `MenuTodo v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Data file path', enabled: false },
      { label: DATA_FILE, enabled: false },
      { label: 'Show in Finder', click: () => shell.showItemInFolder(DATA_FILE) },
      { type: 'separator' },
      { label: 'Restart', click: () => { app.relaunch(); app.exit(0); } },
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
  const data = loadTasks();
  const processed = processRollover(data);

  // Save processed data if it changed
  if (JSON.stringify(data) !== JSON.stringify(processed)) {
    saveTasks(processed);
  }

  return processed;
});

ipcMain.handle('save-tasks', (event, data) => {
  saveTasks(data);
  return true;
});

// Update the badge count on the tray icon
ipcMain.handle('update-badge', (event, count) => {
  if (tray) {
    tray.setTitle(count > 0 ? String(count) : '');
  }
  return true;
});

app.whenReady().then(() => {
  if (app.isPackaged) app.dock?.hide();

  createWindow();
  createTray();
  startFileWatcher();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// File watcher — picks up external writes (e.g. MCP) and reloads the renderer
let fileWatcherDebounce = null;

function startFileWatcher() {
  ensureDataDir();
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
