import { prisma } from '../lib/prisma.js';
import { publish, CHANNELS } from '../lib/redis.js';
import type { Announcement } from '@prisma/client';

export interface CreateAnnouncementInput {
  title: string;
  body:  string;
}

// Always created as a draft — publishing is a distinct, explicit action (publishAnnouncement
// below), matching the required draft/publish/edit/delete admin workflow.
export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  return prisma.announcement.create({ data: { title: input.title, body: input.body } });
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?:  string;
}

export async function updateAnnouncement(id: string, input: UpdateAnnouncementInput): Promise<Announcement> {
  return prisma.announcement.update({ where: { id }, data: input });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await prisma.announcement.delete({ where: { id } });
}

// The one transition with a side effect: broadcasts to every connected client (nav badge/feed
// update live) and stamps publishedAt exactly once — see schema.prisma's comment on
// Announcement for why re-publishing never refreshes an already-set publishedAt.
export async function publishAnnouncement(id: string): Promise<Announcement> {
  const existing = await prisma.announcement.findUniqueOrThrow({ where: { id } });

  const announcement = await prisma.announcement.update({
    where: { id },
    data: {
      status:      'published',
      publishedAt: existing.publishedAt ?? new Date(),
    },
  });

  publish(CHANNELS.market, 'announcement_published', { id: announcement.id, title: announcement.title })
    .catch(() => { /* non-fatal if Redis is unavailable */ });

  return announcement;
}

export async function listAnnouncements(includeDrafts: boolean): Promise<Announcement[]> {
  return prisma.announcement.findMany({
    where:   includeDrafts ? {} : { status: 'published' },
    orderBy: { createdAt: 'desc' },
  });
}

// A player's "unread" count is published-since-their-cursor, not a per-announcement read
// table — see Player.lastAnnouncementsViewedAt's comment in schema.prisma. A null cursor
// (never visited the page) counts every published announcement as unread.
export async function getUnreadAnnouncementCount(playerId: string): Promise<number> {
  const player = await prisma.player.findUniqueOrThrow({
    where:  { id: playerId },
    select: { lastAnnouncementsViewedAt: true },
  });

  return prisma.announcement.count({
    where: {
      status: 'published',
      ...(player.lastAnnouncementsViewedAt ? { publishedAt: { gt: player.lastAnnouncementsViewedAt } } : {}),
    },
  });
}

export async function markAnnouncementsViewed(playerId: string): Promise<Date> {
  const viewedAt = new Date();
  await prisma.player.update({ where: { id: playerId }, data: { lastAnnouncementsViewedAt: viewedAt } });
  return viewedAt;
}
