import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Comment, CommunityCommentSubmission, CommunityCommentSubmissionHistory, CommunityCommentSubmissionInput } from '../../shared/types';
import { request, useStudio } from '../store';

export function CommentComposer({resource,disabled,reply,onCancelReply,onCreated}:{resource:string;disabled:boolean;reply:Comment|null;onCancelReply:()=>void;onCreated:(comment:Comment,parentId:string|null)=>void}) {
  const {act,notify,pending}=useStudio();
  const [body,setBody]=useState(''),[attempt,setAttempt]=useState<{input:CommunityCommentSubmissionInput;error:string;saved?:CommunityCommentSubmission}>(),[ack,setAck]=useState(false);
  const active=useRef<CommunityCommentSubmissionInput|null>(null),busy=useRef(false),alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function confirmed(input:CommunityCommentSubmissionInput,saved:CommunityCommentSubmission) {
    if(!alive.current||active.current!==input)return;
    if(saved.comment){
      onCreated(saved.comment,input.parentId);
      setBody(current=>current===input.body?'':current);
      active.current=null;setAttempt(undefined);setAck(false);
      notify('Your local comment submission was confirmed.');
    }else{
      setAttempt({input,error:'',saved});
      notify('This submission was created earlier but its comment is now unavailable. It was not recreated.');
    }
  }
  function perform(input:CommunityCommentSubmissionInput,check=false) {
    if(busy.current||active.current!==input)return;
    busy.current=true;
    void act(async()=>{
      try{
        const saved=check?await request<CommunityCommentSubmission>(`/api/comments/submissions/receipt?${new URLSearchParams({requestId:input.requestId})}`)
          :await request<CommunityCommentSubmission>('/api/comments/submissions',input);
        confirmed(input,saved);
      }catch(error){
        if(!alive.current||active.current!==input)return;
        setAttempt({input,error:`${check?'Checking failed':'Submission was not confirmed'}. ${error instanceof Error?error.message:'Check the saved outcome before deciding what to do.'}`});setAck(false);
        throw error;
      }finally{busy.current=false;}
    });
  }
  return <><form onSubmit={event=>{
    event.preventDefault();if(disabled||active.current||busy.current)return;
    const input={requestId:crypto.randomUUID(),resource,body,parentId:reply?.id??null};
    active.current=input;setAttempt({input,error:''});perform(input);
  }}>
    {reply&&<div className="reply-label">Replying to {reply.author}<button type="button" className="icon-button" aria-label="Cancel reply" onClick={onCancelReply}><X size={14}/></button></div>}
    <textarea aria-label="Add a comment" placeholder="Share a question or an insight..." minLength={2} maxLength={3000} required value={body} onChange={event=>setBody(event.target.value)}/>
    <button className="button small" disabled={pending||disabled||!!attempt}><Send size={15}/> Post comment</button>
  </form>
  {attempt&&<section className="panel post-editor" aria-label="Comment submission recovery">
    <p className="fine-print">Submission reference: <code>{attempt.input.requestId}</code>. This original request is separate from edits you make to the composer.</p>
    {attempt.error&&<p role="alert" className="error-text">{attempt.error}</p>}
    {attempt.saved&&!attempt.saved.comment&&<p role="status">Created earlier; the comment is now unavailable. Retrying will not recreate it.</p>}
    {!pending&&<><h3>Original submitted text</h3><p className="post-body">{attempt.input.body}</p>
    <button className="button secondary small" onClick={()=>perform(attempt.input,true)}>Check comment submission</button>
    {!attempt.saved&&<button className="button secondary small" onClick={()=>perform(attempt.input)}>Retry original comment submission</button>}
    <p className="fine-print">A missing receipt does not cancel an in-flight request. Only an explicit retry of this original key and content is duplicate-safe. Unsaved recovery text stays in this view, not browser storage.</p>
    <label className="checkbox-label"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/> I understand a new submission does not cancel this request and could create an additional comment.</label>
    <button className="text-button" disabled={!ack} onClick={()=>{active.current=null;setAttempt(undefined);setAck(false);}}>Start a separate comment submission</button></>}
  </section>}</>;
}

export function CommentSubmissionHistory({resource}:{resource?:string}) {
  const {data}=useStudio(),scope=JSON.stringify([data.user?.id??null,resource??null]);
  const [open,setOpen]=useState(true),[state,setState]=useState<{scope:string;rows:CommunityCommentSubmission[];cursor:string|null;busy:boolean;error:string}>();
  const control=useRef<{controller:AbortController;busy:boolean}|null>(null);
  async function load(cursor?:string) {
    const read=control.current;if(!read||read.busy||read.controller.signal.aborted)return;
    read.busy=true;
    setState(current=>current?.scope===scope?{...current,busy:true,error:''}:{scope,rows:[],cursor:null,busy:true,error:''});
    try{
      const query=new URLSearchParams({...(resource!==undefined?{resource}:{}),...(cursor?{cursor}:{})});
      const page=await request<CommunityCommentSubmissionHistory>(`/api/comments/submissions?${query}`,undefined,'GET',read.controller.signal);
      if(!read.controller.signal.aborted)setState(current=>{
        if(current?.scope!==scope)return current;
        const rows=cursor?current.rows:[],ids=new Set(rows.map(row=>row.receipt.requestId));
        return {scope,rows:[...rows,...page.submissions.filter(row=>!ids.has(row.receipt.requestId))],cursor:page.nextCursor,busy:false,error:''};
      });
    }catch(error){if(!read.controller.signal.aborted)setState(current=>current?.scope===scope?{...current,busy:false,error:error instanceof Error?error.message:'Your submission history could not be read.'}:current);}
    finally{read.busy=false;}
  }
  useEffect(()=>{
    if(!open||!data.user||data.capabilities.community==='read-only')return;
    const controller=new AbortController();control.current={controller,busy:false};setState(undefined);void load();
    return()=>controller.abort();
  },[open,scope,data.capabilities.community]);
  if(!data.user||data.capabilities.community==='read-only')return null;
  const current=state?.scope===scope?state:undefined;
  return <section className="panel community-submission-history">
    <button className="button secondary small" aria-expanded={open} onClick={()=>setOpen(!open)}>My comment submissions</button>
    {open&&<><h2>Your local comment submission history</h2><p className="fine-print">Private minimal references survive comment removal to prevent duplicate retries. Current text is shown only while the same comment remains available. This is not a privacy export or deletion receipt.</p>
    {!current&&<p role="status">Loading your comment submissions...</p>}
    {current?.error&&<><p role="alert" className="error-text">{current.error}</p><button className="text-button" disabled={current.busy} onClick={()=>void load(current.cursor??undefined)}>Retry submission history</button></>}
    {current?.rows.map(row=><article key={`${scope}:${row.receipt.requestId}`}><time>{new Date(row.receipt.createdAt).toLocaleString()}</time><p className="post-body"><code>{row.receipt.requestId}</code><br/>{row.receipt.resource}</p>{row.comment?<p className="post-body">Current saved text: {row.comment.body.slice(0,241)}{row.comment.body.length>241?'...':''}</p>:<p>Created earlier; now unavailable. No recreation occurred.</p>}</article>)}
    {current&&!current.busy&&!current.error&&!current.rows.length&&<p>No recorded submissions in this view. Legacy comments have no fabricated receipts.</p>}
    {current?.busy&&<p role="status">Reading your comment submissions...</p>}
    {current?.cursor&&<button className="button secondary small" disabled={current.busy} onClick={()=>void load(current.cursor??undefined)}>Load more comment submissions</button>}</>}
  </section>;
}
