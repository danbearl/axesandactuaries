import type { Contract } from '@axes-actuaries/types';
import { BIDDING_CONTRACT_TIERS, CONTRACT_TIER_REPUTATION_REQUIREMENTS } from '@axes-actuaries/types';
import './ContractCard.css';

interface Props {
  contract: Contract;
  onAccept?: (e: React.MouseEvent) => void;
  onAcceptOnly?: (e: React.MouseEvent) => void;
  onBid?: (e: React.MouseEvent) => void;
  expanded?: boolean;
  playerRep?: number;
}

const formatTimeLeft = (isoDate: string): string => {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const formatDuration = (hours: number): string => {
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};

export default function ContractCard({ contract: c, onAccept, onAcceptOnly, onBid, expanded, playerRep }: Props) {
  const hasStatReqs  = Object.keys(c.requiredStats).length > 0;
  const isBidding    = BIDDING_CONTRACT_TIERS.includes(c.tier as 'dangerous' | 'legendary');
  const repRequired  = CONTRACT_TIER_REPUTATION_REQUIREMENTS[c.tier as keyof typeof CONTRACT_TIER_REPUTATION_REQUIREMENTS] ?? 0;
  // A requirement of 0 is "no gate" — must never flag a player as blocked even at negative reputation.
  const repBlocked   = repRequired > 0 && playerRep !== undefined && playerRep < repRequired;

  return (
    <div className={`contract-card panel ${expanded ? 'contract-expanded' : ''}`}>
      <div className="cc-header">
        <div className="cc-title-row">
          <h3 className="cc-title">{c.title}</h3>
          <div className="flex gap-xs items-center" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className={`badge badge-tier-${c.tier}`}>{c.tier}</span>
            {isBidding ? (
              <>
                <span className="label">Bid closes {formatTimeLeft(c.bidDeadline)}</span>
                {c.bidCount !== undefined && c.bidCount > 0 && (
                  <span className="label" style={{ color: 'var(--gold)' }}>
                    {c.bidCount} bid{c.bidCount !== 1 ? 's' : ''}
                  </span>
                )}
                {c.hasBid && (
                  <span className="badge" style={{ background: 'var(--success)', color: '#fff' }}>Bid placed</span>
                )}
              </>
            ) : (
              <span className="label">Expires {formatTimeLeft(c.expiresAt)}</span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <p className="cc-description mt-sm">{c.description}</p>
      )}

      <div className="cc-details mt-md">
        <div className="cc-detail-col">
          <div className="cc-stat">
            <span className="label">Required Power</span>
            <span className="value">{c.requiredPower}</span>
          </div>
          <div className="cc-stat">
            <span className="label">Duration</span>
            <span className="value">{formatDuration(c.durationHours)}</span>
          </div>
          {repRequired > 0 && (
            <div className="cc-stat">
              <span className="label">Min. Reputation</span>
              <span className="value" style={repBlocked ? { color: 'var(--danger)' } : undefined}>{repRequired}</span>
            </div>
          )}
          {hasStatReqs && (
            <div className="cc-stat">
              <span className="label">Preferred Stats</span>
              <div className="flex gap-xs" style={{ flexWrap: 'wrap' }}>
                {(Object.entries(c.requiredStats) as [string, number][]).map(([stat, val]) => (
                  <span key={stat} className="cc-req-badge">{stat} {val}+</span>
                ))}
              </div>
            </div>
          )}
          {c.requiredVocation && (
            <div className="cc-stat">
              <span className="label">Preferred Vocation</span>
              <div className="flex gap-xs" style={{ flexWrap: 'wrap' }}>
                <span className="cc-req-badge">{c.requiredVocation}</span>
              </div>
            </div>
          )}
        </div>

        <div className="cc-detail-col cc-rewards">
          <div className="cc-reward">
            <span className="label">Reward</span>
            <span className="currency">{c.rewardGold.toLocaleString()} gp</span>
          </div>
          <div className="cc-reward">
            <span className="label">Reputation</span>
            <span className="value">+{c.reputationReward}</span>
          </div>
          <div className="cc-reward">
            <span className="label">Failure Penalty</span>
            <span className="currency negative">−{c.penaltyGold} gp · −{c.penaltyReputation} rep</span>
          </div>
        </div>
      </div>

      {(onAccept || onAcceptOnly || onBid || repBlocked) && (
        <div className="cc-actions">
          {repBlocked && (
            <span className="label" style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
              Requires {repRequired} reputation
            </span>
          )}
          {onBid && !repBlocked && (
            <button
              className={`btn btn-sm ${c.hasBid ? 'btn-secondary' : 'btn-primary'}`}
              onClick={(e) => { e.stopPropagation(); onBid(e); }}
            >
              {c.hasBid ? 'Update Bid' : 'Place Bid'}
            </button>
          )}
          {onAcceptOnly && !repBlocked && (
            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onAcceptOnly(e); }}>
              Accept for Later
            </button>
          )}
          {onAccept && !repBlocked && (
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onAccept(e); }}>
              Accept &amp; Assign Party
            </button>
          )}
        </div>
      )}
    </div>
  );
}
