/* ============================================================================
   FIT LOG — app.js
   ============================================================================
   A plain HTML/CSS/JavaScript app — no build step, no framework, no
   third-party libraries. Every screen is one page (index.html) whose content
   is swapped out by this file; "screens" are <section> elements shown and
   hidden here rather than separate pages. All application data lives in the
   browser's localStorage on-device — nothing is ever sent over the network.

   The file is organized top-to-bottom as one list of sections, each marked
   with a banner comment like the one below. An editor's "find" (Ctrl+F /
   Cmd+F) on a section's name is the fastest way to jump to it — line numbers
   are omitted here since they drift as the file changes. Reading order, and
   what each section is responsible for:

     SCHEMA VERSION & MIGRATIONS  – the data shape, and the safe way to
                                     change it later without losing anyone's
                                     history. Read this before editing
                                     anything that touches saved data.
     Defaults                     – what a brand-new install starts with
                                     (the seeded exercises and their goals).
     Store                        – load()/save(): the only two functions
                                     that touch localStorage directly. See
                                     showRecoveryScreen() (near Init) for
                                     what happens when load() can't make
                                     sense of an existing save file.
     Unit helpers                 – lb<->kg and mi<->km conversions, plus
                                     every number-formatting function
                                     (fmtWeight, fmtDistance, fmtPace, ...).
     Derived data                 – reading state.exercises/state.entries to
                                     answer questions like "what's the best
                                     set ever logged for this exercise?"
     Progressive-overload
       suggestion engine          – the "Next session" recommendation logic.
     Body & wellness trackers     – generic "log a number against an
                                     optional goal" trackers (weight, sleep,
                                     and anything a user adds) — the
                                     scalable metric-tracking building
                                     block. Sleep is the one composite
                                     tracker (hours + a quality rating per
                                     entry, `kind: 'sleep'`). Height lives
                                     in Settings' Profile instead — it isn't
                                     something that trends over time, so
                                     it's a one-time fact, not a tracker.
                                     Progress is measured against a captured
                                     `baseline`, not a plain current/goal
                                     ratio — see trackerProgressPct(). Each
                                     tracker also has a showOnDashboard flag
                                     so the dashboard doesn't have to show
                                     every tracker that exists — Body Fat %
                                     isn't pre-seeded (most people can't
                                     measure it without equipment); it's
                                     only ever added manually now.
     Insights & standards         – optional, off-by-default calculators
                                     (BMI, body-weight trend, strength-vs-
                                     bodyweight level, running-pace level)
                                     built on researched reference tables,
                                     plus computeStandardGoal()/
                                     standardGoalPreviewRows() — the shared
                                     bodyweight-standard-goal math used by
                                     both the setup wizard and Manage ->
                                     Exercises' goal-style toggle. Read the
                                     comment at the top of this section for
                                     sourcing and caveats before changing
                                     any threshold.
     Water                        – daily water intake: cups, totals,
                                     progress toward the daily goal.
     Food / nutrition             – a fourth, independent top-level data
                                     area (`state.food`): optional calories/
                                     protein/carbs/fat per entry, daily
                                     totals, and a per-macro Manage -> Food
                                     toggle for which fields the Log form
                                     asks for. Deliberately separate from
                                     exercises/trackers/water — see the
                                     comment at the top of this section.
     Theme                        – light/dark/system, and applying it to
                                     the page.
     Toast                        – the small "Entry saved" popup.
     Modal                        – the generic bottom-sheet popup shell
                                     that every other modal builds on top of
                                     (focus trap, Escape-to-close, and
                                     restoring focus on close all live here,
                                     once, rather than per-modal).
     Chip picker                  – a row of tap targets (sleep quality's
                                     1-5 rating) for a small set of discrete
                                     choices, in place of a number input.
     Dynamic set fields           – the weight/reps/cardio input rows shared
                                     by the Log tab and the edit-entry modal.
                                     Includes the per-set ★ "working set"
                                     toggle topSetOf() prefers when present.
     Rendering: Dashboard         – the home screen, split into "Today"
                                     (needs-attention tracker prompts, then
                                     whatever's been logged today, then
                                     Water/Food) and "Progress" (everything
                                     else — untouched-today goal cards, Body
                                     & wellness tracker cards). See the
                                     comment above renderDashboard().
     Rendering: Log tab           – quick-add for a workout set, a tracker
                                     measurement, or a cup of water.
     Rendering: History           – a month calendar with per-day colored
                                     dots (workout/water-goal-hit/body
                                     measurement) that opens a day-detail
                                     view, above the full, filterable entry
                                     list split by workout/measurement/
                                     water category.
     Entry modal                  – editing or deleting one logged entry.
     Exercise detail modal        – tapping a goal card: chart, PRs, the
                                     suggestion card, all of that exercise's
                                     entries.
     Add / edit exercise modal    – creating a new exercise or changing an
                                     existing one's name/section/goal/etc.
     Tracker detail modal         – tapping a Body & wellness card: chart
                                     and history of that tracker's entries.
     Add / edit tracker modal     – creating a new tracker or changing an
                                     existing one's name/unit/goal/etc.
     Water: cup management        – adding, editing, and deleting cup sizes.
     Manage                       – the Manage tab: exercise, tracker, and
                                     water-cup lists (add/edit/archive/
                                     delete), grouped by category.
     Settings                     – units and theme, a Profile card (height/
                                     sex — fixed facts, not trackers) and
                                     the Insights toggles, reached via the
                                     header gear icon; export/import backup.
     First-run setup wizard       – shown once, only when there's no saved
                                     data at all, instead of silently
                                     seeding the same fixed goals for
                                     everyone; builds the real starting
                                     data from what's answered.
     Tabs / global wiring         – wires up every click handler once, and
                                     switchTab()/renderAll(), which redraw
                                     the current screen after any change.
     Data recovery screen         – shown instead of the app when saved data
                                     exists but load() couldn't read it;
                                     never overwrites it without an explicit,
                                     confirmed choice.
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
       3. The default, and by far the common case: ONLY ADD new fields with
          safe defaults. Never delete, rename, or repurpose a field an
          older version wrote for no reason — that is how someone's real
          history gets silently wiped on an update. If a field truly isn't
          needed anymore, the simplest safe move is to just stop reading it
          elsewhere in the app and leave it sitting harmlessly in the saved
          data, rather than removing it here.
          Removing or restructuring old data in a migration (rather than
          just adding to it) is a deliberate exception, not the default —
          only do it when there's an explicit conversion that preserves the
          information (e.g. the v4->v5 migration below moves a Height
          tracker's latest value into profile.heightCm before deleting the
          tracker; v5->v6 merges two sleep trackers into one before
          deleting the originals), and it has a test with a saved fixture
          proving nothing is lost. "Never delete a field" is the rule for
          the common case of adding something new; it was never a promise
          that a schema can't evolve its shape when there's a real reason.

     load() (below) walks any saved file forward through every migration it
     hasn't been through yet, oldest first, until it reaches SCHEMA_VERSION.
     A brand-new install has no saved file at all, so it starts directly at
     the latest shape via defaultData() and skips this process entirely.
     This is also why exporting a backup (Settings -> Export) and importing
     it later always works even after the app has changed in between: the
     import path runs the exact same migrations.
     ========================================================================== */

  const SCHEMA_VERSION = 12;

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
    // v3 -> v4: introduced body/wellness trackers (`trackers` +
    // `measurements`) and water tracking (`water` + `waterEntries`) as
    // brand-new top-level fields, alongside two new unit settings. All
    // purely additive — nothing about exercises or workout entries changes.
    // A pre-existing save gets the same starter trackers/cups a fresh
    // install seeds (see defaultTrackers()/defaultWater()), rather than
    // empty lists, so upgrading actually surfaces the new features.
    3: (data) => {
      if (!Array.isArray(data.trackers)) data.trackers = defaultTrackers();
      if (!Array.isArray(data.measurements)) data.measurements = [];
      if (!data.water) data.water = defaultWater();
      if (!Array.isArray(data.waterEntries)) data.waterEntries = [];
      if (!data.settings.lengthUnit) data.settings.lengthUnit = 'in';
      if (!data.settings.volumeUnit) data.settings.volumeUnit = 'flOz';
      return data;
    },
    // v4 -> v5: added a `profile` (height + sex — fixed facts about you,
    // not something with a trend worth charting) and settings for the
    // dashboard chart's default range and the optional insight calculators
    // (body-weight trend/BMI, strength-vs-bodyweight, pace level).
    //
    // Height specifically moves OUT of the trackers list here: it doesn't
    // change often enough to need a logged history, so any existing Height
    // tracker's most recent value is carried over into profile.heightCm —
    // nothing is lost, it just becomes a single current fact instead of a
    // trend — and the tracker (and its now-redundant measurement history)
    // is removed. Every other tracker, and everything about exercises,
    // entries, and water, is untouched.
    4: (data) => {
      if (!data.profile) data.profile = { heightCm: null, sex: null };
      const heightTracker = (data.trackers || []).find((t) => t.id === 'trk_height');
      if (heightTracker) {
        const heightEntries = (data.measurements || [])
          .filter((m) => m.trackerId === heightTracker.id)
          .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
        if (heightEntries.length && data.profile.heightCm == null) {
          data.profile.heightCm = heightEntries[heightEntries.length - 1].value;
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
    // carry both an hours `value` and a 1-5 `quality` on the same entry —
    // see the "Body & wellness trackers" section for how `kind` branches.
    //
    // Merging is best-effort and date-based (the normal case is one sleep
    // log per night): for each date either tracker has an entry on, take
    // the LATEST entry per tracker per date (highest id) and pair them —
    // an hours-only or quality-only date still gets a merged entry with
    // the other field left null, so nothing is dropped either way.
    5: (data) => {
      const hoursTracker = (data.trackers || []).find((t) => t.id === 'trk_sleephours');
      const feelTracker = (data.trackers || []).find((t) => t.id === 'trk_sleepfeel');
      if (hoursTracker || feelTracker) {
        const lastPerDate = (trackerId) => {
          const map = new Map();
          (data.measurements || [])
            .filter((m) => m.trackerId === trackerId)
            .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id))
            .forEach((m) => map.set(m.date, m));
          return map;
        };
        const hoursByDate = hoursTracker ? lastPerDate(hoursTracker.id) : new Map();
        const feelByDate = feelTracker ? lastPerDate(feelTracker.id) : new Map();
        const dates = new Set([...hoursByDate.keys(), ...feelByDate.keys()]);
        dates.forEach((date) => {
          const h = hoursByDate.get(date);
          const f = feelByDate.get(date);
          data.measurements.push({
            id: genId('meas'), trackerId: 'trk_sleep', date,
            value: h ? h.value : null, quality: f ? f.value : null,
            note: (h && h.note) || (f && f.note) || null,
          });
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
    // the 92% that ratio gives) — see trackerProgressPct() below, which now
    // measures against a `baseline` instead. Existing trackers with a goal
    // already set have no recorded "starting point," so the best available
    // proxy — the earliest logged value — is used; a tracker with no
    // measurements yet, or no goal, gets `baseline: null` and simply falls
    // back to the old ratio until one is established (see
    // trackerProgressPct()'s own fallback).
    6: (data) => {
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
    // computed. Every existing weight exercise — including ones the setup
    // wizard originally computed from a standard — is backfilled as
    // 'fixed': there's no way to recover which ones were formula-derived
    // after the fact, and 'fixed' exactly matches how the number has
    // actually behaved until now (a static value, not recomputed as
    // bodyweight changes), so nothing about existing goals changes; the
    // user can switch any of them to 'standard' going forward.
    // (2) A brand-new, independent Food/nutrition area (`food` +
    // `settings.trackedMacros`) — see the "Food / nutrition" section below.
    // It touches nothing about exercises, entries, trackers, measurements,
    // water, or waterEntries.
    7: (data) => {
      data.exercises.forEach((ex) => {
        if (ex.kind !== 'weight') return;
        if (ex.goalMode === undefined) ex.goalMode = 'fixed';
        if (ex.goalTier === undefined) ex.goalTier = null;
      });
      if (!data.food || !Array.isArray(data.food.entries)) data.food = { entries: (data.food && data.food.entries) || [] };
      if (!data.settings.trackedMacros) data.settings.trackedMacros = { calories: true, protein: true, carbs: false, fat: false };
      // Body Fat % used to be pre-seeded on every install (see
      // defaultTrackers()) even though most people have no way to measure
      // it without calipers or a smart scale — it's no longer seeded for
      // new installs, and an existing one that was never actually logged
      // (a sign it was just clutter, not something the user chose to use)
      // gets quietly hidden from the dashboard the same reversible way
      // Manage's own "hide from dashboard" toggle works. The tracker and
      // any real history it does have are left completely alone either
      // way — this only ever flips a display flag, never deletes anything.
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
    // default — which means an install that predates that migration has
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
    // is) — seeded fully off, matching how a water/tracker goal starts
    // unset until deliberately given one. `trackedMacros` is left in place
    // per the migration policy above rather than deleted; nothing reads it
    // anymore.
    8: (data) => {
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
    // v9 -> v10: purely additive — three new optional food fields (sugar,
    // sodium, caffeine) alongside the original four macros, added the same
    // way the four macros work rather than as a separate feature (see the
    // "Food / nutrition" section for the reasoning). Every existing food
    // entry already omits fields it has no value for (they're only ever
    // set when logged), so no entry needs touching — a food entry from
    // before this migration simply has no sugar/sodium/caffeine value yet,
    // same as it would if those fields just hadn't been logged. The only
    // real backfill needed is `settings.macroGoals`, which — like every
    // other settings object here — only had keys for the fields that
    // existed when it was created.
    9: (data) => {
      ['sugar', 'sodium', 'caffeine'].forEach((k) => {
        if (!data.settings.macroGoals[k]) data.settings.macroGoals[k] = { enabled: false, goal: null };
      });
      return data;
    },
    // v10 -> v11: three purely additive changes for this round's new
    // features. (1) `showSleepInsights` — off by default, same as every
    // other optional insight toggle — gates the trailing-nights sleep
    // average/category shown on the Sleep tracker card and in its detail
    // modal (see sleepInsights()). (2) `profile.age` — a new one-time fact
    // alongside height/sex, needed only by the nutrition calculator's
    // Mifflin-St Jeor calorie estimate (see computeNutritionTargets()); null
    // until set, same treatment as height/sex before this. (3)
    // `settings.nutritionCalc` — the activity-level/goal picker for that
    // same calculator, off by default; turning it on computes and applies
    // calorie/protein numbers into the *existing* `macroGoals.calories`/
    // `.protein` fields rather than introducing a parallel goal-storage
    // shape, the same way a lift's "Bodyweight standard" goal mode still
    // writes into the exercise's ordinary `goal` field.
    10: (data) => {
      // A save file that started migrating from before v4 (see MIGRATIONS[4]
      // above, which is the step that normally creates `profile`) but whose
      // *starting* version was already >= 4 never runs that step at all —
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
    // Calories, which is always tracked regardless (see macroTracked) —
    // its `enabled` still only ever means "has a goal," so migrating it
    // needs no change. Protein/Carbs/Fat are forced on so nobody who never
    // bothered to set a goal for them suddenly loses a field they were
    // already using; Sugar/Sodium/Caffeine are forced on only where an
    // existing entry actually has a value for them, so a field genuinely
    // never used stays off (the declutter this was for) while one that IS
    // used stays visible. (2) `food.savedFoods` — the new Saved Foods list,
    // starts empty. (3) `settings.trackFood`/`showMacroGuidance` — new
    // toggles, both additive with safe defaults (Food stays on for
    // existing installs; guidance starts off like every other insight).
    11: (data) => {
      const usedExtraKeys = new Set();
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
    // Next migration goes here, keyed `12: (data) => { ...; return data; }`.
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

  // Starter body/wellness trackers — just Weight and Sleep. Both are things
  // a regular person can and does check with no special equipment, so
  // they're pre-seeded and shown on the dashboard unasked. Body Fat % is
  // deliberately NOT seeded here: it needs calipers, a smart scale, or a
  // DEXA scan to measure meaningfully, so silently putting it on everyone's
  // Goals page — never having asked whether they can even track it — did
  // more to clutter the dashboard than to help. It's still fully supported;
  // anyone who does want it adds it themselves from Manage -> Body -> Add
  // tracker (name it anything, `unitKind: 'percent'`), same as any other
  // custom metric.
  // Weight is the plain "log a number, optionally against a goal" shape
  // (`kind: 'metric'`). Sleep is the one composite tracker: one entry per
  // night carries both hours (`value`, this tracker's normal unitKind) and
  // a 1-5 quality rating (`quality`) — `kind: 'sleep'` is what tells the
  // shared rendering/logging code to show and read that second field; see
  // the "Body & wellness trackers" section below for where `kind` branches.
  // A future kind beyond these two (e.g. a yes/no daily habit checklist) is
  // a new `kind` value and a new branch, not a data-shape change for
  // existing trackers.
  function defaultTrackers() {
    const now = new Date().toISOString();
    return [
      { id: 'trk_weight', name: 'Weight', kind: 'metric', unitKind: 'weight', goal: null, baseline: null, direction: null, archived: false, createdAt: now },
      { id: 'trk_sleep', name: 'Sleep', kind: 'sleep', unitKind: 'hours', goal: null, baseline: null, direction: null, archived: false, createdAt: now },
    ];
  }

  // A fixed fact about you rather than something with a history worth
  // charting — height doesn't change often enough to be a tracker (see the
  // v4->v5 migration above for how an existing Height tracker becomes
  // this). All three fields are optional and used only by the insight
  // calculators below (BMI, strength-vs-bodyweight, pace level) and the
  // nutrition calculator (age, alongside height/sex, feeds its Mifflin-St
  // Jeor calorie estimate) — the app works fully without any of them set.
  function defaultProfile() {
    return { heightCm: null, sex: null, age: null };
  }

  // Water's starter cup sizes and daily goal, canonically in milliliters
  // (see the Unit helpers section for why a canonical/display split exists
  // at all) — editable and replaceable from Manage, never read for anything
  // but seeding a fresh install or an upgrade that never had water data.
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
    // Dashboard/detail chart default range, and the optional insight
    // calculators (see the "Insights & standards" section) — all off by
    // default, since they're extras layered on top of the core tracking,
    // not something to spring on an existing install unasked.
    chartScale: 'last10', insightsWindowDays: 90,
    showWeightInsights: false, showStrengthLevel: false, showPaceLevel: false,
    // Sleep is logged per-night rather than persisting like weight, so its
    // dashboard card always resets to "not logged" for a fresh day (see
    // trackerCardHtml()) regardless of this toggle — this only gates the
    // separate, optional trailing-nights average/category insight
    // (sleepInsights()), same off-by-default treatment as every other one.
    showSleepInsights: false,
    // Daily-value guidance card (Fat/Sugar/Sodium/etc. vs. published FDA
    // reference values) in the Food detail modal — off by default, same
    // off-by-default treatment as every other insight above.
    showMacroGuidance: false,
    // Whether Food is tracked at all — the setup wizard's Food interest
    // tile writes this; a Settings toggle re-enables it later, since Food
    // has no per-item unarchive the way a tracker does. Gates the
    // dashboard's Food section and the Food sub-tab in Log/History/Manage.
    trackFood: true,
    // Each macro's `enabled` flag now does double duty: whether the field
    // is tracked at all (shown in the log form / today's totals), and
    // whether it additionally has a daily GOAL set. Calories has no
    // visibility toggle (always tracked, see renderFoodManagePanel) so its
    // `enabled` here only ever means "has a goal," same as before.
    // Protein/Carbs/Fat start tracked (the four macros this app has always
    // shown); Sugar/Sodium/Caffeine start off — opt in from Manage ->
    // Nutrition -> Food. Managed from Manage -> Food.
    macroGoals: {
      calories: { enabled: false, goal: null }, protein: { enabled: true, goal: null },
      carbs: { enabled: true, goal: null }, fat: { enabled: true, goal: null },
      sugar: { enabled: false, goal: null }, sodium: { enabled: false, goal: null }, caffeine: { enabled: false, goal: null },
    },
    // The nutrition calculator (Manage -> Nutrition -> Food): off by
    // default. Turning it on computes calories/protein from activityLevel +
    // goal (Mifflin-St Jeor + an activity multiplier + a goal adjustment —
    // see computeNutritionTargets()) and writes the result into
    // macroGoals.calories/.protein above, rather than storing its own
    // separate goal numbers — so those two fields work exactly like every
    // other macro goal (same dashboard display, same manual override if the
    // calculator is turned back off) once applied.
    nutritionCalc: { enabled: false, activityLevel: 'moderate', goal: 'maintain' },
  };

  // A brand-new install's starting Food state — always empty; there's no
  // meaningful "starter" food entry the way there are starter exercises.
  function defaultFood() {
    return { entries: [], savedFoods: [] };
  }

  // The starting data for a brand-new install — already in the current
  // schema shape, so it never has to pass through the migrations above.
  function defaultData() {
    const now = new Date().toISOString();
    return {
      version: SCHEMA_VERSION,
      settings: Object.assign({}, DEFAULT_SETTINGS),
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
     load()/save() are the ONLY two functions that touch localStorage
     directly. Everything else in the app reads and writes the in-memory
     `state` object and calls save() when it's done — that keeps "how data
     gets to disk" in one place. */

  let state = null;
  // True only for a genuinely first-ever run (see load() below) — init()
  // checks this to show the setup wizard instead of the normal dashboard.
  let needsSetup = false;
  // True when saved data exists but couldn't be read (see load()'s catch
  // below) — init() shows a recovery screen instead of guessing at
  // defaults. `rawCorrupt` keeps the original, untouched bytes so the
  // recovery screen can hand them back rather than losing them.
  let needsRecovery = false;
  let rawCorrupt = null;

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // Truly first run. `state` gets an inert skeleton so the rest of
        // the app has something safe to read, but it's deliberately NOT
        // saved yet — finishSetup() (see "First-run setup wizard" below)
        // builds and saves the real starting data once answered, so
        // closing mid-wizard leaves nothing partial behind to reopen into.
        state = defaultData();
        needsSetup = true;
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.exercises) || !Array.isArray(parsed.entries)) throw new Error('bad shape');
      parsed.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
      state = runMigrations(parsed);
      save(); // persist the migrated shape once, so this doesn't re-run every load
    } catch (e) {
      // A real saved payload exists but couldn't be parsed or migrated —
      // this is NOT the same as "no data," and must not be treated like
      // it. There is no server-side copy of this data, so overwriting
      // localStorage here on what might be a bug in this code (rather
      // than a genuinely unrecoverable file) could destroy real history.
      // Leave localStorage exactly as it was and let the recovery screen
      // (see showRecoveryScreen()) offer an explicit, informed choice.
      console.warn('Could not read saved data — leaving it untouched.', e);
      rawCorrupt = raw || null;
      needsRecovery = true;
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
  const CM_PER_IN = 2.54;
  const ML_PER_FLOZ = 29.5735295625;

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

    // Body-measurement lengths (height, waist, bicep, ...) canonically in
    // centimeters — a separate unit from running distance (miles/km above)
    // since inches/cm and miles/km are different scales for different things.
    cmToDisplay: (cm) => (state.settings.lengthUnit === 'cm' ? cm : cm / CM_PER_IN),
    displayToCm: (v) => (state.settings.lengthUnit === 'cm' ? v : v * CM_PER_IN),
    lengthUnitLabel: () => state.settings.lengthUnit,

    // Water volume canonically in milliliters.
    mlToDisplay: (ml) => (state.settings.volumeUnit === 'mL' ? ml : ml / ML_PER_FLOZ),
    displayToMl: (v) => (state.settings.volumeUnit === 'mL' ? v : v * ML_PER_FLOZ),
    volumeUnitLabel: () => (state.settings.volumeUnit === 'mL' ? 'mL' : 'fl oz'),
  };

  function round(v, dp) {
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  // Splits a canonical height in cm into whole feet + inches for display —
  // nobody knows their height as a single number of inches, so Profile's
  // imperial height field is feet-and-inches (see the Settings section
  // below), never the plain "in" a length tracker like Waist uses.
  function cmToFtIn(cm) {
    const totalIn = cm / CM_PER_IN;
    const ft = Math.floor(totalIn / 12);
    return { ft, inch: round(totalIn - ft * 12, 1) };
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
  function fmtLength(cm) {
    if (cm == null || Number.isNaN(cm)) return '—';
    const v = Units.cmToDisplay(cm);
    return `${round(v, 1)} ${Units.lengthUnitLabel()}`;
  }
  function fmtVolume(ml) {
    if (ml == null || Number.isNaN(ml)) return '—';
    const v = Units.mlToDisplay(ml);
    return `${round(v, v < 10 ? 1 : 0)} ${Units.volumeUnitLabel()}`;
  }
  function fmtDuration(totalSec) {
    if (totalSec == null || Number.isNaN(totalSec)) return '—';
    const s = Math.round(totalSec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }

  // A calendar day is a YYYY-MM-DD label, not a timestamp — reading it back
  // off a Date's local getters (never .toISOString(), which reports UTC and
  // silently shifts the date by a day in any timezone ahead of UTC) is what
  // keeps "today," streaks, and trend windows agreeing with the calendar on
  // the wall rather than the calendar in Greenwich.
  function localDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function todayISO() {
    return localDateISO(new Date());
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
  const SECTION_LABELS = { goal: 'Goals', daily: 'Daily targets', accessory: 'Other exercises' };

  // The single best/most-recent set of an entry, used both for trend values
  // and for the progressive-overload suggestion (which needs reps/RPE too,
  // not just the scalar entryValue()).
  function topSetOf(exercise, entry) {
    if (exercise.kind === 'weight') {
      const valid = (entry.sets || []).filter((s) => s.reps > 0 && s.weight != null);
      if (!valid.length) return null;
      // A set starred as the working set (see the log form's ★ toggle) is
      // the intended basis for a suggestion even if a heavier warm-up or
      // test single was also logged in the same entry; fall back to
      // "heaviest logged" only when nothing was starred.
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
       2) A simple two-session trend fallback when no RPE is logged: matching
          or beating the prior rep count at the same weight across two
          sessions in a row signals it's time to add load. This is NOT the
          NSCA's "2-for-2 rule" (which tracks exceeding a target rep RANGE
          by ~2 reps across two sessions — this app doesn't model rep-range
          targets) — it's labeled plainly below rather than claiming that
          more specific rule's name.
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
    sametrend: 'Based on your last two sessions at this weight.',
    trend: 'Based on your last two sessions.',
  };

  // Returns an ARRAY of suggestions: always one element for a weight/reps
  // exercise, but one element PER configured goal metric for cardio — a
  // cardio exercise with both a distance and a pace goal gets two
  // suggestions, each tagged with `metric`, computed from the same pair of
  // logged entries (one run informs both).
  function suggestNextTarget(exercise) {
    // Daily-section exercises (push-ups, crunches, etc.) are open-ended "stay
    // active" targets, not a progressive-overload lift or a cardio goal —
    // there's no "next session" to size, so no suggestion card at all.
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

  /* ============================== Body & wellness trackers ==============================
     A tracker is a user-defined "log a number, optionally against a goal"
     metric — the same generic shape covers body weight, body-fat %, a
     circumference, sleep hours, a mood rating, or anything else added later
     (calories, a supplement dose, ...) with zero new code, just a new
     tracker instance. One canonical value per unitKind keeps the lb/kg-style
     display-vs-storage split (see Unit helpers) working the same way it
     does for exercises. */

  function activeTrackers() { return state.trackers.filter((t) => !t.archived); }
  function trackerById(id) { return state.trackers.find((t) => t.id === id); }
  function measurementsFor(trackerId) { return state.measurements.filter((m) => m.trackerId === trackerId); }

  // The most recently logged value. A tracker reflects current state
  // (today's weight, last night's sleep) rather than a lifetime best like an
  // exercise PR, so "latest" — not "highest/lowest ever" — is the right
  // notion of "current" here.
  function latestMeasurement(trackerId) {
    const list = measurementsFor(trackerId).slice().sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    return list.length ? list[list.length - 1] : null;
  }

  // tracker.unitLabel is free-text the user (or an imported backup) typed
  // in — this return value is interpolated straight into innerHTML in
  // several places (dashboard/tracker cards, chart tooltips), so it's
  // escaped right here rather than trusting every call site to remember to.
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

  // The Sleep tracker's second field (see `kind: 'sleep'` above) — a plain
  // 1-5 rating, optional, clamped and rounded rather than trusting raw
  // input straight from a number field.
  function clampQuality(raw) {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : Math.max(1, Math.min(5, Math.round(n)));
  }
  function fmtQuality(q) { return q == null ? null : `${q}/5`; }

  // Percent of the way from `tracker.baseline` (the value when this goal
  // was set — see the v6->v7 migration and the baseline-capture points in
  // openTrackerForm()/handleLogMeasurementSubmit()/finishSetup()) to
  // `tracker.goal`. This is deliberately NOT a plain current/goal ratio:
  // for a body metric moving toward a target from somewhere else — weight
  // 200 -> goal 180, currently 195 — current/goal math reports 92% (180/195)
  // when only 25% of the actual 20lb has been lost. Measuring against where
  // you started instead of against zero is what makes the percentage mean
  // "progress" rather than "proximity."
  // Falls back to the old direct ratio when there's no usable baseline yet
  // (a brand-new tracker with a goal but no logged history) so a goal still
  // shows *something* meaningful before any progress exists to measure.
  function trackerProgressPct(tracker, value) {
    if (value == null || tracker.goal == null) return { pct: 0, achieved: false };
    const goal = tracker.goal;
    const achieved = tracker.direction === 'down' ? value <= goal : value >= goal;
    const baseline = tracker.baseline;
    if (baseline == null || baseline === goal) {
      const pct = tracker.direction === 'down'
        ? (value <= 0 ? 0 : (goal / value) * 100)
        : (value / goal) * 100;
      return { pct: Math.max(0, pct), achieved };
    }
    const pct = ((baseline - value) / (baseline - goal)) * 100;
    return { pct: Math.max(0, pct), achieved };
  }

  // A plain-language alternative to the percentage above for a tracker with
  // a known baseline — "12 lb down · 8 lb remaining" reads unambiguously
  // where "80%" can still be misread as "80% of my original weight" for a
  // body metric. Returns null when there's no baseline to measure a delta
  // from yet, or nothing left to describe (goal already reached).
  function trackerProgressDeltaText(tracker, value) {
    if (value == null || tracker.goal == null || tracker.baseline == null) return null;
    const moved = Math.abs(tracker.baseline - value);
    const remaining = Math.abs(tracker.goal - value);
    if (remaining <= 0) return null;
    const dir = tracker.direction === 'down' ? 'down' : 'up';
    return `${fmtTrackerValue(tracker, moved)} ${dir} · ${fmtTrackerValue(tracker, remaining)} remaining`;
  }

  // Converts a tracker's canonical value (weight in lb, length in cm, ...)
  // to/from the number an <input> should show, per its unitKind — the one
  // place logging/edit forms need to know which unit a tracker's raw value
  // is stored in. Every other unitKind is stored and displayed as the same
  // plain number (percent, hours, a rating, a free-unit count).
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
  // Same escaping rationale as fmtTrackerValue() above — this also lands in
  // innerHTML (the log/edit measurement forms' field labels).
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
     Optional, off-by-default calculators layered on top of the core
     tracking — turned on in Settings ("Insights"), one toggle per kind.
     Each one needs a fact from `state.profile` (height and/or sex) that
     the app never requires elsewhere; if it's missing, the calculator
     says so instead of guessing.

     The benchmark numbers below are general published reference points,
     not a personalized or medical assessment — presented with that
     caveat in the UI, the same way the progressive-overload suggestion
     engine caveats its own heuristics.
       - BMI categories: CDC adult BMI guidance.
       - Bodyweight-ratio strength standards (bench/squat/deadlift, by
         sex): commonly published community strength-standard tables
         (e.g. the kind of chart on Strength Level / Denstar Fitness).
       - Pace levels: a general recreational-runner pace heuristic
         built from typical age-graded training-pace ranges — looser
         and less authoritative than the lift standards, since there is
         no single widely-agreed pace-tier chart the way there is for
         barbell lifts. */

  const INSIGHT_TIER_LABELS = ['Untrained', 'Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];

  // Bodyweight-multiplier thresholds for [Beginner, Novice, Intermediate,
  // Advanced, Elite] — a lift meeting a threshold is classified at that
  // tier or higher, and below the "Beginner" threshold is "Untrained".
  const LIFT_STANDARDS = {
    bench: { label: 'Bench Press', male: [0.5, 0.75, 1.2, 1.6, 2.0], female: [0.3, 0.5, 0.85, 1.15, 1.5] },
    squat: { label: 'Squat', male: [0.75, 1.0, 1.65, 2.2, 2.75], female: [0.5, 0.75, 1.25, 1.75, 2.25] },
    deadlift: { label: 'Deadlift', male: [1.0, 1.25, 2.0, 2.5, 3.0], female: [0.65, 0.95, 1.5, 2.0, 2.5] },
  };
  const LIFT_TYPE_LABELS = { bench: 'Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

  // Fixed "plates" goals — a barbell loaded to 2/3/4 plates a side (plus the
  // 45lb bar) for bench/squat/deadlift respectively — offered in the setup
  // wizard as the plain alternative to a bodyweight-standard goal below, and
  // also what a brand-new install's defaultData() seeds (see below).
  const PLATE_GOALS = { bench: 225, squat: 315, deadlift: 405 };
  // Which LIFT_STANDARDS threshold index a wizard tier name maps to —
  // [Beginner, Novice, Intermediate, Advanced, Elite] — Beginner/Novice are
  // omitted from the wizard itself since they're a trivially low bar for
  // something being set as a goal, not just a classification.
  const TIER_TO_INDEX = { intermediate: 2, advanced: 3, elite: 4 };
  // Every LIFT_STANDARDS threshold, in table order — used to build the
  // full Beginner..Elite preview shown alongside tier selection (in both
  // the setup wizard and Manage -> Exercises), separately from
  // TIER_TO_INDEX above, which is only the subset actually selectable as a
  // goal.
  const ALL_TIER_KEYS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

  // The actual lb goal a bodyweight-standard tier works out to, rounded to
  // the nearest 5lb (a sane barbell increment) — the single source of
  // truth for that math, shared by the setup wizard (finishSetup) and the
  // general Manage -> Exercises goal-mode toggle (openExerciseForm) so a
  // lift's goal can be recomputed identically wherever bodyweight changes.
  function computeStandardGoal(liftType, tier, bodyweightLb, sex) {
    if (!bodyweightLb || !sex || !LIFT_STANDARDS[liftType] || TIER_TO_INDEX[tier] === undefined) return null;
    const mult = LIFT_STANDARDS[liftType][sex][TIER_TO_INDEX[tier]];
    return Math.round((bodyweightLb * mult) / 5) * 5;
  }

  // Every tier's computed goal for a given lift/bodyweight/sex — the "what
  // would each tier actually ask of me" preview requested alongside tier
  // selection. Returns null if there isn't enough info yet (no bodyweight
  // logged, or sex not set in Profile).
  function standardGoalPreviewRows(liftType, bodyweightLb, sex) {
    if (!bodyweightLb || !sex || !LIFT_STANDARDS[liftType]) return null;
    const table = LIFT_STANDARDS[liftType][sex];
    return ALL_TIER_KEYS.map((key, i) => ({
      tierKey: key,
      label: key[0].toUpperCase() + key.slice(1),
      goalLb: Math.round((bodyweightLb * table[i]) / 5) * 5,
    }));
  }

  // Recomputes every weight exercise currently set to a bodyweight-standard
  // goal (goalMode 'standard') from the CURRENT bodyweight + sex, so a
  // formula-based goal actually tracks you as you log new bodyweight
  // entries or fill in your sex — rather than freezing at whatever it
  // computed to the moment it was set. A goal with goalMode 'fixed' is
  // never touched here. Call this anywhere bodyweight or sex can change:
  // logging/editing a body-weight measurement, and the Profile sex picker.
  function recomputeStandardGoals() {
    const bw = currentBodyWeightLb();
    const sex = state.profile.sex;
    state.exercises.forEach((ex) => {
      if (ex.kind !== 'weight' || ex.goalMode !== 'standard' || !ex.liftType || !ex.goalTier) return;
      const g = computeStandardGoal(ex.liftType, ex.goalTier, bw, sex);
      if (g != null) ex.goal = g;
    });
  }

  // Pace tiers as seconds-per-mile ceilings for [Elite, Advanced, Good,
  // Recreational] — faster (lower) than the ceiling qualifies for that
  // tier; anything slower than the last one is "Building base". Order is
  // fastest-first here (opposite of the lift table) since a lower pace is
  // the "better" direction.
  const PACE_TIER_LABELS = ['Elite', 'Advanced', 'Good', 'Recreational', 'Building base'];
  const PACE_TIERS = {
    male: [390, 480, 570, 660], // 6:30, 8:00, 9:30, 11:00 per mile
    female: [450, 540, 630, 720], // 7:30, 9:00, 10:30, 12:00 per mile
  };

  function classifyAscending(value, thresholds, labels) {
    let idx = 0;
    for (let i = 0; i < thresholds.length; i++) { if (value >= thresholds[i]) idx = i + 1; }
    return labels[idx];
  }
  function classifyDescending(value, ceilings, labels) {
    for (let i = 0; i < ceilings.length; i++) { if (value <= ceilings[i]) return labels[i]; }
    return labels[labels.length - 1];
  }

  const BMI_CATEGORIES = [
    { max: 18.5, label: 'Underweight' },
    { max: 25, label: 'Healthy weight' },
    { max: 30, label: 'Overweight' },
    { max: Infinity, label: 'Obese' },
  ];
  function bmiCategory(bmi) {
    return BMI_CATEGORIES.find((c) => bmi < c.max).label;
  }
  // The CSS class (see .category-dot in styles.css) matching a BMI category
  // label — kept as an explicit map rather than derived from the label text
  // so the two can drift in wording independently (e.g. the label says
  // "Healthy weight" but the class is the more conventional "normal",
  // matching how every published BMI chart names that zone).
  const BMI_CATEGORY_CLASS = { 'Underweight': 'is-underweight', 'Healthy weight': 'is-normal', 'Overweight': 'is-overweight', 'Obese': 'is-obese' };

  // A short, humanized elapsed-time phrase ("12 days", "3 months", "1.4
  // years") for the weight-trend delta below — plain days under two weeks,
  // weeks under two months, months under ~13 months, years beyond that.
  function humanizeDays(days) {
    if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
    if (days < 60) { const w = Math.round(days / 7); return `${w} week${w === 1 ? '' : 's'}`; }
    if (days < 400) { const m = Math.round(days / 30); return `${m} month${m === 1 ? '' : 's'}`; }
    return `${round(days / 365, 1)} years`;
  }

  // The body-weight tracker is the one fixed anchor the other calculators
  // (BMI, strength ratio) read from — always this seeded id if it exists.
  // If the user deletes it, those calculators simply have nothing to
  // compare against and say so rather than guessing at a substitute.
  const BODY_WEIGHT_TRACKER_ID = 'trk_weight';
  function currentBodyWeightLb() {
    const latest = latestMeasurement(BODY_WEIGHT_TRACKER_ID);
    return latest ? latest.value : null;
  }

  // Current weight, how much it's moved over the settings-chosen window,
  // and BMI (once height is set in Profile) — the "Body weight insights"
  // toggle's payload for the Weight tracker's dashboard card.
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

  // Sleep doesn't have one persistent "current" reading worth trending the
  // way weight does (see the date-scoping comment on trackerCardHtml()) — so
  // rather than a single-value trend, this looks at the last N *logged*
  // nights (skipping gaps rather than requiring N calendar days in a row,
  // since missing a night or two shouldn't blank out the whole insight) and
  // summarizes how sleep has actually been: average hours, a plain-language
  // duration category against general sleep-duration guidance, and an
  // average quality rating across whichever of those nights had one logged.
  const SLEEP_TRACKER_ID = 'trk_sleep';
  const SLEEP_NIGHTS_WINDOW = 7;
  // General adult sleep-duration guidance (e.g. CDC/NSF: ~7-9 hours) used
  // only to label an average as short/adequate/long — not a personalized or
  // medical assessment, same disclaimer convention as BMI/strength/pace.
  const SLEEP_HOURS_CATEGORIES = [
    { max: 6, label: 'Short' },
    { max: 9, label: 'Adequate' },
    { max: Infinity, label: 'Long' },
  ];
  function sleepHoursCategory(hours) {
    return SLEEP_HOURS_CATEGORIES.find((c) => hours < c.max).label;
  }
  function sleepInsights() {
    const list = measurementsFor(SLEEP_TRACKER_ID).slice().sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    if (!list.length) return null;
    const recent = list.slice(-SLEEP_NIGHTS_WINDOW);
    const hoursLogged = recent.filter((m) => m.value != null);
    if (!hoursLogged.length) return null;
    const avgHours = hoursLogged.reduce((sum, m) => sum + m.value, 0) / hoursLogged.length;
    const qualityLogged = recent.filter((m) => m.quality != null);
    const avgQuality = qualityLogged.length ? qualityLogged.reduce((sum, m) => sum + m.quality, 0) / qualityLogged.length : null;
    return { avgHours, nights: hoursLogged.length, category: sleepHoursCategory(avgHours), avgQuality };
  }

  // How a weight-based exercise's best lift compares to current
  // bodyweight, against the researched standards above — needs the lift
  // mapped to a known type (see the exercise form's "Lift type" field) and
  // both a bodyweight entry and a sex set in Profile.
  // Epley formula: a set's estimated 1-rep max from any (weight, reps) pair.
  // Standards tables like LIFT_STANDARDS below are published as 1RM ratios,
  // so this — not the raw heaviest weight ever lifted — is the correct
  // like-for-like comparison; a 185lb x 10 set is a much bigger lift than a
  // 185lb single, and only the estimate reflects that.
  function epleyOneRM(weight, reps) {
    return reps <= 1 ? weight : weight * (1 + reps / 30);
  }

  // The single best estimated 1RM across every logged set for this
  // exercise, plus which actual (weight, reps) set produced it.
  function bestEstimatedOneRM(ex) {
    let best = null;
    entriesFor(ex.id).forEach((entry) => {
      (entry.sets || []).forEach((s) => {
        if (!(s.reps > 0) || s.weight == null) return;
        const oneRM = epleyOneRM(s.weight, s.reps);
        if (!best || oneRM > best.oneRM) best = { oneRM, weight: s.weight, reps: s.reps };
      });
    });
    return best;
  }

  function strengthLevelInfo(ex) {
    if (ex.kind !== 'weight' || !ex.liftType || !LIFT_STANDARDS[ex.liftType]) return null;
    const bw = currentBodyWeightLb();
    if (!bw) return { needsBodyWeight: true };
    if (!state.profile.sex) return { needsSex: true };
    const heaviestLoad = best(ex);
    const oneRepMax = bestEstimatedOneRM(ex);
    if (heaviestLoad == null || !oneRepMax) return null;
    const ratio = oneRepMax.oneRM / bw;
    const table = LIFT_STANDARDS[ex.liftType][state.profile.sex];
    return {
      ratio, tier: classifyAscending(ratio, table, INSIGHT_TIER_LABELS), liftLabel: LIFT_STANDARDS[ex.liftType].label,
      oneRepMax: oneRepMax.oneRM, heaviestLoad,
    };
  }

  // How a cardio exercise's best pace compares to the general recreational
  // pace tiers above — needs at least one logged pace and a sex set in
  // Profile (the tiers are only published split by sex).
  function paceLevelInfo(ex) {
    if (ex.kind !== 'cardio') return null;
    const paceBest = best(ex, 'pace');
    if (paceBest == null) return null;
    if (!state.profile.sex) return { needsSex: true };
    const ceilings = PACE_TIERS[state.profile.sex];
    return { pace: paceBest, tier: classifyDescending(paceBest, ceilings, PACE_TIER_LABELS) };
  }

  /* ============================== Water ==============================
     Water is a small, dedicated feature rather than another tracker kind —
     tap-a-cup logging is a different interaction from typing a number, so
     it earns its own simple data shape (see defaultWater()) instead of
     being forced into the generic tracker model above. */

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
     A fourth, deliberately separate top-level data area (`state.food`) —
     same rationale as Water above: this is additive, and specifically
     built to never touch `exercises`/`entries`, `trackers`/`measurements`,
     or `water`/`waterEntries`. One entry is one thing eaten OR drunk, with
     Calories plus up to six other optional numbers (any of the six may be
     left blank, since not everyone knows every value for everything they
     consume) plus an optional note, on a date.

     Calories is always tracked and always required to log an entry — see
     handleLogFoodSubmit. Every other field in MACRO_KEYS is gated by
     `state.settings.macroGoals[key].enabled` (managed from Manage ->
     Nutrition -> Food): Off means the field is fully gone — not in the log
     form, not in today's totals, not in history — not just "no goal set."
     On does double duty, the same one toggle also revealing an optional
     daily-goal amount for that field, mirroring how a water/tracker goal is
     opt-in: tracked-with-no-goal just totals for the day with no progress
     comparison; tracked-with-a-goal shows "1850 / 2600 kcal" style progress
     the same way Water shows progress toward its daily goal. Turning a
     field back on doesn't lose anything logged while it was off — old
     values for it stay in storage untouched, they just don't surface in the
     UI until it's tracked again.

     Sodium, sugar, and caffeine were added the same way as the original
     four macros — new keys in this same list, nothing structurally new —
     rather than as a separate "Drinks" feature. A drink is just a food
     entry with different numbers filled in (a latte has both calories AND
     caffeine; a black coffee has caffeine but no calories), so splitting
     "food" and "drinks" into two features would force every drink with
     calories into an awkward choice between the two, for no real benefit:
     every mainstream nutrition tracker treats caffeine as one more optional
     number on the same entry, not a separate log. */

  const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat', 'sugar', 'sodium', 'caffeine'];
  const MACRO_LABELS = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', sugar: 'Sugar', sodium: 'Sodium', caffeine: 'Caffeine' };
  // The unit each field is logged/displayed in — '' for calories (a bare
  // count, no suffix), grams for the macros and sugar, milligrams for
  // sodium and caffeine. Single source of truth for every place that needs
  // to print or label a value (fmtMacroValue, the Log form, Manage's goal
  // inputs).
  const MACRO_UNITS = { calories: '', protein: 'g', carbs: 'g', fat: 'g', sugar: 'g', sodium: 'mg', caffeine: 'mg' };
  // Realistic example values shown as input placeholders, roughly what a
  // single typical serving/meal looks like for that field.
  const MACRO_PLACEHOLDERS = { calories: '520', protein: '30', carbs: '30', fat: '15', sugar: '10', sodium: '400', caffeine: '95' };

  // FDA Nutrition Facts Daily Values for a 2,000-calorie diet — the same
  // reference figures printed on every packaged-food label in the US, used
  // by the optional "Daily value guidance" card (Settings ->
  // showMacroGuidance). Caffeine has no formal %DV; 400mg is the FDA's own
  // general consumer guidance for "how much is usually not associated with
  // dangerous effects," shown the same way but labeled as general guidance
  // rather than a DV. The published Sugar DV (50g) is specifically for
  // ADDED sugar; Fit Log logs one total-sugar number, so that comparison is
  // an upper bound, not exact — flagged wherever it's shown. Calories has
  // no fixed DV (the app's own nutrition calculator is the personalized
  // equivalent) and Carbs/Protein/Fat are the plain macronutrient DVs, not
  // per-meal targets.
  const MACRO_DV = { protein: 50, carbs: 275, fat: 78, sugar: 50, sodium: 2300, caffeine: 400 };
  // Macros where going over 100% DV is a "watch this" signal worth
  // flagging red — the public-health framing for these three is "less is
  // better," unlike Protein/Carbs/Fat, where a published DV is just a
  // reference point, not a ceiling. Only these three ever get the red
  // over-DV treatment on the dashboard card or in the guidance table.
  const MACRO_DV_OVER_FLAGS = new Set(['sugar', 'sodium', 'caffeine']);
  // Rounded %DV for one macro's value, or null if there's no DV for that
  // key or nothing logged yet — shared by the dashboard card's red
  // highlighting and the food detail modal's guidance table.
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

  // Whether a macro is tracked at all right now — shown in the log form,
  // totaled on the dashboard, offered in Manage. Calories is exempt from
  // the toggle entirely (see the section comment above) and always tracked.
  function macroTracked(key) { return key === 'calories' || macroGoalInfo(key).enabled; }

  // Every currently-tracked macro, in MACRO_KEYS order — what the log form
  // and today's totals actually render.
  function trackedMacroKeys() { return MACRO_KEYS.filter(macroTracked); }

  // Fields that currently have a daily goal turned on, in MACRO_KEYS order.
  function macroGoalKeys() {
    return MACRO_KEYS.filter((k) => macroGoalInfo(k).enabled && macroGoalInfo(k).goal != null);
  }

  // ---- Nutrition calculator (Manage -> Nutrition -> Food) ----
  // Estimates a daily calorie and protein target from Profile facts (height,
  // age, sex) plus a logged body weight, an activity level, and a goal —
  // the Food feature's counterpart to a lift's bodyweight-standard goal
  // mode. Lives here rather than under Settings -> Insights because, like
  // that goal mode, it's an ACTIVE configuration choice that writes into a
  // goal field (macroGoals.calories/.protein) once applied, not a passive
  // read-only display.
  const ACTIVITY_LEVELS = {
    sedentary:  { label: 'Sedentary',        hint: 'little or no exercise',        multiplier: 1.2 },
    light:      { label: 'Light activity',   hint: 'exercise 1-3 days/week',       multiplier: 1.375 },
    moderate:   { label: 'Moderate activity', hint: 'exercise 3-5 days/week',      multiplier: 1.55 },
    active:     { label: 'Active',           hint: 'exercise 6-7 days/week',       multiplier: 1.725 },
    veryActive: { label: 'Very active',      hint: 'physical job or 2x/day training', multiplier: 1.9 },
  };
  // Calorie adjustment from estimated maintenance (TDEE), and a protein
  // target per pound of bodyweight, both by goal — a moderate, commonly
  // published range (roughly a 1 lb/week pace for a cut or lean gain), with
  // protein set higher while cutting specifically to help protect muscle
  // mass in a deficit — a moderate, commonly published range.
  const NUTRITION_GOAL_ADJUST = {
    lose:     { calorieDelta: -500, proteinPerLb: 1.0 },
    maintain: { calorieDelta: 0,    proteinPerLb: 0.8 },
    gain:     { calorieDelta: 300,  proteinPerLb: 0.9 },
  };
  // Matches the button labels in #nutritionGoalSegmented (index.html) —
  // kept as its own map (rather than derived) so the Food detail modal can
  // name the active goal in a sentence without reaching into the DOM.
  const NUTRITION_GOAL_LABELS = { lose: 'losing weight', maintain: 'maintaining', gain: 'gaining weight' };
  // Mifflin-St Jeor equation for basal metabolic rate, times an
  // activity-level multiplier for estimated maintenance calories (TDEE),
  // then the goal-based adjustment above. Needs height, age, and sex
  // (Profile) plus a logged body weight — same prerequisites BMI and
  // Strength level already need — so this returns which fact(s) are still
  // missing rather than guessing at a substitute for any of them.
  function computeNutritionTargets(activityLevel, goal) {
    const bw = currentBodyWeightLb();
    const { heightCm, age, sex } = state.profile;
    const missing = [];
    if (!heightCm) missing.push('height');
    if (!age) missing.push('age');
    if (!sex) missing.push('sex');
    if (!bw) missing.push('a logged body weight');
    if (missing.length) return { missing };
    const kg = bw * LB_PER_KG;
    const bmr = sex === 'male'
      ? 10 * kg + 6.25 * heightCm - 5 * age + 5
      : 10 * kg + 6.25 * heightCm - 5 * age - 161;
    const tdee = bmr * ACTIVITY_LEVELS[activityLevel].multiplier;
    const adjust = NUTRITION_GOAL_ADJUST[goal];
    // Calories are floored well below any deficit that would be unsafe to
    // sustain, regardless of how the math above works out for someone
    // small/low-activity — 1200 is a commonly published general floor.
    const calories = Math.max(1200, Math.round(tdee + adjust.calorieDelta));
    const protein = Math.round(bw * adjust.proteinPerLb);
    return { calories, protein, tdee: Math.round(tdee) };
  }

  // The explicit "Apply to daily goals" action (see the Nutrition
  // calculator's card in renderFoodManagePanel()) — writes the computed
  // numbers into the same macroGoals.calories/.protein fields a manual goal
  // uses, turning both on in the process. Deliberately only ever called
  // from that one button tap, never automatically from a settings change —
  // see the comment on saveProfileBtn's handler for why an auto-recompute
  // binding would be the wrong call here (it would silently clobber a value
  // the user set some other way since the calculator was last applied).
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

  // One day's totals, per field — null (not 0) for one nothing was logged
  // for that day, so the dashboard/history can show "—" instead of a
  // misleading zero.
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

  // A short "520 cal, 40g protein" style summary for one entry or one
  // day's totals — used by both the entry row and the history date header.
  // Only currently-tracked macros are included, same as the log form and
  // today's totals — a macro turned off is fully gone from history too,
  // not just new logging (see the "Food / nutrition" section).
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

  // Keep these two in sync with --page's light/dark values in
  // css/styles.css, and with the two <meta name="theme-color" media="...">
  // tags in index.html below.
  const PAGE_COLOR_LIGHT = '#f9f9f7';
  const PAGE_COLOR_DARK = '#0d0d0d';

  // The OS status bar / nav bar tint comes from <meta name="theme-color">,
  // read by the browser/OS chrome rather than CSS, so it can't reference a
  // CSS custom property directly — and, on Android especially, mutating a
  // single such tag's `content` in place is not reliably repainted live by
  // the system-UI compositor (this is what caused "switching light/dark on
  // my phone doesn't update the top and bottom [bars]" — a device that
  // happened to launch already in the OS's current theme never needed a
  // live repaint, so it looked fine there). index.html instead ships TWO
  // theme-color tags, each gated by its own `media="(prefers-color-scheme:
  // ...)"`, so the OS/browser can pick the right one itself from a live
  // media-query match with no JS involved — the standard, more reliable
  // fix for this exact class of bug.
  //
  // Those two tags are only left alone here while Settings -> Appearance is
  // "System" — the whole point of the dual-tag approach is to let the OS
  // drive it without JS in that case. When Appearance explicitly overrides
  // the system default (Light or Dark), only ONE tag can be "correct" and
  // we can't know for certain which one this device's browser is actually
  // honoring, so both are forced to the same resolved color; switching back
  // to "System" restores each tag's own natural color so the declarative
  // behavior resumes.
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
  let modalLastFocusedEl = null;

  function focusableEls(container) {
    return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  }

  // Escape closes; Tab/Shift+Tab cycle within the sheet instead of escaping
  // to the (hidden-behind-the-backdrop, but still technically tabbable)
  // page underneath.
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

  // `tall: true` is for the handful of modals that are really full detail
  // screens (exercise/tracker/food detail) rather than a quick action or
  // form — see the `.is-detail-sheet` comment in styles.css for why a
  // fixed height instead of the usual shrink-to-content matters there.
  function openModal(html, { tall = false } = {}) {
    const sheet = modalSheet();
    sheet.style.transform = '';
    sheet.classList.remove('is-dragging');
    sheet.classList.toggle('is-detail-sheet', tall);
    sheet.innerHTML = `<div class="modal-handle"></div>${html}`;
    // A dialog needs an accessible name; every modal here starts with an
    // <h2> title, so point at it rather than requiring each call site to
    // wire this up itself.
    const heading = sheet.querySelector('h2');
    if (heading) { heading.id = 'modalTitle'; sheet.setAttribute('aria-labelledby', 'modalTitle'); }
    else sheet.removeAttribute('aria-labelledby');
    modalLastFocusedEl = document.activeElement;
    modalRoot().hidden = false;
    wireModalSwipeToClose(sheet);
    document.addEventListener('keydown', handleModalKeydown);
    // Land focus on the first real control past the ✕ (so a form's first
    // field is ready to type into), falling back to the ✕ itself, or the
    // sheet, if that's all there is. This runs before any call-site wiring
    // (e.g. wireOpenable on a suggestion card) has added tabindex to
    // anything, so on a read-heavy detail modal (exercise/tracker detail)
    // "first control" in practice often isn't visually first at all — it's
    // whatever plain <button> happens to appear earliest in the raw HTML,
    // which on those modals is the chart's Last-10/All-time toggle, well
    // below the title/progress/insight cards a person actually opened the
    // modal to see. Focusing an off-screen element auto-scrolls it into
    // view, so without the explicit reset below, the modal would silently
    // open scrolled past its own top content on every single open.
    const focusables = focusableEls(sheet);
    const target = focusables.find((el) => el.dataset.action !== 'close-modal') || focusables[0];
    if (target) target.focus();
    else { sheet.tabIndex = -1; sheet.focus(); }
    sheet.scrollTop = 0;
  }
  function closeModal() {
    modalRoot().hidden = true;
    modalSheet().innerHTML = '';
    document.removeEventListener('keydown', handleModalKeydown);
    if (modalLastFocusedEl && document.body.contains(modalLastFocusedEl)) modalLastFocusedEl.focus();
    modalLastFocusedEl = null;
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
     A small discrete-choice input (sleep quality's 1-5 rating, currently) —
     a row of tap targets reads faster and is easier to hit on a phone than
     a number field for a value that only ever takes a few known options.
     The container's data-value is the single source of truth (empty string
     = nothing picked, since a rating is optional); tapping the already-
     selected chip clears it rather than requiring a separate "clear" UI. */
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
  // Makes a clickable card/row div behave like a real control for keyboard
  // and assistive-tech users — a div click handler alone gives it neither
  // focusability nor Enter/Space activation.
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================== Dynamic set fields (shared by Log tab + edit modal) ============================== */

  // Column labels (Weight/Reps/RPE, or Reps/Added wt/RPE) only ever render
  // visibly above the FIRST set row in the list — repeating "Weight (lb)" /
  // "Reps" / "RPE" above every single set in a multi-set entry added nothing
  // (the columns never change row to row) and pushed the actual inputs
  // further down the longer the list got. Every row still carries the same
  // markup regardless of its position (see the CSS rule for
  // `.set-row:not(:first-child) .field-label`, which visually hides it via
  // the standard clip-based sr-only technique rather than a JS-computed
  // per-row class) so a screen reader still hears "Weight, Reps, RPE" for
  // each row, and removing/reordering rows never leaves a stale hidden
  // label behind the way baking the decision into a fixed index at creation
  // time would have.
  function setRowHtml(kind, idx, set) {
    set = set || {};
    if (kind === 'weight') {
      const w = set.weight != null ? round(Units.lbToDisplay(set.weight), 2) : '';
      return `
        <div class="set-row set-row-3" data-set-idx="${idx}" data-primary="${set.primary ? '1' : '0'}">
          <label class="field"><span class="field-label">Weight (${Units.weightUnitLabel()})</span>
            <input type="number" step="any" inputmode="decimal" class="set-weight" value="${w}" placeholder="0" /></label>
          <label class="field"><span class="field-label">Reps</span>
            <input type="number" step="1" min="1" inputmode="numeric" class="set-reps" value="${set.reps ?? ''}" placeholder="0" /></label>
          <label class="field"><span class="field-label">RPE</span>
            <input type="number" step="0.5" min="1" max="10" inputmode="decimal" class="set-rpe" value="${set.rpe ?? ''}" placeholder="opt." /></label>
          <button type="button" class="set-row-star ${set.primary ? 'is-active' : ''}" data-action="toggle-primary" aria-label="Mark as working set" title="Mark as working set (used for suggestions)">★</button>
          <button type="button" class="set-row-remove" data-action="remove-set" aria-label="Remove set">${CLOSE_ICON_SVG}</button>
        </div>`;
    }
    // reps kind (bodyweight)
    const aw = set.addedWeight ? round(Units.lbToDisplay(set.addedWeight), 2) : '';
    return `
      <div class="set-row set-row-3" data-set-idx="${idx}">
        <label class="field"><span class="field-label">Reps</span>
          <input type="number" step="1" min="1" inputmode="numeric" class="set-reps" value="${set.reps ?? ''}" placeholder="0" /></label>
        <label class="field"><span class="field-label">Added wt (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" inputmode="decimal" class="set-addedweight" value="${aw}" placeholder="opt." /></label>
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
      wireSetPrimaryButtons(container);
    });
    wireSetRemoveButtons(container);
    wireSetPrimaryButtons(container);
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

  // Only one set per entry can be "the" working set — starring one clears
  // the others in the same form, since topSetOf() needs a single answer.
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
        const hasW = !Number.isNaN(w);
        const hasR = !Number.isNaN(r);
        if (!hasW && !hasR) continue; // fully blank row — not a set, just ignore it
        // A set is weight AND reps together or it isn't a set at all — filling
        // in the missing side with 0 would silently write a fake 0lb or 0-rep
        // set into history, so a half-filled row is rejected instead.
        if (!hasW || !hasR) return { error: 'Each set needs both a weight and reps — fill in the missing value, or clear the row.' };
        sets.push({ weight: Units.displayToLb(w), reps: r, primary: row.dataset.primary === '1' || undefined, rpe: Number.isNaN(rpe) ? null : rpe });
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
    while (days.has(localDateISO(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // Dropped the old "Goals reached" tally tile — whether a goal is hit is
  // already visible on that goal's own dashboard card (its meter fills and
  // reads "✓ Goal reached"), so a third summary number just duplicated
  // that instead of adding anything. The two tiles that remain lean into
  // what they actually are: a currently-burning streak (a flame, lit only
  // while the streak is alive) and a pattern of the last 7 days (a small
  // heat strip alongside the raw count), rather than three plain numbers
  // in equal boxes.
  function renderSummary() {
    const days = new Set(state.entries.map((e) => e.date));
    const today = new Date(todayISO() + 'T00:00:00');
    const weekDots = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      weekDots.push(days.has(localDateISO(d)));
    }
    const sessionsThisWeek = weekDots.filter(Boolean).length;
    const streak = computeStreak();

    document.getElementById('summaryRow').innerHTML = `
      <div class="stat-tile">
        <div class="value">${sessionsThisWeek}</div>
        <div class="label">Days logged this week</div>
        <div class="heat-strip">${weekDots.map((on) => `<span class="heat-day${on ? ' on' : ''}"></span>`).join('')}</div>
      </div>
      <div class="stat-tile${streak > 0 ? ' is-streak-hot' : ''}">
        <div class="value">${streak > 0 ? FLAME_ICON_SVG : ''}<span>${streak}</span></div>
        <div class="label">Day streak</div>
      </div>
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

  // Slices `items` (already date-sorted ascending) down to the range the
  // "Dashboard chart range" setting calls for, then maps each to a
  // {date, value} chart point, dropping any with no value. Shared by every
  // dashboard card and by the exercise/tracker detail modals' own chart
  // (via renderExerciseDetail/renderTrackerDetail's own `scale` argument),
  // so the one setting controls what "the chart" means everywhere.
  function chartPointsFor(items, valueFn) {
    const scaled = state.settings.chartScale === 'last10' ? items.slice(-10) : items;
    return scaled.map((item) => ({ date: item.date, value: valueFn(item) })).filter((p) => p.value != null);
  }

  // A compact "which tier am I in" bar shared by the Strength level (lift
  // bodyweight-multiple tiers) and Pace level (running pace tiers) detail
  // sections below — same visual language, different units. `abbrevLabels`
  // are short enough (4-5 chars) to fit as their own segment in a 5-6
  // column row; the full tier names plus their concrete unit thresholds go
  // in the wrapped caption underneath instead, where there's room for them.
  function tierBarHtml(abbrevLabels, currentAbbrev, captionText) {
    return `
      <div class="tier-bar">${abbrevLabels.map((l) => `<div class="tier-seg ${l === currentAbbrev ? 'is-current' : ''}">${l}</div>`).join('')}</div>
      ${captionText ? `<div class="tier-bar-caption muted-text">${captionText}</div>` : ''}`;
  }

  // The full "Strength level" detail block — moved here from the dashboard
  // goal card (which now only shows a plain progress meter, no insight
  // math) into the exercise detail modal instead. Renders as the same
  // `.standards-preview` table used for BMI and the bodyweight-standard
  // goal picker (Manage -> Exercises) rather than a bespoke tier bar, so
  // "which tier am I in" reads the same way everywhere in the app — each
  // row spelling out both the multiplier and the weight it works out to
  // at the current bodyweight (e.g. "0.75x BW - 135 lb+"), current tier
  // highlighted via `.is-selected`.
  function strengthStandardsDetailHtml(ex) {
    const info = strengthLevelInfo(ex);
    if (!info) return '';
    if (info.needsBodyWeight) return `<div class="card"><div class="section-head"><h2>Strength level</h2></div><p class="muted-text">Log your body weight to see your strength level.</p></div>`;
    if (info.needsSex) return `<div class="card"><div class="section-head"><h2>Strength level</h2></div><p class="muted-text">Set your sex in Settings → Profile to see your strength level.</p></div>`;
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
        <div class="section-head"><h2>Strength level</h2></div>
        <div class="insight-line">Est. 1RM ${fmtWeight(info.oneRepMax)} &middot; ${round(info.ratio, 2)}&times; bodyweight &middot; <strong>${info.tier}</strong></div>
        <div class="insight-line muted-text">Heaviest logged: ${fmtWeight(info.heaviestLoad)}</div>
        <div class="standards-preview">
          ${rows.map((r) => `<div class="standards-preview-row${r.isCurrent ? ' is-selected' : ''}"><span>${r.label}</span><span>${r.rightText}</span></div>`).join('')}
        </div>
        <p class="muted-text field-hint">Est. 1RM via the Epley formula, classified against published bodyweight-multiple strength standards for your sex.</p>
      </div>`;
  }

  // The "Pace level" counterpart — same `.standards-preview` table pattern,
  // one row per published tier showing its pace-per-mile ceiling.
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

  // BMI's detail-on-demand card — the Weight tracker's counterpart to
  // strengthStandardsDetailHtml()/paceStandardsDetailHtml() above, opened by
  // tapping into the tracker detail modal rather than shown on the dashboard
  // card (see the comment in trackerCardHtml()). Same `.standards-preview`
  // table component the bodyweight-standard goal picker uses (Manage ->
  // Exercises), one row per category with a colored dot and its range,
  // current one highlighted via `.is-selected` — rather than a bespoke
  // gauge, so this reads as the same visual language as the rest of the
  // app's "which tier/category am I in" displays instead of a one-off.
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
        <p class="muted-text field-hint">From your logged weight and height. Doesn't account for muscle mass or body composition.</p>
      </div>`;
  }

  // Sleep's detail-on-demand card — the trailing-window average/category
  // this segment's dashboard badge summarizes in one line, spelled out with
  // the same tier-bar visual language as Strength/Pace level (against the
  // general short/adequate/long guidance in SLEEP_HOURS_CATEGORIES) plus an
  // average-quality line when any of those nights had a quality logged.
  const SLEEP_HOURS_ABBREV = ['Short', 'OK', 'Good'];
  function sleepInsightDetailHtml() {
    const insights = sleepInsights();
    if (!insights) {
      return `<div class="card"><div class="section-head"><h2>Sleep insights</h2></div><p class="muted-text">Log a night's sleep to see your trend.</p></div>`;
    }
    const currentAbbrev = SLEEP_HOURS_ABBREV[SLEEP_HOURS_CATEGORIES.findIndex((c) => c.label === insights.category)];
    const caption = SLEEP_HOURS_CATEGORIES
      .map((c, i) => c.max === Infinity ? `${c.label} &ge; 9h` : `${c.label} ${i === 0 ? '&lt;' : `${SLEEP_HOURS_CATEGORIES[i - 1].max}–`}${c.max}h`)
      .join(' &middot; ');
    return `
      <div class="card">
        <div class="section-head"><h2>Sleep insights</h2></div>
        <div class="insight-line">Avg ${round(insights.avgHours, 1)}h over last ${insights.nights} logged night${insights.nights === 1 ? '' : 's'} &middot; <strong>${insights.category}</strong></div>
        ${insights.avgQuality != null ? `<div class="insight-line muted-text">Avg quality ${fmtQuality(round(insights.avgQuality, 1))}</div>` : ''}
        ${tierBarHtml(SLEEP_HOURS_ABBREV, currentAbbrev, caption)}
        <p class="muted-text field-hint">Against general adult sleep guidance (~7-9 hours).</p>
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
    // Strength/Pace level — the estimated-1RM/tier math and the "which
    // published tier am I in" breakdown — used to render right here on the
    // dashboard card. It's now detail-on-demand instead: tap into the card
    // (openExerciseDetail) for strengthStandardsDetailHtml()/
    // paceStandardsDetailHtml(), keeping this card to a plain progress
    // meter + chart regardless of whether either Insights toggle is on.
    return `
      <div class="card ex-card" data-exercise-id="${ex.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${escapeHtml(ex.name)}</div>
          <div class="ex-card-badge">${kindBadge(ex)}</div>
        </div>
        ${progressHtml}
        ${chartPoints.length >= 2 ? `<div class="ex-card-chart">${Charts.lineChart(chartPoints, { goal: chartGoal, width: 300, height: 96, formatValue: (v) => formatValueForExercise(ex, v, trendMetric) })}</div>` : ''}
      </div>`;
  }

  // A "Daily target" exercise (push-ups, pull-ups, crunches — whatever
  // you're aiming to do every day) gets a compact, low-emphasis row
  // instead of a full goal card. Unlike a goal card, this row is only ever
  // rendered for a day it's actually been logged (see renderDashboard) —
  // it's a same-day confirmation of what you did, not a standing reminder
  // that clutters the dashboard on days you haven't gotten to it — so
  // "today" rather than "lifetime" is the number front and center here.
  function dailyRowHtml(ex) {
    const entries = entriesFor(ex.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const todayEntries = entries.filter((e) => e.date === todayISO());
    const lifetimeTotal = entries.reduce((sum, e) => sum + (e.sets || []).reduce((m, s) => m + (s.reps || 0), 0), 0);
    // Cardio exercises are rare as a daily target (it's meant for WFH
    // bodyweight work), but if one lands here it still needs a sane
    // fallback rather than assuming reps-shaped data.
    if (ex.kind === 'cardio') {
      const metrics = cardioMetricsOf(ex);
      const metric = metrics[0];
      const todayVal = todayEntries.length ? Math.max(...todayEntries.map((e) => entryValue(ex, e, metric)).filter((v) => v != null)) : null;
      return `
        <div class="daily-row" data-exercise-id="${ex.id}">
          <div class="daily-row-main">
            <div class="daily-row-name">${escapeHtml(ex.name)}</div>
            <div class="daily-row-sub">Logged today · ${entries.length} session${entries.length === 1 ? '' : 's'} lifetime</div>
          </div>
          ${metric && todayVal != null ? `<div class="daily-row-goal">${formatValueForExercise(ex, todayVal, metric)}</div>` : ''}
        </div>`;
    }
    const todayTotal = todayEntries.reduce((sum, e) => sum + (e.sets || []).reduce((m, s) => m + (s.reps || 0), 0), 0);
    return `
      <div class="daily-row" data-exercise-id="${ex.id}">
        <div class="daily-row-main">
          <div class="daily-row-name">${escapeHtml(ex.name)}</div>
          <div class="daily-row-sub">${lifetimeTotal.toLocaleString()} lifetime reps</div>
        </div>
        <div class="daily-row-goal">${todayTotal}${ex.goal ? `<span class="muted-text">/${Math.round(ex.goal)}</span>` : ''}</div>
      </div>`;
  }

  // Whether a trend delta is "good news" for this tracker, per its own
  // direction setting (the same field that already drives its goal-progress
  // math) — a shrinking number is good when direction is 'down' (e.g. a
  // weight-loss goal), growing is good otherwise. With no direction set,
  // there's no way to know intent, so the delta badge stays neutral.
  function deltaSentiment(tracker, delta) {
    if (!tracker.direction || delta === 0) return 'neutral';
    return (tracker.direction === 'down' ? delta < 0 : delta > 0) ? 'good' : 'bad';
  }

  // A body/wellness tracker's dashboard card — deliberately the same visual
  // shape as an exercise's goalCardHtml (current value, goal, meter, chart)
  // so the dashboard reads as one consistent language rather than
  // "workouts styled one way, everything else styled another." The body
  // weight tracker additionally carries the optional "Body weight
  // insights" toggle's payload: a trend-delta badge and a BMI line.
  function trackerCardHtml(tracker) {
    const isSleep = tracker.kind === 'sleep';
    // Weight (and any other plain metric tracker) reflects a persistent
    // current state — showing the most recently logged value as "current"
    // until it's replaced is exactly right, the same way a bathroom scale
    // app assumes yesterday's weigh-in is still roughly your weight today.
    // Sleep is a per-night reading, not a persistent state, so that same
    // "keep showing the latest ever logged" behavior reads as broken for it
    // specifically: log 8 hours last night, and the card would keep saying
    // "8 hours" indefinitely until the next time sleep is logged, even
    // several days later. Scoping sleep's headline value to *today's*
    // entry only (falling back to "—", the same way a never-logged tracker
    // already renders) fixes that — the trend below (sleepInsights()) still
    // looks across all recent nights regardless of whether today has one.
    const todayEntry = isSleep ? state.measurements.find((m) => m.trackerId === tracker.id && m.date === todayISO()) : null;
    const latest = isSleep ? todayEntry : latestMeasurement(tracker.id);
    const value = latest ? latest.value : null;
    const { pct, achieved } = trackerProgressPct(tracker, value);
    const fillPct = Math.min(100, pct);
    const history = measurementsFor(tracker.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const chartPoints = chartPointsFor(history, (m) => m.value);
    const insights = (tracker.id === BODY_WEIGHT_TRACKER_ID && state.settings.showWeightInsights) ? weightInsights() : null;
    const deltaBadge = insights && insights.trend
      ? `<div class="ex-card-delta is-${deltaSentiment(tracker, insights.trend.delta)}">${insights.trend.delta > 0 ? '+' : ''}${round(insights.trend.delta, 1)} ${Units.weightUnitLabel()} in ${humanizeDays(insights.trend.days)}</div>`
      : '';
    // BMI itself moved off this card into the tracker detail modal's own
    // visual gauge (see bmiDetailHtml()) — same "keep the dashboard plain,
    // put the deeper breakdown one tap in" move already made for a lift's
    // Strength level. A concise sleep average (also detail-on-demand for
    // the fuller breakdown — see sleepInsightDetailHtml()) takes its old
    // badge slot instead, next to the tracker name like weight's trend.
    const sleep = (isSleep && state.settings.showSleepInsights) ? sleepInsights() : null;
    const sleepBadge = sleep ? `<div class="ex-card-delta">Avg ${round(sleep.avgHours, 1)}h &middot; ${sleep.nights}n</div>` : '';
    const qualityLine = isSleep && latest && latest.quality != null
      ? `<div class="insight-line">Quality ${fmtQuality(latest.quality)}</div>` : '';
    return `
      <div class="card ex-card" data-tracker-id="${tracker.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${escapeHtml(tracker.name)}</div>
          ${deltaBadge}${sleepBadge}
        </div>
        <div class="ex-card-values">
          <div class="ex-card-current">${fmtTrackerValue(tracker, value)}</div>
          ${tracker.goal != null ? `<div class="ex-card-goal">/ ${trackerGoalLabel(tracker).replace('Goal ', '')}</div>` : ''}
        </div>
        ${tracker.goal != null ? `
          <div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${fillPct}%"></div></div>
          <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}%`}</span></div>
          ${!achieved && trackerProgressDeltaText(tracker, value) ? `<div class="insight-line muted-text">${trackerProgressDeltaText(tracker, value)}</div>` : ''}` : ''}
        ${chartPoints.length >= 2 ? `<div class="ex-card-chart">${Charts.lineChart(chartPoints, { goal: tracker.goal, width: 300, height: 96, formatValue: (v) => fmtTrackerValue(tracker, v) })}</div>` : ''}
        ${qualityLine}
      </div>`;
  }

  function renderBodySection() {
    // Manage still lists every tracker regardless of this — hiding one from
    // the dashboard only declutters the daily view, it doesn't archive it.
    const trackers = activeTrackers().filter((t) => t.showOnDashboard !== false);
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
        <span class="cup-btn-name-row">${WATER_DROP_ICON_SVG}<span>${escapeHtml(cup.name)}</span></span>
        <span class="cup-btn-amount">${fmtVolume(cup.amountMl)}</span>
      </button>`).join('');
  }

  // Logging water is a one-tap action (pick a cup, done) rather than a form
  // submission, so it lives directly on the dashboard as well as in Log —
  // wherever the user already is when they want to record a drink.
  function logWaterAmount(amountMl, cupId) {
    if (!amountMl || amountMl <= 0) { toast('Enter an amount greater than zero.'); return; }
    state.waterEntries.push({ id: genId('wtr'), date: todayISO(), amountMl, cupId: cupId || null });
    save();
    toast('Water logged');
    renderDashboard();
    renderRecentEntries();
    renderHistory();
  }

  function renderWaterSection() {
    const hasCups = state.water.cups.length > 0;
    document.getElementById('waterSectionHead').hidden = !hasCups;
    const wrap = document.getElementById('waterDashboardWrap');
    wrap.hidden = !hasCups;
    if (!hasCups) { wrap.innerHTML = ''; return; }
    const { pct, achieved, total } = waterProgressPct(todayISO());
    const fillPct = Math.min(100, pct);
    wrap.innerHTML = `
      <div class="card">
        <div class="ex-card-values">
          <div class="ex-card-current">${fmtVolume(total)}</div>
          ${state.water.goalMl ? `<div class="ex-card-goal">/ ${fmtVolume(state.water.goalMl)} today</div>` : ''}
        </div>
        ${state.water.goalMl ? `
          <div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${fillPct}%"></div></div>
          <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}%`}</span></div>` : ''}
        <div class="cup-button-row">${cupButtonsHtml()}</div>
      </div>`;
    wrap.querySelectorAll('.cup-btn').forEach((btn) => btn.addEventListener('click', () => {
      const cup = cupById(btn.dataset.cupId);
      if (cup) logWaterAmount(cup.amountMl, cup.id);
    }));
  }

  // The id of exId's most-recently-logged entry for today, or '' if it
  // hasn't been logged today — genId() prefixes every id with a base36
  // timestamp (see genId), so plain string comparison of ids sorts
  // chronologically. Used to order Today's "logged today" list newest
  // first, across a mix of goal exercises and daily targets.
  function latestTodayEntryId(exId) {
    return entriesFor(exId)
      .filter((en) => en.date === todayISO())
      .reduce((max, en) => (en.id > max ? en.id : max), '');
  }

  // The dashboard's "Today" needs-attention prompts — one compact row per
  // dashboard-visible tracker (Weight, Sleep, or any custom one) that
  // hasn't been logged yet today. This is deliberately just a prompt, not
  // that tracker's full card — the full card (with its chart/trend/goal
  // meter) keeps living in Progress via renderBodySection whether or not
  // today's entry has landed yet; a tracker simply drops off this list the
  // moment it's logged, rather than jumping anywhere or duplicating itself.
  function renderTodayAttention() {
    const pending = activeTrackers()
      .filter((t) => t.showOnDashboard !== false)
      .filter((t) => !state.measurements.some((m) => m.trackerId === t.id && m.date === todayISO()));
    document.getElementById('todayAttentionSubhead').hidden = pending.length === 0;
    const wrap = document.getElementById('todayAttentionWrap');
    wrap.hidden = pending.length === 0;
    wrap.innerHTML = pending.map((t) => `
      <div class="prompt-row" data-tracker-id="${t.id}">
        <div>
          <div class="prompt-row-name">${escapeHtml(t.name)}</div>
          <div class="prompt-row-sub">Not logged today</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="log-tracker-prompt">Log</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-action="log-tracker-prompt"]').forEach((btn) => {
      btn.addEventListener('click', () => logTrackerFromDetail(btn.closest('[data-tracker-id]').getAttribute('data-tracker-id')));
    });
  }

  // Dashboard layout: "Today" (what's happening right now) above
  // "Progress" (the lifetime picture) — see the section-head comment in
  // index.html. Today holds, in order: needs-attention tracker prompts
  // (renderTodayAttention), whatever's actually been logged today (any
  // goal exercise with a today's entry, plus daily targets — which, same
  // as before, only ever show up on a day they're logged at all — mixed
  // together and sorted most-recent-first), then Water and Food, since
  // both are inherently day-scoped rather than lifetime numbers. Progress
  // keeps everything Today didn't claim: goal exercises untouched today,
  // and every tracker's own card (Body & wellness) regardless of whether
  // it was just logged — a tracker's card is a trend, not a today-only
  // thing, so it doesn't disappear from Progress just because it's also
  // prompted (or was, a moment ago) in Today.
  function renderDashboard() {
    renderSummary();
    const all = activeExercises();
    const goalList = all.filter((e) => sectionOf(e) === 'goal');
    const dailyDefined = all.filter((e) => sectionOf(e) === 'daily');
    const isLoggedToday = (e) => entriesFor(e.id).some((en) => en.date === todayISO());
    const goalsToday = goalList.filter(isLoggedToday);
    const goalsRemaining = goalList.filter((e) => !isLoggedToday(e));
    // A daily target only earns a spot on the dashboard once you've
    // actually logged it today — otherwise it'd be a standing reminder
    // cluttering the goals page every day whether or not you got to it.
    // It's still fully definable/loggable/editable via Log/History/Manage
    // even on a day it doesn't show here.
    const dailyToday = dailyDefined.filter(isLoggedToday);
    // accessory exercises are intentionally omitted from the dashboard —
    // they're still fully logged/edited via the Log and History tabs.

    document.getElementById('dashboardEmpty').hidden = (goalList.length + dailyDefined.length) > 0;

    renderTodayAttention();

    const todayItems = [...goalsToday, ...dailyToday]
      .sort((a, b) => latestTodayEntryId(b.id).localeCompare(latestTodayEntryId(a.id)));
    document.getElementById('todayActivitySubhead').hidden = todayItems.length === 0;
    const todayWrap = document.getElementById('todayActivityList');
    todayWrap.hidden = todayItems.length === 0;
    todayWrap.innerHTML = todayItems.map((e) => sectionOf(e) === 'goal' ? goalCardHtml(e) : dailyRowHtml(e)).join('');
    todayWrap.querySelectorAll('.ex-card[data-exercise-id]').forEach((card) => {
      wireOpenable(card, () => openExerciseDetail(card.getAttribute('data-exercise-id')));
    });
    todayWrap.querySelectorAll('.daily-row').forEach((row) => {
      wireOpenable(row, () => openExerciseDetail(row.getAttribute('data-exercise-id')));
    });

    renderWaterSection();
    renderFoodDashboardSection();

    const cardsWrap = document.getElementById('exerciseCards');
    cardsWrap.innerHTML = goalsRemaining.map(goalCardHtml).join('');
    cardsWrap.querySelectorAll('.ex-card[data-exercise-id]').forEach((card) => {
      wireOpenable(card, () => openExerciseDetail(card.getAttribute('data-exercise-id')));
    });

    renderBodySection();
  }

  // A read-only "today so far" summary of every tracked macro (see
  // trackedMacroKeys — a macro turned off in Manage -> Nutrition -> Food
  // isn't rendered here at all) — Food doesn't get quick-tap logging
  // buttons on the dashboard the way Water does (typed macro numbers don't
  // reduce to one tap), but seeing today's running total without a trip to
  // Log or History is still worth having front and center. Every tile
  // always shows a total; one with a daily goal enabled additionally shows
  // "/ goal" underneath, the same way Water shows progress toward its daily
  // goal; when the daily-value guidance toggle (Settings -> Insights) is
  // on, a value past the DV for Sugar/Sodium/Caffeine (see
  // MACRO_DV_OVER_FLAGS) is highlighted red right here too, not just in the
  // detail modal's table. The whole card is tappable (same "quick glance
  // here, detail one tap in" pattern as every other dashboard card) into
  // openFoodDetail() below, which is where the richer breakdown, the
  // nutrition calculator's recommendation, and quick access to
  // logging/adjusting goals now live — this flat grid stays a lightweight
  // summary.
  function renderFoodDashboardSection() {
    document.getElementById('foodSectionHead').hidden = !state.settings.trackFood;
    const wrap = document.getElementById('foodDashboardWrap');
    wrap.hidden = !state.settings.trackFood;
    if (!state.settings.trackFood) { wrap.innerHTML = ''; return; }
    const totals = foodTotalsForDate(todayISO());
    wrap.innerHTML = `
      <div class="card food-dashboard-card">
        <div class="food-totals-row">
          ${trackedMacroKeys().map((k) => {
            const goalInfo = macroGoalInfo(k);
            const goalLine = (goalInfo.enabled && goalInfo.goal != null)
              ? `<div class="food-total-goal">/ ${fmtMacroValue(k, goalInfo.goal)}</div>` : '';
            const isOver = state.settings.showMacroGuidance && macroDvOver(k, totals[k]);
            return `
              <div class="food-total-item">
                <div class="food-total-value${isOver ? ' is-over-dv' : ''}">${fmtMacroValue(k, totals[k])}</div>
                ${goalLine}
                <div class="food-total-label">${MACRO_LABELS[k]}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
    wireOpenable(wrap.querySelector('.food-dashboard-card'), openFoodDetail);
  }

  // Food's detail-on-demand modal — the dashboard card's flat totals grid
  // expanded with per-macro progress toward any enabled goal, the
  // nutrition calculator's recommendation (if turned on in Manage ->
  // Nutrition), and quick actions to log food or adjust goals, rather than
  // leaving the dashboard card as the only place to see today's food and a
  // separate trip to Manage as the only way to act on it.
  function openFoodDetail() {
    const totals = foodTotalsForDate(todayISO());
    const calc = state.settings.nutritionCalc;
    const suggestion = calc.enabled ? computeNutritionTargets(calc.activityLevel, calc.goal) : null;
    const trackedKeys = trackedMacroKeys();
    const rows = trackedKeys.map((k) => {
      const goalInfo = macroGoalInfo(k);
      const hasGoal = goalInfo.enabled && goalInfo.goal != null;
      const value = totals[k];
      let rightText = fmtMacroValue(k, value);
      if (hasGoal) {
        const pct = value != null ? Math.round(Math.min(100, (value / goalInfo.goal) * 100)) : null;
        rightText += ` / ${fmtMacroValue(k, goalInfo.goal)}${pct != null ? ` &middot; ${pct}%` : ''}`;
      }
      return `<div class="standards-preview-row"><span>${MACRO_LABELS[k]}</span><span>${rightText}</span></div>`;
    }).join('');

    // "Daily value guidance" — a second, toggleable table (Settings ->
    // Insights -> Macro guidance) rather than folded into the totals table
    // above: mixing a personal goal ("1850 / 2600 kcal") and a generic FDA
    // reference value ("58g of 78g DV") on the same row read as two
    // different kinds of number competing for the same line. Row text is
    // deliberately just "value + %DV", not a sentence ("61g over the 50g
    // added-sugar DV") — the caveats that sentence used to carry (added
    // sugar vs. total sugar, caffeine's guidance vs. a real DV) live once,
    // below the table, instead of repeated per row.
    const guidanceKeys = trackedKeys.filter((k) => MACRO_DV[k] != null);
    const guidanceHtml = (state.settings.showMacroGuidance && guidanceKeys.length) ? `
      <div class="card">
        <div class="section-head"><h2>Daily value guidance</h2></div>
        <div class="standards-preview">
          ${guidanceKeys.map((k) => {
            const value = totals[k];
            const pct = macroDvPct(k, value);
            const over = macroDvOver(k, value);
            return `<div class="standards-preview-row${over ? ' over' : ''}"><span>${MACRO_LABELS[k]}</span><span>${fmtMacroValue(k, value)} <span class="pct">${pct != null ? `${pct}% DV` : '—'}</span></span></div>`;
          }).join('')}
        </div>
        <p class="muted-text field-hint">General adult reference values for a 2,000-calorie diet, not personalized. Sugar's DV is for <i>added</i> sugar specifically — Fit Log logs one total, so treat that comparison as an upper bound. Caffeine has no official DV; 400mg is the FDA's general guidance, shown the same way.</p>
      </div>` : '';

    let calcHtml;
    if (!calc.enabled) {
      calcHtml = `
        <div class="card">
          <div class="section-head"><h2>Recommendation</h2></div>
          <p class="muted-text">Turn on the nutrition calculator (Adjust goals below) for a calorie/protein recommendation based on your profile.</p>
        </div>`;
    } else if (suggestion.missing) {
      const list = suggestion.missing.length > 1
        ? `${suggestion.missing.slice(0, -1).join(', ')} and ${suggestion.missing[suggestion.missing.length - 1]}`
        : suggestion.missing[0];
      calcHtml = `
        <div class="card">
          <div class="section-head"><h2>Recommendation</h2></div>
          <p class="muted-text">Set your ${list} to get a calorie/protein recommendation.</p>
        </div>`;
    } else {
      calcHtml = `
        <div class="card">
          <div class="section-head"><h2>Recommendation</h2></div>
          <div class="insight-line">${suggestion.calories} cal &middot; ${suggestion.protein}g protein</div>
          <p class="muted-text field-hint">For ${NUTRITION_GOAL_LABELS[calc.goal]}, ${ACTIVITY_LEVELS[calc.activityLevel].label.toLowerCase()}.</p>
        </div>`;
    }

    openModal(`
      <div class="modal-title-row"><h2>Food today</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <button type="button" class="btn btn-primary btn-block" id="logFoodFromDetailBtn">Log food</button>
      <div class="card">
        <div class="section-head"><h2>Today's totals</h2></div>
        <div class="standards-preview">${rows}</div>
      </div>
      ${guidanceHtml}
      ${calcHtml}
      <div class="btn-row">
        <button class="btn btn-secondary" id="adjustFoodGoalsBtn">Adjust goals</button>
      </div>
    `, { tall: true });
    document.getElementById('logFoodFromDetailBtn').addEventListener('click', logFoodFromDetail);
    document.getElementById('adjustFoodGoalsBtn').addEventListener('click', openFoodGoalsFromDetail);
  }

  // Jumps to the Log tab's Nutrition -> Food form, same "quick access"
  // pattern as logExerciseFromDetail()/logTrackerFromDetail() above.
  function logFoodFromDetail() {
    closeModal();
    logCategory = 'nutrition';
    logNutritionSub = 'food';
    switchTab('log');
  }

  // Jumps to Manage -> Nutrition -> Food, where the per-macro goal toggles
  // and the nutrition calculator (activity level/goal/Apply button) live —
  // the "adjustability" the flat dashboard card had no way to reach.
  function openFoodGoalsFromDetail() {
    closeModal();
    manageCategory = 'nutrition';
    manageNutritionSub = 'food';
    switchTab('manage');
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

  // The Log tab is grouped by domain — Workout, Measurements, Nutrition —
  // switched by a segmented control at the top rather than separate tabs,
  // since they're all "add one thing" forms sharing the same "Recent
  // entries" list below. Nutrition itself covers two very different
  // logging interactions (tap-a-cup water, typed-number food), so it gets
  // its own nested segmented control (see availableNutritionSubs()/
  // renderLogNutritionPanel()) rather than being split back into two
  // top-level categories. Measurements is only offered once there's at
  // least one tracker (it ships pre-seeded, but stays hidden if the user
  // deletes down to zero); Nutrition is always offered since Food has no
  // "delete down to zero" concept anymore.
  let logCategory = 'workout';

  // Every inline SVG icon in the app — this constant plus the ones below —
  // is Lucide's actual stroke-icon set (24x24 viewBox, stroke=currentColor,
  // stroke-width=2, round caps/joins; https://lucide.dev, ISC license),
  // hand-copied in from the `lucide-static` package rather than pulled from
  // a CDN or npm dependency, so the app keeps working fully offline with no
  // new install. Using one real, licensed source everywhere replaces what
  // used to be a mix of hand-drawn shapes (which already matched this style
  // closely) and plain text glyphs (✕, ‹, +) standing in for icons — see
  // CLOSE_ICON_SVG/BACK_CHEVRON_ICON_SVG/PLUS_ICON_SVG below for those.
  // A small pencil glyph for the "Edit" icon button in a detail modal's
  // title row (see renderExerciseDetail/renderTrackerDetail).
  const EDIT_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

  // The generic modal "✕" close button and the small "✕" that removes one
  // set row from the workout log form — both were a plain text character
  // before; this is Lucide's `x`.
  const CLOSE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // The "Next session" modal's back link — used to be the HTML entity
  // "&lsaquo;" (‹), which didn't match the calendar's own SVG chevrons.
  // Lucide's `chevron-left` (the calendar's prev/next-month arrows already
  // are this exact path, so they needed no change).
  const BACK_CHEVRON_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';

  // The "+ Add exercise / tracker / cup" buttons' leading "+" — used to be
  // a literal "+" character prefixed onto the label text. Lucide's `plus`.
  const PLUS_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

  // The day-streak stat tile's flame (see renderSummary) — Lucide `flame`.
  const FLAME_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/></svg>';

  // A small water-drop glyph next to each water "cup" quick-log button (see
  // cupButtonsHtml) — there was no icon here at all before. Lucide
  // `droplets`.
  const WATER_DROP_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/></svg>';

  // The Water/Food sub-tabs' Food glyph (see nutritionSubTabsHtml below),
  // and the setup wizard's Food interest tile. Lucide `apple`.
  const APPLE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.528V3a1 1 0 0 1 1-1h0"/><path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21"/></svg>';

  // The setup wizard's interest tiles (see renderSetupStepInterests) — one
  // icon per trackable thing the wizard asks about up front. Lifting reuses
  // DOMAIN_TAB_ICONS.workout (same dumbbell, same meaning); the rest are new.
  const FOOTPRINTS_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>';
  const SCALE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/><path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M7 21h10"/></svg>';
  const MOON_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>';

  // The three domain-tab icons, shared by Log (built here), and duplicated
  // byte-for-byte in index.html for History and Manage, whose outer
  // category buttons are static markup rather than JS-rendered (History and
  // Manage always offer all three domains; only Log's can disappear). Keep
  // all three copies identical — same glyph for the same domain everywhere
  // it appears is the whole point of giving these their own bigger,
  // consistent design family instead of the old cramped inline pill.
  // (Lucide `dumbbell` / `ruler` / `utensils`.)
  const DOMAIN_TAB_ICONS = {
    workout: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/></svg>',
    measurement: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>',
    nutrition: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  };

  // Nutrition's Water/Food sub-tabs (icon + label pill — see .segmented-new
  // in styles.css), shared by all three places it appears: Log, History,
  // and Manage > Nutrition. All three already track which sub is active in
  // their own local variable and re-render on click; this just builds the
  // markup so the three copies can't drift the way the old plain-text pill
  // (`<button>${s.label}</button>`) did.
  const NUTRITION_SUB_ICONS = { water: WATER_DROP_ICON_SVG, food: APPLE_ICON_SVG };
  function nutritionSubTabsHtml(subs, activeId) {
    return subs.map((s) => `
      <button type="button" data-nutrition-sub="${s.id}" role="radio" aria-checked="${s.id === activeId}">
        ${NUTRITION_SUB_ICONS[s.id] || ''}
        <span>${s.label}</span>
      </button>`).join('');
  }

  function availableLogCategories() {
    const cats = [{ id: 'workout', label: 'Workout' }];
    if (activeTrackers().length) cats.push({ id: 'measurement', label: 'Measurements' });
    if (availableNutritionSubs().length) cats.push({ id: 'nutrition', label: 'Nutrition' });
    return cats;
  }

  function renderLogCategorySegmented() {
    const cats = availableLogCategories();
    if (!cats.some((c) => c.id === logCategory)) logCategory = cats[0].id;
    const seg = document.getElementById('logCategorySegmented');
    seg.innerHTML = cats.map((c) => `
      <button type="button" class="domain-tab" data-log-cat="${c.id}" role="radio">
        ${DOMAIN_TAB_ICONS[c.id] || ''}
        <span>${c.label}</span>
      </button>`).join('');
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.logCat === logCategory));
      b.addEventListener('click', () => { logCategory = b.dataset.logCat; renderLogView(); });
    });
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
    document.getElementById('logMeasurementValueLabel').textContent = tracker ? (isSleep ? 'Hours slept' : `Value (${trackerUnitLabel(tracker)})`) : 'Value';
    document.getElementById('logSleepQualityField').hidden = !isSleep;
  }

  function handleLogMeasurementSubmit(ev) {
    ev.preventDefault();
    const tracker = trackerById(document.getElementById('logTracker').value);
    if (!tracker) { toast('Add a tracker first.'); return; }
    const raw = parseFloat(document.getElementById('logMeasurementValue').value);
    if (Number.isNaN(raw)) { toast('Enter a value.'); return; }
    const date = document.getElementById('logMeasurementDate').value || todayISO();
    const note = document.getElementById('logMeasurementNote').value.trim();
    const quality = tracker.kind === 'sleep' ? clampQuality(document.getElementById('logSleepQuality').dataset.value) : undefined;
    // If this tracker has a goal but never got a baseline (e.g. the goal was
    // set before this feature existed and the v6->v7 migration found no
    // history to backfill from), the value it was AT before this new entry
    // becomes that baseline — or, if this is the very first entry ever,
    // the entry's own value (0% progress, which is correct: nothing to
    // measure movement against yet).
    if (tracker.goal != null && tracker.baseline == null) {
      const prevLatest = latestMeasurement(tracker.id);
      tracker.baseline = prevLatest ? prevLatest.value : trackerCanonicalFromDisplay(tracker, raw);
    }
    state.measurements.push({ id: genId('meas'), trackerId: tracker.id, date, value: trackerCanonicalFromDisplay(tracker, raw), quality, note: note || null });
    // A new bodyweight entry can move any lift's bodyweight-standard goal —
    // see recomputeStandardGoals(). A no-op for every other tracker.
    if (tracker.id === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
    save();
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

  // Only currently-tracked macros (see trackedMacroKeys) — a macro turned
  // off in Manage -> Nutrition -> Food doesn't show up here at all. Calories
  // is always first and always required (handleLogFoodSubmit below); every
  // other tracked field stays genuinely optional.
  function renderLogFoodForm() {
    document.getElementById('logFoodDate').value = document.getElementById('logFoodDate').value || todayISO();
    const wrap = document.getElementById('logFoodDynamicFields');
    wrap.innerHTML = trackedMacroKeys().map((k) => {
      const req = k === 'calories';
      return `
      <label class="field"><span class="field-label">${MACRO_LABELS[k]}${MACRO_UNITS[k] ? ` (${MACRO_UNITS[k]})` : ''} ${req ? '<span class="req-mark">*</span>' : '<span class="muted-text">(optional)</span>'}</span>
        <input type="number" step="any" min="0" id="logFood_${k}" placeholder="e.g. ${MACRO_PLACEHOLDERS[k]}" ${req ? 'required' : ''} /></label>`;
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
    // Calories is the one required field — an entry with, say, only sodium
    // filled in isn't a usable food log (see the "Food / nutrition"
    // section). Every other tracked macro stays optional.
    if (values.calories == null) { toast('Enter calories to log a food entry.'); return; }
    const date = document.getElementById('logFoodDate').value || todayISO();
    const note = document.getElementById('logFoodNote').value.trim();
    state.food.entries.push({ id: genId('food'), date, ...values, note: note || null });
    save();
    toast('Food logged');
    trackedMacroKeys().forEach((k) => { const el = document.getElementById(`logFood_${k}`); if (el) el.value = ''; });
    document.getElementById('logFoodNote').value = '';
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  // Nutrition's own nested segmented control — Water and Food are too
  // different an interaction (tap-a-cup vs. typed numbers) to share one
  // form the way Workout/Measurements/Nutrition share the outer one. Water
  // is only offered while at least one cup exists; Food only while
  // settings.trackFood is on (see the setup wizard's interests step and the
  // Settings toggle that mirrors it) — both can be off at once, which
  // every caller of this (Log/History/Manage) needs to handle rendering
  // nothing rather than assuming at least one sub always exists.
  let logNutritionSub = 'water';

  function availableNutritionSubs() {
    const subs = [];
    if (state.water.cups.length) subs.push({ id: 'water', label: 'Water' });
    if (state.settings.trackFood) subs.push({ id: 'food', label: 'Food' });
    return subs;
  }

  function renderLogNutritionPanel() {
    const subs = availableNutritionSubs();
    if (!subs.some((s) => s.id === logNutritionSub)) logNutritionSub = subs[0].id;
    const seg = document.getElementById('logNutritionSubSegmented');
    seg.innerHTML = nutritionSubTabsHtml(subs, logNutritionSub);
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { logNutritionSub = b.dataset.nutritionSub; renderLogNutritionPanel(); renderRecentEntries(); });
    });
    document.getElementById('logWaterPanel').hidden = logNutritionSub !== 'water';
    document.getElementById('logFoodForm').hidden = logNutritionSub !== 'food';
    document.getElementById('savedFoodsWrap').hidden = logNutritionSub !== 'food' || !state.food.savedFoods.length;
    if (logNutritionSub === 'water') renderLogWaterPanel();
    if (logNutritionSub === 'food') { renderLogFoodForm(); renderSavedFoodLogList(); }
  }

  // Redraws whichever Log sub-form is currently selected, plus the shared
  // "Recent entries" list below it.
  function renderLogView() {
    renderLogCategorySegmented();
    document.getElementById('logForm').hidden = logCategory !== 'workout';
    document.getElementById('logMeasurementForm').hidden = logCategory !== 'measurement';
    document.getElementById('logNutritionPanel').hidden = logCategory !== 'nutrition';
    if (logCategory === 'workout') renderLogForm();
    if (logCategory === 'measurement') renderLogMeasurementForm();
    if (logCategory === 'nutrition') renderLogNutritionPanel();
    renderRecentEntries();
  }

  // "Recent entries" always reflects whichever Log category (and, for
  // Nutrition, sub-category) is active, rather than always showing
  // workouts — otherwise it would look broken while logging water, a
  // measurement, or food.
  function renderRecentEntries() {
    const wrap = document.getElementById('recentEntries');
    if (logCategory === 'measurement') {
      const recent = state.measurements.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
      wrap.innerHTML = recent.length ? recent.map((m) => measurementRowHtml(m)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireMeasurementRowClicks(wrap);
      return;
    }
    if (logCategory === 'nutrition' && logNutritionSub === 'water') {
      const recent = state.waterEntries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
      wrap.innerHTML = recent.length ? recent.map((e) => waterEntryRowHtml(e)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireWaterEntryRowClicks(wrap);
      return;
    }
    if (logCategory === 'nutrition' && logNutritionSub === 'food') {
      const recent = state.food.entries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
      wrap.innerHTML = recent.length ? recent.map((e) => foodEntryRowHtml(e)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireFoodEntryRowClicks(wrap);
      return;
    }
    const recent = state.entries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
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

  function waterEntryRowHtml(e) {
    const cup = e.cupId ? cupById(e.cupId) : null;
    return `
      <div class="entry-row" data-water-entry-id="${e.id}">
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
          <input type="number" step="any" min="0" id="editWaterAmount" value="${round(Units.mlToDisplay(e.amountMl), 1)}" /></label>
        <div class="btn-row"><button class="btn btn-primary btn-block" id="saveWaterEntryBtn">Save changes</button></div>
        <button class="btn btn-danger btn-block" id="deleteWaterEntryBtn">Delete entry</button>
      </div>
    `);
    document.getElementById('saveWaterEntryBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('editWaterAmount').value);
      if (Number.isNaN(raw) || raw <= 0) { toast('Enter an amount greater than zero.'); return; }
      e.date = document.getElementById('editWaterDate').value || e.date;
      e.amountMl = Units.displayToMl(raw);
      save();
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteWaterEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.waterEntries = state.waterEntries.filter((x) => x.id !== entryId);
        save();
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  function foodEntryRowHtml(e) {
    return `
      <div class="entry-row" data-food-entry-id="${e.id}">
        <div class="entry-row-main">
          <div class="entry-row-title">${macroSummaryText(e)}</div>
          ${e.note ? `<div class="entry-row-sub">“${escapeHtml(e.note)}”</div>` : ''}
        </div>
        <div class="entry-row-date">${fmtDateShort(e.date)}</div>
      </div>`;
  }

  function wireFoodEntryRowClicks(container) {
    container.querySelectorAll('.entry-row[data-food-entry-id]').forEach((row) => {
      row.addEventListener('click', () => openFoodEntryModal(row.getAttribute('data-food-entry-id')));
    });
  }

  // Edit modal only shows currently-tracked macro fields (see
  // trackedMacroKeys) — a field that's off doesn't render an input at all,
  // so `Object.assign(e, values)` below only ever touches tracked keys and
  // any value already saved for an untracked one is left exactly as it was.
  function openFoodEntryModal(entryId) {
    const e = state.food.entries.find((x) => x.id === entryId);
    if (!e) return;
    openModal(`
      <div class="modal-title-row"><h2>Edit food entry</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Date</span><input type="date" id="editFoodDate" value="${e.date}" /></label>
        ${trackedMacroKeys().map((k) => {
          const req = k === 'calories';
          return `
        <label class="field"><span class="field-label">${MACRO_LABELS[k]}${MACRO_UNITS[k] ? ` (${MACRO_UNITS[k]})` : ''} ${req ? '<span class="req-mark">*</span>' : '<span class="muted-text">(optional)</span>'}</span>
          <input type="number" step="any" min="0" id="editFood_${k}" value="${e[k] != null ? e[k] : ''}" ${req ? 'required' : ''} /></label>`;
        }).join('')}
        <label class="field"><span class="field-label">Note</span><input type="text" id="editFoodNote" value="${e.note ? escapeHtml(e.note) : ''}" maxlength="200" /></label>
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
      if (values.calories == null) { toast('Enter calories to save this entry.'); return; }
      e.date = document.getElementById('editFoodDate').value || e.date;
      Object.assign(e, values);
      e.note = document.getElementById('editFoodNote').value.trim() || null;
      save();
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteFoodEntryBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.food.entries = state.food.entries.filter((x) => x.id !== entryId);
        save();
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  /* ============================== Saved Foods ==============================
     The exercise-library equivalent for food: research a food's numbers
     once, save it under a name (Manage -> Nutrition -> Food -> Saved
     foods), and every later logging of it is one tap — optionally scaled by
     quantity — instead of retyping every macro. A saved food stores
     whatever tracked macros were filled in when it was created/edited, same
     shape as a food entry; logging one just scales those fields by the
     chosen quantity and pushes a normal entry, indistinguishable afterward
     from one typed by hand. No database, no barcode lookup, no network —
     just a shortcut list the user curates themselves. */

  function savedFoodById(id) { return state.food.savedFoods.find((f) => f.id === id); }

  function savedFoodRowHtml(food) {
    return `
      <div class="entry-row is-manage" data-saved-food-id="${food.id}">
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(food.name)}</div>
          <div class="entry-row-sub">${macroSummaryText(food)}</div>
        </div>
        <div class="entry-row-actions">
          <button class="btn btn-secondary btn-sm" data-action="edit-saved-food" data-id="${food.id}">Edit</button>
        </div>
      </div>`;
  }

  function renderSavedFoodManageList() {
    const wrap = document.getElementById('savedFoodManageList');
    wrap.innerHTML = state.food.savedFoods.map(savedFoodRowHtml).join('')
      || '<p class="muted-text">No saved foods yet — research a food once, save it here, then log it in one tap from Log &rarr; Food.</p>';
    wrap.querySelectorAll('[data-action="edit-saved-food"]').forEach((btn) => btn.addEventListener('click', () => openSavedFoodForm(btn.dataset.id)));
  }

  // Only currently-tracked macros are asked for (same fields as the log
  // form itself, Calories required) — a saved food is just a template for
  // a food entry, so it follows the same tracking rules one would.
  function openSavedFoodForm(foodId) {
    const editing = !!foodId;
    const food = editing ? savedFoodById(foodId) : null;
    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit saved food' : 'Save a new food'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Name</span>
          <input type="text" id="savedFoodName" value="${food ? escapeHtml(food.name) : ''}" placeholder="e.g. Chicken breast, 6oz" maxlength="60" /></label>
        ${trackedMacroKeys().map((k) => {
          const req = k === 'calories';
          return `
        <label class="field"><span class="field-label">${MACRO_LABELS[k]}${MACRO_UNITS[k] ? ` (${MACRO_UNITS[k]})` : ''} ${req ? '<span class="req-mark">*</span>' : '<span class="muted-text">(optional)</span>'}</span>
          <input type="number" step="any" min="0" id="savedFood_${k}" value="${food && food[k] != null ? food[k] : ''}" ${req ? 'required' : ''} /></label>`;
        }).join('')}
        <button type="button" class="btn btn-primary btn-block" id="saveSavedFoodBtn">${editing ? 'Save changes' : 'Save food'}</button>
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteSavedFoodBtn">Delete saved food</button>` : ''}
      </div>
    `);
    document.getElementById('saveSavedFoodBtn').addEventListener('click', () => {
      const name = document.getElementById('savedFoodName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      const values = {};
      trackedMacroKeys().forEach((k) => {
        const el = document.getElementById(`savedFood_${k}`);
        const raw = el ? parseFloat(el.value) : NaN;
        values[k] = (!Number.isNaN(raw) && raw >= 0) ? raw : null;
      });
      if (values.calories == null) { toast('Enter calories to save this food.'); return; }
      if (editing) {
        food.name = name;
        Object.assign(food, values);
      } else {
        state.food.savedFoods.push({ id: genId('savedfood'), name, ...values });
      }
      save();
      closeModal();
      toast(editing ? 'Saved food updated' : 'Food saved');
      renderManage();
      renderLogView();
    });
    if (editing) {
      document.getElementById('deleteSavedFoodBtn').addEventListener('click', () => {
        confirmDialog('Delete this saved food?', 'This can’t be undone. Food entries already logged from it aren’t affected.', 'Delete', () => {
          state.food.savedFoods = state.food.savedFoods.filter((f) => f.id !== foodId);
          save();
          closeModal();
          toast('Saved food deleted');
          renderManage();
          renderLogView();
        }, true);
      });
    }
  }

  // Log -> Food's quantity picker is transient UI state, not saved
  // anywhere — which saved food (if any) is expanded, and what quantity is
  // currently chosen for it. Reset to 1x whenever a different row is
  // tapped, same "one open at a time" behavior used elsewhere (e.g. the
  // suggestion-info modal).
  let expandedSavedFoodId = null;
  let savedFoodQty = 1;
  const SAVED_FOOD_QTY_PRESETS = [0.5, 0.75, 1, 1.5, 2];

  // Every tracked macro on `food`, scaled by `qty` and rounded to one
  // decimal place — e.g. 1.5x on 280 cal / 53g protein logs 420 cal /
  // 79.5g protein. A macro the saved food has no value for stays null, same
  // as any other optional field.
  function scaledSavedFoodValues(food, qty) {
    const values = {};
    trackedMacroKeys().forEach((k) => { values[k] = food[k] != null ? round(food[k] * qty, 1) : null; });
    return values;
  }

  function renderSavedFoodLogList() {
    const wrap = document.getElementById('savedFoodsWrap');
    const list = document.getElementById('savedFoodLogList');
    const foods = state.food.savedFoods;
    wrap.hidden = foods.length === 0;
    if (!foods.length) { list.innerHTML = ''; return; }
    list.innerHTML = foods.map((food) => {
      const expanded = expandedSavedFoodId === food.id;
      const isCustomQty = !SAVED_FOOD_QTY_PRESETS.includes(savedFoodQty);
      return `
        <div class="entry-row saved-food-log-row" data-saved-food-id="${food.id}">
          <div class="entry-row-main">
            <div class="entry-row-title">${escapeHtml(food.name)}</div>
            <div class="entry-row-sub">${macroSummaryText(food)}</div>
          </div>
        </div>
        ${expanded ? `
        <div class="card form-card saved-food-qty-card">
          <div class="chip-picker" id="savedFoodQtyChips" role="radiogroup" aria-label="Quantity">
            ${SAVED_FOOD_QTY_PRESETS.map((q) => `<button type="button" class="chip-option${savedFoodQty === q ? ' is-active' : ''}" data-qty="${q}" role="radio" aria-checked="${savedFoodQty === q}">${q}&times;</button>`).join('')}
            <button type="button" class="chip-option${isCustomQty ? ' is-active' : ''}" data-qty="custom" role="radio" aria-checked="${isCustomQty}">Custom&hellip;</button>
          </div>
          ${isCustomQty ? `
          <label class="field"><span class="field-label">Custom quantity (&times;)</span>
            <input type="number" step="any" min="0" id="savedFoodCustomQty" value="${savedFoodQty}" /></label>` : ''}
          <p class="muted-text field-hint">Logs: ${macroSummaryText(scaledSavedFoodValues(food, savedFoodQty))}</p>
          <button type="button" class="btn btn-primary btn-block" id="logSavedFoodBtn">Log it</button>
        </div>` : ''}`;
    }).join('');
    list.querySelectorAll('.saved-food-log-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.savedFoodId;
        expandedSavedFoodId = expandedSavedFoodId === id ? null : id;
        savedFoodQty = 1;
        renderSavedFoodLogList();
      });
    });
    const chips = document.getElementById('savedFoodQtyChips');
    if (chips) {
      chips.querySelectorAll('.chip-option').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (btn.dataset.qty === 'custom') { savedFoodQty = 1.25; } // any non-preset value switches the picker into "Custom" mode
          else savedFoodQty = parseFloat(btn.dataset.qty);
          renderSavedFoodLogList();
        });
      });
    }
    const customInput = document.getElementById('savedFoodCustomQty');
    if (customInput) {
      customInput.addEventListener('click', (ev) => ev.stopPropagation());
      customInput.addEventListener('change', () => {
        const raw = parseFloat(customInput.value);
        if (!Number.isNaN(raw) && raw > 0) savedFoodQty = raw;
        renderSavedFoodLogList();
      });
    }
    const logBtn = document.getElementById('logSavedFoodBtn');
    if (logBtn) {
      logBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        logSavedFood(expandedSavedFoodId, savedFoodQty);
      });
    }
  }

  function logSavedFood(foodId, qty) {
    const food = savedFoodById(foodId);
    if (!food) return;
    const values = scaledSavedFoodValues(food, qty);
    const date = document.getElementById('logFoodDate').value || todayISO();
    state.food.entries.push({ id: genId('food'), date, ...values, note: food.name });
    save();
    toast(`${food.name} logged`);
    expandedSavedFoodId = null;
    savedFoodQty = 1;
    renderSavedFoodLogList();
    renderRecentEntries();
    renderDashboard();
    renderHistory();
  }

  function handleLogSubmit(ev) {
    ev.preventDefault();
    const select = document.getElementById('logExercise');
    const ex = exerciseById(select.value);
    if (!ex) { toast('Pick an exercise first.'); return; }
    const fields = readDynamicFields(document.getElementById('logDynamicFields'), ex);
    if (fields && fields.error) { toast(fields.error); return; }
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

  // A month calendar sitting above the filterable entry list — a second,
  // date-first way into the same History data rather than a replacement
  // for the list below it. Each day gets a small colored dot per category
  // that had activity that day (fixed colors, not user-configurable — see
  // .cal-dot-* in styles.css): green for any workout logged, blue for
  // hitting that day's water goal (not just for drinking anything — the
  // dot means "goal met"), purple for any body measurement logged. Tapping
  // a day opens everything logged that day, editable in place.

  let calendarMonth = (() => { const d = new Date(); d.setDate(1); return d; })();

  function dayActivity(dateIso) {
    const workout = state.entries.some((e) => e.date === dateIso);
    const body = state.measurements.some((m) => m.date === dateIso);
    const waterHit = !!(state.water.goalMl && waterTotalForDate(dateIso) >= state.water.goalMl);
    const food = state.food.entries.some((e) => e.date === dateIso);
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
        <button type="button" class="calendar-day ${dateIso === todayIso ? 'is-today' : ''}" data-date="${dateIso}">
          <span>${day}</span>
          <span class="calendar-day-dots">${dots}</span>
        </button>`;
    }
    document.getElementById('calendarGrid').innerHTML = html;
    document.querySelectorAll('#calendarGrid .calendar-day[data-date]').forEach((btn) => {
      btn.addEventListener('click', () => openDayDetail(btn.dataset.date));
    });
  }

  // Everything logged on one day, across all four categories, each row
  // clickable straight into its own existing edit/delete modal — the
  // calendar's "click a day to see or edit its history" affordance.
  function openDayDetail(dateIso) {
    const workoutEntries = state.entries.filter((e) => e.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const measurements = state.measurements.filter((m) => m.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const waterEntries = state.waterEntries.filter((e) => e.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const foodEntries = state.food.entries.filter((e) => e.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const nothingLogged = !workoutEntries.length && !measurements.length && !waterEntries.length && !foodEntries.length;

    const dateLabel = new Date(dateIso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    openModal(`
      <div class="modal-title-row"><h2>${dateLabel}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      ${nothingLogged ? '<p class="muted-text">Nothing logged on this day.</p>' : ''}
      ${workoutEntries.length ? `
        <div class="section-head"><h2>Workouts</h2></div>
        <div class="entry-list" id="dayWorkoutList">${workoutEntries.map(entryRowHtml).join('')}</div>` : ''}
      ${measurements.length ? `
        <div class="section-head"><h2>Body</h2></div>
        <div class="entry-list" id="dayMeasurementList">${measurements.map(measurementRowHtml).join('')}</div>` : ''}
      ${waterEntries.length ? `
        <div class="section-head"><h2>Water</h2></div>
        <div class="entry-list" id="dayWaterList">${waterEntries.map(waterEntryRowHtml).join('')}</div>` : ''}
      ${foodEntries.length ? `
        <div class="section-head"><h2>Food <span class="muted-text">— ${macroSummaryText(foodTotalsForDate(dateIso))}</span></h2></div>
        <div class="entry-list" id="dayFoodList">${foodEntries.map(foodEntryRowHtml).join('')}</div>` : ''}
    `);
    const workoutList = document.getElementById('dayWorkoutList');
    if (workoutList) wireEntryRowClicks(workoutList);
    const measurementList = document.getElementById('dayMeasurementList');
    if (measurementList) wireMeasurementRowClicks(measurementList);
    const waterList = document.getElementById('dayWaterList');
    if (waterList) wireWaterEntryRowClicks(waterList);
    const foodList = document.getElementById('dayFoodList');
    if (foodList) wireFoodEntryRowClicks(foodList);
  }

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

  let historyCategory = 'workout';
  // Nutrition's nested sub-choice within History, mirroring Log's.
  let historyNutritionSub = 'water';

  function renderHistoryCategorySegmented() {
    document.querySelectorAll('#historyCategorySegmented button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.historyCat === historyCategory));
    });
    document.getElementById('historyFilterField').hidden = historyCategory !== 'workout';
    document.getElementById('historyNutritionSubField').hidden = historyCategory !== 'nutrition';
    if (historyCategory === 'nutrition') {
      const subs = availableNutritionSubs();
      if (subs.length && !subs.some((s) => s.id === historyNutritionSub)) historyNutritionSub = subs[0].id;
      document.getElementById('historyNutritionSubSegmented').innerHTML = subs.length ? nutritionSubTabsHtml(subs, historyNutritionSub) : '';
    }
  }

  function renderHistory() {
    renderHistoryCalendar();
    renderHistoryCategorySegmented();
    const wrap = document.getElementById('historyList');

    if (historyCategory === 'nutrition' && !availableNutritionSubs().length) {
      document.getElementById('historyEmpty').hidden = false;
      wrap.innerHTML = '';
      return;
    }
    if (historyCategory === 'measurement') {
      const list = state.measurements.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      document.getElementById('historyEmpty').hidden = list.length > 0;
      wrap.innerHTML = list.map((m) => measurementRowHtml(m)).join('');
      wireMeasurementRowClicks(wrap);
      return;
    }
    if (historyCategory === 'nutrition' && historyNutritionSub === 'water') {
      const list = state.waterEntries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      document.getElementById('historyEmpty').hidden = list.length > 0;
      wrap.innerHTML = list.map((e) => waterEntryRowHtml(e)).join('');
      wireWaterEntryRowClicks(wrap);
      return;
    }
    if (historyCategory === 'nutrition' && historyNutritionSub === 'food') {
      // Grouped by date with each day's totals as a header, rather than one
      // flat list — "total everything by day" is the whole point of the
      // feature, so History is where those totals actually live, not just
      // the dashboard's "today" card.
      document.getElementById('historyEmpty').hidden = state.food.entries.length > 0;
      const byDate = {};
      state.food.entries.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
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
      .slice()
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    document.getElementById('historyEmpty').hidden = list.length > 0;
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
      if (fields && fields.error) { toast(fields.error); return; }
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

  // Jumps straight to the Log tab with this exercise/tracker already
  // selected — the detail modal's "Log entry" button, so a person who
  // tapped in just to log a set doesn't have to close the modal, switch
  // tabs, and re-pick from a dropdown they were just looking at. Reuses
  // the same change handling the dropdown's own listener runs (dispatching
  // a real 'change' event) rather than duplicating what it does.
  function logExerciseFromDetail(exId) {
    closeModal();
    logCategory = 'workout';
    switchTab('log');
    const select = document.getElementById('logExercise');
    select.value = exId;
    select.dispatchEvent(new Event('change'));
  }
  function logTrackerFromDetail(trackerId) {
    closeModal();
    logCategory = 'measurement';
    switchTab('log');
    const select = document.getElementById('logTracker');
    select.value = trackerId;
    select.dispatchEvent(new Event('change'));
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

    const standardsHtml = ex.kind === 'weight' && state.settings.showStrengthLevel ? strengthStandardsDetailHtml(ex)
      : ex.kind === 'cardio' && state.settings.showPaceLevel ? paceStandardsDetailHtml(ex)
      : '';

    openModal(`
      <div class="modal-title-row">
        <h2>${escapeHtml(ex.name)}</h2>
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
      <button type="button" class="btn btn-primary btn-block" id="logEntryFromDetailBtn">Log entry</button>

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
    document.getElementById('archiveExerciseBtn').addEventListener('click', () => {
      ex.archived = !ex.archived;
      save();
      closeModal();
      toast(ex.archived ? 'Exercise archived' : 'Exercise unarchived');
      renderAll();
    });
  }

  function openExerciseDetail(exId) {
    renderExerciseDetail(exId, state.settings.chartScale);
  }

  // The "Why?" tap target on a suggestion card — the specific detail/method
  // note for THIS suggestion, followed by a general, always-the-same
  // explanation of the progression logic behind every suggestion the app
  // makes (see suggestWeightOrReps()/suggestCardioMetric() above). Keeping
  // this as its own screen (rather than an inline expand) is what lets the
  // card itself stay a one-line "at a glance" headline. "‹ Back" returns to
  // the exercise detail rather than closing outright — this app's modal is
  // a single sheet with no stack, so going back means re-rendering the
  // previous screen from scratch, the same trick confirmDialog() etc. use.
  function openSuggestionInfoModal(exId, scale, activeMetric, sugg) {
    const ex = exerciseById(exId);
    openModal(`
      <button type="button" class="modal-back-link" data-action="back-to-exercise">${BACK_CHEVRON_ICON_SVG}${ex ? escapeHtml(ex.name) : 'Back'}</button>
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
        <label class="field"><span class="field-label">Name</span>
          <input type="text" id="exName" value="${ex ? escapeHtml(ex.name) : ''}" placeholder="e.g. Overhead Press" maxlength="60" /></label>

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
    let selectedSection = section;
    let selectedRegion = bodyRegion;
    let selectedLiftType = (ex && ex.liftType) || '';
    // Goal style for a weight-kind exercise with a lift type set — 'fixed'
    // (a plain typed number) or 'standard' (recomputed from a bodyweight
    // multiplier tier; see computeStandardGoal/standardGoalPreviewRows).
    // Defaults to whatever's already saved, or 'fixed' for a brand-new
    // exercise — never defaults to 'standard' on its own even once a lift
    // type is picked, since that would silently overwrite a goal the user
    // may already have typed in.
    let selectedGoalMode = (ex && ex.goalMode) || 'fixed';
    let selectedGoalTier = (ex && ex.goalTier) || 'intermediate';

    const SECTION_HINTS = {
      goal: 'Shown as a full progress card on your home screen.',
      daily: 'Something you’re aiming to do every day (push-ups, pull-ups, ...). Only shows on your home screen on a day you’ve actually logged it.',
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
    function setLiftTypeUI(t) {
      selectedLiftType = t;
      document.querySelectorAll('#exLiftTypeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.liftType === t)));
      // A bodyweight-standard goal only means anything once a lift type is
      // picked (it's what selects the LIFT_STANDARDS table) — clearing the
      // lift type falls back to a plain fixed number rather than leaving
      // the form stuck showing a tier picker for no lift.
      if (!t) selectedGoalMode = 'fixed';
      if (selectedKind === 'weight' && document.getElementById('goalFieldWrap')) renderGoalField();
    }
    document.querySelectorAll('#exSectionSegmented button').forEach((b) => b.addEventListener('click', () => setSectionUI(b.dataset.section)));
    document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.addEventListener('click', () => setRegionUI(b.dataset.region)));
    document.querySelectorAll('#exLiftTypeSegmented button').forEach((b) => b.addEventListener('click', () => setLiftTypeUI(b.dataset.liftType)));
    setSectionUI(selectedSection);
    setRegionUI(selectedRegion);
    setLiftTypeUI(selectedLiftType);

    // The weight-kind goal field: a plain number by default, or — once a
    // lift type is set — a "Fixed number" / "Bodyweight standard" toggle
    // matching the one in the setup wizard, complete with the same live
    // Beginner..Elite preview table so switching a lift's goal mode after
    // the fact (the whole point of this being here instead of only in the
    // wizard) is exactly as informative as setting it up the first time.
    function weightGoalFieldHtml() {
      const fixedVal = ex && ex.goal ? round(Units.lbToDisplay(ex.goal), 1) : '';
      if (!selectedLiftType || !LIFT_STANDARDS[selectedLiftType]) {
        return `<label class="field"><span class="field-label">Goal weight (${Units.weightUnitLabel()})</span><input type="number" step="any" id="goalInput" value="${fixedVal}" placeholder="e.g. 225" /></label>`;
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
            <input type="number" step="any" id="goalInput" value="${fixedVal}" placeholder="e.g. 225" /></label>
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
      const usingStandardGoal = selectedKind === 'weight' && selectedLiftType && LIFT_STANDARDS[selectedLiftType] && selectedGoalMode === 'standard';
      if (usingStandardGoal) {
        goal = computeStandardGoal(selectedLiftType, selectedGoalTier, currentBodyWeightLb(), state.profile.sex);
        if (goal == null) { toast('Log your body weight and set your sex in Settings → Profile first.'); return; }
      } else if (selectedKind === 'weight' || selectedKind === 'reps') {
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
      } else {
        const newEx = { id: genId('ex'), name, kind: selectedKind, section: selectedSection, goal, goalMode: 'fixed', goalTier: null, archived: false, createdAt: new Date().toISOString() };
        if (selectedKind === 'weight') {
          newEx.bodyRegion = selectedRegion; newEx.liftType = selectedLiftType || null;
          newEx.goalMode = usingStandardGoal ? 'standard' : 'fixed';
          newEx.goalTier = usingStandardGoal ? selectedGoalTier : null;
        }
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

  /* ============================== Tracker detail modal ============================== */

  function measurementRowHtml(m) {
    const tracker = trackerById(m.trackerId);
    const valueText = tracker ? fmtTrackerValue(tracker, m.value) : m.value;
    const qualityText = tracker && tracker.kind === 'sleep' && m.quality != null ? ` · Quality ${fmtQuality(m.quality)}` : '';
    return `
      <div class="entry-row" data-measurement-id="${m.id}">
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
          <input type="number" step="any" id="editMeasurementValue" value="${tracker ? trackerDisplayFromCanonical(tracker, m.value) : m.value}" /></label>
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
      m.date = document.getElementById('editMeasurementDate').value || m.date;
      m.value = tracker ? trackerCanonicalFromDisplay(tracker, raw) : raw;
      if (isSleep) m.quality = clampQuality(document.getElementById('editMeasurementQuality').dataset.value);
      m.note = document.getElementById('editMeasurementNote').value.trim() || null;
      if (m.trackerId === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
      save();
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteMeasurementBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.measurements = state.measurements.filter((x) => x.id !== measurementId);
        if (m.trackerId === BODY_WEIGHT_TRACKER_ID) recomputeStandardGoals();
        save();
        toast('Entry deleted');
        renderRecentEntries(); renderDashboard(); renderHistory();
      }, true);
    });
  }

  // Mirrors renderExerciseDetail: current value/goal/meter, a trend chart,
  // and the full entry list — deliberately simpler (no progressive-overload
  // suggestion, no PR grid) since a body/wellness tracker's job is showing
  // where things stand and where they've been, not coaching a next session.
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
    // BMI (Weight tracker) and the fuller sleep breakdown (Sleep tracker)
    // each get their own detail-on-demand card here, same "tap in for the
    // deeper insight" placement already used for a lift's Strength/Pace
    // level — gated behind the same Settings → Insights toggles that used
    // to gate their old, plainer dashboard-card lines.
    const insightDetailHtml = tracker.id === BODY_WEIGHT_TRACKER_ID && state.settings.showWeightInsights ? bmiDetailHtml()
      : tracker.kind === 'sleep' && state.settings.showSleepInsights ? sleepInsightDetailHtml()
      : '';
    openModal(`
      <div class="modal-title-row">
        <h2>${escapeHtml(tracker.name)}</h2>
        <div class="modal-title-actions">
          <button class="icon-btn" id="editTrackerBtn" aria-label="Edit tracker">${EDIT_ICON_SVG}</button>
          <button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button>
        </div>
      </div>
      <!-- Wrapped in a .card (matching the exercise detail modal's own fix
           and how a tracker's dashboard card already wraps this same
           content) rather than left as bare top-level modal content, which
           had no spacing of its own and sat jammed against the pr-grid
           right below it. -->
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
      <button type="button" class="btn btn-primary btn-block" id="logEntryFromDetailBtn">Log entry</button>

      ${insightDetailHtml}

      <div class="pr-grid">
        <div class="pr-tile"><div class="value">${history.length}</div><div class="label">Entries logged</div></div>
        <div class="pr-tile"><div class="value">${latest ? fmtDateShort(latest.date) : '—'}</div><div class="label">Last logged</div></div>
      </div>

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
    document.getElementById('archiveTrackerBtn').addEventListener('click', () => {
      tracker.archived = !tracker.archived;
      save();
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
    // Sleep's value type is fixed (hours + a quality rating are part of what
    // `kind: 'sleep'` means, not a plain unitKind choice) — locked the same
    // way an in-use tracker's type is, just for a different reason.
    const isSleep = tracker && tracker.kind === 'sleep';
    const typeLocked = hasEntries || isSleep;

    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit tracker' : 'Add tracker'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Name</span>
          <input type="text" id="trkName" value="${tracker ? escapeHtml(tracker.name) : ''}" placeholder="e.g. Waist, Protein, Resting Heart Rate" maxlength="60" /></label>

        <div class="field">
          <span class="field-label">Value type${isSleep ? ' (fixed — Sleep also tracks quality)' : hasEntries ? ' (locked — has logged entries)' : ''}</span>
          <div class="segmented" id="trkUnitKindSegmentedA" role="radiogroup">
            ${['weight', 'length', 'percent'].map((k) => `<button type="button" data-unit-kind="${k}" role="radio" ${typeLocked && unitKind !== k ? 'disabled' : ''}>${UNIT_KIND_LABELS[k]}</button>`).join('')}
          </div>
          <div class="segmented" id="trkUnitKindSegmentedB" role="radiogroup">
            ${['hours', 'rating', 'count'].map((k) => `<button type="button" data-unit-kind="${k}" role="radio" ${typeLocked && unitKind !== k ? 'disabled' : ''}>${UNIT_KIND_LABELS[k]}</button>`).join('')}
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

        <div class="field">
          <span class="field-label">Dashboard <span class="muted-text">(as more trackers pile up, hide the ones you don't need to see every day)</span></span>
          <div class="segmented" id="trkShowOnDashboardSegmented" role="radiogroup">
            <button type="button" data-show="1" role="radio">Show</button>
            <button type="button" data-show="0" role="radio">Hide</button>
          </div>
        </div>

        <button type="button" class="btn btn-primary btn-block" id="saveTrackerBtn">${editing ? 'Save changes' : 'Add tracker'}</button>
        ${editing ? `<button type="button" class="btn btn-secondary btn-block" id="archiveTrackerToggleBtn">${tracker.archived ? 'Unarchive tracker' : 'Archive tracker'}</button>` : ''}
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteTrackerBtn">Delete tracker permanently</button>` : ''}
      </div>
    `);

    let selectedUnitKind = unitKind;
    let selectedDirection = direction;
    let selectedRatingMax = tracker && tracker.ratingMax ? tracker.ratingMax : 5;
    let selectedShowOnDashboard = tracker ? tracker.showOnDashboard !== false : true;

    function renderGoalField() {
      const wrap = document.getElementById('trkGoalFieldWrap');
      document.getElementById('trkUnitLabelField').hidden = selectedUnitKind !== 'count';
      const unitLabel = selectedUnitKind === 'count'
        ? (document.getElementById('trkUnitLabelInput').value.trim() || '')
        : unitLabelForKind(selectedUnitKind, selectedRatingMax);
      const v = tracker && tracker.goal != null ? trackerDisplayFromCanonical(tracker, tracker.goal) : '';
      wrap.innerHTML = `<label class="field"><span class="field-label">Goal ${unitLabel ? `(${unitLabel})` : ''} <span class="muted-text">(optional)</span></span>
        <input type="number" step="any" id="trkGoalInput" value="${v}" placeholder="Leave blank to just track" /></label>`;
    }

    function setUnitKindUI(k) {
      selectedUnitKind = k;
      document.querySelectorAll('#trkUnitKindSegmentedA button, #trkUnitKindSegmentedB button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitKind === k)));
      renderGoalField();
    }
    function setDirectionUI(d) {
      selectedDirection = d;
      document.querySelectorAll('#trkDirectionSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.direction === d)));
    }
    function setShowOnDashboardUI(show) {
      selectedShowOnDashboard = show;
      document.querySelectorAll('#trkShowOnDashboardSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.show === '1') === show)));
    }

    document.querySelectorAll('#trkUnitKindSegmentedA button, #trkUnitKindSegmentedB button').forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) setUnitKindUI(b.dataset.unitKind); });
    });
    document.querySelectorAll('#trkDirectionSegmented button').forEach((b) => b.addEventListener('click', () => setDirectionUI(b.dataset.direction)));
    document.querySelectorAll('#trkShowOnDashboardSegmented button').forEach((b) => b.addEventListener('click', () => setShowOnDashboardUI(b.dataset.show === '1')));
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
      const fields = { unitKind: selectedUnitKind, unitLabel, ratingMax: selectedUnitKind === 'rating' ? selectedRatingMax : null, direction: selectedDirection, showOnDashboard: selectedShowOnDashboard };
      const canonicalGoal = hasGoal ? trackerCanonicalFromDisplay(Object.assign({}, tracker, fields), rawGoal) : null;
      if (editing) {
        // A goal newly set on a tracker that doesn't already have a
        // baseline gets one now — the point it's starting from — so
        // trackerProgressPct() has something to measure movement against
        // instead of falling back to a plain (and misleading) ratio.
        const gettingFirstGoal = tracker.goal == null && canonicalGoal != null && tracker.baseline == null;
        Object.assign(tracker, { name }, fields, { goal: canonicalGoal });
        if (gettingFirstGoal) {
          const latest = latestMeasurement(trackerId);
          tracker.baseline = latest ? latest.value : null;
        }
      } else {
        state.trackers.push(Object.assign({ id: genId('trk'), name, archived: false, kind: 'metric', baseline: null, createdAt: new Date().toISOString() }, fields, { goal: canonicalGoal }));
      }
      save();
      closeModal();
      toast(editing ? 'Tracker updated' : 'Tracker added');
      renderAll();
    });

    if (editing) {
      document.getElementById('archiveTrackerToggleBtn').addEventListener('click', () => {
        tracker.archived = !tracker.archived;
        save();
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
          save(); closeModal(); toast('Tracker deleted'); renderAll();
        }, true);
      });
    }
  }

  /* ============================== Water: cup management ============================== */

  function cupRowHtml(cup) {
    return `
      <div class="entry-row is-manage" data-cup-id="${cup.id}">
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(cup.name)}</div>
          <div class="entry-row-sub">${fmtVolume(cup.amountMl)}</div>
        </div>
        <div class="entry-row-actions">
          <button class="btn btn-secondary btn-sm" data-action="edit-cup" data-id="${cup.id}">Edit</button>
        </div>
      </div>`;
  }

  function openCupForm(cupId) {
    const editing = !!cupId;
    const cup = editing ? cupById(cupId) : null;
    openModal(`
      <div class="modal-title-row"><h2>${editing ? 'Edit cup' : 'Add cup'}</h2><button class="modal-close" data-action="close-modal">${CLOSE_ICON_SVG}</button></div>
      <div class="form-card">
        <label class="field"><span class="field-label">Name</span>
          <input type="text" id="cupName" value="${cup ? escapeHtml(cup.name) : ''}" placeholder="e.g. Water bottle" maxlength="40" /></label>
        <label class="field"><span class="field-label">Amount (${Units.volumeUnitLabel()})</span>
          <input type="number" step="any" min="0" id="cupAmount" value="${cup ? round(Units.mlToDisplay(cup.amountMl), 1) : ''}" placeholder="e.g. 16" /></label>
        <button type="button" class="btn btn-primary btn-block" id="saveCupBtn">${editing ? 'Save changes' : 'Add cup'}</button>
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteCupBtn">Delete cup</button>` : ''}
      </div>
    `);
    document.getElementById('saveCupBtn').addEventListener('click', () => {
      const name = document.getElementById('cupName').value.trim();
      const raw = parseFloat(document.getElementById('cupAmount').value);
      if (!name) { toast('Give it a name.'); return; }
      if (Number.isNaN(raw) || raw <= 0) { toast('Enter an amount greater than zero.'); return; }
      const amountMl = Units.displayToMl(raw);
      if (editing) {
        cup.name = name;
        cup.amountMl = amountMl;
      } else {
        state.water.cups.push({ id: genId('cup'), name, amountMl });
      }
      save();
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
          save();
          closeModal();
          toast('Cup deleted');
          renderManage();
          renderDashboard();
          renderLogForm();
        }, true);
      });
    }
  }

  /* ============================== Manage ==============================
     One tab with three top-level sub-panels, switched by
     manageCategorySegmented: Exercises (the lift/reps/cardio definitions,
     previously listed in Settings), Measurements (the metric trackers from
     the section above), and Nutrition (Water's daily goal + cup sizes, and
     Food's per-macro daily-goal toggles), which itself nests a second
     Water/Food segmented control mirroring Log and History. All
     configuration lives here now; Settings (reached from the header) is
     app-wide preferences only. */

  let manageCategory = 'exercises';
  // Nutrition's nested sub-choice within Manage, mirroring Log/History's.
  let manageNutritionSub = 'water';

  function setManageCategory(cat) {
    manageCategory = cat;
    document.querySelectorAll('#manageCategorySegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.manageCat === cat)));
    document.getElementById('manageExercisesPanel').hidden = cat !== 'exercises';
    document.getElementById('manageMeasurementsPanel').hidden = cat !== 'measurements';
    document.getElementById('manageNutritionPanel').hidden = cat !== 'nutrition';
  }

  // Unlike Log/History (which only offer a sub while it's actually tracked
  // — see availableNutritionSubs), Manage always offers both Water and
  // Food: it's specifically where a turned-off feature gets turned back on
  // (add a cup here even with zero cups today; flip "Track food" back on
  // here even while Food is off), so it can't gate on the very thing it's
  // meant to change.
  const MANAGE_NUTRITION_SUBS = [{ id: 'water', label: 'Water' }, { id: 'food', label: 'Food' }];
  function setManageNutritionSub(sub) {
    manageNutritionSub = MANAGE_NUTRITION_SUBS.some((s) => s.id === sub) ? sub : 'water';
    document.getElementById('manageNutritionSubSegmented').innerHTML = nutritionSubTabsHtml(MANAGE_NUTRITION_SUBS, manageNutritionSub);
    document.getElementById('manageWaterPanel').hidden = manageNutritionSub !== 'water';
    document.getElementById('manageFoodPanel').hidden = manageNutritionSub !== 'food';
  }

  // Food's one piece of configuration: which macros are tracked at all, and
  // which of those have a daily goal (see the "Food / nutrition" section —
  // Calories is exempt from the tracking half, this only ever sets its
  // goal). Mirrors Water's own goal input right next to it under the same
  // Nutrition category.
  // The row markup is built once (guarded by wrap.dataset.built) rather
  // than on every render, for two reasons: MACRO_KEYS can grow (it already
  // has, from 4 to 7 fields) so this can't be hand-written static HTML the
  // way Water's fixed cup list can be, and rebuilding via innerHTML on
  // every single toggle click would blow away focus/in-progress typing in
  // any OTHER field's goal-amount input at the same time. Click/change are
  // wired once via delegation on the container instead of per-field
  // getElementById calls, so this never throws no matter how many (or few)
  // fields MACRO_KEYS lists.
  // The Nutrition calculator card just above the daily-goals list — options
  // list built once (same one-time-build reasoning as macroGoalRows below),
  // everything else refreshed every render since the live preview needs to
  // track whatever Profile/body-weight facts currently exist.
  function renderNutritionCalcCard() {
    const select = document.getElementById('nutritionActivityLevel');
    if (!select.dataset.built) {
      select.innerHTML = Object.keys(ACTIVITY_LEVELS)
        .map((k) => `<option value="${k}">${ACTIVITY_LEVELS[k].label} — ${ACTIVITY_LEVELS[k].hint}</option>`)
        .join('');
      select.dataset.built = '1';
    }
    const calc = state.settings.nutritionCalc;
    document.querySelectorAll('#nutritionCalcEnabledSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === calc.enabled)));
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

  function renderFoodManagePanel() {
    const tracked = state.settings.trackFood;
    document.querySelectorAll('#trackFoodSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === tracked)));
    document.getElementById('trackFoodOffHint').hidden = tracked;
    document.getElementById('foodTrackedFields').hidden = !tracked;
    if (!tracked) return;
    renderNutritionCalcCard();
    renderSavedFoodManageList();
    const wrap = document.getElementById('macroGoalRows');
    if (!wrap.dataset.built) {
      wrap.innerHTML = MACRO_KEYS.map((k) => `
        <div class="setting-row">
          <span>${MACRO_LABELS[k]} <span class="muted-text" data-macro-hint="${k}"></span></span>
          <div class="segmented" data-macro-goal-toggle="${k}" role="radiogroup" aria-label="${MACRO_LABELS[k]} ${k === 'calories' ? 'goal' : 'tracking'}">
            <button type="button" data-bool-choice="off" role="radio">Off</button>
            <button type="button" data-bool-choice="on" role="radio">On</button>
          </div>
        </div>
        <label class="field" data-macro-goal-field="${k}" hidden>
          <span class="field-label">Daily goal (${MACRO_UNITS[k] || 'cal'})</span>
          <input type="number" step="any" min="0" data-macro-goal-input="${k}" />
        </label>`).join('');
      wrap.dataset.built = '1';
      wrap.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-bool-choice]');
        const toggle = btn && btn.closest('[data-macro-goal-toggle]');
        if (!toggle) return;
        const k = toggle.dataset.macroGoalToggle;
        macroGoalInfo(k).enabled = btn.dataset.boolChoice === 'on';
        save();
        renderFoodManagePanel();
        renderDashboard();
      });
      wrap.addEventListener('change', (ev) => {
        const input = ev.target.closest('[data-macro-goal-input]');
        if (!input) return;
        const k = input.dataset.macroGoalInput;
        const raw = parseFloat(input.value);
        macroGoalInfo(k).goal = (!Number.isNaN(raw) && raw > 0) ? raw : null;
        save();
        renderDashboard();
      });
    }
    // Calories has no "not tracked" state (see macroTracked) — its toggle
    // only ever means "has a goal." Every other macro's toggle means both
    // "tracked at all" and, once on, optionally "has a goal" too.
    MACRO_KEYS.forEach((k) => {
      const info = macroGoalInfo(k);
      wrap.querySelectorAll(`[data-macro-goal-toggle="${k}"] button`).forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === info.enabled)));
      const field = wrap.querySelector(`[data-macro-goal-field="${k}"]`);
      if (field) field.hidden = !info.enabled;
      const input = wrap.querySelector(`[data-macro-goal-input="${k}"]`);
      if (input && document.activeElement !== input) input.value = info.goal != null ? info.goal : '';
      const hint = wrap.querySelector(`[data-macro-hint="${k}"]`);
      if (hint) {
        hint.textContent = k === 'calories'
          ? (info.enabled && info.goal != null ? `(goal: ${fmtMacroValue(k, info.goal)})` : '(always tracked)')
          : (!info.enabled ? '(not tracked)' : (info.goal != null ? `(goal: ${fmtMacroValue(k, info.goal)})` : '(tracked)'));
      }
    });
  }

  function renderExerciseManageList() {
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

  function trackerManageRowHtml(tracker) {
    return `
      <div class="entry-row is-manage" data-tracker-id="${tracker.id}">
        <div class="entry-row-main">
          <div class="entry-row-title">${escapeHtml(tracker.name)} ${tracker.archived ? '<span class="chip chip-archived">archived</span>' : ''}${tracker.showOnDashboard === false ? '<span class="chip">hidden from dashboard</span>' : ''}</div>
          <div class="entry-row-sub">${UNIT_KIND_LABELS[tracker.unitKind] || ''}${tracker.goal != null ? ` · ${trackerGoalLabel(tracker)}` : ' · no goal set'}</div>
        </div>
        <div class="entry-row-actions">
          ${tracker.archived ? `<button class="btn btn-secondary btn-sm" data-action="unarchive-tracker" data-id="${tracker.id}">Unarchive</button>` : ''}
          <button class="btn btn-secondary btn-sm" data-action="edit-tracker" data-id="${tracker.id}">Edit</button>
        </div>
      </div>`;
  }

  function renderTrackerManageList() {
    const wrap = document.getElementById('trackerManageList');
    wrap.innerHTML = state.trackers.map(trackerManageRowHtml).join('') || '<p class="muted-text">No trackers yet — add one to start tracking anything you like.</p>';
    wrap.querySelectorAll('[data-action="edit-tracker"]').forEach((btn) => btn.addEventListener('click', () => openTrackerForm(btn.dataset.id)));
    wrap.querySelectorAll('[data-action="unarchive-tracker"]').forEach((btn) => btn.addEventListener('click', () => {
      const t = trackerById(btn.dataset.id);
      if (!t) return;
      t.archived = false;
      save();
      toast('Tracker unarchived');
      renderAll();
    }));
  }

  function renderWaterManagePanel() {
    document.getElementById('waterGoalUnitLabel').textContent = Units.volumeUnitLabel();
    // Same re-render-clobbers-an-unsaved-field guard as the Profile height
    // field above.
    if (document.activeElement !== document.getElementById('waterGoalInput')) {
      document.getElementById('waterGoalInput').value = state.water.goalMl ? round(Units.mlToDisplay(state.water.goalMl), 1) : '';
    }
    const wrap = document.getElementById('cupManageList');
    wrap.innerHTML = state.water.cups.map(cupRowHtml).join('') || '<p class="muted-text">No cups yet.</p>';
    wrap.querySelectorAll('[data-action="edit-cup"]').forEach((btn) => btn.addEventListener('click', () => openCupForm(btn.dataset.id)));
  }

  function renderManage() {
    setManageCategory(manageCategory);
    setManageNutritionSub(manageNutritionSub);
    renderExerciseManageList();
    renderTrackerManageList();
    renderWaterManagePanel();
    renderFoodManagePanel();
  }

  /* ============================== Settings ============================== */

  function renderSettings() {
    document.querySelectorAll('#themeSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === state.settings.theme)));
    document.querySelectorAll('#weightUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.weightUnit)));
    document.querySelectorAll('#distanceUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.distanceUnit)));
    document.querySelectorAll('#lengthUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.lengthUnit)));
    document.querySelectorAll('#volumeUnitSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitChoice === state.settings.volumeUnit)));

    // Which height field to show follows the unit setting; the *values* in
    // them are deliberately NOT synced here — see syncProfileHeightInputs()
    // and openSettings() below for why: syncing on every render would
    // clobber a height the user just typed but hasn't saved yet, the moment
    // they tap the adjacent Sex control (which, like every other settings
    // control, saves instantly and re-renders this whole view).
    document.getElementById('profileHeightFieldCm').hidden = state.settings.lengthUnit !== 'cm';
    document.getElementById('profileHeightFieldFtIn').hidden = state.settings.lengthUnit === 'cm';
    document.querySelectorAll('#profileSexSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sexChoice === (state.profile.sex || ''))));

    document.querySelectorAll('#dashboardChartScaleSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scaleChoice === state.settings.chartScale)));
    document.querySelectorAll('#insightsWindowSegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.windowChoice === String(state.settings.insightsWindowDays))));
    document.querySelectorAll('#showWeightInsightsSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === state.settings.showWeightInsights)));
    document.querySelectorAll('#showStrengthLevelSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === state.settings.showStrengthLevel)));
    document.querySelectorAll('#showPaceLevelSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === state.settings.showPaceLevel)));
    document.querySelectorAll('#showSleepInsightsSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === state.settings.showSleepInsights)));
    document.querySelectorAll('#showMacroGuidanceSegmented button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.boolChoice === 'on') === state.settings.showMacroGuidance)));
  }

  /* ============================== Backup validation ==============================
     A hand-written shape/type check for an imported backup — deliberately
     lenient about fields older schema versions won't have yet (those get
     backfilled by runMigrations, same as a normal load()), but strict about
     type and about the enum-like fields the rest of the app switches on
     directly (kind, direction, ...), since a bad value there would otherwise
     surface as a rendering bug deep in the app instead of a clear rejection
     here. Returns an error string, or null when the shape is acceptable to
     hand to runMigrations(). Not a full re-implementation of every rule in
     the app (e.g. it won't catch a negative water goal) — it exists to
     reject garbage and hostile input, not to replace normal validation. */
  const VALID_EX_KINDS = new Set(['weight', 'reps', 'cardio']);
  const VALID_TRACKER_KINDS = new Set(['metric', 'sleep']);
  const VALID_DIRECTIONS = new Set(['up', 'down']);
  const VALID_SEX = new Set(['male', 'female']);
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function isNumOrNull(v) { return v == null || (typeof v === 'number' && Number.isFinite(v)); }

  function validateBackupShape(parsed) {
    if (!isPlainObject(parsed)) return 'This file isn’t a Fit Log backup.';
    if (parsed.version != null && !(typeof parsed.version === 'number' && parsed.version >= 1)) return 'Unrecognized backup version.';
    if (typeof parsed.version === 'number' && parsed.version > SCHEMA_VERSION) {
      return `This backup is from a newer version of Fit Log (v${parsed.version}) than this app supports (v${SCHEMA_VERSION}) — update the app before importing it.`;
    }

    if (!Array.isArray(parsed.exercises)) return 'Missing or invalid exercise list.';
    for (const ex of parsed.exercises) {
      if (!isPlainObject(ex) || typeof ex.id !== 'string' || typeof ex.name !== 'string') return 'One of the exercises is malformed.';
      if (ex.kind != null && !VALID_EX_KINDS.has(ex.kind)) return `Unknown exercise type “${ex.kind}”.`;
      if (!isNumOrNull(ex.goal) || !isNumOrNull(ex.distanceGoal) || !isNumOrNull(ex.paceGoal)) return `"${ex.name}" has an invalid goal value.`;
    }

    if (!Array.isArray(parsed.entries)) return 'Missing or invalid entry list.';
    for (const en of parsed.entries) {
      if (!isPlainObject(en) || typeof en.id !== 'string' || typeof en.exerciseId !== 'string') return 'One of the logged entries is malformed.';
      if (typeof en.date !== 'string' || !ISO_DATE_RE.test(en.date)) return 'One of the logged entries has an invalid date.';
      if (en.sets != null && !Array.isArray(en.sets)) return 'One of the logged entries has an invalid sets list.';
    }

    if (parsed.trackers != null) {
      if (!Array.isArray(parsed.trackers)) return 'Invalid tracker list.';
      for (const t of parsed.trackers) {
        if (!isPlainObject(t) || typeof t.id !== 'string' || typeof t.name !== 'string') return 'One of the trackers is malformed.';
        if (t.kind != null && !VALID_TRACKER_KINDS.has(t.kind)) return `Unknown tracker type “${t.kind}”.`;
        if (t.direction != null && !VALID_DIRECTIONS.has(t.direction)) return `Tracker "${t.name}" has an invalid direction.`;
        if (!isNumOrNull(t.goal) || !isNumOrNull(t.baseline)) return `Tracker "${t.name}" has an invalid goal value.`;
      }
    }

    if (parsed.measurements != null) {
      if (!Array.isArray(parsed.measurements)) return 'Invalid tracker-entry list.';
      for (const m of parsed.measurements) {
        if (!isPlainObject(m) || typeof m.id !== 'string' || typeof m.trackerId !== 'string') return 'One of the tracker entries is malformed.';
        if (typeof m.date !== 'string' || !ISO_DATE_RE.test(m.date)) return 'One of the tracker entries has an invalid date.';
        if (!isNumOrNull(m.value)) return 'One of the tracker entries has an invalid value.';
      }
    }

    if (parsed.water != null) {
      if (!isPlainObject(parsed.water) || !isNumOrNull(parsed.water.goalMl)) return 'Invalid water settings.';
      if (parsed.water.cups != null && !Array.isArray(parsed.water.cups)) return 'Invalid water cup list.';
    }
    if (parsed.waterEntries != null) {
      if (!Array.isArray(parsed.waterEntries)) return 'Invalid water-entry list.';
      for (const w of parsed.waterEntries) {
        if (!isPlainObject(w) || !isNumOrNull(w.amountMl) || typeof w.date !== 'string' || !ISO_DATE_RE.test(w.date)) return 'One of the water entries is malformed.';
      }
    }

    if (parsed.profile != null) {
      if (!isPlainObject(parsed.profile) || !isNumOrNull(parsed.profile.heightCm)) return 'Invalid profile data.';
      if (parsed.profile.sex != null && !VALID_SEX.has(parsed.profile.sex)) return 'Invalid sex value in profile.';
      if (parsed.profile.age != null && !isNumOrNull(parsed.profile.age)) return 'Invalid age value in profile.';
    }

    return null;
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
        // Imported data is untrusted — a hand-typed or corrupted file, or
        // one from somewhere other than this app's own Export — so its
        // shape is checked in full before it ever reaches runMigrations()
        // or state, not just spot-checked the way load()'s catch-all is.
        const shapeError = validateBackupShape(parsed);
        if (shapeError) { toast(`Can't import: ${shapeError}`); return; }
        confirmDialog('Replace all data?', 'Importing will overwrite everything currently in the app with this backup file.', 'Import', () => {
          parsed.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
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

  /* ============================== First-run setup wizard ==============================
     Shown exactly once — only when there is no saved data at all (see
     load() below) — instead of silently seeding the same fixed starter
     goals for everyone. It builds the same kind of shape defaultData()
     would, just tailored to what this person actually wants to track;
     anything skipped here is still addable later from Manage/Settings,
     exactly as if it had come from the old fixed defaults. */

  // The wizard's step list isn't fixed-length — it's computed fresh from
  // the Interests step's answers every time (see setupStepSequence below),
  // so `setupStepIndex` is an offset into whatever that sequence currently
  // is rather than a fixed 1-4 count. Turning an interest off doesn't just
  // hide content within a step the way the old per-step toggles did; the
  // whole step disappears from the sequence, so "Step 2 of 5" always
  // reflects only what's actually left to answer.
  let setupStepIndex = 0;
  let setupAnswers = {
    // What this install tracks at all (see renderSetupStepInterests) —
    // Lifting/Running/Body weight/Water default on (same as this app
    // always tracked before interests existed); Sleep/Food default off,
    // the actual declutter this step was for. Lifting also decides whether
    // the daily bodyweight-target exercises (push-ups/squats/pull-ups) get
    // seeded — those are exercise tracking too, not a separate concern.
    interests: { lifting: true, running: true, bodyweight: true, sleep: false, water: true, food: false },
    heightFt: '', heightIn: '', heightCm: '',
    weight: '', sex: '',
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
    insightsEnabled: false,
  };

  // Recomputed on every render rather than fixed at wizard start — its
  // first two entries (interests, about) are always present; everything
  // after depends on what got turned on in the Interests step, which can
  // only be (re)answered at index 0, so the sequence is always accurate by
  // the time the user reaches any later index. 'goals' is always last
  // (before Finish) even when both Water and Body weight are off, since
  // the Insight calculators toggle lives there regardless.
  function setupStepSequence() {
    const seq = ['interests', 'about'];
    if (setupAnswers.interests.lifting) seq.push('lifting');
    if (setupAnswers.interests.running) seq.push('running');
    seq.push('goals');
    return seq;
  }
  const SETUP_STEP_TITLES = { interests: 'What do you want to track?', about: 'About you', lifting: 'Lifting goals', running: 'Running goal', goals: 'Other goals' };

  // The topbar normally reserves the iOS notch/status-bar area itself (its
  // own top padding includes env(safe-area-inset-top) — see styles.css —
  // rather than an ancestor, since a sticky element must carry its own
  // safe-area padding or the inset gets lost the moment it scrolls to
  // top:0). Any screen that hides the topbar (the setup wizard, the
  // recovery screen) loses that protection and needs its own, via the
  // `#app.no-topbar` CSS rule these two helpers toggle.
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

  // A Settings-style on/off row (see e.g. #showWeightInsightsSegmented) —
  // every wizard toggle re-renders its whole step on change, since flipping
  // one always shows or hides other fields below it.
  function setupBoolRowHtml(id, label, checked) {
    return `<div class="setting-row"><span>${label}</span>
      <div class="segmented" id="${id}" role="radiogroup" aria-label="${label}">
        <button type="button" data-bool-choice="off" role="radio" aria-checked="${!checked}">Off</button>
        <button type="button" data-bool-choice="on" role="radio" aria-checked="${checked}">On</button>
      </div></div>`;
  }
  function wireSetupBoolRow(id, onChange) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => onChange(b.dataset.boolChoice === 'on')));
  }

  function renderSetupStep() {
    const seq = setupStepSequence();
    if (setupStepIndex >= seq.length) setupStepIndex = seq.length - 1; // interest turned off after passing its step — land on the new last step instead of an index that no longer exists
    const key = seq[setupStepIndex];
    document.getElementById('setupStepLabel').textContent = `Step ${setupStepIndex + 1} of ${seq.length} · ${SETUP_STEP_TITLES[key]}`;
    document.getElementById('setupBackBtn').hidden = setupStepIndex === 0;
    document.getElementById('setupNextBtn').textContent = setupStepIndex === seq.length - 1 ? 'Finish setup' : 'Next';
    if (key === 'interests') renderSetupStepInterests();
    else if (key === 'about') renderSetupStepAbout();
    else if (key === 'lifting') renderSetupStepLifting();
    else if (key === 'running') renderSetupStepRunning();
    else renderSetupStepGoals();
  }

  // Six independent on/off tiles rather than a radiogroup — any combination
  // is valid, including all-off (someone who just wants the bare workout
  // log with nothing else). Tapping a tile only flips its own answer and
  // re-renders this step; the sequence itself (and therefore which later
  // steps exist) is recomputed the next time Next/Back moves off this step.
  function interestTileHtml(key, icon, label, on) {
    return `<button type="button" class="domain-tab interest-tile" data-interest="${key}" aria-pressed="${on}">
      ${icon}
      <span>${label}</span>
    </button>`;
  }
  function renderSetupStepInterests() {
    const i = setupAnswers.interests;
    document.getElementById('setupContent').innerHTML = `
      <p class="muted-text">Tap to turn any of these on or off. Nothing here is permanent — everything stays changeable later in Manage and Settings.</p>
      <div class="interest-grid">
        ${interestTileHtml('lifting', DOMAIN_TAB_ICONS.workout, 'Lifting', i.lifting)}
        ${interestTileHtml('running', FOOTPRINTS_ICON_SVG, 'Running', i.running)}
        ${interestTileHtml('bodyweight', SCALE_ICON_SVG, 'Body weight', i.bodyweight)}
        ${interestTileHtml('sleep', MOON_ICON_SVG, 'Sleep', i.sleep)}
        ${interestTileHtml('water', WATER_DROP_ICON_SVG, 'Water', i.water)}
        ${interestTileHtml('food', APPLE_ICON_SVG, 'Food', i.food)}
      </div>`;
    document.querySelectorAll('#setupContent [data-interest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.interest;
        setupAnswers.interests[key] = !setupAnswers.interests[key];
        renderSetupStepInterests();
      });
    });
  }

  function renderSetupStepAbout() {
    const cm = state.settings.lengthUnit === 'cm';
    document.getElementById('setupContent').innerHTML = `
      <p class="muted-text">A couple of basics, both optional — used only to size your goals below and the optional insight calculators in Settings.</p>
      <div class="form-card">
        ${cm ? `
        <label class="field"><span class="field-label">Height (cm)</span>
          <input type="number" step="any" min="0" id="setupHeightCm" value="${escapeHtml(setupAnswers.heightCm)}" placeholder="Not set" /></label>
        ` : `
        <div class="field"><span class="field-label">Height (ft/in)</span>
          <div class="inline-time-fields">
            <input type="number" step="1" min="0" inputmode="numeric" id="setupHeightFt" value="${escapeHtml(setupAnswers.heightFt)}" placeholder="ft" />
            <input type="number" step="1" min="0" max="11" inputmode="numeric" id="setupHeightIn" value="${escapeHtml(setupAnswers.heightIn)}" placeholder="in" />
          </div>
        </div>
        `}
        <label class="field"><span class="field-label">Weight (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupWeight" value="${escapeHtml(setupAnswers.weight)}" placeholder="Not set" /></label>
        <div class="setting-row">
          <span>Sex <span class="muted-text">(for strength/pace benchmarks)</span></span>
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

  // Reached only when the Interests step turned Lifting on — no separate
  // "Track lifting goals" toggle here anymore (that decision already got
  // made). Content and wiring below are otherwise unchanged from before the
  // interests rework.
  function renderSetupStepLifting() {
    const lifts = setupAnswers.lifts;
    const canUseStandards = setupAnswers.weight !== '' && setupAnswers.sex !== '';
    document.getElementById('setupContent').innerHTML = `
        <p class="muted-text">Each lift can use a fixed plates goal, or a bodyweight-multiple standard${canUseStandards ? '' : ' (enter weight + sex in the previous step to unlock this)'}.</p>
        <div class="card form-card">
          ${['bench', 'squat', 'deadlift'].map((key) => {
            const lift = lifts[key];
            const bwLb = canUseStandards ? Units.displayToLb(parseFloat(setupAnswers.weight)) : null;
            const previewRows = (lift.mode === 'standard' && canUseStandards) ? standardGoalPreviewRows(key, bwLb, setupAnswers.sex) : null;
            return `
            <div class="form-card">
              <div class="setting-row">
                <span>${LIFT_TYPE_LABELS[key]}</span>
                <div class="segmented" data-lift-toggle="${key}" role="radiogroup" aria-label="Track ${LIFT_TYPE_LABELS[key]}">
                  <button type="button" data-bool-choice="off" role="radio" aria-checked="${!lift.enabled}">Off</button>
                  <button type="button" data-bool-choice="on" role="radio" aria-checked="${lift.enabled}">On</button>
                </div>
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
      if (toggleEl) toggleEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { lifts[key].enabled = b.dataset.boolChoice === 'on'; renderSetupStepLifting(); }));
      const modeEl = document.querySelector(`[data-lift-mode="${key}"]`);
      if (modeEl) modeEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) { lifts[key].mode = b.dataset.modeChoice; renderSetupStepLifting(); } }));
      const tierEl = document.querySelector(`[data-lift-tier="${key}"]`);
      if (tierEl) tierEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { lifts[key].tier = b.dataset.tierChoice; renderSetupStepLifting(); }));
    });
  }

  // Reached only when the Interests step turned Running on — see the
  // Lifting step's comment above for why there's no separate track/don't
  // track toggle here anymore either.
  function renderSetupStepRunning() {
    const t = setupAnswers.runningGoalType;
    document.getElementById('setupContent').innerHTML = `
      <div class="card form-card">
        <div class="setting-row">
          <span>Goal by</span>
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

  // Reached last, always — even when both Water and Body weight are off, so
  // the Insight-calculators toggle always has somewhere to live. No more
  // on/off toggle for Water or Body weight themselves here — the Interests
  // step already decided that; this step only asks about their goal.
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

  // Plain text/number inputs aren't captured until Back/Next is pressed
  // (unlike the toggles above, which write into setupAnswers immediately on
  // click since they also change what's on screen) — this is what reads
  // them just before the step changes. Keyed by the step's identity in the
  // (dynamic) sequence rather than a fixed number, same as everything else
  // in the wizard since the interests rework.
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
    } else if (key === 'running') {
      const distEl = document.getElementById('setupRunDistance');
      if (distEl) setupAnswers.runningDistance = distEl.value;
      const minEl = document.getElementById('setupRunPaceMin');
      if (minEl) setupAnswers.runningPaceMin = minEl.value;
      const secEl = document.getElementById('setupRunPaceSec');
      if (secEl) setupAnswers.runningPaceSec = secEl.value;
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
      return (!Number.isNaN(cmVal) && cmVal > 0) ? cmVal : null;
    }
    const totalIn = (parseFloat(setupAnswers.heightFt) || 0) * 12 + (parseFloat(setupAnswers.heightIn) || 0);
    return totalIn > 0 ? Units.displayToCm(totalIn) : null;
  }

  // Builds the real starting `state` from every answer collected above —
  // the wizard's equivalent of defaultData(), just tailored per-answer
  // instead of fixed. Runs exactly once, right before the very first save.
  function finishSetup() {
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
        });
      });
      // Daily bodyweight targets ride along with the Lifting interest — the
      // mockup's flow has no separate step for them, so they're exercise
      // tracking that follows Lifting rather than a concern of their own.
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

    const trackers = defaultTrackers();
    // Body weight / Sleep off reuses each tracker's own archived flag rather
    // than omitting the tracker entirely — the same mechanism Manage already
    // uses to hide a tracker, so re-enabling later is just an un-archive.
    if (!i.bodyweight) trackers.find((tr) => tr.id === 'trk_weight').archived = true;
    if (!i.sleep) trackers.find((tr) => tr.id === 'trk_sleep').archived = true;

    const measurements = [];
    if (weightLb != null) {
      // Seeded regardless of the Body weight interest: it's the one data
      // point behind BMI/strength-standard math elsewhere (currentBodyWeightLb()
      // and friends read state.measurements directly, unfiltered by whether
      // the tracker itself is archived), so hiding the tracker doesn't mean
      // that starting number should be thrown away.
      measurements.push({ id: genId('meas'), trackerId: 'trk_weight', date: todayISO(), value: weightLb, note: null });
      if (i.bodyweight && setupAnswers.weightGoalEnabled && setupAnswers.weightGoalValue !== '') {
        const targetLb = Units.displayToLb(parseFloat(setupAnswers.weightGoalValue));
        if (!Number.isNaN(targetLb)) {
          const weightTracker = trackers.find((tr) => tr.id === 'trk_weight');
          weightTracker.goal = targetLb;
          weightTracker.direction = targetLb < weightLb ? 'down' : 'up';
          weightTracker.baseline = weightLb; // the weight just entered above — the literal starting point
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
    state.settings.trackFood = i.food;

    save();
    showAppChrome();
    switchTab('dashboard');
    renderAll();
    toast('All set — welcome to Fit Log!');
  }

  /* ============================== Tabs / global wiring ============================== */

  // Hides every <section class="view"> except the one whose data-view
  // matches `tab`, updates the bottom tab bar's highlighted icon, and
  // re-renders that one tab so it always shows current data (rather than
  // whatever it last looked like). There's no real router here — with only
  // a handful of screens, "show this one, hide the rest" is simplest.
  // Settings has no tabbar button (it opens from the header gear icon
  // instead — see openSettings() below), so switching to it correctly
  // leaves every tab unhighlighted, which is the desired look for a screen
  // layered on top rather than a sixth peer tab.
  function switchTab(tab) {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'log') renderLogView();
    if (tab === 'history') renderHistory();
    if (tab === 'manage') renderManage();
    if (tab === 'settings') renderSettings();
  }

  // Settings is reached from the header gear icon rather than a bottom tab,
  // so it needs to remember which tab was active in order to return there
  // on close instead of always landing back on Dashboard.
  let lastTabBeforeSettings = 'dashboard';
  // One-time value sync for the Profile height field(s) (and, for the same
  // reason, Age), on entry only — see the comment in renderSettings() for
  // why this can't live in the general re-render path. Height is also
  // re-run whenever the length unit itself is switched (see wireEvents'
  // lengthUnitSegmented handler), since that changes which fields are shown
  // and what they should contain — unlike every other settings control,
  // that one *has* to resync the value.
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
    const activeTab = document.querySelector('.tab[aria-current="page"]');
    lastTabBeforeSettings = activeTab ? activeTab.dataset.tab : 'dashboard';
    switchTab('settings');
    syncProfileHeightInputs();
  }
  function closeSettings() {
    switchTab(lastTabBeforeSettings);
  }

  // The heavy-handed "just redraw everything" refresh, used after anything
  // that could affect more than one screen at once (import, unit change,
  // adding/editing/archiving an exercise or tracker). Cheap enough for how
  // little data this app holds — no need for more surgical updates.
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

    document.getElementById('logExercise').addEventListener('change', (ev) => {
      if (ev.target.value === '__add_new__') {
        openExerciseForm(null);
        ev.target.value = '';
        return;
      }
      renderDynamicFields(document.getElementById('logDynamicFields'), exerciseById(ev.target.value));
    });
    document.getElementById('logForm').addEventListener('submit', handleLogSubmit);

    // Reuses renderLogMeasurementForm() rather than re-deriving the label/
    // quality-field visibility here too — one place decides what a tracker
    // selection changes on screen.
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
    document.getElementById('historyCategorySegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      historyCategory = btn.dataset.historyCat;
      renderHistory();
    });
    document.getElementById('historyNutritionSubSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      historyNutritionSub = btn.dataset.nutritionSub;
      renderHistory();
    });
    document.getElementById('calPrevBtn').addEventListener('click', () => {
      calendarMonth.setMonth(calendarMonth.getMonth() - 1);
      renderHistoryCalendar();
    });
    document.getElementById('calNextBtn').addEventListener('click', () => {
      calendarMonth.setMonth(calendarMonth.getMonth() + 1);
      renderHistoryCalendar();
    });

    document.getElementById('manageCategorySegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      setManageCategory(btn.dataset.manageCat);
    });
    document.querySelectorAll('[data-action="add-exercise"]').forEach((btn) => btn.addEventListener('click', () => openExerciseForm(null)));
    document.querySelectorAll('[data-action="add-tracker"]').forEach((btn) => btn.addEventListener('click', () => openTrackerForm(null)));
    document.querySelectorAll('[data-action="add-cup"]').forEach((btn) => btn.addEventListener('click', () => openCupForm(null)));
    document.querySelectorAll('[data-action="add-saved-food"]').forEach((btn) => btn.addEventListener('click', () => openSavedFoodForm(null)));

    document.getElementById('manageNutritionSubSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      setManageNutritionSub(btn.dataset.nutritionSub);
    });

    // Macro/goal toggle + amount rows are wired inside renderFoodManagePanel()
    // itself (event delegation on #macroGoalRows, built once) rather than
    // here, since that list of fields can grow (it already has — see
    // MACRO_KEYS) and per-field getElementById wiring here would throw the
    // moment a field's static markup stopped existing.
    document.getElementById('saveWaterGoalBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('waterGoalInput').value);
      state.water.goalMl = (!Number.isNaN(raw) && raw > 0) ? Units.displayToMl(raw) : null;
      save();
      toast('Water goal saved');
      renderManage();
      renderDashboard();
    });

    // Master on/off for Food (Manage -> Nutrition -> Food) — mirrors
    // Water's own "off means zero cups" self-management: turning this off
    // hides Food from the dashboard and from Log/History (see
    // availableNutritionSubs), without touching any already-logged entries.
    document.getElementById('trackFoodSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.trackFood = btn.dataset.boolChoice === 'on';
      save();
      renderAll();
    });

    // Nutrition calculator (Manage -> Nutrition -> Food) — "Use calculator"
    // only shows/updates the live preview below; nothing is written into
    // macroGoals until "Apply to daily goals" is tapped (see the comment on
    // applyNutritionCalcTargets()).
    document.getElementById('nutritionCalcEnabledSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.nutritionCalc.enabled = btn.dataset.boolChoice === 'on';
      save();
      renderManage();
    });
    document.getElementById('nutritionActivityLevel').addEventListener('change', (ev) => {
      state.settings.nutritionCalc.activityLevel = ev.target.value;
      save();
      renderManage();
    });
    document.getElementById('nutritionGoalSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.nutritionCalc.goal = btn.dataset.goalChoice;
      save();
      renderManage();
    });
    document.getElementById('applyNutritionCalcBtn').addEventListener('click', () => {
      const calc = state.settings.nutritionCalc;
      const applied = applyNutritionCalcTargets(calc.activityLevel, calc.goal);
      if (!applied) { toast('Set your height, age, sex, and a logged body weight first.'); return; }
      save();
      toast('Calorie and protein goals applied');
      renderManage();
      renderDashboard();
    });

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
    document.getElementById('lengthUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.lengthUnit = btn.dataset.unitChoice; save(); renderAll();
      syncProfileHeightInputs(); // unit switch changes which fields show — this one has to resync
    });
    document.getElementById('volumeUnitSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.volumeUnit = btn.dataset.unitChoice; save(); renderAll();
    });

    document.getElementById('profileSexSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.profile.sex = btn.dataset.sexChoice || null;
      recomputeStandardGoals();
      save(); renderAll();
    });
    document.getElementById('saveProfileBtn').addEventListener('click', () => {
      let heightCm = null;
      if (state.settings.lengthUnit === 'cm') {
        const raw = parseFloat(document.getElementById('profileHeightCm').value);
        heightCm = (!Number.isNaN(raw) && raw > 0) ? raw : null;
      } else {
        const ft = parseFloat(document.getElementById('profileHeightFt').value) || 0;
        const inch = parseFloat(document.getElementById('profileHeightIn').value) || 0;
        const totalIn = ft * 12 + inch;
        heightCm = totalIn > 0 ? Units.displayToCm(totalIn) : null;
      }
      state.profile.heightCm = heightCm;
      const rawAge = parseInt(document.getElementById('profileAge').value, 10);
      state.profile.age = (!Number.isNaN(rawAge) && rawAge > 0) ? rawAge : null;
      save();
      toast('Profile saved');
      // Height/age both feed the nutrition calculator's live preview (see
      // computeNutritionTargets()) — renderAll() re-renders Manage -> Food's
      // panel too, so the preview reflects the new numbers immediately. It
      // does NOT re-apply them into macroGoals on its own: applying is
      // always the explicit "Apply to daily goals" button, so a Profile
      // edit never silently overwrites a goal the user has set (or since
      // hand-edited) via the calculator.
      renderAll();
    });

    document.getElementById('dashboardChartScaleSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.chartScale = btn.dataset.scaleChoice; save(); renderAll();
    });
    document.getElementById('insightsWindowSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.insightsWindowDays = parseInt(btn.dataset.windowChoice, 10); save(); renderAll();
    });
    document.getElementById('showWeightInsightsSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.showWeightInsights = btn.dataset.boolChoice === 'on'; save(); renderAll();
    });
    document.getElementById('showStrengthLevelSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.showStrengthLevel = btn.dataset.boolChoice === 'on'; save(); renderAll();
    });
    document.getElementById('showPaceLevelSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.showPaceLevel = btn.dataset.boolChoice === 'on'; save(); renderAll();
    });
    document.getElementById('showSleepInsightsSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.showSleepInsights = btn.dataset.boolChoice === 'on'; save(); renderAll();
    });
    document.getElementById('showMacroGuidanceSegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      state.settings.showMacroGuidance = btn.dataset.boolChoice === 'on'; save(); renderAll();
    });

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
     Shown instead of the normal app when load() couldn't make sense of an
     existing (non-empty) saved payload. Offers an explicit choice rather
     than silently discarding data that might still be salvageable. */

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
    load();
    // wireEvents() only ever attaches listeners (nothing here reads `state`
    // synchronously), so it's safe to wire even in recovery mode — that's
    // what makes the recovery screen's own confirm dialog (Cancel/✕) work.
    wireEvents();
    if (needsRecovery) { showRecoveryScreen(); registerServiceWorker(); return; }
    applyTheme();
    document.getElementById('logDate').value = todayISO();
    document.getElementById('logMeasurementDate').value = todayISO();
    if (needsSetup) startSetupWizard();
    else renderAll();
    registerServiceWorker();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker registration failed', e));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
