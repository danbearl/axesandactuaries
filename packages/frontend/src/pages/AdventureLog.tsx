import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import './AdventureLog.css';

const PAGE_SIZE = 15;

export default function AdventureLog() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['adventures', 'history', page],
    queryFn: () => api.adventures.history(PAGE_SIZE, page * PAGE_SIZE),
  });

  const adventures = data?.adventures ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="adventure-log-page">
      <div className="page-header">
        <h1>Adventure Log</h1>
        <span className="label">A record of every completed and failed adventure</span>
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="empty-state">Loading log…</div>
        ) : adventures.length === 0 ? (
          <div className="empty-state">No adventures resolved yet.</div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th className="label">Date Completed</th>
                <th className="label">Contract</th>
                <th className="label">Tier</th>
                <th className="label">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {adventures.map(adv => (
                <tr
                  key={adv.id}
                  className="log-table-row"
                  onClick={() => navigate(`/adventures/${adv.id}`)}
                >
                  <td className="label">
                    {adv.resolvedAt && new Date(adv.resolvedAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </td>
                  <td>{adv.contract.title}</td>
                  <td><span className={`badge badge-tier-${adv.contract.tier}`}>{adv.contract.tier}</span></td>
                  <td>
                    <span className={`badge badge-status-${adv.status}`}>
                      {adv.status === 'completed' ? 'Success' : 'Failure'}
                    </span>
                  </td>
                </tr>
              ))}
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
