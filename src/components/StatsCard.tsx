interface StatsCardProps {
  label:      string;
  value:      string;
  sublabel?:  string;
  trend?:     'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
}

const TREND_STYLES = {
  up:      'text-emerald-400',
  down:    'text-red-400',
  neutral: 'text-gray-400',
};

const TREND_ARROWS = { up: '↑', down: '↓', neutral: '→' };

export function StatsCard({ label, value, sublabel, trend, trendValue, className }: StatsCardProps) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${className ?? ''}`}>
      <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-gray-500">{sublabel}</p>}
      {trend && trendValue && (
        <p className={`mt-2 text-xs font-semibold ${TREND_STYLES[trend]}`}>
          {TREND_ARROWS[trend]} {trendValue}
        </p>
      )}
    </div>
  );
}
