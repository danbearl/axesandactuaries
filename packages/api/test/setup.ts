import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

// Refuse to run against anything that isn't obviously a disposable test
// database — this file truncates every table before each test.
const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl.includes('_test')) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL does not look like a test database ` +
    `(expected the database name to contain "_test"). Got: ${dbUrl}`,
  );
}

const TABLES = [
  'adventure_adventurers',
  'transactions',
  'player_events',
  'contract_bids',
  'adventures',
  'properties',
  'contracts',
  'adventurers',
  'players',
];

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
