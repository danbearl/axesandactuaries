// Must be the very first import: tsx does not auto-load .env files (unlike
// some other TS runners), and everything below — including Sentry.init()'s
// own process.env.SENTRY_DSN read two lines down — needs real env vars
// already populated. In production this is a no-op: Fly injects real env
// vars directly and there's no .env file in the container.
import 'dotenv/config';
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.2,
  enabled: !!process.env.SENTRY_DSN,
});

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { clerkMiddleware } from '@clerk/express';

import authRouter from './routes/auth.js';
import playerRouter from './routes/player.js';
import adventurersRouter from './routes/adventurers.js';
import contractsRouter from './routes/contracts.js';
import adventuresRouter from './routes/adventures.js';
import propertiesRouter from './routes/properties.js';
import transactionsRouter from './routes/transactions.js';
import eventsRouter from './routes/events.js';
import wikiRouter from './routes/wiki.js';
import adminRouter from './routes/admin.js';
import { registerWorkers, stopWorkers } from './workers/index.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { sseHub } from './lib/sse.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Ran in Report-Only mode first against real production traffic (sign-in +
// browsing multiple pages) with zero policy violations before enforcing —
// see SECURITY.md and ROADMAP.md for that verification.
//
// Clerk FAPI hostname is clerk.axesandactuaries.com (custom domain, not the
// default *.clerk.accounts.dev). If that ever changes, update here too.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' is required by both Clerk's own SDK and this app's
      // extensive use of React's style={{}} prop (rendered as inline style
      // attributes, which CSP treats the same as inline scripts for style-src).
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://clerk.axesandactuaries.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      connectSrc: [
        "'self'",
        'https://clerk.axesandactuaries.com',
        'https://clerk-telemetry.com',
        'https://*.clerk-telemetry.com',
        'https://*.ingest.us.sentry.io',
      ],
      imgSrc: ["'self'", 'https://img.clerk.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      workerSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// EventSource cannot send custom headers, so the SSE endpoint passes its
// Clerk JWT as ?token= in the query string. Promote it to Authorization
// before clerkMiddleware runs so Clerk can verify it normally.
app.use('/api/v1/events', (req: Request, _res: Response, next: NextFunction) => {
  const token = req.query['token'] as string | undefined;
  if (token && !req.headers['authorization']) {
    req.headers['authorization'] = `Bearer ${token}`;
  }
  next();
});

app.use(clerkMiddleware());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/player', playerRouter);
app.use('/api/v1/adventurers', adventurersRouter);
app.use('/api/v1/contracts', contractsRouter);
app.use('/api/v1/adventures', adventuresRouter);
app.use('/api/v1/properties', propertiesRouter);
app.use('/api/v1/transactions', transactionsRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/wiki', wikiRouter);
app.use('/api/v1/admin', adminRouter);

// In production the compiled frontend lives two directories up from dist/
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

Sentry.setupExpressErrorHandler(app);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);

  connectRedis()
    .then(() => sseHub.start())
    .catch((err) => console.error('Redis/SSE init failed:', err));

  registerWorkers().catch((err) => {
    console.error('Failed to register workers:', err);
  });
});

const shutdown = () => {
  server.close(() => {
    Promise.allSettled([stopWorkers(), disconnectRedis()])
      .finally(() => process.exit(0));
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
