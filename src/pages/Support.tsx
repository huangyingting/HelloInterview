import { useEffect, useRef, useState } from 'react';
import type { SupportHistory } from '../../shared/types';
import { Badge } from '../components';
import { request } from '../store';

export function SupportHistoryPanel({ savedId }: { savedId: string }) {
  const [history,setHistory]=useState<SupportHistory|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [reload,setReload]=useState(0);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>{
    active.current?.abort();
    const controller=new AbortController();
    active.current=controller;
    setLoading(true);setError('');
    request<SupportHistory>('/api/support/requests',undefined,'GET',controller.signal).then(result=>{
      if(!controller.signal.aborted)setHistory(result);
    }).catch(reason=>{
      if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Your saved requests could not be loaded.');
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>{controller.abort();active.current?.abort();};
  },[savedId,reload]);
  async function more() {
    if(!history?.nextCursor||loading)return;
    active.current?.abort();
    const controller=new AbortController();active.current=controller;
    setLoading(true);setError('');
    try {
      const next=await request<SupportHistory>(`/api/support/requests?cursor=${encodeURIComponent(history.nextCursor)}`,undefined,'GET',controller.signal);
      if(!controller.signal.aborted)setHistory({ ...next,tickets:[...history.tickets,...next.tickets] });
    } catch(reason) {if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'More saved requests could not be loaded.');}
    finally {if(!controller.signal.aborted)setLoading(false);}
  }
  return <section className="panel support-history" aria-labelledby="support-history-heading"><h2 id="support-history-heading">Your saved requests</h2><p className="muted">Requests and any support-team replies stay inside your authenticated Studio account. External email/helpdesk delivery and response times are not promised.</p><button className="button secondary small" disabled={loading} onClick={()=>setReload(value=>value+1)}>{error?'Reload saved requests':'Refresh saved requests'}</button>{error&&<p role="alert">{error}</p>}{history?.tickets.map(ticket=><article className="support-receipt" key={ticket.id}><div><Badge>{ticket.handlingStatus} · in-app only</Badge><time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString()}</time></div><p>{ticket.body}</p><small>Contact: {ticket.email}</small>{ticket.replies.map(reply=><blockquote key={reply.id}><strong>Support team</strong><p>{reply.body}</p><time dateTime={reply.createdAt}>{new Date(reply.createdAt).toLocaleString()}</time></blockquote>)}<code>{ticket.id}</code></article>)}{history&&!history.tickets.length&&!loading&&<p>No saved requests yet.</p>}{loading&&<p role="status">Loading your saved requests…</p>}{history?.nextCursor&&<button className="button secondary small" disabled={loading} onClick={()=>void more()}>Load older requests</button>}</section>;
}
