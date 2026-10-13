import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import type {
  StaffAccount,StaffAuditPage,StaffCommunityAppeal,StaffCommunityAppealPage,StaffCommunityReport,StaffCommunityReportPage,
  StaffCommunityRestriction,StaffCommunityRestrictionAppeal,StaffCommunityRestrictionAppealPage,
  StaffCommunityRestrictionPage,StaffRole,StaffSupportPage,StaffSupportTicket,
} from '../../shared/types';
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

function StaffModerationCard({value,administrator,onChange}:{value:StaffCommunityReport;administrator:boolean;onChange:(report:StaffCommunityReport)=>void}) {
  const {notify}=useStudio(),[reason,setReason]=useState(''),[pending,setPending]=useState(false);
  const [durationHours,setDurationHours]=useState<24|168|720>(168);
  async function apply(action:'claim'|'release'|'dismiss'|'hide'|'restore') {
    setPending(true);
    try{
      const report=await request<StaffCommunityReport>(`/api/staff/community/reports/${value.id}`,
        {revision:value.revision,targetRevision:value.targetRevision,action,reason},'PATCH');
      onChange(report);setReason('');notify('Moderation state updated with immutable staff evidence.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Moderation action failed.',true);}
    finally{setPending(false);}
  }
  async function restrict(subject:'author'|'reporter',scope:'participation'|'reporting') {
    setPending(true);
    try{
      await request<StaffCommunityRestriction>(`/api/staff/community/reports/${value.id}/restrictions`,
        {reportRevision:value.revision,targetRevision:value.targetRevision,subject,scope,durationHours,reason});
      setReason('');notify(subject==='author'
        ?'Author participation restricted with an expiring reviewed record.'
        :'Reporter submission restricted with an expiring reviewed record.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Community restriction failed.',true);}
    finally{setPending(false);}
  }
  async function reviewTriage(decision:'confirmed'|'rejected') {
    if(!value.triage)return;
    setPending(true);
    try{
      const report=await request<StaffCommunityReport>(`/api/staff/community/reports/${value.id}/triage`,
        {revision:value.triage.revision,decision,reason},'PATCH');
      onChange(report);setReason('');
      notify('Spam suggestion review saved without changing report, contribution or account state.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Spam suggestion review failed.',true);}
    finally{setPending(false);}
  }
  const available=administrator||value.assignment!=='other',targetAction=value.targetState==='hidden'?'restore':'hide';
  const canReviewTriage=administrator||value.assignment==='me';
  const triageCurrent=value.triage!==null&&value.target.contentRevision===value.triage.contentRevision;
  return <article className="panel">
    <h3>{value.target.title??`${value.targetType} report`}</h3>
    <p><Badge tone={value.status==='open'?'amber':'green'}>{value.status}</Badge>{' '}
      {value.assignment==='me'?'Assigned to you':value.assignment==='other'?'Assigned to another moderator':'Unassigned'} · report revision {value.revision} · target revision {value.targetRevision}</p>
    <p>{value.target.body}</p>
    <p className="fine-print">{value.targetType} by {value.target.author}{value.target.resource?` · ${value.target.resource}`:''} · currently {value.targetState}</p>
    <strong>{value.category.replaceAll('-',' ')}</strong><p>{value.details}</p>
    {value.triage?<div className="local-notice"><strong>Automated spam suggestion: {value.triage.classification.replaceAll('-',' ')}</strong>
      <p>Score {value.triage.score}/100 · {value.triage.algorithmVersion} · {value.triage.state}
        {value.triage.outcome?` (${value.triage.outcome})`:''} · triage revision {value.triage.revision} ·
        content revision {value.triage.contentRevision}{!triageCurrent&&value.triage.state==='pending'?' (stale or unavailable)':''}</p>
      <p className="fine-print">{value.triage.signals.length
        ?`Bounded signals: ${value.triage.signals.map(signal=>signal.replaceAll('-',' ')).join(', ')}.`
        :'No configured spam signals matched.'} This suggestion never changes visibility, report state, restrictions or account access.</p>
      {value.triage.state==='pending'&&canReviewTriage&&<>{triageCurrent&&<button className="button secondary small"
        disabled={pending||reason.trim().length<20} onClick={()=>void reviewTriage('confirmed')}>Confirm spam suggestion</button>
      }<button className="button secondary small" disabled={pending||reason.trim().length<20}
        onClick={()=>void reviewTriage('rejected')}>{triageCurrent?'Reject spam suggestion':'Reject stale spam suggestion'}</button></>}
    </div>:<p className="fine-print">No spam suggestion exists for this pre-migration report; no evidence was fabricated during reads.</p>}
    <label>Required moderation reason
      <textarea minLength={20} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}
        placeholder="Record the specific policy and evidence reviewed."/>
    </label>
    {available&&value.assignment!==null&&<label>Restriction duration
      <select value={durationHours} onChange={event=>setDurationHours(Number(event.target.value) as 24|168|720)}>
        <option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option>
      </select>
    </label>}
    {available&&<button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply(value.assignment==='me'?'release':'claim')}>{value.assignment==='me'?'Release report':'Claim report'}</button>}
    {available&&value.assignment!==null&&<><button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply(targetAction)}>{targetAction==='hide'?'Hide contribution':'Restore contribution'}</button>
      {value.status!=='dismissed'&&<button className="button secondary small" disabled={pending||reason.trim().length<20}
        onClick={()=>void apply('dismiss')}>Dismiss report</button>}
      <button className="button secondary small" disabled={pending||reason.trim().length<20}
        onClick={()=>void restrict('author','participation')}>Restrict author participation</button>
      <button className="button secondary small" disabled={pending||reason.trim().length<20}
        onClick={()=>void restrict('reporter','reporting')}>Restrict reporter submissions</button></>}
  </article>;
}

function StaffRestrictionCard({value,administrator,onChange}:{value:StaffCommunityRestriction;administrator:boolean;
  onChange:(restriction:StaffCommunityRestriction)=>void}) {
  const {notify}=useStudio(),[reason,setReason]=useState(''),[durationHours,setDurationHours]=useState<24|168|720>(720);
  const [pending,setPending]=useState(false),allowed=administrator||value.lastActor==='me';
  async function apply(action:'extend'|'lift') {
    setPending(true);
    try{
      const restriction=await request<StaffCommunityRestriction>(`/api/staff/community/restrictions/${value.id}`,
        action==='extend'?{action,revision:value.revision,durationHours,reason}:{action,revision:value.revision,reason},'PATCH');
      onChange(restriction);setReason('');notify(action==='extend'?'Community restriction extended.':'Community restriction lifted.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Community restriction update failed.',true);}
    finally{setPending(false);}
  }
  return <article className="panel">
    <h3>{value.scope==='participation'?'Author participation restriction':'Reporter submission restriction'}</h3>
    <p><Badge tone="amber">active</Badge>{' '}revision {value.revision} · expires {new Date(value.expiresAt).toLocaleString()}</p>
    <p>{value.target.body}</p>
    <p className="fine-print">Evidence report {value.sourceReportId} · {value.targetType} by {value.target.author}
      {value.target.resource?` · ${value.target.resource}`:''}. The subject account identifier and staff reason are not returned.</p>
    {allowed?<><label>Required restriction reason
      <textarea minLength={20} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}
        placeholder="Record the reviewed policy and evidence for this change."/>
    </label>
    <label>New duration from now
      <select value={durationHours} onChange={event=>setDurationHours(Number(event.target.value) as 24|168|720)}>
        <option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option>
      </select>
    </label>
    <button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply('extend')}>Extend restriction</button>
    <button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply('lift')}>Lift restriction</button></>
    :<p className="fine-print">Only the latest restricting moderator or an administrator can change this restriction.</p>}
  </article>;
}

function StaffRestrictionAppealCard({value,administrator,onChange}:{value:StaffCommunityRestrictionAppeal;
  administrator:boolean;onChange:(appeal:StaffCommunityRestrictionAppeal)=>void}) {
  const {notify}=useStudio(),[reason,setReason]=useState(''),[pending,setPending]=useState(false);
  async function apply(action:'claim'|'release'|'deny'|'uphold'|'resolve') {
    setPending(true);
    try{
      const appeal=await request<StaffCommunityRestrictionAppeal>(
        `/api/staff/community/restriction-appeals/${value.id}`,
        {revision:value.revision,restrictionRevision:value.restrictionRevision,action,reason},'PATCH');
      onChange(appeal);setReason('');notify('Restriction appeal updated with immutable review evidence.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Restriction appeal action failed.',true);}
    finally{setPending(false);}
  }
  const available=administrator||value.assignment!=='other',reviewReady=administrator||value.assignment==='me';
  const current=value.restrictionState==='active'&&value.restrictionRevision===value.appealedRestrictionRevision;
  const independent=administrator||value.restrictionActor==='other';
  return <article className="panel">
    <h3>{value.scope==='participation'?'Participation restriction appeal':'Reporting restriction appeal'}</h3>
    <p><Badge tone={value.status==='open'?'amber':'green'}>{value.status}</Badge>{' '}
      {value.assignment==='me'?'Assigned to you':value.assignment==='other'?'Assigned to another moderator':'Unassigned'} · appeal revision {value.revision}</p>
    <p>{value.target.body}</p>
    <p className="fine-print">{value.targetType} by {value.target.author}{value.target.resource?` · ${value.target.resource}`:''} ·
      appealed restriction revision {value.appealedRestrictionRevision} · now {value.restrictionState} at revision {value.restrictionRevision} ·
      expires {new Date(value.expiresAt).toLocaleString()}. No restricted account identifier or prior staff reason is returned.</p>
    <strong>Member appeal</strong><p>{value.statement}</p>
    <label>Required restriction appeal reason
      <textarea minLength={20} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}
        placeholder="Record the policy and evidence used for this independent review."/>
    </label>
    {available&&value.status==='open'&&<button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply(value.assignment==='me'?'release':'claim')}>{value.assignment==='me'?'Release restriction appeal':'Claim restriction appeal'}</button>}
    {reviewReady&&value.status==='open'&&current&&independent&&<><button className="button secondary small"
      disabled={pending||reason.trim().length<20} onClick={()=>void apply('uphold')}>Uphold appeal and lift restriction</button>
      <button className="button secondary small" disabled={pending||reason.trim().length<20}
        onClick={()=>void apply('deny')}>Deny restriction appeal</button></>}
    {reviewReady&&value.status==='open'&&current&&!independent&&
      <p className="fine-print">A different moderator or an administrator must decide this restriction appeal.</p>}
    {reviewReady&&value.status==='open'&&!current&&<button className="button secondary small"
      disabled={pending||reason.trim().length<20} onClick={()=>void apply('resolve')}>Resolve superseded restriction appeal</button>}
  </article>;
}

function StaffAppealCard({value,administrator,onChange}:{value:StaffCommunityAppeal;administrator:boolean;onChange:(appeal:StaffCommunityAppeal)=>void}) {
  const {notify}=useStudio(),[reason,setReason]=useState(''),[pending,setPending]=useState(false);
  async function apply(action:'claim'|'release'|'deny'|'uphold') {
    setPending(true);
    try{
      const appeal=await request<StaffCommunityAppeal>(`/api/staff/community/appeals/${value.id}`,
        {revision:value.revision,targetRevision:value.targetRevision,action,reason},'PATCH');
      onChange(appeal);setReason('');notify('Appeal state updated with immutable staff evidence.');
    }catch(cause){notify(cause instanceof Error?cause.message:'Appeal action failed.',true);}
    finally{setPending(false);}
  }
  const available=administrator||value.assignment!=='other';
  return <article className="panel">
    <h3>{value.target.title??`${value.targetType} appeal`}</h3>
    <p><Badge tone={value.status==='open'?'amber':'green'}>{value.status}</Badge>{' '}
      {value.assignment==='me'?'Assigned to you':value.assignment==='other'?'Assigned to another moderator':'Unassigned'} · appeal revision {value.revision} · target revision {value.targetRevision}</p>
    <p>{value.target.body}</p>
    <p className="fine-print">{value.targetType} by {value.target.author}{value.target.resource?` · ${value.target.resource}`:''} · currently {value.targetState} · appealed hidden revision {value.appealedTargetRevision}</p>
    <strong>Owner appeal</strong><p>{value.statement}</p>
    <label>Required appeal reason
      <textarea minLength={20} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}
        placeholder="Record the policy and evidence used for this second review."/>
    </label>
    {available&&<button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply(value.assignment==='me'?'release':'claim')}>{value.assignment==='me'?'Release appeal':'Claim appeal'}</button>}
    {available&&value.assignment!==null&&value.status==='open'&&<><button className="button secondary small" disabled={pending||reason.trim().length<20}
      onClick={()=>void apply('uphold')}>Uphold and restore contribution</button>
      <button className="button secondary small" disabled={pending||reason.trim().length<20}
        onClick={()=>void apply('deny')}>Deny appeal</button></>}
  </article>;
}

export function StaffPage() {
  const {data,notify}=useStudio(),[roles,setRoles]=useState<StaffRole[]|null>(null),[error,setError]=useState(''),[email,setEmail]=useState('');
  const [accounts,setAccounts]=useState<StaffAccount[]>([]),[searching,setSearching]=useState(false),[audit,setAudit]=useState<StaffAuditPage>();
  const [auditError,setAuditError]=useState(''),[loadingAudit,setLoadingAudit]=useState(false);
  const [support,setSupport]=useState<StaffSupportPage>(),[supportError,setSupportError]=useState(''),[loadingSupport,setLoadingSupport]=useState(false);
  const [moderation,setModeration]=useState<StaffCommunityReportPage>(),[moderationError,setModerationError]=useState(''),[loadingModeration,setLoadingModeration]=useState(false);
  const [appeals,setAppeals]=useState<StaffCommunityAppealPage>(),[appealsError,setAppealsError]=useState(''),[loadingAppeals,setLoadingAppeals]=useState(false);
  const [restrictions,setRestrictions]=useState<StaffCommunityRestrictionPage>(),[restrictionError,setRestrictionError]=useState('');
  const [loadingRestrictions,setLoadingRestrictions]=useState(false);
  const [restrictionAppeals,setRestrictionAppeals]=useState<StaffCommunityRestrictionAppealPage>();
  const [restrictionAppealError,setRestrictionAppealError]=useState(''),[loadingRestrictionAppeals,setLoadingRestrictionAppeals]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    request<{roles:StaffRole[]}>('/api/staff/session',undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted){setRoles(value.roles);setError('');}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Staff verification failed.');});
    return()=>controller.abort();
  },[data.user?.id]);
  const administrator=roles?.includes('administrator')??false,canSearch=roles?.some(role=>role==='support-agent'||role==='administrator')??false;
  const canModerate=roles?.some(role=>role==='moderator'||role==='administrator')??false;
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
  async function loadModeration(cursor?:string) {
    setLoadingModeration(true);
    try{
      const page=await request<StaffCommunityReportPage>(`/api/staff/community/reports${cursor?`?${new URLSearchParams({cursor})}`:''}`);
      setModeration(current=>cursor&&current?{reports:[...current.reports,...page.reports],nextCursor:page.nextCursor}:page);setModerationError('');
    }catch(cause){setModerationError(cause instanceof Error?cause.message:'Moderation queue could not be loaded.');}
    finally{setLoadingModeration(false);}
  }
  async function loadAppeals(cursor?:string) {
    setLoadingAppeals(true);
    try{
      const page=await request<StaffCommunityAppealPage>(`/api/staff/community/appeals${cursor?`?${new URLSearchParams({cursor})}`:''}`);
      setAppeals(current=>cursor&&current?{appeals:[...current.appeals,...page.appeals],nextCursor:page.nextCursor}:page);setAppealsError('');
    }catch(cause){setAppealsError(cause instanceof Error?cause.message:'Appeal queue could not be loaded.');}
    finally{setLoadingAppeals(false);}
  }
  async function loadRestrictions(cursor?:string) {
    setLoadingRestrictions(true);
    try{
      const page=await request<StaffCommunityRestrictionPage>(`/api/staff/community/restrictions${cursor?`?${new URLSearchParams({cursor})}`:''}`);
      setRestrictions(current=>cursor&&current?{restrictions:[...current.restrictions,...page.restrictions],nextCursor:page.nextCursor}:page);
      setRestrictionError('');
    }catch(cause){setRestrictionError(cause instanceof Error?cause.message:'Community restrictions could not be loaded.');}
    finally{setLoadingRestrictions(false);}
  }
  async function loadRestrictionAppeals(cursor?:string) {
    setLoadingRestrictionAppeals(true);
    try{
      const page=await request<StaffCommunityRestrictionAppealPage>(
        `/api/staff/community/restriction-appeals${cursor?`?${new URLSearchParams({cursor})}`:''}`);
      setRestrictionAppeals(current=>cursor&&current?{appeals:[...current.appeals,...page.appeals],nextCursor:page.nextCursor}:page);
      setRestrictionAppealError('');
    }catch(cause){setRestrictionAppealError(cause instanceof Error?cause.message:'Restriction appeals could not be loaded.');}
    finally{setLoadingRestrictionAppeals(false);}
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
      {canModerate&&<section className="panel"><h2>Community moderation queue</h2>
        <p>Reports and actions stay inside the authenticated Studio. Versioned spam suggestions require human review and never enforce an action. External notifications and a staffed SLA are not connected.</p>
        {!moderation&&<button className="button secondary small" disabled={loadingModeration} onClick={()=>void loadModeration()}>Load moderation queue</button>}
        {moderationError&&<><p role="alert">{moderationError}</p><button className="button secondary small" disabled={loadingModeration} onClick={()=>void loadModeration()}>Retry moderation queue</button></>}
        {moderation?.reports.map(report=><StaffModerationCard key={report.id} value={report} administrator={administrator}
          onChange={updated=>setModeration(current=>current&&({...current,reports:current.reports.map(item=>item.id===updated.id?updated:item)}))}/>)}
        {moderation&&!moderation.reports.length&&<p>No community reports are saved.</p>}
        {moderation?.nextCursor&&<button className="button secondary small" disabled={loadingModeration}
          onClick={()=>void loadModeration(moderation.nextCursor!)}>Load older community reports</button>}
      </section>}
      {canModerate&&<section className="panel"><h2>Community appeal queue</h2>
        <p>Appeals provide a revision-fenced second review. Decisions remain in-app; no external delivery or response SLA is claimed.</p>
        {!appeals&&<button className="button secondary small" disabled={loadingAppeals} onClick={()=>void loadAppeals()}>Load appeal queue</button>}
        {appealsError&&<><p role="alert">{appealsError}</p><button className="button secondary small" disabled={loadingAppeals} onClick={()=>void loadAppeals()}>Retry appeal queue</button></>}
        {appeals?.appeals.map(appeal=><StaffAppealCard key={appeal.id} value={appeal} administrator={administrator}
          onChange={updated=>setAppeals(current=>current&&({...current,appeals:current.appeals.map(item=>item.id===updated.id?updated:item)}))}/>)}
        {appeals&&!appeals.appeals.length&&<p>No community appeals are saved.</p>}
        {appeals?.nextCursor&&<button className="button secondary small" disabled={loadingAppeals}
          onClick={()=>void loadAppeals(appeals.nextCursor!)}>Load older community appeals</button>}
      </section>}
      {canModerate&&<section className="panel"><h2>Active community restrictions</h2>
        <p>Restrictions are narrow, expiring and report-bound. They do not suspend accounts, revoke sessions or block learning, billing, support, privacy, appeals or personal mutes/blocks.</p>
        {!restrictions&&<button className="button secondary small" disabled={loadingRestrictions}
          onClick={()=>void loadRestrictions()}>Load active restrictions</button>}
        {restrictionError&&<><p role="alert">{restrictionError}</p><button className="button secondary small"
          disabled={loadingRestrictions} onClick={()=>void loadRestrictions()}>Retry active restrictions</button></>}
        {restrictions?.restrictions.map(value=><StaffRestrictionCard key={value.id} value={value} administrator={administrator}
          onChange={updated=>setRestrictions(current=>current&&({...current,
            restrictions:updated.status==='active'?current.restrictions.map(item=>item.id===updated.id?updated:item)
              :current.restrictions.filter(item=>item.id!==updated.id)}))}/>)}
        {restrictions&&!restrictions.restrictions.length&&<p>No active community restrictions are saved.</p>}
        {restrictions?.nextCursor&&<button className="button secondary small" disabled={loadingRestrictions}
          onClick={()=>void loadRestrictions(restrictions.nextCursor!)}>Load older active restrictions</button>}
      </section>}
      {canModerate&&<section className="panel"><h2>Restriction appeal queue</h2>
        <p>Appeals bind one exact restriction revision. Uphold atomically lifts only that current revision; later, lifted or expired restrictions can only be resolved as superseded.</p>
        {!restrictionAppeals&&<button className="button secondary small" disabled={loadingRestrictionAppeals}
          onClick={()=>void loadRestrictionAppeals()}>Load restriction appeal queue</button>}
        {restrictionAppealError&&<><p role="alert">{restrictionAppealError}</p><button className="button secondary small"
          disabled={loadingRestrictionAppeals} onClick={()=>void loadRestrictionAppeals()}>Retry restriction appeal queue</button></>}
        {restrictionAppeals?.appeals.map(value=><StaffRestrictionAppealCard key={value.id} value={value}
          administrator={administrator} onChange={updated=>{
            setRestrictionAppeals(current=>current&&({...current,
              appeals:current.appeals.map(item=>item.id===updated.id?updated:item)}));
            if(updated.status==='upheld')setRestrictions(current=>current&&({...current,
              restrictions:current.restrictions.filter(item=>item.id!==updated.restrictionId)}));
          }}/>)}
        {restrictionAppeals&&!restrictionAppeals.appeals.length&&<p>No restriction appeals are saved.</p>}
        {restrictionAppeals?.nextCursor&&<button className="button secondary small" disabled={loadingRestrictionAppeals}
          onClick={()=>void loadRestrictionAppeals(restrictionAppeals.nextCursor!)}>Load older restriction appeals</button>}
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
