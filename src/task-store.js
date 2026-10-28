'use strict';
const fs   = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const BACKUP_KEEP_DAYS = 14;

// Brand orange (the dot in the app icon). Also the first project color; indigo moved down the list.
const ACCENT = '#FF6A00';
const COLOR_PALETTE = [ACCENT,'#3b82f6','#22c55e','#eab308','#6366f1','#ef4444','#ec4899','#a855f7'];

function getNextColor(projects) {
  const used = (projects || []).map(p => p.color);
  return COLOR_PALETTE.find(c => !used.includes(c)) ?? COLOR_PALETTE[(projects || []).length % COLOR_PALETTE.length];
}

function migrateTasks(data) {
  let changed = false;
  data.tasks = (data.tasks || []).map(task => {
    const t = { ...task };
    if ('text' in t)    { t.title = t.text; delete t.text; changed = true; }
    if (!t.bucket)      { t.bucket = 'anytime'; changed = true; }
    if ('dueDate' in t) { t.deadline = t.dueDate ?? null; delete t.dueDate; changed = true; }
    if ('priority' in t){ delete t.priority; changed = true; }
    return t;
  });
  return changed;
}

// Creates a store bound to a specific data directory.
// legacyDataDir: if provided, tasks.json is copied from there on first run (one-time migration).
function createStore(dataDir, { legacyDataDir } = {}) {
  const dataFile = path.join(dataDir, 'tasks.json');

  function ensureDir() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  }

  function migrateLegacy() {
    if (!legacyDataDir || fs.existsSync(dataFile)) return;
    const oldFile = path.join(legacyDataDir, 'tasks.json');
    if (fs.existsSync(oldFile)) {
      ensureDir();
      fs.copyFileSync(oldFile, dataFile);
    }
  }

  const backupDir = path.join(dataDir, 'backups');

  function today() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }

  // Keeps one snapshot per day (the state before the day's first write) and prunes old ones.
  function backupIfNeeded() {
    try {
      if (!fs.existsSync(dataFile)) return;
      const target = path.join(backupDir, `tasks-${today()}.json`);
      if (fs.existsSync(target)) return;
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(dataFile, target);
      const old = fs.readdirSync(backupDir).filter(f => /^tasks-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      old.slice(0, Math.max(0, old.length - BACKUP_KEEP_DAYS))
        .forEach(f => fs.unlinkSync(path.join(backupDir, f)));
    } catch { /* a failed backup must never block saving */ }
  }

  function latestValidBackup() {
    try {
      const files = fs.readdirSync(backupDir).filter(f => /^tasks-.*\.json$/.test(f)).sort().reverse();
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf8'));
          if (isValid(data)) return data;
        } catch { /* try the next one */ }
      }
    } catch { /* no backup dir */ }
    return null;
  }

  function isValid(data) {
    return data && typeof data === 'object' && Array.isArray(data.tasks);
  }

  // Atomic: write a temp file in the same directory, flush it to disk, then rename over the target.
  // A crash or power cut leaves either the old file or the new one, never a half-written one.
  function writeAtomic(file, content) {
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  function read() {
    migrateLegacy();
    ensureDir();
    if (!fs.existsSync(dataFile)) {
      const empty = { version: SCHEMA_VERSION, tasks: [], projects: [] };
      writeAtomic(dataFile, JSON.stringify(empty, null, 2));
      return { tasks: [], projects: [] };
    }
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (!isValid(data)) throw new Error('invalid shape');
      let changed = migrateTasks(data);
      if (data.version !== SCHEMA_VERSION) { data.version = SCHEMA_VERSION; changed = true; }
      if (changed) write(data);
      return data;
    } catch {
      // Never overwrite an unreadable file: set it aside, then fall back to the latest backup.
      try {
        fs.renameSync(dataFile, path.join(dataDir, `tasks.corrupt-${Date.now()}.json`));
      } catch { /* keep going */ }
      const restored = latestValidBackup();
      if (restored) {
        migrateTasks(restored);
        restored.version = SCHEMA_VERSION;
        writeAtomic(dataFile, JSON.stringify(restored, null, 2));
        return restored;
      }
      return { tasks: [], projects: [] };
    }
  }

  function write(data) {
    if (!isValid(data)) throw new Error('refusing to write invalid tasks data');
    ensureDir();
    backupIfNeeded();
    writeAtomic(dataFile, JSON.stringify({ ...data, version: SCHEMA_VERSION }, null, 2));
  }

  return { read, write, dataFile };
}

module.exports = { createStore, migrateTasks, ACCENT, SCHEMA_VERSION, COLOR_PALETTE, getNextColor };
