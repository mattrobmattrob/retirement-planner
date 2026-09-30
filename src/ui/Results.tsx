import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { LedgerRow, ScenarioResult } from '../engine/simulate';
import { SS_TAX_THRESHOLDS } from '../model/ssTax';
import { money, moneyCompact, monthName, pct, runway } from './format';
import { HoverDetail } from './HoverDetail';
import { Legend, LineChart, type ChartSeries } from './LineChart';

export const seriesColor = (slot: number) => `var(--series-${(slot % 8) + 1})`;

interface Props {
  results: ScenarioResult[];
  horizonYears: number;
  startDate: string;
  /** Rendered between the charts and the ledger. */
  extra?: ComponentChildren;
}

function best<T>(items: T[], score: (t: T) => number): T | undefined {
  return items.reduce<T | undefined>((a, b) => (a === undefined || score(b) > score(a) ? b : a), undefined);
}

export function Results({ results, horizonYears, startDate, extra }: Props) {
  const [realDollars, setRealDollars] = useState(true);
  const [focusId, setFocusId] = useState<string>('');
  const [ledgerId, setLedgerId] = useState<string>('');
  if (results.length === 0) return null;

  const focus = results.find((r) => r.scenarioId === focusId) ?? results[0];
  const ledgerScenario = results.find((r) => r.scenarioId === ledgerId) ?? results[0];
  const years = results[0].snapshotYears.map((y) => (y === null ? 'Today' : String(y)));
  const xTitles = results[0].snapshotYears.map((y) => (y === null ? `Today (${monthName(startDate)})` : `End of ${y}`));
  const ages = results[0].ages;
  const xContext = (i: number) => ages.map((a) => `${a.name} ${Math.floor(a.values[i])}`).join(' · ');
  const legend = results.map((r) => ({ key: r.scenarioId, label: r.name, color: seriesColor(r.colorSlot) }));
  const runwayScore = (r: ScenarioResult) => r.runwayP10Years ?? Infinity;

  const bestSuccess = best(results, (r) => r.successRate);
  const bestRunway = best(results, runwayScore);
  const bestEnding = best(results, (r) => r.medianEndingReal);
  const bestP10 = best(results, (r) => r.p10EndingReal);
  const mark = (winner: ScenarioResult | undefined, r: ScenarioResult) => (results.length > 1 && winner === r ? 'is-best' : '');

  const fundedSeries: ChartSeries[] = results.map((r) => ({
    key: r.scenarioId,
    label: r.name,
    color: seriesColor(r.colorSlot),
    values: r.fundedPct,
  }));

  const pick = (r: ScenarioResult) => (realDollars ? r.liquidReal : r.liquidNominal);
  const balanceSeries: ChartSeries[] = results.map((r) => ({
    key: r.scenarioId,
    label: `${r.name} (median)`,
    color: seriesColor(r.colorSlot),
    values: pick(r)[50],
    bands:
      r === focus
        ? [
            { lo: pick(r)[10], hi: pick(r)[90], opacity: 0.12, label: '10th–90th percentile' },
            { lo: pick(r)[25], hi: pick(r)[75], opacity: 0.2, label: '25th–75th percentile' },
          ]
        : undefined,
  }));

  const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.name}: ${w}`));

  return (
    <div class="results">
      {warnings.length > 0 && (
        <ul class="warnings" role="status">
          {warnings.map((w) => (
            <li key={w}>⚠︎ {w}</li>
          ))}
        </ul>
      )}

      <section class="card">
        <h2>Scenario comparison</h2>
        <div class="table-wrap">
          <table class="summary">
            <thead>
              <tr>
                <th>Scenario</th>
                <th title="Share of simulations where savings covered every expense for as long as anyone was alive (within the plan horizon).">Success</th>
                <th title="90% of simulations still have savings until at least this year (and this long from today).">Runway (90%)</th>
                <th title="Half of simulations still have savings until at least this year.">Runway (median)</th>
                <th title="Median savings at the end of the plan, in today's dollars.">Median ending</th>
                <th title="In a bad-luck case (10th percentile), savings at the end, in today's dollars.">Poor-market ending</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.scenarioId}>
                  <td>
                    <span class="swatch" style={{ background: seriesColor(r.colorSlot) }} />
                    {r.name}
                  </td>
                  <td class={mark(bestSuccess, r)}>{pct(r.successRate)}</td>
                  <td class={mark(bestRunway, r)}>{runway(r.runwayP10Years, startDate)}</td>
                  <td>{runway(r.runwayP50Years, startDate)}</td>
                  <td class={mark(bestEnding, r)}>{moneyCompact(r.medianEndingReal)}</td>
                  <td class={mark(bestP10, r)}>{moneyCompact(r.p10EndingReal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="footnote">
          {results[0].runs.toLocaleString()} simulations per scenario. Bold marks the best value in each column. "Runway (90%)" is how long savings last in all but the unluckiest 10% of markets; "Never runs out" means savings outlast everyone (or the plan, through {+startDate.slice(0, 4) + horizonYears}).
        </p>
      </section>

      <section class="card">
        <h2>Chance savings last</h2>
        <p class="card__sub">Share of simulations that still have money at the end of each year.</p>
        <Legend items={legend} />
        <LineChart
          series={fundedSeries}
          xLabels={years}
          xTitles={xTitles}
          xContext={xContext}
          yFormat={(v) => pct(v)}
          yMin={0}
          yMax={100}
          ariaLabel="Percent of simulations with savings remaining, by year, for each scenario"
        />
      </section>

      <section class="card">
        <div class="card__head">
          <h2>Savings over time</h2>
          <div class="controls">
            <label class="field field--inline">
              <span class="field__label">Range for</span>
              <select value={focus.scenarioId} onChange={(e) => setFocusId((e.target as HTMLSelectElement).value)}>
                {results.map((r) => (
                  <option key={r.scenarioId} value={r.scenarioId}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <div class="segmented" role="group" aria-label="Dollar basis">
              <button type="button" aria-pressed={realDollars} onClick={() => setRealDollars(true)}>
                Today’s $
              </button>
              <button type="button" aria-pressed={!realDollars} onClick={() => setRealDollars(false)}>
                Future $
              </button>
            </div>
          </div>
        </div>
        <p class="card__sub">
          Liquid savings across all accounts. Lines are medians; shading shows the range of outcomes for the selected scenario.
        </p>
        <Legend items={legend} />
        <LineChart series={balanceSeries} xLabels={years} xTitles={xTitles} xContext={xContext} yFormat={moneyCompact} yMin={0} ariaLabel="Median savings by year for each scenario" />
      </section>

      {extra}

      <section class="card">
        <div class="card__head">
          <h2>Year-by-year (expected returns)</h2>
          <label class="field field--inline">
            <span class="field__label">Scenario</span>
            <select value={ledgerScenario.scenarioId} onChange={(e) => setLedgerId((e.target as HTMLSelectElement).value)}>
              {results.map((r) => (
                <option key={r.scenarioId} value={r.scenarioId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p class="card__sub">
          A single path where markets return exactly their averages and everyone lives to their life expectancy. Calendar (tax) years, future (nominal) dollars. Hover or tap an underlined value for how it was worked out.
        </p>
        <div class="table-wrap ledger-wrap">
          <table class="ledger">
            <thead>
              <tr>
                <th>Year</th>
                <th>Ages</th>
                <th>Income</th>
                <th>Social Security</th>
                <th title="Share and dollars of Social Security subject to income tax that year. Under the IRS rule the share can be anything from 0% to 85% — 50% and 85% are the caps of its two tiers.">SS taxable (0–85%)</th>
                <th>Expenses</th>
                <th>Debt payments</th>
                <th>Taxes</th>
                <th>Withdrawals</th>
                <th>Savings at end</th>
                <th>Debt at end</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              {ledgerScenario.ledger.map((row) => (
                <tr key={row.year}>
                  <td>{yearLabel(row)}</td>
                  <td>{row.ages.join(' / ')}</td>
                  <td>{money(row.income)}</td>
                  <td>{money(row.socialSecurity)}</td>
                  <td class="ledger__ss-tax">
                    {row.ssDetail ? (
                      <HoverDetail lines={ssTaxExplanation(row)}>
                        {pct(row.ssTaxablePct)} <span class="muted">· {money(row.ssTaxable)}</span>
                        {row.ssDetail.basis === 'assumed' && <span class="muted"> (assumed)</span>}
                      </HoverDetail>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{money(row.expenses)}</td>
                  <td>{money(row.debtPayments)}</td>
                  <td>
                    {row.settlementPaid !== 0 ? (
                      <HoverDetail
                        lines={[
                          `${row.year} taxes: ${money(row.taxes)}`,
                          `Includes ${money(Math.abs(row.settlementPaid))} ${row.settlementPaid > 0 ? 'owed' : 'refunded'} in April for ${row.year - 1} Social Security tax (true-up of the estimate).`,
                        ]}
                      >
                        {money(row.taxes)}
                      </HoverDetail>
                    ) : (
                      money(row.taxes)
                    )}
                  </td>
                  <td>{money(row.withdrawals)}</td>
                  <td class={row.endLiquid <= 1 ? 'is-bad' : ''}>{money(row.endLiquid)}</td>
                  <td>{money(row.endDebt)}</td>
                  <td class="ledger__events">{row.events.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function yearLabel(row: LedgerRow): string {
  const first = +row.firstMonth.slice(5, 7);
  const last = +row.lastMonth.slice(5, 7);
  return first === 1 && last === 12 ? String(row.year) : `${row.year} (${MONTHS[first - 1]}–${MONTHS[last - 1]})`;
}

/** Plain-language walk through the IRS worksheet for one ledger row. */
function ssTaxExplanation(row: LedgerRow): string[] {
  const d = row.ssDetail!;
  const status = d.joint ? 'married filing jointly' : 'single';
  const lines = [`${row.year} · ${status}`, `Benefits: ${money(d.benefits)}`];
  if (d.basis === 'flat') {
    lines.push(`Flat ${pct(row.ssTaxablePct)} taxable (Assumptions tab): ${money(d.taxable)}`);
    return lines;
  }
  if (d.basis === 'assumed') {
    lines.push(
      `Assumed ${pct(row.ssTaxablePct)} taxable = ${money(d.taxable)} (Assumptions tab)`,
      'The rest of the first year and the following year use the assumed share without a true-up; the IRS rule applies after that.',
    );
    return lines;
  }
  const t = d.joint ? SS_TAX_THRESHOLDS.joint : SS_TAX_THRESHOLDS.single;
  const tierText = d.tier === 0 ? 'below the first threshold → none taxable' : d.tier === 50 ? 'first tier → up to 50% taxable' : 'second tier → up to 85% taxable';
  lines.push(
    `Other taxable income: ${money(d.otherIncome)} (taxable income + pre-tax withdrawals + ½ of brokerage withdrawals)`,
    `Provisional income: ${money(d.provisionalIncome)} (other income + ½ of benefits)`,
    `Thresholds ${money(t.base)} / ${money(t.adjusted)}: ${tierText}`,
    `Taxable: ${money(d.taxable)} = ${pct(row.ssTaxablePct)} of benefits`,
    `Withheld during the year on an estimate of ${money(d.estimatedTaxable)} taxable`,
    d.settlement === 0
      ? 'No true-up needed'
      : `True-up: ${money(Math.abs(d.settlement))} ${d.settlement > 0 ? 'owed' : 'refunded'} in April ${row.year + 1}`,
  );
  return lines;
}
