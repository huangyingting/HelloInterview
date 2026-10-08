import { ArrowLeft, ArrowRight, BookOpen, Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getTrack, problems } from '../../shared/catalog';
import { hasPremium } from '../../shared/domain';
import { Badge, ContentSections, PageHeading, SourceLinks } from '../components';
import { useStudio } from '../store';
import { NotFound, PremiumGate } from './Learn';

export function CodingLibrary() {
  const exercises = problems.filter(problem => problem.track === 'code' && problem.solution);
  return <><PageHeading eyebrow="CODING · ORIGINAL WORKED SOLUTIONS" title="Explain the invariant. Test the implementation." description={`${exercises.length} original algorithm exercises with explicit contracts, reference implementations, complexity analysis, and executable examples.`} action={<Link className="button secondary" to="/learn/courses/coding-complete"><BookOpen size={17} /> Complete coding path</Link>} />
    <p className="fine-print">Try the exercise before revealing its solution. Examples are not an exhaustive judge or verified company interview questions.</p>
    <div className="learning-index">{exercises.map(problem => <Link className="track-card" key={problem.id} to={`/practice/code/${problem.id}/writeup`}><Badge tone={problem.difficulty}>{problem.difficulty}</Badge><h2>{problem.title}</h2><p>{problem.description}</p><div className="track-card-bottom"><span>{problem.testCases!.length} executable examples</span><ArrowRight size={17} /></div></Link>)}</div>
  </>;
}

export function CodingReader({ problemId }: { problemId: string }) {
  const { data } = useStudio(), problem = problems.find(problem => problem.track === 'code' && problem.id === problemId), solution = problem?.solution;
  if (!problem || !solution) return <NotFound />;
  if (problem.premium && !hasPremium(data.state)) return <><PageHeading title={problem.title} description={problem.description} /><PremiumGate /></>;
  return <><Link className="back-link" to="/learn/code/solutions"><ArrowLeft size={15} /> Worked coding solutions</Link><div className="article-layout"><article className="lesson-article case-article">
    <div className="article-heading"><div><span className="eyebrow">ORIGINAL REFERENCE SOLUTION</span><h1>{problem.title}</h1></div><Badge tone={problem.difficulty}>{problem.difficulty}</Badge></div><p className="article-summary">{problem.description}</p>
    <section><h2>The contract</h2><ul>{problem.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></section>
    <ContentSections sections={solution.sections} />
    <section><h2>Complexity and assumptions</h2><p><strong>Time: </strong>{solution.timeComplexity}</p><p><strong>Space: </strong>{solution.spaceComplexity}</p><p>These bounds follow the stated computational model and input contract. Passing the example cases is not proof of correctness for every input.</p></section>
    <details className="case-followup"><summary><Code2 size={15} /> Reveal reference implementation</summary><pre><code>{solution.code}</code></pre></details>
    <section><h2>Executable examples</h2><p>The practice workspace runs these cases in its network-disabled JavaScript worker. The reference reader displays them without executing code.</p><div className="capacity-calculations">{problem.testCases!.map(example => <div className="panel coding-example" key={example.label}><h3>{example.label}</h3><pre><code>{`Input: ${JSON.stringify(example.input)}\nExpected: ${JSON.stringify(example.expected)}`}</code></pre></div>)}</div></section>
    <section><h2>Related lessons</h2><div className="content-next-steps">{solution.lessonIds.map(id => <Link className="text-link" key={id} to={`/learn/code/${id}`}>{getTrack('code')!.lessons.find(lesson => lesson.id === id)!.title} <ArrowRight size={15} /></Link>)}</div></section>
    <SourceLinks ids={solution.sourceIds} />
    <div className="exercise-box"><h3>Rebuild the reasoning yourself.</h3><p>State the invariant, implement the solution, and explain an input that would break a tempting alternative. Reading a solution does not complete its practice attempt.</p><Link className="button secondary small" to={`/practice/code/${problem.id}`}>Practice this algorithm <ArrowRight size={15} /></Link></div>
  </article><aside className="article-aside"><div className="toc"><h4>In this solution</h4>{solution.sections.map((section, i) => <a key={section.title} href={`#section-${i}`}>{section.title}</a>)}</div></aside></div></>;
}
