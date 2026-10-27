/* Fit Log data migrations.

   All app data is one JSON object saved under one key. SCHEMA_VERSION says what
   shape that object has. To change the shape:

     1. Bump SCHEMA_VERSION by exactly 1.
     2. Add a function to MIGRATIONS keyed by the OLD version (key 15 upgrades
        a v15 save to v16).
     3. Prefer adding fields with safe defaults. Do not delete, rename or
        repurpose a field an older version wrote. Restructuring is allowed only
        when the migration preserves the information (v4 keeps every Height
        reading in profile.heightHistory; v5 merges the two sleep trackers
        without dropping a reading) and a test with a saved fixture proves it.
     4. Add a fixture and a case to tests/migrations.test.js.

   load() and the backup import both call runMigrations(), so a backup from any
   older version imports cleanly. A new install starts at the latest shape and
   skips this. */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 16;

  function genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  // Home screen blocks the user can hide (Settings > Home screen). A block
  // also stays hidden when the feature behind it is switched off.
  const HOME_SECTION_DEFAULTS = Object.freeze({ checklist: true, training: true, nutrition: true, mini: true, goals: true });

  // Known "daily" exercise ids from before the Goal/Daily/Other split
  // existed (schema v1). Used only by the v1->v2 migration below.
  const LEGACY_DAILY_IDS = new Set(['ex_pushups', 'ex_bwsquats', 'ex_pullups']);
  const LOWER_BODY_KEYWORDS = ['squat', 'deadlift', 'leg press', 'lunge', 'calf', 'hip thrust', 'glute', 'rdl', 'romanian'];

  // Best-effort guess for a new lift's move pattern, used (a) as the
  // starting selection when adding a weight exercise, and (b) to backfill
  // `bodyRegion` for lifts saved before that field existed. It only sizes
  // the suggested weight jump in the progressive-overload card -  getting
  // it wrong isn't destructive, so a simple keyword match is good enough.
  function guessBodyRegion(name) {
    const n = (name || '').toLowerCase();
    return LOWER_BODY_KEYWORDS.some((k) => n.includes(k)) ? 'lower' : 'upper';
  }

  const MIGRATIONS = {
    // v1 -> v2: introduced `section` ('goal' | 'daily' | 'accessory') on
    // every exercise, and `bodyRegion` ('upper' | 'lower') on weighted
    // lifts. Both are purely additive -  nothing from v1 is touched.
    1: (data, deps) => {
      data.exercises.forEach((ex) => {
        if (!ex.section) ex.section = LEGACY_DAILY_IDS.has(ex.id) ? 'daily' : 'goal';
        if (ex.kind === 'weight' && !ex.bodyRegion) ex.bodyRegion = guessBodyRegion(ex.name);
      });
      return data;
    },
    // v2 -> v3: cardio exercises moved from a single goal ('goalMetric' +
    // 'goal') to two independent, optional goals ('distanceGoal' and
    // 'paceGoal') so one logged run can count toward both at once. The old
    // fields are left in place, untouched, rather than deleted -  nothing
    // reads them for cardio anymore, but per the rule above an older field
    // is never removed on upgrade.
    2: (data, deps) => {
      data.exercises.forEach((ex) => {
        if (ex.kind !== 'cardio') return;
        if (ex.distanceGoal === undefined) ex.distanceGoal = (ex.goalMetric !== 'pace' && ex.goal) ? ex.goal : null;
        if (ex.paceGoal === undefined) ex.paceGoal = (ex.goalMetric === 'pace' && ex.goal) ? ex.goal : null;
      });
      return data;
    },
    // v3 -> v4: introduced body/wellness trackers (`trackers` +
    // `measurements`) and water tracking (`water` + `waterEntries`) as
    // brand-new top-level fields, alongside two new unit settings. All
    // purely additive -  nothing about exercises or workout entries changes.
    // A pre-existing save gets the same starter trackers/cups a fresh
    // install seeds (see defaultTrackers()/defaultWater()), rather than
    // empty lists, so upgrading actually surfaces the new features.
    3: (data, deps) => {
      if (!Array.isArray(data.trackers)) data.trackers = deps.defaultTrackers();
      if (!Array.isArray(data.measurements)) data.measurements = [];
      if (!data.water) data.water = deps.defaultWater();
      if (!Array.isArray(data.waterEntries)) data.waterEntries = [];
      if (!data.settings.lengthUnit) data.settings.lengthUnit = 'in';
      if (!data.settings.volumeUnit) data.settings.volumeUnit = 'flOz';
      return data;
    },
    // v4 -> v5: added a `profile` (height + sex -  fixed facts about you,
    // not something with a trend worth charting) and settings for the
    // dashboard chart's default range and the optional insight calculators
    // (body-weight trend/BMI, strength-vs-bodyweight, pace level).
    //
    // Height specifically moves OUT of the trackers list here: it doesn't
    // change often enough to need a logged history, so any existing Height
    // tracker's most recent value is carried over into profile.heightCm - 
    // nothing is lost, it just becomes a single current fact instead of a
    // trend. The tracker is removed, but every height reading it held is
    // kept in `profile.heightHistory` ({date, value, note}) so no record is
    // lost. Every other tracker, and everything about exercises, entries,
    // and water, is untouched.
    4: (data, deps) => {
      if (!data.profile) data.profile = { heightCm: null, sex: null };
      const heightTracker = (data.trackers || []).find((t) => t.id === 'trk_height');
      if (heightTracker) {
        const heightEntries = (data.measurements || [])
          .filter((m) => m.trackerId === heightTracker.id)
          .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
        if (heightEntries.length && data.profile.heightCm == null) {
          data.profile.heightCm = heightEntries[heightEntries.length - 1].value;
        }
        if (heightEntries.length && !Array.isArray(data.profile.heightHistory)) {
          data.profile.heightHistory = heightEntries.map((m) => ({ date: m.date, value: m.value, note: m.note || null }));
        }
        data.trackers = data.trackers.filter((t) => t.id !== heightTracker.id);
        data.measurements = (data.measurements || []).filter((m) => m.trackerId !== heightTracker.id);
      }
      if (data.settings.chartScale === undefined) data.settings.chartScale = 'last10';
      if (data.settings.insightsWindowDays === undefined) data.settings.insightsWindowDays = 90;
      if (data.settings.showWeightInsights === undefined) data.settings.showWeightInsights = false;
      if (data.settings.showStrengthLevel === undefined) data.settings.showStrengthLevel = false;
      if (data.settings.showPaceLevel === undefined) data.settings.showPaceLevel = false;
      data.exercises.forEach((ex) => { if (ex.kind === 'weight' && ex.liftType === undefined) ex.liftType = null; });
      return data;
    },
    // v5 -> v6: Sleep Hours and Sleep Feeling were two separate trackers,
    // meaning one night's sleep took two log entries. They're merged here
    // into one `kind: 'sleep'` tracker (id `trk_sleep`) whose measurements
    // carry both an hours `value` and a 1-5 `quality` on the same entry - 
    // see the "Body & wellness trackers" section for how `kind` branches.
    //
    // Merging is date-based (the normal case is one sleep log per night):
    // on each date, the hours entries and feeling entries are paired in the
    // order they were logged. Any entry without a partner (an hours-only
    // night, or a second log on the same date) still becomes its own merged
    // entry with the other field left null, and notes from both sides are
    // kept, so no reading is dropped.
    5: (data, deps) => {
      const hoursTracker = (data.trackers || []).find((t) => t.id === 'trk_sleephours');
      const feelTracker = (data.trackers || []).find((t) => t.id === 'trk_sleepfeel');
      if (hoursTracker || feelTracker) {
        const byDate = (trackerId) => {
          const map = new Map();
          (data.measurements || [])
            .filter((m) => m.trackerId === trackerId)
            .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id))
            .forEach((m) => { if (!map.has(m.date)) map.set(m.date, []); map.get(m.date).push(m); });
          return map;
        };
        const hoursByDate = hoursTracker ? byDate(hoursTracker.id) : new Map();
        const feelByDate = feelTracker ? byDate(feelTracker.id) : new Map();
        const dates = new Set([...hoursByDate.keys(), ...feelByDate.keys()]);
        dates.forEach((date) => {
          const hs = hoursByDate.get(date) || [];
          const fs = feelByDate.get(date) || [];
          for (let i = 0; i < Math.max(hs.length, fs.length); i++) {
            const h = hs[i]; const f = fs[i];
            const notes = [h && h.note, f && f.note].filter(Boolean);
            data.measurements.push({
              id: genId('meas'), trackerId: 'trk_sleep', date,
              value: h ? h.value : null, quality: f ? f.value : null,
              note: notes.length ? Array.from(new Set(notes)).join(' · ') : null,
            });
          }
        });
        data.trackers = (data.trackers || []).filter((t) => t.id !== 'trk_sleephours' && t.id !== 'trk_sleepfeel');
        data.measurements = data.measurements.filter((m) => m.trackerId !== 'trk_sleephours' && m.trackerId !== 'trk_sleepfeel');
        if (!data.trackers.some((t) => t.id === 'trk_sleep')) {
          data.trackers.push({ id: 'trk_sleep', name: 'Sleep', kind: 'sleep', unitKind: 'hours', goal: (hoursTracker && hoursTracker.goal) || null, direction: (hoursTracker && hoursTracker.direction) || null, archived: (hoursTracker && hoursTracker.archived) || false, createdAt: new Date().toISOString() });
        }
      }
      return data;
    },
    // v6 -> v7: tracker goal progress used to be a plain current/goal ratio,
    // which reads as nonsense for a body metric moving toward a target from
    // some starting point (200lb -> 180lb goal at 195lb is 25% there, not
    // the 92% that ratio gives) -  see trackerProgressPct() below, which now
    // measures against a `baseline` instead. Existing trackers with a goal
    // already set have no recorded "starting point," so the best available
    // proxy -  the earliest logged value -  is used; a tracker with no
    // measurements yet, or no goal, gets `baseline: null` and simply falls
    // back to the old ratio until one is established (see
    // trackerProgressPct()'s own fallback).
    6: (data, deps) => {
      (data.trackers || []).forEach((t) => {
        if (t.baseline !== undefined) return;
        if (t.goal == null) { t.baseline = null; return; }
        const earliest = (data.measurements || [])
          .filter((m) => m.trackerId === t.id)
          .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id))[0];
        t.baseline = earliest ? earliest.value : null;
      });
      return data;
    },
    // v7 -> v8: two purely additive changes. (1) A weight exercise's goal
    // gains `goalMode` ('fixed' | 'standard') + `goalTier` so a bodyweight-
    // standard goal (see LIFT_STANDARDS/computeStandardGoal below) stays
    // adjustable from Manage -> Exercises after the fact instead of
    // collapsing into an indistinguishable flat number the moment it's
    // computed. Every existing weight exercise -  including ones the setup
    // wizard originally computed from a standard -  is backfilled as
    // 'fixed': there's no way to recover which ones were formula-derived
    // after the fact, and 'fixed' exactly matches how the number has
    // actually behaved until now (a static value, not recomputed as
    // bodyweight changes), so nothing about existing goals changes; the
    // user can switch any of them to 'standard' going forward.
    // (2) A brand-new, independent Food/nutrition area (`food` +
    // `settings.trackedMacros`) -  see the "Food / nutrition" section below.
    // It touches nothing about exercises, entries, trackers, measurements,
    // water, or waterEntries.
    7: (data, deps) => {
      data.exercises.forEach((ex) => {
        if (ex.kind !== 'weight') return;
        if (ex.goalMode === undefined) ex.goalMode = 'fixed';
        if (ex.goalTier === undefined) ex.goalTier = null;
      });
      if (!data.food || !Array.isArray(data.food.entries)) data.food = { entries: (data.food && data.food.entries) || [] };
      if (!data.settings.trackedMacros) data.settings.trackedMacros = { calories: true, protein: true, carbs: false, fat: false };
      // Body Fat % used to be pre-seeded on every install (see
      // defaultTrackers()) even though most people have no way to measure
      // it without calipers or a smart scale -  it's no longer seeded for
      // new installs, and an existing one that was never actually logged
      // (a sign it was just clutter, not something the user chose to use)
      // gets quietly hidden from the dashboard the same reversible way
      // Manage's own "hide from dashboard" toggle works. The tracker and
      // any real history it does have are left completely alone either
      // way -  this only ever flips a display flag, never deletes anything.
      const bodyfat = (data.trackers || []).find((t) => t.id === 'trk_bodyfat');
      if (bodyfat && bodyfat.showOnDashboard === undefined) {
        const hasData = (data.measurements || []).some((m) => m.trackerId === 'trk_bodyfat');
        if (!hasData) bodyfat.showOnDashboard = false;
      }
      return data;
    },
    // v8 -> v9: two fixes.
    // (1) `liftType` backfill for the three seeded lifts (Bench/Squat/
    // Deadlift). The v4->v5 migration (long before Lift Type existed as a
    // field anyone could deliberately choose) set `liftType: null`
    // unconditionally on every pre-existing weight exercise as a safe
    // default -  which means an install that predates that migration has
    // had `liftType: null` on these three ever since, with no way for the
    // Strength Level insight to ever work for them even after turning the
    // Settings toggle on, since it requires a matching liftType. Since
    // "null" here overwhelmingly means "never touched," not "deliberately
    // set to None," these three specific ids are backfilled to their
    // obvious lift type. This is reversible in seconds from Manage ->
    // Exercises (set Lift Type back to None) for the rare case where
    // someone genuinely had opted out.
    // (2) Food's per-macro settings move from `trackedMacros` (an on/off
    // switch for whether the Log form even asked for that macro) to
    // `macroGoals` (all four macros are now always loggable; this instead
    // tracks whether a DAILY GOAL is set for a given macro, and what it
    // is) -  seeded fully off, matching how a water/tracker goal starts
    // unset until deliberately given one. `trackedMacros` is left in place
    // per the migration policy above rather than deleted; nothing reads it
    // anymore.
    8: (data, deps) => {
      const KNOWN_LIFT_IDS = { ex_bench: 'bench', ex_squat: 'squat', ex_deadlift: 'deadlift' };
      data.exercises.forEach((ex) => {
        if (ex.kind === 'weight' && ex.liftType == null && KNOWN_LIFT_IDS[ex.id]) ex.liftType = KNOWN_LIFT_IDS[ex.id];
      });
      if (!data.settings.macroGoals) {
        data.settings.macroGoals = {
          calories: { enabled: false, goal: null }, protein: { enabled: false, goal: null },
          carbs: { enabled: false, goal: null }, fat: { enabled: false, goal: null },
        };
      }
      return data;
    },
    // v9 -> v10: purely additive -  three new optional food fields (sugar,
    // sodium, caffeine) alongside the original four macros, added the same
    // way the four macros work rather than as a separate feature (see the
    // "Food / nutrition" section for the reasoning). Every existing food
    // entry already omits fields it has no value for (they're only ever
    // set when logged), so no entry needs touching -  a food entry from
    // before this migration simply has no sugar/sodium/caffeine value yet,
    // same as it would if those fields just hadn't been logged. The only
    // real backfill needed is `settings.macroGoals`, which -  like every
    // other settings object here -  only had keys for the fields that
    // existed when it was created.
    9: (data, deps) => {
      if (!data.settings.macroGoals) data.settings.macroGoals = {};
      ['sugar', 'sodium', 'caffeine'].forEach((k) => {
        if (!data.settings.macroGoals[k]) data.settings.macroGoals[k] = { enabled: false, goal: null };
      });
      return data;
    },
    // v10 -> v11: three purely additive changes for this round's new
    // features. (1) `showSleepInsights` -  off by default, same as every
    // other optional insight toggle -  gates the trailing-nights sleep
    // average/category shown on the Sleep tracker card and in its detail
    // modal (see sleepInsights()). (2) `profile.age` -  a new one-time fact
    // alongside height/sex, needed only by the nutrition calculator's
    // Mifflin-St Jeor calorie estimate (see computeNutritionTargets()); null
    // until set, same treatment as height/sex before this. (3)
    // `settings.nutritionCalc` -  the activity-level/goal picker for that
    // same calculator, off by default; turning it on computes and applies
    // calorie/protein numbers into the *existing* `macroGoals.calories`/
    // `.protein` fields rather than introducing a parallel goal-storage
    // shape, the same way a lift's "Bodyweight standard" goal mode still
    // writes into the exercise's ordinary `goal` field.
    10: (data, deps) => {
      // A save file that started migrating from before v4 (see MIGRATIONS[4]
      // above, which is the step that normally creates `profile`) but whose
      // *starting* version was already >= 4 never runs that step at all - 
      // runMigrations() only calls MIGRATIONS[N] for N >= the save's own
      // starting version. A hand-built old-schema test fixture (or a very
      // old real save last touched between v4 and v9) can therefore still
      // reach this step with no `profile` object yet, so this can't assume
      // it already exists the way every migration after v4 normally could.
      if (!data.profile) data.profile = { heightCm: null, sex: null };
      if (data.settings.showSleepInsights === undefined) data.settings.showSleepInsights = false;
      if (data.profile.age === undefined) data.profile.age = null;
      if (!data.settings.nutritionCalc) {
        data.settings.nutritionCalc = { enabled: false, activityLevel: 'moderate', goal: 'maintain' };
      }
      return data;
    },
    // v11 -> v12: three changes, all for the nutrition/onboarding rework.
    // (1) Each macro's `enabled` flag (see macroGoalInfo) is repurposed
    // from "has a daily goal" to "tracked at all" for every macro EXCEPT
    // Calories, which is always tracked regardless (see macroTracked) - 
    // its `enabled` still only ever means "has a goal," so migrating it
    // needs no change. Protein/Carbs/Fat are forced on so nobody who never
    // bothered to set a goal for them suddenly loses a field they were
    // already using; Sugar/Sodium/Caffeine are forced on only where an
    // existing entry actually has a value for them, so a field genuinely
    // never used stays off (the declutter this was for) while one that IS
    // used stays visible. (2) `food.savedFoods` -  the new Saved Foods list,
    // starts empty. (3) `settings.trackFood`/`showMacroGuidance` -  new
    // toggles, both additive with safe defaults (Food stays on for
    // existing installs; guidance starts off like every other insight).
    11: (data, deps) => {
      const usedExtraKeys = new Set();
      if (!data.food) data.food = { entries: [] };
      if (!data.settings.macroGoals) data.settings.macroGoals = {};
      ['protein', 'carbs', 'fat', 'sugar', 'sodium', 'caffeine'].forEach((k) => {
        if (!data.settings.macroGoals[k]) data.settings.macroGoals[k] = { enabled: false, goal: null };
      });
      (data.food.entries || []).forEach((e) => {
        ['sugar', 'sodium', 'caffeine'].forEach((k) => { if (e[k] != null) usedExtraKeys.add(k); });
      });
      ['protein', 'carbs', 'fat'].forEach((k) => { data.settings.macroGoals[k].enabled = true; });
      usedExtraKeys.forEach((k) => { data.settings.macroGoals[k].enabled = true; });
      if (!Array.isArray(data.food.savedFoods)) data.food.savedFoods = [];
      if (data.settings.trackFood === undefined) data.settings.trackFood = true;
      if (data.settings.showMacroGuidance === undefined) data.settings.showMacroGuidance = false;
      return data;
    },
    // v12 -> v13: the Manage-consistency rework. Water and Food were nested
    // one level inside a "Nutrition" domain tab; that nesting is gone now
    // (see availableDomainCategories/DOMAIN_LABELS) -  Workout, Body
    // (measurements), Water, and Food are four flat, identically-styled
    // domains. Each of the four now also gets the same explicit "Track
    // this" master toggle Food already had (`trackFood`) -  added here for
    // the other three (`trackWorkout`, `trackMeasurements`, `trackWater`),
    // all defaulting to true so nothing that was visible before silently
    // disappears on upgrade. This is purely a navigation/visibility change;
    // it doesn't touch exercises, trackers, water entries, or food entries.
    12: (data, deps) => {
      if (data.settings.trackWorkout === undefined) data.settings.trackWorkout = true;
      if (data.settings.trackMeasurements === undefined) data.settings.trackMeasurements = true;
      if (data.settings.trackWater === undefined) data.settings.trackWater = true;
      return data;
    },
    // v13 -> v14: the first step of the redesign, and strictly additive.
    // (1) `settings.trackHabits` -  habits and daily-rep targets used to
    // switch on and off with Workout; they now have their own "Track this"
    // switch. Defaults to true so everything visible before stays visible.
    // (2) `settings.catalogPacksSeen` -  ids of starter packs from the
    // built-in catalog (js/catalog.js) that were already offered, added or
    // skipped, so a pack is never suggested twice. Nothing in the catalog
    // is ever added unasked. No exercise, set, entry, tracker, cup or food
    // is read or changed here. (Optional per-exercise fields the catalog
    // uses -  `catalogId`, `equipment` -  are written only when that
    // feature is used; a missing value means "not linked".)
    13: (data, deps) => {
      if (!data.settings) data.settings = {};
      if (data.settings.trackHabits === undefined) data.settings.trackHabits = true;
      if (!Array.isArray(data.settings.catalogPacksSeen)) data.settings.catalogPacksSeen = [];
      return data;
    },
    // v14 -> v15: `settings.trackCardio` -  running and cardio get their own
    // switch next to Habits instead of riding on Workout. Strictly additive:
    // it starts equal to trackWorkout, because cardio used to follow that
    // switch, so what was visible before stays visible (and what was hidden
    // stays hidden). Nothing logged is read or changed.
    14: (data, deps) => {
      if (!data.settings) data.settings = {};
      if (data.settings.trackCardio === undefined) data.settings.trackCardio = data.settings.trackWorkout !== false;
      return data;
    },
    // v15 -> v16: `settings.homeSections` -  which blocks the Home screen
    // shows. Strictly additive; everything starts on, as before.
    15: (data, deps) => {
      if (!data.settings) data.settings = {};
      const cur = data.settings.homeSections;
      data.settings.homeSections = Object.assign({}, HOME_SECTION_DEFAULTS, cur && typeof cur === 'object' ? cur : {});
      return data;
    },
    // Next migration goes here, keyed `16: (data, deps) => { ...; return data; }`.
  };

  /** Walks `data` forward through MIGRATIONS until it matches SCHEMA_VERSION.
   *  `deps` supplies the starter data the app owns: { defaultTrackers, defaultWater }. */
  function runMigrations(data, deps) {
    let version = data.version || 1;
    while (version < SCHEMA_VERSION && MIGRATIONS[version]) {
      data = MIGRATIONS[version](data, deps);
      version += 1;
    }
    data.version = version;
    return data;
  }

  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /** Copies `saved` over a fresh copy of `defaults`, one level of nesting at a
   *  time, so a partial saved object (say macroGoals with only calories) keeps
   *  the default for everything it omits. Never copies prototype-polluting keys
   *  and never shares an object with `defaults`. */
  function mergeSettings(defaults, saved) {
    const out = {};
    Object.keys(defaults).forEach((k) => {
      out[k] = isObj(defaults[k]) ? mergeSettings(defaults[k], {}) : Array.isArray(defaults[k]) ? defaults[k].slice() : defaults[k];
    });
    if (!isObj(saved)) return out;
    Object.keys(saved).forEach((k) => {
      if (UNSAFE_KEYS.has(k)) return;
      const v = saved[k];
      if (isObj(out[k]) && isObj(v)) out[k] = mergeSettings(out[k], v);
      else if (isObj(v)) out[k] = mergeSettings({}, v);
      else out[k] = Array.isArray(v) ? v.slice() : v;
    });
    return out;
  }

  /** Makes sure every top-level section exists after migrations, so a file that
   *  is missing one (a hand-edited or partial backup) cannot crash the app.
   *  `deps` = { defaultSettings, defaultProfile, defaultTrackers, defaultWater, defaultFood }. */
  function normalize(data, deps) {
    data.settings = mergeSettings(deps.defaultSettings(), data.settings);
    data.profile = mergeSettings(deps.defaultProfile(), data.profile);
    if (!Array.isArray(data.exercises)) data.exercises = [];
    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.trackers)) data.trackers = deps.defaultTrackers();
    if (!Array.isArray(data.measurements)) data.measurements = [];
    if (!isObj(data.water) || !Array.isArray(data.water.cups)) data.water = Object.assign(deps.defaultWater(), isObj(data.water) && Number.isFinite(data.water.goalMl) ? { goalMl: data.water.goalMl } : {});
    if (!Array.isArray(data.waterEntries)) data.waterEntries = [];
    const food = isObj(data.food) ? data.food : {};
    data.food = Object.assign(mergeSettings({}, food), {
      entries: Array.isArray(food.entries) ? food.entries : [],
      savedFoods: Array.isArray(food.savedFoods) ? food.savedFoods : [],
    });
    return data;
  }

  /** The one entry point for loading saved or imported data: migrate the raw
   *  object (so migrations see exactly what the file contained), then fill in
   *  defaults for anything still missing. */
  function upgrade(raw, deps) {
    if (!isObj(raw.settings)) raw.settings = {};
    ['exercises', 'entries', 'measurements'].forEach((k) => { if (!Array.isArray(raw[k])) raw[k] = []; });
    return normalize(runMigrations(raw, deps), deps);
  }

  const api = { SCHEMA_VERSION, HOME_SECTION_DEFAULTS, MIGRATIONS, runMigrations, mergeSettings, normalize, upgrade, guessBodyRegion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitMigrations = api;
})(typeof window !== 'undefined' ? window : globalThis);
