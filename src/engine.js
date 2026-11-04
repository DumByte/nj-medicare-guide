// Pure calculation engine: dates, computed values (SPEC 3), scoring (SPEC 4), calculators (SPEC 5).
// No DOM access. Dates are ISO strings "YYYY-MM-DD"; months are "YYYY-MM".

// ---------- dates ----------
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function isValidDate(s) {
  const r = ISO_RE.exec(s || '');
  if (!r) return false;
  const y = +r[1], m = +r[2], d = +r[3];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function isValidMonth(s) {
  const r = MONTH_RE.exec(s || '');
  return !!r && +r[2] >= 1 && +r[2] <= 12;
}

export function parseDate(s) {
  if (!isValidDate(s)) throw new Error('Bad date: ' + s);
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function makeDate(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function firstOfMonth(s) {
  const { y, m } = parseDate(s);
  return makeDate(y, m, 1);
}

export function lastOfMonth(s) {
  const { y, m } = parseDate(s);
  return makeDate(y, m, daysInMonth(y, m));
}

export function monthToFirst(month) {
  if (!isValidMonth(month)) throw new Error('Bad month: ' + month);
  return month + '-01';
}

export function monthToLast(month) {
  return lastOfMonth(monthToFirst(month));
}

// "+Nm" rule (CLAUDE_CODE_PROMPT requirement 3): a month-end date maps to the target month's end;
// any other date keeps its day, clamped to the target month's length.
export function addMonths(s, n) {
  const { y, m, d } = parseDate(s);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12), tm = (idx % 12) + 1;
  const dim = daysInMonth(ty, tm);
  const day = d === daysInMonth(y, m) ? dim : Math.min(d, dim);
  return makeDate(ty, tm, day);
}

export function addDays(s, n) {
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function yearOf(s) { return parseDate(s).y; }
export function monthOf(s) { return parseDate(s).m; }
export const maxDate = (a, b) => (a > b ? a : b);
export const minDate = (a, b) => (a < b ? a : b);

// Whole months from a to b, counting any partial month as a full month (so a short gap is never 0).
export function monthsCeil(a, b) {
  const A = parseDate(a), B = parseDate(b);
  let n = (B.y - A.y) * 12 + (B.m - A.m);
  if (B.d > A.d) n += 1;
  return n;
}

export function formatDate(s) {
  const { y, m, d } = parseDate(s);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export function formatMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ---------- money ----------
// Work in integer cents to avoid floating-point drift.
export const toCents = (usd) => Math.round(usd * 100);

export function formatUSD(usd, opts = {}) {
  const cents = toCents(usd);
  const whole = cents % 100 === 0 && !opts.cents;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const out = whole ? `$${dollars}` : `$${dollars}.${pad(abs % 100)}`;
  return cents < 0 ? '-' + out : out;
}

// Round cents to the nearest 10 cents (Medicare penalty rounding).
const roundToDime = (cents) => Math.round(cents / 10) * 10;

// ---------- facts ----------
export function indexFacts(factsDoc) {
  const map = {};
  for (const f of factsDoc.facts) map[f.id] = f;
  Object.defineProperty(map, '__meta', { value: factsDoc.meta || {}, enumerable: false });
  return map;
}

export function isStale(fact, today) {
  return !!(fact && fact.review_after && today > fact.review_after);
}

// Pick a year-keyed fact (prefix_YYYY) for `year`, falling back to the latest earlier year.
export function pickYearFact(facts, prefix, year) {
  const re = new RegExp('^' + prefix + '_(\\d{4})$');
  let best = null;
  for (const id of Object.keys(facts)) {
    const r = re.exec(id);
    if (!r) continue;
    const y = +r[1];
    if (y <= year && (!best || y > best.year)) best = { year: y, fact: facts[id] };
  }
  if (!best) return null;
  return { ...best, placeholder: best.year !== year };
}

// Pick a value from a fact whose value is keyed by year ({"2026": 2950, "2027": 3050}).
export function pickYearKey(obj, year) {
  const years = Object.keys(obj).map(Number).filter((y) => y <= year);
  if (!years.length) return null;
  const y = Math.max(...years);
  return { year: y, value: obj[y], placeholder: y !== year };
}

// ---------- computed values (SPEC 3) ----------
const known = (v) => v !== undefined && v !== null && v !== '' && v !== 'unknown' && v !== 'default';

export function wifeMedicareStart(birth) {
  const { y, m, d } = parseDate(birth);
  const start = makeDate(y + 65, m, 1);
  return d === 1 ? addMonths(start, -1) : start;
}

export function gcnjWindowBefore(facts, jobCovEnd, today) {
  const base = facts.gcnj_oe_2027 && facts.gcnj_oe_2027.value;
  if (!base) return null;
  let pick = null;
  for (let k = -1; k <= 10; k++) {
    const start = addMonths(base.start, 12 * k), end = addMonths(base.end, 12 * k);
    // The latest window that opens by the day job coverage ends (and has not closed yet): its prices
    // are the ones she would pay right after, and she can still enroll in it before the coverage ends.
    if (start <= jobCovEnd && end >= today) pick = { start, end, assumed: k !== 0 };
  }
  return pick;
}

const LABEL = {
  job_cov_end: ['INFERRED', 'high', 'Your answer.'],
  wife_medicare_start: ['INFERRED', 'high', 'First day of her 65th-birthday month; if born on the 1st, the month before (fact medicare_start_month).'],
  his_entitlement: ['INFERRED', 'medium', 'Your Part A start date.'],
  part_a_projected_start: ['INFERRED', 'medium', 'Part A starts 6 months back from the month you sign up, assumed to be the sign-up month on your to-do list (fact parta_retro).'],
  parta_signup_by: ['ASSUMED', null, 'The end of the month two weeks from today, leaving time to check with HR first. A guide timing choice, not a Medicare rule.'],
  parta_signup_earliest_for_36: ['INFERRED', 'medium', 'The first sign-up month whose backdated Part A start (6 months earlier) is less than 18 months before your last day of work (facts parta_retro, cobra_36_month_rule).'],
  parta_signup_latest_for_36: ['INFERRED', 'medium', 'The month you stop working: a later sign-up could start Part A after you retire, which the 36-month rule does not count (facts parta_retro, cobra_36_month_rule).'],
  wife_cobra_end_if_parta_latest: ['INFERRED', 'medium', 'Part A start for a sign-up in the latest month (6 months back) + 36 months - 1 day (facts parta_retro, cobra_36_month_rule).'],
  drug_enroll_by_no_gap: ['INFERRED', 'high', 'Last day of the month before the month that contains the day after your job coverage ends, so the plan starts on the 1st with no gap (fact partd_sep_effective_date).'],
  drug_enroll_by_no_penalty: ['INFERRED', 'high', 'The last day you can join so the plan starts (on the 1st of the next month) before a 63-day gap, and within your enrollment window (facts partd_penalty, partd_sep_effective_date, ma_pd_sep_employer_loss).'],
  nj_gi_window_close: ['INFERRED', 'medium', 'Job coverage end + 63 days (fact gi_nj_state_extension, which is UNVERIFIED).'],
  ssa44_date: ['INFERRED', 'medium', 'The later of January 1 of your first Part B year and the first day of the month after you stop working: a work-stoppage request can only be made after work stops (fact lce_effective).'],
  wife_partb_start: ['INFERRED', 'high', "The first day of the month that contains the day after your job coverage ends (her Part B starts the same way as yours; fact partb_sep_start_date)."],
  wife_partb_file_by: ['INFERRED', 'medium', 'Her Part B start - 2 months (the same lead time as yours).'],
  wife_medigap_window_close: ['INFERRED', 'high', 'Her Part B start + 6 months - 1 day (fact medigap_oep).'],
  months_until_retire: ['INFERRED', 'medium', 'Months from today until your job coverage ends.'],
  cobra36_eligible: ['INFERRED', 'medium', 'Part A start is before your last day of work and less than 18 months before it (fact cobra_36_month_rule).'],
  wife_cobra_end: ['INFERRED', 'medium', 'Job coverage end + 18 months, or Part A start + 36 months - 1 day if the 36-month rule applies, whichever is later. Confirm with the plan administrator.'],
  bridge_months: ['INFERRED', 'medium', 'Months from the day after your job coverage ends to her Medicare start (any part month counts as a month).'],
  cobra_gap_months: ['INFERRED', 'medium', 'Months from the day after her COBRA ends to her Medicare start (any part month counts as a month).'],
  retire_by_for_36: ['INFERRED', 'medium', 'Projected Part A start + 18 months - 1 day.'],
  wife_cobra_end_if_parta_now: ['INFERRED', 'medium', 'Projected Part A start + 36 months - 1 day.'],
  partb_start: ['INFERRED', 'high', 'The first day of the month that contains the day after your job coverage ends (Part B always starts on the 1st). Fact partb_sep_start_date.'],
  partb_file_by: ['INFERRED', 'medium', 'Part B start - 2 months (Medicare says about 1 month; 2 adds time for the CMS-L564 signature).'],
  ma_window_open: ['INFERRED', 'high', 'Part B start - 3 months (fact ma_window_new_to_b).'],
  ma_window_close: ['INFERRED', 'high', 'End of the 2nd full month after the month your job coverage ends (fact ma_pd_sep_employer_loss).'],
  drug_deadline: ['INFERRED', 'high', 'Job coverage end + 63 days (facts partd_penalty, creditable_notice).'],
  medigap_window_close: ['INFERRED', 'high', 'Part B start + 6 months - 1 day (fact medigap_oep).'],
  medigap_window_open: ['INFERRED', 'high', 'Compares today with the end of your 6-month Medigap window.'],
  partb_sep_end: ['INFERRED', 'high', 'End of the 8th month after the month your job or job coverage ends, whichever is earlier (fact partb_sep).'],
  irmaa_first_year_jan: ['INFERRED', 'medium', 'January 1 of the year your Part B starts.'],
  gcnj_oe_before_retire: ['INFERRED', 'medium', 'The last Get Covered NJ open enrollment (Nov 1 - Jan 31) that opens by the day your job coverage ends (fact gcnj_oe_2027).']
};

// answers: effective answers on the current path. today: ISO date.
// Returns { values, meta, notes, questions } where meta[name] = {label, confidence, how}.
export function compute(answers, facts, today) {
  const a = answers || {};
  const v = { as_of: (facts.__meta && facts.__meta.as_of) || null, today, gi_right: false };
  const meta = {};
  const notes = []; // {needs, for}
  const questions = [];
  const set = (name, value, overrides) => {
    v[name] = value;
    const [label, confidence, how] = LABEL[name] || ['INFERRED', 'medium', ''];
    meta[name] = { label, confidence, how, ...(overrides || {}) };
  };

  // Job coverage end
  let lastDayWorked = null;
  if (isValidMonth(a.last_work_month)) {
    lastDayWorked = monthToLast(a.last_work_month);
    v.last_day_worked = lastDayWorked;
  }
  if (isValidDate(a.job_cov_end)) {
    v.job_cov_end = a.job_cov_end; // the user's own answer: no estimate badge
  } else if (lastDayWorked) {
    set('job_cov_end', lastDayWorked, { label: 'ASSUMED', confidence: null,
      how: 'Assumed to be the last day of the month you stop working (fact his_coverage_end_assumption). Confirm with HR.' });
  }
  const jce = v.job_cov_end || null;

  // Wife's Medicare start
  if (isValidDate(a.wife_birth)) set('wife_medicare_start', wifeMedicareStart(a.wife_birth));

  // Part A
  if (a.part_a === 'no') {
    // "Now" = by the end of the month two weeks out (after the HR check), so the action date and the
    // projected start use the same sign-up month.
    const signupBy = lastOfMonth(addDays(today, 14));
    const pps = addMonths(firstOfMonth(signupBy), -6);
    set('parta_signup_by', signupBy);
    set('part_a_projected_start', pps);
    set('retire_by_for_36', addDays(addMonths(pps, 18), -1));
    set('wife_cobra_end_if_parta_now', addDays(addMonths(pps, 36), -1));
    set('his_entitlement', pps, { how: 'Projected Part A start if you sign up by ' + formatDate(signupBy) + '.' });
    if (lastDayWorked) {
      // C1: retiring after the cutoff, a sign-up now is too early for the 36-month rule. A sign-up month M
      // (start M - 6 months) qualifies when that start is < 18 months before the last day worked.
      v.retire_after_36_cutoff = lastDayWorked > v.retire_by_for_36;
      if (v.retire_after_36_cutoff) {
        const latest = firstOfMonth(lastDayWorked);
        const earliest = addMonths(latest, -11);
        // X2: these are months (any day in the month works), shown as "December 2027".
        set('parta_signup_earliest_for_36', earliest, { format: 'month' });
        set('parta_signup_latest_for_36', latest, { format: 'month' });
        set('wife_cobra_end_if_parta_latest', addDays(addMonths(addMonths(latest, -6), 36), -1));
      }
    }
  } else if (isValidMonth(a.part_a_date)) {
    set('his_entitlement', monthToFirst(a.part_a_date));
  } else if (a.part_a === 'yes') {
    // Date unknown: treat as more than 18 months before retirement (no 36-month rule).
    v.his_entitlement = null;
    v.entitlement_assumed = true;
    meta.his_entitlement = { label: 'ASSUMED', confidence: null, unknown: true,
      how: 'Part A date not known: assumed to be more than 18 months before you retire, so the 36-month COBRA rule is not used. Ask Social Security.' };
    questions.push('Q_SSA_STATUS');
  }
  if (v.his_entitlement) v.part_a_date_display = v.his_entitlement;

  // COBRA for wife
  if (jce && lastDayWorked) {
    const ent = v.his_entitlement;
    const c36 = !!ent && ent < lastDayWorked && lastDayWorked < addMonths(ent, 18);
    set('cobra36_eligible', c36);
    const base = addMonths(jce, 18);
    const end = c36 ? maxDate(base, addDays(addMonths(ent, 36), -1)) : base;
    set('wife_cobra_end', end, v.entitlement_assumed ? { label: 'ASSUMED', confidence: null,
      how: 'Job coverage end + 18 months (your Part A date is unknown, so the 36-month rule was not used).' } : undefined);
    v.wife_cobra_rule = c36
      ? '36-month rule (you became entitled to Medicare less than 18 months before retiring)'
      : '18-month rule';
  }
  if (jce && v.wife_medicare_start) {
    set('bridge_months', monthsCeil(addDays(jce, 1), v.wife_medicare_start));
    if (v.wife_cobra_end) set('cobra_gap_months', monthsCeil(addDays(v.wife_cobra_end, 1), v.wife_medicare_start));
  }
  // H2: she reaches Medicare while still on his job plan, so she signs up for Part B when it ends, as he does.
  v.wife_on_medicare_at_retire = !!(jce && v.wife_medicare_start && a.wife_on_his_plan === 'yes' && v.wife_medicare_start <= jce);
  if (v.wife_on_medicare_at_retire) {
    const ws = firstOfMonth(addDays(jce, 1));
    set('wife_partb_start', ws);
    set('wife_partb_file_by', addMonths(ws, -2));
    set('wife_medigap_window_close', addDays(addMonths(ws, 6), -1));
  }
  if (jce) set('months_until_retire', Math.max(0, monthsCeil(today, jce)));

  // Part B
  if (a.part_b === 'yes') {
    if (isValidMonth(a.part_b_date)) {
      set('partb_start', monthToFirst(a.part_b_date), { how: 'Your Part B start date from your card.' });
    }
  } else if (jce) {
    const ps = firstOfMonth(addDays(jce, 1));
    set('partb_start', ps);
    set('partb_file_by', addMonths(ps, -2));
    set('ma_window_open', addMonths(ps, -3));
  }
  if (jce) {
    set('ma_window_close', lastOfMonth(addMonths(firstOfMonth(jce), 2)));
    set('drug_deadline', addDays(jce, 63));
    // C2: a drug plan starts on the 1st of the month after you join (fact partd_sep_effective_date).
    const gapStart = addDays(jce, 1);
    const gapDays = facts.partd_penalty.value.gap_days;
    set('drug_enroll_by_no_gap', addDays(firstOfMonth(gapStart), -1));
    set('drug_enroll_by_no_penalty', minDate(addDays(firstOfMonth(addDays(gapStart, gapDays - 1)), -1), v.ma_window_close));
    const endedFirst = lastDayWorked ? minDate(lastDayWorked, jce) : jce;
    set('partb_sep_end', lastOfMonth(addMonths(firstOfMonth(endedFirst), 8)));
  }

  // Medigap window
  if (v.partb_start) set('medigap_window_close', addDays(addMonths(v.partb_start, 6), -1));
  if (a.part_b === 'no' || (a.part_b === undefined && a.part_a === 'no')) {
    set('medigap_window_open', true);
    v.medigap_window_status = v.medigap_window_close
      ? `is still open until ${formatDate(v.medigap_window_close)}` : 'opens when your Part B starts';
  } else if (a.part_b === 'yes') {
    if (v.medigap_window_close) {
      const open = today <= v.medigap_window_close;
      set('medigap_window_open', open);
      v.medigap_window_status = open
        ? `is still open until ${formatDate(v.medigap_window_close)}`
        : `closed on ${formatDate(v.medigap_window_close)}`;
    } else {
      set('medigap_window_open', 'unknown', { how: 'Your Part B start date is not known.' });
      v.medigap_window_status = "can't be determined — ask NJ SHIP";
      questions.push('Q_SHIP_GI_PRIMARY');
    }
  }
  // C3: New Jersey's 63-day right after leaving a job plan that pays first (UNVERIFIED-high).
  if (a.part_b === 'yes' && v.medigap_window_open !== true && jce && facts.gi_nj_state_extension) {
    set('nj_gi_window_close', addDays(jce, facts.gi_nj_state_extension.value.window_days_after));
  }

  // IRMAA first January
  if (v.partb_start) {
    const y = yearOf(v.partb_start);
    set('irmaa_first_year_jan', makeDate(y, 1, 1));
    if (monthOf(v.partb_start) >= 10) v.irmaa_second_year_jan = makeDate(y + 1, 1, 1);
    // H1: a work-stoppage request can be made only after work stops (POMS HI 01120.005 B).
    set('ssa44_date', lastDayWorked ? maxDate(v.irmaa_first_year_jan, firstOfMonth(addMonths(lastDayWorked, 1))) : v.irmaa_first_year_jan);
  }
  // Year for yearly dollar figures ({{fig:...}}): the year Part B starts, never earlier than this year.
  v.decision_year = Math.max(v.partb_start ? yearOf(v.partb_start) : yearOf(today), yearOf(today));

  // Get Covered NJ window before retirement
  if (jce) {
    const w = gcnjWindowBefore(facts, jce, today);
    if (w) {
      set('gcnj_oe_before_retire', maxDate(w.start, today), w.assumed
        ? { label: 'ASSUMED', confidence: null, how: `Assumes Get Covered NJ keeps the same Nov 1 - Jan 31 dates in later years (only the 2026-27 dates are published).` }
        : undefined);
      v.gcnj_window = w;
    }
  }

  // Scoring (SPEC 4)
  const score = pathScore(a, v.medigap_window_open, facts);
  v.path_score = score.total;
  v.path_score_reasons = score.reasons;
  meta.path_score = { label: 'ASSUMED', confidence: null, how: 'Design weights (fact path_score_weights), not a Medicare rule.' };

  // Needs
  if (!jce) notes.push('the month you plan to stop working');
  if (!v.wife_medicare_start) notes.push("your wife's date of birth");

  return { values: v, meta, notes, questions };
}

// ---------- scoring (SPEC 4) ----------
export function pathScore(a, windowOpen, facts) {
  const w = facts.path_score_weights.value;
  const reasons = [];
  const add = (name, answer, pts) => reasons.push({ name, answer, points: pts });
  for (const name of ['health_needs', 'doctor_choice', 'travel', 'predictability', 'budget_ok']) {
    const ans = a[name];
    if (ans === undefined) continue;
    add(name, ans, (w[name] && w[name][ans]) || 0);
  }
  if (windowOpen === true && a.health_needs === 'yes') add('reversibility', 'window open and health needs', w.reversibility);
  const total = reasons.reduce((s, r) => s + r.points, 0);
  return { total, reasons };
}

// ---------- IRMAA (SPEC 5a) ----------
// Whole-dollar MAGI; tiers use the table's inclusive min/max, which encode CMS's exact
// "greater than" / "less than or equal" wording (boundary_note).
export function irmaaTier(table, magi) {
  const m = Math.round(magi);
  for (const row of table) {
    if (m >= row.joint_magi_min && (row.joint_magi_max === null || m <= row.joint_magi_max)) return row;
  }
  return null;
}

export function irmaaTableFor(facts, premiumYear) {
  const pick = pickYearFact(facts, 'irmaa_table', premiumYear);
  if (!pick) return null;
  return { table: pick.fact.value, tableYear: pick.year, placeholder: pick.placeholder, factId: pick.fact.id };
}

function monthsInYear(startIso, year) {
  if (!startIso) return 0;
  const y = yearOf(startIso);
  if (y < year) return 12;
  if (y > year) return 0;
  return 13 - monthOf(startIso);
}

const monthlySurchargeCents = (row) => toCents(row.partb_irmaa) + toCents(row.partd_irmaa);

// inputs: { partbStart, wifeMedicareStart, wifeHasB, lastWorkMonth, magi: {year: n}, oneTime: {year: n}, lastYear }
export function irmaaSchedule(facts, inputs) {
  const rows = [];
  if (!inputs.partbStart) return rows;
  const firstYear = yearOf(inputs.partbStart);
  const lastYear = inputs.lastYear || 2031;
  const margin = facts.irmaa_cliff_margin ? facts.irmaa_cliff_margin.value : 0;
  const lastWorkYear = inputs.lastWorkMonth ? +inputs.lastWorkMonth.slice(0, 4) : null;
  const lastFullSalaryYear = inputs.lastWorkMonth
    ? (+inputs.lastWorkMonth.slice(5, 7) === 12 ? lastWorkYear : lastWorkYear - 1) : null;
  for (let Y = firstYear; Y <= lastYear; Y++) {
    const t = irmaaTableFor(facts, Y);
    const taxYear = Y - 2;
    const himMonths = monthsInYear(inputs.partbStart, Y);
    const wifeMonths = inputs.wifeHasB ? monthsInYear(inputs.wifeMedicareStart, Y) : 0;
    const row = { year: Y, taxYear, himMonths, wifeMonths, tableYear: t && t.tableYear,
      placeholder: t ? t.placeholder : true, factId: t && t.factId };
    const magi = inputs.magi ? inputs.magi[taxYear] : undefined;
    if (!t || magi === undefined || magi === null || magi === '') {
      row.missing = `income estimate for ${taxYear}`;
      rows.push(row);
      continue;
    }
    const tier = irmaaTier(t.table, +magi);
    row.magi = +magi;
    row.tier = tier.tier;
    row.surchargeCents = (himMonths + wifeMonths) * monthlySurchargeCents(tier);
    row.surcharge = row.surchargeCents / 100;
    // Cliff warning: within `margin` of the income where the next tier starts.
    const next = t.table.find((r) => r.tier === tier.tier + 1);
    if (next && next.joint_magi_min - row.magi <= margin) {
      row.cliff = { nextMin: next.joint_magi_min,
        stepPerPersonYear: (12 * (monthlySurchargeCents(next) - monthlySurchargeCents(tier))) / 100 };
    }
    // Appeal (life-changing event: work stoppage)
    const appealable = lastWorkYear !== null && taxYear <= lastWorkYear && Y >= lastFullSalaryYear + 1;
    row.appealable = appealable;
    if (appealable) {
      const newer = inputs.magi ? inputs.magi[Y] : undefined;
      if (newer === undefined || newer === null || newer === '') {
        row.appealMissing = `income estimate for ${Y}`;
      } else {
        const at = irmaaTier(t.table, +newer);
        row.appealTier = at.tier;
        row.appealSurchargeCents = (himMonths + wifeMonths) * monthlySurchargeCents(at);
        row.appealSurcharge = row.appealSurchargeCents / 100;
        const oneTime = inputs.oneTime ? +(inputs.oneTime[Y] || 0) : 0;
        row.appealOneTime = oneTime; // still counted in year Y; cannot be appealed
      }
    }
    rows.push(row);
  }
  return rows;
}

// ---------- late penalties (SPEC 5b) ----------
export function partBPenalty(facts, monthsLate, year) {
  const prem = pickYearFact(facts, 'partb_premium', year);
  const pct = facts.partb_penalty.value.pct_per_full_12_months * Math.floor(monthsLate / 12);
  const baseCents = toCents(prem.fact.value);
  const cents = roundToDime((baseCents * (100 + pct)) / 100);
  return { pct, monthly: cents / 100, premiumYear: prem.year, placeholder: prem.placeholder, factId: prem.fact.id };
}

export function partDPenalty(facts, monthsWithout, year) {
  const base = pickYearFact(facts, 'partd_base', year);
  const pct = facts.partd_penalty.value.pct_per_month;
  const cents = roundToDime((toCents(base.fact.value) * monthsWithout * pct) / 100);
  return { monthly: cents / 100, baseYear: base.year, placeholder: base.placeholder, factId: base.fact.id };
}

// ---------- Medigap compare (SPEC 5c) ----------
// inputs: { g, n, hdg (monthly premiums), office, er, excess, yearType: healthy|moderate|bad, year }
export function medigapCompare(facts, inputs) {
  const types = facts.medigap_compare_year_types.value;
  const year = inputs.year;
  const partA = pickYearFact(facts, 'parta_deductible', year);
  const partB = pickYearFact(facts, 'partb_deductible', year);
  const hd = pickYearKey(facts.hdg_deductible.value, year);
  const copay = facts.plan_n_differences.value;
  const costSharing = inputs.yearType === 'healthy' ? types.healthy
    : inputs.yearType === 'bad' ? partA.fact.value + types.bad_extra : types.moderate;
  const excess = +inputs.excess || 0;
  const bDed = Math.min(costSharing, partB.fact.value);
  const out = { costSharing, partBDeductible: partB.fact.value, hdDeductible: hd.value,
    placeholders: { partB: partB.placeholder ? partB.year : null, partA: partA.placeholder ? partA.year : null,
      hd: hd.placeholder ? hd.year : null } };
  const yearly = (monthly, oop) => (monthly === '' || monthly === undefined || monthly === null || isNaN(+monthly))
    ? null : (toCents(12 * +monthly) + toCents(oop)) / 100;
  out.g = yearly(inputs.g, bDed);
  out.n = yearly(inputs.n, bDed + copay.office_copay * (+inputs.office || 0) + copay.er_copay * (+inputs.er || 0) + excess);
  out.hdg = yearly(inputs.hdg, Math.min(costSharing + excess, hd.value));
  return out;
}
