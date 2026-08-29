// Minimal dependency-free SVG chart helpers, following the dataviz skill's
// mark specs: 2px line, round joins, ~10% opacity area wash, >=8px end
// markers with a surface ring, dashed hairline goal reference, recessive axes.
// No categorical color decisions needed here — every chart in this app is a
// single-series magnitude trend, so it always uses the one accent hue (set
// via CSS custom properties / classes in styles.css), never re-picked per call.
//
// lineChart() is the one chart type in the app, used at both a compact size
// (dashboard cards) and a larger size (the exercise/tracker detail modals) —
// there used to be a separate tiny "sparkline" renderer for cards, but a
// smaller lineChart reads better (a real goal line and axis labels instead
// of a bare squiggle), so that's gone in favor of one chart every screen
// shares. The `width`/`height` opts only set the chart's internal drawing
// units and aspect ratio, not its rendered pixel size — the SVG itself
// always stretches to fill its container's actual width (see the aspect-
// ratio style set below), so a chart never falls short of a card's edges.

const Charts = (() => {

  function pathFromPoints(points) {
    if (!points.length) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  }

  function areaPathFromPoints(points, baselineY) {
    if (!points.length) return '';
    const top = pathFromPoints(points);
    const last = points[points.length - 1];
    const first = points[0];
    return `${top} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`;
  }

  // entries: array of { date: 'YYYY-MM-DD', value: number }, sorted ascending.
  function lineChart(entries, opts = {}) {
    const width = opts.width || 320;
    const height = opts.height || 160;
    const padL = 34, padR = 12, padT = 16, padB = 22;
    const goal = opts.goal;

    if (!entries.length) {
      return `<div class="chart-empty">No entries yet — log one to start your trend line.</div>`;
    }
    if (entries.length === 1) {
      const v = opts.formatValue ? opts.formatValue(entries[0].value) : entries[0].value;
      return `<div class="chart-empty">One entry logged (${v}). Log another to see a trend.</div>`;
    }

    const values = entries.map((e) => e.value);
    let min = Math.min(...values, goal != null ? goal : Infinity);
    let max = Math.max(...values, goal != null ? goal : -Infinity);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    min -= range * 0.08;
    max += range * 0.12;

    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const n = entries.length;
    const points = entries.map((e, i) => ({
      x: padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y: padT + innerH - ((e.value - min) / (max - min)) * innerH,
      raw: e,
    }));

    const line = pathFromPoints(points);
    const area = areaPathFromPoints(points, padT + innerH);
    const last = points[points.length - 1];
    const first = points[0];

    const fmtDate = (d) => {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const fmtVal = opts.formatValue || ((v) => v);

    let goalLine = '';
    if (goal != null && goal >= min && goal <= max) {
      const gy = padT + innerH - ((goal - min) / (max - min)) * innerH;
      goalLine = `<line x1="${padL}" y1="${gy.toFixed(2)}" x2="${width - padR}" y2="${gy.toFixed(2)}" class="chart-goal-line"></line>
        <text x="${width - padR}" y="${(gy - 4).toFixed(2)}" text-anchor="end" class="chart-axis-text">Goal ${fmtVal(goal)}</text>`;
    }

    // The SVG's box is sized purely in CSS (width:100%, height derived from
    // the aspect-ratio below) rather than a fixed pixel height, so the chart
    // always fills its container edge-to-edge instead of "meet" scaling
    // letterboxing it down to fit a mismatched fixed height.
    return `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;aspect-ratio:${width}/${height};display:block" role="img" aria-label="Progress over time">
        ${goalLine}
        <path d="${area}" class="chart-area"></path>
        <path d="${line}" class="chart-line"></path>
        ${points.map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" class="chart-dot"></circle>`).join('')}
        <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="4.5" class="chart-dot"></circle>
        ${opts.axisLabels === false ? '' : `
        <text x="${first.x.toFixed(2)}" y="${height - 4}" text-anchor="start" class="chart-axis-text">${fmtDate(first.raw.date)}</text>
        <text x="${last.x.toFixed(2)}" y="${height - 4}" text-anchor="end" class="chart-axis-text">${fmtDate(last.raw.date)}</text>`}
        <text x="${last.x.toFixed(2)}" y="${(last.y - 10).toFixed(2)}" text-anchor="end" class="chart-axis-text">${fmtVal(last.raw.value)}</text>
      </svg>`;
  }

  // A semicircular gauge for a single value classified into named zones
  // (currently just BMI, but written generically) — colored arc segments,
  // a needle pointing at the current value, and boundary tick labels.
  //
  // opts: { min, max, value (clamped to [min,max] for needle placement, but
  // the caller's own formatValue still shows the real, unclamped number),
  // segments: [{ from, to, className }] spanning [min,max] with no gaps,
  // ticks: [numbers to label], width, height, formatValue }.
  //
  // Geometry: the arc sweeps from angle 180° (value=min, pointing left) to
  // 0° (value=max, pointing right) over the top half of the circle, i.e.
  // angle = 180 - ((value-min)/(max-min))*180. A point at that angle and
  // radius r is (cx + r*cos, cy - r*sin) — the minus on y accounts for SVG's
  // downward-growing y axis, so 90° (mid-value) lands at the top of the arc
  // as expected. Every segment's start angle is >= its end angle (value
  // increases as angle decreases), which is a clockwise sweep on screen, so
  // every arc segment below uses the same fixed sweep-flag of 1.
  function gaugeChart(value, opts = {}) {
    const min = opts.min, max = opts.max;
    const width = opts.width || 300;
    const height = opts.height || 190;
    const cx = width / 2;
    const cy = height - 40;
    const r = Math.min(width / 2 - 20, cy - 30);

    const angleForValue = (v) => {
      const clamped = Math.max(min, Math.min(max, v));
      return 180 - ((clamped - min) / (max - min)) * 180;
    };
    const pointAt = (angleDeg, radius) => {
      const rad = (angleDeg * Math.PI) / 180;
      return { x: cx + radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
    };

    const segPaths = (opts.segments || []).map((seg) => {
      const p1 = pointAt(angleForValue(seg.from), r);
      const p2 = pointAt(angleForValue(seg.to), r);
      return `<path d="M${p1.x.toFixed(2)},${p1.y.toFixed(2)} A${r},${r} 0 0,1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)}" class="gauge-seg ${seg.className}"></path>`;
    }).join('');

    const needleTip = pointAt(angleForValue(value), r * 0.8);

    const tickText = (opts.ticks || []).map((t) => {
      const p = pointAt(angleForValue(t), r + 14);
      const anchor = p.x < cx - 2 ? 'start' : p.x > cx + 2 ? 'end' : 'middle';
      return `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" text-anchor="${anchor}" class="gauge-tick-text">${t}</text>`;
    }).join('');

    const fmt = opts.formatValue || ((v) => v);

    return `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;aspect-ratio:${width}/${height};display:block" role="img" aria-label="Gauge showing ${fmt(value)}">
        ${segPaths}
        <line x1="${cx}" y1="${cy}" x2="${needleTip.x.toFixed(2)}" y2="${needleTip.y.toFixed(2)}" class="gauge-needle"></line>
        <circle cx="${cx}" cy="${cy}" r="6" class="gauge-pivot"></circle>
        ${tickText}
        <text x="${cx}" y="${(cy - r * 0.4).toFixed(2)}" text-anchor="middle" class="gauge-value-text">${fmt(value)}</text>
      </svg>`;
  }

  return { lineChart, gaugeChart };
})();
