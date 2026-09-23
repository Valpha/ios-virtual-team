#!/bin/bash
# scaffold.sh — 在项目目录铺开 iOS 虚拟团队（team-init 技能的机械步骤部分）
# 用法: scaffold.sh <project-dir> [team-dir]
set -euo pipefail

PROJ="${1:?usage: scaffold.sh <project-dir> [team-dir]}"
TEAM="${2:-$HOME/.zcode/team}"
cd "$PROJ"

# 1. 团队层软链接
if [ -L .team ]; then
  cur=$(readlink .team)
  if [ "$cur" != "$TEAM" ]; then
    echo "WARN: .team -> $cur 与 $TEAM 不一致，保留现状"
  else
    echo "OK .team 链接已存在"
  fi
elif [ -e .team ]; then
  echo "ERROR: .team 是实体目录（旧式铺开）。请先把内容并入 $TEAM 并删除后重试。" >&2
  exit 1
else
  ln -s "$TEAM" .team
  echo "OK .team -> $TEAM"
fi

# 2. 目录骨架（项目工件柜 + 项目层差分目录）
for d in docs/specs docs/architecture/adr design/ui-specs reports releases \
         .team.local/roles .team.local/workflows; do
  mkdir -p "$d"
  touch "$d/.gitkeep"
done
echo "OK 目录骨架完成（docs/ design/ reports/ releases/ .team.local/）"

# 3. gitignore 软链接（机器本地）
touch .gitignore
if ! grep -qx '.team' .gitignore; then
  printf '\n# 团队层软链接（机器本地；跨机器克隆后运行 /team-init 恢复）\n.team\n' >> .gitignore
  echo "OK .gitignore 已追加 .team"
fi

# 4. 项目宪法
if [ ! -f AGENTS.md ]; then
  cp "$TEAM/scaffold/AGENTS.md.tmpl" AGENTS.md
  echo "OK AGENTS.md 已生成（含占位符，待 team-init 对话步骤填写）"
else
  echo "NOTE AGENTS.md 已存在，跳过模板（请手工合并缺失的团队规则节）"
fi

echo "DONE scaffold 完成"
