const { ipcRenderer } = require('electron');
const { toLocalISO, parseAtQuery } = require('./date-parser');

let tasks = [];
let projects = [];
let pendingProjectId = null;
let pendingProjectName = null;
let pendingDeadlineLabel = null;
let activePicker = null;
let activePickerTaskId = null;
let activeDueDatePicker = null;
let activeDueDatePickerTaskId = null;
let dragging = null;
let showCompleted = false;
let editingTaskId = null;
let sortedUncompleted = [];
let currentView = 'focus';
let activeProjectFilter = null;
let activeProjectFilterPicker = null;
let activeDotsMenu = null;
let activeHashPicker = null;
let pendingDeadline = null;
let activeAtPicker = null;

const COLOR_PALETTE = ['#6366f1','#3b82f6','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#a855f7'];

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


function getNextColor() {
  const usedColors = projects.map(p => p.color);
  for (const color of COLOR_PALETTE) {
    if (!usedColors.includes(color)) return color;
  }
  return COLOR_PALETTE[projects.length % COLOR_PALETTE.length];
}

function createProject(name) {
  const project = { id: generateId(), name: name.trim(), color: getNextColor() };
  projects.push(project);
  saveTasks();
  return project;
}

function assignProjectToTask(taskId, projectId) {
  if (taskId === 'pending') {
    pendingProjectId = projectId;
  } else {
    const task = tasks.find(t => t.id === taskId);
    if (task) { task.projectId = projectId; saveTasks(); renderTasks(); }
  }
}

function assignDeadlineToTask(taskId, deadline) {
  const task = tasks.find(t => t.id === taskId);
  if (task) { task.deadline = deadline; saveTasks(); renderTasks(); }
}

// --- Popover positioning ---

function positionPopover(el, anchorRect) {
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  const wr = window.innerWidth;
  const wh = window.innerHeight;
  // Right-align to anchor's right edge, clamped to viewport
  let left = anchorRect.right - pw;
  left = Math.max(8, Math.min(left, wr - pw - 8));
  // Below anchor; flip above if it would overflow the bottom
  let top = anchorRect.bottom + 4;
  if (top + ph > wh - 8) top = anchorRect.top - ph - 4;
  top = Math.max(8, Math.min(top, wh - ph - 8));
  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
}

// --- Hash project picker (# inline syntax) ---

function showHashProjectPicker(inputEl, query) {
  if (activeHashPicker) { activeHashPicker.remove(); activeHashPicker = null; }

  const q = query.toLowerCase();
  const filtered = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
  const exactMatch = projects.some(p => p.name.toLowerCase() === q);

  if (filtered.length === 0 && !(q && !exactMatch)) { hideHashProjectPicker(); return; }

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:#fafaf9;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.1);border:1px solid #e4e4e7;width:200px;z-index:1000;overflow:hidden;padding:4px 0;';
  picker._items = [];

  const setHighlight = (idx) => {
    picker._items.forEach((item, i) => { item.el.style.background = i === idx ? '#f4f4f5' : ''; });
    picker._highlighted = idx;
  };

  const makeOption = (label, color, onClick) => {
    const opt = document.createElement('div');
    opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#3f3f46;';
    const dot = document.createElement('span');
    dot.style.cssText = color
      ? `width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;`
      : 'width:7px;height:7px;border-radius:50%;border:1.5px solid #d4d4d8;flex-shrink:0;display:inline-block;box-sizing:border-box;';
    const text = document.createElement('span');
    text.textContent = label;
    opt.appendChild(dot); opt.appendChild(text);
    opt.addEventListener('mouseover', () => setHighlight(picker._items.findIndex(i => i.el === opt)));
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); onClick(); });
    picker._items.push({ el: opt, action: onClick });
    picker.appendChild(opt);
  };

  filtered.forEach(p => makeOption(p.name, p.color, () => selectHashProject(inputEl, p.id)));

  if (q && !exactMatch) {
    const createOpt = document.createElement('div');
    createOpt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#6366f1;border-top:1px solid #e4e4e7;';
    const plus = document.createElement('span'); plus.textContent = '+'; plus.style.cssText = 'font-weight:bold;font-size:14px;line-height:1;flex-shrink:0;';
    const text = document.createElement('span'); text.textContent = `Create "${query}"`;
    createOpt.appendChild(plus); createOpt.appendChild(text);
    const createAction = () => selectHashProject(inputEl, createProject(query).id);
    createOpt.addEventListener('mouseover', () => setHighlight(picker._items.findIndex(i => i.el === createOpt)));
    createOpt.addEventListener('mousedown', (e) => { e.preventDefault(); createAction(); });
    picker._items.push({ el: createOpt, action: createAction });
    picker.appendChild(createOpt);
  }

  document.body.appendChild(picker);
  activeHashPicker = picker;
  setHighlight(0);

  const rect = inputEl.getBoundingClientRect();
  picker.style.top  = `${rect.bottom + 4}px`;
  picker.style.left = `${rect.left}px`;
}

function selectHashProject(inputEl, projectId) {
  const project = projects.find(p => p.id === projectId);
  if (project) {
    inputEl.value = inputEl.value.replace(/#\S*$/, `#${project.name}`);
    pendingProjectName = project.name;
  }
  pendingProjectId = projectId;
  hideHashProjectPicker();
  inputEl.focus();
  updateMirror();
}

function hideHashProjectPicker() {
  if (activeHashPicker) { activeHashPicker.remove(); activeHashPicker = null; }
}

// --- @ date picker (inline deadline syntax) ---

function showAtDatePicker(inputEl, rawQuery) {
  if (activeAtPicker) { activeAtPicker.remove(); activeAtPicker = null; }
  const suggestions = parseAtQuery(rawQuery);
  if (!suggestions.length) return;

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:#fafaf9;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.10);border:1px solid #e4e4e7;width:220px;z-index:1000;overflow:hidden;padding:4px 0;';
  picker._items = [];

  const setHighlight = (idx) => {
    picker._items.forEach((item, i) => { item.el.style.background = i === idx ? '#f4f4f5' : ''; });
    picker._highlighted = idx;
  };

  suggestions.forEach(({ label, sublabel, iso }) => {
    const opt = document.createElement('div');
    opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;';

    const iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const iconWrap = document.createElement('span');
    iconWrap.innerHTML = iconSvg;
    iconWrap.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size:12px;font-weight:500;color:#09090b;white-space:nowrap;';

    const subEl = document.createElement('span');
    subEl.textContent = sublabel;
    subEl.style.cssText = 'font-size:11px;color:#a1a1aa;white-space:nowrap;';

    opt.appendChild(iconWrap);
    opt.appendChild(labelEl);
    opt.appendChild(subEl);

    const action = () => selectAtDate(inputEl, iso, label);
    opt.addEventListener('mouseover', () => setHighlight(picker._items.findIndex(i => i.el === opt)));
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
    picker._items.push({ el: opt, action });
    picker.appendChild(opt);
  });

  document.body.appendChild(picker);
  activeAtPicker = picker;
  setHighlight(0);

  const rect = inputEl.getBoundingClientRect();
  picker.style.top  = `${rect.bottom + 4}px`;
  picker.style.left = `${rect.left}px`;
}

function selectAtDate(inputEl, iso, label) {
  inputEl.value = inputEl.value.replace(/@[a-zA-Z0-9 ]*$/, `@${label || iso}`);
  pendingDeadline = iso;
  pendingDeadlineLabel = label || iso;
  hideAtDatePicker();
  inputEl.focus();
  updateMirror();
}

function hideAtDatePicker() {
  if (activeAtPicker) { activeAtPicker.remove(); activeAtPicker = null; }
}

// --- Project picker (for existing tasks) ---

function renderPickerOptions(container, query) {
  container.innerHTML = '';
  const q = query.toLowerCase().trim();
  const filtered = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
  const exactMatch = projects.some(p => p.name.toLowerCase() === q);

  const makeOption = (label, color, onClick) => {
    const opt = document.createElement('div');
    opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#3f3f46;';
    const dot = document.createElement('span');
    if (color) {
      dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;`;
    } else {
      dot.style.cssText = 'width:7px;height:7px;border-radius:50%;border:1.5px solid #d4d4d8;flex-shrink:0;display:inline-block;box-sizing:border-box;';
    }
    opt.appendChild(dot);
    const text = document.createElement('span');
    text.textContent = label;
    opt.appendChild(text);
    opt.addEventListener('mouseover', () => { opt.style.background = '#f4f4f5'; });
    opt.addEventListener('mouseout',  () => { opt.style.background = ''; });
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); onClick(); });
    container.appendChild(opt);
  };

  const activeTask = tasks.find(t => t.id === activePickerTaskId);
  if (activeTask && activeTask.projectId) {
    makeOption('None', null, () => { assignProjectToTask(activePickerTaskId, null); hideProjectPicker(); });
  }
  filtered.forEach(p => {
    makeOption(p.name, p.color, () => { assignProjectToTask(activePickerTaskId, p.id); hideProjectPicker(); });
  });

  if (q && !exactMatch) {
    const createOpt = document.createElement('div');
    createOpt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#6366f1;border-top:1px solid #e4e4e7;';
    const plus = document.createElement('span');
    plus.textContent = '+';
    plus.style.cssText = 'font-weight:bold;flex-shrink:0;font-size:14px;line-height:1;';
    createOpt.appendChild(plus);
    const text = document.createElement('span');
    text.textContent = `Create "${query}"`;
    createOpt.appendChild(text);
    createOpt.addEventListener('mouseover', () => { createOpt.style.background = '#f4f4f5'; });
    createOpt.addEventListener('mouseout',  () => { createOpt.style.background = ''; });
    createOpt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const project = createProject(query);
      assignProjectToTask(activePickerTaskId, project.id);
      hideProjectPicker();
    });
    container.appendChild(createOpt);
  }
}

function showProjectPicker(anchorEl, taskId) {
  hideProjectPicker(); hideDeadlinePicker();
  activePickerTaskId = taskId;

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:#fafaf9;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.1);border:1px solid #e4e4e7;width:200px;z-index:1000;overflow:hidden;';
  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.placeholder = 'Find or create…';
  inputEl.style.cssText = 'width:100%;padding:7px 12px;border:none;border-bottom:1px solid #e4e4e7;font-size:12px;outline:none;box-sizing:border-box;background:transparent;color:#09090b;';
  const optionsList = document.createElement('div');
  optionsList.style.cssText = 'max-height:160px;overflow-y:auto;';
  picker.appendChild(inputEl);
  picker.appendChild(optionsList);
  document.body.appendChild(picker);
  activePicker = picker;
  positionPopover(picker, anchorEl.getBoundingClientRect());

  renderPickerOptions(optionsList, '');
  inputEl.addEventListener('input', () => renderPickerOptions(optionsList, inputEl.value));
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectPicker(); });
  inputEl.addEventListener('blur', () => setTimeout(hideProjectPicker, 100));
  setTimeout(() => inputEl.focus(), 0);
}

function hideProjectPicker() {
  if (activePicker) { activePicker.remove(); activePicker = null; activePickerTaskId = null; }
}

// --- Deadline picker ---

function showDeadlinePicker(anchorEl, taskId) {
  hideDeadlinePicker(); hideProjectPicker();
  activeDueDatePickerTaskId = taskId;

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:#fafaf9;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.1);border:1px solid #e4e4e7;width:160px;z-index:1000;overflow:hidden;padding:4px 0;';

  const today    = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);

  const makeOption = (label, value) => {
    const opt = document.createElement('div');
    opt.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;color:#3f3f46;';
    opt.textContent = label;
    opt.addEventListener('mouseover', () => { opt.style.background = '#f4f4f5'; });
    opt.addEventListener('mouseout',  () => { opt.style.background = ''; });
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      assignDeadlineToTask(activeDueDatePickerTaskId, value);
      hideDeadlinePicker();
    });
    picker.appendChild(opt);
  };

  const currentTaskForPicker = tasks.find(t => t.id === activeDueDatePickerTaskId);
  if (currentTaskForPicker && currentTaskForPicker.deadline) {
    makeOption('No deadline', null);
  }
  makeOption('Today',     toLocalISO(today));
  makeOption('Tomorrow',  toLocalISO(tomorrow));
  makeOption('In a week', toLocalISO(nextWeek));

  const divider = document.createElement('div');
  divider.style.cssText = 'border-top:1px solid #e4e4e7;margin:4px 0;';
  picker.appendChild(divider);

  const dateRow = document.createElement('div');
  dateRow.style.cssText = 'padding:4px 12px 8px;';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.style.cssText = 'width:100%;font-size:12px;border:1px solid #e4e4e7;border-radius:4px;padding:4px 6px;outline:none;box-sizing:border-box;color:#3f3f46;background:#fff;';
  const currentTask = tasks.find(t => t.id === taskId);
  if (currentTask && currentTask.deadline) dateInput.value = currentTask.deadline;
  dateInput.addEventListener('change', (e) => {
    if (e.target.value) { assignDeadlineToTask(activeDueDatePickerTaskId, e.target.value); hideDeadlinePicker(); }
  });
  dateRow.appendChild(dateInput);
  picker.appendChild(dateRow);

  document.body.appendChild(picker);
  activeDueDatePicker = picker;
  positionPopover(picker, anchorEl.getBoundingClientRect());

  const onOutsideClick = (e) => { if (!picker.contains(e.target)) hideDeadlinePicker(); };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
  picker._onOutsideClick = onOutsideClick;
}

function hideDeadlinePicker() {
  if (activeDueDatePicker) {
    if (activeDueDatePicker._onOutsideClick) document.removeEventListener('mousedown', activeDueDatePicker._onOutsideClick);
    activeDueDatePicker.remove();
    activeDueDatePicker = null;
    activeDueDatePickerTaskId = null;
  }
}

// --- Data ---

async function loadTasks() {
  const data = await ipcRenderer.invoke('load-tasks');
  tasks = data.tasks || [];
  projects = data.projects || [];
  renderTasks();
}

async function saveTasks() {
  await ipcRenderer.invoke('save-tasks', { tasks, projects });
}

function updateBadge() {
  ipcRenderer.invoke('update-badge', tasks.filter(t => !t.completed && t.bucket === 'today').length);
}

function addTask(text) {
  let title = text;
  if (pendingProjectName) title = title.replace(`#${pendingProjectName}`, '');
  if (pendingDeadlineLabel) title = title.replace(`@${pendingDeadlineLabel}`, '');
  title = title.replace(/\s+/g, ' ').trim();

  const bucket = currentView === 'focus' ? 'today' : 'anytime';
  tasks.push({
    id: generateId(),
    title,
    bucket,
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    projectId: pendingProjectId || null,
    deadline: pendingDeadline || null,
  });
  pendingProjectId = null;
  pendingProjectName = null;
  pendingDeadline = null;
  pendingDeadlineLabel = null;
  saveTasks();
  renderTasks();
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    saveTasks();
    renderTasks();
  }
}

function updateTaskText(id, newText) {
  const trimmed = newText.trim();
  if (!trimmed) { editingTaskId = null; renderTasks(); return; }
  const task = tasks.find(t => t.id === id);
  if (task) task.title = trimmed;
  editingTaskId = null;
  saveTasks();
  renderTasks();
  updateBadge();
}

let pendingDelete = null;

function commitPendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  saveTasks();
  const toast = document.getElementById('delete-toast');
  if (toast) toast.remove();
  pendingDelete = null;
}

function deleteTask(id) {
  commitPendingDelete();

  const index = tasks.findIndex(t => t.id === id);
  const task = tasks[index];
  tasks = tasks.filter(t => t.id !== id);
  renderTasks();

  const toast = document.createElement('div');
  toast.id = 'delete-toast';
  toast.style.cssText = [
    'position:fixed', 'bottom:12px', 'left:12px', 'right:12px',
    'background:#18181b', 'color:#fafafa',
    'border-radius:8px', 'padding:0 12px',
    'height:36px', 'display:flex', 'align-items:center', 'justify-content:space-between',
    'font-size:12px', 'font-weight:500',
    'box-shadow:0 4px 12px rgba(0,0,0,0.25)',
    'z-index:9999',
    'opacity:0', 'transition:opacity 120ms ease',
  ].join(';');
  toast.innerHTML = `
    <span style="color:#a1a1aa;">Task deleted</span>
    <button id="undo-delete" style="background:none;border:none;cursor:pointer;color:#fafafa;font-size:12px;font-weight:600;padding:0;">Undo</button>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  const timer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.remove(); }, 120);
    saveTasks();
    pendingDelete = null;
  }, 4000);

  pendingDelete = { task, index, timer };

  document.getElementById('undo-delete').addEventListener('click', () => {
    clearTimeout(pendingDelete.timer);
    tasks.splice(index, 0, task);
    pendingDelete = null;
    toast.style.opacity = '0';
    setTimeout(() => { toast.remove(); }, 120);
    renderTasks();
  });
}

function moveToToday(id) {
  const task = tasks.find(t => t.id === id);
  if (task) { task.bucket = 'today'; saveTasks(); renderTasks(); }
}

function moveToAnytime(id) {
  const task = tasks.find(t => t.id === id);
  if (task) { task.bucket = 'anytime'; saveTasks(); renderTasks(); }
}

function moveToTop(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const rest = tasks.filter(t => t.id !== id);
  const firstSame = rest.findIndex(t => !t.completed && t.bucket === task.bucket);
  rest.splice(firstSame === -1 ? 0 : firstSame, 0, task);
  tasks = rest;
  saveTasks(); renderTasks();
}

function moveToBottom(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const rest = tasks.filter(t => t.id !== id);
  let lastSame = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (!rest[i].completed && rest[i].bucket === task.bucket) { lastSame = i; break; }
  }
  rest.splice(lastSame === -1 ? rest.length : lastSame + 1, 0, task);
  tasks = rest;
  saveTasks(); renderTasks();
}

// --- Navigation ---

function switchView(view) {
  currentView = view;
  renderTasks();
  updateNav();
  updateInputPlaceholder();
  document.getElementById('task-input')?.focus();
}

function updateNav() {
  const todayBtn   = document.getElementById('nav-today');
  const anytimeBtn = document.getElementById('nav-anytime');
  if (!todayBtn || !anytimeBtn) return;
  if (currentView === 'focus') {
    todayBtn.classList.add('nav-active');
    anytimeBtn.classList.remove('nav-active');
  } else {
    todayBtn.classList.remove('nav-active');
    anytimeBtn.classList.add('nav-active');
  }
}

function updateInputPlaceholder() {
  const input = document.getElementById('task-input');
  if (input) input.placeholder = currentView === 'focus'
    ? 'Add to today… · @date · #label'
    : 'Add to anytime… · @date · #label';
}

// --- Format helpers ---

function formatDeadline(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = deadline.split('-').map(Number);
  const due = new Date(year, month - 1, day);
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) {
    const abs = Math.abs(diff);
    const label = abs === 1 ? 'Yesterday'
      : abs <= 6  ? `${abs} days ago`
      : 'Overdue';
    return { label, urgency: 'overdue' };
  }
  if (diff === 0) return { label: 'Today',    urgency: 'soon' };
  if (diff === 1) return { label: 'Tomorrow', urgency: 'soon' };
  if (diff <= 6)  return { label: `In ${diff} days`, urgency: 'soon' };
  return null;
}

// --- Section header ---

function renderSectionHeader(label, accent = false) {
  return `<div class="section-label${accent ? ' accent' : ''}">${escapeHtml(label)}</div>`;
}

// --- Render ---

function renderTasks() {
  const container = document.getElementById('task-list');
  const historyFooter = document.getElementById('history-footer-btn');
  if (currentView === 'focus') {
    renderFocusView(container);
    if (historyFooter) historyFooter.style.display = '';
  } else {
    renderAnytimeView(container);
    if (historyFooter) historyFooter.style.display = 'none';
  }
  updateBadge();
}

function renderFocusView(container) {
  const todayISO = toLocalISO(new Date());
  const todayActive = tasks.filter(t => !t.completed && t.bucket === 'today');
  sortedUncompleted = todayActive;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const completedToday = tasks
    .filter(t => {
      if (!t.completed || !t.completedAt) return false;
      const d = new Date(t.completedAt); d.setHours(0,0,0,0);
      return d.getTime() === todayStart.getTime();
    })
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const nudges = tasks.filter(t => !t.completed && t.bucket === 'anytime' && t.deadline === todayISO);

  let html = '';

  nudges.forEach(t => {
    html += `
      <div class="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-100">
        <span style="font-size:12px;color:#92400e;flex:1;min-width:0;" class="truncate"><span style="font-weight:500;">${escapeHtml(t.title)}</span> deadline is today</span>
        <button class="nudge-add-btn" style="font-size:11px;font-weight:500;color:#92400e;background:#fde68a;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;white-space:nowrap;" data-id="${t.id}">+ Focus</button>
      </div>
    `;
  });

  if (todayActive.length === 0) {
    html += `
      <div class="flex flex-col items-center justify-center py-8 px-4 text-center">
        <div style="font-size:16px;color:#6366f1;margin-bottom:6px;">✓</div>
        <div style="font-size:13px;font-weight:500;color:#09090b;margin-bottom:3px;">Focus cleared</div>
        <div style="font-size:12px;color:#71717a;">Nothing left for today</div>
      </div>
    `;
  } else {
    todayActive.forEach((t, i) => {
      const pos = todayActive.length === 1 ? 'only'
        : i === 0 ? 'first'
        : i === todayActive.length - 1 ? 'last'
        : 'middle';
      html += renderTaskRow(t, true, pos);
    });
  }

  if (completedToday.length > 0) {
    html += `<button id="completed-toggle" class="completed-toggle">
      <svg style="width:10px;height:10px;flex-shrink:0;color:#a1a1aa;transform:${showCompleted ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform 100ms;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
      </svg>
      ${completedToday.length} done today
    </button>`;
    if (showCompleted) {
      completedToday.forEach(t => { html += renderTaskRow(t, false); });
    }
  }

  container.innerHTML = html;

  container.querySelectorAll('.nudge-add-btn').forEach(btn => {
    btn.addEventListener('click', () => moveToToday(btn.dataset.id));
  });
  const completedToggle = container.querySelector('#completed-toggle');
  if (completedToggle) completedToggle.addEventListener('click', () => { showCompleted = !showCompleted; renderTasks(); });

  attachTaskListeners(container);
}

function showProjectFilterPicker(anchorEl) {
  if (activeProjectFilterPicker) { activeProjectFilterPicker.remove(); activeProjectFilterPicker = null; }

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:#fafaf9;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.1);border:1px solid #e4e4e7;width:180px;z-index:1000;overflow:hidden;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search…';
  searchInput.style.cssText = 'width:100%;padding:7px 12px;border:none;border-bottom:1px solid #e4e4e7;font-size:12px;outline:none;box-sizing:border-box;background:transparent;color:#09090b;';

  const list = document.createElement('div');
  list.style.cssText = 'max-height:160px;overflow-y:auto;padding:4px 0;';

  const anchorRect = anchorEl.getBoundingClientRect();

  function renderOptions(q) {
    list.innerHTML = '';
    const lq = q.toLowerCase();
    const filtered = lq ? projects.filter(p => p.name.toLowerCase().includes(lq)) : projects;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:6px 12px;font-size:12px;color:#a1a1aa;';
      empty.textContent = 'No labels';
      list.appendChild(empty);
      return;
    }

    filtered.forEach(p => {
      const isActive = activeProjectFilter === p.id;
      const opt = document.createElement('div');
      opt.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#3f3f46;${isActive ? 'background:#f4f4f5;' : ''}`;
      opt.innerHTML = `
        <span style="width:7px;height:7px;border-radius:50%;background:${p.color};flex-shrink:0;display:inline-block;"></span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span>
        ${isActive ? `<svg width="10" height="10" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>` : ''}
      `;
      opt.addEventListener('mouseover', () => { opt.style.background = '#f4f4f5'; });
      opt.addEventListener('mouseout',  () => { opt.style.background = isActive ? '#f4f4f5' : ''; });
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeProjectFilter = isActive ? null : p.id;
        picker.remove(); activeProjectFilterPicker = null;
        renderTasks();
      });
      list.appendChild(opt);
    });

    positionPopover(picker, anchorRect);
  }

  renderOptions('');
  searchInput.addEventListener('input', () => renderOptions(searchInput.value));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { picker.remove(); activeProjectFilterPicker = null; } });

  picker.appendChild(searchInput);
  picker.appendChild(list);
  document.body.appendChild(picker);
  activeProjectFilterPicker = picker;

  positionPopover(picker, anchorRect);

  const onOutside = (e) => {
    if (!picker.contains(e.target)) { picker.remove(); activeProjectFilterPicker = null; document.removeEventListener('mousedown', onOutside); }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  setTimeout(() => searchInput.focus(), 0);
}

function renderAnytimeView(container) {
  const anytimeActive = tasks.filter(t => !t.completed && t.bucket === 'anytime');
  sortedUncompleted = anytimeActive;

  const filterFn = activeProjectFilter ? t => t.projectId === activeProjectFilter : () => true;
  const filtered  = anytimeActive.filter(filterFn);

  let html = '';

  if (projects.length > 0) {
    const activeProj = activeProjectFilter ? projects.find(p => p.id === activeProjectFilter) : null;
    const filterColor = activeProj ? activeProj.color : '#c4c4c7';
    html += `<div style="padding:4px 14px 5px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:flex-end;gap:4px;">
      ${activeProj ? `<button id="project-filter-clear" style="background:none;border:none;cursor:pointer;color:#c4c4c7;font-size:13px;line-height:1;padding:2px;" title="Clear filter">×</button>` : ''}
      <button id="project-filter-btn" class="icon-btn" style="color:${filterColor};" title="Filter by label">
        <i class="ph ph-funnel" style="font-size:15px;"></i>
      </button>
    </div>`;
  }

  if (filtered.length > 0) {
    filtered.forEach(t => { html += renderTaskRow(t, true); });
  } else if (anytimeActive.length === 0) {
    html += `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;text-align:center;">
      <div style="font-size:13px;font-weight:500;color:#09090b;margin-bottom:4px;">Anytime is empty</div>
      <div style="font-size:12px;color:#71717a;">Add tasks here to plan for later</div>
    </div>`;
  } else {
    html += `<div style="padding:12px 14px;font-size:12px;color:#71717a;">No matching tasks</div>`;
  }

  container.innerHTML = html;

  document.getElementById('project-filter-btn')?.addEventListener('click', (e) => {
    showProjectFilterPicker(e.currentTarget);
  });
  document.getElementById('project-filter-clear')?.addEventListener('click', () => {
    activeProjectFilter = null;
    renderTasks();
  });

  attachTaskListeners(container);
}

function attachTaskListeners(container) {
  container.querySelectorAll('.task-checkbox').forEach(cb => {
    cb.addEventListener('click', () => toggleTask(cb.dataset.id));
  });
  container.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(btn.dataset.id); });
  });
  container.querySelectorAll('.bucket-today-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); moveToToday(btn.dataset.id); });
  });
  container.querySelectorAll('.top-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); moveToTop(btn.dataset.id); });
  });
  container.querySelectorAll('.bottom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); moveToBottom(btn.dataset.id); });
  });
  container.querySelectorAll('.project-pill').forEach(pill => {
    pill.addEventListener('click', (e) => { e.stopPropagation(); showProjectPicker(pill, pill.dataset.taskId); });
  });
  container.querySelectorAll('.deadline-pill').forEach(pill => {
    pill.addEventListener('click', (e) => { e.stopPropagation(); showDeadlinePicker(pill, pill.dataset.taskId); });
  });
  container.querySelectorAll('.dots-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showDotsMenu(btn, btn.dataset.id); });
  });
  container.querySelectorAll('.task-row[data-id]').forEach(row => {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const taskId = row.dataset.id;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const bucketTasks = sortedUncompleted.filter(t => t.bucket === task.bucket);
      const taskIndex = bucketTasks.findIndex(t => t.id === taskId);
      ipcRenderer.invoke('show-context-menu', taskId, {
        isFirst:     taskIndex === 0,
        isLast:      taskIndex === bucketTasks.length - 1,
        bucket:      task.bucket,
        hasProject:  !!task.projectId,
        hasDeadline: !!task.deadline,
        completed:   task.completed,
      });
    });
  });
  container.querySelectorAll('[data-clickable-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      editingTaskId = el.dataset.clickableId;
      renderTasks();
      const inp = container.querySelector('[data-edit-id]');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
  });
  const editInput = container.querySelector('[data-edit-id]');
  if (editInput) {
    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  updateTaskText(editInput.dataset.editId, editInput.value);
      if (e.key === 'Escape') { editingTaskId = null; renderTasks(); }
    });
    editInput.addEventListener('blur', () => updateTaskText(editInput.dataset.editId, editInput.value));
  }
  container.querySelectorAll('.task-row[data-draggable]').forEach(row => {
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-no-drag]')) return;

      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (mv) => {
        if (Math.sqrt((mv.clientX - startX) ** 2 + (mv.clientY - startY) ** 2) > 4) {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          startDrag(e, row);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function clearDropIndicators() {
  document.querySelectorAll('.task-row').forEach(r => { r.style.boxShadow = ''; });
}

function startDrag(e, row) {
  const rect = row.getBoundingClientRect();
  const clone = row.cloneNode(true);
  clone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;pointer-events:none;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.10),0 2px 6px rgba(0,0,0,0.06);border-radius:6px;background:#fff;opacity:0.97;`;
  document.body.appendChild(clone);
  row.style.opacity = '0.3';
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  dragging = { id: row.dataset.id, row, clone, offsetY: e.clientY - rect.top, currentTarget: null };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  window.addEventListener('blur', cancelDrag);
}

function onDragMove(e) {
  if (!dragging) return;
  dragging.clone.style.top = `${e.clientY - dragging.offsetY}px`;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const targetRow = el?.closest('.task-row[data-id]');
  clearDropIndicators();
  if (targetRow && targetRow !== dragging.row) {
    const r = targetRow.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    targetRow.style.boxShadow = before ? 'inset 0 2px 0 0 #818cf8' : 'inset 0 -2px 0 0 #818cf8';
    dragging.currentTarget = { row: targetRow, before };
  } else {
    dragging.currentTarget = null;
  }
}

function onDragEnd() {
  if (!dragging) return;
  finalizeDrag(dragging.currentTarget);
}

function cancelDrag() {
  if (!dragging) return;
  finalizeDrag(null);
}

function finalizeDrag(currentTarget) {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  window.removeEventListener('blur', cancelDrag);
  const { id, row, clone } = dragging;
  dragging = null;
  clone.remove();
  row.style.opacity = '';
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  clearDropIndicators();
  if (!currentTarget) return;
  const fromIdx = sortedUncompleted.findIndex(t => t.id === id);
  if (fromIdx === -1) return;
  const [moved] = sortedUncompleted.splice(fromIdx, 1);
  const toIdx = sortedUncompleted.findIndex(t => t.id === currentTarget.row.dataset.id);
  if (toIdx === -1) { sortedUncompleted.splice(fromIdx, 0, moved); return; }
  sortedUncompleted.splice(currentTarget.before ? toIdx : toIdx + 1, 0, moved);
  const renderedIds = new Set(sortedUncompleted.map(t => t.id));
  tasks = [...sortedUncompleted, ...tasks.filter(t => !renderedIds.has(t.id))];
  saveTasks();
  renderTasks();
}

// --- Dots (···) menu ---

function showDotsMenu(anchorEl, taskId) {
  if (activeDotsMenu) { activeDotsMenu.remove(); activeDotsMenu = null; }
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;background:#fafaf9;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);border:1px solid #e4e4e7;width:176px;z-index:1000;overflow:hidden;';

  const anchorRect = anchorEl.getBoundingClientRect();

  function reposition() {
    positionPopover(menu, anchorRect);
  }

  function makeRow(label, onClick, hasChevron = false) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 12px;cursor:pointer;font-size:12px;color:#3f3f46;';
    const span = document.createElement('span');
    span.textContent = label;
    item.appendChild(span);
    if (hasChevron) {
      const ch = document.createElement('span');
      ch.textContent = '›';
      ch.style.cssText = 'color:#a1a1aa;font-size:15px;line-height:1;';
      item.appendChild(ch);
    }
    item.addEventListener('mouseover', () => { item.style.background = '#f4f4f5'; });
    item.addEventListener('mouseout',  () => { item.style.background = ''; });
    item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return item;
  }

  function makeSep() {
    const d = document.createElement('div');
    d.style.cssText = 'border-top:1px solid #e4e4e7;margin:4px 0;';
    return d;
  }

  function makeBack(onClick) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:6px 10px;cursor:pointer;font-size:11.5px;color:#a1a1aa;border-bottom:1px solid #e4e4e7;';
    row.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg><span>Back</span>`;
    row.addEventListener('mouseover', () => { row.style.background = '#f4f4f5'; });
    row.addEventListener('mouseout',  () => { row.style.background = ''; });
    row.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return row;
  }

  function showMain() {
    menu.innerHTML = '';
    menu.style.padding = '4px 0';
    menu.appendChild(makeRow('Move to Anytime', () => { hideDotsMenu(); moveToAnytime(taskId); }));
    menu.appendChild(makeSep());
    menu.appendChild(makeRow(task.projectId ? 'Change label' : 'Add label', showLabelPanel, true));
    menu.appendChild(makeRow(task.deadline ? 'Change deadline' : 'Set deadline', showDatePanel, true));
    reposition();
  }

  function showLabelPanel() {
    menu.innerHTML = '';
    menu.style.padding = '0';
    menu.appendChild(makeBack(showMain));

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Find or create…';
    searchInput.style.cssText = 'width:100%;padding:7px 12px;border:none;border-bottom:1px solid #e4e4e7;font-size:12px;outline:none;box-sizing:border-box;background:transparent;color:#09090b;';

    const list = document.createElement('div');
    list.style.cssText = 'max-height:140px;overflow-y:auto;padding:4px 0;';

    function renderOptions(q) {
      list.innerHTML = '';
      const lq = q.toLowerCase().trim();
      const filtered = lq ? projects.filter(p => p.name.toLowerCase().includes(lq)) : projects;
      const exactMatch = projects.some(p => p.name.toLowerCase() === lq);

      const makeOpt = (label, color, onClick) => {
        const opt = document.createElement('div');
        opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;font-size:12px;color:#3f3f46;';
        const dot = document.createElement('span');
        dot.style.cssText = color
          ? `width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;`
          : 'width:7px;height:7px;border-radius:50%;border:1.5px solid #d4d4d8;flex-shrink:0;display:inline-block;box-sizing:border-box;';
        const txt = document.createElement('span'); txt.textContent = label;
        opt.appendChild(dot); opt.appendChild(txt);
        opt.addEventListener('mouseover', () => { opt.style.background = '#f4f4f5'; });
        opt.addEventListener('mouseout',  () => { opt.style.background = ''; });
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        list.appendChild(opt);
      };

      if (task.projectId) makeOpt('None', null, () => { assignProjectToTask(taskId, null); hideDotsMenu(); });
      filtered.forEach(p => makeOpt(p.name, p.color, () => { assignProjectToTask(taskId, p.id); hideDotsMenu(); }));

      if (lq && !exactMatch) {
        const createOpt = document.createElement('div');
        createOpt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;font-size:12px;color:#6366f1;border-top:1px solid #e4e4e7;margin-top:2px;';
        createOpt.innerHTML = `<span style="font-weight:bold;font-size:14px;line-height:1;flex-shrink:0;">+</span><span>Create "${q}"</span>`;
        createOpt.addEventListener('mouseover', () => { createOpt.style.background = '#f4f4f5'; });
        createOpt.addEventListener('mouseout',  () => { createOpt.style.background = ''; });
        createOpt.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); assignProjectToTask(taskId, createProject(q).id); hideDotsMenu(); });
        list.appendChild(createOpt);
      }
    }

    renderOptions('');
    searchInput.addEventListener('input', () => { renderOptions(searchInput.value); reposition(); });
    menu.appendChild(searchInput);
    menu.appendChild(list);
    reposition();
    setTimeout(() => searchInput.focus(), 0);
  }

  function showDatePanel() {
    menu.innerHTML = '';
    menu.style.padding = '0';
    menu.appendChild(makeBack(showMain));

    const wrap = document.createElement('div');
    wrap.style.padding = '4px 0';

    const today    = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);

    const makeOpt = (label, value) => {
      const opt = document.createElement('div');
      opt.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;color:#3f3f46;';
      opt.textContent = label;
      opt.addEventListener('mouseover', () => { opt.style.background = '#f4f4f5'; });
      opt.addEventListener('mouseout',  () => { opt.style.background = ''; });
      opt.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); assignDeadlineToTask(taskId, value); hideDotsMenu(); });
      wrap.appendChild(opt);
    };

    if (task.deadline) makeOpt('No deadline', null);
    makeOpt('Today',     toLocalISO(today));
    makeOpt('Tomorrow',  toLocalISO(tomorrow));
    makeOpt('In a week', toLocalISO(nextWeek));

    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px solid #e4e4e7;margin:4px 0;';
    wrap.appendChild(divider);

    const dateRow = document.createElement('div');
    dateRow.style.cssText = 'padding:4px 12px 8px;';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.style.cssText = 'width:100%;font-size:12px;border:1px solid #e4e4e7;border-radius:4px;padding:4px 6px;outline:none;box-sizing:border-box;color:#3f3f46;background:#fff;';
    if (task.deadline) dateInput.value = task.deadline;
    dateInput.addEventListener('change', (e) => {
      if (e.target.value) { assignDeadlineToTask(taskId, e.target.value); hideDotsMenu(); }
    });
    dateRow.appendChild(dateInput);
    wrap.appendChild(dateRow);
    menu.appendChild(wrap);
    reposition();
  }

  showMain();
  document.body.appendChild(menu);
  activeDotsMenu = menu;
  reposition();

  const onOutside = (e) => { if (!menu.contains(e.target)) hideDotsMenu(); };
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  menu._onOutside = onOutside;
}

function hideDotsMenu() {
  if (activeDotsMenu) {
    if (activeDotsMenu._onOutside) document.removeEventListener('mousedown', activeDotsMenu._onOutside);
    activeDotsMenu.remove();
    activeDotsMenu = null;
  }
}

// --- Task row ---

function renderTaskRow(task, draggable = false, position = 'middle') {
  const isEditing   = !task.completed && editingTaskId === task.id;
  const isDraggable = draggable && !task.completed;

  const checkboxClass = task.completed ? 'checkbox checked' : 'checkbox';

  let textEl;
  if (isEditing) {
    textEl = `<input class="task-text-edit" data-edit-id="${task.id}" data-no-drag value="${escapeHtml(task.title)}" />`;
  } else if (task.completed) {
    textEl = `<span class="task-title-completed" data-no-drag>${escapeHtml(task.title)}</span>`;
  } else {
    textEl = `<span class="task-text-wrap"><span class="task-text" data-clickable-id="${task.id}" data-no-drag>${escapeHtml(task.title)}</span></span>`;
  }

  // Meta chips — right-anchored, fade on hover (CSS handles it)
  let deadlineChip = '';
  if (!task.completed && task.deadline) {
    const fmt = formatDeadline(task.deadline);
    if (fmt) {
      deadlineChip = `<button class="deadline-chip ${fmt.urgency} deadline-pill" data-task-id="${task.id}" data-no-drag>${escapeHtml(fmt.label)}</button>`;
    }
  }
  let labelChip = '';
  if (!task.completed && task.projectId) {
    const project = projects.find(p => p.id === task.projectId);
    if (project) {
      labelChip = `<button class="label-chip project-pill" data-task-id="${task.id}" data-no-drag
        style="color:${project.color};background:${project.color}14;border-color:${project.color}28;"
        >${escapeHtml(project.name)}</button>`;
    }
  }
  const metaChips = `<div class="task-meta" data-no-drag>${deadlineChip}${labelChip}</div>`;

  // Action tray — context-sensitive per bucket and position
  let actionTray = '';
  if (task.completed) {
    actionTray = `
      <div class="task-tray" data-no-drag>
        <button class="tray-icon del task-delete" data-id="${task.id}" title="Delete">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
  } else if (task.bucket === 'today') {
    const showTop    = position !== 'first' && position !== 'only';
    const showBottom = position !== 'last'  && position !== 'only';
    const reorderBtns = (showTop || showBottom) ? `
      ${showTop ? `<button class="tray-icon quiet top-btn" data-id="${task.id}" title="Move to top">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 3h14"/><path d="M12 21V7M5 14l7-7 7 7"/></svg>
      </button>` : ''}
      ${showBottom ? `<button class="tray-icon quiet bottom-btn" data-id="${task.id}" title="Move to bottom">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 21h14"/><path d="M12 3v14M5 10l7 7 7-7"/></svg>
      </button>` : ''}
      <div class="tray-div"></div>` : '';
    actionTray = `
      <div class="task-tray" data-no-drag>
        ${reorderBtns}
        <button class="tray-icon quiet dots-btn" data-id="${task.id}" title="More">
          <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
        </button>
        <button class="tray-icon del task-delete" data-id="${task.id}" title="Delete">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
  } else {
    actionTray = `
      <div class="task-tray" data-no-drag>
        <button class="move-pill bucket-today-btn" data-id="${task.id}">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>Today
        </button>
        <button class="tray-icon del task-delete" data-id="${task.id}" title="Delete">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
  }

  return `
    <div class="task-row" data-id="${task.id}"${isDraggable ? ' data-draggable' : ''}>
      <div class="task-checkbox ${checkboxClass}" data-id="${task.id}" data-no-drag>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      ${textEl}
      ${metaChips}
      ${actionTray}
    </div>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Token mirror ---

function updateMirror() {
  const mirror = document.getElementById('input-mirror');
  const input  = document.getElementById('task-input');
  if (!mirror || !input) return;
  let html = escapeHtml(input.value);
  if (pendingDeadlineLabel) {
    const escaped = escapeHtml(`@${pendingDeadlineLabel}`);
    html = html.split(escaped).join(`<span class="token-date">${escaped}</span>`);
  }
  if (pendingProjectName) {
    const proj    = projects.find(p => p.name === pendingProjectName);
    const color   = proj ? proj.color : '#6366f1';
    const escaped = escapeHtml(`#${pendingProjectName}`);
    html = html.split(escaped).join(`<span class="token-label" style="color:${color};background:${color}14;">${escaped}</span>`);
  }
  mirror.innerHTML = html;
}

// --- History panel ---

function showHistoryPanel() {
  if (document.getElementById('history-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'history-panel';
  panel.style.cssText = 'position:absolute;inset:0;background:#fafaf9;z-index:100;display:flex;flex-direction:column;opacity:0;transition:opacity 120ms ease;';

  const groups = {};
  tasks.filter(t => t.completed && t.completedAt).forEach(t => {
    const d = new Date(t.completedAt); d.setHours(0,0,0,0);
    const key = d.toISOString();
    if (!groups[key]) groups[key] = { date: d, tasks: [] };
    groups[key].tasks.push(t);
  });
  const sortedKeys = Object.keys(groups).sort((a,b) => new Date(b) - new Date(a));
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  function dayLabel(d) {
    if (d.getTime() === today.getTime())     return 'Today';
    if (d.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
  }
  let bodyHtml = sortedKeys.length === 0
    ? `<div style="padding:24px 14px;font-size:13px;color:#a1a1aa;text-align:center;">No completed tasks yet</div>`
    : sortedKeys.map(key => {
        const g = groups[key];
        const sorted = g.tasks.sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
        return `<div style="padding:8px 0 4px;">
          <div style="padding:0 14px 5px;font-size:10px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(dayLabel(g.date))} · ${g.tasks.length}</div>
          ${sorted.map(t => `<div style="display:flex;align-items:center;gap:9px;padding:5px 14px;border-top:1px solid #f4f4f5;">
            <div style="width:15px;height:15px;border-radius:4px;flex-shrink:0;background:#6366f1;display:flex;align-items:center;justify-content:center;">
              <svg width="9" height="9" fill="none" stroke="white" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"/></svg>
            </div>
            <span style="flex:1;min-width:0;font-size:12.5px;color:#a1a1aa;text-decoration:line-through;text-decoration-color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title)}</span>
          </div>`).join('')}
        </div>`;
      }).join('');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;padding:9px 14px;border-bottom:1px solid #e4e4e7;">
      <button id="history-back" style="background:none;border:none;cursor:pointer;padding:0;color:#a1a1aa;display:flex;align-items:center;">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span style="font-size:13px;font-weight:600;color:#09090b;letter-spacing:-0.01em;">History</span>
    </div>
    <div style="flex:1;overflow-y:auto;">${bodyHtml}</div>`;

  const appEl = document.getElementById('app');
  appEl.style.position = 'relative';
  appEl.appendChild(panel);
  requestAnimationFrame(() => { panel.style.opacity = '1'; });
  panel.querySelector('#history-back').addEventListener('click', () => {
    panel.style.opacity = '0';
    setTimeout(() => { panel.remove(); }, 120);
  });
}

// --- Settings panel ---

function showSettings() {
  if (document.getElementById('settings-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.style.cssText = [
    'position:absolute', 'inset:0', 'background:#fff', 'z-index:100',
    'display:flex', 'flex-direction:column',
    'opacity:0', 'transition:opacity 120ms ease',
  ].join(';');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid #e4e4e7;">
      <button id="settings-back" style="background:none;border:none;cursor:pointer;padding:0;color:#71717a;display:flex;align-items:center;transition:color 60ms ease-out;">
        <i class="ph ph-arrow-left" style="font-size:15px;"></i>
      </button>
      <span style="font-size:13px;font-weight:600;color:#09090b;letter-spacing:-0.01em;">Settings</span>
    </div>
    <div style="flex:1;overflow-y:auto;padding:8px 0;">
      <div style="padding:6px 12px 4px;font-size:10px;font-weight:600;color:#a1a1aa;letter-spacing:0.04em;text-transform:uppercase;">Data</div>
      <button id="show-in-finder-btn" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:none;border:none;cursor:pointer;text-align:left;transition:background 60ms ease-out;" onmouseover="this.style.background='#f4f4f5'" onmouseout="this.style.background='none'">
        <span style="font-size:13px;color:#09090b;">Open data file in Finder</span>
        <i class="ph ph-arrow-square-out" style="font-size:14px;color:#a1a1aa;"></i>
      </button>
    </div>
  `;

  const app = document.getElementById('app');
  app.style.position = 'relative';
  app.appendChild(panel);
  requestAnimationFrame(() => { panel.style.opacity = '1'; });

  panel.querySelector('#settings-back').addEventListener('click', hideSettings);
  panel.querySelector('#show-in-finder-btn').addEventListener('click', () => {
    ipcRenderer.invoke('show-in-finder');
  });
}

function hideSettings() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  panel.style.opacity = '0';
  setTimeout(() => { panel.remove(); }, 120);
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  const input       = document.getElementById('task-input');
  const settingsBtn = document.getElementById('settings-btn');

  settingsBtn?.addEventListener('click', showSettings);
  document.getElementById('history-footer-btn')?.addEventListener('click', () => showHistoryPanel());


  input.addEventListener('keydown', (e) => {
    const picker = activeHashPicker || activeAtPicker;
    if (picker && picker._items?.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = ((picker._highlighted ?? -1) + 1) % picker._items.length;
        picker._items.forEach((item, i) => { item.el.style.background = i === next ? '#f4f4f5' : ''; });
        picker._highlighted = next;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = ((picker._highlighted ?? 0) - 1 + picker._items.length) % picker._items.length;
        picker._items.forEach((item, i) => { item.el.style.background = i === prev ? '#f4f4f5' : ''; });
        picker._highlighted = prev;
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        picker._items[picker._highlighted ?? 0]?.action();
        return;
      }
    }
    if (e.key === 'Enter' && input.value.trim()) {
      hideHashProjectPicker(); hideAtDatePicker();
      addTask(input.value); input.value = '';
      updateMirror();
    }
    if (e.key === 'Escape') { hideHashProjectPicker(); hideAtDatePicker(); updateMirror(); }
  });

  input.addEventListener('input', () => {
    const val = input.value;

    if (pendingProjectId && !val.includes(`#${pendingProjectName}`)) { pendingProjectId = null; pendingProjectName = null; }
    if (pendingDeadline && !val.includes('@')) { pendingDeadline = null; pendingDeadlineLabel = null; }

    const hashMatch = val.match(/#(\S*)$/);
    if (hashMatch) {
      hideAtDatePicker();
      showHashProjectPicker(input, hashMatch[1]);
    } else {
      hideHashProjectPicker();
      const atMatch = val.match(/@([a-zA-Z0-9 ]*)$/);
      if (atMatch) showAtDatePicker(input, atMatch[1]);
      else hideAtDatePicker();
    }

    updateMirror();
  });

  input.addEventListener('blur', () => { setTimeout(hideHashProjectPicker, 150); setTimeout(hideAtDatePicker, 150); });

  document.getElementById('nav-today')?.addEventListener('click', () => {
    if (currentView !== 'focus') switchView('focus');
  });

  document.getElementById('nav-anytime')?.addEventListener('click', () => {
    if (currentView !== 'list') switchView('list');
  });

  loadTasks().then(() => {
    updateNav();
    updateInputPlaceholder();
  });
});

ipcRenderer.on('window-shown', () => {
  hideProjectPicker(); hideDeadlinePicker(); hideHashProjectPicker(); hideAtDatePicker(); hideDotsMenu();
  document.getElementById('task-input').focus();
  loadTasks();
});

ipcRenderer.on('reload-tasks', () => { loadTasks(); });

ipcRenderer.on('context-action', (event, { action, taskId }) => {
  switch (action) {
    case 'move-top':     moveToTop(taskId); break;
    case 'move-bottom':  moveToBottom(taskId); break;
    case 'move-today':   moveToToday(taskId); break;
    case 'move-anytime': moveToAnytime(taskId); break;
    case 'add-label':
    case 'change-label': {
      const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
      if (row) showProjectPicker(row, taskId);
      break;
    }
    case 'set-deadline':
    case 'change-deadline': {
      const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
      if (row) showDeadlinePicker(row, taskId);
      break;
    }
    case 'delete': deleteTask(taskId); break;
  }
});
