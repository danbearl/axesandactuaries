import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { prisma } from '../lib/prisma.js';
import { zodErrorMessage } from '../lib/zodError.js';
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement, publishAnnouncement,
  listAnnouncements, getUnreadAnnouncementCount, markAnnouncementsViewed,
} from '../services/announcements.js';

const router = Router();

// GET /api/v1/announcements
// Admins see drafts and published; everyone else sees published only.
router.get('/', requireAuth, async (req, res) => {
  const player = await prisma.player.findUnique({ where: { id: req.playerId }, select: { isAdmin: true } });
  const announcements = await listAnnouncements(player?.isAdmin ?? false);
  res.json({ announcements });
});

// GET /api/v1/announcements/unread-count
router.get('/unread-count', requireAuth, async (req, res) => {
  const count = await getUnreadAnnouncementCount(req.playerId);
  res.json({ count });
});

// POST /api/v1/announcements/mark-viewed
// Advances the caller's unread cursor to now — called when the Announcements page mounts.
router.post('/mark-viewed', requireAuth, async (req, res) => {
  const lastAnnouncementsViewedAt = await markAnnouncementsViewed(req.playerId);
  res.json({ lastAnnouncementsViewedAt });
});

const AnnouncementBody = z.object({
  title: z.string().min(1).max(160),
  body:  z.string().min(1),
});

// POST /api/v1/announcements
// Admin-only. Always creates a draft — publishing is the separate POST /:id/publish below.
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const parsed = AnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const announcement = await createAnnouncement(parsed.data);
  res.status(201).json({ announcement });
});

// A GitHub Actions deploy step's shared-secret credential — it has no Clerk session, so it
// can't use requireAuth/requireAdmin, which both assume a Clerk-backed Player row. Deliberately
// its own narrow check rather than a general-purpose API-key middleware, since this is the
// only endpoint in the API that needs non-Clerk auth.
function isValidWebhookSecret(req: import('express').Request): boolean {
  const secret = process.env.ANNOUNCEMENTS_WEBHOOK_SECRET;
  if (!secret) return false;

  const header = req.headers.authorization;
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!provided) return false;

  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(secret);
  if (providedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(providedBuf, secretBuf);
}

// POST /api/v1/announcements/webhook
// Called by the deploy workflow (see .github/workflows/deploy.yml) to drop a draft
// summarizing commits since the last deploy, for an admin to review/clean up and publish —
// never auto-published, so a bad deploy message never reaches players unreviewed.
router.post('/webhook', async (req, res) => {
  if (!isValidWebhookSecret(req)) {
    res.status(401).json({ error: 'Invalid or missing webhook credentials' });
    return;
  }

  const parsed = AnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const announcement = await createAnnouncement(parsed.data);
  res.status(201).json({ announcement });
});

// POST /api/v1/announcements/:id/publish
router.post('/:id/publish', requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Announcement not found' });
    return;
  }
  const announcement = await publishAnnouncement(req.params.id);
  res.json({ announcement });
});

const AnnouncementUpdateBody = AnnouncementBody.partial();

// PATCH /api/v1/announcements/:id
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const parsed = AnnouncementUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Announcement not found' });
    return;
  }

  const announcement = await updateAnnouncement(req.params.id, parsed.data);
  res.json({ announcement });
});

// DELETE /api/v1/announcements/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Announcement not found' });
    return;
  }

  await deleteAnnouncement(req.params.id);
  res.json({ success: true });
});

export default router;
