import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type AnnouncementResponse } from '../lib/api.ts';
import './Announcements.css';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

interface EditorState { title: string; body: string; }
const BLANK_EDITOR_STATE: EditorState = { title: '', body: '' };

function AnnouncementEditor({
  initial, onSave, onCancel, saving, error, saveLabel,
}: {
  initial: EditorState;
  onSave: (data: EditorState) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  saveLabel: string;
}) {
  const [form, setForm] = useState(initial);

  return (
    <div className="announcement-editor">
      <label className="announcement-field">
        <span className="label">Title</span>
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      </label>

      <label className="announcement-field mt-md">
        <span className="label">Body (Markdown)</span>
        <textarea
          className="announcement-editor-textarea"
          value={form.body}
          onChange={e => setForm({ ...form, body: e.target.value })}
          rows={10}
        />
      </label>

      <div className="admin-actions mt-md">
        <button
          className="btn btn-primary btn-sm"
          disabled={saving || !form.title || !form.body}
          onClick={() => onSave(form)}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="admin-error mt-sm">{error}</div>}

      <div className="mt-md">
        <span className="label">Preview</span>
        <div className="announcement-body announcement-editor-preview mt-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.body || '*Nothing to preview yet.*'}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function AnnouncementCard({
  announcement, isAdmin, onEdit, onDelete, onPublish, publishPending,
}: {
  announcement: AnnouncementResponse;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  publishPending: boolean;
}) {
  return (
    <div className="panel announcement-card">
      <div className="flex items-center justify-between">
        <h2>{announcement.title}</h2>
        <span className={`badge ${announcement.status === 'draft' ? 'badge-status-injured' : 'badge-status-completed'}`}>
          {announcement.status === 'draft' ? 'Draft' : 'Published'}
        </span>
      </div>
      <div className="label mt-sm">
        {announcement.status === 'published' && announcement.publishedAt
          ? `Published ${formatDate(announcement.publishedAt)}`
          : `Created ${formatDate(announcement.createdAt)}`}
      </div>
      <hr className="divider" />
      <div className="announcement-body mt-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{announcement.body}</ReactMarkdown>
      </div>
      {isAdmin && (
        <div className="admin-actions mt-md">
          {announcement.status === 'draft' && (
            <button className="btn btn-primary btn-sm" disabled={publishPending} onClick={onPublish}>
              {publishPending ? 'Publishing…' : 'Publish'}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}

export default function Announcements() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'create'>('view');
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: playerData } = useQuery({ queryKey: ['player'], queryFn: () => api.player.me() });
  const isAdmin = playerData?.player.isAdmin ?? false;

  const { data, isLoading } = useQuery({ queryKey: ['announcements'], queryFn: () => api.announcements.list() });
  const announcements = data?.announcements ?? [];

  const markViewedMutation = useMutation({
    mutationFn: () => api.announcements.markViewed(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcements', 'unread-count'] }),
  });

  useEffect(() => {
    // Advances the unread cursor once per page visit — see services/announcements.ts.
    markViewedMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['announcements'] });
  }

  const createMutation = useMutation({
    mutationFn: (form: EditorState) => api.announcements.create(form),
    onSuccess: () => { invalidate(); setMode('view'); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: EditorState }) => api.announcements.update(id, form),
    onSuccess: () => { invalidate(); setEditingId(null); },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.announcements.publish(id),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.announcements.remove(id),
    onSuccess: invalidate,
  });

  function handleDelete(announcement: AnnouncementResponse) {
    if (window.confirm(`Delete "${announcement.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(announcement.id);
    }
  }

  function renderAnnouncement(a: AnnouncementResponse) {
    if (editingId === a.id) {
      return (
        <div key={a.id} className="panel announcement-card">
          <h2>Edit: {a.title}</h2>
          <hr className="divider" />
          <div className="mt-md">
            <AnnouncementEditor
              initial={{ title: a.title, body: a.body }}
              onSave={form => updateMutation.mutate({ id: a.id, form })}
              onCancel={() => setEditingId(null)}
              saving={updateMutation.isPending}
              error={updateMutation.isError ? updateMutation.error.message : null}
              saveLabel="Save"
            />
          </div>
        </div>
      );
    }

    return (
      <AnnouncementCard
        key={a.id}
        announcement={a}
        isAdmin={isAdmin}
        onEdit={() => setEditingId(a.id)}
        onDelete={() => handleDelete(a)}
        onPublish={() => publishMutation.mutate(a.id)}
        publishPending={publishMutation.isPending}
      />
    );
  }

  const drafts = announcements.filter(a => a.status === 'draft');
  const published = [...announcements]
    .filter(a => a.status === 'published')
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());

  return (
    <div className="announcements-page">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1>Announcements</h1>
          <span className="label">Guild-wide updates, balance changes, and news from the front office</span>
        </div>
        {isAdmin && mode === 'view' && (
          <button className="btn btn-secondary btn-sm" onClick={() => setMode('create')}>+ New Announcement</button>
        )}
      </div>

      {isAdmin && mode === 'create' && (
        <div className="panel mt-md">
          <h2>New Announcement</h2>
          <hr className="divider" />
          <div className="mt-md">
            <AnnouncementEditor
              initial={BLANK_EDITOR_STATE}
              onSave={form => createMutation.mutate(form)}
              onCancel={() => setMode('view')}
              saving={createMutation.isPending}
              error={createMutation.isError ? createMutation.error.message : null}
              saveLabel="Save Draft"
            />
          </div>
        </div>
      )}

      {isLoading && <div className="panel mt-md" style={{ textAlign: 'center' }}>Loading announcements…</div>}

      {!isLoading && isAdmin && drafts.length > 0 && (
        <section className="mt-md">
          <h2 className="announcements-section-title">Drafts</h2>
          <div className="flex-col gap-md mt-sm">
            {drafts.map(renderAnnouncement)}
          </div>
        </section>
      )}

      {!isLoading && (
        <section className="mt-md">
          {isAdmin && <h2 className="announcements-section-title">Published</h2>}
          {published.length === 0 ? (
            <div className="empty-state mt-sm">No announcements yet.</div>
          ) : (
            <div className="flex-col gap-md mt-sm">
              {published.map(renderAnnouncement)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
