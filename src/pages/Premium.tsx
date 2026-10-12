import { ArrowLeft, ArrowRight, CalendarDays, Check, ClipboardCheck, Code2, Download, MessageSquare, Target, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { companies, levels, practiceLabels, problems } from "../../shared/public-catalog";
import { companyProblems, mockReport, planTaskComplete } from '../../shared/premium';
import type { MockSession, PlanTask, StudyPlan, UserState } from '../../shared/types';
import { AuthPrompt, Badge, CardLink, Empty, NotFound, PageHeading, PremiumAccess, Progress } from '../components';
import { request, useStudio } from '../store';
import { ContentStatus, useContent } from '../content';
import type { PracticeProblem } from '../../shared/types';
import { download } from '../download';
export function PremiumStudio() {
  const { can, data } = useStudio(), [company, setCompany] = useState('Meta'), [difficulty, setDifficulty] = useState('All');
  const list = companyProblems(company).filter(p => difficulty === 'All' || p.difficulty === difficulty);
  return <>
    <PageHeading eyebrow="ORIGINAL PREMIUM WORKFLOWS" title="Make the practice more deliberate." description="A focused conversation, a tailored quiz, a plan you can follow, and a project you can inspect." action={<Badge tone={can('mock.create') ? 'green' : 'amber'}>{data.capabilities.auth?.mode === 'managed' ? can('mock.create') ? 'Pro access active' : 'Check access on Account' : can('mock.create') ? 'Premium demo active' : 'Explore with a local demo plan'}</Badge>} />
    <div className="premium-cards">
      <CardLink to="/premium/mock" title="Adaptive mock interviews" description="Follow-up questions respond to gaps in your answers. Keep a transcript and actionable report." icon={MessageSquare} />
      <CardLink to="/quiz/custom" title="Custom quiz builder" description="Combine topics, choose a session length, or focus exclusively on missed questions." icon={ClipboardCheck} />
      <CardLink to="/premium/plans" title="Company-focused study plans" description="Two- or four-week plans connect your actual progress to clear next steps." icon={CalendarDays} />
      <CardLink to="/premium/projects" title="Project workbench" description="Bring source snapshots, edit files, run JavaScript examples, and export a patch." icon={Code2} />
    </div>
    {!can('mock.create') && <PremiumAccess><span /></PremiumAccess>}
    <section className="panel premium-library">
      <div className="section-heading"><div><span className="eyebrow">CURATED PRACTICE PACKS</span><h2>A focus for your next company.</h2></div></div>
      <p>These are original study suggestions, not insider interview questions or claims about a company’s current hiring process.</p>
      <div className="filter-bar"><label>Company focus<select aria-label="Practice pack company" value={company} onChange={e => setCompany(e.target.value)}>{companies.map(c => <option key={c}>{c}</option>)}</select></label><label>Difficulty<select aria-label="Practice pack difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}>{['All', 'Easy', 'Medium', 'Hard'].map(d => <option key={d}>{d}</option>)}</select></label><Link className="button secondary small" to={`/premium/plans?company=${company}`}>Build a plan <ArrowRight size={15} /></Link></div>
      <div className="premium-pack-list">{list.map(p => <div key={p.id}><div><strong>{p.title}</strong><p>{practiceLabels[p.track]} · {p.difficulty}</p></div><Link className="text-link" to={`/premium/mock?problem=${p.id}&company=${company}`}>Practice a conversation <ArrowRight size={14} /></Link></div>)}</div>
      {!list.length && <Empty title="No exercises match" description="Choose another difficulty for this original preparation pack." />}
    </section>
    <div className="local-notice">Follow-up selection uses an original local topic-coverage heuristic, not a recovered reference algorithm. Grading is labeled local rubric or configured AI; no hiring prediction is made.</div>
  </>;
}
export function MockPage({ id }: { id?: string }) {
  return id ? <MockSessionPage id={id} /> : <MockSetup />;
}
function MockSetup() {
  const { can, data, act, setState, pending } = useStudio(), navigate = useNavigate(), [params] = useSearchParams();
  const [problemId, setProblemId] = useState(params.get('problem') || 'job-scheduler'), [company, setCompany] = useState(params.get('company') || 'Meta');
  const [level, setLevel] = useState(params.get('level') || 'Senior'), [length, setLength] = useState('3'), [track, setTrack] = useState('all');
  const list = problems.filter(p => track === 'all' || p.track === track);
  const invalid = !problems.some(p => p.id === problemId) || !companies.includes(company) || !levels.some(l => l === level);
  if (invalid) return <NotFound />;
  return <>
    <PageHeading eyebrow="A CONVERSATION WITH A NEXT STEP" title="Practice the follow-up." description="A mock session changes focus as your answers reveal covered and missing topics." />
    <PremiumAccess><div className="two-column"><form className="panel premium-form" onSubmit={e => { e.preventDefault(); void act(async () => {
      const result = await request<{ state: UserState; session: MockSession }>('/api/mocks', { problemId, company, level, length: Number(length) });
      setState(result.state); navigate(`/premium/mock/${result.session.id}`);
    }); }}>
      <h2>Set the context</h2>
      <label>Interview discipline<select aria-label="Mock discipline" value={track} onChange={e => { setTrack(e.target.value); setProblemId(problems.find(p => e.target.value === 'all' || p.track === e.target.value)!.id); }}><option value="all">All disciplines</option>{Object.entries(practiceLabels).map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label>
      <label>Exercise<select aria-label="Mock exercise" value={problemId} onChange={e => setProblemId(e.target.value)}>{list.map(p => <option value={p.id} key={p.id}>{p.title} · {p.difficulty}</option>)}</select></label>
      <div className="form-grid"><label>Company context<select aria-label="Mock company" value={company} onChange={e => setCompany(e.target.value)}>{companies.map(c => <option key={c}>{c}</option>)}</select></label><label>Target level<select aria-label="Mock level" value={level} onChange={e => setLevel(e.target.value)}>{levels.map(l => <option key={l}>{l}</option>)}</select></label></div>
      <label>Conversation length<select aria-label="Mock length" value={length} onChange={e => setLength(e.target.value)}><option value="3">3 turns · focused practice</option><option value="5">5 turns · deeper conversation</option></select></label>
      <p className="fine-print">Each response is saved before grading. {data.capabilities.ai ? 'Answers and conversation context are sent to your configured AI provider.' : 'Feedback checks topic coverage and depth locally. It is not AI.'} Company context is a preparation preference, not an official interview simulation.</p>
      <button className="button" disabled={pending}>Start mock interview <ArrowRight size={16} /></button>
    </form><section className="panel"><h2>Return to your conversations</h2><MockArchive /></section></div></PremiumAccess>
    {!can('mock.create') && data.state.mocks.length > 0 && <section className="panel premium-library"><h2>Your saved archive</h2><MockArchive /></section>}
  </>;
}
function MockArchive() {
  const { data } = useStudio();
  return data.state.mocks.length ? <div className="premium-archive">{data.state.mocks.map(m => <Link key={m.id} to={`/premium/mock/${m.id}`}><div><strong>{problems.find(p => p.id === m.problemId)?.title}</strong><p>{m.company} · {m.level} · {m.turns.length}/{m.length} turns</p></div><Badge>{m.completedAt ? `${mockReport(m).score}/100` : 'Resume draft'}</Badge><ArrowRight size={16} /></Link>)}</div> : <Empty title="Your next conversation starts here" description="Saved drafts and completed reports appear in this archive." />;
}
function MockSessionPage({ id }: { id: string }) {
  const { can, data, act, pending, setState, notify } = useStudio();
  const session = data.state.mocks.find(m => m.id === id);
  const resource = useContent<PracticeProblem>(session && !session.completedAt && can('mock.create') ? `/api/content/problems/${encodeURIComponent(session.problemId)}` : null);
  const [answer, setAnswer] = useState(session?.draft || '');
  useEffect(() => setAnswer(session?.draft || ''), [session?.revision, id]);
  if (!data.user) return <AuthPrompt />;
  if (!session) return <NotFound />;
  const problem = problems.find(p => p.id === session.problemId)!;
  const save = async () => {
    const state = await request<UserState>(`/api/mocks/${id}/draft`, { revision: session.revision, answer });
    setState(state); return state.mocks.find(m => m.id === id)!;
  };
  if (session.completedAt) {
    const report = mockReport(session);
    return <>
      <Link className="back-link" to="/premium/mock"><ArrowLeft size={15} /> Mock interview archive</Link>
      <PageHeading eyebrow={`${session.company} · ${session.level} · ${session.turns.length} TURNS`} title="Your interview report." description="A record of this practice conversation, not an assessment of hiring readiness." action={<button className="button secondary small" onClick={() => download('mock-interview-report.json', JSON.stringify({ session, report }, null, 2))}><Download size={15} /> Export report</button>} />
      <div className="mock-score panel"><strong>{report.score}<small>/100</small></strong><div><h2>{problem.title}</h2><p>{report.sources.includes('ai') ? 'Includes configured AI feedback' : 'Local topic rubric · not AI'} · original local follow-up selection</p></div></div>
      <div className="two-column premium-report"><section className="panel"><h2>What your answers covered</h2><ul>{report.strengths.map(s => <li key={s}>{s}</li>)}</ul>{!report.strengths.length && <p>No topic coverage was identified by this rubric.</p>}</section><section className="panel"><h2>Your next practice</h2><ul>{report.improvements.map(s => <li key={s}>{s}</li>)}</ul><Link className="text-link" to={`/learn/${problem.track === 'code-review' ? 'ai-coding' : problem.track}`}>Review the foundations <ArrowRight size={15} /></Link></section></div>
      <MockTranscript session={session} />
    </>;
  }
  if (can('mock.create') && !resource.value) return <ContentStatus {...resource}/>;
  return <>
    <Link className="back-link" to="/premium/mock"><ArrowLeft size={15} /> Return to the archive</Link>
    <PageHeading eyebrow={`${session.company} · ${session.level}`} title={problem.title} description="Take one question at a time. Save a draft whenever you need to pause." action={<Badge>{session.turns.length + 1} of {session.length} turns</Badge>} />
    <PremiumAccess><Progress value={session.turns.length / session.length * 100} label="Interview progress" />
      <div className="mock-workspace"><aside className="panel"><h2>The brief</h2><p>{resource.value?.description}</p><ul>{resource.value?.requirements.map(r => <li key={r}>{r}</li>)}</ul><p className="fine-print">Follow-ups prioritize topics not covered in earlier answers. {data.capabilities.ai ? 'Grading uses your configured AI provider.' : 'Grading uses a local rubric, not AI.'}</p></aside>
        <form className="panel mock-response" onSubmit={e => { e.preventDefault(); void act(async () => { const saved = await save(); setState(await request<UserState>(`/api/mocks/${id}/respond`, { revision: saved.revision })); }); }}>
          <div className="section-heading"><span className="eyebrow">INTERVIEWER · TURN {session.turns.length + 1}</span><button type="button" className="icon-button" aria-label="Read mock question aloud" onClick={() => { if (!('speechSynthesis' in window)) { notify('Speech synthesis is unavailable in this browser.', true); return; } speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(session.question)); }}><Volume2 size={18} /></button></div>
          <h2>{session.question}</h2>
          <label>Your response<textarea aria-label="Mock answer" value={answer} disabled={pending} onChange={e => setAnswer(e.target.value)} minLength={30} maxLength={8000} required rows={9} placeholder="Make your assumptions and reasoning visible." /></label>
          <div className="hero-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => act(async () => { await save(); notify('Interview draft saved.'); })}>Save interview draft</button><button className="button" disabled={pending}>{pending ? 'Saving and grading…' : session.turns.length + 1 === session.length ? 'Finish interview' : 'Submit and continue'} <ArrowRight size={16} /></button></div>
          <p className="fine-print">Answers are saved before provider requests. An error leaves your draft available for retry.</p>
        </form></div>
    </PremiumAccess>{!can('mock.create') && <section className="panel"><h2>{answer === session.draft ? 'Your saved interview draft' : 'Your unsaved interview draft'}</h2><p>{session.question}</p><pre>{answer || 'No answer was saved for this turn.'}</pre>{answer !== session.draft && <p>These editor changes have not been saved to the server. Export them before leaving this page.</p>}<button className="button secondary small" onClick={() => download('mock-interview-draft.json', JSON.stringify({ ...session, draft: answer }, null, 2))}><Download size={15}/> {answer === session.draft ? 'Export saved draft' : 'Export current draft'}</button></section>}<MockTranscript session={session} />
  </>;
}
function MockTranscript({ session }: { session: MockSession }) {
  if (!session.turns.length) return null;
  return <section className="mock-transcript"><div className="section-heading"><h2>Your conversation</h2><span>{session.turns.length} saved responses</span></div>{session.turns.map((turn, i) => <details className="panel" key={i} open={i === session.turns.length - 1}><summary><span>Turn {i + 1} · {turn.question}</span><Badge>{turn.feedback.score}/100</Badge></summary><p className="post-body">{turn.answer}</p><div className="local-notice">{turn.feedback.source === 'ai' ? 'Configured AI feedback' : 'Local rubric · not AI'}</div><p>{turn.feedback.summary}</p><ul>{turn.feedback.improvements.map(s => <li key={s}>{s}</li>)}</ul></details>)}</section>;
}
export function StudyPlansPage({ id }: { id?: string }) {
  const { can, data, act, setState, pending } = useStudio(), navigate = useNavigate(), [params] = useSearchParams();
  const [company, setCompany] = useState(params.get('company') || 'Meta'), [level, setLevel] = useState(params.get('level') || 'Senior');
  const [weeks, setWeeks] = useState('2'), [pace, setPace] = useState('3'), [startOn, setStartOn] = useState(new Date().toISOString().slice(0, 10));
  const plan = data.state.studyPlans.find(p => p.id === id);
  if (id) {
    if (!data.user) return <AuthPrompt />;
    if (!plan) return <NotFound />;
    const complete = plan.tasks.filter(t => planTaskComplete(t, plan, data.state)).length;
    return <>
      <Link className="back-link" to="/premium/plans"><ArrowLeft size={15} /> Your study plans</Link>
      <PageHeading eyebrow={`${plan.weeks} WEEKS · ${plan.sessionsPerWeek} SESSIONS PER WEEK`} title={`${plan.company} · ${plan.level} prep plan`} description="Progress follows saved lesson, quiz, practice, and mock-interview actions. Reflections are yours to write." action={<button className="button secondary small" onClick={() => download('study-plan.json', JSON.stringify(plan, null, 2))}><Download size={15} /> Export plan</button>} />
      <section className="panel plan-progress"><h2>{complete} of {plan.tasks.length} steps complete</h2><Progress value={complete / plan.tasks.length * 100} label="Plan progress" /></section>
      {!can('plan.create') && <div className="local-notice">Your plan remains readable and exportable. Current premium permission is required to save new reflections or begin premium sessions.</div>}
      {Array.from({ length: plan.weeks }, (_, week) => <section className="plan-week" key={week}><h2>Week {week + 1}</h2>{plan.tasks.slice(week * plan.sessionsPerWeek, (week + 1) * plan.sessionsPerWeek).map(task => {
        const done = planTaskComplete(task, plan, data.state);
        return <article className="panel plan-task" key={task.id}><span className={`plan-task-status ${done ? 'done' : ''}`} aria-label={done ? 'Task complete' : 'Task incomplete'}>{done ? <Check size={18} /> : <Target size={18} />}</span><div><span className="eyebrow">{task.day} · {task.kind}</span><h3>{task.title}</h3>{task.kind === 'reflection' ? <PlanReflection task={task} planId={plan.id} revision={plan.revision??0} /> : <Link className="text-link" to={task.to}>{done ? 'Review this step' : 'Open this step'} <ArrowRight size={14} /></Link>}</div></article>;
      })}</section>)}
    </>;
  }
  return <>
    <PageHeading eyebrow="A PLAN THAT CONNECTS TO PROGRESS" title="Make the next weeks count." description="Create an original company-focused schedule. Missed quiz topics influence the suggested checks; completed work remains recognized." />
    <PremiumAccess feature="plan.create"><div className="two-column"><form className="panel premium-form" onSubmit={e => { e.preventDefault(); void act(async () => {
      const result = await request<{ state: UserState; plan: StudyPlan }>('/api/study-plans', { company, level, weeks: Number(weeks), sessionsPerWeek: Number(pace), startOn });
      setState(result.state); navigate(`/premium/plans/${result.plan.id}`);
    }); }}><h2>Choose a sustainable pace</h2><div className="form-grid"><label>Company<select aria-label="Plan company" value={company} onChange={e => setCompany(e.target.value)}>{companies.map(c => <option key={c}>{c}</option>)}</select></label><label>Level<select aria-label="Plan level" value={level} onChange={e => setLevel(e.target.value)}>{levels.map(l => <option key={l}>{l}</option>)}</select></label><label>Duration<select aria-label="Plan weeks" value={weeks} onChange={e => setWeeks(e.target.value)}><option value="2">Two weeks</option><option value="4">Four weeks</option></select></label><label>Sessions per week<select aria-label="Plan sessions" value={pace} onChange={e => setPace(e.target.value)}><option value="3">Three focused sessions</option><option value="5">Five shorter sessions</option></select></label></div><label>Start date<input aria-label="Plan start date" type="date" required value={startOn} onChange={e => setStartOn(e.target.value)} /></label><p className="fine-print">This is original study curation, not a verified company interview loop. Confirm your actual format with the recruiter.</p><button className="button" disabled={pending}>Create study plan <CalendarDays size={16} /></button></form><section className="panel"><h2>Your saved plans</h2><PlanArchive /></section></div></PremiumAccess>
    {!can('plan.create') && data.state.studyPlans.length > 0 && <section className="panel premium-library"><PlanArchive /></section>}
  </>;
}
function PlanArchive() {
  const { data } = useStudio();
  return data.state.studyPlans.length ? <div className="premium-archive">{data.state.studyPlans.map(plan => <Link key={plan.id} to={`/premium/plans/${plan.id}`}><div><strong>{plan.company} · {plan.level}</strong><p>{plan.weeks} weeks · {plan.tasks.filter(t => planTaskComplete(t, plan, data.state)).length}/{plan.tasks.length} complete</p></div><ArrowRight size={16} /></Link>)}</div> : <Empty title="Room for a realistic schedule" description="A plan connects your preparation actions rather than adding a separate checkbox list." />;
}
function PlanReflection({ task, planId, revision }: { task: PlanTask; planId: string; revision: number }) {
  const { can, act, data, setState, pending, notify } = useStudio(), [note, setNote] = useState(task.note || '');
  const [editingRevision, setEditingRevision] = useState(revision), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setEditingRevision(revision); setNote(task.note || ''); } }, [dirty, revision, task.note]);
  return <form className="plan-reflection" onSubmit={e => { e.preventDefault(); void act(async () => { setState(await request<UserState>(`/api/study-plans/${planId}/reflection`, { taskId: task.id, note, revision: editingRevision })); setDirty(false); notify('Reflection saved to your plan.'); }); }}><label>What would you change next time?<textarea aria-label={`Reflection ${task.id}`} disabled={pending || !can('plan.create')} required minLength={20} maxLength={3000} value={note} onChange={e => { setDirty(true); setNote(e.target.value); }} rows={2} /></label><button className="button secondary small" disabled={pending || !can('plan.create')}>Save reflection</button></form>;
}
