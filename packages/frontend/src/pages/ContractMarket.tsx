import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ContractResponse, type AdventurerResponse } from '../lib/api.ts';
import type { Contract } from '@adventurer-manager/types';
import { BIDDING_CONTRACT_TIERS, CONTRACT_TIER_REPUTATION_REQUIREMENTS } from '@adventurer-manager/types';
import ContractCard from '../components/ContractCard.tsx';
import './ContractMarket.css';

const WELFARE_COOLDOWN_HOURS = 48;

const TIERS = ['errand', 'standard', 'dangerous', 'legendary'] as const;

export default function ContractMarket() {
  const queryClient = useQueryClient();
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deployingContract, setDeployingContract] = useState<ContractResponse | null>(null);
  const [selectedAdventurerIds, setSelectedAdventurerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: contractData, isLoading } = useQuery({
    queryKey: ['contracts', 'market'],
    queryFn: () => api.contracts.market(),
  });

  const { data: playerData } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
  });

  const { data: welfareData } = useQuery({
    queryKey: ['contracts', 'welfare'],
    queryFn: () => api.contracts.welfare(),
  });

  const contracts        = contractData?.contracts ?? [];
  const hiredAdventurers = (playerData?.adventurers ?? []).filter(a => a.status === 'hired');
  const playerRep        = playerData?.player.reputation ?? 0;

  const welfareAvailable     = welfareData?.available ?? false;
  const welfareCooldownUntil = welfareData?.cooldownUntil ? new Date(welfareData.cooldownUntil) : null;

  const welfareMutation = useMutation({
    mutationFn: () => api.contracts.welfareAccept(),
    onSuccess: ({ contract }) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['contracts', 'welfare'] });
      setDeployingContract(contract);
      setSelectedAdventurerIds([]);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to claim welfare contract'),
  });

  const acceptMutation = useMutation({
    mutationFn: ({ contractId, adventurerIds }: { contractId: string; adventurerIds: string[] }) =>
      api.contracts.accept(contractId).then(() =>
        api.adventures.start(contractId, adventurerIds)
      ),
    onSuccess: () => {
      setError(null);
      setDeployingContract(null);
      setSelectedAdventurerIds([]);
      queryClient.invalidateQueries({ queryKey: ['player'] });
      queryClient.invalidateQueries({ queryKey: ['contracts', 'market'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to accept contract'),
  });

  const bidMutation = useMutation({
    mutationFn: (contractId: string) => api.contracts.bid(contractId),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['contracts', 'market'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to place bid'),
  });

  const filtered = selectedTier === 'all'
    ? contracts
    : contracts.filter(c => c.tier === selectedTier);

  const toggleAdventurer = (id: string) => {
    setSelectedAdventurerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleDeploy = () => {
    if (!deployingContract || selectedAdventurerIds.length === 0) return;
    acceptMutation.mutate({
      contractId: deployingContract.id,
      adventurerIds: selectedAdventurerIds,
    });
  };

  return (
    <div className="contract-page">
      <div className="page-header">
        <h1>Contract Board</h1>
        <span className="label">Available contracts · Refreshes daily at midnight</span>
      </div>

      {error && (
        <div className="panel panel-sm" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="contract-tier-tabs panel panel-sm">
        <button
          className={`tier-tab ${selectedTier === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedTier('all')}
        >
          All ({contracts.length})
        </button>
        {TIERS.map(tier => {
          const count = contracts.filter(c => c.tier === tier).length;
          return (
            <button
              key={tier}
              className={`tier-tab tier-tab-${tier} ${selectedTier === tier ? 'active' : ''}`}
              onClick={() => setSelectedTier(tier)}
            >
              {tier.charAt(0).toUpperCase() + tier.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      <div className="contract-info panel panel-sm">
        <p>
          <strong>Errand / Standard:</strong> Accept directly — first player to take it wins.{' '}
          <strong>Dangerous / Legendary:</strong> Competitive bid — highest-reputation bidder wins when the bid window closes.
          {CONTRACT_TIER_REPUTATION_REQUIREMENTS.dangerous > 0 && (
            <> Requires {CONTRACT_TIER_REPUTATION_REQUIREMENTS.dangerous} rep for Dangerous, {CONTRACT_TIER_REPUTATION_REQUIREMENTS.legendary} rep for Legendary.</>
          )}
        </p>
      </div>

      {(welfareAvailable || welfareCooldownUntil) && (
        <div className="panel panel-sm" style={{ borderColor: 'var(--gold)', marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Guild Charity Work</h3>
          {welfareAvailable && welfareData?.contract ? (
            <>
              <p style={{ marginBottom: '0.25rem' }}>{welfareData.contract.description}</p>
              <p className="label" style={{ marginBottom: '0.75rem' }}>
                Reward: {welfareData.contract.rewardGold} gp · +{welfareData.contract.reputationReward} rep ·{' '}
                {welfareData.contract.durationHours}h duration · No penalty on failure
              </p>
              <button
                className="btn btn-primary btn-sm"
                disabled={welfareMutation.isPending}
                onClick={() => welfareMutation.mutate()}
              >
                {welfareMutation.isPending ? 'Claiming…' : 'Claim Guild Errand'}
              </button>
            </>
          ) : welfareCooldownUntil ? (
            <p className="label">
              Guild charity work is on cooldown for {WELFARE_COOLDOWN_HOURS}h after each claim.
              Available again: {welfareCooldownUntil.toLocaleString()}
            </p>
          ) : null}
        </div>
      )}

      {isLoading && <div className="empty-state">Loading contracts…</div>}

      <div className="contract-list">
        {!isLoading && filtered.length === 0 && (
          <div className="empty-state">No contracts available in this tier.</div>
        )}
        {filtered.map(contract => {
          const isBiddingTier = BIDDING_CONTRACT_TIERS.includes(contract.tier as 'dangerous' | 'legendary');
          const repRequired = CONTRACT_TIER_REPUTATION_REQUIREMENTS[contract.tier as keyof typeof CONTRACT_TIER_REPUTATION_REQUIREMENTS] ?? 0;
          const hasRep = playerRep >= repRequired;

          return (
            <div
              key={contract.id}
              onClick={() => setExpandedId(expandedId === contract.id ? null : contract.id)}
              className="contract-list-item"
            >
              <ContractCard
                contract={contract as unknown as Contract}
                expanded={expandedId === contract.id}
                playerRep={playerRep}
                onAccept={!isBiddingTier && hasRep
                  ? (e) => {
                      (e as React.MouseEvent).stopPropagation();
                      setDeployingContract(contract);
                      setSelectedAdventurerIds([]);
                      setError(null);
                    }
                  : undefined}
                onBid={isBiddingTier && hasRep && !bidMutation.isPending
                  ? (e) => {
                      (e as React.MouseEvent).stopPropagation();
                      bidMutation.mutate(contract.id);
                    }
                  : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* Party selection modal — for direct-accept and welfare contracts */}
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
              <div className="empty-state">No adventurers available. Hire some from the market first.</div>
            ) : (
              <div className="flex-col gap-sm" style={{ marginBottom: '1rem' }}>
                {hiredAdventurers.map((adv: AdventurerResponse) => {
                  const checked = selectedAdventurerIds.includes(adv.id);
                  return (
                    <label
                      key={adv.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAdventurer(adv.id)}
                      />
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
              const party = hiredAdventurers.filter(a => selectedAdventurerIds.includes(a.id));
              const partyPower = party.reduce((s, a) => s + a.powerRating, 0);
              const ratio = partyPower / deployingContract.requiredPower;
              const chance = Math.min(90, Math.round((0.3 + ratio * 0.5) * 100));
              return (
                <div className="panel panel-sm" style={{ marginBottom: '1rem' }}>
                  <span className="label">Party Power: </span>
                  <span className="value">{partyPower}</span>
                  <span className="label"> vs. {deployingContract.requiredPower} required · </span>
                  <span className="value">~{chance}% success</span>
                </div>
              );
            })()}

            {error && <div style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</div>}

            <div className="flex gap-sm justify-between">
              <button className="btn btn-secondary btn-sm" onClick={() => setDeployingContract(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={selectedAdventurerIds.length === 0 || acceptMutation.isPending}
                onClick={handleDeploy}
              >
                {acceptMutation.isPending ? 'Deploying…' : 'Deploy Party'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
