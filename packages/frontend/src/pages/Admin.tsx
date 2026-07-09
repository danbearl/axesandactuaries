import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import './Admin.css';

export default function Admin() {
  const queryClient = useQueryClient();

  // ── Force-resolve adventures ──────────────────────────────────────────────
  const { data: adventuresData, isLoading: adventuresLoading } = useQuery({
    queryKey: ['admin', 'adventures'],
    queryFn: () => api.admin.adventures('in_progress'),
  });
  const adventures = adventuresData?.adventures ?? [];
  const [selectedAdventureId, setSelectedAdventureId] = useState('');

  const resolveMutation = useMutation({
    mutationFn: (outcome: 'success' | 'failure') =>
      api.admin.resolveAdventure(selectedAdventureId, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'adventures'] });
      queryClient.invalidateQueries({ queryKey: ['adventures'] });
      queryClient.invalidateQueries({ queryKey: ['player'] });
      setSelectedAdventureId('');
    },
  });

  // ── Adjust player treasury/reputation ─────────────────────────────────────
  const { data: playersData, isLoading: playersLoading } = useQuery({
    queryKey: ['admin', 'players'],
    queryFn: () => api.admin.players(),
  });
  const players = playersData?.players ?? [];
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [gold, setGold] = useState('');
  const [reputation, setReputation] = useState('');

  const selectedPlayer = players.find(p => p.id === selectedPlayerId);

  const adjustMutation = useMutation({
    mutationFn: () =>
      api.admin.adjustPlayer(selectedPlayerId, {
        gold: gold === '' ? undefined : Number(gold),
        reputation: reputation === '' ? undefined : Number(reputation),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'players'] });
      queryClient.invalidateQueries({ queryKey: ['player'] });
    },
  });

  function handleSelectPlayer(id: string) {
    setSelectedPlayerId(id);
    const p = players.find(pl => pl.id === id);
    setGold(p ? String(p.gold) : '');
    setReputation(p ? String(p.reputation) : '');
  }

  // ── Clear adventurer status ────────────────────────────────────────────────
  const [rosterPlayerId, setRosterPlayerId] = useState('');
  const { data: rosterData, isLoading: rosterLoading } = useQuery({
    queryKey: ['admin', 'players', rosterPlayerId, 'adventurers'],
    queryFn: () => api.admin.playerAdventurers(rosterPlayerId),
    enabled: !!rosterPlayerId,
  });
  const roster = rosterData?.adventurers ?? [];

  const clearStatusMutation = useMutation({
    mutationFn: (adventurerId: string) => api.admin.clearAdventurerStatus(adventurerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'players', rosterPlayerId, 'adventurers'] });
      queryClient.invalidateQueries({ queryKey: ['player'] });
    },
  });

  // ── Seed market ────────────────────────────────────────────────────────────
  const [seedAdventurerCount, setSeedAdventurerCount] = useState('10');

  const seedContractsMutation = useMutation({
    mutationFn: () => api.admin.seedContracts(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const seedAdventurersMutation = useMutation({
    mutationFn: () => api.admin.seedAdventurers(Number(seedAdventurerCount) || 1),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adventurers'] });
    },
  });

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Admin</h1>
        <span className="label">Testing tools — not for regular gameplay use</span>
      </div>

      <section className="panel">
        <h2>Force-Resolve Adventure</h2>
        <hr className="divider" />
        <div className="admin-field mt-md">
          <span className="label">In-Progress Adventure</span>
          <select value={selectedAdventureId} onChange={e => setSelectedAdventureId(e.target.value)}>
            <option value="">Select an adventure…</option>
            {adventures.map(a => (
              <option key={a.id} value={a.id}>{a.player.username} — {a.contract.title}</option>
            ))}
          </select>
        </div>
        {!adventuresLoading && adventures.length === 0 && (
          <div className="empty-state mt-sm">No adventures currently in progress.</div>
        )}
        <div className="admin-actions mt-md">
          <button
            className="btn btn-primary"
            disabled={!selectedAdventureId || resolveMutation.isPending}
            onClick={() => resolveMutation.mutate('success')}
          >
            Force Success
          </button>
          <button
            className="btn btn-danger"
            disabled={!selectedAdventureId || resolveMutation.isPending}
            onClick={() => resolveMutation.mutate('failure')}
          >
            Force Failure
          </button>
        </div>
        {resolveMutation.isError && (
          <div className="admin-error mt-sm">Failed to resolve adventure.</div>
        )}
      </section>

      <section className="panel mt-md">
        <h2>Adjust Player Treasury &amp; Reputation</h2>
        <hr className="divider" />
        <div className="admin-field mt-md">
          <span className="label">Player</span>
          <select value={selectedPlayerId} onChange={e => handleSelectPlayer(e.target.value)}>
            <option value="">Select a player…</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.username}{p.guildName ? ` (${p.guildName})` : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedPlayer && (
          <>
            <div className="admin-field-row mt-md">
              <label className="admin-field">
                <span className="label">Gold</span>
                <input type="number" value={gold} onChange={e => setGold(e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="label">Reputation</span>
                <input type="number" value={reputation} onChange={e => setReputation(e.target.value)} />
              </label>
            </div>
            <div className="admin-actions mt-md">
              <button
                className="btn btn-primary"
                disabled={adjustMutation.isPending}
                onClick={() => adjustMutation.mutate()}
              >
                {adjustMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              {adjustMutation.isSuccess && <span className="currency positive">Saved.</span>}
            </div>
            {adjustMutation.isError && <div className="admin-error mt-sm">Failed to update player.</div>}
          </>
        )}

        {!playersLoading && players.length === 0 && (
          <div className="empty-state mt-sm">No players found.</div>
        )}
      </section>

      <section className="panel mt-md">
        <h2>Clear Adventurer Status</h2>
        <hr className="divider" />
        <p className="label mt-sm">
          Resets an adventurer out of injured/resting/dead into a clean working state —
          bypasses recovery timers entirely, for testing.
        </p>
        <div className="admin-field mt-md">
          <span className="label">Player</span>
          <select value={rosterPlayerId} onChange={e => setRosterPlayerId(e.target.value)}>
            <option value="">Select a player…</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.username}{p.guildName ? ` (${p.guildName})` : ''}
              </option>
            ))}
          </select>
        </div>

        {rosterPlayerId && (
          rosterLoading ? (
            <div className="empty-state mt-sm">Loading roster…</div>
          ) : roster.length === 0 ? (
            <div className="empty-state mt-sm">This player has no adventurers.</div>
          ) : (
            <table className="admin-roster-table mt-md">
              <thead>
                <tr>
                  <th className="label">Name</th>
                  <th className="label">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {roster.map(adv => {
                  // "Resting" isn't its own status value — it's status='hired' plus a
                  // future restUntil — so without this check every resting adventurer
                  // shows as plain "hired", indistinguishable from a genuinely clear one.
                  const isResting = adv.status === 'hired' && !!adv.restUntil && new Date(adv.restUntil) > new Date();
                  const statusLabel = isResting ? 'resting' : adv.status;
                  const statusBadgeClass = isResting ? 'badge-status-resting' : `badge-status-${adv.status}`;
                  return (
                  <tr key={adv.id}>
                    <td>{adv.name}</td>
                    <td><span className={`badge ${statusBadgeClass}`}>{statusLabel}</span></td>
                    <td className="text-right">
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={clearStatusMutation.isPending}
                        onClick={() => clearStatusMutation.mutate(adv.id)}
                      >
                        Clear Status
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
        {clearStatusMutation.isError && (
          <div className="admin-error mt-sm">Failed to clear status.</div>
        )}
      </section>

      <section className="panel mt-md">
        <h2>Seed Market</h2>
        <hr className="divider" />
        <p className="label mt-sm">
          Adds new listings without touching anything already on the market — safe to run
          against a live database, unlike <code>pnpm db:seed</code>.
        </p>

        <div className="admin-actions mt-md">
          <button
            className="btn btn-primary"
            disabled={seedContractsMutation.isPending}
            onClick={() => seedContractsMutation.mutate()}
          >
            {seedContractsMutation.isPending ? 'Seeding…' : 'Seed Contracts'}
          </button>
          <span className="label">All tiers topped up to their population-scaled target</span>
          {seedContractsMutation.isSuccess && (
            <span className="currency positive">Added {seedContractsMutation.data.added}.</span>
          )}
        </div>
        {seedContractsMutation.isError && (
          <div className="admin-error mt-sm">Failed to seed contracts.</div>
        )}

        <div className="admin-field-row mt-md">
          <label className="admin-field">
            <span className="label">Adventurer Count</span>
            <input
              type="number"
              min={1}
              max={100}
              value={seedAdventurerCount}
              onChange={e => setSeedAdventurerCount(e.target.value)}
            />
          </label>
        </div>
        <div className="admin-actions mt-md">
          <button
            className="btn btn-primary"
            disabled={seedAdventurersMutation.isPending}
            onClick={() => seedAdventurersMutation.mutate()}
          >
            {seedAdventurersMutation.isPending ? 'Seeding…' : 'Seed Adventurers'}
          </button>
          {seedAdventurersMutation.isSuccess && (
            <span className="currency positive">Added {seedAdventurersMutation.data.added}.</span>
          )}
        </div>
        {seedAdventurersMutation.isError && (
          <div className="admin-error mt-sm">Failed to seed adventurers.</div>
        )}
      </section>
    </div>
  );
}
