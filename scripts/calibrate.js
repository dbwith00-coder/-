/* ============================================================
   분양가 추정 모델 캘리브레이션
   ------------------------------------------------------------
   지역별 택지비를 "시장 상황을 보고 정한" 값으로 쓰다가, 실제 분양가가
   붙은 청약홈 공고로 검증해 보니 평균 오차가 28% 였습니다.
   추측을 버리고 실측에서 뽑습니다.

   시군구 단위로 쪼개면 오차가 13% 대로 떨어집니다. 광역 9개 버킷으로는
   같은 "경기 남부" 안에 과천과 평택이 같이 들어가서 설명이 안 됩니다.

   결과물: src/data/py-price.js  (앱과 스크립트가 함께 import)
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));

/* 전용 ㎡ → 공급 평. 전용 84 ≈ 공급 112㎡ ≈ 34평 */
const PY_PER_M2 = 1.35 / 3.3058;
const pyOf = (typeLabel) => {
  const m = String(typeLabel).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) * PY_PER_M2 : 0;
};
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};

/* ── 1. 관측치 ─────────────────────────────────────────────
   펜트하우스·초소형은 평당가가 튀어서 15~50평만 씁니다. */
const obs = [];
for (const s of SNAP.sites) {
  if (s.scoreless) continue;                      /* 무순위는 가격 성격이 다름 */
  const tok = String(s.gu || "").split(/\s+/);
  const sgg = tok.slice(0, 2).join(" ");
  /* 용인시 하나로 묶으면 처인(외곽)과 수지(고가)가 섞여 설명이 안 됩니다.
     시 아래 구가 있으면 그 단위까지 따로 잡습니다. */
  const fine = tok[2] && /구$/.test(tok[2]) ? tok.slice(0, 3).join(" ") : "";
  if (!sgg) continue;
  for (const t of s.types || []) {
    const py = pyOf(t.t);
    if (!py || !t.price || py < 15 || py > 50) continue;
    const pyPrice = t.price / py;
    if (pyPrice < 300 || pyPrice > 12000) continue;
    obs.push({ sgg, fine, pyPrice, n: s.n, capped: (s.tags || []).includes("분양가상한제") });
  }
}
console.log(`관측치 ${obs.length}건 · 공고 ${new Set(obs.map((o) => o.n)).size}건\n`);

/* ── 2. 시군구별 중앙값 ───────────────────────────────────── */
const bySgg = new Map();
const byFine = new Map();
for (const o of obs) {
  if (!bySgg.has(o.sgg)) bySgg.set(o.sgg, []);
  bySgg.get(o.sgg).push(o.pyPrice);
  if (o.fine) {
    if (!byFine.has(o.fine)) byFine.set(o.fine, []);
    byFine.get(o.fine).push(o.pyPrice);
  }
}
const MIN_N = 3;
const regions = {};
for (const [sgg, v] of bySgg) {
  if (v.length < MIN_N) continue;
  regions[sgg] = { pyPrice: Math.round(median(v)), n: v.length };
}
/* 구 단위는 별도 표 — 조회할 때 먼저 봅니다 */
const fineRegions = {};
for (const [k, v] of byFine) {
  if (v.length < MIN_N) continue;
  fineRegions[k] = { pyPrice: Math.round(median(v)), n: v.length };
}
const globalPy = Math.round(median(obs.map((o) => o.pyPrice)));

/* ── 3. 지역 키워드 → 시군구 매핑 ──────────────────────────
   뉴스 후보에는 주소가 없고 "천안", "반포" 같은 단어만 나옵니다.
   시군구 이름에서 접미사를 떼어 검색어를 만들어 둡니다. */
const aliases = {};
const aliasesFine = {};
for (const [sgg, info] of Object.entries(regions)) {
  const [sido, gugun] = sgg.split(/\s+/);
  const bare = String(gugun || "").replace(/(특별자치)?[시군구]$/, "");
  /* 한 글자 별칭은 위험합니다. "서구" → "서" 로 만들면
     "서울대입구" 가 인천 서구로 잡힙니다. 두 글자 이상만 씁니다. */
  if (bare.length < 2) continue;
  /* 같은 이름이 여러 시도에 있으면(광주광역시 / 경기도 광주시)
     표본이 많은 쪽을 기본으로 두고, 다른 쪽은 시도까지 붙여 구분합니다. */
  const prev = aliases[bare];
  if (!prev || info.n > regions[prev].n) aliases[bare] = sgg;
  aliases[`${sido.slice(0, 2)}${bare}`] = sgg;
}
/* 구 단위 이름을 별칭에 추가 — "처인", "수지" 로 바로 찾히게 */
for (const key of Object.keys(fineRegions)) {
  const gu = key.split(/\s+/)[2] || "";
  const bare = gu.replace(/구$/, "");
  if (bare.length >= 2) aliasesFine[bare] = key;
}

/* ── 4. 오차 측정 ─────────────────────────────────────────── */
const errs = obs.map((o) => {
  /* o.fine 이 "" 일 때 (a && b) ?? c 는 "" 를 반환합니다 — ?? 는 빈 문자열을
     통과시키지 않습니다. 삼항으로 명확히 갈라야 합니다. */
  const est = (o.fine ? fineRegions[o.fine]?.pyPrice : undefined)
    ?? regions[o.sgg]?.pyPrice ?? globalPy;
  return (est - o.pyPrice) / o.pyPrice * 100;
});
const abs = errs.map(Math.abs);
const stats = {
  mae: +(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(1),
  p50: +median(abs).toFixed(1),
  p80: +pct(abs, 0.8).toFixed(1),
  p90: +pct(abs, 0.9).toFixed(1),
  within: Object.fromEntries([5, 10, 15, 20, 30].map((b) =>
    [b, +(abs.filter((x) => x <= b).length / abs.length * 100).toFixed(0)])),
};

console.log(`시군구 ${bySgg.size}개 중 표본 ${MIN_N}건 이상 ${Object.keys(regions).length}개 채택`);
console.log(`전국 중앙값 ${globalPy.toLocaleString()}만/평\n`);
console.log(`평균 절대오차 ${stats.mae}% · 중앙 ${stats.p50}% · 80분위 ${stats.p80}% · 90분위 ${stats.p90}%`);
for (const [b, v] of Object.entries(stats.within)) console.log(`  ±${String(b).padStart(2)}% 안에 ${v}%`);

/* ── 5. 모듈로 저장 ───────────────────────────────────────── */
const out = `/* 자동 생성 — scripts/calibrate.js
   청약홈 실제 분양가 ${obs.length}건에서 뽑은 시군구별 평당 분양가(만원).
   손으로 고치지 마세요. 수집이 갱신되면 다시 돌리면 됩니다.
   측정 오차: 평균 ${stats.mae}% · 중앙 ${stats.p50}% · ±15% 안에 ${stats.within[15]}% */
export const PY_PRICE_META = ${JSON.stringify({ at: new Date().toISOString(), samples: obs.length, notices: new Set(obs.map((o) => o.n)).size, stats }, null, 2)};
export const PY_PRICE_GLOBAL = ${globalPy};
export const PY_PRICE_REGIONS = ${JSON.stringify(regions, null, 2)};
export const PY_PRICE_FINE = ${JSON.stringify(fineRegions, null, 2)};
export const PY_PRICE_ALIAS = ${JSON.stringify(aliases, null, 2)};
export const PY_PRICE_ALIAS_FINE = ${JSON.stringify(aliasesFine, null, 2)};
`;
fs.mkdirSync("src/data", { recursive: true });
fs.writeFileSync("src/data/py-price.js", out, "utf8");
console.log(`\nsrc/data/py-price.js 생성 · 시군구 ${Object.keys(regions).length}개 · 구 단위 ${Object.keys(fineRegions).length}개 · 별칭 ${Object.keys(aliases).length}개`);
