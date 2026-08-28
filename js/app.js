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
                                     that touch localStorage directly.
     Unit helpers                 – lb<->kg and mi<->km conversions, plus
                                     every number-formatting function
                                     (fmtWeight, fmtDistance, fmtPace, ...).
     Derived data                 – reading state.exercises/state.entries to
                                     answer questions like "what's the best
                                     set ever logged for this exercise?"
     Progressive-overload
       suggestion engine          – the "Next session" recommendation logic.
     Body & wellness trackers     – generic "log a number against an
                                     optional goal" trackers (weight, body
                                     fat %, and anything a user adds) — the
                                     scalable metric-tracking building
                                     block. Sleep is the one composite
                                     tracker (hours + a quality rating per
                                     entry, `kind: 'sleep'`). Height lives
                                     in Settings' Profile instead — it isn't
                                     something that trends over time, so
                                     it's a one-time fact, not a tracker.
     Insights & standards         – optional, off-by-default calculators
                                     (BMI, body-weight trend, strength-vs-
                                     bodyweight level, running-pace level)
                                     built on researched reference tables.
                                     Read the comment at the top of this
                                     section for sourcing and caveats
                                     before changing any threshold.
     Water                        – daily water intake: cups, totals,
                                     progress toward the daily goal.
     Theme                        – light/dark/system, and applying it to
                                     the page.
     Toast                        – the small "Entry saved" popup.
     Modal                        – the generic bottom-sheet popup shell
                                     that every other modal builds on top of.
     Dynamic set fields           – the weight/reps/cardio input rows shared
                                     by the Log tab and the edit-entry modal.
     Rendering: Dashboard         – the Goals cards, Body & wellness cards,
                                     and Water section on the home screen.
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

  const SCHEMA_VERSION = 6;

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
    // Next migration goes here, keyed `6: (data) => { ...; return data; }`.
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

  // Starter body/wellness trackers. Weight and Body Fat % are the plain
  // "log a number, optionally against a goal" shape (`kind: 'metric'`).
  // Sleep is the one composite tracker: one entry per night carries both
  // hours (`value`, this tracker's normal unitKind) and a 1-5 quality
  // rating (`quality`) — `kind: 'sleep'` is what tells the shared
  // rendering/logging code to show and read that second field; see the
  // "Body & wellness trackers" section below for where `kind` branches.
  // A future kind beyond these two (e.g. a yes/no daily habit checklist)
  // is a new `kind` value and a new branch, not a data-shape change for
  // existing trackers.
  function defaultTrackers() {
    const now = new Date().toISOString();
    return [
      { id: 'trk_weight', name: 'Weight', kind: 'metric', unitKind: 'weight', goal: null, direction: null, archived: false, createdAt: now },
      { id: 'trk_bodyfat', name: 'Body Fat %', kind: 'metric', unitKind: 'percent', goal: null, direction: null, archived: false, createdAt: now },
      { id: 'trk_sleep', name: 'Sleep', kind: 'sleep', unitKind: 'hours', goal: null, direction: null, archived: false, createdAt: now },
    ];
  }

  // A fixed fact about you rather than something with a history worth
  // charting — height doesn't change often enough to be a tracker (see the
  // v4->v5 migration above for how an existing Height tracker becomes
  // this). Both fields are optional and used only by the insight
  // calculators below (BMI, strength-vs-bodyweight, pace level) — the app
  // works fully without either ever being set.
  function defaultProfile() {
    return { heightCm: null, sex: null };
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
  };

  // The starting data for a brand-new install — already in the current
  // schema shape, so it never has to pass through the migrations above.
  function defaultData() {
    const now = new Date().toISOString();
    return {
      version: SCHEMA_VERSION,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      profile: defaultProfile(),
      exercises: [
        { id: 'ex_bench', name: 'Bench Press', kind: 'weight', bodyRegion: 'upper', section: 'goal', goal: PLATE_GOALS.bench, liftType: 'bench', archived: false, createdAt: now },
        { id: 'ex_squat', name: 'Squat', kind: 'weight', bodyRegion: 'lower', section: 'goal', goal: PLATE_GOALS.squat, liftType: 'squat', archived: false, createdAt: now },
        { id: 'ex_deadlift', name: 'Deadlift', kind: 'weight', bodyRegion: 'lower', section: 'goal', goal: PLATE_GOALS.deadlift, liftType: 'deadlift', archived: false, createdAt: now },
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

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
  const SECTION_LABELS = { goal: 'Goals', daily: 'Daily targets', accessory: 'Other exercises' };

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

  function fmtTrackerValue(tracker, v) {
    if (v == null || Number.isNaN(v)) return '—';
    switch (tracker.unitKind) {
      case 'weight': return fmtWeight(v);
      case 'length': return fmtLength(v);
      case 'percent': return `${round(v, 1)}%`;
      case 'hours': return `${round(v, 1)} hr`;
      case 'rating': return `${Math.round(v)}/${tracker.ratingMax || 5}`;
      default: return `${round(v, 1)}${tracker.unitLabel ? ' ' + tracker.unitLabel : ''}`;
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

  // Same shape as progressPct() for exercises: percent of goal reached,
  // "lower is better" when direction is 'down' (e.g. a body-fat % goal).
  function trackerProgressPct(tracker, value) {
    if (value == null || !tracker.goal) return { pct: 0, achieved: false };
    const pct = tracker.direction === 'down'
      ? (value <= 0 ? 0 : (tracker.goal / value) * 100)
      : (value / tracker.goal) * 100;
    return { pct: Math.max(0, pct), achieved: pct >= 100 };
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
  function trackerUnitLabel(tracker) {
    switch (tracker.unitKind) {
      case 'weight': return Units.weightUnitLabel();
      case 'length': return Units.lengthUnitLabel();
      case 'percent': return '%';
      case 'hours': return 'hr';
      case 'rating': return `/ ${tracker.ratingMax || 5}`;
      default: return tracker.unitLabel || '';
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
      const cutoffIso = cutoff.toISOString().slice(0, 10);
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

  // How a weight-based exercise's best lift compares to current
  // bodyweight, against the researched standards above — needs the lift
  // mapped to a known type (see the exercise form's "Lift type" field) and
  // both a bodyweight entry and a sex set in Profile.
  function strengthLevelInfo(ex) {
    if (ex.kind !== 'weight' || !ex.liftType || !LIFT_STANDARDS[ex.liftType]) return null;
    const bw = currentBodyWeightLb();
    if (!bw) return { needsBodyWeight: true };
    if (!state.profile.sex) return { needsSex: true };
    const liftBest = best(ex);
    if (liftBest == null) return null;
    const ratio = liftBest / bw;
    const table = LIFT_STANDARDS[ex.liftType][state.profile.sex];
    return { ratio, tier: classifyAscending(ratio, table, INSIGHT_TIER_LABELS), liftLabel: LIFT_STANDARDS[ex.liftType].label };
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

  // The OS status bar / address bar tint (the <meta name="theme-color"> tag)
  // is read by the browser chrome, not by CSS, so it can't reference a CSS
  // custom property directly. Rather than keeping a second hand-synced copy
  // of a color, this reads the resolved --page value straight off the page
  // — once the attributes above are set — so the status bar always matches
  // the app's actual background instead of a fixed accent color.
  function syncThemeColorMeta() {
    const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (page && meta) meta.setAttribute('content', page);
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

  // A muted one-line readout for an optional insight calculator — either
  // the result, or (when it needs a Profile fact that isn't set yet) a
  // short prompt telling you exactly what to add and where.
  function strengthLevelLineHtml(info) {
    if (!info) return '';
    if (info.needsBodyWeight) return `<div class="insight-line muted-text">Log your body weight to see your strength level.</div>`;
    if (info.needsSex) return `<div class="insight-line muted-text">Set your sex in Settings → Profile to see your strength level.</div>`;
    return `<div class="insight-line">${round(info.ratio, 2)}&times; bodyweight &middot; <strong>${info.tier}</strong></div>`;
  }
  function paceLevelLineHtml(info) {
    if (!info) return '';
    if (info.needsSex) return `<div class="insight-line muted-text">Set your sex in Settings → Profile to see your pace level.</div>`;
    return `<div class="insight-line">${fmtPace(info.pace)} &middot; <strong>${info.tier}</strong></div>`;
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
    const insightHtml = ex.kind === 'weight' && state.settings.showStrengthLevel ? strengthLevelLineHtml(strengthLevelInfo(ex))
      : ex.kind === 'cardio' && state.settings.showPaceLevel ? paceLevelLineHtml(paceLevelInfo(ex))
      : '';
    return `
      <div class="card ex-card" data-exercise-id="${ex.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${escapeHtml(ex.name)}</div>
          <div class="ex-card-badge">${kindBadge(ex)}</div>
        </div>
        ${progressHtml}
        ${chartPoints.length >= 2 ? `<div class="ex-card-chart">${Charts.lineChart(chartPoints, { goal: chartGoal, width: 300, height: 96, formatValue: (v) => formatValueForExercise(ex, v, trendMetric) })}</div>` : ''}
        ${insightHtml}
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
    const latest = latestMeasurement(tracker.id);
    const value = latest ? latest.value : null;
    const { pct, achieved } = trackerProgressPct(tracker, value);
    const fillPct = Math.min(100, pct);
    const history = measurementsFor(tracker.id).slice().sort((a, c) => a.date.localeCompare(c.date));
    const chartPoints = chartPointsFor(history, (m) => m.value);
    const insights = (tracker.id === BODY_WEIGHT_TRACKER_ID && state.settings.showWeightInsights) ? weightInsights() : null;
    const deltaBadge = insights && insights.trend
      ? `<div class="ex-card-delta is-${deltaSentiment(tracker, insights.trend.delta)}">${insights.trend.delta > 0 ? '+' : ''}${round(insights.trend.delta, 1)} ${Units.weightUnitLabel()} in ${humanizeDays(insights.trend.days)}</div>`
      : '';
    const bmiLine = insights && insights.bmi
      ? `<div class="insight-line">BMI ${insights.bmi.value} &middot; <strong>${insights.bmi.category}</strong></div>`
      : (insights && !insights.bmi && state.settings.showWeightInsights && tracker.id === BODY_WEIGHT_TRACKER_ID
          ? `<div class="insight-line muted-text">Set your height in Settings → Profile to see your BMI.</div>` : '');
    const qualityLine = tracker.kind === 'sleep' && latest && latest.quality != null
      ? `<div class="insight-line">Quality ${fmtQuality(latest.quality)}</div>` : '';
    return `
      <div class="card ex-card" data-tracker-id="${tracker.id}">
        <div class="ex-card-top">
          <div class="ex-card-name">${escapeHtml(tracker.name)}</div>
          ${deltaBadge}
        </div>
        <div class="ex-card-values">
          <div class="ex-card-current">${fmtTrackerValue(tracker, value)}</div>
          ${tracker.goal != null ? `<div class="ex-card-goal">/ ${trackerGoalLabel(tracker).replace('Goal ', '')}</div>` : ''}
        </div>
        ${tracker.goal != null ? `
          <div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${fillPct}%"></div></div>
          <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}%`}</span></div>` : ''}
        ${chartPoints.length >= 2 ? `<div class="ex-card-chart">${Charts.lineChart(chartPoints, { goal: tracker.goal, width: 300, height: 96, formatValue: (v) => fmtTrackerValue(tracker, v) })}</div>` : ''}
        ${qualityLine}
        ${bmiLine}
      </div>`;
  }

  function renderBodySection() {
    const trackers = activeTrackers();
    document.getElementById('bodySectionHead').hidden = trackers.length === 0;
    const wrap = document.getElementById('bodyCards');
    wrap.hidden = trackers.length === 0;
    wrap.innerHTML = trackers.map(trackerCardHtml).join('');
    wrap.querySelectorAll('[data-tracker-id]').forEach((card) => {
      card.addEventListener('click', () => openTrackerDetail(card.getAttribute('data-tracker-id')));
    });
  }

  function cupButtonsHtml() {
    return state.water.cups.map((cup) => `
      <button type="button" class="btn btn-secondary cup-btn" data-cup-id="${cup.id}">
        <span>${escapeHtml(cup.name)}</span><span class="cup-btn-amount">${fmtVolume(cup.amountMl)}</span>
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

  function renderDashboard() {
    renderSummary();
    const all = activeExercises();
    const goalList = all.filter((e) => sectionOf(e) === 'goal');
    const dailyDefined = all.filter((e) => sectionOf(e) === 'daily');
    // A daily target only earns a spot on the dashboard once you've
    // actually logged it today — otherwise it'd be a standing reminder
    // cluttering the goals page every day whether or not you got to it.
    // It's still fully definable/loggable/editable via Log/History/Manage
    // even on a day it doesn't show here.
    const dailyToday = dailyDefined.filter((e) => entriesFor(e.id).some((en) => en.date === todayISO()));
    // accessory exercises are intentionally omitted from the dashboard —
    // they're still fully logged/edited via the Log and History tabs.

    document.getElementById('dashboardEmpty').hidden = (goalList.length + dailyDefined.length) > 0;

    const cardsWrap = document.getElementById('exerciseCards');
    cardsWrap.innerHTML = goalList.map(goalCardHtml).join('');
    cardsWrap.querySelectorAll('.ex-card[data-exercise-id]').forEach((card) => {
      card.addEventListener('click', () => openExerciseDetail(card.getAttribute('data-exercise-id')));
    });

    document.getElementById('dailySectionHead').hidden = dailyToday.length === 0;
    const dailyWrap = document.getElementById('dailyList');
    dailyWrap.hidden = dailyToday.length === 0;
    dailyWrap.innerHTML = dailyToday.map(dailyRowHtml).join('');
    dailyWrap.querySelectorAll('.daily-row').forEach((row) => {
      row.addEventListener('click', () => openExerciseDetail(row.getAttribute('data-exercise-id')));
    });

    renderWaterSection();
    renderBodySection();
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

  // The Log tab covers three kinds of entry now — a workout set, a body
  // measurement, or water — switched by a segmented control at the top
  // rather than three separate tabs, since they're all "add one thing"
  // forms sharing the same "Recent entries" list below. A category is only
  // offered once there's something to log for it: Measurement needs at
  // least one tracker, Water needs at least one cup — both ship pre-seeded,
  // but stay hidden if the user deletes down to zero.
  let logCategory = 'workout';

  function availableLogCategories() {
    const cats = [{ id: 'workout', label: 'Workout' }];
    if (activeTrackers().length) cats.push({ id: 'measurement', label: 'Body' });
    if (state.water.cups.length) cats.push({ id: 'water', label: 'Water' });
    return cats;
  }

  function renderLogCategorySegmented() {
    const cats = availableLogCategories();
    if (!cats.some((c) => c.id === logCategory)) logCategory = cats[0].id;
    const seg = document.getElementById('logCategorySegmented');
    seg.innerHTML = cats.map((c) => `<button type="button" data-log-cat="${c.id}" role="radio">${c.label}</button>`).join('');
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
    const quality = tracker.kind === 'sleep' ? clampQuality(document.getElementById('logSleepQuality').value) : undefined;
    state.measurements.push({ id: genId('meas'), trackerId: tracker.id, date, value: trackerCanonicalFromDisplay(tracker, raw), quality, note: note || null });
    save();
    toast('Entry saved');
    document.getElementById('logMeasurementValue').value = '';
    document.getElementById('logSleepQuality').value = '';
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

  // Redraws whichever of the three Log sub-forms is currently selected,
  // plus the shared "Recent entries" list below it.
  function renderLogView() {
    renderLogCategorySegmented();
    document.getElementById('logForm').hidden = logCategory !== 'workout';
    document.getElementById('logMeasurementForm').hidden = logCategory !== 'measurement';
    document.getElementById('logWaterPanel').hidden = logCategory !== 'water';
    if (logCategory === 'workout') renderLogForm();
    if (logCategory === 'measurement') renderLogMeasurementForm();
    if (logCategory === 'water') renderLogWaterPanel();
    renderRecentEntries();
  }

  // "Recent entries" always reflects whichever Log category is active,
  // rather than always showing workouts — otherwise it would look broken
  // while logging water or a measurement.
  function renderRecentEntries() {
    const wrap = document.getElementById('recentEntries');
    if (logCategory === 'measurement') {
      const recent = state.measurements.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
      wrap.innerHTML = recent.length ? recent.map((m) => measurementRowHtml(m)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireMeasurementRowClicks(wrap);
      return;
    }
    if (logCategory === 'water') {
      const recent = state.waterEntries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 8);
      wrap.innerHTML = recent.length ? recent.map((e) => waterEntryRowHtml(e)).join('') : `<p class="muted-text">Nothing logged yet.</p>`;
      wireWaterEntryRowClicks(wrap);
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
      <div class="modal-title-row"><h2>Edit water entry</h2><button class="modal-close" data-action="close-modal">✕</button></div>
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
    return { workout, body, waterHit };
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
      const { workout, body, waterHit } = dayActivity(dateIso);
      const dots = [
        workout ? '<span class="cal-dot cal-dot-workout"></span>' : '',
        waterHit ? '<span class="cal-dot cal-dot-water"></span>' : '',
        body ? '<span class="cal-dot cal-dot-body"></span>' : '',
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

  // Everything logged on one day, across all three categories, each row
  // clickable straight into its own existing edit/delete modal — the
  // calendar's "click a day to see or edit its history" affordance.
  function openDayDetail(dateIso) {
    const workoutEntries = state.entries.filter((e) => e.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const measurements = state.measurements.filter((m) => m.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const waterEntries = state.waterEntries.filter((e) => e.date === dateIso).sort((a, b) => a.id.localeCompare(b.id));
    const nothingLogged = !workoutEntries.length && !measurements.length && !waterEntries.length;

    const dateLabel = new Date(dateIso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    openModal(`
      <div class="modal-title-row"><h2>${dateLabel}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
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
    `);
    const workoutList = document.getElementById('dayWorkoutList');
    if (workoutList) wireEntryRowClicks(workoutList);
    const measurementList = document.getElementById('dayMeasurementList');
    if (measurementList) wireMeasurementRowClicks(measurementList);
    const waterList = document.getElementById('dayWaterList');
    if (waterList) wireWaterEntryRowClicks(waterList);
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

  function renderHistoryCategorySegmented() {
    document.querySelectorAll('#historyCategorySegmented button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.historyCat === historyCategory));
    });
    document.getElementById('historyFilterField').hidden = historyCategory !== 'workout';
  }

  function renderHistory() {
    renderHistoryCalendar();
    renderHistoryCategorySegmented();
    const wrap = document.getElementById('historyList');

    if (historyCategory === 'measurement') {
      const list = state.measurements.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      document.getElementById('historyEmpty').hidden = list.length > 0;
      wrap.innerHTML = list.map((m) => measurementRowHtml(m)).join('');
      wireMeasurementRowClicks(wrap);
      return;
    }
    if (historyCategory === 'water') {
      const list = state.waterEntries.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      document.getElementById('historyEmpty').hidden = list.length > 0;
      wrap.innerHTML = list.map((e) => waterEntryRowHtml(e)).join('');
      wireWaterEntryRowClicks(wrap);
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
          ${sugg.method ? `<div class="suggestion-method">${SUGGESTION_METHOD_NOTE[sugg.method]} General heuristic, not personalized coaching — adjust for soreness, sleep, and stress.</div>` : ''}
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
    renderExerciseDetail(exId, state.settings.chartScale);
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
    }
    document.querySelectorAll('#exSectionSegmented button').forEach((b) => b.addEventListener('click', () => setSectionUI(b.dataset.section)));
    document.querySelectorAll('#exBodyRegionSegmented button').forEach((b) => b.addEventListener('click', () => setRegionUI(b.dataset.region)));
    document.querySelectorAll('#exLiftTypeSegmented button').forEach((b) => b.addEventListener('click', () => setLiftTypeUI(b.dataset.liftType)));
    setSectionUI(selectedSection);
    setRegionUI(selectedRegion);
    setLiftTypeUI(selectedLiftType);

    function renderGoalField() {
      const wrap = document.getElementById('goalFieldWrap');
      document.getElementById('bodyRegionField').hidden = selectedKind !== 'weight';
      document.getElementById('liftTypeField').hidden = selectedKind !== 'weight';
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
        if (selectedKind === 'weight') { ex.bodyRegion = selectedRegion; ex.liftType = selectedLiftType || null; } else { delete ex.bodyRegion; ex.liftType = null; }
        if (selectedKind === 'cardio') {
          ex.distanceGoal = distanceGoal;
          ex.paceGoal = paceGoal;
        }
        ex.goal = goal; // meaningful for weight/reps only; left null and unread for cardio
      } else {
        const newEx = { id: genId('ex'), name, kind: selectedKind, section: selectedSection, goal, archived: false, createdAt: new Date().toISOString() };
        if (selectedKind === 'weight') { newEx.bodyRegion = selectedRegion; newEx.liftType = selectedLiftType || null; }
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
      <div class="modal-title-row"><h2>Edit entry</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <p class="muted-text modal-subtitle">${escapeHtml(tracker ? tracker.name : 'Deleted tracker')}</p>
      <div class="form-card">
        <label class="field"><span class="field-label">Date</span><input type="date" id="editMeasurementDate" value="${m.date}" /></label>
        <label class="field"><span class="field-label">${isSleep ? 'Hours slept' : `Value${tracker ? ` (${trackerUnitLabel(tracker)})` : ''}`}</span>
          <input type="number" step="any" id="editMeasurementValue" value="${tracker ? trackerDisplayFromCanonical(tracker, m.value) : m.value}" /></label>
        ${isSleep ? `<label class="field"><span class="field-label">Sleep quality (1-5, optional)</span>
          <input type="number" step="1" min="1" max="5" id="editMeasurementQuality" value="${m.quality != null ? m.quality : ''}" /></label>` : ''}
        <label class="field"><span class="field-label">Note</span><input type="text" id="editMeasurementNote" value="${m.note ? escapeHtml(m.note) : ''}" maxlength="200" /></label>
        <div class="btn-row"><button class="btn btn-primary btn-block" id="saveMeasurementBtn">Save changes</button></div>
        <button class="btn btn-danger btn-block" id="deleteMeasurementBtn">Delete entry</button>
      </div>
    `);
    document.getElementById('saveMeasurementBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('editMeasurementValue').value);
      if (Number.isNaN(raw)) { toast('Enter a value.'); return; }
      m.date = document.getElementById('editMeasurementDate').value || m.date;
      m.value = tracker ? trackerCanonicalFromDisplay(tracker, raw) : raw;
      if (isSleep) m.quality = clampQuality(document.getElementById('editMeasurementQuality').value);
      m.note = document.getElementById('editMeasurementNote').value.trim() || null;
      save();
      closeModal();
      toast('Entry updated');
      renderRecentEntries(); renderDashboard(); renderHistory();
    });
    document.getElementById('deleteMeasurementBtn').addEventListener('click', () => {
      confirmDialog('Delete entry?', 'This can’t be undone.', 'Delete', () => {
        state.measurements = state.measurements.filter((x) => x.id !== measurementId);
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
    openModal(`
      <div class="modal-title-row"><h2>${escapeHtml(tracker.name)}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
      <div class="ex-card-values">
        <div class="ex-card-current">${fmtTrackerValue(tracker, value)}</div>
        ${tracker.goal != null ? `<div class="ex-card-goal">/ ${trackerGoalLabel(tracker).replace('Goal ', '')}</div>` : ''}
      </div>
      ${qualityLine}
      ${tracker.goal != null ? `<div class="meter"><div class="meter-fill ${achieved ? 'is-complete' : ''}" style="--fill:${Math.min(100, pct)}%"></div></div>
      <div class="ex-card-foot"><span class="ex-card-pct ${achieved ? 'is-complete' : ''}">${achieved ? '✓ Goal reached' : `${Math.round(pct)}% to goal`}</span></div>` : ''}

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
        <button class="btn btn-secondary" id="editTrackerBtn">Edit tracker</button>
        <button class="btn btn-secondary" id="archiveTrackerBtn">${tracker.archived ? 'Unarchive' : 'Archive'}</button>
      </div>

      <div class="section-head"><h2>All entries</h2></div>
      <div class="entry-list" id="trackerEntryList">${history.slice().reverse().map((m) => measurementRowHtml(m)).join('') || '<p class="muted-text">No entries yet.</p>'}</div>
    `);
    document.querySelectorAll('#trkChartScaleSegmented button').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.scale === scale));
      btn.addEventListener('click', () => renderTrackerDetail(trackerId, btn.dataset.scale));
    });
    wireMeasurementRowClicks(document.getElementById('trackerEntryList'));
    document.getElementById('editTrackerBtn').addEventListener('click', () => openTrackerForm(tracker.id));
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
      <div class="modal-title-row"><h2>${editing ? 'Edit tracker' : 'Add tracker'}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
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

        <button type="button" class="btn btn-primary btn-block" id="saveTrackerBtn">${editing ? 'Save changes' : 'Add tracker'}</button>
        ${editing ? `<button type="button" class="btn btn-secondary btn-block" id="archiveTrackerToggleBtn">${tracker.archived ? 'Unarchive tracker' : 'Archive tracker'}</button>` : ''}
        ${editing ? `<button type="button" class="btn-text-danger" id="deleteTrackerBtn">Delete tracker permanently</button>` : ''}
      </div>
    `);

    let selectedUnitKind = unitKind;
    let selectedDirection = direction;
    let selectedRatingMax = tracker && tracker.ratingMax ? tracker.ratingMax : 5;

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

    document.querySelectorAll('#trkUnitKindSegmentedA button, #trkUnitKindSegmentedB button').forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) setUnitKindUI(b.dataset.unitKind); });
    });
    document.querySelectorAll('#trkDirectionSegmented button').forEach((b) => b.addEventListener('click', () => setDirectionUI(b.dataset.direction)));
    document.getElementById('trkUnitLabelField').querySelector('input').addEventListener('input', renderGoalField);
    setUnitKindUI(selectedUnitKind);
    setDirectionUI(selectedDirection);

    document.getElementById('saveTrackerBtn').addEventListener('click', () => {
      const name = document.getElementById('trkName').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      const unitLabel = selectedUnitKind === 'count' ? (document.getElementById('trkUnitLabelInput').value.trim() || null) : null;
      const rawGoal = parseFloat(document.getElementById('trkGoalInput').value);
      const hasGoal = !Number.isNaN(rawGoal) && document.getElementById('trkGoalInput').value !== '';
      const fields = { unitKind: selectedUnitKind, unitLabel, ratingMax: selectedUnitKind === 'rating' ? selectedRatingMax : null, direction: selectedDirection };
      const canonicalGoal = hasGoal ? trackerCanonicalFromDisplay(Object.assign({}, tracker, fields), rawGoal) : null;
      if (editing) {
        Object.assign(tracker, { name }, fields, { goal: canonicalGoal });
      } else {
        state.trackers.push(Object.assign({ id: genId('trk'), name, archived: false, kind: 'metric', createdAt: new Date().toISOString() }, fields, { goal: canonicalGoal }));
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
      <div class="modal-title-row"><h2>${editing ? 'Edit cup' : 'Add cup'}</h2><button class="modal-close" data-action="close-modal">✕</button></div>
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
     One tab with three sub-panels, switched by manageCategorySegmented:
     Exercises (the lift/reps/cardio definitions, previously listed in
     Settings), Body (the metric trackers from the section above), and
     Water (daily goal + cup sizes). All configuration lives here now;
     Settings (reached from the header) is app-wide preferences only. */

  let manageCategory = 'exercises';

  function setManageCategory(cat) {
    manageCategory = cat;
    document.querySelectorAll('#manageCategorySegmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.manageCat === cat)));
    document.getElementById('manageExercisesPanel').hidden = cat !== 'exercises';
    document.getElementById('manageMeasurementsPanel').hidden = cat !== 'measurements';
    document.getElementById('manageWaterPanel').hidden = cat !== 'water';
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
          <div class="entry-row-title">${escapeHtml(tracker.name)} ${tracker.archived ? '<span class="chip chip-archived">archived</span>' : ''}</div>
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
    renderExerciseManageList();
    renderTrackerManageList();
    renderWaterManagePanel();
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

  let setupStep = 1;
  const SETUP_STEP_COUNT = 4;
  let setupAnswers = {
    heightFt: '', heightIn: '', heightCm: '',
    weight: '', sex: '',
    liftingEnabled: true,
    lifts: {
      bench: { enabled: true, mode: 'plates', tier: 'intermediate' },
      squat: { enabled: true, mode: 'plates', tier: 'intermediate' },
      deadlift: { enabled: true, mode: 'plates', tier: 'intermediate' },
    },
    runningEnabled: true,
    runningGoalType: 'distance',
    runningDistance: '5',
    runningPaceMin: '10',
    runningPaceSec: '0',
    waterEnabled: true,
    waterGoal: '',
    weightGoalEnabled: false,
    weightGoalValue: '',
    insightsEnabled: false,
  };

  function startSetupWizard() {
    setupStep = 1;
    document.getElementById('topbar').hidden = true;
    document.getElementById('tabbar').hidden = true;
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
    document.getElementById('setupBackBtn').hidden = setupStep === 1;
    document.getElementById('setupNextBtn').textContent = setupStep === SETUP_STEP_COUNT ? 'Finish setup' : 'Next';
    if (setupStep === 1) renderSetupStep1();
    else if (setupStep === 2) renderSetupStep2();
    else if (setupStep === 3) renderSetupStep3();
    else renderSetupStep4();
  }

  function renderSetupStep1() {
    document.getElementById('setupStepLabel').textContent = 'Step 1 of 4 · About you';
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
      b.addEventListener('click', () => { captureSetupStep(); setupAnswers.sex = b.dataset.sexChoice; renderSetupStep1(); });
    });
  }

  function renderSetupStep2() {
    document.getElementById('setupStepLabel').textContent = 'Step 2 of 4 · Lifting goals';
    const lifts = setupAnswers.lifts;
    const canUseStandards = setupAnswers.weight !== '' && setupAnswers.sex !== '';
    document.getElementById('setupContent').innerHTML = `
      ${setupBoolRowHtml('setupLiftingToggle', 'Track lifting goals', setupAnswers.liftingEnabled)}
      ${setupAnswers.liftingEnabled ? `
        <p class="muted-text">Each lift can use a fixed plates goal, or a bodyweight-multiple standard${canUseStandards ? '' : ' (enter weight + sex in step 1 to unlock this)'}.</p>
        <div class="card form-card">
          ${['bench', 'squat', 'deadlift'].map((key) => {
            const lift = lifts[key];
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
              </div>` : ''}` : ''}
            </div>`;
          }).join('')}
        </div>
      ` : ''}`;
    wireSetupBoolRow('setupLiftingToggle', (v) => { setupAnswers.liftingEnabled = v; renderSetupStep2(); });
    ['bench', 'squat', 'deadlift'].forEach((key) => {
      const toggleEl = document.querySelector(`[data-lift-toggle="${key}"]`);
      if (toggleEl) toggleEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { lifts[key].enabled = b.dataset.boolChoice === 'on'; renderSetupStep2(); }));
      const modeEl = document.querySelector(`[data-lift-mode="${key}"]`);
      if (modeEl) modeEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) { lifts[key].mode = b.dataset.modeChoice; renderSetupStep2(); } }));
      const tierEl = document.querySelector(`[data-lift-tier="${key}"]`);
      if (tierEl) tierEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { lifts[key].tier = b.dataset.tierChoice; renderSetupStep2(); }));
    });
  }

  function renderSetupStep3() {
    document.getElementById('setupStepLabel').textContent = 'Step 3 of 4 · Running goal';
    const t = setupAnswers.runningGoalType;
    document.getElementById('setupContent').innerHTML = `
      ${setupBoolRowHtml('setupRunningToggle', 'Track running', setupAnswers.runningEnabled)}
      ${setupAnswers.runningEnabled ? `
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
      </div>` : ''}`;
    wireSetupBoolRow('setupRunningToggle', (v) => { captureSetupStep(); setupAnswers.runningEnabled = v; renderSetupStep3(); });
    if (setupAnswers.runningEnabled) {
      document.querySelectorAll('#setupRunGoalType button').forEach((b) => b.addEventListener('click', () => {
        captureSetupStep(); // keep whatever's already typed before the field set changes shape
        setupAnswers.runningGoalType = b.dataset.typeChoice;
        renderSetupStep3();
      }));
    }
  }

  function renderSetupStep4() {
    document.getElementById('setupStepLabel').textContent = 'Step 4 of 4 · Other goals';
    document.getElementById('setupContent').innerHTML = `
      ${setupBoolRowHtml('setupWaterToggle', 'Water tracking', setupAnswers.waterEnabled)}
      ${setupAnswers.waterEnabled ? `<div class="card form-card">
        <label class="field"><span class="field-label">Daily water goal (${Units.volumeUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupWaterGoal" value="${escapeHtml(setupAnswers.waterGoal || round(Units.mlToDisplay(2000), 0))}" /></label>
      </div>` : ''}
      ${setupBoolRowHtml('setupWeightGoalToggle', 'Body weight goal', setupAnswers.weightGoalEnabled)}
      ${setupAnswers.weightGoalEnabled ? `<div class="card form-card">
        <label class="field"><span class="field-label">Target weight (${Units.weightUnitLabel()})</span>
          <input type="number" step="any" min="0" id="setupWeightGoal" value="${escapeHtml(setupAnswers.weightGoalValue)}" /></label>
      </div>` : ''}
      ${setupBoolRowHtml('setupInsightsToggle', 'Insight calculators (BMI, strength level, pace level)', setupAnswers.insightsEnabled)}
      <p class="muted-text">General published benchmarks, not personalized or medical advice — each can be turned off individually later in Settings → Insights.</p>`;
    wireSetupBoolRow('setupWaterToggle', (v) => { captureSetupStep(); setupAnswers.waterEnabled = v; renderSetupStep4(); });
    wireSetupBoolRow('setupWeightGoalToggle', (v) => { captureSetupStep(); setupAnswers.weightGoalEnabled = v; renderSetupStep4(); });
    wireSetupBoolRow('setupInsightsToggle', (v) => { captureSetupStep(); setupAnswers.insightsEnabled = v; renderSetupStep4(); });
  }

  // Plain text/number inputs aren't captured until Back/Next is pressed
  // (unlike the toggles above, which write into setupAnswers immediately on
  // click since they also change what's on screen) — this is what reads
  // them just before the step changes.
  function captureSetupStep() {
    if (setupStep === 1) {
      const cmEl = document.getElementById('setupHeightCm');
      if (cmEl) setupAnswers.heightCm = cmEl.value;
      const ftEl = document.getElementById('setupHeightFt');
      if (ftEl) setupAnswers.heightFt = ftEl.value;
      const inEl = document.getElementById('setupHeightIn');
      if (inEl) setupAnswers.heightIn = inEl.value;
      setupAnswers.weight = document.getElementById('setupWeight').value;
    } else if (setupStep === 3 && setupAnswers.runningEnabled) {
      const distEl = document.getElementById('setupRunDistance');
      if (distEl) setupAnswers.runningDistance = distEl.value;
      const minEl = document.getElementById('setupRunPaceMin');
      if (minEl) setupAnswers.runningPaceMin = minEl.value;
      const secEl = document.getElementById('setupRunPaceSec');
      if (secEl) setupAnswers.runningPaceSec = secEl.value;
    } else if (setupStep === 4) {
      const waterEl = document.getElementById('setupWaterGoal');
      if (waterEl) setupAnswers.waterGoal = waterEl.value;
      const goalEl = document.getElementById('setupWeightGoal');
      if (goalEl) setupAnswers.weightGoalValue = goalEl.value;
    }
  }

  function goSetupNext() {
    captureSetupStep();
    if (setupStep === SETUP_STEP_COUNT) { finishSetup(); return; }
    setupStep++;
    renderSetupStep();
  }
  function goSetupBack() {
    captureSetupStep();
    setupStep--;
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

    const exercises = [];
    if (setupAnswers.liftingEnabled) {
      ['bench', 'squat', 'deadlift'].forEach((key) => {
        const lift = setupAnswers.lifts[key];
        if (!lift.enabled) return;
        let goal = PLATE_GOALS[key];
        if (lift.mode === 'standard' && weightLb && sex) {
          const mult = LIFT_STANDARDS[key][sex][TIER_TO_INDEX[lift.tier]];
          goal = Math.round((weightLb * mult) / 5) * 5;
        }
        exercises.push({ id: `ex_${key}`, name: LIFT_TYPE_LABELS[key], kind: 'weight', bodyRegion: key === 'bench' ? 'upper' : 'lower', section: 'goal', goal, liftType: key, archived: false, createdAt: now });
      });
    }
    // Daily bodyweight targets are seeded unconditionally, same as the old
    // fixed defaults — the wizard's toggles are for the bigger goal-style
    // decisions (lifting/running/water/weight), not every single exercise.
    exercises.push(
      { id: 'ex_pushups', name: 'Push-ups', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
      { id: 'ex_bwsquats', name: 'Bodyweight Squats', kind: 'reps', section: 'daily', goal: 50, archived: false, createdAt: now },
      { id: 'ex_pullups', name: 'Pull-ups', kind: 'reps', section: 'daily', goal: 15, archived: false, createdAt: now },
    );
    if (setupAnswers.runningEnabled) {
      const t = setupAnswers.runningGoalType;
      const distanceGoal = t !== 'pace' ? Units.displayToMi(parseFloat(setupAnswers.runningDistance) || 5) : null;
      const paceSec = (parseInt(setupAnswers.runningPaceMin, 10) || 0) * 60 + (parseInt(setupAnswers.runningPaceSec, 10) || 0);
      const paceGoal = t !== 'distance' && paceSec > 0 ? Units.displaySecPerUnitToSecPerMi(paceSec) : null;
      exercises.push({ id: 'ex_running', name: 'Running', kind: 'cardio', section: 'goal', distanceGoal, paceGoal, goal: null, archived: false, createdAt: now });
    }

    const trackers = defaultTrackers();
    const measurements = [];
    if (weightLb != null) {
      measurements.push({ id: genId('meas'), trackerId: 'trk_weight', date: todayISO(), value: weightLb, note: null });
      if (setupAnswers.weightGoalEnabled && setupAnswers.weightGoalValue !== '') {
        const targetLb = Units.displayToLb(parseFloat(setupAnswers.weightGoalValue));
        if (!Number.isNaN(targetLb)) {
          const weightTracker = trackers.find((tr) => tr.id === 'trk_weight');
          weightTracker.goal = targetLb;
          weightTracker.direction = targetLb < weightLb ? 'down' : 'up';
        }
      }
    }

    const water = defaultWater();
    water.goalMl = null;
    if (setupAnswers.waterEnabled) {
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

    save();
    document.getElementById('topbar').hidden = false;
    document.getElementById('tabbar').hidden = false;
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
  // One-time value sync for the Profile height field(s), on entry only —
  // see the comment in renderSettings() for why this can't live in the
  // general re-render path. Also re-run whenever the length unit itself is
  // switched (see wireEvents' lengthUnitSegmented handler), since that
  // changes which fields are shown and what they should contain — unlike
  // every other settings control, that one *has* to resync the value.
  function syncProfileHeightInputs() {
    if (state.settings.lengthUnit === 'cm') {
      document.getElementById('profileHeightCm').value = state.profile.heightCm ? round(state.profile.heightCm, 1) : '';
    } else {
      const { ft, inch } = state.profile.heightCm ? cmToFtIn(state.profile.heightCm) : { ft: '', inch: '' };
      document.getElementById('profileHeightFt').value = ft;
      document.getElementById('profileHeightIn').value = inch;
    }
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

    document.getElementById('logWaterCustomAddBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('logWaterCustomAmount').value);
      if (Number.isNaN(raw) || raw <= 0) { toast('Enter an amount greater than zero.'); return; }
      logWaterAmount(Units.displayToMl(raw), null);
      document.getElementById('logWaterCustomAmount').value = '';
    });

    document.getElementById('historyFilter').addEventListener('change', renderHistory);
    document.getElementById('historyCategorySegmented').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      historyCategory = btn.dataset.historyCat;
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
    document.getElementById('saveWaterGoalBtn').addEventListener('click', () => {
      const raw = parseFloat(document.getElementById('waterGoalInput').value);
      state.water.goalMl = (!Number.isNaN(raw) && raw > 0) ? Units.displayToMl(raw) : null;
      save();
      toast('Water goal saved');
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
      save();
      toast('Profile saved');
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
    document.getElementById('logMeasurementDate').value = todayISO();
    wireEvents();
    if (needsSetup) startSetupWizard();
    else renderAll();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker registration failed', e));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
