import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { area, arc, curveMonotoneX, line, pie } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import type { AreaChartProps, DonutChartProps, SparklineProps } from '@ficoim/screens';

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#f43f5e', '#14b8a6'];
const H = 200, M = { top: 18, right: 10, bottom: 26, left: 10 };

/** Lebar elemen (px) yang ikut berubah saat ukuran jendela/wadah berubah. */
function useWidth(initial = 340): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(200, Math.round(el.clientWidth || initial)));
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, w];
}

/** Grafik area halus (monotone) dengan 1–2 deret, garis bantu, titik hari terakhir, dan tooltip saat disentuh/diarahkan. */
export function AreaChartWeb({ points, format, formatAxis, seriesLabel = 'Penjualan', series2Label = 'Laba kotor', testID }: AreaChartProps) {
  const [ref, W] = useWidth();
  const uid = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const geo = useMemo(() => {
    const max = Math.max(1, ...points.flatMap((p) => [p.value, p.value2 ?? 0]));
    const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range([M.left + 6, W - M.right - 6]);
    const y = scaleLinear().domain([0, max * 1.18]).nice(3).range([H - M.bottom, M.top]);
    const mk = (get: (p: (typeof points)[number]) => number) => line<(typeof points)[number]>().x((_, i) => x(i)).y((p) => y(get(p))).curve(curveMonotoneX)(points) ?? '';
    const fill = area<(typeof points)[number]>().x((_, i) => x(i)).y0(y(0)).y1((p) => y(p.value)).curve(curveMonotoneX)(points) ?? '';
    return { x, y, l1: mk((p) => p.value), l2: points.some((p) => p.value2 !== undefined) ? mk((p) => p.value2 ?? 0) : null, fill, ticks: y.ticks(3).filter((t) => t > 0) };
  }, [points, W, n]);
  const step = Math.ceil(n / 7);
  const idx = active ?? n - 1;
  const p = points[idx];
  const px = geo.x(idx);
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = geo.x.invert(((e.clientX - r.left) / r.width) * W);
    setActive(Math.min(n - 1, Math.max(0, Math.round(v))));
  };
  if (n === 0) return null;
  const tipLeft = Math.min(W - 168, Math.max(4, px - 70));
  return (
    <div ref={ref} className="ch-wrap" data-testid={testID}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${seriesLabel}: ${points.map((q) => `${q.label} ${format(q.value)}`).join(', ')}`}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setActive(null)} style={{ touchAction: 'pan-y' }}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.38" /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}><line x1={M.left} x2={W - M.right} y1={geo.y(t)} y2={geo.y(t)} className="ch-grid" /><text x={M.left + 2} y={geo.y(t) - 4} className="ch-axis">{(formatAxis ?? format)(t)}</text></g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={geo.y(0)} y2={geo.y(0)} className="ch-grid ch-base" />
        <path d={geo.fill} fill={`url(#g${uid})`} className="ch-area" />
        {geo.l2 ? <path d={geo.l2} className="ch-line ch-line2" pathLength={1} fill="none" /> : null}
        <path d={geo.l1} className="ch-line" pathLength={1} fill="none" />
        {points.map((q, i) => ((i % step === 0 && (n - 1 - i >= step || i === n - 1)) || i === n - 1) ? <text key={i} x={geo.x(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className={`ch-axis ${i === idx ? 'ch-axis-on' : ''}`}>{q.label}</text> : null)}
        {active !== null ? <line x1={px} x2={px} y1={M.top - 4} y2={geo.y(0)} className="ch-guide" /> : null}
        {geo.l2 && p?.value2 !== undefined ? <circle cx={px} cy={geo.y(p.value2)} r={4} className="ch-dot ch-dot2" /> : null}
        {p ? <circle cx={px} cy={geo.y(p.value)} r={5} className={`ch-dot ${active === null ? 'ch-pulse' : ''}`} /> : null}
      </svg>
      {p && active !== null ? (
        <div className="ch-tip" style={{ left: tipLeft }} data-testid="chart-tip">
          <b>{p.label}</b>
          <span><i className="ch-sw" style={{ background: 'var(--chart-1)' }} />{seriesLabel} {format(p.value)}</span>
          {p.value2 !== undefined ? <span><i className="ch-sw" style={{ background: 'var(--chart-2)' }} />{series2Label} {format(p.value2)}</span> : null}
          {p.hint ? <em>{p.hint}</em> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Donat dengan celah antar-irisan, sorotan saat diarahkan/diketuk, dan legenda berpersen. */
export function DonutChartWeb({ slices, centerLabel, format, testID }: DonutChartProps) {
  const [sel, setSel] = useState<number | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 84, r = 58;
  const arcs = useMemo(() => pie<(typeof slices)[number]>().sort(null).value((s) => Math.max(0, s.value)).padAngle(slices.length > 1 ? 0.03 : 0)(slices), [slices]);
  const gen = arc<(typeof arcs)[number]>().innerRadius(r).outerRadius(R).cornerRadius(4);
  const genOn = arc<(typeof arcs)[number]>().innerRadius(r - 2).outerRadius(R + 6).cornerRadius(4);
  const cur = sel !== null ? slices[sel] : null;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0).toString().replace('.', ',');
  if (total <= 0) return null;
  return (
    <div className="dn-wrap" data-testid={testID}>
      <svg viewBox="-100 -100 200 200" className="dn-svg" role="img" aria-label={`${centerLabel}: ${slices.map((s) => `${s.label} ${pct(s.value)}%`).join(', ')}`}>
        {arcs.map((a, i) => (
          <path key={i} d={(sel === i ? genOn : gen)(a) ?? ''} fill={PALETTE[i % PALETTE.length]} className={`dn-slice ${sel !== null && sel !== i ? 'dn-dim' : ''}`}
            onPointerEnter={() => setSel(i)} onPointerLeave={() => setSel(null)} onClick={() => setSel(sel === i ? null : i)} />
        ))}
        <text y={-6} textAnchor="middle" className="dn-c1">{cur ? cur.label : centerLabel}</text>
        <text y={14} textAnchor="middle" className="dn-c2">{cur ? `${pct(cur.value)}%` : format(total)}</text>
        {cur ? <text y={30} textAnchor="middle" className="dn-c3">{format(cur.value)}</text> : null}
      </svg>
      <ul className="dn-legend">
        {slices.map((s, i) => (
          <li key={s.label} className={sel === i ? 'on' : ''} onPointerEnter={() => setSel(i)} onPointerLeave={() => setSel(null)}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} /><span className="dn-name">{s.label}</span><b>{pct(s.value)}%</b>{s.note ? <em>{s.note}</em> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Garis mini tanpa sumbu (untuk kartu hero); warna mengikuti `currentColor`. */
export function SparklineWeb({ values, className }: SparklineProps) {
  const uid = useId().replace(/:/g, '');
  const d = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(1, ...values), x = scaleLinear().domain([0, values.length - 1]).range([2, 198]), y = scaleLinear().domain([0, max]).range([34, 4]);
    return { l: line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(values) ?? '', a: area<number>().x((_, i) => x(i)).y0(36).y1((v) => y(v)).curve(curveMonotoneX)(values) ?? '', lx: x(values.length - 1), ly: y(values[values.length - 1]!) };
  }, [values]);
  if (!d) return null;
  return (
    <svg viewBox="0 0 200 38" preserveAspectRatio="none" className={`spark ${className ?? ''}`} aria-hidden="true">
      <defs><linearGradient id={`s${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity="0.35" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path d={d.a} fill={`url(#s${uid})`} />
      <path d={d.l} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
