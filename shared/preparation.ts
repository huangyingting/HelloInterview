import { courses, problems, tracks } from './public-catalog';
import { courseStepComplete } from './domain';
import type { UserState } from './types';

export function nextPreparationStep(state: UserState) {
  const draft = [...state.attempts].filter(attempt => !attempt.completed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find(attempt => problems.some(problem => problem.id === attempt.problemId));
  if (draft) {
    const problem = problems.find(problem => problem.id === draft.problemId)!;
    return { label: 'CONTINUE YOUR DRAFT', title: problem.title,
      description: 'Your saved answer, code, and diagram are ready where you left them.',
      to: `/practice/${problem.track}/${problem.id}?attempt=${encodeURIComponent(draft.id)}`, action: 'Resume practice', kind: 'practice' };
  }
  for (const id of state.enrollments) {
    const course = courses.find(item => item.id === id);
    const step = course?.units.flatMap(unit => unit.steps).find(item => !courseStepComplete(item, state));
    if (course && step) return { label: 'NEXT IN YOUR COURSE', title: step.title, description: course.title,
      to: step.to, action: 'Continue course', kind: 'course' };
  }
  const started = tracks.find(track => track.lessons.some(lesson => state.read.includes(`${track.id}/${lesson.id}`))
    && track.lessons.some(lesson => !state.read.includes(`${track.id}/${lesson.id}`)));
  const track = started ?? tracks.find(item => item.lessons.some(lesson => !state.read.includes(`${item.id}/${lesson.id}`)));
  const lesson = track?.lessons.find(item => !state.read.includes(`${track.id}/${item.id}`));
  const hasReadLessons = tracks.some(item => item.lessons.some(lesson => state.read.includes(`${item.id}/${lesson.id}`)));
  if (track && lesson) return { label: started ? 'CONTINUE LEARNING' : hasReadLessons ? 'EXPLORE ANOTHER TRACK' : 'YOUR FIRST GOOD STEP', title: lesson.title,
    description: `${track.title} / ${lesson.minutes} min read`, to: `/learn/${track.id}/${lesson.id}`,
    action: started ? 'Continue lesson' : 'Start learning', kind: 'lesson' };
  return { label: 'PUT YOUR KNOWLEDGE TO WORK', title: 'Choose your next challenge.',
    description: 'Explore original exercises and put your reasoning into practice.', to: '/practice', action: 'Explore practice', kind: 'practice' };
}
