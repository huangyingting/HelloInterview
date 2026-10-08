export type TrackId = 'system-design' | 'code' | 'low-level-design' | 'behavioral' | 'ai-coding' | 'ml-system-design' | 'salary-negotiation';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Level = 'Junior' | 'Mid-level' | 'Senior' | 'Staff' | 'Manager';
export type CommunityKind = 'questions' | 'stories' | 'submissions' | 'discussion';

export interface Lesson {
  id: string;
  title: string;
  group: string;
  minutes: number;
  summary: string;
  sections: { title: string; body: string; bullets?: string[]; code?: string }[];
  exercise: string;
  premium?: boolean;
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
  testCases?: { input: unknown; expected: unknown; label: string }[];
  premium?: boolean;
}
export interface QuizQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
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
}
export interface QuizAttempt {
  id: string;
  topic: string;
  answers: Record<string, number>;
  score: number;
  total: number;
  completedAt: string;
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
