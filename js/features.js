/* Which parts of the app are switched on. These are pure functions of the
   settings object, so the on/off rules can be tested without the app.

   Turning something off only hides it. Nothing logged is changed or removed. */
(function (root) {
  'use strict';

  const liftingTracked = (s) => s.trackWorkout !== false;
  const cardioTracked = (s) => s.trackCardio !== false;
  const habitsTracked = (s) => s.trackHabits !== false;

  /** A habit, or a daily rep target: things that live in the Home checklist. */
  const isHabitLike = (ex) => ex.kind === 'habit' || (ex.section || 'goal') === 'daily';

  /** Whether an exercise is visible: habits follow Habits, cardio follows
   *  Running & cardio, everything else follows Lifting. */
  function exerciseTracked(s, ex) {
    if (ex.archived) return false;
    if (isHabitLike(ex)) return habitsTracked(s);
    if (ex.kind === 'cardio') return cardioTracked(s);
    return liftingTracked(s);
  }

  /** The four top-level areas: workout, measurements, water, food. */
  function domainTracked(s, id) {
    if (id === 'workout') return !!(s.trackWorkout || cardioTracked(s) || habitsTracked(s));
    if (id === 'measurements') return !!s.trackMeasurements;
    if (id === 'water') return !!s.trackWater;
    return !!s.trackFood;
  }

  /** With only Habits on, the Workout area is called Habits. */
  const habitsOnly = (s) => !s.trackWorkout && !cardioTracked(s) && habitsTracked(s);

  /** Home blocks default to on; a stored `false` hides one. */
  const homeSectionOn = (s, key) => !s.homeSections || s.homeSections[key] !== false;

  const api = { liftingTracked, cardioTracked, habitsTracked, isHabitLike, exerciseTracked, domainTracked, habitsOnly, homeSectionOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitFeatures = api;
})(typeof window !== 'undefined' ? window : globalThis);
