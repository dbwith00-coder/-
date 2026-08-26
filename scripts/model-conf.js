/* ============================================================
   분양가 모델 탐색 4 — "얼마나 틀릴지"를 미리 아는 법
   ------------------------------------------------------------
   앞의 실험 셋(계층 축소 / 인근·최근 비교법 / 트리 분할)이 전부
   평균 13% 근처에서 멈췄습니다. 방법을 바꿔서 안 되는 게 아니라
   정보가 모자라서 안 되는 겁니다. 근거:

     같은 읍면동 · 6개월 안에 분양한 두 단지끼리도 평당가가
     평균 10.8% 벌어집니다. 같은 시군구면 16.0% 입니다.
     위치와 시점만 아는 모델의 이론적 하한이 각각 약 7.6% / 11.3%.

   그래서 방향을 바꿉니다. **전부를 10% 안에 넣는 대신, 10% 안에
   들어갈 현장을 미리 골라냅니다.** 감정평가에서 하는 일과 같습니다 —
   비교사례가 충분하면 좁은 값을, 없으면 넓은 값을 냅니다.

   미리 알 수 있는 것:
     · 근처에서 최근 분양한 단지가 몇 건이나 되는가 (표본 수)
     · 그 단지들 값이 서로 얼마나 벌어져 있는가 (분산)
   둘 다 정답을 안 보고 계산됩니다. 이것으로 신뢰도를 나눈 뒤,
   등급별 실제 오차를 교차검증으로 잽니다.
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
/* 노드 키는 토큰을 이 문자로 이어 붙입니다.
   그냥 붙이면 "부모 = 마지막 토큰 뗀 것" 계산이 글자 단위로 잘려 트리가 망가집니다. */
const SEP = "\u0001";
const PY_PER_M2 = 1.35 / 3.3058;
const pyOf = (t) => {
  const m = String(t).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) * PY_PER_M2 : 0;
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;
const TAXI = /지구|블록|BL|신도시|택지/;

const M0 = new Date("2025-08-01").getTime();
const sites = [];
for (const s of SNAP.sites) {
  if (s.scoreless || NOT_SALE.test(s.n)) continue;
  const gu = String(s.gu || "");
  const tok = gu.split(/\s+/).filter(Boolean);
  if (!tok.length) continue;
  let ref = null;
  for (const t of s.types || []) {
    const py = pyOf(t.t);
    if (!py || !t.price || py < 15 || py > 50) continue;
    const pp = t.price / py;
    if (pp < 300 || pp > 12000) continue;
    const d = Math.abs(py - 34);
    if (!ref || d < ref.d) ref = { d, pp };
  }
  if (!ref) continue;
  const rural = /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(gu) ? "읍면"
    : TAXI.test(gu) ? "택지" : "시가지";
  sites.push({
    tok, sido: tok[0], sgg: tok[1] || "", emd: tok[2] || "", rural,
    redev: (s.tags || []).includes("정비사업") ? "재개발" : "일반",
    pyPrice: ref.pp, m: (new Date(s.when || "2026-01-01").getTime() - M0) / (1000 * 86400 * 30.44),
    n: s.n, gu,
  });
}
console.log(`공고 ${sites.length}건 · ${SNAP.collectedAt}\n`);
const K = 5;
sites.forEach((s, i) => (s.fold = i % K));

const pathOf = (s) => [s.sido, s.rural, s.sgg, s.redev, s.emd].filter(Boolean);
const K_SHRINK = 0.5;   /* model-tree.js 격자탐색에서 고른 값 */

function buildTree(train) {
  const nodes = new Map();
  for (const o of train) {
    const p = pathOf(o);
    for (let i = 0; i <= p.length; i++) {
      const key = p.slice(0, i).join(SEP);
      (nodes.get(key) ?? nodes.set(key, []).get(key)).push(Math.log(o.pyPrice));
    }
  }
  const est = new Map();
  const dep = (x) => (x === "" ? 0 : x.split(SEP).length);
  for (const key of [...nodes.keys()].sort((a, b) => dep(a) - dep(b))) {
    const v = nodes.get(key);
    const parent = key === "" ? null : est.get(key.split(SEP).slice(0, -1).join(SEP));
    const m = mean(v);
    est.set(key, parent == null ? m : (v.length * m + K_SHRINK * parent) / (v.length + K_SHRINK));
  }
  return {
    predict(p) {
      for (let i = p.length; i >= 0; i--) {
        const key = p.slice(0, i).join(SEP);
        if (est.has(key)) return { v: Math.exp(est.get(key)), depth: i, n: (nodes.get(key) || []).length };
      }
      return { v: Math.exp(est.get("") ?? 0), depth: 0, n: 0 };
    },
    nodes,
  };
}

/* ── 정답을 안 보고 계산되는 신뢰도 지표 ────────────────────
   원칙: 추정의 신뢰도 = **그 추정을 실제로 떠받친 비교사례**의
   숫자와 흩어짐입니다. 그래서 모델이 최종적으로 고른 노드를 그대로 씁니다.
   (같은 동을 따로 세면 모델이 실제로 뭘 봤는지와 어긋납니다.)

   깊이 4 이상 = 읍면동/지구까지 일치하는 사례가 있었다는 뜻입니다. */
function confidenceOf(tree, o) {
  const p = pathOf(o);
  let key = "", depth = 0, logs = [];
  for (let i = p.length; i >= 0; i--) {
    const k = p.slice(0, i).join(SEP);
    if (tree.nodes.has(k)) { key = k; depth = i; logs = tree.nodes.get(k); break; }
  }
  const n = logs.length;
  const sd = n >= 2 ? Math.sqrt(mean(logs.map((x) => (x - mean(logs)) ** 2))) : null;
  return { depth, n, sd };
}

/* ── 교차검증하며 예측 + 신뢰도를 같이 기록 ────────────────── */
const rows = [];
for (let f = 0; f < K; f++) {
  const train = sites.filter((s) => s.fold !== f);
  const tree = buildTree(train);
  for (const o of sites.filter((s) => s.fold === f)) {
    const p = tree.predict(pathOf(o));
    const c = confidenceOf(tree, o);
    rows.push({ ...o, pred: p.v, ...c,
      err: Math.abs(p.v - o.pyPrice) / o.pyPrice * 100 });
  }
}

const stat = (v) => ({
  n: v.length,
  mae: +mean(v.map((r) => r.err)).toFixed(2),
  p50: +median(v.map((r) => r.err)).toFixed(2),
  p80: +pct(v.map((r) => r.err), 0.8).toFixed(2),
  w10: +(v.filter((r) => r.err <= 10).length / v.length * 100).toFixed(0),
});
const row = (label, v) => {
  const s = stat(v);
  console.log(`${label.padEnd(34)}${String(s.n).padStart(5)}건${(s.mae + "%").padStart(9)}`
    + `${(s.p50 + "%").padStart(8)}${(s.p80 + "%").padStart(9)}${(s.w10 + "%").padStart(8)}`);
};
const head = (t) => {
  console.log("\n" + t);
  console.log("-".repeat(73));
  console.log(`${"구간".padEnd(34)}${"표본".padStart(6)}${"평균".padStart(8)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"±10%".padStart(8)}`);
};

head("전체");
row("모든 공고", rows);

head("① 어느 단계까지 일치하는 사례가 있었나");
for (const [lbl, f] of [
  ["읍면동/지구까지 일치 (깊이 5)", (r) => r.depth >= 5],
  ["시군구+성격+사업유형 (깊이 4)", (r) => r.depth === 4],
  ["시군구+성격까지 (깊이 3)", (r) => r.depth === 3],
  ["시도까지만 (깊이 2 이하)", (r) => r.depth <= 2],
]) { const v = rows.filter(f); if (v.length) row(lbl, v); }

head("② 그 사례들이 서로 얼마나 벌어져 있나 (로그 표준편차)");
for (const [lbl, f] of [
  ["아주 촘촘 (sd < 0.10)", (r) => r.sd != null && r.sd < 0.10],
  ["촘촘 (0.10~0.18)", (r) => r.sd != null && r.sd >= 0.10 && r.sd < 0.18],
  ["보통 (0.18~0.28)", (r) => r.sd != null && r.sd >= 0.18 && r.sd < 0.28],
  ["넓음 (0.28 이상)", (r) => r.sd != null && r.sd >= 0.28],
  ["사례 1건 이하", (r) => r.sd == null],
]) { const v = rows.filter(f); if (v.length) row(lbl, v); }

head("③ 사례 수 × 흩어짐");
for (const [lbl, f] of [
  ["사례 4건 이상 · sd<0.18", (r) => r.n >= 4 && r.sd != null && r.sd < 0.18],
  ["사례 2~3건 · sd<0.18", (r) => r.n >= 2 && r.n < 4 && r.sd != null && r.sd < 0.18],
  ["sd 0.18~0.28", (r) => r.sd != null && r.sd >= 0.18 && r.sd < 0.28],
  ["sd 0.28 이상 또는 사례 1건", (r) => r.sd == null || r.sd >= 0.28],
]) { const v = rows.filter(f); if (v.length) row(lbl, v); }

head("④ 최종 신뢰도 등급 — 일치 깊이로 나눕니다");
/* 흩어짐(sd)은 등급 기준으로 안 씁니다. 노드가 깊을수록 사례가 적어져
   sd 자체가 불안정해지고, 위 ③처럼 등급이 뒤집힙니다.
   "어느 단계까지 같은 사례를 찾았나"는 그런 문제가 없고 해석도 쉽습니다. */
const grade = (r) => (r.depth >= 5 ? "높음" : r.depth === 4 ? "보통" : "낮음");
const grades = {};
rows.forEach((r) => ((grades[grade(r)] ??= []).push(r)));
const LABEL = {
  "높음": "높음 — 읍면동/지구까지 같은 사례 있음",
  "보통": "보통 — 시군구·성격·사업유형까지 일치",
  "낮음": "낮음 — 시군구 위로 올라가 빌려옴",
};
for (const g of ["높음", "보통", "낮음"]) if (grades[g]) row(LABEL[g], grades[g]);

const hi = grades["높음"] || [];
console.log(`\n신뢰도 "높음" ${hi.length}건 (전체의 ${Math.round(hi.length / rows.length * 100)}%)`
  + ` · 평균 ${stat(hi).mae}% · 중앙 ${stat(hi).p50}% · ±10% 안 ${stat(hi).w10}%`);
console.log(`등급별 표시 범위(80분위): `
  + ["높음", "보통", "낮음"].filter((g) => grades[g])
      .map((g) => `${g} ±${Math.round(stat(grades[g]).p80)}%`).join(" · "));
console.log(`\n→ 오차 10% 안으로 들어가는 건 "높음" 등급입니다. 나머지를 끌어올리려면`);
console.log(`   현장의 읍면동·지구를 알아내야 합니다 (뉴스 기사에서 뽑아낼 수 있습니다).`);

fs.writeFileSync("data/model-conf.json", JSON.stringify({
  at: new Date().toISOString(), sites: sites.length,
  all: stat(rows),
  byGrade: Object.fromEntries(["높음", "보통", "낮음"].filter((g) => grades[g]).map((g) => [g, stat(grades[g])])),
  byDepth: Object.fromEntries([5, 4, 3, 2].map((d) => {
    const v = rows.filter((r) => (d === 5 ? r.depth >= 5 : d === 2 ? r.depth <= 2 : r.depth === d));
    return [d, v.length ? stat(v) : null];
  })),
  rule: "depth>=5 -> 높음 / depth==4 -> 보통 / 그 외 낮음",
}, null, 2));
console.log("\ndata/model-conf.json 저장");
