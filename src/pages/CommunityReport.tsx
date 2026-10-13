import {useState} from 'react';
import type {
  CommunityAppealReceipt,CommunityAppealStatusPage,CommunityMute,CommunityMutePage,CommunityMuteReceipt,
  CommunityReportCategory,CommunityReportReceipt,CommunityReportStatusPage,
} from '../../shared/types';
import {request,useStudio} from '../store';

const labels:Record<CommunityReportCategory,string>={
  spam:'Spam or deceptive content',harassment:'Harassment or abuse',privacy:'Private or sensitive information',
  misinformation:'Materially misleading content',other:'Another policy concern',
};

export function CommunityReportControl({targetType,targetId}:{targetType:'post'|'comment';targetId:string}) {
  const {data,notify}=useStudio(),[open,setOpen]=useState(false),[category,setCategory]=useState<CommunityReportCategory>('spam');
  const [details,setDetails]=useState(''),[requestId]=useState(()=>crypto.randomUUID()),[pending,setPending]=useState(false);
  const [saved,setSaved]=useState<CommunityReportReceipt>(),[error,setError]=useState('');
  if(!data.user)return null;
  async function submit() {
    setPending(true);setError('');
    try{
      const receipt=await request<CommunityReportReceipt>('/api/community/reports',
        {requestId,targetType,targetId,category,details});
      setSaved(receipt);setOpen(false);notify('Report saved for the in-app moderation queue. No response time is promised.');
    }catch(cause){
      const message=cause instanceof Error?cause.message:'The report was not confirmed.';
      setError(`${message} Retry only report request ${requestId}.`);notify(message,true);
    }finally{setPending(false);}
  }
  if(saved)return <p className="fine-print" role="status">Reported for review · {labels[saved.category]} · request <code>{saved.requestId}</code></p>;
  return <div className="community-report-control">
    <button className="text-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Report {targetType}</button>
    {open&&<form className="panel" onSubmit={event=>{event.preventDefault();void submit();}}>
      <label>Policy concern<select value={category} onChange={event=>setCategory(event.target.value as CommunityReportCategory)}>
        {Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
      </select></label>
      <label>What should a moderator review?
        <textarea required minLength={20} maxLength={1000} value={details} onChange={event=>setDetails(event.target.value)}
          placeholder="Describe the specific concern without adding unrelated private information."/>
      </label>
      <p className="fine-print">Reports enter a private in-app queue. Appeals, external notifications and a staffed response SLA are not connected.</p>
      {error&&<p className="error-text" role="alert">{error}</p>}
      <button className="button secondary small" disabled={pending||details.trim().length<20}>
        {pending?'Saving exact report...':error?'Retry same report request':'Submit report'}
      </button>
    </form>}
  </div>;
}

export function CommunityAppealControl({targetType,targetId,targetRevision}:{
  targetType:'post'|'comment';targetId:string;targetRevision:number;
}) {
  const {data,notify}=useStudio(),[open,setOpen]=useState(false),[statement,setStatement]=useState('');
  const [requestId]=useState(()=>crypto.randomUUID()),[pending,setPending]=useState(false);
  const [saved,setSaved]=useState<CommunityAppealReceipt>(),[error,setError]=useState('');
  if(!data.user||targetRevision<1)return null;
  async function submit() {
    setPending(true);setError('');
    try{
      const receipt=await request<CommunityAppealReceipt>('/api/community/appeals',
        {requestId,targetType,targetId,targetRevision,statement});
      setSaved(receipt);setOpen(false);notify('Appeal saved for the in-app moderation queue. No response time is promised.');
    }catch(cause){
      const message=cause instanceof Error?cause.message:'The appeal was not confirmed.';
      setError(`${message} Retry only appeal request ${requestId}.`);notify(message,true);
    }finally{setPending(false);}
  }
  if(saved)return <p className="fine-print" role="status">Appeal saved for hidden revision {saved.appealedTargetRevision} · request <code>{saved.requestId}</code></p>;
  return <div className="community-report-control">
    <button className="text-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Appeal moderation decision</button>
    {open&&<form className="panel" onSubmit={event=>{event.preventDefault();void submit();}}>
      <label>Why should this contribution be restored?
        <textarea required minLength={20} maxLength={1000} value={statement} onChange={event=>setStatement(event.target.value)}
          placeholder="Explain the specific context or policy concern for a second review. Do not add unrelated private information."/>
      </label>
      <p className="fine-print">This appeals hidden target revision {targetRevision}. Staff identity, internal notes, external delivery and a response SLA are not exposed.</p>
      {error&&<p className="error-text" role="alert">{error}</p>}
      <button className="button secondary small" disabled={pending||statement.trim().length<20}>
        {pending?'Saving exact appeal...':error?'Retry same appeal request':'Submit appeal'}
      </button>
    </form>}
  </div>;
}

export function CommunityMuteControl({targetType,targetId,onMuted}:{
  targetType:'post'|'comment';targetId:string;onMuted?:()=>void;
}) {
  const {data,notify}=useStudio(),[requestId]=useState(()=>crypto.randomUUID()),[pending,setPending]=useState(false);
  const [saved,setSaved]=useState<CommunityMuteReceipt>(),[error,setError]=useState('');
  if(!data.user)return null;
  async function submit() {
    setPending(true);setError('');
    try{
      const receipt=await request<CommunityMuteReceipt>('/api/community/mutes',
        {requestId,muted:true,targetType,targetId},'PUT');
      setSaved(receipt);notify('Author muted. Their posts and comments are hidden only for you.');onMuted?.();
    }catch(cause){
      const message=cause instanceof Error?cause.message:'The author mute was not confirmed.';
      setError(`${message} Retry only mute request ${requestId}.`);notify(message,true);
    }finally{setPending(false);}
  }
  if(saved)return <p className="fine-print" role="status">Author muted for you · request <code>{saved.requestId}</code></p>;
  return <div className="community-report-control">
    <button className="text-button" disabled={pending} onClick={()=>void submit()}>
      {pending?'Muting author...':error?'Retry same mute request':'Mute author'}
    </button>
    {error&&<p className="error-text" role="alert">{error}</p>}
  </div>;
}

function CommunityUnmuteControl({mute,onSaved}:{mute:CommunityMute;onSaved:()=>void}) {
  const {notify}=useStudio(),[requestId]=useState(()=>crypto.randomUUID()),[pending,setPending]=useState(false);
  const [error,setError]=useState('');
  async function submit() {
    setPending(true);setError('');
    try{
      await request<CommunityMuteReceipt>('/api/community/mutes',
        {requestId,muted:false,muteId:mute.id,revision:mute.revision},'PUT');
      notify('Author unmuted. Their available contributions can appear for you again.');onSaved();
    }catch(cause){
      const message=cause instanceof Error?cause.message:'The author unmute was not confirmed.';
      setError(`${message} Retry only unmute request ${requestId}.`);notify(message,true);
    }finally{setPending(false);}
  }
  return <div>
    <button className="button secondary small" disabled={pending} onClick={()=>void submit()}>
      {pending?'Unmuting author...':error?'Retry same unmute request':'Unmute author'}
    </button>
    {error&&<p className="error-text" role="alert">{error}</p>}
  </div>;
}

export function CommunityModerationHistory() {
  const {data}=useStudio(),[open,setOpen]=useState(false),[reports,setReports]=useState<CommunityReportStatusPage>();
  const [appeals,setAppeals]=useState<CommunityAppealStatusPage>(),[mutes,setMutes]=useState<CommunityMutePage>();
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  if(!data.user)return null;
  async function load(kind:'initial'|'reports'|'appeals'|'mutes') {
    setPending(true);setError('');
    try{
      if(kind==='initial'){
        const [reportPage,appealPage,mutePage]=await Promise.all([
          request<CommunityReportStatusPage>('/api/community/reports'),
          request<CommunityAppealStatusPage>('/api/community/appeals'),
          request<CommunityMutePage>('/api/community/mutes'),
        ]);
        setReports(reportPage);setAppeals(appealPage);setMutes(mutePage);
      }else if(kind==='reports'&&reports?.nextCursor){
        const page=await request<CommunityReportStatusPage>(`/api/community/reports?${new URLSearchParams({cursor:reports.nextCursor})}`);
        setReports({reports:[...reports.reports,...page.reports],nextCursor:page.nextCursor});
      }else if(kind==='appeals'&&appeals?.nextCursor){
        const page=await request<CommunityAppealStatusPage>(`/api/community/appeals?${new URLSearchParams({cursor:appeals.nextCursor})}`);
        setAppeals({appeals:[...appeals.appeals,...page.appeals],nextCursor:page.nextCursor});
      }else if(kind==='mutes'&&mutes?.nextCursor){
        const page=await request<CommunityMutePage>(`/api/community/mutes?${new URLSearchParams({cursor:mutes.nextCursor})}`);
        setMutes({mutes:[...mutes.mutes,...page.mutes],nextCursor:page.nextCursor});
      }
    }catch(cause){setError(cause instanceof Error?cause.message:'Moderation status could not be loaded.');}
    finally{setPending(false);}
  }
  return <section className="panel">
    <button className="button secondary small" aria-expanded={open} onClick={()=>{
      const next=!open;setOpen(next);if(next&&!reports&&!appeals)void load('initial');
    }}>My moderation status</button>
    {open&&<div>
      <p className="fine-print">Only your report, appeal and active personal-mute receipts are shown. Staff identities, internal reasons, account identifiers and other members' activity remain private.</p>
      {pending&&!reports&&!appeals&&!mutes&&<p role="status">Loading moderation status...</p>}
      {error&&<p className="error-text" role="alert">{error}</p>}
      {reports&&<><h3>My reports</h3>{reports.reports.map(value=><p key={value.id}>
        <strong>{value.category.replaceAll('-',' ')}</strong> · {value.status} · target {value.targetState} at revision {value.targetRevision}
        <br/><span className="fine-print">{value.targetType} <code>{value.targetId}</code> · request <code>{value.requestId}</code></span>
      </p>)}{!reports.reports.length&&<p>No community reports are saved.</p>}
      {reports.nextCursor&&<button className="button secondary small" disabled={pending} onClick={()=>void load('reports')}>Load older reports</button>}</>}
      {appeals&&<><h3>My appeals</h3>{appeals.appeals.map(value=><p key={value.id}>
        <strong>{value.status}</strong> · appealed hidden revision {value.appealedTargetRevision} · target now {value.targetState} at revision {value.targetRevision}
        <br/><span className="fine-print">{value.targetType} <code>{value.targetId}</code> · request <code>{value.requestId}</code></span>
      </p>)}{!appeals.appeals.length&&<p>No community appeals are saved.</p>}
      {appeals.nextCursor&&<button className="button secondary small" disabled={pending} onClick={()=>void load('appeals')}>Load older appeals</button>}</>}
      {mutes&&<><h3>Authors muted for me</h3>{mutes.mutes.map(value=><div className="panel" key={value.id}>
        <p><strong>Muted author</strong> · revision {value.revision}<br/>
          <span className="fine-print">Representative {value.targetType} <code>{value.targetId}</code> · no account identifier is exposed</span>
        </p>
        <CommunityUnmuteControl mute={value} onSaved={()=>setMutes(current=>current?{...current,mutes:current.mutes.filter(row=>row.id!==value.id)}:current)}/>
      </div>)}{!mutes.mutes.length&&<p>No authors are currently muted for you.</p>}
      {mutes.nextCursor&&<button className="button secondary small" disabled={pending} onClick={()=>void load('mutes')}>Load older active mutes</button>}</>}
    </div>}
  </section>;
}
