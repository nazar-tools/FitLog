/* Fit Log backup validation.

   An imported backup is untrusted (hand-edited, corrupted, or from another
   app version), so it is checked before it touches your data: structure,
   numbers (down to every set), dates, and the links between records
   (an entry must point at an exercise that exists, and so on).

   validate() returns an error string describing the first problem, or null
   when the backup is safe to hand to the migrations. Older backups are
   allowed to be missing newer fields; migrations backfill those.

   Pure function: no DOM, no storage. */
(function (root) {
  'use strict';

  const EX_KINDS = new Set(['weight', 'reps', 'cardio', 'habit']);
  const TRACKER_KINDS = new Set(['metric', 'sleep']);
  const DIRECTIONS = new Set(['up', 'down']);
  const SEXES = new Set(['male', 'female']);
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  // Ids are written into HTML attributes (data-exercise-id="...") by the app, so an id from an
  // untrusted file may only contain characters that are inert there. The app's own ids
  // (ex_squat, meas_lx2k3a9f...) all fit. Names are escaped when shown, so they are not limited
  // here beyond a sane length.
  const SAFE_ID = /^[\w.:-]{1,80}$/;
  const MAX_NAME = 200;

  // Generous sanity ceilings: they exist to catch typos and corruption (a
  // 5,000,000 lb squat), not to second-guess a real lifter.
  const LIMITS = {
    weightLb: 3000, reps: 5000, holdSeconds: 86400, distanceMi: 1000, durationSec: 7 * 86400,
    waterMl: 20000, foodCalories: 20000, foodGrams: 5000, foodMg: 100000,
    // The same bounds the Profile form and setup wizard enforce (js/units.js), so a backup the
    // app wrote can never be refused by its own validator.
    heightCm: [50, 272], age: [1, 120],
  };

  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const numOrNull = (v) => v == null || isNum(v);
  const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
  const optRange = (v, lo, hi) => v == null || inRange(v, lo, hi);
  const badId = (v) => typeof v !== 'string' || !SAFE_ID.test(v);
  const badName = (v) => typeof v !== 'string' || v.length > MAX_NAME;

  function validDate(str, todayIso) {
    if (typeof str !== 'string' || !ISO.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
    if (str < '2000-01-01') return false;
    if (todayIso) {
      const limit = new Date(todayIso + 'T00:00:00Z'); limit.setUTCDate(limit.getUTCDate() + 2);
      if (str > limit.toISOString().slice(0, 10)) return false;
    }
    return true;
  }

  function dupId(list) {
    const seen = new Set();
    for (const item of list) { if (seen.has(item.id)) return item.id; seen.add(item.id); }
    return null;
  }

  // One logged set, checked against the kind of exercise it belongs to.
  function setError(kind, st, timed) {
    if (!isObj(st)) return 'is malformed';
    if (kind === 'weight') {
      if (!inRange(st.weight, 0.0001, LIMITS.weightLb)) return 'has an invalid weight';
      if (!Number.isInteger(st.reps) || st.reps < 1 || st.reps > LIMITS.reps) return 'has an invalid rep count';
    } else {
      const cap = timed ? LIMITS.holdSeconds : LIMITS.reps;
      if (!isNum(st.reps) || st.reps < 1 || st.reps > cap || (!timed && !Number.isInteger(st.reps))) return timed ? 'has an invalid time' : 'has an invalid rep count';
      if (!optRange(st.addedWeight, 0, LIMITS.weightLb)) return 'has an invalid added weight';
    }
    if (!optRange(st.rpe, 1, 10)) return 'has an RPE outside 1 to 10';
    return null;
  }

  function validate(parsed, ctx) {
    const { schemaVersion, macroKeys, todayIso } = ctx;
    if (!isObj(parsed)) return 'This file isn’t a Fit Log backup.';
    if (parsed.version != null && !(typeof parsed.version === 'number' && parsed.version >= 1)) return 'Unrecognized backup version.';
    if (typeof parsed.version === 'number' && parsed.version > schemaVersion) {
      return `This backup is from a newer version of Fit Log (v${parsed.version}) than this app supports (v${schemaVersion}) — update the app before importing it.`;
    }

    /* ---- exercises ---- */
    if (!Array.isArray(parsed.exercises)) return 'Missing or invalid exercise list.';
    const exById = new Map();
    for (const ex of parsed.exercises) {
      if (!isObj(ex) || badId(ex.id) || badName(ex.name)) return 'One of the exercises is malformed.';
      if (ex.kind != null && !EX_KINDS.has(ex.kind)) return `Unknown exercise type “${ex.kind}”.`;
      if (!numOrNull(ex.goal) || !numOrNull(ex.distanceGoal) || !numOrNull(ex.paceGoal)) return `"${ex.name}" has an invalid goal value.`;
      if ((ex.goal != null && ex.goal < 0) || (ex.distanceGoal != null && ex.distanceGoal < 0) || (ex.paceGoal != null && ex.paceGoal < 0)) return `"${ex.name}" has a negative goal.`;
      exById.set(ex.id, ex);
    }
    if (dupId(parsed.exercises)) return 'Two exercises share the same id.';

    /* ---- entries and every set ---- */
    if (!Array.isArray(parsed.entries)) return 'Missing or invalid entry list.';
    if (dupId(parsed.entries.filter((e) => isObj(e) && !badId(e.id)))) return 'Two logged entries share the same id.';
    for (const en of parsed.entries) {
      if (!isObj(en) || badId(en.id) || badId(en.exerciseId)) return 'One of the logged entries is malformed.';
      const ex = exById.get(en.exerciseId);
      if (!ex) return 'A logged entry belongs to an exercise that isn’t in this backup.';
      const where = `${ex.name} on ${en.date}`;
      if (!validDate(en.date, todayIso)) return 'One of the logged entries has an invalid date.';
      if (en.sets != null && !Array.isArray(en.sets)) return `${where} has an invalid sets list.`;
      const kind = ex.kind || 'weight';
      if (kind === 'weight' || kind === 'reps') {
        const timed = ex.unit === 'time';
        const sets = en.sets || [];
        for (let i = 0; i < sets.length; i++) {
          const err = setError(kind, sets[i], timed);
          if (err) return `${where}: set ${i + 1} ${err}.`;
        }
      } else if (kind === 'cardio') {
        if (!optRange(en.distance, 0, LIMITS.distanceMi)) return `${where} has an invalid distance.`;
        if (!optRange(en.duration, 0, LIMITS.durationSec)) return `${where} has an invalid duration.`;
        if (!optRange(en.rpe, 1, 10)) return `${where} has an RPE outside 1 to 10.`;
      }
    }

    /* ---- trackers and measurements ---- */
    const trackerById = new Map();
    if (parsed.trackers != null) {
      if (!Array.isArray(parsed.trackers)) return 'Invalid tracker list.';
      for (const t of parsed.trackers) {
        if (!isObj(t) || badId(t.id) || badName(t.name)) return 'One of the trackers is malformed.';
        if (t.kind != null && !TRACKER_KINDS.has(t.kind)) return `Unknown tracker type “${t.kind}”.`;
        if (t.direction != null && !DIRECTIONS.has(t.direction)) return `Tracker "${t.name}" has an invalid direction.`;
        if (!numOrNull(t.goal) || !numOrNull(t.baseline)) return `Tracker "${t.name}" has an invalid goal value.`;
        trackerById.set(t.id, t);
      }
      if (dupId(parsed.trackers)) return 'Two trackers share the same id.';
    }
    if (parsed.measurements != null) {
      if (!Array.isArray(parsed.measurements)) return 'Invalid tracker-entry list.';
      for (const m of parsed.measurements) {
        if (!isObj(m) || badId(m.id) || badId(m.trackerId)) return 'One of the tracker entries is malformed.';
        const t = trackerById.get(m.trackerId);
        // Pre-v5 backups still carry the old height/sleep trackers; migrations handle those.
        if (!t && parsed.trackers != null && (parsed.version || 0) >= 6) return 'A tracker entry belongs to a tracker that isn’t in this backup.';
        if (!validDate(m.date, todayIso)) return 'One of the tracker entries has an invalid date.';
        if (!numOrNull(m.value)) return 'One of the tracker entries has an invalid value.';
        if (t && t.kind === 'sleep') {
          if (!optRange(m.value, 0, 24)) return `A sleep entry on ${m.date} is outside 0 to 24 hours.`;
          if (m.quality != null && !(Number.isInteger(m.quality) && m.quality >= 1 && m.quality <= 5)) return `A sleep entry on ${m.date} has a quality outside 1 to 5.`;
        }
      }
      if (dupId(parsed.measurements.filter((m) => isObj(m) && !badId(m.id)))) return 'Two tracker entries share the same id.';
    }

    /* ---- water ---- */
    if (parsed.water != null) {
      if (!isObj(parsed.water) || !numOrNull(parsed.water.goalMl)) return 'Invalid water settings.';
      if (parsed.water.goalMl != null && (parsed.water.goalMl < 0 || parsed.water.goalMl > LIMITS.waterMl)) return 'The water goal is out of range.';
      if (parsed.water.cups != null) {
        if (!Array.isArray(parsed.water.cups)) return 'Invalid water cup list.';
        for (const c of parsed.water.cups) { if (!isObj(c) || badId(c.id) || !inRange(c.amountMl, 0.0001, LIMITS.waterMl)) return 'One of the water cups is malformed.'; }
      }
    }
    if (parsed.waterEntries != null) {
      if (!Array.isArray(parsed.waterEntries)) return 'Invalid water-entry list.';
      for (const w of parsed.waterEntries) {
        if (!isObj(w) || (w.id != null && badId(w.id)) || !inRange(w.amountMl, 0.0001, LIMITS.waterMl) || !validDate(w.date, todayIso)) return 'One of the water entries is malformed.';
      }
    }

    /* ---- profile ---- */
    if (parsed.profile != null) {
      if (!isObj(parsed.profile) || !numOrNull(parsed.profile.heightCm)) return 'Invalid profile data.';
      if (!optRange(parsed.profile.heightCm, ...LIMITS.heightCm)) return 'The profile height is out of range.';
      if (parsed.profile.sex != null && !SEXES.has(parsed.profile.sex)) return 'Invalid sex value in profile.';
      if (parsed.profile.age != null && !optRange(parsed.profile.age, ...LIMITS.age)) return 'Invalid age value in profile.';
    }

    /* ---- food ---- */
    const macroLimit = (k) => (k === 'calories' ? LIMITS.foodCalories : (k === 'sodium' || k === 'caffeine') ? LIMITS.foodMg : LIMITS.foodGrams);
    if (parsed.food != null) {
      if (!isObj(parsed.food)) return 'Invalid food data.';
      if (parsed.food.entries != null) {
        if (!Array.isArray(parsed.food.entries)) return 'Invalid food-entry list.';
        for (const f of parsed.food.entries) {
          if (!isObj(f) || badId(f.id)) return 'One of the food entries is malformed.';
          if (!validDate(f.date, todayIso)) return 'One of the food entries has an invalid date.';
          for (const k of macroKeys) { if (!optRange(f[k], 0, macroLimit(k))) return `A food entry on ${f.date} has an invalid ${k} value.`; }
        }
      }
      if (parsed.food.savedFoods != null) {
        if (!Array.isArray(parsed.food.savedFoods)) return 'Invalid saved-foods list.';
        for (const f of parsed.food.savedFoods) {
          if (!isObj(f) || badId(f.id) || badName(f.name)) return 'One of the saved foods is malformed.';
          for (const k of macroKeys) { if (!optRange(f[k], 0, macroLimit(k))) return `Saved food "${f.name}" has an invalid ${k} value.`; }
        }
      }
    }

    /* ---- the two settings objects every screen reads without guarding ---- */
    if (parsed.settings != null) {
      if (!isObj(parsed.settings)) return 'Invalid settings data.';
      if (parsed.settings.macroGoals != null) {
        if (!isObj(parsed.settings.macroGoals)) return 'Invalid macro-goal settings.';
        for (const [k, v] of Object.entries(parsed.settings.macroGoals)) {
          if (!isObj(v) || !numOrNull(v.goal) || (v.goal != null && v.goal < 0)) return `Invalid macro-goal setting for "${k}".`;
        }
      }
      if (parsed.settings.nutritionCalc != null && !isObj(parsed.settings.nutritionCalc)) return 'Invalid nutrition-calculator settings.';
    }
    return null;
  }

  const B = Object.freeze({ validate, validDate, LIMITS });
  root.FitBackup = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(typeof window !== 'undefined' ? window : globalThis);
