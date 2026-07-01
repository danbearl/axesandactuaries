import { PgBoss } from 'pg-boss';

const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL!,
  monitorIntervalSeconds: 30,
});

boss.on('error', (err: Error) => console.error('[pg-boss]', err));

export default boss;
