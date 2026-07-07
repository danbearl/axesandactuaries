import { computeCohesionBonus } from '@axes-actuaries/types';
import type { CohesionPairResponse } from './api';

// Fractional power bonus (0 to 0.10) for a candidate party, given the roster-wide pairwise
// cohesion data from /player/me. Every pair among the selected members counts — a pair with
// no matching row (never adventured together) contributes 0 rather than being skipped.
export function partyCohesionBonus(partyIds: string[], cohesionPairs: CohesionPairResponse[]): number {
  if (partyIds.length < 2) return 0;

  const cohesionByPair = new Map(
    cohesionPairs.map((p) => [pairKey(p.adventurerLowId, p.adventurerHighId), p.cohesion]),
  );

  const values: number[] = [];
  for (let i = 0; i < partyIds.length; i++) {
    for (let j = i + 1; j < partyIds.length; j++) {
      values.push(cohesionByPair.get(pairKey(partyIds[i], partyIds[j])) ?? 0);
    }
  }
  return computeCohesionBonus(values);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
