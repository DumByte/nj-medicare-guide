// UI layer: renders the current screen from the interpreter's walk. All math lives in engine.js.
import { indexFacts, isStale, isValidDate, formatDate, formatUSD, irmaaSchedule, irmaaTableFor, partBPenalty,
  partDPenalty, medigapCompare, makeDate, yearOf } from './engine.js';
import { walk, collectPath, renderSegments, renderPlain, validateInput, evalWhen, modulesOf } from './interpreter.js';

const FACTS_DOC = JSON.parse(document.getElementById('facts-data').textContent);
const TREE = JSON.parse(document.getElementById('tree-data').textContent);
const FACTS = indexFacts(FACTS_DOC);
const BY_ID = Object.fromEntries(TREE.nodes.map((n) => [n.id, n]));
const MODULES = modulesOf(TREE);
const STORE_KEY = 'nj-medicare-guide-answers-v1';
const LOG = [];

// ---------- today (?today=YYYY-MM-DD test hook; never changes facts) ----------
function localToday() {
  const d = new Date();
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
const TODAY = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('today');
    if (q && isValidDate(q)) return q;
  } catch (e) { /* ignore */ }
  return localToday();
})();

// ---------- state + opt-in storage ----------
// Calculator years start empty and default to the path's decision year (the year Part B starts).
const freshState = () => ({ answers: {}, calc: { irmaa: { magi: {}, oneTime: {}, wifeHasB: true },
  medigap: { yearType: 'moderate', year: null, excess: 0 }, penalty: { bMonths: 12, bYear: null, dMonths: 12, dYear: null } }, pos: 0 });
let state = freshState();
let remember = false;

function storageGet() {
  try { const s = window.localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function storageSet() {
  if (!remember) return true;
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; } catch (e) {
    note('Could not save on this device (storage is blocked). The guide still works.');
    return false;
  }
}
function storageClear() {
  try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* storage blocked: nothing saved */ }
}
function note(msg) { document.getElementById('storage-note').textContent = msg; }

// ---------- DOM helper ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

// ---------- popovers ----------
const pop = document.getElementById('pop');
function openPop(title, ...content) {
  const body = document.getElementById('pop-body');
  body.replaceChildren(h('h2', { id: 'pop-title' }, title), ...content);
  if (typeof pop.showModal === 'function') pop.showModal(); else pop.setAttribute('open', '');
}
const srcLink = (s, text) => h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', class: 'src' }, text || 'Source');

function factDetail(f) {
  const items = [h('p', {}, f.plain)];
  items.push(h('p', {}, h('strong', {}, 'Label: '), f.label, f.confidence ? ` (confidence: ${f.confidence})` : '',
    ' — ', (FACTS_DOC.meta.label_definitions || {})[f.label] || ''));
  if (f.effective) items.push(h('p', {}, h('strong', {}, 'Applies to: '), String(f.effective)));
  if (f.derivation) items.push(h('p', {}, h('strong', {}, 'How we got this: '), f.derivation));
  if (f.note) items.push(h('p', {}, h('strong', {}, 'Note: '), f.note));
  if (f.label === 'PENDING' && f.projection) {
    items.push(h('p', {}, h('strong', {}, 'Projected (not official): '),
      `premium ${formatUSD(f.projection.premium)}, deductible ${formatUSD(f.projection.deductible)}. ${f.projection.basis}`));
  }
  if (isStale(f, TODAY)) items.push(h('p', { class: 'stale' }, 'This number may be out of date — check the source.'));
  if (f.review_after) items.push(h('p', { class: 'small' }, `Check again after ${formatDate(f.review_after)}.`));
  if (f.source) items.push(h('p', {}, srcLink(f.source, f.source.title)));
  for (const a of f.also || []) items.push(h('p', {}, 'Also: ', srcLink(a, a.title)));
  return items;
}

function badgeForFact(f) {
  return h('button', { type: 'button', class: 'badge ' + f.label,
    'aria-label': `${f.label}${f.confidence ? ', ' + f.confidence + ' confidence' : ''}: details for "${f.plain.slice(0, 60)}"`,
    onclick: () => openPop('About this fact', ...factDetail(f)) },
  f.label + (f.label === 'UNVERIFIED' && f.confidence ? ` (${f.confidence})` : ''));
}

function factMarks(f) {
  const out = [' ', badgeForFact(f)];
  if (f.source) out.push(srcLink(f.source));
  if (isStale(f, TODAY)) out.push(h('span', { class: 'stale' }, 'This number may be out of date — check the source'));
  return out;
}

function badgeForVar(name, meta) {
  const m = meta || { label: 'INFERRED', how: '' };
  return h('button', { type: 'button', class: 'badge ' + m.label, 'aria-label': `${m.label}: how we got this`,
    onclick: () => openPop('How we got this', h('p', {}, h('strong', {}, m.label), m.confidence ? ` (confidence: ${m.confidence})` : ''),
      h('p', {}, m.how || 'Computed from your answers.'), h('p', { class: 'small' }, 'This is an estimate from your answers, not an official figure.')) },
  m.label);
}

// ---------- glossary ----------
const GLOSS = Object.entries(TREE.glossary || {}).map(([key, g]) => {
  const pattern = key === 'take_assignment' ? 'tak(?:e|es|ing) assignment'
    : g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { key, ...g, re: new RegExp(`\\b${pattern}\\b`, key === 'ship' || key === 'irmaa' || key === 'cobra' ? '' : 'i') };
});

function glossaryDialog(g) {
  const f = FACTS[g.fact];
  openPop(g.term, h('p', {}, g.text), f ? h('p', { class: 'small' }, 'Related fact: ', f.plain, ...factMarks(f)) : null);
}

function withGlossary(text, used) {
  let parts = [text];
  for (const g of GLOSS) {
    if (used.has(g.key)) continue;
    const next = [];
    let done = false;
    for (const p of parts) {
      if (done || typeof p !== 'string') { next.push(p); continue; }
      const m = g.re.exec(p);
      if (!m) { next.push(p); continue; }
      next.push(p.slice(0, m.index),
        h('button', { type: 'button', class: 'gloss', 'aria-label': `${m[0]}: what this means`, onclick: () => glossaryDialog(g) }, m[0]),
        p.slice(m.index + m[0].length));
      used.add(g.key);
      done = true;
    }
    parts = next;
  }
  return parts;
}

// ---------- rich text ----------
function ctxFor(w) {
  return { facts: FACTS, vars: w.vars, meta: w.meta, log: (m) => { LOG.push(m); console.warn(m); } };
}

function rich(text, ctx, used, opts = {}) {
  const out = [];
  const segs = renderSegments(text, ctx);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.type === 'text') out.push(...(opts.noGloss ? [s.text] : withGlossary(s.text, used)));
    else if (s.type === 'fact') {
      const f = FACTS[s.id];
      out.push(h('span', { class: 'fact' }, ...(opts.noGloss ? [s.text] : withGlossary(s.text, used)), ...(opts.noMarks ? [] : factMarks(f))));
    } else {
      // Keep a hyphenated suffix ("17-month") with its number, before the badge.
      const next = segs[i + 1];
      const suffix = next && next.type === 'text' ? (/^-\w+/.exec(next.text) || [''])[0] : '';
      if (suffix) next.text = next.text.slice(suffix.length);
      out.push(h('strong', {}, s.text + suffix));
      if (s.meta && !opts.noMarks) out.push(' ', badgeForVar(s.name, s.meta));
    }
  }
  return out;
}

// Headings hold plain text only (M20): their fact/estimate marks and glossary buttons go on a line below.
function heading(text, ctx, used) {
  const segs = renderSegments(text, ctx);
  const marks = [];
  for (const s of segs) {
    if (s.type === 'fact') marks.push(...factMarks(FACTS[s.id]));
    else if (s.type === 'var' && s.meta) marks.push(h('span', { class: 'mark-label' }, s.text), ' ', badgeForVar(s.name, s.meta), ' ');
  }
  const terms = withGlossary(segs.map((s) => s.text).join(''), used).filter((x) => x instanceof Node);
  return [h('h1', { tabindex: '-1' }, ...rich(text, ctx, used, { noMarks: true, noGloss: true })),
    marks.length || terms.length ? h('p', { class: 'heading-marks' }, ...marks,
      terms.length ? [h('span', { class: 'mark-label' }, 'What these words mean:'), ' ', ...terms.flatMap((b) => [b, ' '])] : null) : null];
}

// Years that have a figure for any of these year-keyed prefixes, plus the decision year.
function yearsFor(prefixes, extra) {
  const ys = new Set(extra);
  for (const id of Object.keys(FACTS)) for (const p of prefixes) { const m = new RegExp('^' + p + '_(\\d{4})$').exec(id); if (m) ys.add(+m[1]); }
  return [...ys].sort();
}

// ---------- progress / footer ----------
function renderProgress(node) {
  const i = Math.max(0, MODULES.indexOf(node.module));
  const nav = document.getElementById('progress');
  nav.replaceChildren(
    h('p', { class: 'progress-line' }, `Part ${i + 1} of ${MODULES.length}: `, h('strong', {}, node.module)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Progress through the guide', 'aria-valuemin': 0,
      'aria-valuemax': MODULES.length, 'aria-valuenow': i + 1 }, h('span', { style: `width:${Math.round(((i + 1) / MODULES.length) * 100)}%` })));
}

function renderFooter() {
  const ship = FACTS.nj_ship_contact;
  document.getElementById('footer').replaceChildren(
    h('p', {}, `Unofficial guide. Not Medicare, CMS or Social Security. Not legal, tax or financial advice. Confirm with NJ SHIP, ${ship.value}.`, ...factMarks(ship)),
    h('p', { class: 'small' }, `Facts as of ${formatDate(FACTS_DOC.meta.as_of)}. Today's date used: ${formatDate(TODAY)}. Nothing you enter leaves this device.`));
}

// ---------- screens ----------
let W = null;

function go(pos) {
  state.pos = pos;
  storageSet();
  render(true);
}

function answer(node, value) {
  state.answers[node.var] = value;
  W = walk(TREE, state.answers, FACTS, TODAY);
  const i = W.screens.indexOf(node.id);
  go(i + 1);
}

function navButtons(node, opts = {}) {
  const kids = [];
  if (state.pos > 0) kids.push(h('button', { type: 'button', class: 'secondary', onclick: () => go(state.pos - 1) }, 'Back'));
  if (opts.continue) kids.push(h('button', { type: 'button', onclick: () => go(state.pos + 1) }, opts.continueLabel || 'Continue'));
  return h('div', { class: 'nav' }, kids);
}

function helpToggle(node, ctx, used) {
  if (!node.help) return null;
  return h('details', {}, h('summary', {}, 'Why we ask'), h('p', {}, ...rich(node.help, ctx, used)));
}

function factList(ids, title = 'Facts on this screen') {
  const list = (ids || []).map((id) => FACTS[id]).filter(Boolean);
  if (!list.length) return null;
  return h('details', {}, h('summary', {}, title),
    h('ul', {}, list.map((f) => h('li', {}, f.plain, ...factMarks(f)))));
}

const WHY_NAMES = { health_needs: 'Specialist, ongoing condition or surgery expected', doctor_choice: 'Seeing any doctor or hospital',
  travel: 'Weeks outside New Jersey', predictability: 'Predictable bills', budget_ok: 'Medigap is affordable',
  reversibility: 'Your Medigap window is open and you expect health needs (Medigap is hard to get back into later)' };

function whyList(w) {
  const reasons = w.vars.path_score_reasons || [];
  const optLabel = (name, ans) => {
    const n = TREE.nodes.find((x) => x.var === name);
    const o = n && n.options.find((x) => x.value === ans);
    return o ? renderPlain(o.label, ctxFor(w)) : ans;
  };
  return h('div', { class: 'panel' }, h('h2', {}, 'Why'),
    h('p', { class: 'small' }, 'Plus points lean to Medigap; minus points lean to Medicare Advantage. These weights are a design choice, not a Medicare rule.',
      ...factMarks(FACTS.path_score_weights)),
    h('ul', {}, reasons.map((r) => h('li', {}, `${WHY_NAMES[r.name] || r.name}: ${r.name === 'reversibility' ? 'yes' : optLabel(r.name, r.answer)} → `,
      h('strong', {}, (r.points > 0 ? '+' : '') + r.points)))),
    h('p', {}, h('strong', {}, `Total: ${w.vars.path_score > 0 ? '+' : ''}${w.vars.path_score}`)),
    w.vars.medigap_window_open === 'unknown' ? h('p', {}, 'Your Medigap window could not be checked, so this is treated as a close call.') : null,
    w.vars.medigap_window_open === false ? h('p', {}, 'Your Medigap window has closed and no guaranteed right was found, so the score is not used.') : null);
}

function screenQuestion(node, ctx, used) {
  const current = state.answers[node.var];
  return [
    ...heading(node.text, ctx, used),
    helpToggle(node, ctx, used),
    h('div', { role: 'group', 'aria-label': 'Choose one' },
      node.options.map((o) => h('button', { type: 'button', class: 'option', 'aria-pressed': String(current === o.value),
        onclick: () => answer(node, o.value) }, renderPlain(o.label, ctx)))),
    factList(node.fact_refs),
    navButtons(node)
  ];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function yearRange(node) {
  const y = +TODAY.slice(0, 4);
  if (node.validate) return [+node.validate.min.slice(0, 4), +node.validate.max.slice(0, 4)];
  if (node.var === 'wife_birth') return [y - 75, y - 50];
  if (node.var === 'job_cov_end') return [y, y + 6];
  return [y - 15, y + 1];
}

function screenInput(node, ctx, used) {
  const cur = state.answers[node.var];
  const [y0, y1] = yearRange(node);
  const idp = 'in-' + node.id;
  const sel = (id, label, opts, value) => h('div', {}, h('label', { class: 'field', for: id }, label),
    h('select', { id }, h('option', { value: '' }, 'Choose'), opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
  const curParts = typeof cur === 'string' && /^\d{4}-\d{2}/.test(cur) ? cur.split('-') : [];
  const fields = [sel(idp + '-m', 'Month', MONTHS.map((m, i) => [String(i + 1).padStart(2, '0'), m]), curParts[1])];
  if (node.input === 'date') fields.push(sel(idp + '-d', 'Day', Array.from({ length: 31 }, (_, i) => [String(i + 1).padStart(2, '0'), String(i + 1)]), curParts[2]));
  const years = [];
  for (let y = y1; y >= y0; y--) years.push([String(y), String(y)]);
  fields.push(sel(idp + '-y', 'Year', years, curParts[0]));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = () => {
    const m = document.getElementById(idp + '-m').value, yv = document.getElementById(idp + '-y').value;
    const d = node.input === 'date' ? document.getElementById(idp + '-d').value : null;
    const value = node.input === 'date' ? `${yv}-${m}-${d}` : `${yv}-${m}`;
    const problem = validateInput(node, value);
    if (problem) { err.textContent = problem; err.hidden = false; err.focus && err.setAttribute('tabindex', '-1'); err.focus(); return; }
    answer(node, value);
  };
  const extra = [];
  if (node.allow_unknown) extra.push(h('button', { type: 'button', class: 'secondary', onclick: () => answer(node, 'unknown') }, "I don't know"));
  if (node.default_from) extra.push(h('button', { type: 'button', class: 'secondary', onclick: () => answer(node, 'default') }, "I don't know — assume the last day of that month"));
  return [
    ...heading(node.text, ctx, used),
    helpToggle(node, ctx, used),
    h('div', { class: 'row' }, fields),
    err,
    h('div', { class: 'nav' }, h('button', { type: 'button', onclick: submit }, 'Save and continue'), extra),
    cur === 'unknown' || cur === 'default' ? h('p', { class: 'small' }, 'Your answer so far: ', cur === 'unknown' ? "I don't know" : 'assume the last day of the month') : null,
    factList(node.fact_refs),
    navButtons(node)
  ];
}

function screenOutcome(node, ctx, used, w) {
  const kids = [...heading(node.title || '', ctx, used)];
  if (node.text) kids.push(h('p', {}, ...rich(node.text, ctx, used)));
  for (const v of node.variants || []) if (evalWhen(v.when, w.vars)) kids.push(h('p', { class: 'panel' }, ...rich(v.text, ctx, used)));
  if (node.bullets) kids.push(h('ul', {}, node.bullets.map((b) => h('li', {}, ...rich(b, ctx, used)))));
  if (node.timeline) {
    const rowDate = (t) => { const s = renderSegments(t.date, ctx).find((x) => x.type === 'var'); return (s && w.vars[s.name]) || '9999'; };
    const rows = [...node.timeline].sort((a, b) => (rowDate(a) < rowDate(b) ? -1 : rowDate(a) > rowDate(b) ? 1 : 0));
    kids.push(h('ol', { class: 'timeline' }, rows.map((t) => {
      const when = renderSegments(t.date, ctx);
      const isPast = when.some((s) => s.type === 'var' && w.vars[s.name] && w.vars[s.name] < TODAY);
      return h('li', { class: t.deadline ? 'deadline' : null }, h('span', { class: 'when' }, ...rich(t.date, ctx, used, { noGloss: true }), isPast ? h('span', { class: 'past' }, ' (this date has passed: act as soon as possible)') : null),
        ...rich(t.text, ctx, used));
    })));
    if (node.id === 'OUT_SIGNUP_TIMELINE') kids.push(penaltyCalc(w));
  }
  if (['OUT_LEAN_MEDIGAP', 'OUT_LEAN_MA', 'OUT_CLOSE_CALL', 'OUT_NO_MEDIGAP_WINDOW'].includes(node.id)) kids.push(whyList(w));
  if (node.calculator === 'MEDIGAP_COMPARE') kids.push(medigapCalc(w));
  if (node.type === 'calculator' && node.calculator === 'IRMAA') kids.push(irmaaCalc(w));
  kids.push(factList(node.fact_refs), navButtons(node, { continue: true }));
  return kids;
}

// ---------- calculators ----------
function numInput(id, label, value, onchange, attrs = {}) {
  return h('div', {}, h('label', { class: 'field', for: id }, label),
    h('input', { id, type: 'number', inputmode: 'decimal', min: 0, value: value === undefined || value === null ? '' : value,
      oninput: (e) => onchange(e.target.value), ...attrs }));
}

function penaltyCalc(w) {
  const p = state.calc.penalty;
  const dy = w.vars.decision_year;
  if (!p.bYear) p.bYear = dy;
  if (!p.dYear) p.dYear = dy;
  const out = h('div', { 'aria-live': 'polite' });
  const yearsB = yearsFor(['partb_premium'], [dy, dy + 1]);
  const yearsD = yearsFor(['partd_base'], [dy, dy + 1]);
  const update = () => {
    const b = partBPenalty(FACTS, Math.max(0, Math.floor(+p.bMonths || 0)), +p.bYear);
    const d = partDPenalty(FACTS, Math.max(0, Math.floor(+p.dMonths || 0)), +p.dYear);
    out.replaceChildren(
      h('p', {}, `Part B: ${b.pct}% penalty → about `, h('strong', {}, formatUSD(b.monthly, { cents: true })), ' a month', ' ', badgeForVar('pb', { label: 'INFERRED', confidence: 'high',
        how: `Standard premium for ${b.premiumYear} × (1 + ${FACTS.partb_penalty.value.pct_per_full_12_months}% for each full 12 months late), rounded to ${formatUSD(FACTS.partb_penalty.value.round_to, { cents: true })} (fact partb_penalty).` }),
      b.placeholder ? ` Uses the ${b.premiumYear} premium as a placeholder (newer figure not published).` : '', ...factMarks(FACTS[b.factId])),
      h('p', {}, 'Part D: about ', h('strong', {}, formatUSD(d.monthly, { cents: true })), ' a month added', ' ', badgeForVar('pd', { label: 'INFERRED', confidence: 'high',
        how: `Months without creditable coverage × ${FACTS.partd_penalty.value.pct_per_month}% × the ${d.baseYear} national base premium, rounded to ${formatUSD(FACTS.partd_penalty.value.round_to, { cents: true })} (fact partd_penalty).` }),
      d.placeholder ? ` Uses the ${d.baseYear} base premium as a placeholder.` : '', ...factMarks(FACTS[d.factId])));
    storageSet();
  };
  const yearSel = (id, label, years, key) => h('div', {}, h('label', { class: 'field', for: id }, label),
    h('select', { id, onchange: (e) => { p[key] = +e.target.value; update(); } }, years.map((y) => h('option', { value: y, selected: +p[key] === y }, String(y)))));
  update();
  return h('details', { class: 'panel' }, h('summary', {}, 'What if I sign up late? (penalty helper)'),
    h('p', { class: 'small' }, 'You will not owe these if you sign up on time. This shows what a delay would cost.', ...factMarks(FACTS.partb_penalty), ...factMarks(FACTS.partd_penalty)),
    h('div', { class: 'row' }, numInput('pen-b', 'Months late for Part B', p.bMonths, (v) => { p.bMonths = v; update(); }), yearSel('pen-by', 'Year', yearsB, 'bYear')),
    h('div', { class: 'row' }, numInput('pen-d', 'Months without drug coverage', p.dMonths, (v) => { p.dMonths = v; update(); }), yearSel('pen-dy', 'Year', yearsD, 'dYear')),
    out);
}

function medigapCalc(w) {
  const c = state.calc.medigap;
  const dy = w.vars.decision_year;
  if (!c.year) c.year = dy;
  const rates = FACTS.nj_medigap_rates_jun2026.value;
  const range = (r) => `e.g. ${formatUSD(r.low)} to ${formatUSD(r.high)} at 65`;
  const out = h('div', { 'aria-live': 'polite' });
  const types = FACTS.medigap_compare_year_types.value;
  const update = () => {
    const r = medigapCompare(FACTS, c);
    const cell = (v) => h('td', { class: 'num' }, v === null ? 'enter a quote' : formatUSD(v));
    const ph = [];
    if (r.placeholders.partB) ph.push(`Part B deductible uses ${r.placeholders.partB} (newer figure not published). `);
    if (r.placeholders.partA) ph.push(`Part A deductible uses ${r.placeholders.partA}. `);
    if (r.placeholders.hd) ph.push(`High-deductible amount uses ${r.placeholders.hd}. `);
    out.replaceChildren(
      h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Results table (scrolls sideways if needed)' }, h('table', {}, h('caption', { class: 'small' }, 'Estimated yearly cost: 12 × premium + your share of Medicare-covered costs'),
        h('thead', {}, h('tr', {}, h('th', {}, 'Plan G'), h('th', {}, 'Plan N'), h('th', {}, 'High-Deductible G'))),
        h('tbody', {}, h('tr', {}, cell(r.g), cell(r.n), cell(r.hdg)))),
      h('p', { class: 'small' }, `Medicare-covered costs this year type: ${formatUSD(r.costSharing)}. Part B deductible ${formatUSD(r.partBDeductible)}; high-deductible amount ${formatUSD(r.hdDeductible)}. `,
        ...ph, ' Drug plan premiums are the same for all three and are left out. ', badgeForVar('mg', { label: 'INFERRED', confidence: 'medium',
          how: 'Simplified model (SPEC 5c): G = deductible part only; N adds office and ER copays and excess charges; High-Deductible G pays after its deductible.' }),
        ...factMarks(FACTS.medigap_compare_year_types), ...factMarks(FACTS.plan_n_differences), ...factMarks(FACTS.hdg_deductible))));
    storageSet();
  };
  const set = (k) => (v) => { c[k] = v; update(); };
  const radio = (val, text) => h('label', { class: 'remember' }, h('input', { type: 'radio', name: 'yt', value: val, checked: c.yearType === val,
    onchange: () => { c.yearType = val; update(); } }), text);
  update();
  return h('div', { class: 'panel' }, h('h2', {}, 'Compare Plans G, N and High-Deductible G'),
    h('p', { class: 'small' }, 'Enter real monthly quotes for your age. The examples are the June 2026 age-65 range in New Jersey.', ...factMarks(FACTS.nj_medigap_rates_jun2026)),
    h('div', { class: 'row' },
      numInput('mg-g', 'Plan G monthly quote', c.g, set('g'), { placeholder: range(rates.plan_g) }),
      numInput('mg-n', 'Plan N monthly quote', c.n, set('n'), { placeholder: range(rates.plan_n) }),
      numInput('mg-h', 'High-Deductible G monthly quote', c.hdg, set('hdg'), { placeholder: range(rates.hd_plan_g) })),
    h('div', { class: 'row' },
      numInput('mg-o', 'Office visits a year', c.office, set('office')),
      numInput('mg-e', 'ER visits a year', c.er, set('er')),
      numInput('mg-x', 'Excess charges a year', c.excess, set('excess'))),
    h('fieldset', {}, h('legend', {}, 'What kind of year?'),
      radio('healthy', `Healthy (${formatUSD(types.healthy)} of Medicare-covered costs)`),
      radio('moderate', `Moderate (${formatUSD(types.moderate)})`),
      radio('bad', `Bad year (one hospital stay: Part A deductible + ${formatUSD(types.bad_extra)})`)),
    h('div', {}, h('label', { class: 'field', for: 'mg-year' }, 'Plan year'),
      h('select', { id: 'mg-year', onchange: (e) => { c.year = +e.target.value; update(); } },
        yearsFor(['partb_deductible', 'parta_deductible'], [dy, ...Object.keys(FACTS.hdg_deductible.value).map(Number)])
          .map((y) => h('option', { value: y, selected: +c.year === y }, String(y) + (y === dy ? ' (your first Medicare year)' : '')))),
      h('p', { class: 'small' }, 'Years without published figures use the latest earlier figure (noted under the table).')),
    out);
}

function irmaaCalc(w) {
  const c = state.calc.irmaa;
  const v = w.vars;
  let partbStart = v.partb_start;
  let assumedStart = false;
  if (!partbStart) { partbStart = `${TODAY.slice(0, 4)}-01-01`; assumedStart = true; }
  const firstYear = yearOf(partbStart);
  const lastYear = firstYear + 3; // four premium years from the first Part B year
  const taxYears = [];
  for (let y = firstYear - 2; y <= lastYear; y++) taxYears.push(y);
  const t = irmaaTableFor(FACTS, firstYear);
  const presets = h('datalist', { id: 'magi-presets' }, (t ? t.table : []).filter((r) => r.joint_magi_max).map((r) => h('option', { value: r.joint_magi_max })));
  const out = h('div', { 'aria-live': 'polite' });
  const update = () => {
    const rows = irmaaSchedule(FACTS, { partbStart, wifeMedicareStart: v.wife_medicare_start, wifeHasB: c.wifeHasB,
      lastWorkMonth: w.effective.last_work_month, magi: c.magi, oneTime: c.oneTime, lastYear });
    const anyPlaceholder = rows.some((r) => r.placeholder);
    const tierText = (r) => (r.missing ? `enter ${r.missing}` : `Tier ${r.tier}`);
    const costText = (r) => (r.missing ? '—' : formatUSD(r.surcharge));
    const appealText = (r) => (r.missing ? '—' : !r.appealable ? 'Not likely to help' : r.appealMissing ? `enter ${r.appealMissing}` : formatUSD(r.appealSurcharge));
    // H9: on narrow screens each premium year is a card (CSS shows cards or the table).
    const cards = h('ul', { class: 'irmaa-cards' }, rows.map((r) => h('li', { class: 'result' },
      h('p', { class: 'card-title' }, `${r.year} premiums`, r.placeholder ? h('span', { class: 'small' }, ` (uses ${r.tableYear} brackets: placeholder)`) : ''),
      h('dl', {},
        h('dt', {}, 'Uses income from'), h('dd', {}, String(r.taxYear)),
        h('dt', {}, 'Income tier'), h('dd', {}, tierText(r)),
        h('dt', {}, 'Months charged (you + wife)'), h('dd', {}, `${r.himMonths} + ${r.wifeMonths}`),
        h('dt', {}, 'Extra cost that year'), h('dd', {}, costText(r)),
        h('dt', {}, 'If you appeal after retiring'), h('dd', {}, appealText(r))),
      r.cliff ? h('p', { class: 'stale' }, `Within ${formatUSD(FACTS.irmaa_cliff_margin.value)} of the next line (${formatUSD(r.cliff.nextMin)}).`) : null)));
    out.replaceChildren(cards,
      h('div', { class: 'table-wrap irmaa-table', tabindex: '0', role: 'region', 'aria-label': 'Results table (scrolls sideways if needed)' }, h('table', {},
        h('caption', { class: 'small' }, 'Extra Medicare premiums (IRMAA) by year, for the people on Medicare in your household'),
        h('thead', {}, h('tr', {}, ['Premium year', 'Uses income from', 'Income tier', 'Months charged (you + wife)', 'Extra cost that year', 'If you appeal after retiring'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, String(r.year), r.placeholder ? h('span', { class: 'small' }, ` (uses ${r.tableYear} brackets: placeholder)`) : ''),
          h('td', {}, String(r.taxYear)),
          h('td', {}, r.missing ? `enter ${r.missing}` : `Tier ${r.tier}`, r.cliff ? h('div', { class: 'stale' },
            `Within ${formatUSD(FACTS.irmaa_cliff_margin.value)} of the next line (${formatUSD(r.cliff.nextMin)}): crossing it costs about ${formatUSD(r.cliff.stepPerPersonYear)} more per person per year`) : ''),
          h('td', {}, `${r.himMonths} + ${r.wifeMonths}`),
          h('td', { class: 'num' }, r.missing ? '—' : formatUSD(r.surcharge)),
          h('td', {}, r.missing ? '—' : !r.appealable ? 'Not likely to help' : r.appealMissing ? `enter ${r.appealMissing}` :
            [formatUSD(r.appealSurcharge), r.appealOneTime ? h('div', { class: 'small' }, `Includes ${formatUSD(r.appealOneTime)} of one-time income, which still counts and can't be appealed.`) : '']))))))
      ,
      h('p', { class: 'small' }, 'Estimates only. ', badgeForVar('irmaa', { label: 'INFERRED', confidence: 'medium',
        how: 'For each premium year, the income from 2 years before sets the tier (fact irmaa_lookback); each person on Medicare that month pays the Part B + Part D surcharge (fact irmaa_per_person). The appeal column uses that year\'s own income estimate (facts lce_attestation, lce_effective).' }),
        anyPlaceholder ? ' Years without official brackets use the latest published table and are placeholders.' : '',
        assumedStart ? ` Your Part B start date is unknown, so this assumes Part B all of ${firstYear} (ASSUMED).` : '',
        ...factMarks(FACTS.irmaa_table_2026), ...factMarks(FACTS.partb_2027_status)));
    storageSet();
  };
  // One collapsible group per tax year; open for the years that set his first two premium years, and any with entries.
  const rowsIn = taxYears.map((y) => h('details', { class: 'taxyear', open: y === firstYear - 2 || y === firstYear - 1 || c.magi[y] !== undefined },
    h('summary', {}, `Income for ${y}`, y + 2 > lastYear ? ' (used only for an appeal)'
      : ` (sets ${y + 2} premiums${y >= firstYear ? '; also used for an appeal' : ''})`),
    h('div', { class: 'row' },
      numInput(`magi-${y}`, `Joint income (MAGI) for ${y}`, c.magi[y], (val) => { if (val === '') delete c.magi[y]; else c.magi[y] = +val; update(); },
        { list: 'magi-presets', step: 1000 }),
      numInput(`one-${y}`, `One-time part of ${y} (Roth conversions, gains)`, c.oneTime[y], (val) => { if (val === '') delete c.oneTime[y]; else c.oneTime[y] = +val; update(); }, { step: 1000 }))));
  update();
  return h('div', { class: 'panel' },
    h('p', {}, 'What counts as income: ', ...rich('{{fact:irmaa_magi_definition}}', ctxFor(w), new Set())),
    h('label', { class: 'remember' }, h('input', { type: 'checkbox', checked: c.wifeHasB, onchange: (e) => { c.wifeHasB = e.target.checked; update(); } }),
      'My wife will have Part B and a drug plan when her Medicare starts'),
    presets, ...rowsIn, out);
}

// ---------- summary ----------
function screenSummary(node, ctx, used, w) {
  const p = collectPath(TREE, w, FACTS, TODAY);
  const kids = [h('h1', { tabindex: '-1' }, node.title), h('p', {}, node.text)];
  if (p.stale.length) kids.push(h('div', { class: 'warn', role: 'note' }, h('strong', {}, 'Some numbers may be out of date. '),
    `${p.stale.length} facts on your path are past their review date. Check the source links before relying on them.`));
  kids.push(h('div', { class: 'nav no-print' }, h('button', { type: 'button', onclick: () => window.print() }, 'Print this page'),
    state.pos > 0 ? h('button', { type: 'button', class: 'secondary', onclick: () => go(state.pos - 1) }, 'Back') : null));

  const outcomes = w.screens.map((id) => BY_ID[id]).filter((n) => n.type === 'outcome');
  kids.push(h('h2', {}, 'Your results'), h('ul', {}, outcomes.map((n) => h('li', {}, renderPlain(n.title, ctx)))));

  // H7: the dates that carry penalties, printed first.
  const deadlines = (TREE.key_deadlines || []).filter((d) => isValidDate(w.vars[d.var]) && evalWhen(d.when, w.vars))
    .map((d) => ({ ...d, date: w.vars[d.var] })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (deadlines.length) {
    kids.push(h('h2', {}, 'Key deadlines'), h('table', { class: 'deadlines' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'What happens'))),
      h('tbody', {}, deadlines.map((d) => h('tr', { class: d.deadline ? 'deadline' : null },
        h('td', { class: 'num' }, formatDate(d.date)),
        h('td', {}, d.deadline ? h('strong', {}, 'Deadline: ') : '', renderPlain(d.text, ctx), d.date < TODAY ? ' (this date has passed)' : ''))))),
    h('p', { class: 'small' }, 'Dates are estimates from your answers. Each one is explained, with its source, on the screens before this one.'));
  }

  kids.push(h('h2', {}, 'Your dated to-do list'), h('ul', { class: 'acts' }, p.actions.map((a) => h('li', {},
    h('strong', {}, a.past ? 'As soon as possible' : formatDate(a.date)), ` (${renderPlain(a.when_text, ctx)}${a.past ? `; the suggested date, ${formatDate(a.ruleDate)}, has passed` : ''}): `,
    ...rich(a.text, ctx, used, { noGloss: true }), ...(a.fact_refs || []).map((id) => FACTS[id]).filter(Boolean).flatMap(factMarks)))));
  for (const n of p.notes) kids.push(h('p', { class: 'warn' }, `We need ${n.needs} to compute this: `, renderPlain(TREE.actions[n.action].text, ctx)));

  kids.push(h('h2', {}, 'Questions to ask'));
  for (const who of ['HR', 'NJ SHIP', 'Social Security']) {
    const qs = p.questions[who] || [];
    if (!qs.length) continue;
    kids.push(h('h3', {}, who === 'NJ SHIP' ? `NJ SHIP (${FACTS.nj_ship_contact.value})` : who),
      h('ul', { class: 'qs' }, qs.map((q) => h('li', {}, ...rich(q.text, ctx, used, { noGloss: true })))));
  }

  kids.push(h('h2', {}, 'Open items'), h('ul', {}, (TREE.open_items || []).map((o) => h('li', {}, o.text,
    ...o.fact_refs.map((id) => FACTS[id]).filter(Boolean).flatMap(factMarks)))));

  kids.push(h('h2', {}, 'Sources'), h('ol', {}, p.factIds.map((id) => FACTS[id]).filter(Boolean).map((f) => h('li', {},
    h('span', {}, f.plain), ' ', h('span', { class: 'badge ' + f.label }, f.label), ' ',
    f.source ? h('a', { href: f.source.url, target: '_blank', rel: 'noopener noreferrer' }, f.source.title) : h('span', { class: 'small' }, '(no outside source: ' + f.label.toLowerCase() + ')'),
    isStale(f, TODAY) ? h('span', { class: 'stale' }, ' may be out of date') : ''))));

  kids.push(h('details', { class: 'no-print' }, h('summary', {}, 'Change my answers'),
    h('ul', {}, w.screens.map((id, i) => [BY_ID[id], i]).filter(([n]) => n.type === 'question' || n.type === 'input').map(([n, i]) => {
      const a = state.answers[n.var];
      const shown = n.type === 'question' ? renderPlain((n.options.find((o) => o.value === a) || {}).label || '', ctx)
        : a === 'unknown' ? "I don't know" : a === 'default' ? 'assumed' : renderPlain(`{{${n.var}}}`, { ...ctx, vars: { [n.var]: a } });
      return h('li', {}, renderPlain(n.text, ctx), ' — ', h('strong', {}, shown), ' ',
        h('button', { type: 'button', class: 'secondary', onclick: () => go(i) }, 'Change'));
    }))));
  return kids;
}

// ---------- render ----------
function render(moveFocus) {
  W = walk(TREE, state.answers, FACTS, TODAY);
  state.pos = Math.min(Math.max(0, state.pos | 0), W.screens.length - 1);
  const node = BY_ID[W.screens[state.pos]];
  const ctx = ctxFor(W);
  const used = new Set();
  let kids;
  if (node.type === 'question') kids = screenQuestion(node, ctx, used);
  else if (node.type === 'input') kids = screenInput(node, ctx, used);
  else if (node.type === 'summary') kids = screenSummary(node, ctx, used, W);
  else kids = screenOutcome(node, ctx, used, W);
  const main = document.getElementById('main');
  main.replaceChildren(...kids.filter(Boolean));
  main.dataset.node = node.id;
  renderProgress(node);
  if (moveFocus) {
    const h1 = main.querySelector('h1');
    if (h1) h1.focus();
    window.scrollTo(0, 0);
  }
}

function init() {
  const saved = storageGet();
  if (saved && saved.answers) {
    state = { ...freshState(), ...saved, calc: { ...freshState().calc, ...(saved.calc || {}) } };
    remember = true;
    note('Your saved answers were loaded from this device.');
  }
  const box = document.getElementById('remember');
  box.checked = remember;
  box.addEventListener('change', () => {
    remember = box.checked;
    if (remember) { if (storageSet()) note('Your answers will be saved on this device only.'); }
    else { storageClear(); note('Answers are no longer saved on this device.'); }
  });
  // M8: clearing takes a second, deliberate click; the confirm buttons go away after 10 seconds.
  const clearBtn = document.getElementById('clear');
  const confirmBox = document.getElementById('clear-confirm');
  let confirmTimer = null;
  const hideConfirm = () => { confirmBox.hidden = true; clearBtn.hidden = false; clearTimeout(confirmTimer); };
  clearBtn.addEventListener('click', () => {
    clearBtn.hidden = true;
    confirmBox.hidden = false;
    document.getElementById('clear-no').focus(); // the safe choice gets focus
    confirmTimer = setTimeout(() => { hideConfirm(); clearBtn.focus(); }, 10000);
  });
  document.getElementById('clear-no').addEventListener('click', () => { hideConfirm(); clearBtn.focus(); });
  document.getElementById('clear-yes').addEventListener('click', () => {
    hideConfirm();
    storageClear();
    remember = false;
    box.checked = false;
    state = freshState();
    note('Your answers were cleared, and saving on this device is off.');
    render(true);
  });
  renderFooter();
  render(false);
}

init();
window.__guide = { log: LOG, today: TODAY };
