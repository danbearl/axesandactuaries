import { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';

export function useSSE() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSignedIn) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    async function connect() {
      const token = await getToken();
      if (!token) return;

      es = new EventSource(`/api/v1/events?token=${encodeURIComponent(token)}`);

      es.addEventListener('adventure_completed', () => {
        void queryClient.invalidateQueries({ queryKey: ['adventures'] });
        void queryClient.invalidateQueries({ queryKey: ['player'] });
      });

      es.addEventListener('daily_summary', () => {
        void queryClient.invalidateQueries({ queryKey: ['player'] });
        void queryClient.invalidateQueries({ queryKey: ['adventurers'] });
      });

      es.addEventListener('market_update', () => {
        void queryClient.invalidateQueries({ queryKey: ['contracts'] });
        void queryClient.invalidateQueries({ queryKey: ['market-adventurers'] });
      });

      // Fired when the Market GC awards a bid-won contract to this player.
      es.addEventListener('contract_awarded', () => {
        void queryClient.invalidateQueries({ queryKey: ['contracts', 'mine'] });
        void queryClient.invalidateQueries({ queryKey: ['contracts', 'market'] });
      });

      es.onerror = () => {
        es?.close();
        es = null;
        reconnectTimer = setTimeout(() => { void connect(); }, 5_000);
      };
    }

    void connect();

    return () => {
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
}
