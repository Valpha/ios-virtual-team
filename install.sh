#!/bin/bash
# install.sh — iOS 虚拟团队接入/更新脚本（同事机器上运行；幂等，可重复执行）
# 前置：把本仓库 clone 到任意位置，进入仓库目录执行 bash install.sh
# 用法: bash install.sh [团队层目标路径，默认 ~/.zcode/team]
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
TEAM="${1:-$HOME/.zcode/team}"

# 1. 团队层：若仓库不在默认位置，软链过去（单一事实源；pull 即全员更新）
if [ "$SRC" != "$TEAM" ]; then
  if [ -e "$TEAM" ] && [ ! -L "$TEAM" ]; then
    echo "ERROR: $TEAM 已存在且不是软链接。若是旧副本请先确认无本地修改后删除，再重跑。" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$TEAM")"
  ln -sfn "$SRC" "$TEAM"
fi
echo "OK 团队层: $TEAM"

# 2. 机制层：技能注册（软链仓库内 skills/ → ~/.zcode/skills/）
mkdir -p "$HOME/.zcode/skills"
for s in "$SRC"/skills/*/; do
  name="$(basename "$s")"
  target="$HOME/.zcode/skills/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "NOTE 跳过技能 $name（~/.zcode/skills/ 已有同名实体目录）"
  else
    ln -sfn "${s%/}" "$target"
  fi
done
echo "OK 技能: $(ls "$SRC"/skills | tr '\n' ' ')"

# 3. 流水线：注册到全局存档，支持按名运行（软链 → 逻辑跟随仓库版本）
mkdir -p "$HOME/.zcode/workflows"
for w in "$SRC"/workflows/*.ts; do
  [ -e "$w" ] || continue
  name="$(basename "$w" .ts)"
  ln -sfn "$w" "$HOME/.zcode/workflows/$name.dwf.ts"
done
echo "OK 按名流水线: $(ls "$HOME/.zcode/workflows"/*.dwf.ts 2>/dev/null | xargs -n1 basename | tr '\n' ' ')"

cat <<'EOF'

安装/更新完成。下一步：
  1. 在你的项目目录运行 /team-init 铺开团队（.team 链接 + .team.local + 目录骨架）
  2. 流水线两种跑法：项目内按章程 path 方式（参数经 resolve --config 合并），
     或任意位置按名运行（CreateWorkflow saved: {name, args}）
  3. 更新：git pull && bash install.sh（幂等）；各项目跑 .team/scripts/resolve --check 看冲突
EOF
