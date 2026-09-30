import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS color (usually a `var(--series-n)`). */
  color: string;
  values: number[];
  /** Optional shaded ranges drawn under the line, outermost first. */
  bands?: { lo: number[]; hi: number[]; opacity: number; label: string }[];
}

interface Props {
  series: ChartSeries[];
  xLabels: string[];
  /** Tooltip heading per x (defaults to the axis label). */
  xTitles?: string[];
  /** Extra per-x context lines for the tooltip (e.g. ages). */
  xContext?: (i: number) => string;
  yFormat: (v: number) => string;
  yMin?: number;
  yMax?: number;
  height?: number;
  ariaLabel: string;
}

const PAD = { top: 12, right: 16, bottom: 28, left: 64 };

function niceTicks(min: number, max: number, count = 5): number[] {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  const top = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.ceil(min / step) * step; v <= top + step * 1e-9; v += step) ticks.push(v);
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(Math.max(280, ref.current.clientWidth));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LineChart({ series, xLabels, xTitles, xContext, yFormat, yMin, yMax, height = 280, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = xLabels.length;
  const all = series.flatMap((s) => [...s.values, ...(s.bands?.flatMap((b) => b.hi) ?? [])]);
  const lo = yMin ?? Math.min(0, ...all);
  const hiRaw = yMax ?? Math.max(1, ...all);
  const ticks = niceTicks(lo, hiRaw);
  const hi = yMax ?? ticks[ticks.length - 1];

  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => PAD.top + h - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * h;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = (a: number[], b: number[]) =>
    `${path(b)}${a
      .map((_, k) => a.length - 1 - k)
      .map((i) => `L${x(i).toFixed(1)},${y(a[i]).toFixed(1)}`)
      .join('')}Z`;

  const xStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));
  const onMove = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - PAD.left) / w) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const tooltipLeft = hover === null ? 0 : x(hover);
  const flip = tooltipLeft > width * 0.6;

  return (
    <div class="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line class="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text class="chart__tick" x={PAD.left - 8} y={y(t)} text-anchor="end" dominant-baseline="middle">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xLabels.map((label, i) =>
          i % xStep === 0 ? (
            <text key={i} class="chart__tick" x={x(i)} y={height - 8} text-anchor="middle">
              {label}
            </text>
          ) : null,
        )}
        <line class="chart__axis" x1={PAD.left} x2={width - PAD.right} y1={y(lo)} y2={y(lo)} />
        {series.map((s) =>
          s.bands?.map((b, k) => <path key={`${s.key}-b${k}`} d={area(b.lo, b.hi)} fill={s.color} fill-opacity={b.opacity} stroke="none" />),
        )}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" />
        ))}
        {hover !== null && (
          <g>
            <line class="chart__crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h} />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill={s.color} class="chart__dot" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div class="tooltip" style={{ left: `${tooltipLeft}px`, transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
          <div class="tooltip__title">{xTitles?.[hover] ?? xLabels[hover]}</div>
          {xContext && <div class="tooltip__context">{xContext(hover)}</div>}
          {[...series]
            .sort((a, b) => b.values[hover] - a.values[hover])
            .map((s) => (
              <div class="tooltip__row" key={s.key}>
                <span class="swatch" style={{ background: s.color }} />
                <span class="tooltip__label">{s.label}</span>
                <span class="tooltip__value">{yFormat(s.values[hover])}</span>
              </div>
            ))}
          {series
            .filter((s) => s.bands?.length)
            .map((s) =>
              s.bands!.map((b) => (
                <div class="tooltip__row tooltip__row--muted" key={`${s.key}-${b.label}`}>
                  <span class="swatch swatch--band" style={{ background: s.color, opacity: b.opacity * 2.5 }} />
                  <span class="tooltip__label">{b.label}</span>
                  <span class="tooltip__value">
                    {yFormat(b.lo[hover])} – {yFormat(b.hi[hover])}
                  </span>
                </div>
              )),
            )}
        </div>
      )}
    </div>
  );
}

export function Legend(props: { items: { key: string; label: string; color: string }[] }) {
  return (
    <ul class="legend">
      {props.items.map((it) => (
        <li key={it.key}>
          <span class="swatch" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
