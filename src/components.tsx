import { Bookmark, Check, MessageSquare } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { request, useStudio } from './store';
import type { Comment, CommunityCommentPage, ContentSection, SourceReference, UserState } from '../shared/types';
import { getContentSource } from '../shared/content/sources';
import { getTrack, problems } from '../shared/public-catalog';
import { AuthPrompt } from './components/access';
import { LearningFlow } from './components/LearningFlow';
import { LessonCheck } from './components/LessonCheck';
export { AuthPrompt, NotFound, PremiumAccess, PremiumGate } from './components/access';
export { Badge, CardLink, Empty, Footer, IconTile, PageHeading, Progress } from './components/primitives';

export function SourceLinks({ ids, sources }: { ids?: string[]; sources?: SourceReference[] }) {
  if (!ids?.length) return null;
  const references = sources ?? ids.flatMap(id => { const source = getContentSource(id); return source ? [source] : []; });
  const date=[...new Set(references.map(source=>source.researchDate))].join(', ');
  return <div className="content-sources"><h4>Sources and further reading</h4><p className="fine-print">Original synthesis informed by public documentation. Research date: {date}; not expert-reviewed.</p><ul>{ids.map(id => {
    const source=references.find(source=>source.id===id);
    return source?<li key={id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><span> · {source.publisher}</span></li>:<li key={id}>Source reference unavailable: {id}</li>;
  })}</ul></div>;
}
export function ArchitectureFigure({ text, label = 'Original architecture sketch' }: { text: string; label?: string }) {
  return <figure className="architecture-figure" aria-label={label}><figcaption>{label}</figcaption><pre><code>{text}</code></pre></figure>;
}
const AIVisualLab = lazy(() => import('./components/AIVisualLab'));
const CurriculumLab = lazy(() => import('./components/CurriculumLab'));
export function ContentSections({ sections }: { sections: ContentSection[] }) {
  return <>{sections.map((section, i) => <section id={`section-${i}`} key={section.title}><h2>{section.title}</h2>{section.body.split(/\n\s*\n/).map((paragraph, j) => <p key={j}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}{section.code && <pre><code>{section.code}</code></pre>}{section.diagram && <ArchitectureFigure text={section.diagram} />}{section.flow && <div className="lesson-activity-target" id={`section-${i}-flow`} tabIndex={-1}><LearningFlow flow={section.flow}/></div>}{(section.visualization || section.lab) && <div className="lesson-activity-target" id={`section-${i}-lab`} tabIndex={-1}>{section.visualization && <Suspense fallback={<p role="status">Loading interactive diagram...</p>}><AIVisualLab kind={section.visualization}/></Suspense>}{section.lab && <Suspense fallback={<p role="status">Loading lesson experiment...</p>}><CurriculumLab lab={section.lab}/></Suspense>}</div>}{section.check && <div className="lesson-activity-target" id={`section-${i}-check`} tabIndex={-1}><LessonCheck check={section.check}/></div>}</section>)}</>;
}

export function ReadButton({ track, lesson, compact = false }: { track: string; lesson: string; compact?: boolean }) {
  const { data, can, setState, act, pending } = useStudio();
  const key = `${track}/${lesson}`, read = data.state.read.includes(key);
  const premium = track === 'practice' ? problems.find(problem => problem.id === lesson)?.premium : getTrack(track)?.lessons.find(item => item.id === lesson)?.premium;
  return <button className={compact ? `read-toggle ${read ? 'checked' : ''}` : `button ${read ? 'soft' : 'secondary'}`} aria-label={compact ? `${read ? 'Mark unread' : 'Mark as read'}: ${lesson}` : undefined} aria-pressed={read} disabled={pending || !!premium && !read && !can('learning.premium.write')} onClick={() => act(async () => setState(await request<UserState>('/api/progress', { key, field: 'read', enabled: !read })))}>{read ? <Check size={16} /> : <span className="circle-outline" />}{!compact && (read ? 'Completed' : 'Mark as read')}</button>;
}
export function BookmarkButton({ resource }: { resource: string }) {
  const { data, setState, act, pending } = useStudio();
  const saved = data.state.bookmarks.includes(resource);
  return <button className={`icon-button ${saved ? 'active' : ''}`} aria-label={saved ? 'Remove bookmark' : 'Bookmark lesson'} aria-pressed={saved} disabled={pending} onClick={() => act(async () => setState(await request<UserState>('/api/progress', { key: resource, field: 'bookmarks', enabled: !saved })))}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>;
}
const CommentOwner = lazy(() => import('./screens/CommunityOwner').then(module => ({ default: module.CommentOwner })));
const CommentComposer = lazy(() => import('./screens/CommunitySubmissions').then(module => ({ default: module.CommentComposer })));
const SubmissionHistory = lazy(() => import('./screens/CommunitySubmissions').then(module => ({ default: module.CommentSubmissionHistory })));
const CommunityReportControl = lazy(() => import('./screens/CommunityReport').then(module => ({default:module.CommunityReportControl})));
const CommunityAppealControl = lazy(() => import('./screens/CommunityReport').then(module => ({default:module.CommunityAppealControl})));
const CommunityMuteControl = lazy(() => import('./screens/CommunityReport').then(module => ({default:module.CommunityMuteControl})));
const CommunityBlockControl = lazy(() => import('./screens/CommunityReport').then(module => ({default:module.CommunityBlockControl})));
export function CommentSubmissionHistory({resource}:{resource?:string}) {
  const [opened,setOpened]=useState(false);
  return opened?<Suspense fallback={<p role="status">Loading submission history controls...</p>}><SubmissionHistory resource={resource}/></Suspense>:<button className="text-button" onClick={()=>setOpened(true)}>View comment submission history</button>;
}
function CommentTools({ comment, onSaved, onDeleted }: { comment: Comment; onSaved: (comment: Comment) => void; onDeleted:(comment:Comment|null)=>void }) {
  const [editing, setEditing] = useState(false);
  return editing ? <Suspense fallback={<p role="status">Loading your comment editor...</p>}><CommentOwner comment={comment} onSaved={onSaved} onDeleted={onDeleted} /></Suspense>
    : <button className="text-button" onClick={() => setEditing(true)}>{comment.moderated?'Manage hidden comment':'Edit my comment'}</button>;
}
function appendComments(current: Comment[], incoming: Comment[]) {
  const seen = new Set(current.map(comment => comment.id));
  return [...current,...incoming.filter(comment => {
    if (seen.has(comment.id)) return false;
    seen.add(comment.id);
    return true;
  })];
}
export function Comments({ resource }: { resource: string }) {
  const { data } = useStudio();
  const scope = JSON.stringify([data.user?.id ?? null,resource]);
  const [loaded, setLoaded] = useState<{ scope: string; comments?: Comment[]; nextCursor?: string | null; error?: string; loadingMore?: boolean; moreError?: string }>(), [filter, setFilter] = useState(''), [reply, setReply] = useState<Comment | null>(null);
  const reader = useRef<{ controller: AbortController; pending: boolean } | null>(null);
  const comments = loaded?.scope === scope ? loaded.comments ?? [] : [];
  const error = loaded?.scope === scope ? loaded.error ?? '' : '';
  const pageState = loaded?.scope === scope ? loaded : undefined;
  const reading = loaded?.scope !== scope || !loaded?.comments && !error;
  const pagePath = (cursor?: string) => `/api/comments/page?${new URLSearchParams({resource,...(cursor ? {cursor} : {})})}`;
  async function readFirst(controller: AbortController) {
    const read = reader.current;
    if (!read || read.controller !== controller || controller.signal.aborted || read.pending) return;
    read.pending = true;
    setLoaded({scope});
    try {
      const value = await request<CommunityCommentPage>(pagePath(),undefined,'GET',controller.signal);
      if (!controller.signal.aborted) setLoaded(current => current?.scope === scope ? {scope,comments:value.comments,nextCursor:value.nextCursor} : current);
    } catch(err) {
      if (!controller.signal.aborted) setLoaded(current => current?.scope === scope ? {scope,error:err instanceof Error ? err.message : 'The discussion could not be loaded.'} : current);
    } finally { read.pending = false; }
  }
  useEffect(() => {
    const controller = new AbortController();
    reader.current = {controller,pending:false};
    setReply(null); setFilter('');
    void readFirst(controller);
    return () => controller.abort();
  }, [scope]);
  async function loadMore() {
    const cursor = pageState?.nextCursor, read = reader.current;
    if (!cursor || !read || read.controller.signal.aborted || read.pending) return;
    read.pending = true;
    setLoaded(current => current?.scope === scope ? {...current,loadingMore:true,moreError:undefined} : current);
    try {
      const next = await request<CommunityCommentPage>(pagePath(cursor),undefined,'GET',read.controller.signal);
      if (!read.controller.signal.aborted) setLoaded(current => current?.scope === scope && current.comments ? {...current,comments:appendComments(current.comments,next.comments),nextCursor:next.nextCursor,loadingMore:false} : current);
    } catch(err) {
      if (!read.controller.signal.aborted) setLoaded(current => current?.scope === scope ? {...current,loadingMore:false,moreError:err instanceof Error ? err.message : 'Additional discussion comments could not be loaded.'} : current);
    } finally { read.pending = false; }
  }
  return <section className="comments" id="comments"><div className="section-heading"><h2><MessageSquare size={20} /> Discussion <span className="muted">{comments.length} loaded</span></h2>{comments.length > 3 && <input aria-label="Search comments" placeholder="Search loaded comments" value={filter} onChange={e => setFilter(e.target.value)} />}</div>
    {error && <><p role="alert" className="error-text">{error}</p><button className="button secondary small" onClick={()=>{const read=reader.current;if(read&&!read.controller.signal.aborted)void readFirst(read.controller);}}>Retry discussion</button></>}
    {reading && <p role="status">Loading the discussion...</p>}
    {data.capabilities.community==='read-only' ? <p className="local-notice">New discussion is paused. Reporting and removing your own contributions remain available.</p> : data.user ? <><Suspense fallback={<p role="status">Loading comment composer...</p>}><CommentComposer key={scope} resource={resource} disabled={reading||!!error} reply={reply} onCancelReply={()=>setReply(null)} onCreated={(comment,parentId)=>{setLoaded(current=>current?.scope===scope&&current.comments?{...current,comments:appendComments(current.comments,[comment])}:current);setReply(current=>current?.id===parentId?null:current);}}/></Suspense><CommentSubmissionHistory key={scope} resource={resource}/></> : <AuthPrompt message="Sign in to join this discussion." />}
    {comments.map(comment => <article className={`comment ${comment.parentId ? 'reply' : ''}`} hidden={!`${comment.author} ${comment.body}`.toLowerCase().includes(filter.toLowerCase())} key={`${scope}:${comment.id}`}><span className="avatar small">{comment.author[0]}</span><div><strong>{comment.author}</strong><time>{new Date(comment.createdAt).toLocaleDateString()}</time><p>{comment.body}</p>{comment.muted&&<p className="fine-print">This viewer-only tombstone cannot be replied to or reported.</p>}{comment.blocked&&<p className="fine-print">This viewer-only safety tombstone does not reveal who created the private relationship setting. It cannot be replied to or reported from this view.</p>}{data.capabilities.community!=='read-only'&&!comment.deleted&&!comment.moderated&&!comment.muted&&!comment.blocked&&<button className="text-button" onClick={() => setReply(comment)}>Reply</button>}{data.user&&!comment.deleted&&!comment.moderated&&!comment.muted&&!comment.blocked&&<Suspense fallback={null}><CommunityReportControl targetType="comment" targetId={comment.id}/></Suspense>}{data.user&&!comment.isMine&&!comment.deleted&&!comment.moderated&&!comment.muted&&!comment.blocked&&<><Suspense fallback={null}><CommunityMuteControl targetType="comment" targetId={comment.id} onMuted={()=>{setReply(current=>current?.id===comment.id?null:current);setLoaded(current=>current?.scope===scope&&current.comments?{...current,comments:current.comments.map(row=>row.id===comment.id?{...row,author:'Muted',body:'This comment is hidden because you muted its author.',muted:true}:row)}:current);}}/></Suspense><Suspense fallback={null}><CommunityBlockControl targetType="comment" targetId={comment.id} onBlocked={()=>{setReply(null);setLoaded(current=>current?.scope===scope&&current.comments?{...current,comments:current.comments.map(row=>row.id===comment.id?{...row,author:'Unavailable',body:'This comment is unavailable due to a personal safety setting.',blocked:true,muted:false}:row)}:current);const read=reader.current;if(read&&!read.controller.signal.aborted)void readFirst(read.controller);}}/></Suspense></>}{data.user&&comment.isMine&&comment.moderated&&<Suspense fallback={null}><CommunityAppealControl targetType="comment" targetId={comment.id} targetRevision={comment.moderationRevision}/></Suspense>}{data.user&&comment.isMine&&<CommentTools comment={comment} onSaved={saved=>setLoaded(current=>current?.scope===scope&&current.comments?{...current,comments:current.comments.map(row=>row.id===saved.id?saved:row)}:current)} onDeleted={saved=>setLoaded(current=>current?.scope===scope&&current.comments?{...current,comments:saved?current.comments.map(row=>row.id===saved.id?saved:row):current.comments.filter(row=>row.id!==comment.id)}:current)}/>}</div></article>)}
    {filter && !comments.some(comment=>`${comment.author} ${comment.body}`.toLowerCase().includes(filter.toLowerCase())) && <p className="muted">No loaded comments match this search.</p>}
    {pageState?.moreError && <p role="alert" className="error-text">Additional comments were not loaded: {pageState.moreError} Your loaded discussion and drafts are unchanged.</p>}
    {pageState?.nextCursor && <><p className="fine-print">More comments remain. Search filters loaded comments only. New comments you add are shown immediately while older pages load.</p><button className="button secondary small" disabled={pageState.loadingMore} onClick={()=>void loadMore()}>{pageState.loadingMore?'Loading more comments...':'Load more comments'}</button></>}
    {!reading && !comments.length && !error && <p className="muted">Start a thoughtful conversation. No comments yet.</p>}
  </section>;
}
