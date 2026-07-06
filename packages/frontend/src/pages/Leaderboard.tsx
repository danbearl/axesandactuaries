import { useQuery } from '@tanstack/react-query';
import { api, type LeaderboardEntry } from '../lib/api.ts';
import './Leaderboard.css';

function LeaderboardRow({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  return (
    <tr className={`leaderboard-row ${isMe ? 'leaderboard-row-me' : ''}`}>
      <td className="leaderboard-rank">#{entry.rank}</td>
      <td>
        <div className="value">{entry.guildName ?? entry.username}</div>
        <div className="label">led by {entry.username}</div>
      </td>
      <td className="text-right">
        <span className="value">{entry.score.toLocaleString()}</span>
      </td>
    </tr>
  );
}

export default function Leaderboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.leaderboard.get(),
  });

  if (isLoading || !data) {
    return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>Loading leaderboard…</div>;
  }

  const { top, me, nearby } = data;

  return (
    <div className="leaderboard-page">
      <div className="page-header">
        <h1>Guild Leaderboard</h1>
        <span className="label">Ranked by reputation, party strength, assets, and contract success rate</span>
      </div>

      <div className="panel">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="label">Rank</th>
              <th className="label">Guild</th>
              <th className="label text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {top.map(entry => (
              <LeaderboardRow key={entry.playerId} entry={entry} isMe={entry.playerId === me.playerId} />
            ))}
          </tbody>
        </table>
      </div>

      {nearby.length > 0 && (
        <div className="panel mt-md">
          <h2 className="mb-md">Your Ranking</h2>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th className="label">Rank</th>
                <th className="label">Guild</th>
                <th className="label text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {nearby.map(entry => (
                <LeaderboardRow key={entry.playerId} entry={entry} isMe={entry.playerId === me.playerId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
