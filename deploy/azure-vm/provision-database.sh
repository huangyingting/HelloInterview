#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this command as root." >&2
  exit 1
fi

config_dir=/etc/interview-studio
migrate_env="$config_dir/migrate.env"
runtime_env="$config_dir/runtime.env"
migrate_pgpass="$config_dir/migrate.pgpass"
runtime_pgpass="$config_dir/runtime.pgpass"
if [ -e "$migrate_env" ] || [ -e "$runtime_env" ] || [ -e "$migrate_pgpass" ] || [ -e "$runtime_pgpass" ]; then
  echo "Interview Studio database environment files already exist; refusing to rotate authority implicitly." >&2
  exit 1
fi
if sudo -u postgres psql --no-psqlrc -Atqc "SELECT 1 FROM pg_roles WHERE rolname IN ('interview_studio_migrator','interview_studio_runtime') LIMIT 1" | grep -q 1; then
  echo "Interview Studio database roles already exist; inspect them before any explicit recovery." >&2
  exit 1
fi
if sudo -u postgres psql --no-psqlrc -Atqc "SELECT 1 FROM pg_database WHERE datname='interview_studio'" | grep -q 1; then
  echo "The Interview Studio database already exists; inspect it before any explicit recovery." >&2
  exit 1
fi

install -d -o root -g root -m 0700 "$config_dir"
umask 077
migrator_password=$(openssl rand -hex 32)
runtime_password=$(openssl rand -hex 32)
migrate_tmp=$(mktemp "$config_dir/.migrate.env.XXXXXX")
runtime_tmp=$(mktemp "$config_dir/.runtime.env.XXXXXX")
mpass_tmp=$(mktemp "$config_dir/.migrate.pgpass.XXXXXX")
rpass_tmp=$(mktemp "$config_dir/.runtime.pgpass.XXXXXX")
cleanup() {
  rm -f "$migrate_tmp" "$runtime_tmp" "$mpass_tmp" "$rpass_tmp"
}
trap cleanup EXIT HUP INT TERM

cat >"$migrate_tmp" <<EOF
DATABASE_URL=postgresql://interview_studio_migrator:${migrator_password}@127.0.0.1:5432/interview_studio
EOF
cat >"$runtime_tmp" <<EOF
NODE_ENV=production
APP_MODE=service
HOST=127.0.0.1
PORT=10006
PUBLIC_ORIGIN=https://interview.genisisiq.com
COOKIE_SECURE=true
TRUST_PROXY=127.0.0.1/32
LOG_REQUESTS=true
FIELD_METRICS_ENABLED=false
DATABASE_URL=postgresql://interview_studio_runtime:${runtime_password}@127.0.0.1:5432/interview_studio
EOF
printf '%s\n' "127.0.0.1:5432:interview_studio:interview_studio_migrator:${migrator_password}" >"$mpass_tmp"
printf '%s\n' "127.0.0.1:5432:interview_studio:interview_studio_runtime:${runtime_password}" >"$rpass_tmp"

sudo -u postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 <<EOF
CREATE ROLE interview_studio_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${migrator_password}';
CREATE ROLE interview_studio_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${runtime_password}';
CREATE DATABASE interview_studio OWNER interview_studio_migrator ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE interview_studio FROM PUBLIC;
GRANT CONNECT ON DATABASE interview_studio TO interview_studio_migrator, interview_studio_runtime;
EOF
sudo -u postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=interview_studio <<'EOF'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO interview_studio_migrator;
EOF

install -o root -g root -m 0600 "$migrate_tmp" "$migrate_env"
install -o root -g root -m 0600 "$runtime_tmp" "$runtime_env"
install -o root -g root -m 0600 "$mpass_tmp" "$migrate_pgpass"
install -o root -g root -m 0600 "$rpass_tmp" "$runtime_pgpass"
echo "Dedicated database authority and root-only environment files were created."
