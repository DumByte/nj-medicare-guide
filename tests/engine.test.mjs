import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, pathScore, irmaaTier, irmaaSchedule, partBPenalty, partDPenalty,
  medigapCompare, isStale } from '../src/engine.js';
import { facts, TODAY } from './helpers.mjs';

const F = facts();

test('T1: Part A sign-up now, December retirement, COBRA reaches Medicare', () => {
  const { values: v } = compute({ ss_collecting: 'no', part_a: 'no', part_b: 'no', retiree_cov: 'no',
    last_work_month: '2027-12', job_cov_end: '2027-12-31', wife_birth: '1964-06-15', wife_on_his_plan: 'yes' }, F, TODAY);
  assert.equal(v.part_a_projected_start, '2026-05-01');
  assert.equal(v.retire_by_for_36, '2027-10-31');
  assert.equal(v.cobra36_eligible, false);
  assert.equal(v.wife_cobra_end, '2029-06-30');
  assert.equal(v.wife_medicare_start, '2029-06-01');
  assert.ok(v.bridge_months > 0);
  assert.ok(v.cobra_gap_months <= 0);
  assert.equal(v.partb_start, '2028-01-01');
  assert.equal(v.partb_file_by, '2027-11-01');
  assert.equal(v.ma_window_open, '2027-10-01');
  assert.equal(v.drug_deadline, '2028-03-03');
  assert.equal(v.ma_window_close, '2028-02-29');
  assert.equal(v.medigap_window_close, '2028-06-30');
  assert.equal(v.partb_sep_end, '2028-08-31');
  assert.equal(v.wife_cobra_end_if_parta_now, '2029-04-30');
});

test('T2: 36-month COBRA rule leaves a 5-month gap', () => {
  const { values: v } = compute({ part_a: 'yes', part_a_date: '2026-05', part_b: 'no',
    last_work_month: '2027-06', job_cov_end: '2027-06-30', wife_birth: '1964-10-10', wife_on_his_plan: 'yes',
    bridge_income: '400_600' }, F, TODAY);
  assert.equal(v.cobra36_eligible, true);
  assert.equal(v.wife_cobra_end, '2029-04-30');
  assert.equal(v.wife_medicare_start, '2029-10-01');
  assert.equal(v.cobra_gap_months, 5);
  assert.match(v.wife_cobra_rule, /36-month/);
});

test('T3: Part B since March 2025, Medigap window closed', () => {
  const { values: v } = compute({ part_a: 'yes', part_a_date: '2025-03', part_b: 'yes', part_b_date: '2025-03',
    last_work_month: '2027-12' }, F, TODAY);
  assert.equal(v.partb_start, '2025-03-01');
  assert.equal(v.medigap_window_close, '2025-08-31');
  assert.equal(v.medigap_window_open, false);
  assert.equal(v.gi_right, false);
  assert.equal(v.medigap_window_status, 'closed on August 31, 2025');
});

test('T4-T6: path scores', () => {
  const s = (a, open) => pathScore(a, open, F).total;
  assert.equal(s({ health_needs: 'yes', doctor_choice: 'very', travel: 'no', predictability: 'fixed', budget_ok: 'yes' }, true), 4);
  assert.equal(s({ health_needs: 'no', doctor_choice: 'not', travel: 'no', predictability: 'variable', budget_ok: 'yes' }, true), -3);
  assert.equal(s({ health_needs: 'skip', doctor_choice: 'somewhat', travel: 'no', predictability: 'fixed', budget_ok: 'yes' }, true), 1);
  // Reversibility point needs the window to be open (not "unknown").
  assert.equal(s({ health_needs: 'yes' }, 'unknown'), 1);
  assert.equal(s({ budget_ok: 'no' }, true), -2);
});

test('T8: IRMAA 2028 with and without appeal', () => {
  const rows = irmaaSchedule(F, { partbStart: '2028-01-01', wifeMedicareStart: '2029-06-01', wifeHasB: true,
    lastWorkMonth: '2027-12', magi: { 2026: 300000, 2028: 120000 } });
  const r = rows.find((x) => x.year === 2028);
  assert.equal(r.tier, 2);
  assert.equal(r.himMonths, 12);
  assert.equal(r.wifeMonths, 0);
  assert.equal(r.surcharge, 2884.80);
  assert.equal(r.placeholder, true);
  assert.equal(r.tableYear, 2026);
  assert.equal(r.appealable, true);
  assert.equal(r.appealTier, 0);
  assert.equal(r.appealSurcharge, 0);
});

test('T9: IRMAA tier boundaries use CMS wording', () => {
  const table = F.irmaa_table_2026.value;
  assert.equal(irmaaTier(table, 218000).tier, 0);
  assert.equal(irmaaTier(table, 218001).tier, 1);
  assert.equal(irmaaTier(table, 274000).tier, 1);
  assert.equal(irmaaTier(table, 274001).tier, 2);
  assert.equal(irmaaTier(table, 749999).tier, 4);
  assert.equal(irmaaTier(table, 750000).tier, 5);
});

test('IRMAA cliff warning and step match irmaa_tier_steps', () => {
  const rows = irmaaSchedule(F, { partbStart: '2028-01-01', lastWorkMonth: '2027-12', magi: { 2026: 212000 } });
  const r = rows[0];
  assert.equal(r.tier, 0);
  assert.equal(r.cliff.nextMin, 218001);
  assert.equal(r.cliff.stepPerPersonYear, F.irmaa_tier_steps.value[0].usd_per_year);
  for (const step of F.irmaa_tier_steps.value) {
    const t = F.irmaa_table_2026.value;
    const a = t[step.from_tier], b = t[step.to_tier];
    const diff = Math.round(12 * (b.partb_irmaa + b.partd_irmaa - a.partb_irmaa - a.partd_irmaa) * 100) / 100;
    assert.equal(diff, step.usd_per_year);
  }
});

test('IRMAA: December mid-month coverage end straddles two Januaries', () => {
  const { values: v } = compute({ part_a: 'yes', part_a_date: '2026-05', part_b: 'no', last_work_month: '2027-12',
    job_cov_end: '2027-12-15', wife_birth: '1964-06-15', wife_on_his_plan: 'yes' }, F, TODAY);
  assert.equal(v.partb_start, '2027-12-01');
  assert.equal(v.irmaa_first_year_jan, '2027-01-01');
  assert.equal(v.irmaa_second_year_jan, '2028-01-01');
  const rows = irmaaSchedule(F, { partbStart: v.partb_start, lastWorkMonth: '2027-12', magi: { 2025: 300000, 2026: 300000 } });
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.year, r.himMonths]), [[2027, 1], [2028, 12]]);
  assert.equal(rows[0].surcharge, 240.40);
});

test('T10: Part D penalty, 12 months in 2027', () => {
  assert.equal(partDPenalty(F, 12, 2027).monthly, 5.00);
});

test('T11: Part B penalty, 24 months in 2026', () => {
  const p = partBPenalty(F, 24, 2026);
  assert.equal(p.pct, 20);
  assert.equal(p.monthly, 243.50);
});

test('T12: Medigap compare, moderate year', () => {
  const r = medigapCompare(F, { g: 200, n: 150, hdg: '', office: 8, er: 0, excess: 0, yearType: 'moderate', year: 2027 });
  assert.equal(r.g, 2683);
  assert.equal(r.n, 2243);
  assert.equal(r.hdg, null);
  assert.equal(r.placeholders.partB, 2026);
});

test('Medigap compare: HD-G caps at that year\'s deductible', () => {
  const r = medigapCompare(F, { hdg: 60, yearType: 'bad', year: 2027, excess: 0 });
  assert.equal(r.hdg, 12 * 60 + 3050);
  assert.equal(r.costSharing, 1736 + 5000);
});

test('Part A date unknown while collecting Social Security', () => {
  const { values: v, questions } = compute({ ss_collecting: 'yes', part_a: 'yes', part_a_date: 'unknown', part_b: 'no',
    last_work_month: '2027-06', wife_birth: '1964-10-10', wife_on_his_plan: 'yes' }, F, TODAY);
  assert.equal(v.cobra36_eligible, false);
  assert.equal(v.wife_cobra_end, '2028-12-31');
  assert.equal(v.job_cov_end, '2027-06-30');
  assert.ok(questions.includes('Q_SSA_STATUS'));
});

test('Part B held, date unknown: window unknown and SHIP question', () => {
  const { values: v, questions } = compute({ part_a: 'yes', part_a_date: '2025-03', part_b: 'yes', part_b_date: 'unknown',
    last_work_month: '2027-12' }, F, TODAY);
  assert.equal(v.medigap_window_open, 'unknown');
  assert.ok(questions.includes('Q_SHIP_GI_PRIMARY'));
});

test('Leap-year coverage end (2028-02-29)', () => {
  const { values: v } = compute({ part_a: 'yes', part_a_date: '2026-05', part_b: 'no', last_work_month: '2028-02',
    wife_birth: '1964-06-15', wife_on_his_plan: 'yes' }, F, TODAY);
  assert.equal(v.job_cov_end, '2028-02-29');
  assert.equal(v.wife_cobra_end, '2029-08-31');
  assert.equal(v.partb_start, '2028-03-01');
  assert.equal(v.drug_deadline, '2028-05-02');
  assert.equal(v.ma_window_close, '2028-04-30');
});

test('Get Covered NJ window before retirement (requirement 8)', () => {
  const at = (jce, today) => compute({ part_a: 'yes', part_a_date: '2026-05', part_b: 'no',
    last_work_month: jce.slice(0, 7), job_cov_end: jce }, F, today).values;
  // The last window that opens by the day job coverage ends (UX review: price the year she will buy).
  let v = at('2027-12-31', TODAY);
  assert.deepEqual(v.gcnj_window, { start: '2027-11-01', end: '2028-01-31', assumed: true });
  assert.equal(v.gcnj_oe_before_retire, '2027-11-01');
  v = at('2027-06-30', TODAY);
  assert.deepEqual(v.gcnj_window, { start: '2026-11-01', end: '2027-01-31', assumed: false });
  assert.equal(v.gcnj_oe_before_retire, TODAY);
  v = at('2029-06-30', TODAY);
  assert.deepEqual(v.gcnj_window, { start: '2028-11-01', end: '2029-01-31', assumed: true });
  v = at('2027-01-15', TODAY);
  assert.equal(v.gcnj_window.start, '2026-11-01');
  v = at('2026-10-31', TODAY);
  assert.equal(v.gcnj_window, undefined);
  v = at('2028-06-30', '2027-03-01');
  assert.equal(v.gcnj_window.start, '2027-11-01');
});

test('T13 (engine part): staleness compares today with review_after', () => {
  assert.equal(isStale(F.partb_premium_2026, '2026-11-20'), false);
  assert.equal(isStale(F.partb_premium_2026, '2026-11-21'), true);
  assert.equal(isStale(F.parta_premium_free, '2030-01-01'), false);
});
