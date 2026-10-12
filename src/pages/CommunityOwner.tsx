import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CommunityPost, OwnedCommunityPost } from '../../shared/types';
import { request, useStudio } from '../store';

export function CommunityOwner({ post, onSaved, onDeleted }: {
  post: CommunityPost; onSaved: (post: CommunityPost) => void; onDeleted: () => void;
}) {
  const { act, notify, pending } = useStudio();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<OwnedCommunityPost>(), [current, setCurrent] = useState<OwnedCommunityPost>();
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const alive = useRef(false);
  const url = `/api/posts/owned?${new URLSearchParams({ id: post.id })}`;
  const install = (snapshot: OwnedCommunityPost) => {
    setSaved(snapshot); setTitle(snapshot.post.title); setBody(snapshot.post.body);
    setCurrent(undefined); setConfirmed(false); setError(''); setLoading(false);
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || saved) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void request<OwnedCommunityPost>(url, undefined, 'GET', controller.signal).then(value => {
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
      const snapshot = await request<OwnedCommunityPost>(url);
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
      const snapshot = await request<OwnedCommunityPost>('/api/posts/owned', { id: post.id, revision: saved.revision, title, body }, 'PUT');
      if (!alive.current) return;
      install(snapshot); onSaved(snapshot.post); notify('Your changes were saved to this local post.');
    } catch (reason) {
      if (alive.current) setError(`Saving was not confirmed. ${reason instanceof Error ? reason.message : 'Check the saved version before trying again.'}`);
      throw reason;
    }
  });
  const remove = () => act(async () => {
    if (!saved || !confirmed) return;
    setError('');
    try {
      await request('/api/posts/owned', { id: post.id, revision: saved.revision }, 'DELETE');
      if (!alive.current) return;
      notify('Your local post and its discussion were deleted.'); onDeleted();
    } catch (reason) {
      if (alive.current) setError(`Deletion was not confirmed. ${reason instanceof Error ? reason.message : 'Check the saved version before trying again.'}`);
      throw reason;
    }
  });
  const dirty = saved && (title !== saved.post.title || body !== saved.post.body);
  return <section className="owned-contribution">
    <button className="button secondary small" aria-expanded={open} aria-controls="owned-contribution" disabled={pending} onClick={() => setOpen(!open)}><Pencil size={15} /> Manage your post</button>
    {open && <div className="panel post-editor" id="owned-contribution">
      <div className="section-heading"><h2>Your original contribution</h2><button className="button secondary small" disabled={pending} onClick={() => setOpen(false)}>Close editor</button></div>
      <p className="fine-print">Edit the title and original text. Context, authorship and publication date stay unchanged. Unsaved edits stay here while this page stays open.</p>
      {loading && <p role="status">Loading your saved contribution...</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {saved && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <p className="fine-print">Editing saved revision {saved.revision}.</p>
        <label>Title<input aria-label="Edit post title" required minLength={5} maxLength={200} value={title} disabled={pending} onChange={event => setTitle(event.target.value)} /></label>
        <label>Original text<textarea aria-label="Edit post details" required minLength={20} maxLength={10000} value={body} disabled={pending} onChange={event => setBody(event.target.value)} /></label>
        <button className="button small" disabled={pending || !dirty}>Save post changes</button>
      </form>}
      <button className="button secondary small" disabled={pending || loading} onClick={() => void check()}>Check saved version</button>
      {current && <article className="panel"><h3>Current saved version</h3><p className="fine-print">Saved revision {current.revision}. Checking did not replace your draft.</p><strong>{current.post.title}</strong><p className="post-body">{current.post.body}</p><button className="button secondary small" disabled={pending} onClick={() => { install(current); onSaved(current.post); }}>Replace my draft with saved version</button></article>}
      {saved && <div role="group" aria-label="Delete original local post">
        <h3>Delete this local contribution</h3><p>This permanently removes this post, its exact local discussion, votes and follows. It also discards your unsaved edit. This is not account or privacy deletion.</p>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} /> I understand this deletes my post, its discussion, votes and follows.</label>
        <button className="button secondary small" disabled={pending || !confirmed} onClick={() => void remove()}><Trash2 size={15} /> Delete my local post</button>
      </div>}
    </div>}
  </section>;
}
