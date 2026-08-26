/* ============================================================
   분양가 모델 학습 — 실제 분양가에서 계수를 뽑습니다
   ------------------------------------------------------------
   scripts/model-tree.js · model-comps.js · model-conf.js 로 여러 구성을
   공고 단위 교차검증해 고른 결과를, 여기서 전체 데이터에 다시 학습시켜
   src/data/price-model-fit.js 로 냅니다.

   구조 — 주소를 "성격"이 끼어 있는 경로로 봅니다.

       [시도] → [지역성격] → [시군구] → [사업유형] → [읍면동/지구]
                 읍면/택지/시가지            재개발/일반

   왜 성격을 끼우나: 안성시 안에도 아양지구(읍면·평당 1,292만)와
   시내 동(평당 2,000만대)이 섞여 있습니다. 그냥 "안성시" 평균을
   물려주면 읍면 현장을 70% 과대예측합니다. 성격을 한 층으로 두면
   안성 읍면은 "경기도 읍면" 쪽에서 값을 빌려옵니다.

   표본이 적은 잎은 부모 쪽으로 끌어당깁니다(축소계수 K=0.5, 격자탐색).

   신뢰도 — 추정이 어느 단계에서 멈췄는지를 그대로 등급으로 씁니다.
     읍면동/지구까지 같은 사례가 있었으면 "높음", 시군구까지면 "보통",
     그 위로 올라가 빌려왔으면 "낮음". 등급별 실제 오차는 교차검증으로
     재서 FIT_CV.byGrade 에 넣습니다. 화면 범위도 그 값을 씁니다.
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const CONF = JSON.parse(fs.readFileSync("data/model-conf.json", "utf8"));
const SEP = "";
const K_SHRINK = 0.5;

/* 분양가 성격이 다른 유형은 학습에서 제외 */
const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;
/* 주소에 지구·블록이 들어가면 공공택지 — 상한제라 값이 다르게 형성됩니다 */
const TAXI = /지구|블록|BL|신도시|택지/;

const PY_PER_M2 = 1.35 / 3.3058;
const pyOf = (t) => {
  const m = String(t).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) * PY_PER_M2 : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

/* 한 공고를 경로와 국민평형 평당가로 바꿉니다 */
export function siteFeatures(gu, tags = []) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  const rural = /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(String(gu))
    ? "읍면" : TAXI.test(String(gu)) ? "택지" : "시가지";
  const redev = tags.includes("정비사업") ? "재개발" : "일반";
  return {
    tok, rural, redev,
    path: [tok[0], rural, tok[1], redev, tok[2]].filter(Boolean),
  };
}

const obs = [];
for (const s of SNAP.sites) {
  if (s.scoreless || NOT_SALE.test(s.n)) continue;
  const f = siteFeatures(s.gu, s.tags || []);
  if (f.path.length < 2) continue;
  /* 국민평형(34평)에 가장 가까운 타입 하나 — 예측 대상과 같은 단위로 */
  let ref = null;
  for (const t of s.types || []) {
    const py = pyOf(t.t);
    if (!py || !t.price || py < 15 || py > 50) continue;
    const pyPrice = t.price / py;
    if (pyPrice < 300 || pyPrice > 12000) continue;
    const d = Math.abs(py - 34);
    if (!ref || d < ref.d) ref = { d, py, pyPrice };
  }
  if (!ref) continue;
  obs.push({ ...f, pyPrice: ref.pyPrice, gu: s.gu });
}
console.log(`학습 공고 ${obs.length}건 (공고당 국민평형 1건)`);

/* ── 지역 트리 ────────────────────────────────────────────── */
const nodes = new Map();
for (const o of obs) {
  for (let i = 0; i <= o.path.length; i++) {
    const k = o.path.slice(0, i).join(SEP);
    (nodes.get(k) ?? nodes.set(k, []).get(k)).push(Math.log(o.pyPrice));
  }
}
const depthOf = (k) => (k === "" ? 0 : k.split(SEP).length);
const region = {}, counts = {};
for (const k of [...nodes.keys()].sort((a, b) => depthOf(a) - depthOf(b))) {
  const v = nodes.get(k);
  const parent = k === "" ? null : region[k.split(SEP).slice(0, -1).join(SEP)];
  const m = mean(v);
  region[k] = parent == null ? m : (v.length * m + K_SHRINK * parent) / (v.length + K_SHRINK);
  counts[k] = v.length;
}

/* ── 지명 색인 ────────────────────────────────────────────
   뉴스에서 찾은 현장은 주소가 아니라 "동탄", "탕정" 같은 낱말로 옵니다.
   학습 데이터에 나온 지명을 낱말 → 노드로 뒤집어 둡니다.
   같은 낱말이 여러 노드에 걸리면 표본이 많은 쪽을 씁니다. */
const place = {};
for (const [k, n] of Object.entries(counts)) {
  if (!k) continue;
  const toks = k.split(SEP);
  /* **마지막 토큰만** 색인합니다. 경로에 있는 모든 토큰을 넣으면
     "의왕시" 가 그 안의 가장 깊은 노드(삼동)로 끌려가, 시 전체를 가리키는
     낱말이 특정 동 값을 내놓게 됩니다. */
  const t = toks[toks.length - 1];
  if (!t || t.length < 2 || /^(읍면|택지|시가지|재개발|일반)$/.test(t)) continue;
  const cur = place[t];
  if (!cur || depthOf(k) > depthOf(cur[0]) || (depthOf(k) === depthOf(cur[0]) && n > cur[1])) {
    place[t] = [k, n];
  }
}

/* ── 저장 ─────────────────────────────────────────────────── */
const byGrade = CONF.byGrade || {};
const out = `/* 자동 생성 — scripts/calibrate.js
   청약홈 실제 분양가 공고 ${obs.length}건으로 학습한 분양가 모델.
   손으로 고치지 마세요. 수집이 갱신되면 npm run calibrate 로 다시 만듭니다.

   경로: [시도] > [읍면/택지/시가지] > [시군구] > [재개발/일반] > [읍면동·지구]
   축소계수 K=${K_SHRINK}

   성능(공고 단위 5겹 교차검증 — 학습에 안 쓴 공고를 위치만 보고 예측):
     전체        평균 ${CONF.all?.mae}% · 중앙 ${CONF.all?.p50}%
     신뢰도 높음  평균 ${byGrade["높음"]?.mae}% · 중앙 ${byGrade["높음"]?.p50}%  (${byGrade["높음"]?.n}건)
     신뢰도 보통  평균 ${byGrade["보통"]?.mae}% · 중앙 ${byGrade["보통"]?.p50}%  (${byGrade["보통"]?.n}건)
     신뢰도 낮음  평균 ${byGrade["낮음"]?.mae}% · 중앙 ${byGrade["낮음"]?.p50}%  (${byGrade["낮음"]?.n}건) */
export const SEP = "\\u0001";
export const FIT_META = ${JSON.stringify({
  at: new Date().toISOString(), samples: obs.length, kShrink: K_SHRINK,
  collectedAt: SNAP.collectedAt,
}, null, 2)};
export const FIT_CV = ${JSON.stringify({ all: CONF.all, byGrade, byDepth: CONF.byDepth }, null, 2)};
export const FIT_REGION = ${JSON.stringify(Object.fromEntries(
  Object.entries(region).map(([k, v]) => [k, +v.toFixed(5)])), null, 0)};
export const FIT_REGION_N = ${JSON.stringify(counts, null, 0)};
/* 지명 낱말 → 노드 키 (뉴스 현장처럼 주소가 없을 때 씁니다) */
export const FIT_PLACE = ${JSON.stringify(
  Object.fromEntries(Object.entries(place).map(([k, v]) => [k, v[0]])), null, 0)};
`;
fs.writeFileSync("src/data/price-model-fit.js", out, "utf8");

console.log(`지역 노드 ${Object.keys(region).length}개 · 지명 색인 ${Object.keys(place).length}개`);
for (const g of ["높음", "보통", "낮음"]) {
  const s = byGrade[g];
  if (s) console.log(`  신뢰도 ${g}  ${String(s.n).padStart(3)}건  평균 ${s.mae}%  중앙 ${s.p50}%  범위 ±${Math.round(s.p80)}%`);
}
console.log("src/data/price-model-fit.js 생성");
