import boss from '../lib/pgboss.js';
import { runAdventureTicker } from './adventureTicker.js';
import { runDailyReset }      from './dailyReset.js';
import { runMarketGC }        from './marketGC.js';

const QUEUES = ['adventure-ticker', 'market-gc', 'daily-reset'] as const;

export async function registerWorkers(): Promise<void> {
  await boss.start();

  // Queues must exist before scheduling (pg-boss v12 requirement)
  await Promise.all(QUEUES.map((name) => boss.createQueue(name)));

  // Upsert cron schedules — idempotent, safe on every restart
  await Promise.all([
    boss.schedule('adventure-ticker', '* * * * *',    {}, { tz: 'UTC' }), // every minute
    boss.schedule('market-gc',        '*/15 * * * *', {}, { tz: 'UTC' }), // every 15 min
    boss.schedule('daily-reset',      '0 0 * * *',    {}, { tz: 'UTC' }), // midnight UTC (wages + maintenance + market refresh)
  ]);

  // Register handlers
  await Promise.all([
    boss.work('adventure-ticker', async () => { await runAdventureTicker(); }),
    boss.work('market-gc',        async () => { await runMarketGC(); }),
    boss.work('daily-reset',      async () => { await runDailyReset(); }),
  ]);

  console.log('[workers] All workers registered');
}

export async function stopWorkers(): Promise<void> {
  await boss.stop();
  console.log('[workers] pg-boss stopped');
}
