import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Capability } from '../../shared/access';
import { companies, getTrack, levels, problems, quizQuestions, quizTopics } from '../../shared/catalog';
import { assessAnswer, courseCompletion } from '../../shared/domain';
import { courses } from '../../shared/courses';
import { chooseQuestions, customQuestionPool, makePlanTasks, mockTurnProblem, nextMockQuestion } from '../../shared/premium';
import type { Attempt, MockSession, QuizQuestion, UserState } from '../../shared/types';
import type { ManagedAuthSession } from '../auth/adapter';
import { assertCsrf } from '../auth/csrf';
import { currentManagedAuthSession } from '../auth/session';
import { ContentRepository } from '../content/repository';
import { gradeQuestions, gradeQuiz } from '../content/grading';
import type { Database } from '../db/connection';
import { prismaConnection } from '../db/prisma';
import { StateRepository } from '../db/state-repository';
import { Entitlements } from '../entitlements';
import { HttpError } from '../http-error';
import { assertAccountSession } from './identity';

const activeStatus = ['active'] as const;
const identifier = z.string().min(1).max(200);
const revision = z.number().int().min(0).max(100000);
const progressSchema = z.strictObject({
  key: z.string().trim().min(1).max(100),
  field: z.enum(['read', 'bookmarks']),
  enabled: z.boolean(),
});
const topicSchema = z.strictObject({ topic: z.string().trim().min(1).max(80) });
const answerSchema = z.strictObject({
  questionId: identifier,
  answer: z.number().int().min(-1).max(20),
  revision,
});
const finishSchema = z.strictObject({ revision });
const videoSchema = z.strictObject({ resource: z.string().min(1).max(200) });
const directQuizSchema = z.strictObject({
  topic: z.string().trim().min(1).max(80),
  answers: z.record(identifier, z.number().int().min(-1).max(20)),
});
const targetSchema = z.strictObject({
  company: z.string().trim().min(2).max(80),
  level: z.enum(levels),
  role: z.string().trim().min(2).max(80),
  date: z.string().trim().max(10).optional().default(''),
});
const storySchema = z.strictObject({
  id: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(3).max(120),
  situation: z.string().trim().min(1).max(4000),
  task: z.string().trim().min(1).max(4000),
  action: z.string().trim().min(1).max(6000),
  result: z.string().trim().min(1).max(4000),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional().default([]),
  revision: revision.optional().default(0),
});
const diagramNodeSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
});
const attemptSchema = z.strictObject({
  id: z.string().trim().min(1).max(80).optional(),
  revision: revision.optional().default(0),
  problemId: z.string().min(1).max(200),
  level: z.enum(levels),
  answer: z.string().trim().max(20000).optional().default(''),
  code: z.string().trim().max(40000).optional().default(''),
  nodes: z.array(diagramNodeSchema).max(30).optional().default([]),
  edges: z.array(z.tuple([z.string().trim().min(1).max(80), z.string().trim().min(1).max(80)])).max(60)
    .optional().default([]),
  elapsed: z.number().finite().min(0).max(86400).optional().default(0),
});
const mockSchema = z.strictObject({
  problemId: z.string().min(1).max(200),
  company: z.enum(companies),
  level: z.enum(levels),
  length: z.union([z.literal(3), z.literal(5)]),
});
const mockDraftSchema = z.strictObject({
  revision,
  answer: z.string().trim().max(8000),
});
const customQuizSchema = z.strictObject({
  title: z.string().trim().min(3).max(100),
  topics: z.array(z.string().min(1).max(80)).min(1).max(quizTopics.length),
  mode: z.enum(['all', 'missed']),
  count: z.number().int().min(1).max(20),
});
const customAnswerSchema = z.strictObject({
  revision,
  questionId: identifier,
  answer: z.number().int().min(-1).max(20),
});
const planSchema = z.strictObject({
  company: z.enum(companies),
  level: z.enum(levels),
  weeks: z.union([z.literal(2), z.literal(4)]),
  sessionsPerWeek: z.union([z.literal(3), z.literal(5)]),
  startOn: z.string().length(10),
});
const reflectionSchema = z.strictObject({
  taskId: identifier,
  note: z.string().trim().min(20).max(3000),
  revision,
});

function checked<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, message);
  return parsed.data;
}

async function learningSession(request: Request, mutation: boolean) {
  const session = await currentManagedAuthSession(request);
  if (!session) throw new HttpError(401, 'Sign in to access your saved learning state.');
  if (session.status !== 'active') {
    throw new HttpError(403, 'This account is not available for product access. Contact support.');
  }
  if (mutation) assertCsrf(request, session);
  return session;
}

async function accountOperation<T>(
  request: Request,
  mutation: boolean,
  operation: (db: Database, session: ManagedAuthSession) => Promise<T>,
) {
  const session = await learningSession(request, mutation);
  const db = prismaConnection();
  return db.transaction(async () => {
    await assertAccountSession(db, session, false, activeStatus);
    const result = await operation(db, session);
    await assertAccountSession(db, session, false, activeStatus);
    return result;
  });
}

async function mutateState(
  request: Request,
  capability: Capability | undefined,
  operation: (state: UserState) => void,
) {
  return accountOperation(request, true, async (db, session) => {
    const entitlements = new Entitlements(db);
    if (capability) await entitlements.assert(session.userId, capability);
    const state = await new StateRepository(db).mutate(session.userId, state => {
      operation(state);
      recordActivity(state);
    });
    if (capability) await entitlements.assert(session.userId, capability);
    return state;
  });
}

function recordActivity(state: UserState) {
  const today = new Date().toISOString().slice(0, 10);
  if (!state.activity.includes(today)) state.activity.push(today);
  state.activity = state.activity.slice(-370);
}

export async function updateProgress(request: Request, input: unknown) {
  const value = checked(progressSchema, input, 'Choose an existing lesson or problem and a valid progress change.');
  const [trackId, lessonId, ...extra] = value.key.split('/');
  const item = trackId === 'practice'
    ? problems.find(problem => problem.id === lessonId)
    : getTrack(trackId)?.lessons.find(lesson => lesson.id === lessonId);
  if (!item || extra.length) throw new HttpError(404, 'Lesson or practice problem not found.');
  const capability = item.premium && value.field === 'read' && value.enabled ? 'learning.premium.write' : undefined;
  return mutateState(request, capability, state => {
    const existed = state[value.field].includes(value.key);
    state[value.field] = value.enabled
      ? [...new Set([...state[value.field], value.key])]
      : state[value.field].filter(resource => resource !== value.key);
    if (value.field === 'read' && value.enabled && !existed) state.recognition += 2;
  });
}

function course(id: string) {
  const value = courses.find(candidate => candidate.id === id);
  if (!value) throw new HttpError(404, 'Course not found.');
  return value;
}

export async function enrollCourse(request: Request, id: string, input: unknown) {
  checked(z.strictObject({}), input, 'Use an empty request body to enroll in a course.');
  const value = course(id);
  return mutateState(request, value.premium ? 'learning.premium.write' : undefined, state => {
    if (!state.enrollments.includes(value.id)) state.enrollments.push(value.id);
  });
}

export async function saveCourseVideo(request: Request, id: string, input: unknown) {
  const value = course(id);
  const body = checked(videoSchema, input, 'Choose a video from this course.');
  if (!value.units.flatMap(unit => unit.steps).some(step => step.type === 'video' && step.resource === body.resource)) {
    throw new HttpError(404, 'Course video not found.');
  }
  return mutateState(request, value.premium ? 'learning.premium.write' : undefined, state => {
    if (!state.enrollments.includes(value.id)) {
      throw new HttpError(400, 'Enroll in this course before saving video progress.');
    }
    if (!state.watched.includes(body.resource)) state.watched.push(body.resource);
  });
}

export async function issueCourseCertificate(request: Request, id: string, input: unknown) {
  checked(z.strictObject({}), input, 'Use an empty request body to issue a completion record.');
  const value = course(id);
  return mutateState(request, value.premium ? 'learning.premium.write' : undefined, state => {
    const progress = courseCompletion(value, state);
    if (!state.enrollments.includes(value.id) || progress.complete !== progress.total) {
      throw new HttpError(400, 'Complete every course step before issuing a local completion certificate.');
    }
    if (!state.certificates.some(certificate => certificate.courseId === value.id)) {
      state.certificates.push({ id: randomUUID(), courseId: value.id, issuedAt: new Date().toISOString() });
    }
  });
}

export async function createTarget(request: Request, input: unknown) {
  const value = checked(targetSchema, input, 'Provide a company, interview level, role and optional valid date.');
  const parsedDate = Date.parse(`${value.date}T00:00:00.000Z`);
  if (value.date && (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== value.date)) {
    throw new HttpError(400, 'Enter a valid interview date.');
  }
  return mutateState(request, undefined, state => {
    if (state.targets.length >= 20) throw new HttpError(400, 'You can save up to 20 target interviews.');
    state.targets.push({ id: randomUUID(), ...value });
  });
}

export async function deleteTarget(request: Request, id: string) {
  const targetId = checked(identifier, id, 'Invalid target.');
  return mutateState(request, undefined, state => {
    if (!state.targets.some(target => target.id === targetId)) throw new HttpError(404, 'Target not found.');
    state.targets = state.targets.filter(target => target.id !== targetId);
  });
}

export async function saveStory(request: Request, input: unknown) {
  const value = checked(storySchema, input, 'Provide a bounded story title, STAR fields, tags and saved revision.');
  const id = value.id ?? randomUUID();
  return mutateState(request, undefined, state => {
    const index = state.stories.findIndex(story => story.id === id);
    if (value.id && index < 0) throw new HttpError(404, 'Story not found.');
    if (index >= 0) {
      const savedRevision = state.stories[index].revision ?? 0;
      if (value.revision !== savedRevision) {
        throw new HttpError(409, 'This story changed. Your edits are still in the editor; reload the saved version before replacing it.');
      }
      state.stories[index] = {
        id,
        title: value.title,
        situation: value.situation,
        task: value.task,
        action: value.action,
        result: value.result,
        tags: value.tags,
        revision: savedRevision + 1,
      };
      return;
    }
    if (state.stories.length >= 100) throw new HttpError(400, 'Your story bank has reached its limit.');
    state.stories.push({
      id,
      title: value.title,
      situation: value.situation,
      task: value.task,
      action: value.action,
      result: value.result,
      tags: value.tags,
      revision: 0,
    });
  });
}

export async function deleteStory(request: Request, id: string) {
  const storyId = checked(z.string().min(1).max(80), id, 'Invalid story.');
  return mutateState(request, undefined, state => {
    if (!state.stories.some(story => story.id === storyId)) throw new HttpError(404, 'Story not found.');
    state.stories = state.stories.filter(story => story.id !== storyId);
  });
}

export async function saveAttempt(request: Request, input: unknown) {
  const value = checked(attemptSchema, input, 'Provide a bounded practice draft, diagram and saved revision.');
  const problem = problems.find(candidate => candidate.id === value.problemId);
  if (!problem) throw new HttpError(404, 'Practice problem not found.');
  if (new Set(value.nodes.map(node => node.id)).size !== value.nodes.length) {
    throw new HttpError(400, 'Diagram node IDs must be unique.');
  }
  const nodeIds = new Set(value.nodes.map(node => node.id));
  if (value.edges.some(([from, to]) => from === to || !nodeIds.has(from) || !nodeIds.has(to))) {
    throw new HttpError(400, 'An edge must connect two existing nodes.');
  }
  const id = value.id ?? randomUUID();
  const draft: Attempt = {
    id,
    problemId: problem.id,
    level: value.level,
    answer: value.answer,
    code: value.code,
    nodes: value.nodes,
    edges: value.edges,
    completed: false,
    updatedAt: new Date().toISOString(),
    elapsed: value.elapsed,
    revision: 0,
  };
  const state = await mutateState(request, problem.premium ? 'practice.premium.create' : undefined, current => {
    const index = current.attempts.findIndex(attempt => attempt.id === id);
    if (value.id && index < 0) throw new HttpError(404, 'Attempt not found.');
    if (index >= 0) {
      const previous = current.attempts[index];
      if (previous.problemId !== problem.id) {
        throw new HttpError(400, 'An existing attempt cannot move to another practice problem.');
      }
      const savedRevision = previous.revision ?? 0;
      if (value.revision !== savedRevision) {
        throw new HttpError(409, 'This draft changed. Your edits are still in the workspace; reload the saved version before replacing it.');
      }
      const changed = previous.answer !== draft.answer
        || previous.code !== draft.code
        || previous.level !== draft.level
        || JSON.stringify(previous.nodes) !== JSON.stringify(draft.nodes)
        || JSON.stringify(previous.edges) !== JSON.stringify(draft.edges);
      current.attempts[index] = {
        ...draft,
        feedback: changed ? undefined : previous.feedback,
        completed: !changed && previous.completed,
        revision: savedRevision + 1,
      };
      return;
    }
    if (current.attempts.length >= 500) throw new HttpError(400, 'Your practice history has reached its limit.');
    current.attempts.unshift(draft);
  });
  return { state, attempt: state.attempts.find(attempt => attempt.id === id)! };
}

export async function evaluateAttempt(request: Request, id: string, input: unknown) {
  checked(z.strictObject({}), input, 'Use an empty request body to evaluate the saved practice draft.');
  const attemptId = checked(z.string().min(1).max(80), id, 'Invalid attempt.');
  return accountOperation(request, true, async (db, session) => {
    const states = new StateRepository(db);
    const current = await states.read(session.userId);
    const attempt = current.attempts.find(candidate => candidate.id === attemptId);
    if (!attempt) throw new HttpError(404, 'Attempt not found.');
    const problem = problems.find(candidate => candidate.id === attempt.problemId);
    if (!problem) throw new Error('The saved practice problem is unavailable.');
    const entitlements = new Entitlements(db);
    if (problem.premium) await entitlements.assert(session.userId, 'practice.premium.create');
    const answer = [attempt.answer, attempt.code, attempt.nodes.map(node => node.label).join(', ')].join('\n');
    if (answer.trim().length < 30) {
      throw new HttpError(400, 'Add at least 30 characters of explanation or code before requesting feedback.');
    }
    const feedback = assessAnswer(problem, answer);
    const state = await states.mutate(session.userId, savedState => {
      const saved = savedState.attempts.find(candidate => candidate.id === attempt.id);
      if (!saved || JSON.stringify(saved) !== JSON.stringify(attempt)) {
        throw new HttpError(409, 'Your attempt changed while grading. Request feedback again for the saved version.');
      }
      if (!saved.completed) savedState.recognition += 5;
      saved.feedback = feedback;
      saved.completed = true;
      saved.revision = (saved.revision ?? 0) + 1;
      recordActivity(savedState);
    });
    if (problem.premium) await entitlements.assert(session.userId, 'practice.premium.create');
    return state;
  });
}

export async function createMock(request: Request, input: unknown) {
  const value = checked(mockSchema, input, 'Choose a known problem, company, level and three or five interview turns.');
  const problem = problems.find(candidate => candidate.id === value.problemId);
  if (!problem) throw new HttpError(404, 'Practice problem not found.');
  const session: MockSession = {
    id: randomUUID(),
    problemId: problem.id,
    company: value.company,
    level: value.level,
    length: value.length,
    question: `${problem.description} ${problem.track === 'behavioral'
      ? 'Explain your own actions and the outcome.'
      : 'Start with the requirements, then walk through one concrete example.'}`,
    focus: -1,
    draft: '',
    revision: 0,
    turns: [],
    createdAt: new Date().toISOString(),
  };
  const state = await mutateState(request, 'mock.create', current => {
    if (current.mocks.length >= 100) throw new HttpError(400, 'Your mock interview archive has reached its limit.');
    current.mocks.unshift(session);
  });
  return { state, session };
}

export async function saveMockDraft(request: Request, id: string, input: unknown) {
  const mockId = checked(identifier, id, 'Invalid mock interview.');
  const value = checked(mockDraftSchema, input, 'Provide the saved revision and a bounded interview answer.');
  return mutateState(request, 'mock.create', state => {
    const session = state.mocks.find(mock => mock.id === mockId);
    if (!session) throw new HttpError(404, 'Interview not found.');
    if (session.completedAt || session.revision !== value.revision) {
      throw new HttpError(409, 'This interview changed. Reload the saved session before editing.');
    }
    session.draft = value.answer;
    session.revision += 1;
  });
}

export async function respondToMock(request: Request, id: string, input: unknown) {
  const mockId = checked(identifier, id, 'Invalid mock interview.');
  const value = checked(finishSchema, input, 'Provide the saved interview revision.');
  return mutateState(request, 'mock.create', state => {
    const session = state.mocks.find(mock => mock.id === mockId);
    if (!session) throw new HttpError(404, 'Interview not found.');
    if (session.completedAt || session.revision !== value.revision) {
      throw new HttpError(409, 'This interview changed. Reload before continuing.');
    }
    if (session.draft.trim().length < 30) {
      throw new HttpError(400, 'Save at least 30 characters before submitting an interview answer.');
    }
    const problem = problems.find(candidate => candidate.id === session.problemId);
    if (!problem) throw new Error('The saved mock interview problem is unavailable.');
    const feedback = assessAnswer(mockTurnProblem(problem, session), session.draft);
    session.turns.push({
      question: session.question,
      focus: session.focus,
      answer: session.draft,
      feedback,
    });
    session.draft = '';
    session.revision += 1;
    if (session.turns.length === session.length) {
      session.completedAt = new Date().toISOString();
      state.recognition += 10;
    } else {
      Object.assign(session, nextMockQuestion(problem, session));
    }
  });
}

export async function createCustomQuiz(request: Request, input: unknown) {
  const value = checked(customQuizSchema, input, 'Choose a title, distinct known topics, question pool and bounded count.');
  if (new Set(value.topics).size !== value.topics.length
    || value.topics.some(topic => !quizTopics.some(candidate => candidate.id === topic))) {
    throw new HttpError(400, 'Choose at least one distinct known quiz topic.');
  }
  return accountOperation(request, true, async (db, session) => {
    const entitlements = new Entitlements(db);
    await entitlements.assert(session.userId, 'quiz.custom.create');
    const states = new StateRepository(db);
    const previous = await states.read(session.userId);
    const pool = customQuestionPool(value.topics, value.mode, previous);
    if (value.count > pool.length) {
      throw new HttpError(400, `Only ${pool.length} questions match. Choose fewer questions or broaden the selection.`);
    }
    const questionIds = chooseQuestions(pool.map(question => question.id), value.count);
    const content = new ContentRepository(db);
    const contentVersion = await content.pin(questionIds.map(id => quizQuestions.find(question => question.id === id)!));
    const quiz = {
      id: randomUUID(),
      title: value.title,
      topics: value.topics,
      mode: value.mode,
      questionIds,
      answers: {},
      revision: 0,
      createdAt: new Date().toISOString(),
      contentVersion,
    };
    const state = await states.mutate(session.userId, current => {
      if (current.customQuizzes.length >= 100) {
        throw new HttpError(400, 'Your custom quiz archive has reached its limit.');
      }
      current.customQuizzes.unshift(quiz);
      recordActivity(current);
    });
    await entitlements.assert(session.userId, 'quiz.custom.create');
    return { state, quiz };
  });
}

export async function customQuizQuestion(request: Request, id: string) {
  const quizId = checked(identifier, id, 'Invalid custom quiz.');
  return accountOperation(request, false, async (db, session) => {
    const saved = (await new StateRepository(db).read(session.userId)).customQuizzes.find(quiz => quiz.id === quizId);
    if (!saved) throw new HttpError(404, 'Custom quiz not found.');
    const content = new ContentRepository(db);
    const questions = await content.questions(saved.contentVersion, saved.questionIds);
    const question = questions.find(candidate => !Object.hasOwn(saved.answers, candidate.id));
    return question ? content.prompt(question) : null;
  });
}

export async function answerCustomQuiz(request: Request, id: string, input: unknown) {
  const quizId = checked(identifier, id, 'Invalid custom quiz.');
  const value = checked(customAnswerSchema, input, 'Answer the next saved custom-quiz question with its revision.');
  return accountOperation(request, true, async (db, session) => {
    const entitlements = new Entitlements(db);
    await entitlements.assert(session.userId, 'quiz.custom.create');
    const states = new StateRepository(db);
    const saved = (await states.read(session.userId)).customQuizzes.find(quiz => quiz.id === quizId);
    if (!saved) throw new HttpError(404, 'Custom quiz not found.');
    const content = new ContentRepository(db);
    const questions = await content.questions(saved.contentVersion, saved.questionIds);
    const contentVersion = saved.contentVersion ?? await content.pin(questions);
    let feedback: QuizQuestion | undefined;
    const state = await states.mutate(session.userId, current => {
      const quiz = current.customQuizzes.find(candidate => candidate.id === quizId);
      if (!quiz) throw new HttpError(404, 'Custom quiz not found.');
      if (quiz.completedAt || quiz.revision !== value.revision) {
        throw new HttpError(409, 'This quiz changed. Reload the saved session.');
      }
      const next = quiz.questionIds.find(questionId => !Object.hasOwn(quiz.answers, questionId));
      if (value.questionId !== next) throw new HttpError(400, 'Answer the next question in this saved quiz.');
      const question = questions.find(candidate => candidate.id === next);
      if (!question || value.answer >= question.options.length) throw new HttpError(400, 'Invalid answer choice.');
      quiz.answers[question.id] = value.answer;
      quiz.contentVersion = contentVersion;
      quiz.revision += 1;
      feedback = question;
      recordActivity(current);
    });
    await entitlements.assert(session.userId, 'quiz.custom.create');
    if (!feedback) throw new Error('A saved custom quiz answer is missing its feedback.');
    return { state, feedback };
  });
}

export async function finishCustomQuiz(request: Request, id: string, input: unknown) {
  const quizId = checked(identifier, id, 'Invalid custom quiz.');
  const value = checked(finishSchema, input, 'Provide the saved custom-quiz revision.');
  return accountOperation(request, true, async (db, session) => {
    const entitlements = new Entitlements(db);
    await entitlements.assert(session.userId, 'quiz.custom.create');
    const states = new StateRepository(db);
    const saved = (await states.read(session.userId)).customQuizzes.find(quiz => quiz.id === quizId);
    if (!saved) throw new HttpError(404, 'Custom quiz not found.');
    const questions = await new ContentRepository(db).questions(saved.contentVersion, saved.questionIds);
    const state = await states.mutate(session.userId, current => {
      const quiz = current.customQuizzes.find(candidate => candidate.id === quizId);
      if (!quiz) throw new HttpError(404, 'Custom quiz not found.');
      if (quiz.completedAt) return;
      if (quiz.revision !== value.revision) throw new HttpError(409, 'This quiz changed. Reload the saved session.');
      if (quiz.questionIds.some(questionId => !Object.hasOwn(quiz.answers, questionId))) {
        throw new HttpError(400, 'Answer or skip every question before finishing.');
      }
      const result = gradeQuestions(questions, quiz.answers);
      quiz.completedAt = new Date().toISOString();
      quiz.score = result.score;
      quiz.revision += 1;
      current.review = [...new Set([
        ...current.review.filter(questionId => !quiz.questionIds.includes(questionId)),
        ...result.missed,
      ])];
      current.recognition += result.score;
      recordActivity(current);
    });
    await entitlements.assert(session.userId, 'quiz.custom.create');
    return state;
  });
}

export async function createStudyPlan(request: Request, input: unknown) {
  const value = checked(planSchema, input, 'Choose a company, level, supported duration, pace and valid start date.');
  return accountOperation(request, true, async (db, session) => {
    const entitlements = new Entitlements(db);
    await entitlements.assert(session.userId, 'plan.create');
    const states = new StateRepository(db);
    const previous = await states.read(session.userId);
    let tasks;
    try {
      tasks = makePlanTasks(value.company, value.level, value.weeks, value.sessionsPerWeek, value.startOn, previous);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid preparation schedule.');
    }
    const plan = {
      id: randomUUID(),
      company: value.company,
      level: value.level,
      weeks: value.weeks,
      sessionsPerWeek: value.sessionsPerWeek,
      tasks,
      createdAt: new Date().toISOString(),
      revision: 0,
    };
    const state = await states.mutate(session.userId, current => {
      if (current.studyPlans.length >= 20) throw new HttpError(400, 'Your study plan archive has reached its limit.');
      current.studyPlans.unshift(plan);
      recordActivity(current);
    });
    await entitlements.assert(session.userId, 'plan.create');
    return { state, plan };
  });
}

export async function savePlanReflection(request: Request, id: string, input: unknown) {
  const planId = checked(identifier, id, 'Invalid study plan.');
  const value = checked(reflectionSchema, input, 'Provide a saved reflection task, note and plan revision.');
  return mutateState(request, 'plan.create', state => {
    const plan = state.studyPlans.find(candidate => candidate.id === planId);
    const task = plan?.tasks.find(candidate => candidate.id === value.taskId && candidate.kind === 'reflection');
    if (!task || !plan) throw new HttpError(404, 'Plan reflection not found.');
    if (value.revision !== (plan.revision ?? 0)) {
      throw new HttpError(409, 'This study plan changed. Your reflection is still in the editor; reload the saved plan before replacing it.');
    }
    task.note = value.note;
    plan.revision = (plan.revision ?? 0) + 1;
  });
}

function quizTopic(value: string) {
  if (value !== 'review' && !quizTopics.some(topic => topic.id === value)) throw new HttpError(404, 'Quiz not found.');
  return value;
}

export async function createQuizSession(request: Request, input: unknown) {
  const { topic } = checked(topicSchema, input, 'Choose a valid quiz topic.');
  quizTopic(topic);
  return accountOperation(request, true, async (db, session) => {
    const content = new ContentRepository(db);
    await content.lockOwner(session.userId);
    const state = await new StateRepository(db).read(session.userId);
    const questions = quizQuestions.filter(question => topic === 'review'
      ? state.review.includes(question.id)
      : question.topic === topic);
    if (!questions.length) throw new HttpError(400, 'There are no questions in this review deck.');
    return content.createSession(session.userId, topic, questions);
  });
}

export async function listQuizSessions(request: Request) {
  return accountOperation(request, false, async (db, session) =>
    db.prepare(`SELECT id,topic FROM assessment_sessions
      WHERE user_id=? AND completed_at IS NULL ORDER BY id LIMIT 50`).all(session.userId));
}

export async function quizSession(request: Request, id: string) {
  const sessionId = checked(identifier, id, 'Invalid quiz session.');
  return accountOperation(request, false,
    (db, session) => new ContentRepository(db).sessionView(session.userId, sessionId));
}

export async function answerQuizSession(request: Request, id: string, input: unknown) {
  const sessionId = checked(identifier, id, 'Invalid quiz session.');
  const body = checked(answerSchema, input, 'Choose the current question, answer and saved revision.');
  return accountOperation(request, true, (db, session) =>
    new ContentRepository(db).answerSession(session.userId, sessionId, body.questionId, body.answer, body.revision));
}

export async function finishQuizSession(request: Request, id: string, input: unknown) {
  const sessionId = checked(identifier, id, 'Invalid quiz session.');
  const body = checked(finishSchema, input, 'Provide the saved quiz revision.');
  return accountOperation(request, true, async (db, session) => {
    const content = new ContentRepository(db);
    await content.lockOwner(session.userId);
    const completed = await content.finishSession(session.userId, sessionId, body.revision);
    if (!completed.newlyCompleted) return new StateRepository(db).read(session.userId);
    return new StateRepository(db).mutate(session.userId, state => {
      if (state.quizzes.some(quiz => quiz.id === completed.session.id)) return;
      const result = gradeQuestions(completed.session.questions, completed.session.answers);
      state.quizzes.unshift({
        id: completed.session.id,
        topic: completed.session.topic,
        answers: completed.session.answers,
        score: result.score,
        total: result.total,
        completedAt: completed.session.completedAt!,
        contentVersion: completed.session.contentVersion,
        questionIds: completed.session.questions.map(question => question.id),
      });
      state.quizzes = state.quizzes.slice(0, 500);
      state.review = [...new Set([
        ...state.review.filter(id => !Object.hasOwn(completed.session.answers, id)),
        ...result.missed,
      ])];
      state.recognition += result.score;
      recordActivity(state);
    });
  });
}

export async function quizReport(request: Request, id: string) {
  const reportId = checked(identifier, id, 'Invalid quiz report.');
  return accountOperation(request, false, async (db, session) => {
    const state = await new StateRepository(db).read(session.userId);
    const quiz = state.quizzes.find(value => value.id === reportId)
      ?? state.customQuizzes.find(value => value.id === reportId && value.completedAt);
    if (!quiz) throw new HttpError(404, 'Quiz report not found.');
    if (quiz.score === undefined) {
      throw new HttpError(409, 'This report is missing its saved score. Its original answers remain in your account export.');
    }
    return new ContentRepository(db).report(
      quiz.id,
      quiz.answers,
      quiz.contentVersion,
      quiz.questionIds ?? Object.keys(quiz.answers),
      quiz.score,
    );
  });
}

export async function submitQuiz(request: Request, input: unknown) {
  const body = checked(directQuizSchema, input, 'Choose a valid quiz topic and bounded answer choices.');
  quizTopic(body.topic);
  return accountOperation(request, true, async (db, session) => {
    const states = new StateRepository(db);
    const current = await states.read(session.userId);
    if (body.topic === 'review' && Object.keys(body.answers).some(id => !current.review.includes(id))) {
      throw new HttpError(400, 'Question is not in your review deck.');
    }
    let result: ReturnType<typeof gradeQuiz>;
    try {
      result = gradeQuiz(body.topic, body.answers);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid quiz submission.');
    }
    const savedAnswers = Object.fromEntries(quizQuestions
      .filter(question => body.topic === 'review'
        ? Object.hasOwn(body.answers, question.id)
        : question.topic === body.topic)
      .map(question => [question.id, body.answers[question.id] ?? -1]));
    const contentVersion = await new ContentRepository(db).pin(
      quizQuestions.filter(question => Object.hasOwn(savedAnswers, question.id)),
    );
    return states.mutate(session.userId, state => {
      state.quizzes.unshift({
        id: randomUUID(),
        topic: body.topic,
        answers: savedAnswers,
        score: result.score,
        total: result.total,
        completedAt: new Date().toISOString(),
        contentVersion,
        questionIds: Object.keys(savedAnswers),
      });
      state.quizzes = state.quizzes.slice(0, 500);
      const answered = new Set(Object.keys(body.answers));
      state.review = [...new Set([...state.review.filter(id => !answered.has(id)), ...result.missed])];
      state.recognition += result.score;
      recordActivity(state);
    });
  });
}
