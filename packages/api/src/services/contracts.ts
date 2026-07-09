import { prisma } from '../lib/prisma.js';
import {
  BIDDING_CONTRACT_TIERS,
  DIRECT_ACCEPT_DEPLOY_HOURS,
  MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS,
} from '@axes-actuaries/types';
import type { ContractTier } from '@axes-actuaries/types';
import type { Contract } from '@prisma/client';
import { ClaimConflictError } from '../lib/errors.js';

// Direct accept — errand/standard only (see routes/contracts.ts for the 404/tier check that
// runs before this). Caps how many contracts a player can hold simultaneously in
// 'awarded'-but-undeployed limbo: these two tiers have no reputation gate by design, so
// without a cap a player could accept the whole market for free and just let each one lapse
// at its deploy-by penalty, denying every other player a contract to work in the meantime at
// essentially zero cost to themselves (see MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS).
export async function acceptContract(playerId: string, contract: Contract, now = new Date()): Promise<Contract> {
  if (BIDDING_CONTRACT_TIERS.includes(contract.tier as ContractTier)) {
    throw new ClaimConflictError('Dangerous and legendary contracts are awarded through competitive bidding, not direct accept');
  }
  if (contract.status !== 'available') {
    throw new ClaimConflictError('Contract is no longer available');
  }
  if (new Date(contract.expiresAt) <= now) {
    throw new ClaimConflictError('Contract has expired');
  }

  const heldCount = await prisma.contract.count({
    where: {
      awardedTo: playerId,
      status:    'awarded',
      tier:      { notIn: [...BIDDING_CONTRACT_TIERS] },
    },
  });
  if (heldCount >= MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS) {
    throw new ClaimConflictError(
      `You already have ${MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS} contracts awaiting deployment — deploy or let one resolve before accepting another`,
    );
  }

  // Atomic claim: only one player can win when multiple race for the same contract.
  const deployBy = new Date(now.getTime() + DIRECT_ACCEPT_DEPLOY_HOURS * 60 * 60 * 1000);
  const claimed = await prisma.contract.updateMany({
    where: { id: contract.id, status: 'available' },
    data:  { status: 'awarded', awardedTo: playerId, deployBy },
  });
  if (claimed.count === 0) {
    throw new ClaimConflictError('Contract was just taken by another player');
  }

  return prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
}
