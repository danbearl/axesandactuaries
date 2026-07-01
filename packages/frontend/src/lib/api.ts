// Typed fetch wrapper. All requests go through /api (proxied to localhost:3001 in dev).
// Clerk session tokens are attached automatically via getToken().

let getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  getToken = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken ? await getToken() : null;
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'Request failed', body);
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = {
  auth: {
    sync: (username?: string) =>
      request<{ player: PlayerResponse }>('/auth/sync', {
        method: 'POST',
        body: JSON.stringify({ username }),
      }),
  },
  player: {
    me: () => request<PlayerMeResponse>('/player/me'),
  },
  adventurers: {
    market: () => request<{ adventurers: AdventurerResponse[] }>('/adventurers/market'),
    hire: (id: string) =>
      request<{ player: PlayerResponse; adventurer: AdventurerResponse }>(`/adventurers/${id}/hire`, { method: 'POST' }),
    fire: (id: string) =>
      request<{ adventurer: AdventurerResponse }>(`/adventurers/${id}/fire`, { method: 'POST' }),
    desperateHire: () =>
      request<{ adventurer: AdventurerResponse }>('/adventurers/desperate-hire', { method: 'POST' }),
  },
  contracts: {
    market: () => request<{ contracts: ContractResponse[] }>('/contracts/market'),
    mine: () => request<{ contracts: ContractResponse[] }>('/contracts/mine'),
    accept: (id: string) =>
      request<{ contract: ContractResponse }>(`/contracts/${id}/accept`, { method: 'POST' }),
    bid: (id: string) =>
      request<{ placed: boolean }>(`/contracts/${id}/bid`, { method: 'POST' }),
    welfare: () =>
      request<{ contract: WelfareContractInfo; available: boolean; cooldownUntil: string | null; cooldownHours: number }>('/contracts/welfare'),
    welfareAccept: () =>
      request<{ contract: ContractResponse }>('/contracts/welfare/accept', { method: 'POST' }),
  },
  adventures: {
    list: () => request<{ adventures: AdventureResponse[] }>('/adventures'),
    get: (id: string) => request<{ adventure: AdventureResponse }>(`/adventures/${id}`),
    start: (contractId: string, adventurerIds: string[]) =>
      request<{ adventure: AdventureResponse }>('/adventures', {
        method: 'POST',
        body: JSON.stringify({ contractId, adventurerIds }),
      }),
  },
  properties: {
    list: () => request<{ properties: PropertyResponse[] }>('/properties'),
    build: (type: string) =>
      request<{ property: PropertyResponse }>('/properties', {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    sell: (id: string) =>
      request<{ salePrice: number }>(`/properties/${id}/sell`, { method: 'POST' }),
  },
  transactions: {
    list: (limit = 50, offset = 0) =>
      request<TransactionsResponse>(`/transactions?limit=${limit}&offset=${offset}`),
  },
};

// ── Response types (mirror the DB shapes returned by the API) ─────────────────

export interface PlayerResponse {
  id: string;
  clerkUserId: string;
  username: string;
  gold: number;
  reputation: number;
  createdAt: string;
}

export interface AdventurerResponse {
  id: string;
  name: string;
  heritage: string;
  vocation: string;
  gender: string;
  level: number;
  experience: number;
  powerRating: number;
  stats: Record<string, number>;
  personality: Record<string, number>;
  hireCost: number;
  dailyWage: number;
  status: string;
  injuryRecoveryUntil: string | null;
  employerId: string | null;
  height: string;
  build: string;
  complexion: string;
  hairColor: string;
  eyeColor: string;
  createdAt: string;
}

export interface ContractResponse {
  id: string;
  title: string;
  description: string;
  tier: string;
  requiredPower: number;
  requiredStats: Record<string, number>;
  rewardGold: number;
  reputationReward: number;
  penaltyGold: number;
  penaltyReputation: number;
  durationHours: number;
  status: string;
  awardedTo: string | null;
  bidDeadline: string;
  expiresAt: string;
  createdAt: string;
  bidCount?: number;
  hasBid?: boolean;
}

export interface AdventureResponse {
  id: string;
  contractId: string;
  playerId: string;
  startsAt: string;
  completesAt: string;
  status: string;
  outcomeRoll: number | null;
  resolvedAt: string | null;
  contract: ContractResponse;
  adventurers: Array<{ adventureId: string; adventurerId: string; adventurer: AdventurerResponse }>;
  createdAt: string;
}

export interface PropertyResponse {
  id: string;
  playerId: string;
  type: string;
  level: number;
  maintenanceCostDaily: number;
  bonus: Record<string, number>;
  costBasis: number;
  createdAt: string;
}

export interface WelfareContractInfo {
  title: string;
  description: string;
  tier: string;
  requiredPower: number;
  rewardGold: number;
  reputationReward: number;
  durationHours: number;
}

export interface TransactionResponseItem {
  id: string;
  playerId: string;
  amount: number;
  reason: string;
  description: string;
  referenceId: string | null;
  createdAt: string;
}

export interface TransactionsResponse {
  transactions: TransactionResponseItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PlayerMeResponse {
  player: PlayerResponse;
  adventurers: AdventurerResponse[];
  properties: PropertyResponse[];
  adventures: AdventureResponse[];
}
