/* Lift Log — vanilla JS PWA. All state lives in localStorage; no network calls. */
(() => {
  'use strict';

  const STORAGE_KEY = 'liftlog.v1';

  /* ============================== Defaults ============================== */

  function defaultData() {
    const now = new Date().toISOString();
    return {
      version: 1,
      settings: { theme: 'system', weightUnit: 'lb', distanceUnit: 'mi' },
      exercises: [
        { id: 'ex_bench', name: 'Bench Press', kind: 'weight', goal: 225, archived: false, createdAt: now },
        { id: 'ex_squat', name: 'Squat', kind: 'weight', goal: 315, archived: false, createdAt: now },
        { id: 'ex_deadlift', name: 'Deadlift', kind: 'weight', goal: 405, archived: false, createdAt: now },
        { id: 'ex_pushups', name: 'Push-ups', kind: 'reps', goal: 50, archived: false, createdAt: now },
        { id: 'ex_bwsquats', name: 'Bodyweight Squats', kind: 'reps', goal: 50, archived: false, createdAt: now },
        { id: 'ex_pullups', name: 'Pull-ups', kind: 'reps', goal: 15, archived: false, createdAt: now },
        { id: 'ex_running', name: 'Running', kind: 'cardio', goalMetric: 'distance', goal: 5, archived: false, createdAt: now },
      ],
      entries: [],
    };
  }

  /* ============================== Store ============================== */

  let state = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { state = defaultData(); save(); return; }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.exercises) || !Array.isArray(parsed.entries)) throw new Error('bad shape');
      parsed.settings = Object.assign({ theme: 'system', weightUnit: 'lb', distanceUnit: 'mi' }, parsed.settings || {});
      state = parsed;
    } catch (e) {
      console.warn('Could not load saved data, starting fresh.', e);
      state = defaultData();
      save();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ============================== Unit helpers ============================== */

  const LB_PER_KG = 0.45359237;
  const KM_PER_MI = 1.609344;

  const Units = {
    lbToDisplay: (lb) => (state.settings.weightUnit === 'kg' ? lb * LB_PER_KG : lb),
    displayToLb: (v) => (state.settings.weightUnit === 'kg' ? v / LB_PER_KG : v),
    weightUnitLabel: () => state.settings.weightUnit,

    miToDisplay: (mi) => (state.settings.distanceUnit === 'km' ? mi * KM_PER_MI : mi),
    displayToMi: (v) => (state.settings.distanceUnit === 'km' ? v / KM_PER_MI : v),
    distanceUnitLabel: () => state.settings.distanceUnit,

    // pace stored canonically as seconds per mile
    secPerMiToDisplaySecPerUnit: (s) => (state.settings.distanceUnit === 'km' ? s / KM_PER_MI : s),
    displaySecPerUnitToSecPerMi: (s) => (state.settings.distanceUnit === 'km' ? s * KM_PER_MI : s),
  };

  function round(v, dp) {
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  function fmtWeight(lb) {
    if (lb == null || Number.isNaN(lb)) return '—';
    const v = Units.lbToDisplay(lb);
    return `${round(v, v < 10 ? 1 : 0)} ${Units.weightUnitLabel()}`;
  }
  function fmtReps(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${Math.round(n)} rep${Math.round(n) === 1 ? '' : 's'}`;
  }
  function fmtDistance(mi) {
    if (mi == null || Number.isNaN(mi)) return '—';
    const v = Units.miToDisplay(mi);
    return `${round(v, 2)} ${Units.distanceUnitLabel()}`;
  }
  function fmtSecShort(totalSec) {
    if (totalSec == null || Number.isNaN(totalSec)) return '—';
    const s = Math.round(totalSec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }
  function fmtPace(secPerMi) {
    if (secPerMi == null || Number.isNaN(secPerMi) || !Number.isFinite(secPerMi)) return '—';
    const s = Units.secPerMiToDisplaySecPerUnit(secPerMi);
    return `${fmtSecShort(s)} /${Units.distanceUnitLabel()}`;
  }
  function fmtDuration(totalSec) {
    if (totalSec == null || Number.isNaN(totalSec)) return '—';
    const s = Math.round(totalSec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }

  function todayISO() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }
  function fmtDateShort(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ============================== Derived data ============================== */

  function activeExercises() { return state.exercises.filter((e) => !e.archived); }
  function exerciseById(id) { return state.exercises.find((e) => e.id === id); }
  function entriesFor(exId) { return state.entries.filter((e) => e.exerciseId === exId); }

  // Per-entry scalar "value" used for trend charts & best/PR calculation.
  function entryValue(exercise, entry) {
    if (exercise.kind === 'weight') {
      const weights = (entry.sets || []).filter((s) => s.reps > 0).map((s) => s.weight);
      return weights.length ? Math.max(...weights) : null;
    }
    if (exercise.kind === 'reps') {
      const reps = (entry.sets || []).map((s) => s.reps).filter((r) => r != null);
      return reps.length ? Math.max(...reps) : null;
    }
    // cardio
    if (exercise.goalMetric === 'pace') {
      if (entry.distance > 0 && entry.duration > 0) return entry.duration / entry.distance; // sec per mile
      return null;
    }
    return entry.distance != null ? entry.distance : null;
  }

  function isLowerBetter(exercise) {
    return exercise.kind === 'cardio' && exercise.goalMetric === 'pace';
  }

  function best(exercise) {
    const vals = entriesFor(exercise.id).map((e) => entryValue(exercise, e)).filter((v) => v != null);
    if (!vals.length) return null;
    return isLowerBetter(exercise) ? Math.min(...vals) : Math.max(...vals);
  }

  function progressPct(exercise) {
    const b = best(exercise);
    if (b == null || !exercise.goal) return { pct: 0, achieved: false, best: b };
    let pct;
    if (isLowerBetter(exercise)) {
      pct = b <= 0 ? 0 : (exercise.goal / b) * 100;
    } else {
      pct = (b / exercise.goal) * 100;
    }
    return { pct: Math.max(0, pct), achieved: pct >= 100, best: b };
  }

  function formatValueForExercise(exercise, v) {
    if (v == null) return '—';
    if (exercise.kind === 'weight') return fmtWeight(v);
    if (exercise.kind === 'reps') return fmtReps(v);
    if (exercise.kind === 'cardio') return exercise.goalMetric === 'pace' ? fmtPace(v) : fmtDistance(v);
    return String(v);
  }

  function goalLabelForExercise(exercise) {
    if (exercise.kind === 'weight') return `Goal ${fmtWeight(exercise.goal)}`;
    if (exercise.kind === 'reps') return `Goal ${fmtReps(exercise.goal)}`;
    if (exercise.kind === 'cardio') return exercise.goalMetric === 'pace' ? `Goal ${fmtPace(exercise.goal)}` : `Goal ${fmtDistance(exercise.goal)}`;
    return '';
  }

  function kindBadge(exercise) {
    if (exercise.kind === 'weight') return 'Lift';
    if (exercise.kind === 'reps') return 'Bodyweight';
    if (exercise.kind === 'cardio') return exercise.goalMetric === 'pace' ? 'Run · pace' : 'Run · distance';
    return '';
  }

  /* ============================== Theme ============================== */

  function resolvedTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const root = document.documentElement;
    if (state.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.settings.theme);
    root.setAttribute('data-resolved-theme', resolvedTheme());
  }

  /* ============================== Toast ============================== */

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* ============================== Modal ============================== */

  const modalRoot = () => document.getElementById('modalRoot');
  const modalSheet = () => document.getElementById('modalSheet');

  function openModal(html) {
    modalSheet().innerHTML = `<div class="modal-handle"></div>${html}`;
    modalRoot().hidden = false;
  }
  function closeModal() {
    modalRoot().hidden = true;
    modalSheet().innerHTML = '';
  }

  function confirmDialog(title, body, confirmLabel, onConfirm, danger) {
    openModal(`
      <div class="modal-title-row"><h2>${escapeHtml(title)}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <p class="muted-text">${escapeHtml(body)}</p>
      <div class="btn-row" style="margin-top:18px;">
        <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmDialogBtn">${escapeHtml(confirmLabel)}</button>
      </div>
    `);
    document.getElementById('confirmDialogBtn').addEventListener('click', () => { closeModal(); onConfirm(); });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================== Dynamic set fields (shared by Log tab + edit modal) ============================== */

  function setRowHtml(kind, idx, set) {
    set = set || {};
    if (kind === 'weight') {
      const w = set.weight != null ? round(Units.lbToDisplay(set.weight), 2) : '';
      return `
        <div class="set-row set-row-3" data-set-idx="${idx}">
          <label class="field"><span class="field-label">Weight (${Units.weightUnitLabel()})</span>
            <input type="number" step="any" inputmode="decimal" class="set-weight" value="${w}" placeholder="0" /></label>
          <label class="field"><span class="field-label">Reps</span>
            <input type="number" step="1" min="0" inputmode="numeric" class="set-reps" value="${set.reps ?? ''}" placeholder="0" /></label>
          <label class="field"><span class="field-label">RPE</span>
            <input type="number" step="0.5" min="1" max="10" inputmode="decimal" class="set-rpe" value="${set.rpe ?? ''}" placeholder="opt." /></label>
          <button type="button" class="set-row-remove" data-action="remove-set" aria-label="Remove set">✕</button>
        </div>`;
    }
    // reps kind (bodyweight)
    const aw = set.addedWeight ? round(Units.lbToDisplay(set.addedWeight), 2) : '';
    return `
      <div class="set-row set-row-3" data-set-idx="${idx}">
        <label class="field"><span class="field-label">Reps</span>
          <input type="number" step="1" min="0" inputmode="numeric" class="set-reps" value="${set.reps ?? ''}" placeholder="0" /></label>
        <label class="field"><span class="field-label">Added wt (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" inputmode="decimal" class="set-addedweight" value="${aw}" placeholder="opt." /></label>
        <label class="field"><span class="field-label">RPE</span>
          <input type="number" step="0.5" min="1" max="10" inputmode="decimal" class="set-rpe" value="${set.rpe ?? ''}" placeholder="opt." /></label>
        <button type="button" class="set-row-remove" data-action="remove-set" aria-label="Remove set">✕</button>
      </div>`;
  }

  function cardioFieldsHtml(entry) {
    entry = entry || {};
    const dist = entry.distance != null ? round(Units.miToDisplay(entry.distance), 2) : '';
    const dur = entry.duration || 0;
    const mins = entry.duration != null ? Math.floor(dur / 60) : '';
    const secs = entry.duration != null ? dur % 60 : '';
    return `
      <div class="set-row" data-cardio="1">
        <label class="field"><span class="field-label">Distance (${Units.distanceUnitLabel()})</span>
          <input type="number" step="any" inputmode="decimal" id="cardioDistance" value="${dist}" placeholder="0" /></label>
        <div class="field"><span class="field-label">Time</span>
          <div style="display:flex; gap:6px;">
            <input type="number" step="1" min="0" inputmode="numeric" id="cardioMin" value="${mins}" placeholder="min" />
            <input type="number" step="1" min="0" max="59" inputmode="numeric" id="cardioSec" value="${secs}" placeholder="sec" />
          </div>
        </div>
      </div>`;
  }

  function renderDynamicFields(container, exercise, existingEntry) {
    if (!exercise) { container.innerHTML = ''; return; }
    if (exercise.kind === 'cardio') {
      container.innerHTML = `<div class="sets-wrap">${cardioFieldsHtml(existingEntry)}</div>`;
      return;
    }
    const sets = (existingEntry && existingEntry.sets && existingEntry.sets.length) ? existingEntry.sets : [{}];
    container.innerHTML = `
      <div class="sets-wrap" data-kind="${exercise.kind}">
        <div class="sets-label"><span class="field-label">Sets</span><button type="button" class="btn-ghost" data-action="add-set">+ Add set</button></div>
        <div class="sets-container">${sets.map((s, i) => setRowHtml(exercise.kind, i, s)).join('')}</div>
      </div>`;
    container.querySelector('[data-action="add-set"]').addEventListener('click', () => {
      const wrap = container.querySelector('.sets-container');
      const idx = wrap.children.length;
      wrap.insertAdjacentHTML('beforeend', setRowHtml(exercise.kind, idx, {}));
      wireSetRemoveButtons(container);
    });
    wireSetRemoveButtons(container);
  }

  function wireSetRemoveButtons(container) {
    container.querySelectorAll('[data-action="remove-set"]').forEach((btn) => {
      btn.onclick = () => {
        const wrap = container.querySelector('.sets-container');
        if (wrap.children.length <= 1) { toast('Keep at least one set, or pick a different exercise.'); return; }
        btn.closest('.set-row').remove();
      };
    });
  }

  function readDynamicFields(container, exercise) {
    if (exercise.kind === 'cardio') {
      const distV = parseFloat(container.querySelector('#cardioDistance').value);
      const minV = parseFloat(container.querySelector('#cardioMin').value) || 0;
      const secV = parseFloat(container.querySelector('#cardioSec').value) || 0;
      const hasDist = !Number.isNaN(distV) && distV > 0;
      const hasTime = minV > 0 || secV > 0;
      if (!hasDist && !hasTime) return null;
      return {
        distance: hasDist ? Units.displayToMi(distV) : null,
        duration: hasTime ? minV * 60 + secV : null,
      };
    }
    const rows = Array.from(container.querySelectorAll('.set-row'));
    const sets = [];
    for (const row of rows) {
      if (exercise.kind === 'weight') {
        const w = parseFloat(row.querySelector('.set-weight').value);
        const r = parseFloat(row.querySelector('.set-reps').value);
        const rpe = parseFloat(row.querySelector('.set-rpe').value);
        if (Number.isNaN(w) && Number.isNaN(r)) continue;
        sets.push({ weight: Number.isNaN(w) ? 0 : Units.displayToLb(w), reps: Number.isNaN(r) ? 0 : r, rpe: Number.isNaN(rpe) ? null : rpe });
      } else {
        const r = parseFloat(row.querySelector('.set-reps').value);
        const aw = parseFloat(row.querySelector('.set-addedweight').value);
        const rpe = parseFloat(row.querySelector('.set-rpe').value);
        if (Number.isNaN(r)) continue;
        sets.push({ reps: r, addedWeight: Number.isNaN(aw) ? 0 : Units.displayToLb(aw), rpe: Number.isNaN(rpe) ? null : rpe });
      }
    }
    return sets.length ? { sets } : null;
  }

  /* ============================== Rendering: Dashboard ============================== */

  function computeStreak() {
    const days = new Set(state.entries.map((e) => e.date));
    let streak = 0;
    let cursor = new Date(todayISO() + 'T00:00:00');
    // allow today to be "not yet logged" without breaking the streak
    if (!days.has(todayISO())) cursor.setDate(cursor.getDate() - 1);
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function renderSummary() {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekAgoIso = new Date(weekAgo.getTime() - weekAgo.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const sessionsThisWeek = new Set(state.entries.filter((e) => e.date >= weekAgoIso).map((e) => e.date)).size;
    const exWithGoals = activeExercises().filter((e) => e.goal);
    const goalsHit = exWithGoals.filter((e) => progressPct(e).achieved).length;
    const streak = computeStreak();

    document.getElementById('summaryRow').innerHTML = `
      <div class="stat-tile"><div class="value">${sessionsThisWeek}</div><div class="label">Days logged this week</div></div>
      <div class="stat-tile"><div class="value">${streak}</div><div class="label">Day streak</div></div>
      <div class="stat-tile"><div class="value">${goalsHit}/${exWithGoals.length}</div><div class="label">Goals reached</div></div>
    `;
  }

  function renderDashboard() {
    renderSummary();
    const list = activeExercises();
    const wrap = document.getElementById('exerciseCards');
    document.getElementById('dashboardEmpty').hidden = list.length > 0;
    wrap.innerHTML = list.map((ex) => {
      const { pct, achieved, best: b } = progressPct(ex);
      const entries = entriesFor(ex.id).slice().sort((a, c) => a.date.localeCompare(c.date));
      const trend = entries.map((e) => entryValue(ex, e));
      const fillPct = Math.min(100, pct);
      return `
        <div class="card ex-card" data-exercise-id="${ex.id}">
          <div class="ex-card-top">
            <div class="ex-card-name">${escapeHtml(ex.name)}</div>
            <div class="ex-card-badge">${kindBadge(ex)}</div>
          </div>
          <div class="ex-card-values">
            <div class="ex-card-current">${formatValueForExercise(ex, b)}</div>
            ${ex.goal ? `<div class="ex-card-goal">/ ${goalLabelForExercise(ex).replace('Goal ', '')}</div>` : ''}
          </div>
          ${ex.goal ? `
            <div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="width:${fillPct}%"></div></div>
            <div class="ex-card-foot">
              <span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}%`}</span>
            </div>` : ''}
          ${trend.filter((v) => v != null).length >= 2 ? `<div class="ex-card-spark">${Charts.sparkline(trend, { width: 280, height: 34 })}</div>` : ''}
        </div>`;
    }).join('');
    wrap.querySelectorAll('.ex-card').forEach((card) => {
      card.addEventListener('click', () => openExerciseDetail(card.getAttribute('data-exercise-id')));
    });
  }

  /* ============================== Rendering: Log tab ============================== */

  function populateExerciseSelect(select, { includeArchived = false } = {}) {
    const list = includeArchived ? state.exercises : activeExercises();
    select.innerHTML = list.map((ex) => `<option value="${ex.id}">${escapeHtml(ex.name)}${ex.archived ? ' (archived)' : ''}</option>`).join('')
      + `<option value="__add_new__">+ Add new exercise…</option>`;
  }

  function renderLogForm() {
    const select = document.getElementById('logExercise');
    const prevValue = select.value;
    populateExerciseSelect(select);
    if (prevValue && [...select.options].some((o) => o.value === prevValue)) select.value = prevValue;
    document.getElementById('logDate').value = document.getElementById('logDate').value || todayISO();
    const ex = exerciseById(select.value);
    renderDynamicFields(document.getElementById('logDynamicFields'), ex);
  }

  function renderRecentEntries() {
    const recent = state.entries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
    const wrap = document.getElementById('recentEntries');
    if (!recent.length) { wrap.innerHTML = `<p class="muted-text">Nothing logged yet — your first entry will show up here.</p>`; return; }
    wrap.innerHTML = recent.map((e) => entryRowHtml(e)).join('');
    wireEntryRowClicks(wrap);
  }

  function entrySummaryText(exercise, entry) {
    if (!exercise) return '';
    if (exercise.kind === 'weight') {
      return (entry.sets || []).map((s) => `${round(Units.lbToDisplay(s.weight), 1)}${Units.weightUnitLabel()}×${s.reps}`).join(', ');
    }
    if (exercise.kind === 'reps') {
      return (entry.sets || []).map((s) => `${s.reps}${s.addedWeight ? ` (+${round(Units.lbToDisplay(s.addedWeight), 1)}${Units.weightUnitLabel()})` : ''}`).join(', ') + ' reps';
    }
    const bits = [];
    if (entry.distance != null) bits.push(fmtDistance(entry.distance));
    if (entry.duration != null) bits.push(fmtDuration(entry.duration));
    if (entry.distance && entry.duration) bits.push(fmtPace(entry.duration / entry.distance));
    return bits.join(' · ');
  }

  function entryRowHtml(entry) {
    const ex = exerciseById(entry.exerciseId);
    return `
      <div class="entry-row" data-entry-id="${entry.id}">
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(ex ? ex.name : 'Deleted exercise')}</div>
          <div class="entry-row-sub">${escapeHtml(entrySummaryText(ex, entry))}${entry.note ? ` — “${escapeHtml(entry.note)}”` : ''}</div>
        </div>
        <div class="entry-row-date">${fmtDateShort(entry.date)}</div>
      </div>`;
  }

  function wireEntryRowClicks(container) {
    container.querySelectorAll('.entry-row[data-entry-id]').forEach((row) => {
      row.addEventListener('click', () => openEntryModal(row.getAttribute('data-entry-id')));
    });
  }

  function handleLogSubmit(ev) {
    ev.preventDefault();
    const select = document.getElementById('logExercise');
    const ex = exerciseById(select.value);
    if (!ex) { toast('Pick an exercise first.'); return; }
    const fields = readDynamicFields(document.getElementById('logDynamicFields'), ex);
    if (!fields) { toast('Enter at least one value before saving.'); return; }
    const date = document.getElementById('logDate').value || todayISO();
    const note = document.getElementById('logNote').value.trim();
    const entry = Object.assign({ id: genId('en'), exerciseId: ex.id, date, note: note || null }, fields);
    state.entries.push(entry);
    save();
    toast('Entry saved');
    document.getElementById('logNote').value = '';
    renderDynamicFields(document.getElementById('logDynamicFields'), ex);
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  /* ============================== Rendering: History ============================== */

  function renderHistoryFilter() {
    const select = document.getElementById('historyFilter');
    const prev = select.value;
    select.innerHTML = `<option value="__all__">All exercises</option>` + state.exercises.map((ex) => `<option value="${ex.id}">${escapeHtml(ex.name)}${ex.archived ? ' (archived)' : ''}</option>`).join('');
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
  }

  function renderHistory() {
    renderHistoryFilter();
    const filter = document.getElementById('historyFilter').value || '__all__';
    const list = state.entries
      .filter((e) => filter === '__all__' || e.exerciseId === filter)
      .slice()
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    document.getElementById('historyEmpty').hidden = list.length > 0;
    const wrap = document.getElementById('historyList');
    wrap.innerHTML = list.map((e) => entryRowHtml(e)).join('');
    wireEntryRowClicks(wrap);
  }

  /* ============================== Entry modal (edit/delete) ============================== */

  function openEntryModal(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const ex = exerciseById(entry.exerciseId);
    openModal(`
      <div class="modal-title-row"><h2>Edit entry</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <p class="muted-text" style="margin-bottom:12px;">${escapeHtml(ex ? ex.name : 'Deleted exercise')}</p>
      <div class="form-card">
        <label class="field"><span class="field-label">Date</span><input type="date" id="editEntryDate" value="${entry.date}" /></label>
        <div id="editEntryFields"></div>
        <label class="field"><span class="field-label">Note</span><input type="text" id="editEntryNote" value="${entry.note ? escapeHtml(entry.note) : ''}" maxlength="200" /></label>
        <div class="btn-row">
          <button class="btn btn-primary btn-block" id="saveEntryBtn">Save changes</button>
        </div>
        <button class="btn btn-danger btn-block" id="deleteEntryBtn">Delete entry</button>
      </div>
    `);
    if (ex) renderDynamicFields(document.getElementById('editEntryFields'), ex, entry);
    document.getElementById('saveEntryBtn').addEventListener('click', () => {
      if (!ex) { closeModal(); return; }
      const fields = readDynamicFields(document.getElementById('editEntryFields'), ex);
      if (!fields) { toast('Enter at least one value.'); return; }
      entry.date = document.getElementById('editEntryDate').value || entry.date;
      entry.note = document.getElementById('editEntryNote').value.trim() || null;
      Object.assign(entry, fields);
      save();
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.entries = state.entries.filter((e) => e.id !== entryId);
        save();
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  /* ============================== Exercise detail modal ============================== */

  function openExerciseDetail(exId) {
    const ex = exerciseById(exId);
    if (!ex) return;
    const entries = entriesFor(exId).slice().sort((a, b) => a.date.localeCompare(b.date));
    const chartPoints = entries.map((e) => ({ date: e.date, value: entryValue(ex, e) })).filter((p) => p.value != null);
    const { pct, achieved, best: b } = progressPct(ex);

    let totalStat = '—';
    if (ex.kind === 'weight') totalStat = `${entries.reduce((n, e) => n + (e.sets || []).length, 0)} sets logged`;
    else if (ex.kind === 'reps') totalStat = `${entries.reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (s.reps || 0), 0), 0)} total reps`;
    else totalStat = `${fmtDistance(entries.reduce((n, e) => n + (e.distance || 0), 0))} total`;

    openModal(`
      <div class="modal-title-row"><h2>${escapeHtml(ex.name)}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <div class="ex-card-badge" style="display:inline-block; margin-bottom:10px;">${kindBadge(ex)}</div>
      <div class="ex-card-values">
        <div class="ex-card-current">${formatValueForExercise(ex, b)}</div>
        ${ex.goal ? `<div class="ex-card-goal">/ ${goalLabelForExercise(ex).replace('Goal ', '')}</div>` : ''}
      </div>
      ${ex.goal ? `<div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}% to goal`}</span></div>` : ''}

      <div class="pr-grid">
        <div class="pr-tile"><div class="value">${entries.length}</div><div class="label">Sessions logged</div></div>
        <div class="pr-tile"><div class="value">${totalStat}</div><div class="label">Lifetime total</div></div>
      </div>

      <div style="margin: 12px 0;">${Charts.lineChart(chartPoints, { goal: ex.goal, formatValue: (v) => formatValueForExercise(ex, v) })}</div>

      <div class="btn-row">
        <button class="btn btn-secondary" id="editExerciseBtn">Edit exercise</button>
        <button class="btn btn-secondary" id="archiveExerciseBtn">${ex.archived ? 'Unarchive' : 'Archive'}</button>
      </div>

      <div class="section-head"><h2>All entries</h2></div>
      <div class="entry-list" id="exerciseEntryList">${entries.slice().reverse().map((e) => entryRowHtml(e)).join('') || '<p class="muted-text">No entries yet.</p>'}</div>
    `);
    wireEntryRowClicks(document.getElementById('exerciseEntryList'));
    document.getElementById('editExerciseBtn').addEventListener('click', () => openExerciseForm(ex.id));
    document.getElementById('archiveExerciseBtn').addEventListener('click', () => {
      ex.archived = !ex.archived;
      save();
      closeModal();
      toast(ex.archived ? 'Exercise archived' : 'Exercise unarchived');
      renderAll();
    });
  }

  /* ============================== Add / edit exercise modal ============================== */

  function openExerciseForm(exId) {
    const editing = !!exId;
    const ex = editing ? exerciseById(exId) : null;
    const hasEntries = editing && entriesFor(exId).length > 0;
    const kind = ex ? ex.kind : 'weight';
    const goalMetric = ex ? (ex.goalMetric || 'distance') : 'distance';

    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit exercise' : 'Add exercise'}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Name</span>
          <input type="text" id="exName" value="${ex ? escapeHtml(ex.name) : ''}" placeholder="e.g. Overhead Press" maxlength="60" /></label>

        <div class="field">
          <span class="field-label">Type${hasEntries ? ' (locked — has logged entries)' : ''}</span>
          <div class="segmented" id="exKindSegmented" role="radiogroup">
            <button type="button" data-kind="weight" role="radio" ${hasEntries && kind !== 'weight' ? 'disabled' : ''}>Weighted lift</button>
            <button type="button" data-kind="reps" role="radio" ${hasEntries && kind !== 'reps' ? 'disabled' : ''}>Bodyweight reps</button>
            <button type="button" data-kind="cardio" role="radio" ${hasEntries && kind !== 'cardio' ? 'disabled' : ''}>Cardio</button>
          </div>
        </div>

        <div class="field" id="cardioMetricField" hidden>
          <span class="field-label">Goal type</span>
          <div class="segmented" id="exGoalMetricSegmented" role="radiogroup">
            <button type="button" data-metric="distance" role="radio">Distance</button>
            <button type="button" data-metric="pace" role="radio">Pace</button>
          </div>
        </div>

        <div id="goalFieldWrap"></div>

        <button type="button" class="btn btn-primary btn-block" id="saveExerciseBtn">${editing ? 'Save changes' : 'Add exercise'}</button>
        ${editing ? `<button type="button" class="btn btn-danger btn-block" id="deleteExerciseBtn">${hasEntries ? 'Archive exercise' : 'Delete exercise'}</button>` : ''}
      </div>
    `);

    let selectedKind = kind;
    let selectedMetric = goalMetric;

    function renderGoalField() {
      const wrap = document.getElementById('goalFieldWrap');
      document.getElementById('cardioMetricField').hidden = selectedKind !== 'cardio';
      if (selectedKind === 'weight') {
        const v = ex && ex.goal ? round(Units.lbToDisplay(ex.goal), 1) : '';
        wrap.innerHTML = `<label class="field"><span class="field-label">Goal weight (${Units.weightUnitLabel()})</span><input type="number" step="any" id="goalInput" value="${v}" placeholder="e.g. 225" /></label>`;
      } else if (selectedKind === 'reps') {
        const v = ex && ex.goal ? ex.goal : '';
        wrap.innerHTML = `<label class="field"><span class="field-label">Goal reps (single set)</span><input type="number" step="1" min="1" id="goalInput" value="${v}" placeholder="e.g. 20" /></label>`;
      } else if (selectedMetric === 'distance') {
        const v = ex && ex.goal ? round(Units.miToDisplay(ex.goal), 2) : '';
        wrap.innerHTML = `<label class="field"><span class="field-label">Goal distance (${Units.distanceUnitLabel()})</span><input type="number" step="any" id="goalInput" value="${v}" placeholder="e.g. 5" /></label>`;
      } else {
        const secPerUnit = ex && ex.goal ? Units.secPerMiToDisplaySecPerUnit(ex.goal) : null;
        const mins = secPerUnit != null ? Math.floor(secPerUnit / 60) : '';
        const secs = secPerUnit != null ? Math.round(secPerUnit % 60) : '';
        wrap.innerHTML = `<div class="field"><span class="field-label">Goal pace (min:sec per ${Units.distanceUnitLabel()})</span>
          <div style="display:flex; gap:6px;"><input type="number" step="1" min="0" id="goalPaceMin" value="${mins}" placeholder="min" /><input type="number" step="1" min="0" max="59" id="goalPaceSec" value="${secs}" placeholder="sec" /></div></div>`;
      }
    }

    function setKindUI(k) {
      selectedKind = k;
      document.querySelectorAll('#exKindSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
      renderGoalField();
    }
    function setMetricUI(m) {
      selectedMetric = m;
      document.querySelectorAll('#exGoalMetricSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.metric === m)));
      renderGoalField();
    }

    document.querySelectorAll('#exKindSegmented button').forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) setKindUI(b.dataset.kind); });
    });
    document.querySelectorAll('#exGoalMetricSegmented button').forEach((b) => {
      b.addEventListener('click', () => setMetricUI(b.dataset.metric));
    });
    setKindUI(selectedKind);
    setMetricUI(selectedMetric);

    document.getElementById('saveExerciseBtn').addEventListener('click', () => {
      const name = document.getElementById('exName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      let goal = null;
      if (selectedKind === 'weight' || selectedKind === 'reps' || (selectedKind === 'cardio' && selectedMetric === 'distance')) {
        const raw = parseFloat(document.getElementById('goalInput').value);
        if (!Number.isNaN(raw) && raw > 0) {
          goal = selectedKind === 'weight' ? Units.displayToLb(raw) : selectedKind === 'reps' ? raw : Units.displayToMi(raw);
        }
      } else {
        const m = parseFloat(document.getElementById('goalPaceMin').value) || 0;
        const s = parseFloat(document.getElementById('goalPaceSec').value) || 0;
        if (m > 0 || s > 0) goal = Units.displaySecPerUnitToSecPerMi(m * 60 + s);
      }
      if (editing) {
        ex.name = name;
        ex.kind = selectedKind;
        if (selectedKind === 'cardio') ex.goalMetric = selectedMetric; else delete ex.goalMetric;
        ex.goal = goal;
      } else {
        const newEx = { id: genId('ex'), name, kind: selectedKind, goal, archived: false, createdAt: new Date().toISOString() };
        if (selectedKind === 'cardio') newEx.goalMetric = selectedMetric;
        state.exercises.push(newEx);
      }
      save();
      closeModal();
      toast(editing ? 'Exercise updated' : 'Exercise added');
      renderAll();
    });

    if (editing) {
      document.getElementById('deleteExerciseBtn').addEventListener('click', () => {
        if (hasEntries) {
          ex.archived = true; save(); closeModal(); toast('Exercise archived'); renderAll();
        } else {
          confirmDialog('Delete exercise?', 'This exercise has no logged entries, so it will be removed entirely.', 'Delete', () => {
            state.exercises = state.exercises.filter((e) => e.id !== exId);
            save(); closeModal(); toast('Exercise deleted'); renderAll();
          }, true);
        }
      });
    }
  }

  /* ============================== Settings ============================== */

  function renderSettings() {
    document.querySelectorAll('#themeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === state.settings.theme)));
    document.querySelectorAll('#weightUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.weightUnit)));
    document.querySelectorAll('#distanceUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.distanceUnit)));

    const wrap = document.getElementById('exerciseManageList');
    wrap.innerHTML = state.exercises.map((ex) => `
      <div class="entry-row is-manage" data-exercise-id="${ex.id}">
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(ex.name)} ${ex.archived ? '<span class="chip chip-archived">archived</span>' : ''}</div>
          <div class="entry-row-sub">${kindBadge(ex)}${ex.goal ? ` · ${goalLabelForExercise(ex)}` : ' · no goal set'}</div>
        </div>
        <div class="entry-row-actions">
          <button class="btn btn-secondary btn-sm" data-action="edit-exercise" data-id="${ex.id}">Edit</button>
        </div>
      </div>`).join('');
    wrap.querySelectorAll('[data-action="edit-exercise"]').forEach((btn) => btn.addEventListener('click', () => openExerciseForm(btn.dataset.id)));
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lift-log-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.exercises) || !Array.isArray(parsed.entries)) throw new Error('bad shape');
        confirmDialog('Replace all data?', 'Importing will overwrite everything currently in the app with this backup file.', 'Import', () => {
          parsed.settings = Object.assign({ theme: 'system', weightUnit: 'lb', distanceUnit: 'mi' }, parsed.settings || {});
          state = parsed;
          save();
          applyTheme();
          renderAll();
          toast('Backup imported');
        }, true);
      } catch (e) {
        toast('That file doesn’t look like a valid Lift Log backup.');
      }
    };
    reader.readAsText(file);
  }

  /* ============================== Tabs / global wiring ============================== */

  function switchTab(tab) {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'log') renderLogForm();
    if (tab === 'history') renderHistory();
    if (tab === 'settings') renderSettings();
  }

  function renderAll() {
    applyTheme();
    renderDashboard();
    renderLogForm();
    renderRecentEntries();
    renderHistory();
    renderSettings();
  }

  function wireEvents() {
    document.getElementById('tabbar').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (btn) switchTab(btn.dataset.tab);
    });

    document.getElementById('quickThemeToggle').addEventListener('click', () => {
      const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
      state.settings.theme = next;
      save();
      applyTheme();
      renderSettings();
    });

    document.getElementById('logExercise').addEventListener('change', (ev) => {
      if (ev.target.value === '__add_new__') {
        openExerciseForm(null);
        ev.target.value = '';
        return;
      }
      renderDynamicFields(document.getElementById('logDynamicFields'), exerciseById(ev.target.value));
    });
    document.getElementById('logForm').addEventListener('submit', handleLogSubmit);

    document.getElementById('historyFilter').addEventListener('change', renderHistory);

    document.getElementById('themeSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.theme = btn.dataset.themeChoice; save(); applyTheme(); renderSettings();
    });
    document.getElementById('weightUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.weightUnit = btn.dataset.unitChoice; save(); renderAll();
    });
    document.getElementById('distanceUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.distanceUnit = btn.dataset.unitChoice; save(); renderAll();
    });

    document.querySelectorAll('[data-action="add-exercise"]').forEach((btn) => btn.addEventListener('click', () => openExerciseForm(null)));

    document.getElementById('exportBtn').addEventListener('click', exportBackup);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      if (file) importBackup(file);
      ev.target.value = '';
    });

    document.getElementById('modalBackdrop').addEventListener('click', closeModal);
    document.body.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-action="close-modal"]')) closeModal();
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (state.settings.theme === 'system') applyTheme();
      });
    }
  }

  /* ============================== Init ============================== */

  function init() {
    load();
    applyTheme();
    document.getElementById('logDate').value = todayISO();
    wireEvents();
    renderAll();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker registration failed', e));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
