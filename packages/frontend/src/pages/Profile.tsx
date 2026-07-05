import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import './Profile.css';

export default function Profile() {
  const { data, isLoading } = useQuery({
    queryKey: ['player', 'profile'],
    queryFn: () => api.player.profile(),
  });

  if (isLoading || !data) {
    return <div className="profile-page"><div className="empty-state">Loading…</div></div>;
  }

  const { player, stats } = data;
  const memberSince = new Date(player.createdAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const totalAdventures = stats.adventuresCompleted + stats.adventuresFailed;
  const successRate = totalAdventures > 0
    ? Math.round((stats.adventuresCompleted / totalAdventures) * 100)
    : null;

  return (
    <div className="profile-page">
      <div className="page-header">
        <h1>{player.username}</h1>
        <span className="label">Guild Charter holder since {memberSince}</span>
      </div>

      <div className="panel profile-summary">
        <div className="profile-summary-grid">
          <div className="ps-item">
            <span className="label">Treasury</span>
            <span className="currency" style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
              {player.gold.toLocaleString()} gp
            </span>
          </div>
          <div className="ps-item">
            <span className="label">Reputation</span>
            <span className="value" style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
              {player.reputation}
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="mb-md">Career Record</h2>
        <div className="profile-summary-grid">
          <div className="ps-item">
            <span className="label">Adventures Completed</span>
            <span className="value">{stats.adventuresCompleted}</span>
          </div>
          <div className="ps-item">
            <span className="label">Adventures Failed</span>
            <span className="value">{stats.adventuresFailed}</span>
          </div>
          <div className="ps-item">
            <span className="label">Success Rate</span>
            <span className="value">{successRate === null ? '—' : `${successRate}%`}</span>
          </div>
          <div className="ps-item">
            <span className="label">Lifetime Gold Earned</span>
            <span className="currency">{stats.lifetimeGoldEarned.toLocaleString()} gp</span>
          </div>
          <div className="ps-item">
            <span className="label">Adventurers Hired</span>
            <span className="value">{stats.adventurersHired}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
