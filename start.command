#!/bin/bash
# OMP 供应商配置器（双击运行，自动打开浏览器）
cd "$HOME/WebstormProjects/omp-switch"
if curl -s --max-time 2 http://127.0.0.1:8642/api/state >/dev/null 2>&1; then
  open http://127.0.0.1:8642
  exit 0
fi
nohup bun server.ts > server.log 2>&1 &
sleep 1.5
open http://127.0.0.1:8642
