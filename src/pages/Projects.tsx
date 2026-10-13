import { ArrowLeft, ArrowRight, Code2, Download, FileCode2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { problems } from "../../shared/public-catalog";
import { projectPatch, sourcePathIssue } from '../../shared/premium';
import type { PracticeProblem, ProjectFile, ProjectWorkspace, UserState } from '../../shared/types';
import { AuthPrompt, Badge, Empty, NotFound, PageHeading, PremiumAccess } from '../components';
import { runCode, type TestResult } from '../sandbox';
import { request, useStudio } from '../store';
import { ContentStatus, useContent } from '../content';
import { download } from '../download';

export function ProjectsPage({ id }: { id?: string }) {
  return id ? <ProjectEditor id={id} /> : <ProjectSetup />;
}
function ProjectArchive() {
  const { data } = useStudio();
  return data.state.projects.length ? <div className="premium-archive">{data.state.projects.map(p => <Link key={p.id} to={`/premium/projects/${p.id}`}><div><strong>{p.title}</strong><p>{p.files.length} tracked files · {problems.find(t => t.id === p.problemId)?.title}</p></div><Badge>{p.feedback ? `${p.feedback.score}/100` : 'Draft'}</Badge><ArrowRight size={16} /></Link>)}</div> : <Empty title="Start with a small change" description="Original starter projects and imported text snapshots use the same saved workbench." />;
}
async function starterFiles(problemId: string) {
  const problem = await request<PracticeProblem>(`/api/content/problems/${encodeURIComponent(problemId)}`);
  if (problem.starter === undefined) throw new Error('This task has no starter files.');
  return [{ path: `${problemId}.js`, content: problem.starter }];
}
async function readSourceFile(file: File): Promise<string> {
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch (error) { if (error instanceof TypeError) throw new Error(`${file.name}: choose a valid UTF-8 text file.`); throw error; }
  if (content.includes('\0')) throw new Error(`${file.name}: binary content cannot be imported.`);
  return content;
}
function ProjectSetup() {
  const { can, data, act, pending, setState, notify } = useStudio(), navigate = useNavigate();
  const [problemId, setProblemId] = useState('event-dedup'), [title, setTitle] = useState('My event processing project'), [files, setFiles] = useState<{ path: string; content: string }[]>([]);
  const starter = useContent<PracticeProblem>(can('project.create') ? '/api/content/problems/event-dedup' : null);
  useEffect(() => { const content=starter.value?.starter; if(content!==undefined)setFiles(current=>current.length?current:[{path:'event-dedup.js',content}]); }, [starter.value]);
  return <>
    <PageHeading eyebrow="BRING A SOURCE SNAPSHOT" title="Work with the code, not just the prompt." description="Make a bounded change, inspect the diff, record your verification, and take a patch back to your editor." />
    <PremiumAccess feature="project.create"><div className="two-column"><form className="panel premium-form" onSubmit={e => { e.preventDefault(); void act(async () => {
      const result = await request<{ state: UserState; project: ProjectWorkspace }>('/api/projects', { title, problemId, files });
      setState(result.state); navigate(`/premium/projects/${result.project.id}`);
    }); }}><h2>A bounded project task</h2><label>Project title<input aria-label="Project title" value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={100} required /></label><label>Acceptance task<select aria-label="Project task" value={problemId} onChange={e => setProblemId(e.target.value)}>{problems.filter(p => p.track === 'ai-coding').map(p => <option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
      <button type="button" className="button secondary small" onClick={() => act(async () => setFiles(await starterFiles(problemId)))}>Use starter files <Code2 size={16} /></button>
      <label>Or import your text source files<input aria-label="Import source files" type="file" multiple disabled={pending} accept=".js,.jsx,.ts,.tsx,.json,.md,.css,.html,.py,.go,.java" onChange={e => {
        const input = e.currentTarget, selected = [...(input.files || [])];
        void act(async () => {
          if (!selected.length || selected.length > 16) throw new Error('Choose 1 to 16 text source files.');
          for (const file of selected) {
            const issue = sourcePathIssue(file.webkitRelativePath || file.name);
            if (issue) throw new Error(`${file.name}: ${issue}`);
            if (file.size > 80000) throw new Error(`${file.name} exceeds the source-file size limit.`);
          }
          const imported = await Promise.all(selected.map(async file => ({ path: file.webkitRelativePath || file.name, content: await readSourceFile(file) })));
          if (new Set(imported.map(f => f.path)).size !== imported.length) throw new Error('Imported file paths must be distinct.');
          if (imported.some(f => f.content.length > 20000) || imported.reduce((sum, f) => sum + f.content.length, 0) > 120000) throw new Error('Use files under 20,000 characters and a total snapshot under 120,000 characters.');
          setFiles(imported); input.value = ''; notify(`${imported.length} source files imported into this page.`);
        });
      }} /></label><div className="project-import-list">{files.map(f => <span key={f.path}><FileCode2 size={15} />{f.path}<small>{f.content.length} characters</small></span>)}</div>
      {!starter.value && <ContentStatus {...starter}/>}<p className="fine-print">Credential/generated paths are rejected before reading. This is not a secret scanner: do not import keys, confidential code, or private data. Only text snapshots are stored; no repository is cloned and no backend code is executed.</p>
      <button className="button" disabled={pending || !files.length}>Create project workspace <ArrowRight size={16} /></button>
    </form><section className="panel"><h2>Your saved workspaces</h2><ProjectArchive /></section></div></PremiumAccess>
    {!can('project.create') && data.state.projects.length > 0 && <section className="panel premium-library"><ProjectArchive /></section>}
  </>;
}
function ProjectEditor({ id }: { id: string }) {
  const { can, data, act, pending, setState, notify } = useStudio(), project = data.state.projects.find(p => p.id === id);
  const resource = useContent<PracticeProblem>(project ? `/api/content/problems/${encodeURIComponent(project.problemId)}?project=${encodeURIComponent(id)}` : null);
  const [files, setFiles] = useState<ProjectFile[]>(project?.files || []), [active, setActive] = useState(project?.files[0]?.path || '');
  const [explanation, setExplanation] = useState(project?.explanation || ''), [verification, setVerification] = useState(project?.verification || '');
  const [tab, setTab] = useState('editor'), [newFile, setNewFile] = useState(''), [running, setRunning] = useState(false), [results, setResults] = useState<{ path: string; cases: TestResult[] } | null>(null);
  useEffect(() => { setFiles(project?.files || []); setExplanation(project?.explanation || ''); setVerification(project?.verification || ''); }, [id, project?.revision]);
  if (!data.user) return <AuthPrompt />;
  if (!project) return <NotFound />;
  const task = resource.value;
  const file = files.find(f => f.path === active), patch = projectPatch(files);
  const editable = can('project.create'), dirty = JSON.stringify(files) !== JSON.stringify(project.files) || explanation !== project.explanation || verification !== project.verification;
  const save = async () => {
    const state = await request<UserState>(`/api/projects/${id}/save`, { revision: project.revision, files: files.map(f => ({ path: f.path, content: f.content })), explanation, verification });
    setState(state); return state.projects.find(p => p.id === id)!;
  };
  return <>
    <Link className="back-link" to="/premium/projects"><ArrowLeft size={15} /> Project archive</Link>
    <PageHeading eyebrow={dirty ? 'UNSAVED CHANGES' : 'SAVED SOURCE SNAPSHOT'} title={project.title} description={task?.description} action={<button className="button secondary small" disabled={pending || !editable} onClick={() => act(async () => { await save(); notify('Project files and notes saved.'); })}><Save size={15} /> Save project</button>} />
    {!task && <ContentStatus {...resource}/>}
    {!editable && <div className="local-notice">Your files and report remain readable and exportable. Current premium permission is required to edit or request a new review.</div>}
    <div className="project-workspace">
      <aside className="panel project-files"><h2>Project files</h2>{files.map(f => <button key={f.path} className={active === f.path ? 'active' : ''} onClick={() => setActive(f.path)}><FileCode2 size={15} /><span>{f.path}{f.content === null ? ' · deleted' : ''}</span></button>)}
        <label>New relative path<input aria-label="New project file path" placeholder="tests.js" value={newFile} onChange={e => setNewFile(e.target.value)} disabled={!editable || pending} maxLength={160} /></label>
        {newFile && sourcePathIssue(newFile) && <p className="error-text">{sourcePathIssue(newFile)}</p>}
        {newFile && files.some(f => f.path === newFile) && <p className="error-text">This path is already tracked. Select it in the file list instead.</p>}
        <button className="button secondary small" disabled={!editable || pending || !newFile || !!sourcePathIssue(newFile) || files.some(f => f.path === newFile) || files.length >= 16} onClick={() => { setFiles([...files, { path: newFile, original: null, content: '' }]); setActive(newFile); setNewFile(''); }}><Plus size={14} /> Add file</button>
        <h3>Acceptance criteria</h3><ul>{task?.requirements.map(r => <li key={r}>{r}</li>)}</ul>
      </aside>
      <section className="panel project-editor"><div className="tabs" role="tablist" aria-label="Project views">{['editor', 'changes', 'review'].map(t => <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>{t === 'editor' ? 'Source editor' : t === 'changes' ? 'Changes' : 'Review and verification'}</button>)}</div>
        {tab === 'editor' && file && <><div className="section-heading"><h3>{file.path}</h3><button className="text-button" disabled={!editable || pending} onClick={() => { setFiles(files.map(f => f.path === file.path ? { ...f, content: f.content === null ? f.original || '' : null } : f)); setResults(null); }}><Trash2 size={14} />{file.content === null ? 'Restore file' : 'Delete file'}</button></div>
          <label>Source contents<textarea className="code-editor" aria-label="Project source contents" value={file.content || ''} disabled={!editable || file.content === null || running || pending} maxLength={20000} spellCheck={false} rows={16} onChange={e => { const content = file.content?.includes('\r\n') ? e.target.value.replace(/\r?\n/g, '\r\n') : e.target.value; setFiles(files.map(f => f.path === active ? { ...f, content } : f)); setResults(null); }} /></label>
          <div className="project-editor-actions"><button className="button secondary small" disabled={running || pending || !editable || !task || file.content === null || !file.path.endsWith('.js')} onClick={() => act(async () => {
            setRunning(true);
            try { if (!task) throw new Error('The task examples are unavailable.'); const cases = await runCode(file.content || '', task.testCases || []); setResults({ path: file.path, cases }); }
            finally { setRunning(false); }
          })}>{running ? 'Running…' : 'Run example checks'}</button><p className="fine-print">Runs client-visible examples for this file’s synchronous solve(input) in a network-disabled opaque origin with bounded results and a two-second CPU deadline. It is not authoritative grading or a reliable memory sandbox; imported modules and other languages are not executed.</p></div>
          {results && <div className="project-results" role="status"><strong>{results.cases.filter(c => c.passed).length}/{results.cases.length} example checks passed · {results.path}</strong>{results.cases.map(c => <div key={c.label}><Badge tone={c.passed ? 'green' : 'amber'}>{c.passed ? 'Pass' : 'Fail'}</Badge><span>{c.label} {c.error || `· expected ${c.expected}, got ${c.actual}`}</span></div>)}</div>}
        </>}
        {tab === 'changes' && <><div className="section-heading"><h2>Changes from the imported baseline</h2><button className="button secondary small" disabled={!patch} onClick={() => download('project-changes.patch', patch, 'text/plain')}><Download size={15} /> Export patch</button></div>{patch ? <pre className="project-diff">{patch}</pre> : <Empty title="No changes yet" description="Edit or add a file to see the changes against the immutable source baseline." />}</>}
        {tab === 'review' && <form onSubmit={e => { e.preventDefault(); void act(async () => { const saved = await save(); setState(await request<UserState>(`/api/projects/${id}/review`, { revision: saved.revision })); notify('Project review saved.'); }); }}><label>Explain your change<textarea aria-label="Project explanation" value={explanation} onChange={e => setExplanation(e.target.value)} required minLength={30} maxLength={8000} disabled={!editable || pending} rows={4} /></label><label>What did you verify, and what remains unchecked?<textarea aria-label="Project verification notes" value={verification} onChange={e => setVerification(e.target.value)} required minLength={10} maxLength={4000} disabled={!editable || pending} rows={3} /></label><p className="fine-print">Verification notes are user-reported, not server-executed tests. {data.capabilities.ai ? 'Your explanation, notes, and diff are sent to the configured AI provider for review.' : 'Review uses the original task’s topic rubric; it is not AI.'}</p><button className="button" disabled={pending || !editable || !patch}>Review saved changes <ArrowRight size={15} /></button>{project.feedback && <section className="project-feedback"><Badge>{project.feedback.source === 'ai' ? 'Configured AI review' : 'Local rubric · not AI'}</Badge><h2>{project.feedback.score}/100</h2><p>{project.feedback.summary}</p><ul>{project.feedback.improvements.map(s => <li key={s}>{s}</li>)}</ul></section>}</form>}
      </section>
    </div>
    <div className="project-export-row"><button className="text-button" onClick={() => download('project-snapshot.json', JSON.stringify({ ...project, files, explanation, verification }, null, 2))}><Download size={15} /> Export current snapshot</button><p className="fine-print">Snapshot workflow only: no live repository, terminal, remote upload, or IDE connection.</p></div>
  </>;
}
