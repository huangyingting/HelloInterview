import { createHash, randomUUID } from 'node:crypto';
import type { Database, DatabaseRow } from '../db/connection';
import { quizQuestions } from '../../shared/catalog';
import type { QuestionPrompt, QuizQuestion, QuizReport, QuizSessionView } from '../../shared/types';
import { gradeQuestions } from './grading';
import { HttpError } from '../http-error';
import { publishedQuestion, questionSnapshotSchema, readQuestionSnapshot } from './schema';

interface Session {
  id: string;
  topic: string;
  answers: Record<string, number>;
  revision: number;
  completedAt: string | null;
  contentVersion: string;
  questions: QuizQuestion[];
}
export class ContentRepository {
  constructor(private readonly db: Database) {}
  version(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  async lockOwner(id: string) {
    await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(id);
  }
  async pin(questions: QuizQuestion[]): Promise<string> {
    const published=questions.map(question=>question.sources?question:publishedQuestion(question));
    questionSnapshotSchema.parse(published);
    const version = this.version(published);
    const value=JSON.stringify(published);
    await this.db.prepare('INSERT INTO content_versions (id,value) VALUES (?,?) ON CONFLICT (id) DO NOTHING').run(version,value);
    const saved=await this.db.prepare('SELECT value FROM content_versions WHERE id=?').get(version);
    if(saved?.value!==value)throw new Error('The saved quiz content version is inconsistent.');
    return version;
  }
  async questions(version: string | undefined, ids: string[]): Promise<QuizQuestion[]> {
    if (!version) {
      const questions = ids.map(id => quizQuestions.find(question => question.id === id));
      if (questions.some(question => !question)) throw new HttpError(409, 'This unversioned legacy quiz contains unavailable questions. Its saved answers and score remain in your account export.');
      return questions.filter((question): question is QuizQuestion => !!question);
    }
    const row = await this.db.prepare('SELECT value FROM content_versions WHERE id=?').get(version);
    if (!row || typeof row.value !== 'string') throw new Error('The saved quiz content version is missing.');
    const questions=readQuestionSnapshot(row.value,version);
    if (questions.length !== ids.length || new Set(ids).size !== ids.length || questions.some(question => !ids.includes(question.id))) throw new Error('The saved quiz content version is inconsistent.');
    return questions;
  }
  prompt({ correct: _correct, explanation: _explanation, ...question }: QuizQuestion): QuestionPrompt { return question; }
  async report(id: string, answers: Record<string, number>, version: string | undefined, ids: string[], score: number): Promise<QuizReport> {
    const questions = await this.questions(version, ids);
    return { id, questions, answers, score, total: questions.length, contentVersion: version ?? 'legacy-unversioned', provenance: version ? 'versioned' : 'legacy-unversioned' };
  }
  private view(session: Session): QuizSessionView {
    const question = session.questions.find(question => !Object.hasOwn(session.answers, question.id));
    return { id: session.id, topic: session.topic, customId: null, revision: session.revision, total: session.questions.length, answered: Object.keys(session.answers).length, question: question ? this.prompt(question) : null, completedAt: session.completedAt, contentVersion: session.contentVersion };
  }
  async createSession(userId: string, topic: string, questions: QuizQuestion[]) {
    const count = await this.db.prepare('SELECT COUNT(*) AS count FROM assessment_sessions WHERE user_id=? AND completed_at IS NULL').get(userId);
    if (Number(count?.count) >= 50) throw new HttpError(400, 'Finish existing saved quiz sessions before starting more.');
    const session: Session = { id: randomUUID(), topic, questions, answers: {}, revision: 0, completedAt: null, contentVersion: await this.pin(questions) };
    await this.db.prepare('INSERT INTO assessment_sessions (id,user_id,topic,content_version,answers,revision) VALUES (?,?,?,?,?,?)').run(session.id, userId, topic, session.contentVersion, '{}', 0);
    return this.view(session);
  }
  private async loadSession(userId: string, id: string): Promise<Session> {
    const row: DatabaseRow | undefined = await this.db.prepare('SELECT id,topic,content_version,answers,revision,completed_at FROM assessment_sessions WHERE user_id=? AND id=?').get(userId, id);
    if (!row) throw new HttpError(404, 'Quiz session not found.');
    const version = String(row.content_version);
    const snapshot = await this.db.prepare('SELECT value FROM content_versions WHERE id=?').get(version);
    if (!snapshot || typeof snapshot.value !== 'string') throw new Error('The saved quiz content version is missing.');
    const questions=readQuestionSnapshot(snapshot.value,version);
    return { id: String(row.id), topic: String(row.topic), contentVersion: version, answers: JSON.parse(String(row.answers)), revision: Number(row.revision), completedAt: row.completed_at === null ? null : String(row.completed_at), questions };
  }
  async sessionView(userId: string, id: string) { return this.view(await this.loadSession(userId, id)); }
  async exportSessions(userId:string) {
    const rows=await this.db.prepare('SELECT id FROM assessment_sessions WHERE user_id=? ORDER BY id').all(userId);
    return Promise.all(rows.map(async row=>{
      const session=await this.loadSession(userId,String(row.id));
      return {session:this.view(session),answers:session.answers,checkedQuestions:session.questions.filter(question=>Object.hasOwn(session.answers,question.id))};
    }));
  }
  async answerSession(userId: string, id: string, questionId: string, answer: number, revision: number) {
    return this.db.transaction(async () => {
      await this.lockOwner(userId);
      const session = await this.loadSession(userId, id);
      if (session.completedAt || session.revision !== revision) throw new HttpError(409, 'This quiz changed. Reload the saved session.');
      const question = session.questions.find(question => !Object.hasOwn(session.answers, question.id));
      if (!question || question.id !== questionId) throw new HttpError(400, 'Answer the next question in this saved quiz.');
      if (!Number.isInteger(answer) || answer < -1 || answer >= question.options.length) throw new HttpError(400, 'Invalid answer choice.');
      session.answers[question.id] = answer;
      session.revision++;
      await this.db.prepare('UPDATE assessment_sessions SET answers=?,revision=? WHERE user_id=? AND id=?').run(JSON.stringify(session.answers), session.revision, userId, id);
      return { session: this.view(session), feedback: question };
    });
  }
  async finishSession(userId: string, id: string, revision: number) {
    const session = await this.loadSession(userId, id);
    if (session.completedAt) return { session, newlyCompleted: false };
    if (session.revision !== revision) throw new HttpError(409, 'This quiz changed. Reload the saved session.');
    if (session.questions.some(question => !Object.hasOwn(session.answers, question.id))) throw new HttpError(400, 'Answer or skip every question before finishing.');
    gradeQuestions(session.questions, session.answers);
    session.completedAt = new Date().toISOString();
    await this.db.prepare('UPDATE assessment_sessions SET completed_at=?,revision=? WHERE user_id=? AND id=?').run(session.completedAt, session.revision + 1, userId, id);
    return { session, newlyCompleted: true };
  }
}
