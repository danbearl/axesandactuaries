import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import './AdventureTimer.css';

interface AdventureForTimer {
  id: string;
  startsAt: string;
  completesAt: string;
  contract: {
    title: string;
    tier: string;
    rewardGold: number;
    reputationReward: number;
  };
  adventurers: Array<{ adventurer: { name: string } }>;
}

interface Props {
  adventure: AdventureForTimer;
}

const formatDuration = (ms: number): string => {
  if (ms <= 0) return 'Completing…';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export default function AdventureTimer({ adventure }: Props) {
  const queryClient = useQueryClient();
  const fallbackFiredRef = useRef(false);

  const [remaining, setRemaining] = useState(
    new Date(adventure.completesAt).getTime() - Date.now(),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(adventure.completesAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [adventure.completesAt]);

  // Fallback refetch: if the SSE event never fires (e.g. Redis down), poll
  // after 65s once the timer hits zero (the worker runs every minute).
  useEffect(() => {
    if (remaining > 0 || fallbackFiredRef.current) return;
    fallbackFiredRef.current = true;
    const id = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['adventures'] });
    }, 65_000);
    return () => clearTimeout(id);
  }, [remaining, queryClient]);

  const total = new Date(adventure.completesAt).getTime() - new Date(adventure.startsAt).getTime();
  const elapsed = total - remaining;
  const progress = Math.min(100, Math.max(0, (elapsed / total) * 100));

  const partyNames = adventure.adventurers.map(aa => aa.adventurer.name.split(' ')[0]).join(', ');
  const { contract } = adventure;

  return (
    <Link to={`/adventures/${adventure.id}`} className="adventure-timer-link">
      <div className="adventure-timer">
        <div className="at-header">
          <div>
            <div className="at-title">{contract.title}</div>
            <div className="flex gap-xs items-center mt-sm">
              <span className={`badge badge-tier-${contract.tier}`}>{contract.tier}</span>
              <span className="label">Party: {partyNames || 'Unknown'}</span>
            </div>
          </div>
          <div className="at-timer">{formatDuration(remaining)}</div>
        </div>
        <div className="at-progress-track mt-sm">
          <div className="at-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="at-footer">
          <span className="label">Reward: <span className="currency">{contract.rewardGold} gp</span> · +{contract.reputationReward} rep</span>
        </div>
      </div>
    </Link>
  );
}
