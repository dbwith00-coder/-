/* ============================================================
   분양가 추정 모델 백테스트
   ------------------------------------------------------------
   과거에 실제로 분양된 단지를 "그 시점 조건"으로 넣어보고,
   추정값이 실제 분양가와 얼마나 차이 나는지 봅니다.

   ⚠️ 파라미터를 정답에 맞춰 깎으면 백테스트는 의미가 없습니다.
      아래 케이스들은 price-model.js 를 손대지 않은 상태로 돌립니다.
   ============================================================ */

import fs from "node:fs";
import { estimatePrice } from "../src/lib/price-model.js";
import { PY_PRICE_META } from "../src/data/py-price.js";

/* 실제 분양 사례 — 공개 보도된 값 */
const CASES = [
  { n: "e편한세상 용인한숲시티 5단지", region: "남사", brand: "e편한세상",
    year: 2015, py: 34, capped: false, actual: 27700,
    src: "2015.10 분양 · 84㎡ 약 2억 7,700만원 · 평당 790만원대" },
  { n: "과천 지식정보타운 (지정타)", region: "과천", brand: "일반",
    year: 2020, py: 34, capped: true, actual: 77000,
    src: "2020 분양 · 84㎡ 7.3~8.2억 구간의 중간값" },
  { n: "검단신도시 신규 분양", region: "검단", brand: "일반",
    year: 2024, py: 34, capped: true, actual: 52000,
    src: "2024 검단 84㎡ 4.9~5.8억 구간의 중간값" },
];

const won = (n) => `${(n / 10000).toFixed(2)}억`;

console.log("분양가 추정 모델 백테스트\n" + "─".repeat(74));
let sumAbs = 0, hit = 0;

for (const c of CASES) {
  const e = estimatePrice({ region: c.region, brand: c.brand, py: c.py, year: c.year, capped: c.capped });
  const err = (e.total - c.actual) / c.actual * 100;
  const inRange = c.actual >= e.lo && c.actual <= e.hi;
  sumAbs += Math.abs(err);
  if (inRange) hit++;

  console.log(`\n▸ ${c.n}  (${c.year}년)`);
  console.log(`   ${c.src}`);
  console.log(`   택지비 ${e.landPy.toLocaleString()}만/평 (${e.labels.land})`
    + ` + 건축비 ${e.constPy.toLocaleString()}만/평 (${e.labels.brand})`);
  console.log(`   × (1 + ${Math.round(e.margin * 100)}% ${e.labels.margin}) = 평당 ${e.pyPrice.toLocaleString()}만`);
  console.log(`   × ${c.py}평 = 추정 ${won(e.total)}   [범위 ${won(e.lo)} ~ ${won(e.hi)}]`);
  console.log(`   실제 ${won(c.actual)}  →  오차 ${err >= 0 ? "+" : ""}${err.toFixed(1)}%`
    + `  ${inRange ? "· 범위 안 ✅" : "· 범위 밖 ❌"}`);
}

console.log("\n" + "─".repeat(74));
console.log(`과거 사례 ${CASES.length}건 — 평균 절대오차 ${(sumAbs / CASES.length).toFixed(1)}% · 범위 적중 ${hit}/${CASES.length}`);
console.log("과거 사례는 표본이 적고 시점 보정 지수까지 얹혀 있어 참고용입니다.\n");

/* 진짜 성능은 "지금 공고" 를 맞히는 정확도입니다 — 표본이 훨씬 많습니다 */
const m = PY_PRICE_META.stats;
console.log("─".repeat(74));
console.log(`현재 공고 실측 대조 — 관측 ${PY_PRICE_META.samples}건 / 공고 ${PY_PRICE_META.notices}건`);
console.log(`  평균 절대오차 ${m.mae}% · 중앙 ${m.p50}% · 80분위 ${m.p80}% · 90분위 ${m.p90}%`);
for (const [b, v] of Object.entries(m.within)) console.log(`  ±${String(b).padStart(2)}% 안에 ${v}%`);
console.log(`\n표시 범위는 80분위(±${m.p80}%)를 씁니다 — 임의로 정한 값이 아닙니다.`);
