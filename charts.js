// Tiny dependency-free SVG line chart so the app stays offline-friendly.
window.FitChart = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 360;
  const H = 220;
  const M = { l: 40, r: 14, t: 12, b: 26 };

  const mk = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };

  const axisDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fullDate = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  function niceScale(min, max) {
    if (min === max) {
      const pad = Math.max(1, Math.abs(min) * 0.02);
      min -= pad;
      max += pad;
    }
    const raw = (max - min) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks, step };
  }

  // opts: { points:[{t,v,text?}], avg?:[{t,v}], unit, label, readout (element) }
  // With `avg`, points are drawn as faint dots and the average is the line; otherwise points are the line.
  function line(opts) {
    const main = opts.points;
    const avg = opts.avg || [];
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opts.label || 'Chart' });

    const goal = opts.goal || [];
    const all = main.concat(avg, goal);
    let t0 = Math.min(...all.map((p) => p.t));
    let t1 = Math.max(...all.map((p) => p.t));
    if (t0 === t1) { t0 -= 3 * 864e5; t1 += 3 * 864e5; }
    const sc = niceScale(Math.min(...all.map((p) => p.v)), Math.max(...all.map((p) => p.v)));
    const x = (t) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
    const y = (v) => H - M.b - ((v - sc.lo) / (sc.hi - sc.lo)) * (H - M.t - M.b);
    const decimals = Math.max(0, -Math.floor(Math.log10(sc.step) + 1e-9));

    sc.ticks.forEach((v) => {
      svg.append(mk('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), class: 'grid' }));
      svg.append(mk('text', { x: M.l - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, v.toFixed(decimals)));
    });

    const labels = [t0, (t0 + t1) / 2, t1].map(axisDate);
    const anchors = ['start', 'middle', 'end'];
    const xs = [M.l, (M.l + W - M.r) / 2, W - M.r];
    let show = [0, 1, 2];
    if (labels[0] === labels[2]) show = [1];
    else if (labels[1] === labels[0] || labels[1] === labels[2]) show = [0, 2];
    show.forEach((i) => svg.append(mk('text', { x: xs[i], y: H - 6, 'text-anchor': anchors[i] }, labels[i])));

    const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
    if (goal.length > 1) svg.append(mk('path', { d: path(goal), class: 'goal' }));
    const faint = avg.length > 0;
    if (faint) {
      if (avg.length > 1) svg.append(mk('path', { d: path(avg), class: 'avg' }));
    } else if (main.length > 1) {
      svg.append(mk('path', { d: path(main), class: 'trace' }));
    }
    main.forEach((p) => svg.append(mk('circle', { cx: x(p.t), cy: y(p.v), r: faint ? 2.8 : 3.5, class: faint ? 'dot faint' : 'dot' })));

    const cursor = mk('line', { y1: M.t, y2: H - M.b, class: 'cursor' });
    const mark = mk('circle', { r: 5.5, class: 'sel' });
    svg.append(cursor, mark);

    const select = (i) => {
      const p = main[i];
      cursor.setAttribute('x1', x(p.t));
      cursor.setAttribute('x2', x(p.t));
      mark.setAttribute('cx', x(p.t));
      mark.setAttribute('cy', y(p.v));
      if (opts.readout) {
        opts.readout.textContent = `${fullDate(p.t)} · ${p.text || `${p.v}${opts.unit || ''}`}`;
      }
    };

    const pick = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let best = 0;
      let bd = Infinity;
      main.forEach((p, i) => {
        const d = Math.abs(x(p.t) - px);
        if (d < bd) { bd = d; best = i; }
      });
      select(best);
    };
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointermove', pick);

    if (main.length) select(main.length - 1);
    return svg;
  }

  return { line };
})();
