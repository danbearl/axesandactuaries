import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { HIRE_REPUTATION_REQUIREMENTS } from '@adventurer-manager/types';
import type { Adventurer } from '@adventurer-manager/types';
import AdventurerCard from '../components/AdventurerCard.tsx';
import './AdventurerMarket.css';

export default function AdventurerMarket() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: playerData } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
  });

  const { data: marketData, isLoading } = useQuery({
    queryKey: ['adventurers', 'market'],
    queryFn: () => api.adventurers.market(),
  });

  const hireMutation = useMutation({
    mutationFn: (id: string) => api.adventurers.hire(id),
    onMutate: (id) => setHiringId(id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['player'] });
      queryClient.invalidateQueries({ queryKey: ['adventurers', 'market'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Hire failed'),
    onSettled: () => setHiringId(null),
  });

  const desperateMutation = useMutation({
    mutationFn: () => api.adventurers.desperateHire(),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['player'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Desperate hire failed'),
  });

  const gold        = playerData?.player.gold ?? 0;
  const playerRep   = playerData?.player.reputation ?? 0;
  const adventurers = marketData?.adventurers ?? [];
  const properties  = playerData?.properties ?? [];
  const hired       = (playerData?.adventurers ?? []).filter(a =>
    ['hired', 'on_adventure', 'injured'].includes(a.status),
  );
  const cheapestHire = adventurers.length > 0
    ? Math.min(...adventurers.map(a => a.hireCost))
    : Infinity;
  const desperateHireAvailable =
    hired.length === 0 && properties.length === 0 && gold < cheapestHire;

  const filtered = filter
    ? adventurers.filter(a =>
        a.heritage.toLowerCase().includes(filter.toLowerCase()) ||
        a.vocation.toLowerCase().includes(filter.toLowerCase()) ||
        a.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : adventurers;

  return (
    <div className="market-page">
      <div className="page-header">
        <h1>Hire Adventurers</h1>
        <span className="label">Today's available pool · Refreshes daily at midnight</span>
      </div>

      {error && (
        <div className="panel panel-sm" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {desperateHireAvailable && (
        <div className="panel panel-sm" style={{ borderColor: 'var(--gold)', marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Guild Emergency Assistance</h3>
          <p style={{ marginBottom: '0.75rem' }}>
            Your company has no adventurers, no properties, and insufficient funds to hire from the open market.
            A desperate soul is willing to join your ranks for free — their loyalty is fragile, but it's a start.
          </p>
          <button
            className="btn btn-primary btn-sm"
            disabled={desperateMutation.isPending}
            onClick={() => desperateMutation.mutate()}
          >
            {desperateMutation.isPending ? 'Recruiting…' : 'Accept Desperate Hire (Free)'}
          </button>
        </div>
      )}

      <div className="market-toolbar panel panel-sm">
        <div className="flex items-center gap-md">
          <div className="toolbar-stat">
            <span className="label">Your Treasury</span>
            <span className="currency">{gold.toLocaleString()} gp</span>
          </div>
          <div className="toolbar-stat">
            <span className="label">Available</span>
            <span className="value">{adventurers.length} adventurers</span>
          </div>
        </div>
        <input
          className="market-search"
          type="text"
          placeholder="Filter by name, heritage, or vocation…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {isLoading && <div className="empty-state">Loading adventurer pool…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="empty-state">
          {filter ? 'No adventurers match your search.' : 'The market is empty — check back after the daily reset.'}
        </div>
      )}

      <div className="market-grid">
        {filtered.map(adv => (
          <AdventurerCard
            key={adv.id}
            adventurer={adv as unknown as Adventurer}
            repRequired={HIRE_REPUTATION_REQUIREMENTS[adv.level]}
            onHire={gold >= adv.hireCost && playerRep >= (HIRE_REPUTATION_REQUIREMENTS[adv.level] ?? 0) && hiringId === null
              ? () => hireMutation.mutate(adv.id)
              : undefined}
          />
        ))}
      </div>

      <div className="market-notice">
        <div className="divider-ornate">NOTICE</div>
        <p>
          Adventurers in this pool are on the free market — other guild managers may hire them before you.
          Adventurers remain available for 48 hours before returning to wandering life. Wages are deducted
          daily; failure to pay wages will result in adventurers seeking employment elsewhere.
        </p>
      </div>
    </div>
  );
}
