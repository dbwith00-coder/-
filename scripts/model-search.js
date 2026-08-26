/* ============================================================
   분양가 모델 탐색 — 오차 10% 아래로 내리기
   ------------------------------------------------------------
   지금은 "지역 중앙값" 하나로만 설명합니다 (평균 절대오차 11.8%).
   같은 구 안에서도 공공/민영, 평형, 단지 규모에 따라 평당가가 달라지는데
   그걸 전혀 보지 않습니다.

   곱셈 보정을 하나씩 얹으면서, 얹을 때마다 오차가 실제로 줄어드는지
   교차검증으로 확인합니다.

       평당가 = 지역중앙값 × f(공급유형) × f(평형) × f(규모) × ...

   ⚠️ 검증 방식이 중요합니다.
      같은 공고의 주택형들은 가격이 서로 붙어 있어서, 관측치를 무작위로
      쪼개면 같은 공고가 학습·평가 양쪽에 들어가 성능이 부풀려집니다.
      그래서 **공고 단위**로 5겹 교차검증합니다.
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const PY_PER_M2 = 1.35 / 3.3058;
const pyOf = (t) => {
  const m = String(t).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) * PY_PER_M2 : 0;
};
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};

/* ── 관측치 + 특징 ────────────────────────────────────────── */
const HIGH_END = /아크로|디에이치|르엘|오티에르|트리마제|원베일리|블레스티지|써밋|라클래시/;
const TIER1 = /자이|래미안|힐스테이트|푸르지오|편한세상|롯데캐슬|더샵|아이파크|위브|SK뷰|포레나|한신더휴|호반|우미린/;

/* 분양가 성격이 다른 유형은 학습에서 뺍니다.
   분양전환 공공임대·토지임대부는 평당 400~1,400만원대로, 일반 분양가와
   섞으면 같은 동네 예측이 통째로 망가집니다(실제로 오차 상위가 전부 이것들). */
const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;

const obs = [];
for (const s of SNAP.sites) {
  if (s.scoreless) continue;
  if (NOT_SALE.test(s.n)) continue;
  const tok = String(s.gu || "").split(/\s+/);
  const coarse = tok.slice(0, 2).join(" ");
  const fine = tok[2] && /구$/.test(tok[2]) ? tok.slice(0, 3).join(" ") : "";
  if (!coarse) continue;
  const tags = s.tags || [];
  const brandText = `${s.brand} ${s.n}`;
  const tier = HIGH_END.test(brandText) ? "하이엔드" : TIER1.test(brandText) ? "1군" : "일반";
  const total = s.total || 0;
  const size = total >= 1500 ? "초대형" : total >= 700 ? "대단지" : total >= 300 ? "중형" : "소규모";
  for (const t of s.types || []) {
    const py = pyOf(t.t);
    if (!py || !t.price || py < 15 || py > 50) continue;
    const pyPrice = t.price / py;
    if (pyPrice < 300 || pyPrice > 12000) continue;
    obs.push({
      /* 주소를 토큰 경로로 — 형식이 깨져 있어도 자기 노드가 됩니다 */
      path: String(s.gu || "").split(/\s+/).filter(Boolean).slice(0, 4),
      notice: `${s.n}|${s.gu}`, coarse, fine, py, pyPrice,
      supply: s.supply, capped: tags.includes("분양가상한제") ? "Y" : "N",
      redev: tags.includes("정비사업") ? "Y" : "N",
      tier, size,
      pyBand: py < 22 ? "소형" : py < 30 ? "중소형" : py < 38 ? "국민" : "대형",
      month: String(s.when || "").slice(0, 7),
    });
  }
}
const notices = [...new Set(obs.map((o) => o.notice))];
console.log(`관측 ${obs.length}건 · 공고 ${notices.length}건\n`);

/* ── 공고 단위 5겹 분할 ───────────────────────────────────── */
const K = 5;
const foldOf = new Map();
notices.forEach((n, i) => foldOf.set(n, i % K));

/* ── 계층적 축소(shrinkage) ────────────────────────────────
   주소를 토큰 경로로 보고 뿌리에서 잎으로 내려가며 값을 물려줍니다.

     전국 → "경기도" → "경기도 성남시" → "경기도 성남시 분당구" → …

   표본이 적은 잎은 부모 값 쪽으로 끌어당깁니다(축소).
     추정 = (n × 잎 평균 + k × 부모) / (n + k)
   n 이 크면 잎을 믿고, 작으면 부모를 믿습니다. k 는 그 저울입니다.

   이렇게 하면 "김포"처럼 주소 형식이 깨진 것도 알아서 자기 노드가 되고,
   표본 1건짜리 동네가 튀는 것도 막힙니다.
   가격은 곱셈으로 움직이므로 로그 공간에서 평균냅니다. */
const K_SHRINK = 6;

function buildHierarchy(train) {
  const nodes = new Map();          /* 경로 → 로그가격 배열 */
  for (const o of train) {
    const toks = o.path;
    for (let i = 0; i <= toks.length; i++) {
      const key = toks.slice(0, i).join(" ");
      (nodes.get(key) ?? nodes.set(key, []).get(key)).push(Math.log(o.pyPrice));
    }
  }
  /* 뿌리부터 내려가며 축소 적용 */
  const est = new Map();
  const keys = [...nodes.keys()].sort((a, b) => a.split(" ").length - b.split(" ").length);
  for (const key of keys) {
    const v = nodes.get(key);
    const parentKey = key.split(" ").slice(0, -1).join(" ");
    const parent = key === "" ? null : est.get(parentKey);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    est.set(key, parent == null ? mean : (v.length * mean + K_SHRINK * parent) / (v.length + K_SHRINK));
  }
  return (path) => {
    /* 가장 깊은 경로부터 찾아 내려옴 */
    for (let i = path.length; i >= 0; i--) {
      const key = path.slice(0, i).join(" ");
      if (est.has(key)) return Math.exp(est.get(key));
    }
    return Math.exp(est.get("") ?? 0);
  };
}

/* 학습 데이터로 표를 만들고, 평가 데이터에 적용 */
function buildModel(train, steps) {
  const base = buildHierarchy(train);

  /* 잔차(실제/예측) 비율의 로그 평균을 특징별로 */
  const factors = [];
  for (const key of steps) {
    const buckets = {};
    for (const o of train) {
      let pred = base(o.path);
      for (const f of factors) pred *= f.tab[o[f.key]] ?? 1;
      (buckets[o[key]] ??= []).push(Math.log(o.pyPrice / pred));
    }
    const tab = {};
    for (const [k, v] of Object.entries(buckets)) {
      if (v.length < 12) continue;
      tab[k] = Math.exp(v.reduce((a, b) => a + b, 0) / v.length);
    }
    factors.push({ key, tab });
  }
  return {
    predict: (o) => {
      let p = base(o.path);
      for (const f of factors) p *= f.tab[o[f.key]] ?? 1;
      return p;
    },
    factors,
  };
}

function cv(steps) {
  const errs = [];
  for (let k = 0; k < K; k++) {
    const train = obs.filter((o) => foldOf.get(o.notice) !== k);
    const test = obs.filter((o) => foldOf.get(o.notice) === k);
    const m = buildModel(train, steps);
    for (const o of test) errs.push(Math.abs(m.predict(o) - o.pyPrice) / o.pyPrice * 100);
  }
  return {
    mae: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2),
    p50: +median(errs).toFixed(2),
    p80: +pct(errs, 0.8).toFixed(2),
    p90: +pct(errs, 0.9).toFixed(2),
    w10: +(errs.filter((e) => e <= 10).length / errs.length * 100).toFixed(0),
    w15: +(errs.filter((e) => e <= 15).length / errs.length * 100).toFixed(0),
  };
}

/* ── 보정을 하나씩 얹으며 측정 ────────────────────────────── */
const TRIALS = [
  ["지역 계층만", []],
  ["+ 공급유형(민영/공공)", ["supply"]],
  ["+ 평형대", ["supply", "pyBand"]],
  ["+ 단지 규모", ["supply", "pyBand", "size"]],
  ["+ 분양가상한제", ["supply", "pyBand", "size", "capped"]],
  ["+ 브랜드 등급", ["supply", "pyBand", "size", "capped", "tier"]],
  ["+ 정비사업", ["supply", "pyBand", "size", "capped", "tier", "redev"]],
];

console.log("공고 단위 5겹 교차검증 (학습에 안 쓴 공고로만 평가)");
console.log("─".repeat(78));
console.log(`${"모델".padEnd(26)}${"평균".padStart(8)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"90분위".padStart(9)}${"±10%".padStart(8)}${"±15%".padStart(8)}`);
let best = null;
for (const [label, steps] of TRIALS) {
  const r = cv(steps);
  if (!best || r.mae < best.r.mae) best = { label, steps, r };
  console.log(`${label.padEnd(26)}${(r.mae + "%").padStart(8)}${(r.p50 + "%").padStart(8)}`
    + `${(r.p80 + "%").padStart(9)}${(r.p90 + "%").padStart(9)}${(r.w10 + "%").padStart(8)}${(r.w15 + "%").padStart(8)}`);
}

console.log("\n" + "─".repeat(78));
console.log(`가장 좋은 조합: ${best.label}  →  평균 ${best.r.mae}% · 중앙 ${best.r.p50}% · ±10% 안에 ${best.r.w10}%`);

/* ── 채택 모델의 보정계수를 전체 데이터로 다시 학습해 저장 ── */
const final = buildModel(obs, best.steps);
console.log("\n보정계수 (전체 학습)");
for (const f of final.factors) {
  const items = Object.entries(f.tab).map(([k, v]) => `${k} ×${v.toFixed(3)}`).join("  ");
  console.log(`  ${f.key.padEnd(8)} ${items}`);
}

fs.writeFileSync("data/model-search.json", JSON.stringify({
  at: new Date().toISOString(), obs: obs.length, notices: notices.length,
  trials: TRIALS.map(([label, steps]) => ({ label, steps, ...cv(steps) })),
  chosen: { label: best.label, steps: best.steps, ...best.r },
  factors: final.factors,
}, null, 2) + "\n");
console.log("\ndata/model-search.json 저장");
