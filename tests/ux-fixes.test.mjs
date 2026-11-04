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
  visits: 'some', hd_ok: 'no', assignment: 'unsure', bridge_income: 'unsure' };
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
