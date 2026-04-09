/**
 * Tiny zero-dependency SVG charts.
 * Replaces recharts (~218 MB on disk) with a few hundred lines of plain SVG.
 *
 * - GroupedBarChart: vertical grouped bars with two series (e.g. revenue vs spend per month)
 * - HorizontalBarChart: horizontal bars with one series (e.g. top grossing items)
 *
 * Both render fully responsive via SVG viewBox + preserveAspectRatio.
 */

import { useState } from 'react';

const formatTickShort = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
};

const niceMax = (raw: number) => {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
};

interface GroupedBarPoint {
  label: string;
  primary: number;
  secondary: number;
}

interface GroupedBarChartProps {
  data: GroupedBarPoint[];
  primaryColor?: string;
  secondaryColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  formatValue?: (n: number) => string;
}

export const GroupedBarChart = ({
  data,
  primaryColor = '#00a7e6',
  secondaryColor = '#94a3b8',
  primaryLabel = 'Primary',
  secondaryLabel = 'Secondary',
  formatValue = (n) => String(n)
}: GroupedBarChartProps) => {
  const [hover, setHover] = useState<{ index: number; series: 'primary' | 'secondary' } | null>(null);

  const width = 640;
  const height = 240;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 28;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const rawMax = Math.max(0, ...data.map((d) => Math.max(d.primary, d.secondary)));
  const maxY = niceMax(rawMax);
  const ticks = 4;

  const groupCount = Math.max(1, data.length);
  const groupW = innerW / groupCount;
  const barW = Math.max(2, (groupW - 8) / 2);

  const yToPx = (v: number) => padTop + innerH - (v / maxY) * innerH;

  return (
    <div className="relative h-64 w-full rounded-lg border border-slate-200 bg-slate-50 p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        onMouseLeave={() => setHover(null)}
      >
        {/* horizontal grid + y axis labels */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (maxY / ticks) * i;
          const y = yToPx(v);
          return (
            <g key={i}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padLeft - 6} y={y + 3} fontSize={10} fill="#475569" textAnchor="end">
                {formatTickShort(v)}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {data.map((d, i) => {
          const groupX = padLeft + i * groupW + 4;
          const yPrimary = yToPx(d.primary);
          const ySecondary = yToPx(d.secondary);
          return (
            <g key={`${d.label}-${i}`}>
              <rect
                x={groupX}
                y={yPrimary}
                width={barW}
                height={Math.max(0, padTop + innerH - yPrimary)}
                fill={primaryColor}
                rx={2}
                onMouseEnter={() => setHover({ index: i, series: 'primary' })}
              />
              <rect
                x={groupX + barW + 2}
                y={ySecondary}
                width={barW}
                height={Math.max(0, padTop + innerH - ySecondary)}
                fill={secondaryColor}
                rx={2}
                onMouseEnter={() => setHover({ index: i, series: 'secondary' })}
              />
              <text
                x={groupX + barW + 1}
                y={height - 10}
                fontSize={10}
                fill="#475569"
                textAnchor="middle"
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {/* baseline */}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={padTop + innerH}
          y2={padTop + innerH}
          stroke="#cbd5e1"
        />
      </svg>

      {/* legend */}
      <div className="pointer-events-none absolute left-2 top-2 flex gap-3 text-[10px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: primaryColor }} />
          {primaryLabel}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: secondaryColor }} />
          {secondaryLabel}
        </span>
      </div>

      {/* hover tooltip */}
      {hover && data[hover.index] && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] shadow">
          <div className="font-medium text-slate-700">{data[hover.index].label}</div>
          <div className="text-slate-600">
            {hover.series === 'primary' ? primaryLabel : secondaryLabel}:{' '}
            <span className="font-medium">
              {formatValue(hover.series === 'primary' ? data[hover.index].primary : data[hover.index].secondary)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

interface HorizontalBarPoint {
  label: string;
  fullLabel?: string;
  value: number;
  meta?: string;
}

interface HorizontalBarChartProps {
  data: HorizontalBarPoint[];
  color?: string;
  formatValue?: (n: number) => string;
}

export const HorizontalBarChart = ({
  data,
  color = '#fb1e2c',
  formatValue = (n) => String(n)
}: HorizontalBarChartProps) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 640;
  const rowH = 26;
  const padLeft = 130;
  const padRight = 16;
  const padTop = 8;
  const padBottom = 22;
  const height = padTop + padBottom + Math.max(1, data.length) * rowH;
  const innerW = width - padLeft - padRight;

  const rawMax = Math.max(0, ...data.map((d) => d.value));
  const maxX = niceMax(rawMax);
  const ticks = 4;

  return (
    <div className="relative h-64 w-full rounded-lg border border-slate-200 bg-slate-50 p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* vertical gridlines + x ticks */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (maxX / ticks) * i;
          const x = padLeft + (v / maxX) * innerW;
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={padTop} y2={height - padBottom} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={x} y={height - 6} fontSize={10} fill="#475569" textAnchor="middle">
                {formatTickShort(v)}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {data.map((d, i) => {
          const y = padTop + i * rowH + 3;
          const w = (d.value / maxX) * innerW;
          return (
            <g key={`${d.label}-${i}`} onMouseEnter={() => setHoverIdx(i)}>
              <text x={padLeft - 8} y={y + rowH / 2 + 1} fontSize={11} fill="#475569" textAnchor="end">
                {d.label}
              </text>
              <rect x={padLeft} y={y} width={Math.max(1, w)} height={rowH - 8} fill={color} rx={3} />
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && data[hoverIdx] && (
        <div className="pointer-events-none absolute right-2 top-2 max-w-[60%] rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] shadow">
          <div className="truncate font-medium text-slate-700">
            {data[hoverIdx].fullLabel || data[hoverIdx].label}
          </div>
          <div className="text-slate-600">{formatValue(data[hoverIdx].value)}</div>
          {data[hoverIdx].meta && <div className="text-slate-500">{data[hoverIdx].meta}</div>}
        </div>
      )}
    </div>
  );
};
