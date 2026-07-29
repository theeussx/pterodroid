#!/bin/sh
set -eu

mkdir -p /data /data/workspaces
chown -R root:root /data /app

exec /sbin/tini -- "$@"
