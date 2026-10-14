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

  /* ---- Strength --------------------------------------------------------- */

  // Bodyweight multiples of a one-rep max for [Beginner, Novice, Intermediate,
  // Advanced, Elite]. Community-published tables, not peer-reviewed.
  const TIER_LABELS = ['Untrained', 'Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
  const LIFT_STANDARDS = {
    bench: { label: 'Bench Press', male: [0.5, 0.75, 1.2, 1.6, 2.0], female: [0.3, 0.5, 0.85, 1.15, 1.5] },
    squat: { label: 'Squat', male: [0.75, 1.0, 1.65, 2.2, 2.75], female: [0.5, 0.75, 1.25, 1.75, 2.25] },
    deadlift: { label: 'Deadlift', male: [1.0, 1.25, 2.0, 2.5, 3.0], female: [0.65, 0.95, 1.5, 2.0, 2.5] },
  };

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

  // Pace ceilings in seconds per mile for [Elite, Advanced, Good, Recreational].
  const PACE_TIER_LABELS = ['Elite', 'Advanced', 'Good', 'Recreational', 'Building base'];
  const PACE_TIERS = { male: [390, 480, 570, 660], female: [450, 540, 630, 720] };

  /* ---- Body ------------------------------------------------------------- */

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

  /* ---- Sleep ------------------------------------------------------------ */

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

  /* ---- Nutrition -------------------------------------------------------- */

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

  /* ---- Streak ----------------------------------------------------------- */

  const STREAK_RULE = 'A day counts when you log anything in a section you track: a workout or habit, food, water or a body entry.';

  /* ---- References shown to the user -------------------------------------- */

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
      summary: 'Your best 1RM divided by body weight, compared with community-published bodyweight-ratio tables for bench, squat and deadlift, split by sex.',
      source: { label: 'Strength Level standards', url: 'https://strengthlevel.com/strength-standards' },
      caveat: 'These tables are not peer-reviewed. Use them as a rough guide.' },
    { id: 'pace', title: 'Pace levels', kind: 'assumption',
      summary: 'A rough recreational-runner heuristic: 6:30, 8:00, 9:30 and 11:00 per mile (men) and 7:30, 9:00, 10:30 and 12:00 (women) for Elite, Advanced, Good and Recreational.',
      source: null, caveat: 'No widely agreed pace chart exists. Treat as a loose guide.' },
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
      summary: 'New installs start at 2,000 ml (about 68 fl oz) a day. Change it in Manage > Water.',
      source: { label: 'NASEM Dietary Reference Intakes for water', url: 'https://doi.org/10.17226/10925' },
      caveat: 'The 2,000 ml starting point is the app\'s own. Total water needs include food and vary with size, heat and activity.' },
  ];

  const S = {
    version: '1.0.0',
    reviewed: '2026-10-14',
    LB_PER_KG,
    TIER_LABELS, LIFT_STANDARDS, ONE_RM_MAX_REPS, estimateOneRM,
    PACE_TIER_LABELS, PACE_TIERS,
    BMI_CATEGORIES, bmiFromKgCm, bmiCategory,
    SLEEP, sleepCategory,
    ACTIVITY_LEVELS, GOAL_ADJUST, CALORIE_FLOOR, restingEnergy, nutritionTargets,
    DAILY_VALUES, DV_OVER_FLAGS, DEFAULT_WATER_GOAL_ML,
    STREAK_RULE, REFERENCES,
  };
  Object.freeze(S);
  root.FitStandards = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
