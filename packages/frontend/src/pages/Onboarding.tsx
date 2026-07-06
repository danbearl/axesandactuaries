import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type PlayerResponse } from '../lib/api.ts';
import './Onboarding.css';

interface Props {
  player: PlayerResponse;
}

export default function Onboarding({ player }: Props) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(player.username);
  const [guildName, setGuildName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.player.completeOnboarding(username.trim(), guildName.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="onboarding-shell">
      <form className="panel onboarding-panel" onSubmit={handleSubmit}>
        <div className="page-header">
          <h1>Charter a New Guild</h1>
          <span className="label">Set your handle and name your guild to begin</span>
        </div>

        <div className="divider mt-md mb-md" />

        <label className="onboarding-field">
          <span className="label">Your Handle</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={2}
            maxLength={40}
            required
            autoFocus
          />
        </label>

        <label className="onboarding-field">
          <span className="label">Guild Name</span>
          <input
            type="text"
            value={guildName}
            onChange={(e) => setGuildName(e.target.value)}
            placeholder="e.g. The Ashen Compact"
            minLength={2}
            maxLength={60}
            required
          />
        </label>

        {error && <div className="onboarding-error">{error}</div>}

        <button type="submit" className="btn btn-primary mt-md" disabled={mutation.isPending}>
          {mutation.isPending ? 'Founding…' : 'Found Your Guild'}
        </button>
      </form>
    </div>
  );
}
