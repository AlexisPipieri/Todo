'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, SCHEMA_VERSION } = require('../src/task-store');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdy-test-'));
  return { dir, store: createStore(dir) };
}

const sample = { tasks: [{ id: '1', title: 'a', bucket: 'today', completed: false }], projects: [] };

test('write stamps the schema version and leaves no temp file behind', () => {
  const { dir, store } = tmpStore();
  store.write(sample);
  const saved = JSON.parse(fs.readFileSync(store.dataFile, 'utf8'));
  assert.equal(saved.version, SCHEMA_VERSION);
  assert.deepEqual(saved.tasks, sample.tasks);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

test('write refuses data without a tasks array', () => {
  const { store } = tmpStore();
  store.write(sample);
  assert.throws(() => store.write({ projects: [] }));
  assert.throws(() => store.write(null));
  assert.equal(store.read().tasks.length, 1);
});

test('first write of the day snapshots the previous state, once', () => {
  const { dir, store } = tmpStore();
  store.write(sample);                                  // no previous file: no backup
  store.write({ ...sample, tasks: [] });                // snapshots the 1-task state
  store.write({ ...sample, tasks: [] });                // already backed up today
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(backups.length, 1);
  const snap = JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups[0]), 'utf8'));
  assert.equal(snap.tasks.length, 1);
});

test('old backups are pruned to 14', () => {
  const { dir, store } = tmpStore();
  store.write(sample);
  const bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  for (let i = 1; i <= 20; i++) {
    fs.writeFileSync(path.join(bdir, `tasks-2020-01-${String(i).padStart(2, '0')}.json`), '{"tasks":[]}');
  }
  store.write({ ...sample, tasks: [] });
  assert.equal(fs.readdirSync(bdir).length, 14);
});

test('a corrupt file is set aside and restored from the latest valid backup', () => {
  const { dir, store } = tmpStore();
  store.write(sample);
  store.write({ ...sample, tasks: [] });                // creates the backup holding 1 task
  fs.writeFileSync(store.dataFile, '{ not json');
  const data = store.read();
  assert.equal(data.tasks.length, 1);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('tasks.corrupt-')));
  assert.equal(JSON.parse(fs.readFileSync(store.dataFile, 'utf8')).tasks.length, 1);
});

test('a corrupt file with no backup is preserved, never overwritten', () => {
  const { dir, store } = tmpStore();
  fs.writeFileSync(store.dataFile, '{ not json');
  const data = store.read();
  assert.deepEqual(data.tasks, []);
  const corrupt = fs.readdirSync(dir).find(f => f.startsWith('tasks.corrupt-'));
  assert.ok(corrupt);
  assert.equal(fs.readFileSync(path.join(dir, corrupt), 'utf8'), '{ not json');
});

test('legacy v0 files are migrated and versioned on read', () => {
  const { store } = tmpStore();
  fs.writeFileSync(store.dataFile, JSON.stringify({ tasks: [{ id: '1', text: 'old', dueDate: '2026-01-01', priority: 2 }] }));
  const data = store.read();
  assert.equal(data.tasks[0].title, 'old');
  assert.equal(data.tasks[0].deadline, '2026-01-01');
  assert.equal(data.tasks[0].bucket, 'anytime');
  assert.equal(data.version, SCHEMA_VERSION);
});
