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
    const commentUser = (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='comments'").get()
      ? db.prepare('PRAGMA table_info(comments)').all() : []).find(column => column.name === 'user_id');
    if (commentUser?.notnull === 1) {
      db.exec(`PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        DROP TRIGGER IF EXISTS initialize_community_comment_revision;
        DROP TRIGGER IF EXISTS advance_community_comment_revision;
        DROP INDEX IF EXISTS comments_resource_order;
        DROP INDEX IF EXISTS comments_resource_cursor;
        ${hasCommentRevisions ? 'ALTER TABLE community_comment_revisions RENAME TO community_comment_revisions_not_nullable_backup;' : ''}
        ALTER TABLE comments RENAME TO comments_not_nullable_backup;
        CREATE TABLE comments (
          id TEXT PRIMARY KEY, resource TEXT NOT NULL, user_id TEXT,
          author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, parent_id TEXT
        );
        INSERT INTO comments SELECT * FROM comments_not_nullable_backup;
        ${hasCommentRevisions ? `
          CREATE TABLE community_comment_revisions (
            comment_id TEXT PRIMARY KEY NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 2147483647)
          );
          INSERT INTO community_comment_revisions SELECT * FROM community_comment_revisions_not_nullable_backup;
          DROP TABLE community_comment_revisions_not_nullable_backup;
        ` : ''}
        DROP TABLE comments_not_nullable_backup;
        COMMIT;
        PRAGMA foreign_keys=ON;`);
      if (db.prepare('PRAGMA foreign_key_check').get())
        throw new Error('Community comment schema upgrade found invalid saved relationships. Restore or reconcile the local database before starting.');
    }
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
        id TEXT PRIMARY KEY, resource TEXT NOT NULL, user_id TEXT,
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
      CREATE TABLE IF NOT EXISTS community_comment_submissions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,comment_id TEXT NOT NULL UNIQUE,resource TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),created_at TEXT NOT NULL,
        PRIMARY KEY(user_id,request_id)
      );
      CREATE INDEX IF NOT EXISTS community_comment_submissions_owner ON community_comment_submissions(user_id,created_at DESC,request_id DESC);
      CREATE INDEX IF NOT EXISTS community_comment_submissions_resource ON community_comment_submissions(user_id,resource,created_at DESC,request_id DESC);
      CREATE TRIGGER IF NOT EXISTS immutable_community_comment_submission BEFORE UPDATE ON community_comment_submissions
        BEGIN SELECT RAISE(ABORT,'Comment submission receipts are immutable.'); END;
      CREATE TABLE IF NOT EXISTS community_comment_tombstones (
        comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
        deleted_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_moderation_targets (
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        state TEXT NOT NULL CHECK(state IN ('visible','hidden')),
        revision INTEGER NOT NULL CHECK(revision>0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(target_type,target_id)
      );
      CREATE TABLE IF NOT EXISTS community_reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        request_key TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        category TEXT NOT NULL CHECK(category IN ('spam','harassment','privacy','misinformation','other')),
        details TEXT NOT NULL CHECK(length(details) BETWEEN 20 AND 1000 AND instr(details,char(0))=0),
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','dismissed','actioned')),
        assigned_to TEXT REFERENCES users(id) ON DELETE RESTRICT,
        report_revision INTEGER NOT NULL DEFAULT 0 CHECK(report_revision>=0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS community_reports_owner_key ON community_reports(reporter_id,request_key) WHERE reporter_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS community_reports_queue ON community_reports(updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS community_reports_owner_open ON community_reports(reporter_id,state);
      CREATE TABLE IF NOT EXISTS community_moderation_events (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES community_reports(id) ON DELETE RESTRICT,
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK(actor_role IN ('moderator','administrator')),
        action TEXT NOT NULL CHECK(action IN ('claim','release','dismiss','hide','restore')),
        reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 500 AND instr(reason,char(0))=0),
        prior_report_revision INTEGER NOT NULL CHECK(prior_report_revision>=0),
        result_report_revision INTEGER NOT NULL CHECK(result_report_revision=prior_report_revision+1),
        prior_target_revision INTEGER,
        result_target_revision INTEGER,
        created_at TEXT NOT NULL,
        CHECK((prior_target_revision IS NULL AND result_target_revision IS NULL) OR
          (prior_target_revision IS NOT NULL AND prior_target_revision>=0 AND result_target_revision=prior_target_revision+1)),
        CHECK((action IN ('hide','restore') AND prior_target_revision IS NOT NULL) OR
          (action IN ('claim','release','dismiss') AND prior_target_revision IS NULL))
      );
      CREATE INDEX IF NOT EXISTS community_moderation_events_report ON community_moderation_events(report_id,created_at,id);
      CREATE TABLE IF NOT EXISTS community_spam_triage (
        report_id TEXT PRIMARY KEY REFERENCES community_reports(id) ON DELETE RESTRICT,
        algorithm_version TEXT NOT NULL CHECK(algorithm_version='community-spam-rules-v1'),
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        content_revision INTEGER NOT NULL CHECK(content_revision>=0),
        input_truncated INTEGER NOT NULL CHECK(input_truncated IN (0,1)),
        score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
        classification TEXT NOT NULL CHECK(classification IN ('unlikely-spam','uncertain','likely-spam')),
        link_count INTEGER NOT NULL CHECK(link_count BETWEEN 0 AND 20),
        contact_solicitation INTEGER NOT NULL CHECK(contact_solicitation IN (0,1)),
        promotional_language INTEGER NOT NULL CHECK(promotional_language IN (0,1)),
        repetitive_content INTEGER NOT NULL CHECK(repetitive_content IN (0,1)),
        state TEXT NOT NULL CHECK(state IN ('pending','reviewed')),
        outcome TEXT CHECK(outcome IN ('confirmed','rejected')),
        revision INTEGER NOT NULL CHECK(revision>=0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((score<30 AND classification='unlikely-spam') OR
          (score BETWEEN 30 AND 59 AND classification='uncertain') OR
          (score>=60 AND classification='likely-spam')),
        CHECK((state='pending' AND outcome IS NULL AND revision=0) OR
          (state='reviewed' AND outcome IS NOT NULL AND revision=1))
      );
      CREATE INDEX IF NOT EXISTS community_spam_triage_queue
        ON community_spam_triage(state,classification,score DESC,updated_at DESC,report_id);
      CREATE TABLE IF NOT EXISTS community_spam_triage_events (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES community_spam_triage(report_id) ON DELETE RESTRICT,
        actor_ref TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK(actor_role IN ('moderator','administrator')),
        decision TEXT NOT NULL CHECK(decision IN ('confirmed','rejected')),
        reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 500 AND instr(reason,char(0))=0),
        prior_revision INTEGER NOT NULL CHECK(prior_revision=0),
        result_revision INTEGER NOT NULL CHECK(result_revision=1),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS community_spam_triage_events_report
        ON community_spam_triage_events(report_id,created_at,id);
      CREATE TABLE IF NOT EXISTS community_appeals (
        id TEXT PRIMARY KEY,
        owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        request_key TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        target_revision INTEGER NOT NULL CHECK(target_revision>0),
        statement TEXT NOT NULL CHECK(length(statement) BETWEEN 20 AND 1000 AND instr(statement,char(0))=0),
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','denied','upheld')),
        assigned_to TEXT REFERENCES users(id) ON DELETE RESTRICT,
        appeal_revision INTEGER NOT NULL DEFAULT 0 CHECK(appeal_revision>=0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS community_appeals_owner_key
        ON community_appeals(owner_id,request_key) WHERE owner_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS community_appeals_owner_target_revision
        ON community_appeals(owner_id,target_type,target_id,target_revision) WHERE owner_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS community_appeals_queue ON community_appeals(updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS community_appeals_owner_order ON community_appeals(owner_id,created_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS community_appeal_events (
        id TEXT PRIMARY KEY,
        appeal_id TEXT NOT NULL REFERENCES community_appeals(id) ON DELETE RESTRICT,
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK(actor_role IN ('moderator','administrator')),
        action TEXT NOT NULL CHECK(action IN ('claim','release','deny','uphold')),
        reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 500 AND instr(reason,char(0))=0),
        prior_appeal_revision INTEGER NOT NULL CHECK(prior_appeal_revision>=0),
        result_appeal_revision INTEGER NOT NULL CHECK(result_appeal_revision=prior_appeal_revision+1),
        prior_target_revision INTEGER,
        result_target_revision INTEGER,
        created_at TEXT NOT NULL,
        CHECK((prior_target_revision IS NULL AND result_target_revision IS NULL) OR
          (prior_target_revision IS NOT NULL AND prior_target_revision>0 AND result_target_revision=prior_target_revision+1)),
        CHECK((action='uphold' AND prior_target_revision IS NOT NULL) OR
          (action IN ('claim','release','deny') AND prior_target_revision IS NULL))
      );
      CREATE INDEX IF NOT EXISTS community_appeal_events_appeal ON community_appeal_events(appeal_id,created_at,id);
      CREATE TABLE IF NOT EXISTS community_mutes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        state TEXT NOT NULL CHECK(state IN ('muted','unmuted')),
        revision INTEGER NOT NULL CHECK(revision>0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id,subject_id),
        CHECK(owner_id<>subject_id)
      );
      CREATE INDEX IF NOT EXISTS community_mutes_owner_state ON community_mutes(owner_id,state,updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS community_mutes_subject ON community_mutes(subject_id,owner_id);
      CREATE TABLE IF NOT EXISTS community_mute_intents (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        mute_id TEXT NOT NULL REFERENCES community_mutes(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        muted INTEGER NOT NULL CHECK(muted IN (0,1)),
        prior_revision INTEGER NOT NULL CHECK(prior_revision>=0),
        result_revision INTEGER NOT NULL CHECK(result_revision=prior_revision OR result_revision=prior_revision+1),
        created_at TEXT NOT NULL,
        PRIMARY KEY(owner_id,request_key)
      );
      CREATE INDEX IF NOT EXISTS community_mute_intents_owner_order
        ON community_mute_intents(owner_id,created_at DESC,request_key DESC);
      CREATE TABLE IF NOT EXISTS community_blocks (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        state TEXT NOT NULL CHECK(state IN ('blocked','unblocked')),
        revision INTEGER NOT NULL CHECK(revision>0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id,subject_id),
        CHECK(owner_id<>subject_id)
      );
      CREATE INDEX IF NOT EXISTS community_blocks_owner_state
        ON community_blocks(owner_id,state,updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS community_blocks_subject_owner
        ON community_blocks(subject_id,owner_id,state);
      CREATE TABLE IF NOT EXISTS community_block_intents (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        block_id TEXT NOT NULL REFERENCES community_blocks(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
        target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND instr(target_id,char(0))=0),
        blocked INTEGER NOT NULL CHECK(blocked IN (0,1)),
        prior_revision INTEGER NOT NULL CHECK(prior_revision>=0),
        result_revision INTEGER NOT NULL CHECK(result_revision=prior_revision OR result_revision=prior_revision+1),
        created_at TEXT NOT NULL,
        PRIMARY KEY(owner_id,request_key)
      );
      CREATE INDEX IF NOT EXISTS community_block_intents_owner_order
        ON community_block_intents(owner_id,created_at DESC,request_key DESC);
      CREATE TABLE IF NOT EXISTS community_restrictions (
        id TEXT PRIMARY KEY,
        subject_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        source_report_id TEXT NOT NULL REFERENCES community_reports(id) ON DELETE RESTRICT,
        scope TEXT NOT NULL CHECK(scope IN ('participation','reporting')),
        state TEXT NOT NULL CHECK(state IN ('active','lifted','expired')),
        revision INTEGER NOT NULL CHECK(revision>0),
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(expires_at>starts_at)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS community_restrictions_active_subject_scope
        ON community_restrictions(subject_id,scope) WHERE state='active' AND subject_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS community_restrictions_subject_order
        ON community_restrictions(subject_id,updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS community_restrictions_staff_queue
        ON community_restrictions(state,expires_at,updated_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS community_restriction_events (
        id TEXT PRIMARY KEY,
        restriction_id TEXT NOT NULL REFERENCES community_restrictions(id) ON DELETE RESTRICT,
        source_report_id TEXT NOT NULL REFERENCES community_reports(id) ON DELETE RESTRICT,
        actor_ref TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK(actor_role IN ('moderator','administrator')),
        action TEXT NOT NULL CHECK(action IN ('restrict','extend','lift','expire')),
        reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 500),
        prior_revision INTEGER NOT NULL CHECK(prior_revision>=0),
        result_revision INTEGER NOT NULL CHECK(result_revision=prior_revision+1),
        prior_expires_at TEXT,
        result_expires_at TEXT NOT NULL,
        result_state TEXT NOT NULL CHECK(result_state IN ('active','lifted','expired')),
        created_at TEXT NOT NULL,
        CHECK((prior_revision=0 AND prior_expires_at IS NULL AND action='restrict') OR
          (prior_revision>0 AND prior_expires_at IS NOT NULL AND action<>'restrict'))
      );
      CREATE INDEX IF NOT EXISTS community_restriction_events_restriction
        ON community_restriction_events(restriction_id,created_at,id);
      CREATE TABLE IF NOT EXISTS community_restriction_appeals (
        id TEXT PRIMARY KEY,
        owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        request_key TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        restriction_id TEXT NOT NULL REFERENCES community_restrictions(id) ON DELETE RESTRICT,
        restriction_revision INTEGER NOT NULL CHECK(restriction_revision>0),
        statement TEXT NOT NULL CHECK(length(statement) BETWEEN 20 AND 1000),
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','denied','upheld','resolved')),
        assigned_to TEXT REFERENCES users(id) ON DELETE RESTRICT,
        appeal_revision INTEGER NOT NULL DEFAULT 0 CHECK(appeal_revision>=0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS community_restriction_appeals_owner_key
        ON community_restriction_appeals(owner_id,request_key) WHERE owner_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS community_restriction_appeals_owner_revision
        ON community_restriction_appeals(owner_id,restriction_id,restriction_revision) WHERE owner_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS community_restriction_appeals_queue
        ON community_restriction_appeals(updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS community_restriction_appeals_owner_order
        ON community_restriction_appeals(owner_id,created_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS community_restriction_appeal_events (
        id TEXT PRIMARY KEY,
        appeal_id TEXT NOT NULL REFERENCES community_restriction_appeals(id) ON DELETE RESTRICT,
        restriction_id TEXT NOT NULL REFERENCES community_restrictions(id) ON DELETE RESTRICT,
        actor_ref TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK(actor_role IN ('moderator','administrator')),
        action TEXT NOT NULL CHECK(action IN ('claim','release','deny','uphold','resolve')),
        reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 500),
        prior_appeal_revision INTEGER NOT NULL CHECK(prior_appeal_revision>=0),
        result_appeal_revision INTEGER NOT NULL CHECK(result_appeal_revision=prior_appeal_revision+1),
        prior_restriction_revision INTEGER NOT NULL CHECK(prior_restriction_revision>0),
        result_restriction_revision INTEGER,
        result_appeal_state TEXT NOT NULL CHECK(result_appeal_state IN ('open','denied','upheld','resolved')),
        created_at TEXT NOT NULL,
        CHECK((action='uphold' AND result_restriction_revision IS NOT NULL AND
          result_restriction_revision=prior_restriction_revision+1 AND result_appeal_state='upheld') OR
          (action<>'uphold' AND result_restriction_revision IS NULL)),
        CHECK((action IN ('claim','release') AND result_appeal_state='open') OR
          (action='deny' AND result_appeal_state='denied') OR
          (action='resolve' AND result_appeal_state='resolved') OR action='uphold')
      );
      CREATE INDEX IF NOT EXISTS community_restriction_appeal_events_appeal
        ON community_restriction_appeal_events(appeal_id,created_at,id);
      CREATE TABLE IF NOT EXISTS community_comment_deletions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        comment_id TEXT NOT NULL UNIQUE,
        resource TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
        prior_revision INTEGER NOT NULL CHECK(prior_revision>=0),
        result_revision INTEGER NOT NULL CHECK(result_revision=prior_revision+1),
        deleted_at TEXT NOT NULL,
        PRIMARY KEY(user_id,request_id)
      );
      CREATE INDEX IF NOT EXISTS community_comment_deletions_owner
        ON community_comment_deletions(user_id,deleted_at DESC,request_id DESC);
      CREATE TRIGGER IF NOT EXISTS require_community_comment_owner BEFORE INSERT ON comments
        WHEN NEW.user_id IS NULL
        BEGIN SELECT RAISE(ABORT,'New community comments require an owner.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_comment_update BEFORE UPDATE ON comments
        WHEN NOT (
          OLD.user_id IS NOT NULL AND NEW.id=OLD.id AND NEW.resource=OLD.resource AND
            NEW.user_id=OLD.user_id AND NEW.author=OLD.author AND NEW.created_at=OLD.created_at AND
            NEW.parent_id IS OLD.parent_id OR
          OLD.user_id IS NOT NULL AND NEW.id=OLD.id AND NEW.resource=OLD.resource AND
            NEW.user_id=OLD.user_id AND NEW.author=OLD.author AND NEW.body=OLD.body AND
            NEW.created_at=OLD.created_at AND OLD.parent_id IS NOT NULL AND NEW.parent_id IS NULL AND
            EXISTS(SELECT 1 FROM comments parent WHERE parent.id=OLD.parent_id AND parent.resource<>OLD.resource) OR
          OLD.user_id IS NOT NULL AND NEW.id=OLD.id AND NEW.resource=OLD.resource AND NEW.user_id IS NULL AND
            NEW.author='' AND NEW.body='' AND NEW.created_at=OLD.created_at AND NEW.parent_id IS OLD.parent_id AND
            EXISTS(SELECT 1 FROM community_comment_deletions deletion
              WHERE deletion.comment_id=OLD.id AND deletion.user_id=OLD.user_id AND deletion.resource=OLD.resource) AND
            EXISTS(SELECT 1 FROM community_comment_tombstones tombstone WHERE tombstone.comment_id=OLD.id)
        )
        BEGIN SELECT RAISE(ABORT,'Community comments allow only body edits, cross-resource parent cleanup or receipt-bound tombstoning.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_report BEFORE UPDATE ON community_reports
      WHEN NOT (
        OLD.reporter_id IS NOT NULL AND NEW.reporter_id IS NULL AND
          NEW.id=OLD.id AND NEW.request_key=OLD.request_key AND NEW.input_hash=OLD.input_hash AND
          NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND NEW.category=OLD.category AND
          NEW.details=OLD.details AND NEW.state=OLD.state AND NEW.assigned_to IS OLD.assigned_to AND
          NEW.report_revision=OLD.report_revision AND NEW.created_at=OLD.created_at AND NEW.updated_at=OLD.updated_at OR
        NEW.id=OLD.id AND NEW.reporter_id IS OLD.reporter_id AND NEW.request_key=OLD.request_key AND
          NEW.input_hash=OLD.input_hash AND NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND
          NEW.category=OLD.category AND NEW.details=OLD.details AND NEW.created_at=OLD.created_at AND
          NEW.report_revision=OLD.report_revision+1 AND NEW.updated_at>=OLD.updated_at
      )
      BEGIN SELECT RAISE(ABORT,'Community reports allow only reporter retirement or revision-fenced staff state changes.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_report BEFORE INSERT ON community_reports
      WHEN NEW.reporter_id IS NULL OR NEW.state<>'open' OR NEW.assigned_to IS NOT NULL OR NEW.report_revision<>0 OR NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New community reports must begin as unassigned revision-zero owner records.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_moderation_target BEFORE UPDATE ON community_moderation_targets
      WHEN NOT (NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND NEW.state<>OLD.state AND
        NEW.revision=OLD.revision+1 AND NEW.updated_at>=OLD.updated_at)
      BEGIN SELECT RAISE(ABORT,'Moderation target changes require one revision-fenced state transition.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_moderation_target BEFORE INSERT ON community_moderation_targets
      WHEN NEW.revision<>1
      BEGIN SELECT RAISE(ABORT,'New moderation targets must begin at revision one.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_moderation_event BEFORE INSERT ON community_moderation_events
      WHEN NOT EXISTS(SELECT 1 FROM community_reports report WHERE report.id=NEW.report_id AND
        report.target_type=NEW.target_type AND report.target_id=NEW.target_id AND report.report_revision=NEW.result_report_revision)
      OR NEW.result_target_revision IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM community_moderation_targets target WHERE target.target_type=NEW.target_type AND
          target.target_id=NEW.target_id AND target.revision=NEW.result_target_revision)
      BEGIN SELECT RAISE(ABORT,'Moderation evidence must reference resulting report and target revisions.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_moderation_event_update BEFORE UPDATE ON community_moderation_events
      BEGIN SELECT RAISE(ABORT,'Community moderation evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_moderation_event_delete BEFORE DELETE ON community_moderation_events
      BEGIN SELECT RAISE(ABORT,'Community moderation evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_report_delete BEFORE DELETE ON community_reports
      BEGIN SELECT RAISE(ABORT,'Community moderation evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_moderation_target_delete BEFORE DELETE ON community_moderation_targets
      BEGIN SELECT RAISE(ABORT,'Community moderation evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_spam_triage BEFORE INSERT ON community_spam_triage
      WHEN NEW.state<>'pending' OR NEW.outcome IS NOT NULL OR NEW.revision<>0 OR NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New spam triage snapshots must begin pending at revision zero.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_spam_triage BEFORE UPDATE ON community_spam_triage
      WHEN NOT (NEW.report_id=OLD.report_id AND NEW.algorithm_version=OLD.algorithm_version AND NEW.input_hash=OLD.input_hash AND
        NEW.content_revision=OLD.content_revision AND NEW.input_truncated=OLD.input_truncated AND NEW.score=OLD.score AND
        NEW.classification=OLD.classification AND NEW.link_count=OLD.link_count AND
        NEW.contact_solicitation=OLD.contact_solicitation AND NEW.promotional_language=OLD.promotional_language AND
        NEW.repetitive_content=OLD.repetitive_content AND OLD.state='pending' AND OLD.outcome IS NULL AND OLD.revision=0 AND
        NEW.state='reviewed' AND NEW.outcome IS NOT NULL AND NEW.revision=1 AND NEW.created_at=OLD.created_at AND
        NEW.updated_at>=OLD.updated_at)
      BEGIN SELECT RAISE(ABORT,'Spam triage permits only one revision-fenced human review.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_spam_triage_event BEFORE INSERT ON community_spam_triage_events
      WHEN NOT EXISTS(SELECT 1 FROM community_spam_triage triage WHERE triage.report_id=NEW.report_id AND
        triage.state='reviewed' AND triage.outcome=NEW.decision AND triage.revision=NEW.result_revision)
      BEGIN SELECT RAISE(ABORT,'Spam triage review evidence must reference the resulting decision.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_spam_triage_event_update BEFORE UPDATE ON community_spam_triage_events
      BEGIN SELECT RAISE(ABORT,'Community spam triage evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_spam_triage_event_delete BEFORE DELETE ON community_spam_triage_events
      BEGIN SELECT RAISE(ABORT,'Community spam triage evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_spam_triage_delete BEFORE DELETE ON community_spam_triage
      BEGIN SELECT RAISE(ABORT,'Community spam triage evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_appeal BEFORE UPDATE ON community_appeals
      WHEN NOT (
        OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL AND
          NEW.id=OLD.id AND NEW.request_key=OLD.request_key AND NEW.input_hash=OLD.input_hash AND
          NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND NEW.target_revision=OLD.target_revision AND
          NEW.statement=OLD.statement AND NEW.state=OLD.state AND NEW.assigned_to IS OLD.assigned_to AND
          NEW.appeal_revision=OLD.appeal_revision AND NEW.created_at=OLD.created_at AND NEW.updated_at=OLD.updated_at OR
        NEW.id=OLD.id AND NEW.owner_id IS OLD.owner_id AND NEW.request_key=OLD.request_key AND
          NEW.input_hash=OLD.input_hash AND NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND
          NEW.target_revision=OLD.target_revision AND NEW.statement=OLD.statement AND NEW.created_at=OLD.created_at AND
          NEW.appeal_revision=OLD.appeal_revision+1 AND NEW.updated_at>=OLD.updated_at
      )
      BEGIN SELECT RAISE(ABORT,'Community appeals allow only owner retirement or revision-fenced staff state changes.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_appeal BEFORE INSERT ON community_appeals
      WHEN NEW.owner_id IS NULL OR NEW.state<>'open' OR NEW.assigned_to IS NOT NULL OR NEW.appeal_revision<>0 OR NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New community appeals must begin as unassigned revision-zero owner records.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_appeal_event BEFORE INSERT ON community_appeal_events
      WHEN NOT EXISTS(SELECT 1 FROM community_appeals appeal WHERE appeal.id=NEW.appeal_id AND
        appeal.target_type=NEW.target_type AND appeal.target_id=NEW.target_id AND appeal.appeal_revision=NEW.result_appeal_revision)
      OR NEW.result_target_revision IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM community_moderation_targets target WHERE target.target_type=NEW.target_type AND
          target.target_id=NEW.target_id AND target.revision=NEW.result_target_revision AND target.state='visible')
      BEGIN SELECT RAISE(ABORT,'Appeal evidence must reference resulting appeal and restored target revisions.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_appeal_event_update BEFORE UPDATE ON community_appeal_events
      BEGIN SELECT RAISE(ABORT,'Community appeal evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_appeal_event_delete BEFORE DELETE ON community_appeal_events
      BEGIN SELECT RAISE(ABORT,'Community appeal evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_appeal_delete BEFORE DELETE ON community_appeals
      BEGIN SELECT RAISE(ABORT,'Community appeal evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_mute BEFORE UPDATE ON community_mutes
      WHEN NOT (NEW.id=OLD.id AND NEW.owner_id=OLD.owner_id AND NEW.subject_id=OLD.subject_id AND
        NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND NEW.state<>OLD.state AND
        NEW.revision=OLD.revision+1 AND NEW.created_at=OLD.created_at AND NEW.updated_at>=OLD.updated_at)
      BEGIN SELECT RAISE(ABORT,'Community mutes allow only one revision-fenced desired-state transition.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_mute BEFORE INSERT ON community_mutes
      WHEN NEW.state<>'muted' OR NEW.revision<>1 OR NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New community mutes must begin muted at revision one.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_mute_intent BEFORE INSERT ON community_mute_intents
      WHEN NOT EXISTS(SELECT 1 FROM community_mutes mute WHERE mute.id=NEW.mute_id AND mute.owner_id=NEW.owner_id AND
        mute.revision=NEW.result_revision AND mute.state=CASE WHEN NEW.muted=1 THEN 'muted' ELSE 'unmuted' END)
      BEGIN SELECT RAISE(ABORT,'Mute intents must reference the resulting owned desired state.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_mute_intent_update BEFORE UPDATE ON community_mute_intents
      BEGIN SELECT RAISE(ABORT,'Community mute intent receipts are immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_mute_intent_delete BEFORE DELETE ON community_mute_intents
      BEGIN SELECT RAISE(ABORT,'Community mute intent receipts are immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_block BEFORE UPDATE ON community_blocks
      WHEN NOT (NEW.id=OLD.id AND NEW.owner_id=OLD.owner_id AND NEW.subject_id=OLD.subject_id AND
        NEW.target_type=OLD.target_type AND NEW.target_id=OLD.target_id AND NEW.state<>OLD.state AND
        NEW.revision=OLD.revision+1 AND NEW.created_at=OLD.created_at AND NEW.updated_at>=OLD.updated_at)
      BEGIN SELECT RAISE(ABORT,'Community blocks allow only one revision-fenced desired-state transition.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_block_delete BEFORE DELETE ON community_blocks
      WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.subject_id)
      BEGIN SELECT RAISE(ABORT,'Community blocks can be deleted only with account erasure.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_block BEFORE INSERT ON community_blocks
      WHEN NEW.state<>'blocked' OR NEW.revision<>1 OR NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New community blocks must begin blocked at revision one.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_block_intent BEFORE INSERT ON community_block_intents
      WHEN NOT EXISTS(SELECT 1 FROM community_blocks block WHERE block.id=NEW.block_id AND block.owner_id=NEW.owner_id AND
        block.revision=NEW.result_revision AND block.state=CASE WHEN NEW.blocked=1 THEN 'blocked' ELSE 'unblocked' END)
      BEGIN SELECT RAISE(ABORT,'Block intents must reference the resulting owned desired state.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_block_intent_update BEFORE UPDATE ON community_block_intents
      BEGIN SELECT RAISE(ABORT,'Community block intent receipts are immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_block_intent_delete BEFORE DELETE ON community_block_intents
      WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id) AND
        EXISTS(SELECT 1 FROM community_blocks WHERE id=OLD.block_id)
      BEGIN SELECT RAISE(ABORT,'Community block intent receipts can be deleted only with account erasure.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_restriction BEFORE INSERT ON community_restrictions
      WHEN NEW.subject_id IS NULL OR NEW.state<>'active' OR NEW.revision<>1 OR
        NEW.starts_at<>NEW.created_at OR NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New community restrictions must begin as active revision-one subject records.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_restriction BEFORE UPDATE ON community_restrictions
      WHEN NOT (
        OLD.subject_id IS NOT NULL AND NEW.subject_id IS NULL AND NEW.id=OLD.id AND
          NEW.source_report_id=OLD.source_report_id AND NEW.scope=OLD.scope AND NEW.state=OLD.state AND
          NEW.revision=OLD.revision AND NEW.starts_at=OLD.starts_at AND NEW.expires_at=OLD.expires_at AND
          NEW.created_at=OLD.created_at AND NEW.updated_at=OLD.updated_at OR
        NEW.id=OLD.id AND NEW.subject_id IS OLD.subject_id AND NEW.source_report_id=OLD.source_report_id AND
          NEW.scope=OLD.scope AND NEW.revision=OLD.revision+1 AND NEW.starts_at=OLD.starts_at AND
          NEW.created_at=OLD.created_at AND NEW.updated_at>=OLD.updated_at AND (
            OLD.state='active' AND NEW.state IN ('lifted','expired') AND NEW.expires_at=OLD.expires_at OR
            OLD.state='active' AND NEW.state='active' AND NEW.expires_at>OLD.expires_at
          )
      )
      BEGIN SELECT RAISE(ABORT,'Community restrictions allow only subject retirement or one revision-fenced active transition.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_restriction_event BEFORE INSERT ON community_restriction_events
      WHEN NOT EXISTS(SELECT 1 FROM community_restrictions restriction WHERE restriction.id=NEW.restriction_id AND
        restriction.source_report_id=NEW.source_report_id AND restriction.revision=NEW.result_revision AND
        restriction.state=NEW.result_state AND restriction.expires_at=NEW.result_expires_at)
      BEGIN SELECT RAISE(ABORT,'Restriction evidence must reference the resulting state and revision.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_restriction_event_update BEFORE UPDATE ON community_restriction_events
      BEGIN SELECT RAISE(ABORT,'Community restriction evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_restriction_event_delete BEFORE DELETE ON community_restriction_events
      BEGIN SELECT RAISE(ABORT,'Community restriction evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS protect_community_restriction_appeal BEFORE UPDATE ON community_restriction_appeals
      WHEN NOT (
        OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL AND NEW.id=OLD.id AND
          NEW.request_key=OLD.request_key AND NEW.input_hash=OLD.input_hash AND
          NEW.restriction_id=OLD.restriction_id AND NEW.restriction_revision=OLD.restriction_revision AND
          NEW.statement=OLD.statement AND NEW.state=OLD.state AND NEW.assigned_to IS OLD.assigned_to AND
          NEW.appeal_revision=OLD.appeal_revision AND NEW.created_at=OLD.created_at AND NEW.updated_at=OLD.updated_at OR
        NEW.id=OLD.id AND NEW.owner_id IS OLD.owner_id AND NEW.request_key=OLD.request_key AND
          NEW.input_hash=OLD.input_hash AND NEW.restriction_id=OLD.restriction_id AND
          NEW.restriction_revision=OLD.restriction_revision AND NEW.statement=OLD.statement AND
          OLD.state='open' AND NEW.state IN ('open','denied','upheld','resolved') AND
          NEW.appeal_revision=OLD.appeal_revision+1 AND NEW.created_at=OLD.created_at AND NEW.updated_at>=OLD.updated_at AND
          (NEW.state<>'upheld' OR EXISTS(SELECT 1 FROM community_restrictions restriction
            WHERE restriction.id=OLD.restriction_id AND restriction.state='lifted' AND
              restriction.revision=OLD.restriction_revision+1))
      )
      BEGIN SELECT RAISE(ABORT,'Restriction appeals allow only owner retirement or one revision-fenced staff review transition.'); END;
      CREATE TRIGGER IF NOT EXISTS initialize_community_restriction_appeal BEFORE INSERT ON community_restriction_appeals
      WHEN NEW.owner_id IS NULL OR NEW.state<>'open' OR NEW.assigned_to IS NOT NULL OR NEW.appeal_revision<>0 OR
        NEW.created_at<>NEW.updated_at
      BEGIN SELECT RAISE(ABORT,'New restriction appeals must begin as unassigned revision-zero owner records.'); END;
      CREATE TRIGGER IF NOT EXISTS validate_community_restriction_appeal_event BEFORE INSERT ON community_restriction_appeal_events
      WHEN NOT EXISTS(SELECT 1 FROM community_restriction_appeals appeal WHERE appeal.id=NEW.appeal_id AND
        appeal.restriction_id=NEW.restriction_id AND appeal.appeal_revision=NEW.result_appeal_revision AND
        appeal.state=NEW.result_appeal_state)
      OR NEW.result_restriction_revision IS NULL AND NOT EXISTS(
        SELECT 1 FROM community_restrictions restriction WHERE restriction.id=NEW.restriction_id AND
          restriction.revision=NEW.prior_restriction_revision)
      OR NEW.result_restriction_revision IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM community_restrictions restriction WHERE restriction.id=NEW.restriction_id AND
          restriction.revision=NEW.result_restriction_revision AND restriction.state='lifted')
      BEGIN SELECT RAISE(ABORT,'Restriction appeal evidence must reference resulting appeal and restriction revisions.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_restriction_appeal_event_update BEFORE UPDATE ON community_restriction_appeal_events
      BEGIN SELECT RAISE(ABORT,'Community restriction appeal evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_restriction_appeal_event_delete BEFORE DELETE ON community_restriction_appeal_events
      BEGIN SELECT RAISE(ABORT,'Community restriction appeal evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_restriction_appeal_delete BEFORE DELETE ON community_restriction_appeals
      BEGIN SELECT RAISE(ABORT,'Community restriction appeal evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_restriction_delete BEFORE DELETE ON community_restrictions
      BEGIN SELECT RAISE(ABORT,'Community restriction evidence is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS apply_community_comment_deletion AFTER INSERT ON community_comment_deletions
        BEGIN
          SELECT CASE WHEN NOT EXISTS(
            SELECT 1 FROM comments comment JOIN community_comment_revisions saved ON saved.comment_id=comment.id
            WHERE comment.id=NEW.comment_id AND comment.user_id=NEW.user_id AND
              comment.resource=NEW.resource AND saved.revision=NEW.prior_revision
          ) THEN RAISE(ABORT,'Comment deletion requires the current owned revision.') END;
          INSERT INTO community_comment_tombstones(comment_id,deleted_at) VALUES(NEW.comment_id,NEW.deleted_at);
          UPDATE comments SET user_id=NULL,author='',body='' WHERE id=NEW.comment_id AND user_id=NEW.user_id;
          SELECT CASE WHEN NOT EXISTS(
            SELECT 1 FROM community_comment_revisions WHERE comment_id=NEW.comment_id AND revision=NEW.result_revision
          ) THEN RAISE(ABORT,'Comment deletion did not publish one exact tombstone revision.') END;
        END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_comment_deletion BEFORE UPDATE ON community_comment_deletions
        BEGIN SELECT RAISE(ABORT,'Comment deletion receipts and tombstones are immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_community_comment_tombstone BEFORE UPDATE ON community_comment_tombstones
        BEGIN SELECT RAISE(ABORT,'Comment deletion receipts and tombstones are immutable.'); END;
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
