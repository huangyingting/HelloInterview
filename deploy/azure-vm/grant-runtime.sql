\set ON_ERROR_STOP on

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, public_jobs TO interview_studio_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, public_jobs TO interview_studio_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, public_jobs TO interview_studio_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, public_jobs TO interview_studio_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO interview_studio_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO interview_studio_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO interview_studio_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public_jobs
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO interview_studio_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public_jobs
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO interview_studio_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public_jobs
  GRANT EXECUTE ON FUNCTIONS TO interview_studio_runtime;
