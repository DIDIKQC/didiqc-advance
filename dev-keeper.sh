#!/bin/bash
cd /home/z/my-project
# Unset shell DATABASE_URL so .env file (InsForge PostgreSQL) is used
unset DATABASE_URL
while true; do
  NODE_OPTIONS="--max-old-space-size=2048" exec node node_modules/next/dist/bin/next dev -p 3000 >> /home/z/my-project/dev.log 2>&1
  echo "[$(date)] Restarting in 2s..." >> /home/z/my-project/dev.log
  sleep 2
done
