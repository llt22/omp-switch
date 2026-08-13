#!/bin/bash
# macOS 一键安装 omp-switch（处理 Gatekeeper 隔离标记）
# 用法: bash install-macos.sh [应用路径]
set -e

APP="${1:-$HOME/Downloads/omp-switch.app}"
if [ ! -d "$APP" ]; then
  echo "❌ 未找到应用: $APP"
  echo "请先解压/挂载下载的安装包，把 omp-switch.app 拖到 ~/Downloads，或指定路径:"
  echo "  bash install-macos.sh /path/to/omp-switch.app"
  exit 1
fi

echo "→ 清除隔离标记..."
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "→ 复制到 /Applications..."
cp -R "$APP" /Applications/

echo "✅ 安装完成，正在启动..."
open /Applications/omp-switch.app
