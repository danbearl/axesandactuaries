import { useCountdown } from '../hooks/useCountdown.ts';
import { formatDuration } from '../lib/time.ts';

// A missed deploy-by deadline fails the contract with a real gold/reputation penalty (see
// workers/marketGC.ts) — this counts down so it's never a silent surprise.
export default function DeployByCountdown({ deployBy }: { deployBy: string }) {
  const remaining = useCountdown(deployBy);

  if (remaining <= 0) {
    return <span className="label" style={{ color: 'var(--crimson)' }}>Deadline passed</span>;
  }

  const urgent = remaining < 60 * 60 * 1000; // under 1h left

  return (
    <span className="label" style={urgent ? { color: 'var(--crimson)' } : undefined}>
      Deploy within {formatDuration(remaining)}
    </span>
  );
}
