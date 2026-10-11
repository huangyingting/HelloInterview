import type { SourceId } from './content/sources';

export type TrackId = 'system-design' | 'code' | 'low-level-design' | 'behavioral' | 'ai-coding' | 'ml-system-design' | 'salary-negotiation';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Level = 'Junior' | 'Mid-level' | 'Senior' | 'Staff' | 'Manager';
export type CommunityKind = 'questions' | 'stories' | 'submissions' | 'discussion';

export interface ContentSection {
  title: string;
  body: string;
  bullets?: string[];
  code?: string;
  diagram?: string;
}
export interface Lesson {
  id: string;
  title: string;
  group: string;
  minutes: number;
  summary: string;
  sections: ContentSection[];
  exercise: string;
  premium?: boolean;
  objectives?: string[];
  sourceIds?: SourceId[];
  relatedProblemIds?: string[];
  quizTopic?: string;
}
export interface WorkedCase {
  problemId: string;
  summary: string;
  assumptions: string[];
  diagram: string;
  calculations: { label: string; factors: number[]; divisor: number; result: number; unit: string; assumption: string }[];
  sections: ContentSection[];
  followUps: { question: string; answer: string }[];
  lessonIds: string[];
  sourceIds: SourceId[];
}
export interface ExampleCase {
  input: unknown;
  expected: unknown;
  label: string;
}
export interface WorkedSolution {
  sections: ContentSection[];
  code: string;
  timeComplexity: string;
  spaceComplexity: string;
  lessonIds: string[];
  sourceIds: SourceId[];
  examples?: ExampleCase[];
}
export interface Track {
  id: TrackId;
  title: string;
  short: string;
  description: string;
  color: string;
  lessons: Lesson[];
}
export interface Problem {
  id: string;
  track: string;
  title: string;
  difficulty: Difficulty;
  description: string;
  requirements: string[];
  keywords: string[][];
  starter?: string;
  testCases?: ExampleCase[];
  premium?: boolean;
  workedCase?: WorkedCase;
  solution?: WorkedSolution;
}
export interface QuizQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  difficulty?: Difficulty;
  sourceIds?: string[];
  sources?: SourceReference[];
}
export interface SourceReference {
  id:string;
  title:string;
  publisher:string;
  url:string;
  researchDate:string;
}
export type LessonMetadata = Omit<Lesson, 'sections' | 'exercise'>;
export type TrackMetadata = Omit<Track, 'lessons'> & { lessons: LessonMetadata[] };
export interface ProblemMetadata {
  id: string;
  track: string;
  title: string;
  difficulty: Difficulty;
  description: string;
  premium?: boolean;
  hasWorkedCase: boolean;
  hasSolution: boolean;
  exampleCount: number;
  runnable: boolean;
  caseSummary: string;
  calculationCount: number;
}
export type PracticeProblem = Omit<Problem, 'keywords' | 'workedCase' | 'solution'>;
export type QuestionPrompt = Omit<QuizQuestion, 'correct' | 'explanation'>;
export interface QuizSessionView {
  id: string;
  topic: string;
  customId: string | null;
  revision: number;
  total: number;
  answered: number;
  question: QuestionPrompt | null;
  completedAt: string | null;
  contentVersion: string;
}
export interface QuizReport {
  id: string;
  questions: QuizQuestion[];
  answers: Record<string, number>;
  score: number;
  total: number;
  contentVersion: string;
  provenance: 'versioned' | 'legacy-unversioned';
}
export interface Feedback {
  score: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  source: 'rubric' | 'ai';
}
export interface User {
  id: string;
  name: string;
  email: string;
  demo: boolean;
}
export interface Target {
  id: string;
  company: string;
  level: Level;
  role: string;
  date: string;
}
export interface Story {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  tags: string[];
  revision?: number;
}
export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
}
export interface Attempt {
  id: string;
  problemId: string;
  level: Level;
  answer: string;
  code: string;
  nodes: DiagramNode[];
  edges: [string, string][];
  feedback?: Feedback;
  completed: boolean;
  updatedAt: string;
  elapsed: number;
  revision?: number;
}
export interface QuizAttempt {
  id: string;
  topic: string;
  answers: Record<string, number>;
  score: number;
  total: number;
  completedAt: string;
  contentVersion?: string;
  questionIds?: string[];
}
export interface MockTurn {
  question: string;
  focus: number;
  answer: string;
  feedback: Feedback;
}
export interface MockSession {
  id: string;
  problemId: string;
  company: string;
  level: Level;
  length: number;
  question: string;
  focus: number;
  draft: string;
  revision: number;
  turns: MockTurn[];
  createdAt: string;
  completedAt?: string;
}
export interface CustomQuiz {
  id: string;
  title: string;
  topics: string[];
  mode: 'all' | 'missed';
  questionIds: string[];
  answers: Record<string, number>;
  revision: number;
  createdAt: string;
  completedAt?: string;
  score?: number;
  contentVersion?: string;
}
export interface PlanTask {
  id: string;
  day: string;
  title: string;
  kind: 'lesson' | 'quiz' | 'practice' | 'mock' | 'reflection';
  resource: string;
  to: string;
  note?: string;
}
export interface StudyPlan {
  id: string;
  company: string;
  level: Level;
  weeks: number;
  sessionsPerWeek: number;
  tasks: PlanTask[];
  createdAt: string;
  revision?: number;
}
export interface ProjectFile {
  path: string;
  original: string | null;
  content: string | null;
}
export interface ProjectWorkspace {
  id: string;
  title: string;
  problemId: string;
  files: ProjectFile[];
  explanation: string;
  verification: string;
  revision: number;
  createdAt: string;
  feedback?: Feedback;
  completedAt?: string;
}
export interface UserState {
  read: string[];
  bookmarks: string[];
  targets: Target[];
  stories: Story[];
  attempts: Attempt[];
  quizzes: QuizAttempt[];
  review: string[];
  activity: string[];
  plan: 'free' | 'month' | 'year' | 'lifetime';
  planExpiresAt: string | null;
  recognition: number;
  enrollments: string[];
  watched: string[];
  certificates: { id: string; courseId: string; issuedAt: string }[];
  chat: { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; source?: 'rubric' | 'ai' }[];
  mocks: MockSession[];
  customQuizzes: CustomQuiz[];
  studyPlans: StudyPlan[];
  projects: ProjectWorkspace[];
}
export interface CourseStep {
  id: string;
  type: 'lesson' | 'quiz' | 'practice' | 'video';
  title: string;
  resource: string;
  to: string;
}
export interface Course {
  id: string;
  title: string;
  description: string;
  track: TrackId;
  premium?: boolean;
  units: { title: string; steps: CourseStep[] }[];
}
export interface CommunityPost {
  id: string;
  kind: CommunityKind;
  title: string;
  body: string;
  company: string;
  track: string;
  level: string;
  region: string;
  author: string;
  authorId: string;
  createdAt: string;
  votes: number;
  voted: boolean;
  followed: boolean;
  sample: boolean;
}
export interface Comment {
  id: string;
  resource: string;
  author: string;
  body: string;
  createdAt: string;
  parentId: string | null;
}
export interface Bootstrap {
  user: User | null;
  state: UserState;
  capabilities: {
    ai: boolean;
    commerce: 'demo';
    community: 'local';
    aiModel: string | null;
  };
}
