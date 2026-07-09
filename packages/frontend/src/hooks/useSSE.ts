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
        // Was ['market-adventurers'] — didn't match AdventurerMarket.tsx's actual
        // query key (['adventurers', 'market']), so this invalidation was a silent
        // no-op; prefix-matching ['adventurers'] here to match how every other
        // handler in this file invalidates (see 'daily_summary' above).
        void queryClient.invalidateQueries({ queryKey: ['adventurers'] });
      });

      // Fired when the Market GC awards a bid-won contract to this player.
      es.addEventListener('contract_awarded', () => {
        void queryClient.invalidateQueries({ queryKey: ['contracts', 'mine'] });
        void queryClient.invalidateQueries({ queryKey: ['contracts', 'market'] });
      });

      // Fired when the Market GC fails a contract for missing its deploy-by deadline.
      es.addEventListener('contract_expired', () => {
        void queryClient.invalidateQueries({ queryKey: ['contracts', 'mine'] });
        void queryClient.invalidateQueries({ queryKey: ['player'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      });

      // One generic event for every guild-events-feed entry (contract completion/failure,
      // adventurer quit/injury-recovery/rest-completion, and any future type added to
      // services/playerEvents.ts) — prefix-matches both ['feed', page, filter] (Feed.tsx) and
      // ['feed', 'recent'] (Dashboard widget). Adding a new event type never needs a new
      // handler here.
      es.addEventListener('player_event', () => {
        void queryClient.invalidateQueries({ queryKey: ['feed'] });
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
