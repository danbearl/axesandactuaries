import type { Response } from 'express';
import { redisSubscriber } from './redis.js';

interface SSEMessage {
  event: string;
  data:  object;
}

// SSE hub: maintains active connections per player and routes Redis pub/sub
// events to the correct clients.
class SSEHub {
  // playerId → set of active response streams (one per open tab/connection)
  private clients = new Map<string, Set<Response>>();

  add(playerId: string, res: Response): void {
    if (!this.clients.has(playerId)) this.clients.set(playerId, new Set());
    this.clients.get(playerId)!.add(res);
  }

  remove(playerId: string, res: Response): void {
    const conns = this.clients.get(playerId);
    if (!conns) return;
    conns.delete(res);
    if (conns.size === 0) this.clients.delete(playerId);
  }

  sendToPlayer(playerId: string, event: string, data: object): void {
    const conns = this.clients.get(playerId);
    if (!conns || conns.size === 0) return;
    const payload = formatSSE(event, data);
    for (const res of conns) res.write(payload);
  }

  broadcast(event: string, data: object): void {
    const payload = formatSSE(event, data);
    for (const conns of this.clients.values()) {
      for (const res of conns) res.write(payload);
    }
  }

  // Attach Redis subscriber — called once at startup.
  async start(): Promise<void> {
    // Subscribe to all channels via pattern; route by channel name.
    await redisSubscriber.psubscribe('player:*', 'market');

    redisSubscriber.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      let msg: SSEMessage;
      try { msg = JSON.parse(raw) as SSEMessage; }
      catch { return; }

      if (channel === 'market') {
        this.broadcast(msg.event, msg.data);
      } else if (channel.startsWith('player:')) {
        const playerId = channel.slice(7);
        this.sendToPlayer(playerId, msg.event, msg.data);
      }
    });

    console.log('[sse-hub] Listening on Redis channels');
  }
}

function formatSSE(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const sseHub = new SSEHub();
