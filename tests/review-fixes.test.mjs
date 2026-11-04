// Tests for the adversarial-review fixes (C1-C4, H1-H13) plus invariants on the shipped data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, indexFacts, irmaaTableFor } from '../src/engine.js';
import { walk, collectPath, renderPlain, resolveFigure, evalWhen } from '../src/interpreter.js';
import { facts, shippedFactsDoc, tree, TODAY } from './helpers.mjs';

const F = facts();
const T = tree();
const tail = { employer_20: 'yes', drug_creditable: 'yes', hsa: 'no', retiree_cov: 'no', wife_own_offer: 'no',
  health_needs: 'skip', doctor_choice: 'somewhat', travel: 'no', predictability: 'fixed', budget_ok: 'yes',
  visits: 'some', hd_ok: 'no', assignment: 'unsure', bridge_income: 'unsure',
  choose_now: 'yes', irmaa_now: 'yes' };
const run = (answers, today = TODAY) => walk(T, { ...tail, ...answers }, F, today);
const likely = { ss_collecting: 'no', part_a: 'no', last_work_month: '2027-12', job_cov_end: 'default',
  wife_birth: '1964-10-10', wife_on_his_plan: 'yes' };
const v = (answers, today = TODAY) => compute(answers, F, today).values;
const actionsOf = (w) => collectPath(T, w, F, TODAY).actions;
const shownVariants = (w, id) => (T.nodes.find((n) => n.id === id).variants || []).filter((x) => evalWhen(x.when, w.vars));

test('C1: retiring after the 36-month cutoff shows the later sign-up window', () => {
  const x = v({ part_a: 'no', last_work_month: '2027-12', wife_birth: '1964-10-10', wife_on_his_plan: 'yes' });
  assert.equal(x.part_a_projected_start, '2026-05-01'); // T1 unchanged
  assert.equal(x.parta_signup_by, '2026-11-30');
  assert.equal(x.retire_after_36_cutoff, true);
  assert.equal(x.parta_signup_earliest_for_36, '2027-01-01');
  assert.equal(x.parta_signup_latest_for_36, '2027-12-01');
  assert.equal(x.wife_cobra_end_if_parta_latest, '2030-05-31');
  const w = run(likely);
  const texts = shownVariants(w, 'OUT_ENROLL_PARTA').map((s) => s.text);
  assert.ok(texts.some((t) => /too early to help her/.test(t)));
  const ids = actionsOf(w).map((a) => a.id);
  assert.ok(ids.includes('ACT_ENROLL_PARTA_WINDOW') && !ids.includes('ACT_ENROLL_PARTA'));
  assert.equal(actionsOf(w).find((a) => a.id === 'ACT_ENROLL_PARTA_WINDOW').date, '2027-01-01');
  const q = collectPath(T, w, F, TODAY).questions;
  assert.ok(q.HR.some((x) => x.id === 'Q_HR_PARTA_ENTITLEMENT'));
  assert.ok(!q.HR.some((x) => x.id === 'Q_HR_COBRA_36')); // only when the 36-month rule applies
});

test('C1: retiring before the cutoff keeps "sign up now", dated on the projection month', () => {
  const w = run({ ...likely, last_work_month: '2027-06' });
  assert.equal(w.vars.retire_after_36_cutoff, false);
  const a = actionsOf(w).find((x) => x.id === 'ACT_ENROLL_PARTA');
  assert.equal(a.date, '2026-11-30');
  assert.ok(!actionsOf(w).some((x) => x.id === 'ACT_ENROLL_PARTA_WINDOW'));
});

test('C1: no-gap case says the Part A month does not matter for her', () => {
  const w = run({ ...likely, wife_birth: '1964-06-15' }); // 18-month COBRA reaches 2029-06-01
  assert.ok(shownVariants(w, 'OUT_ENROLL_PARTA').some((s) => /doesn't change her coverage/.test(s.text)));
});

test('C2: drug enrollment dates for month-end, mid-month and leap-day coverage ends', () => {
  const cases = [['2027-12-31', '2027-12-31', '2028-02-29'], ['2027-12-15', '2027-11-30', '2028-01-31'], ['2028-02-29', '2028-02-29', '2028-04-30']];
  for (const [jce, gap, pen] of cases) {
    const x = v({ part_a: 'no', part_b: 'no', last_work_month: jce.slice(0, 7), job_cov_end: jce });
    assert.equal(x.drug_enroll_by_no_gap, gap, jce);
    assert.equal(x.drug_enroll_by_no_penalty, pen, jce);
  }
});

test('C2: every completed path has a drug-enrollment action', () => {
  const paths = [likely, { ...likely, last_work_month: '2027-06' },
    { part_a: 'yes', part_a_date: '2024-09', part_b: 'yes', part_b_date: '2025-03', last_work_month: '2028-06', job_cov_end: 'default', wife_birth: '1964-06-15', wife_on_his_plan: 'yes' },
    { ...likely, wife_on_his_plan: 'no' }];
  for (const p of paths) {
    const w = run(p);
    assert.ok(w.complete);
    assert.ok(actionsOf(w).some((a) => a.id === 'ACT_ENROLL_DRUG'), JSON.stringify(p));
  }
});

test('C3: NJ 63-day right is dated when the Medigap window has closed', () => {
  const w = run({ part_a: 'yes', part_a_date: '2024-09', part_b: 'yes', part_b_date: '2025-03', last_work_month: '2028-06',
    job_cov_end: 'default', wife_birth: '1964-06-15', wife_on_his_plan: 'yes' });
  assert.equal(w.vars.nj_gi_window_close, '2028-09-01');
  assert.ok(w.screens.includes('OUT_NO_MEDIGAP_WINDOW'));
  const p = collectPath(T, w, F, TODAY);
  assert.ok(p.actions.some((a) => a.id === 'ACT_NJ_GI_CONFIRM'));
  assert.ok(p.questions['NJ SHIP'].some((q) => q.id === 'Q_SHIP_NJ_GI_PLANS'));
  assert.equal(v({ part_a: 'no', part_b: 'no', last_work_month: '2028-06' }).nj_gi_window_close, undefined);
});

test('C4: Part B start fact states the same-month option from the statute', () => {
  assert.match(F.partb_sep_start_date.plain, /1st of the month you sign up/);
  assert.match(F.partb_sep_start_date.source.url, /1395q/);
});

test('H1: SSA-44 is dated after work stops', () => {
  assert.equal(v({ part_a: 'no', part_b: 'no', last_work_month: '2027-06' }).ssa44_date, '2027-07-01');
  assert.equal(v({ part_a: 'yes', part_a_date: '2026-09', part_b: 'yes', part_b_date: '2026-09', last_work_month: '2028-06' }).ssa44_date, '2028-07-01');
  assert.equal(v({ part_a: 'no', part_b: 'no', last_work_month: '2027-12' }).ssa44_date, '2028-01-01');
});

test('H2: wife already on Medicare at his retirement gets her own Part B and drug steps', () => {
  for (const [lw, birth] of [['2029-12', '1964-06-15'], ['2029-06', '1963-12-01']]) {
    const w = run({ ...likely, last_work_month: lw, wife_birth: birth });
    assert.ok(w.screens.includes('OUT_BRIDGE_NONE'), lw);
    assert.equal(w.vars.wife_on_medicare_at_retire, true);
    const ids = actionsOf(w).map((a) => a.id);
    assert.ok(ids.includes('ACT_WIFE_PARTB_FILE') && ids.includes('ACT_WIFE_DRUG'), lw);
  }
  assert.equal(v({ part_a: 'no', last_work_month: '2029-12', wife_birth: '1964-06-15', wife_on_his_plan: 'yes' }).wife_partb_start, '2030-01-01');
});

test('H3: the HSA question is asked when he already has Part A or Part B', () => {
  for (const p of [{ part_a: 'yes', part_a_date: '2026-05', part_b: 'no' }, { ss_collecting: 'no', part_a: 'yes', part_a_date: '2026-05', part_b: 'yes', part_b_date: '2026-05' }]) {
    const w = walk(T, { ...tail, hsa: undefined, ...likely, ...p }, F, TODAY);
    assert.equal(w.screens.at(-1), 'B_HSA', JSON.stringify(p));
  }
  const w = run({ part_a: 'yes', part_a_date: '2026-05', part_b: 'no', last_work_month: '2027-12', job_cov_end: 'default',
    wife_birth: '1964-10-10', wife_on_his_plan: 'yes', hsa: 'yes' });
  assert.ok(w.screens.includes('OUT_HSA_WARNING') && !w.screens.includes('OUT_ENROLL_PARTA'));
  assert.ok(shownVariants(w, 'OUT_HSA_WARNING').some((s) => /already have Medicare/.test(s.text)));
});

test('H4: small employer and non-creditable drug coverage get warnings', () => {
  const w = run({ ...likely, employer_20: 'no', drug_creditable: 'no' });
  assert.ok(w.screens.includes('OUT_SMALL_EMPLOYER') && w.screens.includes('OUT_DRUG_NOT_CREDITABLE'));
  const ids = actionsOf(w).map((a) => a.id);
  assert.ok(ids.includes('ACT_SHIP_NOW') && ids.includes('ACT_SHIP_DRUG_NOW'));
  assert.ok(actionsOf(run({ ...likely, employer_20: 'unsure' })).some((a) => a.id === 'ACT_HR_EMPLOYEES'));
});

test('H10: yearly dollar figures say which year they are from', () => {
  const ctx = (year) => ({ facts: F, vars: { decision_year: year }, meta: {} });
  assert.equal(renderPlain('{{fig:partb_deductible}}', ctx(2026)), '$283 (2026)');
  assert.equal(renderPlain('{{fig:partb_deductible}}', ctx(2028)), "$283 (2026 figure; the 2028 amount isn't published yet)");
  assert.equal(renderPlain('{{fig:hdg_deductible}}', ctx(2027)), '$3,050 (2027)');
  assert.equal(renderPlain('{{fig:ma_moop.in_network}}', ctx(2026)), '$9,850 (2027 figure)');
  assert.equal(resolveFigure(F, 'nope', 2027).ok, false);
});

test('H12/H13: Advantage trial-right wording and the Part B-held Medigap trade-off', () => {
  const ma = T.nodes.find((n) => n.id === 'OUT_LEAN_MA');
  assert.ok(ma.more.some((b) => /no trial right/.test(b)));
  assert.match(ma.text, /probably does not apply to you \(our reading of the rule\)/);
  const w = run({ ss_collecting: 'no', part_a: 'yes', part_a_date: '2026-09', part_b: 'yes', part_b_date: '2026-09', last_work_month: '2028-06',
    job_cov_end: 'default', wife_birth: '1964-06-15', wife_on_his_plan: 'yes', health_needs: 'yes', doctor_choice: 'very', predictability: 'fixed' });
  assert.ok(w.screens.includes('OUT_LEAN_MEDIGAP'));
  assert.ok(shownVariants(w, 'OUT_LEAN_MEDIGAP').length === 1);
  assert.ok(!actionsOf(w).some((a) => a.id === 'ACT_MEDIGAP_QUOTES'));
});

test('L9: no age-derived birth-date range in shipped facts', () => {
  const doc = shippedFactsDoc();
  assert.ok(!doc.facts.some((f) => f.id === 'wife_65_window'));
  assert.ok(!/turns 65 sometime between|birth date is between/.test(JSON.stringify(doc)));
});

// ---------- invariants on the shipped data (no values asserted, so data refreshes don't break them) ----------
test('invariant: every IRMAA table is contiguous from 0 and ends open', () => {
  const doc = shippedFactsDoc();
  for (const f of doc.facts.filter((x) => /^irmaa_table_\d{4}$/.test(x.id))) {
    const rows = f.value;
    assert.equal(rows[0].joint_magi_min, 0, f.id);
    for (let i = 1; i < rows.length; i++) assert.equal(rows[i].joint_magi_min, rows[i - 1].joint_magi_max + 1, f.id);
    assert.equal(rows.at(-1).joint_magi_max, null, f.id);
  }
});

test('invariant: VERIFIED facts have a source URL; year-keyed prefixes have no gaps', () => {
  const doc = shippedFactsDoc();
  for (const f of doc.facts) if (f.label === 'VERIFIED') assert.match((f.source || {}).url || '', /^https:\/\//, f.id);
  const years = {};
  for (const f of doc.facts) { const m = /^(.*)_(\d{4})$/.exec(f.id); if (m) (years[m[1]] = years[m[1]] || []).push(+m[2]); }
  for (const [p, ys] of Object.entries(years)) { ys.sort(); for (let i = 1; i < ys.length; i++) assert.equal(ys[i], ys[i - 1] + 1, p); }
});

test('refresh simulation: adding next-year facts flips placeholders with no code change', () => {
  const doc = shippedFactsDoc();
  const latest = (prefix) => doc.facts.filter((f) => new RegExp('^' + prefix + '_\\d{4}$').test(f.id)).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  for (const prefix of ['partb_premium', 'partb_deductible', 'irmaa_table']) {
    const f = latest(prefix);
    const y = +f.id.slice(-4) + 1;
    doc.facts.push({ ...structuredClone(f), id: `${prefix}_${y}` });
  }
  const NF = indexFacts(doc);
  const y = +latest('partb_premium').id.slice(-4);
  assert.equal(resolveFigure(NF, 'partb_premium', y).placeholder, false);
  assert.equal(irmaaTableFor(NF, y).placeholder, false);
});
