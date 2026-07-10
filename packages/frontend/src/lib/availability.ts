import type { AdventurerResponse, AdventureResponse } from './api.ts';

// When will this adventurer next be deployable? Shared by the dashboard roster sort and the
// availability projection widget so the two don't drift.
//
// For an `on_adventure` adventurer this is necessarily optimistic: it uses the adventure's
// completesAt, but the real return could land later — a fresh restUntil (or, worse, an
// injuryRecoveryUntil) only gets set once the mission actually resolves, and that outcome
// isn't knowable in advance. Not modeled further here (would need outcome-probability
// simulation) — callers that show this to the player should label it as an estimate.
export function computeAvailableAt(adventurer: AdventurerResponse, adventures: AdventureResponse[]): number {
  if (adventurer.status === 'dead') return Infinity;

  if (adventurer.status === 'on_adventure') {
    const adventure = adventures.find((a) => a.adventurers.some((x) => x.adventurerId === adventurer.id));
    return adventure ? new Date(adventure.completesAt).getTime() : Infinity;
  }

  if (adventurer.status === 'injured' && adventurer.injuryRecoveryUntil) {
    return new Date(adventurer.injuryRecoveryUntil).getTime();
  }

  if (adventurer.restUntil) {
    const restUntil = new Date(adventurer.restUntil).getTime();
    if (restUntil > Date.now()) return restUntil;
  }

  return Date.now();
}

// True if any of the given adventurers' availability is derived from an in-progress
// adventure's completesAt rather than a fixed restUntil/injuryRecoveryUntil timestamp — the
// case where computeAvailableAt's estimate is optimistic and worth flagging to the player.
export function hasEstimatedAvailability(adventurers: AdventurerResponse[]): boolean {
  return adventurers.some((a) => a.status === 'on_adventure');
}
