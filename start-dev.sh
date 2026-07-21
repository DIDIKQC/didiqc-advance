#!/bin/bash
# Launcher untuk dev server — membersihkan stale env vars sebelum start
# agar .env (PostgreSQL/InsForge) yang dipakai, bukan shell env (SQLite)
unset DATABASE_URL
unset SQLITE_DATABASE_URL
cd /home/z/my-project
exec /home/z/my-project/node_modules/.bin/next dev -p 3000
