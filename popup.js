// Theme logic
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const theme = isDark ? 'dark' : 'light';

chrome.action.setIcon({
  path: {
    "16": `assets/icon-${theme}-16.png`,
    "48": `assets/icon-${theme}-48.png`,
    "128": `assets/icon-${theme}-128.png`
  }
});

// popup.js — Timer UI logic

let timers = [];
let displayInterval = null;
let searchQuery = "";
let activeTag = null;
let undoStack = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return "timer_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return { h: pad(h), m: pad(m), s: pad(s) };
}

// ── Undo ─────────────────────────────────────────────────────────────────────

function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(timers)));
  if (undoStack.length > 20) undoStack.shift();
  updateUndoBtn();
}

function undo() {
  if (undoStack.length === 0) return;
  timers = undoStack.pop();
  saveTimers();
  renderTimers();
  updateUndoBtn();
}

function updateUndoBtn() {
  const btn = document.getElementById("undoBtn");
  if (btn) btn.disabled = undoStack.length === 0;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function saveTimers() {
  chrome.storage.local.set({ timers });
}

function loadTimers(cb) {
  chrome.storage.local.get("timers", (data) => {
    timers = data.timers || [];
    cb();
  });
}

// ── Core timer actions ────────────────────────────────────────────────────────

function startTimer(id) {
  // clear search box
  const searchInput = document.querySelector("#searchInput");
  searchInput.value = "";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));

  const now = Date.now();
  timers = timers.map((t) => {
    if (t.id === id) {
      return { ...t, running: true, lastTick: now, lastUsed: now };
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
  timers = timers.map((t) => {
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
  pushUndo();
  timers = timers.map((t) =>
    t.id === id
      ? { ...t, running: false, elapsed: 0, lastTick: Date.now() }
      : t,
  );
  saveTimers();
  renderTimers();
}

function deleteTimer(id) {
  pushUndo();
  timers = timers.filter((t) => t.id !== id);
  saveTimers();
  renderTimers();
}

function renameTimer(id, newName) {
  pushUndo();
  const name = newName.trim() || "Timer";
  timers = timers.map((t) => (t.id === id ? { ...t, name } : t));
  saveTimers();
}

function updateTimerElapsed(id, hours, minutes) {
  pushUndo();
  const h = Math.max(0, Math.min(24, parseInt(hours, 10) || 0));
  const m = Math.max(0, Math.min(59, parseInt(minutes, 10) || 0));
  const newElapsed = (h * 3600 + m * 60) * 1000;

  timers = timers.map((t) => {
    if (t.id === id) {
      return { ...t, elapsed: newElapsed, lastTick: Date.now() };
    }
    return t;
  });
  saveTimers();
  renderTimers();
}

function addTimer(name) {
  const now = Date.now();
  const trimmedName = name.trim() || "Timer";
  const existingTimer = timers.find((timer) => timer.name === trimmedName);
  if (existingTimer) {
    existingTimer.lastUsed = now;
  } else {
    pushUndo();

    const timer = {
      id: generateId(),
      name: trimmedName,
      elapsed: 0,
      running: false,
      lastTick: now,
      lastUsed: now,
      tags: [],
    };
    timers.unshift(timer);
  }
  saveTimers();
  renderTimers();
  cancelAddingNewTimer();
}

function addTag(id, tag) {
  pushUndo();
  const trimmed = tag.trim().toLowerCase();
  if (!trimmed) return;
  timers = timers.map((t) => {
    if (t.id === id && !(t.tags || []).includes(trimmed)) {
      return { ...t, tags: [...(t.tags || []), trimmed] };
    }
    return t;
  });

  saveTimers();
  renderTimers();
}

function removeTag(id, tag) {
  pushUndo();
  timers = timers.map((t) => {
    if (t.id === id) {
      return { ...t, tags: (t.tags || []).filter((tg) => tg !== tag) };
    }
    return t;
  });
  // If active tag was removed, clear filter if no timers have it anymore
  if (activeTag === tag && !timers.some((t) => (t.tags || []).includes(tag))) {
    activeTag = null;
  }
  saveTimers();
  renderTimers();
}

// ── Live elapsed ──────────────────────────────────────────────────────────────

function getLiveElapsed(timer) {
  if (!timer.running) return timer.elapsed;
  return timer.elapsed + (Date.now() - timer.lastTick);
}

// ── Total time ────────────────────────────────────────────────────────────────

function updateTotalTime() {
  const total = timers.reduce((sum, t) => sum + getLiveElapsed(t), 0);
  const totalMin = Math.floor(total / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const el = document.getElementById("totalTime");
  if (el) el.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Tag filter bar ────────────────────────────────────────────────────────────

function renderTagFilter() {
  const allTags = [...new Set(timers.flatMap((t) => t.tags || []))].sort();
  const bar = document.getElementById("tagFilter");
  if (!bar) return;

  if (allTags.length === 0) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  bar.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "tag-filter-btn" + (activeTag === null ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeTag = null;
    renderTagFilter();
    renderTimers();
  });
  bar.appendChild(allBtn);

  allTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className =
      "tag-filter-btn" + (activeTag === tag ? " active" : "");
    btn.textContent = tag;
    btn.addEventListener("click", () => {
      activeTag = activeTag === tag ? null : tag;
      renderTagFilter();
      renderTimers();
    });
    bar.appendChild(btn);
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTimers() {
  const list = document.getElementById("timerList");
  const empty = document.getElementById("emptyState");

  if (timers.length === 0) {
    [...list.querySelectorAll(".timer-card")].forEach((c) => c.remove());
    list.appendChild(empty);
    empty.style.display = "block";
    updateTotalTime();
    renderTagFilter();
    return;
  }

  empty.style.display = "none";

  const search = searchQuery.toLowerCase();
  const sorted = [...timers].sort(
    (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0),
  );

  const allTimerIds = new Set(timers.map((t) => t.id));

  // Remove cards for deleted timers only
  [...list.querySelectorAll(".timer-card")].forEach((card) => {
    if (!allTimerIds.has(card.dataset.id)) card.remove();
  });

  // Create / update — use CSS order instead of DOM movement to avoid repaints
  sorted.forEach((timer, index) => {
    let card = list.querySelector(`[data-id="${timer.id}"]`);
    if (!card) {
      card = createTimerCard(timer);
      list.appendChild(card);
    }
    card.style.order = index;

    const visible =
      (!search || timer.name.toLowerCase().includes(search)) &&
      (!activeTag || (timer.tags || []).includes(activeTag));
    card.style.display = visible ? "" : "none";

    updateTimerCard(card, timer);
  });

  list?.scrollTo(0, 0);
  updateTotalTime();
  renderTagFilter();
}

function createTimerCard(timer) {
  const card = document.createElement("div");
  card.className = "timer-card";
  card.dataset.id = timer.id;
  card.innerHTML = `
    <div class="timer-top">
      <div class="timer-name-wrap">
        <div class="status-dot"></div>
        <span class="timer-name" title="Click to rename">${escapeHtml(timer.name)}</span>
      </div>
      <div class="timer-top-right">
        <button class="tag-add-btn" data-action="addtag" title="Add tag">
          <svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        </button>
        <button class="delete-btn" data-action="delete" title="Delete timer">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
    <div class="timer-tags" data-tags style="display:none"></div>
    <div class="timer-display" title="Click to edit time">
      <span class="t-h editable">00</span><span class="sep">:</span><span class="t-m editable">00</span><span class="sep">:</span><span class="t-s">00</span>
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
  const nameEl = card.querySelector(".timer-name");
  nameEl.addEventListener("click", () => startInlineNameEdit(card, timer.id));

  // Timer display click → time edit
  card.querySelectorAll(".editable").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", (e) =>
      startTimeEdit(card, timer.id, e.target),
    );
  });

  // Control buttons
  card.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = card.dataset.id;
    if (action === "start") startTimer(id);
    else if (action === "pause") pauseTimer(id);
    else if (action === "reset") resetTimer(id);
    else if (action === "delete") deleteTimer(id);
    else if (action === "copy") copyFractionalHours(id, btn);
    else if (action === "addtag") startTagInput(card, id);
  });

  return card;
}

function updateTimerCard(card, timer) {
  const isRunning = timer.running;
  card.classList.toggle("running", isRunning);

  // Update time display
  const elapsed = getLiveElapsed(timer);
  const { h, m, s } = formatTime(elapsed);
  card.querySelector(".t-h").textContent = h;
  card.querySelector(".t-m").textContent = m;
  card.querySelector(".t-s").textContent = s;

  // Update button states
  const playBtn = card.querySelector('[data-action="start"]');
  const pauseBtn = card.querySelector('[data-action="pause"]');
  playBtn.disabled = isRunning;
  pauseBtn.disabled = !isRunning;
  playBtn.style.opacity = isRunning ? "0.35" : "1";
  pauseBtn.style.opacity = !isRunning ? "0.35" : "1";

  // Update name if not editaddTing
  const nameEl = card.querySelector(".timer-name");
  if (nameEl) nameEl.textContent = timer.name;

  // Rebuild tags only when no input is active
  const tagsEl = card.querySelector("[data-tags]");
  if (tagsEl && !tagsEl.querySelector(".tag-input")) {
    renderCardTags(tagsEl, timer);
  }
}

function renderCardTags(tagsEl, timer) {
  tagsEl.innerHTML = "";
  const tags = timer.tags || [];

  if (tags.length === 0) {
    tagsEl.style.display = "none";
    return;
  }

  tagsEl.style.display = "flex";
  tags.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "tag-pill";

    const label = document.createElement("span");
    label.textContent = tag;

    const removeBtn = document.createElement("button");
    removeBtn.className = "tag-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTag(timer.id, tag);
    });

    pill.appendChild(label);
    pill.appendChild(removeBtn);
    tagsEl.appendChild(pill);
  });
}

function startTagInput(card, id) {
  const tagsEl = card.querySelector("[data-tags]");
  if (!tagsEl) return;

  // Prevent double inputs
  const existing = tagsEl.querySelector(".tag-input");
  if (existing) {
    existing.focus();
    return;
  }

  tagsEl.style.display = "flex";

  const input = document.createElement("input");
  input.className = "tag-input";
  input.placeholder = "tag...";
  input.maxLength = 20;
  tagsEl.appendChild(input);
  input.focus();

  let committed = false;
  const finish = () => {
    if (committed) return;
    committed = true;
    const val = input.value.trim();
    input.classList.remove("tag-input");
    if (val) {
      addTag(id, val); // triggers re-render
    } else {
      // Re-render tags to hide row if still empty
      const timer = timers.find((t) => t.id === id);
      if (timer) renderCardTags(tagsEl, timer);
    }
  };

  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      input.value = "";
      input.blur();
    }
  });
}

function startInlineNameEdit(card, id) {
  const nameEl = card.querySelector(".timer-name");
  const timer = timers.find((t) => t.id === id);
  if (!timer) return;

  const input = document.createElement("input");
  input.className = "timer-name-input";
  input.value = timer.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = () => {
    renameTimer(id, input.value);
    const span = document.createElement("span");
    span.className = "timer-name";
    span.title = "Click to rename";
    span.textContent = input.value.trim() || "Timer";
    span.addEventListener("click", () => startInlineNameEdit(card, id));
    input.replaceWith(span);
  };

  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = timer.name;
      input.blur();
    }
  });
}

function startTimeEdit(card, id, target) {
  const timerDisplay = card.querySelector(".timer-display");
  const timer = timers.find((t) => t.id === id);
  if (!timer) return;

  const elapsed = getLiveElapsed(timer);
  const { h, m } = formatTime(elapsed);

  const editContainer = document.createElement("div");
  editContainer.className = "timer-edit-container";
  editContainer.innerHTML = `
    <div class="timer-edit">
      <input class="timer-edit-input hours" type="number" min="0" max="24" value="${h}" placeholder="0">
      <span class="timer-edit-sep">:</span>
      <input class="timer-edit-input minutes" type="number" min="0" max="59" value="${m}" placeholder="0">
      <div class="timer-edit-buttons">
        <button class="edit-btn cancel-edit">Cancel</button>
        <button class="edit-btn confirm-edit">Update</button>
      </div>
    </div>
  `;

  timerDisplay.style.display = "none";
  timerDisplay.after(editContainer);

  const hoursInput = editContainer.querySelector(".timer-edit-input.hours");
  const minutesInput = editContainer.querySelector(".timer-edit-input.minutes");
  const cancelBtn = editContainer.querySelector(".cancel-edit");
  const confirmBtn = editContainer.querySelector(".confirm-edit");

  const inputToFocus = target.classList.contains("t-h")
    ? hoursInput
    : minutesInput;
  inputToFocus.focus();
  inputToFocus.select();

  const finish = () => {
    // Restore display
    timerDisplay.style.display = "block";
    editContainer.remove();
  };

  const confirm = () => {
    const newHours = hoursInput.value;
    const newMinutes = minutesInput.value;
    if (newHours !== "" && newMinutes !== "") {
      updateTimerElapsed(id, newHours, newMinutes);
    }
    finish();
  };

  confirmBtn.addEventListener("click", confirm);
  cancelBtn.addEventListener("click", finish);

  document.addEventListener("keydown", function handler(e) {
    if (e.key === "Enter") {
      confirm();
      document.removeEventListener("keydown", handler);
    }
    if (e.key === "Escape") {
      finish();
      document.removeEventListener("keydown", handler);
    }
  });
}

function copyFractionalHours(id, btn) {
  const timer = timers.find((t) => t.id === id);
  if (!timer) return;
  const elapsed = getLiveElapsed(timer);
  const fractional = (elapsed / 3600000).toFixed(1);
  navigator.clipboard.writeText(fractional).then(() => {
    // Flash feedback on button
    const original = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" style="stroke:currentColor;fill:none;stroke-width:2.5"/></svg> Copied!`;
    btn.classList.add("copied");
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove("copied");
    }, 1500);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Tick loop (updates display every 100ms without hammering storage) ─────────

function startDisplayLoop() {
  if (displayInterval) clearInterval(displayInterval);
  displayInterval = setInterval(() => {
    const list = document.getElementById("timerList");
    let hasRunning = false;
    timers.forEach((timer) => {
      if (timer.running) {
        hasRunning = true;
        const card = list.querySelector(`[data-id="${timer.id}"]`);
        if (card) {
          const elapsed = getLiveElapsed(timer);
          const { h, m, s } = formatTime(elapsed);
          card.querySelector(".t-h").textContent = h;
          card.querySelector(".t-m").textContent = m;
          card.querySelector(".t-s").textContent = s;
        }
      }
    });
    if (hasRunning) updateTotalTime();
  }, 100);
}

// Sync fresh data from storage periodically (background worker updates storage)
function startStorageSync() {
  setInterval(() => {
    chrome.storage.local.get("timers", (data) => {
      const fresh = data.timers || [];
      // Merge: update elapsed for running timers from storage, keep local for display
      fresh.forEach((ft) => {
        const idx = timers.findIndex((t) => t.id === ft.id);
        if (idx !== -1 && !timers[idx].running) {
          timers[idx].elapsed = ft.elapsed;
        }
      });
    });
  }, 2000);
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById("resetAllBtn").addEventListener("click", () => {
  pushUndo();
  const now = Date.now();
  timers = timers.map((t) => ({ ...t, running: false, elapsed: 0, lastTick: now }));
  saveTimers();
  renderTimers();
});

document.getElementById("addBtn").addEventListener("click", () => {
  const form = document.getElementById("newTimerForm");
  form.classList.add("visible");
  document.getElementById("timerNameInput").focus();
});

function cancelAddingNewTimer() {
  document.getElementById("newTimerForm").classList.remove("visible");
  document.getElementById("timerNameInput").value = "";
}

document.getElementById("cancelBtn").addEventListener("click", cancelAddingNewTimer);

document.getElementById("confirmBtn").addEventListener("click", () => {
  const name =
    document.getElementById("timerNameInput").value.trim() || "Timer";
  addTimer(name);
  document.getElementById("timerNameInput").value = "";
  document.getElementById("newTimerForm").classList.remove("visible");
});

document.getElementById("timerNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("confirmBtn").click();
  if (e.key === "Escape") document.getElementById("cancelBtn").click();
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderTimers();
});

document.getElementById("undoBtn").addEventListener("click", undo);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (!isTyping) {
      e.preventDefault();
      undo();
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadTimers(() => {
  renderTimers();
  startDisplayLoop();
  startStorageSync();
  updateUndoBtn();
});
