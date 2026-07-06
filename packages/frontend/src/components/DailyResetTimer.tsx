import { useEffect, useState } from 'react';

// The daily-reset worker runs at 00:00 UTC (wages, maintenance, market refresh) —
// see workers/index.ts's 'daily-reset' cron schedule.
function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return next - now.getTime();
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

export default function DailyResetTimer() {
  const [remaining, setRemaining] = useState(msUntilNextUtcMidnight());

  useEffect(() => {
    const id = setInterval(() => setRemaining(msUntilNextUtcMidnight()), 1000);
    return () => clearInterval(id);
  }, []);

  return <>{formatCountdown(remaining)}</>;
}
