import type { LearningFlow, LessonLab, UnderstandingCheck, VisualLabKind } from '../types';
import type { SourceId } from './sources';

export interface LessonActivity {
  scenario: string;
  steps: [string, string][];
  question: [prompt: string, options: [string, string, string], explanation: string];
  lab?: LessonLab;
  visualization?: VisualLabKind;
  quizTopic?: string;
  sourceIds?: SourceId[];
}

export function activity(scenario: string, steps: LessonActivity['steps'], question: LessonActivity['question'], lab?: LessonLab): LessonActivity {
  return { scenario, steps, question, lab };
}

export function authoredFlow(title: string, item: LessonActivity): LearningFlow {
  return { title: `${title}: decision trace`, summary: item.scenario, steps: item.steps.map(([title, detail], index) => ({ id: `decision-${index + 1}`, title, detail })) };
}

export function authoredCheck(key: string, item: LessonActivity): UnderstandingCheck {
  const correct = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3;
  const [prompt, original, explanation] = item.question;
  const options = original.map((_, index) => original[(index - correct + original.length) % original.length]);
  return { id: `check-${key}`, prompt, options, correct, explanation };
}
