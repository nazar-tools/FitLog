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
    if (tracked.workout) data.entries.forEach((e) => days.add(e.date));
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

  const api = { localDateISO, activityDays, computeStreak, sleepInsights, bestEstimatedOneRM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
