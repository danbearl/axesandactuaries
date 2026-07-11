import { Routes, Route } from 'react-router-dom';
import { SignIn, Show, useAuth } from '@clerk/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, lazy, Suspense } from 'react';
import Navigation from './components/Navigation.tsx';
import { useSSE } from './hooks/useSSE.ts';
import { api } from './lib/api.ts';

// Route-level code-splitting: each page becomes its own chunk, fetched on navigation
// instead of all bundled into one ~950KB script loaded up front.
const Dashboard = lazy(() => import('./pages/Dashboard.tsx'));
const AdventurerMarket = lazy(() => import('./pages/AdventurerMarket.tsx'));
const ContractMarket = lazy(() => import('./pages/ContractMarket.tsx'));
const Properties = lazy(() => import('./pages/Properties.tsx'));
const AdventureDetail = lazy(() => import('./pages/AdventureDetail.tsx'));
const Feed = lazy(() => import('./pages/Feed.tsx'));
const AdventurerDetail = lazy(() => import('./pages/AdventurerDetail.tsx'));
const Transactions = lazy(() => import('./pages/Transactions.tsx'));
const Profile = lazy(() => import('./pages/Profile.tsx'));
const Wiki = lazy(() => import('./pages/Wiki.tsx'));
const Leaderboard = lazy(() => import('./pages/Leaderboard.tsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const Announcements = lazy(() => import('./pages/Announcements.tsx'));

const PageFallback = () => (
  <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>Loading…</div>
);

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
    return (
      <Suspense fallback={<PageFallback />}>
        <Onboarding player={data.player} />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <Navigation player={data.player} />
      <main className="main-content">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/market/adventurers" element={<AdventurerMarket />} />
            <Route path="/market/contracts" element={<ContractMarket />} />
            <Route path="/properties" element={<Properties />} />
            <Route path="/adventures" element={<Feed />} />
            <Route path="/adventures/:id" element={<AdventureDetail />} />
            <Route path="/adventurers/:id" element={<AdventurerDetail />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/wiki" element={<Wiki />} />
            <Route path="/wiki/:slug" element={<Wiki />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/announcements" element={<Announcements />} />
            {data.player.isAdmin && <Route path="/admin" element={<Admin />} />}
          </Routes>
        </Suspense>
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
