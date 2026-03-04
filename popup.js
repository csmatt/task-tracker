// popup.js — Timer UI logic

let timers = [];
let displayInterval = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return 'timer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  return { h: pad(h), m: pad(m), s: pad(s) };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function saveTimers() {
  chrome.storage.local.set({ timers });
}

function loadTimers(cb) {
  chrome.storage.local.get('timers', data => {
    timers = data.timers || [];
    cb();
  });
}

// ── Core timer actions ────────────────────────────────────────────────────────

function startTimer(id) {
  const now = Date.now();
  timers = timers.map(t => {
    if (t.id === id) {
      return { ...t, running: true, lastTick: now };
    }
    // Pause all others
    if (t.running) {
      const elapsed = now - t.lastTick;
      return { ...t, running: false, elapsed: t.elapsed + elapsed };
    }
    return t;
  });
  saveTimers();
  renderTimers();
}

function pauseTimer(id) {
  const now = Date.now();
  timers = timers.map(t => {
    if (t.id === id && t.running) {
      const elapsed = now - t.lastTick;
      return { ...t, running: false, elapsed: t.elapsed + elapsed };
    }
    return t;
  });
  saveTimers();
  renderTimers();
}

function resetTimer(id) {
  timers = timers.map(t =>
    t.id === id ? { ...t, running: false, elapsed: 0, lastTick: Date.now() } : t
  );
  saveTimers();
  renderTimers();
}

function deleteTimer(id) {
  timers = timers.filter(t => t.id !== id);
  saveTimers();
  renderTimers();
}

function renameTimer(id, newName) {
  const name = newName.trim() || 'Timer';
  timers = timers.map(t => t.id === id ? { ...t, name } : t);
  saveTimers();
}

function addTimer(name) {
  const timer = {
    id: generateId(),
    name: name.trim() || 'Timer',
    elapsed: 0,
    running: false,
    lastTick: Date.now(),
  };
  timers.push(timer);
  saveTimers();
  renderTimers();
}

// ── Live elapsed for running timers (local calc, no storage writes) ───────────

function getLiveElapsed(timer) {
  if (!timer.running) return timer.elapsed;
  return timer.elapsed + (Date.now() - timer.lastTick);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTimers() {
  const list = document.getElementById('timerList');
  const empty = document.getElementById('emptyState');

  if (timers.length === 0) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  // Build set of existing card ids
  const existingIds = new Set([...list.querySelectorAll('.timer-card')].map(el => el.dataset.id));
  const newIds = new Set(timers.map(t => t.id));

  // Remove deleted
  existingIds.forEach(id => {
    if (!newIds.has(id)) {
      const el = list.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
    }
  });

  timers.forEach((timer, index) => {
    let card = list.querySelector(`[data-id="${timer.id}"]`);

    if (!card) {
      card = createTimerCard(timer);
      list.appendChild(card);
    }

    updateTimerCard(card, timer);
  });
}

function createTimerCard(timer) {
  const card = document.createElement('div');
  card.className = 'timer-card';
  card.dataset.id = timer.id;
  card.innerHTML = `
    <div class="timer-top">
      <div class="timer-name-wrap">
        <div class="status-dot"></div>
        <span class="timer-name" title="Click to rename">${escapeHtml(timer.name)}</span>
      </div>
      <button class="delete-btn" data-action="delete" title="Delete timer">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
    <div class="timer-display">
      <span class="t-h">00</span><span class="sep">:</span><span class="t-m">00</span><span class="sep">:</span><span class="t-s">00</span>
    </div>
    <div class="timer-controls">
      <button class="ctrl-btn play" data-action="start">
        <svg viewBox="0 0 24 24"><polygon class="icon-filled" points="5 3 19 12 5 21 5 3"/></svg>
        Continue
      </button>
      <button class="ctrl-btn pause" data-action="pause">
        <svg viewBox="0 0 24 24"><rect class="icon-filled" x="6" y="4" width="4" height="16"/><rect class="icon-filled" x="14" y="4" width="4" height="16"/></svg>
        Pause
      </button>
      <button class="ctrl-btn reset" data-action="reset">
        <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.52"/></svg>
        Reset
      </button>
      <button class="ctrl-btn copy" data-action="copy" title="Copy as fractional hours">
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      </button>
    </div>
  `;

  // Name click → inline edit
  const nameEl = card.querySelector('.timer-name');
  nameEl.addEventListener('click', () => startInlineEdit(card, timer.id));

  // Control buttons
  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = card.dataset.id;
    if (action === 'start') startTimer(id);
    else if (action === 'pause') pauseTimer(id);
    else if (action === 'reset') resetTimer(id);
    else if (action === 'delete') deleteTimer(id);
    else if (action === 'copy') copyFractionalHours(id, btn);
  });

  return card;
}

function updateTimerCard(card, timer) {
  const isRunning = timer.running;
  card.classList.toggle('running', isRunning);

  // Update time display
  const elapsed = getLiveElapsed(timer);
  const { h, m, s } = formatTime(elapsed);
  card.querySelector('.t-h').textContent = h;
  card.querySelector('.t-m').textContent = m;
  card.querySelector('.t-s').textContent = s;

  // Update button states
  const playBtn = card.querySelector('[data-action="start"]');
  const pauseBtn = card.querySelector('[data-action="pause"]');
  playBtn.disabled = isRunning;
  pauseBtn.disabled = !isRunning;
  playBtn.style.opacity = isRunning ? '0.35' : '1';
  pauseBtn.style.opacity = !isRunning ? '0.35' : '1';

  // Update name if not editing
  const nameEl = card.querySelector('.timer-name');
  if (nameEl) nameEl.textContent = timer.name;
}

function startInlineEdit(card, id) {
  const nameEl = card.querySelector('.timer-name');
  const timer = timers.find(t => t.id === id);
  if (!timer) return;

  const input = document.createElement('input');
  input.className = 'timer-name-input';
  input.value = timer.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = () => {
    renameTimer(id, input.value);
    const span = document.createElement('span');
    span.className = 'timer-name';
    span.title = 'Click to rename';
    span.textContent = input.value.trim() || 'Timer';
    span.addEventListener('click', () => startInlineEdit(card, id));
    input.replaceWith(span);
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = timer.name;
      input.blur();
    }
  });
}

function copyFractionalHours(id, btn) {
  const timer = timers.find(t => t.id === id);
  if (!timer) return;
  const elapsed = getLiveElapsed(timer);
  const fractional = (elapsed / 3600000).toFixed(1); // ms → hours, 1 decimal place
  navigator.clipboard.writeText(fractional).then(() => {
    // Flash feedback on button
    const original = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" style="stroke:currentColor;fill:none;stroke-width:2.5"/></svg> Copied!`;
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('copied');
    }, 1500);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Tick loop (updates display every 100ms without hammering storage) ─────────

function startDisplayLoop() {
  if (displayInterval) clearInterval(displayInterval);
  displayInterval = setInterval(() => {
    const list = document.getElementById('timerList');
    timers.forEach(timer => {
      const card = list.querySelector(`[data-id="${timer.id}"]`);
      if (card && timer.running) {
        const elapsed = getLiveElapsed(timer);
        const { h, m, s } = formatTime(elapsed);
        card.querySelector('.t-h').textContent = h;
        card.querySelector('.t-m').textContent = m;
        card.querySelector('.t-s').textContent = s;
      }
    });
  }, 100);
}

// Sync fresh data from storage periodically (background worker updates storage)
function startStorageSync() {
  setInterval(() => {
    chrome.storage.local.get('timers', data => {
      const fresh = data.timers || [];
      // Merge: update elapsed for running timers from storage, keep local for display
      fresh.forEach(ft => {
        const idx = timers.findIndex(t => t.id === ft.id);
        if (idx !== -1) {
          if (!timers[idx].running) {
            timers[idx].elapsed = ft.elapsed;
          }
        }
      });
    });
  }, 2000);
}

document.getElementById('resetAllBtn').addEventListener('click', () => {
  timers.forEach((timer) => resetTimer(timer.id));
});


// ── New timer form ────────────────────────────────────────────────────────────

document.getElementById('addBtn').addEventListener('click', () => {
  const form = document.getElementById('newTimerForm');
  form.classList.add('visible');
  document.getElementById('timerNameInput').focus();
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  document.getElementById('newTimerForm').classList.remove('visible');
  document.getElementById('timerNameInput').value = '';
});

document.getElementById('confirmBtn').addEventListener('click', () => {
  const name = document.getElementById('timerNameInput').value.trim() || 'Timer';
  addTimer(name);
  document.getElementById('timerNameInput').value = '';
  document.getElementById('newTimerForm').classList.remove('visible');
});

document.getElementById('timerNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('confirmBtn').click();
  if (e.key === 'Escape') document.getElementById('cancelBtn').click();
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadTimers(() => {
  renderTimers();
  startDisplayLoop();
  startStorageSync();
});
