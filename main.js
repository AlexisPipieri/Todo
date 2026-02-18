const { app, BrowserWindow, Tray, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let mainWindow = null;

const DATA_DIR_NAME = process.env.MENUTODO_ENV === 'test' ? 'menutodo-test' : 'menutodo';
const DATA_DIR = path.join(app.getPath('userData'), DATA_DIR_NAME);
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

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
    return JSON.parse(data);
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

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
