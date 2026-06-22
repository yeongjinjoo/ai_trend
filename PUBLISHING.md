# 전 세계 배포 셋업 가이드

매주 만드는 4개 언어(EN·中文·日本語·한국어) AI 트렌드 자료를 **한 번 세팅해두면 자동으로 웹 게시 → RSS 갱신 → 뉴스레터 발송 → 소셜 게시**까지 굴러가게 하는 가이드입니다.

> **핵심 아이디어:** 모든 자동화의 척추는 **RSS 피드**(`feed-en.xml` 등)입니다. 새 호가 사이트에 올라가면 RSS가 갱신되고, 뉴스레터·크로스포스트 도구들이 그 RSS를 보고 알아서 움직입니다. 그래서 매주 할 일은 "스킬 실행 + 발행 스크립트 한 번"이 전부입니다.

```
매주 루틴 (≈ 2분):
  1) ai-trend-research 스킬로 4개 언어 새 호 생성   ← 기존과 동일
  2) pwsh scripts/publish.ps1                       ← 빌드+커밋+푸시 (끝)
        → GitHub/Cloudflare 자동 배포
        → RSS 갱신 → beehiiv 자동 메일 발송 → dev.to/X/LinkedIn/Bluesky 자동 게시
```

---

## 1단계 — 일회성 셋업 (한 번만)

### A. 설정값 채우기
[`scripts/build_site.mjs`](scripts/build_site.mjs) 상단 `SITE` 객체에서:
- `url` — 배포 후 실제 주소로 교체 (예: `https://ai-weekly.pages.dev`). **B/C 단계 후에 확정**되니 일단 그대로 두고 진행해도 됩니다.
- `brandLatin` — 대표 영문 표기 (로고/OG용). 퍼블리케이션 이름 확정 시 변경.
- `publisher.name`, `publisher.url` — 개인 브랜드용 이름/링크(LinkedIn 등). 채우면 푸터에 자동 표시.
- `subscribeUrl` — 비워두세요. **E단계(뉴스레터)** 후에 구독 페이지 주소를 넣습니다.

언어별 표시 이름(`이번 주 AI 트렌드` 등)도 같은 파일 `LANG_META`에서 한곳에 모여 있어 바꾸기 쉽습니다.

### B. GitHub에 올리기 (소스 보관 + 자동 배포 트리거)
자료는 공개 출처 기반이라 **공개(public) 저장소**로 두면 됩니다.
```powershell
# ai-trend 폴더에서 (이미 git init/최초 커밋은 되어 있음)
git remote add origin https://github.com/<당신아이디>/ai-trend.git
git branch -M main
git push -u origin main
```
> GitHub 계정/저장소가 아직 없으면: github.com에서 New repository → 이름 `ai-trend` → Public → 생성 후 위 명령.

### C. 호스팅 — 둘 중 하나 (둘 다 무료)

**옵션 1: Cloudflare Pages (권장 — 글로벌 CDN, 중국 접근성↑)**
1. dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git → `ai-trend` 저장소 선택
2. 빌드 설정: **Build command** = `node scripts/build_site.mjs`, **Output directory** = `/` (루트)
3. 환경변수 `SITE_URL` = 배포될 주소(처음엔 `https://ai-trend.pages.dev` 형태, 나중에 커스텀 도메인으로 변경 가능)
4. Deploy → 몇 분 뒤 공개 URL 발급

**옵션 2: GitHub Pages (가장 단순, 워크플로 포함됨)**
1. 저장소 → Settings → Pages → **Source: GitHub Actions**
2. (선택) Settings → Secrets and variables → Actions → Variables 에 `SITE_URL` 추가 = `https://<아이디>.github.io/ai-trend`
3. push하면 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)가 자동 빌드·배포

> **커스텀 도메인**(약 1.2만원/년, 신뢰도↑)은 어느 쪽이든 나중에 연결 가능. 연결하면 `SITE_URL`만 그 도메인으로 바꾸면 됩니다.

### D. 주소 확정 후 한 번 더
배포 URL이 확정되면 `SITE.url`(또는 호스팅의 `SITE_URL` 변수)을 그 주소로 맞추고 다시 push → RSS/sitemap/OG의 절대 경로가 정확해집니다.

### E. 뉴스레터 — 구독자 기반 (beehiiv 권장)
beehiiv는 **RSS-to-email 자동 발송**이 내장돼 있어 near-zero에 최적입니다.
1. beehiiv.com 가입 → publication 생성 (무료 티어)
2. Settings → **RSS to Email (Automations)** → 피드 URL에 `https://<당신주소>/feed-en.xml` 입력 → "새 항목이 올라오면 자동 발송" 켜기
3. 언어별로 운영하려면 publication을 나누거나, 통합 1개로 시작했다가 구독자가 늘면 분리
4. 발급된 **구독 페이지 URL**을 `SITE.subscribeUrl`에 넣고 push → 사이트 상단 "구독" 버튼이 거기로 연결됨

> Substack도 가능하지만 RSS 자동발송이 약해 매주 수동 작업이 생깁니다. near-zero 목표엔 beehiiv가 유리.

### F. 자동 크로스포스트 — 도달 확대 (전부 RSS/예약 기반, 손 안 댐)
- **dev.to** → Settings → Extensions → "Publishing to DEV from RSS"에 `feed-en.xml` 등록 (canonical 자동 처리로 SEO 중복 회피)
- **Medium** → 설정의 RSS import 또는 Zapier "RSS → Medium"
- **X(트위터)·LinkedIn** → Buffer 또는 Typefully 무료 플랜에서 RSS 연결 → 새 글 자동 예약 게시
- **Bluesky·Mastodon** → `feedcraft`/`buffer` 같은 RSS 봇으로 자동 게시 (AI 커뮤니티 활발, 자동화 친화적)

### G. 검색 노출 (SEO) — 4개 언어가 가장 큰 무기
zh/ja/ko는 영어권보다 AI 뉴스레터 검색 경쟁이 훨씬 낮습니다. sitemap만 제출하면 됩니다.
1. Google Search Console에 사이트 등록 → `sitemap.xml` 제출
2. Bing Webmaster Tools에도 동일하게 제출
3. 며칠 뒤 4개 언어가 각각 색인되는지 확인 (hreflang가 "같은 글의 4개 언어판"임을 구글에 알려 줌)

---

## 2단계 — 매주 발행 (near-zero)
```powershell
pwsh scripts/publish.ps1     # (macOS/Linux: bash scripts/publish.sh)
```
이게 전부입니다. 나머지(배포·메일·소셜)는 RSS를 통해 자동으로 일어납니다.

> **완전 무인화(선택):** `/schedule` 스킬로 "매주 월요일 ai-trend-research 실행 + publish"를 예약하면 손도 안 대도 매주 발행됩니다.

---

## 3단계 — 런칭 부스트 (딱 한 번, 수동, ROI 최고)
첫 공개 때만 직접 한 바퀴 돌리면 초기 구독자 + 백링크가 쌓여 SEO가 부팅됩니다. 이후엔 다시 0으로 복귀.
- **영어권:** Hacker News (Show HN), Reddit r/artificial · r/MachineLearning (자기홍보 규칙 확인)
- **중화권:** 知乎(Zhihu), 掘金(Juejin), WeChat 공众号
- **일본:** Qiita, Zenn, note.com
- **한국:** 브런치, velog, LinkedIn

> Reddit·HN은 자동화하면 밴 위험이 있어 **의도적으로 수동·일회성**으로만 둡니다.

---

## 4단계 — 수익화 (트래픽/구독 쌓인 뒤, 저터치)
- beehiiv 광고 네트워크·Boosts (자동) → 구독 1~2천 넘으면 스폰서십
- 푸터 제휴(affiliate) 링크, "Buy me a coffee" 후원, 선택적 유료 티어
- 기존 PPTX 덱을 SlideShare/SpeakerDeck에 올려 추가 검색 유입

---

## 부록

### 파일 구조
```
ai-trend/
├── index.html              ← 자동 생성 (다국어 아카이브/랜딩)
├── feed-{en,zh,ja,ko}.xml  ← 자동 생성 (RSS, 자동화 척추)
├── sitemap.xml, robots.txt ← 자동 생성 (SEO)
├── og-default.svg          ← 자동 생성 (공유 썸네일)
├── scripts/
│   ├── build_site.mjs      ← 빌더 (설정도 여기 상단)
│   ├── publish.ps1 / .sh   ← 매주 발행 한 방
├── .github/workflows/deploy.yml
└── YYYY-MM-DD/{lang}/...    ← 기존 콘텐츠 (스킬이 생성)
```

### 자주 묻는 것
- **OG 썸네일이 일부 SNS(Facebook/LinkedIn)에서 안 보임:** 그쪽은 SVG OG를 잘 지원하지 않습니다. 더 넓은 호환이 필요하면 `og-default.svg`를 1200×630 **PNG**로 변환해 `og-default.png`로 저장하고 `SITE.ogImage`를 `'og-default.png'`로 바꾸세요.
- **링크가 깨짐/절대경로가 example.pages.dev로 나옴:** `SITE.url`(또는 `SITE_URL`)을 실제 배포 주소로 맞추고 다시 빌드/푸시.
- **로컬 미리보기:** `node scripts/build_site.mjs` 실행 후 `index.html`을 브라우저로 열기. (절대 URL 검증까지 하려면 `SITE_URL=http://localhost:8000 node scripts/build_site.mjs` 후 `npx serve` 등으로 서빙)
