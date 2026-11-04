// Tests for the UX-review correctness fixes: X1 (F5 wording), X2 (Part A sign-up months),
// and the Get Covered NJ open-enrollment rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, gcnjWindowBefore } from '../src/engine.js';
import { walk, collectPath, renderPlain } from '../src/interpreter.js';
import { facts, tree, TODAY } from './helpers.mjs';

const F = facts();
const T = tree();
const tail = { employer_20: 'yes', drug_creditable: 'yes', hsa: 'no', retiree_cov: 'no', wife_own_offer: 'no',
  health_needs: 'skip', doctor_choice: 'somewhat', travel: 'no', predictability: 'fixed', budget_ok: 'yes',
  visits: 'some', hd_ok: 'no', assignment: 'unsure', bridge_income: 'unsure',
  choose_now: 'yes', irmaa_now: 'yes' };
const likely = { ss_collecting: 'no', part_a: 'no', last_work_month: '2027-12', job_cov_end: 'default',
  wife_birth: '1964-10-10', wife_on_his_plan: 'yes' };
const run = (answers) => walk(T, { ...tail, ...answers }, F, TODAY);
const ctxOf = (w) => ({ facts: F, vars: w.vars, meta: w.meta });

test('X1: F5 asks what he prefers, and each option is the thing it scores', () => {
  const f5 = T.nodes.find((n) => n.id === 'F5');
  assert.equal(f5.text, 'Which do you prefer?');
  const label = (v) => f5.options.find((o) => o.value === v).label;
  assert.match(label('fixed'), /^Pay more each month/);
  assert.match(label('variable'), /^Pay less each month/);
  // Scoring is unchanged: preferring fixed bills leans toward Medigap.
  assert.equal(F.path_score_weights.value.predictability.fixed, 1);
  assert.equal(F.path_score_weights.value.predictability.variable, -1);
});

test('X2: the sign-up window shows months, and the to-do item is the whole range', () => {
  const w = run(likely);
  const ctx = ctxOf(w);
  assert.equal(renderPlain('{{parta_signup_earliest_for_36}}', ctx), 'January 2027');
  assert.equal(renderPlain('{{parta_signup_latest_for_36}}', ctx), 'December 2027');
  const a = collectPath(T, w, F, TODAY).actions.find((x) => x.id === 'ACT_ENROLL_PARTA_WINDOW');
  assert.deepEqual(a.range, { start: '2027-01-01', end: '2027-12-01' });
  assert.equal(a.past, false);
  const q = collectPath(T, w, F, TODAY).questions['Social Security'].find((x) => x.id === 'Q_SSA_PARTA_START');
  const qText = renderPlain(q.text, ctx);
  assert.match(qText, /apply in December 2027 instead of now/);
  assert.doesNotMatch(qText, /month of/);
  // Day values elsewhere still print as full dates.
  assert.equal(renderPlain('{{parta_signup_by}}', ctx), 'November 30, 2026');
});

test('X2: the late-retirement Part A text no longer opens with the cutoff as if it were his plan', () => {
  const v = T.nodes.find((n) => n.id === 'OUT_ENROLL_PARTA').variants.map((x) => x.text).join(' ');
  assert.doesNotMatch(v, /You plan to stop working after/);
});

test('Get Covered NJ: price plans in the open enrollment that opens before his coverage ends', () => {
  // Retire December 2027: the November 2027 window (2028 prices, enroll for January 1) is the useful one.
  let x = compute({ ...likely }, F, TODAY).values;
  assert.equal(x.gcnj_window.start, '2027-11-01');
  assert.equal(x.gcnj_oe_before_retire, '2027-11-01');
  // Coverage ends in the middle of a window: that window counts.
  assert.equal(gcnjWindowBefore(F, '2027-01-15', TODAY).start, '2026-11-01');
  // Coverage ends before the next window opens: use the one before it.
  assert.equal(gcnjWindowBefore(F, '2028-06-30', TODAY).start, '2027-11-01');
  // Coverage ends October 31: the window opening November 1 is too late.
  assert.equal(gcnjWindowBefore(F, '2027-10-31', TODAY).start, '2026-11-01');
  // No window opens by an end date before the first one, and none has closed into the past.
  assert.equal(gcnjWindowBefore(F, '2026-10-31', TODAY), null);
});

// ---------- UX review H1, M2, M3: the shorter question flow ----------
const screens = (answers) => run(answers).screens;

test('H1: the first three questions are the card, employer size and the stop-work month', () => {
  const s = screens({ ...likely });
  assert.deepEqual(s.slice(0, 4), ['A3', 'A10', 'A6', 'A6b']);
  assert.ok(!s.includes('A1') && !s.includes('A2'));
  assert.ok(s.indexOf('A8') < s.indexOf('A7') && s.indexOf('A7') < s.indexOf('A5'));
});

test('H1: the Part A card date is asked only when it can change the COBRA length', () => {
  const card = { ...likely, part_a: 'yes', part_a_date: '2026-09', part_b: 'no' };
  // Stops working 21+ months after this month starts (Nov 2026 + 21 = Aug 2028): no card date can matter.
  for (const m of ['2028-08', '2029-06']) {
    const w = run({ ...card, last_work_month: m });
    assert.ok(!w.screens.includes('A3b'), m);
    assert.equal(w.effective.part_a_date, undefined);
    assert.equal(w.vars.cobra36_eligible, false);
    assert.notEqual(w.meta.his_entitlement.label, 'ASSUMED');
  }
  // One month earlier, a card dated up to 3 months ahead could still matter: ask.
  for (const m of ['2028-07', '2027-06']) assert.ok(screens({ ...card, last_work_month: m }).includes('A3b'), m);
  // The 36-month rule still applies when it is asked and the date qualifies.
  assert.equal(run({ ...card, last_work_month: '2027-06' }).vars.cobra36_eligible, true);
});

test('H1: skipping the card date never changes a result it could have changed', () => {
  // At the boundary month, every card date he could have gives the same COBRA end as no date at all.
  const base = { ...likely, part_a: 'yes', part_b: 'no', last_work_month: '2028-08' };
  const skipped = compute(base, F, TODAY).values.wife_cobra_end;
  for (let k = -24; k <= 3; k++) {
    const d = new Date(Date.UTC(2026, 10 + k, 1)).toISOString().slice(0, 7);
    assert.equal(compute({ ...base, part_a_date: d }, F, TODAY).values.wife_cobra_end, skipped, d);
  }
});

test("H1: the wife's own job offer is asked only when she is not on his plan", () => {
  assert.ok(!screens({ ...likely, wife_on_his_plan: 'yes' }).includes('A9'));
  assert.ok(screens({ ...likely, wife_on_his_plan: 'no' }).includes('A9'));
});

test('H1: Medigap plan questions: many visits skips G2 and G3; some visits skips G2', () => {
  const lean = { ...likely, health_needs: 'yes', doctor_choice: 'very', budget_ok: 'yes' };
  const many = screens({ ...lean, visits: 'many' });
  assert.ok(many.includes('G1') && !many.includes('G2') && !many.includes('G3'));
  const some = screens({ ...lean, visits: 'some' });
  assert.ok(!some.includes('G2') && some.includes('G3'));
  const few = screens({ ...lean, visits: 'few', hd_ok: 'yes' });
  assert.ok(few.includes('G2') && !few.includes('G3'));
  assert.ok(few.includes('OUT_PLAN_HDG'));
});

test('H1: "Not now" at the plan-type fork goes to the to-do list with an NJ SHIP step', () => {
  const w = run({ ...likely, choose_now: 'later' });
  assert.equal(w.complete, true);
  assert.ok(w.screens.includes('OUT_DECIDE_LATER') && !w.screens.includes('F1') && !w.screens.includes('H1'));
  const ids = collectPath(T, w, F, TODAY).actions.map((a) => a.id);
  assert.ok(ids.includes('ACT_BOOK_SHIP'));
  assert.ok(ids.includes('ACT_SSA44')); // income step still on the list
  assert.ok(ids.includes('ACT_ENROLL_DRUG'));
});

test('H1: "Skip" at the income fork goes straight to the to-do list', () => {
  const w = run({ ...likely, irmaa_now: 'skip' });
  assert.equal(w.complete, true);
  assert.ok(!w.screens.includes('H1') && !w.screens.includes('H2'));
  assert.ok(collectPath(T, w, F, TODAY).actions.some((a) => a.id === 'ACT_SSA44'));
});

test('M2: only the birth month matters, unless she was born on the 1st', () => {
  const at = (d) => compute({ ...likely, wife_birth: d }, F, TODAY).values;
  for (const k of ['wife_medicare_start', 'wife_cobra_end', 'bridge_months', 'cobra_gap_months']) {
    assert.equal(at('1964-10-15')[k], at('1964-10-10')[k], k);
    assert.equal(at('1964-10-15')[k], at('1964-10-31')[k], k);
    assert.equal(at('1964-10-15')[k], at('1964-10-02')[k], k);
  }
  assert.equal(at('1964-10-01').wife_medicare_start, '2029-09-01');
  assert.equal(at('1964-10-15').wife_medicare_start, '2029-10-01');
  const a7 = T.nodes.find((n) => n.id === 'A7');
  assert.equal(a7.birth_month, true);
});
