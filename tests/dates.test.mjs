import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, addDays, monthsCeil, isLeapYear, isValidDate, formatDate, formatMonth,
  formatUSD, wifeMedicareStart, lastOfMonth } from '../src/engine.js';

test('month rule: month-end maps to month-end (requirement 3)', () => {
  assert.equal(addMonths('2027-06-30', 18), '2028-12-31');
  assert.equal(addMonths('2027-12-31', 18), '2029-06-30');
  assert.equal(addMonths('2028-02-29', 18), '2029-08-31');
  assert.equal(addMonths('2027-04-30', 1), '2027-05-31');
  assert.equal(addMonths('2028-03-31', -1), '2028-02-29');
});

test('month rule: other days keep the day, clamped', () => {
  assert.equal(addMonths('2027-01-30', 1), '2027-02-28');
  assert.equal(addMonths('2028-01-30', 1), '2028-02-29');
  assert.equal(addMonths('2026-05-01', 18), '2027-11-01');
  assert.equal(addMonths('2027-11-15', -2), '2027-09-15');
  assert.equal(addMonths('2028-01-01', -3), '2027-10-01');
});

test('calendar days across a leap day', () => {
  assert.equal(addDays('2027-12-31', 63), '2028-03-03');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2029-02-28', 1), '2029-03-01');
  assert.equal(addDays('2027-11-01', -1), '2027-10-31');
});

test('leap years and validity', () => {
  assert.ok(isLeapYear(2028));
  assert.ok(!isLeapYear(2100));
  assert.ok(isLeapYear(2000));
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2027-02-29'));
  assert.ok(!isValidDate('2027-13-01'));
  assert.equal(lastOfMonth('2028-02-10'), '2028-02-29');
});

test('whole months count part months up', () => {
  assert.equal(monthsCeil('2029-05-01', '2029-10-01'), 5);
  assert.equal(monthsCeil('2029-07-01', '2029-06-01'), -1);
  assert.equal(monthsCeil('2029-09-16', '2029-10-01'), 1);
  assert.equal(monthsCeil('2029-10-01', '2029-10-01'), 0);
});

test('wife Medicare start, including born on the 1st', () => {
  assert.equal(wifeMedicareStart('1964-06-15'), '2029-06-01');
  assert.equal(wifeMedicareStart('1964-07-01'), '2029-06-01');
  assert.equal(wifeMedicareStart('1964-01-01'), '2028-12-01');
});

test('formatting (requirement 4)', () => {
  assert.equal(formatDate('2028-01-01'), 'January 1, 2028');
  assert.equal(formatMonth('2026-05'), 'May 2026');
  assert.equal(formatUSD(202.9), '$202.90');
  assert.equal(formatUSD(9850), '$9,850');
  assert.equal(formatUSD(2884.8), '$2,884.80');
  assert.equal(formatUSD(0), '$0');
});
