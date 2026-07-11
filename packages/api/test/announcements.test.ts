import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement, publishAnnouncement,
  listAnnouncements, getUnreadAnnouncementCount, markAnnouncementsViewed,
} from '../src/services/announcements.js';
import { createPlayer } from './fixtures.js';

describe('createAnnouncement', () => {
  it('creates a draft with no publishedAt', async () => {
    const announcement = await createAnnouncement({ title: 'Season II', body: 'Coming soon.' });

    expect(announcement.status).toBe('draft');
    expect(announcement.publishedAt).toBeNull();
  });
});

describe('updateAnnouncement', () => {
  it('updates title/body without touching status', async () => {
    const announcement = await createAnnouncement({ title: 'Draft', body: 'v1' });

    const updated = await updateAnnouncement(announcement.id, { body: 'v2' });

    expect(updated.body).toBe('v2');
    expect(updated.status).toBe('draft');
  });
});

describe('deleteAnnouncement', () => {
  it('removes the row', async () => {
    const announcement = await createAnnouncement({ title: 'Gone soon', body: '...' });

    await deleteAnnouncement(announcement.id);

    await expect(prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } })).rejects.toThrow();
  });
});

describe('publishAnnouncement', () => {
  it('sets status to published and stamps publishedAt', async () => {
    const announcement = await createAnnouncement({ title: 'Patch notes', body: 'Buffed sellswords.' });

    const published = await publishAnnouncement(announcement.id);

    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();
  });

  it('never refreshes publishedAt on a second publish call', async () => {
    const announcement = await createAnnouncement({ title: 'Patch notes', body: 'v1' });
    const first = await publishAnnouncement(announcement.id);

    // Edit while published, then publish again — publishedAt must stay exactly what it was,
    // not jump forward, or the unread-cursor comparison would resurrect it as "new" for
    // everyone who already saw it.
    await updateAnnouncement(announcement.id, { body: 'v2' });
    const second = await publishAnnouncement(announcement.id);

    expect(second.publishedAt).toEqual(first.publishedAt);
  });
});

describe('listAnnouncements', () => {
  it('excludes drafts when includeDrafts is false', async () => {
    const draft = await createAnnouncement({ title: 'Draft', body: '...' });
    const published = await createAnnouncement({ title: 'Published', body: '...' });
    await publishAnnouncement(published.id);

    const results = await listAnnouncements(false);

    expect(results.map(a => a.id)).toContain(published.id);
    expect(results.map(a => a.id)).not.toContain(draft.id);
  });

  it('includes drafts when includeDrafts is true', async () => {
    const draft = await createAnnouncement({ title: 'Draft', body: '...' });

    const results = await listAnnouncements(true);

    expect(results.map(a => a.id)).toContain(draft.id);
  });
});

describe('getUnreadAnnouncementCount', () => {
  it('counts every published announcement when the player has never viewed the feed', async () => {
    const player = await createPlayer();
    const a = await createAnnouncement({ title: 'A', body: '...' });
    const b = await createAnnouncement({ title: 'B', body: '...' });
    await publishAnnouncement(a.id);
    await publishAnnouncement(b.id);

    const count = await getUnreadAnnouncementCount(player.id);

    expect(count).toBe(2);
  });

  it('only counts announcements published after the player\'s cursor', async () => {
    const player = await createPlayer();
    const now = Date.now();

    const seen = await prisma.announcement.create({
      data: { title: 'Seen', body: '...', status: 'published', publishedAt: new Date(now - 10_000) },
    });
    await prisma.announcement.create({
      data: { title: 'New', body: '...', status: 'published', publishedAt: new Date(now + 10_000) },
    });
    await prisma.player.update({
      where: { id: player.id },
      data:  { lastAnnouncementsViewedAt: new Date(now) },
    });

    const count = await getUnreadAnnouncementCount(player.id);

    expect(count).toBe(1);
    expect(seen.publishedAt!.getTime()).toBeLessThan(now);
  });

  it('never counts drafts', async () => {
    const player = await createPlayer();
    await createAnnouncement({ title: 'Draft', body: '...' });

    const count = await getUnreadAnnouncementCount(player.id);

    expect(count).toBe(0);
  });
});

describe('markAnnouncementsViewed', () => {
  it('advances the cursor so previously-unread announcements no longer count', async () => {
    const player = await createPlayer();
    const announcement = await createAnnouncement({ title: 'A', body: '...' });
    await publishAnnouncement(announcement.id);

    expect(await getUnreadAnnouncementCount(player.id)).toBe(1);

    await markAnnouncementsViewed(player.id);

    expect(await getUnreadAnnouncementCount(player.id)).toBe(0);
  });
});
