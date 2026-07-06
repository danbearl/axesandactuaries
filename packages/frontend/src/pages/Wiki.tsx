import { useParams, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type WikiPageSummary } from '../lib/api.ts';
import './Wiki.css';

function WikiPageView({ slug, pages }: { slug: string; pages: WikiPageSummary[] }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wiki', slug],
    queryFn: () => api.wiki.get(slug),
  });

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
            >
              {p.title}
            </Link>
          ))}
        </nav>

        <div className="panel wiki-content">
          {isLoading && <div className="empty-state">Loading…</div>}
          {isError && <div className="empty-state">Page not found.</div>}
          {data && (
            <>
              <h2>{data.page.title}</h2>
              <hr className="divider" />
              <div className="wiki-body mt-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.page.body}</ReactMarkdown>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Wiki() {
  const { slug } = useParams<{ slug: string }>();

  const { data: indexData, isLoading: indexLoading } = useQuery({
    queryKey: ['wiki'],
    queryFn: () => api.wiki.list(),
  });

  const pages = indexData?.pages ?? [];

  // No slug in the URL — redirect to the first page once the index has loaded.
  if (!slug) {
    if (indexLoading) {
      return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>Loading wiki…</div>;
    }
    if (pages.length === 0) {
      return <div className="panel" style={{ marginTop: '2rem', textAlign: 'center' }}>No wiki pages yet.</div>;
    }
    return <Navigate to={`/wiki/${pages[0].slug}`} replace />;
  }

  return <WikiPageView slug={slug} pages={pages} />;
}
