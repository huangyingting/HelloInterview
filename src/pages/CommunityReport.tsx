import {useState} from 'react';
import type {CommunityReportCategory,CommunityReportReceipt} from '../../shared/types';
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
