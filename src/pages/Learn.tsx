import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Clock3, Code2, GraduationCap, LockKeyhole, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTrack, problems, tracks } from '../../shared/catalog';
import { hasPremium } from '../../shared/domain';
import { AuthPrompt, Badge, BookmarkButton, CardLink, Comments, ContentSections, IconTile, PageHeading, Progress, ReadButton, SourceLinks } from '../components';
import { useStudio } from '../store';
import { trackIcons } from './Home';

export function LearningIndex() {
  return <><PageHeading eyebrow="THE LEARNING LIBRARY" title="Build a stronger foundation." description="Clear explanations. Useful examples. A path you can make your own." action={<Link className="button secondary" to="/learn/courses"><GraduationCap size={17}/> Structured courses</Link>}/><div className="learning-index">{tracks.map(t=><Link className="track-card" to={`/learn/${t.id}`} key={t.id}><div className="track-card-top"><IconTile icon={trackIcons[t.id]} color={t.color}/><span>{t.lessons.length} lessons</span></div><h2>{t.title}</h2><p>{t.description}</p><div className="track-card-bottom"><span>{t.lessons.reduce((s,l)=>s+l.minutes,0)} min of reading</span><ArrowRight size={18}/></div></Link>)}</div></>;
}
export function TrackOverview({ id }: { id: string }) {
  const { data } = useStudio(), track = getTrack(id);
  if (!track) return <NotFound/>;
  const read = track.lessons.filter(l=>data.state.read.includes(`${id}/${l.id}`)).length;
  const groups = [...new Set(track.lessons.map(l=>l.group))];
  return <><PageHeading eyebrow="A LITTLE BETTER, ONE LESSON AT A TIME" title={track.title} description={track.description} action={<IconTile icon={trackIcons[track.id]} color={track.color}/>}/>
    <div className="track-overview-banner"><div><span className="eyebrow">YOUR PROGRESS</span><h3>{read} of {track.lessons.length} lessons complete</h3><Progress value={read/track.lessons.length*100}/></div><Link className="button" to={`/learn/${id}/${(track.lessons.find(l=>!data.state.read.includes(`${id}/${l.id}`))||track.lessons[0]).id}`}>{read?'Continue learning':'Start learning'} <ArrowRight size={16}/></Link></div>
    {['system-design','code','low-level-design','behavioral'].includes(id)&&<div className="course-link-banner"><BookOpen size={22}/><div><strong>Prefer a structured path?</strong><p>{id==='system-design'?'Connect 24 source-linked lessons, 12 quizzes, and 16 design exercises.':id==='code'?'Connect 24 source-linked lessons, 12 quizzes, and 24 executable algorithm exercises.':'Connect reading, original video, quizzes, and practice in one course.'}</p></div><Link className="text-link" to={`/learn/courses/${id==='system-design'?'system-design-complete':id==='code'?'coding-complete':id}`}>Explore the course <ArrowRight size={15}/></Link></div>}
    {id==='system-design'&&<div className="course-link-banner"><BookOpen size={22}/><div><strong>From concepts to a worked architecture</strong><p>Explore original case studies with assumptions, calculations, failure paths, and alternatives.</p></div><Link className="text-link" to="/learn/system-design/cases">Browse worked designs <ArrowRight size={15}/></Link></div>}
    {id==='code'&&<div className="course-link-banner"><Code2 size={22}/><div><strong>From an invariant to working code</strong><p>Study original solutions with explicit contracts, complexity analysis, and executable examples.</p></div><Link className="text-link" to="/learn/code/solutions">Browse worked solutions <ArrowRight size={15}/></Link></div>}
    {id==='code'&&<AlgorithmLab kind="two-pointers"/>}
    {groups.map(group=><section className="lesson-group" key={group}><div className="section-heading"><h2>{group}</h2><span>{track.lessons.filter(l=>l.group===group).length} lessons</span></div><div className="lesson-list">{track.lessons.filter(l=>l.group===group).map((l,i)=><div className="lesson-row" key={l.id}><ReadButton track={id} lesson={l.id} compact/><Link to={`/learn/${id}/${l.id}`}><span className="lesson-number">{String(i+1).padStart(2,'0')}</span><div><strong>{l.title}</strong><p>{l.summary}</p></div></Link><span className="lesson-time"><Clock3 size={14}/>{l.minutes} min</span>{l.premium&&<Badge>Premium demo</Badge>}<Link className="icon-button" to={`/learn/${id}/${l.id}`} aria-label={`Read ${l.title}`}><ChevronRight size={18}/></Link></div>)}</div></section>)}
    <section className="callout"><BookOpen size={23}/><div><strong>Connect learning to practice.</strong><p>Try a related exercise while the ideas are still fresh.</p></div><Link className="button secondary small" to={`/practice/${id==='ml-system-design'?'system-design':id==='salary-negotiation'?'behavioral':id}`}>Browse practice <ArrowRight size={15}/></Link></section>
  </>;
}
export function LessonPage({ trackId, lessonId }: { trackId: string; lessonId: string }) {
  const { data } = useStudio();
  const track=getTrack(trackId), lesson=track?.lessons.find(l=>l.id===lessonId);
  const [reading, setReading] = useState(0);
  useEffect(()=>{const onScroll=()=>{const range=document.documentElement.scrollHeight-window.innerHeight;setReading(range>0?window.scrollY/range*100:100);};window.addEventListener('scroll',onScroll);onScroll();return()=>window.removeEventListener('scroll',onScroll);},[lessonId]);
  if (!track||!lesson) return <NotFound/>;
  const CoverIcon = trackIcons[track.id];
  const index=track.lessons.indexOf(lesson), next=track.lessons[index+1], previous=track.lessons[index-1];
  if (lesson.premium&&!hasPremium(data.state)) return <><PageHeading eyebrow={track.title.toUpperCase()} title={lesson.title} description={lesson.summary}/><PremiumGate/></>;
  const related=lesson.relatedProblemIds?.length?problems.filter(p=>lesson.relatedProblemIds!.includes(p.id)):[problems.find(p=>p.track===trackId)||problems[0]];
  return <><Link className="back-link" to={`/learn/${trackId}`}><ArrowLeft size={15}/>{track.title}</Link><div className="article-layout"><article className="lesson-article"><div className="lesson-cover" style={{'--track-color':track.color} as React.CSSProperties}><span>{lesson.group}</span><CoverIcon size={100} strokeWidth={.7}/><div className="cover-lines" aria-hidden="true"><i/><i/><i/></div></div><div className="article-heading"><div><span className="eyebrow">{lesson.group}</span><h1>{lesson.title}</h1></div><BookmarkButton resource={`${trackId}/${lessonId}`}/></div><p className="article-summary">{lesson.summary}</p><div className="article-meta"><Clock3 size={14}/>{lesson.minutes} min read<span>·</span>Original Studio lesson</div>
      {lesson.objectives&&<section className="lesson-objectives"><h2>What you will learn</h2><ul>{lesson.objectives.map(objective=><li key={objective}>{objective}</li>)}</ul></section>}
      <ContentSections sections={lesson.sections}/>
      {trackId==='code'&&['two-pointers','sliding-window','binary-search','graph-search','dynamic-programming'].includes(lessonId)&&<AlgorithmLab kind={lessonId}/>}
      <div className="exercise-box"><span className="eyebrow">PUT IT INTO PRACTICE</span><h3>Your turn</h3><p>{lesson.exercise}</p><div className="content-next-steps">{related.map(problem=><Link className="text-link" key={problem.id} to={`/practice/${problem.track}/${problem.id}`}>Practice: {problem.title} <ArrowRight size={16}/></Link>)}{lesson.quizTopic&&<Link className="text-link" to={`/quiz/${lesson.quizTopic}`}>Check your understanding <ArrowRight size={16}/></Link>}</div></div>
      <SourceLinks ids={lesson.sourceIds}/>
      {data.user?<div className="lesson-complete"><div><strong>One step further.</strong><p>Save your progress and keep the momentum.</p></div><ReadButton track={trackId} lesson={lessonId}/></div>:<AuthPrompt/>}
      <div className="lesson-pagination">{previous?<Link to={`/learn/${trackId}/${previous.id}`}><span>Previous lesson</span><strong><ArrowLeft size={15}/>{previous.title}</strong></Link>:<span/>}{next&&<Link to={`/learn/${trackId}/${next.id}`}><span>Up next</span><strong>{next.title}<ArrowRight size={15}/></strong></Link>}</div><Comments resource={`lesson/${trackId}/${lessonId}`}/>
    </article><aside className="article-aside"><div className="panel learning-outline"><h4>In this learning path</h4><Progress value={track.lessons.filter(l=>data.state.read.includes(`${trackId}/${l.id}`)).length/track.lessons.length*100}/>{track.lessons.map(l=><Link className={l.id===lessonId?'active':''} to={`/learn/${trackId}/${l.id}`} key={l.id}>{data.state.read.includes(`${trackId}/${l.id}`)?<Check size={13}/>:<span className="tiny-circle"/>}{l.title}</Link>)}</div><div className="toc"><h4>On this page</h4><Progress value={reading}/>{lesson.sections.map((s,i)=><a href={`#section-${i}`} key={s.title}>{s.title}</a>)}</div><Link className="tutor-nudge" to={`/tutor?context=${encodeURIComponent(`${track.title}: ${lesson.title}`)}`}><IconTile icon={BookOpen} small/><div><strong>A question worth asking?</strong><p>Explore it with the study helper.</p></div><ChevronRight size={16}/></Link></aside></div></>;
}

type Step = { cells: number[]; active: number[]; done: number[]; note: string; label: string };
export function AlgorithmLab({ kind }: { kind: string }) {
  const [raw,setRaw]=useState(kind==='sliding-window'?'2, 1, 5, 1, 3, 2':'1, 3, 4, 6, 8, 10, 13'),[target,setTarget]=useState(kind==='binary-search'?8:kind==='sliding-window'?3:17);
  const [step,setStep]=useState(0),[playing,setPlaying]=useState(false),[error,setError]=useState('');
  const graph=kind==='graph-search',dp=kind==='dynamic-programming';
  const steps=useMemo(()=>{
    if(graph){const adjacency=[[1,2],[3],[3,4],[5],[5],[]];const visited=new Set([0]);const queue=[0];const result:Step[]=[];while(queue.length){const current=queue.shift()!;result.push({cells:[0,1,2,3,4,5],active:[current],done:[...visited],label:`Visit node ${String.fromCharCode(65+current)}`,note:`BFS explores the closest remaining node. Queue: ${queue.map(n=>String.fromCharCode(65+n)).join(', ')||'empty'}.`});for(const neighbor of adjacency[current])if(!visited.has(neighbor)){visited.add(neighbor);queue.push(neighbor);}}return result;}
    if(dp){const count=target;if(!Number.isInteger(count)||count<2||count>12)return [];const values=[0,1];const result:Step[]=[{cells:[0,1],active:[0,1],done:[],label:'Base cases',note:'F(0) = 0 and F(1) = 1.'}];for(let i=2;i<=count;i++){values.push(values[i-1]+values[i-2]);result.push({cells:[...values],active:[i],done:[i-1,i-2],label:`F(${i}) = ${values[i]}`,note:`Reuse F(${i-1}) and F(${i-2}) rather than recomputing their subproblems.`});}return result;}
    const values=raw.split(',').map(v=>Number(v.trim()));
    if(!raw.trim()||raw.split(',').some(v=>!v.trim())||!Number.isFinite(target)||values.some(v=>!Number.isFinite(v))||values.length>20||values.length<2)return [];
    if(kind==='sliding-window'){const size=target;if(!Number.isInteger(size)||size<1||size>values.length)return [];const result:Step[]=[];for(let i=0;i<=values.length-size;i++){const window=values.slice(i,i+size);result.push({cells:values,active:Array.from({length:size},(_,j)=>i+j),done:[],label:`Window sum = ${window.reduce((s,v)=>s+v,0)}`,note:i===0?'Compute the first window sum.':`Remove ${values[i-1]} and add ${values[i+size-1]} instead of recalculating the whole window.`});}return result;}
    if(values.some((v,i)=>i>0&&v<values[i-1]))return [];
    const result:Step[]=[];let left=0,right=values.length-1;
    while(left<=right){if(kind==='binary-search'){const mid=Math.floor((left+right)/2);result.push({cells:values,active:[mid],done:Array.from({length:left},(_,i)=>i).concat(Array.from({length:values.length-1-right},(_,i)=>right+1+i)),label:`Compare ${values[mid]} with ${target}`,note:values[mid]===target?'Target found.':values[mid]<target?'The target can only be to the right.':'The target can only be to the left.'});if(values[mid]===target)break;if(values[mid]<target)left=mid+1;else right=mid-1;}else{if(left===right)break;const sum=values[left]+values[right];result.push({cells:values,active:[left,right],done:[],label:`${values[left]} + ${values[right]} = ${sum}`,note:sum===target?'Target found. Both pointers identify a valid pair.':sum<target?'The sum is too small. Move the left pointer to a larger value.':'The sum is too large. Move the right pointer to a smaller value.'});if(sum===target)break;if(sum<target)left++;else right--;}}
    if(!result.length||(!result.at(-1)!.note.startsWith('Target found')&&kind!=='binary-search'))result.push({cells:values,active:[],done:[],label:'Search finished',note:'There is no pair with the requested sum.'});
    if(kind==='binary-search'&&!result.at(-1)?.note.startsWith('Target found'))result.push({cells:values,active:[],done:[],label:'Search finished',note:'The target is not present.'});
    return result;
  },[raw,target,kind,graph,dp]);
  useEffect(()=>{setStep(0);setPlaying(false);setError(steps.length?'':dp?'Use a whole Fibonacci index from 2 to 12.':'Use 2–20 finite numbers, sorted for pointer/search lessons. Window size must be a valid whole number.');},[steps,dp]);
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setStep(current=>{if(current>=steps.length-1){setPlaying(false);return current;}return current+1;}),850);return()=>clearInterval(timer);},[playing,steps.length]);
  const current=steps[Math.min(step,steps.length-1)];
  return <section className="algorithm-lab"><div className="section-heading"><div><span className="eyebrow">WATCH THE REASONING</span><h3>{graph?'Breadth-first search':dp?'Dynamic programming':kind==='binary-search'?'Binary search':kind==='sliding-window'?'Sliding window':'Two pointers'} playground</h3></div><Badge tone="green">Interactive</Badge></div>
    {!graph&&<div className="algorithm-inputs">{!dp&&<label>Values<input aria-label="Algorithm values" value={raw} maxLength={200} onChange={e=>setRaw(e.target.value)}/></label>}<label>{dp?'Fibonacci index':kind==='sliding-window'?'Window size':'Target'}<input aria-label="Algorithm target" type="number" min={dp?2:undefined} max={dp?12:undefined} value={target} onChange={e=>setTarget(Number(e.target.value))}/></label></div>}
    {error?<p className="error-text" role="alert">{error}</p>:current&&<><div className={`algorithm-cells ${graph?'graph-cells':''}`}>{current.cells.map((v,i)=><div className={`${current.active.includes(i)?'active':''} ${current.done.includes(i)?'visited':''}`} key={i}><small>{graph?'node':i}</small><strong>{graph?String.fromCharCode(65+v):v}</strong>{current.active.includes(i)&&<span>↑</span>}</div>)}</div><div className="algorithm-explanation" aria-live="polite"><strong>{current.label}</strong><p>{current.note}</p></div></>}
    <div className="algorithm-controls"><button className="icon-button" aria-label="Reset visualization" onClick={()=>{setStep(0);setPlaying(false);}}><RotateCcw size={17}/></button><button className="button small" disabled={!steps.length||step===steps.length-1&&!playing} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={15}/>:<Play size={15}/>} {playing?'Pause':'Play'}</button><button className="button secondary small" disabled={!steps.length||step>=steps.length-1} onClick={()=>setStep(i=>i+1)}><SkipForward size={15}/> Step</button><span>Step {steps.length?step+1:0} of {steps.length}</span></div>
  </section>;
}
export function PremiumGate() {
  return <div className="premium-gate"><IconTile icon={LockKeyhole}/><h2>A deeper practice opportunity.</h2><p>This original Studio exercise is part of the local premium demo. Activate a demo plan to explore it; no payment or card information is collected.</p><Link className="button" to="/pricing">Explore demo plans <ArrowRight size={16}/></Link></div>;
}
export function NotFound() {
  return <div className="empty"><BookOpen size={36}/><h1>This page isn’t in the Studio.</h1><p>Try the learning library or return to your dashboard.</p><Link className="button" to="/learn">Explore the library <ArrowRight size={16}/></Link></div>;
}
