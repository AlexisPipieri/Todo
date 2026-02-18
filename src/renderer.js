const { ipcRenderer } = require('electron');

let tasks = [];
let projects = [];
let pendingProjectId = null;
let activePicker = null;
let activePickerTaskId = null;
let draggedId = null;
let showHistory = false;

const COLOR_PALETTE = ['#6366f1','#3b82f6','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#a855f7'];

// Generate UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
  const project = {
    id: generateId(),
    name: name.trim(),
    color: getNextColor()
  };
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
    if (task) {
      task.projectId = projectId;
      saveTasks();
      renderTasks();
    }
  }
}

// Update the project picker button appearance in the input area
function updateInputProjectButton() {
  const btn = document.getElementById('project-picker-btn');
  if (!btn) return;

  if (pendingProjectId) {
    const project = projects.find(p => p.id === pendingProjectId);
    if (project) {
      btn.innerHTML = `
        <span style="width:8px;height:8px;border-radius:50%;background:${project.color};flex-shrink:0;display:inline-block;"></span>
        <span style="font-size:11px;color:${project.color};margin-left:2px;">${escapeHtml(project.name)}</span>
      `;
      return;
    }
  }
  btn.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#d1d5db;flex-shrink:0;display:inline-block;"></span>`;
}

// Render the options list inside an open picker dropdown
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
    opt.addEventListener('mouseout', () => { opt.style.background = ''; });
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onClick();
    });
    container.appendChild(opt);
  };

  // None option (always first)
  makeOption('None', null, () => {
    assignProjectToTask(activePickerTaskId, null);
    hideProjectPicker();
  });

  // Filtered project options
  filtered.forEach(p => {
    makeOption(p.name, p.color, () => {
      assignProjectToTask(activePickerTaskId, p.id);
      hideProjectPicker();
    });
  });

  // Create new project option
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
    createOpt.addEventListener('mouseout', () => { createOpt.style.background = ''; });
    createOpt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const project = createProject(query);
      assignProjectToTask(activePickerTaskId, project.id);
      hideProjectPicker();
    });
    container.appendChild(createOpt);
  }
}

// Show a project picker dropdown anchored below an element
function showProjectPicker(anchorEl, taskId) {
  hideProjectPicker();
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
  const left = rect.left + pickerWidth > window.innerWidth
    ? rect.right - pickerWidth
    : rect.left;
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${left}px`;

  renderPickerOptions(optionsList, '');

  inputEl.addEventListener('input', () => renderPickerOptions(optionsList, inputEl.value));
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectPicker(); });
  inputEl.addEventListener('blur', () => setTimeout(hideProjectPicker, 100));

  setTimeout(() => inputEl.focus(), 0);
}

// Remove the picker from the DOM
function hideProjectPicker() {
  if (activePicker) {
    activePicker.remove();
    activePicker = null;
    activePickerTaskId = null;
  }
}

// Load tasks from storage
async function loadTasks() {
  const data = await ipcRenderer.invoke('load-tasks');
  tasks = data.tasks || [];
  projects = data.projects || [];
  renderTasks();
}

// Save tasks to storage
async function saveTasks() {
  await ipcRenderer.invoke('save-tasks', { tasks, projects });
}

// Update badge count on menu bar icon
function updateBadge() {
  const uncompletedCount = tasks.filter(t => !t.completed).length;
  ipcRenderer.invoke('update-badge', uncompletedCount);
}

// Add a new task
function addTask(text) {
  const task = {
    id: generateId(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    projectId: pendingProjectId || null
  };
  tasks.unshift(task);
  pendingProjectId = null;
  saveTasks();
  renderTasks();
  updateInputProjectButton();
}

// Toggle task completion
function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    saveTasks();
    renderTasks();
  }
}

// Delete a task
function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  renderTasks();
}

// Format a past date as a readable label
function formatDate(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  if (date.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

// Render task list
function renderTasks() {
  const container = document.getElementById('task-list');

  const uncompleted = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const completedToday = completed
    .filter(t => {
      if (!t.completedAt) return false;
      const d = new Date(t.completedAt);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === todayStart.getTime();
    })
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const completedPast = completed
    .filter(t => {
      if (!t.completedAt) return false;
      const d = new Date(t.completedAt);
      d.setHours(0, 0, 0, 0);
      return d.getTime() < todayStart.getTime();
    })
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  let html = '';

  // Uncompleted tasks
  uncompleted.forEach(task => {
    html += renderTaskRow(task);
  });

  // Completed section
  if (completed.length > 0) {
    const hasHistory = completedPast.length > 0;

    html += `
      <div class="flex items-center justify-between px-3 pt-3 pb-1 ${uncompleted.length > 0 ? 'border-t border-gray-100 mt-1' : ''}">
        <span class="text-xs font-medium text-gray-400 uppercase tracking-wider">Completed today</span>
        ${hasHistory ? `
          <button id="history-toggle" class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ${showHistory ? 'Hide history' : 'History'}
          </button>
        ` : ''}
      </div>
    `;

    completedToday.forEach(task => {
      html += renderTaskRow(task);
    });

    if (showHistory) {
      // Group past tasks by day
      const groups = new Map();
      completedPast.forEach(task => {
        const d = new Date(task.completedAt);
        d.setHours(0, 0, 0, 0);
        const key = d.getTime();
        if (!groups.has(key)) groups.set(key, { date: d, tasks: [] });
        groups.get(key).tasks.push(task);
      });

      [...groups.values()]
        .sort((a, b) => b.date - a.date)
        .forEach(({ date, tasks: dayTasks }) => {
          html += `
            <div class="px-3 pt-3 pb-1">
              <span class="text-xs font-medium text-gray-400 uppercase tracking-wider">${formatDate(date)}</span>
            </div>
          `;
          dayTasks.forEach(task => {
            html += renderTaskRow(task);
          });
        });
    }
  }

  // Empty state
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

  // History toggle listener
  const historyBtn = container.querySelector('#history-toggle');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      showHistory = !showHistory;
      renderTasks();
    });
  }

  // Checkbox listeners
  container.querySelectorAll('.task-checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', () => toggleTask(checkbox.dataset.id));
  });

  // Delete listeners
  container.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(btn.dataset.id);
    });
  });

  // Project pill listeners (assigned tasks)
  container.querySelectorAll('.project-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      showProjectPicker(pill, pill.dataset.taskId);
    });
  });

  // Project tag icon listeners (unassigned tasks)
  container.querySelectorAll('.project-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showProjectPicker(btn, btn.dataset.taskId);
    });
  });

  // Drag-to-reorder listeners (uncompleted tasks only)
  container.querySelectorAll('.task-row').forEach(row => {
    if (!row.draggable) return;

    row.addEventListener('dragstart', (e) => {
      draggedId = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { row.style.opacity = '0.4'; }, 0);
    });

    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      clearDropIndicators();
      draggedId = null;
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row.dataset.id === draggedId) return;
      e.dataTransfer.dropEffect = 'move';
      clearDropIndicators();
      row.style.borderTop = '2px solid #a5b4fc';
    });

    row.addEventListener('dragleave', () => {
      row.style.borderTop = '';
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetId = row.dataset.id;
      if (!draggedId || draggedId === targetId) return;

      const uncompleted = tasks.filter(t => !t.completed);
      const completed = tasks.filter(t => t.completed);

      const fromIdx = uncompleted.findIndex(t => t.id === draggedId);
      const toIdx = uncompleted.findIndex(t => t.id === targetId);

      if (fromIdx !== -1 && toIdx !== -1) {
        const [moved] = uncompleted.splice(fromIdx, 1);
        uncompleted.splice(toIdx, 0, moved);
        tasks = [...uncompleted, ...completed];
        saveTasks();
        renderTasks();
      }
    });
  });

  updateBadge();
}

function clearDropIndicators() {
  document.querySelectorAll('.task-row').forEach(r => {
    r.style.borderTop = '';
  });
}

// Render a single task row
function renderTaskRow(task) {
  const checkboxClass = task.completed ? 'checkbox checked' : 'checkbox';
  const textClass = task.completed
    ? 'text-sm text-gray-400 line-through'
    : 'text-sm text-gray-900';

  const draggableAttr = task.completed ? '' : 'draggable="true"';
  const dragHandle = task.completed
    ? '<div class="w-4 flex-shrink-0"></div>'
    : `<div class="flex-shrink-0 w-4 opacity-0 group-hover:opacity-100 cursor-grab text-gray-300 flex items-center" data-id="${task.id}">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 12 20">
          <circle cx="4" cy="4" r="1.5"/>
          <circle cx="4" cy="10" r="1.5"/>
          <circle cx="4" cy="16" r="1.5"/>
          <circle cx="9" cy="4" r="1.5"/>
          <circle cx="9" cy="10" r="1.5"/>
          <circle cx="9" cy="16" r="1.5"/>
        </svg>
      </div>`;

  // Project pill (assigned) or tag icon (unassigned, uncompleted only)
  let projectEl = '';
  if (task.projectId) {
    const project = projects.find(p => p.id === task.projectId);
    if (project) {
      projectEl = `
        <button class="project-pill flex-shrink-0 flex items-center gap-1" data-task-id="${task.id}"
          style="padding:1px 8px;font-size:11px;font-weight:500;border-radius:4px;background:${project.color}18;color:${project.color};border:1px solid ${project.color}30;cursor:pointer;white-space:nowrap;line-height:1.6;">
          <span style="width:5px;height:5px;border-radius:50%;background:${project.color};display:inline-block;flex-shrink:0;"></span>
          ${escapeHtml(project.name)}
        </button>
      `;
    }
  } else if (!task.completed) {
    projectEl = `
      <button class="project-tag-btn flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity" data-task-id="${task.id}" title="Assign project">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z"></path>
        </svg>
      </button>
    `;
  }

  return `
    <div class="task-row group flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors" ${draggableAttr} data-id="${task.id}">
      ${dragHandle}
      <div class="task-checkbox ${checkboxClass}" data-id="${task.id}">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
        </svg>
      </div>
      <span class="${textClass} flex-1">${escapeHtml(task.text)}</span>
      ${projectEl}
      <button class="task-delete opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity" data-id="${task.id}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    </div>
  `;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('task-input');
  const projectBtn = document.getElementById('project-picker-btn');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      addTask(input.value);
      input.value = '';
    }
  });

  projectBtn.addEventListener('click', () => {
    showProjectPicker(projectBtn, 'pending');
  });

  loadTasks();
});

// Focus input when window is shown
ipcRenderer.on('window-shown', () => {
  const input = document.getElementById('task-input');
  input.focus();
});

// Reload tasks (triggered at midnight)
ipcRenderer.on('reload-tasks', () => {
  loadTasks();
});
