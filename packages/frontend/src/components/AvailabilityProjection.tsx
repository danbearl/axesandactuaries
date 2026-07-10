import { computeGearBonus, computeTrainingHallBonus } from '@axes-actuaries/types';
import type { AdventurerResponse, AdventureResponse, PropertyResponse } from '../lib/api.ts';
import { computeAvailableAt, hasEstimatedAvailability } from '../lib/availability.ts';
import { useCountdown } from '../hooks/useCountdown.ts';
import { formatDuration } from '../lib/time.ts';

const MAX_EVENTS = 6;

interface Props {
  adventurers: AdventurerResponse[];
  adventures:  AdventureResponse[];
  properties:  PropertyResponse[];
}

// A single upcoming unlock row — its own component (not inlined in a .map()) so its live
// countdown (useCountdown) gets a stable per-row hook instance, same pattern as AdventurerCard.
function ProjectionRow({ adventurer, availableAt, runningTotal }: {
  adventurer: AdventurerResponse; availableAt: number; runningTotal: number;
}) {
  const remaining = useCountdown(availableAt);
  return (
    <div className="ledger-row">
      <div className="ledger-desc">
        +{adventurer.name} in {formatDuration(Math.max(0, remaining))}
      </div>
      <div className="value">→ {Math.round(runningTotal)} power</div>
    </div>
  );
}

// Projects how much deployable power comes back online over the next while, so a player can
// anticipate when they'll next be able to take on a demanding contract — without opening every
// resting/injured adventurer's detail page individually. Deliberately excludes Cohesion (it
// depends on which specific adventurers end up paired together on a future contract, not known
// yet) but includes the flat, deterministic Training Hall bonus, and gear — both already known
// regardless of future party composition. Mirrors services/adventure.ts's computePartyPower
// formula shape (gear applied per-adventurer, Training Hall applied on top) for consistency
// with how power is actually calculated at resolution time.
export default function AvailabilityProjection({ adventurers, adventures, properties }: Props) {
  const living = adventurers.filter(a => a.status !== 'dead');
  const trainingBonus = computeTrainingHallBonus(properties);
  const effectivePower = (a: AdventurerResponse) =>
    a.powerRating * (1 + computeGearBonus(a.gearTier)) * (1 + trainingBonus);

  const now = Date.now();
  const available = living.filter(a => computeAvailableAt(a, adventures) <= now);
  const upcoming = living
    .filter(a => computeAvailableAt(a, adventures) > now)
    .sort((a, b) => computeAvailableAt(a, adventures) - computeAvailableAt(b, adventures))
    .slice(0, MAX_EVENTS);

  let runningTotal = available.reduce((sum, a) => sum + effectivePower(a), 0);
  const rows = upcoming.map(adv => {
    runningTotal += effectivePower(adv);
    return { adventurer: adv, availableAt: computeAvailableAt(adv, adventures), runningTotal };
  });

  return (
    <section className="panel">
      <div className="flex items-center justify-between mb-md">
        <h2>Power Availability</h2>
        <span className="value">{Math.round(available.reduce((sum, a) => sum + effectivePower(a), 0))} power now</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          {living.length === 0 ? 'No adventurers on the roster yet.' : 'Your whole roster is already available.'}
        </div>
      ) : (
        <div className="flex-col gap-xs">
          {rows.map(({ adventurer, availableAt, runningTotal }) => (
            <ProjectionRow key={adventurer.id} adventurer={adventurer} availableAt={availableAt} runningTotal={runningTotal} />
          ))}
        </div>
      )}

      {hasEstimatedAvailability(upcoming) && (
        <div className="label mt-sm">
          Estimates assume a clean return — injury or extended rest could push these back.
        </div>
      )}
    </section>
  );
}
