const { ipcRenderer } = require('electron');

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

function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
    createOpt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#2563eb;border-top:1px solid #e4e4e7;';
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
}

function hideHashProjectPicker() {
  if (activeHashPicker) { activeHashPicker.remove(); activeHashPicker = null; }
}

// --- @ date picker (inline deadline syntax) ---

function parseAtQuery(raw) {
  const q = raw.toLowerCase().trim();
  if (!q) return [];

  const today = new Date(); today.setHours(0, 0, 0, 0);

  function nextDow(dayIdx) {
    const d = new Date(today);
    const diff = (dayIdx - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function fmtSub(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const seen = new Set();
  const results = [];

  function add(label, d) {
    const iso = toLocalISO(d);
    if (!seen.has(iso)) { seen.add(iso); results.push({ label, sublabel: fmtSub(d), iso }); }
  }

  const tom = new Date(today); tom.setDate(tom.getDate() + 1);
  if ('today'.startsWith(q))    add('Today',    today);
  if ('tomorrow'.startsWith(q)) add('Tomorrow', tom);

  const DAYS = [
    ['sunday',    0, ['su', 'sun']],
    ['monday',    1, ['mo', 'mon']],
    ['tuesday',   2, ['tu', 'tue']],
    ['wednesday', 3, ['we', 'wed']],
    ['thursday',  4, ['th', 'thu']],
    ['friday',    5, ['fr', 'fri']],
    ['saturday',  6, ['sa', 'sat']],
  ];

  DAYS.forEach(([name, idx, aliases]) => {
    if (name.startsWith(q) || aliases.includes(q)) {
      add(name[0].toUpperCase() + name.slice(1), nextDow(idx));
    }
  });

  if (q.length >= 2 && 'next'.startsWith(q)) {
    add('Next Sunday', nextDow(0));
  }
  if (q.startsWith('next ')) {
    const rest = q.slice(5);
    DAYS.forEach(([name, idx, aliases]) => {
      if (!rest || name.startsWith(rest) || aliases.some(a => a === rest)) {
        const d = nextDow(idx); d.setDate(d.getDate() + 7);
        add('Next ' + name[0].toUpperCase() + name.slice(1), d);
      }
    });
  }

  const inMatch = q.match(/^in\s+(\d+)(?:\s+days?)?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    if (n > 0 && n <= 365) {
      const d = new Date(today); d.setDate(d.getDate() + n);
      add(`In ${n} day${n !== 1 ? 's' : ''}`, d);
    }
  }

  const MONTHS = [
    ['january',   ['jan'], 0],  ['february',  ['feb'], 1],
    ['march',     ['mar'], 2],  ['april',     ['apr'], 3],
    ['may',       ['may'], 4],  ['june',      ['jun'], 5],
    ['july',      ['jul'], 6],  ['august',    ['aug'], 7],
    ['september', ['sep', 'sept'], 8], ['october', ['oct'], 9],
    ['november',  ['nov'], 10], ['december',  ['dec'], 11],
  ];

  const mParts = q.match(/^([a-z]+)(?:\s+(\d{1,2}))?$/);
  if (mParts) {
    const mq = mParts[1], dq = mParts[2] ? parseInt(mParts[2], 10) : null;
    MONTHS.forEach(([fullName, abbrs, idx]) => {
      if (fullName.startsWith(mq) || abbrs.some(a => a.startsWith(mq))) {
        const dayNum = (dq && dq >= 1 && dq <= 31) ? dq : null;
        let year = today.getFullYear();
        const d = new Date(year, idx, dayNum || 1);
        if (d <= today) d.setFullYear(year + 1);
        const mLabel = fullName[0].toUpperCase() + fullName.slice(1, 3);
        add(dayNum ? `${mLabel} ${dayNum}` : mLabel, d);
      }
    });
  }

  return results.slice(0, 6);
}

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

  makeOption('None', null, () => { assignProjectToTask(activePickerTaskId, null); hideProjectPicker(); });
  filtered.forEach(p => {
    makeOption(p.name, p.color, () => { assignProjectToTask(activePickerTaskId, p.id); hideProjectPicker(); });
  });

  if (q && !exactMatch) {
    const createOpt = document.createElement('div');
    createOpt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#2563eb;border-top:1px solid #e4e4e7;';
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

  const rect = anchorEl.getBoundingClientRect();
  const pickerWidth = 200;
  const left = rect.left + pickerWidth > window.innerWidth ? rect.right - pickerWidth : rect.left;
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${left}px`;

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

  makeOption('No deadline', null);
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

  const rect = anchorEl.getBoundingClientRect();
  const pickerWidth = 160;
  const left = rect.left + pickerWidth > window.innerWidth ? rect.right - pickerWidth : rect.left;
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${left}px`;

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

// --- Navigation ---

function switchView(view) {
  currentView = view;
  renderTasks();
  updateNav();
  updateInputPlaceholder();
}

function updateNav() {
  const left  = document.getElementById('nav-left');
  const right = document.getElementById('nav-right');
  if (!left || !right) return;
  if (currentView === 'focus') {
    left.textContent       = 'Today';
    left.style.fontWeight  = '600';
    left.style.color       = '#09090b';
    left.style.cursor      = 'default';
    right.textContent      = 'All →';
    right.style.fontWeight = '400';
    right.style.color      = '#71717a';
  } else {
    left.textContent       = '← Today';
    left.style.fontWeight  = '400';
    left.style.color       = '#71717a';
    left.style.cursor      = 'pointer';
    right.textContent      = 'All';
    right.style.fontWeight = '600';
    right.style.color      = '#09090b';
  }
}

function updateInputPlaceholder() {
  const input = document.getElementById('task-input');
  if (input) input.placeholder = currentView === 'focus' ? 'Add to today…' : 'Add to backlog…';
}

// --- Format helpers ---

function formatDeadline(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = deadline.split('-').map(Number);
  const due = new Date(year, month - 1, day);
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0)  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: true };
  if (diff === 0) return { label: 'Today', overdue: false };
  if (diff === 1) return { label: 'Tomorrow', overdue: false };
  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false };
}

// --- Section header ---

function renderSectionHeader(label, accent = false) {
  const color = accent ? '#2563eb' : '#71717a';
  return `
    <div class="flex items-center px-3 pt-2.5 pb-0.5">
      <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${color};">${escapeHtml(label)}</span>
    </div>
  `;
}

// --- Render ---

function renderTasks() {
  const container = document.getElementById('task-list');
  if (currentView === 'focus') {
    renderFocusView(container);
  } else {
    renderListView(container);
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
        <div style="font-size:16px;color:#2563eb;margin-bottom:6px;">✓</div>
        <div style="font-size:13px;font-weight:500;color:#09090b;margin-bottom:3px;">Focus cleared</div>
        <div style="font-size:12px;color:#71717a;">Nothing left for today</div>
      </div>
    `;
  } else {
    todayActive.forEach(t => { html += renderTaskRow(t, true); });
  }

  if (completedToday.length > 0) {
    html += `
      <div style="border-top:1px solid #f0f0ee;margin-top:4px;">
        <button id="completed-toggle" style="display:flex;align-items:center;gap:6px;width:100%;padding:8px 12px;border:none;background:none;cursor:pointer;">
          <svg style="width:10px;height:10px;color:#a1a1aa;flex-shrink:0;transform:${showCompleted ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform 60ms ease-out;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
          </svg>
          <span style="font-size:11px;color:#71717a;">${completedToday.length} done today</span>
        </button>
      </div>
    `;
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

function renderListView(container) {
  const todayActive   = tasks.filter(t => !t.completed && t.bucket === 'today');
  const anytimeActive = tasks.filter(t => !t.completed && t.bucket === 'anytime');
  sortedUncompleted = [...todayActive, ...anytimeActive];

  const filterFn = activeProjectFilter ? t => t.projectId === activeProjectFilter : () => true;
  const filteredToday   = todayActive.filter(filterFn);
  const filteredAnytime = anytimeActive.filter(filterFn);

  let html = '';

  if (projects.length > 0) {
    html += `<div class="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 overflow-x-auto">`;
    projects.forEach(p => {
      const active = activeProjectFilter === p.id;
      html += `<button class="project-filter-chip flex-shrink-0 text-xs px-2 py-0.5 rounded-full border" data-project-id="${p.id}"
        style="${active
          ? `background:${p.color}20;color:${p.color};border-color:${p.color}40;`
          : 'background:#f4f4f5;color:#71717a;border-color:#e4e4e7;'}">
        ${escapeHtml(p.name)}
      </button>`;
    });
    html += `</div>`;
  }

  if (todayActive.length > 0) {
    html += renderSectionHeader('Today', true);
    if (filteredToday.length > 0) {
      filteredToday.forEach(t => { html += renderTaskRow(t, false); });
    } else {
      html += `<div class="px-3 py-1.5" style="font-size:12px;color:#71717a;">No matching tasks</div>`;
    }
  }

  html += renderSectionHeader('Anytime');
  if (filteredAnytime.length > 0) {
    filteredAnytime.forEach(t => { html += renderTaskRow(t, false); });
  } else if (anytimeActive.length === 0) {
    html += `<div class="px-3 py-2" style="font-size:12px;color:#71717a;">Backlog is empty</div>`;
  } else {
    html += `<div class="px-3 py-1.5" style="font-size:12px;color:#71717a;">No matching tasks</div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.project-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeProjectFilter = activeProjectFilter === chip.dataset.projectId ? null : chip.dataset.projectId;
      renderTasks();
    });
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
  container.querySelectorAll('.bucket-anytime-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); moveToAnytime(btn.dataset.id); });
  });
  container.querySelectorAll('.project-pill').forEach(pill => {
    pill.addEventListener('click', (e) => { e.stopPropagation(); showProjectPicker(pill, pill.dataset.taskId); });
  });
  container.querySelectorAll('.deadline-pill').forEach(pill => {
    pill.addEventListener('click', (e) => { e.stopPropagation(); showDeadlinePicker(pill, pill.dataset.taskId); });
  });
  container.querySelectorAll('.deadline-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showDeadlinePicker(btn, btn.dataset.taskId); });
  });
  container.querySelectorAll('.project-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showProjectPicker(btn, btn.dataset.taskId); });
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
  container.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startDrag(e, handle.closest('.task-row'));
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

// --- Task row ---

function renderTaskRow(task, draggable = false) {
  const isEditing   = !task.completed && editingTaskId === task.id;
  const isDraggable = draggable && !task.completed;
  const hasSub = !task.completed && !!task.deadline;

  const dragHandle = isDraggable
    ? `<div class="drag-handle flex-shrink-0 w-4 opacity-0 group-hover:opacity-100 cursor-grab flex items-start pt-0.5" style="color:#d4d4d8;">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 12 20">
          <circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="10" r="1.5"/><circle cx="4" cy="16" r="1.5"/>
          <circle cx="9" cy="4" r="1.5"/><circle cx="9" cy="10" r="1.5"/><circle cx="9" cy="16" r="1.5"/>
        </svg>
      </div>`
    : `<div class="flex-shrink-0 w-4"></div>`;

  const checkboxClass = task.completed ? 'checkbox checked' : 'checkbox';

  let textEl;
  if (isEditing) {
    textEl = `<input class="edit-input flex-1 min-w-0 bg-transparent outline-none" style="font-size:13px;color:#09090b;" data-edit-id="${task.id}" value="${escapeHtml(task.title)}" />`;
  } else if (!task.completed) {
    textEl = `<span class="flex-1 min-w-0 cursor-text" style="font-size:13px;color:#09090b;word-break:break-word;" data-clickable-id="${task.id}">${escapeHtml(task.title)}</span>`;
  } else {
    textEl = `<span class="task-title-completed flex-1 min-w-0" style="font-size:13px;word-break:break-word;">${escapeHtml(task.title)}</span>`;
  }

  // Deadline sub-line
  let subLine = '';
  if (!task.completed && task.deadline) {
    const fmt = formatDeadline(task.deadline);
    if (fmt) {
      const color  = fmt.overdue ? '#ef4444' : '#71717a';
      const bg     = fmt.overdue ? '#ef444412' : '#f4f4f5';
      const border = fmt.overdue ? '#ef444428' : '#e4e4e7';
      subLine = `<div class="mt-0.5">
        <button class="deadline-pill" data-task-id="${task.id}"
          style="font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:${bg};color:${color};border:1px solid ${border};cursor:pointer;white-space:nowrap;line-height:1.6;">
          ${escapeHtml(fmt.label)}
        </button>
      </div>`;
    }
  }

  // Inline label pill
  let labelPill = '';
  if (!task.completed && !isEditing && task.projectId) {
    const project = projects.find(p => p.id === task.projectId);
    if (project) {
      labelPill = `<button class="project-pill flex items-center gap-1 flex-shrink-0" data-task-id="${task.id}"
        style="font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:${project.color}12;color:${project.color};border:none;cursor:pointer;white-space:nowrap;line-height:1.6;flex-shrink:0;align-self:flex-start;margin-top:1px;">
        <span style="width:4px;height:4px;border-radius:50%;background:${project.color};display:inline-block;flex-shrink:0;"></span>
        ${escapeHtml(project.name)}
      </button>`;
    }
  }

  // Right-side hover actions
  let actions = '';
  if (!task.completed) {
    const bucketBtn = task.bucket === 'today'
      ? `<button class="bucket-anytime-btn" data-id="${task.id}" title="Move to Anytime" style="color:#d4d4d8;background:none;border:none;cursor:pointer;padding:0;line-height:1;">
          <i class="ph ph-tray-arrow-down" style="font-size:12px;"></i>
        </button>`
      : `<button class="bucket-today-btn" data-id="${task.id}" title="Move to Today" style="color:#d4d4d8;background:none;border:none;cursor:pointer;padding:0;line-height:1;">
          <i class="ph ph-tray-arrow-up" style="font-size:12px;"></i>
        </button>`;

    const calBtn = !task.deadline
      ? `<button class="deadline-tag-btn" data-task-id="${task.id}" title="Set deadline" style="color:#d4d4d8;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </button>` : '';

    const tagBtn = !task.projectId
      ? `<button class="project-tag-btn" data-task-id="${task.id}" title="Add label" style="color:#d4d4d8;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z"/>
          </svg>
        </button>` : '';

    actions = `<div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 flex-shrink-0" style="transition:opacity 60ms ease-out;">
      ${bucketBtn}
      ${calBtn}${tagBtn}
      <button class="task-delete" data-id="${task.id}" style="color:#d4d4d8;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
  } else {
    actions = `<div class="flex items-center opacity-0 group-hover:opacity-100 flex-shrink-0" style="transition:opacity 60ms ease-out;">
      <button class="task-delete" data-id="${task.id}" style="color:#d4d4d8;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
  }

  return `
    <div class="task-row group flex items-start gap-2 px-3 py-2 hover:bg-zinc-100" data-id="${task.id}">
      ${dragHandle}
      <div class="task-checkbox ${checkboxClass}" style="margin-top:1px;flex-shrink:0;" data-id="${task.id}">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        ${textEl}
        ${subLine}
      </div>
      ${labelPill}
      <div style="margin-top:1px;">${actions}</div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  const navLeft     = document.getElementById('nav-left');
  const navRight    = document.getElementById('nav-right');
  const settingsBtn = document.getElementById('settings-btn');

  settingsBtn?.addEventListener('mouseover', () => { settingsBtn.style.color = '#71717a'; });
  settingsBtn?.addEventListener('mouseout',  () => { settingsBtn.style.color = '#c4c4c7'; });
  settingsBtn?.addEventListener('click', showSettings);

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
    }
    if (e.key === 'Escape') { hideHashProjectPicker(); hideAtDatePicker(); }
  });

  input.addEventListener('input', () => {
    const val = input.value;

    if (pendingProjectId && !val.includes('#')) { pendingProjectId = null; pendingProjectName = null; }
    if (pendingDeadline && !val.includes('@')) { pendingDeadline = null; pendingDeadlineLabel = null; }

    const hashMatch = val.match(/#(\S*)$/);
    if (hashMatch) { hideAtDatePicker(); showHashProjectPicker(input, hashMatch[1]); return; }
    else hideHashProjectPicker();

    const atMatch = val.match(/@([a-zA-Z0-9 ]*)$/);
    if (atMatch) showAtDatePicker(input, atMatch[1]);
    else hideAtDatePicker();
  });

  input.addEventListener('blur', () => { setTimeout(hideHashProjectPicker, 150); setTimeout(hideAtDatePicker, 150); });

  navLeft?.addEventListener('click', () => {
    if (currentView !== 'focus') switchView('focus');
  });

  navRight?.addEventListener('click', () => {
    if (currentView !== 'list') switchView('list');
  });

  loadTasks().then(() => {
    updateNav();
    updateInputPlaceholder();
  });
});

ipcRenderer.on('window-shown', () => {
  hideProjectPicker(); hideDeadlinePicker(); hideHashProjectPicker(); hideAtDatePicker();
  document.getElementById('task-input').focus();
  loadTasks();
});

ipcRenderer.on('reload-tasks', () => { loadTasks(); });
