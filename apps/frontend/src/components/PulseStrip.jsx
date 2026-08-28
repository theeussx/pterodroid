/**
 * The panel's signature element: a small oscilloscope-style sparkline of
 * recent CPU history, with a live numeric readout. Doubles as real
 * monitoring info, not just decoration.
 */
export default function PulseStrip({ history, current, className = '' }) {
  const points = history.length ? history : Array(20).fill(0);
  const max = Math.max(100, ...points.map((p) => p.cpu || 0));
  const w = 120;
  const h = 28;

  const path = points
    .map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * w;
      const y = h - ((p.cpu || 0) / max) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg width={w} height={h} className="overflow-visible shrink-0" aria-hidden="true">
        <path d={path} fill="none" stroke="#3DDC84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        {points.length > 0 && (
          <circle
            cx={w}
            cy={h - ((points[points.length - 1].cpu || 0) / max) * h}
            r="2"
            fill="#3DDC84"
          />
        )}
      </svg>
      <div className="font-mono text-xs leading-tight">
        <div className="text-ink tabular-nums">{current ? `${current.cpu.toFixed(0)}%` : '--'} <span className="text-ink-faint">cpu</span></div>
        <div className="text-ink-dim tabular-nums">{current ? `${current.mem.percent.toFixed(0)}%` : '--'} <span className="text-ink-faint">ram</span></div>
      </div>
    </div>
  );
}
