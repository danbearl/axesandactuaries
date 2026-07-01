import Redis from 'ioredis';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Two separate connections are required: Redis pub/sub connections
// cannot issue other commands while in subscriber mode.
export const redisPublisher  = new Redis(url, { lazyConnect: true });
export const redisSubscriber = new Redis(url, { lazyConnect: true });

redisPublisher.on('error',  (err: Error) => console.error('[redis/pub]', err.message));
redisSubscriber.on('error', (err: Error) => console.error('[redis/sub]', err.message));

export async function connectRedis(): Promise<void> {
  await Promise.all([
    redisPublisher.connect(),
    redisSubscriber.connect(),
  ]);
  console.log('[redis] Connected');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redisPublisher.quit(),
    redisSubscriber.quit(),
  ]);
  console.log('[redis] Disconnected');
}

// Publish a typed event to a channel.
export async function publish(channel: string, event: string, data: object): Promise<void> {
  await redisPublisher.publish(channel, JSON.stringify({ event, data }));
}

export const CHANNELS = {
  player: (playerId: string) => `player:${playerId}`,
  market: 'market',
} as const;
