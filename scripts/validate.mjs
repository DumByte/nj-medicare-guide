// T14: every {{fact:id}}, fact_refs, add_actions, add_questions, next and route.next resolves; every node is
// reachable from the start; every fact has source.url unless ASSUMED or INFERRED from the user's inputs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexFacts } from '../src/engine.js';
import { resolveFactPath, resolveFigure } from '../src/interpreter.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

// Names the engine computes (SPEC 3/4) in addition to tree.variables.
export const COMPUTED = ['as_of', 'today', 'job_cov_end', 'wife_medicare_start', 'his_entitlement', 'part_a_projected_start',
  'cobra36_eligible', 'wife_cobra_end', 'wife_cobra_rule', 'bridge_months', 'cobra_gap_months', 'retire_by_for_36',
  'wife_cobra_end_if_parta_now', 'partb_start', 'partb_file_by', 'ma_window_open', 'ma_window_close', 'drug_deadline',
  'medigap_window_close', 'medigap_window_open', 'medigap_window_status', 'gi_right', 'partb_sep_end',
  'irmaa_first_year_jan', 'gcnj_oe_before_retire', 'path_score', 'last_day_worked', 'irmaa_second_year_jan',
  'parta_signup_by', 'retire_after_36_cutoff', 'parta_signup_earliest_for_36', 'parta_signup_latest_for_36',
  'wife_cobra_end_if_parta_latest', 'drug_enroll_by_no_gap', 'drug_enroll_by_no_penalty',
  'nj_gi_window_close', 'ssa44_date', 'wife_on_medicare_at_retire', 'wife_partb_start', 'wife_partb_file_by',
  'wife_medigap_window_close', 'months_until_retire', 'decision_year'];

export function validate(tree, factsDoc) {
  const errors = [];
  const facts = indexFacts(factsDoc);
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const varNames = new Set([...Object.keys(tree.variables), ...COMPUTED]);
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  const checkText = (where, text) => {
    if (typeof text !== 'string') return;
    for (const m of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      const tok = m[1];
      if (tok.startsWith('fact:')) {
        const r = resolveFactPath(facts, tok.slice(5));
        if (!r.ok) err(where, `unresolved {{${tok}}}`);
        else if (!r.whole && typeof r.value === 'object') err(where, `{{${tok}}} is not a single value`);
      } else if (tok.startsWith('fig:')) {
        // Must resolve for every year a user can reach (this year through the latest Part B start year).
        for (let y = 2026; y <= 2031; y++) if (!resolveFigure(facts, tok.slice(4), y).ok) { err(where, `{{${tok}}} does not resolve for ${y}`); break; }
      } else if (!varNames.has(tok)) err(where, `unknown variable {{${tok}}}`);
    }
  };
  const checkFacts = (where, ids) => (ids || []).forEach((id) => facts[id] || err(where, `fact_refs: unknown fact ${id}`));
  const checkNext = (where, id) => { if (id && !byId[id]) err(where, `next: unknown node ${id}`); };
  const checkVars = (where, when) => (when || []).forEach((c) => varNames.has(c.var) || err(where, `when: unknown variable ${c.var}`));

  if (!byId[tree.meta.start]) err('meta', 'start node missing');
  for (const n of tree.nodes) {
    const w = n.id;
    for (const k of ['title', 'text', 'help']) checkText(`${w}.${k}`, n[k]);
    (n.bullets || []).forEach((b, i) => checkText(`${w}.bullets[${i}]`, b));
    (n.variants || []).forEach((v, i) => { checkText(`${w}.variants[${i}]`, v.text); checkVars(w, v.when); });
    (n.timeline || []).forEach((t, i) => { checkText(`${w}.timeline[${i}].date`, t.date); checkText(`${w}.timeline[${i}].text`, t.text); });
    checkFacts(w, n.fact_refs);
    (n.add_actions || []).forEach((a) => tree.actions[a] || err(w, `add_actions: unknown ${a}`));
    (n.add_questions || []).forEach((q) => tree.questions[q] || err(w, `add_questions: unknown ${q}`));
    checkNext(w, n.next);
    if (n.default_from && !facts[n.default_from]) err(w, `default_from: unknown fact ${n.default_from}`);
    if ((n.type === 'question' || n.type === 'input') && !varNames.has(n.var)) err(w, `unknown var ${n.var}`);
    for (const o of n.options || []) { checkNext(w, o.next); checkText(`${w}.option`, o.label); }
    for (const r of n.route || []) {
      checkNext(w, r.next); checkVars(w, r.when);
      (r.add_questions || []).forEach((q) => tree.questions[q] || err(w, `route add_questions: unknown ${q}`));
    }
    if (['info', 'outcome', 'calculator'].includes(n.type) && !n.next) err(w, 'screen has no next');
  }
  for (const [k, a] of Object.entries(tree.actions)) {
    checkText(k, a.text); checkText(k, a.when_text); checkFacts(k, a.fact_refs); checkVars(k, a.when);
    const m = /^([a-z_][a-z0-9_]*)(?:[+-]\d+[dm])?$/.exec(a.date_rule || '');
    if (!m) err(k, `bad date_rule ${a.date_rule}`);
    else if (m[1] !== 'today' && !varNames.has(m[1])) err(k, `date_rule uses unknown name ${m[1]}`);
  }
  for (const [k, q] of Object.entries(tree.questions)) { checkText(k, q.text); checkVars(k, q.when); }
  (tree.key_deadlines || []).forEach((d, i) => {
    if (!varNames.has(d.var)) err(`key_deadlines[${i}]`, `unknown variable ${d.var}`);
    checkText(`key_deadlines[${i}]`, d.text); checkVars(`key_deadlines[${i}]`, d.when);
  });
  (tree.always_include_questions || []).forEach((q) => tree.questions[q] || err('always_include_questions', `unknown ${q}`));
  for (const [k, g] of Object.entries(tree.glossary || {})) if (g.fact && !facts[g.fact]) err(`glossary.${k}`, `unknown fact ${g.fact}`);
  for (const oi of tree.open_items || []) checkFacts('open_items', oi.fact_refs);

  // Reachability
  const seen = new Set();
  const stack = [tree.meta.start];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id) || !byId[id]) continue;
    seen.add(id);
    const n = byId[id];
    stack.push(n.next, ...(n.options || []).map((o) => o.next), ...(n.route || []).map((r) => r.next));
  }
  for (const n of tree.nodes) if (!seen.has(n.id)) err(n.id, 'not reachable from start');

  // Sources
  for (const f of factsDoc.facts) {
    const exempt = f.label === 'ASSUMED' || (f.label === 'INFERRED' && f.derivation && !f.source);
    if (!exempt && !(f.source && /^https:\/\//.test(f.source.url))) err(`fact ${f.id}`, 'missing source.url');
    if (!['VERIFIED', 'UNVERIFIED', 'INFERRED', 'ASSUMED', 'PENDING'].includes(f.label)) err(`fact ${f.id}`, `bad label ${f.label}`);
    if ((f.label === 'UNVERIFIED' || f.label === 'INFERRED') && !f.confidence) err(`fact ${f.id}`, 'needs a confidence');
  }
  return { errors, nodes: tree.nodes.length, reachable: seen.size, facts: factsDoc.facts.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = validate(read('src/data/tree.json'), read('src/data/facts.json'));
  for (const e of r.errors) console.log('ERROR ' + e);
  console.log(`${r.nodes} nodes (${r.reachable} reachable from start), ${r.facts} facts: ${r.errors.length ? r.errors.length + ' errors' : 'all checks passed'}.`);
  process.exit(r.errors.length ? 1 : 0);
}
