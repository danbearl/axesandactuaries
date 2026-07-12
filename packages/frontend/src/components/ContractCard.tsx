import type { Contract } from '@axes-actuaries/types';
import { BIDDING_CONTRACT_TIERS, CONTRACT_TIER_REPUTATION_REQUIREMENTS } from '@axes-actuaries/types';
import { ROLE_ICONS } from '../lib/roleIcons.ts';
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

// Highlights encounters that clearly favor (or punish) a role, rather than every modifier —
// values near 1.0 are visually neutral, matching how little they actually matter to the
// outcome. Thresholds are illustrative, not tied to MIN/MAX_ROLE_MODIFIER's [0.5, 1.5] range.
function encounterModifierClass(value: number): string {
  if (value >= 1.15) return 'cc-mod-high';
  if (value <= 0.85) return 'cc-mod-low';
  return '';
}

// A fully composition-neutral contract (errand tier always, or any tier that happened to roll
// zero favored/unfavored roles) has every modifier exactly 1 — nothing worth showing.
function hasRoleBias(encounter: { fighter: number; wizard: number; rogue: number; priest: number }): boolean {
  return encounter.fighter !== 1 || encounter.wizard !== 1 || encounter.rogue !== 1 || encounter.priest !== 1;
}

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
          <div className="flex gap-xs items-center" style={{ flexWrap: 'wrap' }}>
            <span className={`badge badge-tier-${c.tier}`}>{c.tier}</span>
            {isBidding ? (
              <>
                <span className="label">
                  {c.bidDeadline ? `Bid closes ${formatTimeLeft(c.bidDeadline)}` : 'Open for bidding'}
                </span>
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

      {/* Every encounter in a contract's chain carries the identical role modifiers (a
          contract's favored/unfavored roles are a fixed property of the contract, not
          something that varies encounter-to-encounter — see generateEncounters in
          @axes-actuaries/types), so only the first entry needs showing. Hidden entirely for a
          fully composition-neutral contract (errand tier always, or any tier that happened to
          roll zero favored/unfavored roles) — nothing to read here beyond the flat power ratio
          already shown above. */}
      {c.encounters.length > 0 && hasRoleBias(c.encounters[0]) && (
        <div className="cc-encounters mt-md">
          <span className="label">Role Affinities</span>
          <div className="cc-encounter-row mt-sm">
            {(Object.keys(ROLE_ICONS) as Array<keyof typeof ROLE_ICONS>).map((role) => (
              <span key={role} className={`cc-encounter-mod ${encounterModifierClass(c.encounters[0][role])}`}>
                {ROLE_ICONS[role]} {c.encounters[0][role].toFixed(1)}×
              </span>
            ))}
          </div>
        </div>
      )}

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
