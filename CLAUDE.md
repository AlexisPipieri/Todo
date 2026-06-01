# MenuTodo

A minimal macOS menu bar todo app built with Electron.

## Development

```bash
npm run dev          # build CSS + launch app in dev mode (window visible on start)
npm run dev:seed     # same but uses isolated test data directory
```

## Install to /Applications

```bash
npm run install-app  # build CSS, package with electron-builder, replace /Applications/MenuTodo.app
```

After installing, relaunch the app from /Applications or Spotlight.

> Note: `install-app` kills any running instance and does a clean replace — no nesting issues.

## Features

- **Tasks**: add via input bar, click text to edit inline, check to complete, × to delete
- **Deadlines**: set via `@` inline syntax (e.g. `@tomorrow`, `@monday`, `@may 5`) or calendar icon on hover; shown as a pill on the task
- **Projects**: assign color-coded tags via `#` inline syntax or tag icon on hover; create new projects inline
- **Buckets**: tasks live in Today or Anytime; move between them via tray icons on hover
- **Completed section**: tasks completed today shown below active tasks as "N done today" toggle
- **Views**: Today (focus view) and All (shows Today + Anytime sections with project filter chips)
- **Tray icon**: left-click to show/hide window; right-click for menu with data file path, Show in Finder, Restart, Quit
- **Auto-rollover**: uncompleted tasks carry over daily; midnight check reloads tasks automatically

## Data

Tasks are stored in `~/Library/Application Support/menutodo/tasks.json` (or `menutodo-test/` when using `dev:seed`).
