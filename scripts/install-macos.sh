#!/bin/bash
# macOS 一键安装 omp-switch（自动挂载 dmg + 清除 Gatekeeper 隔离标记）
# 用法: bash install-macos.sh [可选: .app 路径 或 .dmg 路径]
set -e

APP="${1:-}"
MOUNTED=""

# 1. 定位 .app
if [ -z "$APP" ]; then
  # 1a. 已挂载的卷中查找
  for v in "$HOME"/../../Volumes/omp-switch*; do
    [ -d "$v/omp-switch.app" ] && APP="$v/omp-switch.app" && break
  done
  # 1b. 尝试挂载下载目录的 dmg
  if [ -z "$APP" ]; then
    DMG=$(ls -t "$HOME"/Downloads/omp-switch*.dmg 2>/dev/null | head -1)
    if [ -n "$DMG" ]; then
      echo "→ 找到安装包: $DMG"
      echo "→ 挂载中..."
      if hdiutil attach "$DMG" -nobrowse -quiet; then
        for v in /Volumes/omp-switch*; do
          [ -d "$v/omp-switch.app" ] && APP="$v/omp-switch.app" && MOUNTED="$v" && break
        done
      else
        echo "❌ 挂载失败，请手动双击 dmg 挂载后重试"
        exit 1
      fi
    fi
  fi
fi

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "❌ 未找到应用: ${APP:-未指定}"
  echo "请先挂载 .dmg，或指定路径:"
  echo "  bash install-macos.sh /path/to/omp-switch.app"
  exit 1
fi

echo "→ 使用: $APP"
echo "→ 清除 Gatekeeper 隔离标记..."
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "→ 安装到 /Applications..."
rm -rf /Applications/omp-switch.app
cp -R "$APP" /Applications/

# 仅卸载本次脚本挂载的卷（不影响用户手动挂载的）
if [ -n "$MOUNTED" ]; then
  echo "→ 卸载安装包..."
  hdiutil detach "$MOUNTED" -quiet
fi

echo "✅ 安装完成，正在启动..."
open /Applications/omp-switch.app
