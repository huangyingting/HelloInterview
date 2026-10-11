import { quizQuestions } from '../../shared/catalog';
import type { QuizQuestion } from '../../shared/types';

export function gradeQuiz(topic: string, answers: Record<string, number>) {
  const questions = quizQuestions.filter(q => topic === 'review' ? Object.hasOwn(answers, q.id) : q.topic === topic);
  return gradeQuestions(questions, answers);
}
export function gradeQuestionSet(ids: string[], answers: Record<string, number>) {
  const questions = ids.map(id => quizQuestions.find(q => q.id === id));
  if (new Set(ids).size !== ids.length || questions.some(q => !q)) throw new Error('Invalid quiz question set.');
  return gradeQuestions(questions.filter((question): question is QuizQuestion => !!question), answers);
}
export function gradeQuestions(questions: QuizQuestion[], answers: Record<string, number>) {
  if (!questions.length) throw new Error('Unknown or empty quiz topic.');
  if (Object.keys(answers).some(id => !questions.some(question => question.id === id))) throw new Error('Answer does not belong to this quiz.');
  for (const q of questions) {
    const answer = answers[q.id];
    if (answer !== undefined && (!Number.isInteger(answer) || answer < -1 || answer >= q.options.length)) throw new Error('Invalid answer choice.');
  }
  const correct = questions.filter(q => answers[q.id] === q.correct).length;
  return { score: correct, total: questions.length, missed: questions.flatMap(q => answers[q.id] !== q.correct ? [q.id] : []) };
}
