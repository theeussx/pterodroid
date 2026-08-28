export default function HistoryChart({ data, accessor, color, label, unit = '%', max = 100, height = 120 }) {
  const w = 600;
  const h = height;
  const values = data.map(accessor);
  const effectiveMax = Math.max(max, ...values, 1);

  const points = values.map((v, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * w : 0;
    const y = h - (v / effectiveMax) * h;
    return [x, y];
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1][0].toFixed(1)},${h} L0,${h} Z`
    : '';

  const current = values[values.length - 1];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-ink-dim">{label}</span>
        <span className="font-mono text-sm text-ink tabular-nums">
          {current != null ? `${current.toFixed(1)}${unit}` : '--'}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="#243229" strokeWidth="1" />
        ))}
        {areaPath && <path d={areaPath} fill={color} opacity="0.12" />}
        {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}
