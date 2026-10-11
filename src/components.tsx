import { ArrowRight, Bookmark, Check, ChevronRight, MessageSquare, Send, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { request, useStudio } from './store';
import type { Comment, ContentSection, SourceReference, UserState } from '../shared/types';
import { contentResearchDate, contentSources } from '../shared/content/sources';

export function SourceLinks({ ids, sources }: { ids?: string[]; sources?: SourceReference[] }) {
  if (!ids?.length) return null;
  const date=sources?.length?[...new Set(sources.map(source=>source.researchDate))].join(', '):contentResearchDate;
  return <div className="content-sources"><h4>Sources and further reading</h4><p className="fine-print">Original synthesis informed by public documentation. Research date: {date}; not expert-reviewed.</p><ul>{ids.map(id => {
    const source=sources?sources.find(source=>source.id===id):Object.entries(contentSources).find(([key])=>key===id)?.[1];
    return source?<li key={id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><span> · {source.publisher}</span></li>:<li key={id}>Source reference unavailable: {id}</li>;
  })}</ul></div>;
}
export function ArchitectureFigure({ text, label = 'Original architecture sketch' }: { text: string; label?: string }) {
  return <figure className="architecture-figure" aria-label={label}><figcaption>{label}</figcaption><pre><code>{text}</code></pre></figure>;
}
export function ContentSections({ sections }: { sections: ContentSection[] }) {
  return <>{sections.map((section, i) => <section id={`section-${i}`} key={section.title}><h2>{section.title}</h2>{section.body.split(/\n\s*\n/).map((paragraph, j) => <p key={j}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}{section.code && <pre><code>{section.code}</code></pre>}{section.diagram && <ArchitectureFigure text={section.diagram} />}</section>)}</>;
}

export function IconTile({ icon: Icon, color = 'var(--accent)', small = false }: { icon: LucideIcon; color?: string; small?: boolean }) {
  return <span className={`icon-tile ${small ? 'small' : ''}`} style={{ color, background: `color-mix(in srgb, ${color} 11%, var(--surface))` }}><Icon size={small ? 18 : 23} strokeWidth={1.7} /></span>;
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function Empty({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="empty"><Sparkles size={30} strokeWidth={1.4} /><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone.toLowerCase()}`}>{children}</span>;
}
export function Progress({ value, label }: { value: number; label?: string }) {
  return <div className="progress-wrap">{label && <div className="progress-label"><span>{label}</span><span>{Math.round(value)}%</span></div>}<div className="progress" role="progressbar" aria-label={label || 'Progress'} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}
export function AuthPrompt({ message = 'Sign in to save your progress and continue practicing.' }: { message?: string }) {
  return <div className="callout"><Sparkles size={20} /><div><strong>Make this progress yours</strong><p>{message}</p></div><Link className="button small" to="/login">Sign in <ArrowRight size={15} /></Link></div>;
}
export function ReadButton({ track, lesson, compact = false }: { track: string; lesson: string; compact?: boolean }) {
  const { data, setState, act, pending } = useStudio();
  const key = `${track}/${lesson}`, read = data.state.read.includes(key);
  return <button className={compact ? `read-toggle ${read ? 'checked' : ''}` : `button ${read ? 'soft' : 'secondary'}`} aria-label={compact ? `${read ? 'Mark unread' : 'Mark as read'}: ${lesson}` : undefined} aria-pressed={read} disabled={pending} onClick={() => act(async () => setState(await request<UserState>('/api/progress', { key, field: 'read', enabled: !read })))}>{read ? <Check size={16} /> : <span className="circle-outline" />}{!compact && (read ? 'Completed' : 'Mark as read')}</button>;
}
export function BookmarkButton({ resource }: { resource: string }) {
  const { data, setState, act, pending } = useStudio();
  const saved = data.state.bookmarks.includes(resource);
  return <button className={`icon-button ${saved ? 'active' : ''}`} aria-label={saved ? 'Remove bookmark' : 'Bookmark lesson'} aria-pressed={saved} disabled={pending} onClick={() => act(async () => setState(await request<UserState>('/api/progress', { key: resource, field: 'bookmarks', enabled: !saved })))}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>;
}
export function Comments({ resource }: { resource: string }) {
  const { data, act, notify, pending } = useStudio();
  const [comments, setComments] = useState<Comment[]>([]), [body, setBody] = useState(''), [filter, setFilter] = useState(''), [reply, setReply] = useState<Comment | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setComments([]); setError('');
    request<Comment[]>(`/api/comments?resource=${encodeURIComponent(resource)}`).then(value => { if (alive) setComments(value); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [resource]);
  return <section className="comments" id="comments"><div className="section-heading"><h2><MessageSquare size={20} /> Discussion <span className="muted">{comments.length}</span></h2>{comments.length > 3 && <input aria-label="Search comments" placeholder="Search comments" value={filter} onChange={e => setFilter(e.target.value)} />}</div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {data.user ? <form onSubmit={e => { e.preventDefault(); void act(async () => { await request('/api/comments', { resource, body, parentId: reply?.id }); setComments(await request<Comment[]>(`/api/comments?resource=${encodeURIComponent(resource)}`)); setBody(''); setReply(null); notify('Comment added to the local discussion.'); }); }}>{reply && <div className="reply-label">Replying to {reply.author}<button type="button" className="icon-button" aria-label="Cancel reply" onClick={() => setReply(null)}><X size={14} /></button></div>}<textarea aria-label="Add a comment" placeholder="Share a question or an insight…" minLength={2} maxLength={3000} required value={body} onChange={e => setBody(e.target.value)} /><button className="button small" disabled={pending}><Send size={15} /> Post comment</button></form> : <AuthPrompt message="Sign in to join this local discussion." />}
    {comments.filter(c => `${c.author} ${c.body}`.toLowerCase().includes(filter.toLowerCase())).map(comment => <article className={`comment ${comment.parentId ? 'reply' : ''}`} key={comment.id}><span className="avatar small">{comment.author[0]}</span><div><strong>{comment.author}</strong><time>{new Date(comment.createdAt).toLocaleDateString()}</time><p>{comment.body}</p><button className="text-button" onClick={() => setReply(comment)}>Reply</button></div></article>)}
    {!comments.length && !error && <p className="muted">Start a thoughtful conversation. No comments yet.</p>}
  </section>;
}
export function Footer() {
  return <footer className="footer"><div><strong>Interview Studio<span className="brand-dot">.</span></strong><p>Small steps. Stronger interviews.</p><span className="fine-print">An independent, original local application.</span></div><div><h4>Prepare</h4><Link to="/learn/system-design">System design</Link><Link to="/learn/code">Coding patterns</Link><Link to="/practice/behavioral">Behavioral practice</Link></div><div><h4>Explore</h4><Link to="/community/questions">Interview questions</Link><Link to="/guides/meta/senior">Company guides</Link><Link to="/blog">The Studio journal</Link></div><div><h4>Studio</h4><Link to="/pricing">Plans</Link><Link to="/support">Support</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></footer>;
}
export function CardLink({ to, title, description, icon: Icon, color }: { to: string; title: string; description: string; icon: LucideIcon; color?: string }) {
  return <Link className="card-link" to={to}><IconTile icon={Icon} color={color} /><div><strong>{title}</strong><p>{description}</p></div><ChevronRight size={18} /></Link>;
}
