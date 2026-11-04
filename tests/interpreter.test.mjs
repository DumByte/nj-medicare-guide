import test from 'node:test';
import assert from 'node:assert/strict';
import { walk, collectPath, renderSegments, renderPlain, resolveActionDate, evalClause, validateInput,
  NOT_ENTERED } from '../src/interpreter.js';
import { validate } from '../scripts/validate.mjs';
import { lint } from '../scripts/lint-facts.mjs';
import { facts, shippedFactsDoc, tree, TODAY } from './helpers.mjs';

const F = facts();
const T = tree();
const tail = { employer_20: 'yes', drug_creditable: 'yes', hsa: 'no',
  retiree_cov: 'no', wife_own_offer: 'no', health_needs: 'skip', doctor_choice: 'somewhat', travel: 'no',
  predictability: 'fixed', budget_ok: 'yes', visits: 'some', hd_ok: 'no', assignment: 'unsure', bridge_income: 'unsure',
  choose_now: 'yes', irmaa_now: 'yes' };
const run = (answers, today = TODAY) => walk(T, { ...tail, ...answers }, F, today);
const T1 = { ss_collecting: 'no', part_a: 'no', hsa: 'no', last_work_month: '2027-12', job_cov_end: '2027-12-31',
  wife_birth: '1964-06-15', wife_on_his_plan: 'yes' };

test('T1 path: HSA question, Part A outcome, COBRA bridge, sign-up timeline, summary', () => {
  const w = run(T1);
  assert.ok(w.complete);
  for (const id of ['B_HSA', 'OUT_ENROLL_PARTA', 'OUT_WORKING_OK', 'OUT_BRIDGE_COBRA', 'OUT_SIGNUP_TIMELINE', 'OUT_CLOSE_CALL', 'I1']) {
    assert.ok(w.screens.includes(id), id);
  }
  assert.ok(!w.screens.includes('OUT_HSA_WARNING'));
  assert.equal(w.effective.part_b, 'no'); // set by A3 "No"
});

test('T2 path: OUT_BRIDGE_GAP with the 400-600% variant', () => {
  const w = run({ ss_collecting: 'no', part_a: 'yes', part_a_date: '2026-05', part_b: 'no', last_work_month: '2027-06',
    job_cov_end: '2027-06-30', wife_birth: '1964-10-10', wife_on_his_plan: 'yes', bridge_income: '400_600' });
  assert.ok(w.screens.includes('D2'));
  assert.ok(w.screens.includes('OUT_BRIDGE_GAP'));
  const node = T.nodes.find((n) => n.id === 'OUT_BRIDGE_GAP');
  const shown = node.variants.filter((v) => v.when.every((c) => evalClause(c, w.vars)));
  assert.equal(shown.length, 1);
  assert.match(shown[0].text, /no U\.S\. help/);
});

test('T3 path: Part B held, window closed -> OUT_HAS_PARTB then OUT_NO_MEDIGAP_WINDOW', () => {
  const w = run({ ss_collecting: 'no', part_a: 'yes', part_a_date: '2025-03', part_b: 'yes', part_b_date: '2025-03',
    last_work_month: '2027-12', job_cov_end: 'default', wife_birth: '1964-06-15', wife_on_his_plan: 'yes', health_needs: 'yes',
    doctor_choice: 'very', predictability: 'fixed' });
  assert.ok(w.screens.includes('OUT_HAS_PARTB'));
  assert.ok(w.screens.includes('OUT_SIGNUP_HAS_B'));
  assert.ok(w.screens.includes('OUT_NO_MEDIGAP_WINDOW'));
});

test('T4-T6 routing from F7', () => {
  const base = { ...T1 };
  const at = (a) => run({ ...base, ...a }).screens;
  assert.ok(at({ health_needs: 'yes', doctor_choice: 'very', travel: 'no', predictability: 'fixed', budget_ok: 'yes' }).includes('OUT_LEAN_MEDIGAP'));
  assert.ok(at({ health_needs: 'no', doctor_choice: 'not', travel: 'no', predictability: 'variable', budget_ok: 'yes' }).includes('OUT_LEAN_MA'));
  assert.ok(at({ health_needs: 'skip', doctor_choice: 'somewhat', travel: 'no', predictability: 'fixed', budget_ok: 'yes' }).includes('OUT_CLOSE_CALL'));
});

test('T7: wife not on his plan', () => {
  const w = run({ ...T1, wife_on_his_plan: 'no' });
  const i = w.screens.indexOf('OUT_WIFE_NOT_ON_PLAN');
  assert.ok(i > 0);
  assert.equal(w.screens[i + 1], 'OUT_WIFE_AT_65');
});

test('Requirement 7: Part B held, date unknown -> OUT_CLOSE_CALL + Q_SHIP_GI_PRIMARY', () => {
  const w = run({ ss_collecting: 'no', part_a: 'yes', part_a_date: '2025-03', part_b: 'yes', part_b_date: 'unknown',
    last_work_month: '2027-12', job_cov_end: 'default', wife_birth: '1964-06-15', wife_on_his_plan: 'yes',
    health_needs: 'yes', doctor_choice: 'very', travel: 'yes', predictability: 'fixed' });
  assert.equal(w.vars.medigap_window_open, 'unknown');
  assert.ok(w.screens.includes('OUT_CLOSE_CALL'));
  assert.ok(!w.screens.includes('OUT_LEAN_MEDIGAP'));
  const p = collectPath(T, w, F, TODAY);
  assert.ok(p.questions['NJ SHIP'].some((q) => q.id === 'Q_SHIP_GI_PRIMARY'));
});

test('Requirement 6: HSA yes/unsure shows the warning and HR question', () => {
  for (const hsa of ['yes', 'unsure']) {
    const w = run({ ...T1, hsa });
    assert.ok(w.screens.includes('OUT_HSA_WARNING'), hsa);
    const p = collectPath(T, w, F, TODAY);
    assert.ok(p.questions.HR.some((q) => q.id === 'Q_HR_HSA'));
    assert.ok(p.factIds.includes('hsa_medicare'));
  }
  const enroll = T.nodes.find((n) => n.id === 'OUT_ENROLL_PARTA');
  assert.ok(!/HSA/.test(enroll.text));
});

test('Changing an early answer drops answers from the old path', () => {
  // Answers from the "has a card" branch stay behind when A3 is changed to "No".
  const w = walk(T, { ...tail, ...T1, part_a: 'no', part_a_date: '2026-05', part_b: 'yes', part_b_date: '2026-05' }, F, TODAY);
  assert.equal(w.effective.part_a, 'no');
  assert.equal(w.effective.part_a_date, undefined);
  assert.notEqual(w.effective.part_b, 'yes');
  assert.ok(!w.screens.includes('A3b') && !w.screens.includes('A4'));
  assert.ok(w.screens.includes('OUT_ENROLL_PARTA'));
  // And with "Yes", the Part A sign-up screen is gone.
  const y = walk(T, { ...tail, ...T1, part_a: 'yes', part_a_date: '2026-05', part_b: 'no' }, F, TODAY);
  assert.ok(!y.screens.includes('OUT_ENROLL_PARTA'));
});

test('Walk stops at the first unanswered question', () => {
  const w = walk(T, {}, F, TODAY);
  assert.equal(w.complete, false);
  assert.deepEqual(w.screens, ['A3']);
});

test('Actions sort by date; past dates become "now"; GCNJ omitted when no window', () => {
  const p = collectPath(T, run(T1), F, TODAY);
  const dates = p.actions.map((a) => a.date);
  assert.deepEqual(dates, [...dates].sort());
  const byId = Object.fromEntries(p.actions.map((a) => [a.id, a]));
  assert.equal(byId.ACT_PARTB_FILE.date, '2027-11-01');
  assert.equal(byId.ACT_SSA44.date, '2028-01-01');
  assert.equal(byId.ACT_WIFE_MEDICARE_SIGNUP.date, '2029-03-01');
  // GCNJ pricing is added on the bridge-gap path (T2): window Nov 1, 2026 - Jan 31, 2027 is open today.
  const t2 = collectPath(T, run({ ss_collecting: 'no', part_a: 'yes', part_a_date: '2026-05', part_b: 'no', last_work_month: '2027-06',
    job_cov_end: '2027-06-30', wife_birth: '1964-10-10', wife_on_his_plan: 'yes', bridge_income: '400_600' }), F, TODAY);
  assert.equal(t2.actions.find((a) => a.id === 'ACT_PRICE_GCNJ').date, TODAY);

  const soon = collectPath(T, run({ ...T1, last_work_month: '2026-12', job_cov_end: '2026-12-31' }), F, TODAY);
  // The window open today (Nov 1, 2026 - Jan 31, 2027) opens before coverage ends Dec 31, 2026: price now.
  assert.equal(soon.actions.find((a) => a.id === 'ACT_PRICE_GCNJ').date, TODAY);
  // No window opens between today and coverage end (Feb 15 - Jun 30, 2027): the action is omitted.
  const later = '2027-02-15';
  const none = collectPath(T, walk(T, { ...tail, ...T1, last_work_month: '2027-06', job_cov_end: '2027-06-30', bridge_income: '400_600' }, F, later), F, later);
  assert.ok(!none.actions.map((a) => a.id).includes('ACT_PRICE_GCNJ'));
  const file = soon.actions.find((a) => a.id === 'ACT_PARTB_FILE');
  assert.equal(file.ruleDate, '2026-11-01');
  assert.equal(file.past, true);
  assert.equal(file.date, TODAY);
});

test('date_rule forms', () => {
  const vars = { job_cov_end: '2027-12-31', partb_start: '2028-01-01', wife_cobra_end: '2029-06-30' };
  assert.equal(resolveActionDate('today', vars, TODAY).date, TODAY);
  assert.equal(resolveActionDate('today+30d', vars, TODAY).date, '2026-12-03');
  assert.equal(resolveActionDate('job_cov_end-6m', vars, TODAY).date, '2027-06-30');
  assert.equal(resolveActionDate('job_cov_end-75d', vars, TODAY).date, '2027-10-17');
  assert.equal(resolveActionDate('job_cov_end+60d', vars, TODAY).date, '2028-02-29');
  assert.equal(resolveActionDate('partb_start', vars, TODAY).date, '2028-01-01');
  assert.deepEqual(resolveActionDate('wife_medicare_start-3m', vars, TODAY), { missing: 'wife_medicare_start' });
});

test('Missing input: dependent action skipped with a "we need" note', () => {
  const w = walk(T, { ...tail, ...T1, wife_birth: undefined }, F, TODAY);
  const p = collectPath(T, { ...w, screens: [...w.screens, 'OUT_WIFE_AT_65'] }, F, TODAY);
  assert.ok(p.notes.some((n) => n.action === 'ACT_WIFE_MEDICARE_SIGNUP' && /wife's date of birth/.test(n.needs)));
});

test('Token rendering (requirement 4)', () => {
  const logs = [];
  const ctx = { facts: F, vars: { job_cov_end: '2028-01-01', part_a_date: '2026-05', part_b_date: 'unknown', bridge_months: 17 }, meta: {}, log: (m) => logs.push(m) };
  assert.equal(renderPlain('{{fact:partb_premium_2026.value}}', ctx), '$202.90');
  assert.equal(renderPlain('{{fact:ma_moop_2027.value.in_network}}', ctx), '$9,850');
  assert.equal(renderPlain('{{fact:hdg_deductible.value.2027}}', ctx), '$3,050');
  assert.equal(renderPlain('{{fact:nj_medigap_rates_jun2026.value.plan_g.low}}', ctx), '$164.31');
  assert.equal(renderPlain('{{job_cov_end}}', ctx), 'January 1, 2028');
  assert.equal(renderPlain('{{part_a_date}}', ctx), 'May 2026');
  assert.equal(renderPlain('{{bridge_months}}-month', ctx), '17-month');
  assert.equal(renderPlain('({{part_b_date}})', ctx), '(unknown)');
  assert.equal(renderPlain('X {{wife_medicare_start}}', ctx), 'X ' + NOT_ENTERED);
  assert.equal(renderPlain('{{fact:nope.value}}', ctx), NOT_ENTERED);
  assert.equal(logs.length, 2);
  const segs = renderSegments('Pay {{fact:partb_premium_2026.value}} now', ctx);
  assert.deepEqual(segs.map((s) => s.type), ['text', 'fact', 'text']);
  for (const n of T.nodes) for (const t of [n.text, n.title, ...(n.bullets || [])]) {
    const out = renderPlain(t || '', { facts: F, vars: run(T1).vars, meta: {} });
    assert.ok(!/Invalid Date|undefined|NaN/.test(out), n.id);
  }
});

test('Input validation', () => {
  const a6 = T.nodes.find((n) => n.id === 'A6');
  assert.equal(validateInput(a6, '2027-12'), null);
  assert.match(validateInput(a6, '2026-10'), /November 2026 or later/);
  assert.match(validateInput(a6, 'unknown'), /Pick an answer/);
  const a3b = T.nodes.find((n) => n.id === 'A3b');
  assert.equal(validateInput(a3b, 'unknown'), null);
});

test('T13: stale facts are reported after review_after', () => {
  const w = run(T1);
  assert.deepEqual(collectPath(T, w, F, '2026-11-20').stale, []);
  const later = collectPath(T, w, F, '2026-11-21').stale;
  assert.ok(later.includes('partb_deductible_2026'));
  assert.ok(later.includes('partb_2027_status'));
});

test('T14: validation script passes', () => {
  const r = validate(T, shippedFactsDoc());
  assert.deepEqual(r.errors, []);
  assert.equal(r.reachable, r.nodes);
});

test('T14: validation catches a broken reference', () => {
  const bad = tree();
  bad.nodes[0].next = 'NOPE';
  bad.nodes.find((n) => n.id === 'H2').more.push('{{fact:not_a_fact}}');
  const r = validate(bad, shippedFactsDoc());
  assert.ok(r.errors.some((e) => /NOPE/.test(e)));
  assert.ok(r.errors.some((e) => /not_a_fact/.test(e)));
});

test('Lint: zero unresolved hits', () => {
  assert.deepEqual(lint().filter((h) => !h.allowed), []);
});
