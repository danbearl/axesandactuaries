import { useEffect, useState } from 'react';

const toEpochMs = (target: string | number): number =>
  typeof target === 'number' ? target : new Date(target).getTime();

// Shared countdown tick — previously duplicated across InjuryStatus/RestStatus
// (AdventurerDetail.tsx) and DeployByCountdown.tsx, each with their own
// useState+useEffect+setInterval copy. Recomputes every 30s, matching the cadence already
// proven fine for this app's timers (nothing here needs second-level precision). Accepts
// either an ISO timestamp (the API's usual shape) or an already-computed epoch-ms number
// (e.g. computeAvailableAt's Infinity-capable result for a dead adventurer).
export function useCountdown(target?: string | number | null): number {
  const [remaining, setRemaining] = useState(target != null ? toEpochMs(target) - Date.now() : 0);

  useEffect(() => {
    if (target == null) return;
    setRemaining(toEpochMs(target) - Date.now());
    const id = setInterval(() => {
      setRemaining(toEpochMs(target) - Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, [target]);

  return target != null ? remaining : 0;
}
