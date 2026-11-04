# NJ Medicare Decision Guide (unofficial)

A single-page guide for a New Jersey worker near retirement who is already past 65 and covered by a 20+ employee job plan. It asks plain-English questions one at a time and ends with:

- which Medicare path fits (Medigap or Medicare Advantage, and which Medigap plan),
- a dated to-do list,
- the spouse's coverage bridge until her own Medicare starts,
- questions to ask HR, Social Security and NJ SHIP.

Each screen lists every fact it uses under "Why trust this?", with its label (VERIFIED / UNVERIFIED / INFERRED / ASSUMED / PENDING) and a link to its source. A fact that is not settled also says so in the text: "(not confirmed)", "(our guess)", "(not published yet)" or "(our reading of the rule)". The summary prints every source with its label.

**Unofficial.** Not Medicare, CMS or Social Security. Not legal, tax or financial advice. Confirm with NJ SHIP (free counseling).

## How it works

- `index.html` is the whole app: one file, no network calls (except source links you click), no frameworks, no CDN, no fonts, no analytics. It works opened from disk or from a GitHub Pages subpath.
- Nothing you enter leaves the device. While the tab is open, a refresh or the Back gesture keeps your place: answers are kept in this tab only (not the health answer or income amounts) and the browser deletes them when the tab closes. Saving across visits is off by default; the "Remember my answers on this device" box saves them in this browser only. "Clear my answers" deletes both and turns saving off.
- Source files:
  - `src/engine.js`: dates, computed values, scoring, calculators (pure, no DOM)
  - `src/interpreter.js`: conditions, routing, `{{ }}` tokens, actions and questions (pure, no DOM)
  - `src/app.js`, `src/template.html`, `src/style.css`: the page
  - `src/data/facts.json`: every fact, label and source
  - `src/data/tree.json`: questions, routing and outcomes
  - `docs/SPEC.md`: the build spec

## Commands

Requires Node.js 22 or newer (uses the built-in test runner). There are no npm dependencies.

```bash
npm test
```

Runs every test, including SPEC test cases T1-T14. Tests that check exact amounts read a frozen copy of the facts (`tests/fixtures/facts-2026-11-03.json`), so updating `src/data/facts.json` doesn't break them. Other tests check the shipped data for structure only (contiguous IRMAA brackets, a source on every VERIFIED fact, no gaps in yearly facts).

```bash
npm run build
```

Writes `index.html` from `src/`.

```bash
node scripts/validate.mjs
```

T14: checks that every reference resolves, every node is reachable, and every fact has a source.

```bash
node scripts/lint-facts.mjs
```

Finds numbers, dates and rules typed into tree.json text instead of linked facts.

## The `?today=` test hook

Add `?today=YYYY-MM-DD` to the page address to pretend it is that date. For example, `index.html?today=2026-11-21` shows the "may be out of date" warnings. It changes only "today" (staleness checks, date-relative actions, and the Part A start projected for a sign-up this month). It never changes any fact.

## Updating facts

To update a number, edit only `src/data/facts.json`: the fact's `value`, `effective`, `source` and `review_after`. For a new year, add a new fact (for example `partb_premium_2027`) instead of overwriting the old one. Screens that use `{{fig:partb_premium}}` pick the right year and label older figures as placeholders. The page does not need code changes. Then:

```bash
npm test
```

```bash
npm run build
```

Commit and push `src/data/facts.json` and `index.html`. GitHub Pages republishes automatically.

Re-verify every fact with a `review_after` date each November after CMS publishes next-year figures, and each August after NJ DOBI announces Get Covered NJ dates.

### After CMS publishes the 2027 figures (expected mid-November 2026)

Re-verify or add these:

- `partb_2027_status`: replace with the official 2027 Part B premium and deductible.
- Add `partb_premium_2027` and `partb_deductible_2027` (same shape as the 2026 facts). The penalty helper and Medigap comparison pick them up automatically.
- Add `irmaa_table_2027` with the same shape as `irmaa_table_2026`. The IRMAA calculator selects tables by premium year. Years without a table use the latest earlier table and are labeled placeholders.
- `irmaa_table_2026`, `irmaa_tier_steps`, `partb_premium_2026`, `partb_deductible_2026`, `parta_deductible_2026`: check that they are unchanged.
- `partd_limits_2027`, `ma_moop_2027`: upgrade from UNVERIFIED only after reading the CMS source.
- `nj_ma_2027_landscape`, `federal_ptc_400_cliff`, `nj_medigap_rates_jun2026`: recheck by their `review_after` dates.

Until then, most 2026 facts show "may be out of date" after November 20, 2026. That is intended.

See `NEEDS_REVIEW.md` for every assumption and open question.
