(() => {
  'use strict';

  const { CATALOG, TEMPLATES, SCHEDULE, MIN_SETS, ABS_DAYS, ABS_ANCHOR } = window.FIT;
  const KEY = 'liftlog.v1';
  const TYPE_LABEL = { pull: 'Pull', push: 'Push', legs: 'Legs', absa: 'Abs A', absb: 'Abs B' };

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDay = (s) => parseDay(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const fmtKg = (n) => String(Math.round(n * 100) / 100);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- state ----------
  const fresh = () => ({ v: 1, sessions: [], draft: null, custom: [], body: [], measures: [], profile: null, lastExport: null });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.sessions)) return { ...fresh(), ...s };
    } catch { /* fall through */ }
    return fresh();
  }

  let state = load();
  let tab = 'train';
  let inSession = false;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      toast('Could not save - storage is full or blocked');
    }
  }

  const allDefs = () => [...CATALOG, ...state.custom];
  const defById = (id) => allDefs().find((d) => d.id === id);

  function makeEx(def, savedSets) {
    const sets = savedSets
      ? savedSets.map((s) => ({ w: s.w ? fmtKg(s.w) : '', r: String(s.r), f: !!s.f }))
      : Array.from({ length: def.sets }, () => ({ w: '', r: '', f: false }));
    return { id: def.id, name: def.name, lo: def.lo, hi: def.hi, step: def.step, bw: !!def.bw, harder: def.harder || '', target: def.sets, sets };
  }

  // ---------- history lookups ----------
  const sessionsNewest = () => [...state.sessions].sort((a, b) => b.startedAt - a.startedAt);

  function lastFor(id) {
    for (const s of sessionsNewest()) {
      const ex = s.exercises.find((e) => e.id === id);
      if (ex && ex.sets.length) return { date: s.date, sets: ex.sets };
    }
    return null;
  }

  const fmtSet = (s, bw) => (bw && !s.w ? `BW×${s.r}` : `${fmtKg(s.w)}×${s.r}`);

  function historyFor(id, n) {
    const out = [];
    for (const s of sessionsNewest()) {
      const ex = s.exercises.find((e) => e.id === id);
      if (ex && ex.sets.length) {
        out.push({ date: s.date, sets: ex.sets });
        if (out.length >= n) break;
      }
    }
    return out;
  }

  // Double progression: stay at a weight until every set reaches the top of the rep range, then go up.
  // Returns { kind, arrow, label, headline, why, sets:[{w,r}] } where sets are per-set targets (strings).
  function suggestFor(ex) {
    const hist = historyFor(ex.id, 3);
    const wLabel = (w) => (ex.bw ? (w ? `+${fmtKg(w)} kg` : 'bodyweight') : `${fmtKg(w)} kg`);
    if (!hist.length) {
      return {
        kind: 'new', arrow: '', label: 'start light', sets: [],
        headline: ex.bw ? 'First time - do as many clean reps as you can' : 'First time - start light',
        why: ex.bw ? '' : `Pick a weight you could lift about ${ex.hi + 2} times and stop 1-2 reps before failure. After that I can build on it.`,
      };
    }
    const last = hist[0];
    const n = Math.max(ex.target, last.sets.length);
    const topW = Math.max(...last.sets.map((s) => s.w));
    const days = Math.round((parseDay(todayStr()) - parseDay(last.date)) / DAY);
    const roundW = (w) => Math.max(0, Math.round(w / ex.step) * ex.step);
    const flat = (w, r) => Array.from({ length: n }, () => ({ w: w ? fmtKg(w) : '', r: String(r) }));
    const score = (h) => Math.max(...h.sets.map((s) => (ex.bw ? s.r : est1rm(s.w, s.r))));

    if (days > 21 && topW > 0) {
      const w = roundW(topW * 0.9);
      return { kind: 'gap', arrow: '↓', label: wLabel(w), sets: flat(w, ex.lo),
        headline: `Back after ${days} days - ease in at ${wLabel(w)}`,
        why: `Starting about 10% lighter after a break lets you rebuild without risking an injury. You'll be back to ${wLabel(topW)} in a session or two.` };
    }
    const hitTop = last.sets.length >= 2 && last.sets.every((s) => s.r >= (s.f ? ex.hi - 2 : ex.hi));
    if (hitTop && ex.harder && topW === 0) {
      return { kind: 'up', arrow: '↑', label: 'harder', sets: flat(topW, ex.lo),
        headline: 'Make it harder',
        why: `You reached ${ex.hi} reps on every set. ${ex.harder} Then aim for ${ex.lo}+ reps per set.` };
    }
    if (hitTop) {
      const w = topW + ex.step;
      return { kind: 'up', arrow: '↑', label: wLabel(w), sets: flat(w, ex.lo),
        headline: `Go up to ${wLabel(w)}`,
        why: `You reached ${ex.hi} reps on every set last time. Aim for ${ex.lo}+ reps per set at the new weight.` };
    }
    if (last.sets.filter((s) => s.r < ex.lo).length > last.sets.length / 2 && topW > 0) {
      let w = roundW(topW * 0.925);
      if (w >= topW) w = Math.max(0, topW - ex.step);
      return { kind: 'down', arrow: '↓', label: wLabel(w), sets: flat(w, ex.lo),
        headline: `Drop to ${wLabel(w)}`,
        why: `Most sets finished under ${ex.lo} reps, so ${wLabel(topW)} was too heavy to build on.` };
    }
    if (hist.length === 3 && Math.max(score(hist[0]), score(hist[1])) <= score(hist[2])) {
      const w = topW > 0 ? roundW(topW * 0.9) : 0;
      return { kind: 'stall', arrow: topW > 0 ? '↓' : '→', label: wLabel(w), sets: flat(w, ex.hi - 2),
        headline: topW > 0 ? `Stuck for 3 sessions - reset to ${wLabel(w)}` : 'Stuck for 3 sessions - try a slower tempo',
        why: 'Your best has not improved across your last three sessions. A lighter reset to build up from usually breaks through. Sleep and food matter here too.' };
    }
    const sets = Array.from({ length: n }, (_, i) => {
      const s = last.sets[Math.min(i, last.sets.length - 1)];
      return { w: s.w ? fmtKg(s.w) : '', r: String(Math.min(ex.hi, s.r + 1)) };
    });
    return { kind: 'hold', arrow: '→', label: wLabel(topW), sets,
      headline: `Stay at ${wLabel(topW)} - add a rep`,
      why: `Try to beat last time by a rep on each set. Once every set reaches ${ex.hi}, ${ex.harder && topW === 0 ? "I'll show you how to make it harder" : `go up${ex.bw ? ' in weight' : ` ${ex.step} kg`}`}.` };
  }

  // Today's target for set i; falls back to the previous set's weight when there is no history.
  function placeholderFor(ex, i, sug) {
    if (sug.sets.length) {
      const t = sug.sets[Math.min(i, sug.sets.length - 1)];
      return { w: t.w, r: t.r };
    }
    for (let j = i - 1; j >= 0; j--) {
      if (ex.sets[j].r) return { w: ex.sets[j].w, r: '' };
    }
    return { w: '', r: '' };
  }

  // Muscle groups trained in the last two weeks, compared with a sensible weekly floor.
  function balanceIssues() {
    if (state.sessions.length < 2) return [];
    const cutoff = todayStrFrom(Date.now() - 14 * DAY);
    const recent = state.sessions.filter((s) => s.date >= cutoff);
    if (!recent.length) return [];
    const sets = {};
    const done = new Set();
    recent.forEach((s) => s.exercises.forEach((e) => {
      const d = defById(e.id);
      if (!d || !d.m) return;
      sets[d.m] = (sets[d.m] || 0) + e.sets.length;
      done.add(e.id);
    }));
    const weekly = (m) => (sets[m] || 0) / 2;
    const legs = ['Quads', 'Hamstrings', 'Calves'];
    const legsLow = legs.every((m) => weekly(m) < MIN_SETS[m]);
    const issues = [];
    if (legsLow) {
      const legSets = legs.reduce((a, m) => a + weekly(m), 0);
      issues.push({ m: 'Legs', text: legSets
        ? `Legs: only about ${round1(legSets)} sets a week. A Legs session (leg press, Romanian deadlift, leg curl, calf raise) would balance things out.`
        : 'Legs: no leg work in the last 2 weeks. Even one Legs session a week (leg press, Romanian deadlift, leg curl, calf raise) would balance things out.' });
    }
    Object.keys(MIN_SETS).forEach((m) => {
      if (legs.includes(m) || weekly(m) >= MIN_SETS[m]) return;
      const pick = CATALOG.find((d) => d.m === m && !done.has(d.id));
      issues.push({ m, pick, text: `${m}: about ${round1(weekly(m))} sets a week (aim for ${MIN_SETS[m]}+). ${pick ? `Try adding ${pick.name}.` : 'Add a set to what you already do.'}` });
    });
    return issues;
  }

  // Pull/Push have fixed days. Ab days alternate A, B, A, B... across every ab session (Mon, Wed, Sat).
  function scheduledFor(date) {
    const dow = date.getDay();
    if (SCHEDULE[dow]) return SCHEDULE[dow];
    const pos = ABS_DAYS.indexOf(dow);
    if (pos < 0) return null;
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((midnight - parseDay(ABS_ANCHOR)) / 864e5);
    const idx = Math.floor(days / 7) * ABS_DAYS.length + pos;
    return ((idx % 2) + 2) % 2 === 0 ? 'absa' : 'absb';
  }

  function nextSession() {
    const now = new Date();
    for (let i = 0; i <= 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const t = scheduledFor(d);
      if (t) return { type: t, today: i === 0, days: i };
    }
    return null;
  }

  // ---------- session actions ----------
  function startSession(type) {
    const go = () => {
      state.draft = {
        id: uid(), type, date: todayStr(), startedAt: Date.now(),
        exercises: TEMPLATES[type].core.map((id) => makeEx(defById(id))),
      };
      save();
      inSession = true;
      render(true);
    };
    if (state.draft && !confirm('Replace the in-progress session? Its sets will be lost.')) return;
    go();
  }

  function finishSession() {
    const d = state.draft;
    const out = [];
    for (const ex of d.exercises) {
      const sets = [];
      for (let i = 0; i < ex.sets.length; i++) {
        const s = ex.sets[i];
        const r = Math.round(num(s.r));
        if (r <= 0) continue;
        const w = num(s.w);
        if (!ex.bw && w <= 0) {
          toast(`Add a weight for ${ex.name}, set ${i + 1}`);
          return;
        }
        sets.push({ w, r, f: !!s.f });
      }
      if (sets.length) out.push({ id: ex.id, name: ex.name, sets });
    }
    if (!out.length) { toast('Log at least one set first'); return; }
    state.sessions.push({ id: d.id, type: d.type, date: d.date, startedAt: d.startedAt, endedAt: Date.now(), exercises: out });
    state.draft = null;
    inSession = false;
    tab = 'history';
    save();
    render(true);
    toast('Session saved');
  }

  function discardSession() {
    if (!confirm('Discard this session? Everything logged in it will be lost.')) return;
    state.draft = null;
    inSession = false;
    save();
    render(true);
  }

  function editSession(id) {
    if (state.draft && !confirm('Replace the in-progress session with this one?')) return;
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return;
    state.draft = {
      id: s.id, type: s.type, date: s.date, startedAt: s.startedAt,
      exercises: s.exercises.map((e) => {
        const def = defById(e.id) || { id: e.id, name: e.name, sets: e.sets.length, lo: 8, hi: 12, step: 2.5 };
        return makeEx({ ...def, name: e.name }, e.sets);
      }),
    };
    state.sessions = state.sessions.filter((x) => x.id !== id);
    save();
    tab = 'train';
    inSession = true;
    render(true);
  }

  function deleteSession(id) {
    if (!confirm('Delete this session permanently?')) return;
    state.sessions = state.sessions.filter((x) => x.id !== id);
    save();
    render();
  }

  // ---------- views ----------
  function homeView() {
    const wrap = h('div');
    const nx = nextSession();
    const todayType = nx && nx.today ? nx.type : null;
    const doneToday = state.sessions.some((s) => s.date === todayStr() && (!todayType || s.type === todayType));

    let title; let sub;
    if (todayType) {
      title = `${TYPE_LABEL[todayType]} day today`;
      sub = doneToday ? 'Logged - nice work.' : 'Time to train.';
    } else {
      title = 'Rest day';
      sub = nx ? `Next up: ${TYPE_LABEL[nx.type]} ${nx.days === 1 ? 'tomorrow' : `in ${nx.days} days`}. Extra session? Start one below.` : 'Extra session? Start one below.';
    }
    const targets = state.profile ? planNumbers(state.profile, currentWeight()) : null;
    wrap.append(h('div', { class: 'card banner' }, h('h1', { text: title }), h('p', { class: 'muted', text: sub }),
      targets && h('p', { class: 'small', text: `Eat about ${targets.calories.toLocaleString('en-GB')} kcal and ${targets.protein} g protein today.` })));

    if (state.draft) {
      wrap.append(h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('div', null,
            h('b', { text: `${TYPE_LABEL[state.draft.type]} in progress` }),
            h('div', { class: 'muted small', text: fmtDay(state.draft.date) })),
          h('button', { class: 'primary', type: 'button', onclick: () => { inSession = true; render(true); } }, 'Resume'))));
    }

    wrap.append(h('h2', { text: 'Start a session' }));
    wrap.append(h('div', { class: 'start-grid' },
      ['pull', 'push', 'legs', 'absa', 'absb'].map((t) =>
        h('button', { type: 'button', onclick: () => startSession(t) },
          TYPE_LABEL[t], h('small', { text: t === 'legs' ? 'optional' : (todayType === t ? 'today' : '') })))));

    const nxt = nextSession();
    if (nxt) {
      const tpl = TEMPLATES[nxt.type];
      const rows = tpl.core.map((id) => {
        const def = defById(id);
        const sug = suggestFor(makeEx(def));
        return h('div', { class: `plan-row ${sug.kind}` },
          h('div', null, h('b', { text: def.name }), h('span', { class: 'muted small', text: ` ${def.sets} × ${def.lo}-${def.hi}` })),
          h('span', { class: 'plan-target', text: `${sug.arrow} ${sug.label}`.trim() }));
      });
      wrap.append(h('h2', { text: nxt.today ? `Today's ${tpl.label} plan` : `Next up: ${tpl.label} (${nxt.days === 1 ? 'tomorrow' : `in ${nxt.days} days`})` }),
        h('div', { class: 'card' }, rows,
          h('p', { class: 'muted small', text: 'Targets come from your last sessions: stay at a weight until every set hits the top of the rep range, then go up.' })));
    }

    const issues = balanceIssues().slice(0, 3);
    if (issues.length) {
      wrap.append(h('h2', { text: 'Balance check' }),
        h('div', { class: 'card' }, issues.map((x) => h('p', { class: 'small', text: x.text })),
          h('p', { class: 'muted small', text: 'Based on your last 2 weeks of training.' })));
    }

    const recent = sessionsNewest().slice(0, 3);
    if (recent.length) {
      wrap.append(h('h2', { text: 'Recent' }));
      recent.forEach((s) => wrap.append(summaryCard(s, false)));
    } else {
      wrap.append(h('p', { class: 'muted', text: 'No sessions yet. Start one above and log your first sets.' }));
    }
    return wrap;
  }

  function sessionStats(s) {
    let sets = 0; let vol = 0;
    s.exercises.forEach((e) => e.sets.forEach((x) => { sets++; vol += x.w * x.r; }));
    return { sets, vol };
  }

  function summaryCard(s, withActions) {
    const { sets, vol } = sessionStats(s);
    const head = h('summary', null,
      h('div', { class: 'row between' },
        h('div', null, h('span', { class: `pill ${s.type}`, text: TYPE_LABEL[s.type] }), h('b', { text: fmtDay(s.date) })),
        h('span', { class: 'muted small', text: `${sets} sets · ${Math.round(vol).toLocaleString('en-GB')} kg` })));
    const body = s.exercises.map((e) =>
      h('div', { class: 'hx' }, h('b', { text: e.name }),
        h('span', { text: e.sets.map((x) => fmtSet(x, defById(e.id)?.bw) + (x.f ? ' (F)' : '')).join('  ·  ') })));
    const card = h('details', { class: 'card' }, head, body);
    if (withActions) {
      card.append(h('div', { class: 'ex-actions' },
        h('button', { type: 'button', onclick: () => editSession(s.id) }, 'Edit'),
        h('button', { type: 'button', class: 'danger', onclick: () => deleteSession(s.id) }, 'Delete')));
    }
    return card;
  }

  function historyView() {
    const wrap = h('div', null, h('h1', { text: 'History' }));
    const list = sessionsNewest();
    if (!list.length) wrap.append(h('p', { class: 'muted', text: 'Finished sessions appear here.' }));
    list.forEach((s) => wrap.append(summaryCard(s, true)));
    return wrap;
  }

  function moreView() {
    const wrap = h('div', null, h('h1', { text: 'More' }));
    const last = state.lastExport ? new Date(state.lastExport).toLocaleDateString('en-GB') : 'never';

    wrap.append(h('div', { class: 'card' },
      h('b', { text: 'Backup' }),
      h('p', { class: 'muted small', text: `Your data lives only in this browser on this device. Clearing site data would erase it, so export a backup now and then. Last backup: ${last}.` }),
      h('div', { class: 'ex-actions' },
        h('button', { type: 'button', class: 'primary', onclick: exportFile }, 'Download backup'),
        h('button', { type: 'button', onclick: copyBackup }, 'Copy to clipboard'))));

    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => importFile(fileIn.files[0]) });
    wrap.append(h('div', { class: 'card' },
      h('b', { text: 'Restore' }),
      h('p', { class: 'muted small', text: 'Import a backup file. Sessions already here are kept; matching ones are not duplicated.' }),
      h('button', { type: 'button', class: 'block', onclick: () => fileIn.click() }, 'Import backup file'), fileIn));

    wrap.append(h('div', { class: 'card' },
      h('b', { text: 'Stored so far' }),
      h('p', { class: 'muted small', text: `${state.sessions.length} sessions, ${state.body.length} weigh-ins, ${state.measures.length} measurements, ${state.custom.length} custom exercises.` })));
    return wrap;
  }

  function backupJson() {
    return JSON.stringify({ app: 'liftlog', exportedAt: Date.now(), sessions: state.sessions, custom: state.custom, body: state.body, measures: state.measures, profile: state.profile });
  }

  function markExported() { state.lastExport = Date.now(); save(); }

  function exportFile() {
    const blob = new Blob([backupJson()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `liftlog-backup-${todayStr()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    markExported();
    render();
    toast('Backup downloaded');
  }

  async function copyBackup() {
    try {
      await navigator.clipboard.writeText(backupJson());
      markExported();
      render();
      toast('Backup copied - paste it somewhere safe');
    } catch {
      toast('Could not copy - use Download instead');
    }
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== 'liftlog' || !Array.isArray(data.sessions)) throw new Error('bad');
        const have = new Set(state.sessions.map((s) => s.id));
        const incoming = data.sessions.filter((s) => s && s.id && Array.isArray(s.exercises) && !have.has(s.id));
        state.sessions.push(...incoming);
        const haveC = new Set(state.custom.map((c) => c.id));
        (data.custom || []).forEach((c) => { if (c && c.id && !haveC.has(c.id)) state.custom.push(c); });
        const haveB = new Set(state.body.map((b) => b.id));
        const newBody = (data.body || []).filter((b) => b && b.id && b.date && b.kg > 0 && !haveB.has(b.id));
        state.body.push(...newBody);
        const haveM = new Set(state.measures.map((m) => m.id));
        const newMeasures = (data.measures || []).filter((m) => m && m.id && m.date && m.type && m.cm > 0 && !haveM.has(m.id));
        state.measures.push(...newMeasures);
        if (!state.profile && data.profile && data.profile.age && data.profile.heightCm) state.profile = data.profile;
        save();
        render();
        toast(`Imported ${incoming.length} session${incoming.length === 1 ? '' : 's'}, ${newBody.length + newMeasures.length} body entries`);
      } catch {
        toast('That is not a valid Lift Log backup');
      }
    };
    reader.readAsText(file);
  }

  // ---------- session screen ----------
  function sessionView() {
    const d = state.draft;
    const wrap = h('div');
    wrap.append(h('div', { class: 'session-head' },
      h('div', { class: 'row between' },
        h('button', { type: 'button', class: 'ghost', onclick: () => { inSession = false; render(true); } }, '‹ Back'),
        h('button', { type: 'button', class: 'primary', onclick: finishSession }, 'Finish')),
      h('h1', { text: `${TYPE_LABEL[d.type]} day` }),
      h('div', { class: 'muted small', text: fmtDay(d.date) })));

    const list = h('div');
    d.exercises.forEach((ex) => list.append(exCard(ex)));
    wrap.append(list);

    wrap.append(h('button', { type: 'button', class: 'block', onclick: openPicker }, '+ Add exercise'));
    wrap.append(h('p'));
    wrap.append(h('button', { type: 'button', class: 'ghost block danger', onclick: discardSession }, 'Discard session'));
    return wrap;
  }

  function exCard(ex) {
    const card = h('section', { class: 'card' });
    const redo = () => card.replaceWith(exCard(ex));
    const last = lastFor(ex.id);
    const sug = suggestFor(ex);

    card.append(h('div', { class: 'ex-head' },
      h('div', null,
        h('h3', { text: ex.name }),
        h('p', { class: 'ex-meta', text: `${ex.target} × ${ex.lo}-${ex.hi} reps${ex.bw ? ' · bodyweight (kg = extra weight)' : ''}` })),
      h('button', { type: 'button', class: 'ghost', 'aria-label': `Remove ${ex.name}`, onclick: () => removeEx(ex) }, '✕')));

    card.append(h('p', {
      class: 'ex-last',
      text: last ? `Last (${fmtDay(last.date)}): ${last.sets.map((s) => fmtSet(s, ex.bw)).join('  ·  ')}` : 'No previous sets logged',
    }));
    card.append(h('div', { class: `sug ${sug.kind}` }, h('b', { text: sug.headline }), sug.why && h('span', { text: sug.why })));

    card.append(h('div', { class: 'set labels' }, h('span'), h('span', { text: 'kg' }), h('span', { text: 'reps' }), h('span', { text: 'fail' }), h('span', { text: 'goal' }), h('span')));
    const sets = h('div', { class: 'sets' });
    ex.sets.forEach((_, i) => sets.append(setRow(ex, i, redo, sug)));
    card.append(sets);

    card.append(h('div', { class: 'ex-actions' },
      h('button', { type: 'button', onclick: () => { ex.sets.push({ w: '', r: '', f: false }); save(); redo(); } }, '+ Add set')));
    return card;
  }

  function setRow(ex, i, redo, sug) {
    const s = ex.sets[i];
    const ph = placeholderFor(ex, i, sug);
    const row = h('div', { class: 'set' });
    const refresh = () => row.classList.toggle('filled', num(s.r) > 0);

    const w = h('input', { class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: ph.w || (ex.bw ? '0' : ''), value: s.w, 'aria-label': `Set ${i + 1} weight in kg` });
    const r = h('input', { class: 'num', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: ph.r, value: s.r, 'aria-label': `Set ${i + 1} reps` });
    w.addEventListener('input', () => { s.w = w.value; save(); });
    r.addEventListener('input', () => { s.r = r.value; save(); refresh(); });

    const fail = h('button', { type: 'button', class: 'tog', 'aria-pressed': String(s.f), 'aria-label': `Set ${i + 1} taken to failure`, onclick: () => {
      s.f = !s.f; fail.setAttribute('aria-pressed', String(s.f)); save();
    } }, 'F');

    const done = h('button', { type: 'button', class: 'done', 'aria-label': `Fill set ${i + 1} with today's goal`, onclick: () => {
      if (!s.w && ph.w) s.w = ph.w;
      if (!s.r && ph.r) s.r = ph.r;
      if (!num(s.r)) { toast('Enter the reps for this set'); return; }
      save(); redo();
    } }, '✓');

    const rm = h('button', { type: 'button', class: 'rm', 'aria-label': `Remove set ${i + 1}`, onclick: () => {
      ex.sets.splice(i, 1); save(); redo();
    } }, '−');

    row.append(h('span', { class: 'idx', text: i + 1 }), w, r, fail, done, rm);
    refresh();
    return row;
  }

  function removeEx(ex) {
    const hasData = ex.sets.some((s) => s.r || s.w);
    if (hasData && !confirm(`Remove ${ex.name} and its sets from this session?`)) return;
    state.draft.exercises = state.draft.exercises.filter((e) => e !== ex);
    save();
    render();
  }

  // ---------- add-exercise sheet ----------
  function openPicker() {
    const d = state.draft;
    const used = new Set(d.exercises.map((e) => e.id));
    const tpl = TEMPLATES[d.type];
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Add exercise' });
    const search = h('input', { type: 'search', placeholder: 'Search or type a new exercise', 'aria-label': 'Search exercises' });
    const list = h('div');

    const add = (def) => {
      d.exercises.push(makeEx(def));
      save();
      overlay.remove();
      render();
      toast(`${def.name} added`);
    };

    const draw = () => {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      const match = (def) => !used.has(def.id) && def.name.toLowerCase().includes(q);
      const suggested = balanceIssues().map((x) => x.pick).filter((x) => x && (tpl.core.includes(x.id) || tpl.extra.includes(x.id)));
      const group = (label, defs) => {
        const items = defs.filter(match);
        if (!items.length) return;
        list.append(h('h2', { text: label }));
        items.forEach((def) => list.append(
          h('button', { type: 'button', class: 'pick', onclick: () => add(def) }, def.name, ' ', h('small', { text: `${def.sets} × ${def.lo}-${def.hi}` }))));
      };
      const shown = new Set();
      const sel = (ids) => ids.map(defById).filter((x) => x && !shown.has(x.id) && (shown.add(x.id), true));
      group('Suggested for you', suggested.map((x) => x.id).filter((id) => !used.has(id)).map(defById).filter((x) => x && !shown.has(x.id) && (shown.add(x.id), true)));
      group(`${tpl.label} extras`, sel(tpl.extra));
      group(`${tpl.label} core`, sel(tpl.core));
      group('Everything else', allDefs().filter((x) => !shown.has(x.id)));

      if (q && !allDefs().some((x) => x.name.toLowerCase() === q)) {
        const name = search.value.trim();
        list.append(h('h2', { text: 'New exercise' }),
          h('button', { type: 'button', class: 'pick primary', onclick: () => {
            const def = { id: 'c-' + uid(), name, sets: 3, lo: 8, hi: 12, step: 2.5 };
            state.custom.push(def);
            add(def);
          } }, `Create "${name}"`));
      }
      if (!list.children.length) list.append(h('p', { class: 'muted', text: 'Nothing left to add.' }));
    };

    search.addEventListener('input', draw);
    sheet.append(h('h2', { text: 'Add exercise' }), search, list,
      h('p'), h('button', { type: 'button', class: 'block', onclick: () => overlay.remove() }, 'Close'));
    overlay.append(sheet);
    document.body.append(overlay);
    draw();
  }

  // ---------- progress ----------
  const DAY = 864e5;
  const MEASURES = [['waist', 'Waist'], ['chest', 'Chest'], ['arm', 'Arm'], ['thigh', 'Thigh']];
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const dayMs = (s) => parseDay(s).getTime();
  const round1 = (n) => Math.round(n * 10) / 10;
  const round2 = (n) => Math.round(n * 100) / 100;
  let ptab = 'body';
  let pEx = null;
  let pMetric = 'e1rm';
  let pMeasure = 'waist';

  function segmented(opts, current, onPick) {
    return h('div', { class: 'seg', role: 'group' }, opts.map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === current), onclick: () => onPick(k) }, label)));
  }

  function progressView() {
    const wrap = h('div', null, h('h1', { text: 'Progress' }));
    wrap.append(segmented([['body', 'Body'], ['strength', 'Strength'], ['measures', 'Measures']], ptab, (k) => { ptab = k; render(); }));
    wrap.append(ptab === 'body' ? bodyPanel() : ptab === 'strength' ? strengthPanel() : measuresPanel());
    return wrap;
  }

  function entryForm({ title, unit, min, max, onSave }) {
    const val = h('input', { class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: unit, 'aria-label': `${title} in ${unit}` });
    const date = h('input', { type: 'date', value: todayStr(), max: todayStr(), 'aria-label': 'Date' });
    const go = () => {
      const v = num(val.value);
      if (v < min || v > max) { toast(`Enter a value between ${min} and ${max} ${unit}`); return; }
      if (!date.value) { toast('Pick a date'); return; }
      onSave(v, date.value);
    };
    val.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'card' }, h('b', { text: title }),
      h('div', { class: 'form-row' }, val, date, h('button', { type: 'button', class: 'primary', onclick: go }, 'Save')));
  }

  function chartBlock(opts) {
    const readout = h('p', { class: 'readout' });
    return h('div', null, readout, window.FitChart.line({ ...opts, readout }));
  }

  function entryList(items, fmt, onDelete) {
    const box = h('div', { class: 'entries' });
    items.slice(-8).reverse().forEach((e) => box.append(
      h('div', { class: 'entry row between' },
        h('span', { text: `${fmtDay(e.date)} - ${fmt(e)}` }),
        h('button', { type: 'button', class: 'ghost', 'aria-label': `Delete entry from ${fmtDay(e.date)}`, onclick: () => { if (confirm('Delete this entry?')) onDelete(e); } }, '✕'))));
    return box;
  }

  function rollingAvg(pts) {
    return pts.map((p) => {
      const win = pts.filter((q) => q.t <= p.t && q.t > p.t - 7 * DAY);
      return { t: p.t, v: win.reduce((a, q) => a + q.v, 0) / win.length };
    });
  }

  // Weekly rate of change of the 7-day average, measured over roughly the last 2-4 weeks.
  function trendRate(avg) {
    if (avg.length < 2) return null;
    const last = avg[avg.length - 1];
    const older = avg.filter((p) => p.t <= last.t - 14 * DAY);
    if (!older.length) return null;
    const ref = older.reduce((best, p) => (Math.abs(p.t - (last.t - 28 * DAY)) < Math.abs(best.t - (last.t - 28 * DAY)) ? p : best));
    return { rate: (last.v - ref.v) / ((last.t - ref.t) / (7 * DAY)), last, ref };
  }

  function trendText(avg) {
    const tr = trendRate(avg);
    if (!tr) return avg.length < 2 ? 'Log a few more weigh-ins to see your trend.' : 'Keep logging - a trend needs about two weeks of weigh-ins.';
    const { rate, last, ref } = tr;
    const sign = rate >= 0 ? '+' : '';
    let verdict;
    if (rate < 0.1) verdict = 'Not gaining yet - a bit more food each day would help.';
    else if (rate < 0.25) verdict = 'Gaining slowly - a small bump in food would speed things up.';
    else if (rate <= 0.6) verdict = 'On target for a lean gain.';
    else verdict = 'Gaining fast - some of it will be fat, so no need to push harder.';
    return `${sign}${round2(rate)} kg/week over the last ${Math.round((last.t - ref.t) / (7 * DAY))} weeks. Goal: about +0.25 to +0.5. ${verdict}`;
  }

  function bodyPanel() {
    const wrap = h('div');
    wrap.append(entryForm({ title: 'Log body weight', unit: 'kg', min: 25, max: 250, onSave: (kg, date) => {
      state.body = state.body.filter((e) => e.date !== date);
      state.body.push({ id: uid(), date, kg });
      save();
      render();
      toast('Weight saved');
    } }));

    const list = [...state.body].sort(byDate);
    const card = h('div', { class: 'card' }, h('b', { text: 'Body weight' }));
    if (!list.length) {
      card.append(h('p', { class: 'muted small', text: 'Weigh yourself first thing in the morning, same conditions each time, and log it here. Day-to-day swings are normal - the line shows the 7-day average, which is what matters.' }));
      wrap.append(card);
      return wrap;
    }
    const pts = list.map((e) => ({ t: dayMs(e.date), v: e.kg }));
    const avg = rollingAvg(pts);
    pts.forEach((p, i) => { p.text = `${fmtKg(p.v)} kg (7-day avg ${fmtKg(round2(avg[i].v))})`; });
    const goal = goalLine(avg);
    card.append(chartBlock({ points: pts, avg, goal, unit: ' kg', label: `Body weight over time, ${pts.length} entries` }));
    card.append(h('p', { class: 'muted small', text: `Dots are single weigh-ins. The solid line is the 7-day average.${goal.length ? ' The dashed line is your goal pace.' : ''}` }));
    card.append(h('p', { class: 'trend', text: trendText(avg) }));
    wrap.append(card);
    wrap.append(h('div', { class: 'card' }, h('b', { text: 'Recent weigh-ins' }),
      entryList(list, (e) => `${fmtKg(e.kg)} kg`, (e) => { state.body = state.body.filter((x) => x.id !== e.id); save(); render(); })));
    return wrap;
  }

  function measuresPanel() {
    const wrap = h('div');
    const label = MEASURES.find(([k]) => k === pMeasure)[1];
    wrap.append(segmented(MEASURES, pMeasure, (k) => { pMeasure = k; render(); }));
    wrap.append(entryForm({ title: `Log ${label.toLowerCase()}`, unit: 'cm', min: 10, max: 250, onSave: (cm, date) => {
      state.measures = state.measures.filter((m) => !(m.type === pMeasure && m.date === date));
      state.measures.push({ id: uid(), date, type: pMeasure, cm });
      save();
      render();
      toast(`${label} saved`);
    } }));

    const list = state.measures.filter((m) => m.type === pMeasure).sort(byDate);
    const card = h('div', { class: 'card' }, h('b', { text: label }));
    if (!list.length) {
      card.append(h('p', { class: 'muted small', text: 'Measure around the same spot each time, relaxed, and log it every week or two. Waist is the one to watch for staying lean while you gain.' }));
      wrap.append(card);
      return wrap;
    }
    const pts = list.map((m) => ({ t: dayMs(m.date), v: m.cm }));
    card.append(chartBlock({ points: pts, unit: ' cm', label: `${label} over time, ${pts.length} entries` }));
    if (list.length > 1) {
      const d = round1(list[list.length - 1].cm - list[0].cm);
      card.append(h('p', { class: 'trend', text: `${d >= 0 ? '+' : ''}${d} cm since ${new Date(dayMs(list[0].date)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` }));
    }
    wrap.append(card);
    wrap.append(h('div', { class: 'card' }, h('b', { text: 'Recent entries' }),
      entryList(list, (e) => `${fmtKg(e.cm)} cm`, (e) => { state.measures = state.measures.filter((x) => x.id !== e.id); save(); render(); })));
    return wrap;
  }

  const est1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

  // One point per session: the best set for the chosen metric.
  function strengthPoints(id, metric) {
    const pts = [];
    [...state.sessions].sort((a, b) => a.startedAt - b.startedAt).forEach((s) => {
      const ex = s.exercises.find((e) => e.id === id);
      if (!ex || !ex.sets.length) return;
      let best = null;
      let bestV = -1;
      ex.sets.forEach((set) => {
        const v = metric === 'reps' ? set.r : metric === 'top' ? set.w : est1rm(set.w, set.r);
        if (v > bestV || (v === bestV && set.r > best.r)) { bestV = v; best = set; }
      });
      if (bestV <= 0) return;
      const setTxt = fmtSet(best, metric === 'reps');
      const text = metric === 'e1rm' ? `${round1(bestV)} kg est. 1RM (from ${setTxt})`
        : metric === 'top' ? `${setTxt} top weight` : `${best.r} reps${best.w ? ` at +${fmtKg(best.w)} kg` : ''}`;
      pts.push({ t: dayMs(s.date), v: round1(bestV), text });
    });
    return pts;
  }

  function strengthPanel() {
    const wrap = h('div');
    const seen = new Map();
    sessionsNewest().forEach((s) => s.exercises.forEach((e) => { if (e.sets.length && !seen.has(e.id)) seen.set(e.id, e.name); }));
    if (!seen.size) {
      wrap.append(h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Finish a session and your exercises will show up here with strength charts.' })));
      return wrap;
    }
    if (!seen.has(pEx)) pEx = seen.keys().next().value;
    const bw = !!defById(pEx)?.bw;
    const metric = bw ? 'reps' : (pMetric === 'reps' ? 'e1rm' : pMetric);

    const select = h('select', { 'aria-label': 'Exercise', onchange: () => { pEx = select.value; render(); } },
      [...seen].map(([id, name]) => h('option', { value: id, selected: id === pEx }, name)));
    wrap.append(h('div', { class: 'card' }, select));
    if (!bw) wrap.append(segmented([['e1rm', 'Est. 1RM'], ['top', 'Top weight']], metric, (k) => { pMetric = k; render(); }));

    const pts = strengthPoints(pEx, metric);
    const card = h('div', { class: 'card' }, h('b', { text: seen.get(pEx) }));
    card.append(h('p', { class: 'muted small', text: metric === 'e1rm' ? 'Estimated one-rep max from your best set each session (Epley formula). It lets you compare sessions with different weights and reps.' : metric === 'top' ? 'Heaviest weight lifted each session.' : 'Most reps in a set each session.' }));
    card.append(chartBlock({ points: pts, unit: metric === 'reps' ? ' reps' : ' kg', label: `${seen.get(pEx)} progress, ${pts.length} sessions` }));
    if (pts.length > 1) {
      const d = round1(pts[pts.length - 1].v - pts[0].v);
      card.append(h('p', { class: 'trend', text: `${d >= 0 ? '+' : ''}${d}${metric === 'reps' ? ' reps' : ' kg'} since ${new Date(pts[0].t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` }));
    }
    wrap.append(card);

    const e1 = strengthPoints(pEx, 'e1rm');
    const top = strengthPoints(pEx, 'top');
    const reps = strengthPoints(pEx, 'reps');
    const stat = (label, value) => h('div', { class: 'stat' }, h('b', { text: value }), h('span', { text: label }));
    wrap.append(h('div', { class: 'stats' },
      bw ? stat('Best reps', String(Math.max(...reps.map((p) => p.v)))) : stat('Best est. 1RM', `${Math.max(...e1.map((p) => p.v))} kg`),
      bw ? stat('Sessions', String(reps.length)) : stat('Heaviest', `${Math.max(...top.map((p) => p.v))} kg`),
      bw ? stat('Last session', `${reps[reps.length - 1].v} reps`) : stat('Sessions', String(pts.length))));
    return wrap;
  }

  // ---------- plan ----------
  const ACTIVITY = {
    light: { pal: 1.5, label: 'Light - school/sitting most of the day, 1-2 workouts a week' },
    moderate: { pal: 1.65, label: 'Moderate - on your feet a fair bit, 3-4 workouts or sport a week' },
    high: { pal: 1.85, label: 'High - sport or training most days, very active' },
  };
  const RATES = [0.25, 0.35, 0.5];
  const KCAL_PER_KG_WEEK = 7700 / 7; // roughly 7,700 kcal per kg of body weight, spread over a week

  // Schofield equations (the ones used for UK dietary guidance); they cover teenagers properly.
  function bmrKcal(sex, age, kg) {
    const m = sex === 'male';
    let mj;
    if (age <= 17) mj = m ? 0.074 * kg + 2.754 : 0.056 * kg + 2.898;
    else if (age <= 29) mj = m ? 0.063 * kg + 2.896 : 0.062 * kg + 2.036;
    else mj = m ? 0.048 * kg + 3.653 : 0.034 * kg + 3.538;
    return mj * 239;
  }

  function currentWeight() {
    const list = [...state.body].sort(byDate);
    if (list.length) return rollingAvg(list.map((e) => ({ t: dayMs(e.date), v: e.kg }))).pop().v;
    return state.profile ? state.profile.weight : 0;
  }

  function planNumbers(p, kg) {
    const maintenance = Math.round((bmrKcal(p.sex, p.age, kg) * ACTIVITY[p.activity].pal) / 10) * 10;
    const surplus = p.goal === 'gain' ? Math.round((p.rate * KCAL_PER_KG_WEEK) / 10) * 10 : 0;
    const calories = Math.round((maintenance + surplus + (p.adjust || 0)) / 10) * 10;
    const protein = Math.round((1.8 * kg) / 5) * 5;
    const fat = Math.round((calories * 0.25) / 9 / 5) * 5;
    const carbs = Math.round((calories - protein * 4 - fat * 9) / 4 / 5) * 5;
    return { maintenance, surplus, adjust: p.adjust || 0, calories, protein, fat, carbs };
  }

  // Dashed target line on the body chart, starting from the first weigh-in after the goal was set.
  function goalLine(avg) {
    const p = state.profile;
    if (!p || !p.since) return [];
    const from = avg.filter((a) => a.t >= dayMs(p.since));
    if (from.length < 2) return [];
    const rate = p.goal === 'gain' ? p.rate : 0;
    const first = from[0];
    const last = from[from.length - 1];
    return [{ t: first.t, v: first.v }, { t: last.t, v: first.v + (rate * (last.t - first.t)) / (7 * DAY) }];
  }

  // Compares real progress with the goal and proposes a small calorie change.
  function adjustAdvice(p) {
    const sinceDate = p.adjustAt ? todayStrFrom(p.adjustAt) : p.since;
    let list = [...state.body].sort(byDate);
    if (sinceDate) list = list.filter((e) => e.date >= sinceDate);
    const tr = trendRate(rollingAvg(list.map((e) => ({ t: dayMs(e.date), v: e.kg }))));
    if (!tr) {
      return { text: p.adjustAt
        ? `You changed your target on ${fmtDay(sinceDate)}. Give it about two weeks of weigh-ins before judging the new number.`
        : 'Log your weight a few times a week. After about two weeks I can tell you whether to eat more or less.' };
    }
    const goal = p.goal === 'gain' ? p.rate : 0;
    const diff = tr.rate - goal;
    const sign = tr.rate >= 0 ? '+' : '';
    const head = `Your 7-day average is moving ${sign}${round2(tr.rate)} kg/week; your goal is ${goal ? '+' : ''}${goal} kg/week.`;
    if (Math.abs(diff) <= 0.1 || (diff > 0 && diff <= 0.15)) return { text: `${head} That's on track - keep the same target.` };
    const delta = Math.min(300, Math.max(100, Math.round((Math.abs(diff) * KCAL_PER_KG_WEEK) / 50) * 50)) * (diff < 0 ? 1 : -1);
    return {
      delta,
      text: `${head} ${diff < 0 ? 'That is slower than planned' : 'That is faster than planned'}, so ${delta > 0 ? 'add' : 'cut'} about ${Math.abs(delta)} kcal a day. This assumes you have really been eating the target - if not, just hit the target first.`,
    };
  }

  function todayStrFrom(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  let editingProfile = false;

  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { text: label }), control);
  }

  function profileForm() {
    const old = state.profile;
    const latest = currentWeight();
    const age = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', value: old ? old.age : '', placeholder: 'years' });
    const sex = h('select', null, [['male', 'Male'], ['female', 'Female']].map(([v, l]) => h('option', { value: v, selected: old ? old.sex === v : v === 'male' }, l)));
    const height = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: old ? old.heightCm : '', placeholder: 'cm' });
    const weight = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: latest ? round1(latest) : '', placeholder: 'kg' });
    const activity = h('select', null, Object.entries(ACTIVITY).map(([k, a]) => h('option', { value: k, selected: (old ? old.activity : 'light') === k }, a.label)));
    const goal = h('select', null, [['gain', 'Gain weight (lean bulk)'], ['maintain', 'Stay the same weight']].map(([v, l]) => h('option', { value: v, selected: (old ? old.goal : 'gain') === v }, l)));
    const rate = h('select', null, RATES.map((r) => h('option', { value: r, selected: (old ? old.rate : 0.35) === r }, `${r} kg per week${r === 0.35 ? ' (recommended)' : ''}`)));

    const submit = () => {
      const a = Math.round(num(age.value));
      const hc = num(height.value);
      const w = num(weight.value);
      if (a < 12 || a > 60) { toast('Age needs to be between 12 and 60'); return; }
      if (hc < 120 || hc > 230) { toast('Height needs to be between 120 and 230 cm'); return; }
      if (w < 25 || w > 250) { toast('Weight needs to be between 25 and 250 kg'); return; }
      const next = {
        age: a, sex: sex.value, heightCm: hc, weight: w, activity: activity.value, goal: goal.value, rate: num(rate.value),
        adjust: old ? old.adjust || 0 : 0, adjustAt: old ? old.adjustAt || null : null,
        since: old && old.goal === goal.value && old.rate === num(rate.value) ? old.since : todayStr(),
      };
      // Typing a new weight here also logs it as today's weigh-in.
      if (!latest || Math.abs(w - latest) > 0.05) {
        state.body = state.body.filter((e) => e.date !== todayStr());
        state.body.push({ id: uid(), date: todayStr(), kg: w });
      }
      state.profile = next;
      editingProfile = false;
      save();
      render(true);
      toast('Plan updated');
    };

    return h('div', { class: 'card' },
      h('b', { text: old ? 'Edit your profile' : 'Set up your plan' }),
      h('p', { class: 'muted small', text: 'This stays on your phone. It is only used to estimate how much you should eat.' }),
      h('div', { class: 'fields' }, field('Age', age), field('Sex (for the formula)', sex), field('Height (cm)', height), field('Weight now (kg)', weight)),
      field('How active are you?', activity), field('Goal', goal), field('Gain rate', rate),
      h('p', { class: 'muted small', text: 'Typing a new weight here also saves it as today\'s weigh-in.' }),
      h('div', { class: 'ex-actions' },
        old && h('button', { type: 'button', onclick: () => { editingProfile = false; render(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'primary', onclick: submit }, 'Save')));
  }

  // Waist-to-height is a simple, rough guide to how close abs are to showing.
  function waistInfo(p) {
    const list = state.measures.filter((m) => m.type === 'waist').sort(byDate);
    if (!list.length) return null;
    const last = list[list.length - 1];
    const ratio = last.cm / p.heightCm;
    let verdict;
    if (ratio < 0.43) verdict = 'Lean enough that abs usually show with decent light and a flexed core. From here it is mostly about making the muscles thicker.';
    else if (ratio < 0.46) verdict = 'Close. Many people start to see the top abs around here.';
    else if (ratio < 0.5) verdict = 'A healthy range, but abs are usually still hidden. Keep your waist steady while your weight rises.';
    else verdict = 'Above 0.5 is worth keeping an eye on. Keep the gain slow and your waist from growing.';
    let trend = '';
    const older = list.filter((m) => dayMs(m.date) <= dayMs(last.date) - 14 * DAY);
    if (older.length) {
      const ref = older.reduce((best, m) => (Math.abs(dayMs(m.date) - (dayMs(last.date) - 28 * DAY)) < Math.abs(dayMs(best.date) - (dayMs(last.date) - 28 * DAY)) ? m : best));
      const weeks = (dayMs(last.date) - dayMs(ref.date)) / (7 * DAY);
      const perMonth = ((last.cm - ref.cm) / weeks) * 4;
      if (perMonth >= 2) trend = `Your waist is growing about ${round1(perMonth)} cm a month - faster than ideal. Drop your gain rate to 0.25 kg a week in Edit profile so more of it is muscle.`;
      else if (perMonth > 0.75) trend = `Waist is up about ${round1(perMonth)} cm a month. That's fine while you gain weight - just don't let it speed up.`;
      else trend = 'Your waist is steady while you gain weight - that is the pattern you want.';
    }
    return { cm: last.cm, ratio, verdict, trend };
  }

  function absCard(p) {
    const info = waistInfo(p);
    const card = h('div', { class: 'card' }, h('b', { text: 'Visible abs' }),
      h('p', { class: 'small', text: 'Abs show when two things line up: low enough body fat, and abs big enough to see. Ab exercises build the second one. They cannot burn fat off your stomach, so the plan has three parts:' }),
      h('p', { class: 'small', text: '1. Train abs at home on Monday, Wednesday and Saturday, alternating Abs A and Abs B each time (A, B, A one week, then B, A, B the next). About 15 minutes, with just your bodyweight and a dumbbell. The app gives you a rep or weight target each time. When you hit the top of the range on every set, add weight or make the move harder, as it tells you.' }),
      h('p', { class: 'small', text: '2. Keep gaining slowly (0.25 to 0.35 kg a week). A bigger, thicker ab wall shows more at the same body fat, and a slow gain keeps fat from piling up on top of it.' }),
      h('p', { class: 'small', text: '3. Watch your waist. Log it every week or two on Progress > Measures.' }));
    if (info) {
      card.append(h('p', { class: 'small', text: `Waist ${fmtKg(info.cm)} cm, height ${p.heightCm} cm: waist-to-height ${info.ratio.toFixed(2)}. ${info.verdict}` }));
      if (info.trend) card.append(h('p', { class: 'trend', text: info.trend }));
    } else {
      card.append(h('p', { class: 'small muted', text: 'Log your waist (relaxed, level with your belly button) to see how close you are. A waist-to-height ratio under about 0.45 is where abs usually start to show.' }));
    }
    card.append(h('p', { class: 'muted small', text: 'Rough guide only: genetics decide where fat sits. Crunching more than this will not make them show faster, and you do not need to cut calories while you are still growing.' }));
    return card;
  }

  function planView() {
    const wrap = h('div', null, h('h1', { text: 'Plan' }));
    const p = state.profile;
    if (!p || editingProfile) { wrap.append(profileForm()); return wrap; }

    const kg = currentWeight();
    const n = planNumbers(p, kg);
    const stat = (label, value) => h('div', { class: 'stat' }, h('b', { text: value }), h('span', { text: label }));

    wrap.append(h('div', { class: 'card banner' },
      h('p', { class: 'muted small', text: p.goal === 'gain' ? 'Daily target to gain weight' : 'Daily target to stay the same' }),
      h('h1', { text: `${n.calories.toLocaleString('en-GB')} kcal` }),
      h('p', { class: 'muted small', text: `Maintenance about ${n.maintenance.toLocaleString('en-GB')}${n.surplus ? ` + ${n.surplus} to gain` : ''}${n.adjust ? ` ${n.adjust > 0 ? '+' : '-'} ${Math.abs(n.adjust)} adjustment` : ''}. Worked out from ${round1(kg)} kg, ${p.heightCm} cm, age ${p.age}.` })));
    wrap.append(h('div', { class: 'stats' }, stat('Protein', `${n.protein} g`), stat('Carbs', `${n.carbs} g`), stat('Fat', `${n.fat} g`)));
    wrap.append(h('p', { class: 'muted small', text: 'Aim for the same every day, rest days included. Close enough is fine: within 100-200 kcal and 10 g of protein. Protein anywhere from about 1.6 to 2 g per kg of body weight works.' }));

    const advice = adjustAdvice(p);
    const adv = h('div', { class: 'card' }, h('b', { text: 'Is it working?' }), h('p', { class: 'small', text: advice.text }));
    if (advice.delta) {
      adv.append(h('button', { type: 'button', class: 'primary block', onclick: () => {
        p.adjust = Math.max(-500, Math.min(800, (p.adjust || 0) + advice.delta));
        p.adjustAt = Date.now();
        save();
        render();
        toast('Target updated');
      } }, `${advice.delta > 0 ? 'Add' : 'Cut'} ${Math.abs(advice.delta)} kcal`));
    }
    wrap.append(adv);

    if (p.goal === 'gain') {
      wrap.append(h('div', { class: 'card' }, h('b', { text: 'What to expect' }),
        h('p', { class: 'small', text: `At +${p.rate} kg a week you would be around ${round1(kg + p.rate * 4)} kg in 4 weeks and ${round1(kg + p.rate * 12)} kg in 12 weeks. Some of it is muscle, some fat and water. Weight can also dip for a few days, which is normal, so judge by the 7-day average on the Progress tab.`}),
        h('p', { class: 'muted small', text: 'You are still growing, so some of your gain will be height and filling out. Sleeping 8-10 hours matters as much as the food. If you ever feel worried about your weight or your eating, talk to your GP or school nurse.' })));
    }

    wrap.append(absCard(p));

    wrap.append(h('button', { type: 'button', class: 'block', onclick: () => { editingProfile = true; render(true); } }, 'Edit profile'));
    if (p.adjust) {
      wrap.append(h('p'), h('button', { type: 'button', class: 'ghost block', onclick: () => { p.adjust = 0; p.adjustAt = null; save(); render(); } }, 'Reset calorie adjustment'));
    }
    return wrap;
  }

  // ---------- shell ----------
  function render(toTop) {
    const app = $('#app');
    app.replaceChildren();
    if (tab === 'train') app.append(inSession && state.draft ? sessionView() : homeView());
    else if (tab === 'progress') app.append(progressView());
    else if (tab === 'plan') app.append(planView());
    else if (tab === 'history') app.append(historyView());
    else app.append(moreView());
    document.querySelectorAll('#nav button').forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (toTop) window.scrollTo(0, 0);
  }

  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    if (tab !== 'train') inSession = false;
    render(true);
  }));

  // If a draft was left open, jump straight back into it.
  if (state.draft) inSession = true;
  render();

  // Ask the browser not to evict our data; harmless if refused.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
