/* Fit Log standards: every formula, threshold and reference number the app
   uses to interpret your data, in one place.

   Each entry says whether it is a published REFERENCE (a number from a named
   source) or an APP ASSUMPTION (a sensible default the app chose, with no
   single authoritative source). The Settings > "About the numbers" screen is
   built from REFERENCES below, so what you read there is what the code does.

   Pure data and pure functions: no DOM, no storage, no app state.
   Bump `version` and `reviewed` whenever a number or rule here changes. */
(function (root) {
  'use strict';

  const LB_PER_KG = 0.45359237;

  // Tier names, lowest first. "Untrained" is the band under the Beginner line.
  const TIER_LABELS = ['Untrained', 'Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];

  // Strength Level's tables, bodyweight-banded (js/strength-data.js). Each standard keeps
  // its published rows at a few bodyweights; a row is [Beginner, Novice, Intermediate,
  // Advanced, Elite]. Between rows the thresholds are interpolated in a straight line and
  // outside the first and last row they stay at that row's values.
  const DATA = root.FitStrengthData || (typeof module !== 'undefined' && module.exports ? require('./strength-data.js') : null);
  const STRENGTH = DATA ? DATA.standards : {};
  const STRENGTH_KEYS = Object.keys(STRENGTH);

  function interpolateRow(section, x) {
    const { bw, rows } = section;
    if (x <= bw[0]) return rows[0].slice();
    if (x >= bw[bw.length - 1]) return rows[rows.length - 1].slice();
    let i = 0;
    while (x > bw[i + 1]) i++;
    const t = (x - bw[i]) / (bw[i + 1] - bw[i]);
    return rows[i].map((v, j) => v + (rows[i + 1][j] - v) * t);
  }

  // The five thresholds for a standard, sex and body weight (lb), as whole numbers
  // (a rep count, or a weight in lb). `which` 'added' reads the added-weight table that
  // pull-ups, chin-ups and dips also have. Null when the standard, sex or body weight
  // is missing.
  function strengthThresholds(key, sex, bodyweightLb, which) {
    const std = STRENGTH[key];
    if (!std || !(sex === 'male' || sex === 'female') || !(bodyweightLb > 0)) return null;
    const table = which === 'added' ? std.added : std;
    if (!table) return null;
    return interpolateRow(table[sex], bodyweightLb).map((v) => Math.round(v));
  }
  // Index into TIER_LABELS (0 = Untrained .. 5 = Elite): how many thresholds the value reaches.
  function tierIndex(value, thresholds) {
    let n = 0;
    thresholds.forEach((t) => { if (value >= t) n += 1; });
    return n;
  }

  // Which standard an exercise uses: the catalog movement plus the equipment it is done
  // with (barbell and dumbbell bench have different tables, and dumbbell loads are per
  // hand). '*' is any equipment. Movements not listed have no chart.
  const CATALOG_STANDARDS = {
    cat_mv_bench_press: { barbell: 'bench', dumbbell: 'dumbbell-bench-press', smith: 'smith-machine-bench-press', machine: 'chest-press' },
    cat_mv_incline_press: { barbell: 'incline-bench-press', dumbbell: 'incline-dumbbell-bench-press' },
    cat_mv_close_grip_bench: { '*': 'close-grip-bench-press' },
    cat_mv_chest_fly: { dumbbell: 'dumbbell-fly', machine: 'machine-chest-fly' },
    cat_mv_pushups: { '*': 'push-ups' },
    cat_mv_dips: { '*': 'dips' },
    cat_mv_deadlift: { barbell: 'deadlift', trapbar: 'hex-bar-deadlift' },
    cat_mv_sumo_deadlift: { '*': 'sumo-deadlift' },
    cat_mv_row: { barbell: 'bent-over-row', dumbbell: 'dumbbell-row', cable: 'seated-cable-row' },
    cat_mv_t_bar_row: { '*': 't-bar-row' },
    cat_mv_lat_pulldown: { '*': 'lat-pulldown' },
    cat_mv_pullups: { '*': 'pull-ups' },
    cat_mv_chinups: { '*': 'chin-ups' },
    cat_mv_squat: { barbell: 'squat' },
    cat_mv_front_squat: { '*': 'front-squat' },
    cat_mv_bw_squats: { '*': 'bodyweight-squat' },
    cat_mv_hack_squat: { '*': 'hack-squat' },
    cat_mv_goblet_squat: { '*': 'goblet-squat' },
    cat_mv_bulgarian_split_squat: { '*': 'dumbbell-bulgarian-split-squat' },
    cat_mv_leg_press: { '*': 'sled-leg-press' },
    cat_mv_rdl: { barbell: 'romanian-deadlift' },
    cat_mv_leg_curl: { '*': 'lying-leg-curl' },
    cat_mv_seated_leg_curl: { '*': 'seated-leg-curl' },
    cat_mv_leg_ext: { '*': 'leg-extension' },
    cat_mv_hip_thrust: { barbell: 'hip-thrust' },
    cat_mv_calf_raise: { machine: 'machine-calf-raise' },
    cat_mv_ohp: { barbell: 'shoulder-press', dumbbell: 'dumbbell-shoulder-press', machine: 'machine-shoulder-press' },
    cat_mv_push_press: { '*': 'push-press' },
    cat_mv_lateral_raise: { dumbbell: 'dumbbell-lateral-raise' },
    cat_mv_shrugs: { dumbbell: 'dumbbell-shrug', barbell: 'barbell-shrug' },
    cat_mv_curl: { barbell: 'barbell-curl', dumbbell: 'dumbbell-curl' },
    cat_mv_preacher_curl: { '*': 'preacher-curl' },
    cat_mv_hammer_curl: { dumbbell: 'hammer-curl' },
    cat_mv_tricep_pushdown: { '*': 'tricep-pushdown' },
    cat_mv_skullcrusher: { barbell: 'lying-tricep-extension' },
    cat_mv_situps: { '*': 'sit-ups' },
    cat_mv_crunch: { bodyweight: 'crunches' },
  };
  // Bench, squat and deadlift keep the older short keys: exercises store them as `liftType`.
  function standardKeyFor(catalogId, equipment) {
    const map = CATALOG_STANDARDS[catalogId];
    if (!map) return null;
    return map[equipment] || map['*'] || null;
  }

  // The Epley formula (weight x (1 + reps/30)) is only reasonably accurate for
  // sets of about 10 reps or fewer; beyond that it drifts high. Sets above the
  // cap are ignored for strength levels and for 1RM-based goals.
  const ONE_RM_MAX_REPS = 10;

  // A logged single is a real lift (method 'actual'); anything else is
  // calculated (method 'estimated'). Returns null above the rep cap.
  function estimateOneRM(weight, reps) {
    if (!(weight > 0) || !(reps >= 1) || reps > ONE_RM_MAX_REPS) return null;
    if (reps === 1) return { value: weight, method: 'actual' };
    return { value: weight * (1 + reps / 30), method: 'estimated' };
  }

  // Running Level's 5K finish times (seconds) by age for [Beginner, Novice, Intermediate,
  // Advanced, Elite] (runninglevel.com/running-times/5k-times, captured 20 Oct 2026; the
  // site's own data runs to October 2026). Same percentile scale as the lifts: stronger
  // than about 5%, 20%, 50%, 80% and 95% of runners of that age and sex. Under 20 uses the
  // age-20 row, and between rows the times are interpolated.
  const RUN_TIER_LABELS = ['Building base', 'Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
  const RUN_5K = {
    ages: [20, 30, 40, 50, 60, 70, 80],
    male: [[1747, 1525, 1340, 1189, 1070], [1758, 1535, 1348, 1197, 1077], [1844, 1611, 1414, 1255, 1129], [1991, 1739, 1527, 1355, 1219], [2162, 1888, 1658, 1472, 1324], [2373, 2072, 1820, 1615, 1453], [2804, 2449, 2150, 1908, 1717]],
    female: [[2044, 1791, 1572, 1391, 1245], [2092, 1833, 1610, 1424, 1274], [2228, 1953, 1714, 1516, 1357], [2383, 2088, 1833, 1622, 1451], [2563, 2246, 1972, 1744, 1561], [2884, 2527, 2219, 1962, 1756], [3548, 3109, 2730, 2415, 2161]],
  };
  const DEFAULT_RUN_AGE = 25; // Running Level's adult baseline is the age-20 to 25 band
  const MI_PER_5K = 3.10686;
  const RUN_MIN_MI = 1;       // rated runs: one mile up to a marathon
  const RUN_MAX_MI = 26.3;
  // Peter Riegel's endurance formula: T2 = T1 x (D2 / D1) ^ 1.06. It turns any run into
  // the 5K time that effort is worth.
  function fiveKEquivalentSec(distanceMi, durationSec) {
    return durationSec * Math.pow(MI_PER_5K / distanceMi, 1.06);
  }
  function runThresholds(sex, age) {
    if (!(sex === 'male' || sex === 'female')) return null;
    const a = age > 0 ? age : DEFAULT_RUN_AGE;
    const rows = RUN_5K[sex];
    const ages = RUN_5K.ages;
    if (a <= ages[0]) return rows[0].slice();
    if (a >= ages[ages.length - 1]) return rows[rows.length - 1].slice();
    let i = 0;
    while (a > ages[i + 1]) i++;
    const t = (a - ages[i]) / (ages[i + 1] - ages[i]);
    return rows[i].map((v, j) => Math.round(v + (rows[i + 1][j] - v) * t));
  }
  // A run's level: null outside one mile to a marathon. tier is an index into
  // RUN_TIER_LABELS (0 = Building base .. 5 = Elite); thresholds are 5K seconds.
  function runLevel(sex, age, distanceMi, durationSec) {
    if (!(distanceMi >= RUN_MIN_MI && distanceMi <= RUN_MAX_MI) || !(durationSec > 0)) return null;
    const thresholds = runThresholds(sex, age);
    if (!thresholds) return null;
    const eq = fiveKEquivalentSec(distanceMi, durationSec);
    let tier = 0;
    thresholds.forEach((t) => { if (eq <= t) tier += 1; });
    return { equivalentSec: eq, tier, thresholds };
  }

  // CDC adult categories (age 20+). BMI ignores muscle mass, so it can read
  // high for people who lift.
  const BMI_CATEGORIES = [
    { max: 18.5, label: 'Underweight' },
    { max: 25, label: 'Healthy weight' },
    { max: 30, label: 'Overweight' },
    { max: Infinity, label: 'Obese' },
  ];
  function bmiFromKgCm(kg, cm) { const m = cm / 100; return kg / (m * m); }
  function bmiCategory(bmi) { return BMI_CATEGORIES.find((c) => bmi < c.max).label; }

  // Adults: 7 to 9 hours a night is the recommended range (NSF); 7 or more is
  // the AASM/SRS minimum. The app labels a night average against that range.
  const SLEEP = {
    windowDays: 7,          // recent calendar nights considered
    minNightsForLabel: 3,   // fewer logged nights than this: no label, just numbers
    categories: [
      { max: 6, label: 'Short', short: 'Short' },
      { max: 7, label: 'Slightly short', short: 'Low' },
      { max: 9.0000001, label: 'Adequate', short: 'Good' },
      { max: Infinity, label: 'Long', short: 'Long' },
    ],
  };
  function sleepCategory(hours) { return SLEEP.categories.find((c) => hours < c.max); }

  // Multipliers on resting energy (Mifflin-St Jeor). Standard "activity
  // factor" values; the choice of level is yours, so results are estimates.
  const ACTIVITY_LEVELS = {
    sedentary:  { label: 'Sedentary',         hint: 'little or no exercise',           multiplier: 1.2 },
    light:      { label: 'Light activity',    hint: 'exercise 1-3 days/week',          multiplier: 1.375 },
    moderate:   { label: 'Moderate activity', hint: 'exercise 3-5 days/week',          multiplier: 1.55 },
    active:     { label: 'Active',            hint: 'exercise 6-7 days/week',          multiplier: 1.725 },
    veryActive: { label: 'Very active',       hint: 'physical job or 2x/day training', multiplier: 1.9 },
  };
  // App assumptions: calorie change from maintenance and protein per pound of
  // body weight. Protein sits inside the 1.4 to 2.2 g/kg range reviewed for
  // people who train (ISSN), higher on a deficit to help hold muscle.
  const GOAL_ADJUST = {
    lose:     { calorieDelta: -500, proteinPerLb: 1.0 },
    maintain: { calorieDelta: 0,    proteinPerLb: 0.8 },
    gain:     { calorieDelta: 300,  proteinPerLb: 0.9 },
  };
  const CALORIE_FLOOR = 1200;

  function restingEnergy(weightLb, heightCm, age, sex) {
    const kg = weightLb * LB_PER_KG;
    return sex === 'male'
      ? 10 * kg + 6.25 * heightCm - 5 * age + 5
      : 10 * kg + 6.25 * heightCm - 5 * age - 161;
  }
  function nutritionTargets(weightLb, heightCm, age, sex, activityLevel, goal) {
    const tdee = restingEnergy(weightLb, heightCm, age, sex) * ACTIVITY_LEVELS[activityLevel].multiplier;
    const adjust = GOAL_ADJUST[goal];
    return {
      calories: Math.max(CALORIE_FLOOR, Math.round(tdee + adjust.calorieDelta)),
      protein: Math.round(weightLb * adjust.proteinPerLb),
      tdee: Math.round(tdee),
    };
  }

  // FDA Daily Values for a 2,000 calorie diet. Total sugar has NO Daily Value
  // (the 50 g figure is for ADDED sugar only), so it is deliberately absent.
  // Caffeine has no DV; 400 mg is the FDA's general consumer guidance.
  const DAILY_VALUES = { protein: 50, carbs: 275, fat: 78, sodium: 2300, caffeine: 400 };
  const DV_OVER_FLAGS = ['sodium', 'caffeine'];
  const DEFAULT_WATER_GOAL_ML = 2000; // app assumption; see REFERENCES

  // Drinking-water guide from body size. Body surface area (Mosteller: sqrt(cm x kg / 3600))
  // times ML_PER_M2 gives a baseline; an activity level then adds to it. 1,500 ml per m2
  // reproduces the NASEM beverage figures at the reference adults (about 3.0 L for a
  // 1.77 m, 70 kg man and 2.2 L for a 1.63 m, 57 kg woman), so one sex-free formula covers both.
  // The activity add-ons are app assumptions (sweat losses run about 0.5 to 1 L per hour of
  // hard exercise). The result is rounded to 50 ml and kept between 1,000 and 5,000 ml.
  const ML_PER_M2 = 1500;
  const WATER_ACTIVITY = {
    low:      { label: 'Light',    hint: 'Mostly sitting, little exercise.',   addMl: 0 },
    moderate: { label: 'Moderate', hint: 'A few workouts a week.',             addMl: 350 },
    high:     { label: 'Heavy',    hint: 'Most days, or very sweaty sessions.', addMl: 700 },
  };
  const WATER_MIN_ML = 1000;
  const WATER_MAX_ML = 5000;
  function bodySurfaceArea(weightLb, heightCm) {
    return Math.sqrt((heightCm * weightLb * LB_PER_KG) / 3600);
  }
  function waterTarget(weightLb, heightCm, activity) {
    const level = WATER_ACTIVITY[activity] || WATER_ACTIVITY.low;
    const bsa = bodySurfaceArea(weightLb, heightCm);
    const raw = bsa * ML_PER_M2 + level.addMl;
    const ml = Math.min(WATER_MAX_ML, Math.max(WATER_MIN_ML, Math.round(raw / 50) * 50));
    return { ml, bsa: Math.round(bsa * 100) / 100 };
  }

  const STREAK_RULE = 'A day counts when you log anything in a section you track: a workout or habit, food, water or a body entry.';

  const REFERENCES = [
    { id: 'streak', title: 'Day streak', kind: 'assumption',
      summary: STREAK_RULE + ' Today may be empty without breaking the streak until the day ends.',
      source: null },
    { id: 'sleep', title: 'Sleep range', kind: 'reference',
      summary: 'Adults: 7 to 9 hours a night. Under 6 is labelled Short, 6 to under 7 Slightly short, 7 to 9 Adequate, over 9 Long. The main average covers the last 7 calendar nights and needs at least 3 logged; a separate line averages your last logged nights, whenever they were.',
      source: { label: 'Hirshkowitz et al. 2015 (NSF), Sleep Health', url: 'https://doi.org/10.1016/j.sleh.2014.12.010' },
      alt: { label: 'Watson et al. 2015 (AASM/SRS), SLEEP', url: 'https://doi.org/10.5665/sleep.4716' },
      caveat: 'Needs vary by person. This is not a medical assessment.' },
    { id: 'oneRM', title: 'Estimated 1RM', kind: 'reference',
      summary: 'Epley formula: weight x (1 + reps / 30). Only sets of ' + ONE_RM_MAX_REPS + ' reps or fewer are used, because the estimate drifts high on longer sets. A set of one rep is a real lift and is labelled as such; everything else is calculated.',
      source: { label: 'Epley, B. (1985) Poundage Chart, Boyd Epley Workout', url: null },
      caveat: 'An estimate, not a tested max.' },
    { id: 'liftLevels', title: 'Strength levels', kind: 'assumption',
      summary: 'Your best set against Strength Level\'s tables for your sex and exact body weight (blended between published rows). Each table has five lines: Beginner is stronger than about 5% of lifters, Novice 20%, Intermediate 50%, Advanced 80% and Elite 95%. Weight lifts use your best estimated 1RM (or best single). Rep exercises such as push-ups, pull-ups, dips and chin-ups use your best reps in one set; where the site has a table, pull-ups, chin-ups and dips also count added weight (1RM of the added load, from body weight plus the extra). Dumbbell tables are per dumbbell. Which table an exercise uses follows its movement and equipment (barbell and dumbbell bench differ).',
      source: { label: 'Strength Level standards (user-submitted lifts, to March 2026)', url: 'https://strengthlevel.com/strength-standards' },
      alt: { label: 'van den Hoek et al. 2024, J Sci Med Sport (competition squat, bench, deadlift)', url: 'https://doi.org/10.1016/j.jsams.2024.07.005' },
      caveat: 'These tables come from lifters who log on one site, not from a study, and no accuracy figure is published. They suit a rough guide. The peer-reviewed paper covers only the three powerlifts and only competitors, so its values run higher.' },
    { id: 'runLevels', title: 'Running levels', kind: 'assumption',
      summary: 'Each run from one mile to a marathon is turned into the 5K time that effort is worth (Riegel: time x (5K / distance) ^ 1.06), then compared with Running Level\'s 5K times for your age and sex: Beginner is faster than about 5% of runners, Novice 20%, Intermediate 50%, Advanced 80% and Elite 95%. Age is optional (without it the age-25 row is used). Your best run counts.',
      source: { label: 'Running Level 5K standards (community runs, to October 2026)', url: 'https://runninglevel.com/running-times/5k-times' },
      alt: { label: 'Riegel, P. (1981) Athletic Records and Human Endurance, American Scientist', url: null },
      caveat: 'Community data, not a study, and a 5K-equivalent is an estimate: it drifts for runs far from 5K and for untrained pacing.' },
    { id: 'bmi', title: 'BMI', kind: 'reference',
      summary: 'Weight in kg divided by height in metres squared. Under 18.5 Underweight, 18.5 to under 25 Healthy weight, 25 to under 30 Overweight, 30 and over Obese (adults 20+).',
      source: { label: 'CDC adult BMI categories', url: 'https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html' },
      caveat: 'BMI ignores muscle mass, so it can read high for people who lift. Not for under 20s.' },
    { id: 'calories', title: 'Calorie target', kind: 'reference',
      summary: 'Resting energy from the Mifflin-St Jeor equation (10 x kg + 6.25 x cm - 5 x age, +5 for men or -161 for women), times an activity factor of 1.2 to 1.9 that you choose. Losing weight subtracts 500, gaining adds 300, and the result never goes below 1,200.',
      source: { label: 'Mifflin et al. 1990, Am J Clin Nutr', url: 'https://doi.org/10.1093/ajcn/51.2.241' },
      caveat: 'The activity factors, the -500 / +300 steps and the 1,200 floor are app assumptions. Real needs vary.' },
    { id: 'protein', title: 'Protein target', kind: 'assumption',
      summary: 'Body weight in pounds times 1.0 (losing), 0.8 (maintaining) or 0.9 (gaining) grams. That is about 1.8 to 2.2 g per kg, inside the 1.4 to 2.0+ g/kg range reviewed for people who train.',
      source: { label: 'Jager et al. 2017 (ISSN position stand)', url: 'https://doi.org/10.1186/s12970-017-0177-8' },
      caveat: 'Higher than the 0.8 g/kg minimum (RDA). People with kidney disease should ask their clinician.' },
    { id: 'dv', title: 'Daily Values (%DV)', kind: 'reference',
      summary: 'Protein 50 g, carbs 275 g, fat 78 g and sodium 2,300 mg, for a 2,000 calorie diet. Caffeine is shown against 400 mg, the FDA general guidance. Total sugar has no Daily Value (the FDA 50 g figure is for added sugar only), so no %DV is shown for it.',
      source: { label: 'FDA Daily Value reference', url: 'https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels' },
      alt: { label: 'FDA caffeine guidance', url: 'https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much' },
      caveat: 'General values, not personalized.' },
    { id: 'water', title: 'Water goal', kind: 'assumption',
      summary: 'The setup guide takes your body surface area (Mosteller: square root of height in cm times weight in kg, divided by 3,600) times 1,500 ml, then adds 0, 350 or 700 ml for the activity level you pick, rounded to 50 ml. Anyone who skips the guide starts at 2,000 ml (about 68 fl oz) a day. Change it any time in Manage > Water.',
      source: { label: 'NASEM Dietary Reference Intakes for water', url: 'https://doi.org/10.17226/10925' },
      caveat: 'The 1,500 ml per m2 scale matches the NASEM beverage figures for reference adults; the activity add-ons and the 2,000 ml default are the app\'s own. Total water needs include food and vary with heat, health and pregnancy.' },
  ];

  const S = {
    version: '2.0.0',
    reviewed: '2026-10-20',
    LB_PER_KG,
    TIER_LABELS, STRENGTH, STRENGTH_KEYS, strengthThresholds, tierIndex, CATALOG_STANDARDS, standardKeyFor,
    ONE_RM_MAX_REPS, estimateOneRM,
    RUN_TIER_LABELS, RUN_5K, RUN_MIN_MI, RUN_MAX_MI, DEFAULT_RUN_AGE, fiveKEquivalentSec, runThresholds, runLevel,
    BMI_CATEGORIES, bmiFromKgCm, bmiCategory,
    SLEEP, sleepCategory,
    ACTIVITY_LEVELS, GOAL_ADJUST, CALORIE_FLOOR, restingEnergy, nutritionTargets,
    DAILY_VALUES, DV_OVER_FLAGS, DEFAULT_WATER_GOAL_ML,
    ML_PER_M2, WATER_ACTIVITY, WATER_MIN_ML, WATER_MAX_ML, bodySurfaceArea, waterTarget,
    STREAK_RULE, REFERENCES,
  };
  Object.freeze(S);
  root.FitStandards = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
