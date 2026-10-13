#!/usr/bin/env bash
# restic pre-hook: dump the deps MongoDB into /var/backups/dumps before the nightly backup.
# Credentials come from the deps-mongo container's own environment; nothing is read from /srv/deps/.env.
set -euo pipefail
umask 077 # the dump holds subscriber emails: $out.tmp and the archive are created 0600
out=/var/backups/dumps/deps-mongo.archive.gz
docker exec deps-mongo sh -c '
  umask 077
  cfg=$(mktemp)
  trap "rm -f $cfg" EXIT
  printf "password: \"%s\"\n" "$MONGO_INITDB_ROOT_PASSWORD" > "$cfg"
  mongodump --quiet --config "$cfg" --username "$MONGO_INITDB_ROOT_USERNAME" \
    --authenticationDatabase admin --db deps --archive --gzip
' > "$out.tmp"
mv "$out.tmp" "$out"
