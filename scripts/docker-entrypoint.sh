#!/bin/sh
# The image's entrypoint: the server never runs as root.
#
# The image declares `USER node`, so on most hosts this script starts as
# `node` and only runs the command. A host that mounts its volume as root
# (Railway does, and RAILWAY_RUN_UID=0 is its switch to start the container as
# root) starts it as root instead: then the directory that holds the saved
# positions is handed to `node`, and the command runs as `node`. Root is held
# for those few lines and never by the server (ADR 0014).
set -eu

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

# The same choice the server makes (readDataDirectory in packages/server/src/index.ts).
data_directory="${DATA_DIRECTORY:-${RAILWAY_VOLUME_MOUNT_PATH:-}}"
# Never the root of the filesystem: owning it would let `node` replace /etc.
if [ -n "$data_directory" ] && [ "$(cd "$data_directory" 2>/dev/null && pwd -P)" != "/" ]; then
  # The directory itself and the store's own files (the database and its write-ahead log, which an earlier deploy may
  # have written as root). Nothing else in it, nothing below it and nothing through a link: a mistyped directory must
  # not hand a tree to `node`. A filesystem that refuses the change is left to the server, which stops the boot with
  # its own message if it cannot write there.
  mkdir -p "$data_directory" || true
  for owned_by_node in "$data_directory" "$data_directory"/saved-positions.sqlite*; do
    if [ -e "$owned_by_node" ] && [ ! -L "$owned_by_node" ]; then
      chown -h node:node "$owned_by_node" || echo "docker-entrypoint: could not hand $owned_by_node to node" >&2
    fi
  done
fi

export HOME=/home/node
exec su-exec node:node "$@"
