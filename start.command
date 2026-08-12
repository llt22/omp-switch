#!/bin/bash
# OMP 供应商配置器（双击运行，自动打开浏览器）
cd "$HOME/.omp/provider-switcher"
if curl -s --max-time 2 http://127.0.0.1:8642/api/state >/dev/null 2>&1; then
  # 服务已在运行，直接打开页面
  open http://127.0.0.1:8642
  exit 0
fi
nohup ./omp-provider-switcher > server.log 2>&1 &
# 二进制启动后会自动打开浏览器
