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
import { clerkMiddleware } from '@clerk/express';

import authRouter from './routes/auth.js';
import playerRouter from './routes/player.js';
import adventurersRouter from './routes/adventurers.js';
import contractsRouter from './routes/contracts.js';
import adventuresRouter from './routes/adventures.js';
import propertiesRouter from './routes/properties.js';
import transactionsRouter from './routes/transactions.js';
import eventsRouter from './routes/events.js';
import { registerWorkers, stopWorkers } from './workers/index.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { sseHub } from './lib/sse.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

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
