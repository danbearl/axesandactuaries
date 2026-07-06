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
    </div>
  );
}
