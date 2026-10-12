import { ArrowLeft, ArrowRight, BookOpen, Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getTrack, problems } from "../../shared/public-catalog";
import { Badge, ContentSections, NotFound, PageHeading, PremiumGate, SourceLinks } from '../components';
import { useStudio } from '../store';
import type { Problem } from '../../shared/types';
import { ContentStatus, useContent } from '../content';

type SolutionTrack = 'code' | 'low-level-design';

export function CodingLibrary({ track = 'code' }: { track?: SolutionTrack }) {
  const exercises = problems.filter(problem => problem.track === track && problem.hasSolution), isCoding = track === 'code';
  return <><PageHeading eyebrow={`${isCoding ? 'CODING' : 'LOW-LEVEL DESIGN'} · ORIGINAL WORKED SOLUTIONS`} title="Explain the invariant. Test the implementation." description={isCoding ? `${exercises.length} original algorithm exercises with explicit contracts, reference implementations, complexity analysis, and executable examples.` : `${exercises.length} original worked object models with state histories and explicit limits. Four runnable exercises complement four preserved open-ended design briefs.`} action={<Link className="button secondary" to={`/learn/courses/${isCoding ? 'coding-complete' : 'low-level-design-complete'}`}><BookOpen size={17} /> {isCoding ? 'Complete coding path' : 'Complete object design path'}</Link>} />
    <p className="fine-print">Try the exercise before revealing its solution. Examples are not an exhaustive judge or verified company interview questions.</p>
    <div className="learning-index">{exercises.map(problem => <Link className="track-card" key={problem.id} to={`/practice/${track}/${problem.id}/writeup`}><Badge tone={problem.difficulty}>{problem.difficulty}</Badge><h2>{problem.title}</h2><p>{problem.description}</p><div className="track-card-bottom"><span>{problem.exampleCount} {problem.runnable ? 'executable examples' : 'reference-protocol examples'}</span><ArrowRight size={17} /></div></Link>)}</div>
  </>;
}

export function CodingReader({ problemId, track = 'code' }: { problemId: string; track?: SolutionTrack }) {
  const { can, data } = useStudio(), metadata = problems.find(problem => problem.track === track && problem.id === problemId);
  const access = !!metadata && (!metadata.premium || can('content.premium.read'));
  const resource = useContent<Omit<Problem, 'keywords'>>(access ? `/api/content/references/${encodeURIComponent(problemId)}` : null);
  const problem = resource.value, solution = problem?.solution;
  if (!metadata?.hasSolution) return <NotFound />;
  if (!access) return <><PageHeading title={metadata.title} description={metadata.description} /><PremiumGate /></>;
  if (!problem || !solution) return <ContentStatus {...resource}/>;
  const examples = solution.examples ?? problem.testCases ?? [], isCoding = track === 'code';
  return <><Link className="back-link" to={`/learn/${track}/solutions`}><ArrowLeft size={15} /> {isCoding ? 'Worked coding solutions' : 'Worked object designs'}</Link><div className="article-layout"><article className="lesson-article case-article">
    <div className="article-heading"><div><span className="eyebrow">ORIGINAL REFERENCE SOLUTION</span><h1>{problem.title}</h1></div><Badge tone={problem.difficulty}>{problem.difficulty}</Badge></div><p className="article-summary">{problem.description}</p>
    <section><h2>The contract</h2><ul>{problem.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></section>
    <ContentSections sections={solution.sections} />
    <section><h2>Complexity and assumptions</h2><p><strong>Time: </strong>{solution.timeComplexity}</p><p><strong>Space: </strong>{solution.spaceComplexity}</p><p>These bounds follow the stated computational model and input contract. Passing the example cases is not proof of correctness for every input.</p></section>
    <details className="case-followup"><summary><Code2 size={15} /> Reveal reference implementation</summary><pre><code>{solution.code}</code></pre></details>
    <section><h2>{problem.testCases ? 'Executable examples' : 'Reference-protocol examples'}</h2><p>{problem.testCases ? 'The practice workspace runs these cases in its network-disabled JavaScript worker. The reference reader displays them without executing code.' : 'These cases describe the narrowed reference protocol below. The original open-ended brief and starter are unchanged and have no executable acceptance harness. The reader displays examples without running code.'}</p><div className="capacity-calculations">{examples.map(example => <div className="panel coding-example" key={example.label}><h3>{example.label}</h3><pre><code>{`Input: ${JSON.stringify(example.input)}\nExpected: ${JSON.stringify(example.expected)}`}</code></pre></div>)}</div></section>
    <section><h2>Related lessons</h2><div className="content-next-steps">{solution.lessonIds.map(id => <Link className="text-link" key={id} to={`/learn/${track}/${id}`}>{getTrack(track)!.lessons.find(lesson => lesson.id === id)!.title} <ArrowRight size={15} /></Link>)}</div></section>
    <SourceLinks ids={solution.sourceIds} />
    <div className="exercise-box"><h3>Rebuild the reasoning yourself.</h3><p>State the invariant, implement the solution, and explain an input that would break a tempting alternative. Reading a solution does not complete its practice attempt.</p><Link className="button secondary small" to={`/practice/${track}/${problem.id}`}>{isCoding ? 'Practice this algorithm' : 'Practice this design'} <ArrowRight size={15} /></Link></div>
  </article><aside className="article-aside"><div className="toc"><h4>In this solution</h4>{solution.sections.map((section, i) => <a key={section.title} href={`#section-${i}`}>{section.title}</a>)}</div></aside></div></>;
}
