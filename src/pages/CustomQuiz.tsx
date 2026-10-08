import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { quizQuestions, quizTopics } from '../../shared/catalog';
import { customQuestionPool } from '../../shared/premium';
import type { CustomQuiz, UserState } from '../../shared/types';
import { AuthPrompt, Badge, Empty, PageHeading, Progress } from '../components';
import { request, useStudio } from '../store';
import { NotFound } from './Learn';
import { PremiumAccess } from './Premium';
import { download } from './Practice';
import { QuizAnswerChoices } from './Quiz';

export function CustomQuizPage({ id }: { id?: string }) {
  return id ? <CustomQuizSession id={id} /> : <CustomQuizBuilder />;
}
function CustomQuizBuilder() {
  const { data, setState, act, pending } = useStudio(), navigate = useNavigate();
  const [title, setTitle] = useState('My focused quiz'), [topics, setTopics] = useState(['api-design', 'caching']), [count, setCount] = useState('3'), [mode, setMode] = useState<'all' | 'missed'>('all');
  const pool = customQuestionPool(topics, mode, data.state), valid = topics.length > 0 && Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= Math.min(20, pool.length);
  return <>
    <PageHeading eyebrow="A QUIZ BUILT AROUND YOUR NEXT QUESTION" title="Choose the gaps worth checking." description="Combine original topics or select only missed questions. The saved session preserves its order, answers, and score." />
    <PremiumAccess><form className="panel custom-quiz-builder" onSubmit={e => { e.preventDefault(); void act(async () => {
      const result = await request<{ state: UserState; quiz: CustomQuiz }>('/api/custom-quizzes', { title, topics, mode, count: Number(count) });
      setState(result.state); navigate(`/quiz/custom/${result.quiz.id}`);
    }); }}><label>Session title<input aria-label="Custom quiz title" value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={100} /></label>
      <fieldset className="custom-topic-grid"><legend>Select topics</legend>{quizTopics.map(topic => <label key={topic.id}><input type="checkbox" aria-label={`Quiz topic: ${topic.title}`} checked={topics.includes(topic.id)} onChange={e => setTopics(e.target.checked ? [...topics, topic.id] : topics.filter(id => id !== topic.id))} /><span><strong>{topic.title}</strong><small>{topic.count} original questions</small></span></label>)}</fieldset>
      <div className="form-grid"><label>Question pool<select aria-label="Custom quiz pool" value={mode} onChange={e => setMode(e.target.value === 'missed' ? 'missed' : 'all')}><option value="all">All selected questions</option><option value="missed">Only my missed questions</option></select></label><label>Session length<input aria-label="Custom quiz question count" type="number" min={1} max={Math.min(20, pool.length)} required value={count} onChange={e => setCount(e.target.value)} /></label></div>
      <p className={valid ? 'muted' : 'error-text'} aria-live="polite">{pool.length ? `${pool.length} matching questions. Choose a whole number between 1 and ${Math.min(20, pool.length)}.` : 'No questions match. Select more topics or take a regular quiz first to build your missed-question deck.'}</p>
      <button className="button" disabled={pending || !valid}>Create custom quiz <ArrowRight size={16} /></button>
    </form></PremiumAccess>
    <Link className="text-link" to="/quiz"><ArrowLeft size={15} /> Return to quiz library and saved sessions</Link>
  </>;
}
function CustomQuizSession({ id }: { id: string }) {
  const { data, setState, act, pending } = useStudio(), quiz = data.state.customQuizzes.find(q => q.id === id);
  const [selected, setSelected] = useState<number | null>(null), [checked, setChecked] = useState(false);
  const nextId = quiz?.questionIds.find(q => !Object.hasOwn(quiz.answers, q));
  useEffect(() => { setSelected(null); setChecked(false); }, [id, nextId]);
  if (!data.user) return <AuthPrompt />;
  if (!quiz) return <NotFound />;
  const finish = async (saved: CustomQuiz) => setState(await request<UserState>(`/api/custom-quizzes/${id}/finish`, { revision: saved.revision }));
  if (quiz.completedAt) return <>
    <Link className="back-link" to="/quiz"><ArrowLeft size={15} /> Quiz library</Link>
    <PageHeading eyebrow="YOUR SAVED CUSTOM SESSION" title="Your custom quiz results." description={`${quiz.title} · ${new Date(quiz.completedAt).toLocaleString()}`} action={<button className="button secondary small" onClick={() => download('custom-quiz-result.json', JSON.stringify(quiz, null, 2))}><Download size={15} /> Export quiz result</button>} />
    <div className="quiz-result-hero"><ClipboardCheck size={32} /><div className="result-score">{quiz.score}<span>/ {quiz.questionIds.length}</span></div><p>Missed and skipped questions join your review deck. Correct answers remove these questions from it.</p></div>
    <div className="quiz-explanations">{quiz.questionIds.map(id => { const question = quizQuestions.find(q => q.id === id)!; return <article className="panel" key={id}><div className="section-heading"><h3>{question.prompt}</h3><Badge tone={quiz.answers[id] === question.correct ? 'green' : 'amber'}>{quiz.answers[id] === question.correct ? 'Correct' : 'Review'}</Badge></div><p>Your answer: {quiz.answers[id] === -1 ? 'Skipped' : question.options[quiz.answers[id]]}</p><p>Correct answer: {question.options[question.correct]}</p><p>{question.explanation}</p></article>; })}</div>
  </>;
  const question = quizQuestions.find(q => q.id === nextId);
  const advance = (answer: number) => act(async () => {
    const state = await request<UserState>(`/api/custom-quizzes/${id}/answer`, { revision: quiz.revision, questionId: nextId, answer });
    setState(state); const saved = state.customQuizzes.find(q => q.id === id)!;
    if (Object.keys(saved.answers).length === saved.questionIds.length) await finish(saved);
  });
  return <PremiumAccess>{question ? <div className="quiz-runner">
    <div className="quiz-runner-top"><Link className="text-link" to="/quiz"><ArrowLeft size={15} /> {quiz.title}</Link><span>{Object.keys(quiz.answers).length + 1} of {quiz.questionIds.length}</span></div>
    <Progress value={Object.keys(quiz.answers).length / quiz.questionIds.length * 100} /><span className="eyebrow question-eyebrow">SAVED CUSTOM QUIZ</span><h1>{question.prompt}</h1>
    <QuizAnswerChoices question={question} selected={selected} checked={checked} pending={pending} onSelect={setSelected} />
    <div className="quiz-question-bottom"><button className="text-button" disabled={pending || checked} onClick={() => advance(-1)}>Skip question</button>{checked ? <button className="button" disabled={pending} onClick={() => advance(selected!)}>{Object.keys(quiz.answers).length + 1 === quiz.questionIds.length ? 'Finish quiz' : 'Next question'} <ArrowRight size={16} /></button> : <button className="button" disabled={pending || selected === null} onClick={() => setChecked(true)}>Check answer <Check size={16} /></button>}</div>
    <p className="fine-print">Each advanced/skipped answer is saved. Leaving before advancing does not commit a selection.</p>
  </div> : <Empty title="Every question is answered" description="Finalize the saved session to calculate its canonical score and update your review deck."><button className="button" disabled={pending} onClick={() => act(() => finish(quiz))}>Finish quiz</button></Empty>}</PremiumAccess>;
}
