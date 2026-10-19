/* ============================================================================
   FIT LOG - app.js
   Plain HTML/CSS/JavaScript: no build step, no framework, no libraries. index.html holds
   every screen as a <section>; this file shows and hides them. All data lives in
   localStorage on the device and is never sent over the network.

   One IIFE, split into sections marked by banner comments (search for a section's name
   to jump to it). Pure logic lives in other files:
     js/migrations.js  schema version and migrations (additive only)
     js/units.js       unit conversion and number formatting
     js/calc.js        streak, sleep and estimated-1RM calculators
     js/features.js    feature on/off rules (Lifting, Running & cardio, Habits)
     js/standards.js   reference tables and nutrition maths
     js/icons.js       ITEM_ICONS data
     js/catalog.js, js/backup.js, js/charts.js

   Sections here, in order: Defaults, Store, Unit helpers, Derived data, Progressive-overload
   suggestion engine, Body & wellness trackers, Insights & standards, Water, Food / nutrition,
   Theme, Toast, Modal, Chip picker, Dynamic set fields, Rendering: Dashboard, Returning-user
   setup review, Home sections, Rendering: Log tab, Organization, Catalog & equipment
   variants, Item icons, Saved Foods, Rendering: History, Entry modal, Exercise detail
   modal, Add / edit exercise modal, Tracker detail modal, Add / edit tracker modal, Water:
   cup management, Manage, Settings, Backup validation, First-run setup wizard, Tabs /
   global wiring, Data recovery screen, Init.

   Data flow: an event handler updates `state`, calls save(), then calls the render*()
   functions for whatever changed. See README.md for a walkthrough and common changes.
   ============================================================================ */
(() => {
  'use strict';

  // Internal storage key, kept from the app's original codename. Never change
  // it: a different key opens an empty store and orphans all saved data.
  const STORAGE_KEY = 'liftlog.v1';

  const { SCHEMA_VERSION, HOME_SECTION_DEFAULTS, guessBodyRegion } = window.FitMigrations;
  // Fresh copies every time, so nothing is shared with DEFAULT_SETTINGS.
  const makeDefaultSettings = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const upgradeData = (raw) => window.FitMigrations.upgrade(raw, {
    defaultSettings: makeDefaultSettings, defaultProfile, defaultTrackers, defaultWater, defaultFood,
  });

  /* ============================== Defaults ============================== */

  // Starter trackers: Weight and Sleep only. `kind: 'metric'` is a number with an
  // optional goal; `kind: 'sleep'` also stores a 1-5 `quality` per entry. Others
  // (e.g. Body Fat %) are added by the user in Manage.
  function defaultTrackers() {
    const now = new Date().toISOString();
    return [
      { id: 'trk_weight', name: 'Weight', kind: 'metric', unitKind: 'weight', goal: null, baseline: null, direction: null, archived: false, createdAt: now },
      { id: 'trk_sleep', name: 'Sleep', kind: 'sleep', unitKind: 'hours', goal: null, baseline: null, direction: null, archived: false, createdAt: now },
    ];
  }

  // Personal facts rather than a tracker. All optional; used by the insight and
  // nutrition calculators.
  function defaultProfile() {
    return { heightCm: null, sex: null, age: null };
  }

  // Starter cups and daily goal in ml. Used only when there is no water data.
  function defaultWater() {
    return {
      goalMl: 2000,
      cups: [
        { id: 'cup_glass', name: 'Glass', amountMl: 240 },
        { id: 'cup_bottle', name: 'Bottle', amountMl: 500 },
      ],
    };
  }

  const DEFAULT_SETTINGS = {
    theme: 'system', weightUnit: 'lb', distanceUnit: 'mi', lengthUnit: 'in', volumeUnit: 'flOz',
    // Chart range and the optional insights (see "Insights & standards"). Each
    // insight is on by default and shows a hint until its data exists. Saved values win.
    chartScale: 'last10', insightsWindowDays: 90,
    showWeightInsights: true, showStrengthLevel: true, showPaceLevel: true,
    // Gates only the trailing-nights sleep average; the sleep card itself always shows today.
    showSleepInsights: true,
    // Daily-value guidance in the Food detail modal.
    showMacroGuidance: true,
    // Master "Track this" switches. trackWorkout is the Lifting switch; the Workout
    // area stays on while Lifting, Running & cardio or Habits is on (js/features.js).
    // An off area is hidden from Log, History and Home. Manage always shows it so it
    // can be turned back on.
    trackWorkout: true,
    homeSections: Object.assign({}, HOME_SECTION_DEFAULTS),
    trackMeasurements: true,
    trackWater: true,
    trackFood: true,
    // Habits and daily-rep targets (Home checklist), independent of Lifting.
    trackHabits: true,
    // Running and cardio exercises, separate from lifting (trackWorkout).
    trackCardio: true,
    // Starter packs from js/catalog.js already offered/added/skipped.
    catalogPacksSeen: [],
    // `enabled` means the macro is tracked (log form, totals) and may also carry a
    // daily goal. Calories is always tracked, so its `enabled` only means "has a
    // goal". Protein, Carbs and Fat start tracked; Sugar, Sodium and Caffeine start off.
    macroGoals: {
      calories: { enabled: false, goal: null }, protein: { enabled: true, goal: null },
      carbs: { enabled: true, goal: null }, fat: { enabled: true, goal: null },
      sugar: { enabled: false, goal: null }, sodium: { enabled: false, goal: null }, caffeine: { enabled: false, goal: null },
    },
    // Nutrition calculator, off by default. Applying it writes calories and protein
    // into macroGoals above (see computeNutritionTargets()).
    nutritionCalc: { enabled: false, activityLevel: 'moderate', goal: 'maintain' },
    // Set once the "Review your tracking" prompt has been answered or dismissed (see
    // shouldOfferSetupReview()). It only stops repeats; it does not decide when to show it.
    setupReviewPromptSeen: false,
  };

  // A new install's starting Food state is empty; there are no starter foods.
  function defaultFood() {
    return { entries: [], savedFoods: [] };
  }

  // Starting data for a new install, already in the current schema shape, so it
  // skips the migrations.
  function defaultData() {
    const now = new Date().toISOString();
    return {
      version: SCHEMA_VERSION,
      settings: makeDefaultSettings(),
      profile: defaultProfile(),
      exercises: [
        { id: 'ex_bench', name: 'Bench Press', kind: 'weight', bodyRegion: 'upper', section: 'goal', goal: PLATE_GOALS.bench, liftType: 'bench', goalMode: 'fixed', goalTier: null, archived: false, createdAt: now },
        { id: 'ex_squat', name: 'Squat', kind: 'weight', bodyRegion: 'lower', section: 'goal', goal: PLATE_GOALS.squat, liftType: 'squat', goalMode: 'fixed', goalTier: null, archived: false, createdAt: now },
        { id: 'ex_deadlift', name: 'Deadlift', kind: 'weight', bodyRegion: 'lower', section: 'goal', goal: PLATE_GOALS.deadlift, liftType: 'deadlift', goalMode: 'fixed', goalTier: null, archived: false, createdAt: now },
        { id: 'ex_pushups', name: 'Push-ups', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
        { id: 'ex_bwsquats', name: 'Bodyweight Squats', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
        { id: 'ex_pullups', name: 'Pull-ups', kind: 'reps', section: 'daily', goal: 15, archived: false, createdAt: now },
        { id: 'ex_running', name: 'Running', kind: 'cardio', section: 'goal', distanceGoal: 5, paceGoal: null, goal: null, archived: false, createdAt: now },
      ],
      entries: [],
      trackers: defaultTrackers(),
      measurements: [],
      water: defaultWater(),
      waterEntries: [],
      food: defaultFood(),
    };
  }

  /* ============================== Store ==============================
     load() and save() are the only code that touches localStorage. */

  let state = null;
  // True only on a first-ever run (see load()); init() then shows the setup wizard.
  let needsSetup = false;
  // True when saved data exists but could not be read; init() then shows the
  // recovery screen. `rawCorrupt` keeps the original text so it can be handed back.
  let needsRecovery = false;
  let rawCorrupt = null;

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // First run: `state` is an unsaved skeleton. finishSetup() saves the real
        // starting data, so quitting mid-wizard leaves nothing behind.
        state = defaultData();
        needsSetup = true;
        return;
      }
      const parsed = JSON.parse(raw);
      // Recognisable as Fit Log data (missing sections are filled in by upgradeData()); anything
      // else goes to the recovery screen instead of being silently replaced.
      const looksLikeData = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && (Array.isArray(parsed.exercises) || Array.isArray(parsed.entries) || typeof parsed.version === 'number');
      if (!looksLikeData) throw new Error('bad shape');
      state = upgradeData(parsed);
      save(); // persist the migrated shape once, so this doesn't re-run every load
    } catch (e) {
      // Saved data exists but could not be parsed or migrated. Do not overwrite it
      // (there is no other copy); leave localStorage alone and let the recovery
      // screen offer a choice.
      console.warn('Could not read saved data — leaving it untouched.', e);
      rawCorrupt = raw || null;
      needsRecovery = true;
    }
  }

  // Returns false on failure (it shows its own failure toast). Callers must
  // check it and skip any success toast or modal close: `if (!save()) return;`.
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      // Most likely the storage quota is full. Say so rather than lose the entry silently.
      console.error('Could not save to localStorage', e);
      toast('Could not save — your browser storage may be full. Try exporting a backup and freeing up space.');
      return false;
    }
  }

  function genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ============================== Unit helpers ============================== */

  const {
    LB_PER_KG, MIN_AGE, MAX_AGE, MIN_HEIGHT_CM, MAX_HEIGHT_CM,
    Units, round, cmToFtIn, fmtWeight, fmtReps, isTimed, fmtHold, fmtCount, fmtDistance, fmtSecShort,
    fmtPace, fmtLength, fmtVolume, fmtDuration, localDateISO, todayISO, fmtDateShort,
  } = window.FitUnits.create(() => state.settings);

  /* ============================== Derived data ============================== */

  // Habits and daily-rep targets follow the Habits switch, cardio follows
  // Running & cardio, everything else follows Lifting (js/features.js). Turning
  // one off only hides its items.
  const F = window.FitFeatures;
  const habitsTracked = () => F.habitsTracked(state.settings);
  const cardioTracked = () => F.cardioTracked(state.settings);
  function activeExercises() { return state.exercises.filter((e) => F.exerciseTracked(state.settings, e)); }
  function exerciseById(id) { return state.exercises.find((e) => e.id === id); }
  function entriesFor(exId) { return state.entries.filter((e) => e.exerciseId === exId); }
  function sectionOf(ex) { return ex.section || 'goal'; }
  const SECTION_LABELS = { goal: 'Goals', daily: 'Daily targets', accessory: 'Other exercises' };

  // A habit has no weight or reps: it is done `goal` times a day and logged with
  // one tap. `repeat` sets how often it falls due.
  const HABIT_REPEATS = [['daily', 'Every day', 1], ['every-other', 'Every other day', 2], ['weekly', 'Weekly', 7]];
  function habitRepeatDays(ex) { return (HABIT_REPEATS.find((r) => r[0] === ex.repeat) || HABIT_REPEATS[0])[2]; }
  function dayGap(fromISO, toISO) { return Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000); }
  // Due today: always if daily; otherwise once enough days have passed since it
  // was last done, or if it is already started today.
  function habitDueToday(ex) {
    const gap = habitRepeatDays(ex);
    if (gap === 1) return true;
    const dates = entriesFor(ex.id).map((e) => e.date).sort();
    return !dates.length || dates.includes(todayISO()) || dayGap(dates[dates.length - 1], todayISO()) >= gap;
  }
  function logHabit(exId) {
    const ex = exerciseById(exId);
    if (!ex) return;
    state.entries.push({ id: genId('en'), exerciseId: ex.id, date: todayISO(), time: new Date().toTimeString().slice(0, 5), note: null });
    if (!save()) return;
    toast(`${ex.name} done`);
    if (document.getElementById('logExercise').value === ex.id) renderLogForm();
    if (document.getElementById('habitDoneBtn')) renderHabitDetail(ex);
    renderRecentEntries(); renderDashboard(); renderHistory();
  }
  function habitPanelHtml(ex) {
    const goal = ex.goal || 1;
    const done = entriesFor(ex.id).filter((e) => e.date === todayISO()).length;
    return `
      <div class="habit-panel">
        <div class="habit-count">${done}<span class="muted-text"> / ${goal} ${goal === 1 ? 'time' : 'times'} today</span></div>
        <div class="habit-dots">${Array.from({ length: Math.min(goal, 6) }, (_, i) => `<span class="habit-dot${i < done ? ' on' : ''}"></span>`).join('')}</div>
      </div>`;
  }

  // The best (or starred) set of an entry. Unlike entryValue() it keeps reps and
  // RPE, which the suggestions need.
  function topSetOf(exercise, entry) {
    if (exercise.kind === 'weight') {
      const valid = (entry.sets || []).filter((s) => s.reps > 0 && s.weight != null);
      if (!valid.length) return null;
      // A starred working set wins over a heavier warm-up or single; otherwise take
      // the heaviest set.
      const starred = valid.find((s) => s.primary);
      if (starred) return { weight: starred.weight, reps: starred.reps, rpe: starred.rpe };
      let top = valid[0];
      for (const s of valid) { if (s.weight > top.weight || (s.weight === top.weight && s.reps > top.reps)) top = s; }
      return { weight: top.weight, reps: top.reps, rpe: top.rpe };
    }
    if (exercise.kind === 'reps') {
      const valid = (entry.sets || []).filter((s) => s.reps != null);
      if (!valid.length) return null;
      let top = valid[0];
      for (const s of valid) { if (s.reps > top.reps) top = s; }
      return { reps: top.reps, addedWeight: top.addedWeight, rpe: top.rpe };
    }
    const pace = (entry.distance && entry.duration) ? entry.duration / entry.distance : null;
    return { distance: entry.distance, duration: entry.duration, pace, rpe: entry.rpe };
  }

  // A cardio exercise has optional distance and pace goals, both computed from
  // the same entries. Read them through these helpers, not distanceGoal/paceGoal.

  // Goal metrics this cardio exercise tracks, in display order (0, 1 or 2).
  function cardioMetricsOf(exercise) {
    if (exercise.kind !== 'cardio') return [];
    const metrics = [];
    if (exercise.distanceGoal != null) metrics.push('distance');
    if (exercise.paceGoal != null) metrics.push('pace');
    return metrics;
  }
  function cardioGoalFor(exercise, metric) {
    return metric === 'pace' ? exercise.paceGoal : exercise.distanceGoal;
  }
  // With no metric given, uses whichever goal is set.
  function defaultCardioMetric(exercise) {
    return exercise.distanceGoal != null ? 'distance' : (exercise.paceGoal != null ? 'pace' : 'distance');
  }

  // One number per entry for charts and PRs: heaviest weight for a lift, most
  // reps in a set for bodyweight, distance or pace (per `metric`) for cardio.
  function entryValue(exercise, entry, metric) {
    if (exercise.kind === 'weight') {
      const weights = (entry.sets || []).filter((s) => s.reps > 0).map((s) => s.weight);
      return weights.length ? Math.max(...weights) : null;
    }
    if (exercise.kind === 'reps') {
      const reps = (entry.sets || []).map((s) => s.reps).filter((r) => r != null);
      return reps.length ? Math.max(...reps) : null;
    }
    // cardio
    const m = metric || defaultCardioMetric(exercise);
    if (m === 'pace') {
      if (entry.distance > 0 && entry.duration > 0) return entry.duration / entry.distance; // sec per mile
      return null;
    }
    return entry.distance != null ? entry.distance : null;
  }

  function isLowerBetter(exercise, metric) {
    if (exercise.kind !== 'cardio') return false;
    return (metric || defaultCardioMetric(exercise)) === 'pace';
  }

  // All-time best entryValue(): lowest for pace, highest otherwise. `metric` is
  // ignored for non-cardio.
  function best(exercise, metric) {
    const vals = entriesFor(exercise.id).map((e) => entryValue(exercise, e, metric)).filter((v) => v != null);
    if (!vals.length) return null;
    return isLowerBetter(exercise, metric) ? Math.min(...vals) : Math.max(...vals);
  }

  // Progress to goal as a percent (over 100 once beaten) and whether it is
  // reached. `metric` picks the cardio goal and is ignored otherwise.
  function progressPct(exercise, metric) {
    const goal = exercise.kind === 'cardio' ? cardioGoalFor(exercise, metric || defaultCardioMetric(exercise)) : exercise.goal;
    // A bodyweight-standard goal is a tier calibrated to estimated 1RM (as in
    // strengthLevelInfo), so measure it against that. A fixed goal uses the
    // heaviest set.
    const useOneRM = exercise.kind === 'weight' && exercise.goalMode === 'standard';
    const b = useOneRM ? (bestEstimatedOneRM(exercise) || {}).oneRM ?? null : best(exercise, metric);
    if (b == null || !goal) return { pct: 0, achieved: false, best: b };
    let pct;
    if (isLowerBetter(exercise, metric)) {
      pct = b <= 0 ? 0 : (goal / b) * 100;
    } else {
      pct = (b / goal) * 100;
    }
    return { pct: Math.max(0, pct), achieved: pct >= 100, best: b };
  }

  function formatValueForExercise(exercise, v, metric) {
    if (v == null) return '—';
    if (exercise.kind === 'weight') return fmtWeight(v);
    if (exercise.kind === 'reps') return fmtCount(exercise, v);
    if (exercise.kind === 'cardio') return (metric || defaultCardioMetric(exercise)) === 'pace' ? fmtPace(v) : fmtDistance(v);
    return String(v);
  }

  function goalLabelForExercise(exercise, metric) {
    if (exercise.kind === 'weight') return `Goal ${fmtWeight(exercise.goal)}`;
    if (exercise.kind === 'reps') return `Goal ${fmtCount(exercise, exercise.goal)}`;
    if (exercise.kind === 'cardio') {
      const m = metric || defaultCardioMetric(exercise);
      const goal = cardioGoalFor(exercise, m);
      return m === 'pace' ? `Goal ${fmtPace(goal)}` : `Goal ${fmtDistance(goal)}`;
    }
    return '';
  }

  // Suffix for the Manage exercise list: one clause per goal, or "no goal set".
  function exerciseGoalSummary(exercise) {
    if (exercise.kind === 'habit') {
      const repeat = HABIT_REPEATS.find((r) => r[0] === exercise.repeat);
      return ` · ${exercise.goal || 1}× a day${repeat && repeat[2] > 1 ? ` · ${repeat[1].toLowerCase()}` : ''}`;
    }
    if (exercise.kind === 'cardio') {
      const metrics = cardioMetricsOf(exercise);
      if (!metrics.length) return ' · no goal set';
      return metrics.map((m) => ` · ${goalLabelForExercise(exercise, m)}`).join('');
    }
    return exercise.goal ? ` · ${goalLabelForExercise(exercise)}` : ' · no goal set';
  }

  /* ============================== Progressive-overload suggestion engine ==============================
     RPE bands when the last top set has an RPE; otherwise a two-session trend
     (not the NSCA "2-for-2 rule"). A general guideline, not coaching; the UI says so. */

  const WEIGHT_INCREMENTS = { upper: { lb: 5, kg: 2.5 }, lower: { lb: 10, kg: 5 } };

  function weightIncrementLb(bodyRegion, fraction) {
    const unit = Units.weightUnitLabel();
    const table = WEIGHT_INCREMENTS[bodyRegion === 'lower' ? 'lower' : 'upper'];
    return Units.displayToLb(table[unit] * fraction);
  }

  function rpeBand(rpe) {
    if (rpe == null || Number.isNaN(rpe)) return null;
    if (rpe <= 6.5) return 'easy';
    if (rpe <= 7.5) return 'moderate';
    if (rpe < 9) return 'ontarget';
    return 'max';
  }

  const SUGGESTION_METHOD_NOTE = {
    rpe: 'Based on RPE/RIR-based autoregulation.',
    sametrend: 'Based on your last two sessions at this weight.',
    trend: 'Based on your last two sessions.',
  };

  // Returns an array: one suggestion for weight/reps, one per goal metric for
  // cardio (each tagged with `metric`).
  function suggestNextTarget(exercise) {
    // Daily targets are open-ended, so they get no suggestion.
    if (sectionOf(exercise) === 'daily') return [];
    const entries = entriesFor(exercise.id).slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (!entries.length) return [{ headline: 'Log a session to get a suggestion.', method: null }];
    const last = entries[0];
    const prev = entries[1] || null;

    if (exercise.kind === 'cardio') {
      const metrics = cardioMetricsOf(exercise);
      if (!metrics.length) return [{ headline: 'Set a distance or pace goal to get a suggestion.', method: null }];
      return metrics.map((metric) => ({ metric, ...suggestCardioMetric(exercise, metric, last, prev) }));
    }
    return [suggestWeightOrReps(exercise, last, prev)];
  }

  function suggestWeightOrReps(exercise, last, prev) {
    const lastTop = topSetOf(exercise, last);
    const prevTop = prev ? topSetOf(exercise, prev) : null;

    if (exercise.kind === 'weight') {
      if (!lastTop || !lastTop.weight) return { headline: 'Log a full set (weight × reps) to get a suggestion.', method: null };
      const band = rpeBand(lastTop.rpe);
      const region = exercise.bodyRegion || 'upper';
      if (band === 'easy') {
        const w = lastTop.weight + weightIncrementLb(region, 1);
        return { headline: `Try ${fmtWeight(w)} next session`, detail: `Last top set (${fmtWeight(lastTop.weight)} × ${lastTop.reps} @ RPE ${lastTop.rpe}) had plenty in reserve.`, method: 'rpe' };
      }
      if (band === 'moderate') {
        const w = lastTop.weight + weightIncrementLb(region, 0.5);
        return { headline: `Try ${fmtWeight(w)} next session`, detail: `RPE ${lastTop.rpe} — a small bump is reasonable.`, method: 'rpe' };
      }
      if (band === 'ontarget') {
        return { headline: `Repeat ${fmtWeight(lastTop.weight)}, aim for +1 rep`, detail: `RPE ${lastTop.rpe} is a solid working effort — build reps here before adding load.`, method: 'rpe' };
      }
      if (band === 'max') {
        return { headline: `Hold at ${fmtWeight(lastTop.weight)} next session`, detail: `RPE ${lastTop.rpe} was near your limit — repeat, or ease off slightly, before progressing.`, method: 'rpe' };
      }
      if (prevTop && prevTop.weight === lastTop.weight) {
        if (lastTop.reps >= prevTop.reps && lastTop.reps >= 5) {
          const w = lastTop.weight + weightIncrementLb(region, 1);
          return { headline: `Try ${fmtWeight(w)} next session`, detail: `You matched or beat your reps (${prevTop.reps} → ${lastTop.reps}) at this weight for two sessions in a row.`, method: 'sametrend' };
        }
        return { headline: `Repeat ${fmtWeight(lastTop.weight)} next session`, detail: `Reps dipped (${prevTop.reps} → ${lastTop.reps}) — consolidate before adding load.`, method: 'sametrend' };
      }
      return { headline: `Repeat ${fmtWeight(lastTop.weight)}, or log RPE for a sharper suggestion`, detail: 'Logging an RPE (how hard that top set felt, 1–10) unlocks a tailored recommendation.', method: null };
    }

    if (exercise.kind === 'reps') {
      if (!lastTop || lastTop.reps == null) return { headline: 'Log a set to get a suggestion.', method: null };
      const band = rpeBand(lastTop.rpe);
      const r = Math.round(lastTop.reps);
      if (isTimed(exercise)) {
        if (band === 'max') return { headline: `Hold ${fmtHold(r)} next time`, detail: `RPE ${lastTop.rpe} was close to failure. Repeat before adding time.`, method: 'rpe' };
        return { headline: `Try ${fmtHold(r + 5)} next time`, detail: 'Add a few seconds each session while your form holds.', method: band ? 'rpe' : null };
      }
      if (band === 'easy') return { headline: `Try ${r + 3} reps next time`, detail: `RPE ${lastTop.rpe} had reps to spare — or add a little weight if you're already at a high rep count.`, method: 'rpe' };
      if (band === 'moderate') return { headline: `Try ${r + 1}–${r + 2} reps next time`, detail: `RPE ${lastTop.rpe} — a small push is reasonable.`, method: 'rpe' };
      if (band === 'ontarget') return { headline: `Repeat ${r} reps, focus on form`, detail: `RPE ${lastTop.rpe} is a solid working effort.`, method: 'rpe' };
      if (band === 'max') return { headline: `Hold at ${r} reps next time`, detail: `RPE ${lastTop.rpe} was close to failure — repeat and recover before pushing further.`, method: 'rpe' };
      if (prevTop && prevTop.reps != null) {
        if (lastTop.reps >= prevTop.reps) return { headline: `Try ${r + 2} reps next time`, detail: `Reps trending up (${Math.round(prevTop.reps)} → ${r}).`, method: 'trend' };
        return { headline: `Repeat ${r} reps`, detail: `Reps dipped (${Math.round(prevTop.reps)} → ${r}) — consolidate first.`, method: 'trend' };
      }
      return { headline: `Repeat ${r} reps, or log RPE for a sharper suggestion`, detail: 'Logging an RPE unlocks a tailored recommendation.', method: null };
    }
    return { headline: 'Log a session to get a suggestion.', method: null };
  }

  // Cardio suggestion for one goal metric; called once per configured goal.
  function suggestCardioMetric(exercise, metric, last, prev) {
    const lastTop = topSetOf(exercise, last);
    const prevTop = prev ? topSetOf(exercise, prev) : null;
    const band = rpeBand(lastTop ? lastTop.rpe : null);
    if (metric === 'distance') {
      if (!lastTop || lastTop.distance == null) return { headline: 'Log a run with distance to get a suggestion.', method: null };
      if (band === 'easy') return { headline: `Try ~${fmtDistance(lastTop.distance * 1.1)} next run`, detail: `RPE ${lastTop.rpe} felt comfortable — a common guideline is to grow distance by no more than ~10% at a time.`, method: 'rpe' };
      if (band === 'moderate') return { headline: `Try ~${fmtDistance(lastTop.distance * 1.05)} next run`, detail: `RPE ${lastTop.rpe} — a small increase is reasonable.`, method: 'rpe' };
      if (band === 'ontarget' || band === 'max') return { headline: `Repeat ~${fmtDistance(lastTop.distance)} next run`, detail: `RPE ${lastTop.rpe} was a real effort — consolidate before extending further.`, method: 'rpe' };
      if (prevTop && prevTop.distance != null) {
        if (lastTop.distance >= prevTop.distance) return { headline: `Try ~${fmtDistance(lastTop.distance * 1.05)} next run`, detail: `Distance trending up (${fmtDistance(prevTop.distance)} → ${fmtDistance(lastTop.distance)}).`, method: 'trend' };
        return { headline: `Repeat ~${fmtDistance(lastTop.distance)} next run`, detail: 'Distance dipped from last time — rebuild before extending.', method: 'trend' };
      }
      return { headline: `Repeat ~${fmtDistance(lastTop.distance)}, or log an effort rating for a sharper suggestion`, detail: 'Logging RPE (how hard that run felt) unlocks a tailored recommendation.', method: null };
    }
    // pace
    if (!lastTop || lastTop.pace == null) return { headline: 'Log a run with both distance and time to get a pace suggestion.', method: null };
    if (band === 'easy') return { headline: `Try ~${fmtPace(lastTop.pace * 0.98)} next run`, detail: `RPE ${lastTop.rpe} felt comfortable — a modest pace push is reasonable.`, method: 'rpe' };
    if (band === 'moderate') return { headline: `Try ~${fmtPace(lastTop.pace * 0.99)} next run`, detail: `RPE ${lastTop.rpe} — a small improvement is reasonable.`, method: 'rpe' };
    if (band === 'ontarget' || band === 'max') return { headline: `Repeat ~${fmtPace(lastTop.pace)} next run`, detail: `RPE ${lastTop.rpe} was a real effort — hold this pace before pushing faster.`, method: 'rpe' };
    if (prevTop && prevTop.pace != null) {
      if (lastTop.pace <= prevTop.pace) return { headline: `Try ~${fmtPace(lastTop.pace * 0.99)} next run`, detail: `Pace trending faster (${fmtPace(prevTop.pace)} → ${fmtPace(lastTop.pace)}).`, method: 'trend' };
      return { headline: `Repeat ~${fmtPace(lastTop.pace)} next run`, detail: 'Pace slipped from last time — rebuild before pushing faster.', method: 'trend' };
    }
    return { headline: `Repeat ~${fmtPace(lastTop.pace)}, or log an effort rating for a sharper suggestion`, detail: 'Logging RPE unlocks a tailored recommendation.', method: null };
  }

  function kindBadge(exercise) {
    if (exercise.kind === 'weight') return 'Lift';
    if (exercise.kind === 'reps') return 'Bodyweight';
    if (exercise.kind === 'habit') return 'Habit';
    if (exercise.kind === 'cardio') {
      const metrics = cardioMetricsOf(exercise);
      if (metrics.length === 2) return 'Run · distance & pace';
      return metrics[0] === 'pace' ? 'Run · pace' : 'Run · distance';
    }
    return '';
  }

  /* ============================== Body & wellness trackers ==============================
     A tracker logs a number against an optional goal (weight, sleep, custom).
     Values are stored in one canonical unit per unitKind (see Unit helpers). */

  function activeTrackers() { return state.trackers.filter((t) => !t.archived); }
  function trackerById(id) { return state.trackers.find((t) => t.id === id); }
  function measurementsFor(trackerId) { return state.measurements.filter((m) => m.trackerId === trackerId); }

  // The latest value: a tracker's "current" is its newest reading, not a lifetime best.
  function latestMeasurement(trackerId) {
    const list = measurementsFor(trackerId).slice().sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    return list.length ? list[list.length - 1] : null;
  }

  // unitLabel is free text and the result goes into innerHTML, so escape it here.
  function fmtTrackerValue(tracker, v) {
    if (v == null || Number.isNaN(v)) return '—';
    switch (tracker.unitKind) {
      case 'weight': return fmtWeight(v);
      case 'length': return fmtLength(v);
      case 'percent': return `${round(v, 1)}%`;
      case 'hours': return `${round(v, 1)} hr`;
      case 'rating': return `${Math.round(v)}/${tracker.ratingMax || 5}`;
      default: return `${round(v, 1)}${tracker.unitLabel ? ' ' + escapeHtml(tracker.unitLabel) : ''}`;
    }
  }

  function trackerGoalLabel(tracker) {
    return tracker.goal != null ? `Goal ${fmtTrackerValue(tracker, tracker.goal)}` : '';
  }

  // Sleep quality: an optional 1-5 rating, rounded and clamped.
  function clampQuality(raw) {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : Math.max(1, Math.min(5, Math.round(n)));
  }
  function fmtQuality(q) { return q == null ? null : `${q}/5`; }

  // Progress is measured from `tracker.baseline` (the value when the goal was
  // set), not from zero: weight 200 -> goal 180 at 195 is 25%, not 92%. A
  // baseline is usable only if it is on the far side of the goal from the
  // direction of travel; otherwise trackerProgressPct() uses current/goal.
  function trackerBaselineUsable(tracker) {
    const b = tracker.baseline, g = tracker.goal;
    if (b == null || g == null || b === g) return false;
    return tracker.direction === 'down' ? b > g : b < g;
  }

  function trackerProgressPct(tracker, value) {
    if (value == null || tracker.goal == null) return { pct: 0, achieved: false };
    const goal = tracker.goal;
    const achieved = tracker.direction === 'down' ? value <= goal : value >= goal;
    const baseline = trackerBaselineUsable(tracker) ? tracker.baseline : null;
    if (baseline == null || baseline === goal) {
      const pct = tracker.direction === 'down'
        ? (value <= 0 ? 0 : (goal / value) * 100)
        : (value / goal) * 100;
      return { pct: Math.max(0, pct), achieved };
    }
    const pct = ((baseline - value) / (baseline - goal)) * 100;
    return { pct: Math.max(0, pct), achieved };
  }

  // Plain-language progress, e.g. "12 lb down, 8 lb remaining". Null without a
  // usable baseline or once the goal is reached.
  function trackerProgressDeltaText(tracker, value) {
    if (value == null || tracker.goal == null || !trackerBaselineUsable(tracker)) return null;
    const moved = Math.abs(tracker.baseline - value);
    const remaining = Math.abs(tracker.goal - value);
    if (remaining <= 0) return null;
    const dir = tracker.direction === 'down' ? 'down' : 'up';
    return `${fmtTrackerValue(tracker, moved)} ${dir} · ${fmtTrackerValue(tracker, remaining)} remaining`;
  }

  // Convert a stored value (lb, cm, ...) to and from the number shown in an
  // input. Other unit kinds are stored as shown.
  function trackerDisplayFromCanonical(tracker, v) {
    if (v == null) return '';
    if (tracker.unitKind === 'weight') return round(Units.lbToDisplay(v), 1);
    if (tracker.unitKind === 'length') return round(Units.cmToDisplay(v), 1);
    return v;
  }
  function trackerCanonicalFromDisplay(tracker, v) {
    if (tracker.unitKind === 'weight') return Units.displayToLb(v);
    if (tracker.unitKind === 'length') return Units.displayToCm(v);
    return v;
  }
  // Escaped like fmtTrackerValue(): the label lands in innerHTML.
  function trackerUnitLabel(tracker) {
    switch (tracker.unitKind) {
      case 'weight': return Units.weightUnitLabel();
      case 'length': return Units.lengthUnitLabel();
      case 'percent': return '%';
      case 'hours': return 'hr';
      case 'rating': return `/ ${tracker.ratingMax || 5}`;
      default: return tracker.unitLabel ? escapeHtml(tracker.unitLabel) : '';
    }
  }

  /* ============================== Insights & standards ==============================
     Optional calculators (BMI, weight trend, strength and pace level), on by
     default and switched in Settings -> Insights. Each says what is missing
     instead of guessing. Tables and sources: js/standards.js. General guidance only. */

  // Thresholds, formulas and sources live in js/standards.js (FitStandards).
  const S = window.FitStandards;
  const INSIGHT_TIER_LABELS = S.TIER_LABELS;
  const LIFT_STANDARDS = S.LIFT_STANDARDS;
  const LIFT_TYPE_LABELS = { bench: 'Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

  // Fixed "plates" goals: 2/3/4 plates a side plus a 45 lb bar. Used by the
  // setup wizard and defaultData().
  const PLATE_GOALS = { bench: 225, squat: 315, deadlift: 405 };
  // Wizard tier name -> LIFT_STANDARDS column. Beginner and Novice are left out
  // as too low to be goals.
  const TIER_TO_INDEX = { intermediate: 2, advanced: 3, elite: 4 };
  // All tiers in LIFT_STANDARDS order, for the Beginner..Elite preview.
  const ALL_TIER_KEYS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

  // Goal in lb for a bodyweight-standard tier, rounded to 5 lb. Shared by the
  // setup wizard and the exercise form.
  function computeStandardGoal(liftType, tier, bodyweightLb, sex) {
    if (!bodyweightLb || !sex || !LIFT_STANDARDS[liftType] || TIER_TO_INDEX[tier] === undefined) return null;
    const mult = LIFT_STANDARDS[liftType][sex][TIER_TO_INDEX[tier]];
    return Math.round((bodyweightLb * mult) / 5) * 5;
  }

  // Every tier's goal for this lift, bodyweight and sex. Null until bodyweight
  // and sex are known.
  function standardGoalPreviewRows(liftType, bodyweightLb, sex) {
    if (!bodyweightLb || !sex || !LIFT_STANDARDS[liftType]) return null;
    const table = LIFT_STANDARDS[liftType][sex];
    return ALL_TIER_KEYS.map((key, i) => ({
      tierKey: key,
      label: key[0].toUpperCase() + key.slice(1),
      goalLb: Math.round((bodyweightLb * table[i]) / 5) * 5,
    }));
  }

  // Recompute each bodyweight-standard goal (goalMode 'standard') from the
  // current bodyweight and sex; 'fixed' goals are untouched. Call wherever
  // bodyweight or sex can change.
  function recomputeStandardGoals() {
    const bw = currentBodyWeightLb();
    const sex = state.profile.sex;
    state.exercises.forEach((ex) => {
      if (ex.kind !== 'weight' || ex.goalMode !== 'standard' || !ex.liftType || !ex.goalTier) return;
      // A null result (bodyweight or sex missing) is assigned on purpose so the goal
      // does not keep a stale value.
      ex.goal = computeStandardGoal(ex.liftType, ex.goalTier, bw, sex);
    });
  }

  // Pace tiers as sec/mile ceilings, fastest first (lower is better). Slower
  // than the last is "Building base".
  const PACE_TIER_LABELS = S.PACE_TIER_LABELS;
  const PACE_TIERS = S.PACE_TIERS;

  function classifyAscending(value, thresholds, labels) {
    let idx = 0;
    for (let i = 0; i < thresholds.length; i++) { if (value >= thresholds[i]) idx = i + 1; }
    return labels[idx];
  }
  function classifyDescending(value, ceilings, labels) {
    for (let i = 0; i < ceilings.length; i++) { if (value <= ceilings[i]) return labels[i]; }
    return labels[labels.length - 1];
  }

  const BMI_CATEGORIES = S.BMI_CATEGORIES;
  const bmiCategory = S.bmiCategory;
  // CSS class (see .category-dot in styles.css) per BMI category. A map, so
  // label wording can differ from the class name.
  const BMI_CATEGORY_CLASS = { 'Underweight': 'is-underweight', 'Healthy weight': 'is-normal', 'Overweight': 'is-overweight', 'Obese': 'is-obese' };

  // Short elapsed-time text for the weight trend: days, weeks, months, then years.
  function humanizeDays(days) {
    if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
    if (days < 60) { const w = Math.round(days / 7); return `${w} week${w === 1 ? '' : 's'}`; }
    if (days < 400) { const m = Math.round(days / 30); return `${m} month${m === 1 ? '' : 's'}`; }
    return `${round(days / 365, 1)} years`;
  }

  // The seeded Weight tracker is the body-weight source for BMI and strength
  // ratio. If it is deleted, those calculators report missing data.
  const BODY_WEIGHT_TRACKER_ID = 'trk_weight';
  function currentBodyWeightLb() {
    const latest = latestMeasurement(BODY_WEIGHT_TRACKER_ID);
    return latest ? latest.value : null;
  }

  // Current weight, change over the insights window, and BMI once height is set.
  function weightInsights() {
    const list = measurementsFor(BODY_WEIGHT_TRACKER_ID).slice().sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    if (!list.length) return null;
    const latest = list[list.length - 1];
    let trend = null;
    if (list.length >= 2) {
      const cutoff = new Date(latest.date + 'T00:00:00');
      cutoff.setDate(cutoff.getDate() - state.settings.insightsWindowDays);
      const cutoffIso = localDateISO(cutoff);
      const baseline = list.filter((m) => m.date <= cutoffIso).slice(-1)[0] || list[0];
      if (baseline.id !== latest.id) {
        const days = Math.round((new Date(latest.date + 'T00:00:00') - new Date(baseline.date + 'T00:00:00')) / 86400000);
        trend = { delta: latest.value - baseline.value, days };
      }
    }
    let bmi = null;
    if (state.profile.heightCm) {
      const kg = latest.value * LB_PER_KG;
      const m = state.profile.heightCm / 100;
      const value = kg / (m * m);
      bmi = { value: round(value, 1), category: bmiCategory(value) };
    }
    return { current: latest.value, trend, bmi };
  }

  // Sleep is a per-night reading, so it is summarised over recent nights
  // (sleepInsights()) rather than trended like weight.
  const SLEEP_TRACKER_ID = 'trk_sleep';

  // `window`: last 7 calendar nights, labelled once 3+ are logged. `recent`:
  // last 7 logged nights. The maths is in js/calc.js.
  function sleepInsights() {
    return window.FitCalc.sleepInsights(measurementsFor(SLEEP_TRACKER_ID), todayISO(), S);
  }

  // Best estimated 1RM for one exercise (Epley, sets of 10 reps or fewer; see
  // js/calc.js). Used by strengthLevelInfo(), which also needs a lift type, a
  // bodyweight entry and a sex in Profile.
  function bestEstimatedOneRM(ex) {
    return window.FitCalc.bestEstimatedOneRM(entriesFor(ex.id), S);
  }

  function strengthLevelInfo(ex) {
    if (ex.kind !== 'weight' || !ex.liftType || !LIFT_STANDARDS[ex.liftType]) return null;
    const bw = currentBodyWeightLb();
    if (!bw) return { needsBodyWeight: true };
    if (!state.profile.sex) return { needsSex: true };
    const heaviestLoad = best(ex);
    const oneRepMax = bestEstimatedOneRM(ex);
    if (heaviestLoad == null) return null;
    if (!oneRepMax) return { needsShorterSet: true, heaviestLoad };
    const ratio = oneRepMax.oneRM / bw;
    const table = LIFT_STANDARDS[ex.liftType][state.profile.sex];
    return {
      ratio, tier: classifyAscending(ratio, table, INSIGHT_TIER_LABELS), liftLabel: LIFT_STANDARDS[ex.liftType].label,
      oneRepMax: oneRepMax.oneRM, oneRepMaxSet: oneRepMax, heaviestLoad,
    };
  }

  // Best pace against the recreational tiers; needs a logged pace and a sex in Profile.
  function paceLevelInfo(ex) {
    if (ex.kind !== 'cardio') return null;
    const paceBest = best(ex, 'pace');
    if (paceBest == null) return null;
    if (!state.profile.sex) return { needsSex: true };
    const ceilings = PACE_TIERS[state.profile.sex];
    return { pace: paceBest, tier: classifyDescending(paceBest, ceilings, PACE_TIER_LABELS) };
  }

  /* ============================== Water ==============================
     Water has its own data shape (see defaultWater()), not a tracker kind, since
     tap-a-cup logging differs from typing a number. */

  function cupById(id) { return state.water.cups.find((c) => c.id === id); }
  function waterEntriesForDate(date) { return state.waterEntries.filter((e) => e.date === date); }
  function waterTotalForDate(date) { return waterEntriesForDate(date).reduce((sum, e) => sum + e.amountMl, 0); }
  function waterProgressPct(date) {
    const total = waterTotalForDate(date);
    const goal = state.water.goalMl;
    if (!goal) return { pct: 0, achieved: false, total };
    const pct = (total / goal) * 100;
    return { pct: Math.max(0, pct), achieved: pct >= 100, total };
  }

  /* ============================== Food / nutrition ==============================
     `state.food` is separate from exercises, trackers and water. An entry is one thing eaten or
     drunk with an optional number per MACRO_KEYS field (at least one required, see anyMacro()).
     Calories is always tracked; other fields only while `settings.macroGoals[key].enabled` is on,
     and saved values are kept. */

  const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat', 'sugar', 'sodium', 'caffeine'];
  const MACRO_LABELS = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', sugar: 'Sugar', sodium: 'Sodium', caffeine: 'Caffeine' };
  // Display unit per field: none for calories, g for macros and sugar, mg for
  // sodium and caffeine.
  const MACRO_UNITS = { calories: '', protein: 'g', carbs: 'g', fat: 'g', sugar: 'g', sodium: 'mg', caffeine: 'mg' };
  // Realistic example values shown as input placeholders, roughly what a
  // single typical serving/meal looks like for that field.
  const MACRO_PLACEHOLDERS = { calories: '520', protein: '30', carbs: '30', fat: '15', sugar: '10', sodium: '400', caffeine: '95' };

  // FDA Daily Values live in js/standards.js. Total sugar has no Daily Value
  // (the 50 g figure is for ADDED sugar), so it gets no %DV here.
  const MACRO_DV = S.DAILY_VALUES;
  // Sodium and caffeine over 100% get the red "watch this" treatment.
  const MACRO_DV_OVER_FLAGS = new Set(S.DV_OVER_FLAGS);
  // Rounded %DV, or null with no DV for the key or no value.
  function macroDvPct(key, value) {
    const dv = MACRO_DV[key];
    if (dv == null || value == null) return null;
    return Math.round((value / dv) * 100);
  }
  function macroDvOver(key, value) {
    const pct = macroDvPct(key, value);
    return MACRO_DV_OVER_FLAGS.has(key) && pct != null && pct >= 100;
  }

  function macroGoalInfo(key) { return state.settings.macroGoals[key]; }

  // Whether a macro is tracked now (log form, totals, Manage). Calories always is.
  function macroTracked(key) { return key === 'calories' || macroGoalInfo(key).enabled; }

  // Every tracked macro in MACRO_KEYS order: what the log form and totals render.
  function trackedMacroKeys() { return MACRO_KEYS.filter(macroTracked); }

  // ---- Nutrition calculator (Manage -> Food) ----
  // Estimates daily calories and protein from Profile, body weight, activity
  // level and goal. Applying it writes into macroGoals, so it sits with Food
  // rather than Settings -> Insights.
  const ACTIVITY_LEVELS = S.ACTIVITY_LEVELS;
  // Labels for #nutritionGoalSegmented (index.html), so the Food detail modal can
  // name the goal in a sentence.
  const NUTRITION_GOAL_LABELS = { lose: 'losing weight', maintain: 'maintaining', gain: 'gaining weight' };
  // Mifflin-St Jeor BMR x activity level, then the goal adjustment (maths in
  // js/standards.js). Returns `{ missing }` naming absent facts instead of guessing.
  function computeNutritionTargets(activityLevel, goal) {
    const bw = currentBodyWeightLb();
    const { heightCm, age, sex } = state.profile;
    const missing = [];
    if (!heightCm) missing.push('height');
    if (!age) missing.push('age');
    if (!sex) missing.push('sex');
    if (!bw) missing.push('a logged body weight');
    if (missing.length) return { missing };
    return nutritionTargetsFor(bw, heightCm, age, sex, activityLevel, goal);
  }
  // The same maths from plain numbers, so the setup wizard can preview a
  // target before anything has been saved.
  function nutritionTargetsFor(bw, heightCm, age, sex, activityLevel, goal) {
    return S.nutritionTargets(bw, heightCm, age, sex, activityLevel, goal);
  }

  // One choice for how calories are set: Calculator = nutritionCalc.enabled,
  // Manual = a calories goal with the calculator off, No Target = neither.
  function calorieMode() {
    if (state.settings.nutritionCalc.enabled) return 'calc';
    return macroGoalInfo('calories').enabled ? 'manual' : 'none';
  }
  function setCalorieMode(mode) {
    state.settings.nutritionCalc.enabled = mode === 'calc';
    if (mode === 'manual') macroGoalInfo('calories').enabled = true;
    // Calculator keeps whatever target it last applied switched on.
    if (mode === 'calc' && macroGoalInfo('calories').goal != null) macroGoalInfo('calories').enabled = true;
    if (mode === 'none') macroGoalInfo('calories').enabled = false;
  }

  // The "Apply to daily goals" action: writes the computed calories and protein
  // into macroGoals and turns them on. Call it only from that button; an
  // automatic recompute would overwrite goals set another way.
  function applyNutritionCalcTargets(activityLevel, goal) {
    const result = computeNutritionTargets(activityLevel, goal);
    if (result.missing) return false;
    macroGoalInfo('calories').enabled = true;
    macroGoalInfo('calories').goal = result.calories;
    macroGoalInfo('protein').enabled = true;
    macroGoalInfo('protein').goal = result.protein;
    return true;
  }

  function foodEntriesForDate(date) { return state.food.entries.filter((e) => e.date === date); }

  // Per-field totals for a day; null (not 0) where nothing was logged, so the UI
  // shows a dash.
  function foodTotalsForDate(date) {
    const dayEntries = foodEntriesForDate(date);
    const totals = {};
    MACRO_KEYS.forEach((k) => {
      const vals = dayEntries.map((e) => e[k]).filter((v) => v != null);
      totals[k] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    });
    return totals;
  }

  function fmtMacroValue(key, v) {
    if (v == null) return '—';
    return `${Math.round(v)}${MACRO_UNITS[key] || ''}`;
  }

  // Short summary such as "520 cal, 40g protein" for an entry or day total.
  // Tracked macros only.
  function macroSummaryText(values) {
    const parts = trackedMacroKeys()
      .filter((k) => values[k] != null)
      .map((k) => k === 'calories' ? `${Math.round(values[k])} cal` : `${fmtMacroValue(k, values[k])} ${MACRO_LABELS[k].toLowerCase()}`);
    return parts.length ? parts.join(', ') : 'No macros logged';
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
    syncThemeColorMeta();
  }

  // Keep in sync with --page in css/styles.css and the two theme-color meta
  // tags in index.html.
  const PAGE_COLOR_LIGHT = '#f9f9f7';
  const PAGE_COLOR_DARK = '#0d0d0d';

  // theme-color is read by the OS, not CSS. index.html ships two tags gated by
  // prefers-color-scheme so the OS picks one itself (editing one tag in place is not
  // reliably repainted on Android). Under "System" each tag keeps its own color; for an
  // explicit Light or Dark both are forced to the resolved color.
  function syncThemeColorMeta() {
    const lightMeta = document.querySelector('meta[name="theme-color"][media*="light"]');
    const darkMeta = document.querySelector('meta[name="theme-color"][media*="dark"]');
    if (!lightMeta || !darkMeta) return;
    if (state.settings.theme === 'system') {
      lightMeta.setAttribute('content', PAGE_COLOR_LIGHT);
      darkMeta.setAttribute('content', PAGE_COLOR_DARK);
      return;
    }
    const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    if (page) { lightMeta.setAttribute('content', page); darkMeta.setAttribute('content', page); }
  }

  /* ============================== Toast ============================== */

  let toastTimer = null;
  // `action` ({label, run}) adds one button, e.g. Undo, and keeps the toast up longer.
  function toast(msg, action) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'toast-action'; btn.textContent = action.label;
      btn.addEventListener('click', () => { el.hidden = true; clearTimeout(toastTimer); action.run(); });
      el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 2200);
  }

  /* ============================== Modal ============================== */

  const modalRoot = () => document.getElementById('modalRoot');
  const modalSheet = () => document.getElementById('modalSheet');
  let modalLastFocusedEl = null;

  function focusableEls(container) {
    return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  }

  /* ===== Back-button / swipe-back step navigation =========================
   * One history entry per level below Dashboard makes Back close the modal, then return to
   * Dashboard, then ask for a second press to exit. Only navPushModal()/navPopModal() and
   * switchTab() touch history. suppressNextPopHandling skips the popstate from our own
   * history.back(); handlingPopState stops its handlers from pushing or popping again. */
  const NAV_MODAL = 'modal';
  const NAV_TAB = 'tab';
  let suppressNextPopHandling = false;
  let handlingPopState = false;
  let exitWarningArmed = false;
  let exitWarningTimer = null;

  let suppressTimer = null;
  function navPop() {
    // A back() is already in flight (history.state does not change until it lands), so a
    // second request in the same tick, e.g. confirmDialog closing and then its callback
    // closing again, would step back twice and land on Dashboard. Ignore it.
    if (suppressNextPopHandling) return;
    suppressNextPopHandling = true;
    // Safety net: if the browser never fires popstate (nothing to go back to), don't leave
    // the flag set and swallow the user's next real Back press.
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => { suppressNextPopHandling = false; }, 600);
    history.back();
  }
  function navPushModal() {
    if (handlingPopState) return;
    history.pushState({ nav: NAV_MODAL }, '');
  }
  function navPopModal() {
    if (handlingPopState) return;
    if ((history.state || {}).nav === NAV_MODAL) navPop();
  }
  // Only the bottom tabs and Settings take part. The setup wizard and recovery
  // screen have no Dashboard to fall back to.
  const NAV_TRACKED_TABS = new Set(['dashboard', 'progress', 'log', 'history', 'manage', 'settings']);
  function navOnSwitchTab(tab) {
    if (handlingPopState || !NAV_TRACKED_TABS.has(tab)) return;
    if (tab === 'dashboard') {
      if ((history.state || {}).nav === NAV_TAB) navPop();
    } else if ((history.state || {}).nav !== NAV_TAB) {
      history.pushState({ nav: NAV_TAB }, '');
    }
  }

  window.addEventListener('popstate', () => {
    if (suppressNextPopHandling) { suppressNextPopHandling = false; clearTimeout(suppressTimer); return; }
    handlingPopState = true;
    try {
      if (!modalRoot().hidden) { closeModal(); return; }
      if (!document.getElementById('view-settings').hidden) { closeSettings(); return; }
      const activeTab = document.querySelector('.tab[aria-current="page"]');
      if (activeTab && activeTab.dataset.tab !== 'dashboard') { switchTab('dashboard'); return; }
      // At Dashboard with nothing open: warn once and re-arm the guard. A second press
      // within 2 seconds exits.
      if (exitWarningArmed) return;
      exitWarningArmed = true;
      toast('Press back again to exit');
      history.pushState({ nav: 'exit-guard' }, '');
      clearTimeout(exitWarningTimer);
      exitWarningTimer = setTimeout(() => { exitWarningArmed = false; }, 2000);
    } finally {
      handlingPopState = false;
    }
  });

  // Arrow keys move between the options of a role="radiogroup" and select the one reached, as
  // native radio buttons do. Every segmented control and chip row in the app is built this way.
  document.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const radio = ev.target.closest && ev.target.closest('[role="radio"]');
    const group = radio && radio.closest('[role="radiogroup"]');
    if (!group) return;
    const items = Array.from(group.querySelectorAll('[role="radio"]:not([disabled])')).filter((el) => el.offsetParent !== null);
    const at = items.indexOf(radio);
    if (at < 0 || items.length < 2) return;
    const step = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1;
    const next = items[(at + step + items.length) % items.length];
    ev.preventDefault();
    next.focus();
    next.click();
  });

  // Escape closes; Tab and Shift+Tab stay inside the sheet.
  function handleModalKeydown(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
    if (ev.key !== 'Tab') return;
    const focusables = focusableEls(modalSheet());
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  // `tall` is for full detail screens (exercise, tracker, food); see
  // `.is-detail-sheet` in styles.css.
  function openModal(html, { tall = false, split = false } = {}) {
    // Opening a modal over an open one replaces its content, so Back still sees one level.
    const wasOpen = !modalRoot().hidden;
    const sheet = modalSheet();
    sheet.style.transform = '';
    sheet.classList.remove('is-dragging');
    sheet.classList.toggle('is-detail-sheet', tall);
    sheet.classList.toggle('is-split-sheet', split);
    sheet.innerHTML = `<div class="modal-handle"></div>${html}`;
    // Icon-only close buttons need a name for screen readers, and a bare <button> would
    // default to type=submit. Done here once instead of on every template.
    sheet.querySelectorAll('.modal-close:not([aria-label])').forEach((b) => b.setAttribute('aria-label', 'Close'));
    sheet.querySelectorAll('button:not([type])').forEach((b) => { b.type = 'button'; });
    // Name the dialog by its <h2> title.
    const heading = sheet.querySelector('h2');
    if (heading) { heading.id = 'modalTitle'; sheet.setAttribute('aria-labelledby', 'modalTitle'); }
    else sheet.removeAttribute('aria-labelledby');
    modalLastFocusedEl = document.activeElement;
    modalRoot().hidden = false;
    wireModalSwipeToClose(sheet);
    document.addEventListener('keydown', handleModalKeydown);
    // Focus the first control after the close button, else the button, else the
    // sheet. Focusing an off-screen control scrolls the sheet, hence the reset below.
    const focusables = focusableEls(sheet);
    const target = focusables.find((el) => el.dataset.action !== 'close-modal') || focusables[0];
    if (target) target.focus();
    else { sheet.tabIndex = -1; sheet.focus(); }
    sheet.scrollTop = 0;
    if (!wasOpen) navPushModal();
  }
  function closeModal() {
    modalRoot().hidden = true;
    modalSheet().innerHTML = '';
    document.removeEventListener('keydown', handleModalKeydown);
    if (modalLastFocusedEl && document.body.contains(modalLastFocusedEl)) modalLastFocusedEl.focus();
    modalLastFocusedEl = null;
    navPopModal();
  }

  // Make `.modal-handle` a swipe-down-to-close gesture (pointer events, so touch
  // and mouse both work).
  function wireModalSwipeToClose(sheet) {
    const handle = sheet.querySelector('.modal-handle');
    if (!handle) return;
    let startY = 0;
    let dragY = 0;
    let dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      dragY = 0;
      sheet.classList.add('is-dragging');
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dragY = Math.max(0, e.clientY - startY); // only downward drag closes
      sheet.style.transform = `translateY(${dragY}px)`;
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('is-dragging');
      // Past ~a fifth of the sheet's height, treat it as a deliberate
      // dismiss; otherwise spring back open.
      if (dragY > sheet.getBoundingClientRect().height * 0.2) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(closeModal, 200);
      } else {
        sheet.style.transform = '';
      }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // The dialog closes itself before running onConfirm: callbacks must not call closeModal().
  function confirmDialog(title, body, confirmLabel, onConfirm, danger) {
    openModal(`
      <div class="modal-title-row"><h2>${escapeHtml(title)}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text">${escapeHtml(body)}</p>
      <div class="btn-row confirm-actions">
        <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmDialogBtn">${escapeHtml(confirmLabel)}</button>
      </div>
    `);
    document.getElementById('confirmDialogBtn').addEventListener('click', () => { closeModal(); onConfirm(); });
  }

  /* ============================== Chip picker ==============================
     A row of tap targets for a few discrete choices (sleep quality 1-5). The
     container's data-value is the source of truth ('' = none); tapping the
     selected chip clears it. */
  function qualityChipsHtml(id, selected) {
    const opts = [1, 2, 3, 4, 5];
    return `<div class="chip-picker" id="${id}" data-value="${selected != null ? selected : ''}" role="radiogroup" aria-label="Sleep quality">
      ${opts.map((v) => `<button type="button" class="chip-option ${v === selected ? 'is-active' : ''}" data-value="${v}" role="radio" aria-checked="${v === selected}">${v}</button>`).join('')}
    </div>`;
  }
  function wireChipPicker(el) {
    if (!el) return;
    el.querySelectorAll('.chip-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const turningOff = el.dataset.value === btn.dataset.value;
        el.dataset.value = turningOff ? '' : btn.dataset.value;
        el.querySelectorAll('.chip-option').forEach((b) => {
          const active = !turningOff && b.dataset.value === btn.dataset.value;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', String(active));
        });
      });
    });
  }
  // Make a clickable div operable by keyboard and screen reader (focusable, Enter/Space).
  function wireOpenable(el, onOpen) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', onOpen);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(); }
    });
  }
  function resetChipPicker(el) {
    if (!el) return;
    el.dataset.value = '';
    el.querySelectorAll('.chip-option').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-checked', 'false'); });
  }

  // The same ceilings the backup validator enforces. The forms apply them too, so anything the
  // app lets you save can also be exported and imported back (a 99999999 fl oz typo would
  // otherwise make your own backup unimportable).
  const LIMITS = window.FitBackup.LIMITS;
  const tooBigWater = (ml) => ml > LIMITS.waterMl;
  // Reads a date input; a blank one falls back, an impossible or far-future one is refused
  // (the backup validator would reject it on import). Returns null after showing the reason.
  function readDate(id, fallback) {
    const v = document.getElementById(id).value || fallback;
    if (!window.FitBackup.validDate(v, todayISO())) { toast('Pick a valid date, no more than a day or two ahead.'); return null; }
    return v;
  }
  // A tracker value in storage units (lb, cm, hours) that makes no sense, or null when fine.
  function measurementError(tracker, canon) {
    if (!tracker || Number.isNaN(canon)) return null;
    if (tracker.kind === 'sleep' && (canon < 0 || canon > 24)) return 'Sleep must be between 0 and 24 hours.';
    if (tracker.unitKind === 'weight' && (canon <= 0 || canon > LIMITS.weightLb)) return 'That weight is out of range. Check the number and unit.';
    if (tracker.unitKind === 'length' && (canon <= 0 || canon > 1000)) return 'That length is out of range. Check the number and unit.';
    return null;
  }
  const WATER_TOO_BIG = 'That amount is too large to be right. Check the number and unit.';
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================== Dynamic set fields (shared by Log tab + edit modal) ============================== */

  // Column labels show only above the first set row. Later rows keep them in the
  // markup, hidden by CSS (`.set-row:not(:first-child) .field-label`), so screen
  // readers still announce them.
  /* Pre-filled number fields show a rounded display value (135 lb -> 61.23 kg). Saving an
     untouched field must not turn that rounded number back into a slightly different stored
     value (61.23 kg -> 134.99 lb), so such fields carry the stored canonical value in
     data-canon and fieldCanon() returns it while the field still equals its initial value. */
  const canonAttr = (canon) => (canon == null ? '' : ` data-canon="${canon}"`);
  function fieldCanon(el, toCanon) {
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return v;
    if (el.dataset.canon !== undefined && el.value === el.defaultValue) return Number(el.dataset.canon);
    return toCanon(v);
  }
  const setRowKind = (ex) => (isTimed(ex) ? 'timed' : ex.kind);
  function setRowHtml(kind, idx, set) {
    set = set || {};
    const timed = kind === 'timed';
    if (kind === 'weight') {
      const w = set.weight != null ? round(Units.lbToDisplay(set.weight), 2) : '';
      return `
        <div class="set-row set-row-3" data-set-idx="${idx}" data-primary="${set.primary ? '1' : '0'}">
          <label class="field"><span class="field-label">Weight (${Units.weightUnitLabel()})</span>
            <input type="number" step="any" inputmode="decimal" class="set-weight" value="${w}"${canonAttr(set.weight)} placeholder="0" /></label>
          <label class="field"><span class="field-label">Reps</span>
            <input type="number" step="1" min="1" inputmode="numeric" class="set-reps" value="${set.reps ?? ''}" placeholder="0" /></label>
          <label class="field"><span class="field-label">RPE</span>
            <input type="number" step="0.5" min="1" max="10" inputmode="decimal" class="set-rpe" value="${set.rpe ?? ''}" placeholder="opt." /></label>
          <button type="button" class="set-row-star ${set.primary ? 'is-active' : ''}" data-action="toggle-primary" aria-label="Mark as working set" title="Mark as working set (used for suggestions)">★</button>
          <button type="button" class="set-row-remove" data-action="remove-set" aria-label="Remove set">${CLOSE_ICON_SVG}</button>
        </div>`;
    }
    // reps kind (bodyweight), or a timed hold
    const aw = set.addedWeight ? round(Units.lbToDisplay(set.addedWeight), 2) : '';
    return `
      <div class="set-row set-row-3" data-set-idx="${idx}">
        <label class="field"><span class="field-label">${timed ? 'Time (sec)' : 'Reps'}</span>
          <input type="number" step="1" min="1" inputmode="numeric" class="set-reps" value="${set.reps ?? ''}" placeholder="0" /></label>
        <label class="field"><span class="field-label">Added wt (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" inputmode="decimal" class="set-addedweight" value="${aw}"${canonAttr(set.addedWeight || null)} placeholder="opt." /></label>
        <label class="field"><span class="field-label">RPE</span>
          <input type="number" step="0.5" min="1" max="10" inputmode="decimal" class="set-rpe" value="${set.rpe ?? ''}" placeholder="opt." /></label>
        <button type="button" class="set-row-remove" data-action="remove-set" aria-label="Remove set">${CLOSE_ICON_SVG}</button>
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
          <input type="number" step="any" inputmode="decimal" id="cardioDistance" value="${dist}"${canonAttr(entry.distance)} placeholder="0" /></label>
        <div class="field"><span class="field-label">Time</span>
          <div class="inline-time-fields">
            <input type="number" step="1" min="0" inputmode="numeric" id="cardioMin" value="${mins}" placeholder="min" />
            <input type="number" step="1" min="0" max="59" inputmode="numeric" id="cardioSec" value="${secs}" placeholder="sec" />
          </div>
        </div>
      </div>
      <label class="field"><span class="field-label">Effort / RPE (optional, 1–10)</span>
        <input type="number" step="0.5" min="1" max="10" inputmode="decimal" id="cardioRpe" value="${entry.rpe ?? ''}" placeholder="How hard did that feel?" /></label>`;
  }

  function renderDynamicFields(container, exercise, existingEntry) {
    const form = container.closest('#logForm');
    if (form) form.classList.toggle('is-habit', !!exercise && exercise.kind === 'habit');
    if (!exercise) { container.innerHTML = ''; return; }
    if (exercise.kind === 'habit') {
      // Logged in one tap, so there is nothing to fill in (and nothing to edit but date and note).
      container.innerHTML = existingEntry ? '' : `${habitPanelHtml(exercise)}<button type="button" class="btn btn-primary btn-block" data-action="habit-done">Done</button><p class="muted-text habit-hint">One tap saves an entry with the time.</p>`;
      const done = container.querySelector('[data-action="habit-done"]');
      if (done) done.addEventListener('click', () => logHabit(exercise.id));
      return;
    }
    if (exercise.kind === 'cardio') {
      container.innerHTML = `<div class="sets-wrap">${cardioFieldsHtml(existingEntry)}</div>`;
      return;
    }
    const sets = (existingEntry && existingEntry.sets && existingEntry.sets.length) ? existingEntry.sets : [{}];
    // "Last time": the previous session on this exact exercise, with a one-tap way
    // to start from the same sets.
    const lastEntry = existingEntry ? null : entriesFor(exercise.id).filter((en) => en.sets && en.sets.length).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))[0];
    const setText = (st) => exercise.kind === 'weight' ? `${round(Units.lbToDisplay(st.weight), 2)} × ${st.reps}` : `${isTimed(exercise) ? fmtHold(st.reps) : st.reps}${st.addedWeight ? ` +${round(Units.lbToDisplay(st.addedWeight), 2)}` : ''}`;
    const lastHtml = lastEntry ? `
      <div class="last-time">
        <div class="last-time-head"><span class="lbl">Last time · ${escapeHtml(fmtDateShort(lastEntry.date))}</span><button type="button" class="link-btn" data-action="copy-last">Copy sets</button></div>
        <div class="last-time-sets num">${lastEntry.sets.map(setText).join(' · ')}</div>
      </div>` : '';
    container.innerHTML = `
      ${lastHtml}
      <div class="sets-wrap" data-kind="${exercise.kind}">
        <div class="sets-label"><span class="field-label">Sets</span><button type="button" class="btn-ghost" data-action="add-set">+ Add set</button></div>
        <div class="sets-container">${sets.map((s, i) => setRowHtml(setRowKind(exercise), i, s)).join('')}</div>
        ${exercise.kind === 'weight' ? '<div class="best-note" aria-live="polite"></div>' : ''}
      </div>`;
    if (exercise.kind === 'weight') {
      const refresh = () => updateBestNote(container, exercise, existingEntry);
      container.querySelector('.sets-wrap').addEventListener('input', refresh);
      container.querySelector('.sets-wrap').addEventListener('click', (ev) => { if (ev.target.closest('[data-action="remove-set"]')) setTimeout(refresh, 0); });
      refresh();
    }
    const copyBtn = container.querySelector('[data-action="copy-last"]');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      container.querySelector('.sets-container').innerHTML = lastEntry.sets.map((st, i) => setRowHtml(setRowKind(exercise), i, { weight: st.weight, reps: st.reps, addedWeight: st.addedWeight })).join('');
      wireSetRemoveButtons(container); wireSetPrimaryButtons(container);
      if (exercise.kind === 'weight') updateBestNote(container, exercise, existingEntry);
    });
    container.querySelector('[data-action="add-set"]').addEventListener('click', () => {
      const wrap = container.querySelector('.sets-container');
      const idx = wrap.children.length;
      wrap.insertAdjacentHTML('beforeend', setRowHtml(setRowKind(exercise), idx, {}));
      wireSetRemoveButtons(container);
      wireSetPrimaryButtons(container);
    });
    wireSetRemoveButtons(container);
    wireSetPrimaryButtons(container);
  }

  // "Best" is the heaviest weight logged on this exact exercise (each equipment
  // variant has its own). A set that beats it is tagged New best, one that matches
  // it Ties best (once per weight). Nothing is tagged before the first logged set.
  function priorBestWeight(exercise, excludeEntryId) {
    let best = null;
    entriesFor(exercise.id).forEach((en) => {
      if (excludeEntryId && en.id === excludeEntryId) return;
      (en.sets || []).forEach((st) => { if (st.weight != null && (best == null || st.weight > best)) best = st.weight; });
    });
    return best;
  }
  function updateBestNote(container, exercise, existingEntry) {
    const note = container.querySelector('.best-note'); if (!note) return;
    const priorLb = priorBestWeight(exercise, existingEntry && existingEntry.id);
    const unit = Units.weightUnitLabel();
    if (priorLb == null) { note.innerHTML = '<span class="muted-text">No best yet. Your heaviest set here becomes it.</span>'; return; }
    let running = round(Units.lbToDisplay(priorLb), 2);
    const tagged = new Set(); const tags = [];
    Array.from(container.querySelectorAll('.set-row')).forEach((row, i) => {
      const w = round(parseFloat(row.querySelector('.set-weight').value), 2);
      const r = parseFloat(row.querySelector('.set-reps').value);
      if (Number.isNaN(w) || Number.isNaN(r) || w <= 0) return;
      if (w > running) { running = w; tagged.add(w); tags.push(`<span class="tag tag-good">Set ${i + 1} · New best</span>`); }
      else if (w === running && !tagged.has(w)) { tagged.add(w); tags.push(`<span class="tag tag-good">Set ${i + 1} · Ties best</span>`); }
    });
    note.innerHTML = `${tags.length ? `<div class="best-tags">${tags.join('')}</div>` : ''}<span class="muted-text">Best = heaviest set on ${escapeHtml(exerciseLabel(exercise))}: ${fmtWeight(priorLb)}. Tying it is tagged too.</span>`;
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

  // Only one set per entry can be the working set; starring one clears the others,
  // since topSetOf() needs a single answer.
  function wireSetPrimaryButtons(container) {
    container.querySelectorAll('[data-action="toggle-primary"]').forEach((btn) => {
      btn.onclick = () => {
        const row = btn.closest('.set-row');
        const turningOn = row.dataset.primary !== '1';
        container.querySelectorAll('.set-row').forEach((r) => {
          r.dataset.primary = '0';
          const b = r.querySelector('[data-action="toggle-primary"]');
          if (b) b.classList.remove('is-active');
        });
        if (turningOn) { row.dataset.primary = '1'; btn.classList.add('is-active'); }
      };
    });
  }

  // RPE is a 1-10 scale; shared so the cardio and weight branches below agree.
  const RPE_MIN = 1;
  const RPE_MAX = 10;
  function invalidRpe(rpe) { return !Number.isNaN(rpe) && (rpe < RPE_MIN || rpe > RPE_MAX); }

  function readDynamicFields(container, exercise) {
    if (exercise.kind === 'habit') return {};
    if (exercise.kind === 'cardio') {
      const distV = parseFloat(container.querySelector('#cardioDistance').value);
      const minV = parseFloat(container.querySelector('#cardioMin').value);
      const secV = parseFloat(container.querySelector('#cardioSec').value);
      const rpeV = parseFloat(container.querySelector('#cardioRpe').value);
      if (!Number.isNaN(distV) && distV < 0) return { error: 'Distance can’t be negative.' };
      if (!Number.isNaN(distV) && Units.displayToMi(distV) > LIMITS.distanceMi) return { error: 'That distance is too large to be right. Check the number and unit.' };
      if (!Number.isNaN(minV) && minV * 60 > LIMITS.durationSec) return { error: 'That time is too long to be right.' };
      if ((!Number.isNaN(minV) && minV < 0) || (!Number.isNaN(secV) && secV < 0)) return { error: 'Time can’t be negative.' };
      if (!Number.isNaN(secV) && secV >= 60) return { error: 'Seconds must be less than 60 — carry the rest over into minutes.' };
      if (invalidRpe(rpeV)) return { error: `RPE must be between ${RPE_MIN} and ${RPE_MAX}.` };
      const hasDist = !Number.isNaN(distV) && distV > 0;
      const minPart = Number.isNaN(minV) ? 0 : minV;
      const secPart = Number.isNaN(secV) ? 0 : secV;
      const hasTime = minPart > 0 || secPart > 0;
      if (!hasDist && !hasTime) return null;
      return {
        distance: hasDist ? fieldCanon(container.querySelector('#cardioDistance'), Units.displayToMi) : null,
        duration: hasTime ? minPart * 60 + secPart : null,
        rpe: Number.isNaN(rpeV) ? null : rpeV,
      };
    }
    const rows = Array.from(container.querySelectorAll('.set-row'));
    const sets = [];
    for (const row of rows) {
      if (exercise.kind === 'weight') {
        const w = parseFloat(row.querySelector('.set-weight').value);
        const r = parseFloat(row.querySelector('.set-reps').value);
        const rpe = parseFloat(row.querySelector('.set-rpe').value);
        const hasW = !Number.isNaN(w);
        const hasR = !Number.isNaN(r);
        if (!hasW && !hasR) continue; // fully blank row: not a set, ignore it
        // A set needs weight and reps together. Filling the missing side with 0 would
        // write a fake set, so a half-filled row is rejected.
        if (!hasW || !hasR) return { error: 'Each set needs both a weight and reps — fill in the missing value, or clear the row.' };
        // Also reject values that make no sense: zero or negative weight, a fractional
        // or non-positive rep count, or an RPE outside 1-10.
        if (w <= 0) return { error: 'Weight must be greater than zero.' };
        if (Units.displayToLb(w) > LIMITS.weightLb) return { error: 'That weight is too large to be right. Check the number and unit.' };
        if (r <= 0 || !Number.isInteger(r)) return { error: 'Reps must be a whole number greater than zero.' };
        if (r > LIMITS.reps) return { error: 'That rep count is too large to be right.' };
        if (invalidRpe(rpe)) return { error: `RPE must be between ${RPE_MIN} and ${RPE_MAX}.` };
        sets.push({ weight: fieldCanon(row.querySelector('.set-weight'), Units.displayToLb), reps: r, primary: row.dataset.primary === '1' || undefined, rpe: Number.isNaN(rpe) ? null : rpe });
      } else {
        const r = parseFloat(row.querySelector('.set-reps').value);
        const aw = parseFloat(row.querySelector('.set-addedweight').value);
        const rpe = parseFloat(row.querySelector('.set-rpe').value);
        if (Number.isNaN(r)) continue;
        if (r <= 0 || !Number.isInteger(r)) return { error: 'Reps must be a whole number greater than zero.' };
        if (!Number.isNaN(aw) && aw < 0) return { error: 'Added weight can’t be negative.' };
        if (r > (exercise.unit === 'time' ? LIMITS.holdSeconds : LIMITS.reps)) return { error: 'That value is too large to be right.' };
        if (!Number.isNaN(aw) && Units.displayToLb(aw) > LIMITS.weightLb) return { error: 'That added weight is too large to be right.' };
        if (invalidRpe(rpe)) return { error: `RPE must be between ${RPE_MIN} and ${RPE_MAX}.` };
        sets.push({ reps: r, addedWeight: Number.isNaN(aw) ? 0 : fieldCanon(row.querySelector('.set-addedweight'), Units.displayToLb), rpe: Number.isNaN(rpe) ? null : rpe });
      }
    }
    return sets.length ? { sets } : null;
  }

  /* ============================== Rendering: Dashboard ============================== */

  // Every date with something logged in a section you track (see
  // FitStandards.STREAK_RULE): workouts/habits, food, water, body entries.
  const trackedAreas = () => ({
    workout: domainTracked('workout'), measurements: domainTracked('measurements'),
    water: domainTracked('water'), food: domainTracked('food'),
  });
  function activityDays() { return window.FitCalc.activityDays(state, trackedAreas()); }
  function computeStreak() { return window.FitCalc.computeStreak(activityDays(), todayISO()); }

  // The streak card at the top of Home: the current streak over a dot for each of
  // the last 7 days. The whole card is a button that opens History.
  function renderSummary() {
    const days = activityDays();
    const today = new Date(todayISO() + 'T00:00:00');
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      week.push({ on: days.has(localDateISO(d)), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }) });
    }
    const streak = computeStreak();
    const card = document.getElementById('streakCard');
    card.classList.toggle('is-hot', streak > 0);
    card.innerHTML = `
      <span class="streak-top">
        <span class="streak-main">${FLAME_ICON_SVG}<span class="streak-num">${streak}</span><span class="streak-label">day streak</span></span>
        <span class="streak-week-text">${week.filter((d) => d.on).length} of 7 days this week${CHEVRON_RIGHT_SVG}</span>
      </span>
      <span class="streak-week">
        ${week.map((d) => `<span class="streak-day">${d.label}<span class="streak-dot${d.on ? ' on' : ''}">${d.on ? CHECK_ICON_SVG : ''}</span></span>`).join('')}
      </span>`;
    document.getElementById('todayDate').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Current value, goal and meter for one goal; shared by the dashboard card and
  // the exercise detail modal. Cardio with two goals renders it once per metric.
  function progressBlockHtml(ex, metric, opts = {}) {
    const { pct, achieved, best: b } = progressPct(ex, metric);
    const goal = ex.kind === 'cardio' ? cardioGoalFor(ex, metric) : ex.goal;
    const fillPct = Math.min(100, pct);
    const label = metric === 'pace' ? 'Pace' : 'Distance';
    return `
      <div class="ex-card-metric">
        ${opts.labeled ? `<div class="ex-card-metric-label">${label}</div>` : ''}
        <div class="ex-card-values">
          <div class="ex-card-current">${formatValueForExercise(ex, b, metric)}</div>
          ${goal ? `<div class="ex-card-goal">/ ${goalLabelForExercise(ex, metric).replace('Goal ', '')}</div>` : ''}
        </div>
        ${goal ? `
          <div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${fillPct}%"></div></div>
          <div class="ex-card-foot">
            <span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}%`}</span>
          </div>` : ''}
      </div>`;
  }

  // Trim date-sorted `items` to the "Dashboard chart range" setting and map them
  // to {date, value} points, dropping empty ones. Shared by dashboard cards and
  // the detail modals.
  function chartPointsFor(items, valueFn) {
    const scaled = state.settings.chartScale === 'last10' ? items.slice(-10) : items;
    return scaled.map((item) => ({ date: item.date, value: valueFn(item) })).filter((p) => p.value != null);
  }

  // A compact tier bar (used by sleep insights). `abbrevLabels` are the short
  // segment labels; full names and thresholds go in the caption.
  function tierBarHtml(abbrevLabels, currentAbbrev, captionText) {
    return `
      <div class="tier-bar">${abbrevLabels.map((l) => `<div class="tier-seg ${l === currentAbbrev ? 'is-current' : ''}">${l}</div>`).join('')}</div>
      ${captionText ? `<div class="tier-bar-caption muted-text">${captionText}</div>` : ''}`;
  }

  // Strength level card for the exercise detail modal: a `.standards-preview`
  // table showing each tier's multiplier and the weight it means at the current
  // bodyweight. The current tier gets `.is-selected`.
  function strengthStandardsDetailHtml(ex) {
    const info = strengthLevelInfo(ex);
    if (!info) return '';
    const head = '<div class="section-head"><div class="setting-row-label"><span class="setting-icon">'+STATIC_ICONS.trophy+'</span><h2>Strength level</h2></div></div>';
    if (info.needsBodyWeight) return `<div class="card">${head}<p class="muted-text">Log your body weight to see your strength level.</p></div>`;
    if (info.needsSex) return `<div class="card">${head}<p class="muted-text">Set your sex in Settings → Profile to see your strength level.</p></div>`;
    if (info.needsShorterSet) return `<div class="card">${head}<p class="muted-text">Log a set of ${S.ONE_RM_MAX_REPS} reps or fewer to see your strength level. The estimate is not reliable on longer sets.</p></div>`;
    const bw = currentBodyWeightLb();
    const table = LIFT_STANDARDS[ex.liftType][state.profile.sex];
    const thresholds = table.map((mult) => Math.round((bw * mult) / 5) * 5);
    const rows = INSIGHT_TIER_LABELS.map((label, j) => {
      const rightText = j === 0
        ? `Under ${fmtWeight(thresholds[0])}`
        : `${round(table[j - 1], 2)}&times; &middot; ${fmtWeight(thresholds[j - 1])}+`;
      return { label, rightText, isCurrent: label === info.tier };
    });
    return `
      <div class="card">
        ${head}
        <div class="insight-line">${info.oneRepMaxSet.method === 'actual' ? '1RM (logged single)' : 'Estimated 1RM'} ${fmtWeight(info.oneRepMax)} &middot; ${round(info.ratio, 2)}&times; bodyweight &middot; <strong>${info.tier}</strong></div>
        <div class="insight-line muted-text">${info.oneRepMaxSet.method === 'actual' ? 'A real lift you logged.' : `Calculated from ${fmtWeight(info.oneRepMaxSet.weight)} &times; ${info.oneRepMaxSet.reps}.`} Heaviest set logged: ${fmtWeight(info.heaviestLoad)}.</div>
        <div class="standards-preview">
          ${rows.map((r) => `<div class="standards-preview-row${r.isCurrent ? ' is-selected' : ''}"><span>${r.label}</span><span>${r.rightText}</span></div>`).join('')}
        </div>
        <p class="muted-text field-hint">Estimates use the Epley formula on sets of ${S.ONE_RM_MAX_REPS} reps or fewer, compared with community bodyweight-multiple tables for your sex. See About the numbers in Settings.</p>
      </div>`;
  }

  // The "Pace level" counterpart: a `.standards-preview` table with each tier's
  // pace ceiling per mile.
  function paceStandardsDetailHtml(ex) {
    const info = paceLevelInfo(ex);
    if (!info) return '';
    if (info.needsSex) return `<div class="card"><div class="section-head"><h2>Pace level</h2></div><p class="muted-text">Set your sex in Settings → Profile to see your pace level.</p></div>`;
    const ceilings = PACE_TIERS[state.profile.sex];
    const rows = PACE_TIER_LABELS.map((label, i) => ({
      label,
      rightText: i < ceilings.length ? `&le; ${fmtPace(ceilings[i])}` : `&gt; ${fmtPace(ceilings[ceilings.length - 1])}`,
      isCurrent: label === info.tier,
    }));
    return `
      <div class="card">
        <div class="section-head"><h2>Pace level</h2></div>
        <div class="insight-line">${fmtPace(info.pace)} &middot; <strong>${info.tier}</strong></div>
        <div class="standards-preview">
          ${rows.map((r) => `<div class="standards-preview-row${r.isCurrent ? ' is-selected' : ''}"><span>${r.label}</span><span>${r.rightText}</span></div>`).join('')}
        </div>
        <p class="muted-text field-hint">Classified against general pace-per-mile tiers for your sex.</p>
      </div>`;
  }

  // BMI card for the Weight tracker detail modal: a `.standards-preview` table
  // with a colored dot and range per category. The current one gets `.is-selected`.
  function bmiDetailHtml() {
    if (!state.profile.heightCm) {
      return `<div class="card"><div class="section-head"><h2>BMI</h2></div><p class="muted-text">Set your height in Settings → Profile to see your BMI.</p></div>`;
    }
    const insights = weightInsights();
    if (!insights || !insights.bmi) {
      return `<div class="card"><div class="section-head"><h2>BMI</h2></div><p class="muted-text">Log your body weight to see your BMI.</p></div>`;
    }
    const { value, category } = insights.bmi;
    const rows = BMI_CATEGORIES.map((c, i) => ({
      label: c.label,
      range: c.max === Infinity ? `${BMI_CATEGORIES[i - 1].max}+` : (i === 0 ? `Under ${c.max}` : `${BMI_CATEGORIES[i - 1].max}–${c.max}`),
      className: BMI_CATEGORY_CLASS[c.label],
      isCurrent: c.label === category,
    }));
    return `
      <div class="card">
        <div class="section-head"><h2>BMI</h2></div>
        <div class="insight-line"><strong>${value}</strong> &middot; ${category}</div>
        <div class="standards-preview">
          ${rows.map((r) => `<div class="standards-preview-row${r.isCurrent ? ' is-selected' : ''}"><span><span class="category-dot ${r.className}"></span>${r.label}</span><span>${r.range}</span></div>`).join('')}
        </div>
        <p class="muted-text field-hint">From your logged weight and height, using CDC adult categories (age 20+). Doesn't account for muscle mass or body composition, so it can read high if you lift.${state.profile.age && state.profile.age < 20 ? ' These categories are not valid under 20.' : ''}</p>
      </div>`;
  }

  // Sleep card for the tracker detail modal: average and category over recent
  // nights, a tier bar, and average quality when logged.
  function sleepInsightDetailHtml() {
    const insights = sleepInsights();
    if (!insights) {
      return `<div class="card"><div class="section-head"><h2>Sleep insights</h2></div><p class="muted-text">Log a night's sleep to see your trend.</p></div>`;
    }
    const w = insights.window; const r = insights.recent;
    const cats = S.SLEEP.categories;
    const abbrev = cats.map((c) => c.short);
    const current = w.category ? cats.find((c) => c.label === w.category).short : null;
    const caption = '&lt;6h Short &middot; 6&ndash;7h Slightly short &middot; 7&ndash;9h Adequate &middot; &gt;9h Long';
    const first = new Date(r.since + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="card">
        <div class="section-head"><h2>Sleep insights</h2></div>
        ${w.nights ? `<div class="insight-line">Last ${w.days} nights: avg ${round(w.avgHours, 1)}h &middot; ${w.nights} of ${w.days} logged${w.category ? ` &middot; <strong>${w.category}</strong>` : ''}</div>` : `<div class="insight-line muted-text">No nights logged in the last ${w.days} days.</div>`}
        ${w.nights && !w.category ? `<div class="insight-line muted-text">Log ${S.SLEEP.minNightsForLabel} or more nights in a week for a label.</div>` : ''}
        <div class="insight-line muted-text">Last ${r.nights} logged night${r.nights === 1 ? '' : 's'} (since ${first}): avg ${round(r.avgHours, 1)}h &middot; ${r.category}</div>
        ${(w.avgQuality ?? r.avgQuality) != null ? `<div class="insight-line muted-text">Avg quality ${fmtQuality(round(w.avgQuality ?? r.avgQuality, 1))}</div>` : ''}
        ${current ? tierBarHtml(abbrev, current, caption) : ''}
        <p class="muted-text field-hint">Against the 7&ndash;9 hour adult range (NSF). Not a medical assessment.</p>
      </div>`;
  }

  function goalCardHtml(ex) {
    const entries = entriesFor(ex.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const cardioMetrics = ex.kind === 'cardio' ? cardioMetricsOf(ex) : null;
    const trendMetric = cardioMetrics ? cardioMetrics[0] : undefined;
    const progressHtml = cardioMetrics
      ? (cardioMetrics.length
          ? cardioMetrics.map((m) => progressBlockHtml(ex, m, { labeled: cardioMetrics.length > 1 })).join('')
          : progressBlockHtml(ex, 'distance'))
      : progressBlockHtml(ex);
    const chartPoints = chartPointsFor(entries, (e) => entryValue(ex, e, trendMetric));
    const chartGoal = cardioMetrics ? (trendMetric ? cardioGoalFor(ex, trendMetric) : null) : ex.goal;
    // Strength and Pace level are detail-on-demand (see openExerciseDetail), not shown here.
    return `
      <div class="card ex-card" data-exercise-id="${ex.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${exerciseIconHtml(ex, true)}${exerciseLabelHtml(ex)}</div>
          <div class="ex-card-badge">${kindBadge(ex)}</div>
        </div>
        ${progressHtml}
        ${chartPoints.length >= 2 ? `<div class="ex-card-chart">${Charts.lineChart(chartPoints, { goal: chartGoal, width: 300, height: 96, formatValue: (v) => formatValueForExercise(ex, v, trendMetric) })}</div>` : ''}
      </div>`;
  }

  /* ---- Home rows ----
     Every Home section is a card of `.glance-row`s: icon, name, value, meter, optional action. */

  // Today's progress toward one daily target, as display text plus a 0-100+
  // percentage (null when the exercise has no goal to measure against).
  function todayProgressOf(ex) {
    const today = entriesFor(ex.id).filter((e) => e.date === todayISO());
    if (ex.kind === 'habit') {
      const goal = ex.goal || 1;
      return { curText: String(today.length), goalText: `/ ${goal} today`, pct: (today.length / goal) * 100 };
    }
    if (ex.kind === 'cardio') {
      const metric = cardioMetricsOf(ex)[0] || 'distance';
      const vals = today.map((e) => entryValue(ex, e, metric)).filter((v) => v != null);
      const cur = vals.length ? (isLowerBetter(ex, metric) ? Math.min(...vals) : Math.max(...vals)) : null;
      const goal = cardioGoalFor(ex, metric);
      const pct = cur == null || !goal ? 0 : (isLowerBetter(ex, metric) ? (goal / cur) * 100 : (cur / goal) * 100);
      return { curText: cur == null ? '0' : formatValueForExercise(ex, cur, metric), goalText: goal ? `/ ${goalLabelForExercise(ex, metric).replace('Goal ', '')}` : '', pct: goal ? pct : null };
    }
    if (ex.kind === 'weight') {
      const vals = today.map((e) => entryValue(ex, e)).filter((v) => v != null);
      const cur = vals.length ? Math.max(...vals) : null;
      return { curText: cur == null ? '0' : fmtWeight(cur), goalText: ex.goal ? `/ ${fmtWeight(ex.goal)}` : '', pct: ex.goal ? ((cur || 0) / ex.goal) * 100 : null };
    }
    const cur = today.reduce((sum, e) => sum + (e.sets || []).reduce((m, st) => m + (st.reps || 0), 0), 0);
    return { curText: String(cur), goalText: isTimed(ex) ? (ex.goal ? `/ ${fmtHold(ex.goal)}` : '') : (ex.goal ? `/ ${Math.round(ex.goal)} reps` : 'reps'), pct: ex.goal ? (cur / ex.goal) * 100 : null };
  }

  function glanceMeterHtml(ex, pct) {
    if (ex.kind === 'habit') {
      const goal = Math.min(ex.goal || 1, 6);
      const done = entriesFor(ex.id).filter((e) => e.date === todayISO()).length;
      return `<div class="meter-segs">${Array.from({ length: goal }, (_, i) => `<span class="meter-seg${i < done ? ' on' : ''}"></span>`).join('')}</div>`;
    }
    if (pct == null) return '';
    return `<div class="meter meter-sm"><div class="meter-fill ${pct >= 100 ? 'is-complete' : ''}" style="--fill:${Math.min(100, pct)}%"></div></div>`;
  }

  // A Daily targets row. A habit logs in one tap ("Done", then "+1" once its count
  // is met); others open Log. The button stays after the target is met.
  function dailyTargetRowHtml(ex) {
    const prog = todayProgressOf(ex);
    const complete = prog.pct != null && prog.pct >= 100;
    const isHabit = ex.kind === 'habit';
    return `
      <div class="glance-row${complete ? ' is-complete' : ''}" data-exercise-id="${ex.id}">
        <div class="glance-open">
          ${exerciseIconHtml(ex)}
          <div class="glance-main">
            <div class="glance-line">
              <span class="glance-name">${exerciseLabelHtml(ex)}</span>
              <span class="glance-value">${complete ? CHECK_ICON_SVG : ''}<span>${prog.curText}<span class="muted-text"> ${prog.goalText}</span></span></span>
            </div>
            ${glanceMeterHtml(ex, prog.pct)}
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm glance-btn" data-action="${isHabit ? 'log-habit' : 'log-daily'}">${isHabit ? (complete ? '+1' : 'Done') : 'Add'}</button>
      </div>`;
  }

  // Whether a trend delta is good news for this tracker, by its `direction`
  // (down: shrinking is good; otherwise growing). With no direction it stays neutral.
  function deltaSentiment(tracker, delta) {
    if (!tracker.direction || delta === 0) return 'neutral';
    return (tracker.direction === 'down' ? delta < 0 : delta > 0) ? 'good' : 'bad';
  }

  // A tracker's dashboard card, shaped like goalCardHtml. The Weight tracker also
  // gets a trend badge when "Body weight insights" is on.
  function trackerCardHtml(tracker) {
    const isSleep = tracker.kind === 'sleep';
    // Sleep is a per-night reading, so its headline value is today's entry only (a
    // dash if none). Other trackers show the latest value ever logged.
    const todayEntry = isSleep ? state.measurements.find((m) => m.trackerId === tracker.id && m.date === todayISO()) : null;
    const latest = isSleep ? todayEntry : latestMeasurement(tracker.id);
    const value = latest ? latest.value : null;
    const { pct, achieved } = trackerProgressPct(tracker, value);
    const fillPct = Math.min(100, pct);
    const history = measurementsFor(tracker.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const chartPoints = chartPointsFor(history, (m) => m.value);
    const insights = (tracker.id === BODY_WEIGHT_TRACKER_ID && state.settings.showWeightInsights) ? weightInsights() : null;
    // insights.trend.delta is in lb (the storage unit); convert it to the display
    // unit shown next to the label.
    const deltaDisplay = insights && insights.trend ? Units.lbToDisplay(insights.trend.delta) : null;
    const deltaBadge = insights && insights.trend
      ? `<div class="ex-card-delta is-${deltaSentiment(tracker, insights.trend.delta)}">${deltaDisplay > 0 ? '+' : ''}${round(deltaDisplay, 1)} ${Units.weightUnitLabel()} in ${humanizeDays(insights.trend.days)}</div>`
      : '';
    // BMI is not shown here (see bmiDetailHtml()); Sleep gets a short average badge
    // instead (full breakdown: sleepInsightDetailHtml()).
    const sleep = (isSleep && state.settings.showSleepInsights) ? sleepInsights() : null;
    const sleepBadge = sleep ? `<div class="ex-card-delta">${sleep.window.nights ? `Avg ${round(sleep.window.avgHours, 1)}h &middot; ${sleep.window.nights} of ${sleep.window.days} nights` : `Last ${sleep.recent.nights} logged: avg ${round(sleep.recent.avgHours, 1)}h`}</div>` : '';
    const qualityLine = isSleep && latest && latest.quality != null
      ? `<div class="insight-line">Quality ${fmtQuality(latest.quality)}</div>` : '';
    // With a goal but no reading (never logged, or Sleep not logged today), show no
    // meter: trackerProgressPct() returns 0, which would read as "measured zero".
    const hasProgress = tracker.goal != null && value != null;
    return `
      <div class="card ex-card" data-tracker-id="${tracker.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${trackerIconHtml(tracker, true)}${escapeHtml(tracker.name)}</div>
          ${deltaBadge}${sleepBadge}
        </div>
        <div class="ex-card-values">
          <div class="ex-card-current">${fmtTrackerValue(tracker, value)}</div>
          ${tracker.goal != null ? `<div class="ex-card-goal">/ ${trackerGoalLabel(tracker).replace('Goal ', '')}</div>` : ''}
        </div>
        ${hasProgress ? `
          <div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${fillPct}%"></div></div>
          <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}%`}</span></div>
          ${!achieved && trackerProgressDeltaText(tracker, value) ? `<div class="insight-line muted-text">${trackerProgressDeltaText(tracker, value)}</div>` : ''}` : ''}
        ${tracker.goal != null && value == null ? `<p class="muted-text field-hint">${isSleep ? 'Not logged today.' : 'Log a value to see your progress.'}</p>` : ''}
        ${chartPoints.length >= 2 ? `<div class="ex-card-chart">${Charts.lineChart(chartPoints, { goal: tracker.goal, width: 300, height: 96, formatValue: (v) => fmtTrackerValue(tracker, v) })}</div>` : ''}
        ${qualityLine}
      </div>`;
  }

  function renderBodySection() {
    // Manage lists every tracker; hiding one from the dashboard (showOnDashboard)
    // does not archive it. Body switched off in Manage hides this whole section.
    const trackers = domainTracked('measurements') ? activeTrackers().filter((t) => t.showOnDashboard !== false) : [];
    document.getElementById('bodySectionHead').hidden = trackers.length === 0;
    const wrap = document.getElementById('bodyCards');
    wrap.hidden = trackers.length === 0;
    wrap.innerHTML = trackers.map(trackerCardHtml).join('');
    wrap.querySelectorAll('[data-tracker-id]').forEach((card) => {
      wireOpenable(card, () => openTrackerDetail(card.getAttribute('data-tracker-id')));
    });
  }

  function cupButtonsHtml() {
    return state.water.cups.map((cup) => `
      <button type="button" class="btn btn-secondary cup-btn" data-cup-id="${cup.id}">
        <span class="cup-btn-name-row">${itemIconSvg(cupIconKey(cup))}<span>${escapeHtml(cup.name)}</span></span>
        <span class="cup-btn-amount">${fmtVolume(cup.amountMl)}</span>
      </button>`).join('');
  }

  // Water is one tap (pick a cup), so it can be logged from the dashboard as well as Log.
  function logWaterAmount(amountMl, cupId) {
    if (!amountMl || amountMl <= 0) { toast('Enter an amount greater than zero.'); return; }
    if (tooBigWater(amountMl)) { toast(WATER_TOO_BIG); return; }
    state.waterEntries.push({ id: genId('wtr'), date: todayISO(), amountMl, cupId: cupId || null });
    if (!save()) return;
    toast('Water logged');
    renderDashboard();
    renderRecentEntries();
    renderHistory();
  }

  // Id of exId's newest entry today, or ''. genId() ids start with a base36
  // timestamp, so string comparison sorts by time. Orders the "logged today" list.
  function latestTodayEntryId(exId) {
    return entriesFor(exId)
      .filter((en) => en.date === todayISO())
      .reduce((max, en) => (en.id > max ? en.id : max), '');
  }

  /* ============================== Returning-user setup review ==============================
     Offers a lightly used existing install a one-time look at tracking options
     added since it started (new defaults do not reach saved settings). It is not
     a re-run of the wizard, which replaces data; it only flips settings booleans. */

  const SETUP_REVIEW_MAX_ENTRIES = 3; // "lightly used": this many logged items or fewer, across every domain
  const SETUP_REVIEW_MIN_INSTALL_DAYS = 3; // give a fresh install a few days before treating light use as "gone stale" rather than "just started"

  function totalLoggedItemCount() {
    return state.entries.length + state.food.entries.length + state.waterEntries.length + state.measurements.length;
  }

  // The earliest createdAt on any exercise or tracker stands in for the install
  // date; nothing else records one.
  function installedAtEstimate() {
    const stamps = [...state.exercises, ...state.trackers].map((x) => x.createdAt).filter(Boolean);
    return stamps.length ? stamps.reduce((a, b) => (a < b ? a : b)) : null;
  }

  function shouldOfferSetupReview() {
    if (state.settings.setupReviewPromptSeen) return false;
    if (totalLoggedItemCount() > SETUP_REVIEW_MAX_ENTRIES) return false; // already in real use: the review is not for active users
    const installedAt = installedAtEstimate();
    if (!installedAt) return false;
    const daysSinceInstall = (Date.now() - new Date(installedAt).getTime()) / 86400000;
    return daysSinceInstall >= SETUP_REVIEW_MIN_INSTALL_DAYS;
  }

  function renderSetupReviewBanner() {
    document.getElementById('setupReviewBanner').hidden = !shouldOfferSetupReview();
  }

  // "Not now": marks the prompt seen without changing any setting.
  function dismissSetupReviewPrompt() {
    state.settings.setupReviewPromptSeen = true;
    if (!save()) return;
    renderSetupReviewBanner();
  }

  // The review screen: a checklist over live settings (no draft, unlike the
  // wizard), using the wizard's setupBoolRowHtml/wireSetupBoolRow. Each toggle
  // saves and re-renders at once.
  function openSetupReviewModal() {
    const s = state.settings;
    const macroRowHtml = (k) => setupBoolRowHtml(`review_macro_${k}`, MACRO_LABELS[k], macroGoalInfo(k).enabled);
    openModal(`
      <div class="modal-title-row"><h2>Review your tracking</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text">Fit Log has added tracking options and insight cards since you started — here's a chance to double check what's on. Nothing you've already logged changes either way.</p>
      <div class="card form-card">
        <div class="section-head"><h2>What do you track?</h2></div>
        ${setupBoolRowHtml('review_trackWorkout', 'Lifting', s.trackWorkout)}
        ${setupBoolRowHtml('review_trackCardio', 'Running & cardio', s.trackCardio)}
        ${setupBoolRowHtml('review_trackHabits', 'Habits & daily reps', s.trackHabits)}
        ${setupBoolRowHtml('review_trackMeasurements', 'Body', s.trackMeasurements)}
        ${setupBoolRowHtml('review_trackWater', 'Water', s.trackWater)}
        ${setupBoolRowHtml('review_trackFood', 'Food', s.trackFood)}
      </div>
      ${s.trackFood ? `<div class="card form-card">
        <div class="section-head"><h2>Nutrition extras</h2></div>
        ${macroRowHtml('sugar')}
        ${macroRowHtml('sodium')}
        ${macroRowHtml('caffeine')}
      </div>` : ''}
      <div class="card form-card">
        <div class="section-head"><h2>Insights &amp; guidance</h2></div>
        ${setupBoolRowHtml('review_showWeightInsights', 'Body weight insights', s.showWeightInsights)}
        ${setupBoolRowHtml('review_showStrengthLevel', 'Strength level', s.showStrengthLevel)}
        ${setupBoolRowHtml('review_showPaceLevel', 'Pace level', s.showPaceLevel)}
        ${setupBoolRowHtml('review_showSleepInsights', 'Sleep insights', s.showSleepInsights)}
        ${setupBoolRowHtml('review_showMacroGuidance', 'Daily-value guidance', s.showMacroGuidance)}
      </div>
      <button type="button" class="btn btn-primary btn-block" id="setupReviewDoneBtn">Done</button>
    `, { tall: true });

    const rerender = () => openSetupReviewModal();
    wireSetupBoolRow('review_trackWorkout', (v) => { s.trackWorkout = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_trackCardio', (v) => { s.trackCardio = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_trackHabits', (v) => { s.trackHabits = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_trackMeasurements', (v) => { s.trackMeasurements = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_trackWater', (v) => { s.trackWater = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_trackFood', (v) => { s.trackFood = v; if (!save()) return; renderAll(); rerender(); });
    ['sugar', 'sodium', 'caffeine'].forEach((k) => {
      if (document.getElementById(`review_macro_${k}`)) {
        wireSetupBoolRow(`review_macro_${k}`, (v) => { macroGoalInfo(k).enabled = v; if (!save()) return; renderAll(); rerender(); });
      }
    });
    wireSetupBoolRow('review_showWeightInsights', (v) => { s.showWeightInsights = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_showStrengthLevel', (v) => { s.showStrengthLevel = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_showPaceLevel', (v) => { s.showPaceLevel = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_showSleepInsights', (v) => { s.showSleepInsights = v; if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_showMacroGuidance', (v) => { s.showMacroGuidance = v; if (!save()) return; renderAll(); rerender(); });

    document.getElementById('setupReviewDoneBtn').addEventListener('click', () => {
      dismissSetupReviewPrompt();
      closeModal();
      toast('Preferences updated');
    });
  }

  /* ============================== Home sections ==============================
     Each section belongs to one module and disappears with it. Home only reads existing data. */

  const dayLabel = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  function openLogCategory(cat) { logCategory = cat; switchTab('log'); }
  function openManageCategory(cat) { manageCategory = cat; switchTab('manage'); }

  // Exercises that belong in Training: lifts and cardio, not the daily
  // counters and habits that live in the Checklist.
  function trainingExercises() {
    return activeExercises().filter((e) => e.kind !== 'habit' && sectionOf(e) !== 'daily');
  }

  const homeSectionOn = (key) => F.homeSectionOn(state.settings, key);

  function renderChecklist(all) {
    const daily = homeSectionOn('checklist') ? all.filter((e) => sectionOf(e) === 'daily' && (e.kind !== 'habit' || habitDueToday(e))) : [];
    document.getElementById('dailyTargetsHead').hidden = daily.length === 0;
    const done = daily.filter((e) => { const p = todayProgressOf(e); return p.pct != null && p.pct >= 100; }).length;
    document.getElementById('checklistCount').textContent = `${done} of ${daily.length} done`;
    const wrap = document.getElementById('dailyTargetsWrap');
    wrap.hidden = daily.length === 0;
    wrap.innerHTML = daily.map(dailyTargetRowHtml).join('');
    wrap.querySelectorAll('.glance-row').forEach((row) => {
      const exId = row.getAttribute('data-exercise-id');
      wireOpenable(row.querySelector('.glance-open'), () => openExerciseDetail(exId));
      row.querySelector('.glance-btn').addEventListener('click', () => {
        if (row.querySelector('.glance-btn').dataset.action === 'log-habit') logHabit(exId);
        else openLogFor(exId);
      });
    });
  }

  function renderTraining() {
    const show = homeSectionOn('training') && (state.settings.trackWorkout || cardioTracked());
    document.getElementById('trainingHead').hidden = !show;
    const wrap = document.getElementById('trainingWrap');
    wrap.hidden = !show;
    if (!show) return;
    const lifts = trainingExercises();
    const today = todayISO();
    const doneToday = lifts
      .filter((e) => entriesFor(e.id).some((en) => en.date === today))
      .sort((a, b) => latestTodayEntryId(b.id).localeCompare(latestTodayEntryId(a.id)));
    const rows = doneToday.map((ex) => {
      const en = entriesFor(ex.id).filter((x) => x.date === today).slice(-1)[0];
      const sets = en.sets ? en.sets.length : 0;
      const top = topSetOf(ex, en);
      const prior = entriesFor(ex.id).filter((x) => x.date < today).map((x) => entryValue(ex, x)).filter((v) => v != null);
      const val = entryValue(ex, en);
      const priorTop = prior.length ? (isLowerBetter(ex) ? Math.min(...prior) : Math.max(...prior)) : null;
      const isBest = val != null && priorTop != null && (isLowerBetter(ex) ? val < priorTop : val > priorTop);
      const tiesBest = val != null && priorTop != null && val === priorTop;
      const topText = top && ex.kind === 'weight' ? ` · top ${fmtWeight(top.weight)} × ${top.reps}` : '';
      return `
        <div class="glance-row" data-exercise-id="${ex.id}">
          <div class="glance-open">
            ${exerciseIconHtml(ex)}
            <div class="glance-main">
              <div class="glance-name">${exerciseLabelHtml(ex)}${isBest ? ' <span class="tag tag-good">New best</span>' : tiesBest ? ' <span class="tag tag-good">Ties best</span>' : ''}</div>
              <div class="glance-sub">Today · ${sets} set${sets === 1 ? '' : 's'}${topText}</div>
            </div>
            ${CHEVRON_RIGHT_SVG}
          </div>
        </div>`;
    }).join('');
    let empty = '';
    if (!doneToday.length) {
      const last = lifts.flatMap((e) => entriesFor(e.id).map((en) => ({ e, en }))).sort((a, b) => b.en.date.localeCompare(a.en.date));
      const lastDate = last.length ? last[0].en.date : null;
      const names = lastDate ? Array.from(new Set(last.filter((x) => x.en.date === lastDate).map((x) => exerciseLabel(x.e)))).slice(0, 3).join(', ') : '';
      empty = `
        <div class="glance-row">
          <div class="glance-open">
            ${itemIconHtml('dumbbell')}
            <div class="glance-main">
              <div class="glance-name">Nothing lifted yet today</div>
              <div class="glance-sub">${lastDate ? `Last lifted ${dayLabel(lastDate)} · ${escapeHtml(names)}` : 'Log your first set to get started'}</div>
            </div>
          </div>
        </div>`;
    }
    const favs = lifts.filter(isFavoriteExercise).slice(0, 3);
    wrap.innerHTML = `${rows}${empty}
      <div class="home-card-foot">
        ${favs.length ? `<div class="quick-chips">${favs.map((e) => `<button type="button" class="quick-chip" data-quick-ex="${e.id}">${itemIconSvg(exerciseIconKey(e))}<span>${exerciseLabelHtml(e)}</span></button>`).join('')}</div>` : ''}
        <button type="button" class="btn btn-primary btn-block" id="homeLogSetBtn">${uiIcon('plus')}Log a set</button>
      </div>`;
    wrap.querySelectorAll('.glance-row[data-exercise-id]').forEach((row) => wireOpenable(row.querySelector('.glance-open'), () => openExerciseDetail(row.getAttribute('data-exercise-id'))));
    wrap.querySelectorAll('[data-quick-ex]').forEach((b) => b.addEventListener('click', () => openLogFor(b.dataset.quickEx)));
    document.getElementById('homeLogSetBtn').addEventListener('click', () => openLogCategory('workout'));
  }

  function foodRingHtml(eaten, goal) {
    const r = 38, c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, eaten / goal));
    const over = eaten > goal;
    return `<svg class="food-ring${over ? ' is-over' : ''}" width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="${Math.round(eaten)} of ${Math.round(goal)} calories">
      <circle cx="46" cy="46" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
      ${pct > 0 ? `<circle class="food-ring-arc" cx="46" cy="46" r="${r}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 46 46)"/>` : ''}
      <text x="46" y="45" text-anchor="middle" font-size="19" font-weight="800" fill="var(--text-primary)">${Math.round(eaten).toLocaleString()}</text>
      <text x="46" y="60" text-anchor="middle" font-size="12" fill="var(--muted)">of ${Math.round(goal).toLocaleString()}</text>
    </svg>`;
  }

  function renderNutrition() {
    const show = homeSectionOn('nutrition') && state.settings.trackFood;
    document.getElementById('nutritionHead').hidden = !show;
    const wrap = document.getElementById('nutritionWrap');
    wrap.hidden = !show;
    if (!show) return;
    const totals = foodTotalsForDate(todayISO());
    const cal = macroGoalInfo('calories');
    const hasGoal = cal.enabled && cal.goal != null;
    const eaten = totals.calories || 0;
    const keys = trackedMacroKeys().filter((k) => k !== 'calories');
    const bars = keys.filter((k) => macroGoalInfo(k).enabled && macroGoalInfo(k).goal != null && ['protein', 'carbs', 'fat'].includes(k)).slice(0, 3);
    const rest = keys.filter((k) => !bars.includes(k));
    const barHtml = bars.map((k) => {
      const info = macroGoalInfo(k); const v = totals[k] || 0; const pct = Math.min(100, (v / info.goal) * 100);
      return `<div class="macro${v > info.goal ? ' is-over' : ''}"><div class="top"><span>${MACRO_LABELS[k]}</span><span><b>${Math.round(v)}</b> / ${fmtMacroValue(k, info.goal)}</span></div><div class="meter meter-sm"><div class="meter-fill" style="--fill:${pct}%"></div></div></div>`;
    }).join('');
    const tiles = rest.map((k) => `<div class="mini-tile"><b>${totals[k] == null ? '—' : fmtMacroValue(k, totals[k])}</b><span>${MACRO_LABELS[k]}</span></div>`).join('');
    const lastUsed = savedFoodLastUsedMap();
    const recent = state.food.savedFoods.filter((f) => lastUsed[f.id]).sort((a, b) => lastUsed[b.id].localeCompare(lastUsed[a.id])).slice(0, 3);
    wrap.innerHTML = `
      <div class="home-card-body" id="foodGlance" role="button" tabindex="0" aria-label="Open today's food">
        <div class="nutri-top">
          ${hasGoal ? foodRingHtml(eaten, cal.goal) : `<div class="nutri-total"><span class="big">${Math.round(eaten).toLocaleString()}</span><span class="muted-text">cal today</span></div>`}
          ${barHtml ? `<div class="nutri-bars">${barHtml}</div>` : ''}
        </div>
        ${tiles ? `<div class="mini-tiles">${tiles}</div>` : ''}
      </div>
      <div class="home-card-foot">
        ${recent.length ? `<div class="quick-chips">${recent.map((f) => `<button type="button" class="quick-chip" data-quick-food="${f.id}">${uiIcon('plus')}<span>${escapeHtml(f.name)}</span></button>`).join('')}</div>` : ''}
        <button type="button" class="btn btn-primary btn-block" id="homeAddFoodBtn">${uiIcon('plus')}Add food</button>
      </div>`;
    wireOpenable(document.getElementById('foodGlance'), openFoodDetail);
    wrap.querySelectorAll('[data-quick-food]').forEach((b) => b.addEventListener('click', () => logSavedFood(b.dataset.quickFood, 1, todayISO())));
    document.getElementById('homeAddFoodBtn').addEventListener('click', () => openLogCategory('food'));
  }

  function sparklineHtml(values) {
    if (values.length < 2) return '';
    const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${(30 - ((v - lo) / span) * 26 - 2).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function trackerMiniHtml(t) {
    const list = measurementsFor(t.id).slice().sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    const last = list[list.length - 1];
    const loggedToday = list.some((m) => m.date === todayISO());
    const insights = (t.id === BODY_WEIGHT_TRACKER_ID && state.settings.showWeightInsights) ? weightInsights() : null;
    let delta = '';
    if (insights && insights.trend) {
      const d = Units.lbToDisplay(insights.trend.delta);
      delta = `<span class="mini-delta is-${deltaSentiment(t, insights.trend.delta)}">${d > 0 ? '+' : ''}${round(d, 1)} ${Units.weightUnitLabel()} in ${humanizeDays(insights.trend.days)}</span>`;
    }
    return `
      <div class="card home-mini" data-tracker-id="${t.id}">
        <div class="mini-head"><span class="mini-label">${escapeHtml(t.name)}</span></div>
        <div class="mini-value">${last ? fmtTrackerValue(t, last.value) : '—'}</div>
        ${sparklineHtml(list.slice(-9).map((m) => m.value))}
        ${delta}
        <button type="button" class="btn btn-secondary btn-sm" data-action="log-tracker-prompt">${loggedToday ? 'Log again' : 'Log'}</button>
      </div>`;
  }

  function waterMiniHtml() {
    const { pct, total } = waterProgressPct(todayISO());
    const goal = state.water.goalMl;
    return `
      <div class="card home-mini" id="homeWaterCard">
        <div class="mini-head"><span class="mini-label">Water</span><button type="button" class="icon-btn icon-btn-sm" id="homeWaterPencil" aria-label="Edit water">${EDIT_ICON_SVG}</button></div>
        <div class="mini-value">${fmtVolume(total)}${goal ? `<span class="muted-text"> / ${fmtVolume(goal)}</span>` : ''}</div>
        ${goal ? glanceMeterHtml({}, pct) : ''}
        ${state.water.cups.slice(0, 2).map((cup) => `<button type="button" class="btn btn-secondary btn-sm" data-cup-id="${cup.id}"><span>+ ${escapeHtml(cup.name)}</span><span class="muted-text">${fmtVolume(cup.amountMl)}</span></button>`).join('')}
      </div>`;
  }

  function renderMiniGrid() {
    const on = homeSectionOn('mini');
    const water = on && domainTracked('water') && state.water.cups.length > 0;
    const trackers = on && domainTracked('measurements') ? activeTrackers().filter((t) => t.showOnDashboard !== false) : [];
    const wrap = document.getElementById('miniGrid');
    wrap.hidden = !(water || trackers.length);
    wrap.innerHTML = (water ? waterMiniHtml() : '') + trackers.map(trackerMiniHtml).join('');
    wrap.querySelectorAll('[data-cup-id]').forEach((btn) => btn.addEventListener('click', () => {
      const cup = cupById(btn.dataset.cupId);
      if (cup) logWaterAmount(cup.amountMl, cup.id);
    }));
    const wp = document.getElementById('homeWaterPencil');
    if (wp) wp.addEventListener('click', () => openManageCategory('water'));
    wrap.querySelectorAll('[data-tracker-id]').forEach((card) => {
      wireOpenable(card, () => openTrackerDetail(card.dataset.trackerId));
      card.querySelector('[data-action="log-tracker-prompt"]').addEventListener('click', (ev) => { ev.stopPropagation(); logTrackerFromDetail(card.dataset.trackerId); });
    });
  }

  // Every goal in one list, computed from the logs each time it is shown:
  // a goal stores only what you want, never how far along you are.
  function collectGoals() {
    const items = [];
    activeExercises().forEach((ex) => {
      const sec = sectionOf(ex);
      if (ex.kind === 'habit' || sec === 'daily') {
        if (!ex.goal && ex.kind !== 'habit') return;
        if (ex.kind === 'habit' && !habitDueToday(ex)) return;
        const p = todayProgressOf(ex);
        if (p.pct == null) return;
        items.push({ type: 'daily', ex, name: exerciseLabel(ex), icon: exerciseIconHtml(ex), cur: p.curText, goal: p.goalText.replace(/^\/ /, ''), pct: p.pct, met: p.pct >= 100, open: () => openExerciseDetail(ex.id) });
        return;
      }
      const metric = ex.kind === 'cardio' ? (cardioMetricsOf(ex)[0] || 'distance') : undefined;
      const goal = ex.kind === 'cardio' ? cardioGoalFor(ex, metric) : ex.goal;
      if (!goal) return;
      const { pct, best: b } = progressPct(ex, metric);
      items.push({ type: ex.kind === 'cardio' ? 'cardio' : 'lift', ex, name: exerciseLabel(ex), icon: exerciseIconHtml(ex), cur: formatValueForExercise(ex, b, metric), goal: goalLabelForExercise(ex, metric).replace('Goal ', ''), pct, met: pct >= 100, open: () => openExerciseDetail(ex.id) });
    });
    if (domainTracked('measurements')) {
      activeTrackers().forEach((t) => {
        if (t.goal == null) return;
        const latest = t.kind === 'sleep' ? null : latestMeasurement(t.id);
        if (!latest) return;
        const { pct, achieved } = trackerProgressPct(t, latest.value);
        items.push({ type: 'body', tracker: t, name: t.name, icon: trackerIconHtml(t), cur: fmtTrackerValue(t, latest.value), goal: fmtTrackerValue(t, t.goal), arrow: true, pct: achieved ? pct : Math.min(pct, 99), met: achieved, open: () => openTrackerDetail(t.id) });
      });
    }
    if (state.settings.trackFood) {
      const totals = foodTotalsForDate(todayISO());
      ['calories', 'protein'].forEach((k) => {
        const info = macroGoalInfo(k);
        if (!info || !info.enabled || info.goal == null || (k !== 'calories' && !macroTracked(k))) return;
        const v = totals[k] || 0;
        items.push({ type: 'food', name: `${MACRO_LABELS[k]} today`, icon: itemIconHtml('apple'), cur: fmtMacroValue(k, v), goal: fmtMacroValue(k, info.goal), pct: (v / info.goal) * 100, met: k === 'protein' && v >= info.goal, open: () => openFoodDetail() });
      });
    }
    return items;
  }

  function goalRowHtml(g, idx) {
    const pct = Math.min(100, g.pct || 0);
    return `
      <div class="glance-row${g.met ? ' is-complete' : ''}" data-goal-idx="${idx}">
        <div class="glance-open">
          ${g.icon}
          <div class="glance-main">
            <div class="glance-line">
              <span class="glance-name">${escapeHtml(g.name)}</span>
              <span class="glance-value">${g.met ? '<span class="tag tag-good">Goal met</span>' : `<span>${g.cur}<span class="muted-text"> ${g.arrow ? '→' : '/'} ${g.goal}</span></span>`}</span>
            </div>
            <div class="meter meter-sm"><div class="meter-fill ${g.met ? 'is-complete' : ''}" style="--fill:${pct}%"></div></div>
          </div>
        </div>
      </div>`;
  }

  function renderGoalsStrip() {
    const all = collectGoals().filter((g) => g.type === 'lift' || g.type === 'cardio' || g.type === 'body');
    const open = all.filter((g) => !g.met).sort((a, b) => b.pct - a.pct);
    const pick = homeSectionOn('goals') ? (open.length ? open : all).slice(0, 3) : [];
    document.getElementById('goalsHead').hidden = pick.length === 0;
    const wrap = document.getElementById('goalsWrap');
    wrap.hidden = pick.length === 0;
    wrap.innerHTML = pick.map((g, i) => goalRowHtml(g, i)).join('');
    wrap.querySelectorAll('[data-goal-idx]').forEach((row) => wireOpenable(row.querySelector('.glance-open'), pick[Number(row.dataset.goalIdx)].open));
  }

  // Home (streak, checklist, training, nutrition, goals strip) plus Progress (goal
  // list and trend cards). Call renderDashboard() to refresh both.
  function renderDashboard() {
    renderHome();
    renderProgress();
  }

  function renderHome() {
    renderSetupReviewBanner();
    renderSummary();
    renderChecklist(activeExercises());
    renderTraining();
    renderNutrition();
    renderMiniGrid();
    renderGoalsStrip();
  }

  // Progress: every goal card (including ones also shown on Home today),
  // then the body & wellness trends.
  let progressSeg = 'goals';

  function renderProgressGoals() {
    const goals = collectGoals();
    const groups = [
      ['Lifts', (g) => g.type === 'lift'],
      ['Body', (g) => g.type === 'body'],
      ['Today', (g) => g.type === 'food'],
      ['Daily reps and habits', (g) => g.type === 'daily'],
      ['Cardio', (g) => g.type === 'cardio'],
    ];
    const wrap = document.getElementById('goalsGroups');
    let idx = 0; const flat = [];
    wrap.innerHTML = groups.map(([title, test]) => {
      const list = goals.filter(test);
      if (!list.length) return '';
      const rows = list.map((g) => { flat.push(g); return goalRowHtml(g, idx++); }).join('');
      const met = list.filter((g) => g.met).length;
      return `<div class="section-head"><h2>${title}</h2><span class="muted-text">${met ? `${met} of ${list.length} met` : ''}</span></div><div class="card card-list">${rows}</div>`;
    }).join('');
    document.getElementById('goalsEmpty').hidden = goals.length > 0;
    wrap.querySelectorAll('[data-goal-idx]').forEach((row) => wireOpenable(row.querySelector('.glance-open'), flat[Number(row.dataset.goalIdx)].open));
  }

  function renderProgress() {
    document.querySelectorAll('#progressSeg [data-progress-seg]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.progressSeg === progressSeg)));
    document.getElementById('progressGoals').hidden = progressSeg !== 'goals';
    document.getElementById('progressCharts').hidden = progressSeg !== 'charts';
    renderProgressGoals();
    const all = activeExercises();
    const goalList = all.filter((e) => sectionOf(e) === 'goal');
    document.getElementById('dashboardEmpty').hidden = !domainTracked('workout') || (goalList.length + all.filter((e) => sectionOf(e) === 'daily').length) > 0;

    const cardsWrap = document.getElementById('exerciseCards');
    cardsWrap.innerHTML = goalList.map(goalCardHtml).join('');
    cardsWrap.querySelectorAll('.ex-card[data-exercise-id]').forEach((card) => {
      wireOpenable(card, () => openExerciseDetail(card.getAttribute('data-exercise-id')));
    });

    renderBodySection();
  }

  // Daily {date, value} points for one macro, for the Food detail Trend chart.
  // Days with no value are left out (a gap, not a zero).
  function foodChartEntriesFor(key) {
    const dates = Array.from(new Set(state.food.entries.map((e) => e.date))).sort();
    return dates
      .map((date) => ({ date, value: foodTotalsForDate(date)[key] }))
      .filter((p) => p.value != null);
  }

  // Trend footer such as "+180 cal vs last week": the average of the latest 7
  // logged days against the 7 before. Empty until a full earlier week exists. Left
  // uncolored on purpose: whether more is good depends on the user's goal.
  function foodTrendDeltaText(key, chartEntries) {
    const last7 = chartEntries.slice(-7);
    const prev7 = chartEntries.slice(-14, -7);
    if (!prev7.length) return '';
    const avg = (arr) => arr.reduce((s, p) => s + p.value, 0) / arr.length;
    const diff = Math.round(avg(last7) - avg(prev7));
    if (diff === 0) return 'No change vs last week';
    return `${diff > 0 ? '+' : ''}${fmtMacroValue(key, diff)} vs last week`;
  }

  function openFoodDetail(chartMetric) {
    const totals = foodTotalsForDate(todayISO());
    const calc = state.settings.nutritionCalc;
    const suggestion = calc.enabled ? computeNutritionTargets(calc.activityLevel, calc.goal) : null;
    const trackedKeys = trackedMacroKeys();
    // With guidance on, the %DV is appended to each row instead of a second table.
    const guidanceOn = state.settings.showMacroGuidance;
    let anyDvShown = false;
    const rows = trackedKeys.map((k) => {
      const goalInfo = macroGoalInfo(k);
      const hasGoal = goalInfo.enabled && goalInfo.goal != null;
      const value = totals[k];
      const mainText = hasGoal ? `${fmtMacroValue(k, value)} / ${fmtMacroValue(k, goalInfo.goal)}` : fmtMacroValue(k, value);
      const subParts = [];
      if (hasGoal) {
        const pct = value != null ? Math.round((value / goalInfo.goal) * 100) : null;
        if (pct != null) subParts.push(`${pct}% of goal`);
      }
      const hasDv = guidanceOn && MACRO_DV[k] != null;
      const over = hasDv && macroDvOver(k, value);
      if (hasDv) {
        anyDvShown = true;
        const dvPct = macroDvPct(k, value);
        subParts.push(`${dvPct != null ? dvPct : '—'}% DV`);
      }
      return `<div class="standards-preview-row${over ? ' over' : ''}"><span>${MACRO_LABELS[k]}</span><span class="macro-val"><span>${mainText}</span>${subParts.length ? `<span class="pct">${subParts.join(' &middot; ')}</span>` : ''}</span></div>`;
    }).join('');
    // Caveats for the %DV figures; shown only when a DV appears.
    const guidanceNoteHtml = anyDvShown
      ? `<p class="muted-text field-hint food-dv-note">DV = % of a general adult daily value for a 2,000-calorie diet, not personalized. Sugar shows no %DV: the FDA's 50g limit is for <i>added</i> sugar, and Fit Log logs total sugar. Caffeine has no official DV; 400mg is the FDA's general guidance, shown the same way.</p>`
      : '';

    let calcHtml;
    if (!calc.enabled) {
      calcHtml = `
        <div class="section-head"><h2>Recommendation</h2></div>
        <p class="muted-text">Turn on the nutrition calculator (Adjust goals below) for a calorie/protein recommendation based on your profile.</p>`;
    } else if (suggestion.missing) {
      const list = suggestion.missing.length > 1
        ? `${suggestion.missing.slice(0, -1).join(', ')} and ${suggestion.missing[suggestion.missing.length - 1]}`
        : suggestion.missing[0];
      calcHtml = `
        <div class="section-head"><h2>Recommendation</h2></div>
        <p class="muted-text">Set your ${list} to get a calorie/protein recommendation.</p>`;
    } else {
      calcHtml = `
        <div class="section-head"><h2>Recommendation</h2></div>
        <div class="card">
          <div class="insight-line">${suggestion.calories} cal &middot; ${suggestion.protein}g protein</div>
          <p class="muted-text field-hint">For ${NUTRITION_GOAL_LABELS[calc.goal]}, ${ACTIVITY_LEVELS[calc.activityLevel].label.toLowerCase()}.</p>
        </div>`;
    }

    // Trend chart with a metric switcher, since food has several trackable numbers.
    const activeMetric = trackedKeys.includes(chartMetric) ? chartMetric : trackedKeys[0];
    const chartEntries = foodChartEntriesFor(activeMetric);
    const chartGoalInfo = macroGoalInfo(activeMetric);
    const chartGoal = chartGoalInfo.enabled ? chartGoalInfo.goal : null;
    const metricSegHtml = trackedKeys.length > 1 ? `
      <div class="segmented${trackedKeys.length > 4 ? ' segmented-grid' : ''}" id="foodChartMetricSegmented" role="radiogroup" aria-label="Chart metric">
        ${trackedKeys.map((k) => `<button type="button" data-metric="${k}" role="radio">${MACRO_LABELS[k]}</button>`).join('')}
      </div>` : '';
    const lastPoint = chartEntries[chartEntries.length - 1];
    const deltaText = lastPoint ? foodTrendDeltaText(activeMetric, chartEntries) : '';
    const trendFootHtml = lastPoint ? `
      <div class="ex-card-foot">
        <div class="ex-card-current">${fmtMacroValue(activeMetric, lastPoint.value)}</div>
        ${deltaText ? `<div class="ex-card-delta">${deltaText}</div>` : ''}
      </div>` : '';

    openModal(`
      <div class="modal-title-row"><h2>Food today</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <button type="button" class="btn btn-primary btn-block" id="logFoodFromDetailBtn">Log food</button>
      <div class="section-head"><h2>Today's totals</h2></div>
      <div class="standards-preview food-totals">${rows}</div>
      ${guidanceNoteHtml}
      <div class="section-head"><h2>Trend</h2></div>
      ${metricSegHtml}
      <div class="chart-wrap">${Charts.lineChart(chartEntries, { goal: chartGoal, formatValue: (v) => fmtMacroValue(activeMetric, v) })}</div>
      ${trendFootHtml}
      ${calcHtml}
      <div class="btn-row">
        <button class="btn btn-secondary" id="adjustFoodGoalsBtn">Adjust goals</button>
      </div>
    `, { tall: true });
    document.getElementById('logFoodFromDetailBtn').addEventListener('click', logFoodFromDetail);
    document.getElementById('adjustFoodGoalsBtn').addEventListener('click', openFoodGoalsFromDetail);
    const metricSeg = document.getElementById('foodChartMetricSegmented');
    if (metricSeg) {
      metricSeg.querySelectorAll('button').forEach((btn) => {
        btn.setAttribute('aria-checked', String(btn.dataset.metric === activeMetric));
        btn.addEventListener('click', () => openFoodDetail(btn.dataset.metric));
      });
    }
  }

  // Jumps to the Log tab's Food form, same "quick access" pattern as
  // logExerciseFromDetail()/logTrackerFromDetail() above.
  function logFoodFromDetail() {
    closeModal();
    logCategory = 'food';
    switchTab('log');
  }

  // Open Manage -> Food (macro tracking and goals, nutrition calculator).
  function openFoodGoalsFromDetail() {
    closeModal();
    manageCategory = 'food';
    switchTab('manage');
  }

  /* ============================== Rendering: Log tab ============================== */

  function groupBySection(list) {
    const groups = { goal: [], daily: [], accessory: [] };
    list.forEach((ex) => { groups[sectionOf(ex)].push(ex); });
    return groups;
  }

  /* ============================== Organization: groups, favorites, search ==============================
     Exercises and saved foods share a favorite star, "recent" (derived from logged
     entries, never stored) and search/filter chips; exercises also have a muscle
     group (`ex.group`). No migration: a missing `group` is inferred from the name. */

  const UI_ICON_PATHS = {
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
  };
  const uiIcon = (name) => lucide(UI_ICON_PATHS[name]);

  const EXERCISE_GROUPS = [
    ['chest', 'Chest'], ['back', 'Back'], ['legs', 'Legs'], ['shoulders', 'Shoulders'],
    ['arms', 'Arms'], ['core', 'Core'], ['cardio', 'Cardio'], ['full', 'Full body'], ['other', 'Other'],
  ];
  const EXERCISE_GROUP_LABELS = Object.fromEntries(EXERCISE_GROUPS);

  // Guess a muscle group from the exercise's kind and name, for exercises saved
  // before groups existed and to preselect the chip on a new one.
  function inferExerciseGroup(ex) {
    if (!ex) return 'other';
    if (ex.kind === 'cardio') return 'cardio';
    if (ex.kind === 'habit') return 'other';
    const n = (ex.name || '').toLowerCase();
    const has = (re) => re.test(n);
    if (has(/plank|crunch|sit[- ]?up|\babs?\b|\bcore\b|leg raise|russian twist|wood ?chop/)) return 'core';
    if (has(/overhead|\bohp\b|shoulder|lateral raise|front raise|shrug|face pull|delt|arnold|military/)) return 'shoulders';
    if (has(/squat|lunge|\bleg\b|calf|calves|glute|hip thrust|\brdl\b|romanian|hamstring|quad|step[- ]?up/)) return 'legs';
    if (has(/curl|tricep|bicep|skull|pushdown|kickback|\barm\b/)) return 'arms';
    if (has(/deadlift|\brow\b|rows\b|pull[- ]?up|chin[- ]?up|pulldown|\blat\b|back ext|\bback\b|rack pull/)) return 'back';
    if (has(/bench|chest|push[- ]?up|\bfly\b|flye|\bdips?\b|\bpec\b|incline|decline|\bpress\b/)) return 'chest';
    if (has(/burpee|clean|snatch|thruster|kettlebell|swing|full body/)) return 'full';
    return 'other';
  }
  function exerciseGroup(ex) { return EXERCISE_GROUP_LABELS[ex.group] ? ex.group : inferExerciseGroup(ex); }
  function exerciseGroupLabel(ex) { return EXERCISE_GROUP_LABELS[exerciseGroup(ex)]; }
  // Until someone stars or unstars an exercise, the lifts they set a goal for count
  // as favorites, so Favorites is useful from day one.
  function isFavoriteExercise(ex) {
    if (ex.favorite === undefined) return sectionOf(ex) === 'goal' && ex.kind !== 'habit';
    return !!ex.favorite;
  }

  function agoText(iso) {
    const d = Math.round((new Date(`${todayISO()}T00:00:00`) - new Date(`${iso}T00:00:00`)) / 86400000);
    if (!(d > 0)) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return `${d} days ago`;
    if (d < 60) return `${Math.round(d / 7)} weeks ago`;
    return `${Math.round(d / 30)} months ago`;
  }

  // exerciseId -> { k: sortable "date+id", entry } for its most recent entry.
  function lastEntryMap() {
    const m = {};
    state.entries.forEach((e) => {
      const k = e.date + e.id;
      if (!m[e.exerciseId] || k > m[e.exerciseId].k) m[e.exerciseId] = { k, entry: e };
    });
    return m;
  }

  function lastResultText(ex, entry) {
    if (ex.kind === 'habit') return 'done';
    const top = topSetOf(ex, entry);
    if (ex.kind === 'weight' && top) return `${round(Units.lbToDisplay(top.weight), 1)} ${Units.weightUnitLabel()} × ${top.reps}`;
    if (ex.kind === 'reps' && top) return isTimed(ex) ? fmtHold(top.reps) : `${top.reps} reps`;
    if (ex.kind === 'cardio') {
      const bits = [];
      if (entry.distance != null) bits.push(fmtDistance(entry.distance));
      if (entry.duration != null) bits.push(fmtDuration(entry.duration));
      if (bits.length) return bits.join(' · ');
    }
    return entrySummaryText(ex, entry);
  }

  function exercisePickSub(ex, lastMap) {
    const last = lastMap[ex.id];
    const group = exerciseGroupLabel(ex);
    if (!last) return `${group} · No entries yet`;
    if (ex.kind === 'habit') return `${group} · last done ${agoText(last.entry.date)}`;
    return `${group} · last ${lastResultText(ex, last.entry)} · ${agoText(last.entry.date)}`;
  }

  // ---- shared bits ----
  function starButtonHtml(attr, id, on) {
    return `<button type="button" class="org-star" ${attr}="${id}" aria-pressed="${!!on}" aria-label="${on ? 'Remove from favorites' : 'Add to favorites'}">${uiIcon('star')}</button>`;
  }
  function chipHtml(value, label, count, on) {
    return `<button type="button" class="f-chip" role="radio" aria-checked="${!!on}" data-chip="${value}">${label}${count != null ? `<span class="n">${count}</span>` : ''}</button>`;
  }
  function segHtml(items, active) {
    return items.map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === active}" data-seg="${v}">${label}</button>`).join('');
  }
  // Re-render a chip row without losing where the user had scrolled it to.
  function setChips(chipsEl, html) {
    const left = chipsEl.scrollLeft;
    chipsEl.innerHTML = html;
    chipsEl.scrollLeft = left;
    refreshFScroll(chipsEl);
  }
  function refreshFScroll(chipsEl) {
    const wrap = chipsEl.closest('.f-scroll');
    if (!wrap) return;
    const update = () => wrap.classList.toggle('at-end', chipsEl.scrollLeft + chipsEl.clientWidth >= chipsEl.scrollWidth - 4);
    update();
    requestAnimationFrame(update);
  }
  // One shared resize listener refreshes every chip row; rows removed from the page (a closed
  // sheet, a re-rendered panel) are dropped instead of accumulating listeners.
  const fScrollEls = new Set();
  window.addEventListener('resize', () => {
    fScrollEls.forEach((el) => { if (el.isConnected) refreshFScroll(el); else fScrollEls.delete(el); });
  });
  function wireFScroll(chipsEl) {
    const wrap = chipsEl.closest('.f-scroll');
    if (!wrap) return;
    chipsEl.addEventListener('scroll', () => refreshFScroll(chipsEl), { passive: true });
    fScrollEls.add(chipsEl);
    const more = wrap.querySelector('.f-more');
    if (more) more.addEventListener('click', () => chipsEl.scrollBy({ left: Math.max(120, chipsEl.clientWidth * 0.7), behavior: 'smooth' }));
  }
  /* Keyboard activation for role="button" rows. Only fires when the row itself has focus, so
     nested real buttons (favourite star, etc.) keep their native Enter/Space behaviour. */
  function onEnterOrSpace(handler) {
    return (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.hasAttribute('data-pick')) { ev.preventDefault(); handler(ev); } };
  }

  /* ============================== Catalog & equipment variants ==============================
     js/catalog.js is reference data (movements, habits, foods). Nothing reaches the user's data
     until they tick it in "Add from catalog"; copies are ordinary items. Each equipment variant
     of a movement is its own exercise (same `catalogId`, different `equipment`). */

  const CATALOG = window.FitCatalog || { equipment: [], groupIcons: {}, packs: [], movements: [], habits: [], foods: [] };
  const EQUIPMENT = Object.fromEntries(CATALOG.equipment.map((e) => [e.id, e]));
  const MOVEMENTS = Object.fromEntries(CATALOG.movements.map((m) => [m.id, m]));
  const CATALOG_HABITS = Object.fromEntries(CATALOG.habits.map((h) => [h.id, h]));

  function equipmentLabel(id) { return EQUIPMENT[id] ? EQUIPMENT[id].label : ''; }
  // The name to show for an exercise: with its equipment for a catalog variant,
  // otherwise just its own name.
  function exerciseLabel(ex) {
    if (!ex) return '';
    const mv = ex.catalogId && MOVEMENTS[ex.catalogId];
    const eq = ex.equipment && mv && mv.equipment.length > 1 && ex.equipment !== 'bodyweight' && equipmentLabel(ex.equipment);
    return eq ? `${ex.name} · ${eq}` : ex.name;
  }
  function exerciseLabelHtml(ex) { return escapeHtml(exerciseLabel(ex)); }
  const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function variantRecord(movId, eq) {
    return state.exercises.find((e) => e.catalogId === movId && (e.equipment || null) === (eq || null));
  }
  // An older exercise of the user's that is already this movement on this
  // equipment (matched by name), so adding from the catalog links to it
  // instead of duplicating it.
  function legacyVariantMatch(mv, eq) {
    if ((eq || null) !== (mv.defaultEquipment || null)) return null;
    return state.exercises.find((e) => !e.catalogId && normName(e.name) === normName(mv.name) && e.kind === mv.kind) || null;
  }

  // Adds one movement on each ticked piece of equipment. Returns how many
  // exercises were created or brought back from the archive.
  function addCatalogMovement(mv, eqIds) {
    let n = 0;
    const list = eqIds && eqIds.length ? eqIds : [null];
    list.forEach((eq) => {
      const existing = variantRecord(mv.id, eq) || legacyVariantMatch(mv, eq);
      if (existing) {
        if (!existing.catalogId) { existing.catalogId = mv.id; if (eq) existing.equipment = eq; n += 1; }
        else if (existing.archived) { existing.archived = false; n += 1; }
        return;
      }
      const ex = {
        id: genId('ex'), name: mv.name, kind: mv.kind, section: 'accessory', group: mv.group,
        goal: null, goalMode: 'fixed', goalTier: null, archived: false, createdAt: new Date().toISOString(),
        catalogId: mv.id, icon: ITEM_ICONS[mv.icon] ? mv.icon : undefined,
      };
      if (eq) ex.equipment = eq;
      if (mv.kind === 'weight') { ex.bodyRegion = guessBodyRegion(mv.name); ex.liftType = (eq || null) === (mv.defaultEquipment || null) && !state.exercises.some((x) => x.liftType && x.liftType === mv.liftType) ? (mv.liftType || null) : null; }
      if (mv.kind === 'cardio') { ex.distanceGoal = null; ex.paceGoal = null; }
      if (mv.unit) ex.unit = mv.unit;
      if (!ex.icon) delete ex.icon;
      state.exercises.push(ex);
      n += 1;
    });
    return n;
  }
  function addCatalogHabit(h) {
    if (state.exercises.some((e) => e.catalogId === h.id && !e.archived)) return 0;
    const back = state.exercises.find((e) => e.catalogId === h.id);
    if (back) { back.archived = false; return 1; }
    state.exercises.push({
      id: genId('ex'), name: h.name, kind: 'habit', section: 'daily', group: 'other', goal: h.goal || 1, repeat: h.repeat || 'daily',
      goalMode: 'fixed', goalTier: null, archived: false, createdAt: new Date().toISOString(), catalogId: h.id,
      ...(ITEM_ICONS[h.icon] && { icon: h.icon }),
    });
    return 1;
  }
  function addCatalogFood(f) {
    if (state.food.savedFoods.some((x) => x.catalogId === f.id)) return 0;
    const food = {
      id: genId('savedfood'), name: f.name, serving: f.serving, category: f.category, favorite: false, catalogId: f.id,
      ...(ITEM_ICONS[f.icon] && { icon: f.icon }),
    };
    MACRO_KEYS.forEach((k) => { food[k] = f[k] != null ? f[k] : null; });
    state.food.savedFoods.push(food);
    return 1;
  }

  /* ---------- Tidy up: group older exercises under catalog movements ----------
     Offers to link exercises that predate the catalog (e.g. "Cable Bicep Curl") to a movement
     plus equipment. Entries and goals stay on the same record unless a variant already exists,
     in which case the two merge. Nothing changes until ticked rows are applied; Manage can undo. */

  const EQUIPMENT_WORDS = [
    ['dumbbell', /\b(dumbbells?|dumbells?|db)\b/], ['barbell', /\b(barbell|bb)\b/], ['cable', /\bcable\b/],
    ['machine', /\b(machine|hammer strength)\b/], ['smith', /\bsmith\b/], ['kettlebell', /\b(kettlebell|kb)\b/],
    ['trapbar', /\b(trap bar|hex bar)\b/],
  ];
  // [pattern on the name once equipment words are removed, movement, note when something is lost]
  const MOVEMENT_ALIASES = [
    [/^incline (bench )?press$/, 'incline_press'], [/^bench press$/, 'bench_press'], [/^(flat )?chest press$/, 'bench_press'],
    [/^decline (bench |chest )?press$/, 'bench_press', 'Loses the decline angle'],
    [/^biceps? curls?$/, 'curl'], [/^curls?$/, 'curl'], [/^hammer curls?$/, 'hammer_curl'],
    [/^(overhead )?tricep(s)? (overhead )?extensions?$/, 'overhead_tri'], [/^lateral raises?$/, 'lateral_raise'],
    [/^(side|lat) raises?$/, 'lateral_raise'], [/^crunch(es)?$/, 'crunch'], [/^push[- ]?ups?$/, 'pushups'],
    [/^pull[- ]?ups?$/, 'pullups'], [/^rows?$/, 'row'], [/^squats?$/, 'squat'], [/^deadlifts?$/, 'deadlift'],
    [/^running$/, 'running'],
  ];

  function tidyCandidates() {
    const out = [];
    state.exercises.forEach((ex) => {
      if (ex.catalogId || ex.archived || ex.kind === 'habit') return;
      let n = normName(ex.name); let eq = null;
      EQUIPMENT_WORDS.forEach(([id, re]) => { if (re.test(n)) { eq = eq || id; n = n.replace(re, ' ').replace(/\s+/g, ' ').trim(); } });
      let hit = MOVEMENT_ALIASES.find(([re]) => re.test(n));
      let mv = hit ? MOVEMENTS[`cat_mv_${hit[1]}`] : null;
      if (!mv) mv = CATALOG.movements.find((m) => normName(m.name) === n) || null;
      if (!mv || mv.kind !== ex.kind) return;
      if (eq && mv.equipment.length && !mv.equipment.includes(eq)) return;
      const equipment = eq || (mv.equipment.length ? mv.defaultEquipment : null);
      if (mv.equipment.length > 1 && !eq && !(normName(ex.name) === normName(mv.name))) return;
      const target = variantRecord(mv.id, equipment);
      out.push({
        ex, mv, equipment, note: (hit && hit[2]) || '', merge: target && target.id !== ex.id ? target : null,
        entries: state.entries.filter((e) => e.exerciseId === ex.id).length,
      });
    });
    return out;
  }

  function tidyAfterLabel(c) {
    return c.equipment && c.mv.equipment.length > 1 ? `${c.mv.name} · ${equipmentLabel(c.equipment)}` : c.mv.name;
  }

  function applyTidy(items) {
    const undo = { at: new Date().toISOString(), renamed: [], merged: [] };
    items.forEach((c) => {
      const ex = c.ex;
      // Looked up again here: an earlier row in this same batch may just have become the
      // variant this one maps to (two old exercises for one movement), and two records must
      // never end up with the same movement and equipment.
      const target = c.merge || variantRecord(c.mv.id, c.equipment);
      if (target && target.id !== ex.id) {
        const rec = { ex: JSON.parse(JSON.stringify(ex)), targetId: target.id, targetGoal: { goal: target.goal, goalMode: target.goalMode, goalTier: target.goalTier }, targetArchived: !!target.archived, moved: [] };
        // Merging into a hidden (archived) variant would make the user's entries vanish.
        target.archived = false;
        state.entries.forEach((e) => { if (e.exerciseId === ex.id) { rec.moved.push(e.id); e.exerciseId = target.id; } });
        if (target.goal == null && ex.goal != null) { target.goal = ex.goal; target.goalMode = ex.goalMode; target.goalTier = ex.goalTier; }
        state.exercises = state.exercises.filter((x) => x.id !== ex.id);
        undo.merged.push(rec);
      } else {
        undo.renamed.push({ id: ex.id, name: ex.name });
        ex.name = c.mv.name; ex.catalogId = c.mv.id;
        if (c.equipment) ex.equipment = c.equipment;
      }
    });
    state.settings.tidyUndo = undo;
    state.settings.tidyDismissed = true; // reviewed: the card goes away; Undo lives on the toast
    return save();
  }

  function undoTidy() {
    const u = state.settings.tidyUndo; if (!u) return;
    u.renamed.forEach((r) => {
      const ex = state.exercises.find((x) => x.id === r.id); if (!ex) return;
      ex.name = r.name; delete ex.catalogId; delete ex.equipment;
    });
    u.merged.forEach((m) => {
      state.exercises.push(m.ex);
      const moved = new Set(m.moved);
      state.entries.forEach((e) => { if (moved.has(e.id)) e.exerciseId = m.ex.id; });
      const target = state.exercises.find((x) => x.id === m.targetId);
      if (target) { Object.assign(target, m.targetGoal); target.archived = !!m.targetArchived; }
    });
    state.settings.tidyUndo = null;
    state.settings.tidyDismissed = false;
    save(); renderAll(); toast('Tidy up undone');
  }

  function renderTidyCard() {
    const host = document.getElementById('tidyCard'); if (!host) return;
    const items = state.settings.tidyDismissed ? [] : tidyCandidates();
    if (!items.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `
      <div class="tidy-text"><b>Tidy up your exercises</b><span class="muted-text">${items.length} can be grouped by equipment, like Bicep Curl · Cable. Nothing changes until you pick.</span></div>
      <div class="tidy-actions"><button type="button" class="btn btn-primary btn-sm" id="tidyReviewBtn">Review</button><button type="button" class="link-btn" id="tidyDismissBtn">Not now</button></div>`;
    const r = document.getElementById('tidyReviewBtn'); if (r) r.addEventListener('click', openTidySheet);
    const d = document.getElementById('tidyDismissBtn'); if (d) d.addEventListener('click', () => { state.settings.tidyDismissed = true; save(); renderTidyCard(); });
  }

  function openTidySheet() {
    const items = tidyCandidates();
    const on = new Set(items.map((c, i) => (c.note ? -1 : i)).filter((i) => i >= 0));
    openModal(`
      <div class="split-shell">
        <div class="modal-title-row"><h2>Tidy up</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
        <p class="muted-text">Tick the ones you want grouped. Your entries and goals stay with each exercise${items.some((c) => c.merge) ? '; where a variant already exists the two are merged' : ''}.</p>
        <div class="split-scroll"><div id="tidyList" class="cat-list"></div></div>
        <div class="split-foot"><button type="button" class="btn btn-primary btn-block" id="tidyApplyBtn"></button></div>
      </div>`, { tall: true, split: true });
    const paint = () => {
      document.getElementById('tidyList').innerHTML = items.map((c, i) => `
        <div class="entry-row cat-row" data-tidy="${i}" role="checkbox" aria-checked="${on.has(i)}" tabindex="0">
          ${catCheck(on.has(i), false)}
          <div class="entry-row-main"><div class="entry-row-title">${escapeHtml(c.ex.name)} <span class="muted-text">→</span> ${escapeHtml(tidyAfterLabel(c))}</div>
            <div class="entry-row-sub">${c.entries} logged entr${c.entries === 1 ? 'y' : 'ies'}${c.merge ? ' · merges into your existing one' : ''}${c.note ? ` · ${escapeHtml(c.note)}` : ''}</div></div>
        </div>`).join('');
      const btn = document.getElementById('tidyApplyBtn');
      btn.disabled = on.size === 0; btn.textContent = on.size ? `Tidy up ${on.size}` : 'Pick something to tidy';
    };
    paint();
    document.getElementById('tidyList').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-tidy]'); if (!row) return;
      const i = Number(row.dataset.tidy); if (on.has(i)) on.delete(i); else on.add(i); paint();
    });
    document.getElementById('tidyApplyBtn').addEventListener('click', () => {
      const chosen = items.filter((c, i) => on.has(i));
      if (!applyTidy(chosen)) return;
      closeModal(); renderAll(); toast(`Tidied up ${chosen.length}`, { label: 'Undo', run: undoTidy });
    });
  }

  /* ---------- the Add-from-catalog sheet ---------- */

  // Transient UI state (never saved). `pick` holds what is ticked per tab.
  const cat = { scope: ['exercises'], tab: 'exercises', query: '', group: 'all', pack: 'all', cat: 'all', open: null, pick: { exercises: new Set(), habits: new Set(), foods: new Set() } };

  // The sheet only offers what belongs to the screen that opened it: Manage >
  // Workout gets exercises (and habits when those are on), Manage > Food gets foods.
  function openCatalogSheet(tab) {
    cat.scope = tab === 'foods' ? ['foods'] : ['exercises'].concat(habitsTracked() ? ['habits'] : []);
    cat.tab = cat.scope.includes(tab) ? tab : cat.scope[0]; cat.query = ''; cat.group = 'all'; cat.pack = 'all'; cat.cat = 'all'; cat.open = null;
    cat.pick = { exercises: new Set(), habits: new Set(), foods: new Set() };
    openModal(`
      <div class="split-shell">
        <div class="modal-title-row"><h2>${cat.scope[0] === 'foods' ? 'Add foods' : 'Add from catalog'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
        ${cat.scope.length > 1 ? `<div class="segmented segmented-fill" id="catTabs" role="radiogroup" aria-label="Catalog">
          ${cat.scope.map((t) => `<button type="button" role="radio" data-cat-tab="${t}">${{ exercises: 'Exercises', habits: 'Habits', foods: 'Foods' }[t]}</button>`).join('')}
        </div>` : '<div id="catTabs" hidden></div>'}
        <div class="split-controls" id="catControls"></div>
        <div class="split-scroll" id="catScroll"><div id="catList" class="cat-list"></div></div>
        <div class="split-foot"><button type="button" class="btn btn-primary btn-block" id="catAddBtn" disabled>Add</button></div>
      </div>`, { tall: true, split: true });
    document.getElementById('catTabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cat-tab]'); if (!b) return;
      cat.tab = b.dataset.catTab; cat.query = ''; cat.open = null; renderCatalogSheet();
    });
    const controls = document.getElementById('catControls');
    controls.addEventListener('input', (ev) => {
      if (ev.target.id !== 'catSearch') return;
      cat.query = ev.target.value; renderCatalogList();
    });
    controls.addEventListener('click', onCatalogClick);
    document.getElementById('catScroll').addEventListener('click', onCatalogClick);
    document.getElementById('catAddBtn').addEventListener('click', applyCatalogPicks);
    renderCatalogSheet();
  }

  function catPickCount() { return cat.pick[cat.tab].size; }

  function renderCatalogSheet() {
    document.querySelectorAll('#catTabs button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.catTab === cat.tab)));
    const body = document.getElementById('catControls');
    let chips = '';
    if (cat.tab === 'exercises') {
      chips = `<div class="f-scroll"><div class="f-chips" id="catGroupChips" role="radiogroup" aria-label="Muscle group">
        ${chipHtml('all', 'All', null, cat.group === 'all')}
        ${EXERCISE_GROUPS.filter(([g]) => CATALOG.movements.some((m) => m.group === g)).map(([g, l]) => chipHtml(g, l, null, cat.group === g)).join('')}
      </div></div>
      <div class="f-scroll"><div class="f-chips" id="catPackChips" role="radiogroup" aria-label="Starter pack">
        <span class="chip-lead">Packs</span>${chipHtml('all', 'None', null, cat.pack === 'all')}
        ${CATALOG.packs.filter((p) => p.id !== 'running' || cardioTracked()).map((p) => chipHtml(p.id, escapeHtml(p.name), null, cat.pack === p.id)).join('')}
      </div></div>
      ${cat.pack !== 'all' ? `<div class="cat-pack-note"><span class="muted-text">${escapeHtml((CATALOG.packs.find((p) => p.id === cat.pack) || {}).description || '')} Nothing is ticked for you.</span>
        <button type="button" class="btn btn-secondary btn-sm" data-cat-selpack="1">Tick the whole pack</button></div>` : ''}`;
    } else if (cat.tab === 'foods') {
      chips = `<div class="f-scroll"><div class="f-chips" id="catFoodChips" role="radiogroup">
        ${chipHtml('all', 'All', null, cat.cat === 'all')}
        ${SAVED_FOOD_CATEGORIES.filter((c) => CATALOG.foods.some((f) => f.category === c.value)).map((c) => chipHtml(c.value, SAVED_FOOD_CHIP_LABELS[c.value], null, cat.cat === c.value)).join('')}
      </div></div>`;
    }
    body.innerHTML = `
      <label class="search"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="search" id="catSearch" placeholder="Search ${cat.tab}" aria-label="Search ${cat.tab}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${escapeHtml(cat.query)}" /></label>
      ${chips}`;
    ['catGroupChips', 'catFoodChips', 'catPackChips'].forEach((id) => { const el = document.getElementById(id); if (el) wireFScroll(el); });
    renderCatalogList();
  }

  const catCheck = (on, disabled) => `<span class="cat-check${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}" aria-hidden="true">${on ? CHECK_ICON_SVG : ''}</span>`;

  function renderCatalogList() {
    const list = document.getElementById('catList');
    const q = cat.query.trim().toLowerCase();
    let html = '';
    if (cat.tab === 'exercises') {
      let items = CATALOG.movements.filter((m) => (cat.group === 'all' || m.group === cat.group) && (cat.pack === 'all' || m.packs.includes(cat.pack)));
      if (q) items = items.filter((m) => m.name.toLowerCase().includes(q) || (EXERCISE_GROUP_LABELS[m.group] || '').toLowerCase().includes(q));
      html = items.map((m) => {
        const eqs = m.equipment.length ? m.equipment : [null];
        const added = eqs.filter((eq) => variantRecord(m.id, eq) || legacyVariantMatch(m, eq)).length;
        const picked = eqs.filter((eq) => cat.pick.exercises.has(`${m.id}|${eq || ''}`)).length;
        const open = cat.open === m.id && m.equipment.length > 0;
        const sub = m.equipment.length ? (m.equipment.length === 1 ? equipmentLabel(m.equipment[0]) : `${equipmentLabel(m.equipment[0])} +${m.equipment.length - 1} more`) : 'No equipment';
        return `
          <div class="entry-row cat-row" data-cat-mv="${m.id}" role="button" tabindex="0" aria-expanded="${open}">
            ${catCheck(picked > 0, false)}
            ${itemIconHtml(ITEM_ICONS[m.icon] ? m.icon : 'dumbbell', true)}
            <div class="entry-row-main"><div class="entry-row-title">${escapeHtml(m.name)}</div>
              <div class="entry-row-sub">${EXERCISE_GROUP_LABELS[m.group]} · ${escapeHtml(sub)}</div></div>
            ${added ? `<span class="chip">${added === eqs.length && eqs.length === 1 ? 'Added' : `${added} added`}</span>` : ''}
            ${m.equipment.length ? (open ? uiIcon('chevron-up') : uiIcon('chevron-down')) : ''}
          </div>
          ${open ? `<div class="cat-variants" role="group" aria-label="Equipment for ${escapeHtml(m.name)}">
            ${m.equipment.map((eq) => {
              const have = !!(variantRecord(m.id, eq) || legacyVariantMatch(m, eq));
              const on = cat.pick.exercises.has(`${m.id}|${eq}`);
              return `<button type="button" class="chip-option${on || have ? ' is-active' : ''}${have ? ' is-added' : ''}" data-cat-eq="${m.id}|${eq}" role="checkbox" aria-checked="${on || have}" ${have ? 'disabled' : ''}>${escapeHtml(equipmentLabel(eq))}${have ? ' · added' : ''}</button>`;
            }).join('')}
            <p class="muted-text field-hint">${escapeHtml(EQUIPMENT[m.defaultEquipment] ? `Most people use ${equipmentLabel(m.defaultEquipment).toLowerCase()}. ` : '')}Each equipment keeps its own records and goals.</p>
          </div>` : ''}`;
      }).join('');
    } else if (cat.tab === 'habits') {
      let items = CATALOG.habits;
      if (q) items = items.filter((h) => h.name.toLowerCase().includes(q));
      html = items.map((h) => {
        const have = state.exercises.some((e) => e.catalogId === h.id && !e.archived);
        const on = cat.pick.habits.has(h.id);
        return `
          <div class="entry-row cat-row${have ? ' is-toggled-off' : ''}" data-cat-habit="${h.id}" role="button" tabindex="0">
            ${catCheck(on || have, have)}
            ${itemIconHtml(ITEM_ICONS[h.icon] ? h.icon : 'standing', true)}
            <div class="entry-row-main"><div class="entry-row-title">${escapeHtml(h.name)}</div>
              <div class="entry-row-sub">${escapeHtml((HABIT_REPEATS.find((r) => r[0] === h.repeat) || HABIT_REPEATS[0])[1])} · ${escapeHtml(h.note || '')}</div></div>
            ${have ? '<span class="chip">Added</span>' : ''}
          </div>`;
      }).join('');
    } else {
      let items = CATALOG.foods.filter((f) => cat.cat === 'all' || f.category === cat.cat);
      if (q) items = items.filter((f) => f.name.toLowerCase().includes(q));
      items = items.slice().sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier === 'starter' ? -1 : 1));
      let lastTier = null;
      html = items.map((f) => {
        const have = state.food.savedFoods.some((x) => x.catalogId === f.id);
        const on = cat.pick.foods.has(f.id);
        const head = f.tier !== lastTier && !q ? `<div class="cat-tier">${f.tier === 'starter' ? 'Everyday foods' : 'More foods'}</div>` : '';
        lastTier = f.tier;
        return `${head}
          <div class="entry-row cat-row${have ? ' is-toggled-off' : ''}" data-cat-food="${f.id}" role="button" tabindex="0">
            ${catCheck(on || have, have)}
            ${itemIconHtml(ITEM_ICONS[f.icon] ? f.icon : 'utensils', true)}
            <div class="entry-row-main"><div class="entry-row-title">${escapeHtml(f.name)}</div>
              <div class="entry-row-sub">${escapeHtml(f.serving)} · ${f.calories} cal · ${f.protein != null ? `${f.protein} g protein` : ''}</div></div>
            ${have ? '<span class="chip">Added</span>' : ''}
          </div>`;
      }).join('');
    }
    list.innerHTML = html || '<p class="muted-text org-empty">Nothing matches.</p>';
    const n = catPickCount();
    const btn = document.getElementById('catAddBtn');
    btn.disabled = n === 0;
    btn.textContent = n ? `Add ${n} ${cat.tab === 'foods' ? (n === 1 ? 'food' : 'foods') : cat.tab === 'habits' ? (n === 1 ? 'habit' : 'habits') : (n === 1 ? 'exercise' : 'exercises')}` : 'Choose something to add';
  }

  function toggleSet(set, key) { if (set.has(key)) set.delete(key); else set.add(key); }

  function onCatalogClick(ev) {
    const chip = ev.target.closest('[data-chip]');
    if (chip) {
      const wrapId = chip.parentElement.id;
      if (wrapId === 'catGroupChips') cat.group = chip.dataset.chip;
      else if (wrapId === 'catPackChips') cat.pack = chip.dataset.chip;
      else if (wrapId === 'catFoodChips') cat.cat = chip.dataset.chip;
      cat.open = null; renderCatalogSheet(); return;
    }
    if (ev.target.closest('[data-cat-selpack]')) {
      CATALOG.movements.filter((m) => m.packs.includes(cat.pack)).forEach((m) => {
        const eq = m.defaultEquipment || '';
        if (!(variantRecord(m.id, eq || null) || legacyVariantMatch(m, eq || null))) cat.pick.exercises.add(`${m.id}|${eq}`);
      });
      renderCatalogList(); return;
    }
    const eqBtn = ev.target.closest('[data-cat-eq]');
    if (eqBtn) { toggleSet(cat.pick.exercises, eqBtn.dataset.catEq); renderCatalogList(); return; }
    const mvRow = ev.target.closest('[data-cat-mv]');
    if (mvRow) {
      const m = MOVEMENTS[mvRow.dataset.catMv];
      if (!m.equipment.length) { toggleSet(cat.pick.exercises, `${m.id}|`); }
      else cat.open = cat.open === m.id ? null : m.id;
      renderCatalogList(); return;
    }
    const hRow = ev.target.closest('[data-cat-habit]');
    if (hRow) { if (!state.exercises.some((e) => e.catalogId === hRow.dataset.catHabit && !e.archived)) toggleSet(cat.pick.habits, hRow.dataset.catHabit); renderCatalogList(); return; }
    const fRow = ev.target.closest('[data-cat-food]');
    if (fRow) { if (!state.food.savedFoods.some((x) => x.catalogId === fRow.dataset.catFood)) toggleSet(cat.pick.foods, fRow.dataset.catFood); renderCatalogList(); }
  }

  function applyCatalogPicks() {
    let added = 0; let label = 'exercise';
    if (cat.tab === 'exercises') {
      const byMv = {};
      cat.pick.exercises.forEach((k) => { const [id, eq] = k.split('|'); (byMv[id] = byMv[id] || []).push(eq); });
      const packsTouched = new Set();
      Object.keys(byMv).forEach((id) => {
        const m = MOVEMENTS[id]; if (!m) return;
        added += addCatalogMovement(m, byMv[id].filter(Boolean));
        m.packs.forEach((p) => packsTouched.add(p));
      });
      if (cat.pack !== 'all' && packsTouched.has(cat.pack)) {
        const seen = state.settings.catalogPacksSeen || [];
        if (!seen.includes(cat.pack)) state.settings.catalogPacksSeen = [...seen, cat.pack];
      }
    } else if (cat.tab === 'habits') {
      label = 'habit';
      cat.pick.habits.forEach((id) => { if (CATALOG_HABITS[id]) added += addCatalogHabit(CATALOG_HABITS[id]); });
    } else {
      label = 'food';
      const byId = Object.fromEntries(CATALOG.foods.map((f) => [f.id, f]));
      cat.pick.foods.forEach((id) => { if (byId[id]) added += addCatalogFood(byId[id]); });
    }
    if (!save()) return;
    closeModal();
    toast(added ? `Added ${added} ${label}${added === 1 ? '' : 's'}` : 'Nothing new to add');
    renderAll();
  }

  /* ---------- Log -> Workout ---------- */

  // Transient UI state (never saved).
  const logEx = { seg: null, group: 'all', query: '', showAll: false, pickerOpen: false };
  const LOG_LIST_LIMIT = 5;

  function toggleExerciseFavorite(id) {
    const ex = exerciseById(id);
    if (!ex) return;
    ex.favorite = !isFavoriteExercise(ex);
    if (!save()) return;
    renderLogExercisePicker();
    renderExerciseManageList();
  }

  function renderLogExercisePicker() {
    const lastMap = lastEntryMap();
    const q = logEx.query.trim().toLowerCase();
    const active = activeExercises();
    const favs = active.filter(isFavoriteExercise);
    const recent = active.filter((e) => lastMap[e.id]).sort((a, b) => lastMap[b.id].k.localeCompare(lastMap[a.id].k));
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (!logEx.seg) logEx.seg = favs.length ? 'fav' : recent.length ? 'recent' : 'all';
    const searching = !!q;
    const seg = searching ? 'all' : logEx.seg;

    document.getElementById('logExSeg').innerHTML = segHtml([['fav', 'Favorites'], ['recent', 'Recent'], ['all', `All ${active.length}`]], seg);

    let base = seg === 'fav' ? favs : seg === 'recent' ? recent : active.slice().sort(byName);
    if (searching) base = active.filter((e) => e.name.toLowerCase().includes(q) || exerciseGroupLabel(e).toLowerCase().includes(q)).sort(byName);

    const counts = {};
    base.forEach((e) => { const g = exerciseGroup(e); counts[g] = (counts[g] || 0) + 1; });
    if (logEx.group !== 'all' && !counts[logEx.group]) logEx.group = 'all';
    setChips(document.getElementById('logExChips'),
      chipHtml('all', 'All', null, logEx.group === 'all') +
      EXERCISE_GROUPS.filter(([g]) => counts[g]).map(([g, label]) => chipHtml(g, label, counts[g], logEx.group === g)).join(''));

    const filtered = logEx.group === 'all' ? base : base.filter((e) => exerciseGroup(e) === logEx.group);
    const limited = !searching && logEx.group === 'all' && !logEx.showAll && filtered.length > LOG_LIST_LIMIT;
    const shown = limited ? filtered.slice(0, LOG_LIST_LIMIT) : filtered;

    const list = document.getElementById('logExList');
    if (!shown.length) {
      let msg;
      if (!active.length) msg = 'No exercises yet.';
      else if (searching) msg = `No exercises match “${escapeHtml(logEx.query.trim())}”.`;
      else if (seg === 'fav') msg = 'No favorites yet — tap the ☆ on an exercise to pin it here.';
      else if (seg === 'recent') msg = 'Nothing logged yet — exercises you log show up here.';
      else msg = 'No exercises in this group.';
      list.innerHTML = `<p class="muted-text org-empty">${msg}</p>` +
        (!active.length || searching ? `<button type="button" class="btn btn-secondary btn-sm" data-org-add="exercise">Add exercise</button>` : '');
    } else {
      list.innerHTML = shown.map((ex) => `
        <div class="entry-row" data-pick="${ex.id}" role="button" tabindex="0">
          ${exerciseIconHtml(ex, true)}
          <div class="entry-row-main">
            <div class="entry-row-title">${exerciseLabelHtml(ex)}</div>
            <div class="entry-row-sub">${escapeHtml(exercisePickSub(ex, lastMap))}</div>
          </div>
          ${starButtonHtml('data-fav', ex.id, isFavoriteExercise(ex))}
        </div>`).join('');
    }
    const more = document.getElementById('logExShowAll');
    more.hidden = !limited;
    if (limited) more.innerHTML = `${seg === 'fav' ? 'Show all favorites' : seg === 'recent' ? 'Show all recent' : `Show all ${filtered.length}`} ${uiIcon('chevron-right')}`;
  }

  function renderLogExerciseHead() {
    const head = document.getElementById('logExerciseHead');
    const ex = exerciseById(document.getElementById('logExercise').value);
    if (!ex) { head.innerHTML = ''; return; }
    head.innerHTML = `
      ${exerciseIconHtml(ex)}
      <div class="log-head-main">
        <div class="log-head-label">Logging</div>
        <div class="log-head-name">${exerciseLabelHtml(ex)}</div>
        <div class="entry-row-sub">${escapeHtml(exercisePickSub(ex, lastEntryMap()))}</div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="logChangeBtn">Change</button>
      ${variantChipsHtml(ex)}`;
    head.querySelectorAll('[data-variant]').forEach((btn) => btn.addEventListener('click', () => {
      const mv = MOVEMENTS[ex.catalogId]; const eq = btn.dataset.variant;
      let target = variantRecord(mv.id, eq) || legacyVariantMatch(mv, eq);
      if (!target) {
        addCatalogMovement(mv, [eq]);
        target = variantRecord(mv.id, eq);
        if (!save()) return;
        renderAll();
      }
      if (target && target.id !== ex.id) openLogFor(target.id);
    }));
  }

  // Equipment chips on the Log form: switch to (or start) the same movement
  // on other equipment. Each variant keeps its own records and goals.
  function variantChipsHtml(ex) {
    const mv = ex.catalogId && MOVEMENTS[ex.catalogId];
    if (!mv || mv.equipment.length < 2) return '';
    return `<div class="variant-chips" role="group" aria-label="Equipment">${mv.equipment.map((eq) => {
      const rec = variantRecord(mv.id, eq) || legacyVariantMatch(mv, eq);
      const current = (ex.equipment || null) === eq;
      return `<button type="button" class="variant-chip${current ? ' is-active' : ''}${rec ? '' : ' is-new'}" data-variant="${eq}" aria-pressed="${current}">${rec ? '' : '+ '}${escapeHtml(equipmentLabel(eq))}</button>`;
    }).join('')}</div>`;
  }

  // Decides what shows on Log -> Workout: the picker (nothing chosen, or "Switch
  // exercise" open) or the form, plus the "Switch exercise" row.
  function syncLogWorkoutUI() {
    const on = logCategory === 'workout' && availableDomainCategories().length > 0;
    const select = document.getElementById('logExercise');
    const ex = exerciseById(select.value);
    if (!ex) logEx.pickerOpen = false;
    const pickerShown = on && (!ex || logEx.pickerOpen);
    const formShown = on && !!ex && !logEx.pickerOpen;
    document.getElementById('logExercisePicker').hidden = !pickerShown;
    document.getElementById('logForm').hidden = !formShown;
    document.getElementById('logSwitchCard').hidden = !(on && ex);
    if (pickerShown) renderLogExercisePicker();
    if (formShown) renderLogExerciseHead();
    if (on && ex) {
      document.getElementById('logSwitchBtn').innerHTML = logEx.pickerOpen
        ? `<span>Back to ${exerciseLabelHtml(ex)}<span class="muted-text">Close the list</span></span>${uiIcon('chevron-up')}`
        : `<span>Switch exercise<span class="muted-text">Search or browse your list</span></span>${uiIcon('chevron-down')}`;
    }
  }

  function chooseLogExercise(id) {
    const select = document.getElementById('logExercise');
    select.value = id;
    select.dispatchEvent(new Event('change'));
    const form = document.getElementById('logForm');
    if (!form.hidden && form.scrollIntoView) form.scrollIntoView({ block: 'nearest' });
  }

  function wireLogExercisePicker() {
    const chips = document.getElementById('logExChips');
    wireFScroll(chips);
    document.getElementById('logExSeg').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-seg]');
      if (!b) return;
      logEx.seg = b.dataset.seg; logEx.group = 'all'; logEx.showAll = false; logEx.query = '';
      document.getElementById('logExSearch').value = '';
      renderLogExercisePicker();
    });
    document.getElementById('logExSearch').addEventListener('input', (ev) => {
      logEx.query = ev.target.value; logEx.group = 'all';
      renderLogExercisePicker();
    });
    chips.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      logEx.group = b.dataset.chip;
      renderLogExercisePicker();
    });
    const list = document.getElementById('logExList');
    const pick = (ev) => {
      const star = ev.target.closest('[data-fav]');
      if (star) { ev.stopPropagation(); toggleExerciseFavorite(star.dataset.fav); return; }
      const add = ev.target.closest('[data-org-add]');
      if (add) { openExerciseForm(null); return; }
      const row = ev.target.closest('[data-pick]');
      if (row) chooseLogExercise(row.dataset.pick);
    };
    list.addEventListener('click', pick);
    list.addEventListener('keydown', onEnterOrSpace(pick));
    document.getElementById('logExShowAll').addEventListener('click', () => { logEx.showAll = true; renderLogExercisePicker(); });
    document.getElementById('logSwitchBtn').addEventListener('click', () => { logEx.pickerOpen = !logEx.pickerOpen; syncLogWorkoutUI(); });
    document.getElementById('logExerciseHead').addEventListener('click', (ev) => {
      if (ev.target.closest('#logChangeBtn')) { logEx.pickerOpen = true; syncLogWorkoutUI(); }
    });
  }

  /* ---------- Manage -> Workout ---------- */

  const manageEx = { query: '', filter: 'all', open: {} };
  const MANAGE_EX_FILTERS = [['all', 'All'], ['goal', 'Goals'], ['daily', 'Daily targets'], ['habit', 'Habits'], ['accessory', 'Other']];
  function manageExMatchesFilter(ex, f) {
    if (f === 'all') return true;
    if (f === 'habit') return ex.kind === 'habit';
    if (f === 'daily') return sectionOf(ex) === 'daily' && ex.kind !== 'habit';
    return sectionOf(ex) === f && ex.kind !== 'habit';
  }

  function manageExRowHtml(ex) {
    return `
      <div class="entry-row is-manage${ex.archived ? ' is-toggled-off' : ''}" data-exercise-id="${ex.id}">
        ${exerciseIconHtml(ex, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${exerciseLabelHtml(ex)}</div>
          <div class="entry-row-sub">${kindBadge(ex)}${exerciseGoalSummary(ex)}</div>
        </div>
        <div class="entry-row-actions">
          ${ex.archived ? `<button class="btn btn-secondary btn-sm" data-action="unarchive-exercise" data-id="${ex.id}">Unarchive</button>` : ''}
          <button class="icon-btn" data-action="edit-exercise" data-id="${ex.id}" aria-label="Edit">${EDIT_ICON_SVG}</button>
        </div>
        ${ex.archived ? '' : starButtonHtml('data-fav', ex.id, isFavoriteExercise(ex))}
      </div>`;
  }

  function renderExerciseManageList() {
    if (!renderDomainTrackToggle('workout')) return;
    const wrap = document.getElementById('exerciseManageList');
    const q = manageEx.query.trim().toLowerCase();
    const matchesQ = (ex) => !q || exerciseLabel(ex).toLowerCase().includes(q) || exerciseGroupLabel(ex).toLowerCase().includes(q);
    const queried = state.exercises.filter(matchesQ);

    const fcounts = {};
    MANAGE_EX_FILTERS.forEach(([f]) => { fcounts[f] = queried.filter((ex) => manageExMatchesFilter(ex, f)).length; });
    if (!fcounts[manageEx.filter]) manageEx.filter = 'all';
    setChips(document.getElementById('exManageChips'),
      MANAGE_EX_FILTERS.filter(([f]) => f === 'all' || fcounts[f]).map(([f, label]) => chipHtml(f, label, fcounts[f], manageEx.filter === f)).join(''));

    const visible = queried.filter((ex) => manageExMatchesFilter(ex, manageEx.filter));
    const active = visible.filter((e) => !e.archived);
    const archived = visible.filter((e) => e.archived);
    const pinned = active.filter(isFavoriteExercise);
    const rest = active.filter((e) => !isFavoriteExercise(e));
    const sections = [{ key: 'pinned', label: '★ Pinned', items: pinned }];
    EXERCISE_GROUPS.forEach(([g, label]) => sections.push({ key: g, label, items: rest.filter((e) => exerciseGroup(e) === g) }));
    sections.push({ key: 'archived', label: 'Archived', items: archived });

    // A small list opens fully; a long one starts with just Pinned open so
    // the group headers (with counts) are what you scan.
    const totalActive = state.exercises.filter((e) => !e.archived).length;
    const filtering = !!q || manageEx.filter !== 'all';
    const isOpen = (key) => {
      if (filtering) return true;
      if (key in manageEx.open) return manageEx.open[key];
      if (key === 'archived') return false;
      return key === 'pinned' || totalActive <= 12;
    };

    const html = sections.filter((s) => s.items.length).map((s) => {
      const open = isOpen(s.key);
      return `<div class="g-sec">
        <button type="button" class="g-head" data-sec="${s.key}" aria-expanded="${open}">${uiIcon(open ? 'chevron-down' : 'chevron-right')}<span>${s.label}</span><span class="n">${s.items.length}</span></button>
        ${open ? `<div class="g-list">${s.items.map(manageExRowHtml).join('')}</div>` : ''}
      </div>`;
    }).join('');
    wrap.innerHTML = html
      ? `<div class="card org-card">${html}</div>`
      : `<div class="card org-card"><p class="muted-text org-empty">${state.exercises.length ? 'No exercises match.' : 'No exercises yet.'}</p></div>`;
  }

  function wireManageExercises() {
    wireFScroll(document.getElementById('exManageChips'));
    document.getElementById('exManageSearch').addEventListener('input', (ev) => { manageEx.query = ev.target.value; renderExerciseManageList(); });
    document.getElementById('exManageChips').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      manageEx.filter = b.dataset.chip;
      renderExerciseManageList();
    });
    document.getElementById('exerciseManageList').addEventListener('click', (ev) => {
      const star = ev.target.closest('[data-fav]');
      if (star) { toggleExerciseFavorite(star.dataset.fav); return; }
      const head = ev.target.closest('[data-sec]');
      if (head) {
        const key = head.dataset.sec;
        manageEx.open[key] = head.getAttribute('aria-expanded') !== 'true';
        renderExerciseManageList();
        return;
      }
      const edit = ev.target.closest('[data-action="edit-exercise"]');
      if (edit) { openExerciseForm(edit.dataset.id); return; }
      const un = ev.target.closest('[data-action="unarchive-exercise"]');
      if (un) {
        const ex = exerciseById(un.dataset.id);
        if (!ex) return;
        ex.archived = false;
        if (!save()) return;
        toast('Exercise unarchived');
        renderAll();
      }
    });
  }

  /* ---------- Saved foods: shared helpers ---------- */

  // savedFoodId -> sortable date+id of its last use. Entries from a saved food
  // carry its id; older ones match by the note holding its name.
  function savedFoodLastUsedMap() {
    const byName = {};
    state.food.savedFoods.forEach((f) => { byName[f.name] = f.id; });
    const m = {};
    state.food.entries.forEach((e) => {
      const id = e.savedFoodId || (e.note && byName[e.note]);
      if (!id) return;
      const k = e.date + e.id;
      if (!m[id] || k > m[id]) m[id] = k;
    });
    return m;
  }
  function savedFoodCategoryLabel(food) {
    const c = SAVED_FOOD_CATEGORIES.find((x) => x.value === (food.category || 'other'));
    return c ? c.label : 'Other';
  }
  const SAVED_FOOD_CHIP_LABELS = { meal: 'Meals', snack: 'Snacks', drink: 'Drinks', other: 'Other' };
  function toggleSavedFoodFavorite(id) {
    const f = savedFoodById(id);
    if (!f) return;
    f.favorite = !f.favorite;
    if (!save()) return;
    renderSavedFoodLogList();
    renderSavedFoodManageList();
  }

  function populateExerciseSelect(select, { includeArchived = false } = {}) {
    const list = includeArchived ? state.exercises : activeExercises();
    const groups = groupBySection(list);
    let html = '';
    ['goal', 'daily', 'accessory'].forEach((sec) => {
      if (!groups[sec].length) return;
      html += `<optgroup label="${SECTION_LABELS[sec]}">` +
        groups[sec].map((ex) => `<option value="${ex.id}">${exerciseLabelHtml(ex)}${ex.archived ? ' (archived)' : ''}</option>`).join('') +
        `</optgroup>`;
    });
    html += `<option value="__add_new__">+ Add new exercise…</option>`;
    select.innerHTML = html;
  }

  // The Log tab switches between Workout, Body, Water and Food with a segmented
  // control; they share the "Recent entries" list. availableDomainCategories()
  // says which are shown.
  let logCategory = 'workout';

  // Inline SVG icons are Lucide (https://lucide.dev, ISC license), copied in so
  // the app works offline: 24x24 viewBox, stroke currentColor, width 2, round caps.
  // Edit (pencil) glyph for a detail modal's title row.
  const EDIT_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

  // Modal close button and the set-row remove button (Lucide `x`).
  const CLOSE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // Back link in the "Next session" modal (Lucide `chevron-left`).
  const BACK_CHEVRON_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';

  // Leading "+" on the Add exercise / tracker / cup buttons (Lucide `plus`).

  // The day-streak flame (see renderSummary); Lucide `flame`.
  const FLAME_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/></svg>';

  // Icons for the four domain tabs (Workout, Body, Water, Food), shared by Log,
  // History and Manage. They resolve to ITEM_ICONS (js/icons.js); getters because
  // ITEM_ICONS is declared further down.
  const DOMAIN_TAB_ICONS = {
    get workout() { return itemIconSvg('dumbbell'); },
    get measurements() { return itemIconSvg('ruler'); },
    get water() { return itemIconSvg('droplets'); },
    get food() { return itemIconSvg('apple'); },
  };

  // Icons for the static `data-icon="name"` spots in index.html (and the trophy
  // on the Strength level card). Same Lucide style as every icon above.
  const lucide = (paths) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const CHEVRON_RIGHT_SVG = lucide('<path d="m9 18 6-6-6-6"/>');
  const CHECK_ICON_SVG = lucide('<path d="M20 6 9 17l-5-5"/>');
  const STATIC_ICONS = {
    get workout() { return DOMAIN_TAB_ICONS.workout; },
    get measurements() { return DOMAIN_TAB_ICONS.measurements; },
    get ruler() { return DOMAIN_TAB_ICONS.measurements; },
    get water() { return DOMAIN_TAB_ICONS.water; },
    get food() { return DOMAIN_TAB_ICONS.food; },
    get apple() { return DOMAIN_TAB_ICONS.food; },
    get scale() { return itemIconSvg('scale'); },
    get moon() { return itemIconSvg('moon'); },
    get footprints() { return itemIconSvg('footprints'); },
    trophy: lucide('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
    chart: lucide('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
    calendar: lucide('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
    contrast: lucide('<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>'),
    habits: lucide('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),
    calculator: lucide('<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>'),
    download: lucide('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    upload: lucide('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
  };
  function hydrateStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = STATIC_ICONS[el.dataset.icon] || ''; });
  }

  /* ============================== Item icons ==============================
     Every exercise, tracker, cup and saved food shows an icon: the user's choice (an optional
     `icon` key) or a default by type. ITEM_ICONS (js/icons.js) maps key -> [label, picker
     category, Lucide paths]. */
  const { ITEM_ICONS } = window.FitIcons;
  const ITEM_ICON_CATEGORIES = [['common', 'Common'], ['training', 'Training'], ['body', 'Body'], ['food', 'Food']];
  const COMMON_ICONS = ['dumbbell', 'weight', 'activity', 'footprints', 'bike', 'timer', 'flame', 'scale', 'ruler', 'heart', 'moon', 'droplets', 'glass', 'apple', 'utensils', 'coffee', 'biceps', 'pill'];
  const EXERCISE_DEFAULT_ICON = { weight: 'dumbbell', reps: 'activity', cardio: 'footprints', habit: 'standing' };

  function itemIconSvg(key) { return lucide((ITEM_ICONS[key] || ITEM_ICONS.dumbbell)[2]); }
  function itemIconHtml(key, small) {
    return `<span class="item-icon${small ? ' item-icon-sm' : ''}" aria-hidden="true">${itemIconSvg(key)}</span>`;
  }
  function exerciseIconKey(ex) { return ex && ITEM_ICONS[ex.icon] ? ex.icon : (ex && EXERCISE_DEFAULT_ICON[ex.kind]) || 'dumbbell'; }
  function trackerDefaultIcon(t) { return t && t.kind === 'sleep' ? 'moon' : t && t.unitKind === 'weight' ? 'scale' : 'ruler'; }
  function trackerIconKey(t) { return t && ITEM_ICONS[t.icon] ? t.icon : trackerDefaultIcon(t); }
  function cupIconKey(cup) { return cup && ITEM_ICONS[cup.icon] ? cup.icon : 'droplets'; }
  function savedFoodIconKey(food) { return food && ITEM_ICONS[food.icon] ? food.icon : 'utensils'; }
  const exerciseIconHtml = (ex, small) => itemIconHtml(exerciseIconKey(ex), small);
  const trackerIconHtml = (t, small) => itemIconHtml(trackerIconKey(t), small);
  const cupIconHtml = (cup, small) => itemIconHtml(cupIconKey(cup), small);
  const savedFoodIconHtml = (food, small) => itemIconHtml(savedFoodIconKey(food), small);

  // The "Icon" field of an Add/Edit form: shows the current icon and opens a grid
  // to pick another. `getDefault` gives the icon shown when none is chosen;
  // `value()` returns the chosen key, or null for the default.
  const PENCIL_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
  // Top of every Add/Edit form: a large icon tile with a pencil badge beside the
  // Name field; tapping it opens the icon picker. Shared by the exercise, tracker,
  // cup and saved-food forms.
  function nameIconHtml({ iconId, inputId, value, placeholder, maxlength, label = 'Name' }) {
    return `
      <div class="field">
        <span class="field-label">${label}</span>
        <div class="name-icon-row">
          <button type="button" class="itile" id="${iconId}" aria-expanded="false" aria-label="Change icon"></button>
          <input type="text" id="${inputId}" value="${value ? escapeHtml(value) : ''}" placeholder="${placeholder}" maxlength="${maxlength}" aria-label="${label}" />
        </div>
        <span class="field-hint">Tap the icon to change it</span>
        <div class="icon-picker" id="${iconId}Picker" hidden>
          <input type="search" id="${iconId}Search" placeholder="Search icons" aria-label="Search icons" />
          <div class="segmented" role="radiogroup" aria-label="Icon category">
            ${ITEM_ICON_CATEGORIES.map(([k, l]) => `<button type="button" data-icon-cat="${k}" role="radio">${l}</button>`).join('')}
          </div>
          <div class="icon-grid" role="radiogroup" aria-label="Icons"></div>
          <button type="button" class="btn btn-secondary btn-block" data-action="icon-default">Use default icon</button>
        </div>
      </div>`;
  }
  function wireIconField(id, getDefault, initial) {
    let chosen = initial && ITEM_ICONS[initial] ? initial : null;
    let category = 'common';
    const row = document.getElementById(id);
    const picker = document.getElementById(`${id}Picker`);
    const search = document.getElementById(`${id}Search`);
    const grid = picker.querySelector('.icon-grid');
    const current = () => chosen || getDefault();
    function paintRow() {
      row.innerHTML = `<span class="itile-ico">${itemIconSvg(current())}</span><span class="itile-badge">${PENCIL_ICON_SVG}</span>`;
      row.title = `${ITEM_ICONS[current()][0]}${chosen ? '' : ' (default)'} — tap to change`;
    }
    function paintGrid() {
      const q = search.value.trim().toLowerCase();
      picker.querySelectorAll('[data-icon-cat]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.iconCat === category)));
      const keys = q ? Object.keys(ITEM_ICONS).filter((k) => ITEM_ICONS[k][0].toLowerCase().includes(q))
        : category === 'common' ? COMMON_ICONS : Object.keys(ITEM_ICONS).filter((k) => ITEM_ICONS[k][1] === category);
      grid.innerHTML = keys
        .map((key) => `<button type="button" class="icon-cell" data-icon-key="${key}" role="radio" aria-checked="${key === current()}" aria-label="${ITEM_ICONS[key][0]}">${itemIconSvg(key)}</button>`).join('')
        || '<p class="muted-text">No icons match.</p>';
    }
    function choose(key) {
      chosen = key;
      picker.hidden = true;
      row.setAttribute('aria-expanded', 'false');
      paintRow();
      row.focus();
    }
    row.addEventListener('click', () => {
      picker.hidden = !picker.hidden;
      row.setAttribute('aria-expanded', String(!picker.hidden));
      if (!picker.hidden) { paintGrid(); if (picker.scrollIntoView) picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    search.addEventListener('input', paintGrid);
    picker.querySelectorAll('[data-icon-cat]').forEach((b) => b.addEventListener('click', () => { category = b.dataset.iconCat; paintGrid(); }));
    grid.addEventListener('click', (ev) => { const b = ev.target.closest('[data-icon-key]'); if (b) choose(b.dataset.iconKey); });
    picker.querySelector('[data-action="icon-default"]').addEventListener('click', () => choose(null));
    paintRow();
    return { value: () => chosen, refresh: paintRow };
  }

  // Display label per domain. The id stays `measurements` (matching
  // settings.trackMeasurements) though it is labelled "Body".
  const DOMAIN_LABELS = { workout: 'Workout', measurements: 'Body', water: 'Water', food: 'Food' };
  const DOMAIN_ORDER = ['workout', 'measurements', 'water', 'food'];

  // Master "Track this" switch per domain (settings.trackWorkout/trackMeasurements/
  // trackWater/trackFood). The Workout domain counts as on while Lifting, Running &
  // cardio or Habits is on (js/features.js).
  function domainTracked(id) { return F.domainTracked(state.settings, id); }

  // Log and History offer only domains that are on. Manage offers all four
  // (ALL_DOMAIN_CATEGORIES).
  function availableDomainCategories() {
    // With only Habits on, "Workout" would promise lifting that isn't being
    // tracked, so Log and History call it what it holds.
    const habitsOnly = F.habitsOnly(state.settings);
    return DOMAIN_ORDER.filter(domainTracked).map((id) => ({ id, label: id === 'workout' && habitsOnly ? 'Habits' : DOMAIN_LABELS[id] }));
  }

  // Manage always offers all four domains: it is where an off domain is turned back on.
  const ALL_DOMAIN_CATEGORIES = DOMAIN_ORDER.map((id) => ({ id, label: DOMAIN_LABELS[id] }));

  // Domain tab markup shared by Log, History and Manage. An off domain gets
  // `.is-toggled-off` (dimmed but still tappable); only Manage shows one.
  function domainTabsHtml(cats, activeId) {
    return cats.map((c) => `
      <button type="button" class="domain-tab${domainTracked(c.id) ? '' : ' is-toggled-off'}" data-domain-cat="${c.id}" role="radio" aria-checked="${c.id === activeId}">
        ${c.label === 'Habits' ? STATIC_ICONS.habits : (DOMAIN_TAB_ICONS[c.id] || '')}
        <span>${c.label}</span>
      </button>`).join('');
  }

  function renderLogCategorySegmented() {
    const cats = availableDomainCategories();
    // All domains can be off at once, so cats[0] may not exist.
    if (cats.length && !cats.some((c) => c.id === logCategory)) logCategory = cats[0].id;
    const seg = document.getElementById('logCategorySegmented');
    seg.innerHTML = domainTabsHtml(cats, logCategory);
    seg.hidden = cats.length < 2; // a single tracked section needs no switcher
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { logCategory = b.dataset.domainCat; renderLogView(); });
    });
  }

  function renderLogForm() {
    const select = document.getElementById('logExercise');
    const prevValue = select.value;
    populateExerciseSelect(select);
    // Nothing is chosen until the user picks one (or opens one from elsewhere in
    // the app), hence the blank first option.
    select.insertAdjacentHTML('afterbegin', '<option value=""></option>');
    select.value = prevValue && [...select.options].some((o) => o.value === prevValue) ? prevValue : '';
    document.getElementById('logDate').value = document.getElementById('logDate').value || todayISO();
    const ex = exerciseById(select.value);
    renderDynamicFields(document.getElementById('logDynamicFields'), ex);
    syncLogWorkoutUI();
  }

  function populateTrackerSelect(select) {
    const prevValue = select.value;
    select.innerHTML = activeTrackers().map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    if (prevValue && [...select.options].some((o) => o.value === prevValue)) select.value = prevValue;
  }

  function renderLogMeasurementForm() {
    const select = document.getElementById('logTracker');
    populateTrackerSelect(select);
    document.getElementById('logMeasurementDate').value = document.getElementById('logMeasurementDate').value || todayISO();
    const tracker = trackerById(select.value);
    const isSleep = tracker && tracker.kind === 'sleep';
    // innerHTML on purpose: trackerUnitLabel() already escapes, so textContent would show "&amp;".
    document.getElementById('logMeasurementValueLabel').innerHTML = tracker ? (isSleep ? 'Hours slept' : `Value (${trackerUnitLabel(tracker)})`) : 'Value';
    document.getElementById('logSleepQualityField').hidden = !isSleep;
  }

  function handleLogMeasurementSubmit(ev) {
    ev.preventDefault();
    const tracker = trackerById(document.getElementById('logTracker').value);
    if (!tracker) { toast('Add a tracker first.'); return; }
    const raw = parseFloat(document.getElementById('logMeasurementValue').value);
    if (Number.isNaN(raw)) { toast('Enter a value.'); return; }
    const date = readDate('logMeasurementDate', todayISO());
    if (!date) return;
    const valueError = measurementError(tracker, trackerCanonicalFromDisplay(tracker, raw));
    if (valueError) { toast(valueError); return; }
    const note = document.getElementById('logMeasurementNote').value.trim();
    const quality = tracker.kind === 'sleep' ? clampQuality(document.getElementById('logSleepQuality').dataset.value) : undefined;
    // A goal with no baseline (e.g. an older tracker with no history to backfill)
    // takes the previous latest value as its baseline, or this entry's value if it
    // is the first.
    if (tracker.goal != null && tracker.baseline == null) {
      const prevLatest = latestMeasurement(tracker.id);
      tracker.baseline = prevLatest ? prevLatest.value : trackerCanonicalFromDisplay(tracker, raw);
    }
    state.measurements.push({ id: genId('meas'), trackerId: tracker.id, date, value: trackerCanonicalFromDisplay(tracker, raw), quality, note: note || null });
    // A new bodyweight entry can move a lift's bodyweight-standard goal (see
    // recomputeStandardGoals()). A no-op for other trackers.
    if (tracker.id === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
    if (!save()) return;
    toast('Entry saved');
    document.getElementById('logMeasurementValue').value = '';
    resetChipPicker(document.getElementById('logSleepQuality'));
    document.getElementById('logMeasurementNote').value = '';
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  function renderLogWaterPanel() {
    document.getElementById('logWaterUnitLabel').textContent = Units.volumeUnitLabel();
    const wrap = document.getElementById('waterCupButtons');
    wrap.innerHTML = cupButtonsHtml();
    wrap.querySelectorAll('.cup-btn').forEach((btn) => btn.addEventListener('click', () => {
      const cup = cupById(btn.dataset.cupId);
      if (cup) logWaterAmount(cup.amountMl, cup.id);
    }));
  }

  // A food entry needs at least one tracked value; no single field is required.
  const anyMacro = (values) => Object.values(values).some((v) => v != null);

  function renderLogFoodForm() {
    document.getElementById('logFoodDate').value = document.getElementById('logFoodDate').value || todayISO();
    const wrap = document.getElementById('logFoodDynamicFields');
    wrap.innerHTML = trackedMacroKeys().map((k) => {
      return `
      <label class="field"><span class="field-label">${MACRO_LABELS[k]}${MACRO_UNITS[k] ? ` (${MACRO_UNITS[k]})` : ''} <span class="muted-text">(optional)</span></span>
        <input type="number" step="any" min="0" id="logFood_${k}" placeholder="e.g. ${MACRO_PLACEHOLDERS[k]}" /></label>`;
    }).join('');
  }

  function handleLogFoodSubmit(ev) {
    ev.preventDefault();
    const values = {};
    trackedMacroKeys().forEach((k) => {
      const el = document.getElementById(`logFood_${k}`);
      const raw = el ? parseFloat(el.value) : NaN;
      values[k] = (!Number.isNaN(raw) && raw >= 0) ? raw : null;
    });
    if (!anyMacro(values)) { toast('Enter at least one value to log a food entry.'); return; }
    const date = readDate('logFoodDate', todayISO());
    if (!date) return;
    const note = document.getElementById('logFoodNote').value.trim();
    state.food.entries.push({ id: genId('food'), date, ...values, note: note || null });
    if (!save()) return;
    toast('Food logged');
    trackedMacroKeys().forEach((k) => { const el = document.getElementById(`logFood_${k}`); if (el) el.value = ''; });
    document.getElementById('logFoodNote').value = '';
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  // Redraw the selected Log form and the shared "Recent entries" list.
  function renderLogView() {
    renderLogCategorySegmented();
    const cats = availableDomainCategories();
    // With every domain off, `logCategory` may be stale, so `allOff` forces every form hidden.
    const allOff = cats.length === 0;
    document.getElementById('logAllOffHint').hidden = !allOff;
    // Which of the workout pieces (picker / form / switch row) show is decided in syncLogWorkoutUI().
    document.getElementById('logForm').hidden = true;
    document.getElementById('logExercisePicker').hidden = true;
    document.getElementById('logSwitchCard').hidden = true;
    document.getElementById('logMeasurementForm').hidden = allOff || logCategory !== 'measurements';
    document.getElementById('logWaterPanel').hidden = allOff || logCategory !== 'water';
    // Food: saved foods lead; typing one in by hand is collapsed under them
    // (open straight away when nothing is saved yet).
    const hasSaved = state.food.savedFoods.length > 0;
    const foodOn = !allOff && logCategory === 'food';
    document.getElementById('logFoodForm').hidden = !foodOn || (hasSaved && !foodLog.manualOpen);
    document.getElementById('logFoodManualCard').hidden = !foodOn || !hasSaved;
    document.getElementById('savedFoodsWrap').hidden = !foodOn || !hasSaved;
    if (foodOn && hasSaved) {
      document.getElementById('logFoodCreateBtn').innerHTML = `<span class="row-icon">${uiIcon('plus')}</span><span class="row-lead"><b class="link-text">Create a food</b><span class="muted-text">Name, serving and macros</span></span>${uiIcon('chevron-right')}`;
      document.getElementById('logFoodManualBtn').innerHTML = `<span class="row-icon">${uiIcon('plus')}</span><span class="row-lead"><b class="link-text">Quick calories</b><span class="muted-text">Calories and macros without saving a food</span></span>${uiIcon(foodLog.manualOpen ? 'chevron-up' : 'chevron-down')}`;
    }
    if (!allOff) {
      if (logCategory === 'workout') renderLogForm(); else syncLogWorkoutUI();
      if (logCategory === 'measurements') renderLogMeasurementForm();
      if (logCategory === 'water') renderLogWaterPanel();
      if (logCategory === 'food') { renderLogFoodForm(); renderSavedFoodLogList(); }
    }
    renderTodayBars();
    renderRecentEntries();
  }

  // "Recent entries" follows the active Log category.
  function renderRecentEntries() {
    renderTodayBars();
    const wrap = document.getElementById('recentEntries');
    if (!availableDomainCategories().length) { wrap.innerHTML = ''; return; }
    if (logCategory === 'measurements') {
      const recent = state.measurements.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 1);
      wrap.innerHTML = recent.length ? recent.map((m) => measurementRowHtml(m)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireMeasurementRowClicks(wrap);
      return;
    }
    if (logCategory === 'water') {
      const recent = state.waterEntries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 1);
      wrap.innerHTML = recent.length ? recent.map((e) => waterEntryRowHtml(e)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireWaterEntryRowClicks(wrap);
      return;
    }
    if (logCategory === 'food') {
      const recent = state.food.entries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 1);
      wrap.innerHTML = recent.length ? recent.map((e) => foodEntryRowHtml(e)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireFoodEntryRowClicks(wrap);
      return;
    }
    const recent = state.entries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 1);
    if (!recent.length) { wrap.innerHTML = `<p class="muted-text">Nothing logged yet — your latest entry will show up here.</p>`; return; }
    wrap.innerHTML = recent.map((e) => entryRowHtml(e)).join('');
    wireEntryRowClicks(wrap);
  }

  function entrySummaryText(exercise, entry) {
    if (!exercise) return '';
    if (exercise.kind === 'habit') return entry.time ? `Done · ${new Date(`2000-01-01T${entry.time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Done';
    if (exercise.kind === 'weight') {
      return (entry.sets || []).map((s) => `${round(Units.lbToDisplay(s.weight), 1)}${Units.weightUnitLabel()}×${s.reps}`).join(', ');
    }
    if (exercise.kind === 'reps') {
      return (entry.sets || []).map((s) => `${isTimed(exercise) ? fmtHold(s.reps) : s.reps}${s.addedWeight ? ` (+${round(Units.lbToDisplay(s.addedWeight), 1)}${Units.weightUnitLabel()})` : ''}`).join(', ') + (isTimed(exercise) ? '' : ' reps');
    }
    const bits = [];
    if (entry.distance != null) bits.push(fmtDistance(entry.distance));
    if (entry.duration != null) bits.push(fmtDuration(entry.duration));
    if (entry.distance && entry.duration) bits.push(fmtPace(entry.duration / entry.distance));
    if (entry.rpe != null) bits.push(`RPE ${entry.rpe}`);
    return bits.join(' · ');
  }

  function entryRowHtml(entry) {
    const ex = exerciseById(entry.exerciseId);
    return `
      <div class="entry-row" data-entry-id="${entry.id}">
        ${exerciseIconHtml(ex, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(ex ? exerciseLabel(ex) : 'Deleted exercise')}</div>
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

  function waterEntryRowHtml(e) {
    const cup = e.cupId ? cupById(e.cupId) : null;
    return `
      <div class="entry-row" data-water-entry-id="${e.id}">
        ${cupIconHtml(cup, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${cup ? escapeHtml(cup.name) : 'Custom amount'}</div>
          <div class="entry-row-sub">${fmtVolume(e.amountMl)}</div>
        </div>
        <div class="entry-row-date">${fmtDateShort(e.date)}</div>
      </div>`;
  }

  function wireWaterEntryRowClicks(container) {
    container.querySelectorAll('.entry-row[data-water-entry-id]').forEach((row) => {
      row.addEventListener('click', () => openWaterEntryModal(row.getAttribute('data-water-entry-id')));
    });
  }

  function openWaterEntryModal(entryId) {
    const e = state.waterEntries.find((x) => x.id === entryId);
    if (!e) return;
    openModal(`
      <div class="modal-title-row"><h2>Edit water entry</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Date</span><input type="date" id="editWaterDate" value="${e.date}" /></label>
        <label class="field"><span class="field-label">Amount (${Units.volumeUnitLabel()})</span>
          <input type="number" step="any" min="0" id="editWaterAmount" value="${round(Units.mlToDisplay(e.amountMl), 1)}"${canonAttr(e.amountMl)} /></label>
        <div class="btn-row"><button class="btn btn-primary btn-block" id="saveWaterEntryBtn">Save changes</button></div>
        <button class="btn btn-danger btn-block" id="deleteWaterEntryBtn">Delete entry</button>
      </div>
    `);
    document.getElementById('saveWaterEntryBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('editWaterAmount').value);
      if (Number.isNaN(raw) || raw <= 0) { toast('Enter an amount greater than zero.'); return; }
      const newMl = fieldCanon(document.getElementById('editWaterAmount'), Units.displayToMl);
      if (tooBigWater(newMl)) { toast(WATER_TOO_BIG); return; }
      const newDate = readDate('editWaterDate', e.date);
      if (!newDate) return;
      e.date = newDate;
      e.amountMl = newMl;
      if (!save()) return;
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteWaterEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.waterEntries = state.waterEntries.filter((x) => x.id !== entryId);
        if (!save()) return;
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  function foodEntryRowHtml(e) {
    return `
      <div class="entry-row" data-food-entry-id="${e.id}">
        ${savedFoodIconHtml(savedFoodMatching(e), true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${e.note ? escapeHtml(e.note) : 'Quick calories'}</div>
          <div class="entry-row-sub num">${compactFoodLine(e)}</div>
        </div>
        <div class="entry-row-date">${fmtDateShort(e.date)}</div>
      </div>`;
  }

  function wireFoodEntryRowClicks(container) {
    container.querySelectorAll('.entry-row[data-food-entry-id]').forEach((row) => {
      row.addEventListener('click', () => openFoodEntryModal(row.getAttribute('data-food-entry-id')));
    });
  }

  // Whether an entry is already a saved food: its note matches a saved food's
  // name (case-insensitive). Used only to hide the "Save as a saved food" button.
  function savedFoodMatching(entry) {
    if (!entry.note) return null;
    const name = entry.note.trim().toLowerCase();
    return state.food.savedFoods.find((f) => f.name.trim().toLowerCase() === name) || null;
  }
  function foodEntryAlreadySaved(entry) { return !!savedFoodMatching(entry); }

  // Only tracked macro fields are shown, so `Object.assign(e, values)` below
  // leaves any saved value for an untracked macro alone.
  function openFoodEntryModal(entryId) {
    const e = state.food.entries.find((x) => x.id === entryId);
    if (!e) return;
    // "Save as a saved food" prefills the saved-food form from this entry (its
    // `prefill` param). Hidden once a saved food with this name exists.
    const offerSaveAsFood = !foodEntryAlreadySaved(e);
    openModal(`
      <div class="modal-title-row"><h2>Edit food entry</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Date</span><input type="date" id="editFoodDate" value="${e.date}" /></label>
        ${trackedMacroKeys().map((k) => {
          return `
        <label class="field"><span class="field-label">${MACRO_LABELS[k]}${MACRO_UNITS[k] ? ` (${MACRO_UNITS[k]})` : ''} <span class="muted-text">(optional)</span></span>
          <input type="number" step="any" min="0" id="editFood_${k}" value="${e[k] != null ? e[k] : ''}" /></label>`;
        }).join('')}
        <label class="field"><span class="field-label">Note</span><input type="text" id="editFoodNote" value="${e.note ? escapeHtml(e.note) : ''}" maxlength="200" /></label>
        ${offerSaveAsFood ? `<button type="button" class="btn btn-secondary btn-block" id="saveAsSavedFoodBtn">Save as a saved food</button>` : ''}
        <div class="btn-row"><button class="btn btn-primary btn-block" id="saveFoodEntryBtn">Save changes</button></div>
        <button class="btn btn-danger btn-block" id="deleteFoodEntryBtn">Delete entry</button>
      </div>
    `);
    const readMacro = (id) => {
      const raw = parseFloat(document.getElementById(id).value);
      return (!Number.isNaN(raw) && raw >= 0) ? raw : null;
    };
    document.getElementById('saveFoodEntryBtn').addEventListener('click', () => {
      const values = {};
      trackedMacroKeys().forEach((k) => { values[k] = readMacro(`editFood_${k}`); });
      if (!anyMacro(values)) { toast('Enter at least one value to save this entry.'); return; }
      const newDate = readDate('editFoodDate', e.date);
      if (!newDate) return;
      e.date = newDate;
      Object.assign(e, values);
      e.note = document.getElementById('editFoodNote').value.trim() || null;
      if (!save()) return;
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    const saveAsSavedFoodBtn = document.getElementById('saveAsSavedFoodBtn');
    if (saveAsSavedFoodBtn) {
      saveAsSavedFoodBtn.addEventListener('click', () => {
        const prefill = { name: e.note || '' };
        trackedMacroKeys().forEach((k) => { prefill[k] = e[k]; });
        openSavedFoodForm(null, prefill);
      });
    }
    document.getElementById('deleteFoodEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.food.entries = state.food.entries.filter((x) => x.id !== entryId);
        if (!save()) return;
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  /* ============================== Saved Foods ==============================
     Named food templates (Manage -> Food -> Saved foods). Logging one is a
     single tap, optionally scaled by quantity, and creates a normal food entry. */

  function savedFoodById(id) { return state.food.savedFoods.find((f) => f.id === id); }

  // Category per saved food (default 'other'), used by the Log -> Food filter
  // chips (see renderSavedFoodLogList()).
  const SAVED_FOOD_CATEGORIES = [
    { value: 'meal', label: 'Meal' },
    { value: 'snack', label: 'Snack' },
    { value: 'drink', label: 'Drink' },
    { value: 'other', label: 'Other' },
  ];

  function openSavedFoodForm(foodId, prefill) {
    const editing = !!foodId;
    const food = editing ? savedFoodById(foodId) : null;
    const seed = food || prefill || null;
    let selectedCategory = (seed && seed.category) || 'other';
    let selectedFavorite = !!(food && food.favorite);
    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit food' : 'Add a food'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        ${nameIconHtml({ iconId: 'savedFoodIcon', inputId: 'savedFoodName', value: seed && seed.name, placeholder: 'e.g. Chicken breast, 6oz', maxlength: 60 })}
        <label class="field"><span class="field-label">Serving <span class="muted-text">(optional)</span></span>
          <input type="text" id="savedFoodServing" maxlength="40" placeholder="e.g. 1 cup, 100 g, 1 medium" value="${escapeHtml((seed && seed.serving) || '')}" autocomplete="off" />
          <span class="muted-text field-hint">The numbers below are for one serving. You pick how many when you log it.</span></label>
        <div class="field">
          <span class="field-label">Category</span>
          <div class="segmented" id="savedFoodCategorySegmentedForm" role="radiogroup" aria-label="Category">
            ${SAVED_FOOD_CATEGORIES.map((c) => `<button type="button" data-category="${c.value}" role="radio">${c.label}</button>`).join('')}
          </div>
        </div>
        <div class="card card-list"><div class="setting-row">
          <span>Favorite<span class="muted-text">Shows under Favorites when you log a food</span></span>
          ${switchHtml('id="savedFoodFavorite"', 'Favorite', selectedFavorite)}
        </div></div>
        ${trackedMacroKeys().map((k) => {
          return `
        <label class="field"><span class="field-label">${MACRO_LABELS[k]}${MACRO_UNITS[k] ? ` (${MACRO_UNITS[k]})` : ''} <span class="muted-text">(optional)</span></span>
          <input type="number" step="any" min="0" id="savedFood_${k}" value="${seed && seed[k] != null ? seed[k] : ''}" /></label>`;
        }).join('')}
        <button type="button" class="btn btn-primary btn-block" id="saveSavedFoodBtn">${editing ? 'Save changes' : 'Save food'}</button>
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteSavedFoodBtn">Delete saved food</button>` : ''}
      </div>
    `);
    const iconField = wireIconField('savedFoodIcon', () => 'utensils', seed && seed.icon);
    function setCategoryUI(val) {
      selectedCategory = val;
      document.querySelectorAll('#savedFoodCategorySegmentedForm button').forEach((btn) => {
        btn.setAttribute('aria-checked', String(btn.dataset.category === val));
      });
    }
    setCategoryUI(selectedCategory);
    document.querySelectorAll('#savedFoodCategorySegmentedForm button').forEach((btn) => {
      btn.addEventListener('click', () => setCategoryUI(btn.dataset.category));
    });
    document.getElementById('savedFoodFavorite').addEventListener('click', (ev) => {
      selectedFavorite = !selectedFavorite;
      ev.currentTarget.setAttribute('aria-checked', String(selectedFavorite));
    });
    document.getElementById('saveSavedFoodBtn').addEventListener('click', () => {
      const name = document.getElementById('savedFoodName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      const values = {};
      trackedMacroKeys().forEach((k) => {
        const el = document.getElementById(`savedFood_${k}`);
        const raw = el ? parseFloat(el.value) : NaN;
        values[k] = (!Number.isNaN(raw) && raw >= 0) ? raw : null;
      });
      if (!anyMacro(values)) { toast('Enter at least one value to save this food.'); return; }
      if (editing) {
        food.name = name;
        food.category = selectedCategory;
        food.favorite = selectedFavorite;
        const serving = document.getElementById('savedFoodServing').value.trim();
        if (serving) food.serving = serving; else delete food.serving;
        Object.assign(food, values);
        if (iconField.value()) food.icon = iconField.value(); else delete food.icon;
      } else {
        state.food.savedFoods.push({ id: genId('savedfood'), name, category: selectedCategory, favorite: selectedFavorite, ...values, ...(document.getElementById('savedFoodServing').value.trim() && { serving: document.getElementById('savedFoodServing').value.trim() }), ...(iconField.value() && { icon: iconField.value() }) });
      }
      if (!save()) return;
      closeModal();
      toast(editing ? 'Saved food updated' : 'Food saved');
      renderManage();
      renderLogView();
    });
    if (editing) {
      document.getElementById('deleteSavedFoodBtn').addEventListener('click', () => {
        confirmDialog('Delete this saved food?', 'This can’t be undone. Food entries already logged from it aren’t affected.', 'Delete', () => {
          state.food.savedFoods = state.food.savedFoods.filter((f) => f.id !== foodId);
          if (!save()) return;
          toast('Saved food deleted');
          renderManage();
          renderLogView();
        }, true);
      });
    }
  }

  // Transient UI state (not saved) for the Log -> Food quantity picker: the
  // expanded saved food and its quantity, reset to 1x when another row opens.
  let expandedSavedFoodId = null;
  let savedFoodQty = 1;
  
  // Every tracked macro on `food` scaled by `qty` and rounded to 1 decimal;
  // macros it has no value for stay null.
  function scaledSavedFoodValues(food, qty) {
    const values = {};
    trackedMacroKeys().forEach((k) => { values[k] = food[k] != null ? round(food[k] * qty, 1) : null; });
    return values;
  }

  /* ---------- Log -> Food: saved foods ---------- */

  // Transient UI state (never saved).
  const foodLog = { seg: null, cat: 'all', query: '', showAll: false, manualOpen: false };
  const FOOD_LIST_LIMIT = 5;
  let savedFoodDate = null;

  // Compact food line: serving, kcal, tracked macros (P/C/F) and caffeine.
  function compactFoodLine(food) {
    const tracked = trackedMacroKeys();
    const parts = [];
    if (food.serving) parts.push(escapeHtml(food.serving));
    if (food.calories != null) parts.push(`${Math.round(food.calories)} kcal`);
    [['protein', 'P'], ['carbs', 'C'], ['fat', 'F']].forEach(([k, l]) => { if (tracked.includes(k) && food[k] != null) parts.push(`${l} ${Math.round(food[k])}`); });
    if (tracked.includes('caffeine') && food.caffeine) parts.push(`${Math.round(food.caffeine)} mg caffeine`);
    return parts.join(' · ');
  }

  function todayBarHtml(value, goalText, label, fillPct, over, linkId, linkText) {
    return `
      <div class="today-bar-top"><span class="num"><b>${value}</b> <span class="muted-text">${goalText ? `/ ${goalText} ${label}` : label}</span></span><button type="button" class="link-btn" id="${linkId}">${linkText}</button></div>
      ${fillPct != null ? `<div class="meter meter-sm"><div class="meter-fill${over ? ' is-over' : ''}" style="--fill:${Math.min(100, fillPct)}%"></div></div>` : ''}`;
  }

  // Food and Water each get their own "today" bar on their own Log tab only.
  function renderFoodTodayBar() {
    const bar = document.getElementById('foodTodayBar');
    const on = state.settings.trackFood && logCategory === 'food' && availableDomainCategories().length > 0;
    bar.hidden = !on; if (!on) return;
    const totals = foodTotalsForDate(todayISO());
    const cal = macroGoalInfo('calories');
    const hasGoal = cal.enabled && cal.goal != null;
    const eaten = totals.calories || 0;
    bar.innerHTML = todayBarHtml(Math.round(eaten).toLocaleString(), hasGoal ? Math.round(cal.goal).toLocaleString() : '', hasGoal ? 'kcal today' : 'kcal today',
      hasGoal ? (eaten / cal.goal) * 100 : null, hasGoal && eaten > cal.goal, 'foodViewDayBtn', 'View day');
    document.getElementById('foodViewDayBtn').addEventListener('click', () => openFoodDetail());
  }

  function renderWaterTodayBar() {
    const bar = document.getElementById('waterTodayBar');
    const on = state.settings.trackWater && logCategory === 'water' && availableDomainCategories().length > 0;
    bar.hidden = !on; if (!on) return;
    const total = waterTotalForDate(todayISO());
    const goal = state.water.goalMl;
    bar.innerHTML = todayBarHtml(fmtVolume(total), goal ? fmtVolume(goal) : '', 'today',
      goal ? (total / goal) * 100 : null, false, 'waterGoalLinkBtn', goal ? 'Edit goal' : 'Set a goal');
    document.getElementById('waterGoalLinkBtn').addEventListener('click', () => openManageCategory('water'));
  }

  function renderTodayBars() { renderFoodTodayBar(); renderWaterTodayBar(); }

  function renderSavedFoodLogList() {
    const wrap = document.getElementById('savedFoodsWrap');
    const list = document.getElementById('savedFoodLogList');
    const foods = state.food.savedFoods;
    wrap.hidden = foods.length === 0 || logCategory !== 'food';
    if (!foods.length) { list.innerHTML = ''; return; }

    const lastUsed = savedFoodLastUsedMap();
    const q = foodLog.query.trim().toLowerCase();
    const favs = foods.filter((f) => f.favorite);
    const recent = foods.filter((f) => lastUsed[f.id]).sort((a, b) => lastUsed[b.id].localeCompare(lastUsed[a.id]));
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (!foodLog.seg) foodLog.seg = favs.length ? 'fav' : recent.length ? 'recent' : 'all';
    const searching = !!q;
    const seg = searching ? 'all' : foodLog.seg;
    document.getElementById('foodSeg').innerHTML = segHtml([['fav', 'Favorites'], ['recent', 'Recent'], ['all', `All ${foods.length}`]], seg);

    let base = seg === 'fav' ? favs : seg === 'recent' ? recent : foods.slice().sort(byName);
    if (searching) base = foods.filter((f) => f.name.toLowerCase().includes(q)).sort(byName);

    const counts = {};
    base.forEach((f) => { const c = f.category || 'other'; counts[c] = (counts[c] || 0) + 1; });
    if (foodLog.cat !== 'all' && !counts[foodLog.cat]) foodLog.cat = 'all';
    setChips(document.getElementById('savedFoodCategorySegmented'),
      chipHtml('all', 'All', null, foodLog.cat === 'all') +
      SAVED_FOOD_CATEGORIES.filter((c) => counts[c.value]).map((c) => chipHtml(c.value, SAVED_FOOD_CHIP_LABELS[c.value], counts[c.value], foodLog.cat === c.value)).join(''));

    const filtered = foodLog.cat === 'all' ? base : base.filter((f) => (f.category || 'other') === foodLog.cat);
    const limited = !searching && foodLog.cat === 'all' && !foodLog.showAll && filtered.length > FOOD_LIST_LIMIT;
    const shown = limited ? filtered.slice(0, FOOD_LIST_LIMIT) : filtered;
    const more = document.getElementById('foodShowAll');
    more.hidden = !limited;
    if (limited) more.innerHTML = `${seg === 'fav' ? 'Show all favorites' : seg === 'recent' ? 'Show all recent' : `Show all ${filtered.length}`} ${uiIcon('chevron-right')}`;

    if (!shown.length) {
      list.innerHTML = `<p class="muted-text org-empty">${searching ? `No saved foods match “${escapeHtml(foodLog.query.trim())}”.`
        : seg === 'fav' ? 'No favorites yet — tap the ☆ on a saved food to pin it here.'
        : seg === 'recent' ? 'Nothing logged from a saved food yet.' : 'No saved foods in this category.'}</p>`;
      return;
    }
    list.innerHTML = shown.map((food) => {
      const expanded = expandedSavedFoodId === food.id;
      return `
        <div class="entry-row saved-food-log-row" data-saved-food-id="${food.id}" role="button" tabindex="0">
          ${savedFoodIconHtml(food, true)}
          <div class="entry-row-main">
            <div class="entry-row-title">${escapeHtml(food.name)}</div>
            <div class="entry-row-sub num">${compactFoodLine(food)}</div>
          </div>
          <button type="button" class="add-btn" data-quick-add="${food.id}" aria-label="Add one serving of ${escapeHtml(food.name)}">${uiIcon('plus')}</button>
        </div>
        ${expanded ? `
        <div class="card form-card saved-food-qty-card">
          <div class="field"><span class="field-label qty-label"><span>Servings${food.serving ? ` <span class="muted-text">(1 = ${escapeHtml(food.serving)})</span>` : ''}</span>${starButtonHtml('data-fav', food.id, food.favorite)}</span>
            <div class="stepper" id="savedFoodStepper" role="group" aria-label="Servings">
              <button type="button" class="stepper-btn" data-step="-1" aria-label="Fewer servings">${uiIcon('minus')}</button>
              <input type="number" inputmode="decimal" step="0.25" min="0.25" id="savedFoodCustomQty" value="${savedFoodQty}" aria-label="Servings" />
              <button type="button" class="stepper-btn" data-step="1" aria-label="More servings">${uiIcon('plus')}</button>
            </div></div>
          <label class="field"><span class="field-label">Date</span>
            <input type="date" id="savedFoodDate" value="${savedFoodDate || todayISO()}" /></label>
          <p class="muted-text field-hint">Logs: ${macroSummaryText(scaledSavedFoodValues(food, savedFoodQty))}</p>
          <button type="button" class="btn btn-primary btn-block" id="logSavedFoodBtn">Log it</button>
        </div>` : ''}`;
    }).join('');
    const stepper = document.getElementById('savedFoodStepper');
    if (stepper) {
      stepper.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => {
        const next = Math.round((savedFoodQty + Number(btn.dataset.step) * 0.25) * 100) / 100;
        savedFoodQty = Math.min(99, Math.max(0.25, next));
        renderSavedFoodLogList();
      }));
      const customInput = document.getElementById('savedFoodCustomQty');
      customInput.addEventListener('change', () => {
        const raw = parseFloat(customInput.value);
        if (!Number.isNaN(raw) && raw > 0) savedFoodQty = Math.min(99, raw);
        renderSavedFoodLogList();
      });
    }
    const dateInput = document.getElementById('savedFoodDate');
    if (dateInput) dateInput.addEventListener('input', () => { savedFoodDate = dateInput.value || null; });
    const logBtn = document.getElementById('logSavedFoodBtn');
    if (logBtn) logBtn.addEventListener('click', () => logSavedFood(expandedSavedFoodId, savedFoodQty));
  }

  // `date` is given by one-tap quick-add (always today); the expanded row's Log button omits it
  // and uses that row's date picker.
  function logSavedFood(foodId, qty, date) {
    const food = savedFoodById(foodId);
    if (!food) return;
    const values = scaledSavedFoodValues(food, qty);
    const dateEl = document.getElementById('savedFoodDate');
    date = date || (dateEl && dateEl.value) || savedFoodDate || todayISO();
    state.food.entries.push({ id: genId('food'), date, ...values, note: food.name, savedFoodId: food.id });
    if (!save()) return;
    toast(`${food.name} logged`);
    expandedSavedFoodId = null;
    savedFoodQty = 1;
    savedFoodDate = null;
    renderSavedFoodLogList();
    renderSavedFoodManageList();
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  function wireFoodLog() {
    const chips = document.getElementById('savedFoodCategorySegmented');
    wireFScroll(chips);
    const reset = () => { expandedSavedFoodId = null; savedFoodQty = 1; };
    document.getElementById('foodSeg').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-seg]');
      if (!b) return;
      foodLog.seg = b.dataset.seg; foodLog.cat = 'all'; foodLog.showAll = false; foodLog.query = '';
      document.getElementById('foodSearch').value = '';
      reset(); renderSavedFoodLogList();
    });
    document.getElementById('foodSearch').addEventListener('input', (ev) => {
      foodLog.query = ev.target.value; foodLog.cat = 'all';
      reset(); renderSavedFoodLogList();
    });
    chips.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      foodLog.cat = b.dataset.chip;
      reset(); renderSavedFoodLogList();
    });
    const list = document.getElementById('savedFoodLogList');
    const pick = (ev) => {
      const star = ev.target.closest('[data-fav]');
      if (star) { ev.stopPropagation(); toggleSavedFoodFavorite(star.dataset.fav); return; }
      const quick = ev.target.closest('[data-quick-add]');
      if (quick) { ev.stopPropagation(); logSavedFood(quick.dataset.quickAdd, 1, todayISO()); return; }
      const row = ev.target.closest('.saved-food-log-row');
      if (!row) return;
      const id = row.dataset.savedFoodId;
      expandedSavedFoodId = expandedSavedFoodId === id ? null : id;
      savedFoodQty = 1;
      renderSavedFoodLogList();
    };
    list.addEventListener('click', pick);
    list.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('saved-food-log-row')) { ev.preventDefault(); pick(ev); }
    });
    document.getElementById('foodShowAll').addEventListener('click', () => { foodLog.showAll = true; renderSavedFoodLogList(); });
    document.getElementById('logFoodManualBtn').addEventListener('click', () => { foodLog.manualOpen = !foodLog.manualOpen; renderLogView(); });
    document.getElementById('logFoodCreateBtn').addEventListener('click', () => openSavedFoodForm(null));
  }

  /* ---------- Manage -> Food: saved foods ---------- */

  const foodManage = { query: '', filter: 'all', sort: 'recent', showAll: false };

  function savedFoodRowHtml(food) {
    return `
      <div class="entry-row is-manage" data-saved-food-id="${food.id}">
        ${savedFoodIconHtml(food, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(food.name)}</div>
          <div class="entry-row-sub">${savedFoodCategoryLabel(food)}${food.serving ? ` · ${escapeHtml(food.serving)}` : ''} · ${macroSummaryText(food)}</div>
        </div>
        <div class="entry-row-actions">
          <button class="icon-btn" data-action="edit-saved-food" data-id="${food.id}" aria-label="Edit">${EDIT_ICON_SVG}</button>
        </div>
        ${starButtonHtml('data-fav', food.id, food.favorite)}
      </div>`;
  }

  function renderSavedFoodManageList() {
    const wrap = document.getElementById('savedFoodManageList');
    const foods = state.food.savedFoods;
    const tools = ['foodManageSearch', 'foodManageChips', 'foodSortLabel'].map((id) => document.getElementById(id).closest('.search, .f-scroll, .sortrow'));
    tools.forEach((el) => { el.hidden = foods.length === 0; });
    if (!foods.length) {
      wrap.innerHTML = '<p class="muted-text">No saved foods yet — research a food once, save it here, then log it in one tap from Log &rarr; Food.</p>';
      return;
    }
    const q = foodManage.query.trim().toLowerCase();
    const queried = q ? foods.filter((f) => f.name.toLowerCase().includes(q) || savedFoodCategoryLabel(f).toLowerCase().includes(q)) : foods;
    const favCount = queried.filter((f) => f.favorite).length;
    const counts = {};
    queried.forEach((f) => { const c = f.category || 'other'; counts[c] = (counts[c] || 0) + 1; });
    if ((foodManage.filter === 'fav' && !favCount) || (foodManage.filter !== 'all' && foodManage.filter !== 'fav' && !counts[foodManage.filter])) foodManage.filter = 'all';
    setChips(document.getElementById('foodManageChips'),
      chipHtml('all', 'All', queried.length, foodManage.filter === 'all') +
      (favCount ? chipHtml('fav', '★ Favorites', favCount, foodManage.filter === 'fav') : '') +
      SAVED_FOOD_CATEGORIES.filter((c) => counts[c.value]).map((c) => chipHtml(c.value, SAVED_FOOD_CHIP_LABELS[c.value], counts[c.value], foodManage.filter === c.value)).join(''));

    let visible = queried.filter((f) => foodManage.filter === 'all' || (foodManage.filter === 'fav' ? f.favorite : (f.category || 'other') === foodManage.filter));
    const lastUsed = savedFoodLastUsedMap();
    visible = visible.slice().sort((a, b) => {
      if (foodManage.sort === 'recent') {
        const ka = lastUsed[a.id] || '', kb = lastUsed[b.id] || '';
        if (ka !== kb) return kb.localeCompare(ka);
      }
      return a.name.localeCompare(b.name);
    });
    document.getElementById('foodSortLabel').innerHTML = `Sorted by <b>${foodManage.sort === 'recent' ? 'Recently used' : 'A–Z'}</b>`;

    const filtering = !!q || foodManage.filter !== 'all';
    const limited = !filtering && !foodManage.showAll && visible.length > FOOD_LIST_LIMIT;
    const shown = limited ? visible.slice(0, FOOD_LIST_LIMIT) : visible;
    wrap.innerHTML = `<div class="card org-card flush">${shown.length
      ? `<div class="g-list">${shown.map(savedFoodRowHtml).join('')}</div>`
      : '<p class="muted-text org-empty">No saved foods match.</p>'}
      ${limited ? `<button type="button" class="showall" id="foodManageShowAll">Show all ${visible.length} ${uiIcon('chevron-right')}</button>` : ''}</div>`;
  }

  function wireManageFood() {
    wireFScroll(document.getElementById('foodManageChips'));
    document.getElementById('foodManageSearch').addEventListener('input', (ev) => { foodManage.query = ev.target.value; renderSavedFoodManageList(); });
    document.getElementById('foodManageChips').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      foodManage.filter = b.dataset.chip;
      renderSavedFoodManageList();
    });
    document.getElementById('foodSortBtn').addEventListener('click', () => {
      foodManage.sort = foodManage.sort === 'recent' ? 'az' : 'recent';
      renderSavedFoodManageList();
    });
    document.getElementById('savedFoodManageList').addEventListener('click', (ev) => {
      const star = ev.target.closest('[data-fav]');
      if (star) { toggleSavedFoodFavorite(star.dataset.fav); return; }
      const edit = ev.target.closest('[data-action="edit-saved-food"]');
      if (edit) { openSavedFoodForm(edit.dataset.id); return; }
      if (ev.target.closest('#foodManageShowAll')) { foodManage.showAll = true; renderSavedFoodManageList(); }
    });
  }

  function handleLogSubmit(ev) {
    ev.preventDefault();
    const select = document.getElementById('logExercise');
    const ex = exerciseById(select.value);
    if (!ex) { toast('Pick an exercise first.'); return; }
    if (ex.kind === 'habit') return;
    const fields = readDynamicFields(document.getElementById('logDynamicFields'), ex);
    if (fields && fields.error) { toast(fields.error); return; }
    if (!fields) { toast('Enter at least one value before saving.'); return; }
    const date = readDate('logDate', todayISO());
    if (!date) return;
    const note = document.getElementById('logNote').value.trim();
    const entry = Object.assign({ id: genId('en'), exerciseId: ex.id, date, note: note || null }, fields);
    state.entries.push(entry);
    if (!save()) return;
    toast('Entry saved');
    document.getElementById('logNote').value = '';
    renderDynamicFields(document.getElementById('logDynamicFields'), ex);
    renderLogExerciseHead();
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  /* ============================== Rendering: History ============================== */

  // A month calendar above the entry list, with a dot per category active that day
  // (colors in `.cal-dot-*` in styles.css): workout, water goal met, body
  // measurement, food. Tapping a day filters "All entries" (within the active
  // domain tab) to that day; tapping it again clears the filter.

  let calendarMonth = (() => { const d = new Date(); d.setDate(1); return d; })();

  // Date filter for the "All entries" list; null shows everything. Starts as today.
  let historySelectedDate = todayISO();

  function dayActivity(dateIso) {
    // A domain switched off in Manage shows no dot.
    const workout = domainTracked('workout') && state.entries.some((e) => e.date === dateIso);
    const body = domainTracked('measurements') && state.measurements.some((m) => m.date === dateIso);
    const waterHit = domainTracked('water') && !!(state.water.goalMl && waterTotalForDate(dateIso) >= state.water.goalMl);
    const food = domainTracked('food') && state.food.entries.some((e) => e.date === dateIso);
    return { workout, body, waterHit, food };
  }

  function renderHistoryCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    document.getElementById('calMonthLabel').textContent = calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayIso = todayISO();

    let html = '';
    for (let i = 0; i < firstWeekday; i++) html += `<button type="button" class="calendar-day" disabled></button>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const { workout, body, waterHit, food } = dayActivity(dateIso);
      const dots = [
        workout ? '<span class="cal-dot cal-dot-workout"></span>' : '',
        waterHit ? '<span class="cal-dot cal-dot-water"></span>' : '',
        body ? '<span class="cal-dot cal-dot-body"></span>' : '',
        food ? '<span class="cal-dot cal-dot-food"></span>' : '',
      ].join('');
      html += `
        <button type="button" class="calendar-day ${dateIso === todayIso ? 'is-today' : ''} ${dateIso === historySelectedDate ? 'is-selected' : ''}" data-date="${dateIso}" aria-pressed="${dateIso === historySelectedDate}">
          <span>${day}</span>
          <span class="calendar-day-dots">${dots}</span>
        </button>`;
    }
    document.getElementById('calendarGrid').innerHTML = html;
    document.querySelectorAll('#calendarGrid .calendar-day[data-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const date = btn.dataset.date;
        historySelectedDate = historySelectedDate === date ? null : date;
        renderHistory();
      });
    });
  }

  function renderHistoryFilter() {
    const select = document.getElementById('historyFilter');
    const prev = select.value;
    const groups = groupBySection(state.exercises);
    let html = `<option value="__all__">All exercises</option>`;
    ['goal', 'daily', 'accessory'].forEach((sec) => {
      if (!groups[sec].length) return;
      html += `<optgroup label="${SECTION_LABELS[sec]}">` +
        groups[sec].map((ex) => `<option value="${ex.id}">${exerciseLabelHtml(ex)}${ex.archived ? ' (archived)' : ''}</option>`).join('') +
        `</optgroup>`;
    });
    select.innerHTML = html;
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
  }

  let historyCategory = 'workout';

  function renderHistoryCategorySegmented() {
    const cats = availableDomainCategories();
    if (cats.length && !cats.some((c) => c.id === historyCategory)) historyCategory = cats[0].id;
    const seg = document.getElementById('historyCategorySegmented');
    seg.innerHTML = domainTabsHtml(cats, historyCategory);
    seg.hidden = cats.length < 2;
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { historyCategory = b.dataset.domainCat; renderHistory(); });
    });
    document.getElementById('historyFilterField').hidden = historyCategory !== 'workout' || !cats.length;
  }

  // Heading for the list: "All entries", "Today", or the selected date.
  function historyListHeadingText() {
    if (!historySelectedDate) return 'All entries';
    if (historySelectedDate === todayISO()) return 'Today';
    return new Date(historySelectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Set #historyEmpty's visibility and wording; an empty selected day reads
  // differently from an empty history.
  function setHistoryEmpty(isEmpty) {
    document.getElementById('historyEmpty').hidden = !isEmpty;
    if (!isEmpty) return;
    const textEl = document.getElementById('historyEmptyText');
    if (textEl) textEl.textContent = historySelectedDate ? `Nothing logged for ${historyListHeadingText().toLowerCase() === 'today' ? 'today' : 'this day'}.` : 'No entries logged yet.';
  }

  function renderHistory() {
    renderHistoryCalendar();
    renderHistoryCategorySegmented();
    const headingEl = document.getElementById('historyListHeading');
    if (headingEl) headingEl.textContent = historyListHeadingText();
    const wrap = document.getElementById('historyList');
    const cats = availableDomainCategories();

    if (!cats.length) {
      document.getElementById('historyEmpty').hidden = false;
      wrap.innerHTML = '';
      return;
    }
    if (historyCategory === 'measurements') {
      const list = state.measurements
        .filter((m) => !historySelectedDate || m.date === historySelectedDate)
        .slice()
        .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      setHistoryEmpty(list.length === 0);
      wrap.innerHTML = list.map((m) => measurementRowHtml(m)).join('');
      wireMeasurementRowClicks(wrap);
      return;
    }
    if (historyCategory === 'water') {
      const list = state.waterEntries
        .filter((e) => !historySelectedDate || e.date === historySelectedDate)
        .slice()
        .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      setHistoryEmpty(list.length === 0);
      wrap.innerHTML = list.map((e) => waterEntryRowHtml(e)).join('');
      wireWaterEntryRowClicks(wrap);
      return;
    }
    if (historyCategory === 'food') {
      // Grouped by date with each day's totals as the header; a selected calendar day
      // shows only its own group.
      const relevantEntries = state.food.entries.filter((e) => !historySelectedDate || e.date === historySelectedDate);
      setHistoryEmpty(relevantEntries.length === 0);
      const byDate = {};
      relevantEntries.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
      const dates = Object.keys(byDate).sort().reverse();
      wrap.innerHTML = dates.map((date) => {
        const dayEntries = byDate[date].sort((a, b) => b.id.localeCompare(a.id));
        return `<div class="manage-group-label">${fmtDateShort(date)} — ${macroSummaryText(foodTotalsForDate(date))}</div>` +
          dayEntries.map(foodEntryRowHtml).join('');
      }).join('');
      wireFoodEntryRowClicks(wrap);
      return;
    }

    renderHistoryFilter();
    const filter = document.getElementById('historyFilter').value || '__all__';
    const list = state.entries
      .filter((e) => filter === '__all__' || e.exerciseId === filter)
      .filter((e) => !historySelectedDate || e.date === historySelectedDate)
      .slice()
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    setHistoryEmpty(list.length === 0);
    wrap.innerHTML = list.map((e) => entryRowHtml(e)).join('');
    wireEntryRowClicks(wrap);
  }

  /* ============================== Entry modal (edit/delete) ============================== */

  function openEntryModal(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const ex = exerciseById(entry.exerciseId);
    openModal(`
      <div class="modal-title-row"><h2>Edit entry</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text modal-subtitle">${escapeHtml(ex ? exerciseLabel(ex) : 'Deleted exercise')}</p>
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
      if (fields && fields.error) { toast(fields.error); return; }
      if (!fields) { toast('Enter at least one value.'); return; }
      const newDate = readDate('editEntryDate', entry.date);
      if (!newDate) return;
      entry.date = newDate;
      entry.note = document.getElementById('editEntryNote').value.trim() || null;
      Object.assign(entry, fields);
      if (!save()) return;
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.entries = state.entries.filter((e) => e.id !== entryId);
        if (!save()) return;
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  // The detail modal's "Log entry" button: opens Log with this exercise selected,
  // dispatching a real 'change' event so the dropdown's own handler runs.
  function logExerciseFromDetail(exId) {
    closeModal();
    openLogFor(exId);
  }
  function openLogFor(exId) {
    logCategory = 'workout';
    switchTab('log');
    const select = document.getElementById('logExercise');
    select.value = exId;
    logEx.pickerOpen = false;
    select.dispatchEvent(new Event('change'));
  }
  function logTrackerFromDetail(trackerId) {
    closeModal();
    logCategory = 'measurements';
    switchTab('log');
    const select = document.getElementById('logTracker');
    select.value = trackerId;
    select.dispatchEvent(new Event('change'));
  }

  /* ============================== Exercise detail modal ============================== */

  // A habit's detail: today's count, how often the target was met lately, and its
  // entries. There is no trend chart: there is nothing to measure but "done".
  function renderHabitDetail(ex) {
    const goal = ex.goal || 1;
    const entries = entriesFor(ex.id).slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    const perDay = {};
    entries.forEach((e) => { perDay[e.date] = (perDay[e.date] || 0) + 1; });
    let hit = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(todayISO() + 'T00:00:00');
      d.setDate(d.getDate() - i);
      if ((perDay[localDateISO(d)] || 0) >= goal) hit++;
    }
    openModal(`
      <div class="modal-title-row">
        <h2 class="title-with-icon">${exerciseIconHtml(ex)}${exerciseLabelHtml(ex)}</h2>
        <div class="modal-title-actions">
          <button class="icon-btn" id="editExerciseBtn" aria-label="Edit exercise">${EDIT_ICON_SVG}</button>
          <button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
      <div class="card">
        <div class="ex-card-badge badge-standalone">${kindBadge(ex)}${escapeHtml(exerciseGoalSummary(ex))}</div>
        ${habitPanelHtml(ex)}
        <p class="muted-text">Target met on ${hit} of the last 30 days.</p>
      </div>
      <div class="btn-row detail-actions">
        <button type="button" class="btn btn-primary" id="habitDoneBtn">Done</button>
        <button type="button" class="btn btn-secondary" id="editGoalFromDetailBtn">Edit goal</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="archiveExerciseBtn">${ex.archived ? 'Unarchive' : 'Archive'}</button>
      </div>
      <div class="section-head"><h2>All entries</h2></div>
      <div class="entry-list" id="exerciseEntryList">${entries.map((e) => entryRowHtml(e)).join('') || '<p class="muted-text">No entries yet.</p>'}</div>
    `, { tall: true });
    wireEntryRowClicks(document.getElementById('exerciseEntryList'));
    document.getElementById('editExerciseBtn').addEventListener('click', () => openExerciseForm(ex.id));
    document.getElementById('habitDoneBtn').addEventListener('click', () => logHabit(ex.id));
    document.getElementById('editGoalFromDetailBtn').addEventListener('click', () => editGoalShortcut(() => openExerciseForm(ex.id), 'goalFieldWrap'));
    document.getElementById('archiveExerciseBtn').addEventListener('click', () => {
      ex.archived = !ex.archived;
      if (!save()) return;
      closeModal();
      toast(ex.archived ? 'Exercise archived' : 'Exercise unarchived');
      renderAll();
    });
  }

  // `chartMetric` picks which goal the trend chart plots for a cardio exercise with
  // two goals; ignored otherwise.
  function renderExerciseDetail(exId, scale, chartMetric) {
    const ex = exerciseById(exId);
    if (!ex) return;
    if (ex.kind === 'habit') { renderHabitDetail(ex); return; }
    const cardioMetrics = ex.kind === 'cardio' ? cardioMetricsOf(ex) : null;
    const activeMetric = cardioMetrics ? (cardioMetrics.includes(chartMetric) ? chartMetric : cardioMetrics[0]) : undefined;

    const entries = entriesFor(exId).slice().sort((a, b) => a.date.localeCompare(b.date));
    const scaledEntries = scale === 'last10' ? entries.slice(-10) : entries;
    const chartPoints = scaledEntries.map((e) => ({ date: e.date, value: entryValue(ex, e, activeMetric) })).filter((p) => p.value != null);
    const chartGoal = cardioMetrics ? (activeMetric ? cardioGoalFor(ex, activeMetric) : null) : ex.goal;
    const suggestions = suggestNextTarget(ex);

    const progressHtml = cardioMetrics
      ? (cardioMetrics.length
          ? cardioMetrics.map((m) => progressBlockHtml(ex, m, { labeled: cardioMetrics.length > 1 })).join('')
          : '<p class="muted-text">No distance or pace goal set yet.</p>')
      : progressBlockHtml(ex);

    const standardsHtml = ex.kind === 'weight' && state.settings.showStrengthLevel ? strengthStandardsDetailHtml(ex)
      : ex.kind === 'cardio' && state.settings.showPaceLevel ? paceStandardsDetailHtml(ex)
      : '';

    openModal(`
      <div class="modal-title-row">
        <h2 class="title-with-icon">${exerciseIconHtml(ex)}${exerciseLabelHtml(ex)}</h2>
        <div class="modal-title-actions">
          <button class="icon-btn" id="editExerciseBtn" aria-label="Edit exercise">${EDIT_ICON_SVG}</button>
          <button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
      <!-- Wrapped in the same .card the dashboard's own goal card uses (see
           goalCardHtml()) rather than left as bare top-level modal content —
           without this, the badge and progress meter had no container of
           their own, so they picked up none of the spacing every other
           block in this modal gets from .modal-sheet's gap, and sat jammed
           against the suggestion card right below with zero space between. -->
      <div class="card">
        <div class="ex-card-badge badge-standalone">${kindBadge(ex)}</div>
        ${progressHtml}
      </div>

      <!-- Quick access to actually logging this exercise, right where a
           person lands after tapping in to check on it — rather than the
           old "Sessions logged / Lifetime total" tiles here, which just
           restated numbers already visible in the progress meter/chart
           below without offering anything to do. -->
      <div class="btn-row detail-actions">
        <button type="button" class="btn btn-primary" id="logEntryFromDetailBtn">Log entry</button>
        <button type="button" class="btn btn-secondary" id="editGoalFromDetailBtn">Edit goal</button>
      </div>

      <!-- Concise "at a glance" headline only — the detail sentence and the
           method note (and the well-researched general explanation) now
           live one tap away in openSuggestionInfoModal(), rather than
           always being visible here. A suggestion with nothing further to
           say (e.g. "Log a session to get a suggestion") isn't made
           tappable at all — see the wiring below. -->
      ${suggestions.map((sugg, i) => `
        <div class="card suggestion-card" data-sugg-idx="${i}">
          <div class="suggestion-label">Next session${sugg.metric ? ` · ${sugg.metric === 'pace' ? 'Pace' : 'Distance'}` : ''}</div>
          <div class="suggestion-headline">${escapeHtml(sugg.headline)}</div>
          ${sugg.detail || sugg.method ? `<div class="suggestion-tap-hint">Why? &rsaquo;</div>` : ''}
        </div>`).join('')}

      ${standardsHtml}

      <div class="section-head">
        <h2>Trend</h2>
        <div class="segmented" id="chartScaleSegmented" role="radiogroup" aria-label="Chart range">
          <button type="button" data-scale="last10" role="radio">Last 10</button>
          <button type="button" data-scale="all" role="radio">All time</button>
        </div>
      </div>
      ${cardioMetrics && cardioMetrics.length > 1 ? `
      <div class="segmented" id="chartMetricSegmented" role="radiogroup" aria-label="Chart metric">
        <button type="button" data-metric="distance" role="radio">Distance</button>
        <button type="button" data-metric="pace" role="radio">Pace</button>
      </div>` : ''}
      <div class="chart-wrap">${Charts.lineChart(chartPoints, { goal: chartGoal, formatValue: (v) => formatValueForExercise(ex, v, activeMetric) })}</div>

      <div class="btn-row">
        <button class="btn btn-secondary" id="archiveExerciseBtn">${ex.archived ? 'Unarchive' : 'Archive'}</button>
      </div>

      <div class="section-head"><h2>All entries</h2></div>
      <div class="entry-list" id="exerciseEntryList">${entries.slice().reverse().map((e) => entryRowHtml(e)).join('') || '<p class="muted-text">No entries yet.</p>'}</div>
    `, { tall: true });
    document.querySelectorAll('#chartScaleSegmented button').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.scale === scale));
      btn.addEventListener('click', () => renderExerciseDetail(exId, btn.dataset.scale, activeMetric));
    });
    const metricSeg = document.getElementById('chartMetricSegmented');
    if (metricSeg) {
      metricSeg.querySelectorAll('button').forEach((btn) => {
        btn.setAttribute('aria-checked', String(btn.dataset.metric === activeMetric));
        btn.addEventListener('click', () => renderExerciseDetail(exId, scale, btn.dataset.metric));
      });
    }
    wireEntryRowClicks(document.getElementById('exerciseEntryList'));
    document.querySelectorAll('.suggestion-card[data-sugg-idx]').forEach((card) => {
      const sugg = suggestions[Number(card.dataset.suggIdx)];
      if (!sugg || (!sugg.detail && !sugg.method)) return; // nothing further to show for a bare placeholder suggestion
      wireOpenable(card, () => openSuggestionInfoModal(exId, scale, activeMetric, sugg));
    });
    document.getElementById('editExerciseBtn').addEventListener('click', () => openExerciseForm(ex.id));
    document.getElementById('logEntryFromDetailBtn').addEventListener('click', () => logExerciseFromDetail(ex.id));
    document.getElementById('editGoalFromDetailBtn').addEventListener('click', () => editGoalShortcut(() => openExerciseForm(ex.id), 'goalFieldWrap'));
    document.getElementById('archiveExerciseBtn').addEventListener('click', () => {
      ex.archived = !ex.archived;
      if (!save()) return;
      closeModal();
      toast(ex.archived ? 'Exercise archived' : 'Exercise unarchived');
      renderAll();
    });
  }

  // Detail screens' "Edit goal" shortcut: opens the normal edit form and puts the cursor on the goal.
  function editGoalShortcut(openForm, wrapId) {
    openForm();
    const wrap = document.getElementById(wrapId);
    const target = wrap && wrap.querySelector('input, button');
    if (target) { wrap.scrollIntoView({ block: 'center' }); target.focus(); }
  }

  function openExerciseDetail(exId) {
    renderExerciseDetail(exId, state.settings.chartScale);
  }

  // The "Why?" screen for a suggestion: this suggestion's method note plus the
  // general progression logic (see suggestWeightOrReps()/suggestCardioMetric()).
  // The modal is one sheet with no stack, so Back re-renders the exercise detail.
  function openSuggestionInfoModal(exId, scale, activeMetric, sugg) {
    const ex = exerciseById(exId);
    openModal(`
      <button type="button" class="modal-back-link" data-action="back-to-exercise">${BACK_CHEVRON_ICON_SVG}${ex ? exerciseLabelHtml(ex) : 'Back'}</button>
      <div class="modal-title-row"><h2>Next session</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>

      ${sugg.detail || sugg.method ? `
        <div class="card suggestion-card">
          <div class="suggestion-label">This suggestion${sugg.metric ? ` · ${sugg.metric === 'pace' ? 'Pace' : 'Distance'}` : ''}</div>
          <div class="suggestion-headline">${escapeHtml(sugg.headline)}</div>
          ${sugg.detail ? `<div class="suggestion-detail">${escapeHtml(sugg.detail)}</div>` : ''}
          ${sugg.method ? `<div class="suggestion-method">${SUGGESTION_METHOD_NOTE[sugg.method]}</div>` : ''}
        </div>` : ''}

      <div class="section-head"><h2>How progression decisions work</h2></div>
      <div class="info-block">
        <p>Each suggestion comes from two signals in what you've logged: how hard your last top set or run felt (RPE, if you log it — 1 easy, 10 all-out) and how you trended at the same weight, reps, or pace from one session to the next.</p>
        <h3>When to increase weight (or reps, or pace)</h3>
        <p>An RPE of 6–6.5 or lower on your last top set means you likely had 3 or more reps left in the tank — the current load isn't challenging anymore, so a bigger jump is suggested. Around RPE 7, a smaller bump is reasonable instead. With no RPE logged, matching or beating your rep count at the same weight for two sessions in a row is also a reliable "ready to add load" signal — a simple form of double progression: build reps at a weight, then add load and let reps reset lower for the next cycle.</p>
        <h3>When to repeat</h3>
        <p>RPE 7.5–9 is a genuine, on-target working effort — the current load is doing its job. The suggestion is to hold there and squeeze out another rep or two before adding weight, rather than piling on load before you've actually consolidated at it.</p>
        <h3>When to back off (and aim for more reps instead)</h3>
        <p>An RPE of 9–10 — at or near failure — or reps/pace dropping two sessions in a row at the same load both point to fatigue outpacing recovery. The suggestion holds or trims the load slightly while nudging reps up: enough of a deload to protect the stimulus without digging a deeper hole.</p>
        <p class="muted-text">These are general heuristics — RPE/RIR-based autoregulation plus simple session-to-session trends — not personalized coaching. They don't know about a rough night's sleep, an old injury, or how the bar actually felt today. Treat them as a sensible default and adjust for how you're actually feeling. Logging an RPE after your top set or run is what unlocks the sharper version of this.</p>
      </div>
    `);
    document.querySelector('[data-action="back-to-exercise"]').addEventListener('click', () => renderExerciseDetail(exId, scale, activeMetric));
  }

  /* ============================== Add / edit exercise modal ============================== */

  function openExerciseForm(exId) {
    const editing = !!exId;
    const ex = editing ? exerciseById(exId) : null;
    const hasEntries = editing && entriesFor(exId).length > 0;
    const kind = ex ? ex.kind : 'weight';
    const section = ex ? sectionOf(ex) : 'goal';
    const bodyRegion = ex ? (ex.bodyRegion || 'upper') : 'upper';

    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit exercise' : 'Add exercise'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        ${nameIconHtml({ iconId: 'exIcon', inputId: 'exName', value: ex && ex.name, placeholder: 'e.g. Overhead Press', maxlength: 60 })}

        <div class="field">
          <span class="field-label">Muscle group</span>
          <div class="f-chips wrap" id="exGroupChips" role="radiogroup" aria-label="Muscle group">
            ${EXERCISE_GROUPS.map(([g, label]) => chipHtml(g, label, null, false)).join('')}
          </div>
        </div>

        <div class="card card-list"><div class="setting-row">
          <span>Favorite<span class="muted-text">Shows under Favorites and at the top of the exercise list</span></span>
          ${switchHtml('id="exFavorite"', 'Favorite', false)}
        </div></div>

        <div class="field">
          <span class="field-label">Section</span>
          <div class="segmented" id="exSectionSegmented" role="radiogroup">
            <button type="button" data-section="goal" role="radio">Goal</button>
            <button type="button" data-section="daily" role="radio">Daily target</button>
            <button type="button" data-section="accessory" role="radio">Other</button>
          </div>
          <span class="muted-text field-hint" id="sectionHint"></span>
        </div>

        <div class="field">
          <span class="field-label">Type${hasEntries ? ' (locked — has logged entries)' : ''}</span>
          <div class="option-list" id="exKindList" role="radiogroup">
            ${[['weight', 'Weighted lift', 'Sets, reps and weight'], ['reps', 'Bodyweight reps', 'Reps per session'], ['cardio', 'Cardio', 'Distance and time'], ['habit', 'Habit', 'Done N times a day']].map(([k, name, hint]) => `
            <button type="button" class="option-row" data-kind="${k}" role="radio" ${hasEntries && kind !== k ? 'disabled' : ''}>
              <span class="option-text"><span class="option-name">${name}</span><br><span class="option-hint">${hint}</span></span>
              <span class="option-radio"></span>
            </button>`).join('')}
          </div>
        </div>

        <div class="field" id="bodyRegionField" hidden>
          <span class="field-label">Move pattern <span class="muted-text">(sizes the suggested weight jump)</span></span>
          <div class="segmented" id="exBodyRegionSegmented" role="radiogroup">
            <button type="button" data-region="upper" role="radio">Upper body</button>
            <button type="button" data-region="lower" role="radio">Lower body</button>
          </div>
        </div>

        <div class="field" id="liftTypeField" hidden>
          <span class="field-label">Lift type <span class="muted-text">(for the optional "Strength level" insight in Settings — leave as None to skip it)</span></span>
          <div class="segmented" id="exLiftTypeSegmented" role="radiogroup">
            <button type="button" data-lift-type="" role="radio">None</button>
            <button type="button" data-lift-type="bench" role="radio">Bench</button>
            <button type="button" data-lift-type="squat" role="radio">Squat</button>
            <button type="button" data-lift-type="deadlift" role="radio">Deadlift</button>
          </div>
        </div>

        <div id="goalFieldWrap"></div>

        <button type="button" class="btn btn-primary btn-block" id="saveExerciseBtn">${editing ? 'Save changes' : 'Add exercise'}</button>
        ${editing ? `<button type="button" class="btn btn-secondary btn-block" id="archiveToggleBtn">${ex.archived ? 'Unarchive exercise' : 'Archive exercise'}</button>` : ''}
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteExerciseBtn">Delete exercise permanently</button>` : ''}
      </div>
    `);

    let selectedKind = kind;
    let selectedUnit = ex && ex.unit === 'time' ? 'time' : 'reps';
    let selectedSection = section;
    let selectedRegion = bodyRegion;
    let selectedLiftType = (ex && ex.liftType) || '';
    // Muscle group: the saved one, or inferred from the name for older exercises. A
    // new exercise follows its name/type until a chip is tapped.
    let selectedGroup = ex ? exerciseGroup(ex) : 'other';
    let groupTouched = !!ex;
    let selectedFavorite = ex ? isFavoriteExercise(ex) : false;
    const paintGroup = () => document.querySelectorAll('#exGroupChips .f-chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.chip === selectedGroup)));
    const followGroup = () => {
      if (groupTouched) return;
      selectedGroup = inferExerciseGroup({ name: document.getElementById('exName').value, kind: selectedKind });
      paintGroup();
    };
    document.querySelectorAll('#exGroupChips .f-chip').forEach((b) => b.addEventListener('click', () => { groupTouched = true; selectedGroup = b.dataset.chip; paintGroup(); }));
    document.getElementById('exName').addEventListener('input', followGroup);
    const favSwitch = document.getElementById('exFavorite');
    favSwitch.setAttribute('aria-checked', String(selectedFavorite));
    favSwitch.addEventListener('click', () => { selectedFavorite = !selectedFavorite; favSwitch.setAttribute('aria-checked', String(selectedFavorite)); });
    // Goal style for a weight exercise with a lift type: 'fixed' (typed number) or
    // 'standard' (bodyweight tier; see computeStandardGoal). Defaults to the saved
    // value, else 'fixed', so an existing goal is never overwritten silently.
    let selectedGoalMode = (ex && ex.goalMode) || 'fixed';
    let selectedGoalTier = (ex && ex.goalTier) || 'intermediate';
    let selectedTimes = (ex && ex.kind === 'habit' && ex.goal) || 1;
    let selectedRepeat = (ex && ex.repeat) || 'daily';
    const iconField = wireIconField('exIcon', () => EXERCISE_DEFAULT_ICON[selectedKind] || 'dumbbell', ex && ex.icon);

    const SECTION_HINTS = {
      goal: 'Shown on your home screen once logged today, with a full progress card in Progress.',
      daily: 'Something you’re aiming to do every day (push-ups, pull-ups, ...). Always shown in Daily targets on your home screen.',
      accessory: 'Hidden from your home screen. Still loggable and viewable in History — for accessory/other exercises.',
      habit: 'Habits are always daily targets.',
    };

    function setSectionUI(s) {
      selectedSection = s;
      const isHabit = selectedKind === 'habit';
      document.querySelectorAll('#exSectionSegmented button').forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.section === s));
        b.disabled = isHabit && b.dataset.section !== 'daily';
      });
      document.getElementById('sectionHint').textContent = isHabit ? SECTION_HINTS.habit : SECTION_HINTS[s];
    }
    function setRegionUI(r) {
      selectedRegion = r;
      document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.region === r)));
    }
    function setLiftTypeUI(t) {
      selectedLiftType = t;
      document.querySelectorAll('#exLiftTypeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.liftType === t)));
      // A standard goal needs a lift type (it picks the LIFT_STANDARDS table), so
      // clearing the type falls back to 'fixed'.
      if (!t) selectedGoalMode = 'fixed';
      if (selectedKind === 'weight' && document.getElementById('goalFieldWrap')) renderGoalField();
    }
    document.querySelectorAll('#exSectionSegmented button').forEach((b) => b.addEventListener('click', () => setSectionUI(b.dataset.section)));
    document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.addEventListener('click', () => setRegionUI(b.dataset.region)));
    document.querySelectorAll('#exLiftTypeSegmented button').forEach((b) => b.addEventListener('click', () => setLiftTypeUI(b.dataset.liftType)));
    setSectionUI(selectedSection);
    setRegionUI(selectedRegion);
    setLiftTypeUI(selectedLiftType);

    // The weight goal field: a plain number, or, with a lift type, a "Fixed number" /
    // "Bodyweight standard" toggle with the same Beginner..Elite preview as the wizard.
    function weightGoalFieldHtml() {
      const fixedVal = ex && ex.goal ? round(Units.lbToDisplay(ex.goal), 1) : '';
      if (!selectedLiftType || !LIFT_STANDARDS[selectedLiftType]) {
        return `<label class="field"><span class="field-label">Goal weight (${Units.weightUnitLabel()})</span><input type="number" step="any" id="goalInput" value="${fixedVal}"${canonAttr(ex && ex.goal)} placeholder="e.g. 225" /></label>`;
      }
      const bw = currentBodyWeightLb();
      const sex = state.profile.sex;
      const rows = standardGoalPreviewRows(selectedLiftType, bw, sex);
      const canUseStandards = !!rows;
      return `
        <div class="field">
          <span class="field-label">Goal style</span>
          <div class="segmented" id="exGoalModeSegmented" role="radiogroup" aria-label="Goal style">
            <button type="button" data-goal-mode="fixed" role="radio" aria-checked="${selectedGoalMode === 'fixed'}">Fixed number</button>
            <button type="button" data-goal-mode="standard" role="radio" aria-checked="${selectedGoalMode === 'standard'}" ${canUseStandards ? '' : 'disabled'}>Bodyweight standard</button>
          </div>
          ${!canUseStandards ? `<span class="muted-text field-hint">Log your body weight and set your sex in Settings → Profile to unlock bodyweight-standard goals.</span>` : ''}
        </div>
        ${selectedGoalMode === 'standard' && canUseStandards ? `
          <div class="field">
            <span class="field-label">Tier</span>
            <div class="segmented" id="exGoalTierSegmented" role="radiogroup" aria-label="Goal tier">
              ${['intermediate', 'advanced', 'elite'].map((t) => `<button type="button" data-tier-choice="${t}" role="radio" aria-checked="${selectedGoalTier === t}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join('')}
            </div>
          </div>
          <div class="standards-preview">
            ${rows.map((r) => `<div class="standards-preview-row${r.tierKey === selectedGoalTier ? ' is-selected' : ''}"><span>${r.label}</span><span>${fmtWeight(r.goalLb)}</span></div>`).join('')}
          </div>
          <p class="muted-text field-hint">This goal updates automatically whenever your logged body weight changes.</p>
        ` : `
          <label class="field"><span class="field-label">Goal weight (${Units.weightUnitLabel()})</span>
            <input type="number" step="any" id="goalInput" value="${fixedVal}"${canonAttr(ex && ex.goal)} placeholder="e.g. 225" /></label>
        `}`;
    }

    function wireWeightGoalField() {
      const modeSeg = document.getElementById('exGoalModeSegmented');
      if (modeSeg) modeSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        selectedGoalMode = b.dataset.goalMode;
        renderGoalField();
      }));
      const tierSeg = document.getElementById('exGoalTierSegmented');
      if (tierSeg) tierSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        selectedGoalTier = b.dataset.tierChoice;
        renderGoalField();
      }));
    }

    function renderGoalField() {
      const wrap = document.getElementById('goalFieldWrap');
      document.getElementById('bodyRegionField').hidden = selectedKind !== 'weight';
      document.getElementById('liftTypeField').hidden = selectedKind !== 'weight';
      if (selectedKind === 'weight') {
        wrap.innerHTML = weightGoalFieldHtml();
        wireWeightGoalField();
      } else if (selectedKind === 'habit') {
        wrap.innerHTML = `
          <div class="field"><span class="field-label">Times per day</span>
            <div class="segmented" id="exTimesSegmented" role="radiogroup">${[1, 2, 3].map((n) => `<button type="button" data-times="${n}" role="radio">${n}</button>`).join('')}</div></div>
          <div class="field"><span class="field-label">Repeats</span>
            <div class="segmented" id="exRepeatSegmented" role="radiogroup">${HABIT_REPEATS.map(([k, label]) => `<button type="button" data-repeat="${k}" role="radio">${label}</button>`).join('')}</div></div>`;
        const paint = () => {
          wrap.querySelectorAll('[data-times]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.times) === selectedTimes)));
          wrap.querySelectorAll('[data-repeat]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.repeat === selectedRepeat)));
        };
        wrap.querySelectorAll('[data-times]').forEach((b) => b.addEventListener('click', () => { selectedTimes = Number(b.dataset.times); paint(); }));
        wrap.querySelectorAll('[data-repeat]').forEach((b) => b.addEventListener('click', () => { selectedRepeat = b.dataset.repeat; paint(); }));
        paint();
      } else if (selectedKind === 'reps') {
        const v = ex && ex.goal ? ex.goal : '';
        const timed = selectedUnit === 'time';
        wrap.innerHTML = `
          <div class="field"><span class="field-label">Measured in${hasEntries ? ' (locked — has logged entries)' : ''}</span>
            <div class="segmented" id="exUnitSeg" role="radiogroup">
              <button type="button" role="radio" data-unit="reps" aria-checked="${!timed}" ${hasEntries ? 'disabled' : ''}>Reps</button>
              <button type="button" role="radio" data-unit="time" aria-checked="${timed}" ${hasEntries ? 'disabled' : ''}>Seconds held</button>
            </div></div>
          <label class="field"><span class="field-label">${timed ? 'Goal time (seconds, single set)' : 'Goal reps (single set)'}</span><input type="number" step="1" min="1" id="goalInput" value="${v}" placeholder="${timed ? 'e.g. 60' : 'e.g. 20'}" /></label>`;
        wrap.querySelectorAll('#exUnitSeg button').forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; selectedUnit = b.dataset.unit; renderGoalField(); }));
      } else {
        // Cardio has optional distance and pace goals, either or both: one run yields both.
        const distVal = ex && ex.distanceGoal ? round(Units.miToDisplay(ex.distanceGoal), 2) : '';
        // Round the total first: rounding only the seconds could produce 60 (5:59.7 -> 5:60).
        const secPerUnit = ex && ex.paceGoal ? Math.round(Units.secPerMiToDisplaySecPerUnit(ex.paceGoal)) : null;
        const mins = secPerUnit != null ? Math.floor(secPerUnit / 60) : '';
        const secs = secPerUnit != null ? secPerUnit % 60 : '';
        wrap.innerHTML = `
          <label class="field"><span class="field-label">Distance goal (${Units.distanceUnitLabel()}) <span class="muted-text">(optional)</span></span>
            <input type="number" step="any" id="goalDistanceInput" value="${distVal}"${canonAttr(ex && ex.distanceGoal)} placeholder="e.g. 5" /></label>
          <div class="field"><span class="field-label">Pace goal (min:sec per ${Units.distanceUnitLabel()}) <span class="muted-text">(optional)</span></span>
            <div class="inline-time-fields"><input type="number" step="1" min="0" id="goalPaceMin" value="${mins}"${canonAttr(ex && ex.paceGoal)} placeholder="min" /><input type="number" step="1" min="0" max="59" id="goalPaceSec" value="${secs}" placeholder="sec" /></div></div>
          <p class="field-hint muted-text">Leave either blank to skip that goal — one logged run updates progress toward both.</p>`;
      }
    }

    function setKindUI(k) {
      selectedKind = k;
      document.querySelectorAll('#exKindList .option-row').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
      setSectionUI(k === 'habit' ? 'daily' : selectedSection);
      iconField.refresh();
      renderGoalField();
      followGroup();
    }

    document.querySelectorAll('#exKindList .option-row').forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) setKindUI(b.dataset.kind); });
    });
    paintGroup();
    setKindUI(selectedKind);

    document.getElementById('saveExerciseBtn').addEventListener('click', () => {
      const name = document.getElementById('exName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      let goal = null;
      let distanceGoal = null;
      let paceGoal = null;
      let standardPending = false;
      const usingStandardGoal = selectedKind === 'weight' && selectedLiftType && LIFT_STANDARDS[selectedLiftType] && selectedGoalMode === 'standard';
      if (usingStandardGoal) {
        goal = computeStandardGoal(selectedLiftType, selectedGoalTier, currentBodyWeightLb(), state.profile.sex);
        // No body weight or sex yet: save anyway. The goal stays empty and fills in by itself
        // (recomputeStandardGoals) once both exist. Refusing to save left the user stuck.
        standardPending = goal == null;
      } else if (selectedKind === 'habit') {
        goal = selectedTimes;
      } else if (selectedKind === 'weight' || selectedKind === 'reps') {
        const raw = parseFloat(document.getElementById('goalInput').value);
        if (!Number.isNaN(raw) && raw > 0) {
          goal = selectedKind === 'weight' ? fieldCanon(document.getElementById('goalInput'), Units.displayToLb) : raw;
        }
      } else {
        // Cardio: read both optional goals independently; either, neither or both may be set.
        const rawDist = parseFloat(document.getElementById('goalDistanceInput').value);
        if (!Number.isNaN(rawDist) && rawDist > 0) distanceGoal = fieldCanon(document.getElementById('goalDistanceInput'), Units.displayToMi);
        const m = parseFloat(document.getElementById('goalPaceMin').value) || 0;
        const s = parseFloat(document.getElementById('goalPaceSec').value) || 0;
        if (m > 0 || s > 0) {
          const minEl = document.getElementById('goalPaceMin');
          const secEl = document.getElementById('goalPaceSec');
          const untouched = minEl.dataset.canon !== undefined && minEl.value === minEl.defaultValue && secEl.value === secEl.defaultValue;
          paceGoal = untouched ? Number(minEl.dataset.canon) : Units.displaySecPerUnitToSecPerMi(m * 60 + s);
        }
      }
      if (editing) {
        ex.name = name;
        ex.kind = selectedKind;
        ex.section = selectedSection;
        ex.group = selectedGroup;
        ex.favorite = selectedFavorite;
        if (selectedKind === 'weight') {
          ex.bodyRegion = selectedRegion; ex.liftType = selectedLiftType || null;
          ex.goalMode = usingStandardGoal ? 'standard' : 'fixed';
          ex.goalTier = usingStandardGoal ? selectedGoalTier : null;
        } else {
          delete ex.bodyRegion; ex.liftType = null; ex.goalMode = 'fixed'; ex.goalTier = null;
        }
        if (selectedKind === 'cardio') {
          ex.distanceGoal = distanceGoal;
          ex.paceGoal = paceGoal;
        }
        ex.goal = goal; // meaningful for weight/reps only; left null and unread for cardio
        if (selectedKind === 'reps' && selectedUnit === 'time') ex.unit = 'time'; else delete ex.unit;
        if (selectedKind === 'habit') ex.repeat = selectedRepeat; else delete ex.repeat;
        if (iconField.value()) ex.icon = iconField.value(); else delete ex.icon;
      } else {
        const newEx = { id: genId('ex'), name, kind: selectedKind, section: selectedSection, group: selectedGroup, favorite: selectedFavorite, goal, goalMode: 'fixed', goalTier: null, archived: false, createdAt: new Date().toISOString() };
        if (selectedKind === 'weight') {
          newEx.bodyRegion = selectedRegion; newEx.liftType = selectedLiftType || null;
          newEx.goalMode = usingStandardGoal ? 'standard' : 'fixed';
          newEx.goalTier = usingStandardGoal ? selectedGoalTier : null;
        }
        if (selectedKind === 'cardio') { newEx.distanceGoal = distanceGoal; newEx.paceGoal = paceGoal; }
        if (selectedKind === 'habit') newEx.repeat = selectedRepeat;
        if (selectedKind === 'reps' && selectedUnit === 'time') newEx.unit = 'time';
        if (iconField.value()) newEx.icon = iconField.value();
        state.exercises.push(newEx);
      }
      if (!save()) return;
      closeModal();
      toast(standardPending ? 'Saved. The goal appears once you log your body weight and set your sex in Settings.' : (editing ? 'Exercise updated' : 'Exercise added'));
      renderAll();
    });

    if (editing) {
      // Archiving hides an exercise reversibly and is always offered, as in the detail
      // modal. Permanent deletion is a separate, lower-emphasis action below it.
      document.getElementById('archiveToggleBtn').addEventListener('click', () => {
        ex.archived = !ex.archived;
        if (!save()) return;
        closeModal();
        toast(ex.archived ? 'Exercise archived' : 'Exercise unarchived');
        renderAll();
      });
      document.getElementById('deleteExerciseBtn').addEventListener('click', () => {
        const entryCount = entriesFor(exId).length;
        const body = entryCount
          ? `This permanently deletes "${ex.name}" and its ${entryCount} logged entr${entryCount === 1 ? 'y' : 'ies'}. This can't be undone.`
          : `This exercise has no logged entries. This can't be undone.`;
        confirmDialog('Delete exercise permanently?', body, 'Delete', () => {
          state.exercises = state.exercises.filter((e) => e.id !== exId);
          state.entries = state.entries.filter((e) => e.exerciseId !== exId);
          if (!save()) return;
          toast('Exercise deleted'); renderAll();
        }, true);
      });
    }
  }

  /* ============================== Tracker detail modal ============================== */

  function measurementRowHtml(m) {
    const tracker = trackerById(m.trackerId);
    const valueText = tracker ? fmtTrackerValue(tracker, m.value) : m.value;
    const qualityText = tracker && tracker.kind === 'sleep' && m.quality != null ? ` · Quality ${fmtQuality(m.quality)}` : '';
    return `
      <div class="entry-row" data-measurement-id="${m.id}">
        ${trackerIconHtml(tracker, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(tracker ? tracker.name : 'Deleted tracker')}</div>
          <div class="entry-row-sub">${escapeHtml(valueText)}${qualityText}${m.note ? ` — “${escapeHtml(m.note)}”` : ''}</div>
        </div>
        <div class="entry-row-date">${fmtDateShort(m.date)}</div>
      </div>`;
  }

  function wireMeasurementRowClicks(container) {
    container.querySelectorAll('.entry-row[data-measurement-id]').forEach((row) => {
      row.addEventListener('click', () => openMeasurementModal(row.getAttribute('data-measurement-id')));
    });
  }

  function openMeasurementModal(measurementId) {
    const m = state.measurements.find((x) => x.id === measurementId);
    if (!m) return;
    const tracker = trackerById(m.trackerId);
    const isSleep = tracker && tracker.kind === 'sleep';
    openModal(`
      <div class="modal-title-row"><h2>Edit entry</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text modal-subtitle">${escapeHtml(tracker ? tracker.name : 'Deleted tracker')}</p>
      <div class="form-card">
        <label class="field"><span class="field-label">Date</span><input type="date" id="editMeasurementDate" value="${m.date}" /></label>
        <label class="field"><span class="field-label">${isSleep ? 'Hours slept' : `Value${tracker ? ` (${trackerUnitLabel(tracker)})` : ''}`}</span>
          <input type="number" step="any" id="editMeasurementValue" value="${tracker ? trackerDisplayFromCanonical(tracker, m.value) : m.value}"${canonAttr(m.value)} /></label>
        ${isSleep ? `<div class="field"><span class="field-label">Sleep quality <span class="muted-text">(optional — tap again to clear)</span></span>
          ${qualityChipsHtml('editMeasurementQuality', m.quality != null ? m.quality : null)}</div>` : ''}
        <label class="field"><span class="field-label">Note</span><input type="text" id="editMeasurementNote" value="${m.note ? escapeHtml(m.note) : ''}" maxlength="200" /></label>
        <div class="btn-row"><button class="btn btn-primary btn-block" id="saveMeasurementBtn">Save changes</button></div>
        <button class="btn btn-danger btn-block" id="deleteMeasurementBtn">Delete entry</button>
      </div>
    `);
    wireChipPicker(document.getElementById('editMeasurementQuality'));
    document.getElementById('saveMeasurementBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('editMeasurementValue').value);
      if (Number.isNaN(raw)) { toast('Enter a value.'); return; }
      const newDate = readDate('editMeasurementDate', m.date);
      if (!newDate) return;
      const newValue = tracker ? fieldCanon(document.getElementById('editMeasurementValue'), (v) => trackerCanonicalFromDisplay(tracker, v)) : raw;
      const valueError = measurementError(tracker, newValue);
      if (valueError) { toast(valueError); return; }
      m.date = newDate;
      m.value = newValue;
      if (isSleep) m.quality = clampQuality(document.getElementById('editMeasurementQuality').dataset.value);
      m.note = document.getElementById('editMeasurementNote').value.trim() || null;
      if (m.trackerId === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
      if (!save()) return;
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteMeasurementBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.measurements = state.measurements.filter((x) => x.id !== measurementId);
        if (m.trackerId === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
        if (!save()) return;
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  // Like renderExerciseDetail but simpler: current value, goal, meter, trend chart
  // and entry list, with no suggestion or PR grid.
  function renderTrackerDetail(trackerId, scale) {
    const tracker = trackerById(trackerId);
    if (!tracker) return;
    const history = measurementsFor(trackerId).slice().sort((a, b) => a.date.localeCompare(b.date));
    const scaled = scale === 'last10' ? history.slice(-10) : history;
    const chartPoints = scaled.map((m) => ({ date: m.date, value: m.value }));
    const latest = latestMeasurement(trackerId);
    const value = latest ? latest.value : null;
    const { pct, achieved } = trackerProgressPct(tracker, value);

    const qualityLine = tracker.kind === 'sleep' && latest && latest.quality != null
      ? `<div class="insight-line">Last quality ${fmtQuality(latest.quality)}</div>` : '';
    // BMI (Weight) and the fuller sleep breakdown (Sleep) show here, gated by their
    // Settings -> Insights toggles.
    const insightDetailHtml = tracker.id === BODY_WEIGHT_TRACKER_ID && state.settings.showWeightInsights ? bmiDetailHtml()
      : tracker.kind === 'sleep' && state.settings.showSleepInsights ? sleepInsightDetailHtml()
      : '';
    openModal(`
      <div class="modal-title-row">
        <h2 class="title-with-icon">${trackerIconHtml(tracker)}${escapeHtml(tracker.name)}</h2>
        <div class="modal-title-actions">
          <button class="icon-btn" id="editTrackerBtn" aria-label="Edit tracker">${EDIT_ICON_SVG}</button>
          <button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
      <!-- Wrapped in a .card (matching the exercise detail modal's own fix
           and how a tracker's dashboard card already wraps this same
           content) rather than left as bare top-level modal content, which
           had no spacing of its own and sat jammed against whatever
           followed it. -->
      <div class="card">
        <div class="ex-card-values">
          <div class="ex-card-current">${fmtTrackerValue(tracker, value)}</div>
          ${tracker.goal != null ? `<div class="ex-card-goal">/ ${trackerGoalLabel(tracker).replace('Goal ', '')}</div>` : ''}
        </div>
        ${qualityLine}
        ${tracker.goal != null ? `<div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${Math.min(100, pct)}%"></div></div>
        <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}% to goal`}</span></div>
        ${!achieved && trackerProgressDeltaText(tracker, value) ? `<div class="insight-line muted-text">${trackerProgressDeltaText(tracker, value)}</div>` : ''}` : ''}
      </div>

      <!-- Quick access to logging this tracker, same as the exercise detail
           modal's own Log entry button — see logTrackerFromDetail(). -->
      <div class="btn-row detail-actions">
        <button type="button" class="btn btn-primary" id="logEntryFromDetailBtn">Log entry</button>
        <button type="button" class="btn btn-secondary" id="editGoalFromDetailBtn">Edit goal</button>
      </div>

      ${insightDetailHtml}

      <div class="section-head">
        <h2>Trend</h2>
        <div class="segmented" id="trkChartScaleSegmented" role="radiogroup" aria-label="Chart range">
          <button type="button" data-scale="last10" role="radio">Last 10</button>
          <button type="button" data-scale="all" role="radio">All time</button>
        </div>
      </div>
      <div class="chart-wrap">${Charts.lineChart(chartPoints, { goal: tracker.goal, formatValue: (v) => fmtTrackerValue(tracker, v) })}</div>

      <div class="btn-row">
        <button class="btn btn-secondary" id="archiveTrackerBtn">${tracker.archived ? 'Unarchive' : 'Archive'}</button>
      </div>

      <div class="section-head"><h2>All entries</h2></div>
      <div class="entry-list" id="trackerEntryList">${history.slice().reverse().map((m) => measurementRowHtml(m)).join('') || '<p class="muted-text">No entries yet.</p>'}</div>
    `, { tall: true });
    document.querySelectorAll('#trkChartScaleSegmented button').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.scale === scale));
      btn.addEventListener('click', () => renderTrackerDetail(trackerId, btn.dataset.scale));
    });
    wireMeasurementRowClicks(document.getElementById('trackerEntryList'));
    document.getElementById('editTrackerBtn').addEventListener('click', () => openTrackerForm(tracker.id));
    document.getElementById('logEntryFromDetailBtn').addEventListener('click', () => logTrackerFromDetail(tracker.id));
    document.getElementById('editGoalFromDetailBtn').addEventListener('click', () => editGoalShortcut(() => openTrackerForm(tracker.id), 'trkGoalFieldWrap'));
    document.getElementById('archiveTrackerBtn').addEventListener('click', () => {
      tracker.archived = !tracker.archived;
      if (!save()) return;
      closeModal();
      toast(tracker.archived ? 'Tracker archived' : 'Tracker unarchived');
      renderAll();
    });
  }

  function openTrackerDetail(trackerId) {
    renderTrackerDetail(trackerId, state.settings.chartScale);
  }

  /* ============================== Add / edit tracker modal ============================== */

  const UNIT_KIND_LABELS = { weight: 'Weight', length: 'Length', percent: 'Percent', hours: 'Hours', rating: 'Rating (1–5)', count: 'Custom number' };

  function unitLabelForKind(unitKind, ratingMax) {
    switch (unitKind) {
      case 'weight': return Units.weightUnitLabel();
      case 'length': return Units.lengthUnitLabel();
      case 'percent': return '%';
      case 'hours': return 'hr';
      case 'rating': return `/ ${ratingMax || 5}`;
      default: return '';
    }
  }

  function openTrackerForm(trackerId) {
    const editing = !!trackerId;
    const tracker = editing ? trackerById(trackerId) : null;
    const hasEntries = editing && measurementsFor(trackerId).length > 0;
    const unitKind = tracker ? tracker.unitKind : 'weight';
    const direction = tracker ? (tracker.direction || 'up') : 'up';
    // Sleep's value type is fixed (hours plus a quality rating come with
    // `kind: 'sleep'`), so the type is locked like an in-use tracker's.
    const isSleep = tracker && tracker.kind === 'sleep';
    const typeLocked = hasEntries || isSleep;

    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit tracker' : 'Add tracker'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        ${nameIconHtml({ iconId: 'trkIcon', inputId: 'trkName', value: tracker && tracker.name, placeholder: 'e.g. Waist, Protein, Resting Heart Rate', maxlength: 60 })}

        <div class="field">
          <span class="field-label">Value type${isSleep ? ' (fixed — Sleep also tracks quality)' : hasEntries ? ' (locked — has logged entries)' : ''}</span>
          <div class="segmented segmented-grid" id="trkUnitKindSegmented" role="radiogroup">
            ${['weight', 'length', 'percent', 'hours', 'rating', 'count'].map((k) => `<button type="button" data-unit-kind="${k}" role="radio" ${typeLocked && unitKind !== k ? 'disabled' : ''}>${UNIT_KIND_LABELS[k]}</button>`).join('')}
          </div>
        </div>

        <div class="field" id="trkUnitLabelField" hidden>
          <span class="field-label">Unit label <span class="muted-text">(optional, e.g. "kcal", "g", "steps")</span></span>
          <input type="text" id="trkUnitLabelInput" value="${tracker && tracker.unitLabel ? escapeHtml(tracker.unitLabel) : ''}" maxlength="20" />
        </div>

        <div id="trkGoalFieldWrap"></div>

        <div class="field">
          <span class="field-label">Direction <span class="muted-text">(which way is progress, if a goal is set)</span></span>
          <div class="segmented" id="trkDirectionSegmented" role="radiogroup">
            <button type="button" data-direction="up" role="radio">Higher is better</button>
            <button type="button" data-direction="down" role="radio">Lower is better</button>
          </div>
        </div>

        <div class="setting-row">
          <span>Show on dashboard <span class="muted-text">(hide trackers you don't need to see every day)</span></span>
          ${switchHtml('id="trkShowOnDashboardSwitch"', 'Show on dashboard', true)}
        </div>

        <button type="button" class="btn btn-primary btn-block" id="saveTrackerBtn">${editing ? 'Save changes' : 'Add tracker'}</button>
        ${editing ? `<button type="button" class="btn btn-secondary btn-block" id="archiveTrackerToggleBtn">${tracker.archived ? 'Unarchive tracker' : 'Archive tracker'}</button>` : ''}
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteTrackerBtn">Delete tracker permanently</button>` : ''}
      </div>
    `);

    let selectedUnitKind = unitKind;
    const iconField = wireIconField('trkIcon', () => trackerDefaultIcon({ kind: tracker && tracker.kind, unitKind: selectedUnitKind }), tracker && tracker.icon);
    let selectedDirection = direction;
    let selectedRatingMax = tracker && tracker.ratingMax ? tracker.ratingMax : 5;
    let selectedShowOnDashboard = tracker ? tracker.showOnDashboard !== false : true;

    function renderGoalField() {
      const wrap = document.getElementById('trkGoalFieldWrap');
      document.getElementById('trkUnitLabelField').hidden = selectedUnitKind !== 'count';
      const unitLabel = selectedUnitKind === 'count'
        ? escapeHtml(document.getElementById('trkUnitLabelInput').value.trim())
        : unitLabelForKind(selectedUnitKind, selectedRatingMax);
      // Only a goal in the tracker's own unit kind can be shown; after switching kind the
      // old number would be meaningless. Typing in the unit-label box re-renders this field,
      // so keep whatever the user has typed while the kind is unchanged.
      const stored = tracker && tracker.unitKind === selectedUnitKind && tracker.goal != null ? tracker.goal : null;
      const prev = document.getElementById('trkGoalInput');
      const keepTyped = !!prev && wrap.dataset.kind === selectedUnitKind;
      const untouched = !prev || prev.value === prev.defaultValue;
      const v = keepTyped ? prev.value : (stored != null ? trackerDisplayFromCanonical(tracker, stored) : '');
      const canon = stored != null && (!keepTyped || untouched) ? stored : null;
      wrap.dataset.kind = selectedUnitKind;
      wrap.innerHTML = `<label class="field"><span class="field-label">Goal ${unitLabel ? `(${unitLabel})` : ''} <span class="muted-text">(optional)</span></span>
        <input type="number" step="any" id="trkGoalInput" value="${v}"${canonAttr(canon)} placeholder="Leave blank to just track" /></label>`;
    }

    function setUnitKindUI(k) {
      selectedUnitKind = k;
      iconField.refresh();
      document.querySelectorAll('#trkUnitKindSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitKind === k)));
      renderGoalField();
    }
    function setDirectionUI(d) {
      selectedDirection = d;
      document.querySelectorAll('#trkDirectionSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.direction === d)));
    }
    function setShowOnDashboardUI(show) {
      selectedShowOnDashboard = show;
      document.getElementById('trkShowOnDashboardSwitch').setAttribute('aria-checked', String(show));
    }

    document.querySelectorAll('#trkUnitKindSegmented button').forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) setUnitKindUI(b.dataset.unitKind); });
    });
    document.querySelectorAll('#trkDirectionSegmented button').forEach((b) => b.addEventListener('click', () => setDirectionUI(b.dataset.direction)));
    document.getElementById('trkShowOnDashboardSwitch').addEventListener('click', () => setShowOnDashboardUI(!selectedShowOnDashboard));
    document.getElementById('trkUnitLabelField').querySelector('input').addEventListener('input', renderGoalField);
    setUnitKindUI(selectedUnitKind);
    setDirectionUI(selectedDirection);
    setShowOnDashboardUI(selectedShowOnDashboard);

    document.getElementById('saveTrackerBtn').addEventListener('click', () => {
      const name = document.getElementById('trkName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      const unitLabel = selectedUnitKind === 'count' ? (document.getElementById('trkUnitLabelInput').value.trim() || null) : null;
      const rawGoal = parseFloat(document.getElementById('trkGoalInput').value);
      const hasGoal = !Number.isNaN(rawGoal) && document.getElementById('trkGoalInput').value !== '';
      const fields = { unitKind: selectedUnitKind, unitLabel, ratingMax: selectedUnitKind === 'rating' ? selectedRatingMax : null, direction: selectedDirection, showOnDashboard: selectedShowOnDashboard, ...(iconField.value() && { icon: iconField.value() }) };
      const canonicalGoal = hasGoal ? fieldCanon(document.getElementById('trkGoalInput'), (v) => trackerCanonicalFromDisplay(Object.assign({}, tracker, fields), v)) : null;
      if (editing) {
        // A baseline is where progress toward THIS goal starts. A new goal number or
        // direction can leave the old baseline on the wrong side of the goal, so
        // recapture it from the latest value; removing the goal clears it.
        const prevGoal = tracker.goal;
        const prevDirection = tracker.direction || 'up';
        const goalOrDirectionChanged = canonicalGoal != null
          && (tracker.baseline == null || canonicalGoal !== prevGoal || fields.direction !== prevDirection);
        Object.assign(tracker, { name }, fields, { goal: canonicalGoal });
        if (!iconField.value()) delete tracker.icon;
        if (canonicalGoal == null) {
          tracker.baseline = null;
        } else if (goalOrDirectionChanged) {
          const latest = latestMeasurement(trackerId);
          tracker.baseline = latest ? latest.value : null;
        }
      } else {
        state.trackers.push(Object.assign({ id: genId('trk'), name, archived: false, kind: 'metric', baseline: null, createdAt: new Date().toISOString() }, fields, { goal: canonicalGoal }));
      }
      if (!save()) return;
      closeModal();
      toast(editing ? 'Tracker updated' : 'Tracker added');
      renderAll();
    });

    if (editing) {
      document.getElementById('archiveTrackerToggleBtn').addEventListener('click', () => {
        tracker.archived = !tracker.archived;
        if (!save()) return;
        closeModal();
        toast(tracker.archived ? 'Tracker archived' : 'Tracker unarchived');
        renderAll();
      });
      document.getElementById('deleteTrackerBtn').addEventListener('click', () => {
        const entryCount = measurementsFor(trackerId).length;
        const body = entryCount
          ? `This permanently deletes "${tracker.name}" and its ${entryCount} logged entr${entryCount === 1 ? 'y' : 'ies'}. This can't be undone.`
          : `This tracker has no logged entries. This can't be undone.`;
        confirmDialog('Delete tracker permanently?', body, 'Delete', () => {
          state.trackers = state.trackers.filter((t) => t.id !== trackerId);
          state.measurements = state.measurements.filter((m) => m.trackerId !== trackerId);
          if (!save()) return;
          toast('Tracker deleted'); renderAll();
        }, true);
      });
    }
  }

  /* ============================== Water: cup management ============================== */

  function cupRowHtml(cup) {
    return `
      <div class="entry-row is-manage" data-cup-id="${cup.id}">
        ${cupIconHtml(cup, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(cup.name)}</div>
          <div class="entry-row-sub">${fmtVolume(cup.amountMl)}</div>
        </div>
        <div class="entry-row-actions">
          <button class="icon-btn" data-action="edit-cup" data-id="${cup.id}" aria-label="Edit">${EDIT_ICON_SVG}</button>
        </div>
      </div>`;
  }

  function openCupForm(cupId) {
    const editing = !!cupId;
    const cup = editing ? cupById(cupId) : null;
    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit cup' : 'Add cup'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        ${nameIconHtml({ iconId: 'cupIcon', inputId: 'cupName', value: cup && cup.name, placeholder: 'e.g. Water bottle', maxlength: 40 })}
        <label class="field"><span class="field-label">Amount (${Units.volumeUnitLabel()})</span>
          <input type="number" step="any" min="0" id="cupAmount" value="${cup ? round(Units.mlToDisplay(cup.amountMl), 1) : ''}"${canonAttr(cup && cup.amountMl)} placeholder="e.g. 16" /></label>
        <button type="button" class="btn btn-primary btn-block" id="saveCupBtn">${editing ? 'Save changes' : 'Add cup'}</button>
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteCupBtn">Delete cup</button>` : ''}
      </div>
    `);
    const iconField = wireIconField('cupIcon', () => 'droplets', cup && cup.icon);
    document.getElementById('saveCupBtn').addEventListener('click', () => {
      const name = document.getElementById('cupName').value.trim();
      const raw = parseFloat(document.getElementById('cupAmount').value);
      if (!name) { toast('Give it a name.'); return; }
      if (Number.isNaN(raw) || raw <= 0) { toast('Enter an amount greater than zero.'); return; }
      const amountMl = fieldCanon(document.getElementById('cupAmount'), Units.displayToMl);
      if (tooBigWater(amountMl)) { toast(WATER_TOO_BIG); return; }
      if (editing) {
        cup.name = name;
        cup.amountMl = amountMl;
        if (iconField.value()) cup.icon = iconField.value(); else delete cup.icon;
      } else {
        state.water.cups.push({ id: genId('cup'), name, amountMl, ...(iconField.value() && { icon: iconField.value() }) });
      }
      if (!save()) return;
      closeModal();
      toast(editing ? 'Cup updated' : 'Cup added');
      renderManage();
      renderDashboard();
      renderLogForm();
    });
    if (editing) {
      document.getElementById('deleteCupBtn').addEventListener('click', () => {
        confirmDialog('Delete this cup?', 'This can’t be undone. Past water entries already logged aren’t affected.', 'Delete', () => {
          state.water.cups = state.water.cups.filter((c) => c.id !== cupId);
          if (!save()) return;
          toast('Cup deleted');
          renderManage();
          renderDashboard();
          renderLogForm();
        }, true);
      });
    }
  }

  /* ============================== Manage ==============================
     One tab with four domain panels (Workout, Body, Water, Food) switched by
     manageCategorySegmented. All four always show (ALL_DOMAIN_CATEGORIES), since this is
     where an off domain is turned back on. Each has a "Track this" switch
     (renderDomainTrackToggle()); Settings holds app-wide preferences only. */

  let manageCategory = 'workout';

  function setManageCategory(cat) {
    manageCategory = cat;
    const seg = document.getElementById('manageCategorySegmented');
    seg.innerHTML = domainTabsHtml(ALL_DOMAIN_CATEGORIES, manageCategory);
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => setManageCategory(b.dataset.domainCat));
    });
    document.getElementById('manageExercisesPanel').hidden = cat !== 'workout';
    document.getElementById('manageMeasurementsPanel').hidden = cat !== 'measurements';
    document.getElementById('manageWaterPanel').hidden = cat !== 'water';
    document.getElementById('manageFoodPanel').hidden = cat !== 'food';
  }

  // Shared "Track this" switch logic for the Manage panels: sets the switch, shows
  // or hides the off hint and the panel's `${id}TrackedFields`. Returns whether the
  // domain is tracked, so a panel can skip rebuilding hidden fields.
  function renderDomainTrackToggle(id) {
    const tracked = domainTracked(id);
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    syncSwitches();
    document.getElementById(`track${cap}OffHint`).hidden = tracked;
    document.getElementById(`${id}TrackedFields`).hidden = !tracked;
    return tracked;
  }

  // Nutrition calculator card (bottom of the Food panel). The activity options are
  // built once; the rest refreshes each render so the preview follows Profile and body weight.
  function renderNutritionCalcCard() {
    const select = document.getElementById('nutritionActivityLevel');
    if (!select.dataset.built) {
      select.innerHTML = Object.keys(ACTIVITY_LEVELS)
        .map((k) => `<option value="${k}">${ACTIVITY_LEVELS[k].label} — ${ACTIVITY_LEVELS[k].hint}</option>`)
        .join('');
      select.dataset.built = '1';
    }
    const calc = state.settings.nutritionCalc;
    document.querySelectorAll('#calorieModeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.calorieMode === calorieMode())));
    document.getElementById('nutritionCalcCard').hidden = !calc.enabled;
    document.getElementById('nutritionCalcFields').hidden = !calc.enabled;
    if (!calc.enabled) return;
    select.value = calc.activityLevel;
    document.querySelectorAll('#nutritionGoalSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.goalChoice === calc.goal)));

    const result = computeNutritionTargets(calc.activityLevel, calc.goal);
    const missingEl = document.getElementById('nutritionCalcMissing');
    const previewEl = document.getElementById('nutritionCalcPreview');
    const applyBtn = document.getElementById('applyNutritionCalcBtn');
    if (result.missing) {
      const list = result.missing.length > 1
        ? `${result.missing.slice(0, -1).join(', ')} and ${result.missing[result.missing.length - 1]}`
        : result.missing[0];
      missingEl.hidden = false;
      missingEl.textContent = `Set your ${list} (Settings → Profile, or log a body weight) to calculate this.`;
      previewEl.hidden = true;
      applyBtn.disabled = true;
    } else {
      missingEl.hidden = true;
      previewEl.hidden = false;
      document.getElementById('nutritionCalcCalories').textContent = `${result.calories}`;
      document.getElementById('nutritionCalcProtein').textContent = `${result.protein}g`;
      applyBtn.disabled = false;
    }
  }

  // Chip row for which non-calorie macros are tracked. Built once (wrap.dataset.built)
  // because MACRO_KEYS can grow; the goal lives in renderMacroGoalRows().
  function renderMacroTrackChips() {
    const wrap = document.getElementById('macroTrackChips');
    const keys = MACRO_KEYS.filter((k) => k !== 'calories');
    if (!wrap.dataset.built) {
      wrap.innerHTML = keys.map((k) => `<button type="button" class="chip-option" data-macro-chip="${k}" role="checkbox">${MACRO_LABELS[k]}</button>`).join('');
      wrap.dataset.built = '1';
      wrap.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-macro-chip]');
        if (!btn) return;
        const info = macroGoalInfo(btn.dataset.macroChip);
        info.enabled = !info.enabled;
        if (!save()) return;
        renderMacroTrackChips();
        renderMacroGoalRows();
        renderDashboard();
      });
    }
    keys.forEach((k) => {
      const tracked = macroTracked(k);
      const btn = wrap.querySelector(`[data-macro-chip="${k}"]`);
      btn.classList.toggle('is-active', tracked);
      btn.classList.toggle('is-toggled-off', !tracked);
      btn.setAttribute('aria-checked', String(tracked));
    });
  }

  // Daily-goal rows, one per MACRO_KEYS entry, shown for tracked macros (Calories
  // always). Built once so a re-render does not wipe a half-typed value; click and
  // change are delegated on the container.
  function renderMacroGoalRows() {
    const wrap = document.getElementById('macroGoalRows');
    if (!wrap.dataset.built) {
      wrap.innerHTML = MACRO_KEYS.map((k) => `
        <div class="setting-row" data-macro-goal-row="${k}">
          <span>${MACRO_LABELS[k]} <span class="muted-text" data-macro-hint="${k}"></span></span>
        </div>
        <label class="field" data-macro-goal-field="${k}" hidden>
          <span class="field-label">Daily goal (${MACRO_UNITS[k] || 'cal'})</span>
          <input type="number" step="any" min="0" data-macro-goal-input="${k}" />
        </label>`).join('');
      wrap.dataset.built = '1';
      wrap.addEventListener('click', (ev) => {
      });
      wrap.addEventListener('change', (ev) => {
        const input = ev.target.closest('[data-macro-goal-input]');
        if (!input) return;
        const k = input.dataset.macroGoalInput;
        const raw = parseFloat(input.value);
        macroGoalInfo(k).goal = (!Number.isNaN(raw) && raw > 0) ? raw : null;
        if (!save()) return;
        renderDashboard();
      });
    }
    MACRO_KEYS.forEach((k) => {
      const info = macroGoalInfo(k);
      const tracked = macroTracked(k);
      const row = wrap.querySelector(`[data-macro-goal-row="${k}"]`);
      if (row) row.hidden = k === 'calories' ? calorieMode() === 'none' : !tracked;
      const field = wrap.querySelector(`[data-macro-goal-field="${k}"]`);
      if (field) field.hidden = k === 'calories' ? calorieMode() === 'none' : !tracked;
      const input = wrap.querySelector(`[data-macro-goal-input="${k}"]`);
      if (input && document.activeElement !== input) input.value = info.goal != null ? info.goal : '';
      const hint = wrap.querySelector(`[data-macro-hint="${k}"]`);
      if (hint) {
        hint.textContent = k === 'calories'
          ? (info.enabled && info.goal != null ? `(goal: ${fmtMacroValue(k, info.goal)})` : '(type a number)')
          : (info.goal != null ? `(goal: ${fmtMacroValue(k, info.goal)})` : '(no goal set)');
      }
    });
  }

  function renderFoodManagePanel() {
    if (!renderDomainTrackToggle('food')) return;
    renderSavedFoodManageList();
    renderMacroTrackChips();
    renderMacroGoalRows();
    renderNutritionCalcCard();
  }

  function trackerManageRowHtml(tracker) {
    return `
      <div class="entry-row is-manage${tracker.archived ? ' is-toggled-off' : ''}" data-tracker-id="${tracker.id}">
        ${trackerIconHtml(tracker, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(tracker.name)} ${tracker.archived ? '<span class="chip chip-archived">archived</span>' : ''}${tracker.showOnDashboard === false ? '<span class="chip">hidden from dashboard</span>' : ''}</div>
          <div class="entry-row-sub">${UNIT_KIND_LABELS[tracker.unitKind] || ''}${tracker.goal != null ? ` · ${trackerGoalLabel(tracker)}` : ' · no goal set'}</div>
        </div>
        <div class="entry-row-actions">
          ${tracker.archived ? `<button class="btn btn-secondary btn-sm" data-action="unarchive-tracker" data-id="${tracker.id}">Unarchive</button>` : ''}
          <button class="icon-btn" data-action="edit-tracker" data-id="${tracker.id}" aria-label="Edit">${EDIT_ICON_SVG}</button>
        </div>
      </div>`;
  }

  function renderTrackerManageList() {
    if (!renderDomainTrackToggle('measurements')) return;
    const wrap = document.getElementById('trackerManageList');
    wrap.innerHTML = state.trackers.map(trackerManageRowHtml).join('') || '<p class="muted-text">No trackers yet — add one to start tracking anything you like.</p>';
    wrap.querySelectorAll('[data-action="edit-tracker"]').forEach((btn) => btn.addEventListener('click', () => openTrackerForm(btn.dataset.id)));
    wrap.querySelectorAll('[data-action="unarchive-tracker"]').forEach((btn) => btn.addEventListener('click', () => {
      const t = trackerById(btn.dataset.id);
      if (!t) return;
      t.archived = false;
      if (!save()) return;
      toast('Tracker unarchived');
      renderAll();
    }));
  }

  function renderWaterManagePanel() {
    if (!renderDomainTrackToggle('water')) return;
    document.getElementById('waterGoalUnitLabel').textContent = Units.volumeUnitLabel();
    // Same re-render-clobbers-an-unsaved-field guard as the Profile height
    // field above.
    if (document.activeElement !== document.getElementById('waterGoalInput')) {
      const goalInput = document.getElementById('waterGoalInput');
      goalInput.value = state.water.goalMl ? round(Units.mlToDisplay(state.water.goalMl), 1) : '';
      // See fieldCanon(): saving the untouched field must keep the stored millilitres.
      goalInput.defaultValue = goalInput.value;
      if (state.water.goalMl) goalInput.dataset.canon = state.water.goalMl; else delete goalInput.dataset.canon;
    }
    const wrap = document.getElementById('cupManageList');
    wrap.innerHTML = state.water.cups.map(cupRowHtml).join('') || '<p class="muted-text">No cups yet.</p>';
    wrap.querySelectorAll('[data-action="edit-cup"]').forEach((btn) => btn.addEventListener('click', () => openCupForm(btn.dataset.id)));
  }

  function renderManage() {
    setManageCategory(manageCategory);
    // One section failing must not blank the others.
    [renderExerciseManageList, renderTidyCard, renderTrackerManageList, renderWaterManagePanel, renderFoodManagePanel].forEach((fn) => {
      try { fn(); } catch (e) { console.error('Manage section failed:', fn.name, e); }
    });
  }

  /* ============================== Settings ============================== */

  // Settings flags driven by a plain on/off switch in index.html.
  const settingSwitches = {
    trackWorkoutSwitch: 'trackWorkout', trackMeasurementsSwitch: 'trackMeasurements',
    trackWaterSwitch: 'trackWater', trackFoodSwitch: 'trackFood', trackHabitsSwitch: 'trackHabits', trackCardioSwitch: 'trackCardio',
    showWeightInsightsSwitch: 'showWeightInsights', showStrengthLevelSwitch: 'showStrengthLevel',
    showPaceLevelSwitch: 'showPaceLevel', showSleepInsightsSwitch: 'showSleepInsights',
    showMacroGuidanceSwitch: 'showMacroGuidance',
  };
  // Home-block switches write into settings.homeSections rather than a flat key.
  const homeSwitches = {
    homeChecklistSwitch: 'checklist', homeTrainingSwitch: 'training', homeNutritionSwitch: 'nutrition',
    homeMiniSwitch: 'mini', homeGoalsSwitch: 'goals',
  };
  function syncSwitches() {
    Object.entries(settingSwitches).forEach(([id, key]) => document.getElementById(id).setAttribute('aria-checked', String(state.settings[key])));
    Object.entries(homeSwitches).forEach(([id, key]) => document.getElementById(id).setAttribute('aria-checked', String(homeSectionOn(key))));
  }

  function renderSettings() {
    syncSwitches();
    document.querySelectorAll('#themeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === state.settings.theme)));
    document.querySelectorAll('#weightUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.weightUnit)));
    document.querySelectorAll('#distanceUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.distanceUnit)));
    document.querySelectorAll('#lengthUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.lengthUnit)));
    document.querySelectorAll('#volumeUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.volumeUnit)));

    // Which height field shows follows the unit setting. The values are not synced
    // here: that would overwrite a height typed but not yet saved whenever another
    // Settings control re-renders this view (see syncProfileHeightInputs()).
    document.getElementById('profileHeightFieldCm').hidden = state.settings.lengthUnit !== 'cm';
    document.getElementById('profileHeightFieldFtIn').hidden = state.settings.lengthUnit === 'cm';
    document.querySelectorAll('#profileSexSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sexChoice === (state.profile.sex || ''))));

    document.querySelectorAll('#dashboardChartScaleSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scaleChoice === state.settings.chartScale)));
    document.querySelectorAll('#insightsWindowSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.windowChoice === String(state.settings.insightsWindowDays))));
  }

  // Settings > About the numbers: built from FitStandards.REFERENCES so the
  // screen and the maths cannot drift apart.
  function openReferencesModal() {
    const link = (r) => (r && r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.label)}</a>` : r ? escapeHtml(r.label) : '');
    const badge = (k) => `<span class="tag${k === 'reference' ? ' tag-good' : ''}">${k === 'reference' ? 'Published reference' : 'App assumption'}</span>`;
    openModal(`
      <div class="modal-title-row"><h2>About the numbers</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text">Fit Log estimates are general guides, not medical advice. A published reference comes from a named source. An app assumption is a sensible default the app chose.</p>
      ${S.REFERENCES.map((r) => `
        <div class="card ref-card">
          <div class="ref-head"><h3>${escapeHtml(r.title)}</h3>${badge(r.kind)}</div>
          <p>${escapeHtml(r.summary)}</p>
          ${r.caveat ? `<p class="muted-text">${escapeHtml(r.caveat)}</p>` : ''}
          ${r.source || r.alt ? `<p class="muted-text ref-src">Source: ${[link(r.source), link(r.alt)].filter(Boolean).join(' &middot; ')}</p>` : '<p class="muted-text ref-src">No single published source.</p>'}
        </div>`).join('')}
      <p class="muted-text">Standards version ${S.version}, reviewed ${S.reviewed}.</p>
    `, { tall: true });
  }

  /* ============================== Backup validation ==============================
     The checks live in js/backup.js (FitBackup.validate). Returns an error string or null. */
  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  function validateBackupShape(parsed) {
    return window.FitBackup.validate(parsed, { schemaVersion: SCHEMA_VERSION, macroKeys: MACRO_KEYS, todayIso: todayISO() });
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fit-log-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in Safari; give it a moment.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup downloaded');
  }

  // A real backup is well under a few MB; refuse absurd files before parsing them.
  const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  function importBackup(file) {
    if (file && file.size > MAX_IMPORT_BYTES) { toast('Can’t import: that file is too large to be a Fit Log backup.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Imported data is untrusted: check its shape in full before upgradeData() or state see it.
        const shapeError = validateBackupShape(parsed);
        if (shapeError) { toast(`Can't import: ${shapeError}`); return; }
        confirmDialog('Replace all data?', 'Importing will overwrite everything currently in the app with this backup file.', 'Import', () => {
          // Kept so a failed write below can restore the in-memory state.
          const previousState = state;
          // Same pipeline as load(): older backups are upgraded additively, not rejected.
          state = upgradeData(parsed);
          if (!save()) { state = previousState; return; }
          applyTheme();
          renderAll();
          toast('Backup imported');
        }, true);
      } catch (e) {
        toast('That file doesn’t look like a valid Fit Log backup.');
      }
    };
    reader.readAsText(file);
  }

  /* ============================== First-run setup wizard ==============================
     Shown once, only when there is no saved data (see load()). It builds a starting state like
     defaultData(), tailored to the answers; anything skipped can be added later in Manage or
     Settings. */

  // The step list is computed from the Interests answers (setupStepSequence()),
  // so `setupStepIndex` indexes whatever that sequence currently is. Turning an
  // interest off removes its step.
  let setupStepIndex = 0;
  let setupAnswers = {
    // What this install tracks (see renderSetupStepInterests). Lifting, Running,
    // Habits, Body weight and Water start on; Sleep and Food start off. Lifting also
    // decides whether the daily bodyweight exercises are seeded.
    interests: { lifting: true, running: true, habits: true, bodyweight: true, sleep: false, water: true, food: false },
    // Starter packs from the catalog; none are ticked by default.
    packs: {},
    // How the calorie target is set: 'calc' | 'manual' | 'none'.
    calorieMode: 'none', calorieManual: '', calorieGoal: 'maintain', commonFoods: true, macros: null,
    heightFt: '', heightIn: '', heightCm: '',
    weight: '', age: '', sex: '',
    lifts: {
      bench: { enabled: true, mode: 'plates', tier: 'intermediate' },
      squat: { enabled: true, mode: 'plates', tier: 'intermediate' },
      deadlift: { enabled: true, mode: 'plates', tier: 'intermediate' },
    },
    runningGoalType: 'pace',
    runningDistance: '5',
    runningPaceMin: '10',
    runningPaceSec: '0',
    waterGoal: '',
    weightGoalEnabled: false,
    weightGoalValue: '',
    // On by default, like DEFAULT_SETTINGS.showWeightInsights.
    insightsEnabled: true,
  };

  // Recomputed on every render. 'interests' and 'about' always come first; the rest
  // follow the Interests answers (changeable only at index 0). 'goals' is always
  // last, since the Insights toggle lives there.
  function setupStepSequence() {
    const seq = ['interests', 'about'];
    if (setupAnswers.interests.lifting) seq.push('lifting');
    if (setupAnswers.interests.running) seq.push('running');
    if (setupPacks().length) seq.push('packs');
    if (setupAnswers.interests.food) seq.push('food');
    seq.push('goals');
    return seq;
  }
  const SETUP_STEP_LEADS = {
    interests: 'Pick only what you will use. Anything left off stays out of sight, and you can turn it on later in Manage.',
    about: 'Optional. Height, weight, age and sex unlock BMI, strength standards and a calorie estimate. Skip any of it.',
    lifting: 'Each lift can use a fixed plates goal or a bodyweight-multiple standard.',
    packs: 'Optional. Start with a ready-made list, or skip and add movements one at a time from the catalog later.',
    food: 'Set a daily calorie target and choose what to track. All of it can be changed in Manage → Food.',
  };
  const SETUP_STEP_TITLES = { interests: 'What do you want to track?', about: 'About you', lifting: 'Lifting goals', running: 'Running goal', packs: 'Starter exercises', food: 'Food targets', goals: 'Other goals' };

  // The topbar normally carries its own iOS safe-area padding (a sticky element
  // must). Screens that hide it (setup wizard, recovery screen) use the
  // `#app.no-topbar` CSS rule, toggled by these helpers.
  function hideAppChrome() {
    document.getElementById('topbar').hidden = true;
    document.getElementById('tabbar').hidden = true;
    document.getElementById('app').classList.add('no-topbar');
  }
  function showAppChrome() {
    document.getElementById('topbar').hidden = false;
    document.getElementById('tabbar').hidden = false;
    document.getElementById('app').classList.remove('no-topbar');
  }

  function startSetupWizard() {
    setupStepIndex = 0;
    hideAppChrome();
    switchTab('setup');
    renderSetupStep();
  }

  // On/off switch markup for rows built in JS; `attrs` is the id or data-* hook.
  function switchHtml(attrs, label, on) {
    return `<button type="button" class="switch" ${attrs} role="switch" aria-checked="${!!on}" aria-label="${label}"><span class="switch-track"><span class="switch-thumb"></span></span></button>`;
  }
  const isOn = (el) => el.getAttribute('aria-checked') === 'true';

  // Every wizard toggle re-renders its whole step, since flipping one shows or hides fields below it.
  function setupBoolRowHtml(id, label, checked) {
    return `<div class="setting-row"><span>${label}</span>${switchHtml(`id="${id}"`, label, checked)}</div>`;
  }
  function wireSetupBoolRow(id, onChange) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => onChange(!isOn(el)));
  }

  function renderSetupStep() {
    const seq = setupStepSequence();
    if (setupStepIndex >= seq.length) setupStepIndex = seq.length - 1; // an interest was turned off after its step: clamp to the new last step
    const key = seq[setupStepIndex];
    document.getElementById('setupProgress').innerHTML = seq.map((_, i) => `<i class="${i <= setupStepIndex ? 'on' : ''}"></i>`).join('');
    document.getElementById('setupKicker').textContent = setupStepIndex === 0 ? 'Welcome to Fit Log' : `Step ${setupStepIndex + 1} of ${seq.length}`;
    document.getElementById('setupStepLabel').textContent = SETUP_STEP_TITLES[key];
    document.getElementById('setupLead').textContent = SETUP_STEP_LEADS[key] || '';
    document.getElementById('setupBackBtn').hidden = setupStepIndex === 0;
    document.getElementById('setupNextBtn').textContent = setupStepIndex === seq.length - 1 ? 'Finish setup' : 'Continue';
    window.scrollTo(0, 0);
    if (key === 'interests') renderSetupStepInterests();
    else if (key === 'about') renderSetupStepAbout();
    else if (key === 'lifting') renderSetupStepLifting();
    else if (key === 'running') renderSetupStepRunning();
    else if (key === 'packs') renderSetupStepPacks();
    else if (key === 'food') renderSetupStepFood();
    else renderSetupStepGoals();
  }

  // Independent on/off tiles: any combination is valid, including none. Tapping
  // one flips its answer and re-renders this step; the step sequence updates when
  // Next/Back leaves it.
  function interestTileHtml(key, icon, label, on, desc) {
    return `<button type="button" class="setup-tile${on ? ' is-on' : ''}" data-interest="${key}" aria-pressed="${on}">
      <span class="setup-tile-ico">${icon}</span>
      <span class="setup-tile-name">${label}</span>
      <span class="setup-tile-desc">${desc}</span>
      <span class="setup-tile-check" aria-hidden="true">${on ? CHECK_ICON_SVG : ''}</span>
    </button>`;
  }
  function renderSetupStepInterests() {
    const i = setupAnswers.interests;
    document.getElementById('setupContent').innerHTML = `
      <div class="setup-tiles">
        ${interestTileHtml('lifting', DOMAIN_TAB_ICONS.workout, 'Lifting', i.lifting, 'Sets, reps, weight and personal bests')}
        ${interestTileHtml('running', STATIC_ICONS.footprints, 'Running', i.running, 'Runs with pace and distance goals')}
        ${interestTileHtml('habits', STATIC_ICONS.habits, 'Habits', i.habits, 'Creatine, stretching, daily reps, anything daily')}
        ${interestTileHtml('food', DOMAIN_TAB_ICONS.food, 'Food', i.food, 'Calories and macros, common foods ready')}
        ${interestTileHtml('water', DOMAIN_TAB_ICONS.water, 'Water', i.water, 'Glasses and bottles against a daily goal')}
        ${interestTileHtml('bodyweight', DOMAIN_TAB_ICONS.measurements, 'Body', i.bodyweight, 'Weight, BMI and other measurements')}
        ${interestTileHtml('sleep', STATIC_ICONS.moon, 'Sleep', i.sleep, 'Hours slept each night')}
      </div>
      <div class="note-box">${uiIconInfo()}<span>Each choice adds one section to Home and one to Log. Nothing you leave off shows up anywhere.</span></div>`;
    document.querySelectorAll('#setupContent [data-interest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.interest;
        setupAnswers.interests[key] = !setupAnswers.interests[key];
        renderSetupStepInterests();
      });
    });
  }
  const uiIconInfo = () => lucide('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>');

  function renderSetupStepAbout() {
    const cm = state.settings.lengthUnit === 'cm';
    document.getElementById('setupContent').innerHTML = `
      <div class="form-card">
        ${cm ? `
        <label class="field"><span class="field-label">Height (cm)</span>
          <input type="number" step="any" min="50" max="272" id="setupHeightCm" value="${escapeHtml(setupAnswers.heightCm)}" placeholder="Not set" /></label>
        ` : `
        <div class="field"><span class="field-label">Height (ft/in)</span>
          <div class="inline-time-fields">
            <input type="number" step="1" min="0" max="8" inputmode="numeric" id="setupHeightFt" value="${escapeHtml(setupAnswers.heightFt)}" placeholder="ft" />
            <input type="number" step="1" min="0" max="11" inputmode="numeric" id="setupHeightIn" value="${escapeHtml(setupAnswers.heightIn)}" placeholder="in" />
          </div>
        </div>
        `}
        <label class="field"><span class="field-label">Weight (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupWeight" value="${escapeHtml(setupAnswers.weight)}" placeholder="Not set" /></label>
        <label class="field"><span class="field-label">Age <span class="muted-text">(for nutrition advice)</span></span>
          <input type="number" step="1" min="1" max="120" inputmode="numeric" id="setupAge" value="${escapeHtml(setupAnswers.age)}" placeholder="Not set" /></label>
        <div class="field">
          <span class="field-label">Sex <span class="muted-text">(for strength/pace benchmarks + nutrition calculator)</span></span>
          <div class="segmented" id="setupSexSegmented" role="radiogroup" aria-label="Sex">
            <button type="button" data-sex-choice="" role="radio" aria-checked="${setupAnswers.sex === ''}">Not set</button>
            <button type="button" data-sex-choice="male" role="radio" aria-checked="${setupAnswers.sex === 'male'}">Male</button>
            <button type="button" data-sex-choice="female" role="radio" aria-checked="${setupAnswers.sex === 'female'}">Female</button>
          </div>
        </div>
      </div>`;
    document.querySelectorAll('#setupSexSegmented button').forEach((b) => {
      b.addEventListener('click', () => { captureSetupStep(); setupAnswers.sex = b.dataset.sexChoice; renderSetupStepAbout(); });
    });
  }

  // Shown only when the Interests step turned Lifting on.
  function renderSetupStepLifting() {
    const lifts = setupAnswers.lifts;
    // A real positive weight, not just a non-empty box: "0" or "abc" would leave the preview empty.
    const canUseStandards = parseFloat(setupAnswers.weight) > 0 && setupAnswers.sex !== '';
    document.getElementById('setupContent').innerHTML = `
        ${canUseStandards ? '' : '<p class="muted-text">Enter weight and sex on the About you step to unlock bodyweight standards.</p>'}
        <div class="card form-card">
          ${['bench', 'squat', 'deadlift'].map((key) => {
            const lift = lifts[key];
            const bwLb = canUseStandards ? Units.displayToLb(parseFloat(setupAnswers.weight)) : null;
            const previewRows = (lift.mode === 'standard' && canUseStandards) ? standardGoalPreviewRows(key, bwLb, setupAnswers.sex) : null;
            return `
            <div class="form-card">
              <div class="setting-row">
                <span>${LIFT_TYPE_LABELS[key]}</span>
                ${switchHtml(`data-lift-toggle="${key}"`, `Track ${LIFT_TYPE_LABELS[key]}`, lift.enabled)}
              </div>
              ${lift.enabled ? `
              <div class="segmented" data-lift-mode="${key}" role="radiogroup" aria-label="${LIFT_TYPE_LABELS[key]} goal style">
                <button type="button" data-mode-choice="plates" role="radio" aria-checked="${lift.mode === 'plates'}">Plates (${PLATE_GOALS[key]} lb)</button>
                <button type="button" data-mode-choice="standard" role="radio" aria-checked="${lift.mode === 'standard'}" ${canUseStandards ? '' : 'disabled'}>Bodyweight standard</button>
              </div>
              ${lift.mode === 'standard' && canUseStandards ? `
              <div class="segmented" data-lift-tier="${key}" role="radiogroup" aria-label="${LIFT_TYPE_LABELS[key]} tier">
                ${['intermediate', 'advanced', 'elite'].map((t) => `<button type="button" data-tier-choice="${t}" role="radio" aria-checked="${lift.tier === t}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join('')}
              </div>
              <div class="standards-preview">
                ${previewRows.map((r) => `<div class="standards-preview-row${r.tierKey === lift.tier ? ' is-selected' : ''}"><span>${r.label}</span><span>${fmtWeight(r.goalLb)}</span></div>`).join('')}
              </div>` : ''}` : ''}
            </div>`;
          }).join('')}
        </div>`;
    ['bench', 'squat', 'deadlift'].forEach((key) => {
      const toggleEl = document.querySelector(`[data-lift-toggle="${key}"]`);
      if (toggleEl) toggleEl.addEventListener('click', () => { lifts[key].enabled = !isOn(toggleEl); renderSetupStepLifting(); });
      const modeEl = document.querySelector(`[data-lift-mode="${key}"]`);
      if (modeEl) modeEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) { lifts[key].mode = b.dataset.modeChoice; renderSetupStepLifting(); } }));
      const tierEl = document.querySelector(`[data-lift-tier="${key}"]`);
      if (tierEl) tierEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { lifts[key].tier = b.dataset.tierChoice; renderSetupStepLifting(); }));
    });
  }

  // Shown only when the Interests step turned Running on.
  function renderSetupStepRunning() {
    const t = setupAnswers.runningGoalType;
    document.getElementById('setupContent').innerHTML = `
      <div class="card form-card">
        <div class="field">
          <span class="field-label">Goal by</span>
          <div class="segmented" id="setupRunGoalType" role="radiogroup" aria-label="Running goal type">
            <button type="button" data-type-choice="distance" role="radio" aria-checked="${t === 'distance'}">Distance</button>
            <button type="button" data-type-choice="pace" role="radio" aria-checked="${t === 'pace'}">Pace</button>
            <button type="button" data-type-choice="both" role="radio" aria-checked="${t === 'both'}">Both</button>
          </div>
        </div>
        ${t !== 'pace' ? `<label class="field"><span class="field-label">Distance goal (${Units.distanceUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupRunDistance" value="${escapeHtml(setupAnswers.runningDistance)}" /></label>` : ''}
        ${t !== 'distance' ? `<label class="field"><span class="field-label">Pace goal (min:sec / ${Units.distanceUnitLabel()})</span>
          <div class="inline-time-fields">
            <input type="number" step="1" min="0" inputmode="numeric" id="setupRunPaceMin" value="${escapeHtml(setupAnswers.runningPaceMin)}" placeholder="min" />
            <input type="number" step="1" min="0" max="59" inputmode="numeric" id="setupRunPaceSec" value="${escapeHtml(setupAnswers.runningPaceSec)}" placeholder="sec" />
          </div></label>` : ''}
      </div>`;
    document.querySelectorAll('#setupRunGoalType button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); // keep whatever's already typed before the field set changes shape
      setupAnswers.runningGoalType = b.dataset.typeChoice;
      renderSetupStepRunning();
    }));
  }

  // Always the last step, even with Water and Body weight off, since the Insights
  // toggle lives here. Those two are decided in the Interests step; this asks only for their goals.
  function renderSetupStepGoals() {
    const i = setupAnswers.interests;
    document.getElementById('setupContent').innerHTML = `
      ${i.water ? `<div class="card form-card">
        <label class="field"><span class="field-label">Daily water goal (${Units.volumeUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupWaterGoal" value="${escapeHtml(setupAnswers.waterGoal || round(Units.mlToDisplay(2000), 0))}" /></label>
      </div>` : ''}
      ${i.bodyweight ? `
      ${setupBoolRowHtml('setupWeightGoalToggle', 'Body weight goal', setupAnswers.weightGoalEnabled)}
      ${setupAnswers.weightGoalEnabled ? `<div class="card form-card">
        <label class="field"><span class="field-label">Target weight (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupWeightGoal" value="${escapeHtml(setupAnswers.weightGoalValue)}" /></label>
      </div>` : ''}` : ''}
      ${setupBoolRowHtml('setupInsightsToggle', 'Insight calculators (BMI, strength level, pace level)', setupAnswers.insightsEnabled)}
      <p class="muted-text">General published benchmarks — each can be turned off individually later in Settings → Insights.</p>`;
    if (i.bodyweight) wireSetupBoolRow('setupWeightGoalToggle', (v) => { captureSetupStep(); setupAnswers.weightGoalEnabled = v; renderSetupStepGoals(); });
    wireSetupBoolRow('setupInsightsToggle', (v) => { captureSetupStep(); setupAnswers.insightsEnabled = v; renderSetupStepGoals(); });
  }

  // Packs offered at setup: Strength and Bodyweight & home go with Lifting, Cardio
  // only with Running.
  function setupPacks() {
    const i = setupAnswers.interests;
    return CATALOG.packs.filter((pk) => (pk.id === 'running' ? i.running : i.lifting));
  }

  function renderSetupStepPacks() {
    const picked = setupAnswers.packs;
    document.getElementById('setupContent').innerHTML = `
      <div class="card card-list">${setupPacks().map((pk) => `
        <div class="setting-row"><span>${escapeHtml(pk.name)}<span class="muted-text">${escapeHtml(pk.description || '')}</span></span>${switchHtml(`data-pack="${pk.id}"`, pk.name, !!picked[pk.id])}</div>`).join('')}
      </div>`;
    document.querySelectorAll('#setupContent [data-pack]').forEach((btn) => btn.addEventListener('click', () => {
      picked[btn.dataset.pack] = !picked[btn.dataset.pack];
      btn.setAttribute('aria-checked', String(!!picked[btn.dataset.pack]));
    }));
  }

  function setupCalcPreview() {
    const w = parseFloat(setupAnswers.weight); const age = parseInt(setupAnswers.age, 10);
    const h = heightCmFromSetup(); const sex = setupAnswers.sex;
    if (!(w > 0) || !(age > 0) || !h || !sex) return null;
    return nutritionTargetsFor(Units.displayToLb(w), h, age, sex, state.settings.nutritionCalc.activityLevel, setupAnswers.calorieGoal);
  }

  function renderSetupStepFood() {
    const a = setupAnswers; const m = a.calorieMode;
    if (!a.macros) a.macros = { protein: macroGoalInfo('protein').enabled, carbs: macroGoalInfo('carbs').enabled, fat: macroGoalInfo('fat').enabled, sugar: false, sodium: false, caffeine: false };
    const starters = CATALOG.foods.filter((f) => f.tier === 'starter');
    const preview = m === 'calc' ? setupCalcPreview() : null;
    document.getElementById('setupContent').innerHTML = `
      ${starters.length ? `<div class="card pad setup-card">
        <div class="setting-row"><span><b>Save common foods</b><span class="muted-text">${starters.length} everyday foods ready to tap</span></span>${switchHtml('id="setupCommonFoods"', 'Save common foods', a.commonFoods)}</div>
        <div class="mini-chips">${starters.slice(0, 8).map((f) => `<span>${escapeHtml(f.name.split(',')[0])}</span>`).join('')}<span>+${starters.length - 8} more</span></div>
        <div class="note-box">${uiIconInfo()}<span>Typical values for one serving, all editable. Brand and restaurant items are not included. Turn this off to start with an empty list.</span></div>
      </div>` : ''}
      <div class="card pad setup-card">
        <span class="lbl">Daily calorie target</span>
        <div class="segmented segmented-fill" id="setupCalorieSeg" role="radiogroup" aria-label="Calorie target">
          <button type="button" role="radio" data-mode="calc" aria-checked="${m === 'calc'}">Calculator</button>
          <button type="button" role="radio" data-mode="manual" aria-checked="${m === 'manual'}">Manual</button>
          <button type="button" role="radio" data-mode="none" aria-checked="${m === 'none'}">No Target</button>
        </div>
        ${m === 'calc' ? `
          <div class="segmented segmented-fill" id="setupCalGoalSeg" role="radiogroup" aria-label="Goal">
            ${[['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']].map(([v, l]) => `<button type="button" role="radio" data-goal="${v}" aria-checked="${a.calorieGoal === v}">${l}</button>`).join('')}
          </div>
          ${preview && !preview.missing ? `<div class="setup-big"><b>${preview.calories.toLocaleString()}</b><span class="muted-text">kcal a day</span></div>
            <div class="muted-text">About ${preview.protein} g protein a day.</div>
            <div class="note-box">${uiIconInfo()}<span>Estimated from your height, weight, age and sex, with a moderate activity level. A starting point you can change any time.</span></div>`
            : `<div class="note-box">${uiIconInfo()}<span>Needs your height, weight, age and sex from the About you step. Without them, Fit Log asks you to enter a number instead.</span></div>`}` : ''}
        ${m === 'manual' ? `<label class="field"><span class="field-label">Daily calories</span>
          <input type="number" step="any" min="0" id="setupCalories" value="${escapeHtml(a.calorieManual)}" placeholder="e.g. 2300" /></label>` : ''}
        ${m === 'none' ? '<div class="note-box">' + uiIconInfo() + '<span>No ring or target on Home. You see plain totals for the day.</span></div>' : ''}
      </div>
      <div class="card pad setup-card">
        <span class="lbl">Nutrients to track</span>
        <div class="chip-picker" id="setupMacroChips" role="group" aria-label="Nutrients to track">
          <button type="button" class="pick-chip is-on is-fixed" disabled>${CHECK_ICON_SVG}Calories</button>
          ${['protein', 'carbs', 'fat', 'sugar', 'sodium', 'caffeine'].map((k) => `<button type="button" class="pick-chip${a.macros[k] ? ' is-on' : ''}" data-macro="${k}" aria-pressed="${!!a.macros[k]}">${a.macros[k] ? CHECK_ICON_SVG : ''}${MACRO_LABELS[k]}</button>`).join('')}
        </div>
      </div>`;
    const cf = document.getElementById('setupCommonFoods');
    if (cf) cf.addEventListener('click', () => { a.commonFoods = !isOn(cf); cf.setAttribute('aria-checked', String(a.commonFoods)); });
    document.querySelectorAll('#setupCalorieSeg [data-mode]').forEach((btn) => btn.addEventListener('click', () => {
      captureSetupStep(); a.calorieMode = btn.dataset.mode; renderSetupStepFood();
    }));
    document.querySelectorAll('#setupCalGoalSeg [data-goal]').forEach((btn) => btn.addEventListener('click', () => { a.calorieGoal = btn.dataset.goal; renderSetupStepFood(); }));
    document.querySelectorAll('#setupMacroChips [data-macro]').forEach((btn) => btn.addEventListener('click', () => {
      captureSetupStep(); a.macros[btn.dataset.macro] = !a.macros[btn.dataset.macro]; renderSetupStepFood();
    }));
  }

  // Text and number inputs are read here, just before the step changes (toggles
  // write to setupAnswers immediately). Keyed by the step's name in the dynamic sequence.
  function captureSetupStep() {
    const key = setupStepSequence()[setupStepIndex];
    if (key === 'about') {
      const cmEl = document.getElementById('setupHeightCm');
      if (cmEl) setupAnswers.heightCm = cmEl.value;
      const ftEl = document.getElementById('setupHeightFt');
      if (ftEl) setupAnswers.heightFt = ftEl.value;
      const inEl = document.getElementById('setupHeightIn');
      if (inEl) setupAnswers.heightIn = inEl.value;
      setupAnswers.weight = document.getElementById('setupWeight').value;
      setupAnswers.age = document.getElementById('setupAge').value;
    } else if (key === 'running') {
      const distEl = document.getElementById('setupRunDistance');
      if (distEl) setupAnswers.runningDistance = distEl.value;
      const minEl = document.getElementById('setupRunPaceMin');
      if (minEl) setupAnswers.runningPaceMin = minEl.value;
      const secEl = document.getElementById('setupRunPaceSec');
      if (secEl) setupAnswers.runningPaceSec = secEl.value;
    } else if (key === 'food') {
      const calEl = document.getElementById('setupCalories');
      if (calEl) setupAnswers.calorieManual = calEl.value;
    } else if (key === 'goals') {
      const waterEl = document.getElementById('setupWaterGoal');
      if (waterEl) setupAnswers.waterGoal = waterEl.value;
      const goalEl = document.getElementById('setupWeightGoal');
      if (goalEl) setupAnswers.weightGoalValue = goalEl.value;
    }
  }

  function goSetupNext() {
    captureSetupStep();
    const seq = setupStepSequence();
    if (setupStepIndex === seq.length - 1) { finishSetup(); return; }
    setupStepIndex++;
    renderSetupStep();
  }
  function goSetupBack() {
    captureSetupStep();
    setupStepIndex--;
    renderSetupStep();
  }

  function heightCmFromSetup() {
    if (state.settings.lengthUnit === 'cm') {
      const cmVal = parseFloat(setupAnswers.heightCm);
      return (!Number.isNaN(cmVal) && cmVal >= MIN_HEIGHT_CM && cmVal <= MAX_HEIGHT_CM) ? cmVal : null;
    }
    const totalIn = (parseFloat(setupAnswers.heightFt) || 0) * 12 + (parseFloat(setupAnswers.heightIn) || 0);
    if (totalIn <= 0) return null;
    const cm = Units.displayToCm(totalIn);
    return (cm >= MIN_HEIGHT_CM && cm <= MAX_HEIGHT_CM) ? cm : null;
  }

  // Builds the real starting `state` from the wizard answers, like a tailored
  // defaultData(). Runs once, right before the first save.
  function finishSetup() {
    needsSetup = false; // the wizard is done; cross-window sync (wireLiveSync) may now apply
    const now = new Date().toISOString();
    const heightCm = heightCmFromSetup();
    const rawWeight = parseFloat(setupAnswers.weight);
    const weightLb = (!Number.isNaN(rawWeight) && rawWeight > 0) ? Units.displayToLb(rawWeight) : null;
    const sex = setupAnswers.sex || null;
    const i = setupAnswers.interests;

    const exercises = [];
    if (i.lifting) {
      ['bench', 'squat', 'deadlift'].forEach((key) => {
        const lift = setupAnswers.lifts[key];
        if (!lift.enabled) return;
        const usingStandard = lift.mode === 'standard' && weightLb && sex;
        const goal = usingStandard ? computeStandardGoal(key, lift.tier, weightLb, sex) : PLATE_GOALS[key];
        exercises.push({
          id: `ex_${key}`, name: LIFT_TYPE_LABELS[key], kind: 'weight', bodyRegion: key === 'bench' ? 'upper' : 'lower', section: 'goal',
          goal, liftType: key, goalMode: usingStandard ? 'standard' : 'fixed', goalTier: usingStandard ? lift.tier : null,
          archived: false, createdAt: now,
          catalogId: key === 'bench' ? 'cat_mv_bench_press' : `cat_mv_${key}`, equipment: 'barbell',
        });
      });
      // The daily bodyweight exercises follow the Lifting interest.
      exercises.push(
        { id: 'ex_pushups', name: 'Push-ups', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
        { id: 'ex_bwsquats', name: 'Bodyweight Squats', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
        { id: 'ex_pullups', name: 'Pull-ups', kind: 'reps', section: 'daily', goal: 15, archived: false, createdAt: now },
      );
    }
    if (i.running) {
      const t = setupAnswers.runningGoalType;
      const distanceGoal = t !== 'pace' ? Units.displayToMi(parseFloat(setupAnswers.runningDistance) || 5) : null;
      const paceSec = (parseInt(setupAnswers.runningPaceMin, 10) || 0) * 60 + (parseInt(setupAnswers.runningPaceSec, 10) || 0);
      const paceGoal = t !== 'distance' && paceSec > 0 ? Units.displaySecPerUnitToSecPerMi(paceSec) : null;
      exercises.push({ id: 'ex_running', name: 'Running', kind: 'cardio', section: 'goal', distanceGoal, paceGoal, goal: null, archived: false, createdAt: now });
    }

    {
      setupPacks().filter((pk) => setupAnswers.packs[pk.id]).forEach((pk) => {
        CATALOG.movements.filter((mv) => mv.packs.includes(pk.id)).forEach((mv) => {
          const eq = mv.equipment.length ? mv.defaultEquipment : null;
          const have = exercises.find((e) => e.liftType && e.liftType === mv.liftType && mv.liftType) || exercises.find((e) => normName(e.name) === normName(mv.name)) || exercises.find((e) => e.catalogId === mv.id && (e.equipment || null) === eq);
          if (have) { if (!have.catalogId) { have.catalogId = mv.id; if (eq) have.equipment = eq; } return; }
          const ex = { id: genId('ex'), name: mv.name, kind: mv.kind, section: 'accessory', group: mv.group, goal: null, goalMode: 'fixed', goalTier: null, archived: false, createdAt: now, catalogId: mv.id };
          if (eq) ex.equipment = eq;
          if (mv.kind === 'weight') { ex.bodyRegion = guessBodyRegion(mv.name); ex.liftType = mv.liftType || null; }
          if (mv.kind === 'cardio') { ex.distanceGoal = null; ex.paceGoal = null; }
          if (mv.unit) ex.unit = mv.unit;
          if (ITEM_ICONS[mv.icon]) ex.icon = mv.icon;
          exercises.push(ex);
        });
      });
      state.settings.catalogPacksSeen = setupPacks().filter((pk) => setupAnswers.packs[pk.id]).map((pk) => pk.id);
    }

    const trackers = defaultTrackers();
    // An interest that is off archives its tracker (as Manage does) rather than
    // omitting it, so turning it on later is an un-archive.
    if (!i.bodyweight) trackers.find((tr) => tr.id === 'trk_weight').archived = true;
    if (!i.sleep) trackers.find((tr) => tr.id === 'trk_sleep').archived = true;

    const measurements = [];
    if (weightLb != null) {
      // Seeded even if the Body weight interest is off: BMI and strength standards
      // read state.measurements regardless of the tracker's archived flag.
      measurements.push({ id: genId('meas'), trackerId: 'trk_weight', date: todayISO(), value: weightLb, note: null });
      if (i.bodyweight && setupAnswers.weightGoalEnabled && setupAnswers.weightGoalValue !== '') {
        const targetLb = Units.displayToLb(parseFloat(setupAnswers.weightGoalValue));
        if (!Number.isNaN(targetLb)) {
          const weightTracker = trackers.find((tr) => tr.id === 'trk_weight');
          weightTracker.goal = targetLb;
          weightTracker.direction = targetLb < weightLb ? 'down' : 'up';
          weightTracker.baseline = weightLb; // the weight just entered above is the starting point
        }
      }
    }

    // Water off reuses the same "zero cups" shape the always-present cup UI
    // already treats as off, rather than a separate flag.
    const water = i.water ? defaultWater() : { goalMl: null, cups: [] };
    if (i.water) {
      water.goalMl = null;
      const rawGoal = parseFloat(setupAnswers.waterGoal);
      water.goalMl = (!Number.isNaN(rawGoal) && rawGoal > 0) ? Units.displayToMl(rawGoal) : defaultWater().goalMl;
    }

    const rawAge = parseInt(setupAnswers.age, 10);
    state.profile.age = (!Number.isNaN(rawAge) && rawAge >= MIN_AGE && rawAge <= MAX_AGE) ? rawAge : null;
    state.profile.heightCm = heightCm;
    state.profile.sex = sex;
    state.exercises = exercises;
    state.entries = [];
    state.trackers = trackers;
    state.measurements = measurements;
    state.water = water;
    state.waterEntries = [];
    state.settings.showWeightInsights = setupAnswers.insightsEnabled;
    state.settings.showStrengthLevel = setupAnswers.insightsEnabled;
    state.settings.showPaceLevel = setupAnswers.insightsEnabled;
    // Starting domain switches come from the interests: Lifting, Running and Habits
    // each have their own, Body covers Body weight and Sleep, Water and Food map 1:1.
    state.settings.trackWorkout = i.lifting;
    state.settings.trackCardio = i.running;
    state.settings.trackHabits = i.habits;
    state.settings.trackMeasurements = i.bodyweight || i.sleep;
    state.settings.trackWater = i.water;
    state.settings.trackFood = i.food;
    if (i.food) {
      if (setupAnswers.macros) Object.keys(setupAnswers.macros).forEach((k) => { if (state.settings.macroGoals[k]) state.settings.macroGoals[k].enabled = !!setupAnswers.macros[k]; });
      if (setupAnswers.commonFoods) CATALOG.foods.filter((f) => f.tier === 'starter').forEach(addCatalogFood);
      const cal = state.settings.macroGoals.calories;
      if (setupAnswers.calorieMode === 'manual' && parseFloat(setupAnswers.calorieManual) > 0) {
        cal.enabled = true; cal.goal = Math.round(parseFloat(setupAnswers.calorieManual));
      } else if (setupAnswers.calorieMode === 'calc') {
        state.settings.nutritionCalc.enabled = true;
        const nc = state.settings.nutritionCalc;
        nc.goal = setupAnswers.calorieGoal;
        applyNutritionCalcTargets(nc.activityLevel, nc.goal); // only applies once the profile has what it needs
      }
      if (setupAnswers.macros) Object.keys(setupAnswers.macros).forEach((k) => { if (state.settings.macroGoals[k]) state.settings.macroGoals[k].enabled = !!setupAnswers.macros[k]; });
    }

    // On failure stay on the wizard: save() has said why and the answers are still
    // in setupAnswers/state.
    if (!save()) return;
    showAppChrome();
    switchTab('dashboard');
    renderAll();
    toast('All set — welcome to Fit Log!');
  }

  /* ============================== Tabs / global wiring ============================== */

  // Show only the `.view` whose data-view matches `tab`, highlight its bottom tab
  // and re-render it. Settings has no tab button (it opens from the header gear),
  // so no tab is highlighted for it.
  function switchTab(tab) {
    navOnSwitchTab(tab);
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    // The window scrolls, not the views, so reset it: each tab should open at its
    // top, not wherever the previous tab was scrolled.
    window.scrollTo(0, 0);
    if (tab === 'dashboard') renderHome();
    if (tab === 'progress') renderProgress();
    if (tab === 'log') renderLogView();
    if (tab === 'history') renderHistory();
    if (tab === 'manage') renderManage();
    if (tab === 'settings') renderSettings();
  }

  // Settings opens from the header gear, not a tab, so remember the active tab to
  // return to on close.
  let lastTabBeforeSettings = 'dashboard';
  // Sync the Profile height and age inputs on entry only: doing it in the general
  // re-render would overwrite a value typed but not saved (see renderSettings()).
  // Height is also resynced when the length unit changes, since the fields change.
  function syncProfileHeightInputs() {
    if (state.settings.lengthUnit === 'cm') {
      document.getElementById('profileHeightCm').value = state.profile.heightCm ? round(state.profile.heightCm, 1) : '';
    } else {
      const { ft, inch } = state.profile.heightCm ? cmToFtIn(state.profile.heightCm) : { ft: '', inch: '' };
      document.getElementById('profileHeightFt').value = ft;
      document.getElementById('profileHeightIn').value = inch;
    }
    document.getElementById('profileAge').value = state.profile.age != null ? state.profile.age : '';
  }

  function openSettings() {
    // The header gear sits outside <main>, so it can be pressed while Settings is
    // already open. Re-capturing then would find no active tab and reset the return
    // tab to 'dashboard', so skip it.
    if (!document.getElementById('view-settings').hidden) return;
    const activeTab = document.querySelector('.tab[aria-current="page"]');
    lastTabBeforeSettings = activeTab ? activeTab.dataset.tab : 'dashboard';
    switchTab('settings');
    syncProfileHeightInputs();
  }
  function closeSettings() {
    switchTab(lastTabBeforeSettings);
  }

  // Redraw everything, after changes that can affect several screens (import,
  // unit change, adding or archiving items). Cheap at this data size.
  function renderAll() {
    applyTheme();
    renderDashboard();
    renderLogView();
    renderHistory();
    renderManage();
    renderSettings();
  }

  function wireEvents() {
    document.getElementById('setupNextBtn').addEventListener('click', goSetupNext);
    document.getElementById('setupBackBtn').addEventListener('click', goSetupBack);

    document.getElementById('tabbar').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (btn) switchTab(btn.dataset.tab);
    });

    document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
    document.querySelectorAll('[data-action="close-settings"]').forEach((btn) => btn.addEventListener('click', closeSettings));

    document.getElementById('dismissSetupReviewBtn').addEventListener('click', dismissSetupReviewPrompt);
    document.getElementById('openSetupReviewBtn').addEventListener('click', openSetupReviewModal);

    document.getElementById('logExercise').addEventListener('change', (ev) => {
      if (ev.target.value === '__add_new__') {
        openExerciseForm(null);
        ev.target.value = '';
        return;
      }
      logEx.pickerOpen = false;
      renderDynamicFields(document.getElementById('logDynamicFields'), exerciseById(ev.target.value));
      syncLogWorkoutUI();
    });
    wireLogExercisePicker();
    document.getElementById('streakCard').addEventListener('click', () => switchTab('history'));
    document.getElementById('recentHistoryBtn').addEventListener('click', () => switchTab('history'));
    wireManageExercises();
    wireFoodLog();
    wireManageFood();
    document.getElementById('logForm').addEventListener('submit', handleLogSubmit);

    // Reuses renderLogMeasurementForm() for the label and the quality field.
    document.getElementById('logTracker').addEventListener('change', renderLogMeasurementForm);
    document.getElementById('logMeasurementForm').addEventListener('submit', handleLogMeasurementSubmit);
    wireChipPicker(document.getElementById('logSleepQuality'));

    document.getElementById('logWaterCustomAddBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('logWaterCustomAmount').value);
      if (Number.isNaN(raw) || raw <= 0) { toast('Enter an amount greater than zero.'); return; }
      logWaterAmount(Units.displayToMl(raw), null);
      document.getElementById('logWaterCustomAmount').value = '';
    });

    document.getElementById('logFoodForm').addEventListener('submit', handleLogFoodSubmit);

    document.getElementById('historyFilter').addEventListener('change', renderHistory);
    // historyCategorySegmented's buttons are wired by renderHistoryCategorySegmented()
    // on each rebuild; manageCategorySegmented does the same via setManageCategory().
    document.getElementById('calPrevBtn').addEventListener('click', () => {
      calendarMonth.setMonth(calendarMonth.getMonth() - 1);
      renderHistoryCalendar();
    });
    document.getElementById('calNextBtn').addEventListener('click', () => {
      calendarMonth.setMonth(calendarMonth.getMonth() + 1);
      renderHistoryCalendar();
    });

    // manageCategorySegmented's buttons are wired inline by
    // setManageCategory() itself, same as historyCategorySegmented above.
    document.querySelectorAll('[data-action="add-exercise"]').forEach((btn) => btn.addEventListener('click', () => openExerciseForm(null)));
    document.querySelectorAll('[data-action="add-tracker"]').forEach((btn) => btn.addEventListener('click', () => openTrackerForm(null)));
    document.querySelectorAll('[data-action="add-cup"]').forEach((btn) => btn.addEventListener('click', () => openCupForm(null)));
    document.getElementById('progressSeg').addEventListener('click', (ev) => { const b = ev.target.closest('[data-progress-seg]'); if (!b) return; progressSeg = b.dataset.progressSeg; renderProgress(); });
    document.getElementById('homeFoodPencil').addEventListener('click', () => openManageCategory('food'));
    document.getElementById('goalsOpenBtn').addEventListener('click', () => { progressSeg = 'goals'; switchTab('progress'); });
    document.querySelectorAll('[data-action="open-catalog"]').forEach((btn) => btn.addEventListener('click', () => openCatalogSheet(btn.dataset.catTabOpen)));
    document.querySelectorAll('[data-action="add-saved-food"]').forEach((btn) => btn.addEventListener('click', () => openSavedFoodForm(null)));

    // Macro toggle and goal rows are wired by delegation in renderFoodManagePanel(),
    // not here, because MACRO_KEYS can grow.
    document.getElementById('saveWaterGoalBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('waterGoalInput').value);
      const goalMl = (!Number.isNaN(raw) && raw > 0) ? fieldCanon(document.getElementById('waterGoalInput'), Units.displayToMl) : null;
      if (goalMl != null && tooBigWater(goalMl)) { toast(WATER_TOO_BIG); return; }
      state.water.goalMl = goalMl;
      if (!save()) return;
      toast('Water goal saved');
      renderManage();
      renderDashboard();
    });

    // Turning a domain off hides it from Log/History/Goals without touching logged data.
    Object.entries(settingSwitches).forEach(([id, key]) => {
      document.getElementById(id).addEventListener('click', () => {
        state.settings[key] = !state.settings[key];
        if (!save()) return;
        renderAll();
      });
    });

    Object.entries(homeSwitches).forEach(([id, key]) => {
      document.getElementById(id).addEventListener('click', () => {
        state.settings.homeSections = Object.assign({}, HOME_SECTION_DEFAULTS, state.settings.homeSections, { [key]: !homeSectionOn(key) });
        if (!save()) return;
        renderAll();
      });
    });

    // Nutrition calculator: its settings only drive the live preview. The target
    // numbers are written into macroGoals only by "Apply to daily goals"
    // (applyNutritionCalcTargets()).
    document.getElementById('calorieModeSegmented').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-calorie-mode]');
      if (!b) return;
      setCalorieMode(b.dataset.calorieMode);
      if (!save()) return;
      renderManage();
      renderDashboard();
    });
    document.getElementById('nutritionActivityLevel').addEventListener('change', (ev) => {
      state.settings.nutritionCalc.activityLevel = ev.target.value;
      if (!save()) return;
      renderManage();
    });
    document.getElementById('nutritionGoalSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.nutritionCalc.goal = btn.dataset.goalChoice;
      if (!save()) return;
      renderManage();
    });
    document.getElementById('applyNutritionCalcBtn').addEventListener('click', () => {
      const calc = state.settings.nutritionCalc;
      const applied = applyNutritionCalcTargets(calc.activityLevel, calc.goal);
      if (!applied) { toast('Set your height, age, sex, and a logged body weight first.'); return; }
      if (!save()) return;
      toast('Calorie and protein goals applied');
      renderManage();
      renderDashboard();
    });

    document.getElementById('themeSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.theme = btn.dataset.themeChoice;
      if (!save()) return;
      applyTheme(); renderSettings();
    });
    document.getElementById('weightUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.weightUnit = btn.dataset.unitChoice;
      if (!save()) return;
      renderAll();
    });
    document.getElementById('distanceUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.distanceUnit = btn.dataset.unitChoice;
      if (!save()) return;
      renderAll();
    });
    document.getElementById('lengthUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.lengthUnit = btn.dataset.unitChoice;
      if (!save()) return;
      renderAll();
      syncProfileHeightInputs(); // a unit switch changes which fields show, so this one must resync
    });
    document.getElementById('volumeUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.volumeUnit = btn.dataset.unitChoice;
      if (!save()) return;
      renderAll();
    });

    document.getElementById('profileSexSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.profile.sex = btn.dataset.sexChoice || null;
      recomputeStandardGoals();
      if (!save()) return;
      renderAll();
    });
    document.getElementById('saveProfileBtn').addEventListener('click', () => {
      let heightCm = null;
      let heightOutOfRange = false;
      if (state.settings.lengthUnit === 'cm') {
        const raw = parseFloat(document.getElementById('profileHeightCm').value);
        if (!Number.isNaN(raw) && raw > 0) {
          if (raw >= MIN_HEIGHT_CM && raw <= MAX_HEIGHT_CM) heightCm = raw;
          else heightOutOfRange = true;
        }
      } else {
        const ft = parseFloat(document.getElementById('profileHeightFt').value) || 0;
        const inch = parseFloat(document.getElementById('profileHeightIn').value) || 0;
        const totalIn = ft * 12 + inch;
        if (totalIn > 0) {
          const cm = Units.displayToCm(totalIn);
          if (cm >= MIN_HEIGHT_CM && cm <= MAX_HEIGHT_CM) heightCm = cm;
          else heightOutOfRange = true;
        }
      }
      const rawAge = parseInt(document.getElementById('profileAge').value, 10);
      let ageOutOfRange = false;
      let age = null;
      if (!Number.isNaN(rawAge)) {
        if (rawAge >= MIN_AGE && rawAge <= MAX_AGE) age = rawAge;
        else ageOutOfRange = true;
      }
      // Reject the whole save rather than silently clearing an out-of-range height or age.
      if (heightOutOfRange || ageOutOfRange) {
        const what = heightOutOfRange && ageOutOfRange ? 'Height and age' : heightOutOfRange ? 'Height' : 'Age';
        toast(`${what} looks out of range — please check the value before saving.`);
        return;
      }
      state.profile.heightCm = heightCm;
      state.profile.age = age;
      if (!save()) return;
      toast('Profile saved');
      // renderAll() refreshes the calculator preview in Manage -> Food. Do not
      // re-apply into macroGoals here: only "Apply to daily goals" does that, so a
      // Profile edit never overwrites goals.
      renderAll();
    });

    document.getElementById('dashboardChartScaleSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.chartScale = btn.dataset.scaleChoice;
      if (!save()) return;
      renderAll();
    });
    document.getElementById('insightsWindowSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.insightsWindowDays = parseInt(btn.dataset.windowChoice, 10);
      if (!save()) return;
      renderAll();
    });

    document.getElementById('aboutNumbersBtn').addEventListener('click', openReferencesModal);
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

  /* ============================== Data recovery screen ==============================
     Shown instead of the app when load() could not read an existing saved payload. It offers an
     explicit choice instead of discarding data that may be salvageable. */

  function showRecoveryScreen() {
    hideAppChrome();
    switchTab('recover');
    document.getElementById('recoverExportBtn').addEventListener('click', () => {
      const blob = new Blob([rawCorrupt || ''], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fit-log-recovery-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Recovery file downloaded');
    });
    document.getElementById('recoverResetBtn').addEventListener('click', () => {
      confirmDialog(
        'Permanently delete this data?',
        'This clears the data Fit Log couldn’t read and starts fresh. Export a recovery file first if you haven’t already — this can’t be undone.',
        'Delete and start fresh',
        () => { localStorage.removeItem(STORAGE_KEY); location.reload(); },
        true
      );
    });
  }

  /* ============================== Init ============================== */

  function init() {
    // Tag the initial history entry and push a guard entry above it, so a Back press
    // on a fresh Dashboard has something to pop and the "press back again to exit"
    // warning can run (see "Back-button / swipe-back step navigation").
    history.replaceState({ nav: 'base' }, '');
    history.pushState({ nav: 'exit-guard' }, '');
    hydrateStaticIcons();
    // Bare buttons outside a <form> default to type=submit; make that explicit.
    document.querySelectorAll('button:not([type])').forEach((b) => { if (!b.closest('form')) b.type = 'button'; });
    load();
    // wireEvents() only attaches listeners and reads no state, so it is safe in
    // recovery mode; the recovery screen's confirm dialog needs it.
    wireEvents();
    if (needsRecovery) { showRecoveryScreen(); registerServiceWorker(); return; }
    applyTheme();
    document.getElementById('logDate').value = todayISO();
    document.getElementById('logMeasurementDate').value = todayISO();
    if (needsSetup) startSetupWizard();
    else renderAll();
    wireLiveSync();
    registerServiceWorker();
  }

  /* ===== Staying current: other tabs and midnight ==============================
     1. Two tabs (or a tab and the installed app) share one localStorage key. Each keeps its
        own in-memory copy and rewrites the whole key on every save, so the later save would
        silently erase the other tab's changes. The `storage` event tells this tab when
        another one saved; it adopts that data instead of overwriting it.
     2. A tab left open past midnight keeps showing yesterday as "today". When the date
        changes, any date the user hasn't deliberately moved is advanced. */
  function wireLiveSync() {
    window.addEventListener('storage', (ev) => {
      if (ev.key !== STORAGE_KEY || !ev.newValue || needsRecovery || needsSetup) return;
      let incoming;
      try { incoming = upgradeData(JSON.parse(ev.newValue)); } catch (e) { return; }
      state = incoming;
      // Open sheets hold references into the old state, so close them rather than let a save
      // write stale objects back.
      if (!modalRoot().hidden) closeModal();
      renderAll();
      toast('Updated from another window.');
    });

    let lastSeenDay = todayISO();
    const checkNewDay = () => {
      const today = todayISO();
      if (today === lastSeenDay || needsRecovery || needsSetup) return;
      const wasMonth = calendarMonth.getFullYear() === Number(lastSeenDay.slice(0, 4)) && calendarMonth.getMonth() + 1 === Number(lastSeenDay.slice(5, 7));
      ['logDate', 'logMeasurementDate', 'logFoodDate', 'savedFoodDate'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.value === lastSeenDay) el.value = today;
      });
      if (historySelectedDate === lastSeenDay) historySelectedDate = today;
      if (wasMonth) { calendarMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1); }
      lastSeenDay = today;
      renderAll();
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewDay(); });
    window.addEventListener('pageshow', checkNewDay);
    setInterval(checkNewDay, 60000);
  }

  // Registers the service worker, checks for updates when the app returns to the
  // foreground, and offers a reload once one installs (never reloads by itself).
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        const offerReload = () => toast('A new version is ready.', { label: 'Reload', run: () => window.location.reload() });
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) offerReload();
          });
        });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      }).catch((e) => console.warn('Service worker registration failed', e));
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
