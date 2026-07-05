import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ContractResponse, type AdventurerResponse } from '../lib/api.ts';
import AdventurerCard from '../components/AdventurerCard.tsx';
import AdventureTimer from '../components/AdventureTimer.tsx';
import type { Adventurer } from '@axes-actuaries/types';
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
  const hiredAdventurers = hired.filter(a => a.status === 'hired');

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
          <div className="summary-big">{hired.length}</div>
          <div className="summary-sub">
            <span className="label">
              {hired.filter(a => a.status === 'hired').length} available ·{' '}
              {hired.filter(a => a.status === 'on_adventure').length} deployed ·{' '}
              {hired.filter(a => a.status === 'injured').length} injured
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
            You won these contracts through competitive bidding. Assign a party to deploy them before they expire.
          </p>
          <div className="flex-col gap-sm">
            {pendingContracts.map(c => (
              <div key={c.id} className="property-row">
                <div>
                  <div className="value">{c.title}</div>
                  <div className="label">{c.tier} · {c.rewardGold.toLocaleString()} gp · Power {c.requiredPower}</div>
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

        {/* Properties */}
        <section className="panel">
          <div className="flex items-center justify-between mb-md">
            <h2>Properties</h2>
            <Link to="/properties" className="btn btn-sm btn-secondary">Manage</Link>
          </div>

          {properties.length === 0 ? (
            <div className="empty-state">No properties built. A dormitory improves adventurer retention.</div>
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
                      <div key={k}>{BONUS_LABELS[k] ?? k}: {typeof v === 'number' && v > 1 ? `+${Math.round((v - 1) * 100)}%` : `+${v}`}</div>
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

            {hiredAdventurers.length === 0 ? (
              <div className="empty-state">No idle adventurers available to deploy.</div>
            ) : (
              <div className="flex-col gap-sm" style={{ marginBottom: '1rem' }}>
                {hiredAdventurers.map((adv: AdventurerResponse) => {
                  const checked = selectedAdventurerIds.includes(adv.id);
                  return (
                    <label
                      key={adv.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleAdventurer(adv.id)} />
                      <div>
                        <span className="value">{adv.name}</span>{' '}
                        <span className="label">{adv.vocation} · Power {adv.powerRating} · Lv.{adv.level}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {selectedAdventurerIds.length > 0 && (() => {
              const party      = hiredAdventurers.filter(a => selectedAdventurerIds.includes(a.id));
              const partyPower = party.reduce((s, a) => s + a.powerRating, 0);
              const ratio      = partyPower / deployingContract.requiredPower;
              const chance     = Math.min(90, Math.round((0.3 + ratio * 0.5) * 100));
              return (
                <div className="panel panel-sm" style={{ marginBottom: '1rem' }}>
                  <span className="label">Party Power: </span>
                  <span className="value">{partyPower}</span>
                  <span className="label"> vs. {deployingContract.requiredPower} required · </span>
                  <span className="value">~{chance}% success</span>
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
};

const BONUS_LABELS: Record<string, string> = {
  xpMultiplier: 'XP gain',
  powerRatingBonus: 'Power rating',
  injuryRecoveryRate: 'Recovery speed',
  wageDiscount: 'Wage discount',
};
