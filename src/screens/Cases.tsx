import { ArrowLeft, ArrowRight, BookOpen, Clock3 } from 'lucide-react';
import { Link } from '../navigation';
import { getTrack, problems } from "../../shared/public-catalog";
import { ArchitectureFigure, Badge, ContentSections, NotFound, PageHeading, PremiumGate, SourceLinks } from '../components';
import { useStudio } from '../store';
import type { Problem } from '../../shared/types';
import { ContentStatus, useContent } from '../content';

export function CaseLibrary() {
  const cases = problems.filter(problem => problem.track === 'system-design' && problem.hasWorkedCase);
  return <><PageHeading eyebrow="SYSTEM DESIGN · WORKED DESIGNS" title="Study the decisions, not just the diagram." description={`${cases.length} original worked examples with hypothetical workloads, explicit calculations, failure paths, alternatives, and public sources.`} action={<Link className="button secondary" to="/learn/courses/system-design-complete"><BookOpen size={17} /> Full learning path</Link>} />
    <p className="fine-print">These are illustrative designs, not official company solutions or current interview-loop reports. Try the exercise before reading its reference design.</p>
    <div className="learning-index">{cases.map(problem => <Link className="track-card" key={problem.id} to={`/practice/system-design/${problem.id}/writeup`}><Badge tone={problem.difficulty}>{problem.difficulty}</Badge><h2>{problem.title}</h2><p>{problem.caseSummary}</p><div className="track-card-bottom"><span>{problem.calculationCount} capacity calculations{problem.premium ? ' · Premium' : ''}</span><ArrowRight size={17} /></div></Link>)}</div>
  </>;
}

export function CaseReader({ problemId }: { problemId: string }) {
  const { can, data } = useStudio(), metadata = problems.find(problem => problem.track === 'system-design' && problem.id === problemId);
  const access = !!metadata && (!metadata.premium || can('content.premium.read'));
  const resource = useContent<Omit<Problem, 'keywords'>>(access ? `/api/content/references/${encodeURIComponent(problemId)}` : null);
  const problem = resource.value, study = problem?.workedCase;
  if (!metadata?.hasWorkedCase) return <NotFound />;
  if (!access) return <><PageHeading title={metadata.title} description={metadata.caseSummary} /><PremiumGate /></>;
  if (!problem || !study) return <ContentStatus {...resource}/>;
  const words = study.sections.flatMap(section => [section.body, ...(section.bullets || [])]).concat(study.followUps.map(followUp => followUp.answer)).join(' ').trim().split(/\s+/).length;
  return <><Link className="back-link" to="/learn/system-design/cases"><ArrowLeft size={15} /> Worked design library</Link>
    <div className="article-layout"><article className="lesson-article case-article"><div className="article-heading"><div><span className="eyebrow">ORIGINAL WORKED DESIGN</span><h1>{problem.title}</h1></div><Badge tone={problem.difficulty}>{problem.difficulty}</Badge></div><p className="article-summary">{study.summary}</p><div className="article-meta"><Clock3 size={14} />{Math.ceil(words / 200)} min read<span>·</span>Hypothetical workload</div>
      <section><h2>Scope and assumptions</h2><ul>{study.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul><p className="fine-print">Numbers are teaching assumptions, not measurements of a real company's system.</p></section>
      <ArchitectureFigure text={study.diagram} label="Reference architecture" />
      <section><h2>Capacity calculations</h2><div className="capacity-calculations">{study.calculations.map(calculation => <div className="panel" key={calculation.label}><h3>{calculation.label}</h3><p><code>({calculation.factors.map(factor => factor.toLocaleString('en-US')).join(' × ')}) / {calculation.divisor.toLocaleString('en-US')} = {calculation.result.toLocaleString('en-US', { maximumFractionDigits: 2 })} {calculation.unit}</code></p><p>{calculation.assumption}</p></div>)}</div></section>
      <ContentSections sections={study.sections} />
      <section><h2>Follow-up questions</h2>{study.followUps.map(followUp => <details className="case-followup" key={followUp.question}><summary>{followUp.question}</summary>{followUp.answer.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</details>)}</section>
      <section><h2>Related lessons</h2><div className="content-next-steps">{study.lessonIds.map(id => <Link key={id} className="text-link" to={`/learn/system-design/${id}`}>{getTrack('system-design')!.lessons.find(lesson => lesson.id === id)!.title} <ArrowRight size={15} /></Link>)}</div></section>
      <SourceLinks ids={study.sourceIds} />
      <div className="exercise-box"><h3>Make the argument your own.</h3><p>Change one assumption, explain which decision breaks, and propose a justified alternative. Reading a reference design does not complete the exercise.</p><Link className="button secondary small" to={`/practice/system-design/${problem.id}`}>Practice this design <ArrowRight size={15} /></Link></div>
    </article><aside className="article-aside"><div className="toc"><h4>Decisions in this design</h4>{study.sections.map((section, i) => <a key={section.title} href={`#section-${i}`}>{section.title}</a>)}</div></aside></div>
  </>;
}
