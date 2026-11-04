# Needs review

Everything here is a choice, assumption or open question a person should confirm. Facts are as of November 3, 2026. "Opened" means the page was read on that date during this build.

## 1. Assumptions in the date math and rules

| # | Item | Label | Why it matters |
|---|---|---|---|
| A1 | **Month arithmetic.** "+N months" on a month-end date gives the target month's last day (2027-06-30 + 18m = 2028-12-31; 2027-12-31 + 18m = 2029-06-30). Any other date keeps its day, clamped to the target month's length. "+N days" and "-1 day" are calendar days. | ASSUMED | Decides the displayed COBRA end date. A plan administrator might count 18 months differently. |
| A2 | **Part B start** = the 1st of the month containing the day after job coverage ends. If coverage ends mid-month (Dec 15), Part B starts on the 1st of that month (Dec 1), with a short overlap and no gap. SPEC said "day after job_cov_end", which can't be right when coverage ends mid-month, because Part B starts on the 1st. | ASSUMED | Ask NJ SHIP (Q_SHIP_TIMING is always included). |
| A3 | **Gaps count part months as whole months** (`bridge_months`, `cobra_gap_months`). A 15-day gap is 1 month, not 0. | ASSUMED | Without this, a short gap would show "no gap". |
| A4 | **Last day worked** = last day of the stop-working month. **Last full-salary year** = that year if he stops in December, otherwise the year before. | ASSUMED | Decides the 36-month COBRA test and the IRMAA appeal column. |
| A5 | **Part A start when he has no card**: the projected start for a sign-up this month (6 months back). **Part A date unknown** (card or Social Security): treated as more than 18 months before retiring, so the shorter 18-month COBRA is shown and Q_SSA_STATUS is added. | ASSUMED | The conservative choice. |
| A6 | **Part B already held**: his Part B start is the date on the card. If it is unknown, the Medigap window is "unknown", F7 routes to OUT_CLOSE_CALL, Q_SHIP_GI_PRIMARY is added, and the IRMAA calculator assumes Part B all of the current year. | ASSUMED | |
| A7 | **Dates already passed** show "As soon as possible" with the original date, sorted as today. | design | |
| A8 | **Get Covered NJ pricing action**: the latest Nov 1-Jan 31 window that ends before job coverage ends and not before today. Only the 2026-27 window is published; later windows reuse the same dates and are labeled ASSUMED. If none qualifies, the action is left out. | ASSUMED (later years) | |
| A9 | **IRMAA**: MAGI is rounded to whole dollars. Premium years with no table use the latest earlier table, labeled "placeholder". The spouse is counted from her Medicare start month if the "will have Part B and a drug plan" box is ticked (default ticked). Cliff warning: income within the `irmaa_cliff_margin` fact of the next tier's starting income. | ASSUMED / design | |
| A10 | **Medigap compare**: each value uses the selected plan year if published, else the latest earlier year (labeled). T12's expected $283 is the 2026 Part B deductible, because the 2027 figure is not published. | design | |
| A11 | An answer of "I don't know" shows as "unknown". "[not entered yet]" is only for a value that was never entered (and it is logged to the console). | design | |
| A12 | Penalty amounts always show cents ($5.00). Other dollar facts show cents only when they have them ($9,850; $202.90). | design | |
| A13 | **Part A "sign up now"** means by the end of the month two weeks from today (after the HR check), and the projected Part A start uses that same month. | ASSUMED (guide timing) | Keeps the to-do date and the projected start consistent. |
| A14 | **Part A window for the 36-month rule** (when he stops working after the cutoff): from 11 months before the month he stops working to that month. A later sign-up, after he stops, is not offered, because a backdated start set up after the job ends may not count as "entitlement before the event". | INFERRED (medium) | HR and Social Security questions are added on this path. |
| A15 | **Drug-plan dates.** No gap: join by the last day of the month before the month containing the day after job coverage ends. No penalty: the latest join date whose plan start (the 1st of the next month) comes less than 63 days after coverage ends, and within the enrollment window. | INFERRED (high) | From facts `partd_sep_effective_date` and `partd_penalty`. |
| A16 | **New Jersey 63-day right** is dated as job coverage end + 63 days. The regulation counts from the effective date of disenrollment, so this may be one day early (the safe side). | INFERRED (medium) | The fact itself is UNVERIFIED-high (see section 4). |
| A17 | **Yearly dollar figures** ({{fig:…}}) use the year Part B starts (never earlier than this year). A year with no published figure shows the latest earlier one, labeled "(2026 figure; the 2028 amount isn't published yet)". | design | |
| A18 | **Get Covered NJ pricing window** (changed after the UX review). `gcnj_oe_before_retire` is now the last Nov 1 - Jan 31 open enrollment that *opens* on or before job coverage ends and has not closed. It used to be the one that *ends* before coverage ends. For a December 2027 retirement that moves the step from November 2026 (2027 prices) to November 2027 (2028 prices, when she can also enroll for a January 1 start). SPEC §3 was updated to match. | INFERRED | A guide timing choice, not a rule. Later years' dates are ASSUMED to repeat the 2026-27 dates. |

## 2. Changes made to `src/data/` (originals in `inputs/` untouched)

### facts.json

| Fact | Change | Source / basis |
|---|---|---|
| `hsa_medicare` | **New**, VERIFIED. No HSA contributions from the first Medicare month, including backdated months; Medicare.gov advises stopping 6 months before retiring. | Opened 2026-11-03: [IRS Pub. 969, "Enrolled in Medicare"](https://www.irs.gov/publications/p969) and [Medicare.gov: Working past 65](https://www.medicare.gov/basics/get-started-with-medicare/medicare-basics/working-past-65). |
| `iep_window` | **New**, VERIFIED. Initial Enrollment Period: 7 months, 3 before to 3 after the 65th-birthday month. | Opened 2026-11-03: [Medicare.gov: When does Medicare coverage start?](https://www.medicare.gov/basics/get-started-with-medicare/sign-up/when-does-medicare-coverage-start). Replaces unsourced wording in OUT_WIFE_AT_65. |
| `partb_penalty`, `partd_penalty`, `plan_n_differences`, `gcnj_oe_2027`, `nj_ship_contact`, `cobra_basics`, `gcnj_sep_loss` | Added a structured `value` holding numbers already written in the fact's own `plain` text (10%, 1%, $0.10, $20/$50, Nov 1-Jan 31, the phone number, 18 months/102%/60 days, 60 days). Labels unchanged. | Same source as each fact. Lets the engine take numbers from facts.json instead of code (SPEC §9). |
| `medigap_compare_year_types` | **New**, ASSUMED. Healthy $500 / Moderate $2,000 / Bad = Part A deductible + $5,000. | SPEC §5c design values. |
| `path_score_weights` | **New**, ASSUMED. The SPEC §4 points table. | SPEC §4 design. |
| `irmaa_cliff_margin` | **New**, ASSUMED. $10,000. | SPEC §5a design. |

### tree.json

| Where | Change | Why |
|---|---|---|
| OUT_ENROLL_PARTA text | Removed "You have no HSA, so signing up causes no tax problem." Replaced "free for you if you or your wife worked 10+ years" and "Coverage starts 6 months back" with the `parta_premium_free` token (the `parta_retro` bullet already states the 6 months). | Requirements 5 and 6 |
| OUT_ENROLL_PARTA bullet 3 | Removed "18 months" / "36 months"; the `cobra_36_month_rule` token states them. | Lint |
| B1 route + new nodes `B_HSA`, `OUT_HSA_WARNING`; new variable `hsa`; new question `Q_HR_HSA` | HSA question before OUT_ENROLL_PARTA; yes/not sure shows the warning and adds the HR question. | Requirement 6 |
| OUT_WORKING_OK bullet 4 | Removed "(Oct 15 - Dec 7)"; the `medicare_oep` token states the dates. | Lint |
| OUT_BRIDGE_COBRA bullets 2-3 | Removed "plus 2%" and "within 60 days"; now point to the `cobra_basics` and `gcnj_sep_loss` tokens. | Lint |
| OUT_PLAN_G text | Removed "It is the most complete plan you can buy." | Lint: unsourced claim |
| H1 text | "from 2 years earlier" → "an earlier year's tax return" plus the `irmaa_lookback` token. | Lint |
| OUT_WIFE_AT_65 bullet 3 | "(3 months before to 3 months after ...)" → `iep_window` token. | Lint |
| F7 route | New first entry: `medigap_window_open` = "unknown" → OUT_CLOSE_CALL, with `add_questions: [Q_SHIP_GI_PRIMARY]`. | Requirement 7 |
| Q_HR_COBRA_36 | `{{part_a_date}}` → `{{his_entitlement}}` (empty on the no-card path otherwise). | Bug fix |
| `glossary`, `open_items` | New sections: glossary pop-ups (SPEC §2) and the SPEC §8 open items, each linked to a fact. | SPEC §2, §8 |

### Changes from the adversarial review (2026-11-03)

| Review item | What changed |
|---|---|
| C1 Part A timing | When he stops working after `retire_by_for_36`, OUT_ENROLL_PARTA no longer says "sign up now". It shows the sign-up window (`parta_signup_earliest_for_36` to `parta_signup_latest_for_36`) and the longest COBRA it gives. The later in the window, the longer her COBRA (the earliest month only equals the regular 18 months). It says timing doesn't matter if her regular COBRA already reaches Medicare. The action is `ACT_ENROLL_PARTA_WINDOW`, plus questions `Q_SSA_PARTA_START` and `Q_HR_PARTA_ENTITLEMENT`. `Q_HR_COBRA_36` now appears only when the 36-month rule applies. The projected Part A start uses the same month as the to-do date (A13). |
| C2 Drug enrollment | New computed `drug_enroll_by_no_gap` and `drug_enroll_by_no_penalty` (A15). New fact `partd_sep_effective_date` (VERIFIED, 42 CFR 423.40(c), 423.38(c)(11)). The timeline rows were rewritten, and `ACT_ENROLL_DRUG` is on every completed path. `drug_deadline` is still computed (SPEC T1) but no longer shown. |
| C3 NJ 63-day right | `gi_nj_state_extension` re-sourced to N.J.A.C. 11:4-23.12 and raised to UNVERIFIED-high, with value `{window_days_after: 63}`. New computed `nj_gi_window_close`. The variant text, `ACT_NJ_GI_CONFIRM` and `Q_SHIP_NJ_GI_PLANS` appear when Part B is held and the window is closed or unknown. The routing (`gi_right=false`) is unchanged. |
| C4 Part B start | `partb_sep_start_date` now states the 42 U.S.C. 1395q(e) rule (same month, or any of the next 3). |
| H1 SSA-44 | New `ssa44_date` = the later of January of the first Part B year and the month after work stops. |
| H2 Wife on Medicare at his retirement | New `wife_on_medicare_at_retire`, `wife_partb_start`, `wife_partb_file_by`, `wife_medigap_window_close`. A variant on OUT_BRIDGE_NONE, plus `ACT_WIFE_PARTB_FILE` and `ACT_WIFE_DRUG`. |
| H3 HSA | B_HSA is now asked on every path (new route `B_HSA_NEXT`). OUT_HSA_WARNING has a variant for people already on Medicare. OUT_ENROLL_PARTA explains the HSA cost of signing up early. |
| H4 Employer size, creditable coverage | New questions A10 (`employer_20`) and A11 (`drug_creditable`), and outcomes OUT_SMALL_EMPLOYER and OUT_DRUG_NOT_CREDITABLE. OUT_WORKING_OK no longer asserts the employer size. |
| H5 Dropping COBRA | New fact `cobra_drop_no_sep` (VERIFIED, HealthCare.gov; NJ Treasury). The bullet is on both bridge outcomes. `gcnj_sep_loss` was re-sourced to the NJ Treasury page, which states the 60 days before and after. |
| H6 Advantage cost | F1 says the Part B premium is still owed. New fact `ma_requires_partb` (INFERRED-high, 42 CFR 422.50(a)(1)). |
| H7 Key deadlines | New `key_deadlines` list in tree.json, shown as a table at the top of the summary, and printed. |
| H8 Text and tap size | Badges and Source links are 16px, warnings 18px; badges and glossary terms have a hit area of about 44px. |
| H9 IRMAA on phones | Below 640px each premium year is a card. Income inputs are grouped by tax year, and the two years that set his first premiums start open. |
| H10 Placeholder years | New `{{fig:prefix.path}}` token renders "$283 (2026 figure; the 2028 amount isn't published yet)". It is used for the Part B premium and deductible, the HD-G deductible, the MA out-of-pocket limit and the Part D cap. Plan G's fact text no longer hard-codes dollars. Calculator years default to the Part B start year and come from the data. |
| H11 Tests | Value tests read the frozen `tests/fixtures/facts-2026-11-03.json`. The "no 2027 table" test was removed. Invariant and refresh-simulation tests run on the shipped data. |
| H12 Trial right | New fact `ma_trial_right_at_your_age` (INFERRED-high, 42 U.S.C. 1395ss(s)(3)(B)(v)-(vi), N.J.A.C. 11:4-23.12(c)7). The OUT_LEAN_MA bullet was rewritten. |
| H13 Part B held, window open | A variant on OUT_LEAN_MEDIGAP about paying early. `ACT_MEDIGAP_QUOTES_HAS_B` replaces "apply so it starts with Part B" on that path. |
| M2, M5, M6, M7, M8, M14, M15, M16 (part), M17, M18, M20, L1, L9, L10 | COBRA "may" end early. A Part B-unknown variant. Hand-written labels removed. Print hides Source links and prints URLs only in the Sources list. "Clear" asks to confirm (focus on Cancel). Poverty-line note. Wife-without-coverage variant. Year lists come from the data. SSA facts re-opened (both kept VERIFIED). Marks and glossary buttons moved out of headings. POMS wording. `wife_65_window` removed. COBRA election wording. |


### UX review, correctness pass (2026-11-04)

| Item | Change |
|---|---|
| X1 F5 wording | The question was "Which would bother you more?", but the code scored the pick as a preference. It is now "Which do you prefer?", with "Pay more each month…" / "Pay less each month…". The values and scoring are unchanged (T4-T6). |
| X2 Part A sign-up months | `parta_signup_earliest_for_36` and `parta_signup_latest_for_36` carry `format: 'month'` and print as "December 2027". `ACT_ENROLL_PARTA_WINDOW` has `date_end_rule`, and the summary prints "Between January 2027 and December 2027" instead of the earliest day, which gives no extra COBRA. Q_SSA_PARTA_START no longer says "the month of December 1, 2027". The late-retirement Part A variant no longer opens with "You plan to stop working after {cutoff}". |
| Get Covered NJ window | See A18. |
| Refresh and Back | Each screen is a history entry, so the phone's Back gesture goes to the previous screen. A tab-only copy (sessionStorage, deleted when the tab closes) keeps his place on refresh. It leaves out the health answer and the income amounts. Saving across visits is still opt-in. |
| Clear confirmation | The 10-second auto-hide was removed. |

### UX review, flow pass (2026-11-04)

| Item | Change |
|---|---|
| H1 order | The welcome screen (A1) and the Social Security question (A2, `ss_collecting`) were removed. A2 was read by nothing but its own `sets: part_a = yes`, and people getting Social Security have the card A3 asks about. The new order is A3 card › A10 20+ employees › A6 stop-work month › A8 › A7 › [A3b] › [A4 › A4b] › A5 › [A9] › A11 › B1. A3 shows a one-line intro. |
| H1 card date | A3b is asked only when `parta_date_can_matter`: he stops working less than 21 months after the start of this month. The 36-month rule needs the last day worked within 18 months after the Part A start, and a card's start is allowed to be up to 3 months ahead (INFERRED-high). When it is skipped, `his_entitlement` is "not needed", not ASSUMED. |
| H1 conditional questions | A9 only when the wife is not on his plan. G2 only when visits = few. G3 only when visits is few or some (G4 reads them only then). |
| H1 forks | `F_FORK` (after the sign-up timeline: "Help me choose now" / "Not now. Show my to-do list") and `H_FORK` (before the IRMAA calculator: "Yes, check it" / "Skip"). Both are drawn as two buttons on the screen before them. "Not now" goes to the new OUT_DECIDE_LATER (book NJ SHIP) and leaves out the Medigap price steps (ACT_MEDIGAP_QUOTES, ACT_MEDIGAP_APPLY, ACT_MEDIGAP_QUOTES_HAS_B). The screen says so. |
| M2 wife's birth | Month and year, plus "She was born on the 1st of the month". Stored as the 1st or the 15th; only the 1st changes her Medicare month (fact `medicare_start_month`). |
| M3 coverage end | A6b is answered "assume the last day of the month" automatically, and A6 says so with a Change button. A6b still shows when opened from Change or the summary. |
| Check | 20,000 random complete answer sets (seed 777, today 2026-11-03) plus 8,000 each at 2027-02-15 and 2026-12-31, compared with commit a8fb7c4: 0 differences in outcome screens, dated actions, summary questions, key deadlines and the COBRA, Part B and Medigap dates, with both forks answered yes. Every old outcome screen is still reached. |

### UX review, presentation pass (2026-11-04)

| Item | Change |
|---|---|
| X3 + H3 labels | Fact badges and Source links are no longer inside the text. Each screen has one "Why trust this?" list with every fact used on it (label badge, plain-word label, source and "also" links) and the dates we worked out, each with how. A fact that is not settled keeps a word in the text: UNVERIFIED "(not confirmed)", ASSUMED "(our guess)", PENDING "(not published yet)", INFERRED from a source "(our reading of the rule)". When a fact on the screen is past its review date, one line says so above the buttons. The summary's Sources list keeps every label. |
| H4 + H5 short screens | Result screens show a short text; the old text and bullets moved, unchanged, into `more` ("More details"). Timeline rows have a short `text` and the old text as `detail`. validate, lint and the Sources list read `more`, `detail` and `subtext`. |
| Rewrites | Questions, results, glossary, messages and footer follow REVIEW_UX section 4, with these differences. OUT_WORKING_OK keeps "If your company has 20 or more employees" (conditional, as before). OUT_WIFE_AT_65 says "should sign up … in the 7 months around her 65th birthday month" (not "must"). H1 drops "This step is optional" (the fork already asks). New glossary entries: premium, deductible, copays, network, pays first, HSA, Get Covered NJ. "creditable" opens the creditable-coverage entry. |
| H2 next step | A line at the top shows the first step on the path once the stop-work month is known. To show it after three questions, ACT_ASK_HR_PARTA_OK is now also added by A6, with `when: part_a = no` (it was only ever reached on that path). 20,000 random answer sets give the same set of dated steps as a60900a; only the order of two steps due on the same day can change. |
| H6 summary | "Do these first" (3 steps: overdue, then the earliest key step, then the earliest) comes first, then Print, then folded sections. Printing opens every section. With retire 2027-12 the three are the drug letter, "ask HR" and the Part A window; the Part B filing (November 2027) is fourth. Every action has a `short` text, and 11 are marked `key`. |
| M1, M5, M6, L1, L2 | "Step N · section" with shorter section names. Shorter footer; "Today's date used" only with `?today=`. "Start over" is a button at the top. A few icons, always next to words. Timeline deadlines say "Deadline" in the page. |
| Storage | The health answer (F2) is never stored, even with "Remember my answers" on. |

### UX review, last items (2026-11-04)

| Item | Change |
|---|---|
| Section 6 resume | Saved answers (opt-in) and the tab-only copy store the current screen by id, the day saved and the facts date. On return he lands on that screen; if it is no longer on his path, on the first unanswered question. Income amounts are not stored either way. |
| Section 6 welcome back | On a new visit with saved answers: "Welcome back. You were on step N." with a Start over button. It adds "Some dates passed since your last visit…" when more than 30 days passed or a dated step fell between the two visits, and "The guide was updated…" when the facts date changed. All dates are recomputed; nothing stored is trusted. Messages show in a banner above the screen. |
| H2 next step | Overdue steps come first. Under 20 employees, "Call NJ SHIP this week" shows before the stop-work month. |
| Section 7.1 `partd_sep_effective_date` | Re-opened 42 CFR 423.38(c)(11)(ii) on 2026-11-04. It says the person "may choose an effective date that is not earlier than the first of the month following the month in which the election is made and no later than up to 3 months after". The fact is right as written; the reviewer opened only 423.40. No change. |

### Not done from REVIEW_UX

- **Saving on by default (H7, section 6 items 2 and 6).** Saving across visits stays opt-in, with the "Remember my answers" box. A refresh or Back gesture in the same tab keeps his place without it. Turning it on by default is the owner's privacy call.
- **"Do these first" above one phone screen.** It ends at about 1.17 screens at 390 px (the top bar takes the rest).
- **Primary button within one screen on every result screen.** Most result screens are now 1.1-1.7 screens; the sign-up timeline (8 rows plus the penalty helper) is about 3.5.
- **`**bold**` markup in tree text** (section 5b). Not added.
- **Reading-grade checks.** `review-ux/scripts/readability.mjs` was not re-run against the new `more` field; word counts above come from the browser.

Not done from the review: M1, M3, M4 (partly: only the condition), M9-M13, M19, L2-L8, L11-L12, the full redesign tokens in section 6, and the section 7 watch metadata and source-check script.

## 3. Lint hits accepted (not converted to tokens)

`node scripts/lint-facts.mjs` reports 0 unresolved hits. These remaining hits are allowed on purpose (each is also in the `ALLOW` list in the script):

| Node | Text | Reason |
|---|---|---|
| A7 | `1` ("born on the 1st", in the checkbox label) | restates `medicare_start_month`, linked on the same screen |
| OUT_WORKING_OK | `20` | restates `employer_size_20`, linked on the same screen |
| H1 | `2 years` | restates `irmaa_lookback` ("usually"), linked under More details |
| H2 | `SSA-44` | form name (`ssa44_form`) |
| ACT_HR_EMPLOYEES | `20` (short text) | restates `employer_size_20`, linked in the action |
| OUT_RETIREE_COV, OUT_WIFE_NOT_ON_PLAN, D2, OUT_WIFE_AT_65 | `65` | Medicare age (`medicare_start_month`) |
| D2, OUT_LEAN_MA, G2, OUT_PLAN_G, OUT_PLAN_HDG | `2026` / `2027` | labels which year a linked fact applies to |
| OUT_BRIDGE_GAP, F1 | `1`-`4` | list numbering |
| OUT_WIFE_AT_65 | `20+`, `20` | restates `employer_size_20`, linked in the bullet |
| OUT_WIFE_AT_65, OUT_SIGNUP_TIMELINE, ACT_PARTB_FILE, ACT_SSA44, Q_SSA_44 | `44`, `40` | form names (SSA-44, CMS-40B) |
| OUT_SIGNUP_TIMELINE | `6-month`, `63 days`, `8-month` | restate `medigap_oep`, `partd_penalty`, `partb_sep`, linked in the same row |
| OUT_SIGNUP_HAS_B | `63-day`, `2` (full months) | restate `partd_penalty`, `ma_pd_sep_employer_loss`, linked in the bullet |
| F1 | `$0` | restates `nj_ma_2027_landscape` (UNVERIFIED), linked on the screen |
| F6, OUT_PLAN_HDG | `65` | the age the linked rate chart is for |
| OUT_LEAN_MEDIGAP | `6-month` | restates `medigap_oep`, linked on the screen |
| G3 | `15%` | restates `plan_g_benefits` (linked on G1). Not linked on G3 itself. |
| H2 | `8` | restates `lce_list`, linked on the screen |
| ACT_HR_QUESTIONS, ACT_SHIP_PARTB_ALREADY, ACT_BOOK_SHIP, ACT_PLAN_SHOP, ACT_MEDIGAP_QUOTES | `30 days`, `60 days`, `6 months`, `2-3 months`, `2 months` | the guide's own timing suggestions (match the `date_rule`), not Medicare rules |
| ACT_WIFE_COBRA_ELECT, ACT_WIFE_GCNJ_ENROLL | `60 days` | restate `cobra_basics` / `gcnj_sep_loss`, linked in the action |
| ACT_WIFE_MEDICARE_SIGNUP | `3 months`, `65` | restates `iep_window`, linked in the action |
| Q_HR_COBRA_36, Q_HR_PARTA_ENTITLEMENT | `36-month` | names the `cobra_36_month_rule` for HR to confirm |
| A10, OUT_SMALL_EMPLOYER, OUT_WORKING_OK, ACT_SHIP_NOW | `20` | restates `employer_size_20`, linked on the screen or in the action |
| OUT_ENROLL_PARTA | `18 months` | restates `cobra_36_month_rule`, linked in the bullet |
| OUT_BRIDGE_NONE, OUT_NO_MEDIGAP_WINDOW (title), key_deadlines | `6-month` | restates `medigap_oep` |
| OUT_SIGNUP_HAS_B, OUT_NO_MEDIGAP_WINDOW, ACT_NJ_GI_CONFIRM, key_deadlines | `63 days`, `63-day` | restates `gi_nj_state_extension`, linked on the screen |
| key_deadlines | `8-month` | restates `partb_sep` |
| F6 | `June 2026` | when the linked rate chart was published |
| ACT_ASK_HR_PARTA_OK, ACT_SHIP_DRUG_NOW, ACT_HR_EMPLOYEES, ACT_MEDIGAP_QUOTES_HAS_B, ACT_NJ_GI_CONFIRM | `2 weeks`, `30 days`, `2 months`, `3 months` | the guide's own timing (matches each `date_rule`) |
| ACT_WIFE_PARTB_FILE | `40` | form name (CMS-40B) |
| OUT_WIFE_AT_65 (title) | `65` | Medicare age |

**Lint limit:** regexes find numbers, money, percentages, dates, years and durations. Rule statements without numbers ("pays first", "can't be appealed") are caught only through a short hand-kept phrase list, so a person should still read tree.json copy for unsourced rules.

## 4. Facts to confirm (carried from facts.json; labels unchanged)

- `partb_2027_status` (PENDING), `irmaa_table_2026` and the other 2026 premium facts: replace after the CMS 2027 fact sheet (expected mid-November 2026).
- UNVERIFIED: `partd_limits_2027`, `ma_moop_2027`, `nj_ma_2027_landscape`, `employer_offer_blocks_ptc` (9.96%; the review reports 10.22% for 2027, not yet applied), `plan_n_differences` (excess-charge exclusion).
- `gi_nj_state_extension` (UNVERIFIED-high): the regulation text was read, but the copy shows its last amendment in 2005, and its plan list (A, B, C, F, HD-F, K, L) predates the 2020 closure of C and F. Which plans apply today, including Plan G, is unconfirmed. Ask NJ SHIP or NJ DOBI.
- `ma_trial_right_at_your_age`, `ma_requires_partb` (INFERRED-high): derived from the statute and regulation text, not from a plain-language page.
- A14: whether the plan administrator counts a backdated Part A start as "entitlement" for the 36-month rule (question added for HR).
- `plan_g_benefits` is labeled VERIFIED, but its own note says the plan-by-row mapping is UNVERIFIED-high until a person checks the NJ SHIP PDF chart.
- `cobra_36_month_rule` note: "entitled to Medicare" is assumed to mean the Part A start date. Confirm with the plan administrator.
- `his_coverage_end_assumption` (ASSUMED): confirm the exact coverage end date with HR.

## 5. Sources opened during this build (2026-11-03)

- IRS Publication 969: opened. It states the Medicare / retroactive-coverage HSA rule. It does not state the 6-month backdating itself; that comes from `parta_retro` (Medicare.gov).
- Medicare.gov "Working past 65": opened. It states "stop contributing to your HSA 6 months before you retire".
- Medicare.gov "When does Medicare coverage start?": opened. It states the 7-month Initial Enrollment Period.
- After the review, opened in a browser on 2026-11-03:
  - SSA "Delayed Retirement Credits" (`ss_delayed_credits`: 8%, 2/3 of 1% a month, stops at 70; kept VERIFIED).
  - SSA "Request to lower an IRMAA" (phone 1-800-772-1213) and POMS HI 01120.005 ("optional Form SSA-44"; a request can be made only after the life-changing event). `ssa44_form` was kept VERIFIED.
  - 42 U.S.C. 1395q(e) (Part B start), 1395ss(s)(3)(B) (trial right), and 42 CFR 423.38, 423.40 and 422.50, all on Cornell LII.
  - N.J.A.C. 11:4-23.12 (Cornell LII copy).
  - HealthCare.gov "COBRA coverage when you're unemployed".
  - NJ Treasury "Income or Life Changes".
  - Medicare.gov "Special Enrollment Periods".
- No other facts in facts.json were re-checked against their sources in this build. Their labels are as supplied.

## 6. Not tested

- Real printing (the print stylesheet was not checked on paper or as a PDF).
- A true `file://` open in a desktop browser. The browser pane opened the built file as a `data:` snapshot, which ran correctly, but the `?today=` hook can't be passed that way.
- Screen readers (NVDA, VoiceOver). Keyboard-only use and a 512 px-wide viewport (= 200% zoom at 1024 px) were tested in the browser pane.
- Browsers other than the Chromium-based browser pane.
- Phone hardware (only narrow-viewport emulation).
- After the review fixes, these were walked in the browser: the likely path (stop working 2027-12, test birth date 1964-10-10) and the Part B-held path (Part B since 2025-03, stop working 2028-06), at desktop size and 390 px wide. Also checked: the IRMAA cards at 390 px and the "Clear" confirm. Print output was not checked.
