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
- **Priority**: mark tasks as urgent (!!!) via flag icon or input bar button; click badge to remove
- **Due dates**: set via calendar icon or input bar button; options include Today, Tomorrow, In a week, or custom date
- **Projects**: assign color-coded project tags via tag icon or input bar button; create new projects inline
- **Sort modes**: Manual (drag-to-reorder) or Due date (grouped sections: Overdue, Today, Tomorrow, This week, Later, No due date)
- **Completed section**: tasks completed today shown below active tasks; "History" toggle reveals past completed tasks grouped by day
- **Tray icon**: left-click to show/hide window; right-click for menu with data file path, Show in Finder, Restart, Quit
- **Auto-rollover**: uncompleted tasks carry over daily; midnight check reloads tasks automatically

## Data

Tasks are stored in `~/Library/Application Support/menutodo/tasks.json` (or `menutodo-test/` when using `dev:seed`).
