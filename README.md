# Retirement Planner

A static, client-side retirement planner that runs Monte Carlo simulations in the browser
and compares scenarios (A vs. B vs. C…) by how long savings last.

Nothing leaves the browser: plans autosave to `localStorage` and can be downloaded/loaded as JSON.

## Features

- **People** with birth month, life expectancy, Social Security claim age and benefit
  (survivor gets the larger benefit after a death).
- **Accounts**: cash, taxable brokerage, traditional IRA/401(k), Roth, HSA — each with a
  stock/bond mix and a withdrawal order. Withdrawals are grossed up for tax.
- **Loans** (mortgage, hot tub, car…) with rate, payment, and optional early payoff month.
- **Expenses**: monthly, annual, or one-time, with optional start/end months and inflation.
- **Income & events**: monthly payments, lump sums (e.g. severance), or death benefits
  (life insurance), with an owner and a survivorship % that applies after the owner dies.
- **Scenarios**: duplicate, edit, reorder; every scenario replays the same random market
  paths (common random numbers) so differences come from the plan, not luck.
- **Results**: success rate, 90% / median runway, ending balances, "chance savings last"
  curve, percentile fan chart (today's or future dollars), and a year-by-year ledger on an
  expected-returns path.
- **Mortality**: fixed at life expectancy, or random (Gompertz, calibrated so the mean age
  at death equals the life expectancy you enter).

## Model notes

- Monthly steps. Stock and bond returns are correlated log-normal draws matching the
  annual mean and volatility you enter; inflation is drawn monthly; cash earns a fixed yield.
- Monthly surpluses go to the chosen surplus account; shortfalls are withdrawn in
  withdrawal order. A run "fails" if spending can't be covered while anyone is alive.
- Taxes are effective flat rates (ordinary income, taxable-account withdrawals, taxable
  share of Social Security). RMDs, IRMAA, contribution limits, and tax brackets are not modeled.
- This is a planning aid, not financial advice.

## Plan file format

`Download plan` writes a JSON file (`"format": "retirement-planner", "version": 1`) with
`settings` and `scenarios`. `Load plan…` accepts it back; missing fields fall back to defaults.
See `src/model/types.ts` for the schema.

## Development

```sh
npm install
npm run dev       # local dev server
npm test          # engine unit tests (Vitest)
npm run build     # type-check + static build into dist/
npm run preview   # serve dist/
```

Source layout:

- `src/model` — types, defaults and example plan, JSON import normalization
- `src/engine` — seeded RNG, mortality, simulation, Web Worker entry
- `src/ui` — Preact components and SVG charts

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds, and publishes `dist/` on every push to `main`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Asset paths are relative (`base: './'`), so the site works at
`https://<user>.github.io/<repo>/` or on a custom domain without changes.
