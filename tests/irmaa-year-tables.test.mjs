// Requirement 14 / SPEC 9: the IRMAA table is chosen by premium year, and facts.json alone sets the numbers.
// The 2027 table here is a FAKE test fixture. It is never written to src/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexFacts, irmaaSchedule, irmaaTableFor, partDPenalty } from '../src/engine.js';
import { factsDoc } from './helpers.mjs';

const FAKE_2027 = {
  id: 'irmaa_table_2027',
  plain: 'TEST FIXTURE ONLY',
  label: 'VERIFIED',
  value: [
    { tier: 0, joint_magi_min: 0, joint_magi_max: 230000, partb_total: 210, partb_irmaa: 0, partd_irmaa: 0 },
    { tier: 1, joint_magi_min: 230001, joint_magi_max: 290000, partb_total: 300, partb_irmaa: 90, partd_irmaa: 10 },
    { tier: 2, joint_magi_min: 290001, joint_magi_max: null, partb_total: 400, partb_irmaa: 190, partd_irmaa: 20 }
  ],
  source: { title: 'fixture', url: 'https://example.invalid/fixture' }
};

const withFixture = () => {
  const doc = factsDoc();
  doc.facts.push(FAKE_2027);
  return indexFacts(doc);
};

test('a new irmaa_table_2027 is picked up for 2027+ with no code change', () => {
  const F = withFixture();
  assert.equal(irmaaTableFor(F, 2026).tableYear, 2026);
  const t27 = irmaaTableFor(F, 2027);
  assert.equal(t27.tableYear, 2027);
  assert.equal(t27.placeholder, false);
  const t29 = irmaaTableFor(F, 2029);
  assert.equal(t29.tableYear, 2027);
  assert.equal(t29.placeholder, true);
});

test('facts alone control the numbers shown', () => {
  const inputs = { partbStart: '2028-01-01', lastWorkMonth: '2027-12', magi: { 2026: 260000 } };
  const before = irmaaSchedule(indexFacts(factsDoc()), inputs)[0];
  const after = irmaaSchedule(withFixture(), inputs)[0];
  assert.equal(before.tier, 1);
  assert.equal(before.surcharge, 12 * (81.20 + 14.50));
  assert.equal(after.tier, 1);
  assert.equal(after.surcharge, 12 * 100);
  assert.equal(after.tableYear, 2027);

  const doc = factsDoc();
  doc.facts.find((f) => f.id === 'partd_base_2027').value = 50;
  assert.equal(partDPenalty(indexFacts(doc), 10, 2027).monthly, 5.00);
});
