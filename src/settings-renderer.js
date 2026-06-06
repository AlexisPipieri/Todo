const { ipcRenderer } = require('electron');
const { COLOR_PALETTE, getNextColor } = require('./task-store');

// ── Nav ──────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`section-${btn.dataset.section}`).classList.add('active');
  });
});

// ── State ─────────────────────────────────────────────────

let state = { tasks: [], projects: [] };
let sortDir = 'asc';

// ── Load ──────────────────────────────────────────────────

async function loadSettings() {
  const { loginItem, dataPath, version } = await ipcRenderer.invoke('get-settings');
  document.getElementById('login-item-toggle').checked = loginItem;
  document.getElementById('data-path').textContent = dataPath.replace(process.env.HOME, '~');
  document.getElementById('about-version').textContent = `Version ${version}`;
}

async function loadLabels() {
  state = await ipcRenderer.invoke('get-labels');
  state.projects = state.projects || [];
  state.tasks = state.tasks || [];
  renderLabels();
}

loadSettings();
loadLabels();

// ── Sort button ───────────────────────────────────────────

document.getElementById('sort-btn').addEventListener('click', () => {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  const icon = document.getElementById('sort-icon');
  icon.className = sortDir === 'asc' ? 'ph ph-arrow-up' : 'ph ph-arrow-down';
  renderLabels();
});

// ── Save labels ───────────────────────────────────────────

async function saveLabels() {
  await ipcRenderer.invoke('update-labels', state);
}

// ── Render labels ─────────────────────────────────────────

function sortedProjects() {
  return [...state.projects].sort((a, b) =>
    sortDir === 'asc'
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name)
  );
}

function taskCountForLabel(labelId) {
  return state.tasks.filter(t => t.projectId === labelId && !t.completed).length;
}

function renderLabels() {
  const list = document.getElementById('labels-list');
  list.innerHTML = '';

  if (state.projects.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size:13px;color:#a1a1aa;padding:12px 4px;margin:0;';
    empty.textContent = 'No labels yet.';
    list.appendChild(empty);
    return;
  }

  sortedProjects().forEach(label => {
    list.appendChild(makeLabelRow(label));
  });
}

function makeLabelRow(label, editMode = false) {
  const row = document.createElement('div');
  row.className = 'label-row';
  row.dataset.id = label.id;

  // Col 1: color dot
  const dot = document.createElement('button');
  dot.className = 'color-dot';
  dot.style.background = label.color;
  dot.style.color = label.color;
  dot.title = 'Change color';
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopovers();
    toggleSwatchPicker(row, label, dot);
  });

  // Col 2: name (text or input)
  let nameEl;
  if (editMode) {
    nameEl = document.createElement('input');
    nameEl.className = 'label-name-edit';
    nameEl.value = label.name;
    nameEl.spellcheck = false;

    const prevName = label.name;
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameEl.blur();
      if (e.key === 'Escape') { label.name = prevName; renderLabels(); }
    });
    nameEl.addEventListener('blur', () => {
      const trimmed = nameEl.value.trim();
      label.name = trimmed || prevName;
      saveLabels();
      renderLabels();
    });
  } else {
    nameEl = document.createElement('span');
    nameEl.className = 'label-name-text';
    nameEl.textContent = label.name;
  }

  // Col 3: task count
  const count = taskCountForLabel(label.id);
  const countEl = document.createElement('span');
  countEl.className = 'task-count';
  countEl.textContent = count > 0 ? `${count} task${count !== 1 ? 's' : ''}` : '—';

  // Col 4: ... action button
  const actionBtn = document.createElement('button');
  actionBtn.className = 'action-menu-btn';
  actionBtn.title = 'Actions';
  actionBtn.innerHTML = '<i class="ph ph-dots-three"></i>';
  actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (actionBtn.classList.contains('open')) {
      closeAllPopovers();
      return;
    }
    closeAllPopovers();
    showActionPopover(row, label, actionBtn);
  });

  row.appendChild(dot);
  row.appendChild(nameEl);
  row.appendChild(countEl);
  row.appendChild(actionBtn);

  if (editMode) {
    requestAnimationFrame(() => { nameEl.focus(); nameEl.select(); });
  }

  return row;
}

// ── Action popover ────────────────────────────────────────

function showActionPopover(row, label, triggerBtn) {
  triggerBtn.classList.add('open');

  const popover = document.createElement('div');
  popover.className = 'action-popover';

  const editItem = document.createElement('button');
  editItem.className = 'action-popover-item';
  editItem.innerHTML = '<i class="ph ph-pencil-simple"></i> Edit';
  editItem.addEventListener('click', () => {
    closeAllPopovers();
    enterEditMode(row, label);
  });

  const deleteItem = document.createElement('button');
  deleteItem.className = 'action-popover-item danger';
  deleteItem.innerHTML = '<i class="ph ph-trash"></i> Delete';
  deleteItem.addEventListener('click', () => {
    closeAllPopovers();
    const count = taskCountForLabel(label.id);
    const detail = count > 0
      ? `${count} task${count !== 1 ? 's' : ''} will lose this label.`
      : 'This action cannot be undone.';
    showConfirm(`Delete "${label.name}"?`, detail, () => deleteLabel(label.id));
  });

  popover.appendChild(editItem);
  popover.appendChild(deleteItem);
  row.appendChild(popover);

  const onOutside = (e) => {
    if (!popover.contains(e.target) && e.target !== triggerBtn) {
      closeAllPopovers();
      document.removeEventListener('click', onOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', onOutside), 0);
}

function enterEditMode(row, label) {
  const list = document.getElementById('labels-list');
  const newRow = makeLabelRow(label, true);
  list.replaceChild(newRow, row);
}

// ── Swatch picker ─────────────────────────────────────────

function toggleSwatchPicker(row, label, dot) {
  const picker = document.createElement('div');
  picker.className = 'swatch-picker';

  COLOR_PALETTE.forEach(color => {
    const swatch = document.createElement('button');
    swatch.className = 'swatch' + (color === label.color ? ' active' : '');
    swatch.style.background = color;
    swatch.style.color = color;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      label.color = color;
      dot.style.background = color;
      dot.style.color = color;
      picker.remove();
      saveLabels();
    });
    picker.appendChild(swatch);
  });

  row.appendChild(picker);

  const onOutside = (e) => {
    if (!picker.contains(e.target) && e.target !== dot) {
      picker.remove();
      document.removeEventListener('click', onOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', onOutside), 0);
}

function closeAllPopovers() {
  document.querySelectorAll('.action-popover, .swatch-picker').forEach(el => el.remove());
  document.querySelectorAll('.action-menu-btn.open').forEach(btn => btn.classList.remove('open'));
}

// ── Add label ─────────────────────────────────────────────

document.getElementById('add-label-btn').addEventListener('click', () => {
  closeAllPopovers();

  const newLabel = {
    id: crypto.randomUUID(),
    name: '',
    color: getNextColor(state.projects),
  };
  state.projects.push(newLabel);

  const list = document.getElementById('labels-list');
  list.querySelector('p')?.remove();

  const row = makeLabelRow(newLabel, true);
  list.appendChild(row);

  const input = row.querySelector('.label-name-edit');

  input.addEventListener('blur', () => {
    if (!newLabel.name) {
      state.projects = state.projects.filter(p => p.id !== newLabel.id);
      row.remove();
      if (state.projects.length === 0) renderLabels();
    } else {
      saveLabels();
    }
  }, { once: true });
});

// ── Confirm modal ─────────────────────────────────────────

function showConfirm(title, detail, onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.innerHTML = `
    <div class="confirm-modal">
      <p class="confirm-title">${title}</p>
      <p class="confirm-detail">${detail}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel-btn">Cancel</button>
        <button class="confirm-delete-btn">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('visible'));

  const close = () => {
    backdrop.classList.remove('visible');
    setTimeout(() => backdrop.remove(), 120);
  };

  backdrop.querySelector('.confirm-cancel-btn').addEventListener('click', close);
  backdrop.querySelector('.confirm-delete-btn').addEventListener('click', () => {
    close();
    onConfirm();
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
}

// ── Delete label ──────────────────────────────────────────

function deleteLabel(labelId) {
  state.projects = state.projects.filter(p => p.id !== labelId);
  state.tasks.forEach(t => { if (t.projectId === labelId) t.projectId = null; });
  saveLabels();
  renderLabels();
}

// ── General: login item toggle ────────────────────────────

document.getElementById('login-item-toggle').addEventListener('change', (e) => {
  ipcRenderer.invoke('set-login-item', e.target.checked);
});

// ── General: show in Finder ───────────────────────────────

document.getElementById('show-in-finder-btn').addEventListener('click', () => {
  ipcRenderer.invoke('show-in-finder');
});

// ── About: check for updates ──────────────────────────────

document.getElementById('check-updates-btn').addEventListener('click', () => {
  ipcRenderer.invoke('check-for-updates');
});
