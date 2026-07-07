import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { prisma } from '../lib/prisma.js';
import { zodErrorMessage } from '../lib/zodError.js';

const router = Router();

// Lowercase letters, numbers, and hyphens — keeps slugs URL-safe without needing to encode
// anything, matching how every other slug (`/wiki/:slug`) already behaves.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_PATTERN_MESSAGE = 'Slug must be lowercase letters, numbers, and hyphens only';

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

const WikiPageBody = z.object({
  slug:  z.string().min(1).max(80).regex(SLUG_PATTERN, SLUG_PATTERN_MESSAGE),
  title: z.string().min(1).max(120),
  body:  z.string().min(1),
  order: z.number().int().optional(),
});

// POST /api/v1/wiki
// Creates a new wiki page. Admin-only — regular players get read access above.
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const parsed = WikiPageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const { slug, title, body, order } = parsed.data;

  const existing = await prisma.wikiPage.findUnique({ where: { slug } });
  if (existing) {
    res.status(409).json({ error: 'A page with that slug already exists' });
    return;
  }

  const page = await prisma.wikiPage.create({
    data: { slug, title, body, order: order ?? 0 },
  });
  res.status(201).json({ page });
});

const WikiPageUpdateBody = WikiPageBody.partial();

// PATCH /api/v1/wiki/:id
// Partial update, keyed by id (not slug) so changing the slug itself is supported.
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const parsed = WikiPageUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const existing = await prisma.wikiPage.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Wiki page not found' });
    return;
  }

  const { slug } = parsed.data;
  if (slug && slug !== existing.slug) {
    const slugTaken = await prisma.wikiPage.findUnique({ where: { slug } });
    if (slugTaken) {
      res.status(409).json({ error: 'A page with that slug already exists' });
      return;
    }
  }

  const page = await prisma.wikiPage.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ page });
});

// DELETE /api/v1/wiki/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.wikiPage.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Wiki page not found' });
    return;
  }

  await prisma.wikiPage.delete({ where: { id: req.params.id } });
  // A JSON body (rather than a bare 204) matches every other response in this API — the
  // frontend's shared `request()` helper always calls `res.json()` on success.
  res.json({ success: true });
});

export default router;
