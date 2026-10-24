import type { Lesson, Track } from '../types';
import { authoredCheck, authoredFlow, type LessonActivity } from './activity-authoring';
import { systemDesignActivities } from './system-design-activities';
import { codingActivities } from './coding-activities';
import { designActivities } from './design-activities';
import { mlActivities } from './ml-activities';
import { practicalActivities } from './practical-activities';
import { dojoLessons } from './dojo-lessons';
import { dojoQuestions } from './dojo-questions';

function scoped(track: string, items: Record<string, LessonActivity>) {
  return Object.fromEntries(Object.entries(items).map(([id, item]) => [`${track}/${id}`, item]));
}
const dojoActivities = Object.fromEntries(dojoLessons.map(lesson => {
  const flow = lesson.sections.find(section => section.flow)!.flow!;
  const question = dojoQuestions.find(question => question.topic === lesson.id)!;
  const distractors = question.options.filter((_, index) => index !== question.correct);
  const item: LessonActivity = {
    scenario: flow.summary, steps: flow.steps.map(step => [step.title, step.detail]),
    question: [question.prompt, [question.options[question.correct], distractors[0], distractors[1]], question.explanation],
    ...(lesson.id === 'structured-proposals' ? { lab: { kind: 'versioned-write' } as const } : {}),
  };
  return [`ml-system-design/${lesson.id}`, item];
}));
export const lessonActivities: Record<string, LessonActivity> = {
  ...scoped('system-design', systemDesignActivities),
  ...scoped('code', codingActivities),
  ...scoped('low-level-design', designActivities),
  ...scoped('ml-system-design', mlActivities),
  ...practicalActivities, ...dojoActivities,
};

export function withLearningActivities(track: Track): Track {
  return { ...track, lessons: track.lessons.map((lesson): Lesson => {
    const key = `${track.id}/${lesson.id}`, item = lessonActivities[key];
    if (!item) throw new Error(`Missing authored learning activities: ${key}`);
    const hasFlow = lesson.sections.some(section => section.flow);
    const hasLab = lesson.sections.some(section => section.visualization || section.lab);
    return {
      ...lesson, quizTopic: lesson.quizTopic ?? item.quizTopic,
      sourceIds: [...new Set([...(lesson.sourceIds ?? []), ...(item.sourceIds ?? [])])],
      sections: lesson.sections.map((section, index) => ({
        ...section,
        ...(!hasFlow && index === 0 ? { flow: authoredFlow(lesson.title, item) } : {}),
        ...(index === lesson.sections.length - 1 ? {
          check: authoredCheck(key, item),
          ...(!hasLab && item.lab ? { lab: item.lab } : {}),
          ...(!hasLab && item.visualization ? { visualization: item.visualization } : {}),
        } : {}),
      })),
    };
  }) };
}
