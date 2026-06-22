# publish.ps1 — 매주 발행 한 방 스크립트 (Windows)
# 사용법:  ai-trend-research 스킬로 새 호 생성 후 →  pwsh scripts/publish.ps1
# 하는 일: 사이트 재빌드 → 변경분 커밋 → push (GitHub/Cloudflare가 자동 배포)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)   # = ai-trend/

Write-Host "▶ 사이트 빌드..." -ForegroundColor Cyan
node scripts/build_site.mjs

# 변경 사항이 없으면 종료
$changes = git status --porcelain
if (-not $changes) {
  Write-Host "변경 사항 없음 — 발행 건너뜀." -ForegroundColor Yellow
  exit 0
}

$date = Get-Date -Format "yyyy-MM-dd"
git add -A
git commit -m "Publish: $date 호 게시 및 사이트 갱신"
git push

Write-Host "✓ 발행 완료 — 배포는 1~2분 내 자동 반영됩니다." -ForegroundColor Green
