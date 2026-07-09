import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { PlayerEventType } from '@axes-actuaries/types';
import './Feed.css';

const PAGE_SIZE = 20;

const EVENT_TYPE_LABELS: Record<PlayerEventType, string> = {
  contract_completed:       'Contract Completed',
  contract_failed:          'Contract Failed',
  adventurer_quit:          'Adventurer Quit',
  adventurer_recovered:     'Recovered from Injury',
  adventurer_rest_complete: 'Finished Resting',
};

const FILTERS: Array<PlayerEventType | 'all'> = [
  'all', 'contract_completed', 'contract_failed', 'adventurer_quit', 'adventurer_recovered', 'adventurer_rest_complete',
];

// Only these types have a meaningful destination — an adventurer who quit is no longer in
// this player's employ (see routes/adventurers.ts's employer check), so that event's
// referenceId can't be linked to, even though it's stored.
const LINKABLE_TYPES = new Set<PlayerEventType>(['contract_completed', 'contract_failed']);

export default function Feed() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<PlayerEventType | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['feed', page, filter],
    queryFn: () => api.feed.list(PAGE_SIZE, page * PAGE_SIZE, filter),
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const changeFilter = (f: PlayerEventType | 'all') => {
    setFilter(f);
    setPage(0);
  };

  return (
    <div className="feed-page">
      <div className="page-header">
        <h1>Guild Feed</h1>
        <span className="label">Recent events across your guild</span>
      </div>

      <div className="feed-filters panel panel-sm">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`tier-tab ${filter === f ? 'active' : ''}`}
            onClick={() => changeFilter(f)}
          >
            {f === 'all' ? 'All' : EVENT_TYPE_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="empty-state">Loading feed…</div>
        ) : events.length === 0 ? (
          <div className="empty-state">No events yet.</div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th className="label">Date</th>
                <th className="label">Event</th>
                <th className="label">Type</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => {
                const linkable = LINKABLE_TYPES.has(ev.type as PlayerEventType) && ev.referenceId;
                return (
                  <tr
                    key={ev.id}
                    className={linkable ? 'log-table-row' : 'log-table-row log-table-row-static'}
                    onClick={linkable ? () => navigate(`/adventures/${ev.referenceId}`) : undefined}
                  >
                    <td className="label">
                      {new Date(ev.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
                    <td>{ev.summary}</td>
                    <td>
                      <span className="feed-type-tag">
                        {EVENT_TYPE_LABELS[ev.type as PlayerEventType] ?? ev.type}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {total > 0 && (
          <div className="log-pagination mt-md">
            <button
              className="btn btn-secondary btn-sm"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              ← Previous
            </button>
            <span className="label">Page {page + 1} of {pageCount}</span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage(p => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
