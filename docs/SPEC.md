# Medicare Decision Guide — Build Spec for Claude Code

**As of:** November 3, 2026. **Audience:** a 67-year-old New Jersey resident (non-expert), still working at a 20+ employee firm, retiring in 1–3 years; wife 62.
**Files:** `SPEC.md` (this), `facts.json` (every fact, label, source URL), `tree.json` (questions, routing, outcomes, actions, questions-to-ask).

Build a single offline HTML page where he answers plain-English questions one at a time and ends with: which Medicare path fits him, a dated to-do list, his wife's coverage bridge, and questions for HR, Social Security and NJ SHIP. Every fact on screen links to its primary source.

---

## 1. Non-negotiable rules

1. **No fact without a source.** Every number, date rule or legal rule shown must come from `facts.json` by id (via `{{fact:id}}` tokens). Do not hard-code facts in UI copy. If copy needs a new fact, add it to `facts.json` with a source URL and label first.
2. **Show the label.** Render each fact with a small badge: VERIFIED (neutral), UNVERIFIED (amber, show confidence), INFERRED (blue, show derivation on tap), ASSUMED (red), PENDING (grey). Each badge has a "Source" link opening `source.url` in a new tab; show `also` links in the detail popover.
3. **Staleness.** If today > a fact's `review_after`, show "This number may be out of date — check the source" next to it, and a banner on the summary page. `partb_2027_status` is PENDING: show 2027 projections only with the word "projected".
4. **Computed values are estimates.** Anything from §3 or §5 is labeled INFERRED in the UI with a one-line "how we got this" on tap.
5. **No data leaves the device.** No network calls except clicked source links. No analytics. Optional resume via `localStorage`, wrapped in try/catch; the page must work without it.
6. **Plan types, not products.** Never recommend a company or a specific plan. Company names in `nj_medigap_rates_jun2026` are for the range only and are not displayed as picks.
7. **Grammar** for `when`/`route` and text tokens is in `tree.json → meta`. Implement it as a small interpreter; do not `eval` strings.

## 2. Accessibility and layout (for a 67-year-old reader)

- One question per screen; base font ≥ 18px; buttons ≥ 48px tall; high contrast; works on phone and desktop.
- Back button and a progress indicator by module (tree `module` field).
- "Why we ask" (`help`) shown under a toggle. Glossary pop-ups for: Part A, Part B, Part D, Medigap, Medicare Advantage, IRMAA, COBRA, creditable coverage, guaranteed issue, take assignment, SHIP.
- Summary page (`I1`) is printable: actions sorted by date, questions grouped by HR / NJ SHIP / Social Security, a Sources list (every fact id used on this path, deduped, title + URL), and an Open Items list (§8).
- "Change my answers" lets him edit any earlier input and re-renders dates.

## 3. Computed values

All dates are calendar dates. "+Nm" adds months; "end of month" = last calendar day. Use a date library or careful native code; test leap years (Feb 29, 2028).

| Name | Rule | Label |
|---|---|---|
| `as_of` | `facts.meta.as_of` | — |
| `job_cov_end` | User input; default = last day of `last_work_month` (`his_coverage_end_assumption`) | ASSUMED if defaulted |
| `wife_medicare_start` | First day of her 65th-birthday month; if born on the 1st, first day of the prior month (`medicare_start_month`) | INFERRED, high |
| `his_entitlement` | `part_a_date` if known. If he has Part A and the date is unknown: treat as more than 18 months before retirement (no 36-month rule) and add `Q_SSA_STATUS`. The card date is asked only when `parta_date_can_matter` (he stops working less than 21 months after the start of this month); otherwise no card date could trigger the 36-month rule | ASSUMED if unknown |
| `part_a_projected_start` | If `part_a = no`: first day of the month 6 months before the current month (`parta_retro`) | INFERRED, medium |
| `cobra36_eligible` | `his_entitlement` < last day worked AND (last day worked − `his_entitlement`) < 18 months (`cobra_36_month_rule`) | INFERRED, medium |
| `wife_cobra_end` | If `cobra36_eligible`: later of (`job_cov_end` + 18m) and (`his_entitlement` + 36m − 1 day). Else `job_cov_end` + 18m | INFERRED, medium (confirm with plan administrator) |
| `wife_cobra_rule` | "18-month rule" or "36-month rule (you became entitled to Medicare less than 18 months before retiring)" | — |
| `bridge_months` | Whole months from day after `job_cov_end` to `wife_medicare_start` (≤ 0 = no gap) | INFERRED |
| `cobra_gap_months` | Whole months from day after `wife_cobra_end` to `wife_medicare_start` (≤ 0 = COBRA covers it) | INFERRED |
| `retire_by_for_36` | `part_a_projected_start` + 18m − 1 day | INFERRED, medium |
| `wife_cobra_end_if_parta_now` | `part_a_projected_start` + 36m − 1 day | INFERRED, medium |
| `partb_start` | Day after `job_cov_end` (normally the 1st of the next month) (`partb_sep_start_date`) | INFERRED, high |
| `partb_file_by` | `partb_start` − 2 months (Medicare says about 1 month; 2 adds margin for the CMS-L564 signature) (`partb_signup_lead_time`) | INFERRED |
| `ma_window_open` | `partb_start` − 3 months (`ma_window_new_to_b`) | INFERRED, high |
| `ma_window_close` | End of the 2nd full month after the month `job_cov_end` falls in (`ma_pd_sep_employer_loss`). Use this earlier, conservative date even though the "new to Part B" window may run slightly later | INFERRED, high |
| `drug_deadline` | `job_cov_end` + 63 days (`partd_penalty`, `creditable_notice`) | INFERRED, high |
| `medigap_window_close` | `partb_start` + 6m − 1 day (`medigap_oep`). If `part_b = yes`: `part_b_date` + 6m − 1 day | INFERRED, high |
| `medigap_window_open` | `part_b = no` → true (window is in the future). `part_b = yes` → today ≤ `medigap_window_close`. `part_b_date` unknown → "unknown"; route to `OUT_CLOSE_CALL` and add `Q_SHIP_GI_PRIMARY` | INFERRED |
| `medigap_window_status` | "is still open until X" / "closed on X" / "can't be determined — ask NJ SHIP" | — |
| `gi_right` | false (federal right does not apply to a primary plan ending, `gi_primary_plan_not_federal`). The NJ state right is UNVERIFIED and must not set this to true | — |
| `partb_sep_end` | End of the 8th month after the month that employment or job coverage ended, whichever is earlier (`partb_sep`) | INFERRED, high |
| `irmaa_first_year_jan` | January 1 of the year `partb_start` falls in; if `partb_start` is in Oct–Dec, show both that date and the next Jan 1 | INFERRED |
| `gcnj_oe_before_retire` | The last Nov 1–Jan 31 Get Covered NJ window that opens on or before `job_cov_end` (and has not closed) (`gcnj_oe_2027`; later years assumed to use the same dates — ASSUMED) | — |

## 4. Medigap vs. Advantage scoring (`F7`)

The user asked to weigh three goals equally: lowest total cost, keeping doctors/hospitals, predictable costs. Weights below are a transparent guide (ASSUMED design, not a Medicare rule). Positive = Medigap, negative = Advantage.

| Input | Points |
|---|---|
| `health_needs` yes / no / skip | +1 / −1 / 0 (heavy users tend to pay less under Medigap; light users under Advantage) |
| `budget_ok` = no | −2 (affordability overrides) |
| `doctor_choice` very / somewhat / not | +1 / 0 / −1 |
| `travel` = yes | +1 |
| `predictability` fixed / variable | +1 / −1 |
| Reversibility: `medigap_window_open` = true AND `health_needs` = yes | +1 (Medigap is the choice that is hard to get back into: `nj_underwriting_after_window`) |

Routing: window closed and no guaranteed right → `OUT_NO_MEDIGAP_WINDOW`; score ≥ 2 → `OUT_LEAN_MEDIGAP`; ≤ −2 → `OUT_LEAN_MA`; else `OUT_CLOSE_CALL`. On the outcome screen show a "Why" list naming each answer and its points.

## 5. Calculators

### 5a. IRMAA (`H1`)
- Inputs: joint MAGI estimate for tax years 2025–2030 (number field with "about" presets), and, per year, how much of it is one-time income (Roth conversions, capital gains). Explain MAGI with `irmaa_magi_definition`.
- For each premium year Y from the year of `partb_start` through 2031: tax year = Y − 2 (`irmaa_lookback`). Find the tier with `irmaa_table_2026` using CMS's exact boundary wording (`boundary_note`).
- People charged in Y: him for each month Part B is in effect in Y; his wife for each month from `wife_medicare_start` (only if she will have Part B). Annual surcharge per person = months × (partb_irmaa + partd_irmaa). (`irmaa_per_person`)
- "With appeal" column: if tax year Y − 2 includes wages earned before `job_cov_end` and Y ≥ the year after the last full-salary year, recompute with the MAGI estimate for year Y (SSA uses the newer year: `lce_attestation`, `lce_effective`). Note: one-time income in year Y still counts; one-time income alone never qualifies (`lce_nonqualifying`).
- Flag any year within $10,000 below a threshold (cliff warning) and show the dollar step from `irmaa_tier_steps`.
- Years ≥ 2027 use 2026 brackets as a placeholder and say so (`partb_2027_status`). When CMS publishes 2027 figures, add `irmaa_table_2027` and select the table by premium year.

### 5b. Late penalties (helper inside `OUT_SIGNUP_TIMELINE`)
- Part B: penalty % = 10% × floor(months late ÷ 12); monthly = standard premium × (1 + %), rounded to $0.10 (`partb_penalty`).
- Part D: monthly = round_to_0.10(months without creditable coverage × 1% × base premium for that year) (`partd_penalty`, `partd_base_2026`, `partd_base_2027`).

### 5c. Medigap compare (`MEDIGAP_COMPARE`)
- Inputs: monthly quotes for G, N, High-Deductible G (pre-filled blank; placeholder text shows the age-65 ranges from `nj_medigap_rates_jun2026`), office visits/year, ER visits/year, expected excess charges/year (default 0), and a year type: Healthy (Medicare-covered cost-sharing $500), Moderate ($2,000), Bad year (one hospital stay: Part A deductible + $5,000).
- Yearly cost = 12 × premium + out-of-pocket:
  - G: min(cost-sharing, Part B deductible) + 0 excess.
  - N: min(cost-sharing, Part B deductible) + $20 × office visits + $50 × ER visits + excess charges.
  - HD-G: min(cost-sharing + excess, HD deductible for that year).
- Show all three side by side; label INFERRED (simplified model). Drug plan premium is the same across all three and is excluded.

## 6. Test cases (must pass)

| # | Inputs | Expected |
|---|---|---|
| T1 | ss no; part_a no; part_b no; retiree no; last work 2027-12; job_cov_end 2027-12-31; wife born 1964-06-15, on his plan; Part A signed up Nov 2026 | `part_a_projected_start` 2026-05-01; `retire_by_for_36` 2027-10-31; not cobra36 (20 months); `wife_cobra_end` 2029-06-30; `wife_medicare_start` 2029-06-01 → `OUT_BRIDGE_COBRA`. `partb_start` 2028-01-01; `partb_file_by` 2027-11-01; `ma_window_open` 2027-10-01; `drug_deadline` 2028-03-03; `ma_window_close` 2028-02-29; `medigap_window_close` 2028-06-30; `partb_sep_end` 2028-08-31 |
| T2 | part_a_date 2026-05; last work 2027-06; job_cov_end 2027-06-30; wife born 1964-10-10, on his plan; bridge_income 400_600 | cobra36 eligible (≈14 months); `wife_cobra_end` 2029-04-30; `wife_medicare_start` 2029-10-01; `cobra_gap_months` 5 → `OUT_BRIDGE_GAP`, 400–600% variant |
| T3 | part_b yes, part_b_date 2025-03 | Medigap window 2025-03-01 to 2025-08-31, closed → `OUT_HAS_PARTB`; F7 → `OUT_NO_MEDIGAP_WINDOW` |
| T4 | F2 yes, F3 very, F4 no, F5 fixed, F6 yes, window open | score 4 → `OUT_LEAN_MEDIGAP` |
| T5 | F2 no, F3 not, F4 no, F5 variable, F6 yes | score −3 → `OUT_LEAN_MA` |
| T6 | F2 skip, F3 somewhat, F4 no, F5 fixed, F6 yes | score 1 → `OUT_CLOSE_CALL` |
| T7 | wife_on_his_plan no | `OUT_WIFE_NOT_ON_PLAN` → `OUT_WIFE_AT_65` |
| T8 | IRMAA: partb_start 2028-01-01; MAGI 2026 = 300,000; MAGI 2028 estimate = 120,000; wife not on Medicare in 2028 | 2028 without appeal: tier 2, him only, 12 × (202.90 + 37.50) = **$2,884.80** (2026 brackets, placeholder); with appeal: tier 0, $0 |
| T9 | IRMAA boundary: MAGI exactly 218,000 → tier 0; 218,001 → tier 1; 750,000 → tier 5; 749,999 → tier 4 | as stated |
| T10 | Part D penalty: 12 months, 2027 | 0.12 × 41.33 = 4.9596 → **$5.00/month** |
| T11 | Part B penalty: 24 months, 2026 | $243.48 → **$243.50/month** (matches Medicare.gov example) |
| T12 | Medigap compare: G $200, N $150, 8 office visits, 0 ER, 0 excess, Moderate year | G = 2,400 + 283 = **$2,683**; N = 1,800 + 283 + 160 = **$2,243** |
| T13 | Any fact with today > review_after | stale banner shown |
| T14 | Validation script | every `{{fact:id}}`, `fact_refs`, `add_actions`, `add_questions`, `next`, `route.next` resolves; every node reachable from the start node (`A3`); every fact has `source.url` unless label is ASSUMED or INFERRED-from-inputs |

## 7. Changes from the earlier research report (already applied in the data)

1. **Medigap guaranteed issue:** a federal guaranteed right is NOT triggered when a job plan that pays first ends (CMS Bulletin 04-01). The report called this unclear. New Jersey may grant a state right (UNVERIFIED, medium). Taking COBRA after Medicare starts creates a federal right when COBRA ends.
2. **Medicare Advantage timing:** his window opens 3 months before Part B starts (not only 2 months after coverage ends).
3. **Part B start date:** he can ask for Part B to start up to 3 months after signing up, which lets him file early and still start exactly when job coverage ends.
4. **IRMAA cliff values:** steps are $1,148.40, $1,736.40, $1,735.20, $1,735.20 and $580.80 per person-year (report said $1,148–$1,736 for all).
5. **IRMAA lookback:** SSA uses the most recent return available, normally 2 years back, never older than 3 (report said "two years" flatly).
6. **Two income definitions:** IRMAA counts only taxable Social Security; the marketplace counts all of it.
7. **Plan choice added:** G vs. N vs. High-Deductible G, with HD-G deductible $2,950 (2026) and $3,050 (2027, CMS Oct 2026).
8. **Now primary-sourced:** Part B penalty and Part A backdating (Medicare.gov), Part D 2027 base premium (CMS), COBRA rules (DOL), NJ mini-COBRA (DOBI), Get Covered NJ 2027 dates and NJ subsidy (DOBI), excess-credit repayment (IRS), poverty guidelines (HHS), delayed retirement credits (SSA).
9. **Still not primary-confirmed** (kept with UNVERIFIED labels): 2027 Part D deductible/cap, 2027 Advantage out-of-pocket limits, NJ 2027 Advantage plan counts, the 9.96% employer affordability figure, Plan N's excess-charge exclusion, and the NJ state guaranteed-issue rule.

## 8. Open items to show on the summary page

- Official 2027 Part B premium and IRMAA brackets (CMS, expected mid-November 2026). Update `partb_2027_status` and add `irmaa_table_2027`.
- His Part A start date (SSA) — decides the wife's COBRA length.
- Exact date his job coverage ends (HR).
- Whether NJ law gives a guaranteed Medigap right when a primary job plan ends (NJ SHIP).
- Whether a first-time Advantage enrollee at his age has any trial right (NJ SHIP).
- His wife's COBRA price and her own employer's plan cost (HR; her employer).
- Whether Congress changes marketplace subsidies for 2027–2029 (recheck `federal_ptc_400_cliff`).

## 9. Maintenance

- To update a number, edit only `facts.json` (value, `effective`, `source`, `review_after`). The UI must not need changes.
- Re-verify every fact with `review_after` each November after CMS publishes next-year figures, and each August after NJ DOBI announces Get Covered NJ dates.
