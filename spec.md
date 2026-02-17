# Menu Bar Todo App — Claude Code Spec

## Overview

A minimal macOS menu bar todo app. Click the icon, see your tasks, add new ones. Uncompleted tasks roll over to the next day automatically. Inspired by Kairn's simplicity and Linear's visual style.

---

## Stack

- **Electron** — for the menu bar tray + popover window
- **React** — for the UI
- **Tailwind CSS** — for styling
- **Local JSON file** — for persistence (`~/Library/Application Support/menutodo/tasks.json`)
- No database, no backend, no account

---

## Core Behaviors

### Capture
- Clicking the menu bar icon opens the popover
- At the top of the popover is a text input, auto-focused on open
- Typing and pressing Enter saves the task instantly
- No required fields other than the task text
- After saving, the input clears and stays focused for quick multi-capture

### Task list
- Tasks appear below the input, newest at the top within each day
- Each task shows a checkbox on the left and the task text
- Clicking the checkbox marks the task as done (subtle strikethrough + muted text)
- Completed tasks appear at the bottom of the list, visually dimmed

### Rollover
- At the start of each new day (on app open or midnight), uncompleted tasks from previous days automatically carry over — no action needed from the user
- Completed tasks from previous days do NOT roll over — they disappear
- There is no "overdue" label or date shown on rolled-over tasks — they simply appear as current tasks

### Persistence
- All tasks saved locally in a JSON file
- Data survives app restarts and system reboots

---

## UI Design

### Style
- **Linear-inspired**: light background, clean sans-serif typography, crisp and airy
- Neutral grays, minimal borders, generous whitespace
- No colors except for subtle interactive states (hover, focus)
- Font: system font stack (`-apple-system, BlinkMacSystemFont, "Inter"`)

### Popover window
- Width: ~380px
- Max height: ~480px, scrollable if list grows
- Rounded corners (12px), subtle drop shadow
- No title bar, no window chrome

### Layout
```
┌─────────────────────────────────┐
│  [ + Add a task...            ] │  ← auto-focused input, subtle border
├─────────────────────────────────┤
│  ○  Buy groceries               │
│  ○  Review PR from Thomas       │
│  ○  Prep standup notes          │
│  ─────────────────────────────  │  ← divider before completed
│  ✓  Send invoice to client      │  ← dimmed, strikethrough
└─────────────────────────────────┘
```

### Input field
- Placeholder: `"Add a task…"`
- No button — Enter to submit
- Clean, borderless look (subtle bottom border or light background on focus)

### Task row
- Checkbox: custom, circular, Linear-style (hollow circle → filled checkmark on complete)
- Task text: `14px`, `font-weight: 400`, color `#1a1a1a`
- Completed task text: `color: #9ca3af`, `text-decoration: line-through`
- Hover state: very light gray background `#f9fafb`
- No delete button visible by default — show a faint `×` on row hover

### Menu bar icon
- Simple monochrome icon (a checkbox or checkmark)
- No badge count needed for v1

---

## Data Model

```json
{
  "tasks": [
    {
      "id": "uuid",
      "text": "Buy groceries",
      "completed": false,
      "createdAt": "2026-02-17T09:00:00Z",
      "completedAt": null
    }
  ]
}
```

---

## What's explicitly out of scope (v1)

- Due dates
- Projects / categories
- Keyboard shortcuts (global hotkey)
- Drag to reorder
- Notifications or reminders
- Sync with any external tool
- Multiple windows or views

These can be added later, but the goal of v1 is a working, beautiful, frictionless daily todo. Ship that first.

---

## Definition of done (v1)

- [ ] App appears in macOS menu bar
- [ ] Clicking icon opens/closes the popover
- [ ] Can add a task by typing + Enter
- [ ] Tasks persist across restarts
- [ ] Checking a task marks it complete (visually)
- [ ] On new day open: uncompleted tasks are still visible, completed ones are gone
- [ ] UI matches Linear-style: light, clean, airy
