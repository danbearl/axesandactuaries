import { useEffect, useState } from 'react';

// A missed deploy-by deadline fails the contract with a real gold/reputation penalty (see
// workers/marketGC.ts) — this counts down so it's never a silent surprise.
export default function DeployByCountdown({ deployBy }: { deployBy: string }) {
  const [remaining, setRemaining] = useState(new Date(deployBy).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(deployBy).getTime() - Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, [deployBy]);

  if (remaining <= 0) {
    return <span className="label" style={{ color: 'var(--crimson)' }}>Deadline passed</span>;
  }

  const totalMin = Math.floor(remaining / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const formatted = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const urgent = remaining < 60 * 60 * 1000; // under 1h left

  return (
    <span className="label" style={urgent ? { color: 'var(--crimson)' } : undefined}>
      Deploy within {formatted}
    </span>
  );
}
