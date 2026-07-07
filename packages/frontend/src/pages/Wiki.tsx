import { useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type WikiPageResponse } from '../lib/api.ts';
import './Wiki.css';

interface EditorState {
  slug: string;
  title: string;
  body: string;
  order: string;
}

function toEditorState(page: WikiPageResponse): EditorState {
  return { slug: page.slug, title: page.title, body: page.body, order: String(page.order) };
}

const BLANK_EDITOR_STATE: EditorState = { slug: '', title: '', body: '', order: '0' };

function WikiEditor({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: EditorState;
  onSave: (data: { slug: string; title: string; body: string; order: number }) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState(initial);

  return (
    <div className="wiki-editor">
      <div className="admin-field-row">
        <label className="admin-field">
          <span className="label">Title</span>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="admin-field">
          <span className="label">Slug</span>
          <input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} />
        </label>
        <label className="admin-field admin-field-narrow">
          <span className="label">Nav Order</span>
          <input type="number" value={form.order} onChange={e => setForm({ ...form, order: e.target.value })} />
        </label>
      </div>

      <label className="admin-field mt-md">
        <span className="label">Body (Markdown)</span>
        <textarea
          className="wiki-editor-textarea"
          value={form.body}
          onChange={e => setForm({ ...form, body: e.target.value })}
          rows={16}
        />
      </label>

      <div className="admin-actions mt-md">
        <button
          className="btn btn-primary"
          disabled={saving || !form.title || !form.slug || !form.body}
          onClick={() => onSave({
            slug: form.slug,
            title: form.title,
            body: form.body,
            order: Number(form.order) || 0,
          })}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="admin-error mt-sm">{error}</div>}

      <div className="mt-md">
        <span className="label">Preview</span>
        <div className="wiki-body wiki-editor-preview mt-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.body || '*Nothing to preview yet.*'}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default function Wiki() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit' | 'create'>('view');

  const { data: playerData } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
  });
  const isAdmin = playerData?.player.isAdmin ?? false;

  const { data: indexData, isLoading: indexLoading } = useQuery({
    queryKey: ['wiki'],
    queryFn: () => api.wiki.list(),
  });
  const pages = indexData?.pages ?? [];

  const { data: pageData, isLoading: pageLoading, isError: pageError } = useQuery({
    queryKey: ['wiki', slug],
    queryFn: () => api.wiki.get(slug!),
    enabled: !!slug,
  });

  function invalidateWiki() {
    queryClient.invalidateQueries({ queryKey: ['wiki'] });
  }

  const createMutation = useMutation({
    mutationFn: (data: { slug: string; title: string; body: string; order: number }) => api.wiki.create(data),
    onSuccess: ({ page }) => {
      invalidateWiki();
      setMode('view');
      navigate(`/wiki/${page.slug}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { slug: string; title: string; body: string; order: number }) =>
      api.wiki.update(pageData!.page.id, data),
    onSuccess: ({ page }) => {
      invalidateWiki();
      setMode('view');
      if (page.slug !== slug) navigate(`/wiki/${page.slug}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.wiki.remove(id),
    onSuccess: () => {
      invalidateWiki();
      navigate('/wiki');
    },
  });

  function handleDelete() {
    if (!pageData) return;
    if (window.confirm(`Delete "${pageData.page.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(pageData.page.id);
    }
  }

  // No slug in the URL — redirect to the first page once the index has loaded.
  if (!slug) {
    if (indexLoading) {
      return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>Loading wiki…</div>;
    }
    if (pages.length === 0 && !isAdmin) {
      return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>No wiki pages yet.</div>;
    }
    if (pages.length > 0) {
      return <Navigate to={`/wiki/${pages[0].slug}`} replace />;
    }
  }

  return (
    <div className="wiki-page">
      <div className="page-header">
        <h1>Guild Wiki</h1>
        <span className="label">Reference material on heritages, vocations, and characteristics</span>
      </div>

      <div className="wiki-layout">
        <nav className="panel wiki-nav">
          {pages.map(p => (
            <Link
              key={p.slug}
              to={`/wiki/${p.slug}`}
              className={`wiki-nav-link ${p.slug === slug ? 'active' : ''}`}
              onClick={() => setMode('view')}
            >
              {p.title}
            </Link>
          ))}
          {isAdmin && (
            <button
              className="btn btn-secondary btn-sm mt-sm"
              onClick={() => setMode('create')}
            >
              + New Page
            </button>
          )}
        </nav>

        <div className="panel wiki-content">
          {mode === 'create' && (
            <>
              <h2>New Page</h2>
              <hr className="divider" />
              <div className="mt-md">
                <WikiEditor
                  initial={BLANK_EDITOR_STATE}
                  onSave={data => createMutation.mutate(data)}
                  onCancel={() => setMode('view')}
                  saving={createMutation.isPending}
                  error={createMutation.isError ? createMutation.error.message : null}
                />
              </div>
            </>
          )}

          {mode !== 'create' && !slug && (
            <div className="empty-state">No wiki pages yet — create one to get started.</div>
          )}

          {mode !== 'create' && slug && (
            <>
              {pageLoading && <div className="empty-state">Loading…</div>}
              {pageError && <div className="empty-state">Page not found.</div>}
              {pageData && mode === 'view' && (
                <>
                  <div className="flex items-center justify-between">
                    <h2>{pageData.page.title}</h2>
                    {isAdmin && (
                      <div className="flex gap-sm">
                        <button className="btn btn-secondary btn-sm" onClick={() => setMode('edit')}>Edit</button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={deleteMutation.isPending}
                          onClick={handleDelete}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <hr className="divider" />
                  <div className="wiki-body mt-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{pageData.page.body}</ReactMarkdown>
                  </div>
                </>
              )}
              {pageData && mode === 'edit' && (
                <>
                  <h2>Edit: {pageData.page.title}</h2>
                  <hr className="divider" />
                  <div className="mt-md">
                    <WikiEditor
                      initial={toEditorState(pageData.page)}
                      onSave={data => updateMutation.mutate(data)}
                      onCancel={() => setMode('view')}
                      saving={updateMutation.isPending}
                      error={updateMutation.isError ? updateMutation.error.message : null}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
