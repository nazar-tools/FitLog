/* ============================================================================
   FIT LOG — app.js
   ============================================================================

     SCHEMA VERSION & MIGRATIONS  – the data shape, and the safe way to
                                     change it later without losing anyone's
                                     history. Read this before editing
                                     anything that touches saved data.
     Defaults                     – what a brand-new install starts with
                                     (the seeded exercises and their goals).
     Store                        – load()/save(): the only two functions
                                     that touch localStorage directly.
     Unit helpers                 – lb<->kg and mi<->km conversions, plus
                                     every number-formatting function
                                     (fmtWeight, fmtDistance, fmtPace, ...).
     Derived data                 – reading state.exercises/state.entries to
                                     answer questions like "what's the best
                                     set ever logged for this exercise?"
     Progressive-overload
       suggestion engine          – the "Next session" recommendation logic.
     Theme                        – light/dark/system, and applying it to
                                     the page.
     Toast                        – the small "Entry saved" popup.
     Modal                        – the generic bottom-sheet popup shell
                                     that every other modal builds on top of.
     Dynamic set fields           – the weight/reps/cardio input rows shared
                                     by the Log tab and the edit-entry modal.
     Rendering: Dashboard         – the Goals cards + Daily rows home screen.
     Rendering: Log tab           – the quick-add workout form.
     Rendering: History           – the full, filterable entry list.
     Entry modal                  – editing or deleting one logged entry.
     Exercise detail modal        – tapping a goal card: chart, PRs, the
                                     suggestion card, all of that exercise's
                                     entries.
     Add / edit exercise modal    – creating a new exercise or changing an
                                     existing one's name/section/goal/etc.
     Settings                     – units, theme, the exercise management
                                     list, export/import backup.
     Tabs / global wiring         – wires up every click handler once, and
                                     switchTab()/renderAll(), which redraw
                                     the current screen after any change.
     Init                         – what runs the moment the page loads.

   The overall flow, on every user action (saving an entry, flipping a
   settings toggle, and so on): an event handler updates the in-memory
   `state` object, calls save(), then calls whichever render*() function(s)
   redraw what's now stale. There is no framework mediating this — it is the
   same plain pattern repeated for every screen.

   See README.md in the project root for a walkthrough of the codebase and a
   cookbook of common changes: recoloring the app, changing default goals,
   and extending the data schema.
   ============================================================================ */
(() => {
  'use strict';

  // Internal storage key, fixed permanently as the app's original codename —
  // unaffected by user-facing renames such as Lift Log -> Fit Log. It is
  // never displayed anywhere; it is simply the address the saved data is
  // filed under. Changing it would point the app at an empty store and
  // orphan every previously logged entry, so this value does not change.
  const STORAGE_KEY = 'liftlog.v1';

  /* ==========================================================================
     SCHEMA VERSION & MIGRATIONS — the contract for changing the data shape.

     All application data — every exercise and every logged set — is one JSON
     object saved under STORAGE_KEY. SCHEMA_VERSION is a plain number that
     records what that object's shape currently is.

     When a future feature needs the data to carry something new (say, a
     bodyweight field, or a per-exercise note template), the safe recipe is:

       1. Bump SCHEMA_VERSION by exactly 1.
       2. Add a new function to MIGRATIONS, keyed by the OLD version number
          it upgrades from (key `2` means "how a v2 save file becomes v3").
       3. Inside that function, ONLY ADD new fields with safe defaults.
          Never delete, rename, or repurpose a field an older version
          wrote — that is exactly how someone's real workout history gets
          silently wiped on an update. If a field truly isn't needed
          anymore, just stop reading it elsewhere in the app; leave it
          sitting harmlessly in the saved data.

     load() (below) walks any saved file forward through every migration it
     hasn't been through yet, oldest first, until it reaches SCHEMA_VERSION.
     A brand-new install has no saved file at all, so it starts directly at
     the latest shape via defaultData() and skips this process entirely.
     This is also why exporting a backup (Settings -> Export) and importing
     it later always works even after the app has changed in between: the
     import path runs the exact same migrations.
     ========================================================================== */

  const SCHEMA_VERSION = 3;

  // Known "daily" exercise ids from before the Goal/Daily/Other split
  // existed (schema v1). Used only by the v1->v2 migration below.
  const LEGACY_DAILY_IDS = new Set(['ex_pushups', 'ex_bwsquats', 'ex_pullups']);
  const LOWER_BODY_KEYWORDS = ['squat', 'deadlift', 'leg press', 'lunge', 'calf', 'hip thrust', 'glute', 'rdl', 'romanian'];

  // Best-effort guess for a new lift's move pattern, used (a) as the
  // starting selection when adding a weight exercise, and (b) to backfill
  // `bodyRegion` for lifts saved before that field existed. It only sizes
  // the suggested weight jump in the progressive-overload card — getting
  // it wrong isn't destructive, so a simple keyword match is good enough.
  function guessBodyRegion(name) {
    const n = (name || '').toLowerCase();
    return LOWER_BODY_KEYWORDS.some((k) => n.includes(k)) ? 'lower' : 'upper';
  }

  const MIGRATIONS = {
    // v1 -> v2: introduced `section` ('goal' | 'daily' | 'accessory') on
    // every exercise, and `bodyRegion` ('upper' | 'lower') on weighted
    // lifts. Both are purely additive — nothing from v1 is touched.
    1: (data) => {
      data.exercises.forEach((ex) => {
        if (!ex.section) ex.section = LEGACY_DAILY_IDS.has(ex.id) ? 'daily' : 'goal';
        if (ex.kind === 'weight' && !ex.bodyRegion) ex.bodyRegion = guessBodyRegion(ex.name);
      });
      return data;
    },
    // v2 -> v3: cardio exercises moved from a single goal ('goalMetric' +
    // 'goal') to two independent, optional goals ('distanceGoal' and
    // 'paceGoal') so one logged run can count toward both at once. The old
    // fields are left in place, untouched, rather than deleted — nothing
    // reads them for cardio anymore, but per the rule above an older field
    // is never removed on upgrade.
    2: (data) => {
      data.exercises.forEach((ex) => {
        if (ex.kind !== 'cardio') return;
        if (ex.distanceGoal === undefined) ex.distanceGoal = (ex.goalMetric !== 'pace' && ex.goal) ? ex.goal : null;
        if (ex.paceGoal === undefined) ex.paceGoal = (ex.goalMetric === 'pace' && ex.goal) ? ex.goal : null;
      });
      return data;
    },
    // Next migration goes here, keyed `3: (data) => { ...; return data; }`.
  };

  /** Walks `data` forward through MIGRATIONS until it matches SCHEMA_VERSION. */
  function runMigrations(data) {
    let version = data.version || 1;
    while (version < SCHEMA_VERSION && MIGRATIONS[version]) {
      data = MIGRATIONS[version](data);
      version += 1;
    }
    data.version = version;
    return data;
  }

  /* ============================== Defaults ============================== */

  // The starting data for a brand-new install — already in the current
  // schema shape, so it never has to pass through the migrations above.
  function defaultData() {
    const now = new Date().toISOString();
    return {
      version: SCHEMA_VERSION,
      settings: { theme: 'system', weightUnit: 'lb', distanceUnit: 'mi' },
      exercises: [
        { id: 'ex_bench', name: 'Bench Press', kind: 'weight', bodyRegion: 'upper', section: 'goal', goal: 225, archived: false, createdAt: now },
        { id: 'ex_squat', name: 'Squat', kind: 'weight', bodyRegion: 'lower', section: 'goal', goal: 315, archived: false, createdAt: now },
        { id: 'ex_deadlift', name: 'Deadlift', kind: 'weight', bodyRegion: 'lower', section: 'goal', goal: 405, archived: false, createdAt: now },
        { id: 'ex_pushups', name: 'Push-ups', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
        { id: 'ex_bwsquats', name: 'Bodyweight Squats', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
        { id: 'ex_pullups', name: 'Pull-ups', kind: 'reps', section: 'daily', goal: 15, archived: false, createdAt: now },
        { id: 'ex_running', name: 'Running', kind: 'cardio', section: 'goal', distanceGoal: 5, paceGoal: null, goal: null, archived: false, createdAt: now },
      ],
      entries: [],
    };
  }

  /* ============================== Store ==============================
     load()/save() are the ONLY two functions that touch localStorage
     directly. Everything else in the app reads and writes the in-memory
     `state` object and calls save() when it's done — that keeps "how data
     gets to disk" in one place. */

  let state = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { state = defaultData(); save(); return; }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.exercises) || !Array.isArray(parsed.entries)) throw new Error('bad shape');
      parsed.settings = Object.assign({ theme: 'system', weightUnit: 'lb', distanceUnit: 'mi' }, parsed.settings || {});
      state = runMigrations(parsed);
      save(); // persist the migrated shape once, so this doesn't re-run every load
    } catch (e) {
      console.warn('Could not load saved data, starting fresh.', e);
      state = defaultData();
      save();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Most likely the browser's storage quota is full. This is rare for a
      // text-only app like this one, but fail loudly rather than silently
      // losing the entry the user thinks they just saved.
      console.error('Could not save to localStorage', e);
      toast('Could not save — your browser storage may be full. Try exporting a backup and freeing up space.');
    }
  }

  function genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ============================== Unit helpers ============================== */

  const LB_PER_KG = 0.45359237;
  const KM_PER_MI = 1.609344;

  // Data is saved in one fixed ("canonical") unit — pounds for weight, miles
  // for distance/pace — regardless of the current Settings toggle. `Units`
  // is the only place that converts canonical to whichever unit is currently
  // selected for *display*. This split means the lb/kg or mi/km toggle can
  // only ever change presentation, never the logged history itself, and
  // entries stay comparable even if the unit is switched partway through.
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
  function sectionOf(ex) { return ex.section || 'goal'; }
  const SECTION_LABELS = { goal: 'Goals', daily: 'Daily (WFH)', accessory: 'Other exercises' };

  // The single best/most-recent set of an entry, used both for trend values
  // and for the progressive-overload suggestion (which needs reps/RPE too,
  // not just the scalar entryValue()).
  function topSetOf(exercise, entry) {
    if (exercise.kind === 'weight') {
      const valid = (entry.sets || []).filter((s) => s.reps > 0 && s.weight != null);
      if (!valid.length) return null;
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

  // A cardio exercise carries two independent, optional goals — distance
  // and pace — computed from the same logged entries, so a single run
  // updates both at once instead of requiring separate entries per goal.
  // These three helpers are the one place that reads distanceGoal/paceGoal;
  // everything downstream (progress, formatting, suggestions, rendering)
  // goes through them rather than touching those fields directly.

  // Which goal metrics this cardio exercise currently tracks, in display
  // order. Empty for a cardio exercise with no goal set yet; length 1 for
  // the common case; length 2 once both a distance and a pace goal exist.
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
  // Falls back to whichever goal is actually set when no metric is given,
  // so single-goal cardio exercises (the common case) don't need callers to
  // know or care which metric that is.
  function defaultCardioMetric(exercise) {
    return exercise.distanceGoal != null ? 'distance' : (exercise.paceGoal != null ? 'pace' : 'distance');
  }

  // Boils one logged entry down to a single number for trend charts and PRs —
  // "heaviest weight lifted for a real rep" for a lift, "most reps in one
  // set" for bodyweight work, distance or pace (per `metric`) for cardio.
  // See topSetOf() just above for the version that keeps reps/RPE too, used
  // by the progressive-overload suggestions.
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

  // The all-time best entryValue() for this exercise/metric — what a
  // dashboard card's big number and meter are measured against. "Best"
  // means lowest for a pace goal (a faster time is better) and highest
  // otherwise. `metric` is ignored for non-cardio kinds.
  function best(exercise, metric) {
    const vals = entriesFor(exercise.id).map((e) => entryValue(exercise, e, metric)).filter((v) => v != null);
    if (!vals.length) return null;
    return isLowerBetter(exercise, metric) ? Math.min(...vals) : Math.max(...vals);
  }

  // How close `best(exercise, metric)` is to its goal, as a percentage (can
  // exceed 100 once the goal's been beaten) plus whether it's been reached
  // at all. `metric` selects which of a cardio exercise's two goals to
  // measure against; ignored for non-cardio kinds, which have one goal.
  function progressPct(exercise, metric) {
    const goal = exercise.kind === 'cardio' ? cardioGoalFor(exercise, metric || defaultCardioMetric(exercise)) : exercise.goal;
    const b = best(exercise, metric);
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
    if (exercise.kind === 'reps') return fmtReps(v);
    if (exercise.kind === 'cardio') return (metric || defaultCardioMetric(exercise)) === 'pace' ? fmtPace(v) : fmtDistance(v);
    return String(v);
  }

  function goalLabelForExercise(exercise, metric) {
    if (exercise.kind === 'weight') return `Goal ${fmtWeight(exercise.goal)}`;
    if (exercise.kind === 'reps') return `Goal ${fmtReps(exercise.goal)}`;
    if (exercise.kind === 'cardio') {
      const m = metric || defaultCardioMetric(exercise);
      const goal = cardioGoalFor(exercise, m);
      return m === 'pace' ? `Goal ${fmtPace(goal)}` : `Goal ${fmtDistance(goal)}`;
    }
    return '';
  }

  // A short " · Goal ..." suffix for the Settings exercise-management list —
  // one clause per configured goal for cardio (so both a distance and a
  // pace goal are listed), one clause for everything else, or a plain "no
  // goal set" when nothing is configured yet.
  function exerciseGoalSummary(exercise) {
    if (exercise.kind === 'cardio') {
      const metrics = cardioMetricsOf(exercise);
      if (!metrics.length) return ' · no goal set';
      return metrics.map((m) => ` · ${goalLabelForExercise(exercise, m)}`).join('');
    }
    return exercise.goal ? ` · ${goalLabelForExercise(exercise)}` : ' · no goal set';
  }

  /* ============================== Progressive-overload suggestion engine ==============================
     Two evidence-based heuristics, chosen by what data is available:
       1) RPE/RIR-based autoregulation (when the last top set has an RPE logged) —
          a well-supported approach in strength-training research for deciding
          session-to-session load. Bands follow common RPE/RIR coaching scales.
       2) The "2-for-2 rule" (NSCA) as a fallback when no RPE is logged:
          matching or beating the prior rep count at the same weight across
          two sessions in a row signals it's time to add load.
     Increment sizes follow NSCA general guidance: smaller jumps for upper-body /
     single-joint lifts, larger jumps for lower-body / multi-joint lifts.
     This is a general heuristic, not personalized coaching — it's surfaced with
     that caveat in the UI rather than as a confident prescription. */

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
    '2for2': 'Based on the “2-for-2” progressive-overload rule.',
    trend: 'Based on your last two sessions.',
  };

  // Returns an ARRAY of suggestions: always one element for a weight/reps
  // exercise, but one element PER configured goal metric for cardio — a
  // cardio exercise with both a distance and a pace goal gets two
  // suggestions, each tagged with `metric`, computed from the same pair of
  // logged entries (one run informs both).
  function suggestNextTarget(exercise) {
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
          return { headline: `Try ${fmtWeight(w)} next session`, detail: `You matched or beat your reps (${prevTop.reps} → ${lastTop.reps}) at this weight for two sessions in a row.`, method: '2for2' };
        }
        return { headline: `Repeat ${fmtWeight(lastTop.weight)} next session`, detail: `Reps dipped (${prevTop.reps} → ${lastTop.reps}) — consolidate before adding load.`, method: '2for2' };
      }
      return { headline: `Repeat ${fmtWeight(lastTop.weight)}, or log RPE for a sharper suggestion`, detail: 'Logging an RPE (how hard that top set felt, 1–10) unlocks a tailored recommendation.', method: null };
    }

    if (exercise.kind === 'reps') {
      if (!lastTop || lastTop.reps == null) return { headline: 'Log a set to get a suggestion.', method: null };
      const band = rpeBand(lastTop.rpe);
      const r = Math.round(lastTop.reps);
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

  // The cardio counterpart of suggestWeightOrReps(), computed for one goal
  // metric at a time — called once per configured goal (see
  // suggestNextTarget above), so a run logged toward both a distance and a
  // pace goal gets an independent, correctly-worded suggestion for each.
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
    if (exercise.kind === 'cardio') {
      const metrics = cardioMetricsOf(exercise);
      if (metrics.length === 2) return 'Run · distance & pace';
      return metrics[0] === 'pace' ? 'Run · pace' : 'Run · distance';
    }
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
    const sheet = modalSheet();
    sheet.style.transform = '';
    sheet.classList.remove('is-dragging');
    sheet.innerHTML = `<div class="modal-handle"></div>${html}`;
    modalRoot().hidden = false;
    wireModalSwipeToClose(sheet);
  }
  function closeModal() {
    modalRoot().hidden = true;
    modalSheet().innerHTML = '';
  }

  // Makes the little bar at the top of every modal sheet (`.modal-handle`)
  // an actual swipe-down-to-close gesture, dragging the sheet with the
  // pointer and either snapping it back or dismissing it, rather than
  // leaving it as a purely decorative hint that does nothing when dragged.
  // Pointer Events cover touch and mouse input identically, so this one
  // listener set works on both a phone and a desktop browser.
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

  function confirmDialog(title, body, confirmLabel, onConfirm, danger) {
    openModal(`
      <div class="modal-title-row"><h2>${escapeHtml(title)}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <p class="muted-text">${escapeHtml(body)}</p>
      <div class="btn-row confirm-actions">
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
      const rpeV = parseFloat(container.querySelector('#cardioRpe').value);
      const hasDist = !Number.isNaN(distV) && distV > 0;
      const hasTime = minV > 0 || secV > 0;
      if (!hasDist && !hasTime) return null;
      return {
        distance: hasDist ? Units.displayToMi(distV) : null,
        duration: hasTime ? minV * 60 + secV : null,
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

  // Every configured goal, flattened to one entry per goal rather than one
  // per exercise — a cardio exercise with both a distance and a pace goal
  // contributes two units here, so the "Goals reached" tally below counts
  // it as two goals, not one.
  function activeGoalUnits() {
    const units = [];
    activeExercises().forEach((ex) => {
      if (ex.kind === 'cardio') {
        cardioMetricsOf(ex).forEach((metric) => units.push({ ex, metric }));
      } else if (ex.goal) {
        units.push({ ex, metric: undefined });
      }
    });
    return units;
  }

  function renderSummary() {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekAgoIso = new Date(weekAgo.getTime() - weekAgo.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const sessionsThisWeek = new Set(state.entries.filter((e) => e.date >= weekAgoIso).map((e) => e.date)).size;
    const goalUnits = activeGoalUnits();
    const goalsHit = goalUnits.filter((u) => progressPct(u.ex, u.metric).achieved).length;
    const streak = computeStreak();

    document.getElementById('summaryRow').innerHTML = `
      <div class="stat-tile"><div class="value">${sessionsThisWeek}</div><div class="label">Days logged this week</div></div>
      <div class="stat-tile"><div class="value">${streak}</div><div class="label">Day streak</div></div>
      <div class="stat-tile"><div class="value">${goalsHit}/${goalUnits.length}</div><div class="label">Goals reached</div></div>
    `;
  }

  // One goal's worth of current-value/goal-label/meter, shared by the
  // dashboard card and the exercise detail modal. A cardio exercise with
  // two configured goals renders this once per metric (see goalCardHtml and
  // renderExerciseDetail below); every other case renders it exactly once.
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

  function goalCardHtml(ex) {
    const entries = entriesFor(ex.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const cardioMetrics = ex.kind === 'cardio' ? cardioMetricsOf(ex) : null;
    const trendMetric = cardioMetrics ? cardioMetrics[0] : undefined;
    const progressHtml = cardioMetrics
      ? (cardioMetrics.length
          ? cardioMetrics.map((m) => progressBlockHtml(ex, m, { labeled: cardioMetrics.length > 1 })).join('')
          : progressBlockHtml(ex, 'distance'))
      : progressBlockHtml(ex);
    const trend = entries.map((e) => entryValue(ex, e, trendMetric));
    return `
      <div class="card ex-card" data-exercise-id="${ex.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${escapeHtml(ex.name)}</div>
          <div class="ex-card-badge">${kindBadge(ex)}</div>
        </div>
        ${progressHtml}
        ${trend.filter((v) => v != null).length >= 2 ? `<div class="ex-card-spark">${Charts.sparkline(trend, { width: 280, height: 34 })}</div>` : ''}
      </div>`;
  }

  // Daily (WFH) exercises get a compact, low-emphasis row instead of a full
  // goal card — the ask was "how many total pushups/squats/pullups I did",
  // not another big progress meter.
  function dailyRowHtml(ex) {
    const entries = entriesFor(ex.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const lastEntry = entries[entries.length - 1];
    // Cardio exercises are rare in the Daily section (it's meant for WFH
    // bodyweight work), but if one lands here it still needs a sane
    // fallback rather than assuming reps-shaped data.
    if (ex.kind === 'cardio') {
      const metrics = cardioMetricsOf(ex);
      const metric = metrics[0];
      const bestVal = metric ? best(ex, metric) : null;
      return `
        <div class="daily-row" data-exercise-id="${ex.id}">
          <div class="daily-row-main">
            <div class="daily-row-name">${escapeHtml(ex.name)}</div>
            <div class="daily-row-sub">${entries.length} session${entries.length === 1 ? '' : 's'} logged${lastEntry ? ` · last: ${fmtDateShort(lastEntry.date)}` : ' · not logged yet'}</div>
          </div>
          ${metric ? `<div class="daily-row-goal">${formatValueForExercise(ex, bestVal, metric)}</div>` : ''}
        </div>`;
    }
    const lifetimeTotal = entries.reduce((sum, e) => sum + (e.sets || []).reduce((m, s) => m + (s.reps || 0), 0), 0);
    const lastTotal = lastEntry ? (lastEntry.sets || []).reduce((m, s) => m + (s.reps || 0), 0) : null;
    const bestSet = best(ex);
    return `
      <div class="daily-row" data-exercise-id="${ex.id}">
        <div class="daily-row-main">
          <div class="daily-row-name">${escapeHtml(ex.name)}</div>
          <div class="daily-row-sub">${lifetimeTotal.toLocaleString()} lifetime reps${lastEntry ? ` · last: ${lastTotal} on ${fmtDateShort(lastEntry.date)}` : ' · not logged yet'}</div>
        </div>
        ${ex.goal ? `<div class="daily-row-goal">${bestSet != null ? Math.round(bestSet) : '—'}<span class="muted-text">/${Math.round(ex.goal)}</span></div>` : ''}
      </div>`;
  }

  function renderDashboard() {
    renderSummary();
    const all = activeExercises();
    const goalList = all.filter((e) => sectionOf(e) === 'goal');
    const dailyList = all.filter((e) => sectionOf(e) === 'daily');
    // accessory exercises are intentionally omitted from the dashboard —
    // they're still fully logged/edited via the Log and History tabs.

    document.getElementById('dashboardEmpty').hidden = (goalList.length + dailyList.length) > 0;

    const cardsWrap = document.getElementById('exerciseCards');
    cardsWrap.innerHTML = goalList.map(goalCardHtml).join('');
    cardsWrap.querySelectorAll('.ex-card').forEach((card) => {
      card.addEventListener('click', () => openExerciseDetail(card.getAttribute('data-exercise-id')));
    });

    document.getElementById('dailySectionHead').hidden = dailyList.length === 0;
    const dailyWrap = document.getElementById('dailyList');
    dailyWrap.hidden = dailyList.length === 0;
    dailyWrap.innerHTML = dailyList.map(dailyRowHtml).join('');
    dailyWrap.querySelectorAll('.daily-row').forEach((row) => {
      row.addEventListener('click', () => openExerciseDetail(row.getAttribute('data-exercise-id')));
    });
  }

  /* ============================== Rendering: Log tab ============================== */

  function groupBySection(list) {
    const groups = { goal: [], daily: [], accessory: [] };
    list.forEach((ex) => { groups[sectionOf(ex)].push(ex); });
    return groups;
  }

  function populateExerciseSelect(select, { includeArchived = false } = {}) {
    const list = includeArchived ? state.exercises : activeExercises();
    const groups = groupBySection(list);
    let html = '';
    ['goal', 'daily', 'accessory'].forEach((sec) => {
      if (!groups[sec].length) return;
      html += `<optgroup label="${SECTION_LABELS[sec]}">` +
        groups[sec].map((ex) => `<option value="${ex.id}">${escapeHtml(ex.name)}${ex.archived ? ' (archived)' : ''}</option>`).join('') +
        `</optgroup>`;
    });
    html += `<option value="__add_new__">+ Add new exercise…</option>`;
    select.innerHTML = html;
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
    if (entry.rpe != null) bits.push(`RPE ${entry.rpe}`);
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
    const groups = groupBySection(state.exercises);
    let html = `<option value="__all__">All exercises</option>`;
    ['goal', 'daily', 'accessory'].forEach((sec) => {
      if (!groups[sec].length) return;
      html += `<optgroup label="${SECTION_LABELS[sec]}">` +
        groups[sec].map((ex) => `<option value="${ex.id}">${escapeHtml(ex.name)}${ex.archived ? ' (archived)' : ''}</option>`).join('') +
        `</optgroup>`;
    });
    select.innerHTML = html;
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
      <p class="muted-text modal-subtitle">${escapeHtml(ex ? ex.name : 'Deleted exercise')}</p>
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

  // `chartMetric` only matters for cardio exercises with two configured
  // goals — it selects which one the trend chart plots. It is ignored (and
  // defaults sensibly) for every other case, so existing callers that don't
  // pass it keep working unchanged.
  function renderExerciseDetail(exId, scale, chartMetric) {
    const ex = exerciseById(exId);
    if (!ex) return;
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

    let totalStat = '—';
    if (ex.kind === 'weight') totalStat = `${entries.reduce((n, e) => n + (e.sets || []).length, 0)} sets logged`;
    else if (ex.kind === 'reps') totalStat = `${entries.reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (s.reps || 0), 0), 0)} total reps`;
    else totalStat = `${fmtDistance(entries.reduce((n, e) => n + (e.distance || 0), 0))} total`;

    openModal(`
      <div class="modal-title-row"><h2>${escapeHtml(ex.name)}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <div class="ex-card-badge badge-standalone">${kindBadge(ex)}</div>
      ${progressHtml}

      ${suggestions.map((sugg) => `
        <div class="card suggestion-card">
          <div class="suggestion-label">Next session${sugg.metric ? ` · ${sugg.metric === 'pace' ? 'Pace' : 'Distance'}` : ''}</div>
          <div class="suggestion-headline">${escapeHtml(sugg.headline)}</div>
          ${sugg.detail ? `<div class="suggestion-detail">${escapeHtml(sugg.detail)}</div>` : ''}
          ${sugg.method ? `<div class="suggestion-method">${SUGGESTION_METHOD_NOTE[sugg.method]} Adjust for soreness and sleep.</div>` : ''}
        </div>`).join('')}

      <div class="pr-grid">
        <div class="pr-tile"><div class="value">${entries.length}</div><div class="label">Sessions logged</div></div>
        <div class="pr-tile"><div class="value">${totalStat}</div><div class="label">Lifetime total</div></div>
      </div>

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
        <button class="btn btn-secondary" id="editExerciseBtn">Edit exercise</button>
        <button class="btn btn-secondary" id="archiveExerciseBtn">${ex.archived ? 'Unarchive' : 'Archive'}</button>
      </div>

      <div class="section-head"><h2>All entries</h2></div>
      <div class="entry-list" id="exerciseEntryList">${entries.slice().reverse().map((e) => entryRowHtml(e)).join('') || '<p class="muted-text">No entries yet.</p>'}</div>
    `);
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
    document.getElementById('editExerciseBtn').addEventListener('click', () => openExerciseForm(ex.id));
    document.getElementById('archiveExerciseBtn').addEventListener('click', () => {
      ex.archived = !ex.archived;
      save();
      closeModal();
      toast(ex.archived ? 'Exercise archived' : 'Exercise unarchived');
      renderAll();
    });
  }

  function openExerciseDetail(exId) {
    renderExerciseDetail(exId, 'last10');
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
      <div class="modal-title-row"><h2>${editing ? 'Edit exercise' : 'Add exercise'}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Name</span>
          <input type="text" id="exName" value="${ex ? escapeHtml(ex.name) : ''}" placeholder="e.g. Overhead Press" maxlength="60" /></label>

        <div class="field">
          <span class="field-label">Section</span>
          <div class="segmented" id="exSectionSegmented" role="radiogroup">
            <button type="button" data-section="goal" role="radio">Goal</button>
            <button type="button" data-section="daily" role="radio">Daily (WFH)</button>
            <button type="button" data-section="accessory" role="radio">Other</button>
          </div>
          <span class="muted-text field-hint" id="sectionHint"></span>
        </div>

        <div class="field">
          <span class="field-label">Type${hasEntries ? ' (locked — has logged entries)' : ''}</span>
          <div class="segmented" id="exKindSegmented" role="radiogroup">
            <button type="button" data-kind="weight" role="radio" ${hasEntries && kind !== 'weight' ? 'disabled' : ''}>Weighted lift</button>
            <button type="button" data-kind="reps" role="radio" ${hasEntries && kind !== 'reps' ? 'disabled' : ''}>Bodyweight reps</button>
            <button type="button" data-kind="cardio" role="radio" ${hasEntries && kind !== 'cardio' ? 'disabled' : ''}>Cardio</button>
          </div>
        </div>

        <div class="field" id="bodyRegionField" hidden>
          <span class="field-label">Move pattern <span class="muted-text">(sizes the suggested weight jump)</span></span>
          <div class="segmented" id="exBodyRegionSegmented" role="radiogroup">
            <button type="button" data-region="upper" role="radio">Upper body</button>
            <button type="button" data-region="lower" role="radio">Lower body</button>
          </div>
        </div>

        <div id="goalFieldWrap"></div>

        <button type="button" class="btn btn-primary btn-block" id="saveExerciseBtn">${editing ? 'Save changes' : 'Add exercise'}</button>
        ${editing ? `<button type="button" class="btn btn-secondary btn-block" id="archiveToggleBtn">${ex.archived ? 'Unarchive exercise' : 'Archive exercise'}</button>` : ''}
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteExerciseBtn">Delete exercise permanently</button>` : ''}
      </div>
    `);

    let selectedKind = kind;
    let selectedSection = section;
    let selectedRegion = bodyRegion;

    const SECTION_HINTS = {
      goal: 'Shown as a full progress card on your home screen.',
      daily: 'Shown as a compact running total on your home screen — for WFH-day bodyweight work.',
      accessory: 'Hidden from your home screen. Still loggable and viewable in History — for accessory/other exercises.',
    };

    function setSectionUI(s) {
      selectedSection = s;
      document.querySelectorAll('#exSectionSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.section === s)));
      document.getElementById('sectionHint').textContent = SECTION_HINTS[s];
    }
    function setRegionUI(r) {
      selectedRegion = r;
      document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.region === r)));
    }
    document.querySelectorAll('#exSectionSegmented button').forEach((b) => b.addEventListener('click', () => setSectionUI(b.dataset.section)));
    document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.addEventListener('click', () => setRegionUI(b.dataset.region)));
    setSectionUI(selectedSection);
    setRegionUI(selectedRegion);

    function renderGoalField() {
      const wrap = document.getElementById('goalFieldWrap');
      document.getElementById('bodyRegionField').hidden = selectedKind !== 'weight';
      if (selectedKind === 'weight') {
        const v = ex && ex.goal ? round(Units.lbToDisplay(ex.goal), 1) : '';
        wrap.innerHTML = `<label class="field"><span class="field-label">Goal weight (${Units.weightUnitLabel()})</span><input type="number" step="any" id="goalInput" value="${v}" placeholder="e.g. 225" /></label>`;
      } else if (selectedKind === 'reps') {
        const v = ex && ex.goal ? ex.goal : '';
        wrap.innerHTML = `<label class="field"><span class="field-label">Goal reps (single set)</span><input type="number" step="1" min="1" id="goalInput" value="${v}" placeholder="e.g. 20" /></label>`;
      } else {
        // Cardio carries two independent, optional goals rather than a
        // single choice — a distance goal, a pace goal, or both — because
        // one logged run (distance + time) always yields both a distance
        // and a pace, so there is no reason to make the user pick only one
        // to track.
        const distVal = ex && ex.distanceGoal ? round(Units.miToDisplay(ex.distanceGoal), 2) : '';
        const secPerUnit = ex && ex.paceGoal ? Units.secPerMiToDisplaySecPerUnit(ex.paceGoal) : null;
        const mins = secPerUnit != null ? Math.floor(secPerUnit / 60) : '';
        const secs = secPerUnit != null ? Math.round(secPerUnit % 60) : '';
        wrap.innerHTML = `
          <label class="field"><span class="field-label">Distance goal (${Units.distanceUnitLabel()}) <span class="muted-text">(optional)</span></span>
            <input type="number" step="any" id="goalDistanceInput" value="${distVal}" placeholder="e.g. 5" /></label>
          <div class="field"><span class="field-label">Pace goal (min:sec per ${Units.distanceUnitLabel()}) <span class="muted-text">(optional)</span></span>
            <div class="inline-time-fields"><input type="number" step="1" min="0" id="goalPaceMin" value="${mins}" placeholder="min" /><input type="number" step="1" min="0" max="59" id="goalPaceSec" value="${secs}" placeholder="sec" /></div></div>
          <p class="field-hint muted-text">Leave either blank to skip that goal — one logged run updates progress toward both.</p>`;
      }
    }

    function setKindUI(k) {
      selectedKind = k;
      document.querySelectorAll('#exKindSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
      renderGoalField();
    }

    document.querySelectorAll('#exKindSegmented button').forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) setKindUI(b.dataset.kind); });
    });
    setKindUI(selectedKind);

    document.getElementById('saveExerciseBtn').addEventListener('click', () => {
      const name = document.getElementById('exName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      let goal = null;
      let distanceGoal = null;
      let paceGoal = null;
      if (selectedKind === 'weight' || selectedKind === 'reps') {
        const raw = parseFloat(document.getElementById('goalInput').value);
        if (!Number.isNaN(raw) && raw > 0) {
          goal = selectedKind === 'weight' ? Units.displayToLb(raw) : raw;
        }
      } else {
        // Cardio: read both optional goals independently — either, neither,
        // or both may be set.
        const rawDist = parseFloat(document.getElementById('goalDistanceInput').value);
        if (!Number.isNaN(rawDist) && rawDist > 0) distanceGoal = Units.displayToMi(rawDist);
        const m = parseFloat(document.getElementById('goalPaceMin').value) || 0;
        const s = parseFloat(document.getElementById('goalPaceSec').value) || 0;
        if (m > 0 || s > 0) paceGoal = Units.displaySecPerUnitToSecPerMi(m * 60 + s);
      }
      if (editing) {
        ex.name = name;
        ex.kind = selectedKind;
        ex.section = selectedSection;
        if (selectedKind === 'weight') ex.bodyRegion = selectedRegion; else delete ex.bodyRegion;
        if (selectedKind === 'cardio') {
          ex.distanceGoal = distanceGoal;
          ex.paceGoal = paceGoal;
        }
        ex.goal = goal; // meaningful for weight/reps only; left null and unread for cardio
      } else {
        const newEx = { id: genId('ex'), name, kind: selectedKind, section: selectedSection, goal, archived: false, createdAt: new Date().toISOString() };
        if (selectedKind === 'weight') newEx.bodyRegion = selectedRegion;
        if (selectedKind === 'cardio') { newEx.distanceGoal = distanceGoal; newEx.paceGoal = paceGoal; }
        state.exercises.push(newEx);
      }
      save();
      closeModal();
      toast(editing ? 'Exercise updated' : 'Exercise added');
      renderAll();
    });

    if (editing) {
      // Archiving is the safe, reversible way to hide an exercise from the
      // dashboard, and is offered unconditionally — whether or not it has
      // logged entries — matching the toggle in the exercise detail modal.
      // Permanent deletion is a separate, deliberately lower-emphasis action
      // below it, so it's never the default choice for "I don't want to see
      // this anymore."
      document.getElementById('archiveToggleBtn').addEventListener('click', () => {
        ex.archived = !ex.archived;
        save();
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
          save(); closeModal(); toast('Exercise deleted'); renderAll();
        }, true);
      });
    }
  }

  /* ============================== Settings ============================== */

  function renderSettings() {
    document.querySelectorAll('#themeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === state.settings.theme)));
    document.querySelectorAll('#weightUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.weightUnit)));
    document.querySelectorAll('#distanceUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.distanceUnit)));

    const wrap = document.getElementById('exerciseManageList');
    const groups = groupBySection(state.exercises);
    wrap.innerHTML = ['goal', 'daily', 'accessory'].map((sec) => {
      if (!groups[sec].length) return '';
      return `<div class="manage-group-label">${SECTION_LABELS[sec]}</div>` + groups[sec].map((ex) => `
        <div class="entry-row is-manage" data-exercise-id="${ex.id}">
          <div class="entry-row-main">
            <div class="entry-row-title">${escapeHtml(ex.name)} ${ex.archived ? '<span class="chip chip-archived">archived</span>' : ''}</div>
            <div class="entry-row-sub">${kindBadge(ex)}${exerciseGoalSummary(ex)}</div>
          </div>
          <div class="entry-row-actions">
            ${ex.archived ? `<button class="btn btn-secondary btn-sm" data-action="unarchive-exercise" data-id="${ex.id}">Unarchive</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-action="edit-exercise" data-id="${ex.id}">Edit</button>
          </div>
        </div>`).join('');
    }).join('');
    wrap.querySelectorAll('[data-action="edit-exercise"]').forEach((btn) => btn.addEventListener('click', () => openExerciseForm(btn.dataset.id)));
    wrap.querySelectorAll('[data-action="unarchive-exercise"]').forEach((btn) => btn.addEventListener('click', () => {
      const ex = exerciseById(btn.dataset.id);
      if (!ex) return;
      ex.archived = false;
      save();
      toast('Exercise unarchived');
      renderAll();
    }));
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
          // Run the same migration pipeline load() uses — a backup exported
          // from an older version of the app is brought up to the current
          // shape the same way, additively, instead of being rejected.
          state = runMigrations(parsed);
          save();
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

  /* ============================== Tabs / global wiring ============================== */

  // Hides every <section class="view"> except the one whose data-view
  // matches `tab`, updates the bottom tab bar's highlighted icon, and
  // re-renders that one tab so it always shows current data (rather than
  // whatever it last looked like). There's no real router here — with only
  // four screens, "show this one, hide the rest" is simplest.
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

  // The heavy-handed "just redraw everything" refresh, used after anything
  // that could affect more than one screen at once (import, unit change,
  // adding/editing/archiving an exercise). Cheap enough for how little data
  // this app holds — no need for more surgical updates.
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
