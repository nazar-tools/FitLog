# Fit Log

An offline-first workout, nutrition and body tracker. Plain HTML, CSS and JavaScript: no build step, no framework, no dependencies. All data stays in the browser's localStorage (key `liftlog.v1`) and is never sent anywhere.

## Run it

Serve the folder over HTTP (service workers need it), for example `python3 -m http.server 8765`, then open `http://localhost:8765`. Install it to the home screen for offline use.

## Files

| File | Role |
| --- | --- |
| `index.html` | Every screen, as sections shown and hidden by `app.js`. |
| `css/styles.css` | All styling. Colours, radii, spacing (`--sp-*`) and type (`--fs-*`) are tokens in `:root`. |
| `js/app.js` | The UI: rendering, events, forms, the setup wizard. |
| `js/migrations.js` | Schema version and the version-to-version upgrades. |
| `js/units.js` | Unit conversion and number formatting. |
| `js/calc.js` | Streak, 7-night sleep summary, estimated 1RM, best reps, added-weight 1RM and the strength level. |
| `js/features.js` | Which areas are switched on (Lifting, Running & cardio, Daily, Home sections). |
| `js/strength-data.js` | Strength Level's bodyweight tables for 49 lifts and rep exercises (static data, with source and capture date). |
| `js/standards.js` | Reference tables and nutrition maths, tier lookup and running levels, with source links, a version and a review date. |
| `js/backup.js` | Validation of an imported backup. |
| `js/catalog.js` | Built-in exercise, habit and food catalog (one item per line). |
| `js/icons.js` | Icon set. |
| `js/charts.js` | SVG line charts. |
| `sw.js` | Service worker: network first, cache fallback, update prompt. |

## Common changes

- **Change the data shape.** Follow the recipe at the top of `js/migrations.js`: bump `SCHEMA_VERSION` and add a migration keyed by the old version. Prefer adding fields over changing old ones.
- **Refresh the strength tables.** Re-capture the "By Bodyweight" tables from strengthlevel.com into `js/strength-data.js` (keep the shape described at the top of that file), bump its `capturedOn`, and check that every tier rises and every library movement maps to a table.
- **Change a reference number.** Edit `js/standards.js`, update its `reviewed` date and `version`, and update the matching entry in `REFERENCES` (shown in Settings > About the numbers).
- **Add a catalog item.** Add one line to `js/catalog.js` and bump its `version`.
- **Log tabs open with a glance card.** `renderLogGlance` in `js/app.js` draws the two-line summary for each area; the streak rules (days, or weeks for workouts and weekly Body trackers) are next to it, with `computeWeekStreak` and `loggingRhythm` in `js/calc.js`.
- **Habits and daily reps live in Daily.** An exercise with `kind: 'habit'` or `section: 'daily'` shows in the Daily tab of Log, History and Manage (`isDailyEx` in `js/app.js`), not in Workout. Nothing was migrated: the same exercises and entries, shown in their own area. The on/off switch is still `settings.trackHabits`.
- **Ship a change.** Bump `CACHE_VERSION` in `sw.js` and list any new file in `APP_SHELL`.
