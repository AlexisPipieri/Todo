const { ipcRenderer } = require('electron');

let tasks = [];

// Generate UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Load tasks from storage
async function loadTasks() {
  const data = await ipcRenderer.invoke('load-tasks');
  tasks = data.tasks || [];
  renderTasks();
}

// Save tasks to storage
async function saveTasks() {
  await ipcRenderer.invoke('save-tasks', { tasks });
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
    completedAt: null
  };
  tasks.unshift(task);
  saveTasks();
  renderTasks();
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

// Render task list
function renderTasks() {
  const container = document.getElementById('task-list');

  // Separate completed and uncompleted tasks
  const uncompleted = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);

  // Sort: newest first within each group
  uncompleted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  completed.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  let html = '';

  // Render uncompleted tasks
  uncompleted.forEach(task => {
    html += renderTaskRow(task);
  });

  // Add divider if there are both completed and uncompleted tasks
  if (uncompleted.length > 0 && completed.length > 0) {
    html += '<div class="border-t border-gray-100 mx-3"></div>';
  }

  // Render completed tasks
  completed.forEach(task => {
    html += renderTaskRow(task);
  });

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

  // Attach event listeners
  container.querySelectorAll('.task-checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', () => {
      toggleTask(checkbox.dataset.id);
    });
  });

  container.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(btn.dataset.id);
    });
  });

  // Update badge count
  updateBadge();
}

// Render a single task row
function renderTaskRow(task) {
  const checkboxClass = task.completed ? 'checkbox checked' : 'checkbox';
  const textClass = task.completed
    ? 'text-sm text-gray-400 line-through'
    : 'text-sm text-gray-900';

  return `
    <div class="group flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
      <div class="task-checkbox ${checkboxClass}" data-id="${task.id}">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
        </svg>
      </div>
      <span class="${textClass} flex-1">${escapeHtml(task.text)}</span>
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

  // Handle Enter key to add task
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      addTask(input.value);
      input.value = '';
    }
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
