const { ipcRenderer } = require('electron');

let tasks = [];
let projects = [];
let pendingProjectId = null;
let pendingPriority = null;
let pendingDueDate = null;
let activePicker = null;
let activePickerTaskId = null;
let activeDueDatePicker = null;
let activeDueDatePickerTaskId = null;
let draggedId = null;
let showHistory = false;
let editingTaskId = null;
let sortedUncompleted = [];
let sortMode = localStorage.getItem('menutodo-sort') || 'manual';
if (sortMode === 'priority') sortMode = 'manual';

const COLOR_PALETTE = ['#6366f1','#3b82f6','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#a855f7'];

const URGENT_COLOR = '#ef4444';

// Generate UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Format a Date as YYYY-MM-DD in local time
function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Return the first palette color not yet used by any project
function getNextColor() {
  const usedColors = projects.map(p => p.color);
  for (const color of COLOR_PALETTE) {
    if (!usedColors.includes(color)) return color;
  }
  return COLOR_PALETTE[projects.length % COLOR_PALETTE.length];
}

// Create a new project with auto-assigned color
function createProject(name) {
  const project = { id: generateId(), name: name.trim(), color: getNextColor() };
  projects.push(project);
  saveTasks();
  return project;
}

// Assign a project to a task or to the pending input
function assignProjectToTask(taskId, projectId) {
  if (taskId === 'pending') {
    pendingProjectId = projectId;
    updateInputProjectButton();
  } else {
    const task = tasks.find(t => t.id === taskId);
    if (task) { task.projectId = projectId; saveTasks(); renderTasks(); }
  }
}

// Assign a priority to a task or to the pending input
function assignPriorityToTask(taskId, priorityId) {
  if (taskId === 'pending') {
    pendingPriority = priorityId;
    updateInputPriorityButton();
  } else {
    const task = tasks.find(t => t.id === taskId);
    if (task) { task.priority = priorityId; saveTasks(); renderTasks(); }
  }
}

// Assign a due date to a task or to the pending input
function assignDueDateToTask(taskId, dueDate) {
  if (taskId === 'pending') {
    pendingDueDate = dueDate;
    updateInputDueDateButton();
  } else {
    const task = tasks.find(t => t.id === taskId);
    if (task) { task.dueDate = dueDate; saveTasks(); renderTasks(); }
  }
}

// --- Input bar button renderers ---

function updateInputProjectButton() {
  const btn = document.getElementById('project-picker-btn');
  if (!btn) return;
  if (pendingProjectId) {
    const project = projects.find(p => p.id === pendingProjectId);
    if (project) {
      btn.setAttribute('style', `font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:${project.color}15;color:${project.color};border:1px solid ${project.color}28;cursor:pointer;white-space:nowrap;line-height:1.6;display:inline-flex;align-items:center;gap:4px;`);
      btn.innerHTML = `
        <span style="width:4px;height:4px;border-radius:50%;background:${project.color};display:inline-block;flex-shrink:0;"></span>
        ${escapeHtml(project.name)}
        <span data-clear style="font-size:12px;color:${project.color};opacity:0.6;margin-left:1px;line-height:1;">×</span>
      `;
      return;
    }
  }
  btn.setAttribute('style', 'font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:#f3f4f6;color:#9ca3af;border:1px solid #e5e7eb;cursor:pointer;white-space:nowrap;line-height:1.6;display:inline-flex;align-items:center;gap:4px;');
  btn.innerHTML = `
    <span style="width:4px;height:4px;border-radius:50%;background:#d1d5db;display:inline-block;flex-shrink:0;"></span>
    Project
  `;
}

function updateInputPriorityButton() {
  const btn = document.getElementById('priority-picker-btn');
  if (!btn) return;
  if (pendingPriority === 'urgent') {
    btn.setAttribute('style', `font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:${URGENT_COLOR}12;color:${URGENT_COLOR};border:1px solid ${URGENT_COLOR}28;cursor:pointer;white-space:nowrap;line-height:1.6;display:inline-flex;align-items:center;gap:3px;letter-spacing:-0.5px;`);
    btn.innerHTML = `!!! Urgent <span data-clear style="font-size:12px;opacity:0.6;margin-left:1px;line-height:1;font-weight:400;letter-spacing:0;">×</span>`;
  } else {
    btn.setAttribute('style', 'font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:#f3f4f6;color:#9ca3af;border:1px solid #e5e7eb;cursor:pointer;white-space:nowrap;line-height:1.6;display:inline-flex;align-items:center;gap:3px;');
    btn.innerHTML = `<span style="font-weight:700;letter-spacing:-0.5px;">!!!</span> Urgent`;
  }
}

function updateInputDueDateButton() {
  const btn = document.getElementById('due-date-picker-btn');
  if (!btn) return;
  if (pendingDueDate) {
    const formatted = formatDueDate(pendingDueDate);
    if (formatted) {
      const color  = formatted.overdue ? '#ef4444' : '#6b7280';
      const bg     = formatted.overdue ? `${color}12` : '#f3f4f6';
      const border = formatted.overdue ? `${color}28` : '#e5e7eb';
      btn.setAttribute('style', `font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:${bg};color:${color};border:1px solid ${border};cursor:pointer;white-space:nowrap;line-height:1.6;display:inline-flex;align-items:center;gap:3px;`);
      btn.innerHTML = `${escapeHtml(formatted.label)} <span data-clear style="font-size:12px;opacity:0.6;margin-left:1px;line-height:1;">×</span>`;
      return;
    }
  }
  btn.setAttribute('style', 'font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:#f3f4f6;color:#9ca3af;border:1px solid #e5e7eb;cursor:pointer;white-space:nowrap;line-height:1.6;display:inline-flex;align-items:center;gap:3px;');
  btn.innerHTML = `Due date`;
}

// Format a due date string (YYYY-MM-DD) into a display label
function formatDueDate(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = dueDate.split('-').map(Number);
  const due = new Date(year, month - 1, day);
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0)  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: true };
  if (diff === 0) return { label: 'Today', overdue: false };
  if (diff === 1) return { label: 'Tomorrow', overdue: false };
  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false };
}

// Return uncompleted tasks sorted according to current sortMode
function getSortedUncompleted() {
  const uncompleted = tasks.filter(t => !t.completed);
  if (sortMode === 'manual') return [...uncompleted];

  if (sortMode === 'due') {
    return [...uncompleted].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      if (a.dueDate < b.dueDate) return -1;
      if (a.dueDate > b.dueDate) return 1;
      const pa = a.priority != null ? (PRIORITY_ORDER[a.priority] ?? 999) : 999;
      const pb = b.priority != null ? (PRIORITY_ORDER[b.priority] ?? 999) : 999;
      return pa - pb;
    });
  }

  return [...uncompleted];
}

// --- Project picker ---

function renderPickerOptions(container, query) {
  container.innerHTML = '';
  const q = query.toLowerCase().trim();
  const filtered = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
  const exactMatch = projects.some(p => p.name.toLowerCase() === q);

  const makeOption = (label, color, onClick) => {
    const opt = document.createElement('div');
    opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:12px;color:#374151;';
    const dot = document.createElement('span');
    if (color) {
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;`;
    } else {
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;border:1.5px solid #d1d5db;flex-shrink:0;display:inline-block;box-sizing:border-box;';
    }
    opt.appendChild(dot);
    const text = document.createElement('span');
    text.textContent = label;
    opt.appendChild(text);
    opt.addEventListener('mouseover', () => { opt.style.background = '#f9fafb'; });
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
    createOpt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:12px;color:#6366f1;border-top:1px solid #f3f4f6;';
    const plus = document.createElement('span');
    plus.textContent = '+';
    plus.style.cssText = 'font-weight:bold;flex-shrink:0;font-size:14px;line-height:1;';
    createOpt.appendChild(plus);
    const text = document.createElement('span');
    text.textContent = `Create "${query}"`;
    createOpt.appendChild(text);
    createOpt.addEventListener('mouseover', () => { createOpt.style.background = '#f9fafb'; });
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
  hideProjectPicker(); hideDueDatePicker();
  activePickerTaskId = taskId;

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:white;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);width:200px;z-index:1000;overflow:hidden;';
  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.placeholder = 'Find or create…';
  inputEl.style.cssText = 'width:100%;padding:8px 12px;border:none;border-bottom:1px solid #f3f4f6;font-size:12px;outline:none;box-sizing:border-box;';
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


// --- Due date picker ---

function showDueDatePicker(anchorEl, taskId) {
  hideDueDatePicker(); hideProjectPicker();
  activeDueDatePickerTaskId = taskId;

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;background:white;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);width:160px;z-index:1000;overflow:hidden;padding:4px 0;';

  const today    = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);

  const makeOption = (label, value) => {
    const opt = document.createElement('div');
    opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:12px;color:#374151;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;border:1.5px solid #d1d5db;flex-shrink:0;display:inline-block;box-sizing:border-box;';
    opt.appendChild(dot);
    const text = document.createElement('span');
    text.textContent = label;
    opt.appendChild(text);
    opt.addEventListener('mouseover', () => { opt.style.background = '#f9fafb'; });
    opt.addEventListener('mouseout',  () => { opt.style.background = ''; });
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      assignDueDateToTask(activeDueDatePickerTaskId, value);
      hideDueDatePicker();
    });
    picker.appendChild(opt);
  };

  makeOption('No due date', null);
  makeOption('Today',      toLocalISO(today));
  makeOption('Tomorrow',   toLocalISO(tomorrow));
  makeOption('In a week',  toLocalISO(nextWeek));

  const divider = document.createElement('div');
  divider.style.cssText = 'border-top:1px solid #f3f4f6;margin:4px 0;';
  picker.appendChild(divider);

  const dateRow = document.createElement('div');
  dateRow.style.cssText = 'padding:4px 12px 8px;';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.style.cssText = 'width:100%;font-size:12px;border:1px solid #e5e7eb;border-radius:4px;padding:4px 6px;outline:none;box-sizing:border-box;color:#374151;';
  const currentTask = taskId !== 'pending' ? tasks.find(t => t.id === taskId) : null;
  if (currentTask && currentTask.dueDate) dateInput.value = currentTask.dueDate;
  else if (taskId === 'pending' && pendingDueDate) dateInput.value = pendingDueDate;
  dateInput.addEventListener('change', (e) => {
    if (e.target.value) { assignDueDateToTask(activeDueDatePickerTaskId, e.target.value); hideDueDatePicker(); }
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

  const onOutsideClick = (e) => { if (!picker.contains(e.target)) hideDueDatePicker(); };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
  picker._onOutsideClick = onOutsideClick;
}

function hideDueDatePicker() {
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
  ipcRenderer.invoke('update-badge', tasks.filter(t => !t.completed).length);
}

function addTask(text) {
  tasks.unshift({
    id: generateId(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    projectId: pendingProjectId || null,
    priority: pendingPriority || null,
    dueDate: pendingDueDate || null,
  });
  pendingProjectId = null;
  pendingPriority = null;
  pendingDueDate = null;
  saveTasks();
  renderTasks();
  updateInputProjectButton();
  updateInputPriorityButton();
  updateInputDueDateButton();
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
  if (task) task.text = trimmed;
  editingTaskId = null;
  saveTasks();
  renderTasks();
  updateBadge();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  renderTasks();
}

function formatDate(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  if (date.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

// --- Section header ---

function renderSectionHeader(label, color) {
  return `
    <div class="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5">
      <span style="width:5px;height:5px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;"></span>
      <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${color};">${escapeHtml(label)}</span>
    </div>
  `;
}

// --- Render ---

function renderTasks() {
  const container = document.getElementById('task-list');
  sortedUncompleted = getSortedUncompleted();

  const completed = tasks.filter(t => t.completed);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const completedToday = completed
    .filter(t => { if (!t.completedAt) return false; const d = new Date(t.completedAt); d.setHours(0,0,0,0); return d.getTime() === todayStart.getTime(); })
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const completedPast = completed
    .filter(t => { if (!t.completedAt) return false; const d = new Date(t.completedAt); d.setHours(0,0,0,0); return d.getTime() < todayStart.getTime(); })
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const sortActiveClass   = 'bg-gray-100 text-gray-600 font-medium';
  const sortInactiveClass = 'text-gray-400 hover:text-gray-500';

  let html = `
    <div class="flex items-center gap-0.5 px-3 pt-2 pb-1.5 border-b border-gray-50">
      <span class="text-xs text-gray-400 mr-1">Sort:</span>
      <button data-sort="manual" class="sort-btn text-xs px-1.5 py-0.5 rounded transition-colors ${sortMode === 'manual' ? sortActiveClass : sortInactiveClass}">Manual</button>
      <button data-sort="due"    class="sort-btn text-xs px-1.5 py-0.5 rounded transition-colors ${sortMode === 'due'    ? sortActiveClass : sortInactiveClass}">Due date</button>
    </div>
  `;

  // Uncompleted tasks with optional section headers
  if (sortMode === 'due') {
    const todayISO    = toLocalISO(new Date());
    const tomorrowD   = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1);
    const tomorrowISO = toLocalISO(tomorrowD);
    const weekD       = new Date(); weekD.setDate(weekD.getDate() + 7);
    const weekISO     = toLocalISO(weekD);

    const dueSections = [
      { label: 'Overdue',     color: '#ef4444', filter: t =>  t.dueDate && t.dueDate < todayISO },
      { label: 'Today',       color: '#6b7280', filter: t =>  t.dueDate === todayISO },
      { label: 'Tomorrow',    color: '#6b7280', filter: t =>  t.dueDate === tomorrowISO },
      { label: 'This week',   color: '#6b7280', filter: t =>  t.dueDate && t.dueDate > tomorrowISO && t.dueDate <= weekISO },
      { label: 'Later',       color: '#9ca3af', filter: t =>  t.dueDate && t.dueDate > weekISO },
      { label: 'No due date', color: '#d1d5db', filter: t => !t.dueDate },
    ];
    dueSections.forEach(section => {
      const sectionTasks = sortedUncompleted.filter(section.filter);
      if (sectionTasks.length === 0) return;
      html += renderSectionHeader(section.label, section.color);
      sectionTasks.forEach(t => { html += renderTaskRow(t); });
    });
  } else {
    sortedUncompleted.forEach(t => { html += renderTaskRow(t); });
  }

  // Completed section
  html += `
    <div class="flex items-center justify-between px-3 pt-3 pb-1 ${sortedUncompleted.length > 0 ? 'border-t border-gray-100 mt-1' : ''}">
      <span class="text-xs font-medium text-gray-400 uppercase tracking-wider">Completed today</span>
      <button id="history-toggle" class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        ${showHistory ? 'Hide history' : 'History'}
      </button>
    </div>
  `;
  completedToday.forEach(t => { html += renderTaskRow(t); });

  if (showHistory) {
    const groups = new Map();
    completedPast.forEach(task => {
      const d = new Date(task.completedAt); d.setHours(0,0,0,0);
      const key = d.getTime();
      if (!groups.has(key)) groups.set(key, { date: d, tasks: [] });
      groups.get(key).tasks.push(task);
    });
    [...groups.values()]
      .sort((a, b) => b.date - a.date)
      .forEach(({ date, tasks: dayTasks }) => {
        html += `<div class="px-3 pt-3 pb-1"><span class="text-xs font-medium text-gray-400 uppercase tracking-wider">${formatDate(date)}</span></div>`;
        dayTasks.forEach(t => { html += renderTaskRow(t); });
      });
  }

  if (tasks.length === 0) {
    html = `
      <div class="flex flex-col items-center justify-center py-12 text-gray-400">
        <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
        </svg>
        <span class="text-sm">No tasks yet</span>
      </div>
    `;
  }

  container.innerHTML = html;

  // Sort toggle
  container.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.sort;
      localStorage.setItem('menutodo-sort', sortMode);
      renderTasks();
    });
  });

  // History toggle
  const historyBtn = container.querySelector('#history-toggle');
  if (historyBtn) historyBtn.addEventListener('click', () => { showHistory = !showHistory; renderTasks(); });

  // Checkboxes
  container.querySelectorAll('.task-checkbox').forEach(cb => {
    cb.addEventListener('click', () => toggleTask(cb.dataset.id));
  });

  // Deletes
  container.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(btn.dataset.id); });
  });

  // Project pills / icons
  container.querySelectorAll('.project-pill').forEach(pill => {
    pill.addEventListener('click', (e) => { e.stopPropagation(); showProjectPicker(pill, pill.dataset.taskId); });
  });
  container.querySelectorAll('.project-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showProjectPicker(btn, btn.dataset.taskId); });
  });

  // Priority badge (urgent → remove) / flag icon (none → set urgent)
  container.querySelectorAll('.priority-badge').forEach(badge => {
    badge.addEventListener('click', (e) => { e.stopPropagation(); assignPriorityToTask(badge.dataset.taskId, null); });
  });
  container.querySelectorAll('.priority-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); assignPriorityToTask(btn.dataset.taskId, 'urgent'); });
  });

  // Due date pills / icons
  container.querySelectorAll('.due-date-pill').forEach(pill => {
    pill.addEventListener('click', (e) => { e.stopPropagation(); showDueDatePicker(pill, pill.dataset.taskId); });
  });
  container.querySelectorAll('.due-date-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showDueDatePicker(btn, btn.dataset.taskId); });
  });

  // Inline edit: click text
  container.querySelectorAll('[data-clickable-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      editingTaskId = el.dataset.clickableId;
      renderTasks();
      const input = container.querySelector('[data-edit-id]');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
  });

  // Inline edit: input events
  const editInput = container.querySelector('[data-edit-id]');
  if (editInput) {
    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  updateTaskText(editInput.dataset.editId, editInput.value);
      if (e.key === 'Escape') { editingTaskId = null; renderTasks(); }
    });
    editInput.addEventListener('blur', () => updateTaskText(editInput.dataset.editId, editInput.value));
  }

  // Drag-to-reorder
  container.querySelectorAll('.task-row').forEach(row => {
    if (!row.draggable) return;

    row.addEventListener('dragstart', (e) => {
      draggedId = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { row.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', () => { row.style.opacity = ''; clearDropIndicators(); draggedId = null; });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row.dataset.id === draggedId) return;
      e.dataTransfer.dropEffect = 'move';
      clearDropIndicators();
      row.style.borderTop = '2px solid #a5b4fc';
    });
    row.addEventListener('dragleave', () => { row.style.borderTop = ''; });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetId = row.dataset.id;
      if (!draggedId || draggedId === targetId) return;
      const fromIdx = sortedUncompleted.findIndex(t => t.id === draggedId);
      const toIdx   = sortedUncompleted.findIndex(t => t.id === targetId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [moved] = sortedUncompleted.splice(fromIdx, 1);
        sortedUncompleted.splice(toIdx, 0, moved);
        tasks = [...sortedUncompleted, ...tasks.filter(t => t.completed)];
        saveTasks();
        renderTasks();
      }
    });
  });

  updateBadge();
}

function clearDropIndicators() {
  document.querySelectorAll('.task-row').forEach(r => { r.style.borderTop = ''; });
}

// --- Task row ---

function renderTaskRow(task) {
  const isEditing = !task.completed && editingTaskId === task.id;

  const draggableAttr = task.completed ? '' : 'draggable="true"';

  const dragHandle = task.completed
    ? '<div class="w-4 flex-shrink-0"></div>'
    : `<div class="flex-shrink-0 w-4 opacity-0 group-hover:opacity-100 cursor-grab text-gray-300 flex items-center">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 12 20">
          <circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="10" r="1.5"/><circle cx="4" cy="16" r="1.5"/>
          <circle cx="9" cy="4" r="1.5"/><circle cx="9" cy="10" r="1.5"/><circle cx="9" cy="16" r="1.5"/>
        </svg>
      </div>`;

  const checkboxClass = task.completed ? 'checkbox checked' : 'checkbox';

  // Priority indicator (main line) — urgent = !!! badge (click to remove), none = flag icon on hover (click to set)
  let priorityEl = '';
  if (task.priority === 'urgent' && !task.completed) {
    priorityEl = `<button class="priority-badge" data-task-id="${task.id}"
      style="font-size:10px;font-weight:700;color:${URGENT_COLOR};letter-spacing:-0.5px;cursor:pointer;padding:1px 4px;background:${URGENT_COLOR}12;border:1px solid ${URGENT_COLOR}28;border-radius:3px;line-height:1.6;"
      title="Remove urgent">!!!</button>`;
  } else if (!task.completed) {
    priorityEl = `<button class="priority-tag-btn opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity" data-task-id="${task.id}" title="Mark urgent">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21V3M3 3h14l-4 5 4 5H3"/>
      </svg>
    </button>`;
  }

  // Text
  let textEl;
  if (isEditing) {
    textEl = `<input class="edit-input flex-1 min-w-0 bg-transparent outline-none text-sm text-gray-800" data-edit-id="${task.id}" value="${escapeHtml(task.text)}" />`;
  } else if (!task.completed) {
    textEl = `<span class="text-sm text-gray-900 flex-1 min-w-0 truncate cursor-text" data-clickable-id="${task.id}">${escapeHtml(task.text)}</span>`;
  } else {
    textEl = `<span class="text-sm text-gray-400 line-through flex-1 min-w-0 truncate">${escapeHtml(task.text)}</span>`;
  }

  // Sub-line: due date + project (uncompleted only)
  let subLine = '';
  if (!task.completed) {
    // Due date element
    let dueDateEl = '';
    if (task.dueDate) {
      const formatted = formatDueDate(task.dueDate);
      if (formatted) {
        const color  = formatted.overdue ? '#ef4444' : '#6b7280';
        const bg     = formatted.overdue ? '#ef444412' : '#f3f4f6';
        const border = formatted.overdue ? '#ef444428' : '#e5e7eb';
        dueDateEl = `<button class="due-date-pill" data-task-id="${task.id}"
          style="font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:${bg};color:${color};border:1px solid ${border};cursor:pointer;white-space:nowrap;line-height:1.6;">
          ${escapeHtml(formatted.label)}
        </button>`;
      }
    } else {
      dueDateEl = `<button class="due-date-tag-btn opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity" data-task-id="${task.id}" title="Set due date">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      </button>`;
    }

    // Project element
    let projectEl = '';
    if (task.projectId) {
      const project = projects.find(p => p.id === task.projectId);
      if (project) {
        projectEl = `<button class="project-pill flex items-center gap-1" data-task-id="${task.id}"
          style="font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:${project.color}15;color:${project.color};border:1px solid ${project.color}28;cursor:pointer;white-space:nowrap;line-height:1.6;">
          <span style="width:4px;height:4px;border-radius:50%;background:${project.color};display:inline-block;flex-shrink:0;"></span>
          ${escapeHtml(project.name)}
        </button>`;
      }
    } else {
      projectEl = `<button class="project-tag-btn opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity" data-task-id="${task.id}" title="Assign project">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z"/>
        </svg>
      </button>`;
    }

    subLine = `<div class="flex items-center gap-1.5 mt-0.5">${dueDateEl}${projectEl}</div>`;
  }

  return `
    <div class="task-row group flex items-start gap-2 px-3 pt-2 pb-1.5 hover:bg-gray-50 transition-colors" ${draggableAttr} data-id="${task.id}">
      ${dragHandle}
      <div class="task-checkbox ${checkboxClass}" data-id="${task.id}">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          ${textEl}
          ${priorityEl}
        </div>
        ${subLine}
      </div>
      <button class="task-delete opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity flex-shrink-0 mt-px" data-id="${task.id}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  const input       = document.getElementById('task-input');
  const projectBtn  = document.getElementById('project-picker-btn');
  const priorityBtn = document.getElementById('priority-picker-btn');
  const dueDateBtn  = document.getElementById('due-date-picker-btn');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) { addTask(input.value); input.value = ''; }
  });

  projectBtn.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { pendingProjectId = null; updateInputProjectButton(); return; }
    showProjectPicker(projectBtn, 'pending');
  });

  priorityBtn.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { pendingPriority = null; updateInputPriorityButton(); return; }
    pendingPriority = pendingPriority === 'urgent' ? null : 'urgent';
    updateInputPriorityButton();
  });

  dueDateBtn.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { pendingDueDate = null; updateInputDueDateButton(); return; }
    showDueDatePicker(dueDateBtn, 'pending');
  });

  loadTasks().then(() => {
    updateInputPriorityButton();
    updateInputDueDateButton();
    updateInputProjectButton();
  });
});

ipcRenderer.on('window-shown', () => {
  hideProjectPicker(); hideDueDatePicker();
  document.getElementById('task-input').focus();
  loadTasks();
});

ipcRenderer.on('reload-tasks', () => { loadTasks(); });
