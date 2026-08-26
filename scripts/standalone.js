/* ============================================================
   단일 파일 배포본 만들기 — 집당.html
   ------------------------------------------------------------
   빌드 결과(dist)를 파일 하나로 합칩니다. 서버도, 인터넷도 필요 없이
   더블클릭으로 열리는 파일입니다.

   왜 파일 하나인가: 브라우저 보안 정책(CORS) 때문에 이 파일에서 직접
   공공데이터 API 를 부를 수 없습니다. 그래서 만들 때 넣어 둔 분양공고
   스냅샷을 씁니다 — 언제 수집한 자료인지 파일 맨 위 주석과 화면에
   같이 적어 둡니다. 최신으로 갱신하려면 저장소의 수집 워크플로를 돌리고
   다시 만듭니다.

   확인: node standalone-check.mjs "$PWD/집당.html"
   ============================================================ */

import fs from "node:fs";
import path from "node:path";

const assets = fs.readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
if (assets.length !== 1) {
  console.error(`dist/assets 에 js 가 ${assets.length}개입니다 — 하나로 합칠 수 없습니다.`);
  console.error("vite 설정에서 코드 분할을 껐는지 확인하세요.");
  process.exit(1);
}
const js = fs.readFileSync(path.join("dist/assets", assets[0]), "utf8");
const snap = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const news = JSON.parse(fs.readFileSync("src/data/upcoming-news.json", "utf8"));

/* 성능 숫자는 학습 결과에서 그대로 읽어옵니다 — 손으로 적지 않습니다 */
const fit = fs.readFileSync("src/data/price-model-fit.js", "utf8");
const cv = JSON.parse(/export const FIT_CV = ([\s\S]*?);\nexport/.exec(fit)[1]);

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

  분양예정가 정확도 (공고 단위 5겹 교차검증, 학습에 안 쓴 공고로 측정)
    전체        평균 ${cv.all.mae}% · 중앙 ${cv.all.p50}%
${[5, 4, 3, 2].filter((d) => cv.byDepth[d]).map((d) => {
  const N = { 5: "높음     ", 4: "보통     ", 3: "낮음     ", 2: "매우 낮음" }[d];
  return `    신뢰도 ${N} 평균 ${String(cv.byDepth[d].mae).padStart(5)}% · 범위 ±${Math.round(cv.byDepth[d].p80)}%  (${cv.byDepth[d].n}건)`;
}).join("\n")}

  ⚠️ 분양공고는 **수집 시점의 스냅샷**입니다. 브라우저 보안 정책상 이
     파일에서 직접 API 를 부를 수 없어, 만들 때 넣어 둔 자료를 씁니다.
  ⚠️ 분양예정가는 추정입니다. 현장마다 신뢰도 등급과 오차범위를 같이
     표시하니 그 폭을 꼭 함께 보세요.

  최신 자료로 갱신 · 소스: https://github.com/dbwith00-coder/jipdang-cheongyak
-->
</head>
<body>
<div id="root"></div>
<script type="module">
${js}
</script>
</body>
</html>
`, "utf8");

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`${OUT} 생성 (${mb}MB)`);
console.log(`  분양공고 ${snap.sites.length}건 · 수집 ${snap.collectedAt}`);
console.log(`  분양 예정 현장 ${news.candidates.length}곳`);
console.log(`  추정 오차 평균 ${cv.all.mae}% · 중앙 ${cv.all.p50}%`);
console.log(`\n확인: node standalone-check.mjs "$PWD/${OUT}"`);
