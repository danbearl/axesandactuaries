import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { XP_TO_LEVEL, MAX_LEVEL } from '@axes-actuaries/types';
import type { Adventurer } from '@axes-actuaries/types';
import AdventurerCard from '../components/AdventurerCard.tsx';
import './AdventurerDetail.css';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In Progress', completed: 'Completed', failed: 'Failed',
};

function InjuryStatus({ recoveryUntil }: { recoveryUntil: string }) {
  const [remaining, setRemaining] = useState(new Date(recoveryUntil).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(recoveryUntil).getTime() - Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, [recoveryUntil]);

  const formatted = (() => {
    if (remaining <= 0) return 'Recovered — refresh to update';
    const totalMin = Math.floor(remaining / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
  })();

  return (
    <div className="panel panel-sm" style={{ borderColor: 'var(--crimson)' }}>
      <div className="flex items-center gap-sm">
        <span className="badge badge-status-injured">Injured</span>
        <span className="label">{formatted}</span>
      </div>
    </div>
  );
}

function RestStatus({ restUntil }: { restUntil: string }) {
  const [remaining, setRemaining] = useState(new Date(restUntil).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(restUntil).getTime() - Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, [restUntil]);

  const formatted = (() => {
    if (remaining <= 0) return 'Rested — refresh to update';
    const totalMin = Math.floor(remaining / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
  })();

  return (
    <div className="panel panel-sm" style={{ borderColor: 'var(--slate-light)' }}>
      <div className="flex items-center gap-sm">
        <span className="badge badge-status-resting">Resting</span>
        <span className="label">{formatted}</span>
      </div>
    </div>
  );
}

export default function AdventurerDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['adventurers', id],
    queryFn: () => api.adventurers.get(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>Loading adventurer…</div>;
  }

  if (isError || !data) {
    return (
      <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>
        <h2>Adventurer not found</h2>
        <Link to="/" className="btn btn-secondary mt-md">← Back to Dashboard</Link>
      </div>
    );
  }

  const { adventurer, stats, recent } = data;

  const currentLevelXp = XP_TO_LEVEL[adventurer.level] ?? 0;
  const nextLevelXp = XP_TO_LEVEL[adventurer.level + 1] as number | undefined;
  const isMaxLevel = adventurer.level >= MAX_LEVEL || nextLevelXp === undefined;
  const levelProgress = isMaxLevel
    ? 100
    : Math.min(100, Math.max(0, ((adventurer.experience - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100));

  const successRate = stats.totalAdventures > 0
    ? Math.round((stats.completed / stats.totalAdventures) * 100)
    : null;

  return (
    <div className="adventurer-detail">
      <div className="flex items-center gap-md mb-md">
        <Link to="/" className="btn btn-secondary btn-sm">← Dashboard</Link>
        <h1>{adventurer.name}</h1>
      </div>

      <div className="detail-grid">
        <AdventurerCard adventurer={adventurer as unknown as Adventurer} />

        <div className="flex-col gap-md">
          <div className="panel">
            <h2>Level Progress</h2>
            <hr className="divider" />
            <div className="mt-md">
              <div className="flex justify-between items-center mb-sm">
                <span className="label">Level {adventurer.level}</span>
                <span className="label">
                  {isMaxLevel ? 'Max Level' : `${adventurer.experience} / ${nextLevelXp} XP`}
                </span>
              </div>
              <div className="at-progress-track">
                <div className="at-progress-fill" style={{ width: `${levelProgress}%` }} />
              </div>
            </div>
          </div>

          {adventurer.status === 'injured' && adventurer.injuryRecoveryUntil && (
            <InjuryStatus recoveryUntil={adventurer.injuryRecoveryUntil} />
          )}

          {adventurer.status === 'hired' && adventurer.restUntil && new Date(adventurer.restUntil) > new Date() && (
            <RestStatus restUntil={adventurer.restUntil} />
          )}

          <div className="panel">
            <h2>Career Record</h2>
            <hr className="divider" />
            <div className="detail-stats mt-md">
              <div className="detail-stat">
                <span className="label">Adventures Completed</span>
                <span className="value">{stats.completed}</span>
              </div>
              <div className="detail-stat">
                <span className="label">Adventures Failed</span>
                <span className="value">{stats.failed}</span>
              </div>
              <div className="detail-stat">
                <span className="label">Success Rate</span>
                <span className="value">{successRate === null ? '—' : `${successRate}%`}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="panel mt-md">
        <h2>Recent Contracts</h2>
        <hr className="divider" />
        {recent.length === 0 ? (
          <div className="empty-state">No adventures yet.</div>
        ) : (
          <div className="flex-col gap-sm mt-md">
            {recent.map(entry => (
              <div key={entry.adventureId} className="property-row">
                <div>
                  <div className="value">{entry.contractTitle}</div>
                  <div className="label">
                    <span className={`badge badge-tier-${entry.contractTier}`}>{entry.contractTier}</span>{' '}
                    {formatDate(entry.createdAt)}
                  </div>
                </div>
                <span className={`badge badge-status-${entry.status}`}>
                  {STATUS_LABELS[entry.status] ?? entry.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
