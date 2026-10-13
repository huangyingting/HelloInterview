import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import type {StaffAccount,StaffAuditPage,StaffRole,StaffSupportPage,StaffSupportTicket} from '../../shared/types';
import {Badge,PageHeading} from '../components';
import {request,useStudio} from '../store';

const roleLabels:Record<StaffRole,string>={
  'support-agent':'Support agent',moderator:'Moderator','content-editor':'Content editor',
  'billing-operator':'Billing operator',administrator:'Administrator',
};

function StaffAccountCard({value,administrator,onChange}:{value:StaffAccount;administrator:boolean;onChange:(account:StaffAccount)=>void}) {
  const {notify}=useStudio(),[reason,setReason]=useState(''),[pending,setPending]=useState(false),next=value.status==='suspended'?'active':'suspended';
  const allowed=administrator&&['active','suspended'].includes(value.status);
  async function change() {
    setPending(true);
    try{
      const updated=await request<StaffAccount>(`/api/staff/accounts/${value.id}/status`,{status:next,revision:value.revision,reason},'PATCH');
      onChange(updated);setReason('');notify(next==='suspended'?'Account suspended and sessions revoked.':'Account reactivated; the member must sign in again.');
    }catch(error){notify(error instanceof Error?error.message:'The staff action failed.',true);}
    finally{setPending(false);}
  }

  return <article className="panel">
    <h3>{value.maskedEmail}</h3>
    <p><Badge tone={value.status==='active'?'green':'amber'}>{value.status.replaceAll('-',' ')}</Badge>{' '}
      {value.verified?'Verified contact':'Contact not verified'} · revision {value.revision} · {value.activeSessions} active session{value.activeSessions===1?'':'s'}</p>
    {allowed&&<form onSubmit={event=>{event.preventDefault();void change();}}>
      <label>Required staff reason
        <textarea required minLength={20} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}
          placeholder={`${next==='suspended'?'Suspend':'Reactivate'} this account because…`}/>
      </label>
      <button className={`button small ${next==='suspended'?'secondary':''}`} disabled={pending||reason.trim().length<20}>
        {pending?'Applying reviewed change…':next==='suspended'?'Suspend and revoke sessions':'Reactivate account'}
      </button>
    </form>}
    {!administrator&&<p className="fine-print">Your role can inspect this minimized account result but cannot change access.</p>}
  </article>;
}

function StaffSupportCard({value,onChange}:{value:StaffSupportTicket;onChange:(ticket:StaffSupportTicket)=>void}) {
  const {notify}=useStudio(),[reason,setReason]=useState(''),[status,setStatus]=useState(value.status);
  const [reply,setReply]=useState(''),[replyKey,setReplyKey]=useState(()=>crypto.randomUUID()),[pending,setPending]=useState(false);
  async function update(input:{assignment?:'me'|'none';status?:StaffSupportTicket['status']}) {
    setPending(true);
    try{
      const ticket=await request<StaffSupportTicket>(`/api/staff/support/${value.id}`,
        {revision:value.revision,reason,...input},'PATCH');
      onChange(ticket);setStatus(ticket.status);setReason('');notify('Support ticket state updated.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Support ticket update failed.',true);}
    finally{setPending(false);}
  }
  async function respond() {
    setPending(true);
    try{
      const result=await request<{ticket:StaffSupportTicket}>(`/api/staff/support/${value.id}/replies`,
        {requestId:replyKey,revision:value.revision,body:reply});
      onChange(result.ticket);setStatus(result.ticket.status);setReply('');setReplyKey(crypto.randomUUID());
      notify('In-app reply published. No email or helpdesk delivery was claimed.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Support reply failed.',true);}
    finally{setPending(false);}
  }
  return <article className="panel">
    <h3>{value.maskedEmail}</h3>
    <p><Badge tone={value.status==='resolved'?'green':'amber'}>{value.status}</Badge>{' '}
      {value.assignment==='me'?'Assigned to you':value.assignment==='other'?'Assigned to another agent':'Unassigned'} · revision {value.revision}</p>
    {!value.ownerAccess&&<p className="fine-print">No authenticated owner inbox is attached. Triage is available, but in-app reply delivery is not.</p>}
    <p>{value.body}</p><p className="fine-print">Saved {new Date(value.createdAt).toLocaleString()} · updated {new Date(value.updatedAt).toLocaleString()}</p>
    <label>Required support reason<textarea minLength={20} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    {value.assignment!=='other'&&<button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void update({assignment:value.assignment==='me'?'none':'me'})}>{value.assignment==='me'?'Release assignment':'Assign to me'}</button>}
    <form onSubmit={event=>{event.preventDefault();void update({status});}}>
      <label>Handling status<select value={status} onChange={event=>setStatus(event.target.value as StaffSupportTicket['status'])}>
        <option value="open">Open</option><option value="pending">Pending owner</option><option value="resolved">Resolved</option>
      </select></label>
      <button className="button secondary small" disabled={pending||reason.trim().length<20||status===value.status}>Apply status</button>
    </form>
    {value.ownerAccess&&value.assignment!=='other'&&<form onSubmit={event=>{event.preventDefault();void respond();}}>
      <label>Owner-visible in-app reply<textarea required minLength={1} maxLength={10000} value={reply} onChange={event=>setReply(event.target.value)}
        placeholder="Reply without including secrets or unsupported delivery promises."/>
      </label>
      <button className="button small" disabled={pending||!reply.trim()}>Publish in-app reply</button>
    </form>}
  </article>;
}

export function StaffPage() {
  const {data,notify}=useStudio(),[roles,setRoles]=useState<StaffRole[]|null>(null),[error,setError]=useState(''),[email,setEmail]=useState('');
  const [accounts,setAccounts]=useState<StaffAccount[]>([]),[searching,setSearching]=useState(false),[audit,setAudit]=useState<StaffAuditPage>();
  const [auditError,setAuditError]=useState(''),[loadingAudit,setLoadingAudit]=useState(false);
  const [support,setSupport]=useState<StaffSupportPage>(),[supportError,setSupportError]=useState(''),[loadingSupport,setLoadingSupport]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    request<{roles:StaffRole[]}>('/api/staff/session',undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted){setRoles(value.roles);setError('');}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Staff verification failed.');});
    return()=>controller.abort();
  },[data.user?.id]);
  const administrator=roles?.includes('administrator')??false,canSearch=roles?.some(role=>role==='support-agent'||role==='administrator')??false;
  async function search() {
    setSearching(true);
    try{
      const value=await request<{accounts:StaffAccount[]}>(`/api/staff/accounts?${new URLSearchParams({email:email.trim()})}`);
      setAccounts(value.accounts);notify(value.accounts.length?'Exact account matches loaded.':'No managed account matched that exact contact.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Account lookup failed.',true);}
    finally{setSearching(false);}
  }
  async function loadAudit(cursor?:string) {
    setLoadingAudit(true);
    try{
      const page=await request<StaffAuditPage>(`/api/staff/audit${cursor?`?${new URLSearchParams({cursor})}`:''}`);
      setAudit(current=>cursor&&current?{events:[...current.events,...page.events],nextCursor:page.nextCursor}:page);setAuditError('');
    }catch(cause){setAuditError(cause instanceof Error?cause.message:'Staff audit history could not be loaded.');}
    finally{setLoadingAudit(false);}
  }
  async function loadSupport(cursor?:string) {
    setLoadingSupport(true);
    try{
      const page=await request<StaffSupportPage>(`/api/staff/support${cursor?`?${new URLSearchParams({cursor})}`:''}`);
      setSupport(current=>cursor&&current?{...page,tickets:[...current.tickets,...page.tickets]}:page);setSupportError('');
    }catch(cause){setSupportError(cause instanceof Error?cause.message:'Support queue could not be loaded.');}
    finally{setLoadingSupport(false);}
  }
  return <>
    <PageHeading eyebrow="STAFF OPERATIONS" title="Account access, without impersonation." description="Privileged actions require a current managed session, verified MFA, a fresh sign-in, an active time-bounded role and an explicit reason."/>
    {error&&<section className="panel"><h2>Confirm privileged access</h2><p role="alert">{error}</p><p>Use an MFA-enabled identity provider and confirm that sign-in again. Fresh authentication alone is not treated as MFA.</p><Link className="button secondary small" to="/account">Open sign-in security</Link></section>}
    {!roles&&!error&&<p role="status">Verifying staff session and role…</p>}
    {roles&&<><section className="panel"><h2>Current authority</h2><p>{roles.map(role=>roleLabels[role]).join(', ')}. Role grants expire automatically and cannot be changed from this screen.</p><p className="fine-print">This checkpoint does not permit impersonation, private preparation access, billing changes, staff self-suspension or changes to another staff account.</p></section>
      {canSearch&&<section className="panel"><h2>Exact managed-account lookup</h2><p>Search requires the full contact email. Results return masked contact, state, revision and session count only.</p>
        <form onSubmit={event=>{event.preventDefault();void search();}}>
          <label>Exact contact email<input required type="email" autoComplete="off" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label>
          <button className="button small" disabled={searching}>{searching?'Looking up exact match…':'Find account'}</button>
        </form>
      </section>}
      {!!accounts.length&&<div className="account-grid">{accounts.map(value=><StaffAccountCard key={value.id} value={value} administrator={administrator}
        onChange={updated=>setAccounts(current=>current.map(item=>item.id===updated.id?updated:item))}/>)}</div>}
      {canSearch&&<section className="panel"><h2>In-app support queue</h2>
        <p>Requests and replies remain inside the authenticated Studio. No email, helpdesk delivery, staffed SLA or escalation is connected.</p>
        {!support&&<button className="button secondary small" disabled={loadingSupport} onClick={()=>void loadSupport()}>Load support queue</button>}
        {supportError&&<><p role="alert">{supportError}</p><button className="button secondary small" disabled={loadingSupport} onClick={()=>void loadSupport()}>Retry support queue</button></>}
        {support?.tickets.map(ticket=><StaffSupportCard key={ticket.id} value={ticket}
          onChange={updated=>setSupport(current=>current&&({...current,tickets:current.tickets.map(item=>item.id===updated.id?updated:item)}))}/>)}
        {support&&!support.tickets.length&&<p>No support requests are saved.</p>}
        {support?.nextCursor&&<button className="button secondary small" disabled={loadingSupport} onClick={()=>void loadSupport(support.nextCursor!)}>Load older support requests</button>}
      </section>}
      {administrator&&<section className="panel"><h2>Immutable staff audit</h2>
        {!audit&&<button className="button secondary small" disabled={loadingAudit} onClick={()=>void loadAudit()}>View recent staff audit</button>}
        {auditError&&<><p role="alert">{auditError}</p><button className="button secondary small" disabled={loadingAudit} onClick={()=>void loadAudit()}>Retry audit history</button></>}
        {audit?.events.map(event=><article className="panel" key={event.id}><strong>{event.action.replaceAll('.',' ')}</strong>
          <p>{event.createdAt} · actor {event.actorRef} · target {event.targetRef}{event.actorRole?` · ${roleLabels[event.actorRole]}`:''}</p>
          <p>{event.reason}</p>{event.priorRevision!==null&&<p className="fine-print">Account revision {event.priorRevision} → {event.resultRevision}</p>}
        </article>)}
        {audit?.nextCursor&&<button className="button secondary small" disabled={loadingAudit} onClick={()=>void loadAudit(audit.nextCursor!)}>Load older audit events</button>}
        {audit&&!audit.events.length&&<p>No staff audit events are recorded.</p>}
      </section>}
    </>}
  </>;
}
