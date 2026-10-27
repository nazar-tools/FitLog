/* Calculations that depend only on the data passed in: the activity streak,
   the 7-night sleep summary and the best estimated one-rep max. Reference
   numbers (sleep bands, Epley cap) come from FitStandards, passed as `S`, so
   this file has no access to app state and can be tested on its own. */
(function (root) {
  'use strict';

  function localDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Dates with something logged in a section the user tracks.
   *  `tracked` is { workout, measurements, water, food } booleans. */
  function activityDays(data, tracked) {
    const days = new Set();
    // `workout` may be a per-entry check, so habit check-ins only count while Daily is on.
    const countEntry = typeof tracked.workout === 'function' ? tracked.workout : () => !!tracked.workout;
    data.entries.forEach((e) => { if (countEntry(e)) days.add(e.date); });
    if (tracked.measurements) data.measurements.forEach((m) => days.add(m.date));
    if (tracked.water) data.waterEntries.forEach((w) => days.add(w.date));
    if (tracked.food) data.food.entries.forEach((f) => days.add(f.date));
    return days;
  }

  /** Consecutive logged days ending today. Today may still be empty without
   *  breaking the streak; it then counts back from yesterday. */
  function computeStreak(days, todayIso) {
    let streak = 0;
    const cursor = new Date(todayIso + 'T00:00:00');
    if (!days.has(todayIso)) cursor.setDate(cursor.getDate() - 1);
    while (days.has(localDateISO(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // Monday of the week holding `iso`, as an ISO date.
  function weekStartISO(iso) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localDateISO(d);
  }

  /** Consecutive weeks (Monday to Sunday) with at least one of `dates`, ending this
   *  week. Like computeStreak, the current week may still be empty without breaking it. */
  function computeWeekStreak(dates, todayIso) {
    const weeks = new Set([...dates].map(weekStartISO));
    const cursor = new Date(weekStartISO(todayIso) + 'T00:00:00');
    if (!weeks.has(localDateISO(cursor))) cursor.setDate(cursor.getDate() - 7);
    let streak = 0;
    while (weeks.has(localDateISO(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
    return streak;
  }

  /** 'week' when entries are usually 4 or more days apart (a weekly tape measure),
   *  otherwise 'day'. Looks at the last 6 gaps; fewer than 3 entries counts as daily. */
  function loggingRhythm(dates) {
    const sorted = [...new Set(dates)].sort();
    if (sorted.length < 3) return 'day';
    const gaps = [];
    for (let i = Math.max(1, sorted.length - 6); i < sorted.length; i++) {
      gaps.push(Math.round((new Date(sorted[i] + 'T00:00:00') - new Date(sorted[i - 1] + 'T00:00:00')) / 86400000));
    }
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] >= 4 ? 'week' : 'day';
  }

  /** `list` is one tracker's measurements. Two views of the same data:
   *  `window` covers the last S.SLEEP.windowDays calendar nights and gets a
   *  category only with at least S.SLEEP.minNightsForLabel nights logged;
   *  `recent` averages the last windowDays logged nights whenever they were. */
  function sleepInsights(measurements, todayIso, S) {
    const list = measurements.filter((m) => m.value != null).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    if (!list.length) return null;
    const avg = (rows, key) => { const v = rows.filter((m) => m[key] != null); return v.length ? v.reduce((t, m) => t + m[key], 0) / v.length : null; };
    const start = new Date(todayIso + 'T00:00:00');
    start.setDate(start.getDate() - (S.SLEEP.windowDays - 1));
    const startIso = localDateISO(start);
    const nightsByDate = {};
    list.forEach((m) => { if (m.date >= startIso && m.date <= todayIso) (nightsByDate[m.date] = nightsByDate[m.date] || []).push(m); });
    const inWindow = Object.values(nightsByDate).map((rows) => rows[rows.length - 1]);
    const windowAvg = inWindow.length ? avg(inWindow, 'value') : null;
    const lastLogged = list.slice(-S.SLEEP.windowDays);
    const recentAvg = avg(lastLogged, 'value');
    return {
      window: {
        days: S.SLEEP.windowDays, nights: inWindow.length, avgHours: windowAvg, avgQuality: avg(inWindow, 'quality'),
        category: inWindow.length >= S.SLEEP.minNightsForLabel ? S.sleepCategory(windowAvg).label : null,
      },
      recent: {
        nights: lastLogged.length, avgHours: recentAvg, avgQuality: avg(lastLogged, 'quality'),
        category: S.sleepCategory(recentAvg).label, since: lastLogged[0].date,
      },
    };
  }

  /** Best estimated 1RM over one exercise's entries, using sets of
   *  S.ONE_RM_MAX_REPS reps or fewer, with the set behind it and whether it
   *  is a real single or an Epley estimate. */
  function bestEstimatedOneRM(entries, S) {
    let best = null;
    entries.forEach((entry) => {
      (entry.sets || []).forEach((st) => {
        const est = S.estimateOneRM(st.weight, st.reps);
        if (!est) return;
        if (!best || est.value > best.oneRM) best = { oneRM: est.value, weight: st.weight, reps: st.reps, method: est.method };
      });
    });
    return best;
  }

  /** Most reps in one set done at body weight (sets with added weight are left to
   *  bestAddedOneRM), with that set. Null when none. */
  function bestReps(entries) {
    let best = null;
    entries.forEach((entry) => {
      (entry.sets || []).forEach((st) => {
        if (!(st.reps >= 1) || st.addedWeight > 0) return;
        if (!best || st.reps > best.reps) best = { reps: st.reps };
      });
    });
    return best;
  }

  /** Best estimated 1RM of the weight added to the body, over sets of 1 to
   *  S.ONE_RM_MAX_REPS reps with added weight. The whole load (body weight + added)
   *  goes through Epley, then the body weight is taken off again. Null without a
   *  body weight or a weighted set. */
  function bestAddedOneRM(entries, bodyweightLb, S) {
    if (!(bodyweightLb > 0)) return null;
    let best = null;
    entries.forEach((entry) => {
      (entry.sets || []).forEach((st) => {
        if (!(st.addedWeight > 0)) return;
        const est = S.estimateOneRM(bodyweightLb + st.addedWeight, st.reps);
        if (!est) return;
        const added = est.value - bodyweightLb;
        if (!best || added > best.added) best = { added, addedWeight: st.addedWeight, reps: st.reps, method: est.method };
      });
    });
    return best;
  }

  /** An exercise's strength level against Strength Level's tables (S.STRENGTH).
   *  `key` names the standard, `entries` are the exercise's entries, `who` is
   *  { sex, bodyweightLb }. Returns { missing: 'sex' | 'bodyweight' } when the
   *  tables cannot be read yet, null when there is no such standard, otherwise
   *  the standard's label and `results`: one per way of measuring it ('1rm'
   *  estimated one-rep max, 'reps' best set at body weight, 'added' one-rep max of
   *  the weight added to the body), each with its value, the five thresholds and
   *  the tier reached (0 = Untrained .. 5 = Elite). `best` is the index of the
   *  result with the highest tier, or -1 when nothing is logged yet. */
  function strengthLevel(key, entries, who, S) {
    const std = S.STRENGTH[key];
    if (!std) return null;
    if (!(who.sex === 'male' || who.sex === 'female')) return { missing: 'sex' };
    if (!(who.bodyweightLb > 0)) return { missing: 'bodyweight' };
    const results = [];
    const add = (mode, found, value, detail) => {
      const thresholds = S.strengthThresholds(key, who.sex, who.bodyweightLb, mode === 'added' ? 'added' : undefined);
      if (!thresholds) return;
      results.push({ mode, value: found ? value : null, detail: found ? detail : null, thresholds, tier: found ? S.tierIndex(value, thresholds) : 0 });
    };
    if (std.metric === '1rm') {
      const b = bestEstimatedOneRM(entries, S);
      add('1rm', !!b, b && b.oneRM, b);
    } else {
      const r = bestReps(entries);
      add('reps', !!r, r && r.reps, r);
      if (std.added) {
        const a = bestAddedOneRM(entries, who.bodyweightLb, S);
        add('added', !!a, a && a.added, a);
      }
    }
    let best = -1;
    results.forEach((r, i) => { if (r.value != null && (best < 0 || r.tier > results[best].tier)) best = i; });
    return { key, label: std.label, group: std.group, load: std.load, metric: std.metric, results, best };
  }

  const api = { localDateISO, activityDays, computeStreak, computeWeekStreak, loggingRhythm, sleepInsights, bestEstimatedOneRM, bestReps, bestAddedOneRM, strengthLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
