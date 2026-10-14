import { getTrack, problems } from '../../shared/catalog';
import { courses } from '../../shared/courses';
import { currentAuthUser } from '../auth/session';
import { ContentRepository } from '../content/repository';
import { prismaConnection } from '../db/prisma';
import { StateRepository } from '../db/state-repository';
import { Entitlements } from '../entitlements';
import { HttpError } from '../http-error';
import { digest, encodePayload } from '../jobs/schema';

const db = () => prismaConnection();

async function authorizePremium(request: Request, premium: boolean | undefined) {
  if (!premium) return;
  const user = await currentAuthUser(request);
  if (!user) throw new HttpError(401, 'Sign in to read premium content.');
  await new Entitlements(db()).assert(user.id, 'content.premium.read');
}

export async function lessonContent(request: Request, track: string, id: string) {
  const lesson = getTrack(track)?.lessons.find(value => value.id === id);
  if (!lesson) throw new HttpError(404, 'Lesson not found.');
  await authorizePremium(request, lesson.premium);
  return { value: lesson, version: new ContentRepository(db()).version(lesson) };
}

export async function problemContent(request: Request, id: string, projectId: string | null) {
  const user = projectId ? await currentAuthUser(request) : null;
  if (projectId && (!user || user.identity?.status !== 'active')) throw new HttpError(401, 'Sign in to open this saved project.');
  const state = user ? await new StateRepository(db()).read(user.id) : null;
  const ownedProject = projectId ? state?.projects.find(project => project.id === projectId && project.problemId === id) : undefined;
  if (projectId && !ownedProject) throw new HttpError(404, 'Project not found.');
  if (ownedProject?.brief || ownedProject?.briefVersion) {
    if (!ownedProject.brief || !ownedProject.briefVersion || ownedProject.brief.id !== ownedProject.problemId ||
      digest(encodePayload(ownedProject.brief)) !== ownedProject.briefVersion) {
      throw new Error('The saved project task snapshot is inconsistent.');
    }
    return { value: ownedProject.brief, version: ownedProject.briefVersion };
  }
  const problem = problems.find(value => value.id === id);
  if (!problem) throw new HttpError(404, 'Problem not found.');
  if (ownedProject && problem.premium && user && !await new Entitlements(db()).allows(user.id, 'content.premium.read')) {
    throw new HttpError(409, 'The original task was not pinned for this legacy project. Saved files, feedback and patches remain exportable; current premium content requires current access.');
  }
  await authorizePremium(request, problem.premium);
  const { keywords: _keywords, workedCase: _case, solution: _solution, ...brief } = problem;
  return { value: brief, version: new ContentRepository(db()).version(brief) };
}

export async function referenceContent(request: Request, id: string) {
  const problem = problems.find(value => value.id === id);
  if (!problem || !problem.workedCase && !problem.solution) throw new HttpError(404, 'Reference not found.');
  await authorizePremium(request, problem.premium);
  const { keywords: _keywords, ...reference } = problem;
  return { value: reference, version: new ContentRepository(db()).version(reference) };
}

export async function mediaContent(request: Request, courseId: string, file: string) {
  const course = courses.find(value => value.id === courseId);
  const video = course?.units.flatMap(unit => unit.steps)
    .find(step => step.type === 'video' && [`${step.resource}.webm`, `${step.resource}.vtt`].includes(file));
  if (!course || !video) throw new HttpError(404, 'Video not found.');
  await authorizePremium(request, course.premium);
  return { premium: course.premium, file };
}
