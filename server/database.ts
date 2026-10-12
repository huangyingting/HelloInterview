import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { CommunityKind } from '../shared/types';

export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
  try {
    const hasCommunityRevisions = !!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='community_post_revisions'").get();
    const hasCommentRevisions = !!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='community_comment_revisions'").get();
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        password TEXT, demo INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS states (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
        company TEXT NOT NULL, track TEXT NOT NULL, level TEXT NOT NULL, region TEXT NOT NULL,
        author TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS community_post_revisions (
        post_id TEXT PRIMARY KEY NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 2147483647)
      );
      CREATE TRIGGER IF NOT EXISTS initialize_community_post_revision AFTER INSERT ON posts
        BEGIN INSERT INTO community_post_revisions(post_id) VALUES(NEW.id); END;
      CREATE TRIGGER IF NOT EXISTS advance_community_post_revision AFTER UPDATE ON posts
        BEGIN
          SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM community_post_revisions WHERE post_id=NEW.id)
            THEN RAISE(ABORT,'Missing community post revision.') END;
          UPDATE community_post_revisions SET revision=revision+1 WHERE post_id=NEW.id;
        END;
      CREATE TABLE IF NOT EXISTS votes (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS follows (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, resource TEXT NOT NULL, user_id TEXT NOT NULL,
        author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, parent_id TEXT
      );
      CREATE TABLE IF NOT EXISTS community_comment_revisions (
        comment_id TEXT PRIMARY KEY NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 2147483647)
      );
      CREATE TRIGGER IF NOT EXISTS initialize_community_comment_revision AFTER INSERT ON comments
        BEGIN INSERT INTO community_comment_revisions(comment_id) VALUES(NEW.id); END;
      CREATE TRIGGER IF NOT EXISTS advance_community_comment_revision AFTER UPDATE ON comments
        BEGIN
          SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM community_comment_revisions WHERE comment_id=NEW.id)
            THEN RAISE(ABORT,'Missing community comment revision.') END;
          UPDATE community_comment_revisions SET revision=revision+1 WHERE comment_id=NEW.id;
        END;
      CREATE TABLE IF NOT EXISTS support (
        id TEXT PRIMARY KEY, user_id TEXT, email TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gifts (
        hash TEXT PRIMARY KEY, plan TEXT NOT NULL, creator TEXT NOT NULL, redeemed_by TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_versions (
        id TEXT PRIMARY KEY, value TEXT NOT NULL CHECK (length(value) <= 2097152)
      );
      CREATE TABLE IF NOT EXISTS assessment_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL, content_version TEXT NOT NULL REFERENCES content_versions(id),
        answers TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS assessment_sessions_owner ON assessment_sessions(user_id,completed_at);
      CREATE INDEX IF NOT EXISTS posts_kind_order ON posts(kind,created_at DESC,id);
      CREATE INDEX IF NOT EXISTS posts_owner_order ON posts(author_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS posts_created_order ON posts(created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS follows_owner ON follows(user_id,post_id);
      CREATE INDEX IF NOT EXISTS comments_resource_cursor ON comments(resource,created_at,id);
    `);
    if (!hasCommunityRevisions) db.exec('INSERT OR IGNORE INTO community_post_revisions(post_id) SELECT id FROM posts');
    if (db.prepare('SELECT p.id FROM posts p LEFT JOIN community_post_revisions r ON r.post_id=p.id WHERE r.post_id IS NULL LIMIT 1').get())
      throw new Error('Community post revision data is incomplete. Restore or reconcile the database before starting.');
    if (!hasCommentRevisions) db.exec('INSERT OR IGNORE INTO community_comment_revisions(comment_id) SELECT id FROM comments');
    if (db.prepare('SELECT c.id FROM comments c LEFT JOIN community_comment_revisions r ON r.comment_id=c.id WHERE r.comment_id IS NULL LIMIT 1').get())
      throw new Error('Community comment revision data is incomplete. Restore or reconcile the database before starting.');
    if (!db.prepare('SELECT id FROM posts LIMIT 1').get()) {
      const samples: [CommunityKind, string, string, string, string][] = [
        ['questions', 'Design a collaborative reading list', 'Practice prompt: a team saves articles, organizes them into lists, and sees updates across devices. Discuss sharing, pagination, and offline changes.', 'Meta', 'system-design'],
        ['questions', 'Build a reliable notification pipeline', 'Practice prompt: send email and push notifications while respecting user preferences. Explain retries, deduplication, and monitoring.', 'Amazon', 'system-design'],
        ['questions', 'Find duplicate events in a stream', 'Practice prompt: process an ordered stream and keep the first event for each identifier. Discuss time and memory costs.', 'Google', 'code'],
        ['questions', 'Explain a difficult trade-off', 'Practice prompt: describe a decision where two product goals conflicted. Explain your reasoning and what you measured afterward.', 'Microsoft', 'behavioral'],
        ['questions', 'Review a task assignment handler', 'Practice prompt: inspect validation, authorization, concurrency, and error handling when assigning a task to a team member.', 'Stripe', 'code-review'],
        ['stories', 'A focused four-week preparation plan', 'Illustrative story, not a real customer testimonial: one candidate alternated concept study with timed practice, reviewed missed quiz questions, and kept a small bank of behavioral examples.', 'Google', 'system-design'],
        ['stories', 'Learning to explain the reasoning', 'Illustrative story: explaining one design aloud revealed more gaps than reading several articles. The candidate used those gaps to plan the next session.', 'Meta', 'behavioral'],
        ['stories', 'From broad reading to deliberate practice', 'Illustrative story: a weekly plan connected each reading session to a concrete exercise and a short reflection. Consistency mattered more than collecting resources.', 'Amazon', 'code'],
        ['submissions', 'A document-sharing architecture', 'Client → API → metadata database and object store. Changes are published to a queue. Notifications are retried independently. Open question: how should conflicting offline edits be resolved?', '', 'system-design'],
        ['submissions', 'A parcel locker object model', 'LockerInventory finds compatible capacity. Reservation owns expiry and pickup validation. A Clock interface keeps tests deterministic. Allocation uses an atomic operation.', '', 'low-level-design'],
        ['discussion', 'How do you prioritize the first design deep dive?', 'I start by naming the most important non-functional requirement, then choose the component most likely to violate it. What criteria do you use?', '', 'system-design'],
        ['discussion', 'What makes a useful practice review?', 'I keep a short list of assumptions I missed, choices I could not defend, and one specific change for the next attempt.', '', 'behavioral'],
      ];
      const insert = db.prepare('INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      samples.forEach(([kind, title, body, company, track], i) => insert.run(`sample-${i}`, kind, title, body, company, track, 'Senior', 'Global', 'Studio example', 'sample', new Date(Date.now() - i * 86400000).toISOString(), 1));
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
