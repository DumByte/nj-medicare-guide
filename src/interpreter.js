// Pure tree interpreter: conditions, routes, path walking, actions, questions and the {{ }} token renderer.
// No DOM access and no eval.
import { compute, formatDate, formatMonth, formatUSD, isValidDate, isValidMonth, addDays, addMonths,
  isStale, pickYearFact, pickYearKey } from './engine.js';

// ---------- conditions ----------
export function evalClause(c, vars) {
  const x = vars[c.var];
  const isSet = x !== undefined && x !== null;
  switch (c.op) {
    case 'eq': return isSet && x === c.value;
    case 'ne': return x !== c.value;
    case 'in': return isSet && Array.isArray(c.value) && c.value.includes(x);
    case 'lt': return typeof x === 'number' && x < c.value;
    case 'lte': return typeof x === 'number' && x <= c.value;
    case 'gt': return typeof x === 'number' && x > c.value;
    case 'gte': return typeof x === 'number' && x >= c.value;
    case 'set': return isSet;
    case 'unset': return !isSet;
    default: throw new Error('Unknown op: ' + c.op);
  }
}

export const evalWhen = (when, vars) => !when || when.every((c) => evalClause(c, vars));

export function pickRoute(route, vars) {
  for (const entry of route) if (evalWhen(entry.when, vars)) return entry;
  return null;
}

// ---------- tokens ----------
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function resolveFactPath(facts, ref) {
  const [id, ...path] = ref.split('.');
  const fact = facts[id];
  if (!fact) return { ok: false, id };
  if (!path.length) return { ok: true, id, fact, whole: true };
  let v = fact;
  for (const key of path) {
    if (v === null || typeof v !== 'object' || !(key in v)) return { ok: false, id, fact };
    v = v[key];
  }
  return { ok: true, id, fact, value: v, path: path.join('.') };
}

// {{fig:prefix.path}}: a yearly dollar figure for `year`. Uses the year-keyed fact prefix_YYYY, or a fact
// `prefix` whose value is keyed by year, falling back to the latest earlier year (a placeholder).
export function resolveFigure(facts, ref, year) {
  const [prefix, ...path] = ref.split('.');
  let fact, figYear, value;
  // Only later years published (e.g. a 2027 limit viewed in 2026): use the earliest of them.
  const firstYear = (years) => years.length ? Math.min(...years) : null;
  const re = new RegExp('^' + prefix + '_(\\d{4})$');
  const idYears = Object.keys(facts).map((id) => (re.exec(id) || [])[1]).filter(Boolean).map(Number);
  const byId = pickYearFact(facts, prefix, year) || (idYears.length
    ? { fact: facts[`${prefix}_${firstYear(idYears)}`], year: firstYear(idYears) } : null);
  if (byId) { fact = byId.fact; figYear = byId.year; value = fact.value; }
  else if (facts[prefix] && facts[prefix].value && typeof facts[prefix].value === 'object') {
    const obj = facts[prefix].value;
    const k = pickYearKey(obj, year) || { year: firstYear(Object.keys(obj).map(Number)), value: obj[firstYear(Object.keys(obj).map(Number))] };
    if (k.year === null) return { ok: false };
    fact = facts[prefix]; figYear = k.year; value = k.value;
  } else return { ok: false };
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !(key in value)) return { ok: false };
    value = value[key];
  }
  if (typeof value !== 'number') return { ok: false };
  return { ok: true, id: fact.id, value, year: figYear, placeholder: figYear !== year };
}

export function figureText(r, year) {
  if (!r.placeholder) return `${formatUSD(r.value)} (${r.year})`;
  return r.year < year ? `${formatUSD(r.value)} (${r.year} figure; the ${year} amount isn't published yet)`
    : `${formatUSD(r.value)} (${r.year} figure)`;
}

// Value inside a fact: numbers are dollars; ISO dates and months are spelled out.
export function formatFactValue(v) {
  if (typeof v === 'number') return formatUSD(v);
  if (typeof v === 'string') return formatVarValue(v);
  return null;
}

export function formatVarValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    if (isValidDate(v)) return formatDate(v);
    if (isValidMonth(v)) return formatMonth(v);
    return v;
  }
  return null;
}

export const NOT_ENTERED = '(not answered yet)';

// ctx: { facts, vars, meta, log(msg) }. Returns segments for the UI.
export function renderSegments(text, ctx) {
  const segs = [];
  if (typeof text !== 'string') return segs;
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > last) segs.push({ type: 'text', text: text.slice(last, m.index) });
    last = m.index + m[0].length;
    const tok = m[1];
    if (tok.startsWith('fact:')) {
      const r = resolveFactPath(ctx.facts, tok.slice(5));
      if (!r.ok) {
        ctx.log && ctx.log(`Unresolved fact token {{${tok}}}`);
        segs.push({ type: 'text', text: NOT_ENTERED, unresolved: tok });
        continue;
      }
      const shown = r.whole ? r.fact.plain.replace(/([^.!?)])$/, '$1.') : formatFactValue(r.value);
      if (shown === null) {
        ctx.log && ctx.log(`Fact value not displayable {{${tok}}}`);
        segs.push({ type: 'text', text: NOT_ENTERED, unresolved: tok });
        continue;
      }
      segs.push({ type: 'fact', id: r.id, whole: !!r.whole, text: shown });
    } else if (tok.startsWith('fig:')) {
      const year = (ctx.vars && ctx.vars.decision_year) || +String((ctx.vars && ctx.vars.today) || '').slice(0, 4);
      const r = resolveFigure(ctx.facts, tok.slice(4), year);
      if (!r.ok) {
        ctx.log && ctx.log(`Unresolved figure token {{${tok}}}`);
        segs.push({ type: 'text', text: NOT_ENTERED, unresolved: tok });
        continue;
      }
      segs.push({ type: 'fact', id: r.id, whole: false, text: figureText(r, year), placeholder: r.placeholder });
    } else {
      const name = tok;
      const raw = ctx.vars[name];
      let shown = formatVarValue(raw);
      if (ctx.meta && ctx.meta[name] && ctx.meta[name].format === 'month' && isValidDate(raw)) shown = formatMonth(raw.slice(0, 7));
      if (raw === 'unknown' || (shown === null && ctx.meta && ctx.meta[name] && ctx.meta[name].unknown)) shown = 'unknown';
      if (shown === null) {
        ctx.log && ctx.log(`Unresolved variable {{${name}}}`);
        segs.push({ type: 'text', text: NOT_ENTERED, unresolved: name });
        continue;
      }
      segs.push({ type: 'var', name, text: shown, meta: ctx.meta ? ctx.meta[name] : undefined });
    }
  }
  if (last < text.length) segs.push({ type: 'text', text: text.slice(last) });
  return segs;
}

export const renderPlain = (text, ctx) => renderSegments(text, ctx).map((s) => s.text).join('');

export function factIdsIn(text) {
  const ids = [];
  if (typeof text !== 'string') return ids;
  for (const m of text.matchAll(TOKEN_RE)) if (m[1].startsWith('fact:')) ids.push(m[1].slice(5).split('.')[0]);
  return ids;
}

// Fact ids behind {{fig:...}} tokens for this path's year.
function figIdsIn(text, facts, vars) {
  const ids = [];
  if (typeof text !== 'string') return ids;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (!m[1].startsWith('fig:')) continue;
    const r = resolveFigure(facts, m[1].slice(4), vars.decision_year);
    if (r.ok) ids.push(r.id);
  }
  return ids;
}

// ---------- inputs ----------
export function validateInput(node, value) {
  if (value === 'unknown') return node.allow_unknown ? null : 'Pick an answer.';
  if (value === 'default') return node.default_from ? null : 'Pick an answer.';
  if (node.input === 'month') {
    if (!isValidMonth(value)) return 'Pick a month and a year.';
    if (node.validate && node.validate.min && value < node.validate.min) return `Pick ${formatMonth(node.validate.min)} or later.`;
    if (node.validate && node.validate.max && value > node.validate.max) return `Pick ${formatMonth(node.validate.max)} or earlier.`;
    return null;
  }
  if (node.input === 'date') return isValidDate(value) ? null : 'Pick a month, a day and a year.';
  return null;
}

// ---------- walking ----------
const SCREEN_TYPES = new Set(['info', 'question', 'input', 'outcome', 'calculator', 'summary']);

// Walk from the start node using `answers`. Info/outcome/calculator screens pass through; the walk
// stops at the first unanswered question/input, or at the summary. Only answers on the current
// path (plus option `sets`) become effective, so changing an early answer drops stale later ones.
export function walk(tree, answers, facts, today) {
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const eff = {};
  const screens = [];
  const routeQuestions = [];
  let id = tree.meta.start;
  let result = null;
  const vars = () => {
    const c = compute(eff, facts, today);
    result = c;
    return { ...eff, ...c.values };
  };
  for (let guard = 0; id && guard < 500; guard++) {
    const node = byId[id];
    if (!node) throw new Error('Missing node ' + id);
    if (SCREEN_TYPES.has(node.type)) screens.push(id);
    if (node.type === 'question' || node.type === 'input') {
      const ans = answers[node.var];
      if (ans === undefined || ans === null || ans === '') return finish(null);
      if (node.type === 'question') {
        const opt = node.options.find((o) => o.value === ans);
        if (!opt) return finish(null);
        eff[node.var] = ans;
        Object.assign(eff, opt.sets || {});
        id = opt.next;
      } else {
        if (validateInput(node, ans)) return finish(null);
        eff[node.var] = ans;
        id = node.next;
      }
    } else if (node.type === 'route' || node.type === 'score') {
      const entry = pickRoute(node.route, vars());
      if (!entry) throw new Error('No route matched at ' + id);
      routeQuestions.push(...(entry.add_questions || []));
      id = entry.next;
    } else if (node.type === 'summary') {
      return finish(id);
    } else {
      id = node.next;
    }
  }
  return finish(null);

  function finish(summaryId) {
    const v = vars();
    return { screens, complete: !!summaryId, effective: { ...eff }, vars: v, meta: result.meta,
      notes: result.notes, engineQuestions: result.questions, routeQuestions };
  }
}

// ---------- actions and questions ----------
const DATE_RULE_RE = /^([a-z_][a-z0-9_]*)(?:([+-])(\d+)([dm]))?$/;

export function resolveActionDate(rule, vars, today) {
  const m = DATE_RULE_RE.exec(rule || '');
  if (!m) throw new Error('Bad date_rule: ' + rule);
  const [, name, sign, num, unit] = m;
  const base = name === 'today' ? today : vars[name];
  if (!isValidDate(base)) return { missing: name };
  if (!sign) return { date: base };
  const n = (sign === '-' ? -1 : 1) * +num;
  return { date: unit === 'd' ? addDays(base, n) : addMonths(base, n) };
}

const NEEDS = {
  job_cov_end: 'the month you plan to stop working', partb_start: 'your Part B start date',
  partb_file_by: 'the month you plan to stop working', wife_medicare_start: "your wife's date of birth",
  wife_cobra_end: "your wife's date of birth and when you stop working", irmaa_first_year_jan: 'your Part B start date',
  ssa44_date: 'your Part B start date', drug_enroll_by_no_gap: 'the month you plan to stop working',
  parta_signup_by: 'whether you have Part A', parta_signup_earliest_for_36: 'the month you plan to stop working',
  medigap_window_close: 'your Part B start date', nj_gi_window_close: 'the month you plan to stop working',
  wife_partb_file_by: "your wife's date of birth and when you stop working"
};

export function collectPath(tree, w, facts, today) {
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const actionIds = [], questionIds = [], factIds = [];
  const push = (arr, xs) => { for (const x of xs || []) if (!arr.includes(x)) arr.push(x); };
  for (const sid of w.screens) {
    const n = byId[sid];
    push(actionIds, n.add_actions);
    push(questionIds, n.add_questions);
    push(factIds, n.fact_refs);
    for (const t of nodeTexts(n, w.vars)) { push(factIds, factIdsIn(t)); push(factIds, figIdsIn(t, facts, w.vars)); }
  }
  push(questionIds, w.routeQuestions);
  push(questionIds, w.engineQuestions);
  push(questionIds, tree.always_include_questions);

  const actions = [];
  const notes = [];
  for (const aid of actionIds) {
    const a = tree.actions[aid];
    if (!evalWhen(a.when, w.vars)) continue; // action applies only on some paths
    const r = resolveActionDate(a.date_rule, w.vars, today);
    push(factIds, a.fact_refs);
    push(factIds, factIdsIn(a.text));
    if (r.missing) {
      if (r.missing === 'gcnj_oe_before_retire') continue; // requirement 8: no qualifying window -> omit
      notes.push({ action: aid, needs: NEEDS[r.missing] || r.missing });
      continue;
    }
    // X2: an action with date_end_rule is a range of months; it sorts by its start.
    const end = a.date_end_rule ? resolveActionDate(a.date_end_rule, w.vars, today).date : null;
    const past = end ? end < today : r.date < today;
    actions.push({ id: aid, date: past ? today : r.date, ruleDate: r.date, past, ...(end ? { range: { start: r.date, end } } : {}), ...a });
  }
  actions.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  const groups = {};
  for (const qid of questionIds) {
    const q = tree.questions[qid];
    if (!q || !evalWhen(q.when, w.vars)) continue;
    (groups[q.to] = groups[q.to] || []).push({ id: qid, ...q });
    push(factIds, factIdsIn(q.text));
  }
  for (const oi of tree.open_items || []) push(factIds, oi.fact_refs);
  const stale = factIds.filter((id) => facts[id] && isStale(facts[id], today));
  return { actions, notes, questions: groups, factIds, stale };
}

// All renderable strings of a node, including matching variants.
export function nodeTexts(n, vars) {
  const out = [n.title, n.text, n.help, n.subtext, ...(n.bullets || []), ...(n.more || [])];
  for (const v of n.variants || []) if (evalWhen(v.when, vars)) out.push(v.text);
  for (const t of n.timeline || []) out.push(t.date, t.text, t.detail);
  for (const o of n.options || []) out.push(o.label);
  return out.filter((t) => typeof t === 'string');
}

export function modulesOf(tree) {
  const mods = [];
  for (const n of tree.nodes) if (n.module && !mods.includes(n.module)) mods.push(n.module);
  return mods;
}

// ---------- presentation helpers (UX review) ----------
// X3: the plain word shown right after a fact that is not settled, since its badge is no longer in the text.
const CONF_WORDS = { UNVERIFIED: 'not confirmed', ASSUMED: 'our guess', PENDING: 'not published yet' };
export function confidenceWord(fact) {
  if (!fact) return null;
  if (CONF_WORDS[fact.label]) return CONF_WORDS[fact.label];
  // INFERRED from a law or rule (it has a source) is our reading of it; INFERRED from his answers needs no word.
  if (fact.label === 'INFERRED' && fact.source) return 'our reading of the rule';
  return null;
}

// H6: the three steps shown first on the summary. Overdue steps first, then the earliest key step, then
// the earliest of the rest; shown in date order. `actions` is collectPath(...).actions (already date-sorted).
export function topSteps(actions, n = 3) {
  const out = [];
  const add = (a) => { if (a && out.length < n && !out.includes(a)) out.push(a); };
  actions.filter((a) => a.past).sort((a, b) => (a.ruleDate < b.ruleDate ? -1 : a.ruleDate > b.ruleDate ? 1 : 0)).forEach(add);
  add(actions.find((a) => a.key));
  actions.forEach(add);
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// H2: the step for the "Next step" line at the top: the first step on the path so far, once the guide
// knows when his job plan ends.
export function nextStep(tree, w, facts, today) {
  if (!w.vars.job_cov_end) return null;
  return collectPath(tree, w, facts, today).actions[0] || null;
}
