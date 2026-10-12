import { z } from 'zod';
import type { PracticeProblem, UserState } from '../../shared/types';

const text = z.string().max(40000);
const id = z.string().min(1).max(200);
const revision = z.number().int().nonnegative().optional();
const level = z.enum(['Junior', 'Mid-level', 'Senior', 'Staff', 'Manager']);
const feedback = z.strictObject({
  score: z.number().min(0).max(100), strengths: z.array(text), improvements: z.array(text),
  summary: text, source: z.enum(['rubric', 'ai']),
});
const file = z.strictObject({ path: id, original: text.max(20000).nullable(), content: text.max(20000).nullable() });
const projectBrief: z.ZodType<PracticeProblem> = z.strictObject({
  id, track: id, title: text, difficulty: z.enum(['Easy', 'Medium', 'Hard']), description: text,
  requirements: z.array(text).max(100), starter: text.optional(), premium: z.boolean().optional(),
  testCases: z.array(z.strictObject({ input: z.unknown(), expected: z.unknown(), label: text })).max(100).optional(),
});

export const userStateSchema: z.ZodType<UserState> = z.strictObject({
  read: z.array(id), bookmarks: z.array(id), review: z.array(id), activity: z.array(id),
  enrollments: z.array(id), watched: z.array(id),
  plan: z.enum(['free', 'month', 'year', 'lifetime']),
  planExpiresAt: text.nullable(), recognition: z.number().int().nonnegative(),
  targets: z.array(z.strictObject({ id, company: text, level, role: text, date: text })).max(20),
  stories: z.array(z.strictObject({ id, title: text, situation: text, task: text, action: text, result: text, tags: z.array(text), revision })).max(100),
  attempts: z.array(z.strictObject({
    id, problemId: id, level, answer: text, code: text,
    nodes: z.array(z.strictObject({ id, label: text, x: z.number().finite(), y: z.number().finite() })).max(30),
    edges: z.array(z.tuple([id, id])).max(60), feedback: feedback.optional(),
    completed: z.boolean(), updatedAt: text, elapsed: z.number().finite().nonnegative(), revision,
  })).max(500),
  quizzes: z.array(z.strictObject({
    id, topic: id, answers: z.record(id, z.number().int()), score: z.number().int().nonnegative(),
    total: z.number().int().positive(), completedAt: text, contentVersion: id.optional(), questionIds: z.array(id).optional(),
  })).max(500),
  certificates: z.array(z.strictObject({ id, courseId: id, issuedAt: text })),
  chat: z.array(z.strictObject({ id, role: z.enum(['user', 'assistant']), text, createdAt: text, source: z.enum(['rubric', 'ai']).optional() })).max(100),
  mocks: z.array(z.strictObject({
    id, problemId: id, company: text, level, length: z.number().int().positive(),
    question: text, focus: z.number().int(), draft: text, revision: z.number().int().nonnegative(),
    turns: z.array(z.strictObject({ question: text, focus: z.number().int(), answer: text, feedback })).max(5),
    createdAt: text, completedAt: text.optional(),
  })).max(100),
  customQuizzes: z.array(z.strictObject({
    id, title: text, topics: z.array(id), mode: z.enum(['all', 'missed']),
    questionIds: z.array(id), answers: z.record(id, z.number().int()),
    revision: z.number().int().nonnegative(), createdAt: text, completedAt: text.optional(),
    score: z.number().int().nonnegative().optional(), contentVersion: id.optional(),
  })).max(100),
  studyPlans: z.array(z.strictObject({
    id, company: text, level, weeks: z.number().int().positive(), sessionsPerWeek: z.number().int().positive(),
    tasks: z.array(z.strictObject({
      id, day: text, title: text, kind: z.enum(['lesson', 'quiz', 'practice', 'mock', 'reflection']),
      resource: text, to: text, note: text.optional(),
    })), createdAt: text, revision,
  })).max(20),
  projects: z.array(z.strictObject({
    id, title: text, problemId: id, files: z.array(file), explanation: text, verification: text,
    brief: projectBrief.optional(), briefVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    revision: z.number().int().nonnegative(), createdAt: text,
    feedback: feedback.optional(), completedAt: text.optional(),
  })).max(20),
}).superRefine((state, context) => {
  for (const [field, values] of Object.entries(state)) {
    if (!Array.isArray(values)) continue;
    const keys = values.map(item => typeof item === 'string' ? item : item.id);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: [field], message: 'Duplicate resource identifiers cannot be persisted.' });
  }
  for (const [index, project] of state.projects.entries()) {
    if (!!project.brief !== !!project.briefVersion || project.brief && project.brief.id !== project.problemId) {
      context.addIssue({ code: 'custom', path: ['projects', index, 'brief'], message: 'A project task snapshot requires its matching content version.' });
    }
    if (project.files.length < 1 || project.files.length > 16 || new Set(project.files.map(file => file.path)).size !== project.files.length
      || project.files.reduce((sum, file) => sum + (file.content?.length ?? 0), 0) > 120000) {
      context.addIssue({ code: 'custom', path: ['projects', index, 'files'], message: 'Project snapshot exceeds its file limits or contains duplicate paths.' });
    }
  }
});
