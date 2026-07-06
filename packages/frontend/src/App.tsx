import { Routes, Route } from 'react-router-dom';
import { SignIn, Show, useAuth } from '@clerk/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import Navigation from './components/Navigation.tsx';
import { useSSE } from './hooks/useSSE.ts';
import Dashboard from './pages/Dashboard.tsx';
import AdventurerMarket from './pages/AdventurerMarket.tsx';
import ContractMarket from './pages/ContractMarket.tsx';
import Properties from './pages/Properties.tsx';
import AdventureDetail from './pages/AdventureDetail.tsx';
import AdventurerDetail from './pages/AdventurerDetail.tsx';
import Transactions from './pages/Transactions.tsx';
import Profile from './pages/Profile.tsx';
import Wiki from './pages/Wiki.tsx';
import Onboarding from './pages/Onboarding.tsx';
import { api } from './lib/api.ts';

function AuthenticatedApp() {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  useSSE();

  // Sync the Clerk user to our database on every login
  const syncMutation = useMutation({
    mutationFn: () => api.auth.sync(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['player'] }),
  });

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      syncMutation.mutate();
    }
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
    enabled: isLoaded && isSignedIn,
  });

  if (!isLoaded || isLoading || syncMutation.isPending) {
    return (
      <div className="app-shell">
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-light)' }}>
          Loading guild records…
        </div>
      </div>
    );
  }

  if (!data) return null;

  // First login (or a pre-existing player who predates this feature): gate the whole app
  // behind picking a handle and guild name before showing the nav/dashboard.
  if (!data.player.guildName) {
    return <Onboarding player={data.player} />;
  }

  return (
    <div className="app-shell">
      <Navigation player={data.player} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/market/adventurers" element={<AdventurerMarket />} />
          <Route path="/market/contracts" element={<ContractMarket />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/adventures/:id" element={<AdventureDetail />} />
          <Route path="/adventurers/:id" element={<AdventurerDetail />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/wiki" element={<Wiki />} />
          <Route path="/wiki/:slug" element={<Wiki />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--parchment-dark)',
        }}>
          <SignIn routing="hash" />
        </div>
      </Show>
      <Show when="signed-in">
        <AuthenticatedApp />
      </Show>
    </>
  );
}
