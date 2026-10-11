import { companies, problems, questionIndex, quizTopics, tracks } from './public-catalog';
import type { Level, MockSession, PlanTask, Problem, ProjectFile, StudyPlan, UserState } from './types';

export const companyTracks: Record<string, string[]> = {
  Meta: ['system-design', 'behavioral', 'code'],
  Google: ['code', 'system-design', 'behavioral'],
  Amazon: ['behavioral', 'system-design', 'low-level-design'],
  Microsoft: ['low-level-design', 'behavioral', 'system-design'],
  Apple: ['low-level-design', 'system-design', 'behavioral'],
  OpenAI: ['ai-coding', 'code-review', 'system-design'],
  Anthropic: ['ml-system-design', 'ai-coding', 'code-review'],
  Stripe: ['code-review', 'system-design', 'low-level-design'],
  Airbnb: ['system-design', 'behavioral', 'code'],
  Netflix: ['system-design', 'behavioral', 'low-level-design'],
};
export function companyProblems(company: string) {
  const selected = companyTracks[company];
  return problems.filter(p => selected?.includes(p.track) || selected?.includes('code') && p.track === 'ai-coding');
}
export function nextMockQuestion(problem: Problem, session: Pick<MockSession, 'turns' | 'level'>) {
  const used = new Set(session.turns.map(t => t.focus));
  const text = session.turns.map(t => t.answer).join(' ').toLowerCase();
  const candidates = problem.keywords.map((terms, focus) => ({
    focus, covered: terms.some(term => text.includes(term)), used: used.has(focus),
  })).sort((a, b) => Number(a.used) - Number(b.used) || Number(a.covered) - Number(b.covered) || a.focus - b.focus);
  const focus = candidates[0].focus;
  const behavioral = ['Set the scene and explain why this situation mattered.', 'Clarify your responsibility and the goal.', 'Walk through your personal actions, not just what the team did.', 'Explain the outcome and what evidence supports it.', 'Describe what you learned and what you would change next time.'];
  const prompt = problem.track === 'behavioral' ? behavioral[focus] : `Explain ${problem.keywords[focus][0]} in your approach to ${problem.title.toLowerCase()}.`;
  const depth = session.level === 'Staff' || session.level === 'Manager' ? 'Explain the wider impact, who you would involve, and how you would measure success.' : 'Give a concrete example and explain an alternative you rejected.';
  return { focus, question: `Let’s go deeper: ${prompt} ${session.turns.length % 2 ? 'What could go wrong, and how would you detect it?' : 'What evidence would change your approach?'} ${depth}` };
}
export function mockTurnProblem(problem: Problem, session: MockSession): Problem {
  if (!session.turns.length) return problem;
  return { ...problem, description: session.question, requirements: [session.question], keywords: [problem.keywords[session.focus]] };
}
export function mockReport(session: MockSession) {
  const count = session.turns.length;
  return {
    score: count ? Math.round(session.turns.reduce((sum, t) => sum + t.feedback.score, 0) / count) : 0,
    strengths: [...new Set(session.turns.flatMap(t => t.feedback.strengths))],
    improvements: [...new Set(session.turns.flatMap(t => t.feedback.improvements))],
    sources: [...new Set(session.turns.map(t => t.feedback.source))],
  };
}
export function customQuestionPool(topics: string[], mode: 'all' | 'missed', state: UserState) {
  return questionIndex.filter(q => topics.includes(q.topic) && (mode === 'all' || state.review.includes(q.id)));
}
export function chooseQuestions(ids: string[], count: number, random: () => number = Math.random) {
  if (!Number.isInteger(count) || count < 1 || count > 20 || count > ids.length) throw new Error(`Choose 1 to ${Math.min(20, ids.length)} matching questions.`);
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
export function makePlanTasks(company: string, level: Level, weeks: number, sessionsPerWeek: number, startOn: string, state: UserState): PlanTask[] {
  if (!companies.includes(company) || ![2, 4].includes(weeks) || ![3, 5].includes(sessionsPerWeek)) throw new Error('Invalid preparation schedule.');
  const date = new Date(`${startOn}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== startOn) throw new Error('Choose a valid start date.');
  const ordered = companyTracks[company], companyPool = companyProblems(company);
  const pool = companyPool.filter(p => level === 'Junior' ? p.difficulty === 'Easy' : p.difficulty !== 'Easy');
  const exercises = pool.length ? pool : companyPool;
  const weakTopics = quizTopics.filter(topic => questionIndex.some(q => q.topic === topic.id && state.review.includes(q.id)));
  const scheduledLessons = new Set<string>(), scheduledTopics = new Set<string>();
  const tasks: PlanTask[] = [];
  for (let week = 0; week < weeks; week++) {
    const selected = ordered[week % ordered.length], learningTrack = selected === 'code-review' ? 'ai-coding' : selected;
    const track = tracks.find(t => t.id === learningTrack)!;
    const lesson = track.lessons.find(l => !state.read.includes(`${track.id}/${l.id}`) && !scheduledLessons.has(`${track.id}/${l.id}`)) || track.lessons.find(l => !scheduledLessons.has(`${track.id}/${l.id}`)) || track.lessons[0];
    scheduledLessons.add(`${track.id}/${lesson.id}`);
    const problem = exercises[week % exercises.length];
    const weak = weakTopics.find(t => !scheduledTopics.has(t.id));
    const topic = weak || quizTopics.find(t => t.track === track.id && !scheduledTopics.has(t.id)) || quizTopics.find(t => !scheduledTopics.has(t.id))!;
    if (sessionsPerWeek === 5) scheduledTopics.add(topic.id);
    const sequence: Omit<PlanTask, 'id' | 'day'>[] = [
      { kind: 'lesson', title: lesson.title, resource: `${track.id}/${lesson.id}`, to: `/learn/${track.id}/${lesson.id}` },
      ...(sessionsPerWeek === 5 ? [{ kind: 'quiz' as const, title: `${weak ? 'Review gap: ' : 'Check understanding: '}${topic.title}`, resource: topic.id, to: `/quiz/${topic.id}` }] : []),
      { kind: 'practice', title: problem.title, resource: problem.id, to: `/practice/${problem.track}/${problem.id}` },
      ...(sessionsPerWeek === 5 ? [{ kind: 'reflection' as const, title: 'Reflect on one missed assumption', resource: '', to: '' }] : []),
      { kind: 'mock', title: `Mock interview: ${problem.title}`, resource: problem.id, to: `/premium/mock?problem=${problem.id}&company=${encodeURIComponent(company)}&level=${encodeURIComponent(level)}` },
    ];
    sequence.forEach((task, i) => {
      const scheduled = new Date(date);
      scheduled.setUTCDate(scheduled.getUTCDate() + week * 7 + (sessionsPerWeek === 3 ? [0, 2, 4] : [0, 1, 2, 4, 6])[i]);
      tasks.push({ ...task, id: `week-${week + 1}-${i}`, day: scheduled.toISOString().slice(0, 10) });
    });
  }
  return tasks;
}
export function planTaskComplete(task: PlanTask, plan: StudyPlan, state: UserState): boolean {
  if (task.kind === 'lesson') return state.read.includes(task.resource);
  if (task.kind === 'quiz') return state.quizzes.some(q => q.topic === task.resource);
  if (task.kind === 'practice') return state.attempts.some(a => a.problemId === task.resource && a.completed);
  if (task.kind === 'reflection') return !!task.note;
  return state.mocks.some(m => m.problemId === task.resource && m.company === plan.company && m.level === plan.level && !!m.completedAt);
}
export function sourcePathIssue(path: string): string | null {
  if (path.length > 160 || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) return 'Use a relative project path without traversal or special characters.';
  if (path.split('/').some(p => /^(\.env(?:\.|$)|\.cred|\.git(?:$|ignore$)|node_modules$|dist$|data$|coverage$|secrets?(?:\.|$)|credentials?(?:\.|$))/i.test(p))) return 'Credential and generated paths cannot be imported.';
  if (!/\.(js|jsx|ts|tsx|json|md|css|html|py|go|java)$/.test(path)) return 'Choose a supported text source file.';
  return null;
}
export function projectPatch(files: ProjectFile[]): string {
  return files.filter(f => f.original !== f.content).map(file => {
    const lines = (text: string | null) => text ? text.replace(/\n$/, '').split('\n') : [];
    const before = lines(file.original), after = lines(file.content);
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    if (prefix === before.length && prefix === after.length && file.original !== file.content) prefix = Math.max(0, prefix - 1);
    const newlineChanged = file.original !== null && file.content !== null && file.original.endsWith('\n') !== file.content.endsWith('\n');
    while (!newlineChanged && suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const contextStart = Math.max(0, prefix - 3), contextEnd = Math.min(suffix, 3);
    const oldCount = before.length - suffix + contextEnd - contextStart, newCount = after.length - suffix + contextEnd - contextStart;
    const output = [`diff --git a/${file.path} b/${file.path}`];
    if (file.original === null) output.push('new file mode 100644');
    if (file.content === null) output.push('deleted file mode 100644');
    if (!before.length && !after.length) return output.join('\n') + '\n';
    output.push(`--- ${file.original === null ? '/dev/null' : `a/${file.path}`}`, `+++ ${file.content === null ? '/dev/null' : `b/${file.path}`}`, `@@ -${oldCount ? contextStart + 1 : contextStart},${oldCount} +${newCount ? contextStart + 1 : contextStart},${newCount} @@`);
    const emit = (prefix: string, value: string, last: boolean, text: string | null) => {
      output.push(`${prefix}${value}`);
      if (last && text && !text.endsWith('\n')) output.push('\\ No newline at end of file');
    };
    for (let i = contextStart; i < prefix; i++) emit(' ', before[i], i === before.length - 1, file.original);
    for (let i = prefix; i < before.length - suffix; i++) emit('-', before[i], i === before.length - 1, file.original);
    for (let i = prefix; i < after.length - suffix; i++) emit('+', after[i], i === after.length - 1, file.content);
    for (let i = 0; i < contextEnd; i++) {
      const index = after.length - suffix + i;
      emit(' ', after[index], index === after.length - 1, file.content);
    }
    return output.join('\n') + '\n';
  }).join('');
}
