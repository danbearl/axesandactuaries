import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// GET /api/v1/wiki
// Returns the page index (no body content) for building navigation.
// Must be declared before /:slug so Express doesn't need to disambiguate.
router.get('/', requireAuth, async (_req, res) => {
  const pages = await prisma.wikiPage.findMany({
    select: { id: true, slug: true, title: true, order: true },
    orderBy: [{ order: 'asc' }, { title: 'asc' }],
  });
  res.json({ pages });
});

// GET /api/v1/wiki/:slug
router.get('/:slug', requireAuth, async (req, res) => {
  const page = await prisma.wikiPage.findUnique({ where: { slug: req.params.slug } });
  if (!page) {
    res.status(404).json({ error: 'Wiki page not found' });
    return;
  }
  res.json({ page });
});

export default router;
