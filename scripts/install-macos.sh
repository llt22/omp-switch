#!/bin/bash
# macOS 一键安装 omp-switch（自动处理 dmg 挂载与 Gatekeeper 隔离标记）
# 用法: bash install-macos.sh [可选: .app 路径 或 .dmg 路径]
set -e

APP="${1:-}"
MOUNTED=""

# 1. 定位 .app
if [ -z "$APP" ]; then
  # 查找下载目录的 dmg
  DMG=$(ls -t "$HOME"/Downloads/omp-switch*.dmg 2>/dev/null | head -1)
  if [ -n "$DMG" ]; then
    echo "→ 找到安装包: $DMG"
    echo "→ 挂载中..."
    hdiutil attach "$DMG" -nobrowse -quiet
    MOUNTED=$(hdiutil info | grep "/Volumes/omp-switch" | awk '{print $1}' | head -1)
    APP="$MOUNTED/omp-switch.app"
  fi
fi

if [ ! -d "$APP" ]; then
  echo "❌ 未找到应用: ${APP:-未指定}"
  echo "请先挂载 .dmg，或指定路径:"
  echo "  bash install-macos.sh /path/to/omp-switch.app"
  exit 1
fi

echo "→ 清除 Gatekeeper 隔离标记..."
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "→ 安装到 /Applications..."
rm -rf /Applications/omp-switch.app
cp -R "$APP" /Applications/

if [ -n "$MOUNTED" ]; then
  echo "→ 卸载安装包..."
  hdiutil detach "$MOUNTED" -quiet
fi

echo "✅ 安装完成，正在启动..."
open /Applications/omp-switch.app
