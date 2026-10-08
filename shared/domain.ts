import type { Course, CourseStep, Feedback, Problem, UserState } from './types';
import { quizQuestions } from './catalog';

export function emptyState(): UserState {
  return { read: [], bookmarks: [], targets: [], stories: [], attempts: [], quizzes: [], review: [], activity: [], plan: 'free', planExpiresAt: null, recognition: 0, enrollments: [], watched: [], certificates: [], chat: [], mocks: [], customQuizzes: [], studyPlans: [], projects: [] };
}

export function courseStepComplete(step: CourseStep, state: UserState): boolean {
  if (step.type === 'lesson') return state.read.includes(step.resource);
  if (step.type === 'video') return state.watched.includes(step.resource);
  if (step.type === 'quiz') return state.quizzes.some(q => q.topic === step.resource);
  return state.attempts.some(a => a.problemId === step.resource && a.completed);
}
export function courseCompletion(course: Course, state: UserState) {
  const steps = course.units.flatMap(u => u.steps);
  return { total: steps.length, complete: steps.filter(s => courseStepComplete(s, state)).length };
}

export function hasPremium(state: UserState, now = Date.now()): boolean {
  return state.plan === 'lifetime' || (state.plan !== 'free' && !!state.planExpiresAt && new Date(state.planExpiresAt).getTime() > now);
}

export function assessAnswer(problem: Problem, answer: string): Feedback {
  const text = answer.toLowerCase();
  const covered = problem.keywords.map(group => group.some(term => text.includes(term)));
  const coverage = covered.filter(Boolean).length / covered.length;
  const depth = Math.min(answer.trim().split(/\s+/).length / 100, 1);
  const score = Math.round(coverage * 75 + depth * 25);
  return {
    score,
    strengths: problem.requirements.filter((_, i) => covered[Math.min(i, covered.length - 1)]).map(r => `Your response touches on: ${r.toLowerCase()}`),
    improvements: problem.keywords.flatMap((group, i) => covered[i] ? [] : [`Explain ${group[0]} and connect it to a concrete requirement.`]),
    summary: 'Local rubric feedback checks topic coverage and response depth. It is not an AI interview grade or a prediction of hiring performance.',
    source: 'rubric',
  };
}

export function gradeQuiz(topic: string, answers: Record<string, number>) {
  const questions = quizQuestions.filter(q => topic === 'review' ? Object.hasOwn(answers, q.id) : q.topic === topic);
  return gradeQuestionSet(questions.map(q => q.id), answers);
}

export function gradeQuestionSet(ids: string[], answers: Record<string, number>) {
  const questions = ids.map(id => quizQuestions.find(q => q.id === id));
  if (new Set(ids).size !== ids.length || questions.some(q => !q)) throw new Error('Invalid quiz question set.');
  if (!questions.length) throw new Error('Unknown or empty quiz topic.');
  if (Object.keys(answers).some(id => !ids.includes(id))) throw new Error('Answer does not belong to this quiz.');
  for (const q of questions) {
    if (!q) throw new Error('Unknown quiz question.');
    const answer = answers[q.id];
    if (answer !== undefined && (!Number.isInteger(answer) || answer < -1 || answer >= q.options.length)) throw new Error('Invalid answer choice.');
  }
  const correct = questions.filter(q => q && answers[q.id] === q.correct).length;
  return { score: correct, total: questions.length, missed: questions.flatMap(q => q && answers[q.id] !== q.correct ? [q.id] : []) };
}

export function currentStreak(activity: string[], now = new Date()): number {
  const dates = new Set(activity);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!dates.has(day.toISOString().slice(0, 10))) day.setUTCDate(day.getUTCDate() - 1);
  let streak = 0;
  while (dates.has(day.toISOString().slice(0, 10))) {
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return streak;
}
