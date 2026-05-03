'use client';

interface CollarGraphProps {
  price: number;
  floor: number;
  cap: number;
  stockName?: string;
  durationMonths?: number;
}

export default function CollarGraph({ price, floor, cap, stockName = 'stock', durationMonths }: CollarGraphProps) {
  // Chart area bounds
  const left = 40;
  const right = 320;
  const top = 20;
  const bottom = 148;
  const chartH = bottom - top; // 128px total
  const padding = 16; // min padding so lines don't hit edges

  // Calculate proportional Y positions based on actual price/floor/cap spread
  const floorPct = (price - floor) / price; // e.g. 0.05 for 5%
  const capPct = (cap - price) / price;     // e.g. 0.15 for 15%
  const totalSpread = floorPct + capPct;

  // Map price values to Y coordinates (higher price = lower Y)
  // Price sits at a position proportional to its place between floor and cap
  const usableH = chartH - padding * 2;
  const capY = top + padding;
  const floorY = bottom - padding;
  const priceY = capY + (capPct / totalSpread) * usableH;

  // Generate a realistic-looking price path that respects the floor/cap bounds
  // Scale the amplitude based on how tight the corridor is
  const amplitude = (priceY - capY) * 0.55; // wiggle within ~55% of the cap-to-price zone
  const points: [number, number][] = [];
  const steps = 12;
  // Seeded-ish deterministic wobble based on price
  const seed = Math.round(price * 100) % 7;
  for (let i = 0; i <= steps; i++) {
    const x = left + 10 + (i / steps) * (right - left - 20);
    const t = i / steps;
    // Combine a few sine waves for organic look
    const wave = Math.sin(t * 4.5 + seed) * 0.5
      + Math.sin(t * 7.2 + seed * 0.7) * 0.3
      + Math.sin(t * 2.1 + seed * 1.3) * 0.2;
    const y = priceY - wave * amplitude;
    // Clamp within the chart area with a small margin
    points.push([x, Math.max(capY + 4, Math.min(floorY - 4, y))]);
  }

  // Build smooth SVG path using cardinal-style curves
  const pathD = points
    .map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`))
    .join(' ');
  const fillD = `${pathD} L${points[points.length - 1][0]} ${bottom} L${points[0][0]} ${bottom} Z`;

  // Dashed grid lines at 25% and 75% between floor and cap
  const gridY1 = capY + (floorY - capY) * 0.25;
  const gridY2 = capY + (floorY - capY) * 0.75;

  // Expiry label
  const expiryLabel = durationMonths
    ? `${durationMonths}mo expiry`
    : 'Expiry';

  return (
    <div>
      <svg viewBox="0 0 340 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
        {/* Grid */}
        <line x1={left} y1={top} x2={left} y2={bottom} stroke="#2A2A2E" strokeWidth="0.5" />
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#2A2A2E" strokeWidth="0.5" />
        <line x1={left} y1={priceY} x2={right} y2={priceY} stroke="#2A2A2E" strokeWidth="0.5" strokeDasharray="3 3" />
        <line x1={left} y1={gridY1} x2={right} y2={gridY1} stroke="#2A2A2E" strokeWidth="0.5" strokeDasharray="3 3" />
        <line x1={left} y1={gridY2} x2={right} y2={gridY2} stroke="#2A2A2E" strokeWidth="0.5" strokeDasharray="3 3" />

        {/* Y-axis labels */}
        <text x={left - 4} y={capY + 4} textAnchor="end" fill="#636366" fontSize="9" fontFamily="Geist,sans-serif">${cap.toFixed(0)}</text>
        <text x={left - 4} y={priceY + 4} textAnchor="end" fill="#636366" fontSize="9" fontFamily="Geist,sans-serif">${price.toFixed(0)}</text>
        <text x={left - 4} y={floorY + 4} textAnchor="end" fill="#636366" fontSize="9" fontFamily="Geist,sans-serif">${floor.toFixed(0)}</text>

        {/* X-axis */}
        <text x="50" y="164" fill="#636366" fontSize="9" fontFamily="Geist,sans-serif">Today</text>
        <text x="290" y="164" textAnchor="end" fill="#636366" fontSize="9" fontFamily="Geist,sans-serif">{expiryLabel}</text>

        {/* Protection zone */}
        <rect x={left} y={capY} width={right - left} height={floorY - capY} rx="2" fill="#10B981" opacity="0.06" />

        {/* Cap line */}
        <line x1={left} y1={capY} x2={right} y2={capY} stroke="#10B981" strokeWidth="1.5" strokeDasharray="6 3" />
        <rect x={right - 24} y={capY - 10} width="24" height="16" rx="4" fill="#10B981" opacity="0.15" />
        <text x={right - 12} y={capY + 1} textAnchor="middle" fill="#10B981" fontSize="8" fontWeight="600" fontFamily="Geist,sans-serif">Cap</text>

        {/* Floor line */}
        <line x1={left} y1={floorY} x2={right} y2={floorY} stroke="#EF4444" strokeWidth="1.5" strokeDasharray="6 3" />
        <rect x={right - 30} y={floorY - 7} width="30" height="16" rx="4" fill="#EF4444" opacity="0.15" />
        <text x={right - 15} y={floorY + 4} textAnchor="middle" fill="#EF4444" fontSize="8" fontWeight="600" fontFamily="Geist,sans-serif">Floor</text>

        {/* Price movement */}
        <path d={pathD}
          stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
        <path d={fillD}
          fill="url(#priceGrad)" opacity="0.3" />
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Current price dot — placed on the first point of the path */}
        <circle cx={points[0][0]} cy={points[0][1]} r="5" fill="#10B981" />
        <circle cx={points[0][0]} cy={points[0][1]} r="9" fill="#10B981" opacity="0.15" />
        <text x={points[0][0] + 12} y={points[0][1] - 4} fill="#10B981" fontSize="9" fontWeight="600" fontFamily="Geist,sans-serif">${price.toFixed(0)} now</text>

        {/* Scenario labels */}
        <text x="180" y={capY - 4} textAnchor="middle" fill="#10B981" fontSize="8.5" fontWeight="500" fontFamily="Geist,sans-serif" opacity="0.7">
          If {stockName} rises: capped at ${cap.toFixed(2)}
        </text>
        <text x="180" y={floorY + 14} textAnchor="middle" fill="#EF4444" fontSize="8.5" fontWeight="500" fontFamily="Geist,sans-serif" opacity="0.7">
          If {stockName} drops: protected at ${floor.toFixed(2)}
        </text>

        {/* Spread annotation — shows how wide the corridor is */}
        <text x={left + 2} y={bottom - 2} fill="#636366" fontSize="7.5" fontFamily="Geist,sans-serif" opacity="0.5">
          −{(floorPct * 100).toFixed(1)}% / +{(capPct * 100).toFixed(1)}%
        </text>
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'rgba(16,185,129,0.25)' }} /> Protected zone
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#10B981' }} /> Price trend
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#EF4444' }} /> Floor
        </span>
      </div>
    </div>
  );
}
