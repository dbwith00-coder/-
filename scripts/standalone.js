/* ============================================================
   단일 파일 배포본 만들기 — 집당.html
   ------------------------------------------------------------
   빌드 결과(dist)와 **소스 코드 전체**를 파일 하나로 합칩니다.
   서버도, 인터넷도, 설치도 없이 더블클릭으로 열립니다.

   담기는 것
     · 실행되는 앱 (React 번들 + 분양공고 스냅샷)
     · 여태 만든 소스 코드 전부 — 화면 맨 아래에서 펼쳐 볼 수 있습니다

   왜 파일 하나인가: 브라우저 보안 정책(CORS) 때문에 이 파일에서 직접
   공공데이터 API 를 부를 수 없습니다. 그래서 만들 때 넣어 둔 분양공고
   스냅샷을 씁니다 — 언제 수집한 자료인지 파일 맨 위 주석과 화면에
   같이 적어 둡니다. 최신으로 갱신하려면 저장소의 수집 워크플로를 돌리고
   다시 만듭니다.

   ⚠️ 성능·건수 숫자는 전부 데이터에서 읽어옵니다. 손으로 적지 않습니다 —
      배포본과 설명이 어긋나는 걸 막으려고요.

   확인: node standalone-check.mjs "$PWD/집당.html"
   ============================================================ */

import fs from "node:fs";
import path from "node:path";

/* ── 1. 번들 ──────────────────────────────────────────────── */
const assets = fs.readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
if (assets.length !== 1) {
  console.error(`dist/assets 에 js 가 ${assets.length}개입니다 — 하나로 합칠 수 없습니다.`);
  console.error("vite 설정에서 코드 분할을 껐는지 확인하세요.");
  process.exit(1);
}
const js = fs.readFileSync(path.join("dist/assets", assets[0]), "utf8");
const snap = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const news = JSON.parse(fs.readFileSync("src/data/upcoming-news.json", "utf8"));
const fit = fs.readFileSync("src/data/price-model-fit.js", "utf8");
const cv = JSON.parse(/export const FIT_CV = ([\s\S]*?);\nexport/.exec(fit)[1]);

/* ── 2. 소스 코드 모으기 ──────────────────────────────────
   자동 생성물과 수집 자료는 뺍니다 — 코드가 아니라 결과물이고,
   합쳐 놓으면 파일만 몇 배로 불어납니다(이미 번들 안에 들어 있습니다). */
const GROUPS = [
  ["화면", ["index.html", "src/main.jsx", "src/App.jsx"]],
  ["모델·API 라이브러리", ["src/lib/price-model.js", "src/lib/notices-core.js", "src/lib/openapi.js"]],
  ["수집 (GitHub Actions 에서 돕니다)",
   ["scripts/collect.js", "scripts/collect-news.js", "scripts/collect-trades.js"]],
  ["분양가 모델 학습·탐색",
   ["scripts/calibrate.js", "scripts/model-final.js", "scripts/model-tree.js",
    "scripts/model-conf.js", "scripts/model-comps.js", "scripts/model-search.js",
    "scripts/backtest.js"]],
  ["소스 탐침 (API 가 열리는지 확인)",
   ["scripts/probe.js", "scripts/probe-trades.js", "scripts/probe-lawd.js", "scripts/probe-quota.js"]],
  ["배포", ["scripts/standalone.js", "vite.config.js", "package.json"]],
  ["검사", ["verify.mjs", "check.mjs", "livetest.mjs", "community-check.mjs",
            "standalone-check.mjs", "mock.mjs", "drive.mjs", "dbg.mjs"]],
  ["워크플로", fs.existsSync(".github/workflows")
    ? fs.readdirSync(".github/workflows").map((f) => `.github/workflows/${f}`) : []],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let files = 0, bytes = 0;
const sourceHtml = GROUPS.map(([group, list]) => {
  const items = list.filter((f) => fs.existsSync(f)).map((f) => {
    const text = fs.readFileSync(f, "utf8");
    files++; bytes += text.length;
    const lines = text.split("\n").length;
    return `<details class="f"><summary><code>${esc(f)}</code>`
      + `<span class="n">${lines.toLocaleString()}줄</span></summary>`
      + `<pre>${esc(text)}</pre></details>`;
  }).join("\n");
  return items ? `<section><h3>${esc(group)}</h3>${items}</section>` : "";
}).filter(Boolean).join("\n");

/* ── 3. 합치기 ────────────────────────────────────────────── */
const NAME = { 5: "높음     ", 4: "보통     ", 3: "낮음     ", 2: "매우 낮음" };
const perf = [5, 4, 3, 2].filter((d) => cv.byDepth[d]).map((d) =>
  `    신뢰도 ${NAME[d]} 평균 ${String(cv.byDepth[d].mae).padStart(5)}%`
  + ` · 범위 ±${Math.round(cv.byDepth[d].p80)}%  (${cv.byDepth[d].n}건)`).join("\n");

const OUT = "집당.html";
fs.writeFileSync(OUT, `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<title>집당 · 청약 입주설계</title>
<!--
  집당 — 청약 가점 계산 · 전국 분양공고 조회 · 분양예정가 추정
  ------------------------------------------------------------
  이 파일 하나로 돕니다. 인터넷 없이 열어도 됩니다.
  (더블클릭하거나 브라우저 창에 끌어다 놓으세요)

  담긴 것
    · 청약 가점 계산기 — 청약홈 공식 배점표 기준
    · 분양공고 ${snap.sites.length}건 — 수집 시각 ${snap.collectedAt}
    · 분양 예정 현장 ${news.candidates.length}곳 — 뉴스에서 추림 (공식 자료 아님)
    · 분양예정가 추정 모델 — 실제 분양가 공고 ${cv.all.n}건으로 학습
    · 커뮤니티 게시판 — 글·댓글이 이 브라우저에 저장됩니다
    · 소스 코드 ${files}개 파일 — 화면 맨 아래에서 펼쳐 볼 수 있습니다

  분양예정가 정확도 (공고 단위 5겹 교차검증, 학습에 안 쓴 공고로 측정)
    전체        평균 ${cv.all.mae}% · 중앙 ${cv.all.p50}%
${perf}

  ⚠️ 분양공고는 **수집 시점의 스냅샷**입니다. 브라우저 보안 정책상 이
     파일에서 직접 API 를 부를 수 없어, 만들 때 넣어 둔 자료를 씁니다.
  ⚠️ 분양예정가는 추정입니다. 현장마다 신뢰도 등급과 오차범위를 같이
     표시하니 그 폭을 꼭 함께 보세요.
  ⚠️ 커뮤니티 글은 이 브라우저에만 저장됩니다. 다른 사람에게는 안 보입니다.

  최신 자료로 갱신 · 저장소: https://github.com/dbwith00-coder/jipdang-cheongyak
-->
<style>
  #src { max-width: 860px; margin: 48px auto 80px; padding: 0 20px;
         font: 14px/1.7 ui-sans-serif, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
         color: #3A3226; }
  #src > summary { cursor: pointer; font-weight: 800; font-size: 15px; padding: 14px 0;
                   border-top: 1px solid rgba(0,0,0,.12); letter-spacing: -.02em; }
  #src h3 { font-size: 13px; margin: 26px 0 8px; color: #8A7E6A;
            text-transform: none; letter-spacing: .04em; }
  #src .f { border: 1px solid rgba(0,0,0,.1); border-radius: 10px; margin-bottom: 6px;
            background: rgba(0,0,0,.015); }
  #src .f > summary { cursor: pointer; padding: 9px 13px; display: flex;
                      justify-content: space-between; gap: 12px; align-items: baseline; }
  #src .f code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
  #src .n { font-size: 11.5px; color: #8A7E6A; white-space: nowrap; }
  #src pre { margin: 0; padding: 13px; border-top: 1px solid rgba(0,0,0,.08);
             overflow-x: auto; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
             white-space: pre; tab-size: 2; }
  #src .note { font-size: 12.5px; color: #8A7E6A; margin: 10px 0 0; }
  @media (prefers-color-scheme: dark) {
    #src { color: #E6DFD2; }
    #src > summary { border-top-color: rgba(255,255,255,.16); }
    #src h3, #src .n, #src .note { color: #9C9282; }
    #src .f { border-color: rgba(255,255,255,.14); background: rgba(255,255,255,.03); }
    #src pre { border-top-color: rgba(255,255,255,.1); }
  }
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${js}
</script>

<details id="src">
<summary>소스 코드 전체 · ${files}개 파일 · ${Math.round(bytes / 1024).toLocaleString()}KB</summary>
<p class="note">
  이 파일을 만든 코드 전부입니다. 수집 스크립트는 브라우저가 아니라
  GitHub Actions 에서 돕니다 — 여기서는 읽기용입니다.
  자동 생성물(학습 결과·수집 자료)은 이미 위 번들 안에 들어 있어 뺐습니다.
</p>
${sourceHtml}
</details>
</body>
</html>
`, "utf8");

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`${OUT} 생성 (${mb}MB)`);
console.log(`  분양공고 ${snap.sites.length}건 · 수집 ${snap.collectedAt}`);
console.log(`  분양 예정 현장 ${news.candidates.length}곳`);
console.log(`  추정 오차 평균 ${cv.all.mae}% · 중앙 ${cv.all.p50}%`);
console.log(`  소스 코드 ${files}개 파일 · ${Math.round(bytes / 1024)}KB 동봉`);
console.log(`\n확인: node standalone-check.mjs "$PWD/${OUT}"`);
