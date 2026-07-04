import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider, useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { setTokenGetter } from './lib/api';
import App from './App.tsx';
import './index.css';

// Mirrors the API's Sentry setup (packages/api/src/index.ts): only enabled
// when a DSN is configured, so it's silently off in local dev by default.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  tracesSampleRate: 0.2,
});

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
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-light)' }}>
          Something went wrong. Please refresh the page.
        </div>
      }
    >
      <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
        <QueryClientProvider client={queryClient}>
          <TokenBridge>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </TokenBridge>
        </QueryClientProvider>
      </ClerkProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
