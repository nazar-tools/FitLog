/* Fit Log. Plain HTML/CSS/JS with no build step or framework. index.html holds every screen
   as a <section>; this file shows and hides them. Data lives in localStorage on the device and
   is never sent anywhere.

   One IIFE. Logic that doesn't touch the DOM is in the other files in js/ (migrations, units,
   calc, features, standards, catalog, backup). A handler updates `state`, calls save(), then
   calls the render*() functions for whatever changed. README.md has the walkthrough. */
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
    // area stays on while Lifting or Running & cardio is on, and Daily follows trackHabits (js/features.js).
    // An off area is hidden from Log, History and Home. Manage always shows it so it
    // can be turned back on.
    trackWorkout: true,
    homeSections: Object.assign({}, HOME_SECTION_DEFAULTS),
    trackMeasurements: true,
    trackWater: true,
    trackFood: true,
    // The Daily area: habits and daily-rep targets (Log, History, Manage and the Home
    // checklist), independent of Lifting. Stored as trackHabits so saved data keeps working.
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

  /* Store
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
      const fromVersion = parsed.version;
      state = upgradeData(parsed);
      if (fromVersion !== SCHEMA_VERSION) save();
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

  const {
    LB_PER_KG, MIN_AGE, MAX_AGE, MIN_HEIGHT_CM, MAX_HEIGHT_CM,
    Units, round, cmToFtIn, fmtWeight, isTimed, fmtHold, fmtCount, fmtDistance,
    fmtPace, fmtLength, fmtVolume, fmtDuration, localDateISO, todayISO, fmtDateShort,
  } = window.FitUnits.create(() => state.settings);

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
  // Habits and daily reps live in the Daily area (Log, History, Manage); everything else is Workout.
  const isDailyEx = (ex) => !!ex && F.isHabitLike(ex);
  const isDailyEntry = (en) => isDailyEx(exerciseById(en.exerciseId));
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
    if (logCategory === 'daily') renderLogDailyPanel();
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
    // FitCalc.strengthLevel), so measure it against that. A fixed goal uses the
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

  /* Progressive-overload suggestion engine
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
        const detail = lastTop.reps < prevTop.reps
          ? `Reps dipped (${prevTop.reps} → ${lastTop.reps}). Consolidate before adding load.`
          : `Fewer than 5 reps (${lastTop.reps}) at this weight. Build to 5 before adding load.`;
        return { headline: `Repeat ${fmtWeight(lastTop.weight)} next session`, detail, method: 'sametrend' };
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
      if (metrics.length === 2) return 'Cardio · distance & pace';
      return metrics[0] === 'pace' ? 'Cardio · pace' : 'Cardio · distance';
    }
    return '';
  }

  /* Body & wellness trackers
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
      case 'rating': return `${Math.round(v)}/${Number(tracker.ratingMax) || 5}`;
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
    const down = tracker.direction === 'down';
    const moved = down ? tracker.baseline - value : value - tracker.baseline;
    const remaining = Math.abs(tracker.goal - value);
    if (remaining <= 0) return null;
    if (moved <= 0) return `${fmtTrackerValue(tracker, remaining)} to go`;
    return `${fmtTrackerValue(tracker, moved)} ${down ? 'down' : 'up'} · ${fmtTrackerValue(tracker, remaining)} remaining`;
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
      case 'rating': return `/ ${Number(tracker.ratingMax) || 5}`;
      default: return tracker.unitLabel ? escapeHtml(tracker.unitLabel) : '';
    }
  }

  /* Insights & standards
     Optional calculators (BMI, weight trend, strength and running level), on by
     default and switched in Settings -> Insights. Each says what is missing
     instead of guessing. Tables and sources: js/standards.js. General guidance only. */

  // Thresholds, formulas and sources live in js/standards.js (FitStandards).
  const S = window.FitStandards;
  // Fixed "plates" goals: 2/3/4 plates a side plus a 45 lb bar. Used by the
  // setup wizard and defaultData().
  const PLATE_GOALS = { bench: 225, squat: 315, deadlift: 405 };
  // Wizard tier name -> index in S.strengthThresholds() (Beginner, Novice,
  // Intermediate, Advanced, Elite). Beginner and Novice are left out as too low
  // to be goals.
  const TIER_TO_INDEX = { intermediate: 2, advanced: 3, elite: 4 };
  const ALL_TIER_KEYS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

  // The Strength Level table an exercise is rated against: the one chosen in its
  // form (stored as `liftType`, which holds a key of S.STRENGTH; the older values
  // bench, squat and deadlift are keys too), else an automatic match: the library's
  // table for its movement and equipment, or a table whose name is the exercise's
  // own name (Pull-ups, Push-ups). Habits, timed holds and cardio have no table, and
  // a table only applies to the right kind (1RM tables to weight, rep tables to reps).
  let standardsByName = null;
  function autoStandardKey(ex) {
    let key = ex.catalogId ? S.standardKeyFor(ex.catalogId, ex.equipment) : null;
    if (!key && !ex.catalogId) {
      if (!standardsByName) {
        standardsByName = {};
        S.STRENGTH_KEYS.forEach((k) => { const n = normName(S.STRENGTH[k].label); if (!standardsByName[n]) standardsByName[n] = k; });
      }
      key = standardsByName[normName(ex.name)] || null;
    }
    return key;
  }
  function standardKeyFits(ex, key) {
    const std = key && S.STRENGTH[key];
    return !!std && !isTimed(ex) && (ex.kind === 'weight') === (std.metric === '1rm') && (ex.kind === 'weight' || ex.kind === 'reps');
  }
  function exStandardKey(ex) {
    if (!ex) return null;
    if (standardKeyFits(ex, ex.liftType)) return ex.liftType;
    const auto = autoStandardKey(ex);
    return standardKeyFits(ex, auto) ? auto : null;
  }

  // Goal in lb for a bodyweight-standard tier, rounded to 5 lb. Shared by the
  // setup wizard and the exercise form. Weight standards only.
  function computeStandardGoal(key, tier, bodyweightLb, sex) {
    const std = S.STRENGTH[key];
    if (!std || std.metric !== '1rm' || TIER_TO_INDEX[tier] === undefined) return null;
    const t = S.strengthThresholds(key, sex, bodyweightLb);
    return t ? Math.round(t[TIER_TO_INDEX[tier]] / 5) * 5 : null;
  }

  // Every tier's goal for this standard, bodyweight and sex. Null until bodyweight
  // and sex are known.
  function standardGoalPreviewRows(key, bodyweightLb, sex) {
    const std = S.STRENGTH[key];
    const t = std && std.metric === '1rm' && S.strengthThresholds(key, sex, bodyweightLb);
    if (!t) return null;
    return ALL_TIER_KEYS.map((tierKey, i) => ({
      tierKey,
      label: tierKey[0].toUpperCase() + tierKey.slice(1),
      goalLb: Math.round(t[i] / 5) * 5,
    }));
  }

  // Recompute each bodyweight-standard goal (goalMode 'standard') from the
  // current bodyweight and sex; 'fixed' goals are untouched. Call wherever
  // bodyweight or sex can change.
  function recomputeStandardGoals() {
    const bw = currentBodyWeightLb();
    const sex = state.profile.sex;
    state.exercises.forEach((ex) => {
      if (ex.kind !== 'weight' || ex.goalMode !== 'standard' || !ex.goalTier) return;
      const key = exStandardKey(ex);
      if (!key) return;
      // A null result (bodyweight or sex missing) is assigned on purpose so the goal
      // does not keep a stale value.
      ex.goal = computeStandardGoal(key, ex.goalTier, bw, sex);
    });
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
        if (days > 0) trend = { delta: latest.value - baseline.value, days };
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
  // js/calc.js). A bodyweight-standard goal is measured against it.
  function bestEstimatedOneRM(ex) {
    return window.FitCalc.bestEstimatedOneRM(entriesFor(ex.id), S);
  }

  // Strength level for one exercise against its Strength Level table (see
  // exStandardKey and FitCalc.strengthLevel). Needs a body weight entry and a sex in
  // Profile; says which is missing instead of guessing.
  function strengthLevelInfo(ex) {
    const key = exStandardKey(ex);
    if (!key) return null;
    return window.FitCalc.strengthLevel(key, entriesFor(ex.id), { sex: state.profile.sex, bodyweightLb: currentBodyWeightLb() }, S);
  }

  // Running, matched by the library movement or, for an exercise made by hand, by
  // its name.
  function isRunning(ex) {
    return ex.kind === 'cardio' && (ex.catalogId === 'cat_mv_running' || (!ex.catalogId && /^(running|run)$/.test(normName(ex.name))));
  }

  // Running level: each logged run from one mile to a marathon becomes a 5K-equivalent
  // time (Riegel) and is placed on Running Level's age and sex table; the best run
  // sets the level. Age is optional (an adult default is used and flagged).
  function runLevelInfo(ex) {
    if (!isRunning(ex)) return null;
    if (!state.profile.sex) return { needsSex: true };
    const age = state.profile.age;
    let best = null;
    entriesFor(ex.id).forEach((e) => {
      const lvl = S.runLevel(state.profile.sex, age, e.distance, e.duration);
      if (lvl && (!best || lvl.tier > best.level.tier || (lvl.tier === best.level.tier && lvl.equivalentSec < best.level.equivalentSec))) best = { entry: e, level: lvl };
    });
    return { best, ageAssumed: !(age > 0), age: age > 0 ? age : S.DEFAULT_RUN_AGE, hasRuns: entriesFor(ex.id).length > 0 };
  }

  /* Water
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

  /* Food / nutrition
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
      .map((k) => k === 'calories' ? `${Math.round(values[k])} kcal` : `${fmtMacroValue(k, values[k])} ${MACRO_LABELS[k].toLowerCase()}`);
    return parts.length ? parts.join(', ') : 'No macros logged';
  }

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
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : Math.max(2200, msg.length * 55));
  }

  const modalRoot = () => document.getElementById('modalRoot');
  const modalSheet = () => document.getElementById('modalSheet');
  let modalLastFocusedEl = null;

  function focusableEls(container) {
    return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  }

  /* Back-button / swipe-back step navigation
   * One history entry per level below Dashboard makes Back close the modal, then return to
   * Dashboard, then ask for a second press to exit. Only navPushModal()/navPopModal() and
   * switchTab() touch history. suppressNextPopHandling skips the popstate from our own
   * history.back(); handlingPopState stops its handlers from pushing or popping again. */
  const NAV_MODAL = 'modal';
  const NAV_TAB = 'tab';
  const NAV_SETTINGS = 'settings';
  let suppressNextPopHandling = false;
  let handlingPopState = false;
  let exitWarningArmed = false;
  let exitWarningTimer = null;
  // A tab switch requested while our own back() is still in flight waits for it to land;
  // pushing first would put the new entry above the one being popped.
  let pendingNav = null;
  // The entry under Settings: a tab's, or Dashboard's guard.
  let navBelowSettings = null;

  let suppressTimer = null;
  function popLanded() {
    suppressNextPopHandling = false;
    clearTimeout(suppressTimer);
    const next = pendingNav;
    pendingNav = null;
    if (next) next();
  }
  function navPop(steps = 1) {
    // A back() is already in flight (history.state does not change until it lands), so a
    // second request in the same tick, e.g. confirmDialog closing and then its callback
    // closing again, would step back twice and land on Dashboard. Ignore it.
    if (suppressNextPopHandling) return;
    suppressNextPopHandling = true;
    // Safety net: if the browser never fires popstate (nothing to go back to), don't leave
    // the flag set and swallow the user's next real Back press.
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(popLanded, 600);
    history.go(-steps);
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
    if (suppressNextPopHandling) { pendingNav = () => navOnSwitchTab(tab); return; }
    const cur = (history.state || {}).nav;
    if (tab === 'settings') {
      if (cur !== NAV_SETTINGS) { navBelowSettings = cur; history.pushState({ nav: NAV_SETTINGS }, ''); }
      return;
    }
    // Leaving Settings drops its entry; going Home also drops the tab entry under it.
    const fromSettings = cur === NAV_SETTINGS;
    const below = fromSettings ? navBelowSettings : cur;
    if (tab === 'dashboard') {
      const steps = (fromSettings ? 1 : 0) + (below === NAV_TAB ? 1 : 0);
      if (steps) navPop(steps);
    } else if (below === NAV_TAB) {
      if (fromSettings) navPop();
    } else if (fromSettings) {
      history.replaceState({ nav: NAV_TAB }, '');
    } else {
      history.pushState({ nav: NAV_TAB }, '');
    }
  }

  window.addEventListener('popstate', () => {
    if (suppressNextPopHandling) { popLanded(); return; }
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
      <div class="modal-title-row"><h2>${escapeHtml(title)}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text">${escapeHtml(body)}</p>
      <div class="btn-row confirm-actions">
        <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmDialogBtn">${escapeHtml(confirmLabel)}</button>
      </div>
    `);
    document.getElementById('confirmDialogBtn').addEventListener('click', () => { closeModal(); onConfirm(); });
  }

  /* Chip picker
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
      if (ev.target === el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onOpen(); }
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
    if (tracker.unitKind === 'rating') {
      const max = Number(tracker.ratingMax) || 5;
      if (canon < 1 || canon > max) return `Pick a rating from 1 to ${max}.`;
    }
    if (tracker.unitKind === 'percent' && (canon < 0 || canon > 100)) return 'A percentage must be between 0 and 100.';
    if (tracker.unitKind === 'hours' && (canon < 0 || canon > 24)) return 'Hours must be between 0 and 24.';
    if (tracker.unitKind === 'count' && canon < 0) return 'A count can’t be negative.';
    return null;
  }
  const WATER_TOO_BIG = 'That amount is too large to be right. Check the number and unit.';
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
      if (!Number.isNaN(secV) && secV >= 60) return { error: 'Seconds must be less than 60. Carry the rest over into minutes.' };
      if (invalidRpe(rpeV)) return { error: `RPE must be between ${RPE_MIN} and ${RPE_MAX}.` };
      const hasDist = !Number.isNaN(distV) && distV > 0;
      const minPart = Number.isNaN(minV) ? 0 : minV;
      const secPart = Number.isNaN(secV) ? 0 : secV;
      const hasTime = minPart > 0 || secPart > 0;
      if (!hasDist && !hasTime) return null;
      return {
        distance: hasDist ? fieldCanon(container.querySelector('#cardioDistance'), Units.displayToMi) : null,
        duration: hasTime ? Math.round(minPart * 60 + secPart) : null,
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
        if (Number.isNaN(r)) {
          if (Number.isNaN(aw) && Number.isNaN(rpe)) continue;
          return { error: 'Add the reps for this set, or clear the row.' };
        }
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

  // Every date with something logged in a section you track (see
  // FitStandards.STREAK_RULE): workouts/habits, food, water, body entries.
  const trackedAreas = () => ({
    workout: (e) => domainTracked(isDailyEntry(e) ? 'daily' : 'workout'), measurements: domainTracked('measurements'),
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
    // A bodyweight-standard goal is measured on estimated 1RM, not the heaviest set; say so.
    const oneRM = ex.kind === 'weight' && ex.goalMode === 'standard';
    const label = oneRM ? 'Est. 1RM' : metric === 'pace' ? 'Pace' : 'Distance';
    return `
      <div class="ex-card-metric">
        ${opts.labeled || oneRM ? `<div class="ex-card-metric-label">${label}</div>` : ''}
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

  // Strength level card for the exercise detail modal: for each way the table
  // measures the exercise (estimated 1RM, reps at body weight, added weight), a
  // `.standards-preview` table of the tier thresholds at the current body weight,
  // with the current tier marked `.is-selected`.
  function strengthStandardsDetailHtml(ex) {
    const info = strengthLevelInfo(ex);
    if (!info) return '';
    const head = '<div class="section-head"><div class="setting-row-label"><span class="setting-icon">'+STATIC_ICONS.trophy+'</span><h2>Strength level</h2></div></div>';
    if (info.missing === 'bodyweight') return `<div class="card">${head}<p class="muted-text">Log your body weight to see your strength level.</p></div>`;
    if (info.missing === 'sex') return `<div class="card">${head}<p class="muted-text">Set your sex in Settings → Profile to see your strength level.</p></div>`;
    const logged = entriesFor(ex.id).length > 0;
    if (info.best < 0) {
      if (!logged) return '';
      const need = info.metric === '1rm' ? `Log a set of ${S.ONE_RM_MAX_REPS} reps or fewer to see your strength level. The estimate is not reliable on longer sets.` : 'Log a set of reps to see your strength level.';
      return `<div class="card">${head}<p class="muted-text">${need}</p></div>`;
    }
    // Assisted pull-up and dip tables run below zero ("−6 lb" is 6 lb of assistance).
    const fmtVal = (mode, v) => {
      if (mode === 'reps') return `${v} rep${v === 1 ? '' : 's'}`;
      if (mode === 'added') return v < 0 ? `\u2212${fmtWeight(-v)}` : `+${fmtWeight(v)}`;
      return fmtWeight(v);
    };
    const blocks = info.results.map((r) => {
      // A line at zero can't be missed, so the row below it is shown as "Any" and the
      // "Untrained" row, which would read "Under 0", is dropped.
      const rows = S.TIER_LABELS.map((label, j) => ({
        label,
        rightText: j === 0 ? `Under ${fmtVal(r.mode, r.thresholds[0])}` : r.thresholds[j - 1] <= 0 && r.mode === 'reps' ? 'Any' : `${fmtVal(r.mode, r.thresholds[j - 1])}${r.mode === 'added' && r.thresholds[j - 1] < 0 ? ' or more' : '+'}`,
        isCurrent: r.value != null && j === r.tier,
      })).filter((row, j) => !(j === 0 && r.thresholds[0] <= 0 && r.mode === 'reps'));
      let line;
      let sub = '';
      if (r.value == null) line = r.mode === 'added' ? 'Added weight: log a set with weight added to see this.' : 'Log a set to see this.';
      else if (r.mode === '1rm') {
        line = `${r.detail.method === 'actual' ? '1RM (logged single)' : 'Estimated 1RM'} ${fmtWeight(r.value)} &middot; <strong>${S.TIER_LABELS[r.tier]}</strong>`;
        sub = r.detail.method === 'actual' ? 'A real lift you logged.' : `Calculated from ${fmtWeight(r.detail.weight)} &times; ${r.detail.reps}.`;
      } else if (r.mode === 'reps') {
        line = `Best set at body weight ${fmtVal('reps', r.value)} &middot; <strong>${S.TIER_LABELS[r.tier]}</strong>`;
      } else {
        line = `Added weight, estimated 1RM ${fmtVal('added', r.value)} &middot; <strong>${S.TIER_LABELS[r.tier]}</strong>`;
        sub = `Calculated from body weight plus ${fmtWeight(r.detail.addedWeight)} &times; ${r.detail.reps}.`;
      }
      const title = info.results.length > 1 ? `<div class="insight-line"><strong>${r.mode === 'reps' ? 'Reps at body weight' : 'With added weight'}</strong></div>` : '';
      return `<div class="standards-block">${title}<div class="insight-line">${line}</div>${sub ? `<div class="insight-line muted-text">${sub}</div>` : ''}
        <div class="standards-preview">
          ${rows.map((row) => `<div class="standards-preview-row${row.isCurrent ? ' is-selected' : ''}"><span>${row.label}</span><span>${row.rightText}</span></div>`).join('')}
        </div></div>`;
    }).join('');
    const loadNote = { hand: 'Weights are per dumbbell.', bar: 'Weights include the bar.', machine: 'Weights are the stack as shown.' }[info.load] || '';
    const how = info.metric === '1rm' ? `Estimates use the Epley formula on sets of ${S.ONE_RM_MAX_REPS} reps or fewer. ` : '';
    return `
      <div class="card">
        ${head}
        <div class="insight-line"><strong>${escapeHtml(info.label)}</strong></div>
        ${blocks}
        <p class="muted-text field-hint">${how}${loadNote} Compared with Strength Level's tables for your sex and body weight: each tier means stronger than about 5%, 20%, 50%, 80% and 95% of lifters. See About the numbers in Settings.</p>
      </div>`;
  }

  // The running counterpart: Running Level's 5K tiers for your sex and age. Each
  // run is converted to its 5K-equivalent time first.
  function runStandardsDetailHtml(ex) {
    const info = runLevelInfo(ex);
    if (!info) return '';
    const head = '<div class="section-head"><div class="setting-row-label"><span class="setting-icon">'+STATIC_ICONS.trophy+'</span><h2>Running level</h2></div></div>';
    if (info.needsSex) return `<div class="card">${head}<p class="muted-text">Set your sex in Settings → Profile to see your running level.</p></div>`;
    if (!info.hasRuns) return '';
    if (!info.best) return `<div class="card">${head}<p class="muted-text">Log a run of 1 mile to a marathon with a time to see your running level.</p></div>`;
    const { entry, level } = info.best;
    const labels = S.RUN_TIER_LABELS;
    const rows = labels.map((label, j) => ({
      label,
      rightText: j === 0 ? `Slower than ${fmtDuration(level.thresholds[0])}` : `${fmtDuration(level.thresholds[j - 1])} or faster`,
      isCurrent: j === level.tier,
    }));
    return `
      <div class="card">
        ${head}
        <div class="insight-line">Best run ${fmtDistance(entry.distance)} in ${fmtDuration(entry.duration)} &middot; 5K equivalent ${fmtDuration(Math.round(level.equivalentSec))} &middot; <strong>${labels[level.tier]}</strong></div>
        <div class="standards-preview">
          ${rows.map((r) => `<div class="standards-preview-row${r.isCurrent ? ' is-selected' : ''}"><span>${r.label}</span><span>${r.rightText}</span></div>`).join('')}
        </div>
        <p class="muted-text field-hint">5K finish times for your sex, ${info.ageAssumed ? `with an adult age of ${info.age} assumed (add your age in Settings → Profile)` : `age ${info.age}`}. Runs from 1 mile to a marathon are converted to a 5K time with Riegel's formula, so the level is the best effort you have logged. Running Level's tiers: faster than about 5%, 20%, 50%, 80% and 95% of runners.</p>
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

  /* Home rows
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
    return { curText: isTimed(ex) ? fmtHold(cur) : String(cur), goalText: isTimed(ex) ? (ex.goal ? `/ ${fmtHold(ex.goal)}` : '') : (ex.goal ? `/ ${Math.round(ex.goal)} reps` : 'reps'), pct: ex.goal ? (cur / ex.goal) * 100 : null };
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
  function dailyTargetRowHtml(ex, repLabel) {
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
        <button type="button" class="btn btn-secondary btn-sm glance-btn" data-action="${isHabit ? 'log-habit' : 'log-daily'}">${isHabit ? (complete ? '+1' : 'Done') : (repLabel || 'Add')}</button>
      </div>`;
  }

  // Whether a trend delta is good news for this tracker, by its `direction`
  // (down: shrinking is good; otherwise growing). With no direction it stays neutral.
  function deltaSentiment(tracker, delta) {
    if (!tracker.direction || delta === 0) return 'neutral';
    return (tracker.direction === 'down' ? delta < 0 : delta > 0) ? 'good' : 'bad';
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

  /* Returning-user setup review
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
      <div class="modal-title-row"><h2>Review your tracking</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text">Fit Log has added tracking options and insight cards since you started — here's a chance to double check what's on. Nothing you've already logged changes either way.</p>
      <div class="card form-card">
        <div class="section-head"><h2>What do you track?</h2></div>
        ${setupBoolRowHtml('review_trackWorkout', 'Lifting', s.trackWorkout)}
        ${setupBoolRowHtml('review_trackCardio', 'Running & cardio', s.trackCardio)}
        ${setupBoolRowHtml('review_trackHabits', 'Daily (habits & reps)', s.trackHabits)}
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
        ${setupBoolRowHtml('review_showPaceLevel', 'Running level', s.showPaceLevel)}
        ${setupBoolRowHtml('review_showSleepInsights', 'Sleep insights', s.showSleepInsights)}
        ${setupBoolRowHtml('review_showMacroGuidance', 'Daily-value guidance', s.showMacroGuidance)}
      </div>
      <button type="button" class="btn btn-primary btn-block" id="setupReviewDoneBtn">Done</button>
    `, { tall: true });

    const rerender = () => openSetupReviewModal();
    wireSetupBoolRow('review_trackWorkout', (v) => { s.trackWorkout = v; if (v) autoImportFor('trackWorkout'); if (!save()) return; renderAll(); rerender(); });
    wireSetupBoolRow('review_trackCardio', (v) => { s.trackCardio = v; if (v) autoImportFor('trackCardio'); if (!save()) return; renderAll(); rerender(); });
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

  /* Home sections
     Each section belongs to one module and disappears with it. Home only reads existing data. */

  const dayLabel = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  function openLogCategory(cat) { logCategory = cat; switchTab('log'); }
  function openManageCategory(cat) { manageCategory = cat; switchTab('manage'); }

  // Home's Workout section: lifts and cardio. Habits and daily reps belong to Daily.
  function trainingExercises() {
    return activeExercises().filter((e) => !isDailyEx(e));
  }

  const homeSectionOn = (key) => F.homeSectionOn(state.settings, key);

  function renderChecklist(all) {
    const daily = homeSectionOn('checklist') ? all.filter((e) => isDailyEx(e) && (e.kind !== 'habit' || habitDueToday(e))) : [];
    document.getElementById('dailyTargetsHead').hidden = daily.length === 0;
    const done = daily.filter((e) => { const p = todayProgressOf(e); return p.pct != null && p.pct >= 100; }).length;
    document.getElementById('checklistCount').textContent = `${done} of ${daily.length} done`;
    const wrap = document.getElementById('dailyTargetsWrap');
    wrap.hidden = daily.length === 0;
    wrap.innerHTML = daily.map((e) => dailyTargetRowHtml(e, 'Log')).join('');
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
      const todays = entriesFor(ex.id).filter((x) => x.date === today);
      const sets = todays.reduce((n, x) => n + (x.sets ? x.sets.length : 0), 0);
      let en = todays[0];
      let val = entryValue(ex, en);
      todays.slice(1).forEach((x) => {
        const v = entryValue(ex, x);
        if (v != null && (val == null || (isLowerBetter(ex) ? v < val : v > val))) { en = x; val = v; }
      });
      const top = topSetOf(ex, en);
      const prior = entriesFor(ex.id).filter((x) => x.date < today).map((x) => entryValue(ex, x)).filter((v) => v != null);
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
              <div class="glance-sub">Today · ${ex.kind === 'cardio' ? escapeHtml(entrySummaryText(ex, en)) : `${sets} set${sets === 1 ? '' : 's'}${topText}`}</div>
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
              <div class="glance-name">Nothing logged yet today</div>
              <div class="glance-sub">${lastDate ? `Last workout ${dayLabel(lastDate)} · ${escapeHtml(names)}` : 'Log your first set to get started'}</div>
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
      // A run can have a distance goal and a pace goal; each gets its own row.
      const metrics = ex.kind === 'cardio' ? (cardioMetricsOf(ex).length ? cardioMetricsOf(ex) : ['distance']) : [undefined];
      metrics.forEach((metric) => {
        const goal = ex.kind === 'cardio' ? cardioGoalFor(ex, metric) : ex.goal;
        if (!goal) return;
        const { pct, best: b } = progressPct(ex, metric);
        items.push({ type: ex.kind === 'cardio' ? 'cardio' : 'lift', ex, name: exerciseLabel(ex), icon: exerciseIconHtml(ex), cur: formatValueForExercise(ex, b, metric), goal: goalLabelForExercise(ex, metric).replace('Goal ', ''), pct, met: pct >= 100, open: () => openExerciseDetail(ex.id) });
      });
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

  /* Progress charts
     Charts leads with one card per tracked area, all scoped by one range: the last 4, 12, 26
     or 52 weeks, Monday to Sunday. Details opens a sheet per area with the same range. Today
     and this week are drawn but not judged: they stay out of averages and on-target counts
     until they are over, and a day with nothing logged is left out rather than counted as 0. */
  const CHART_RANGES = [
    ['4w', '4W', 4, '4 weeks', 'the last 4 weeks'], ['12w', '12W', 12, '12 weeks', 'the last 12 weeks'],
    ['6m', '6M', 26, '6 months', 'the last 6 months'], ['1y', '1Y', 52, 'a year', 'the last year'],
  ];
  let chartRange = '12w';
  // Charts showing their table instead, by card id. Kept while the app is open.
  const chartTables = new Set();
  const ALERT_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  const rangeInfo = () => CHART_RANGES.find((r) => r[0] === chartRange);
  const addDays = (iso, n) => window.FitCalc.addDaysISO(iso, n);
  const weekOf = (iso) => window.FitCalc.weekStartISO(iso);
  function rangeWeeks() {
    const n = rangeInfo()[2];
    const cur = weekOf(todayISO());
    return Array.from({ length: n }, (_, i) => addDays(cur, -7 * (n - 1 - i)));
  }
  const rangeFrom = () => rangeWeeks()[0];
  // Daily columns only fit the 4-week range; longer ranges group days into weeks.
  const rangeIsDaily = () => chartRange === '4w';
  function daysBetween(from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  const fmtInt = (n) => Math.round(n).toLocaleString();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const signed = (n, dp = 1) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(round(n, dp))}`;
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const chartDay = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const weekLabel = (w) => (w === weekOf(todayISO()) ? 'This week' : chartDay(w));
  const dayTitle = (d) => (d === todayISO() ? 'Today' : chartDay(d));

  function rangeSegHtml() {
    return `<div class="segmented segmented-fill seg-sm chart-range" role="radiogroup" aria-label="Chart range">${segHtml(CHART_RANGES.map((r) => [r[0], r[1]]), chartRange)}</div>`;
  }

  function chartTableHtml(t) {
    return `<div class="cc-table-scroll"><table class="data-table">
      <thead><tr>${t.head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => (i ? `<td>${v}</td>` : `<th scope="row">${v}</th>`)).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  // One chart card: { id, icon, name, sub, open, extra, plot, table, legend, note, empty: { text, have, need } }.
  function chartCardHtml(c) {
    const asTable = !!c.table && chartTables.has(c.id);
    const head = `
      <div class="cc-head">
        ${c.icon || ''}
        <div class="cc-titles"><div class="cc-name">${c.name}</div>${c.sub ? `<div class="cc-sub">${c.sub}</div>` : ''}</div>
        ${c.open ? `<button type="button" class="link-btn cc-more" data-cc-open>Details${CHEVRON_RIGHT_SVG}</button>` : ''}
      </div>`;
    if (c.empty) {
      const { text, have, need } = c.empty;
      return `<div class="card chart-card" data-chart-card="${c.id}">${head}${c.extra || ''}
        <div class="cc-empty"><p>${text}</p>${need ? `<div class="meter meter-sm"><div class="meter-fill" style="--fill:${Math.min(100, (have / need) * 100)}%"></div></div><p class="muted-text">${have} of ${need} logged</p>` : ''}</div>
      </div>`;
    }
    return `<div class="card chart-card" data-chart-card="${c.id}">${head}${c.extra || ''}
      <div class="cc-plot"${asTable ? ' hidden' : ''}>${c.plot}</div>
      ${c.table ? `<div class="cc-table"${asTable ? '' : ' hidden'}>${chartTableHtml(c.table)}</div>` : ''}
      ${c.legend || c.table ? `<div class="cc-foot"><div class="cc-key">${c.legend || ''}</div>${c.table ? `<button type="button" class="link-btn" data-cc-table aria-pressed="${asTable}">${asTable ? 'Show chart' : 'Show table'}</button>` : ''}</div>` : ''}
      ${c.note ? `<p class="cc-note">${c.note}</p>` : ''}
    </div>`;
  }

  function wireChartCards(root, cards) {
    cards.forEach((c) => {
      const el = root.querySelector(`[data-chart-card="${c.id}"]`);
      if (!el) return;
      const more = el.querySelector('[data-cc-open]');
      if (more && c.open) more.addEventListener('click', c.open);
      const tbl = el.querySelector('[data-cc-table]');
      if (tbl) tbl.addEventListener('click', () => {
        const on = !chartTables.has(c.id);
        if (on) chartTables.add(c.id); else chartTables.delete(c.id);
        el.querySelector('.cc-plot').hidden = on;
        el.querySelector('.cc-table').hidden = !on;
        tbl.setAttribute('aria-pressed', String(on));
        tbl.textContent = on ? 'Show chart' : 'Show table';
      });
    });
    Charts.wire(root);
  }

  const keyItem = (swatch, text) => `<span><i class="${swatch}"></i>${text}</span>`;

  function kpiRowHtml(tiles) {
    if (!tiles.length) return '';
    return `<div class="kpi-row">${tiles.map((t) => `<div class="kpi"><b>${t.value}${t.unit ? ` <small>${t.unit}</small>` : ''}</b><span>${t.label}</span></div>`).join('')}</div>`;
  }

  /* Workout */

  function workoutWeekRows(weeks) {
    const rows = Object.fromEntries(weeks.map((w) => [w, { week: w, dates: new Set(), logged: 0 }]));
    state.entries.forEach((e) => {
      if (isDailyEntry(e) || e.date > todayISO()) return;
      const row = rows[weekOf(e.date)];
      if (row) { row.dates.add(e.date); row.logged++; }
    });
    return weeks.map((w) => ({ ...rows[w], days: rows[w].dates.size }));
  }

  function workoutOverviewCard() {
    if (!domainTracked('workout')) return null;
    const base = { id: 'workout', icon: itemIconHtml('dumbbell'), name: 'Workout', open: () => openWorkoutCharts() };
    if (!state.entries.some((e) => !isDailyEntry(e))) return { ...base, empty: { text: 'Log a workout and your weeks show up here.' } };
    const rows = workoutWeekRows(rangeWeeks());
    const firstWeek = weekOf(state.entries.filter((e) => !isDailyEntry(e)).map((e) => e.date).sort()[0]);
    const done = rows.slice(0, -1).filter((r) => r.week >= firstWeek);
    const cur = rows[rows.length - 1];
    const avg = mean(done.map((r) => r.days)) || 0;
    const best = Math.max(0, ...done.map((r) => r.days));
    const bestIdx = best ? done.map((r) => r.days).lastIndexOf(best) : -1;
    const bars = rows.map((r, i) => {
      const now = i === rows.length - 1;
      return {
        value: r.days,
        tone: now ? 'now' : '',
        label: i === bestIdx ? `${r.days} best` : now && r.days ? String(r.days) : '',
        tip: { title: now ? 'This week, so far' : `Week of ${chartDay(r.week)}`, rows: [['Workout days', String(r.days)], ['Exercises logged', String(r.logged)]] },
      };
    });
    return {
      ...base,
      sub: done.some((r) => r.days) ? `${round(avg, 1)} ${round(avg, 1) === 1 ? 'day' : 'days'} a week on average` : `${plural(cur.days, 'day')} this week so far`,
      plot: Charts.columns(bars, { max: 7, height: 116, first: chartDay(rows[0].week), last: 'This week, so far', label: `Workout days per week over ${rangeInfo()[3]}: ${round(avg, 1)} on average, best ${best}, this week ${cur.days} so far` }),
      table: { head: ['Week of', 'Days', 'Exercises'], rows: rows.map((r) => [weekLabel(r.week), r === cur ? `${r.days} so far` : String(r.days), String(r.logged)]) },
    };
  }

  // One value per session date for a lift or bodyweight movement: { date, value, detail }.
  // Values are in display units so the axis and the readout agree.
  function sessionSeries(ex, metric) {
    const byDate = {};
    entriesFor(ex.id).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(...(e.sets || [])); });
    const out = [];
    Object.keys(byDate).sort().forEach((date) => {
      const sets = byDate[date];
      if (ex.kind === 'weight') {
        const done = sets.filter((st) => st.reps > 0 && st.weight != null);
        if (!done.length) return;
        if (metric === 'vol') {
          const v = done.reduce((t, st) => t + st.weight * st.reps, 0);
          out.push({ date, value: Units.lbToDisplay(v), detail: plural(done.length, 'set') });
        } else if (metric === '1rm') {
          let best = null;
          done.forEach((st) => { const e = S.estimateOneRM(st.weight, st.reps); if (e && (!best || e.value > best.value)) best = { value: e.value, st }; });
          if (best) out.push({ date, value: Units.lbToDisplay(best.value), detail: `from ${fmtWeight(best.st.weight)} × ${best.st.reps}` });
        } else {
          const top = done.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps) ? b : a));
          out.push({ date, value: Units.lbToDisplay(top.weight), detail: `× ${top.reps}` });
        }
      } else if (ex.kind === 'reps') {
        const reps = sets.map((st) => st.reps).filter((r) => r > 0);
        if (!reps.length) return;
        out.push(metric === 'vol'
          ? { date, value: reps.reduce((a, b) => a + b, 0), detail: plural(reps.length, 'set') }
          : { date, value: Math.max(...reps), detail: '' });
      }
    });
    return out;
  }

  // Cardio entries keep distance and time on the entry, not in sets.
  function cardioSeries(ex, metric) {
    const byDate = {};
    entriesFor(ex.id).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    const out = [];
    Object.keys(byDate).sort().forEach((date) => {
      const vals = byDate[date].map((e) => entryValue(ex, e, metric)).filter((v) => v != null);
      if (!vals.length) return;
      const v = metric === 'pace' ? Math.min(...vals) : Math.max(...vals);
      out.push({ date, value: metric === 'pace' ? Units.secPerMiToDisplaySecPerUnit(v) : Units.miToDisplay(v), raw: v, detail: '' });
    });
    return out;
  }

  function movementMetrics(ex) {
    if (ex.kind === 'weight') return [['1rm', 'Est. 1RM'], ['top', 'Top set'], ['vol', 'Volume']];
    if (ex.kind === 'reps') return isTimed(ex) ? [['top', 'Longest'], ['vol', 'Total time']] : [['top', 'Best set'], ['vol', 'Total reps']];
    const hasPace = entriesFor(ex.id).some((e) => entryValue(ex, e, 'pace') != null);
    return hasPace ? [['dist', 'Distance'], ['pace', 'Pace']] : [['dist', 'Distance']];
  }

  // How a display-unit value reads for this movement and metric.
  function movementFormat(ex, metric) {
    if (ex.kind === 'weight') return (v) => `${round(v, 1)} ${Units.weightUnitLabel()}`;
    if (ex.kind === 'reps') return (v) => fmtCount(ex, v);
    if (metric === 'pace') return (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')} /${Units.distanceUnitLabel()}`;
    return (v) => `${round(v, 2)} ${Units.distanceUnitLabel()}`;
  }

  // Whether a goal sits close enough to the data to draw without squashing the line.
  function goalFits(goal, values) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = Math.max(hi - lo, Math.abs(hi) * 0.04, 1);
    return goal >= lo - span * 2 && goal <= hi + span * 2;
  }

  function movementCard(ex, metric) {
    const from = rangeFrom();
    const all = ex.kind === 'cardio' ? cardioSeries(ex, metric) : sessionSeries(ex, metric);
    const pts = all.filter((p) => p.date >= from);
    const fmt = movementFormat(ex, metric);
    const metrics = movementMetrics(ex);
    const extra = metrics.length > 1 ? `<div class="segmented segmented-fill seg-sm cc-metric" role="radiogroup" aria-label="Measure">${segHtml(metrics, metric)}</div>` : '';
    const base = { id: `mv-${metric}`, name: exerciseLabelHtml(ex), extra };
    if (all.length < 2) return { ...base, empty: { text: 'Log a second session to draw a line.', have: all.length, need: 2 } };
    if (pts.length < 2) return { ...base, sub: `Last session ${chartDay(all[all.length - 1].date)}`, empty: { text: `Fewer than 2 sessions in ${rangeInfo()[4]}. Try a longer range.` } };
    const subs = [];
    let band = null;
    const showsLoad = ex.kind === 'weight' && metric !== 'vol';
    const lvl = ex.kind === 'weight' ? strengthLevelInfo(ex) : null;
    const res = lvl && !lvl.missing && lvl.results.find((r) => r.mode === '1rm');
    if (res && res.value != null) {
      const t = res.tier;
      const lo = t ? res.thresholds[t - 1] : 0;
      const hi = t < 5 ? res.thresholds[t] : null;
      subs.push(hi != null ? `${S.TIER_LABELS[t]} now, ${fmtWeight(hi - res.value)} to ${S.TIER_LABELS[t + 1]}` : `${S.TIER_LABELS[t]} now`);
      if (metric === '1rm') {
        const vals = pts.map((p) => p.value);
        const pad = Math.max((Math.max(...vals) - Math.min(...vals)) * 0.6, Math.max(...vals) * 0.05);
        const blo = Math.max(Units.lbToDisplay(lo), Math.min(...vals) - pad);
        const bhi = Math.min(hi != null ? Units.lbToDisplay(hi) : Infinity, Math.max(...vals) + pad);
        if (bhi > blo) band = { lo: blo, hi: bhi, text: S.TIER_LABELS[t] };
      }
    }
    let goal = null;
    if (showsLoad && ex.goal) {
      const g = Units.lbToDisplay(ex.goal);
      if (goalFits(g, pts.map((p) => p.value))) goal = g;
      else subs.push(`Goal ${fmtWeight(ex.goal)} ${g > pts[pts.length - 1].value ? 'above' : 'below'}`);
    }
    const name = metrics.find((m) => m[0] === metric)[1];
    return {
      ...base,
      sub: subs.join(' · '),
      plot: Charts.line({
        from, to: todayISO(), dots: pts, connect: true, goal, goalText: goal != null ? `Goal ${round(goal, 1)}` : '', band,
        format: metric === 'pace' ? (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}` : Charts.compact,
        tipRows: (d) => { const p = pts.find((q) => q.date === d); return [[name, `${fmt(p.value)}${p.detail ? ` ${p.detail}` : ''}`]]; },
        label: `${exerciseLabel(ex)}, ${name} over ${rangeInfo()[3]}: from ${fmt(pts[0].value)} to ${fmt(pts[pts.length - 1].value)}`,
      }),
      legend: band ? keyItem('sw band', 'Your strength level') : '',
      table: { head: ['Date', name], rows: pts.map((p) => [chartDay(p.date), `${fmt(p.value)}${p.detail ? ` ${p.detail}` : ''}`]) },
    };
  }

  function movementTiles(ex) {
    const from = rangeFrom();
    const entries = entriesFor(ex.id).filter((e) => e.date >= from && e.date <= todayISO());
    const sessions = new Set(entries.map((e) => e.date)).size;
    const tiles = [];
    if (ex.kind === 'weight') {
      const orm = sessionSeries(ex, '1rm').filter((p) => p.date >= from);
      if (orm.length) {
        const last = orm[orm.length - 1].value;
        const change = last - orm[0].value;
        tiles.push({ value: round(last, 1), unit: Units.weightUnitLabel(), label: orm.length > 1 && Math.abs(change) >= 0.05 ? `Est. 1RM, ${change > 0 ? 'up' : 'down'} ${Math.abs(round(change, 1))}` : 'Est. 1RM' });
      }
      const sets = entries.flatMap((e) => e.sets || []).filter((st) => st.reps > 0 && st.weight != null);
      if (sets.length) {
        const top = sets.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps) ? b : a));
        tiles.push({ value: `${round(Units.lbToDisplay(top.weight), 1)} × ${top.reps}`, label: 'Heaviest set' });
      }
    } else if (ex.kind === 'reps') {
      const pts = sessionSeries(ex, 'top').filter((p) => p.date >= from);
      const tot = sessionSeries(ex, 'vol').filter((p) => p.date >= from);
      if (pts.length) tiles.push({ value: fmtCount(ex, Math.max(...pts.map((p) => p.value))), label: isTimed(ex) ? 'Longest hold' : 'Best set' });
      if (tot.length) tiles.push({ value: fmtCount(ex, tot.reduce((t, p) => t + p.value, 0)), label: isTimed(ex) ? 'Total time' : 'Total reps' });
    } else {
      const dist = cardioSeries(ex, 'dist').filter((p) => p.date >= from);
      const pace = cardioSeries(ex, 'pace').filter((p) => p.date >= from);
      if (dist.length) tiles.push({ value: fmtDistance(Math.max(...dist.map((p) => p.raw))), label: 'Longest' });
      if (pace.length) tiles.push({ value: fmtPace(Math.min(...pace.map((p) => p.raw))), label: 'Best pace' });
    }
    tiles.push({ value: String(sessions), label: sessions === 1 ? 'Session' : 'Sessions' });
    return tiles;
  }

  function weeklyVolumeCard() {
    const weeks = rangeWeeks();
    const vol = Object.fromEntries(weeks.map((w) => [w, 0]));
    state.entries.forEach((e) => {
      const ex = exerciseById(e.exerciseId);
      if (!ex || ex.kind !== 'weight' || isDailyEx(ex) || e.date > todayISO() || !(weekOf(e.date) in vol)) return;
      (e.sets || []).forEach((st) => { if (st.reps > 0 && st.weight != null) vol[weekOf(e.date)] += st.weight * st.reps; });
    });
    const vals = weeks.map((w) => Units.lbToDisplay(vol[w]));
    if (!vals.some((v) => v > 0)) return null;
    const done = vals.slice(0, -1);
    const best = Math.max(0, ...done);
    const bestIdx = best ? done.lastIndexOf(best) : -1;
    const unit = Units.weightUnitLabel();
    const bars = vals.map((v, i) => {
      const now = i === vals.length - 1;
      return { value: v, tone: now ? 'now' : '', label: i === bestIdx || (now && v) ? Charts.compact(v) : '', tip: { title: now ? 'This week, so far' : `Week of ${chartDay(weeks[i])}`, rows: [['Volume', `${fmtInt(v)} ${unit}`]] } };
    });
    return {
      id: 'volume', name: 'Weekly volume', sub: `All lifts, weight × reps, ${unit}`,
      plot: Charts.columns(bars, { height: 112, first: chartDay(weeks[0]), last: 'This week, so far', label: `Weekly lifting volume over ${rangeInfo()[3]}, best week ${fmtInt(best)} ${unit}` }),
      table: { head: ['Week of', `Volume, ${unit}`], rows: weeks.map((w, i) => [weekLabel(w), `${fmtInt(vals[i])}${i === weeks.length - 1 ? ' so far' : ''}`]) },
    };
  }

  // All-time records for one movement: [{ label, sub, value }].
  function movementRecords(ex) {
    const out = [];
    const sets = [];
    entriesFor(ex.id).forEach((e) => (e.sets || []).forEach((st) => sets.push({ ...st, date: e.date })));
    const pick = (list, better) => list.reduce((a, b) => (better(b, a) ? b : a));
    if (ex.kind === 'weight') {
      const done = sets.filter((st) => st.reps > 0 && st.weight != null);
      if (!done.length) return out;
      const heavy = pick(done, (b, a) => b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps));
      out.push({ label: 'Heaviest', sub: fmtDateShort(heavy.date), value: `${fmtWeight(heavy.weight)} × ${heavy.reps}` });
      const ests = done.map((st) => ({ st, e: S.estimateOneRM(st.weight, st.reps) })).filter((x) => x.e);
      if (ests.length) {
        const b = pick(ests, (x, y) => x.e.value > y.e.value);
        out.push({ label: 'Est. 1RM', sub: `${fmtDateShort(b.st.date)} · from ${fmtWeight(b.st.weight)} × ${b.st.reps}`, value: fmtWeight(b.e.value) });
      }
      const most = pick(done, (b, a) => b.reps > a.reps || (b.reps === a.reps && b.weight > a.weight));
      out.push({ label: 'Most reps', sub: `${fmtDateShort(most.date)} · at ${fmtWeight(most.weight)}`, value: `${most.reps} reps` });
    } else if (ex.kind === 'reps') {
      const done = sets.filter((st) => st.reps > 0);
      if (!done.length) return out;
      const most = pick(done, (b, a) => b.reps > a.reps);
      out.push({ label: isTimed(ex) ? 'Longest hold' : 'Most in a set', sub: fmtDateShort(most.date), value: fmtCount(ex, most.reps) });
      const tot = sessionSeries(ex, 'vol');
      const bestDay = pick(tot, (b, a) => b.value > a.value);
      out.push({ label: isTimed(ex) ? 'Most in a day' : 'Most in a day', sub: fmtDateShort(bestDay.date), value: fmtCount(ex, bestDay.value) });
    } else {
      const dist = cardioSeries(ex, 'dist');
      const pace = cardioSeries(ex, 'pace');
      if (dist.length) { const b = pick(dist, (x, y) => x.raw > y.raw); out.push({ label: 'Longest', sub: fmtDateShort(b.date), value: fmtDistance(b.raw) }); }
      if (pace.length) { const b = pick(pace, (x, y) => x.raw < y.raw); out.push({ label: 'Fastest pace', sub: fmtDateShort(b.date), value: fmtPace(b.raw) }); }
    }
    return out;
  }

  function openWorkoutCharts(exId) {
    const movements = activeExercises()
      .filter((ex) => !isDailyEx(ex) && entriesFor(ex.id).length)
      .sort((a, b) => entriesFor(b.id).length - entriesFor(a.id).length);
    let selId = movements.some((m) => m.id === exId) ? exId : movements[0] && movements[0].id;
    const metricFor = {};
    openChartSheet('Workout', itemIconHtml('dumbbell'), (body, repaint) => {
      const ex = exerciseById(selId);
      const cards = [];
      let html = '';
      if (ex) {
        const metrics = movementMetrics(ex);
        if (!metricFor[ex.id] || !metrics.some((m) => m[0] === metricFor[ex.id])) {
          metricFor[ex.id] = ex.kind === 'weight' && !(strengthLevelInfo(ex) || {}).results ? 'top' : metrics[0][0];
        }
        const card = movementCard(ex, metricFor[ex.id]);
        cards.push(card);
        const recs = movementRecords(ex);
        html += `
          <div class="f-scroll"><div class="f-chips" id="chartMoveChips" role="radiogroup" aria-label="Movement">${movements.map((m) => chipHtml(m.id, exerciseLabelHtml(m), null, m.id === selId)).join('')}</div></div>
          ${chartCardHtml(card)}
          ${kpiRowHtml(movementTiles(ex))}`;
        const vol = weeklyVolumeCard();
        if (vol) { cards.push(vol); html += chartCardHtml(vol); }
        if (recs.length) {
          html += `<div class="section-head"><h2>Records</h2><span class="muted-text">${exerciseLabelHtml(ex)}</span></div>
            <div class="card card-list">${recs.map((r) => `<div class="entry-row rec-row"><div class="entry-row-main"><div class="entry-row-title">${r.label}</div><div class="entry-row-sub">${r.sub}</div></div><div class="rec-value">${r.value}</div></div>`).join('')}</div>`;
        }
      } else {
        const vol = weeklyVolumeCard();
        if (vol) { cards.push(vol); html += chartCardHtml(vol); }
        html += '<div class="empty-state"><p>Log a lift, a bodyweight exercise or a run and its chart shows up here.</p></div>';
      }
      body.innerHTML = html;
      const chips = body.querySelector('#chartMoveChips');
      if (chips) {
        wireFScroll(chips);
        refreshFScroll(chips);
        chips.addEventListener('click', (ev) => { const b = ev.target.closest('[data-chip]'); if (b) { selId = b.dataset.chip; repaint(); } });
        const on = chips.querySelector('[aria-checked="true"]');
        if (on) chips.scrollLeft = Math.max(0, on.offsetLeft - 20);
      }
      const seg = body.querySelector('.cc-metric');
      if (seg) seg.addEventListener('click', (ev) => { const b = ev.target.closest('[data-seg]'); if (b) { metricFor[selId] = b.dataset.seg; repaint(); } });
      wireChartCards(body, cards);
    });
  }

  /* Daily */

  const DAILY_STATE_LABELS = { done: 'Done', part: 'Partly', miss: 'Missed', off: 'Not due', open: 'Not yet' };

  // One item's square for one day. Every-other-day and weekly items are only due once
  // enough days have passed since they were last done, and nothing is due before the
  // first check-in.
  function dailyCellState(ex, iso, byDate, firstDate) {
    const list = byDate[iso] || [];
    const goal = ex.kind === 'habit' ? ex.goal || 1 : ex.goal;
    const amount = ex.kind === 'habit' ? list.length : list.reduce((t, e) => t + (e.sets || []).reduce((m, st) => m + (st.reps || 0), 0), 0);
    if (list.length) return !goal || amount >= goal ? 'done' : 'part';
    if (iso === todayISO()) return 'open';
    if (!firstDate || iso < firstDate) return 'off';
    const gap = ex.kind === 'habit' ? habitRepeatDays(ex) : 1;
    if (gap > 1) {
      const prev = Object.keys(byDate).filter((d) => d < iso).sort().pop();
      if (prev && dayGap(prev, iso) < gap) return 'off';
    }
    return 'miss';
  }

  function dailyOverviewCard() {
    if (!domainTracked('daily')) return null;
    const items = activeExercises().filter(isDailyEx);
    if (!items.length) return null;
    const base = { id: 'daily', icon: `<span class="item-icon" aria-hidden="true">${STATIC_ICONS.daily}</span>`, name: 'Daily', open: () => { historyCategory = 'daily'; switchTab('history'); } };
    if (!items.some((ex) => entriesFor(ex.id).length)) return { ...base, empty: { text: 'Check in on a Daily item and your days show up here.' } };
    const dates = daysBetween(addDays(todayISO(), -13), todayISO());
    const rows = items.map((ex) => {
      const byDate = {};
      entriesFor(ex.id).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
      const first = Object.keys(byDate).sort()[0];
      const cells = dates.map((d) => dailyCellState(ex, d, byDate, first));
      const past = cells.slice(0, -1);
      return { name: exerciseLabel(ex), cells, done: past.filter((c) => c === 'done').length, part: past.filter((c) => c === 'part').length, miss: past.filter((c) => c === 'miss').length };
    });
    const ranked = rows.slice().sort((a, b) => b.done - a.done);
    let sub;
    if (rows.length === 1) sub = `Done ${rows[0].done} of the last 13 days`;
    else if (!ranked[0].done) sub = 'Nothing checked in the last 2 weeks';
    else if (ranked[1].done === ranked[0].done || ranked[1].done >= 9) sub = `${escapeHtml(ranked[0].name)} and ${escapeHtml(ranked[1].name)} are the steadiest`;
    else sub = `${escapeHtml(ranked[0].name)} is the steadiest`;
    const tips = dates.map((d, i) => ({ title: dayTitle(d), rows: rows.map((r) => ['', `${r.name}: ${DAILY_STATE_LABELS[r.cells[i]]}`]) }));
    return {
      ...base,
      sub,
      plot: Charts.heatmap(rows, dates, tips, `Daily items over the last 14 days: ${rows.map((r) => `${r.name} done ${r.done} of 13`).join(', ')}`),
      legend: ['done', 'part', 'miss', 'off'].map((k) => keyItem(`sw hm-${k}`, DAILY_STATE_LABELS[k])).join(''),
      note: 'Weekly items only get a square on the days they are due. Today stays open until midnight.',
      table: { head: ['Item', 'Done', 'Partly', 'Missed'], rows: rows.map((r) => [escapeHtml(r.name), String(r.done), String(r.part), String(r.miss)]) },
    };
  }

  /* Body */

  // A tracker's readings in display units, one per day (the last one logged that day).
  function trackerPoints(t) {
    const byDate = {};
    measurementsFor(t.id).filter((m) => m.value != null).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id)).forEach((m) => { byDate[m.date] = m; });
    return Object.keys(byDate).sort().map((d) => ({ date: d, value: Number(trackerDisplayFromCanonical(t, byDate[d].value)) }));
  }
  const trackerFmt = (t) => (v) => `${round(v, 1)}${trackerUnitLabel(t) ? ` ${trackerUnitLabel(t)}` : ''}`;
  const trackerNoun = (t) => (t.id === BODY_WEIGHT_TRACKER_ID ? ['weigh-in', 'weigh-ins'] : t.unitKind === 'hours' ? ['night', 'nights'] : ['entry', 'entries']);
  const SLEEP_BAND = { lo: 7, hi: 9 };

  // The trend pieces a Body chart and its tiles share: points in range, the 7-day average
  // (daily trackers only), the change over the range and the pace toward the goal.
  function trackerTrend(t) {
    const all = trackerPoints(t);
    const from = rangeFrom();
    const pts = all.filter((p) => p.date >= from && p.date <= todayISO());
    const daily = window.FitCalc.loggingRhythm(all.map((p) => p.date)) === 'day';
    const avg = daily ? window.FitCalc.trailingAverage(all, 7).filter((p) => p.date >= from && p.date <= todayISO()) : pts;
    const goal = t.goal != null ? Number(trackerDisplayFromCanonical(t, t.goal)) : null;
    const last = avg.length ? avg[avg.length - 1].value : null;
    const recent = all.filter((p) => p.date >= addDays(todayISO(), -27));
    const trend = window.FitCalc.linearTrend(recent);
    let weeksToGoal = null;
    if (trend && goal != null && last != null && Math.abs(trend.slope) > 1e-6) {
      const days = (goal - last) / trend.slope;
      if (days > 0) weeksToGoal = days / 7;
    }
    const reached = goal != null && last != null && (t.direction === 'down' ? last <= goal : last >= goal);
    return { all, pts, avg, daily, goal, last, trend, weeksToGoal: reached ? null : weeksToGoal, reached };
  }

  function sleepColumnsCard(t, base) {
    const all = trackerPoints(t);
    const from = rangeFrom();
    const byDate = Object.fromEntries(all.map((p) => [p.date, p.value]));
    const fmt = trackerFmt(t);
    const isSleep = t.kind === 'sleep';
    const goal = t.goal != null ? Number(t.goal) : null;
    const inRange = all.filter((p) => p.date >= from && p.date <= todayISO());
    const avgAll = mean(inRange.map((p) => p.value));
    const under = inRange.filter((p) => p.value < SLEEP_BAND.lo).length;
    let bars;
    let table;
    let first;
    if (rangeIsDaily()) {
      const dates = daysBetween(from, todayISO());
      const lastLogged = inRange.length ? inRange[inRange.length - 1].date : null;
      bars = dates.map((d) => ({ value: byDate[d] || 0, tone: d === lastLogged ? 'now' : '', label: d === lastLogged ? round(byDate[d], 1) : '', tip: byDate[d] != null ? { title: dayTitle(d), rows: [[t.name, fmt(byDate[d])]] } : { title: dayTitle(d), rows: [['', 'Nothing logged']] } }));
      first = chartDay(dates[0]);
      table = { head: ['Date', 'Hours'], rows: inRange.map((p) => [chartDay(p.date), fmt(p.value)]) };
    } else {
      const weeks = rangeWeeks();
      const avgs = weeks.map((w) => mean(inRange.filter((p) => weekOf(p.date) === w).map((p) => p.value)));
      bars = weeks.map((w, i) => ({ value: avgs[i] || 0, tone: i === weeks.length - 1 ? 'now' : '', tip: { title: i === weeks.length - 1 ? 'This week, so far' : `Week of ${chartDay(w)}`, rows: [[avgs[i] != null ? 'a night on average' : '', avgs[i] != null ? fmt(avgs[i]) : 'Nothing logged']] } }));
      first = chartDay(weeks[0]);
      table = { head: ['Week of', 'Average'], rows: weeks.map((w, i) => [weekLabel(w), avgs[i] != null ? fmt(avgs[i]) : '—']) };
    }
    return {
      ...base,
      sub: avgAll != null ? `${round(avgAll, 1)} hr average${isSleep ? `, ${under} of ${plural(inRange.length, 'night')} under 7 hr` : ''}` : '',
      plot: Charts.columns(bars, {
        height: 124, max: Math.max(10, Charts.niceMax(Math.max(...bars.map((b) => b.value), goal || 0))), goal: isSleep ? null : goal,
        band: isSleep ? { ...SLEEP_BAND, text: '7–9 hr guideline for adults' } : null,
        first, last: rangeIsDaily() ? 'Last night' : 'This week', label: `${t.name} over ${rangeInfo()[3]}${avgAll != null ? `, ${round(avgAll, 1)} hours on average` : ''}`,
      }),
      legend: isSleep ? keyItem('sw band', '7–9 hr guideline') : '',
      table,
    };
  }

  function trackerChartCard(t, { withEstimate = false, open } = {}) {
    const base = { id: `trk-${t.id}`, name: escapeHtml(t.name), open };
    const [one, many] = trackerNoun(t);
    const all = trackerPoints(t);
    const need = t.unitKind === 'hours' ? 1 : 3;
    if (all.length < need) return { ...base, empty: { text: `Log ${need} ${need === 1 ? one : many} to see a trend.`, have: all.length, need } };
    if (t.unitKind === 'hours') return sleepColumnsCard(t, base);
    const tr = trackerTrend(t);
    const fmt = trackerFmt(t);
    const unit = trackerUnitLabel(t);
    if (tr.pts.length < 2) {
      const last = all[all.length - 1];
      return { ...base, sub: `Last ${fmt(last.value)} on ${chartDay(last.date)}`, empty: { text: `Fewer than 2 ${many} in ${rangeInfo()[4]}. Try a longer range.` } };
    }
    const vals = [...tr.pts, ...tr.avg].map((p) => p.value);
    const goalOn = tr.goal != null && goalFits(tr.goal, vals);
    const change = tr.avg[tr.avg.length - 1].value - tr.avg[0].value;
    const span = tr.avg[0].date > addDays(rangeFrom(), 7) ? `since ${chartDay(tr.avg[0].date)}` : `in ${rangeInfo()[3]}`;
    const subs = [Math.abs(change) < 0.05 ? `Steady ${span}` : `${change < 0 ? 'Down' : 'Up'} ${round(Math.abs(change), 1)}${unit ? ` ${unit}` : ''} ${span}`];
    if (tr.goal != null) subs.push(tr.reached ? 'goal reached' : `${round(Math.abs(tr.goal - tr.last), 1)}${unit ? ` ${unit}` : ''} to goal${goalOn ? '' : ` (${tr.goal > tr.last ? 'above' : 'below'})`}`);
    let estimate = null;
    if (withEstimate && tr.weeksToGoal != null && goalOn) {
      const lastDate = tr.avg[tr.avg.length - 1].date;
      const ext = Math.max(1, Math.min(tr.weeksToGoal * 7, rangeInfo()[2] * 7 * 0.25));
      estimate = [{ date: lastDate, value: tr.last }, { date: addDays(lastDate, Math.round(ext)), value: tr.last + tr.trend.slope * Math.round(ext) }];
    }
    const avgByDate = Object.fromEntries(tr.avg.map((p) => [p.date, p.value]));
    const dotNoun = one[0].toUpperCase() + one.slice(1);
    return {
      ...base,
      sub: subs.join(', '),
      plot: Charts.line({
        from: rangeFrom(), to: todayISO(), dots: tr.pts, avg: tr.daily ? tr.avg : null, connect: !tr.daily,
        goal: goalOn ? tr.goal : null, goalText: goalOn ? `Goal ${round(tr.goal, 1)}` : '', estimate,
        tipRows: (d) => {
          const p = tr.pts.find((q) => q.date === d);
          const rows = p ? [[one, fmt(p.value), 'dot']] : [];
          if (tr.daily && avgByDate[d] != null) rows.push(['7-day average', fmt(avgByDate[d]), 'line']);
          return rows;
        },
        label: `${t.name} over ${rangeInfo()[3]}: ${subs.join(', ')}`,
      }),
      legend: tr.daily
        ? [keyItem('dt', `${dotNoun}s`), keyItem('ln', '7-day average'), estimate ? keyItem('ln est', 'Estimate') : ''].join('')
        : estimate ? keyItem('ln est', 'Estimate') : '',
      table: { head: tr.daily ? ['Date', dotNoun, '7-day avg'] : ['Date', dotNoun], rows: tr.pts.map((p) => (tr.daily ? [chartDay(p.date), fmt(p.value), fmt(avgByDate[p.date])] : [chartDay(p.date), fmt(p.value)])) },
      note: estimate && tr.weeksToGoal <= 104 ? `Estimate: about ${new Date(addDays(todayISO(), Math.round(tr.weeksToGoal * 7)) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} at the pace of the last 4 weeks.` : '',
    };
  }

  function trackerTiles(t) {
    const fmt = trackerFmt(t);
    const unit = trackerUnitLabel(t);
    const from = rangeFrom();
    if (t.unitKind === 'hours') {
      const pts = trackerPoints(t).filter((p) => p.date >= from && p.date <= todayISO());
      if (!pts.length) return [];
      const tiles = [{ value: round(mean(pts.map((p) => p.value)), 1), unit, label: 'Average' }];
      if (t.kind === 'sleep') tiles.push({ value: `${pts.filter((p) => p.value < SLEEP_BAND.lo).length}`, label: 'Nights under 7 hr' });
      tiles.push({ value: round(pts[pts.length - 1].value, 1), unit, label: `Last, ${chartDay(pts[pts.length - 1].date)}` });
      return tiles;
    }
    const tr = trackerTrend(t);
    if (!tr.pts.length) return [];
    const tiles = [{ value: round(tr.last, 1), unit, label: tr.daily ? '7-day average' : 'Latest' }];
    if (tr.trend) tiles.push({ value: signed(tr.trend.slope * 7), unit, label: 'a week, last 4 weeks' });
    if (tr.goal != null) {
      if (tr.reached) tiles.push({ value: fmt(tr.goal), label: 'Goal reached' });
      else if (tr.weeksToGoal != null && tr.weeksToGoal <= 104) tiles.push({ value: `~${Math.max(1, Math.round(tr.weeksToGoal))}`, unit: 'wk', label: 'to goal at this pace' });
      else tiles.push({ value: round(Math.abs(tr.goal - tr.last), 1), unit, label: 'to goal' });
    }
    return tiles;
  }

  function bodyOverviewCard() {
    if (!domainTracked('measurements')) return null;
    const trackers = activeTrackers();
    if (!trackers.length) return null;
    const t = trackers.find((x) => x.id === BODY_WEIGHT_TRACKER_ID && measurementsFor(x.id).length)
      || trackers.find((x) => measurementsFor(x.id).length) || trackers[0];
    const card = trackerChartCard(t, { open: () => openBodyCharts(t.id) });
    const sub = t.id === BODY_WEIGHT_TRACKER_ID || !card.sub ? card.sub : `${escapeHtml(t.name)}: ${card.sub.charAt(0).toLowerCase()}${card.sub.slice(1)}`;
    return { ...card, id: 'body', name: 'Body', icon: itemIconHtml('scale'), sub };
  }

  function bodyNoteHtml(t) {
    if (t.unitKind === 'hours') return '';
    const parts = [];
    if (trackerTrend(t).daily) parts.push('Dots are single readings; the line is the 7-day average, so one odd day does not move it.');
    if (t.goal != null) parts.push('The estimate only shows when the last 4 weeks move toward the goal.');
    return parts.length ? `<p class="cc-note">${parts.join(' ')}</p>` : '';
  }

  function openBodyCharts(trackerId) {
    const trackers = activeTrackers();
    let selId = trackers.some((t) => t.id === trackerId) ? trackerId : trackers[0] && trackers[0].id;
    openChartSheet('Body', itemIconHtml('scale'), (body, repaint) => {
      const t = trackerById(selId);
      if (!t) { body.innerHTML = '<div class="empty-state"><p>Add a tracker in Manage, Body, and its chart shows up here.</p></div>'; return; }
      const card = trackerChartCard(t, { withEstimate: true });
      body.innerHTML = `
        <div class="f-scroll"><div class="f-chips" id="chartTrackerChips" role="radiogroup" aria-label="Tracker">${trackers.map((x) => chipHtml(x.id, escapeHtml(x.name), null, x.id === selId)).join('')}</div></div>
        ${chartCardHtml(card)}
        ${card.empty ? '' : kpiRowHtml(trackerTiles(t))}
        ${card.empty ? '' : bodyNoteHtml(t)}`;
      const chips = body.querySelector('#chartTrackerChips');
      wireFScroll(chips);
      refreshFScroll(chips);
      chips.addEventListener('click', (ev) => { const b = ev.target.closest('[data-chip]'); if (b) { selId = b.dataset.chip; repaint(); } });
      wireChartCards(body, [card]);
    });
  }

  /* Water */

  function waterByDate() {
    const out = {};
    state.waterEntries.forEach((w) => { out[w.date] = (out[w.date] || 0) + w.amountMl; });
    return out;
  }
  const waterShown = (ml) => round(Units.mlToDisplay(ml), state.settings.volumeUnit === 'mL' ? 0 : 1);

  function waterOverviewCard() {
    if (!domainTracked('water')) return null;
    const base = { id: 'water', icon: itemIconHtml('droplets'), name: 'Water', open: () => openFoodCharts('water') };
    const byDate = waterByDate();
    if (!Object.keys(byDate).length) return { ...base, empty: { text: 'Log water and your weeks show up here.' } };
    const goal = state.water.goalMl;
    const weeks = rangeWeeks();
    const unit = Units.volumeUnitLabel();
    const rows = weeks.map((w) => {
      const days = daysBetween(w, addDays(w, 6)).filter((d) => d <= todayISO() && byDate[d]);
      return { week: w, met: goal ? days.filter((d) => byDate[d] >= goal).length : 0, logged: days.length, avg: mean(days.map((d) => byDate[d])) };
    });
    const firstWeek = weekOf(Object.keys(byDate).sort()[0]);
    const done = rows.slice(0, -1).filter((r) => r.week >= firstWeek);
    if (goal) {
      const avg = mean(done.map((r) => r.met)) || 0;
      return {
        ...base,
        sub: `Goal met ${round(avg, 1)} ${round(avg, 1) === 1 ? 'day' : 'days'} a week`,
        plot: Charts.columns(rows.map((r, i) => {
          const now = i === rows.length - 1;
          return { value: r.met, tone: now ? 'now' : '', label: now && r.met ? String(r.met) : '', tip: { title: now ? 'This week, so far' : `Week of ${chartDay(r.week)}`, rows: [['days at goal', String(r.met)], ['days logged', String(r.logged)]] } };
        }), { max: 7, height: 110, first: chartDay(weeks[0]), last: 'This week, so far', label: `Days the water goal was met each week over ${rangeInfo()[3]}, ${round(avg, 1)} on average` }),
        table: { head: ['Week of', 'Days at goal', 'Days logged'], rows: rows.map((r, i) => [weekLabel(r.week), `${r.met}${i === rows.length - 1 ? ' so far' : ''}`, String(r.logged)]) },
      };
    }
    const avg = mean(done.map((r) => r.avg).filter((v) => v != null));
    return {
      ...base,
      sub: avg != null ? `Average ${fmtVolume(avg)} a day` : '',
      plot: Charts.columns(rows.map((r, i) => ({ value: r.avg ? waterShown(r.avg) : 0, tone: i === rows.length - 1 ? 'now' : '', tip: { title: i === rows.length - 1 ? 'This week, so far' : `Week of ${chartDay(r.week)}`, rows: [['a day on average', r.avg ? fmtVolume(r.avg) : '—']] } })), { height: 110, first: chartDay(weeks[0]), last: 'This week, so far', label: `Average water a day, by week, over ${rangeInfo()[3]}` }),
      table: { head: ['Week of', `Average, ${unit}`], rows: rows.map((r) => [weekLabel(r.week), r.avg ? String(waterShown(r.avg)) : '—']) },
    };
  }

  function waterDetailCard() {
    const byDate = waterByDate();
    const base = { id: 'water-days', name: 'Water' };
    if (!Object.keys(byDate).length) return { ...base, empty: { text: 'Log water and your days show up here.' } };
    const goal = state.water.goalMl;
    const from = rangeFrom();
    const unit = Units.volumeUnitLabel();
    const full = daysBetween(from, addDays(todayISO(), -1)).filter((d) => byDate[d]);
    const met = goal ? full.filter((d) => byDate[d] >= goal).length : 0;
    const today = byDate[todayISO()] || 0;
    let bars;
    let first;
    let table;
    if (rangeIsDaily()) {
      const dates = daysBetween(from, todayISO());
      bars = dates.map((d) => ({ value: byDate[d] ? waterShown(byDate[d]) : 0, tone: d === todayISO() ? 'open' : '', tip: { title: dayTitle(d), rows: [[d === todayISO() ? 'so far' : '', byDate[d] ? fmtVolume(byDate[d]) : 'Nothing logged']] } }));
      first = chartDay(dates[0]);
      table = { head: ['Date', unit], rows: dates.filter((d) => byDate[d]).map((d) => [dayTitle(d), `${waterShown(byDate[d])}${d === todayISO() ? ' so far' : ''}`]) };
    } else {
      const weeks = rangeWeeks();
      const avgs = weeks.map((w) => mean(full.filter((d) => weekOf(d) === w).map((d) => byDate[d])));
      bars = weeks.map((w, i) => ({ value: avgs[i] ? waterShown(avgs[i]) : 0, tone: i === weeks.length - 1 ? 'now' : '', tip: { title: i === weeks.length - 1 ? 'This week, so far' : `Week of ${chartDay(w)}`, rows: [['a day on average', avgs[i] ? fmtVolume(avgs[i]) : '—']] } }));
      first = chartDay(weeks[0]);
      table = { head: ['Week of', `Average, ${unit}`], rows: weeks.map((w, i) => [weekLabel(w), avgs[i] ? String(waterShown(avgs[i])) : '—']) };
    }
    return {
      ...base,
      sub: goal ? `Goal met ${met} of the last ${plural(full.length, 'full day')}` : `Average ${fmtVolume(mean(full.map((d) => byDate[d])) || 0)} on full days`,
      plot: Charts.columns(bars, { height: 116, goal: goal ? waterShown(goal) : null, goalText: goal ? String(Math.round(waterShown(goal))) : '', first, last: rangeIsDaily() ? 'Today' : 'This week', label: `Water ${rangeIsDaily() ? 'per day' : 'per day, weekly average'} over ${rangeInfo()[3]}${goal ? `, goal met ${met} of ${full.length} full days` : ''}` }),
      legend: [goal ? keyItem('ln goal', `Goal ${fmtVolume(goal)}`) : '', rangeIsDaily() && today ? keyItem('sw open', `Today, ${fmtVolume(today)} so far`) : ''].join(''),
      table,
    };
  }

  /* Food */

  function foodCaloriesByDate() {
    const out = {};
    state.food.entries.forEach((e) => { if (e.calories != null) out[e.date] = (out[e.date] || 0) + e.calories; });
    return out;
  }
  const calorieTarget = () => (macroGoalInfo('calories').enabled && macroGoalInfo('calories').goal ? macroGoalInfo('calories').goal : null);
  const onTarget = (kcal, target) => Math.abs(kcal - target) <= target * 0.1;

  // Full days are days before today with calories logged.
  function foodRangeStats() {
    const byDate = foodCaloriesByDate();
    const target = calorieTarget();
    const full = daysBetween(rangeFrom(), addDays(todayISO(), -1)).filter((d) => byDate[d] != null);
    return { byDate, target, full, avg: mean(full.map((d) => byDate[d])), onTarget: target ? full.filter((d) => onTarget(byDate[d], target)).length : null };
  }

  function caloriesCard(open) {
    const base = { id: open ? 'food' : 'food-cal', icon: open ? itemIconHtml('apple') : '', name: open ? 'Food' : 'Calories', open };
    const st = foodRangeStats();
    const fullEver = Object.keys(st.byDate).filter((d) => d < todayISO()).length;
    if (fullEver < 7) return { ...base, empty: { text: 'Log 7 full days to see a trend.', have: fullEver, need: 7 } };
    const { byDate, target, full } = st;
    const over = (kcal) => target && kcal > target * 1.1;
    const today = byDate[todayISO()];
    let bars;
    let first;
    let table;
    if (rangeIsDaily()) {
      const dates = daysBetween(rangeFrom(), todayISO());
      bars = dates.map((d) => {
        const v = byDate[d] || 0;
        const isToday = d === todayISO();
        const rows = v ? [['kcal', `${fmtInt(v)}${isToday ? ' so far' : ''}`]] : [['', 'Nothing logged']];
        if (v && target && !isToday) rows.push(['', onTarget(v, target) ? 'On target' : over(v) ? 'Over by 10%+' : 'Under by 10%+']);
        return { value: v, tone: isToday ? 'open' : over(v) ? 'over' : '', tip: { title: dayTitle(d), rows } };
      });
      first = chartDay(dates[0]);
      table = { head: target ? ['Date', 'kcal', 'Target'] : ['Date', 'kcal'], rows: dates.filter((d) => byDate[d] != null).map((d) => {
        const row = [dayTitle(d), `${fmtInt(byDate[d])}${d === todayISO() ? ' so far' : ''}`];
        if (target) row.push(d === todayISO() ? '—' : onTarget(byDate[d], target) ? 'On' : over(byDate[d]) ? 'Over' : 'Under');
        return row;
      }) };
    } else {
      const weeks = rangeWeeks();
      const avgs = weeks.map((w) => mean(full.filter((d) => weekOf(d) === w).map((d) => byDate[d])));
      bars = weeks.map((w, i) => ({ value: avgs[i] || 0, tone: i === weeks.length - 1 ? 'now' : avgs[i] && over(avgs[i]) ? 'over' : '', tip: { title: i === weeks.length - 1 ? 'This week, so far' : `Week of ${chartDay(w)}`, rows: [['kcal a day', avgs[i] ? fmtInt(avgs[i]) : '—']] } }));
      first = chartDay(weeks[0]);
      table = { head: ['Week of', 'kcal a day'], rows: weeks.map((w, i) => [weekLabel(w), avgs[i] ? fmtInt(avgs[i]) : '—']) };
    }
    return {
      ...base,
      sub: target ? `On target ${st.onTarget} of the last ${plural(full.length, 'full day')}` : st.avg != null ? `${fmtInt(st.avg)} kcal a day on full days` : 'No full days in this range',
      plot: Charts.columns(bars, { height: 120, goal: target, goalText: target ? fmtInt(target) : '', first, last: rangeIsDaily() ? 'Today' : 'This week', label: `Calories ${rangeIsDaily() ? 'per day' : 'per day, weekly average'} over ${rangeInfo()[3]}${target ? `, target ${fmtInt(target)}, on target ${st.onTarget} of ${full.length} full days` : ''}` }),
      legend: [
        target ? keyItem('ln goal', `Target ${fmtInt(target)}`) : '',
        bars.some((x) => x.tone === 'over') ? `<span><i class="sw over"></i>${ALERT_ICON_SVG}Over by 10%+</span>` : '',
        rangeIsDaily() && today ? keyItem('sw open', `Today, ${fmtInt(today)} so far`) : '',
      ].join(''),
      table,
    };
  }

  // Protein per full day against its goal, in the Food colour.
  function proteinCard() {
    if (!macroTracked('protein')) return null;
    const byDate = {};
    state.food.entries.forEach((e) => { if (e.protein != null) byDate[e.date] = (byDate[e.date] || 0) + e.protein; });
    const pts = daysBetween(rangeFrom(), addDays(todayISO(), -1)).filter((d) => byDate[d] != null).map((d) => ({ date: d, value: byDate[d] }));
    if (pts.length < 2) return null;
    const pg = macroGoalInfo('protein');
    const goal = pg.goal || null;
    const avg = mean(pts.map((p) => p.value));
    const week = window.FitCalc.trailingAverage(pts, 7);
    const weekBy = Object.fromEntries(week.map((p) => [p.date, p.value]));
    const hit = goal ? pts.filter((p) => p.value >= goal).length : 0;
    return {
      id: 'protein', name: 'Protein',
      sub: goal ? `Goal hit on ${hit} of ${plural(pts.length, 'day')}, average ${Math.round(avg)} g` : `Average ${Math.round(avg)} g a day`,
      plot: `<div class="is-food">${Charts.line({
        from: rangeFrom(), to: todayISO(), dots: pts, avg: week, goal, goalText: goal ? `Goal ${Math.round(goal)} g` : '', height: 116, format: (v) => String(Math.round(v)),
        tipRows: (d) => [['protein', `${Math.round(byDate[d])} g`, 'dot food'], ['7-day average', `${Math.round(weekBy[d])} g`, 'line food']],
        label: `Protein per full day over ${rangeInfo()[3]}, average ${Math.round(avg)} grams`,
      })}</div>`,
      legend: keyItem('dt food', 'Days') + keyItem('ln food', '7-day average'),
      table: { head: ['Date', 'Protein', '7-day avg'], rows: pts.map((p) => [chartDay(p.date), `${Math.round(p.value)} g`, `${Math.round(weekBy[p.date])} g`]) },
    };
  }

  // Share of calories from protein, carbs and fat over the last 7 days with any of them logged.
  function macroSplitCard() {
    if (!['protein', 'carbs', 'fat'].every(macroTracked)) return null;
    const sums = { protein: 0, carbs: 0, fat: 0 };
    const days = new Set();
    state.food.entries.forEach((e) => {
      if (e.date >= todayISO() || e.date < addDays(todayISO(), -7)) return;
      ['protein', 'carbs', 'fat'].forEach((k) => { if (e[k] != null) { sums[k] += e[k]; days.add(e.date); } });
    });
    if (!days.size) return null;
    const kcal = { protein: sums.protein * 4, carbs: sums.carbs * 4, fat: sums.fat * 9 };
    const total = kcal.protein + kcal.carbs + kcal.fat;
    if (!total) return null;
    const parts = ['protein', 'carbs', 'fat'].map((k, i) => ({ k, label: MACRO_LABELS[k], pct: Math.round((kcal[k] / total) * 100), g: sums[k] / days.size, cls: `m${i + 1}` }));
    return {
      id: 'macros', name: 'Where calories came from', sub: `Last 7 days, ${plural(days.size, 'day')} logged`,
      plot: `<div class="split-bar" role="img" aria-label="${parts.map((p) => `${p.label} ${p.pct}%`).join(', ')}">${parts.map((p) => `<span class="${p.cls}" style="flex:${Math.max(p.pct, 1)} 1 0"></span>`).join('')}</div>
        <div class="split-key">${parts.map((p) => `<div><i class="sw ${p.cls}"></i><span>${p.label}</span><b>${p.pct}%</b><span class="muted-text">${Math.round(p.g)} g a day</span></div>`).join('')}</div>`,
      table: { head: ['Macro', 'g a day', 'Share'], rows: parts.map((p) => [p.label, String(Math.round(p.g)), `${p.pct}%`]) },
    };
  }

  function openFoodCharts(focus) {
    const food = domainTracked('food');
    const water = domainTracked('water');
    const title = food && water ? 'Food and water' : food ? 'Food' : 'Water';
    openChartSheet(title, itemIconHtml(food ? 'apple' : 'droplets'), (body) => {
      const cards = [];
      let html = '';
      if (food) {
        const cal = caloriesCard();
        cards.push(cal);
        html += chartCardHtml(cal);
        const st = foodRangeStats();
        if (!cal.empty && st.full.length) {
          html += kpiRowHtml([
            st.target ? { value: `${st.onTarget} of ${st.full.length}`, label: 'Days on target (within 10%)' } : null,
            { value: fmtInt(st.avg), label: 'Average kcal, full days' },
          ].filter(Boolean));
        }
        [proteinCard(), macroSplitCard()].filter(Boolean).forEach((c) => { cards.push(c); html += chartCardHtml(c); });
      }
      if (water) { const w = waterDetailCard(); cards.push(w); html += chartCardHtml(w); }
      body.innerHTML = `${html}<p class="cc-note">A day counts once it is over. Days with nothing logged are left out of averages rather than counted as zero.</p>`;
      wireChartCards(body, cards);
    });
    if (focus === 'water' && food) {
      const el = modalSheet().querySelector('[data-chart-card="water-days"]');
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }

  /* Overview and sheets */

  function overviewTiles() {
    const from = rangeFrom();
    const tiles = [];
    if (domainTracked('workout')) {
      const days = new Set(state.entries.filter((e) => !isDailyEntry(e) && e.date >= from && e.date <= todayISO()).map((e) => e.date)).size;
      if (state.entries.some((e) => !isDailyEntry(e))) tiles.push({ value: String(days), label: 'Workout days' });
    }
    const wt = trackerById(BODY_WEIGHT_TRACKER_ID);
    if (domainTracked('measurements') && wt && !wt.archived) {
      const tr = trackerTrend(wt);
      if (tr.avg.length >= 2) tiles.push({ value: signed(tr.avg[tr.avg.length - 1].value - tr.avg[0].value), unit: Units.weightUnitLabel(), label: 'Weight change' });
    }
    if (domainTracked('food')) {
      const st = foodRangeStats();
      if (st.avg != null) tiles.push({ value: fmtInt(st.avg), label: 'Avg kcal, full days' });
    }
    if (domainTracked('water') && state.water.goalMl && state.waterEntries.length && tiles.length < 3) {
      const byDate = waterByDate();
      const met = daysBetween(from, addDays(todayISO(), -1)).filter((d) => byDate[d] >= state.water.goalMl).length;
      tiles.push({ value: String(met), label: 'Days at water goal' });
    }
    return tiles.slice(0, 3);
  }

  // A card's inner width inside `el`, or inside the page when `el` is not laid out yet.
  function chartWidthIn(el) {
    const outer = el && el.clientWidth ? el.clientWidth : document.getElementById('main').clientWidth - 40;
    return outer - 34;
  }

  function renderProgressCharts() {
    const wrap = document.getElementById('chartsOverview');
    Charts.setWidth(chartWidthIn(wrap));
    chartsDrawnAt = wrap.clientWidth;
    const cards = [workoutOverviewCard(), dailyOverviewCard(), bodyOverviewCard(), waterOverviewCard(), domainTracked('food') ? caloriesCard(() => openFoodCharts()) : null].filter(Boolean);
    document.getElementById('dashboardEmpty').hidden = cards.length > 0;
    wrap.innerHTML = cards.length ? `${rangeSegHtml()}${kpiRowHtml(overviewTiles())}${cards.map(chartCardHtml).join('')}` : '';
    if (!cards.length) return;
    wrap.querySelector('.chart-range').addEventListener('click', (ev) => { const b = ev.target.closest('[data-seg]'); if (b) { chartRange = b.dataset.seg; renderProgressCharts(); } });
    wireChartCards(wrap, cards);
  }

  // Redraw the overview when the page width changes (rotation, a resized window).
  let chartsDrawnAt = 0;
  window.addEventListener('resize', () => {
    const wrap = document.getElementById('chartsOverview');
    if (!wrap || !wrap.clientWidth || Math.abs(wrap.clientWidth - chartsDrawnAt) < 8) return;
    renderProgressCharts();
  });

  // A tall sheet with the shared range on top. `paint(body, repaint)` fills the body; a
  // range change repaints it (and the overview behind it) without reopening the sheet.
  function openChartSheet(title, iconHtml, paint) {
    openModal(`
      <div class="modal-title-row"><h2 class="title-with-icon">${iconHtml}${title}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
      ${rangeSegHtml()}
      <div class="chart-sheet" id="chartSheetBody"></div>`, { tall: true });
    const sheet = modalSheet();
    const body = sheet.querySelector('#chartSheetBody');
    const repaint = () => { Charts.setWidth(chartWidthIn(body)); paint(body, repaint); };
    sheet.querySelector('.chart-range').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-seg]');
      if (!b) return;
      chartRange = b.dataset.seg;
      sheet.querySelectorAll('.chart-range [data-seg]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.seg === chartRange)));
      repaint();
      if (!document.getElementById('progressCharts').hidden) renderProgressCharts();
    });
    repaint();
  }

  function renderProgress() {
    document.querySelectorAll('#progressSeg [data-progress-seg]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.progressSeg === progressSeg)));
    document.getElementById('progressGoals').hidden = progressSeg !== 'goals';
    document.getElementById('progressCharts').hidden = progressSeg !== 'charts';
    if (progressSeg === 'goals') renderProgressGoals();
    else renderProgressCharts();
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
          <div class="insight-line">${suggestion.calories} kcal &middot; ${suggestion.protein}g protein</div>
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
      <div class="modal-title-row"><h2>Food today</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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

  function groupBySection(list) {
    const groups = { goal: [], daily: [], accessory: [] };
    list.forEach((ex) => { groups[sectionOf(ex)].push(ex); });
    return groups;
  }

  /* Organization: groups, favorites, search
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
  function exerciseGroup(ex) { return Object.hasOwn(EXERCISE_GROUP_LABELS, ex.group) ? ex.group : inferExerciseGroup(ex); }
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

  /* Catalog & equipment variants
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
    const mv = ex.catalogId && Object.hasOwn(MOVEMENTS, ex.catalogId) && MOVEMENTS[ex.catalogId];
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
      if (mv.kind === 'weight') ex.bodyRegion = guessBodyRegion(mv.name);
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
  // Adds every catalog movement matching `filter` that the user does not have yet, on its usual
  // equipment. Anything already there (archived too) is left exactly as it is. Returns how many
  // exercises were created.
  function importMissingMovements(filter) {
    let n = 0;
    CATALOG.movements.filter(filter).forEach((m) => {
      const eq = m.defaultEquipment || null;
      if (variantRecord(m.id, eq) || legacyVariantMatch(m, eq)) return;
      n += addCatalogMovement(m, eq ? [eq] : []);
    });
    return n;
  }
  const isCardioMovement = (m) => m.kind === 'cardio';
  const missingMovementCount = () => CATALOG.movements.filter((m) => !(variantRecord(m.id, m.defaultEquipment || null) || legacyVariantMatch(m, m.defaultEquipment || null))).length;
  // Switching Lifting or Cardio on while that part of the library is empty brings in the whole set,
  // like setup does, so it is never a blank screen. Returns a short message when it added any.
  function autoImportFor(key) {
    if (key === 'trackCardio' && !state.exercises.some((e) => e.kind === 'cardio')) {
      const n = importMissingMovements(isCardioMovement);
      return n ? `Added ${n} cardio activities` : '';
    }
    if (key === 'trackWorkout' && !state.exercises.some((e) => (e.kind === 'weight' || e.kind === 'reps') && !isDailyEx(e))) {
      const n = importMissingMovements((m) => !isCardioMovement(m));
      return n ? `Added ${n} exercises` : '';
    }
    return '';
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

  /* Tidy up: group older exercises under catalog movements
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

  // Manage > Exercises: one button brings in the whole catalog instead of ticking each movement.
  // Shown until it is used or dismissed, and only while a meaningful number are missing.
  function renderImportCard() {
    const host = document.getElementById('importCard'); if (!host) return;
    const n = state.settings.importDismissed ? 0 : missingMovementCount();
    if (n < 5) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `
      <div class="tidy-text"><b>Add every catalog exercise</b><span class="muted-text">${n} lifts, bodyweight moves and cardio activities are not in your list yet. Yours stay exactly as they are.</span></div>
      <div class="tidy-actions"><button type="button" class="btn btn-primary btn-sm" id="importAllBtn">Import all ${n}</button><button type="button" class="link-btn" id="importDismissBtn">Not now</button></div>`;
    document.getElementById('importAllBtn').addEventListener('click', () => {
      const before = state.exercises.length;
      const added = importMissingMovements(() => true);
      state.settings.importDismissed = true;
      if (!save()) return;
      renderAll();
      toast(`Added ${added} exercises`, { label: 'Undo', run: () => {
        const logged = new Set(state.entries.map((e) => e.exerciseId));
        state.exercises = state.exercises.filter((e, i) => i < before || logged.has(e.id));
        state.settings.importDismissed = false;
        save(); renderAll(); toast('Import undone');
      } });
    });
    document.getElementById('importDismissBtn').addEventListener('click', () => { state.settings.importDismissed = true; save(); renderImportCard(); });
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
        <div class="modal-title-row"><h2>Tidy up</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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

  // Transient UI state (never saved). `pick` holds what is ticked per tab.
  const cat = { scope: ['exercises'], tab: 'exercises', query: '', group: 'all', pack: 'all', cat: 'all', open: null, pick: { exercises: new Set(), habits: new Set(), foods: new Set() } };

  // The sheet only offers what belongs to the screen that opened it: Manage >
  // Workout gets exercises, Manage > Daily gets habits, Manage > Food gets foods.
  function openCatalogSheet(tab) {
    cat.scope = tab === 'foods' ? ['foods'] : tab === 'habits' ? ['habits'] : ['exercises'];
    cat.tab = cat.scope.includes(tab) ? tab : cat.scope[0]; cat.query = ''; cat.group = 'all'; cat.pack = 'all'; cat.cat = 'all'; cat.open = null;
    cat.pick = { exercises: new Set(), habits: new Set(), foods: new Set() };
    openModal(`
      <div class="split-shell">
        <div class="modal-title-row"><h2>${cat.scope[0] === 'foods' ? 'Add foods' : 'Add from catalog'}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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

  // What the current tab, filters and search show, as the pick keys of the ones not added yet.
  // Exercises pick their usual equipment, like "Tick the whole pack".
  function catUnaddedKeys() {
    const q = cat.query.trim().toLowerCase();
    if (cat.tab === 'exercises') {
      return CATALOG.movements
        .filter((m) => (cat.group === 'all' || m.group === cat.group) && (cat.pack === 'all' || m.packs.includes(cat.pack)))
        .filter((m) => !q || m.name.toLowerCase().includes(q) || (EXERCISE_GROUP_LABELS[m.group] || '').toLowerCase().includes(q))
        .filter((m) => !(variantRecord(m.id, m.defaultEquipment || null) || legacyVariantMatch(m, m.defaultEquipment || null)))
        .map((m) => `${m.id}|${m.defaultEquipment || ''}`);
    }
    if (cat.tab === 'habits') {
      return CATALOG.habits.filter((h) => (!q || h.name.toLowerCase().includes(q)) && !state.exercises.some((e) => e.catalogId === h.id && !e.archived)).map((h) => h.id);
    }
    return CATALOG.foods.filter((f) => (cat.cat === 'all' || f.category === cat.cat) && (!q || f.name.toLowerCase().includes(q)) && !state.food.savedFoods.some((x) => x.catalogId === f.id)).map((f) => f.id);
  }

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
              <div class="entry-row-sub">${escapeHtml(f.serving)} · ${f.calories} kcal · ${f.protein != null ? `${f.protein} g protein` : ''}</div></div>
            ${have ? '<span class="chip">Added</span>' : ''}
          </div>`;
      }).join('');
    }
    const unadded = catUnaddedKeys();
    const ticked = unadded.length > 0 && unadded.every((k) => cat.pick[cat.tab].has(k));
    const bulk = unadded.length > 1 ? `<div class="cat-bulk"><span class="muted-text">${unadded.length} not added yet</span>
      <button type="button" class="btn btn-secondary btn-sm" data-cat-tickall="1">${ticked ? 'Clear ticks' : `Tick all ${unadded.length}`}</button></div>` : '';
    list.innerHTML = html ? bulk + html : '<p class="muted-text org-empty">Nothing matches.</p>';
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
    if (ev.target.closest('[data-cat-tickall]')) {
      const keys = catUnaddedKeys(); const set = cat.pick[cat.tab];
      if (keys.every((k) => set.has(k))) keys.forEach((k) => set.delete(k)); else keys.forEach((k) => set.add(k));
      renderCatalogList(); return;
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
    const active = activeExercises().filter((e) => !isDailyEx(e));
    const favs = active.filter(isFavoriteExercise);
    const recent = active.filter((e) => lastMap[e.id]).sort((a, b) => lastMap[b.id].k.localeCompare(lastMap[a.id].k));
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (!logEx.seg) logEx.seg = favs.length ? 'fav' : recent.length ? 'recent' : 'all';
    const searching = !!q;
    const seg = searching ? 'all' : logEx.seg;

    document.getElementById('logExSeg').innerHTML = segHtml([['fav', 'Favorites'], ['recent', 'Recent'], ['all', `All ${active.length}`]], seg);

    let base = seg === 'fav' ? favs : seg === 'recent' ? recent : active.slice().sort(byName);
    if (searching) base = active.filter((e) => exerciseLabel(e).toLowerCase().includes(q) || exerciseGroupLabel(e).toLowerCase().includes(q)).sort(byName);

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
    const mv = ex.catalogId && Object.hasOwn(MOVEMENTS, ex.catalogId) && MOVEMENTS[ex.catalogId];
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

  const manageEx = { query: '', filter: 'all', open: {} };
  const MANAGE_EX_FILTERS = [['all', 'All'], ['goal', 'Goals'], ['accessory', 'Other']];
  function manageExMatchesFilter(ex, f) {
    return f === 'all' || sectionOf(ex) === f;
  }

  function manageExRowHtml(ex, { star = true } = {}) {
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
        ${ex.archived || !star ? '' : starButtonHtml('data-fav', ex.id, isFavoriteExercise(ex))}
      </div>`;
  }

  function renderExerciseManageList() {
    if (!renderDomainTrackToggle('workout')) return;
    const wrap = document.getElementById('exerciseManageList');
    const q = manageEx.query.trim().toLowerCase();
    const matchesQ = (ex) => !q || exerciseLabel(ex).toLowerCase().includes(q) || exerciseGroupLabel(ex).toLowerCase().includes(q);
    const queried = state.exercises.filter((ex) => !isDailyEx(ex)).filter(matchesQ);

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
    const totalActive = state.exercises.filter((e) => !e.archived && !isDailyEx(e)).length;
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
      : `<div class="card org-card"><p class="muted-text org-empty">${state.exercises.some((e) => !isDailyEx(e)) ? 'No exercises match.' : 'No exercises yet.'}</p></div>`;
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

  // Manage > Daily: every habit and daily rep target, split into Habits, Daily reps and
  // Archived. Editing, archiving and the catalog work as they do for exercises.
  function renderDailyManageList() {
    if (!renderDomainTrackToggle('daily')) return;
    const wrap = document.getElementById('dailyManageList');
    const items = state.exercises.filter(isDailyEx);
    const block = (label, list) => list.length ? `
      <div class="manage-group-label">${label} · ${list.length}</div>
      <div class="card org-card"><div class="g-list">${list.map((ex) => manageExRowHtml(ex, { star: false })).join('')}</div></div>` : '';
    const byName = (a, b) => a.name.localeCompare(b.name);
    const live = items.filter((e) => !e.archived);
    wrap.innerHTML = items.length
      ? block('Habits', live.filter((e) => e.kind === 'habit').sort(byName)) +
        block('Daily reps', live.filter((e) => e.kind !== 'habit').sort(byName)) +
        block('Archived', items.filter((e) => e.archived).sort(byName))
      : `<div class="card org-card"><p class="muted-text org-empty">Nothing here yet. Add a habit like Creatine or Stretching, or a daily rep target like Push-ups.</p></div>`;
  }

  function wireManageDaily() {
    document.querySelectorAll('#manageDailyPanel [data-action="add-daily"]').forEach((btn) => btn.addEventListener('click', () => openExerciseForm(null, { kind: 'habit', section: 'daily' })));
    document.getElementById('dailyManageList').addEventListener('click', (ev) => {
      const edit = ev.target.closest('[data-action="edit-exercise"]');
      if (edit) { openExerciseForm(edit.dataset.id); return; }
      const un = ev.target.closest('[data-action="unarchive-exercise"]');
      if (un) {
        const ex = exerciseById(un.dataset.id);
        if (!ex) return;
        ex.archived = false;
        if (!save()) return;
        toast('Unarchived');
        renderAll();
      }
    });
  }

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

  // The Log tab switches between Workout, Daily, Body, Water and Food with a segmented
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

  // Icons for the five domain tabs (Workout, Daily, Body, Water, Food), shared by Log,
  // History and Manage. They resolve to ITEM_ICONS (js/icons.js); getters because
  // ITEM_ICONS is declared further down.
  const DOMAIN_TAB_ICONS = {
    get workout() { return itemIconSvg('dumbbell'); },
    get measurements() { return itemIconSvg('ruler'); },
    get water() { return itemIconSvg('droplets'); },
    get food() { return itemIconSvg('apple'); },
    get daily() { return STATIC_ICONS.daily; },
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
    get dumbbell() { return DOMAIN_TAB_ICONS.workout; },
    get person() { return itemIconSvg('standing'); },
    get sun() { return itemIconSvg('sun'); },
    get apple() { return DOMAIN_TAB_ICONS.food; },
    get scale() { return itemIconSvg('scale'); },
    get moon() { return itemIconSvg('moon'); },
    get footprints() { return itemIconSvg('footprints'); },
    trophy: lucide('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
    chart: lucide('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
    calendar: lucide('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
    contrast: lucide('<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>'),
    get check() { return STATIC_ICONS.habits; },
    daily: lucide('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>'),
    habits: lucide('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),
    calculator: lucide('<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>'),
    trash: lucide('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
    'triangle-alert': lucide('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    download: lucide('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    upload: lucide('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
  };
  function hydrateStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = STATIC_ICONS[el.dataset.icon] || ''; });
  }

  /* Item icons
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
  const DOMAIN_LABELS = { workout: 'Workout', daily: 'Daily', measurements: 'Body', water: 'Water', food: 'Food' };
  const DOMAIN_ORDER = ['workout', 'daily', 'measurements', 'water', 'food'];

  // Master "Track this" switch per domain (settings.trackWorkout/trackMeasurements/
  // trackWater/trackFood). Workout counts as on while Lifting or Running & cardio is
  // on; Daily (habits and daily reps) follows trackHabits (js/features.js).
  function domainTracked(id) { return F.domainTracked(state.settings, id); }

  // Log and History offer only domains that are on. Manage offers all five
  // (ALL_DOMAIN_CATEGORIES).
  function availableDomainCategories() {
    return DOMAIN_ORDER.filter(domainTracked).map((id) => ({ id, label: DOMAIN_LABELS[id] }));
  }

  // Manage always offers all five domains: it is where an off domain is turned back on.
  const ALL_DOMAIN_CATEGORIES = DOMAIN_ORDER.map((id) => ({ id, label: DOMAIN_LABELS[id] }));

  // Domain tab markup shared by Log, History and Manage. An off domain gets
  // `.is-toggled-off` (dimmed but still tappable); only Manage shows one.
  function domainTabsHtml(cats, activeId) {
    return cats.map((c) => `
      <button type="button" class="domain-tab${domainTracked(c.id) ? '' : ' is-toggled-off'}" data-domain-cat="${c.id}" role="radio" aria-checked="${c.id === activeId}">
        ${DOMAIN_TAB_ICONS[c.id] || ''}
        <span>${c.label}</span>
      </button>`).join('');
  }

  // A daily rep target logs through the workout form, even when the Workout area is off.
  let logWorkoutBorrowed = false;

  function renderLogCategorySegmented() {
    const cats = availableDomainCategories();
    if (logWorkoutBorrowed && logCategory === 'workout' && !cats.some((c) => c.id === 'workout')) cats.unshift({ id: 'workout', label: DOMAIN_LABELS.workout });
    // All domains can be off at once, so cats[0] may not exist.
    if (cats.length && !cats.some((c) => c.id === logCategory)) logCategory = cats[0].id;
    const seg = document.getElementById('logCategorySegmented');
    seg.innerHTML = domainTabsHtml(cats, logCategory);
    seg.hidden = cats.length < 2; // a single tracked section needs no switcher
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { logCategory = b.dataset.domainCat; logWorkoutBorrowed = false; renderLogView(); });
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

  // The Body entry starts at the tracker's last value, so a routine weigh-in is a tap on
  // Save or a nudge of the stepper instead of typing the whole number. measFilledFor
  // remembers which tracker the field was filled for, so a value being typed survives
  // re-renders.
  let measFilledFor = null;
  const MEAS_STEP = { weight: 0.1, length: 0.1, percent: 0.1, hours: 0.25, rating: 1, count: 1 };

  function renderLogMeasurementForm() {
    const select = document.getElementById('logTracker');
    populateTrackerSelect(select);
    const tracker = trackerById(select.value);
    const chips = document.getElementById('logTrackerChips');
    chips.innerHTML = activeTrackers().map((t) => chipHtml(t.id, escapeHtml(t.name), null, t.id === select.value)).join('');
    chips.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
      select.value = b.dataset.chip;
      select.dispatchEvent(new Event('change'));
    }));
    const dateEl = document.getElementById('logMeasurementDate');
    dateEl.value = dateEl.value || todayISO();
    syncMeasurementDateBtn();
    const isSleep = tracker && tracker.kind === 'sleep';
    document.getElementById('logMeasurementValueLabel').textContent = tracker ? (isSleep ? 'Hours slept' : `Log ${tracker.name}`) : 'Value';
    // innerHTML on purpose: trackerUnitLabel() already escapes, so textContent would show "&amp;".
    document.getElementById('logMeasurementUnit').innerHTML = tracker ? trackerUnitLabel(tracker) : '';
    document.getElementById('logMeasurementSaveBtn').textContent = tracker ? `Save ${tracker.name.toLowerCase()}` : 'Save entry';
    document.getElementById('logSleepQualityField').hidden = !isSleep;
    if (tracker && measFilledFor !== tracker.id) {
      const latest = latestMeasurement(tracker.id);
      document.getElementById('logMeasurementValue').value = latest ? trackerDisplayFromCanonical(tracker, latest.value) : '';
      measFilledFor = tracker.id;
    }
  }

  function syncMeasurementDateBtn() {
    const date = document.getElementById('logMeasurementDate').value || todayISO();
    const label = relDay(date);
    document.getElementById('logMeasurementDateBtn').textContent = label[0].toUpperCase() + label.slice(1);
  }

  function stepMeasurement(dir) {
    const tracker = trackerById(document.getElementById('logTracker').value);
    if (!tracker) return;
    const input = document.getElementById('logMeasurementValue');
    const step = MEAS_STEP[tracker.unitKind] || 1;
    const cur = parseFloat(input.value);
    let next = round((Number.isNaN(cur) ? 0 : cur) + dir * step, 2);
    if (tracker.unitKind === 'rating') next = Math.min(Number(tracker.ratingMax) || 5, Math.max(1, next));
    input.value = Math.max(0, next);
  }

  function wireLogMeasurementForm() {
    document.querySelectorAll('[data-meas-step]').forEach((b) => b.addEventListener('click', () => stepMeasurement(Number(b.dataset.measStep))));
    const reveal = (btnId, fieldId, focusId) => document.getElementById(btnId).addEventListener('click', (ev) => {
      const field = document.getElementById(fieldId);
      field.hidden = !field.hidden;
      ev.currentTarget.setAttribute('aria-expanded', String(!field.hidden));
      if (!field.hidden) document.getElementById(focusId).focus();
    });
    reveal('logMeasurementDateBtn', 'logMeasurementDateField', 'logMeasurementDate');
    reveal('logMeasurementNoteBtn', 'logMeasurementNoteField', 'logMeasurementNote');
    document.getElementById('logMeasurementDate').addEventListener('change', syncMeasurementDateBtn);
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
    // The field keeps the value just saved; date and note fold away again.
    resetChipPicker(document.getElementById('logSleepQuality'));
    document.getElementById('logMeasurementNote').value = '';
    document.getElementById('logMeasurementDate').value = todayISO();
    ['logMeasurementDateField', 'logMeasurementNoteField'].forEach((id) => { document.getElementById(id).hidden = true; });
    ['logMeasurementDateBtn', 'logMeasurementNoteBtn'].forEach((id) => document.getElementById(id).setAttribute('aria-expanded', 'false'));
    syncMeasurementDateBtn();
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
    if (macroTooBig(values)) return;
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

  /* Log -> Daily
     Habits and daily-rep targets, one screen (today's count is in the glance card above
     it): a tap-to-check list of the habits due today, then the daily rep targets with a meter and a Log
     button (which opens the same rep form as Workout). Nothing here is new data: it is
     the Home "Daily targets" list, given its own home. */
  function dailyItemsToday() {
    const all = activeExercises().filter(isDailyEx);
    return { habits: all.filter((e) => e.kind === 'habit' && habitDueToday(e)), reps: all.filter((e) => e.kind !== 'habit') };
  }
  const dailyComplete = (ex) => { const p = todayProgressOf(ex); return p.pct != null && p.pct >= 100; };

  function dailyHabitRowHtml(ex) {
    const goal = ex.goal || 1;
    const done = entriesFor(ex.id).filter((e) => e.date === todayISO()).length;
    const complete = done >= goal;
    const repeat = (HABIT_REPEATS.find((r) => r[0] === ex.repeat) || HABIT_REPEATS[0])[1];
    const sub = goal > 1 ? `${goal} times · ${Math.min(done, goal)} of ${goal} today` : repeat;
    const pips = goal > 1 ? `<span class="daily-pips" aria-hidden="true">${Array.from({ length: Math.min(goal, 6) }, (_, i) => `<i class="daily-pip${i < done ? ' on' : ''}"></i>`).join('')}</span>` : '';
    return `
      <div class="glance-row daily-row${complete ? ' is-complete' : ''}" data-exercise-id="${ex.id}">
        <div class="glance-open">
          ${exerciseIconHtml(ex)}
          <div class="glance-main">
            <div class="glance-name">${exerciseLabelHtml(ex)}</div>
            <div class="glance-sub">${escapeHtml(sub)}</div>
          </div>
        </div>
        ${pips}
        <button type="button" class="daily-cb${complete ? ' is-on' : ''}" data-action="daily-check" aria-label="${complete ? `${escapeHtml(ex.name)} is done today. Open details` : `Mark ${escapeHtml(ex.name)} done`}">${complete ? CHECK_ICON_SVG : ''}</button>
      </div>`;
  }

  function renderLogDailyPanel() {
    const panel = document.getElementById('logDailyPanel');
    if (panel.hidden) return;
    const { habits, reps } = dailyItemsToday();
    const all = habits.concat(reps);
    const section = (title, items, rowFn) => items.length ? `
      <div class="section-head daily-head"><h2>${title}</h2><span class="muted-text">${items.filter(dailyComplete).length} of ${items.length}</span></div>
      <div class="card card-list">${items.map(rowFn).join('')}</div>` : '';
    panel.innerHTML = `
      ${all.length ? '' : '<p class="muted-text">Nothing is due today. Add a habit or a daily rep target to get started.</p>'}
      ${section('Habits', habits, dailyHabitRowHtml)}
      ${section('Daily reps', reps, (ex) => dailyTargetRowHtml(ex, 'Log'))}
      <button type="button" class="card daily-add" data-action="add-daily">${uiIcon('plus')}<span>Add to Daily</span></button>`;
    panel.querySelectorAll('.glance-row').forEach((row) => {
      const exId = row.getAttribute('data-exercise-id');
      const ex = exerciseById(exId);
      wireOpenable(row.querySelector('.glance-open'), () => openExerciseDetail(exId));
      const check = row.querySelector('[data-action="daily-check"]');
      if (check) { check.addEventListener('click', () => { if (dailyComplete(ex)) openExerciseDetail(exId); else logHabit(exId); }); return; }
      row.querySelector('.glance-btn').addEventListener('click', () => openLogFor(exId));
    });
    panel.querySelector('[data-action="add-daily"]').addEventListener('click', () => openExerciseForm(null, { kind: 'habit', section: 'daily' }));
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
    document.getElementById('logTrackerChipsWrap').hidden = allOff || logCategory !== 'measurements' || activeTrackers().length === 0;
    document.getElementById('logWaterPanel').hidden = allOff || logCategory !== 'water';
    document.getElementById('logDailyPanel').hidden = allOff || logCategory !== 'daily';
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
      if (logCategory === 'daily') renderLogDailyPanel();
      if (logCategory === 'measurements') renderLogMeasurementForm();
      if (logCategory === 'water') renderLogWaterPanel();
      if (logCategory === 'food') { renderLogFoodForm(); renderSavedFoodLogList(); }
    }
    renderRecentEntries();
  }

  // "Recent entries" follows the active Log category.
  function renderRecentEntries() {
    renderLogGlance();
    const wrap = document.getElementById('recentEntries');
    const head = document.getElementById('recentHead');
    // Daily's rows already show what is done today, so it has no Latest entry section.
    const show = availableDomainCategories().length > 0 && logCategory !== 'daily';
    head.hidden = !show;
    if (!show) { wrap.innerHTML = ''; return; }
    head.querySelector('h2').textContent = logCategory === 'measurements' ? 'Latest entries' : 'Latest entry';
    if (logCategory === 'measurements') {
      // The selected tracker's last three entries.
      const trackerId = document.getElementById('logTracker').value;
      const recent = measurementsFor(trackerId).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 3);
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
    // A daily rep target logs through the Workout form; show it there too.
    const wantDaily = logWorkoutBorrowed;
    const recent = state.entries.filter((e) => isDailyEntry(e) === wantDaily).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 1);
    if (!recent.length) { wrap.innerHTML = `<p class="muted-text">Nothing logged yet. Your latest entry will show up here.</p>`; return; }
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
      wireOpenable(row, () => openEntryModal(row.getAttribute('data-entry-id')));
    });
  }

  function waterEntryRowHtml(e) {
    const cup = e.cupId ? cupById(e.cupId) : null;
    return `
      <div class="entry-row" data-water-entry-id="${e.id}">
        ${cupIconHtml(cup, true)}
        <div class="entry-row-main">
          <div class="entry-row-title">${cup ? escapeHtml(cup.name) : e.cupName ? escapeHtml(e.cupName) : 'Custom amount'}</div>
          <div class="entry-row-sub">${fmtVolume(e.amountMl)}</div>
        </div>
        <div class="entry-row-date">${fmtDateShort(e.date)}</div>
      </div>`;
  }

  function wireWaterEntryRowClicks(container) {
    container.querySelectorAll('.entry-row[data-water-entry-id]').forEach((row) => {
      wireOpenable(row, () => openWaterEntryModal(row.getAttribute('data-water-entry-id')));
    });
  }

  function openWaterEntryModal(entryId) {
    const e = state.waterEntries.find((x) => x.id === entryId);
    if (!e) return;
    openModal(`
      <div class="modal-title-row"><h2>Edit water entry</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
      wireOpenable(row, () => openFoodEntryModal(row.getAttribute('data-food-entry-id')));
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
      <div class="modal-title-row"><h2>Edit food entry</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
      if (macroTooBig(values)) return;
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

  /* Saved Foods
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
      <div class="modal-title-row"><h2>${editing ? 'Edit food' : 'Add a food'}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
      if (macroTooBig(values)) return;
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
    // Every macro, tracked or not, so turning one on later still shows it for past entries.
    MACRO_KEYS.forEach((k) => { values[k] = food[k] != null ? round(food[k] * qty, 1) : null; });
    return values;
  }
  // Same ceilings the backup validator uses, so anything saved here can be exported and re-imported.
  function macroTooBig(values) {
    const bad = Object.keys(values).find((k) => values[k] != null && values[k] > window.FitBackup.macroLimit(k));
    if (!bad) return false;
    toast(`That ${MACRO_LABELS[bad].toLowerCase()} value is too large to be right.`);
    return true;
  }

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

  /* Log glance card
     Every Log tab opens with the same small two-line card: the number, then a thin meter
     (week dots for Workout), one short status and one link. Streaks live in the History
     calendar's legend (calendarStreaks), so Log stays about logging. */
  function relDay(iso) {
    const gap = dayGap(iso, todayISO());
    if (gap === 0) return 'today';
    if (gap === 1) return 'yesterday';
    return gap > 1 && gap < 7 ? dayLabel(iso) : fmtDateShort(iso);
  }
  function glanceMeter(pct, fillClass = '') {
    return `<div class="meter meter-sm"><div class="meter-fill${fillClass}" style="--fill:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  }
  function glanceHtml({ eyebrow, value, unit, empty, row2 }) {
    return `
      <div class="lg-r1">
        <div class="lg-ev"><span class="lg-eb">${eyebrow}</span>${empty ? '<span class="lg-v is-empty">None yet</span>' : `<span class="lg-v">${value} <span class="lg-u">${unit}</span></span>`}</div>
      </div>
      <div class="lg-r2">${row2}</div>`;
  }
  const glanceLink = (text) => `<button type="button" class="link-btn" data-glance-link>${text}</button>`;

  function workoutGlance() {
    const dates = new Set(state.entries.filter((e) => !isDailyEntry(e)).map((e) => e.date));
    const today = todayISO();
    const monday = new Date(today + 'T00:00:00');
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return localDateISO(d); });
    const last = [...dates].sort().pop();
    const dots = `<div class="lg-dots" aria-label="${week.filter((d) => dates.has(d)).length} workout days this week">${week.map((d) => `<i class="${dates.has(d) ? 'on' : ''}${d === today ? ' is-today' : ''}"></i>`).join('')}</div>`;
    return {
      html: glanceHtml({ eyebrow: 'This week', value: week.filter((d) => dates.has(d)).length, unit: 'of 7 days',
        row2: `${dots}<span class="lg-tx">${last ? `Last: ${relDay(last)}` : 'No workouts yet'}</span>` }),
    };
  }
  function dailyGlance() {
    const { habits, reps } = dailyItemsToday();
    const all = habits.concat(reps);
    const done = all.filter(dailyComplete).length;
    const left = all.length - done;
    return {
      html: glanceHtml({ eyebrow: 'Today', value: done, unit: `of ${all.length} done`,
        row2: `${glanceMeter(all.length ? (done / all.length) * 100 : 0, all.length && !left ? ' is-complete' : '')}<span class="lg-tx">${!all.length ? 'Nothing due' : left ? `${left} left` : 'All done'}</span>` }),
    };
  }
  function bodyGlance() {
    const t = trackerById(document.getElementById('logTracker').value);
    if (!t) return null;
    const list = measurementsFor(t.id).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    const latest = list[list.length - 1];
    const base = { eyebrow: escapeHtml(t.name) };
    if (!latest) {
      return { html: glanceHtml({ ...base, empty: true, row2: `${glanceMeter(0)}<span class="lg-tx">Log your first entry to start</span>${glanceLink(t.goal != null ? 'Goal' : 'Set goal')}` }), link: () => openTrackerForm(t.id) };
    }
    let row2;
    if (t.kind === 'sleep') {
      const recent = list.slice(-7);
      const avg = recent.reduce((sum, m) => sum + m.value, 0) / recent.length;
      row2 = `${t.goal != null ? glanceMeter((latest.value / t.goal) * 100, latest.value >= t.goal ? ' is-complete' : '') : ''}<span class="lg-tx">Avg ${round(avg, 1)} hr, last ${recent.length} night${recent.length === 1 ? '' : 's'}</span>`;
    } else if (t.goal != null) {
      const { pct, achieved } = trackerProgressPct(t, latest.value);
      row2 = `${glanceMeter(pct, achieved ? ' is-complete' : '')}<span class="lg-tx">${achieved ? 'Goal reached' : `${fmtTrackerValue(t, Math.abs(t.goal - latest.value))} to go`}</span>`;
    } else {
      row2 = `<span class="lg-tx">Last: ${relDay(latest.date)}</span>`;
    }
    return {
      html: glanceHtml({ ...base, value: trackerDisplayFromCanonical(t, latest.value), unit: trackerUnitLabel(t), row2: row2 + glanceLink(t.goal != null ? 'Goal' : 'Set goal') }),
      link: () => openTrackerForm(t.id),
    };
  }
  function waterGlance() {
    const goal = state.water.goalMl;
    const total = waterTotalForDate(todayISO());
    const unit = Units.volumeUnitLabel();
    const show = (ml) => round(Units.mlToDisplay(ml), 0);
    const status = !goal ? 'No daily goal' : total >= goal ? 'Goal met' : `${show(goal - total)} to go of ${show(goal)} ${unit}`;
    return {
      html: glanceHtml({ eyebrow: 'Today', value: show(total), unit,
        row2: `${goal ? glanceMeter((total / goal) * 100, total >= goal ? ' is-complete' : '') : ''}<span class="lg-tx">${status}</span>${glanceLink(goal ? 'Goal' : 'Set goal')}` }),
      link: () => openManageCategory('water'),
    };
  }
  function foodGlance() {
    const eaten = foodTotalsForDate(todayISO()).calories || 0;
    const cal = macroGoalInfo('calories');
    const goal = cal.enabled && cal.goal != null ? cal.goal : null;
    const fmt = (n) => Math.round(n).toLocaleString();
    const status = goal == null ? 'No calorie target' : eaten > goal ? `${fmt(eaten - goal)} over ${fmt(goal)}` : `${fmt(goal - eaten)} left of ${fmt(goal)}`;
    return {
      html: glanceHtml({ eyebrow: 'Today', value: fmt(eaten), unit: 'kcal',
        row2: `${goal != null ? glanceMeter((eaten / goal) * 100, eaten > goal ? ' is-over' : '') : ''}<span class="lg-tx">${status}</span>${glanceLink('Day')}` }),
      link: () => openFoodDetail(),
    };
  }
  const GLANCES = { workout: workoutGlance, daily: dailyGlance, measurements: bodyGlance, water: waterGlance, food: foodGlance };

  function renderLogGlance() {
    const card = document.getElementById('logGlance');
    const on = availableDomainCategories().some((c) => c.id === logCategory) || (logWorkoutBorrowed && logCategory === 'workout');
    const g = on ? GLANCES[logCategory]() : null;
    card.hidden = !g;
    if (!g) return;
    card.innerHTML = g.html;
    const link = card.querySelector('[data-glance-link]');
    if (link && g.link) link.addEventListener('click', g.link);
  }

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
              <input type="number" inputmode="decimal" step="0.25" min="0.25" id="savedFoodCustomQty" value="${savedFoodQty}" aria-label="Servings" data-enter-clicks="logSavedFoodBtn" />
              <button type="button" class="stepper-btn" data-step="1" aria-label="More servings">${uiIcon('plus')}</button>
            </div></div>
          <label class="field"><span class="field-label">Date</span>
            <input type="date" id="savedFoodDate" value="${savedFoodDate || todayISO()}" /></label>
          <p class="muted-text field-hint" id="savedFoodLogsHint">Logs: ${macroSummaryText(scaledSavedFoodValues(food, savedFoodQty))}</p>
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
      // Only store the amount here. Re-rendering on blur would replace the Log it button under a tap.
      customInput.addEventListener('input', () => {
        const raw = parseFloat(customInput.value);
        if (Number.isNaN(raw) || raw <= 0) return;
        savedFoodQty = Math.min(99, raw);
        const f = savedFoodById(expandedSavedFoodId);
        const hint = document.getElementById('savedFoodLogsHint');
        if (f && hint) hint.textContent = `Logs: ${macroSummaryText(scaledSavedFoodValues(f, savedFoodQty))}`;
      });
    }
    const dateInput = document.getElementById('savedFoodDate');
    if (dateInput) dateInput.addEventListener('input', () => { savedFoodDate = dateInput.value || null; });
    const logBtn = document.getElementById('logSavedFoodBtn');
    if (logBtn) logBtn.addEventListener('click', () => {
      const customInput = document.getElementById('savedFoodCustomQty');
      if (customInput) {
        const raw = parseFloat(customInput.value);
        if (Number.isNaN(raw) || raw <= 0) { toast('Enter how many servings, more than 0.'); return; }
        savedFoodQty = Math.min(99, raw);
      }
      logSavedFood(expandedSavedFoodId, savedFoodQty);
    });
  }

  // `date` is given by one-tap quick-add (always today); the expanded row's Log button omits it
  // and uses that row's date picker.
  function logSavedFood(foodId, qty, date) {
    const food = savedFoodById(foodId);
    if (!food) return;
    const values = scaledSavedFoodValues(food, qty);
    if (macroTooBig(values)) return;
    const dateEl = document.getElementById('savedFoodDate');
    date = date || (dateEl && dateEl.value) || savedFoodDate || todayISO();
    if (!window.FitBackup.validDate(date, todayISO())) { toast('Pick a valid date, no more than a day or two ahead.'); return; }
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
    // Lifting and rep exercises: logging the same exercise again on the same day adds sets to that
    // day's entry rather than starting a second workout, since each time is another set toward
    // the day's total. Cardio runs (and habits) stay separate entries.
    const sameDay = Array.isArray(fields.sets) ? state.entries.filter((e) => e.exerciseId === ex.id && e.date === date && Array.isArray(e.sets) && e.sets.length).pop() : null;
    let message = 'Entry saved';
    if (sameDay) {
      const hasPrimary = sameDay.sets.some((st) => st.primary);
      sameDay.sets = sameDay.sets.concat(fields.sets.map((st) => (hasPrimary && st.primary ? Object.assign({}, st, { primary: undefined }) : st)));
      if (note) sameDay.note = sameDay.note && !sameDay.note.includes(note) ? `${sameDay.note} · ${note}` : (sameDay.note || note);
      message = `Added ${fields.sets.length === 1 ? 'a set' : `${fields.sets.length} sets`} to ${date === todayISO() ? 'today’s' : 'that day’s'} ${ex.name}`;
    } else {
      state.entries.push(Object.assign({ id: genId('en'), exerciseId: ex.id, date, note: note || null }, fields));
    }
    if (!save()) return;
    toast(message);
    document.getElementById('logNote').value = '';
    renderDynamicFields(document.getElementById('logDynamicFields'), ex);
    renderLogExerciseHead();
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  // A month calendar above the entry list, with a dot per category active that day
  // (colors in `.cal-dot-*` in styles.css, slots in CAL_DOT_SLOTS): workout, daily, water goal
  // met, food, body measurement. Tapping a day filters "All entries" (within the active
  // domain tab) to that day; tapping it again clears the filter.

  let calendarMonth = (() => { const d = new Date(); d.setDate(1); return d; })();

  // Date filter for the "All entries" list; null shows everything. Starts as today.
  let historySelectedDate = todayISO();

  // Fixed order (left to right) for the calendar dots and their legend.
  const CAL_DOT_SLOTS = [['workout', 'cal-dot-workout'], ['daily', 'cal-dot-daily'], ['water', 'cal-dot-water'], ['food', 'cal-dot-food'], ['measurements', 'cal-dot-body']];

  function dayActivity(dateIso) {
    // A domain switched off in Manage shows no dot.
    const dayEntries = state.entries.filter((e) => e.date === dateIso);
    const workout = domainTracked('workout') && dayEntries.some((e) => !isDailyEntry(e));
    const daily = domainTracked('daily') && dayEntries.some(isDailyEntry);
    const body = domainTracked('measurements') && state.measurements.some((m) => m.date === dateIso);
    const waterHit = domainTracked('water') && !!(state.water.goalMl && waterTotalForDate(dateIso) >= state.water.goalMl);
    const food = domainTracked('food') && state.food.entries.some((e) => e.date === dateIso);
    return { workout, daily, body, waterHit, food };
  }

  /* Calendar streaks
     Each legend entry carries its area's current streak, counted on the same days its dot
     marks: weeks for workouts (rest days never break it), days for Daily, Water goal and
     Food, and days or weeks for Body depending on how often it is logged
     (FitCalc.loggingRhythm). Today may still be empty without breaking a streak. */
  const CAL_AREA_NAMES = { workout: 'Workout', daily: 'Daily', water: 'Water goal', food: 'Food', measurements: 'Body' };
  function calendarStreaks() {
    const C = window.FitCalc;
    const dates = { workout: new Set(), daily: new Set(), water: new Set(), food: new Set(), measurements: new Set() };
    state.entries.forEach((e) => (isDailyEntry(e) ? dates.daily : dates.workout).add(e.date));
    state.measurements.forEach((m) => dates.measurements.add(m.date));
    state.food.entries.forEach((f) => dates.food.add(f.date));
    const goal = state.water.goalMl;
    if (goal) Object.entries(waterByDate()).forEach(([d, ml]) => { if (ml >= goal) dates.water.add(d); });
    const out = {};
    Object.entries(dates).forEach(([area, set]) => {
      const unit = area === 'workout' || (area === 'measurements' && C.loggingRhythm([...set]) === 'week') ? 'week' : 'day';
      out[area] = { unit, current: unit === 'week' ? C.computeWeekStreak(set, todayISO()) : C.computeStreak(set, todayISO()), best: C.longestStreak(set, unit) };
    });
    return out;
  }

  function renderCalendarLegend() {
    const streaks = calendarStreaks();
    document.getElementById('calendarLegend').innerHTML = CAL_DOT_SLOTS.filter(([area]) => domainTracked(area)).map(([area, cls]) => {
      const { unit, current, best } = streaks[area];
      const count = current ? `<span class="cal-streak">${FLAME_ICON_SVG}${plural(current, unit)}<span class="sr-only"> in a row, best ${plural(best, unit)}</span></span>` : '';
      return `<span class="cal-key"><i class="cal-dot ${cls}"></i>${CAL_AREA_NAMES[area]}${count}</span>`;
    }).join('');
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
      const { workout, daily, body, waterHit, food } = dayActivity(dateIso);
      const doneToday = [workout && 'workout', daily && 'daily', waterHit && 'water goal', food && 'food', body && 'body'].filter(Boolean);
      const label = `${new Date(year, month, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${doneToday.length ? ', ' + doneToday.join(', ') : ''}`;
      const dots = CAL_DOT_SLOTS.filter(([area]) => domainTracked(area))
        .map(([area, cls]) => `<span class="cal-dot ${cls}${({ workout, daily, water: waterHit, food, measurements: body })[area] ? '' : ' is-empty'}"></span>`).join('');
      html += `
        <button type="button" class="calendar-day ${dateIso === todayIso ? 'is-today' : ''} ${dateIso === historySelectedDate ? 'is-selected' : ''}" data-date="${dateIso}" aria-label="${label}" aria-pressed="${dateIso === historySelectedDate}">
          <span>${day}</span>
          <span class="calendar-day-dots">${dots}</span>
        </button>`;
    }
    document.getElementById('calendarGrid').innerHTML = html;
    renderCalendarLegend();
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
    const daily = historyCategory === 'daily';
    const groups = groupBySection(state.exercises.filter((e) => isDailyEx(e) === daily));
    let html = `<option value="__all__">${daily ? 'All habits and daily reps' : 'All exercises'}</option>`;
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
    document.getElementById('historyFilterField').hidden = !(historyCategory === 'workout' || historyCategory === 'daily') || !cats.length;
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
      .filter((e) => isDailyEntry(e) === (historyCategory === 'daily'))
      .filter((e) => filter === '__all__' || e.exerciseId === filter)
      .filter((e) => !historySelectedDate || e.date === historySelectedDate)
      .slice()
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    setHistoryEmpty(list.length === 0);
    wrap.innerHTML = list.map((e) => entryRowHtml(e)).join('');
    wireEntryRowClicks(wrap);
  }

  function openEntryModal(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const ex = exerciseById(entry.exerciseId);
    openModal(`
      <div class="modal-title-row"><h2>Edit entry</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
      if (logCategory === 'daily') renderLogDailyPanel();
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.entries = state.entries.filter((e) => e.id !== entryId);
        if (!save()) return;
        toast('Entry deleted');
        if (logCategory === 'daily') renderLogDailyPanel();
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
    logWorkoutBorrowed = isDailyEx(exerciseById(exId));
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
          <button class="icon-btn" id="editExerciseBtn" aria-label="Edit habit">${EDIT_ICON_SVG}</button>
          <button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
      <div class="card">
        <div class="ex-card-badge badge-standalone">${kindBadge(ex)}${escapeHtml(exerciseGoalSummary(ex))}</div>
        ${habitPanelHtml(ex)}
        <p class="muted-text">${habitRepeatDays(ex) === 1 ? `Target met on ${hit} of the last 30 days.` : `Done ${hit} time${hit === 1 ? '' : 's'} in the last 30 days, about ${Math.floor(30 / habitRepeatDays(ex))} due.`}</p>
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

    const standardsHtml = ex.kind !== 'cardio' && state.settings.showStrengthLevel ? strengthStandardsDetailHtml(ex)
      : ex.kind === 'cardio' && state.settings.showPaceLevel ? runStandardsDetailHtml(ex)
      : '';

    openModal(`
      <div class="modal-title-row">
        <h2 class="title-with-icon">${exerciseIconHtml(ex)}${exerciseLabelHtml(ex)}</h2>
        <div class="modal-title-actions">
          <button class="icon-btn" id="editExerciseBtn" aria-label="Edit exercise">${EDIT_ICON_SVG}</button>
          <button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
      <div class="card">
        <div class="ex-card-badge badge-standalone">${kindBadge(ex)}</div>
        ${progressHtml}
      </div>

      <div class="btn-row detail-actions">
        <button type="button" class="btn btn-primary" id="logEntryFromDetailBtn">Log entry</button>
        <button type="button" class="btn btn-secondary" id="editGoalFromDetailBtn">Edit goal</button>
      </div>

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
      <div class="modal-title-row"><h2>Next session</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>

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

  // `preset` ({ kind, section }) only sets the starting choices of a NEW exercise; Manage > Daily
  // passes a habit.
  function openExerciseForm(exId, preset) {
    const editing = !!exId;
    const ex = editing ? exerciseById(exId) : null;
    const hasEntries = editing && entriesFor(exId).length > 0;
    const kind = ex ? ex.kind : ((preset && preset.kind) || 'weight');
    const section = ex ? sectionOf(ex) : ((preset && preset.section) || 'goal');
    const bodyRegion = ex ? (ex.bodyRegion || 'upper') : 'upper';

    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit exercise' : (preset && preset.kind === 'habit' ? 'Add to Daily' : 'Add exercise')}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
          <span class="field-label">Type${hasEntries ? ' (locked: has logged entries)' : ''}</span>
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
          <label class="field-label" for="exStandard">Strength standard <span class="muted-text">(for the optional "Strength level" insight in Settings)</span></label>
          <select id="exStandard"></select>
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
      daily: 'Something you’re aiming to do every day (push-ups, pull-ups, ...). Lives in the Daily tab, and in Daily targets on your home screen.',
      accessory: 'Hidden from your home screen. Still loggable and viewable in History — for accessory/other exercises.',
      habit: 'Habits are always daily targets.',
    };

    // A daily target adds up every set logged that day (todayProgressOf); a goal counts the best single set.
    function repsGoalLabel(timed) {
      if (selectedSection === 'daily') return timed ? 'Time per day (seconds, all sets)' : 'Reps per day (all sets)';
      return timed ? 'Goal time (seconds, single set)' : 'Goal reps (single set)';
    }
    function setSectionUI(s) {
      selectedSection = s;
      const repsLabel = document.getElementById('repsGoalLabel');
      if (repsLabel) repsLabel.textContent = repsGoalLabel(selectedUnit === 'time');
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
    // The Strength Level table for this form: the one picked in the select, else the
    // library's match for a movement added from it. Weight exercises use 1RM tables and
    // rep exercises (not timed holds) use rep tables.
    const standardMetric = () => (selectedKind === 'weight' ? '1rm' : selectedKind === 'reps' && selectedUnit !== 'time' ? 'reps' : null);
    function formAutoKey() {
      const k = ex ? autoStandardKey(ex) : null;
      return k && S.STRENGTH[k].metric === standardMetric() ? k : null;
    }
    function formStandardKey() {
      const std = selectedLiftType && S.STRENGTH[selectedLiftType];
      if (std && std.metric === standardMetric()) return selectedLiftType;
      return formAutoKey();
    }
    let standardBuiltFor = null;
    function renderStandardField() {
      const metric = standardMetric();
      document.getElementById('liftTypeField').hidden = !metric;
      if (!metric) return;
      const sel = document.getElementById('exStandard');
      if (selectedLiftType && (!S.STRENGTH[selectedLiftType] || S.STRENGTH[selectedLiftType].metric !== metric)) selectedLiftType = '';
      if (standardBuiltFor !== metric) {
        standardBuiltFor = metric;
        const auto = formAutoKey();
        const groups = {};
        S.STRENGTH_KEYS.filter((k) => S.STRENGTH[k].metric === metric).forEach((k) => { (groups[S.STRENGTH[k].group] = groups[S.STRENGTH[k].group] || []).push(k); });
        sel.innerHTML = `<option value="">${auto ? `Automatic: ${escapeHtml(S.STRENGTH[auto].label)}` : 'None'}</option>`
          + Object.keys(groups).map((g) => `<optgroup label="${g[0].toUpperCase()}${g.slice(1)}">${groups[g].map((k) => `<option value="${k}">${escapeHtml(S.STRENGTH[k].label)}</option>`).join('')}</optgroup>`).join('');
      }
      sel.value = selectedLiftType;
    }
    document.getElementById('exStandard').addEventListener('change', (e) => {
      selectedLiftType = e.target.value;
      if (!formStandardKey()) selectedGoalMode = 'fixed';
      renderGoalField();
    });
    document.querySelectorAll('#exSectionSegmented button').forEach((b) => b.addEventListener('click', () => setSectionUI(b.dataset.section)));
    document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.addEventListener('click', () => setRegionUI(b.dataset.region)));
    setSectionUI(selectedSection);
    setRegionUI(selectedRegion);

    // The weight goal field: a plain number, or, with a lift type, a "Fixed number" /
    // "Bodyweight standard" toggle with the same Beginner..Elite preview as the wizard.
    function weightGoalFieldHtml() {
      const fixedVal = ex && ex.goal ? round(Units.lbToDisplay(ex.goal), 1) : '';
      const stdKey = formStandardKey();
      if (!stdKey) {
        return `<label class="field"><span class="field-label">Goal weight (${Units.weightUnitLabel()})</span><input type="number" step="any" id="goalInput" value="${fixedVal}"${canonAttr(ex && ex.goal)} placeholder="e.g. 225" /></label>`;
      }
      const bw = currentBodyWeightLb();
      const sex = state.profile.sex;
      const rows = standardGoalPreviewRows(stdKey, bw, sex);
      const canUseStandards = !!rows;
      // A standard goal saved earlier stays selected while body weight or sex is missing;
      // it fills in again by itself (recomputeStandardGoals) once both exist.
      const waitingStandard = !canUseStandards && selectedGoalMode === 'standard';
      return `
        <div class="field">
          <span class="field-label">Goal style</span>
          <div class="segmented" id="exGoalModeSegmented" role="radiogroup" aria-label="Goal style">
            <button type="button" data-goal-mode="fixed" role="radio" aria-checked="${selectedGoalMode === 'fixed'}">Fixed number</button>
            <button type="button" data-goal-mode="standard" role="radio" aria-checked="${selectedGoalMode === 'standard'}" ${canUseStandards || waitingStandard ? '' : 'disabled'}>Bodyweight standard</button>
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
        ` : waitingStandard ? `
          <p class="muted-text field-hint">Your ${escapeHtml(selectedGoalTier || 'standard')} goal is kept and shows again once body weight and sex are set. Pick Fixed number to type a goal instead.</p>
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
      renderStandardField();
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
          <div class="field"><span class="field-label">Measured in${hasEntries ? ' (locked: has logged entries)' : ''}</span>
            <div class="segmented" id="exUnitSeg" role="radiogroup">
              <button type="button" role="radio" data-unit="reps" aria-checked="${!timed}" ${hasEntries ? 'disabled' : ''}>Reps</button>
              <button type="button" role="radio" data-unit="time" aria-checked="${timed}" ${hasEntries ? 'disabled' : ''}>Seconds held</button>
            </div></div>
          <label class="field"><span class="field-label" id="repsGoalLabel">${repsGoalLabel(timed)}</span><input type="number" step="1" min="1" id="goalInput" value="${v}" placeholder="${timed ? 'e.g. 60' : 'e.g. 20'}" /></label>`;
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
      const usingStandardGoal = selectedKind === 'weight' && !!formStandardKey() && selectedGoalMode === 'standard';
      if (usingStandardGoal) {
        goal = computeStandardGoal(formStandardKey(), selectedGoalTier, currentBodyWeightLb(), state.profile.sex);
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
        if (m < 0 || s < 0 || s >= 60) { toast('Pace needs whole minutes and 0 to 59 seconds.'); return; }
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
          ex.bodyRegion = selectedRegion;
          ex.goalMode = usingStandardGoal ? 'standard' : 'fixed';
          ex.goalTier = usingStandardGoal ? selectedGoalTier : null;
        } else {
          delete ex.bodyRegion; ex.goalMode = 'fixed'; ex.goalTier = null;
        }
        ex.liftType = standardMetric() ? (selectedLiftType || null) : null;
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
          newEx.bodyRegion = selectedRegion;
          newEx.goalMode = usingStandardGoal ? 'standard' : 'fixed';
          newEx.goalTier = usingStandardGoal ? selectedGoalTier : null;
        }
        if (standardMetric()) newEx.liftType = selectedLiftType || null;
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
      wireOpenable(row, () => openMeasurementModal(row.getAttribute('data-measurement-id')));
    });
  }

  function openMeasurementModal(measurementId) {
    const m = state.measurements.find((x) => x.id === measurementId);
    if (!m) return;
    const tracker = trackerById(m.trackerId);
    const isSleep = tracker && tracker.kind === 'sleep';
    openModal(`
      <div class="modal-title-row"><h2>Edit entry</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
          <button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
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

  const UNIT_KIND_LABELS = { weight: 'Weight', length: 'Length', percent: 'Percent', hours: 'Hours', rating: 'Rating (1–5)', count: 'Custom number' };

  function unitLabelForKind(unitKind, ratingMax) {
    switch (unitKind) {
      case 'weight': return Units.weightUnitLabel();
      case 'length': return Units.lengthUnitLabel();
      case 'percent': return '%';
      case 'hours': return 'hr';
      case 'rating': return `/ ${Number(ratingMax) || 5}`;
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
      <div class="modal-title-row"><h2>${editing ? 'Edit tracker' : 'Add tracker'}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
          if (trackerId === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
          if (!save()) return;
          toast('Tracker deleted'); renderAll();
        }, true);
      });
    }
  }

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
      <div class="modal-title-row"><h2>${editing ? 'Edit cup' : 'Add cup'}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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
        confirmDialog('Delete this cup?', 'This can’t be undone. Water already logged with it keeps its amount and name.', 'Delete', () => {
          // Keep the name on past entries so History still says what was logged.
          state.waterEntries.forEach((w) => { if (w.cupId === cupId) w.cupName = cup.name; });
          state.water.cups = state.water.cups.filter((c) => c.id !== cupId);
          if (!save()) return;
          toast('Cup deleted');
          renderManage();
          renderDashboard();
          renderLogWaterPanel();
          renderRecentEntries();
          renderHistory();
        }, true);
      });
    }
  }

  /* Manage
     One tab with five domain panels (Workout, Daily, Body, Water, Food) switched by
     manageCategorySegmented. All five always show (ALL_DOMAIN_CATEGORIES), since this is
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
    document.getElementById('manageDailyPanel').hidden = cat !== 'daily';
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
      wrap.addEventListener('change', (ev) => {
        const input = ev.target.closest('[data-macro-goal-input]');
        if (!input) return;
        const k = input.dataset.macroGoalInput;
        const raw = parseFloat(input.value);
        const info = macroGoalInfo(k);
        info.goal = (!Number.isNaN(raw) && raw > 0) ? raw : null;
        if (info.goal != null && info.goal > window.FitBackup.macroLimit(k)) { toast(`That ${MACRO_LABELS[k].toLowerCase()} goal is too large to be right.`); info.goal = null; renderMacroGoalRows(); return; }
        // A typed goal is a goal: switch it on (clearing calories keeps the calorie mode as it is).
        if (info.goal != null) info.enabled = true;
        else if (k !== 'calories') info.enabled = false;
        if (!save()) return;
        renderMacroGoalRows();
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
    [renderExerciseManageList, renderDailyManageList, renderImportCard, renderTidyCard, renderTrackerManageList, renderWaterManagePanel, renderFoodManagePanel].forEach((fn) => {
      try { fn(); } catch (e) { console.error('Manage section failed:', fn.name, e); }
    });
  }

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
    const hv = document.getElementById('profileHeightVal');
    if (!state.profile.heightCm) hv.textContent = 'Not set';
    else if (state.settings.lengthUnit === 'cm') hv.textContent = `${round(state.profile.heightCm, 1)} cm`;
    else { const { ft, inch } = cmToFtIn(state.profile.heightCm); hv.textContent = `${ft} ft ${inch} in`; }
    document.getElementById('profileAgeVal').textContent = state.profile.age != null ? String(state.profile.age) : 'Not set';
    document.getElementById('profileSexVal').textContent = state.profile.sex === 'male' ? 'Male' : state.profile.sex === 'female' ? 'Female' : 'Not set';

    document.querySelectorAll('#dashboardChartScaleSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scaleChoice === state.settings.chartScale)));
    document.querySelectorAll('#insightsWindowSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.windowChoice === String(state.settings.insightsWindowDays))));
  }

  // Settings > About the numbers: built from FitStandards.REFERENCES so the
  // screen and the maths cannot drift apart.
  function openReferencesModal() {
    const link = (r) => (r && r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.label)}</a>` : r ? escapeHtml(r.label) : '');
    const badge = (k) => `<span class="tag${k === 'reference' ? ' tag-good' : ''}">${k === 'reference' ? 'Published reference' : 'App assumption'}</span>`;
    openModal(`
      <div class="modal-title-row"><h2>About the numbers</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
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

  /* Backup validation
     The checks live in js/backup.js (FitBackup.validate). Returns an error string or null. */

  function validateBackupShape(parsed) {
    return window.FitBackup.validate(parsed, { schemaVersion: SCHEMA_VERSION, macroKeys: MACRO_KEYS, todayIso: todayISO(), strengthKeys: S.STRENGTH_KEYS, activityKeys: Object.keys(S.ACTIVITY_LEVELS), goalKeys: Object.keys(S.GOAL_ADJUST) });
  }

  function downloadJson(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportBackup() {
    downloadJson(`fit-log-backup-${todayISO()}.json`, JSON.stringify(state, null, 2));
    toast('Backup downloaded');
  }

  // Settings -> Erase data. Removes the one storage key and reloads, so the app comes back
  // exactly as on a first install (the setup guide). Nothing is sent anywhere; there is no
  // other copy, which is why the dialog says so and offers a backup first.
  function eraseAllData() {
    openModal(`
      <div class="modal-title-row"><h2>Erase all data?</h2><button class="modal-close" data-action="close-modal" aria-label="Close">${CLOSE_ICON_SVG}</button></div>
      <p class="muted-text"><strong>This can&rsquo;t be reversed.</strong> Every exercise, entry, measurement, water and food log, habit, your profile and your settings will be deleted from this device, and Fit Log will start over from the setup guide.</p>
      <p class="muted-text">There is no other copy. Export a backup first if you might want your data back.</p>
      <button type="button" class="btn btn-secondary btn-block btn-icon-label" id="eraseExportBtn"><span data-icon="download"></span>Export a backup first</button>
      <div class="btn-row confirm-actions">
        <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger-solid" id="eraseConfirmBtn">Erase everything</button>
      </div>
    `);
    hydrateStaticIcons();
    document.getElementById('eraseExportBtn').addEventListener('click', exportBackup);
    document.getElementById('eraseConfirmBtn').addEventListener('click', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { toast('Could not erase: your browser blocked access to storage.'); return; }
      location.reload();
    });
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
          try { state = upgradeData(parsed); } catch (e) { state = previousState; toast('Can’t import: that backup could not be upgraded.'); return; }
          if (!save()) { state = previousState; return; }
          applyTheme();
          renderAll();
          toast('Backup imported');
        }, true);
      } catch (e) {
        toast('That file doesn’t look like a valid Fit Log backup.');
      }
    };
    reader.onerror = () => toast('Could not read that file.');
    reader.readAsText(file);
  }

  /* First-run setup wizard
     Shown once, only when there is no saved data (see load()). It builds a starting state like
     defaultData(), tailored to the answers; anything skipped can be added later in Manage or
     Settings. */

  // The step list is computed from the Interests answers (setupStepSequence()),
  // so `setupStepIndex` indexes whatever that sequence currently is. Turning an
  // interest off removes its step.
  let setupStepIndex = 0;
  let setupAnswers = {
    // What this install tracks (see renderSetupStepInterests). Lifting, Cardio,
    // Habits, Body weight and Water start on; Sleep and Food start off. Lifting and Cardio
    // also decide which exercises are added to the library at the end.
    interests: { lifting: true, running: true, habits: true, bodyweight: true, sleep: false, water: true, food: false },
    // How the calorie target is set: 'calc' | 'manual' | 'none'.
    calorieMode: 'none', calorieManual: '', calorieGoal: 'maintain', commonFoods: true, macros: null,
    heightFt: '', heightIn: '', heightCm: '',
    weight: '', age: '', sex: '',
    // "Skip" on a card of the About step empties it and locks its fields.
    skipWeight: false, skipBody: false,
    // Optional target weight, asked next to the weight when Body is on. '' = none.
    weightGoalValue: '',
    // Habits ticked on the last step (catalog ids), custom ones typed in, and whether the full list is open.
    habits: {}, habitsAll: false, customHabits: [], habitForm: null,
    // Lifting goals ticked on the Lifting step: id -> { on, mode: 'fixed'|'standard', tier, text }.
    // `text` is what the goal box holds once edited; null means the typical goal, untouched.
    liftGoals: {}, customGoals: [], goalForm: null,
    // Cardio goals ticked on the Cardio step: id -> { on, type: 'distance'|'pace'|'both', dist, min, sec }
    // (each null until edited).
    cardioGoals: {},
    // Water guide: 'calc' | 'manual', the activity level, and the goal box once edited (null = the guide's number).
    waterMode: 'calc', waterActivity: 'moderate', waterText: null,
  };

  // Recomputed on every render. 'interests' and 'about' always come first; the rest
  // follow the Interests answers (changeable only at index 0). Habits closes the wizard.
  function setupStepSequence() {
    const i = setupAnswers.interests;
    const seq = ['interests', 'about'];
    if (i.lifting) seq.push('lifting');
    if (i.running) seq.push('cardio');
    if (i.food) seq.push('food');
    if (i.water) seq.push('water');
    if (i.habits) seq.push('habits');
    return seq;
  }
  const SETUP_STEP_LEADS = {
    interests: 'Pick only what you will use. Anything left off stays out of sight, and you can turn it on later in Manage.',
    about: 'All optional. Each answer powers one thing, and every one can be skipped.',
    lifting: 'Every lift is added to your library for you. Tick the ones you want a goal for; each goal can be changed later.',
    cardio: 'Every cardio activity is added to your library for you. Tick the ones you want a distance or pace goal for.',
    food: 'Set a daily calorie target and choose what to track. All of it can be changed in Manage → Food.',
    water: 'A guide from your height and weight, or type your own number. You can change it in Manage → Water.',
    habits: 'Anything you want to check off and keep consistent. Tap to add, or add your own; you can change how often later.',
  };
  const SETUP_STEP_TITLES = { interests: 'What do you want to track?', about: 'A little about you', lifting: 'Lifting goals', cardio: 'Cardio goals', food: 'Food targets', water: 'Daily water', habits: 'Daily habits' };
  // The picture beside each step's title.
  const SETUP_STEP_ICONS = {
    get interests() { return itemIconSvg('target'); }, get about() { return itemIconSvg('standing'); },
    get lifting() { return itemIconSvg('dumbbell'); }, get cardio() { return itemIconSvg('sport-shoe'); },
    get food() { return itemIconSvg('apple'); }, get water() { return itemIconSvg('droplets'); },
    get habits() { return STATIC_ICONS.habits; },
  };

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
    document.getElementById('setupNextBtn').textContent = setupStepIndex === seq.length - 1 ? 'Open Fit Log' : 'Continue';
    // A step that can be passed over whole gets a quiet second button.
    const skipBtn = document.getElementById('setupSkipBtn');
    skipBtn.hidden = !(key === 'about' || key === 'habits');
    document.getElementById('setupHero').innerHTML = SETUP_STEP_ICONS[key] || '';
    skipBtn.textContent = key === 'habits' ? 'Skip habits' : 'Not now';
    window.scrollTo(0, 0);
    if (key === 'interests') renderSetupStepInterests();
    else if (key === 'about') renderSetupStepAbout();
    else if (key === 'lifting') renderSetupStepLifting();
    else if (key === 'cardio') renderSetupStepCardio();
    else if (key === 'food') renderSetupStepFood();
    else if (key === 'water') renderSetupStepWater();
    else renderSetupStepHabits();
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
        ${interestTileHtml('running', STATIC_ICONS.footprints, 'Cardio', i.running, 'Running, walking, cycling, with distance and pace goals')}
        ${interestTileHtml('habits', STATIC_ICONS.daily, 'Daily', i.habits, 'Creatine, stretching, daily reps, anything daily')}
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

  // US and Metric each set all four display units at once; Settings still lets them be mixed.
  const SETUP_UNIT_SYSTEMS = {
    us: { weightUnit: 'lb', distanceUnit: 'mi', lengthUnit: 'in', volumeUnit: 'flOz' },
    metric: { weightUnit: 'kg', distanceUnit: 'km', lengthUnit: 'cm', volumeUnit: 'mL' },
  };
  const setupUnitSystem = () => (state.settings.weightUnit === 'kg' && state.settings.lengthUnit === 'cm' ? 'metric' : 'us');

  // Switching system carries any weight and height already typed across, so nothing is lost.
  function setSetupUnitSystem(system) {
    const a = setupAnswers;
    // The exact stored value is remembered next to the text it produced, so switching back
    // and forth does not wear 178 lb down to 177.9 through rounding.
    const w = parseFloat(a.weight);
    const weightLb = a.weight === a.weightShown && a.weightCanon != null ? a.weightCanon : (w > 0 ? Units.displayToLb(w) : null);
    const heightKey = `${a.heightCm}|${a.heightFt}|${a.heightIn}`;
    const heightCm = heightKey === a.heightShown && a.heightCanon != null ? a.heightCanon : heightCmFromSetup();
    // Goal boxes already edited are carried across in pounds; untouched ones simply follow the new unit.
    const carryLb = (text) => (parseFloat(text) > 0 ? Units.displayToLb(parseFloat(text)) : null);
    const lbGoals = SETUP_LIFTS.filter(isWeightGoal).map((d) => [a.liftGoals[d.id], a.liftGoals[d.id] && a.liftGoals[d.id].text != null ? carryLb(a.liftGoals[d.id].text) : null]);
    const lbCustom = a.customGoals.filter((c) => c.kind === 'weight').map((c) => [c, carryLb(c.text)]);
    const waterMl = a.waterText != null && parseFloat(a.waterText) > 0 ? Units.displayToMl(parseFloat(a.waterText)) : null;
    const wGoal = carryLb(a.weightGoalValue);
    Object.assign(state.settings, SETUP_UNIT_SYSTEMS[system]);
    lbGoals.forEach(([g, lb]) => { if (g && lb != null) g.text = String(round(Units.lbToDisplay(lb), 1)); });
    lbCustom.forEach(([c, lb]) => { if (lb != null) c.text = String(round(Units.lbToDisplay(lb), 1)); });
    if (waterMl != null) a.waterText = String(round(Units.mlToDisplay(waterMl), 0));
    if (wGoal != null) a.weightGoalValue = String(round(Units.lbToDisplay(wGoal), 1));
    Object.values(a.cardioGoals).forEach((g) => { g.dist = null; g.min = null; g.sec = null; });
    if (weightLb != null) a.weight = String(round(Units.lbToDisplay(weightLb), 1));
    a.heightCm = ''; a.heightFt = ''; a.heightIn = '';
    if (heightCm != null) {
      if (system === 'metric') a.heightCm = String(Math.round(heightCm));
      else { const totalIn = Math.round(Units.cmToDisplay(heightCm)); a.heightFt = String(Math.floor(totalIn / 12)); a.heightIn = String(totalIn % 12); }
    }
    a.weightCanon = weightLb; a.weightShown = a.weight;
    a.heightCanon = heightCm; a.heightShown = `${a.heightCm}|${a.heightFt}|${a.heightIn}`;
  }

  function renderSetupStepAbout() {
    const a = setupAnswers; const i = a.interests;
    const system = setupUnitSystem();
    const cm = state.settings.lengthUnit === 'cm';
    // Only questions for modules that use the answer are shown (see the note below).
    const showWeight = i.lifting || i.bodyweight || i.food;
    const showBody = i.lifting || i.food;
    const why = (text) => `<div class="why">${uiIconInfo()}<span>${text}</span></div>`;
    const skipLink = (key, skipped) => `<button type="button" class="link-btn" data-skip-card="${key}" aria-pressed="${skipped}">${skipped ? 'Add' : 'Skip'}</button>`;
    const field = (id, value, suffix, label, extra = '', disabled = false) => `<div class="input-unit"><input type="number" ${extra.includes('placeholder') ? '' : 'placeholder="Not set"'} ${extra} id="${id}" value="${escapeHtml(value)}" aria-label="${label}" ${disabled ? 'disabled' : ''} /><span class="u">${suffix}</span></div>`;
    const hidden = [!showWeight && 'weight', !showBody && 'height, age and sex'].filter(Boolean);
    document.getElementById('setupContent').innerHTML = `
      <div class="card pad setup-card">
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('ruler', true)}<span class="lbl">Units</span></span></div>
        <div class="segmented segmented-fill" id="setupUnitSeg" role="radiogroup" aria-label="Units">
          <button type="button" role="radio" data-system="us" aria-checked="${system === 'us'}">US (lb, mi)</button>
          <button type="button" role="radio" data-system="metric" aria-checked="${system === 'metric'}">Metric (kg, km)</button>
        </div>
        ${why('Used for every number in the app. Stored in one standard unit underneath, so you can switch later without losing anything.')}
      </div>
      ${showWeight ? `<div class="card pad setup-card">
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('scale', true)}<span class="lbl">Body weight</span></span>${skipLink('weight', a.skipWeight)}</div>
        ${field('setupWeight', a.skipWeight ? '' : a.weight, Units.weightUnitLabel(), `Body weight in ${Units.weightUnitLabel()}`, 'step="any" min="0" inputmode="decimal"', a.skipWeight)}
        ${i.bodyweight ? `<span class="lbl">Target weight (optional)</span>
        ${field('setupWeightGoal', a.skipWeight ? '' : a.weightGoalValue, Units.weightUnitLabel(), `Target weight in ${Units.weightUnitLabel()}`, 'step="any" min="0" inputmode="decimal"', a.skipWeight)}` : ''}
        ${why('Used for your weight chart’s starting point and for strength standards such as bench press relative to body weight.')}
      </div>` : ''}
      ${showBody ? `<div class="card pad setup-card">
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('standing', true)}<span class="lbl">Height, age and sex</span></span>${skipLink('body', a.skipBody)}</div>
        <div class="input-pair${cm ? '' : ' is-wide'}">
          ${cm
            ? field('setupHeightCm', a.skipBody ? '' : a.heightCm, 'cm', 'Height in centimetres', 'step="any" min="50" max="272" inputmode="decimal"', a.skipBody)
            : `<div class="input-pair">${field('setupHeightFt', a.skipBody ? '' : a.heightFt, 'ft', 'Height, feet', 'step="1" min="0" max="8" inputmode="numeric" placeholder="0"', a.skipBody)}${field('setupHeightIn', a.skipBody ? '' : a.heightIn, 'in', 'Height, inches', 'step="1" min="0" max="11" inputmode="numeric" placeholder="0"', a.skipBody)}</div>`}
          ${field('setupAge', a.skipBody ? '' : a.age, 'age', 'Age in years', 'step="1" min="1" max="120" inputmode="numeric" placeholder="–"', a.skipBody)}
        </div>
        <div class="segmented segmented-fill" id="setupSexSegmented" role="radiogroup" aria-label="Sex">
          <button type="button" data-sex-choice="male" role="radio" aria-checked="${a.sex === 'male'}" ${a.skipBody ? 'disabled' : ''}>Male</button>
          <button type="button" data-sex-choice="female" role="radio" aria-checked="${a.sex === 'female'}" ${a.skipBody ? 'disabled' : ''}>Female</button>
          <button type="button" data-sex-choice="" role="radio" aria-checked="${a.sex === ''}" ${a.skipBody ? 'disabled' : ''}>Skip</button>
        </div>
        ${why('Used for the suggested calorie target and for strength and pace benchmarks. Skip it and you type your own calorie number instead.')}
      </div>` : ''}
      <div class="note-box">${uiIconInfo()}<span>${hidden.length ? `Only questions for the modules you picked are shown. Without ${hidden.length === 2 ? 'Body weight, Food or Lifting' : 'Food or Lifting'}, ${hidden.length === 2 ? 'this screen is just units.' : 'the height, age and sex questions are left out.'}` : 'Only questions for the modules you picked are shown.'}</span></div>`;
    document.querySelectorAll('#setupUnitSeg button').forEach((b) => {
      b.addEventListener('click', () => { captureSetupStep(); setSetupUnitSystem(b.dataset.system); renderSetupStepAbout(); });
    });
    document.querySelectorAll('#setupSexSegmented button').forEach((b) => {
      b.addEventListener('click', () => { captureSetupStep(); a.sex = b.dataset.sexChoice; renderSetupStepAbout(); });
    });
    document.querySelectorAll('[data-skip-card]').forEach((b) => {
      b.addEventListener('click', () => {
        captureSetupStep();
        if (b.dataset.skipCard === 'weight') { a.skipWeight = !a.skipWeight; if (a.skipWeight) a.weight = ''; }
        else { a.skipBody = !a.skipBody; if (a.skipBody) { a.heightCm = ''; a.heightFt = ''; a.heightIn = ''; a.age = ''; a.sex = ''; } }
        renderSetupStepAbout();
      });
    });
  }

  // Wizard last step: the habits catalog, with the five suggested ones up front and the rest
  // behind "Browse all", then a summary of what Home will show.
  const REPEAT_LABELS = { daily: 'Daily', 'every-other': 'Every other day', weekly: 'Weekly' };
  function setupHomePreviewHtml() {
    const a = setupAnswers; const i = a.interests;
    const chips = [];
    const nHabits = Object.keys(a.habits).filter((k) => a.habits[k]).length + a.customHabits.length;
    if (i.habits) chips.push(`Daily · ${nHabits} habit${nHabits === 1 ? '' : 's'}`);
    const nLifts = i.lifting ? setupLiftGoalCount() : 0;
    if (i.lifting) chips.push(`Workout · ${nLifts} goal${nLifts === 1 ? '' : 's'}`);
    const nCardio = i.running ? setupCardioGoalCount() : 0;
    if (i.running) chips.push(`Cardio · ${nCardio} goal${nCardio === 1 ? '' : 's'}`);
    if (i.food) {
      const kcal = a.calorieMode === 'manual' ? Math.round(parseFloat(a.calorieManual)) : a.calorieMode === 'calc' ? (setupCalcPreview() || {}).calories : null;
      chips.push(kcal > 0 ? `Nutrition · ${kcal.toLocaleString()} kcal` : 'Nutrition');
    }
    if (i.water) chips.push(`Water · ${fmtWaterAmount(setupWaterMl())}`);
    if (i.bodyweight && a.weightGoalValue !== '') chips.push('Weight goal');
    const off = [!i.water && 'Water', !i.bodyweight && 'Body', !i.sleep && 'Sleep', !i.running && 'Cardio', !i.food && 'Food'].filter(Boolean);
    return `<div class="card pad setup-card">
      <div class="setup-card-head"><span class="tag tag-good">Ready</span><b>Here is what Home will show</b></div>
      <div class="mini-chips">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>
      <div class="muted-text">${off.length ? `${off.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${off.length === 1 ? 'stays' : 'stay'} hidden. ` : ''}Change any of this in Settings, Home screen.</div>
    </div>`;
  }

  function renderSetupStepHabits() {
    const a = setupAnswers;
    const all = CATALOG.habits;
    const shown = a.habitsAll ? all : all.filter((h) => h.suggested);
    const form = a.habitForm;
    document.getElementById('setupContent').innerHTML = `
      <div class="card pick-wrap">
        ${a.customHabits.map((c) => `
        <div class="pick-row is-static">
          ${itemIconHtml('standing')}
          <span class="grow"><span class="pick-name"><span class="t">${escapeHtml(c.name)}</span><span class="tag">${REPEAT_LABELS[c.repeat] || 'Daily'}</span></span><span class="d">Your own habit</span></span>
          <button type="button" class="btn btn-ghost btn-sm" data-habit-remove="${c.id}" aria-label="Remove ${escapeHtml(c.name)}">Remove</button>
        </div>`).join('')}
        ${shown.map((h) => pickRowHtml(`data-habit="${h.id}"`, ITEM_ICONS[h.icon] ? h.icon : 'standing', h.name, escapeHtml(h.note), a.habits[h.id], REPEAT_LABELS[h.repeat] || 'Daily')).join('')}
        ${a.habitsAll ? '' : `<button type="button" class="pick-row pick-more" id="setupHabitsMore"><span>Browse all ${all.length} habits</span><span aria-hidden="true">›</span></button>`}
      </div>
      ${form ? `<div class="card pad setup-card" id="setupHabitForm">
        <div class="setup-card-head"><span class="lbl">Add your own habit</span></div>
        <label class="field"><span class="field-label">Name</span><input type="text" id="habitFormName" maxlength="60" placeholder="e.g. Take vitamin D" value="${escapeHtml(form.name)}" /></label>
        ${setupSegHtml('data-habit-repeat', 'How often', [['daily', 'Daily'], ['every-other', 'Every other day'], ['weekly', 'Weekly']], form.repeat)}
        ${form.error ? `<p class="setup-error" role="alert">${escapeHtml(form.error)}</p>` : ''}
        <div class="setup-actions-row"><button type="button" class="btn btn-primary" id="habitFormAdd">Add habit</button><button type="button" class="btn btn-ghost" id="habitFormCancel">Cancel</button></div>
      </div>` : `<button type="button" class="btn btn-secondary btn-block" id="setupHabitAdd">${uiIcon('plus')} Add your own habit</button>`}
      <div id="setupHomePreview">${setupHomePreviewHtml()}</div>`;
    document.querySelectorAll('#setupContent [data-habit]').forEach((b) => b.addEventListener('click', () => {
      a.habits[b.dataset.habit] = !a.habits[b.dataset.habit];
      b.setAttribute('aria-pressed', String(!!a.habits[b.dataset.habit]));
      b.querySelector('.pick-cb').innerHTML = a.habits[b.dataset.habit] ? CHECK_ICON_SVG : '';
      document.getElementById('setupHomePreview').innerHTML = setupHomePreviewHtml();
    }));
    const more = document.getElementById('setupHabitsMore');
    if (more) more.addEventListener('click', () => { captureSetupStep(); a.habitsAll = true; renderSetupStepHabits(); });
    document.querySelectorAll('#setupContent [data-habit-remove]').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.customHabits = a.customHabits.filter((c) => c.id !== b.dataset.habitRemove); renderSetupStepHabits();
    }));
    const add = document.getElementById('setupHabitAdd');
    if (add) add.addEventListener('click', () => { a.habitForm = { name: '', repeat: 'daily', error: '' }; renderSetupStepHabits(); document.getElementById('habitFormName').focus(); });
    document.querySelectorAll('#setupContent [data-habit-repeat] button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.habitForm.repeat = b.dataset.choice; renderSetupStepHabits();
    }));
    const cancel = document.getElementById('habitFormCancel');
    if (cancel) cancel.addEventListener('click', () => { a.habitForm = null; renderSetupStepHabits(); });
    const addBtn = document.getElementById('habitFormAdd');
    if (addBtn) addBtn.addEventListener('click', () => {
      captureSetupStep();
      const name = a.habitForm.name.trim();
      if (!name) { a.habitForm.error = 'Give the habit a name.'; renderSetupStepHabits(); return; }
      a.customHabits.push({ id: genId('habit'), name, repeat: a.habitForm.repeat });
      a.habitForm = null; renderSetupStepHabits();
    });
  }

  /* Goal pickers: Lifting, Cardio
     Typical goals offered at setup. Names, icons and kinds come from the catalog movement (`mv`).
     Weights are pounds, rep goals are a count for the day, and the plank is seconds held. */
  const SETUP_LIFTS = [
    { id: 'bench', mv: 'cat_mv_bench_press', lift: 'bench', typical: 225, note: 'two plates a side' },
    { id: 'squat', mv: 'cat_mv_squat', lift: 'squat', typical: 315, note: 'three plates a side' },
    { id: 'deadlift', mv: 'cat_mv_deadlift', lift: 'deadlift', typical: 405, note: 'four plates a side' },
    { id: 'ohp', mv: 'cat_mv_ohp', lift: 'shoulder-press', typical: 135, note: 'one plate a side' },
    { id: 'pushups', mv: 'cat_mv_pushups', typical: 50, note: 'in a day' },
    { id: 'pullups', mv: 'cat_mv_pullups', typical: 15, note: 'in a day' },
    { id: 'bwsquats', mv: 'cat_mv_bw_squats', typical: 50, note: 'in a day' },
    { id: 'dips', mv: 'cat_mv_dips', typical: 20, note: 'in a day' },
    { id: 'plank', mv: 'cat_mv_plank', typical: 120, note: 'held at once' },
  ];
  // Distance in miles, pace in seconds per mile.
  const SETUP_CARDIO = [
    { id: 'running', mv: 'cat_mv_running', dist: 5, pace: 600 },
    { id: 'walking', mv: 'cat_mv_walking', dist: 3, pace: 900 },
    { id: 'cycling', mv: 'cat_mv_cycling', dist: 15, pace: 240 },
    { id: 'hiking', mv: 'cat_mv_hiking', dist: 5, pace: 1200 },
    { id: 'rowing', mv: 'cat_mv_rowing', dist: 3, pace: 480 },
    { id: 'swimming', mv: 'cat_mv_swimming', dist: 1, pace: 2400 },
  ];
  const setupMv = (def) => MOVEMENTS[def.mv];
  const isWeightGoal = (def) => setupMv(def).kind === 'weight';
  const isTimedGoal = (def) => setupMv(def).unit === 'time';
  const setupLiftDefaultText = (def) => (isWeightGoal(def) ? String(round(Units.lbToDisplay(def.typical), 0)) : String(def.typical));
  const setupLiftUnit = (def) => (isWeightGoal(def) ? Units.weightUnitLabel() : isTimedGoal(def) ? 'sec' : 'reps');
  const setupLiftLabel = (def) => (isWeightGoal(def) ? 'Goal weight' : isTimedGoal(def) ? 'Hold goal' : 'Reps in a day');
  const setupLiftTypicalText = (def) => (isWeightGoal(def) ? fmtWeight(def.typical) : isTimedGoal(def) ? fmtHold(def.typical) : `${def.typical} reps`);
  const cardioDefaults = (def) => {
    const s = Math.round(Units.secPerMiToDisplaySecPerUnit(def.pace));
    return { dist: String(round(Units.miToDisplay(def.dist), 1)), min: String(Math.floor(s / 60)), sec: String(s % 60) };
  };
  const newLiftGoal = () => ({ on: true, mode: 'fixed', tier: 'intermediate', text: null });
  const newCardioGoal = () => ({ on: true, type: 'distance', dist: null, min: null, sec: null });

  // A goal's number in storage units: the typical value when the box was never edited (so kg
  // and lb users get exactly 225 lb, not 224.9), otherwise what was typed.
  function setupLiftValue(def, g) {
    if (g.text == null || g.text === setupLiftDefaultText(def)) return def.typical;
    const n = parseFloat(g.text);
    if (!(n > 0)) return def.typical;
    return isWeightGoal(def) ? Units.displayToLb(n) : Math.round(n);
  }
  function setupCustomValue(c) {
    const n = parseFloat(c.text);
    if (!(n > 0)) return null;
    return c.kind === 'weight' ? Units.displayToLb(n) : Math.round(n);
  }
  function setupCardioValues(def, g) {
    const d = cardioDefaults(def);
    const n = parseFloat(g.dist);
    const dist = g.dist == null || g.dist === d.dist || !(n > 0) ? def.dist : Units.displayToMi(n);
    const untouched = (g.min == null || g.min === d.min) && (g.sec == null || g.sec === d.sec);
    const paceSec = (parseInt(g.min == null ? d.min : g.min, 10) || 0) * 60 + (parseInt(g.sec == null ? d.sec : g.sec, 10) || 0);
    const pace = untouched ? def.pace : (paceSec > 0 ? Units.displaySecPerUnitToSecPerMi(paceSec) : def.pace);
    return { distanceGoal: g.type !== 'pace' ? dist : null, paceGoal: g.type !== 'distance' ? pace : null };
  }
  // Picks the number of ticked goals, for the summary on the last step.
  const setupLiftGoalCount = () => SETUP_LIFTS.filter((d) => (setupAnswers.liftGoals[d.id] || {}).on).length + setupAnswers.customGoals.length;
  const setupCardioGoalCount = () => SETUP_CARDIO.filter((d) => (setupAnswers.cardioGoals[d.id] || {}).on).length;

  // One tappable row of a pick list: icon, name, detail and a tick box. The caller supplies the
  // data attribute that identifies it.
  function pickRowHtml(attr, iconKey, name, desc, on, tag) {
    return `<button type="button" class="pick-row" ${attr} aria-pressed="${!!on}">
      ${itemIconHtml(iconKey)}
      <span class="grow"><span class="pick-name"><span class="t">${escapeHtml(name)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</span><span class="d">${desc}</span></span>
      <span class="pick-cb" aria-hidden="true">${on ? CHECK_ICON_SVG : ''}</span>
    </button>`;
  }
  const goalInputHtml = (attr, label, unit, value, aria) => `<label class="field"><span class="field-label">${label}</span>
    <div class="input-unit"><input type="number" step="any" min="0" inputmode="decimal" ${attr} value="${escapeHtml(value)}" aria-label="${escapeHtml(aria)}" /><span class="u">${unit}</span></div></label>`;
  const setupSegHtml = (attr, label, options, current) => `<div class="segmented segmented-fill" ${attr} role="radiogroup" aria-label="${label}">
    ${options.map(([v, l]) => `<button type="button" data-choice="${v}" role="radio" aria-checked="${current === v}">${l}</button>`).join('')}</div>`;

  // Shown only when the Interests step turned Lifting on.
  function renderSetupStepLifting() {
    const a = setupAnswers;
    const canUseStandards = parseFloat(a.weight) > 0 && a.sex !== '';
    const bwLb = canUseStandards ? Units.displayToLb(parseFloat(a.weight)) : null;
    const panelFor = (def, g) => {
      let html = '';
      if (def.lift) {
        html += setupSegHtml(`data-lift-mode="${def.id}"`, `${setupMv(def).name} goal style`, [['fixed', 'Fixed weight'], ['standard', 'By body weight']], g.mode);
      }
      if (def.lift && g.mode === 'standard') {
        if (!canUseStandards) {
          html += `<div class="note-box">${uiIconInfo()}<span>Needs your weight and sex from the About you step. Until then this uses the fixed weight.</span></div>`;
        } else {
          const rows = standardGoalPreviewRows(def.lift, bwLb, a.sex);
          html += setupSegHtml(`data-lift-tier="${def.id}"`, `${setupMv(def).name} tier`, ['intermediate', 'advanced', 'elite'].map((t) => [t, t[0].toUpperCase() + t.slice(1)]), g.tier);
          html += `<div class="standards-preview">${rows.map((r) => `<div class="standards-preview-row${r.tierKey === g.tier ? ' is-selected' : ''}"><span>${r.label}</span><span>${fmtWeight(r.goalLb)}</span></div>`).join('')}</div>`;
          return html;
        }
      }
      return html + goalInputHtml(`data-goal-input="${def.id}"`, setupLiftLabel(def), setupLiftUnit(def), g.text == null ? setupLiftDefaultText(def) : g.text, `${setupMv(def).name} ${setupLiftLabel(def).toLowerCase()}`);
    };
    const rowFor = (def) => {
      const g = a.liftGoals[def.id];
      const on = !!(g && g.on);
      const std = on && def.lift && g.mode === 'standard' && canUseStandards;
      const desc = on ? `Goal ${escapeHtml(setupLiftTypicalText(Object.assign({}, def, { typical: std ? computeStandardGoal(def.lift, g.tier, bwLb, a.sex) : setupLiftValue(def, g) })))}` : `Typical ${escapeHtml(setupLiftTypicalText(def))}, ${def.note}`;
      return pickRowHtml(`data-lift-pick="${def.id}"`, setupMv(def).icon, setupMv(def).name, desc, on) + (on ? `<div class="pick-panel">${panelFor(def, g)}</div>` : '');
    };
    const customRows = a.customGoals.map((c) => `
      ${pickRowHtml(`data-custom-pick="${c.id}"`, c.kind === 'weight' ? 'dumbbell' : 'activity', c.name, c.kind === 'weight' ? 'Your own · weight goal' : 'Your own · reps in a day', true, 'Yours')}
      <div class="pick-panel">
        ${goalInputHtml(`data-custom-input="${c.id}"`, c.kind === 'weight' ? 'Goal weight' : 'Reps in a day', c.kind === 'weight' ? Units.weightUnitLabel() : 'reps', c.text, `${c.name} goal`)}
        <button type="button" class="btn btn-ghost btn-sm" data-custom-remove="${c.id}">Remove</button>
      </div>`).join('');
    const form = a.goalForm;
    document.getElementById('setupContent').innerHTML = `
      <span class="lbl">Barbell lifts</span>
      <div class="card pick-wrap">${SETUP_LIFTS.filter(isWeightGoal).map(rowFor).join('')}</div>
      <span class="lbl">Bodyweight, per day</span>
      <div class="card pick-wrap">${SETUP_LIFTS.filter((d) => !isWeightGoal(d)).map(rowFor).join('')}</div>
      ${a.customGoals.length ? `<span class="lbl">Your own</span><div class="card pick-wrap">${customRows}</div>` : ''}
      ${form ? `<div class="card pad setup-card" id="setupGoalForm">
        <div class="setup-card-head"><span class="lbl">Add your own goal</span></div>
        <label class="field"><span class="field-label">Name</span><input type="text" id="goalFormName" maxlength="60" placeholder="e.g. Barbell Row" value="${escapeHtml(form.name)}" /></label>
        ${setupSegHtml('data-goal-kind', 'Goal type', [['weight', 'Weight'], ['reps', 'Reps in a day']], form.kind)}
        ${goalInputHtml('id="goalFormValue"', form.kind === 'weight' ? 'Goal weight' : 'Reps in a day', form.kind === 'weight' ? Units.weightUnitLabel() : 'reps', form.value, 'Goal')}
        ${form.error ? `<p class="setup-error" role="alert">${escapeHtml(form.error)}</p>` : ''}
        <div class="setup-actions-row"><button type="button" class="btn btn-primary" id="goalFormAdd">Add goal</button><button type="button" class="btn btn-ghost" id="goalFormCancel">Cancel</button></div>
      </div>` : `<button type="button" class="btn btn-secondary btn-block" id="setupGoalAdd">${uiIcon('plus')} Add your own goal</button>`}
      <div class="note-box">${uiIconInfo()}<span>${a.liftGoals && setupLiftGoalCount() ? `${setupLiftGoalCount()} goal${setupLiftGoalCount() === 1 ? '' : 's'} will show on Home.` : 'Nothing is ticked, so no goals are set. Your exercises are still all in the Log.'}</span></div>`;

    document.querySelectorAll('#setupContent [data-lift-pick]').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep();
      const id = b.dataset.liftPick;
      if (a.liftGoals[id] && a.liftGoals[id].on) a.liftGoals[id].on = false; else a.liftGoals[id] = Object.assign(newLiftGoal(), a.liftGoals[id] || {}, { on: true });
      renderSetupStepLifting();
    }));
    document.querySelectorAll('#setupContent [data-lift-mode] button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.liftGoals[b.parentElement.dataset.liftMode].mode = b.dataset.choice; renderSetupStepLifting();
    }));
    document.querySelectorAll('#setupContent [data-lift-tier] button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.liftGoals[b.parentElement.dataset.liftTier].tier = b.dataset.choice; renderSetupStepLifting();
    }));
    document.querySelectorAll('#setupContent [data-custom-remove]').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.customGoals = a.customGoals.filter((c) => c.id !== b.dataset.customRemove); renderSetupStepLifting();
    }));
    const add = document.getElementById('setupGoalAdd');
    if (add) add.addEventListener('click', () => { captureSetupStep(); a.goalForm = { name: '', kind: 'weight', value: '', error: '' }; renderSetupStepLifting(); document.getElementById('goalFormName').focus(); });
    document.querySelectorAll('#setupContent [data-goal-kind] button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.goalForm.kind = b.dataset.choice; renderSetupStepLifting();
    }));
    const cancel = document.getElementById('goalFormCancel');
    if (cancel) cancel.addEventListener('click', () => { a.goalForm = null; renderSetupStepLifting(); });
    const addBtn = document.getElementById('goalFormAdd');
    if (addBtn) addBtn.addEventListener('click', () => {
      captureSetupStep();
      const f = a.goalForm; const name = f.name.trim(); const n = parseFloat(f.value);
      if (!name) { f.error = 'Give the goal a name.'; renderSetupStepLifting(); return; }
      if (!(n > 0)) { f.error = 'Enter a goal above zero.'; renderSetupStepLifting(); return; }
      a.customGoals.push({ id: genId('goal'), name, kind: f.kind, text: String(f.value) });
      a.goalForm = null; renderSetupStepLifting();
    });
  }

  // Shown only when the Interests step turned Cardio on.
  function renderSetupStepCardio() {
    const a = setupAnswers;
    const rowFor = (def) => {
      const g = a.cardioGoals[def.id];
      const on = !!(g && g.on);
      const mv = setupMv(def);
      const typical = `${fmtDistance(def.dist)} · ${fmtPace(def.pace)}`;
      let panel = '';
      if (on) {
        const d = cardioDefaults(def);
        panel = `<div class="pick-panel">
          ${setupSegHtml(`data-cardio-type="${def.id}"`, `${mv.name} goal type`, [['distance', 'Distance'], ['pace', 'Pace'], ['both', 'Both']], g.type)}
          ${g.type !== 'pace' ? goalInputHtml(`data-cardio-dist="${def.id}"`, 'Distance goal', Units.distanceUnitLabel(), g.dist == null ? d.dist : g.dist, `${mv.name} distance goal`) : ''}
          ${g.type !== 'distance' ? `<div class="field"><span class="field-label">Pace goal (min:sec per ${Units.distanceUnitLabel()})</span>
            <div class="input-pair">
              <div class="input-unit"><input type="number" step="1" min="0" inputmode="numeric" data-cardio-min="${def.id}" value="${escapeHtml(g.min == null ? d.min : g.min)}" aria-label="${mv.name} pace minutes" /><span class="u">min</span></div>
              <div class="input-unit"><input type="number" step="1" min="0" max="59" inputmode="numeric" data-cardio-sec="${def.id}" value="${escapeHtml(g.sec == null ? d.sec : g.sec)}" aria-label="${mv.name} pace seconds" /><span class="u">sec</span></div>
            </div></div>` : ''}
        </div>`;
      }
      const v = on ? setupCardioValues(def, g) : null;
      const goalText = v ? [v.distanceGoal != null && fmtDistance(v.distanceGoal), v.paceGoal != null && fmtPace(v.paceGoal)].filter(Boolean).join(' · ') : '';
      return pickRowHtml(`data-cardio-pick="${def.id}"`, mv.icon, mv.name, on ? `Goal ${escapeHtml(goalText)}` : `Typical ${typical}`, on) + panel;
    };
    const others = CATALOG.movements.filter((m) => m.kind === 'cardio' && !SETUP_CARDIO.some((d) => d.mv === m.id)).map((m) => m.name);
    document.getElementById('setupContent').innerHTML = `
      <div class="card pick-wrap">${SETUP_CARDIO.map(rowFor).join('')}</div>
      <div class="note-box">${uiIconInfo()}<span>${others.length ? `${others.join(', ').replace(/, ([^,]*)$/, ' and $1')} are in your library too, ready to log without a goal. ` : ''}${setupCardioGoalCount() ? `${setupCardioGoalCount()} goal${setupCardioGoalCount() === 1 ? '' : 's'} will show on Home.` : 'Nothing is ticked, so no cardio goals are set.'}</span></div>`;
    document.querySelectorAll('#setupContent [data-cardio-pick]').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep();
      const id = b.dataset.cardioPick;
      if (a.cardioGoals[id] && a.cardioGoals[id].on) a.cardioGoals[id].on = false; else a.cardioGoals[id] = Object.assign(newCardioGoal(), a.cardioGoals[id] || {}, { on: true });
      renderSetupStepCardio();
    }));
    document.querySelectorAll('#setupContent [data-cardio-type] button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.cardioGoals[b.parentElement.dataset.cardioType].type = b.dataset.choice; renderSetupStepCardio();
    }));
  }

  // Shown when Water is on. Mirrors Food: a guide from height and weight, or a number of your own.
  function setupWaterGuide() {
    const w = parseFloat(setupAnswers.weight); const h = heightCmFromSetup();
    if (!(w > 0) || !h) return null;
    return S.waterTarget(Units.displayToLb(w), h, setupAnswers.waterActivity);
  }
  // Water in the chosen volume unit, with litres alongside for US units.
  function fmtWaterParts(ml) {
    return { main: `${round(Units.mlToDisplay(ml), 0).toLocaleString()} ${Units.volumeUnitLabel()}`, alt: state.settings.volumeUnit === 'mL' ? '' : `${round(ml / 1000, 1)} L` };
  }
  function fmtWaterAmount(ml) { const p = fmtWaterParts(ml); return p.alt ? `${p.main} · ${p.alt}` : p.main; }
  function setupWaterMl() {
    const a = setupAnswers; const guide = a.waterMode === 'calc' ? setupWaterGuide() : null;
    const base = guide ? guide.ml : S.DEFAULT_WATER_GOAL_ML;
    const dflt = String(round(Units.mlToDisplay(base), 0));
    if (a.waterText == null || a.waterText === dflt) return base;
    const n = parseFloat(a.waterText);
    return n > 0 ? Units.displayToMl(n) : base;
  }
  function renderSetupStepWater() {
    const a = setupAnswers; const guide = a.waterMode === 'calc' ? setupWaterGuide() : null;
    const base = guide ? guide.ml : S.DEFAULT_WATER_GOAL_ML;
    const text = a.waterText == null ? String(round(Units.mlToDisplay(base), 0)) : a.waterText;
    const levels = Object.entries(S.WATER_ACTIVITY);
    document.getElementById('setupContent').innerHTML = `
      <div class="card pad setup-card">
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('droplets', true)}<span class="lbl">How to set your goal</span></span></div>
        <div class="segmented segmented-fill" id="setupWaterModeSeg" role="radiogroup" aria-label="Water goal">
          <button type="button" role="radio" data-mode="calc" aria-checked="${a.waterMode === 'calc'}">Calculator</button>
          <button type="button" role="radio" data-mode="manual" aria-checked="${a.waterMode === 'manual'}">Manual</button>
        </div>
        ${a.waterMode === 'calc' ? `
          <span class="lbl">Activity</span>
          <div class="segmented segmented-fill" id="setupWaterActivitySeg" role="radiogroup" aria-label="Activity level">
            ${levels.map(([k, l]) => `<button type="button" role="radio" data-level="${k}" aria-checked="${a.waterActivity === k}">${l.label}</button>`).join('')}
          </div>
          <div class="muted-text">${escapeHtml(S.WATER_ACTIVITY[a.waterActivity].hint)}</div>
          ${guide ? `<div class="setup-big"><b>${escapeHtml(fmtWaterParts(guide.ml).main)}</b><span class="muted-text">${fmtWaterParts(guide.ml).alt ? `(${fmtWaterParts(guide.ml).alt}) ` : ''}a day</span></div>
            <div class="why">${uiIconInfo()}<span>Worked out from your body surface area (${guide.bsa} m²) plus ${S.WATER_ACTIVITY[a.waterActivity].addMl ? `${S.WATER_ACTIVITY[a.waterActivity].addMl} mL for activity` : 'nothing extra for activity'}. A starting point: heat, thirst and what you eat all matter.</span></div>`
            : `<div class="note-box">${uiIconInfo()}<span>Needs your height and weight from the About you step. Until then it starts at ${escapeHtml(fmtWaterAmount(S.DEFAULT_WATER_GOAL_ML))}.</span></div>`}` : `
          <div class="why">${uiIconInfo()}<span>Starts at ${escapeHtml(fmtWaterAmount(S.DEFAULT_WATER_GOAL_ML))}, a common rule of thumb. Type any number you like.</span></div>`}
        ${goalInputHtml('id="setupWaterGoal"', a.waterMode === 'calc' && guide ? 'Your goal (adjust if you like)' : 'Daily goal', Units.volumeUnitLabel(), text, 'Daily water goal')}
      </div>`;
    document.querySelectorAll('#setupWaterModeSeg button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.waterMode = b.dataset.mode; a.waterText = null; renderSetupStepWater();
    }));
    document.querySelectorAll('#setupWaterActivitySeg button').forEach((b) => b.addEventListener('click', () => {
      captureSetupStep(); a.waterActivity = b.dataset.level; a.waterText = null; renderSetupStepWater();
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
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('apple', true)}<span class="lbl">Save common foods</span></span>${switchHtml('id="setupCommonFoods"', 'Save common foods', a.commonFoods)}</div>
        <span class="muted-text">${starters.length} everyday foods ready to tap. One tap logs a typical serving.</span>
        <div class="mini-chips">${starters.slice(0, 8).map((f) => `<span>${escapeHtml(f.name.split(',')[0])}</span>`).join('')}<span>+${starters.length - 8} more</span></div>
        <div class="note-box">${uiIconInfo()}<span>Typical values for one serving, all editable. Brand and restaurant items are not included. Turn this off to start with an empty list.</span></div>
      </div>` : ''}
      <div class="card pad setup-card">
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('flame', true)}<span class="lbl">Daily calorie target</span></span></div>
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
        <div class="setup-card-head"><span class="setup-card-title">${itemIconHtml('utensils', true)}<span class="lbl">Nutrients to track</span></span></div>
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
      const weightEl = document.getElementById('setupWeight');
      if (weightEl) setupAnswers.weight = weightEl.value;
      const ageEl = document.getElementById('setupAge');
      if (ageEl) setupAnswers.age = ageEl.value;
      const goalEl = document.getElementById('setupWeightGoal');
      if (goalEl) setupAnswers.weightGoalValue = goalEl.value;
    } else if (key === 'lifting') {
      document.querySelectorAll('#setupContent [data-goal-input]').forEach((el) => {
        const g = setupAnswers.liftGoals[el.dataset.goalInput]; if (g) g.text = el.value;
      });
      document.querySelectorAll('#setupContent [data-custom-input]').forEach((el) => {
        const c = setupAnswers.customGoals.find((x) => x.id === el.dataset.customInput); if (c) c.text = el.value;
      });
      const f = setupAnswers.goalForm;
      if (f) {
        const nameEl = document.getElementById('goalFormName'); if (nameEl) f.name = nameEl.value;
        const valEl = document.getElementById('goalFormValue'); if (valEl) f.value = valEl.value;
      }
    } else if (key === 'cardio') {
      ['dist', 'min', 'sec'].forEach((k) => document.querySelectorAll(`#setupContent [data-cardio-${k}]`).forEach((el) => {
        const g = setupAnswers.cardioGoals[el.dataset[`cardio${k[0].toUpperCase()}${k.slice(1)}`]]; if (g) g[k] = el.value;
      }));
    } else if (key === 'water') {
      const waterEl = document.getElementById('setupWaterGoal');
      if (waterEl) setupAnswers.waterText = waterEl.value;
    } else if (key === 'habits') {
      const f = setupAnswers.habitForm;
      const nameEl = document.getElementById('habitFormName');
      if (f && nameEl) f.name = nameEl.value;
    } else if (key === 'food') {
      const calEl = document.getElementById('setupCalories');
      if (calEl) setupAnswers.calorieManual = calEl.value;
    }
  }

  // A goal or habit typed into an open "Add your own" form but never confirmed is added when the
  // person moves on, so Continue never throws it away.
  function commitOpenSetupForms() {
    const a = setupAnswers;
    if (a.goalForm && a.goalForm.name.trim() && parseFloat(a.goalForm.value) > 0) {
      a.customGoals.push({ id: genId('goal'), name: a.goalForm.name.trim(), kind: a.goalForm.kind, text: String(a.goalForm.value) });
    }
    if (a.habitForm && a.habitForm.name.trim()) a.customHabits.push({ id: genId('habit'), name: a.habitForm.name.trim(), repeat: a.habitForm.repeat });
    a.goalForm = null; a.habitForm = null;
  }

  // Same bounds as Settings > Profile, so a typo is pointed out instead of silently dropped.
  function setupAboutError() {
    const a = setupAnswers;
    const typedHeight = state.settings.lengthUnit === 'cm' ? parseFloat(a.heightCm) > 0 : (parseFloat(a.heightFt) || 0) + (parseFloat(a.heightIn) || 0) > 0;
    const badHeight = typedHeight && heightCmFromSetup() == null;
    const age = parseInt(a.age, 10);
    const badAge = !Number.isNaN(age) && (age < MIN_AGE || age > MAX_AGE);
    if (badHeight && badAge) return 'Height and age look out of range. Check them, or tap Skip.';
    if (badHeight) return 'Height looks out of range. Check it, or tap Skip.';
    if (badAge) return `Age must be between ${MIN_AGE} and ${MAX_AGE}, or tap Skip.`;
    return null;
  }

  function goSetupNext() {
    captureSetupStep();
    commitOpenSetupForms();
    const seq = setupStepSequence();
    if (seq[setupStepIndex] === 'about') {
      const err = setupAboutError();
      if (err) { toast(err); return; }
    }
    if (setupStepIndex === seq.length - 1) { finishSetup(); return; }
    setupStepIndex++;
    renderSetupStep();
  }
  // "Not now" on About clears its answers; "Skip habits" clears the ticks. Either way the
  // wizard moves on (or finishes, for habits).
  function skipSetupStep() {
    const key = setupStepSequence()[setupStepIndex];
    const a = setupAnswers;
    if (key === 'about') {
      a.weight = ''; a.age = ''; a.sex = ''; a.heightCm = ''; a.heightFt = ''; a.heightIn = '';
      a.skipWeight = false; a.skipBody = false;
    } else if (key === 'habits') {
      a.habits = {}; a.customHabits = []; a.habitForm = null;
    }
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
    const a = setupAnswers;
    // Values carried across a unit switch keep their exact stored number (see setSetupUnitSystem).
    const heightCm = `${a.heightCm}|${a.heightFt}|${a.heightIn}` === a.heightShown && a.heightCanon != null ? a.heightCanon : heightCmFromSetup();
    const rawWeight = parseFloat(a.weight);
    const weightLb = a.weight === a.weightShown && a.weightCanon != null ? a.weightCanon
      : (!Number.isNaN(rawWeight) && rawWeight > 0) ? Units.displayToLb(rawWeight) : null;
    const sex = a.sex || null;
    const i = setupAnswers.interests;

    // Goals ticked on the Lifting and Cardio steps become the "goal" and "daily" exercises. Every
    // other catalog movement for a ticked interest is added after state.exercises is set (below),
    // so the whole library is there from the start.
    const exercises = [];
    const linkedTo = (mv) => ({ catalogId: mv.id, group: mv.group, ...(mv.defaultEquipment && { equipment: mv.defaultEquipment }), ...(ITEM_ICONS[mv.icon] && { icon: mv.icon }) });
    if (i.lifting) {
      SETUP_LIFTS.forEach((def) => {
        const g = setupAnswers.liftGoals[def.id]; if (!g || !g.on) return;
        const mv = setupMv(def);
        if (isWeightGoal(def)) {
          const usingStandard = def.lift && g.mode === 'standard' && weightLb && sex;
          exercises.push({
            id: def.lift ? `ex_${def.lift}` : genId('ex'), name: mv.name, kind: 'weight', bodyRegion: guessBodyRegion(mv.name), section: 'goal',
            goal: usingStandard ? computeStandardGoal(def.lift, g.tier, weightLb, sex) : setupLiftValue(def, g),
            liftType: def.lift || null, goalMode: usingStandard ? 'standard' : 'fixed', goalTier: usingStandard ? g.tier : null,
            archived: false, createdAt: now, ...linkedTo(mv),
          });
        } else {
          exercises.push({
            id: genId('ex'), name: mv.name, kind: 'reps', section: 'daily', goal: setupLiftValue(def, g), goalMode: 'fixed', goalTier: null,
            archived: false, createdAt: now, ...(mv.unit && { unit: mv.unit }), ...linkedTo(mv),
          });
        }
      });
      setupAnswers.customGoals.forEach((c) => {
        const goal = setupCustomValue(c); if (goal == null) return;
        exercises.push(c.kind === 'weight'
          ? { id: genId('ex'), name: c.name, kind: 'weight', bodyRegion: guessBodyRegion(c.name), section: 'goal', goal, liftType: null, goalMode: 'fixed', goalTier: null, archived: false, createdAt: now }
          : { id: genId('ex'), name: c.name, kind: 'reps', section: 'daily', goal, goalMode: 'fixed', goalTier: null, archived: false, createdAt: now });
      });
    }
    if (i.running) {
      SETUP_CARDIO.forEach((def) => {
        const g = setupAnswers.cardioGoals[def.id]; if (!g || !g.on) return;
        const mv = setupMv(def);
        const v = setupCardioValues(def, g);
        exercises.push({ id: genId('ex'), name: mv.name, kind: 'cardio', section: 'goal', distanceGoal: v.distanceGoal, paceGoal: v.paceGoal, goal: null, goalMode: 'fixed', goalTier: null, archived: false, createdAt: now, ...linkedTo(mv) });
      });
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
      if (i.bodyweight && parseFloat(setupAnswers.weightGoalValue) > 0) {
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
    if (i.water) water.goalMl = Math.round(setupWaterMl());

    const rawAge = parseInt(setupAnswers.age, 10);
    state.profile.age = (!Number.isNaN(rawAge) && rawAge >= MIN_AGE && rawAge <= MAX_AGE) ? rawAge : null;
    state.profile.heightCm = heightCm;
    state.profile.sex = sex;
    state.exercises = exercises;
    state.entries = [];
    // Habits ticked on the last step: ordinary exercises of kind 'habit', same as Add from catalog.
    if (i.habits) {
      CATALOG.habits.filter((h) => setupAnswers.habits[h.id]).forEach(addCatalogHabit);
      setupAnswers.customHabits.forEach((c) => state.exercises.push({
        id: genId('ex'), name: c.name, kind: 'habit', section: 'daily', group: 'other', goal: 1, repeat: c.repeat,
        goalMode: 'fixed', goalTier: null, archived: false, createdAt: now,
      }));
    }
    // The exercise library: every movement for a ticked interest, on its usual equipment. Goals
    // chosen above are already in the list and are linked, not duplicated.
    if (i.lifting) CATALOG.movements.filter((m) => m.kind !== 'cardio').forEach((m) => addCatalogMovement(m, m.defaultEquipment ? [m.defaultEquipment] : []));
    if (i.running) CATALOG.movements.filter((m) => m.kind === 'cardio').forEach((m) => addCatalogMovement(m, []));
    state.settings.catalogPacksSeen = CATALOG.packs.filter((pk) => (pk.id === 'running' ? i.running : i.lifting)).map((pk) => pk.id);
    state.trackers = trackers;
    state.measurements = measurements;
    state.water = water;
    state.waterEntries = [];
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
  // What the height fields showed when filled, so saving without touching them keeps the
  // exact stored height instead of the rounded display value.
  let profileHeightShown = null;
  const profileHeightKey = () => (state.settings.lengthUnit === 'cm'
    ? document.getElementById('profileHeightCm').value
    : `${document.getElementById('profileHeightFt').value}|${document.getElementById('profileHeightIn').value}`);
  function syncProfileHeightInputs() {
    if (state.settings.lengthUnit === 'cm') {
      document.getElementById('profileHeightCm').value = state.profile.heightCm ? round(state.profile.heightCm, 1) : '';
    } else {
      const { ft, inch } = state.profile.heightCm ? cmToFtIn(state.profile.heightCm) : { ft: '', inch: '' };
      document.getElementById('profileHeightFt').value = ft;
      document.getElementById('profileHeightIn').value = inch;
    }
    profileHeightShown = profileHeightKey();
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
    document.getElementById('setupSkipBtn').addEventListener('click', skipSetupStep);

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
      logWorkoutBorrowed = isDailyEx(exerciseById(ev.target.value));
      renderDynamicFields(document.getElementById('logDynamicFields'), exerciseById(ev.target.value));
      syncLogWorkoutUI();
      renderRecentEntries();
    });
    wireLogExercisePicker();
    document.getElementById('streakCard').addEventListener('click', () => switchTab('history'));
    document.getElementById('recentHistoryBtn').addEventListener('click', () => switchTab('history'));
    wireManageExercises();
    wireManageDaily();
    wireFoodLog();
    wireManageFood();
    document.getElementById('logForm').addEventListener('submit', handleLogSubmit);

    // Reuses renderLogMeasurementForm() for the label and the quality field.
    document.getElementById('logTracker').addEventListener('change', () => { renderLogMeasurementForm(); renderRecentEntries(); });
    document.getElementById('logMeasurementForm').addEventListener('submit', handleLogMeasurementSubmit);
    wireLogMeasurementForm();
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
      const blank = document.getElementById('waterGoalInput').value.trim() === '';
      if (!blank && !(raw > 0)) { toast('Enter a goal above zero, or clear the field to remove it.'); return; }
      const goalMl = blank ? null : fieldCanon(document.getElementById('waterGoalInput'), Units.displayToMl);
      if (goalMl != null && tooBigWater(goalMl)) { toast(WATER_TOO_BIG); return; }
      state.water.goalMl = goalMl;
      if (!save()) return;
      toast(blank ? 'Water goal removed' : 'Water goal saved');
      renderManage();
      renderDashboard();
    });

    // Turning a domain off hides it from Log/History/Goals without touching logged data.
    Object.entries(settingSwitches).forEach(([id, key]) => {
      document.getElementById(id).addEventListener('click', () => {
        state.settings[key] = !state.settings[key];
        const added = state.settings[key] ? autoImportFor(key) : '';
        if (!save()) return;
        renderAll();
        if (added) toast(added);
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

    const profilePanels = { height: 'profilePanelHeight', age: 'profilePanelAge', sex: 'profilePanelSex' };
    const closeProfilePanels = () => {
      Object.values(profilePanels).forEach((id) => { document.getElementById(id).hidden = true; });
      document.querySelectorAll('[data-profile-row]').forEach((r) => r.setAttribute('aria-expanded', 'false'));
      document.getElementById('profileSaveRow').hidden = true;
    };
    document.getElementById('profileList').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-profile-row]'); if (!row) return;
      const key = row.dataset.profileRow;
      const panel = document.getElementById(profilePanels[key]);
      const opening = panel.hidden;
      closeProfilePanels();
      if (opening) {
        panel.hidden = false;
        row.setAttribute('aria-expanded', 'true');
        document.getElementById('profileSaveRow').hidden = key === 'sex';
      }
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
        toast(`${what} looks out of range. Check the value before saving.`);
        return;
      }
      if (profileHeightKey() !== profileHeightShown) state.profile.heightCm = heightCm;
      state.profile.age = age;
      if (!save()) return;
      profileHeightShown = profileHeightKey();
      toast('Profile saved');
      closeProfilePanels();
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
    document.getElementById('eraseAllBtn').addEventListener('click', eraseAllData);
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

  /* Data recovery screen
     Shown instead of the app when load() could not read an existing saved payload. It offers an
     explicit choice instead of discarding data that may be salvageable. */

  function showRecoveryScreen() {
    hideAppChrome();
    switchTab('recover');
    document.getElementById('recoverExportBtn').addEventListener('click', () => {
      downloadJson(`fit-log-recovery-${todayISO()}.json`, rawCorrupt || '');
      toast('Recovery file downloaded');
    });
    document.getElementById('recoverResetBtn').addEventListener('click', () => {
      confirmDialog(
        'Permanently delete this data?',
        'This clears the data Fit Log couldn’t read and starts fresh. Export a recovery file first if you haven’t already — this can’t be undone.',
        'Delete and start fresh',
        () => {
          try { localStorage.removeItem(STORAGE_KEY); } catch (e) { toast('Could not erase: your browser blocked access to storage.'); return; }
          location.reload();
        },
        true
      );
    });
  }

  function init() {
    // Tag the initial history entry and push a guard entry above it, so a Back press
    // on a fresh Dashboard has something to pop and the "press back again to exit"
    // warning can run (see "Back-button / swipe-back step navigation").
    history.replaceState({ nav: 'base' }, '');
    history.pushState({ nav: 'exit-guard' }, '');
    hydrateStaticIcons();
    // Catalog and tidy rows are divs with role=button/checkbox; give them the keys a button has.
    document.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('.cat-row[role]')) { ev.preventDefault(); ev.target.click(); }
      // A lone amount field outside a form: Enter presses the button next to it.
      if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.enterClicks) {
        const btn = document.getElementById(ev.target.dataset.enterClicks);
        if (btn) { ev.preventDefault(); btn.click(); }
      }
    });
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

  /* Staying current: other tabs and midnight
     1. Two tabs (or a tab and the installed app) share one localStorage key. Each keeps its
        own in-memory copy and rewrites the whole key on every save, so the later save would
        silently erase the other tab's changes. The `storage` event tells this tab when
        another one saved; it adopts that data instead of overwriting it.
     2. A tab left open past midnight keeps showing yesterday as "today". When the date
        changes, any date the user hasn't deliberately moved is advanced. */
  function wireLiveSync() {
    window.addEventListener('storage', (ev) => {
      if (ev.key !== STORAGE_KEY && ev.key !== null) return;
      // Another tab erased everything: reload so this one doesn't write its old data back.
      if (!ev.newValue) { location.reload(); return; }
      if (needsRecovery || needsSetup) return;
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
