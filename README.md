# Retirement Planner

A static, client-side retirement planner that runs Monte Carlo simulations in the browser
and compares scenarios (A vs. B vs. C…) by how long savings last.

Nothing leaves the browser: plans autosave to `localStorage` and can be downloaded/loaded as JSON.

## How it's organized

Describe the household **once**, then give any item alternatives ("options"). A **scenario**
is one option picked per item, so comparing "lump sum vs. monthly severance" or "pay off the
mortgage vs. keep paying" never means re-entering the whole plan.

- **People & Social Security**: birth month, life expectancy, and the benefit from the SSA
  statement as "$X/mo if claiming at age Y". Claim-age options (year + month) are derived with
  SSA's early-reduction and delayed-credit rules, or can be overridden. Survivors get the larger benefit.
- **Accounts**: cash, taxable brokerage, pre-tax IRA/401(k), Roth, HSA — each with a stock/bond
  mix, withdrawal order, and one or more starting-balance options. Withdrawals are grossed up for tax.
- **Loans**: balance, rate, payment; options for "keep paying" vs. "pay off from savings in month X".
- **Expenses**: monthly, annual, or one-time, with **phases** — "$850/mo until Person A turns 65,
  then $380/mo" — triggered by a date or a person's age. An expense with an owner stops at their death.
- **Income & events**: monthly payments (with a number of payments), lump sums, or death benefits
  (life insurance), each with an owner and a survivorship %. Severance "lump sum vs. monthly × N"
  is just several options on one item. Any item can have a "Not included" option.
- **Scenarios tab**: a grid of decisions × scenarios, plus "every combination" (up to 8).
- **Social Security claiming solver**: for a chosen scenario, tries every claim age 62–70 for
  each person (whole years, then month by month around the best) against the same market paths,
  and shows a heatmap. The best pair can be added as a new scenario in one click.
- **Results**: success rate, 90% / median runway, ending balances, "chance savings last" curve,
  percentile fan chart (today's or future dollars), and a year-by-year expected-returns ledger.
- **Mortality**: fixed at life expectancy, or random (Gompertz, calibrated so the mean age at
  death equals the life expectancy you enter).

## Model notes

- Monthly steps. Stock and bond returns are correlated log-normal draws matching the annual mean
  and volatility you enter; inflation is drawn monthly; cash earns a fixed yield.
- All scenarios replay the same random market paths (common random numbers), so differences come
  from the plan, not luck.
- Monthly surpluses go to the chosen surplus account; shortfalls are withdrawn in withdrawal order.
  A run "fails" if spending can't be covered while anyone is alive.
- Taxes are effective flat rates (ordinary income, brokerage withdrawals, taxable share of Social
  Security). RMDs, IRMAA, contribution limits, spousal benefits, and brackets are not modeled.
- This is a planning aid, not financial advice.

## Plan file format

`Download plan` writes JSON (`"format": "retirement-planner", "version": 2`) with `settings`,
`household` (items and their options) and `scenarios` (one chosen option id per item).
`Load plan…` accepts it back; version 1 files are migrated automatically (same-named items across
old scenarios are merged into options). See `src/model/types.ts` for the schema.

## Development

```sh
npm install
npm run dev       # local dev server
npm test          # engine unit tests (Vitest)
npm run build     # type-check + static build into dist/
npm run preview   # serve dist/
```

Source layout:

- `src/model` — plan types, example plan, JSON import/migration, Social Security rules, and
  `resolve.ts` (turns a scenario's picks into the engine's flat input)
- `src/engine` — seeded RNG, mortality, simulation, claiming solver, Web Worker entry
- `src/ui` — Preact components and SVG charts

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds, and publishes `dist/` on every push to `main`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Asset paths are relative (`base: './'`), so the site works at
`https://<user>.github.io/<repo>/` or on a custom domain without changes.
