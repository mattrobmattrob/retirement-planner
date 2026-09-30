import type { MarketAssumptions, SimulationSettings, TaxAssumptions } from '../model/types';
import { MonthField, NumField, SelectField } from './fields';

export function MarketFields(props: { market: MarketAssumptions; onChange: (m: MarketAssumptions) => void }) {
  const { market: m, onChange } = props;
  const set = (patch: Partial<MarketAssumptions>) => onChange({ ...m, ...patch });
  return (
    <div class="grid">
      <NumField label="Stock return" hint="Expected average annual nominal return." value={m.stockReturn} suffix="%" onChange={(stockReturn) => set({ stockReturn })} />
      <NumField label="Stock volatility" hint="Annual standard deviation. ~15–20% is typical for a US stock index; 0 = no randomness." value={m.stockStdev} suffix="%" min={0} onChange={(stockStdev) => set({ stockStdev })} />
      <NumField label="Bond return" value={m.bondReturn} suffix="%" onChange={(bondReturn) => set({ bondReturn })} />
      <NumField label="Bond volatility" value={m.bondStdev} suffix="%" min={0} onChange={(bondStdev) => set({ bondStdev })} />
      <NumField label="Stock/bond correlation" value={m.correlation} min={-1} max={1} onChange={(correlation) => set({ correlation })} />
      <NumField label="Cash yield" value={m.cashReturn} suffix="%" onChange={(cashReturn) => set({ cashReturn })} />
      <NumField label="Inflation" value={m.inflation} suffix="%" onChange={(inflation) => set({ inflation })} />
      <NumField label="Inflation volatility" value={m.inflationStdev} suffix="%" min={0} onChange={(inflationStdev) => set({ inflationStdev })} />
    </div>
  );
}

export function SettingsPanel(props: {
  settings: SimulationSettings;
  onChange: (s: SimulationSettings) => void;
  taxes: TaxAssumptions;
  onTaxesChange: (t: TaxAssumptions) => void;
}) {
  const { settings: s, onChange, taxes, onTaxesChange } = props;
  const setTax = (patch: Partial<TaxAssumptions>) => onTaxesChange({ ...taxes, ...patch });
  const set = (patch: Partial<SimulationSettings>) => onChange({ ...s, ...patch });
  return (
    <div class="editor">
      <details class="section" open>
        <summary>
          <span class="section__title">Simulation</span>
          <span class="section__summary">
            {s.runs.toLocaleString()} runs · {s.horizonYears} yrs
          </span>
        </summary>
        <p class="section__desc">Applies to every scenario. All scenarios replay the same random market paths, so differences come from the plan, not luck.</p>
        <div class="section__body grid">
          <MonthField label="Plan starts" value={s.startDate} onChange={(startDate) => set({ startDate })} />
          <NumField label="Years to simulate" value={s.horizonYears} suffix="yrs" min={1} max={80} onChange={(horizonYears) => set({ horizonYears: Math.round(horizonYears) })} />
          <NumField label="Simulations" hint="More runs = smoother results but slower. 1,000–5,000 is plenty." value={s.runs} min={1} max={50000} onChange={(runs) => set({ runs: Math.round(runs) })} />
          <NumField label="Random seed" hint="Same seed = same results. Change it to check the results are stable." value={s.seed} onChange={(seed) => set({ seed: Math.round(seed) })} />
          <SelectField
            label="Mortality"
            hint="Fixed: everyone dies at their life expectancy. Random: age at death varies per simulation (Gompertz model), so survivorship options matter."
            value={s.mortality}
            options={[
              { value: 'fixed', label: 'Fixed at life expectancy' },
              { value: 'stochastic', label: 'Random (life-table shaped)' },
            ]}
            onChange={(mortality) => set({ mortality })}
          />
        </div>
      </details>
      <details class="section" open>
        <summary>
          <span class="section__title">Market assumptions</span>
          <span class="section__summary">
            {s.market.stockReturn}% stocks · {s.market.bondReturn}% bonds · {s.market.inflation}% inflation
          </span>
        </summary>
        <p class="section__desc">Nominal annual figures. Invested accounts earn a monthly-rebalanced stock/bond mix; returns are drawn from a log-normal distribution each month.</p>
        <div class="section__body">
          <MarketFields market={s.market} onChange={(market) => set({ market })} />
        </div>
      </details>
      <details class="section" open>
        <summary>
          <span class="section__title">Taxes</span>
          <span class="section__summary">
            {taxes.ordinaryRate}% ordinary · {taxes.taxableWithdrawalRate}% brokerage
          </span>
        </summary>
        <p class="section__desc">Effective (average) rates. Roth, HSA and cash withdrawals are tax-free. The year-by-year table shows the share of Social Security taxed each year.</p>
        <div class="section__body grid">
          <NumField label="Ordinary income tax" hint="Effective rate on taxable income and pre-tax IRA/401(k) withdrawals." value={taxes.ordinaryRate} suffix="%" min={0} max={95} onChange={(ordinaryRate) => setTax({ ordinaryRate })} />
          <NumField label="Brokerage withdrawals" hint="Effective tax per dollar withdrawn from a taxable account (capital gains on the gain portion)." value={taxes.taxableWithdrawalRate} suffix="%" min={0} max={95} onChange={(taxableWithdrawalRate) => setTax({ taxableWithdrawalRate })} />
          <SelectField
            label="Social Security taxation"
            hint="IRS rule: from plan year 3, the taxable share (0%, up to 50%, or up to 85%) follows the prior year's simulated provisional income — taxable income, pre-tax withdrawals, half of brokerage withdrawals as gains, plus half of benefits — against the fixed $32K/$44K joint ($25K/$34K single) thresholds."
            value={taxes.ssTaxRule}
            options={[
              { value: 'irs', label: 'IRS 0/50/85% rule' },
              { value: 'flat', label: 'Flat taxable share' },
            ]}
            onChange={(ssTaxRule) => setTax({ ssTaxRule })}
          />
          <NumField
            label={taxes.ssTaxRule === 'irs' ? 'Taxable share, years 1–2' : 'Taxable share of SS'}
            hint={taxes.ssTaxRule === 'irs' ? 'Assumed until the simulation has a prior year of income to apply the IRS rule to.' : undefined}
            value={taxes.ssTaxablePct}
            suffix="%"
            min={0}
            max={100}
            onChange={(ssTaxablePct) => setTax({ ssTaxablePct })}
          />
        </div>
      </details>
    </div>
  );
}
