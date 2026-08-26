/* ============================================================
   분양가 모델 학습 — 실제 분양가에서 계수를 뽑습니다
   ------------------------------------------------------------
   scripts/model-search.js 로 여러 구성을 공고 단위 교차검증해 고른 결과를
   여기서 전체 데이터에 다시 학습시켜 src/data/price-model-fit.js 로 냅니다.

   구조:
     평당가 = 지역계층(축소) × f(읍면리) × f(공급유형) × f(평형대)
              × f(단지규모) × f(상한제) × f(브랜드) × f(정비사업)

   지역계층: 주소를 토큰 경로로 보고 뿌리→잎으로 값을 물려주되,
   표본이 적은 잎은 부모 쪽으로 끌어당깁니다(축소계수 K).
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const K_SHRINK = 3;                 /* 교차검증으로 고른 값 */
const MIN_FACTOR_N = 12;

/* 분양가 성격이 다른 유형은 학습에서 제외 */
const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;
const HIGH_END = /아크로|디에이치|르엘|오티에르|트리마제|원베일리|블레스티지|써밋|라클래시/;
const TIER1 = /자이|래미안|힐스테이트|푸르지오|편한세상|롯데캐슬|더샵|아이파크|위브|SK뷰|포레나|한신더휴|호반|우미린/;

const PY_PER_M2 = 1.35 / 3.3058;
const pyOf = (t) => {
  const m = String(t).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) * PY_PER_M2 : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

export function featuresOf(site) {
  const brandText = `${site.brand || ""} ${site.n || ""}`;
  const total = site.total || 0;
  const gu = String(site.gu || "");
  return {
    path: gu.split(/\s+/).filter(Boolean).slice(0, 4),
    rural: /[면리]$|면 |리 /.test(gu) ? "읍면리" : /동$|동 |가$/.test(gu) ? "동" : "기타",
    supply: site.supply || "민영",
    size: total >= 1500 ? "초대형" : total >= 700 ? "대단지" : total >= 300 ? "중형" : "소규모",
    capped: (site.tags || []).includes("분양가상한제") ? "Y" : "N",
    redev: (site.tags || []).includes("정비사업") ? "Y" : "N",
    tier: HIGH_END.test(brandText) ? "하이엔드" : TIER1.test(brandText) ? "1군" : "일반",
  };
}

const obs = [];
for (const s of SNAP.sites) {
  if (s.scoreless || NOT_SALE.test(s.n)) continue;
  const f = featuresOf(s);
  if (!f.path.length) continue;
  for (const t of s.types || []) {
    const py = pyOf(t.t);
    if (!py || !t.price || py < 15 || py > 50) continue;
    const pyPrice = t.price / py;
    if (pyPrice < 300 || pyPrice > 12000) continue;
    obs.push({ ...f, py, pyPrice,
      pyBand: py < 22 ? "소형" : py < 30 ? "중소형" : py < 38 ? "국민" : "대형" });
  }
}
console.log(`학습 관측 ${obs.length}건`);

/* ── 지역 계층 ────────────────────────────────────────────── */
const nodes = new Map();
for (const o of obs) {
  for (let i = 0; i <= o.path.length; i++) {
    const k = o.path.slice(0, i).join(" ");
    (nodes.get(k) ?? nodes.set(k, []).get(k)).push(Math.log(o.pyPrice));
  }
}
const region = {};
const counts = {};
for (const k of [...nodes.keys()].sort((a, b) => a.split(" ").length - b.split(" ").length)) {
  const v = nodes.get(k);
  const parentKey = k.split(" ").slice(0, -1).join(" ");
  const parent = k === "" ? null : region[parentKey];
  const m = mean(v);
  region[k] = parent == null ? m : (v.length * m + K_SHRINK * parent) / (v.length + K_SHRINK);
  counts[k] = v.length;
}
const baseOf = (path) => {
  for (let i = path.length; i >= 0; i--) {
    const k = path.slice(0, i).join(" ");
    if (region[k] != null) return { logPy: region[k], key: k || "전국", n: counts[k] };
  }
  return { logPy: region[""], key: "전국", n: counts[""] };
};

/* ── 곱셈 보정 ────────────────────────────────────────────── */
const STEPS = ["rural", "supply", "pyBand", "size", "capped", "tier", "redev"];
const factors = [];
for (const key of STEPS) {
  const buckets = {};
  for (const o of obs) {
    let pred = Math.exp(baseOf(o.path).logPy);
    for (const f of factors) pred *= f.tab[o[f.key]] ?? 1;
    (buckets[o[key]] ??= []).push(Math.log(o.pyPrice / pred));
  }
  const tab = {};
  for (const [k, v] of Object.entries(buckets)) {
    if (v.length < MIN_FACTOR_N) continue;
    tab[k] = +Math.exp(mean(v)).toFixed(4);
  }
  factors.push({ key, tab });
}

/* ── 저장 ─────────────────────────────────────────────────── */
const SEARCH = JSON.parse(fs.readFileSync("data/model-search.json", "utf8"));
/* tuned = 실사용 지표(공고 하나당 국민평형 1건, 지역+브랜드만 알고 예측)를
   공고 단위 5겹 교차검증한 결과. 이 숫자만 화면에 씁니다. */
const CV = SEARCH.tuned ?? SEARCH.national ?? SEARCH.chosen ?? null;
const out = `/* 자동 생성 — scripts/calibrate.js
   청약홈 실제 분양가 ${obs.length}건(공고 ${new Set(obs.map((o) => o.path.join(" "))).size}개 지역)으로
   학습한 분양가 모델. 손으로 고치지 마세요.
   수집이 갱신되면 npm run calibrate 로 다시 만듭니다.

   성능(공고 단위 5겹 교차검증 — 학습에 안 쓴 공고를 지역+브랜드만 보고 예측):
     평균 절대오차 ${CV?.mae ?? "-"}% · 중앙 ${CV?.p50 ?? "-"}% · ±10% 안 ${CV?.w10 ?? "-"}% */
export const FIT_META = ${JSON.stringify({
  at: new Date().toISOString(), samples: obs.length, kShrink: K_SHRINK,
}, null, 2)};
export const FIT_CV = ${JSON.stringify(CV, null, 2)};
export const FIT_REGION = ${JSON.stringify(Object.fromEntries(
  Object.entries(region).map(([k, v]) => [k, +v.toFixed(5)])), null, 0)};
export const FIT_REGION_N = ${JSON.stringify(counts, null, 0)};
export const FIT_FACTORS = ${JSON.stringify(factors, null, 2)};
`;
fs.writeFileSync("src/data/price-model-fit.js", out, "utf8");
console.log(`지역 노드 ${Object.keys(region).length}개 · 보정 ${factors.length}종`);
for (const f of factors) {
  console.log(`  ${f.key.padEnd(8)} ` + Object.entries(f.tab).map(([k, v]) => `${k} \u00d7${v}`).join("  "));
}
console.log(`교차검증 평균 ${CV?.mae}% · 중앙 ${CV?.p50}% · \u00b110% 안 ${CV?.w10}%`);
console.log("src/data/price-model-fit.js 생성");
