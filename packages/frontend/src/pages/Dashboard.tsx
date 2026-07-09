import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ContractResponse, type AdventurerResponse } from '../lib/api.ts';
import AdventurerCard from '../components/AdventurerCard.tsx';
import AdventureTimer from '../components/AdventureTimer.tsx';
import DailyResetTimer from '../components/DailyResetTimer.tsx';
import DeployByCountdown from '../components/DeployByCountdown.tsx';
import { computeRosterCap, countUnmetRequirements, adventurerMeetsAnyRequirement, estimateSuccessChance, PROPERTY_PARTY_ROLE, type Adventurer } from '@axes-actuaries/types';
import { partyCohesionBonus, trainingHallBonus } from '../lib/cohesion.ts';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deployingContract, setDeployingContract] = useState<ContractResponse | null>(null);
  const [selectedAdventurerIds, setSelectedAdventurerIds] = useState<string[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
  });

  const { data: mineData } = useQuery({
    queryKey: ['contracts', 'mine'],
    queryFn: () => api.contracts.mine(),
  });

  const fireMutation = useMutation({
    mutationFn: (id: string) => api.adventurers.fire(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['player'] }),
  });

  const deployMutation = useMutation({
    mutationFn: ({ contractId, adventurerIds }: { contractId: string; adventurerIds: string[] }) =>
      api.adventures.start(contractId, adventurerIds),
    onSuccess: () => {
      setDeployError(null);
      setDeployingContract(null);
      setSelectedAdventurerIds([]);
      queryClient.invalidateQueries({ queryKey: ['player'] });
      queryClient.invalidateQueries({ queryKey: ['contracts', 'mine'] });
    },
    onError: (err) => setDeployError(err instanceof Error ? err.message : 'Failed to deploy party'),
  });

  const { data: txData } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => api.transactions.list(5, 0),
  });

  const { data: feedData } = useQuery({
    queryKey: ['feed', 'recent'],
    queryFn: () => api.feed.list(5, 0),
  });

  if (isLoading || !data) {
    return <div className="dashboard"><div className="empty-state">Loading…</div></div>;
  }

  const { player, adventurers: hired, properties, adventures } = data;
  const pendingContracts = (mineData?.contracts ?? []).filter(c => c.status === 'awarded');

  const dailyWages = hired.reduce((sum, a) => sum + a.dailyWage, 0);
  const dailyMaintenance = properties.reduce((sum, p) => sum + p.maintenanceCostDaily, 0);
  const dailyBurn = dailyWages + dailyMaintenance;
  const daysOfRunway = dailyBurn > 0 ? Math.floor(player.gold / dailyBurn) : Infinity;

  const recentTx = txData?.transactions ?? [];
  const recentEvents = feedData?.events ?? [];
  const isDeployable = (a: AdventurerResponse) =>
    a.status === 'hired' && (!a.restUntil || new Date(a.restUntil) <= new Date());
  const hiredAdventurers = hired.filter(isDeployable);

  const dormitory = properties.find(p => p.type === 'dormitory');
  const rosterCap = computeRosterCap(dormitory?.level ?? 0);
  // A dead adventurer still occupies a roster slot until released — it doesn't just vanish.
  const rosterCount = hired.length;

  const toggleAdventurer = (id: string) => {
    setSelectedAdventurerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Guild Ledger</h1>
        <span className="label">Active operations dashboard</span>
      </div>

      {/* Summary row */}
      <div className="summary-row">
        <div className="panel summary-card">
          <span className="label">Treasury</span>
          <div className="summary-big currency">{player.gold.toLocaleString()} gp</div>
          <div className="summary-sub">
            <span className="currency negative">−{dailyBurn} gp/day burn</span>
            <span className="label">{daysOfRunway === Infinity ? '∞' : daysOfRunway} days runway</span>
            <span className="label">Day resets in <DailyResetTimer /></span>
          </div>
        </div>

        <div className="panel summary-card">
          <span className="label">Reputation</span>
          <div className="summary-big">{player.reputation}</div>
          <div className="summary-sub">
            <span className="label">Dangerous requires 50 · Legendary requires 200</span>
          </div>
        </div>

        <div className="panel summary-card">
          <span className="label">Roster</span>
          <div className="summary-big">{rosterCount} / {rosterCap}</div>
          <div className="summary-sub">
            <span className="label">
              {hiredAdventurers.length} available ·{' '}
              {hired.filter(a => a.status === 'hired' && !isDeployable(a)).length} resting ·{' '}
              {hired.filter(a => a.status === 'on_adventure').length} deployed ·{' '}
              {hired.filter(a => a.status === 'injured').length} injured ·{' '}
              {hired.filter(a => a.status === 'dead').length} deceased
            </span>
          </div>
        </div>

        <div className="panel summary-card">
          <span className="label">Active Adventures</span>
          <div className="summary-big">{adventures.length}</div>
          <div className="summary-sub">
            <Link to="/market/contracts" className="dashboard-link">Browse contracts →</Link>
          </div>
        </div>
      </div>

      {/* Bid-won contracts awaiting deployment */}
      {pendingContracts.length > 0 && (
        <section className="panel" style={{ borderColor: 'var(--gold)', marginBottom: '1rem' }}>
          <div className="flex items-center justify-between mb-md">
            <h2>Contracts Awaiting Deployment</h2>
            <span className="label">{pendingContracts.length} bid-won contract{pendingContracts.length !== 1 ? 's' : ''}</span>
          </div>
          <p className="label" style={{ marginBottom: '0.75rem' }}>
            Assign a party before the deploy-by deadline — missing it fails the contract with
            its normal gold/reputation penalty.
          </p>
          <div className="flex-col gap-sm">
            {pendingContracts.map(c => (
              <div key={c.id} className="property-row">
                <div>
                  <div className="value">{c.title}</div>
                  <div className="label">{c.tier} · {c.rewardGold.toLocaleString()} gp · Power {c.requiredPower}</div>
                  {formatRequirements(c) && (
                    <div className="label">Needs: {formatRequirements(c)}</div>
                  )}
                  {c.deployBy && <DeployByCountdown deployBy={c.deployBy} />}
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => { setDeployingContract(c); setSelectedAdventurerIds([]); setDeployError(null); }}
                >
                  Deploy Party
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="dashboard-grid">
        {/* Active adventures */}
        <section className="panel">
          <div className="flex items-center justify-between mb-md">
            <h2>Active Adventures</h2>
            <Link to="/market/contracts" className="btn btn-sm btn-primary">+ Accept Contract</Link>
          </div>

          {adventures.length === 0 ? (
            <div className="empty-state">No adventures in progress. Accept a contract to deploy your party.</div>
          ) : (
            <div className="flex-col gap-sm">
              {adventures.map(adv => (
                <AdventureTimer key={adv.id} adventure={adv} />
              ))}
            </div>
          )}
        </section>

        {/* Roster */}
        <section className="panel">
          <div className="flex items-center justify-between mb-md">
            <h2>Your Roster</h2>
            <Link to="/market/adventurers" className="btn btn-sm btn-secondary">Hire More</Link>
          </div>

          {hired.length === 0 ? (
            <div className="empty-state">Your roster is empty. Visit the market to hire adventurers.</div>
          ) : (
            <div className="flex-col gap-sm">
              {hired.map(adv => (
                <AdventurerCard
                  key={adv.id}
                  adventurer={adv as unknown as Adventurer}
                  compact
                  onClick={() => navigate(`/adventurers/${adv.id}`)}
                  onFire={adv.status !== 'on_adventure'
                    ? () => fireMutation.mutate(adv.id)
                    : undefined}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recent transactions */}
        <section className="panel dashboard-ledger">
          <div className="flex items-center justify-between mb-md">
            <h2>Recent Ledger</h2>
            <Link to="/transactions" className="btn btn-sm btn-secondary">Full Ledger</Link>
          </div>

          <div className="flex-col gap-xs">
            {recentTx.map(tx => (
              <div key={tx.id} className="ledger-row">
                <div className="ledger-desc">{tx.description}</div>
                <div className={`currency ${tx.amount > 0 ? 'positive' : 'negative'}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} gp
                </div>
              </div>
            ))}
            {recentTx.length === 0 && <div className="empty-state">No transactions yet.</div>}
          </div>
        </section>

        {/* Recent events */}
        <section className="panel dashboard-ledger">
          <div className="flex items-center justify-between mb-md">
            <h2>Recent Events</h2>
            <Link to="/adventures" className="btn btn-sm btn-secondary">Full Feed</Link>
          </div>

          <div className="flex-col gap-xs">
            {recentEvents.map(ev => (
              <div key={ev.id} className="ledger-row">
                <div className="ledger-desc">{ev.summary}</div>
              </div>
            ))}
            {recentEvents.length === 0 && <div className="empty-state">No recent events.</div>}
          </div>
        </section>

        {/* Properties */}
        <section className="panel">
          <div className="flex items-center justify-between mb-md">
            <h2>Properties</h2>
            <Link to="/properties" className="btn btn-sm btn-secondary">Manage</Link>
          </div>

          {properties.length === 0 ? (
            <div className="empty-state">No properties built. A dormitory expands your roster capacity.</div>
          ) : (
            <div className="flex-col gap-sm">
              {properties.map(p => (
                <div key={p.id} className="property-row">
                  <div>
                    <div className="value">{PROPERTY_LABELS[p.type] ?? p.type} · Level {p.level}</div>
                    <div className="label">{p.maintenanceCostDaily} gp/day maintenance</div>
                  </div>
                  <div className="label text-right">
                    {Object.entries(p.bonus as Record<string, number>).map(([k, v]) => (
                      <div key={k}>{bonusLabel(p.type, k)}: {typeof v === 'number' ? formatBonusValue(k, v) : `+${v}`}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Party deployment modal for bid-won contracts */}
      {deployingContract && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
          onClick={() => setDeployingContract(null)}
        >
          <div
            className="panel"
            style={{ maxWidth: 520, width: '90%', padding: '1.5rem' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '0.5rem' }}>{deployingContract.title}</h2>
            <p className="label" style={{ marginBottom: '1rem' }}>
              Select adventurers to deploy. Required power: {deployingContract.requiredPower}
            </p>
            {formatRequirements(deployingContract) && (
              <p className="label" style={{ marginBottom: '1rem' }}>
                Preferred: {formatRequirements(deployingContract)} — a party member meeting a
                requirement raises the success chance; adventurers below marked "Matches" meet
                at least one.
              </p>
            )}

            {hiredAdventurers.length === 0 ? (
              <div className="empty-state">No idle adventurers available to deploy.</div>
            ) : (
              <div className="flex-col gap-sm" style={{ marginBottom: '1rem' }}>
                {hiredAdventurers.map((adv: AdventurerResponse) => {
                  const checked = selectedAdventurerIds.includes(adv.id);
                  const matches = adventurerMeetsAnyRequirement(deployingContract, adv);
                  return (
                    <label
                      key={adv.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleAdventurer(adv.id)} />
                      <div>
                        <span className="value">{adv.name}</span>{' '}
                        <span className="label">{adv.vocation} · Power {adv.powerRating} · Lv.{adv.level}</span>{' '}
                        {matches && (
                          <span className="badge" style={{ background: 'var(--success)', color: '#fff', fontSize: '0.65rem' }}>
                            Matches
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {selectedAdventurerIds.length > 0 && (() => {
              const party      = hiredAdventurers.filter(a => selectedAdventurerIds.includes(a.id));
              const basePower  = party.reduce((s, a) => s + a.powerRating, 0);
              const cohesionBonus = partyCohesionBonus(selectedAdventurerIds, data.cohesionPairs);
              const trainingBonus = trainingHallBonus(data.properties);
              const partyPower = Math.round(basePower * (1 + trainingBonus + cohesionBonus));
              const unmetRequirements = countUnmetRequirements(deployingContract, party);
              const chance     = Math.round(estimateSuccessChance(partyPower, deployingContract.requiredPower, unmetRequirements) * 100);
              return (
                <div className="panel panel-sm" style={{ marginBottom: '1rem' }}>
                  <span className="label">Party Power: </span>
                  <span className="value">{partyPower}</span>
                  <span className="label"> vs. {deployingContract.requiredPower} required · </span>
                  <span className="value">~{chance}% success</span>
                  {trainingBonus > 0 && (
                    <span className="label"> · +{Math.round(trainingBonus * 100)}% training bonus</span>
                  )}
                  {cohesionBonus > 0 && (
                    <span className="label"> · +{Math.round(cohesionBonus * 100)}% cohesion bonus</span>
                  )}
                  {unmetRequirements > 0 && (
                    <span className="label"> (missing {unmetRequirements} preferred requirement{unmetRequirements > 1 ? 's' : ''})</span>
                  )}
                </div>
              );
            })()}

            {deployError && <div style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{deployError}</div>}

            <div className="flex gap-sm justify-between">
              <button className="btn btn-secondary btn-sm" onClick={() => setDeployingContract(null)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                disabled={selectedAdventurerIds.length === 0 || deployMutation.isPending}
                onClick={() => deployMutation.mutate({ contractId: deployingContract.id, adventurerIds: selectedAdventurerIds })}
              >
                {deployMutation.isPending ? 'Deploying…' : 'Deploy Party'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PROPERTY_LABELS: Record<string, string> = {
  dormitory: 'Dormitory', training_hall: 'Training Hall',
  alchemy_lab: 'Alchemy Lab', library: 'Library',
  infirmary: 'Infirmary', armory: 'Armory',
  sanctuary: 'Sanctuary',
};

const BONUS_LABELS: Record<string, string> = {
  powerRatingBonus: 'Power rating',
  injuryRecoveryRate: 'Recovery speed',
  xpBonusPerLevel: 'XP gain',
  loyaltyRecoveryBonus: 'Loyalty recovery',
};

const ROLE_LABELS: Record<string, string> = {
  fighter: 'fighters', wizard: 'wizards', rogue: 'rogues', priest: 'priests',
};

// Role-vocation bonus keys (xpBonusPerLevel, loyaltyRecoveryBonus) are reused across every
// role-property (Armory/fighter, Library/wizard, ...) — the label needs to say which role
// this specific property's bonus applies to, or it'd read as if it applied to everyone.
const ROLE_BONUS_KEYS = new Set(['xpBonusPerLevel', 'loyaltyRecoveryBonus']);

function bonusLabel(propertyType: string, key: string): string {
  const base = BONUS_LABELS[key] ?? key;
  if (!ROLE_BONUS_KEYS.has(key)) return base;
  const role = PROPERTY_PARTY_ROLE[propertyType as keyof typeof PROPERTY_PARTY_ROLE];
  return role ? `${base} (${ROLE_LABELS[role]})` : base;
}

// Flat-count keys (not a percentage/multiplier, regardless of property) — a role-property
// bonus like "+1 extra loyalty point recovered per day" should never render as "+100%".
const FLAT_COUNT_KEYS = new Set(['loyaltyRecoveryBonus']);

// Bonus values come in different shapes depending on the key: XP-style multipliers (e.g.
// 1.1 = +10%), plain fractions (e.g. 0.1 = +10%), and flat counts (e.g. +1 loyalty point) —
// treating a flat count as a fraction would render it as a nonsensical percentage.
function formatBonusValue(key: string, value: number): string {
  if (FLAT_COUNT_KEYS.has(key)) return `+${value}`;
  if (value > 1) return `+${Math.round((value - 1) * 100)}%`;
  return `+${Math.round(value * 100)}%`;
}

// Compact "Needs X, Y" summary for a contract's preferred stat/vocation requirements — null
// if the contract has none. Used where there isn't room for full requirement badges (e.g.
// the awaiting-deployment list), unlike the fuller display in the deploy modal below.
function formatRequirements(c: ContractResponse): string | null {
  const parts = Object.entries(c.requiredStats).map(([stat, val]) => `${stat} ${val}+`);
  if (c.requiredVocation) parts.push(c.requiredVocation);
  return parts.length > 0 ? parts.join(', ') : null;
}
