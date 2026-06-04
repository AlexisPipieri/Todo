'use strict';
const fs   = require('fs');
const path = require('path');

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

  function read() {
    migrateLegacy();
    ensureDir();
    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, JSON.stringify({ tasks: [] }, null, 2));
      return { tasks: [], projects: [] };
    }
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const changed = migrateTasks(data);
      if (changed) write(data);
      return data;
    } catch {
      return { tasks: [], projects: [] };
    }
  }

  function write(data) {
    ensureDir();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  }

  return { read, write, dataFile };
}

module.exports = { createStore, migrateTasks };
