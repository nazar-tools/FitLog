/* Unit conversion and display formatting.

   Data is stored in one canonical unit (pounds, miles, centimetres,
   millilitres, seconds per mile) whatever the Settings toggle says. `Units`
   converts to the selected display unit, so changing the toggle only ever
   changes presentation. create(getSettings) takes a function returning the
   current settings, which keeps this file free of app state. */
(function (root) {
  'use strict';

  function create(getSettings) {
    const LB_PER_KG = 0.45359237;
    const KM_PER_MI = 1.609344;
    const CM_PER_IN = 2.54;
    const ML_PER_FLOZ = 29.5735295625;

    // Sanity bounds for profile fields — generous enough to cover every real
    // human (and then some) while still catching fat-fingered or garbage
    // input like "999" years old or "40 ft" tall. Used by both the setup
    // wizard's About step and Settings' Profile card so the two can't drift.
    const MIN_AGE = 1;
    const MAX_AGE = 120;
    const MIN_HEIGHT_CM = 50;   // ~1'8"
    const MAX_HEIGHT_CM = 272;  // ~8'11"

    // Data is saved in one fixed ("canonical") unit — pounds for weight, miles
    // for distance/pace — regardless of the current Settings toggle. `Units`
    // is the only place that converts canonical to whichever unit is currently
    // selected for *display*. This split means the lb/kg or mi/km toggle can
    // only ever change presentation, never the logged history itself, and
    // entries stay comparable even if the unit is switched partway through.
    const Units = {
      lbToDisplay: (lb) => (getSettings().weightUnit === 'kg' ? lb * LB_PER_KG : lb),
      displayToLb: (v) => (getSettings().weightUnit === 'kg' ? v / LB_PER_KG : v),
      weightUnitLabel: () => getSettings().weightUnit,

      miToDisplay: (mi) => (getSettings().distanceUnit === 'km' ? mi * KM_PER_MI : mi),
      displayToMi: (v) => (getSettings().distanceUnit === 'km' ? v / KM_PER_MI : v),
      distanceUnitLabel: () => getSettings().distanceUnit,

      // pace stored canonically as seconds per mile
      secPerMiToDisplaySecPerUnit: (s) => (getSettings().distanceUnit === 'km' ? s / KM_PER_MI : s),
      displaySecPerUnitToSecPerMi: (s) => (getSettings().distanceUnit === 'km' ? s * KM_PER_MI : s),

      // Body-measurement lengths (height, waist, bicep, ...) canonically in
      // centimeters — a separate unit from running distance (miles/km above)
      // since inches/cm and miles/km are different scales for different things.
      cmToDisplay: (cm) => (getSettings().lengthUnit === 'cm' ? cm : cm / CM_PER_IN),
      displayToCm: (v) => (getSettings().lengthUnit === 'cm' ? v : v * CM_PER_IN),
      lengthUnitLabel: () => getSettings().lengthUnit,

      // Water volume canonically in milliliters.
      mlToDisplay: (ml) => (getSettings().volumeUnit === 'mL' ? ml : ml / ML_PER_FLOZ),
      displayToMl: (v) => (getSettings().volumeUnit === 'mL' ? v : v * ML_PER_FLOZ),
      volumeUnitLabel: () => (getSettings().volumeUnit === 'mL' ? 'mL' : 'fl oz'),
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
      // One decimal, trailing .0 dropped: 62.5 kg stays 62.5 (whole-number rounding made it
      // read 63), and 135 lb stays 135.
      return `${round(v, 1)} ${Units.weightUnitLabel()}`;
    }
    function fmtReps(n) {
      if (n == null || Number.isNaN(n)) return '—';
      return `${Math.round(n)} rep${Math.round(n) === 1 ? '' : 's'}`;
    }
    // A "timed" exercise is a bodyweight exercise measured in seconds held
    // (a plank). It is kind 'reps' with `unit: 'time'`; each set's `reps` field
    // then holds seconds, so existing storage, charts and PRs keep working.
    const isTimed = (ex) => !!ex && ex.kind === 'reps' && ex.unit === 'time';
    function fmtHold(sec) {
      if (sec == null || Number.isNaN(sec)) return '—';
      const t = Math.round(sec);
      return t < 90 ? `${t} s` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
    const fmtCount = (ex, n) => (isTimed(ex) ? fmtHold(n) : fmtReps(n));
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

    return {
      LB_PER_KG, KM_PER_MI, CM_PER_IN, ML_PER_FLOZ, MIN_AGE, MAX_AGE, MIN_HEIGHT_CM, MAX_HEIGHT_CM,
      Units, round, cmToFtIn, fmtWeight, fmtReps, isTimed, fmtHold, fmtCount, fmtDistance, fmtSecShort,
      fmtPace, fmtLength, fmtVolume, fmtDuration, localDateISO, todayISO, fmtDateShort,
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitUnits = api;
})(typeof window !== 'undefined' ? window : globalThis);
