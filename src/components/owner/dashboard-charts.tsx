"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Days are YYYY-MM-DD in the shop's time zone (computed on the server). */
type Day = string;

const RANGES = [
  { weeks: 4, label: "Last 4 weeks" },
  { weeks: 12, label: "Last 12 weeks" },
  { weeks: 26, label: "Last 26 weeks" },
] as const;

const SERIES = [
  { key: "orders", label: "Orders received", color: "var(--chart-1)" },
  { key: "payments", label: "Payments verified", color: "var(--chart-2)" },
] as const;

const dayMs = 86_400_000;
const toTime = (d: Day) => Date.parse(`${d}T00:00:00Z`);
const shortDate = (t: number) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(t);

/** Monotone cubic path (Fritsch–Carlson): smooth, never overshoots between points, so a count never dips below zero. */
function smoothPath(pts: [number, number][]) {
  const n = pts.length;
  if (n < 2) return "";
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const sl = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i]);
  const m = pts.map((_, i) => (i === 0 ? sl[0] : i === n - 1 ? sl[n - 2] : sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / sl[i], b = m[i + 1] / sl[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * sl[i]; m[i + 1] = t * b * sl[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/**
 * Weekly activity: orders received and payments verified (both counts, one axis).
 * Crosshair + tooltip on hover/focus; a visually hidden table carries the same numbers.
 */
export function ActivityChart({ orderDays, paymentDays, today }: { orderDays: Day[]; paymentDays: Day[]; today: Day }) {
  const [weeks, setWeeks] = useState<number>(12);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const [H, setH] = useState(260);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setWidth(Math.max(280, Math.round(e.contentRect.width)));
      setH(Math.max(160, Math.round(e.contentRect.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buckets = useMemo(() => {
    const end = toTime(today) + dayMs; // exclusive
    const start = end - weeks * 7 * dayMs;
    const rows = Array.from({ length: weeks }, (_, i) => ({ start: start + i * 7 * dayMs, orders: 0, payments: 0 }));
    const add = (days: Day[], key: "orders" | "payments") => {
      for (const d of days) {
        const t = toTime(d);
        if (t >= start && t < end) rows[Math.floor((t - start) / (7 * dayMs))][key]++;
      }
    };
    add(orderDays, "orders");
    add(paymentDays, "payments");
    return rows;
  }, [orderDays, paymentDays, today, weeks]);

  const padL = 28, padR = 8, padT = 12, padB = 28;
  const max = Math.max(4, ...buckets.flatMap((b) => [b.orders, b.payments]));
  const top = Math.ceil(max / 4) * 4;
  const x = (i: number) => padL + (buckets.length === 1 ? 0 : (i * (width - padL - padR)) / (buckets.length - 1));
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const floor = y(0);
  const pts = (key: "orders" | "payments") => buckets.map((b, i) => [x(i), y(b[key])] as [number, number]);
  const line = { orders: smoothPath(pts("orders")), payments: smoothPath(pts("payments")) };
  const area = `${line.orders} L${x(buckets.length - 1)},${floor} L${x(0)},${floor} Z`;
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const labelEvery = Math.ceil(buckets.length / Math.max(2, Math.floor(width / 90)));

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const rel = clientX - r.left - padL;
    const step = (width - padL - padR) / Math.max(1, buckets.length - 1);
    setHover(Math.min(buckets.length - 1, Math.max(0, Math.round(rel / step))));
  };
  const h = hover != null ? buckets[hover] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mb-4">
        <h2 className="mr-auto text-base font-bold sm:text-lg">Shop activity</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}</li>
          ))}
        </ul>
        <label className="sr-only" htmlFor="activity-range">Range</label>
        <select id="activity-range" value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setHover(null); }}
          className="h-9 rounded-lg border border-input bg-card px-2.5 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          {RANGES.map((r) => <option key={r.weeks} value={r.weeks}>{r.label}</option>)}
        </select>
      </div>

      <div ref={box} className="relative min-h-[170px] flex-1 sm:min-h-[220px] rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40" onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
        tabIndex={0} role="img" aria-label={`Orders received and payments verified per week, ${RANGES.find((r) => r.weeks === weeks)?.label.toLowerCase()}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((v) => Math.min(buckets.length - 1, (v ?? -1) + 1));
          if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? buckets.length) - 1));
          if (e.key === "Escape") setHover(null);
        }}
        onBlur={() => setHover(null)}
      >
        <svg width={width} height={H} className="absolute inset-0 block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{t}</text>
            </g>
          ))}
          {buckets.map((b, i) => (i % labelEvery === 0 || i === buckets.length - 1) && (
            <text key={b.start} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">{shortDate(b.start)}</text>
          ))}
          <path d={area} fill="url(#activity-fill)" />
          <path d={line.payments} fill="none" stroke="var(--chart-2)" strokeWidth={2} strokeLinecap="round" />
          <path d={line.orders} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinecap="round" />
          {h && (
            <g>
              <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={floor} stroke="var(--foreground)" strokeOpacity={0.25} />
              {SERIES.map((s) => <circle key={s.key} cx={x(hover!)} cy={y(h[s.key])} r={5} fill={s.color} stroke="var(--card)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {h && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(x(hover!) - 80, 0), width - 168) }}>
            <p className="mb-1 font-semibold">Week of {shortDate(h.start)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="flex-1 text-muted-foreground">{s.label}</span>
                <b className="tabular-nums">{h[s.key]}</b>
              </p>
            ))}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Weekly shop activity</caption>
        <thead><tr><th>Week of</th><th>Orders received</th><th>Payments verified</th></tr></thead>
        <tbody>{buckets.map((b) => <tr key={b.start}><td>{shortDate(b.start)}</td><td>{b.orders}</td><td>{b.payments}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Jobs due per day for the coming week, on the dark card: the busiest day is highlighted. */
export function DueBars({ days }: { days: { day: Day; label: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const peak = days.reduce((a, d, i) => (d.count > days[a].count ? i : a), 0);
  return (
    <div>
      <ul className="flex h-20 items-end gap-1 sm:h-28 sm:gap-1.5" aria-label="Jobs due per day">
        {days.map((d, i) => (
          <li key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.label}: ${d.count} due`}>
            <span className="sr-only">{d.label}: {d.count} due</span>
            <span aria-hidden className={cn("w-full rounded-t-md transition-opacity group-hover:opacity-100",
              i === peak && d.count > 0 ? "bg-gradient-to-t from-[#c48a5a] to-[#f0b27a] premium:from-[#b8924f] premium:to-[#e9cf98]" : "bg-white/15 opacity-90")}
              style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }} />
            <span aria-hidden className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#2b1d17] group-hover:block">{d.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between text-[11px] text-white/60" aria-hidden>
        <span>{days[0]?.label}</span>
        {days[peak]?.count ? <span>Busiest: {days[peak].label}</span> : <span />}
        <span>{days.at(-1)?.label}</span>
      </div>
    </div>
  );
}
