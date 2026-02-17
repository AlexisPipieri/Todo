const { app, BrowserWindow, Tray, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let mainWindow = null;

const DATA_DIR = path.join(app.getPath('userData'), 'menutodo');
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
    return { tasks: [] };
  }
}

// Save tasks to file
function saveTasks(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Process rollover: keep uncompleted tasks, remove completed tasks from previous days
function processRollover(data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tasks = data.tasks.filter(task => {
    const createdDate = new Date(task.createdAt);
    createdDate.setHours(0, 0, 0, 0);

    // Keep all uncompleted tasks
    if (!task.completed) {
      return true;
    }

    // For completed tasks, only keep those completed today
    if (task.completedAt) {
      const completedDate = new Date(task.completedAt);
      completedDate.setHours(0, 0, 0, 0);
      return completedDate.getTime() === today.getTime();
    }

    return false;
  });

  return { tasks };
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

function createTray() {
  // Create a 22x22 checkmark icon using data URL (standard macOS menu bar size)
  const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAARUlEQVR42mNgGAVDBfxHwjQx9D+tDP0/pFw7MEFAjEKywpWQBrIjC59GilMALgOoEln/CWCqxzzVkhbNchbNCphRQDkAALOAU606uX3uAAAAAElFTkSuQmCC';

  const icon = nativeImage.createFromDataURL(iconDataUrl);
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
  // Hide dock icon since this is a menu bar app
  app.dock?.hide();

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
