#!/bin/bash
# Wrapper that keeps Next.js dev server alive
cd /home/z/my-project
rm -f dev.log
while true; do
  echo "[$(date +%T)] Starting Next.js dev server..." >> dev.log
  NODE_OPTIONS="--max-old-space-size=2048" node node_modules/next/dist/bin/next dev -p 3000 >> dev.log 2>&1
  EXIT_CODE=$?
  echo "[$(date +%T)] Next.js exited with code $EXIT_CODE, restarting in 3s..." >> dev.log
  sleep 3
done
