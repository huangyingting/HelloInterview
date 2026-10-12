import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Comment, CommunityPost, OwnedCommunityComment, OwnedCommunityPost } from '../../shared/types';
import { request, useStudio } from '../store';

type PostProps = { post: CommunityPost; comment?: never; onSaved: (post: CommunityPost) => void; onDeleted: () => void };
type CommentProps = { comment: Comment; post?: never; onSaved: (comment: Comment) => void; onDeleted?: never };
type Snapshot = OwnedCommunityPost | OwnedCommunityComment;
export function CommunityOwner(props: PostProps) { return <ContributionOwner {...props} />; }
export function CommentOwner(props: CommentProps) { return <ContributionOwner {...props} />; }
function ContributionOwner(props: PostProps | CommentProps) {
  const { act, notify, pending } = useStudio();
  const [open, setOpen] = useState(!!props.comment), [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Snapshot>(), [current, setCurrent] = useState<Snapshot>();
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const alive = useRef(false);
  const instanceId = useId(), editorId = props.post ? 'owned-contribution' : instanceId;
  const id = props.post ? props.post.id : props.comment.id;
  const endpoint = props.post ? '/api/posts/owned' : '/api/comments/owned';
  const url = `${endpoint}?${new URLSearchParams({ id })}`;
  const values = (snapshot: Snapshot) => {
    if (props.post && 'post' in snapshot) return { title: snapshot.post.title, body: snapshot.post.body };
    if (props.comment && 'comment' in snapshot) return { title: '', body: snapshot.comment.body };
    throw new Error('The saved contribution does not match this editor.');
  };
  const publish = (snapshot: Snapshot) => {
    if (props.post && 'post' in snapshot) props.onSaved(snapshot.post);
    else if (props.comment && 'comment' in snapshot) props.onSaved(snapshot.comment);
    else throw new Error('The saved contribution does not match this editor.');
  };
  const install = (snapshot: Snapshot) => {
    const draft = values(snapshot);
    setSaved(snapshot); setTitle(draft.title); setBody(draft.body);
    setCurrent(undefined); setConfirmed(false); setError(''); setLoading(false);
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || saved) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void request<Snapshot>(url, undefined, 'GET', controller.signal).then(value => {
      if (!controller.signal.aborted) install(value);
    }).catch(reason => {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : 'Your saved contribution could not be loaded.';
        setError(message); notify(message, true);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, saved, url, notify]);
  const check = () => act(async () => {
    setError('');
    try {
      const snapshot = await request<Snapshot>(url); values(snapshot);
      if (!alive.current) return;
      if (saved) setCurrent(snapshot); else install(snapshot);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'The saved version could not be checked.');
      throw reason;
    }
  });
  const save = () => act(async () => {
    if (!saved) return;
    setError('');
    try {
      const snapshot = await request<Snapshot>(endpoint, { id, revision: saved.revision, ...(props.post ? { title } : {}), body }, 'PUT');
      if (!alive.current) return;
      install(snapshot); publish(snapshot); notify(`Your changes were saved to this local ${props.post ? 'post' : 'comment'}.`);
    } catch (reason) {
      if (alive.current) setError(`Saving was not confirmed. ${reason instanceof Error ? reason.message : 'Check the saved version before trying again.'}`);
      throw reason;
    }
  });
  const remove = () => act(async () => {
    if (!saved || !confirmed || !props.post) return;
    setError('');
    try {
      await request(endpoint, { id, revision: saved.revision }, 'DELETE');
      if (!alive.current) return;
      notify('Your local post and its discussion were deleted.'); props.onDeleted();
    } catch (reason) {
      if (alive.current) setError(`Deletion was not confirmed. ${reason instanceof Error ? reason.message : 'Check the saved version before trying again.'}`);
      throw reason;
    }
  });
  const dirty = saved && (title !== values(saved).title || body !== values(saved).body);
  return <section className="owned-contribution">
    <button className="button secondary small" aria-expanded={open} aria-controls={editorId} disabled={pending} onClick={() => setOpen(!open)}><Pencil size={15} /> {props.post ? 'Manage your post' : 'Edit my comment'}</button>
    {open && <div className="panel post-editor" id={editorId}>
      <div className="section-heading"><h2>{props.post ? 'Your original contribution' : 'Your original comment'}</h2><button className="button secondary small" disabled={pending} onClick={() => setOpen(false)}>Close editor</button></div>
      <p className="fine-print">{props.post ? 'Edit the title and original text.' : 'Edit your original text; the discussion and reply parent stay unchanged.'} Context, authorship and publication date stay unchanged. Unsaved edits stay here while this page stays open.</p>
      {loading && <p role="status">Loading your saved contribution...</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {saved && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <p className="fine-print">Editing saved revision {saved.revision}.</p>
        {props.post && <label>Title<input aria-label="Edit post title" required minLength={5} maxLength={200} value={title} disabled={pending} onChange={event => setTitle(event.target.value)} /></label>}
        <label>Original text<textarea aria-label={props.post ? 'Edit post details' : 'Edit comment text'} required minLength={props.post ? 20 : 2} maxLength={props.post ? 10000 : 3000} value={body} disabled={pending} onChange={event => setBody(event.target.value)} /></label>
        <button className="button small" disabled={pending || !dirty}>{props.post ? 'Save post changes' : 'Save comment changes'}</button>
      </form>}
      <button className="button secondary small" disabled={pending || loading || !saved && !error} onClick={() => void check()}>Check saved version</button>
      {current && <article className="panel"><h3>Current saved version</h3><p className="fine-print">Saved revision {current.revision}. Checking did not replace your draft.</p>{props.post && <strong>{values(current).title}</strong>}<p className="post-body">{values(current).body}</p><button className="button secondary small" disabled={pending} onClick={() => { install(current); publish(current); }}>Replace my draft with saved version</button></article>}
      {saved && props.post && <div role="group" aria-label="Delete original local post">
        <h3>Delete this local contribution</h3><p>This permanently removes this post, its exact local discussion, votes and follows. It also discards your unsaved edit. This is not account or privacy deletion.</p>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} /> I understand this deletes my post, its discussion, votes and follows.</label>
        <button className="button secondary small" disabled={pending || !confirmed} onClick={() => void remove()}><Trash2 size={15} /> Delete my local post</button>
      </div>}
    </div>}
  </section>;
}
