import { describe, it, expect } from 'vitest';
import { MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS } from '@axes-actuaries/types';
import { acceptContract } from '../src/services/contracts.js';
import { ClaimConflictError } from '../src/lib/errors.js';
import { createPlayer, createContract } from './fixtures.js';

describe('acceptContract', () => {
  it('awards an available direct-accept contract to the player', async () => {
    const player = await createPlayer();
    const contract = await createContract({ tier: 'errand', status: 'available' });

    const updated = await acceptContract(player.id, contract);

    expect(updated.status).toBe('awarded');
    expect(updated.awardedTo).toBe(player.id);
    expect(updated.deployBy).not.toBeNull();
  });

  it('rejects a bidding-tier contract', async () => {
    const player = await createPlayer();
    const contract = await createContract({ tier: 'dangerous', status: 'available' });

    await expect(acceptContract(player.id, contract)).rejects.toThrow(ClaimConflictError);
  });

  it('rejects a contract that is no longer available', async () => {
    const player = await createPlayer();
    const contract = await createContract({ tier: 'errand', status: 'awarded' });

    await expect(acceptContract(player.id, contract)).rejects.toThrow(ClaimConflictError);
  });

  it('rejects a contract past its expiresAt', async () => {
    const player = await createPlayer();
    const contract = await createContract({
      tier: 'errand', status: 'available', expiresAt: new Date(Date.now() - 1000),
    });

    await expect(acceptContract(player.id, contract)).rejects.toThrow(ClaimConflictError);
  });

  it(`allows up to ${MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS} concurrently held direct-accept contracts`, async () => {
    const player = await createPlayer();

    for (let i = 0; i < MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS; i++) {
      const contract = await createContract({ tier: 'errand', status: 'available' });
      const updated = await acceptContract(player.id, contract);
      expect(updated.status).toBe('awarded');
    }
  });

  it('rejects accepting past the concurrent direct-accept cap', async () => {
    const player = await createPlayer();

    for (let i = 0; i < MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS; i++) {
      const contract = await createContract({ tier: 'errand', status: 'available' });
      await acceptContract(player.id, contract);
    }

    const oneTooMany = await createContract({ tier: 'standard', status: 'available' });
    await expect(acceptContract(player.id, oneTooMany)).rejects.toThrow(ClaimConflictError);
  });

  it('does not count in-progress or resolved contracts toward the cap, only awaiting-deployment ones', async () => {
    const player = await createPlayer();
    await createContract({ tier: 'errand', status: 'in_progress', awardedTo: player.id });
    await createContract({ tier: 'errand', status: 'completed', awardedTo: player.id });

    // Should still have full room under the cap since neither of the above is 'awarded'.
    for (let i = 0; i < MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS; i++) {
      const contract = await createContract({ tier: 'errand', status: 'available' });
      const updated = await acceptContract(player.id, contract);
      expect(updated.status).toBe('awarded');
    }
  });

  it('does not let a dangerous/legendary award count toward the direct-accept cap', async () => {
    const player = await createPlayer();
    await createContract({ tier: 'legendary', status: 'awarded', awardedTo: player.id });

    for (let i = 0; i < MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS; i++) {
      const contract = await createContract({ tier: 'errand', status: 'available' });
      const updated = await acceptContract(player.id, contract);
      expect(updated.status).toBe('awarded');
    }
  });
});
