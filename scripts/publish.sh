#!/usr/bin/env bash
# publish.sh — 매주 발행 한 방 스크립트 (macOS/Linux/CI)
# 사용법:  ai-trend-research 스킬로 새 호 생성 후 →  bash scripts/publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # = ai-trend/

echo "▶ 사이트 빌드..."
node scripts/build_site.mjs

if [ -z "$(git status --porcelain)" ]; then
  echo "변경 사항 없음 — 발행 건너뜀."
  exit 0
fi

git add -A
git commit -m "Publish: $(date +%F) 호 게시 및 사이트 갱신"
git push
echo "✓ 발행 완료 — 배포는 1~2분 내 자동 반영됩니다."
