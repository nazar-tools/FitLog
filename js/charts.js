// Small dependency-free SVG chart helpers.
// lineChart() is the compact trend used on goal cards and detail sheets. columns(), line() and
// heatmap() draw the Progress charts: a viewBox as wide as the card (setWidth), one axis,
// hairline grid, and only goals dashed. Each returns markup for a .chart-box; wire() then
// adds the press-and-hold (or hover, or arrow key) readout using the tips registered for it.

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
    // X position by actual elapsed time between the first and last logged
    // date, not by index -  a plain index spacing put every entry the same
    // distance apart regardless of when it was actually logged, so a run of
    // daily entries followed by a two-week gap then one more looked exactly
    // like perfectly even logging: the gap and the density were both
    // flattened into identical spacing, distorting the very trend the chart
    // exists to show. Falls back to even spacing only when every entry
    // shares one date (totalSpan 0), where a time-proportional x is
    // undefined anyway.
    const firstTime = new Date(entries[0].date + 'T00:00:00').getTime();
    const totalSpan = new Date(entries[n - 1].date + 'T00:00:00').getTime() - firstTime;
    const points = entries.map((e, i) => {
      const frac = n === 1 ? 0.5 : (totalSpan > 0 ? (new Date(e.date + 'T00:00:00').getTime() - firstTime) / totalSpan : i / (n - 1));
      return {
        x: padL + frac * innerW,
        y: padT + innerH - ((e.value - min) / (max - min)) * innerH,
        raw: e,
      };
    });

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

  // Drawing width in px. The app sets it to the card's inner width before drawing, so 11px
  // text stays 11px on a narrow phone instead of scaling down with the viewBox.
  let VBW = 326;
  const setWidth = (w) => { VBW = Math.max(240, Math.min(560, Math.round(w))); };
  const tipsById = new Map();
  let nextId = 0;

  const r1 = (n) => Math.round(n * 10) / 10;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayMs = (iso) => new Date(iso + 'T00:00:00').getTime();
  const shortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function niceStep(span, count) {
    const raw = span / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const step = niceStep(v, 4);
    return Math.ceil(v / step) * step;
  }
  // 1,200 as 1.2K; small numbers keep one decimal at most.
  function compact(n) {
    if (Math.abs(n) >= 1000) return `${r1(n / 1000)}K`;
    return String(r1(n));
  }

  function boxHtml(svg, tips, label) {
    const id = `c${++nextId}`;
    tipsById.set(id, tips);
    return `<div class="chart-box" data-chart="${id}" tabindex="0" role="img" aria-label="${esc(label)}">${svg}<div class="chart-tip" aria-live="polite" hidden></div></div>`;
  }

  function hairline(top, bottom) {
    return `<line class="chart-hair" x1="0" x2="0" y1="${top}" y2="${bottom}"></line>`;
  }

  // A bar with only its data end rounded.
  function barPath(x, w, yTop, yBase) {
    const r = Math.min(4, w / 2, yBase - yTop);
    return `M${r1(x)},${yBase} V${r1(yTop + r)} A${r},${r} 0 0 1 ${r1(x + r)},${r1(yTop)} H${r1(x + w - r)} A${r},${r} 0 0 1 ${r1(x + w)},${r1(yTop + r)} V${yBase} Z`;
  }

  /* Columns, one per period.
     bars: [{ value, tone: '' | 'now' | 'over' | 'open', label, tip: { title, rows: [[name, value, swatch]] } }]
     'now' is the current period, 'open' today (drawn as an outline), 'over' a status fill.
     opts: { height, max, goal, goalText, band: { lo, hi, text }, first, last, label, format } */
  function columns(bars, opts = {}) {
    const H = opts.height || 112;
    const padT = 18, padB = 20, padL = 32, padR = 4;
    const fmt = opts.format || compact;
    const peak = Math.max(0, ...bars.map((b) => b.value || 0), opts.goal || 0, opts.band ? opts.band.hi : 0);
    const top = opts.max != null ? opts.max : niceMax(peak * 1.08);
    const iw = VBW - padL - padR;
    const ih = H - padT - padB;
    const base = padT + ih;
    const slot = iw / bars.length;
    const bw = Math.min(24, Math.max(2, slot * 0.64));
    const y = (v) => base - (Math.min(v, top) / top) * ih;
    const goalY = opts.goal ? y(opts.goal) : null;
    let out = '';
    if (opts.band) {
      const bt = y(opts.band.hi);
      out += `<rect class="cband" x="${padL}" y="${r1(bt)}" width="${iw}" height="${r1(y(opts.band.lo) - bt)}"></rect>`;
      if (opts.band.text) out += `<text class="ct halo" x="${padL + 6}" y="${r1(bt - 4)}">${esc(opts.band.text)}</text>`;
    }
    [0, top].forEach((t) => {
      const ty = y(t);
      out += `<line class="${t ? 'cg' : 'cb'}" x1="${padL}" x2="${VBW - padR}" y1="${r1(ty)}" y2="${r1(ty)}"></line>`;
      if (goalY == null || Math.abs(goalY - ty) > 14) out += `<text class="ct" x="${padL - 6}" y="${r1(ty + 4)}" text-anchor="end">${fmt(t)}</text>`;
    });
    const tips = [];
    bars.forEach((b, i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      const cx = r1(x + bw / 2);
      const v = b.value || 0;
      if (v > 0) {
        const yt = y(v);
        out += b.tone === 'open'
          ? `<path class="cbar open" d="${barPath(x + 0.75, bw - 1.5, yt + 0.75, base)}"></path>`
          : `<path class="cbar${b.tone ? ` ${b.tone}` : ''}" d="${barPath(x, bw, yt, base)}"></path>`;
        if (b.label) out += `<text class="ct strong" x="${cx}" y="${r1(yt - 5)}" text-anchor="middle">${esc(b.label)}</text>`;
      }
      if (b.tip) tips.push({ x: cx, ...b.tip });
    });
    if (goalY != null) {
      out += `<line class="cgoal" x1="${padL}" x2="${VBW - padR}" y1="${r1(goalY)}" y2="${r1(goalY)}"></line>`;
      out += `<text class="ct strong" x="${padL - 6}" y="${r1(goalY + 4)}" text-anchor="end">${esc(opts.goalText || fmt(opts.goal))}</text>`;
    }
    if (opts.first) out += `<text class="ct" x="${r1(padL + (slot - bw) / 2)}" y="${H - 4}">${esc(opts.first)}</text>`;
    if (opts.last) out += `<text class="ct" x="${r1(padL + slot * (bars.length - 1) + (slot + bw) / 2)}" y="${H - 4}" text-anchor="end">${esc(opts.last)}</text>`;
    const svg = `<svg viewBox="0 0 ${VBW} ${H}" class="chart-svg" aria-hidden="true">${out}${hairline(padT - 6, base)}</svg>`;
    return boxHtml(svg, tips, opts.label || '');
  }

  /* A line over time.
     opts: { from, to (ISO dates), dots: [{date, value}], avg: [{date, value}], goal, goalText,
       band: { lo, hi, text }, estimate: [{date, value}, {date, value}], format, height, label,
       tipRows(date) -> rows, connect (draw the dots as the line itself) } */
  function line(opts) {
    const H = opts.height || 132;
    const padT = 12, padB = 20, padL = 34, padR = 40;
    const fmt = opts.format || compact;
    const dots = opts.dots || [];
    const avg = opts.connect ? dots : (opts.avg || []);
    const est = opts.estimate || [];
    const end = est.length ? est[est.length - 1].date : opts.to;
    const t0 = dayMs(opts.from);
    const span = Math.max(1, dayMs(end) - t0);
    const iw = VBW - padL - padR;
    const ih = H - padT - padB;
    const x = (iso) => padL + ((dayMs(iso) - t0) / span) * iw;
    const vals = [...dots, ...avg, ...est].map((p) => p.value);
    if (opts.goal != null) vals.push(opts.goal);
    if (opts.band) vals.push(opts.band.lo, opts.band.hi);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const step = niceStep(hi - lo, 3);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
    let out = '';
    if (opts.band) {
      const bt = y(Math.min(hi, opts.band.hi));
      const bb = y(Math.max(lo, opts.band.lo));
      out += `<rect class="cband" x="${padL}" y="${r1(bt)}" width="${iw}" height="${r1(bb - bt)}"></rect>`;
      if (opts.band.text) out += `<text class="ct" x="${padL + 6}" y="${r1(bt + 13)}">${esc(opts.band.text)}</text>`;
    }
    for (let v = lo; v <= hi + step / 2; v += step) {
      const ty = r1(y(v));
      out += `<line class="${v === lo ? 'cb' : 'cg'}" x1="${padL}" x2="${padL + iw}" y1="${ty}" y2="${ty}"></line>`;
      out += `<text class="ct" x="${padL - 6}" y="${r1(ty + 4)}" text-anchor="end">${fmt(v)}</text>`;
    }
    if (opts.goal != null) {
      const gy = r1(y(opts.goal));
      out += `<line class="cgoal" x1="${padL}" x2="${padL + iw}" y1="${gy}" y2="${gy}"></line>`;
      // The label goes where it covers no reading: above the line at the left, then at the
      // right, then below the line.
      const text = opts.goalText || `Goal ${fmt(opts.goal)}`;
      const tw = text.length * 7 + 8;
      const marks = dots.concat(avg);
      const covers = (lx, ly) => marks.some((p) => { const px = x(p.date); const py = y(p.value); return px > lx - 5 && px < lx + tw && py > ly - 15 && py < ly + 5; });
      const spots = [[padL + 4, gy - 5], [padL + iw - tw, gy - 5], [padL + 4, gy + 14], [padL + iw - tw, gy + 14]];
      const [lx, ly] = spots.find((s) => !covers(s[0], s[1])) || spots[0];
      out += `<text class="ct strong halo" x="${r1(lx)}" y="${r1(ly)}">${esc(text)}</text>`;
    }
    if (!opts.connect) dots.forEach((p) => { out += `<circle class="cdot" cx="${r1(x(p.date))}" cy="${r1(y(p.value))}" r="3.5"></circle>`; });
    if (avg.length > 1) out += `<polyline class="cline" points="${avg.map((p) => `${r1(x(p.date))},${r1(y(p.value))}`).join(' ')}"></polyline>`;
    if (opts.connect) dots.slice(0, -1).forEach((p) => { out += `<circle class="cpt" cx="${r1(x(p.date))}" cy="${r1(y(p.value))}" r="3"></circle>`; });
    if (est.length > 1) {
      out += `<polyline class="cest" points="${est.map((p) => `${r1(x(p.date))},${r1(y(p.value))}`).join(' ')}"></polyline>`;
      const e = est[est.length - 1];
      out += `<text class="ct" x="${r1(x(e.date))}" y="${r1(y(e.value) + (e.value < est[0].value ? 15 : -7))}" text-anchor="end">Estimate</text>`;
    }
    const last = avg[avg.length - 1] || dots[dots.length - 1];
    if (last) {
      out += `<circle class="cend" cx="${r1(x(last.date))}" cy="${r1(y(last.value))}" r="4.5"></circle>`;
      if (!est.length) out += `<text class="ct strong" x="${r1(x(last.date) + 8)}" y="${r1(y(last.value) + 4)}">${esc(fmt(last.value))}</text>`;
    }
    // Dates along the bottom: the start, month starts with room around them, and today.
    const labels = [[x(opts.from), shortDate(opts.from), 'start']];
    const todayX = x(opts.to);
    if (span / 86400000 >= 50) {
      const d = new Date(t0);
      d.setDate(1);
      for (d.setMonth(d.getMonth() + 1); d.getTime() < dayMs(opts.to); d.setMonth(d.getMonth() + 1)) {
        const mx = x(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
        if (mx - labels[labels.length - 1][0] > (labels.length === 1 ? 58 : 40) && todayX - mx > 36) labels.push([mx, d.toLocaleDateString(undefined, { month: 'short' }), 'middle']);
      }
    }
    labels.push([todayX, 'Today', 'end']);
    labels.forEach(([lx, text, anchor]) => { out += `<text class="ct" x="${r1(lx)}" y="${H - 4}" text-anchor="${anchor}">${esc(text)}</text>`; });
    const dates = [...new Set([...dots, ...avg].map((p) => p.date))].sort();
    const tips = opts.tipRows ? dates.map((d) => ({ x: r1(x(d)), title: shortDate(d), rows: opts.tipRows(d) })) : [];
    const svg = `<svg viewBox="0 0 ${VBW} ${H}" class="chart-svg" aria-hidden="true">${out}${hairline(padT, padT + ih)}</svg>`;
    return boxHtml(svg, tips, opts.label || '');
  }

  /* A grid of items by day. rows: [{ name, cells: ['done' | 'part' | 'miss' | 'off' | 'open'] }],
     dates: the ISO date of each column, tips: one per column. */
  function heatmap(rows, dates, tips, label) {
    const labelW = 80;
    const n = dates.length;
    const gap = 3;
    // Cells fill the width; past a square they grow sideways only, so a wide card does not get taller.
    const cw = (VBW - labelW - gap * (n - 1)) / n;
    const cs = Math.min(18, cw);
    const pitch = cw + gap;
    const rowH = cs + 5;
    const top = 18;
    const H = top + rows.length * rowH;
    let out = `<text class="ct" x="${labelW}" y="10">${esc(shortDate(dates[0]))}</text><text class="ct strong" x="${r1(labelW + pitch * (n - 1) + cw)}" y="10" text-anchor="end">Today</text>`;
    rows.forEach((row, ri) => {
      const ry = top + ri * rowH;
      const name = row.name.length > 12 ? `${row.name.slice(0, 11)}…` : row.name;
      out += `<text class="ct name" x="0" y="${r1(ry + cs - 3)}">${esc(name)}</text>`;
      row.cells.forEach((c, ci) => {
        const cx = labelW + ci * pitch;
        out += c === 'off' || c === 'open'
          ? `<rect class="hm ${c}" x="${r1(cx + 0.75)}" y="${r1(ry + 0.75)}" width="${r1(cw - 1.5)}" height="${r1(cs - 1.5)}" rx="3.5"></rect>`
          : `<rect class="hm ${c}" x="${r1(cx)}" y="${r1(ry)}" width="${r1(cw)}" height="${r1(cs)}" rx="4"></rect>`;
      });
    });
    const t = tips.map((tip, i) => ({ x: r1(labelW + i * pitch + cw / 2), ...tip }));
    const svg = `<svg viewBox="0 0 ${VBW} ${H}" class="chart-svg" aria-hidden="true">${out}${hairline(top - 3, H)}</svg>`;
    return boxHtml(svg, t, label);
  }

  /* Body map: a front and a back figure with one shape per muscle, each shaded by the level
     (0 to 3) of the muscle group it belongs to. The drawing is the app's own: every shape is
     a short list of points on a 200 x 400 figure, rounded into a smooth outline. Points are
     given for the left half; `pair` shapes are mirrored, `mid` shapes run down the centre
     line and close with their own mirror image. */
  const BODY_SIL = [
    ['mid', [[92, 43], [91, 51], [88, 60]]],
    ['mid', [[86, 56], [66, 62], [55, 74], [58, 104], [64, 134], [67, 156], [63, 178], [60, 200], [78, 208]]],
    ['pair', [[58, 64], [46, 68], [40, 86], [38, 116], [33, 146], [28, 176], [26, 198], [38, 202], [45, 178], [51, 150], [56, 124], [61, 100], [63, 80]]],
    ['pair', [[26, 204], [24, 214], [28, 224], [35, 224], [38, 212], [36, 203]]],
    ['pair', [[61, 196], [59, 228], [63, 260], [66, 280], [63, 306], [66, 344], [71, 372], [88, 372], [91, 344], [93, 306], [92, 282], [96, 260], [99, 230], [99, 200]]],
    ['pair', [[66, 372], [62, 381], [67, 387], [88, 387], [92, 380], [89, 372]]],
  ];
  const BODY_ARM = [
    ['arms', 'pair', [[45, 100], [57, 96], [60, 116], [55, 139], [46, 141], [40, 121]]],
    ['arms', 'pair', [[40, 147], [53, 144], [50, 166], [43, 196], [29, 196], [33, 170]]],
    ['shoulders', 'pair', [[63, 63], [51, 67], [43, 79], [42, 93], [49, 100], [57, 91], [63, 77]]],
  ];
  const BODY_FRONT = BODY_ARM.concat([
    ['back', 'pair', [[91, 50], [89, 60], [70, 63], [82, 56]]],
    ['chest', 'pair', [[67, 68], [84, 66], [98, 70], [98, 98], [86, 107], [70, 104], [61, 93], [62, 78]]],
    ['core', 'pair', [[87, 109], [98, 109], [98, 123], [87, 123]]],
    ['core', 'pair', [[87, 126], [98, 126], [98, 140], [87, 140]]],
    ['core', 'pair', [[87, 143], [98, 143], [98, 157], [87, 157]]],
    ['core', 'pair', [[88, 160], [98, 160], [98, 184], [92, 178]]],
    ['core', 'pair', [[68, 108], [82, 110], [84, 134], [84, 160], [74, 168], [67, 150], [64, 128]]],
    ['legs', 'pair', [[62, 200], [75, 198], [80, 230], [78, 262], [70, 272], [62, 250], [59, 224]]],
    ['legs', 'pair', [[78, 198], [92, 202], [94, 238], [89, 268], [81, 270], [82, 234]]],
    ['legs', 'pair', [[93, 203], [99, 206], [99, 240], [95, 252]]],
    ['legs', 'pair', [[66, 288], [79, 284], [87, 300], [86, 330], [80, 360], [72, 362], [65, 330], [63, 306]]],
  ]);
  const BODY_BACK = BODY_ARM.concat([
    ['back', 'mid', [[93, 46], [88, 58], [67, 63], [82, 74], [92, 96], [96, 114]]],
    ['back', 'pair', [[63, 97], [80, 84], [93, 104], [96, 138], [89, 160], [75, 152], [66, 126]]],
    ['back', 'mid', [[92, 146], [88, 160], [89, 176], [96, 186]]],
    ['legs', 'pair', [[61, 192], [72, 186], [88, 186], [98, 192], [98, 214], [90, 226], [74, 228], [62, 218]]],
    ['legs', 'pair', [[61, 232], [78, 232], [80, 266], [73, 276], [64, 264]]],
    ['legs', 'pair', [[80, 232], [97, 230], [97, 260], [90, 276], [82, 268]]],
    ['legs', 'pair', [[64, 286], [77, 282], [80, 312], [76, 342], [69, 344], [62, 314]]],
    ['legs', 'pair', [[79, 282], [90, 286], [92, 312], [86, 342], [79, 344]]],
  ]);

  // A closed, rounded outline through the points (Catmull-Rom, written as cubic Béziers).
  function blobPath(pts) {
    const n = pts.length;
    const at = (i) => pts[(i + n) % n];
    let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const k = 0.9 / 6;
      d += `C${r1(p1[0] + (p2[0] - p0[0]) * k)} ${r1(p1[1] + (p2[1] - p0[1]) * k)} ${r1(p2[0] - (p3[0] - p1[0]) * k)} ${r1(p2[1] - (p3[1] - p1[1]) * k)} ${r1(p2[0])} ${r1(p2[1])}`;
    }
    return `${d}Z`;
  }
  const flipX = (pts) => pts.map(([x, y]) => [200 - x, y]);
  function bodyShapes(kind, pts) {
    return kind === 'mid' ? [blobPath(pts.concat(flipX(pts).reverse()))] : [blobPath(pts), blobPath(flipX(pts))];
  }

  // levels: { chest, back, legs, shoulders, arms, core } -> 0 to 3. `titles` names each group's value.
  function bodyMap(levels, titles, label) {
    const figure = (muscles, dx, name) => {
      const sil = `<ellipse class="mm-sil" cx="100" cy="27" rx="16" ry="20"></ellipse>${BODY_SIL.map(([kind, pts]) => bodyShapes(kind, pts).map((d) => `<path class="mm-sil" d="${d}"></path>`).join('')).join('')}`;
      const parts = muscles.map(([group, kind, pts]) => bodyShapes(kind, pts).map((d) => `<path class="mm-m l${levels[group] || 0}" d="${d}"><title>${esc(titles[group] || '')}</title></path>`).join('')).join('');
      return `<g transform="translate(${dx} 0)">${sil}${parts}<text class="ct" x="100" y="408" text-anchor="middle">${name}</text></g>`;
    };
    return `<svg viewBox="0 0 410 414" class="chart-svg mm" role="img" aria-label="${esc(label)}">${figure(BODY_FRONT, 0, 'Front')}${figure(BODY_BACK, 210, 'Back')}</svg>`;
  }

  /* Horizontal bars, one row per category: this period's value as the bar, a tick for the
     previous period, and an optional dashed reference line with a label at the top. Each
     row's value sits in a right-hand column so it never reads as the tick's.
     rows: [{ label, value, prev }]; opts: { mark, markText, label } */
  function hbars(rows, opts = {}) {
    const labelW = 84, padR = 34, rowH = 28, top = 20;
    const H = top + rows.length * rowH;
    const peak = Math.max(opts.mark || 0, ...rows.map((r) => Math.max(r.value, r.prev || 0)));
    const max = niceMax(peak * 1.1);
    const iw = VBW - labelW - padR;
    const x = (v) => labelW + (Math.min(v, max) / max) * iw;
    let out = '';
    rows.forEach((r, i) => {
      const cy = top + i * rowH + rowH / 2;
      const name = r.label.length > 12 ? `${r.label.slice(0, 11)}…` : r.label;
      out += `<text class="ct name" x="0" y="${r1(cy + 4)}">${esc(name)}</text>`;
      const end = x(r.value);
      out += `<rect class="ctrack" x="${labelW}" y="${r1(cy - 6)}" width="${iw}" height="12" rx="4"></rect>`;
      if (r.value > 0) {
        const w = end - labelW;
        const rr = Math.min(4, w / 2);
        out += `<path class="cbar now" d="M${labelW},${r1(cy - 6)} H${r1(end - rr)} A${rr},${rr} 0 0 1 ${r1(end)},${r1(cy - 6 + rr)} V${r1(cy + 6 - rr)} A${rr},${rr} 0 0 1 ${r1(end - rr)},${r1(cy + 6)} H${labelW} Z"></path>`;
      }
      if (r.prev != null) out += `<line class="ctick" x1="${r1(x(r.prev))}" x2="${r1(x(r.prev))}" y1="${r1(cy - 9)}" y2="${r1(cy + 9)}"></line>`;
      out += `<text class="ct strong" x="${VBW}" y="${r1(cy + 4)}" text-anchor="end">${esc(r.value)}</text>`;
    });
    if (opts.mark) {
      const mx = r1(x(opts.mark));
      out += `<line class="cgoal" x1="${mx}" x2="${mx}" y1="${top - 4}" y2="${H}"></line>`;
      out += `<text class="ct strong" x="${mx}" y="${top - 8}" text-anchor="middle">${esc(opts.markText || opts.mark)}</text>`;
    }
    const svg = `<svg viewBox="0 0 ${VBW} ${H}" class="chart-svg" aria-hidden="true">${out}${hairline(top, H)}</svg>`;
    return boxHtml(svg, [], opts.label || '');
  }

  // Readouts for every .chart-box under `root`: press and hold (or hover) and slide, or
  // focus and use the arrow keys. A hairline snaps to the nearest point.
  function wire(root) {
    root.querySelectorAll('.chart-box[data-chart]').forEach((box) => {
      if (box.dataset.wired) return;
      box.dataset.wired = '1';
      const tips = tipsById.get(box.dataset.chart) || [];
      if (!tips.length) { box.removeAttribute('tabindex'); return; }
      const svg = box.querySelector('svg');
      const hair = box.querySelector('.chart-hair');
      const tip = box.querySelector('.chart-tip');
      const vbw = svg.viewBox.baseVal.width;
      let idx = -1;
      let down = false;
      const show = (i) => {
        idx = Math.max(0, Math.min(tips.length - 1, i));
        const t = tips[idx];
        hair.setAttribute('x1', t.x);
        hair.setAttribute('x2', t.x);
        box.classList.add('is-reading');
        tip.innerHTML = `<b>${esc(t.title)}</b>${t.rows.map(([name, value, sw]) => `<span class="tip-row">${sw ? `<i class="tip-sw ${sw}"></i>` : ''}<span class="tip-v">${esc(value)}</span> <span class="tip-n">${esc(name)}</span></span>`).join('')}`;
        tip.hidden = false;
        const px = (t.x / vbw) * svg.clientWidth;
        tip.style.left = `${Math.max(0, Math.min(box.clientWidth - tip.offsetWidth, px - tip.offsetWidth / 2))}px`;
      };
      const hide = () => { idx = -1; down = false; box.classList.remove('is-reading'); tip.hidden = true; };
      const nearest = (clientX) => {
        const r = svg.getBoundingClientRect();
        const vx = ((clientX - r.left) / r.width) * vbw;
        let best = 0;
        tips.forEach((t, i) => { if (Math.abs(t.x - vx) < Math.abs(tips[best].x - vx)) best = i; });
        return best;
      };
      box.addEventListener('pointerdown', (e) => { down = true; show(nearest(e.clientX)); });
      box.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') show(nearest(e.clientX)); });
      box.addEventListener('pointerup', (e) => { down = false; if (e.pointerType !== 'mouse') hide(); });
      box.addEventListener('pointercancel', hide);
      box.addEventListener('pointerleave', hide);
      box.addEventListener('blur', hide);
      box.addEventListener('keydown', (e) => {
        const moves = { ArrowLeft: idx < 0 ? tips.length - 1 : idx - 1, ArrowRight: idx < 0 ? tips.length - 1 : idx + 1, Home: 0, End: tips.length - 1 };
        if (e.key in moves) { e.preventDefault(); show(moves[e.key]); }
        else if (e.key === 'Escape' && idx >= 0) { e.stopPropagation(); hide(); }
      });
    });
    tipsById.forEach((_, id) => { if (!document.querySelector(`[data-chart="${id}"]`)) tipsById.delete(id); });
  }

  return { lineChart, columns, line, heatmap, hbars, bodyMap, wire, setWidth, compact, niceMax };
})();
