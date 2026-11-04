// Hard-coded-fact lint: finds numbers, money, percentages, dates, durations and listed rule phrases in
// tree.json copy that are NOT inside a {{ }} token. Every hit must be fixed or listed in ALLOW (with a
// reason, mirrored in NEEDS_REVIEW.md). Exit code 1 if any hit is neither.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(fs.readFileSync(path.join(root, 'src/data/tree.json'), 'utf8'));

const MONTHS = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const NUMWORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|thirty-six';
const PATTERNS = [
  ['money', /\$\s?\d[\d,]*(?:\.\d+)?/g],
  ['percent', /\b\d+(?:\.\d+)?\s?%/g],
  ['date', new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}\\b`, 'g')],
  ['duration', new RegExp(`\\b(?:\\d+\\+?|${NUMWORD})[\\s-]*(?:years?|months?|days?|weeks?|quarters?)\\b`, 'gi')],
  ['year', /\b(?:19|20)\d{2}\b/g],
  ['number', /\b\d+(?:[.,]\d+)?\+?/g]
];
// Rule statements that regexes can't find; curated by hand.
const PHRASES = ['most complete plan you can buy', 'You have no HSA', 'causes no tax problem', 'is free for you'];

// Accepted hits: [nodeOrKey, exact match, reason]. Keep in sync with NEEDS_REVIEW.md.
export const ALLOW = [
  ['OUT_WORKING_OK', '20 or more workers', 'restates fact employer_size_20, which is linked in the same screen'],
  ['OUT_WIFE_AT_65', '20+ employer', 'restates fact employer_size_20, linked in the same bullet'],
  ['OUT_WIFE_AT_65', 'fewer than 20 workers', 'restates fact employer_size_20, linked in the same bullet'],
  ['OUT_SIGNUP_TIMELINE', '6-month', 'restates fact medigap_oep, linked in the same row'],
  ['OUT_SIGNUP_TIMELINE', '8-month', 'restates fact partb_sep, linked in the same row'],
  ['OUT_LEAN_MEDIGAP', '6-month', 'restates fact medigap_oep, linked in the same screen'],
  ['OUT_PLAN_HDG', '65', 'age the linked rate chart is for'],
  ['G3', '15%', 'restates fact plan_g_benefits (excess charges up to 15%), linked via G1 fact_refs'],
  ['H2', '8 events', 'restates fact lce_list, linked in the same screen'],
  ['D2', '2027', 'labels which year the linked poverty-line facts are for'],
  ['F6', '65', 'age the linked rate chart is for'],
  ['OUT_WIFE_AT_65', '65th', 'her birthday, not a rule'],
  ['OUT_WIFE_AT_65', 'for her at 65', 'Medicare age, fact medicare_start_month'],
  ['ACT_WIFE_MEDICARE_SIGNUP', '3 months before', 'restates fact iep_window (linked in the action): her window opens 3 months before her 65th-birthday month'],
  ['ACT_WIFE_MEDICARE_SIGNUP', '65th', 'her birthday, not a rule'],
  ['ACT_BOOK_SHIP', '6 months before', 'guide timing choice (date_rule job_cov_end-6m), not a Medicare rule'],
  ['ACT_HR_QUESTIONS', '30 days', 'guide timing choice (date_rule today+30d)'],
  ['ACT_SHIP_PARTB_ALREADY', '60 days', 'guide timing choice (date_rule today+60d)'],
  ['ACT_PLAN_SHOP', '2-3 months before', 'guide timing choice (date_rule job_cov_end-75d)'],
  ['ACT_MEDIGAP_QUOTES', '2 months before', 'guide timing choice (date_rule partb_start-60d)'],
  ['ACT_WIFE_COBRA_ELECT', '60 days', 'restates fact cobra_basics (at least 60 days to elect), linked in the action'],
  ['ACT_WIFE_GCNJ_ENROLL', '60 days', 'restates fact gcnj_sep_loss, linked in the action'],
  ['Q_HR_PAYOUTS', 'particular tax year', 'not a fact'],
  ['Q_SSA_44', 'SSA-44', 'form name'],
  ['ACT_SSA44', 'SSA-44', 'form name'],
  ['OUT_WIFE_AT_65', 'SSA-44', 'form name'],
  ['ACT_PARTB_FILE', 'CMS-L564', 'form name'],
  ['ACT_PARTB_FILE', 'CMS-40B', 'form name'],
  ['OUT_SIGNUP_TIMELINE', 'CMS-L564', 'form name'],
  ['OUT_SIGNUP_TIMELINE', 'CMS-40B', 'form name'],
  ['Q_HR_L564', 'CMS-L564', 'form name'],
  ['G1', '0-4', 'answer bucket, not a fact'],
  ['G1', '5-10', 'answer bucket, not a fact'],
  ['G1', 'More than 10', 'answer bucket, not a fact'],
  ['F2', 'next few years', 'not a fact'],
  ['A7', 'born on the 1st', 'restates fact medicare_start_month, linked on the same screen'],
  ['OUT_RETIREE_COV', 'turns 65', 'Medicare age, fact medicare_start_month'],
  ['OUT_WIFE_NOT_ON_PLAN', '65th-birthday', 'Medicare age, fact medicare_start_month'],
  ['D2', 'turns 65', 'Medicare age, fact medicare_start_month'],
  ['OUT_BRIDGE_GAP', 'Options: (1)', 'list numbering'],
  ['OUT_BRIDGE_GAP', '(2)', 'list numbering'],
  ['OUT_BRIDGE_GAP', '(3)', 'list numbering'],
  ['OUT_BRIDGE_GAP', '(4)', 'list numbering'],
  ['F1', 'Way 1', 'list numbering'],
  ['F1', 'Way 2', 'list numbering'],
  ['Q_HR_COBRA_36', '36-month rule', 'names the rule in fact cobra_36_month_rule (question for HR to confirm)'],
  ['Q_HR_PARTA_ENTITLEMENT', '36-month', 'names the rule in fact cobra_36_month_rule (question for HR to confirm)'],
  ['A10', '20 or more employees', 'restates fact employer_size_20, linked on the same screen'],
  ['OUT_SMALL_EMPLOYER', 'fewer than 20', 'restates fact employer_size_20, linked in the same sentence'],
  ['OUT_WORKING_OK', 'fewer than 20', 'restates fact employer_size_20, linked on the same screen'],
  ['ACT_SHIP_NOW', 'fewer than 20', 'restates fact employer_size_20, linked in the action'],
  ['OUT_ENROLL_PARTA', '18 months', 'restates fact cobra_36_month_rule, linked in the same bullet'],
  ['OUT_BRIDGE_NONE', '6-month', 'restates fact medigap_oep, linked on the same screen'],
  ['OUT_SIGNUP_HAS_B', '63 days', 'restates fact gi_nj_state_extension, linked in the same paragraph'],
  ['OUT_NO_MEDIGAP_WINDOW', '63 days', 'restates fact gi_nj_state_extension, linked in the same paragraph'],
  ['OUT_NO_MEDIGAP_WINDOW', '6-month', 'restates fact medigap_oep (linked on G-path screens and the timeline)'],
  ['ACT_NJ_GI_CONFIRM', '63-day', 'restates fact gi_nj_state_extension, linked in the action'],
  ['ACT_NJ_GI_CONFIRM', '3 months before', 'guide timing choice (date_rule job_cov_end-90d)'],
  ['F6', 'June 2026', 'labels when the linked rate chart was published'],
  ['ACT_ASK_HR_PARTA_OK', '2 weeks', 'guide timing choice (date_rule today+14d)'],
  ['ACT_SHIP_DRUG_NOW', '2 weeks', 'guide timing choice (date_rule today+14d)'],
  ['ACT_HR_EMPLOYEES', '30 days', 'guide timing choice (date_rule today+30d)'],
  ['ACT_MEDIGAP_QUOTES_HAS_B', '2 months before', 'guide timing choice (date_rule medigap_window_close-60d)'],
  ['ACT_WIFE_PARTB_FILE', 'CMS-40B', 'form name'],
  ['key_deadlines', '6-month', 'restates fact medigap_oep, linked on the timeline screen'],
  ['key_deadlines', '8-month', 'restates fact partb_sep, linked on the timeline screen'],
  ['key_deadlines', '63-day', 'restates fact gi_nj_state_extension, linked on the outcome screen'],
  ['OUT_WIFE_AT_65', 'turns 65', 'Medicare age, fact medicare_start_month']
];

function collect() {
  const out = [];
  const add = (key, field, text) => { if (typeof text === 'string') out.push({ key, field, text }); };
  for (const n of tree.nodes) {
    add(n.id, 'text', n.text);
    add(n.id, 'help', n.help);
    (n.bullets || []).forEach((b, i) => add(n.id, `bullets[${i}]`, b));
    (n.variants || []).forEach((v, i) => add(n.id, `variants[${i}]`, v.text));
    (n.timeline || []).forEach((t, i) => { add(n.id, `timeline[${i}].text`, t.text); add(n.id, `timeline[${i}].date`, t.date); });
  }
  for (const [k, a] of Object.entries(tree.actions)) { add(k, 'text', a.text); add(k, 'when_text', a.when_text); }
  for (const [k, q] of Object.entries(tree.questions)) add(k, 'text', q.text);
  for (const [k, g] of Object.entries(tree.glossary || {})) add('glossary.' + k, 'text', g.text);
  (tree.key_deadlines || []).forEach((d) => add('key_deadlines', d.var, d.text));
  for (const n of tree.nodes) add(n.id, 'title', n.title);
  return out;
}

export function lint() {
  const hits = [];
  for (const { key, field, text } of collect()) {
    const bare = text.replace(/\{\{[^}]*\}\}/g, ' ⁣ ');
    const taken = [];
    const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);
    for (const [kind, re] of PATTERNS) {
      for (const m of bare.matchAll(re)) {
        const s = m.index, e = s + m[0].length;
        if (overlaps(s, e)) continue;
        taken.push([s, e]);
        hits.push({ key, field, kind, match: m[0].trim(), context: bare.slice(Math.max(0, s - 30), e + 30).replace(/\s+/g, ' ') });
      }
    }
    for (const p of PHRASES) if (bare.includes(p)) hits.push({ key, field, kind: 'rule', match: p, context: p });
  }
  for (const h of hits) {
    const allow = ALLOW.find(([k, m]) => k === h.key && h.context.includes(m));
    h.allowed = allow ? allow[2] : null;
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = lint();
  const open = hits.filter((h) => !h.allowed);
  const json = process.argv.includes('--json');
  if (json) { console.log(JSON.stringify(hits, null, 2)); process.exit(open.length ? 1 : 0); }
  for (const h of hits) {
    console.log(`${h.allowed ? 'ALLOWED' : 'HIT    '} ${h.key}.${h.field} [${h.kind}] "${h.match}"  …${h.context}…${h.allowed ? '  (' + h.allowed + ')' : ''}`);
  }
  console.log(`\n${hits.length} hits: ${hits.length - open.length} allowed (listed in NEEDS_REVIEW.md), ${open.length} unresolved.`);
  process.exit(open.length ? 1 : 0);
}
