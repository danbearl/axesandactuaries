import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setTokenGetter } from './lib/api';
import App from './App.tsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set. Copy .env.example → .env and add your Clerk key.');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

// Bridge Clerk session tokens into the API client once the auth context is available.
function TokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  setTokenGetter(() => getToken());
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <QueryClientProvider client={queryClient}>
        <TokenBridge>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TokenBridge>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);
