import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getLeaderboard } from '../services/leaderboard.js';

const router = Router();

// GET /api/v1/leaderboard
// Top 10 by score, plus the viewing player's own rank and a +/-5 window around it
// when they're outside the top 10.
router.get('/', requireAuth, async (req, res) => {
  const result = await getLeaderboard(req.playerId);
  res.json(result);
});

export default router;
