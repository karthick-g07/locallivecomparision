#!/bin/bash
# Kill any process using port 3000
PORT=3000
PIDS=$(lsof -ti:$PORT 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "Killing processes on port $PORT: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
    echo "Port $PORT is now free"
else
    echo "Port $PORT is already free"
fi

