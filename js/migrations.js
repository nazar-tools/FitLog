/* Fit Log data migrations.

   All app data is one JSON object saved under one key. SCHEMA_VERSION says what
   shape that object has. To change the shape:

     1. Bump SCHEMA_VERSION by exactly 1.
     2. Add a function to MIGRATIONS keyed by the old version (key 15 upgrades
        a v15 save to v16).
     3. Prefer adding fields with safe defaults. Do not delete, rename or
        repurpose a field an older version wrote. Restructuring is allowed only
        when the migration keeps the information (v4 keeps every Height reading
        in profile.heightHistory; v5 merges the two sleep trackers without
        dropping a reading), and a test with a saved file should prove it.

   load() and the backup import both call upgrade(), so a backup from any older
   version imports cleanly. A new install starts at the latest shape and skips
   this. */
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

  // Upper or lower body, guessed from the name: the starting pick for a new weight exercise
  // and the backfill for `bodyRegion`. It only sizes the suggested weight jump, so a keyword
  // match is good enough.
  function guessBodyRegion(name) {
    const n = (name || '').toLowerCase();
    return LOWER_BODY_KEYWORDS.some((k) => n.includes(k)) ? 'lower' : 'upper';
  }

  const MIGRATIONS = {
    // v1 -> v2: `section` ('goal' | 'daily' | 'accessory') on every exercise and
    // `bodyRegion` ('upper' | 'lower') on weighted lifts.
    1: (data, deps) => {
      data.exercises.forEach((ex) => {
        if (!ex.section) ex.section = LEGACY_DAILY_IDS.has(ex.id) ? 'daily' : 'goal';
        if (ex.kind === 'weight' && !ex.bodyRegion) ex.bodyRegion = guessBodyRegion(ex.name);
      });
      return data;
    },
    // v2 -> v3: cardio's single goal (goalMetric + goal) becomes two optional goals,
    // distanceGoal and paceGoal, so one run counts toward both. The old fields stay; nothing
    // reads them any more.
    2: (data, deps) => {
      data.exercises.forEach((ex) => {
        if (ex.kind !== 'cardio') return;
        if (ex.distanceGoal === undefined) ex.distanceGoal = (ex.goalMetric !== 'pace' && ex.goal) ? ex.goal : null;
        if (ex.paceGoal === undefined) ex.paceGoal = (ex.goalMetric === 'pace' && ex.goal) ? ex.goal : null;
      });
      return data;
    },
    // v3 -> v4: body trackers (trackers, measurements), water (water, waterEntries) and two
    // unit settings. An existing save gets the same starter trackers and cups as a new
    // install, so the new screens are not empty.
    3: (data, deps) => {
      if (!Array.isArray(data.trackers)) data.trackers = deps.defaultTrackers();
      if (!Array.isArray(data.measurements)) data.measurements = [];
      if (!data.water) data.water = deps.defaultWater();
      if (!Array.isArray(data.waterEntries)) data.waterEntries = [];
      if (!data.settings.lengthUnit) data.settings.lengthUnit = 'in';
      if (!data.settings.volumeUnit) data.settings.volumeUnit = 'flOz';
      return data;
    },
    // v4 -> v5: `profile` (height and sex), plus settings for the chart range and the
    // insight calculators. Height stops being a tracker: its latest reading becomes
    // profile.heightCm and every reading is kept in profile.heightHistory.
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
    // v5 -> v6: the Sleep Hours and Sleep Feeling trackers become one `kind: 'sleep'`
    // tracker (trk_sleep) whose entries hold the hours as `value` and a 1-5 `quality`.
    // Readings pair up by date in the order they were logged. One without a partner keeps
    // the other field null, and the notes from both are kept.
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
    // v6 -> v7: progress toward a tracker goal is measured from a `baseline` instead of
    // current/goal (200 lb aiming for 180, now at 195, is 25% there, not 92%). A tracker
    // with a goal starts from its earliest reading; one with no goal or no readings gets null.
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
    // v7 -> v8: weight goals get `goalMode` ('fixed' | 'standard') and `goalTier`, so a
    // bodyweight-standard goal can still be changed later. Existing goals become 'fixed',
    // which is how they always behaved. Also starts the Food area (`food`,
    // settings.trackedMacros).
    7: (data, deps) => {
      data.exercises.forEach((ex) => {
        if (ex.kind !== 'weight') return;
        if (ex.goalMode === undefined) ex.goalMode = 'fixed';
        if (ex.goalTier === undefined) ex.goalTier = null;
      });
      if (!data.food || !Array.isArray(data.food.entries)) data.food = { entries: (data.food && data.food.entries) || [] };
      if (!data.settings.trackedMacros) data.settings.trackedMacros = { calories: true, protein: true, carbs: false, fat: false };
      // Body Fat % is no longer a starter tracker. One that was never logged is hidden from
      // Home with the same flag Manage uses; the tracker itself stays.
      const bodyfat = (data.trackers || []).find((t) => t.id === 'trk_bodyfat');
      if (bodyfat && bodyfat.showOnDashboard === undefined) {
        const hasData = (data.measurements || []).some((m) => m.trackerId === 'trk_bodyfat');
        if (!hasData) bodyfat.showOnDashboard = false;
      }
      return data;
    },
    // v8 -> v9: (1) the three starter lifts get their `liftType`. The v4 -> v5 step set it
    // to null on every weight exercise, so Strength Level could never match them. It can be
    // set back to None in Manage. (2) Food moves from trackedMacros to macroGoals, one daily
    // goal per macro, all off. trackedMacros stays but nothing reads it.
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
    // v9 -> v10: sugar, sodium and caffeine join the food fields. An entry only stores what
    // was logged, so no entry changes; macroGoals gets a key for each.
    9: (data, deps) => {
      if (!data.settings.macroGoals) data.settings.macroGoals = {};
      ['sugar', 'sodium', 'caffeine'].forEach((k) => {
        if (!data.settings.macroGoals[k]) data.settings.macroGoals[k] = { enabled: false, goal: null };
      });
      return data;
    },
    // v10 -> v11: settings.showSleepInsights (off), profile.age (null; only the nutrition
    // calculator uses it) and settings.nutritionCalc (off). The calculator writes into the
    // existing macroGoals.calories and .protein rather than keeping goals of its own.
    10: (data, deps) => {
      // `profile` comes from MIGRATIONS[4], which a save that started at v5 or later never
      // ran, so an old or hand-made save can get here without one.
      if (!data.profile) data.profile = { heightCm: null, sex: null };
      if (data.settings.showSleepInsights === undefined) data.settings.showSleepInsights = false;
      if (data.profile.age === undefined) data.profile.age = null;
      if (!data.settings.nutritionCalc) {
        data.settings.nutritionCalc = { enabled: false, activityLevel: 'moderate', goal: 'maintain' };
      }
      return data;
    },
    // v11 -> v12: a macro's `enabled` now means "tracked" rather than "has a goal".
    // Calories is always tracked, so its flag still means "has a goal". Protein, carbs and
    // fat are switched on; sugar, sodium and caffeine only where an entry already has a
    // value. Also adds food.savedFoods (empty), settings.trackFood (on) and
    // settings.showMacroGuidance (off).
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
    // v12 -> v13: Water and Food leave the old Nutrition tab, and Workout, Body and Water get
    // the on/off switch Food already had (trackWorkout, trackMeasurements, trackWater), all on.
    12: (data, deps) => {
      if (data.settings.trackWorkout === undefined) data.settings.trackWorkout = true;
      if (data.settings.trackMeasurements === undefined) data.settings.trackMeasurements = true;
      if (data.settings.trackWater === undefined) data.settings.trackWater = true;
      return data;
    },
    // v13 -> v14: settings.trackHabits (on), so habits and daily reps get a switch of their
    // own, and settings.catalogPacksSeen, the starter packs already offered. The catalog's
    // fields on an exercise (catalogId, equipment) are only written when it is used.
    13: (data, deps) => {
      if (!data.settings) data.settings = {};
      if (data.settings.trackHabits === undefined) data.settings.trackHabits = true;
      if (!Array.isArray(data.settings.catalogPacksSeen)) data.settings.catalogPacksSeen = [];
      return data;
    },
    // v14 -> v15: settings.trackCardio. It starts equal to trackWorkout, since cardio used to
    // follow that switch.
    14: (data, deps) => {
      if (!data.settings) data.settings = {};
      if (data.settings.trackCardio === undefined) data.settings.trackCardio = data.settings.trackWorkout !== false;
      return data;
    },
    // v15 -> v16: settings.homeSections, which blocks Home shows. All start on.
    15: (data, deps) => {
      if (!data.settings) data.settings = {};
      const cur = data.settings.homeSections;
      data.settings.homeSections = Object.assign({}, HOME_SECTION_DEFAULTS, cur && typeof cur === 'object' ? cur : {});
      return data;
    },
    // Next migration goes here, keyed `16: (data, deps) => { ...; return data; }`.
  };

  // Walks `data` forward through MIGRATIONS until it reaches SCHEMA_VERSION. `deps` holds
  // the app's starter data: { defaultTrackers, defaultWater }.
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

  // Copies `saved` over a fresh copy of `defaults`, level by level, so a partial object
  // (macroGoals with only calories) keeps the defaults it leaves out. Skips prototype keys
  // and never shares an object with `defaults`.
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

  // Afterwards every top-level section exists, so a hand-edited or partial backup cannot
  // crash the app. `deps` = { defaultSettings, defaultProfile, defaultTrackers, defaultWater,
  // defaultFood }.
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

  // The way in for saved and imported data: migrate the raw object exactly as the file had
  // it, then fill in defaults for anything still missing.
  function upgrade(raw, deps) {
    if (!isObj(raw.settings)) raw.settings = {};
    ['exercises', 'entries', 'measurements'].forEach((k) => { if (!Array.isArray(raw[k])) raw[k] = []; });
    return normalize(runMigrations(raw, deps), deps);
  }

  const api = { SCHEMA_VERSION, HOME_SECTION_DEFAULTS, MIGRATIONS, runMigrations, mergeSettings, normalize, upgrade, guessBodyRegion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitMigrations = api;
})(typeof window !== 'undefined' ? window : globalThis);
