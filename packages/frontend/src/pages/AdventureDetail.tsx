import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { Adventurer } from '@axes-actuaries/types';
import AdventurerCard from '../components/AdventurerCard.tsx';
import './AdventureDetail.css';

const formatTimeLeft = (iso: string): string => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Completing…';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default function AdventureDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['adventures', id],
    queryFn: () => api.adventures.get(id!),
    enabled: !!id,
    // Refetch when the adventure is still in progress to pick up auto-resolution
    refetchInterval: (query) => {
      const adv = query.state.data?.adventure;
      return adv?.status === 'in_progress' ? 10_000 : false;
    },
  });

  if (isLoading) {
    return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>Loading adventure…</div>;
  }

  if (isError || !data) {
    return (
      <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>
        <h2>Adventure not found</h2>
        <Link to="/" className="btn btn-secondary mt-md">← Back to Dashboard</Link>
      </div>
    );
  }

  const { adventure } = data;
  const { contract } = adventure;
  const party = adventure.adventurers.map(aa => aa.adventurer);
  const partyPower = party.reduce((s, a) => s + a.powerRating, 0);
  const ratio = partyPower / contract.requiredPower;
  const successChance = Math.min(90, Math.round((0.3 + ratio * 0.5) * 100));

  const total = new Date(adventure.completesAt).getTime() - new Date(adventure.startsAt).getTime();
  const elapsed = Date.now() - new Date(adventure.startsAt).getTime();
  const progress = Math.min(100, Math.max(0, (elapsed / total) * 100));

  const isResolved = adventure.status !== 'in_progress';

  return (
    <div className="adventure-detail">
      <div className="flex items-center gap-md mb-md">
        <Link to="/" className="btn btn-secondary btn-sm">← Dashboard</Link>
        <div>
          <h1>{contract.title}</h1>
          <div className="flex gap-xs items-center mt-sm">
            <span className={`badge badge-tier-${contract.tier}`}>{contract.tier}</span>
            <span className={`badge badge-status-${adventure.status}`}>
              {adventure.status === 'in_progress' ? 'In Progress'
                : adventure.status === 'completed' ? 'Completed'
                : 'Failed'}
            </span>
          </div>
        </div>
      </div>

      {isResolved && (
        <div className={`panel panel-sm mb-md`} style={{
          borderColor: adventure.status === 'completed' ? 'var(--success, #5a8a5a)' : 'var(--danger)',
          color: adventure.status === 'completed' ? 'var(--success, #5a8a5a)' : 'var(--danger)',
        }}>
          {adventure.status === 'completed'
            ? `✓ Contract completed! +${contract.rewardGold} gp · +${contract.reputationReward} reputation`
            : `✗ Contract failed. −${contract.penaltyGold} gp · −${contract.penaltyReputation} reputation`}
        </div>
      )}

      <div className="detail-grid">
        {/* Contract info */}
        <div className="panel">
          <h2>Contract Brief</h2>
          <hr className="divider" />
          <p className="mt-sm">{contract.description}</p>

          <div className="detail-stats mt-md">
            <div className="detail-stat">
              <span className="label">Required Power</span>
              <span className="value">{contract.requiredPower}</span>
            </div>
            <div className="detail-stat">
              <span className="label">Duration</span>
              <span className="value">{contract.durationHours}h</span>
            </div>
            <div className="detail-stat">
              <span className="label">Reward</span>
              <span className="currency">{contract.rewardGold.toLocaleString()} gp · +{contract.reputationReward} rep</span>
            </div>
            <div className="detail-stat">
              <span className="label">Failure Penalty</span>
              <span className="currency negative">−{contract.penaltyGold} gp · −{contract.penaltyReputation} rep</span>
            </div>
          </div>
        </div>

        {/* Timer */}
        <div className="panel">
          <h2>Progress</h2>
          <hr className="divider" />

          <div className="timer-display mt-md">
            <div className="timer-big">
              {isResolved
                ? (adventure.status === 'completed' ? 'Completed' : 'Failed')
                : formatTimeLeft(adventure.completesAt)}
            </div>
            <div className="label">Deployed: {formatDate(adventure.startsAt)}</div>
            <div className="label">Returns: {formatDate(adventure.completesAt)}</div>
          </div>

          <div className="at-progress-track mt-md">
            <div className="at-progress-fill" style={{ width: `${isResolved ? 100 : progress}%` }} />
          </div>

          {!isResolved && (
            <div className="success-indicator mt-md">
              <div className="flex justify-between items-center mb-sm">
                <span className="label">Estimated Success Chance</span>
                <span className={`value ${successChance >= 75 ? '' : successChance >= 50 ? 'text-warning' : 'text-danger'}`}>
                  {successChance}%
                </span>
              </div>
              <div className="success-breakdown">
                <div className="detail-stat">
                  <span className="label">Party Power</span>
                  <span className="value">{partyPower} vs. {contract.requiredPower} required</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Party */}
      <section className="panel mt-md">
        <h2>Deployed Party</h2>
        <hr className="divider" />
        <div className="party-grid mt-md">
          {party.map(adv => (
            <AdventurerCard key={adv.id} adventurer={adv as unknown as Adventurer} compact />
          ))}
        </div>
        {party.length === 0 && (
          <div className="empty-state">No party data found.</div>
        )}
      </section>
    </div>
  );
}
