#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this command as root." >&2
  exit 1
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
install -d -o root -g root -m 0755 /usr/local/share/interview-studio
install -o root -g root -m 0644 "$script_dir/grant-runtime.sql" /usr/local/share/interview-studio/grant-runtime.sql
for unit in \
  interview-studio.service \
  interview-studio-privacy-worker.service \
  interview-studio-preflight.service \
  interview-studio-migrate.service
do
  install -o root -g root -m 0644 "$script_dir/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl disable interview-studio.service interview-studio-privacy-worker.service >/dev/null 2>&1 || true
echo "Interview Studio units were installed and remain disabled."
