#!/bin/bash
# Fully detached dev server starter
cd /home/z/my-project
# Kill any existing
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1
# Start with setsid in new session
setsid bash -c 'exec bun run dev' > /home/z/my-project/.zscripts/dev.log 2>&1 < /dev/null &
echo $! > /home/z/my-project/.zscripts/dev.pid
