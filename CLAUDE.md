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
