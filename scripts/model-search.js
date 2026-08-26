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
      /* 주택구분 — 신혼희망타운·사전청약은 분양가 체계가 아예 다릅니다 */
      kind: String(s.kind || "APT").trim() || "APT",
      /* 같은 시/군 안에서도 읍·면·리는 동보다 훨씬 쌉니다.
         가평 설악면·강화 선원면이 시 평균으로 끌려 올라가 과대예측됐습니다. */
      rural: /[면리]$|면 |리 /.test(String(s.gu || "")) ? "읍면리"
           : /동$|동 |가$/.test(String(s.gu || "")) ? "동" : "기타",
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
let K_SHRINK = 6;
let USE_MEDIAN = false;
const logAgg = (v) => USE_MEDIAN
  ? median(v)
  : v.reduce((a, b) => a + b, 0) / v.length;

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
    const mean = logAgg(v);
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
      tab[k] = Math.exp(logAgg(v));
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
  ["+ 읍면리 여부", ["rural", "supply", "pyBand", "size", "capped", "tier", "redev"]],
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

/* ── 실제 사용 시나리오 지표 ───────────────────────────────
   앱이 예측하는 대상은 "아직 공고가 안 난 현장의 국민평형 분양가" 입니다.
   그때 아는 정보는 지역과 브랜드뿐 — 타입 구성도, 세대수도 모릅니다.
   그러니 공고마다 84㎡(국민평형) 한 건만 예측해 맞히는지가 진짜 지표입니다. */
function cvNational(steps) {
  const errs = [];
  for (let k = 0; k < K; k++) {
    const train = obs.filter((o) => foldOf.get(o.notice) !== k);
    const test = obs.filter((o) => foldOf.get(o.notice) === k);
    const m = buildModel(train, steps);
    /* 공고별로 국민평형(30~38평)에 가장 가까운 타입 하나만 */
    const byNotice = new Map();
    for (const o of test) {
      const cur = byNotice.get(o.notice);
      const d = Math.abs(o.py - 34);
      if (!cur || d < cur.d) byNotice.set(o.notice, { o, d });
    }
    for (const { o } of byNotice.values()) {
      /* 규모·평형은 공고 전엔 모르므로 국민평형 기본값으로 고정 */
      const guess = { ...o, pyBand: "국민", size: "중형" };
      errs.push(Math.abs(m.predict(guess) - o.pyPrice) / o.pyPrice * 100);
    }
  }
  return {
    n: errs.length,
    mae: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2),
    p50: +median(errs).toFixed(2),
    p80: +pct(errs, 0.8).toFixed(2),
    w10: +(errs.filter((e) => e <= 10).length / errs.length * 100).toFixed(0),
    w15: +(errs.filter((e) => e <= 15).length / errs.length * 100).toFixed(0),
    w20: +(errs.filter((e) => e <= 20).length / errs.length * 100).toFixed(0),
  };
}

console.log("\n실사용 지표 — 공고당 국민평형 1건, 지역+브랜드만 알고 예측");
console.log("─".repeat(78));
console.log(`${"모델".padEnd(26)}${"평균".padStart(8)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"±10%".padStart(8)}${"±15%".padStart(8)}${"±20%".padStart(8)}`);
let bestN = null;
for (const [label, steps] of TRIALS) {
  const r = cvNational(steps);
  if (!bestN || r.mae < bestN.r.mae) bestN = { label, steps, r };
  console.log(`${label.padEnd(26)}${(r.mae + "%").padStart(8)}${(r.p50 + "%").padStart(8)}`
    + `${(r.p80 + "%").padStart(9)}${(r.w10 + "%").padStart(8)}${(r.w15 + "%").padStart(8)}${(r.w20 + "%").padStart(8)}`);
}
console.log(`\n실사용 최적: ${bestN.label} → 평균 ${bestN.r.mae}% · 중앙 ${bestN.r.p50}% · ±10% 안에 ${bestN.r.w10}% (공고 ${bestN.r.n}건)`);

/* ── 축소계수·집계방식 탐색 ────────────────────────────────
   K 가 작으면 잎(동 단위)을 믿고, 크면 부모(시·도)로 끌어당깁니다.
   어느 쪽이 나은지는 데이터가 정합니다. */
console.log("\n축소계수 K · 집계방식 탐색 (실사용 지표 기준)");
console.log("─".repeat(78));
const STEPS_BEST = ["rural", "supply", "pyBand", "size", "capped", "tier", "redev"];
let bestCfg = null;
for (const useMed of [false, true]) {
  const line = [];
  for (const k of [1, 2, 3, 4, 6, 10, 16]) {
    K_SHRINK = k; USE_MEDIAN = useMed;
    const r = cvNational(STEPS_BEST);
    line.push(`K=${String(k).padStart(2)} ${r.mae}%/${r.p50}%`);
    if (!bestCfg || r.mae < bestCfg.r.mae) bestCfg = { k, useMed, r };
  }
  console.log(`${useMed ? "로그중앙값" : "로그평균  "}  ${line.join("  ")}`);
}
K_SHRINK = bestCfg.k; USE_MEDIAN = bestCfg.useMed;
console.log(`\n최적: K=${bestCfg.k} · ${bestCfg.useMed ? "로그중앙값" : "로그평균"}`
  + ` → 평균 ${bestCfg.r.mae}% · 중앙 ${bestCfg.r.p50}% · ±10% 안에 ${bestCfg.r.w10}% · ±20% 안에 ${bestCfg.r.w20}%`);

/* ── 지역별 신뢰구간 ───────────────────────────────────────
   평균 오차를 한 자리로 내리는 건 지역·브랜드만 아는 상태에선 무리입니다.
   같은 광명시 안에 철산역자이(4,594만/평)와 그 절반짜리가 같이 있습니다.
   그러면 점 하나를 우기는 대신, **그 지역이 실제로 얼마나 흩어지는지**를
   구간으로 같이 내미는 게 맞습니다.
   표본이 촘촘하고 편차가 작은 지역은 좁게, 넓은 지역은 넓게. */
function cvInterval(steps, mult) {
  let inBand = 0, n = 0, widthSum = 0;
  for (let k = 0; k < K; k++) {
    const train = obs.filter((o) => foldOf.get(o.notice) !== k);
    const test = obs.filter((o) => foldOf.get(o.notice) === k);
    const m = buildModel(train, steps);
    /* 학습셋에서 지역별 상대편차(로그 표준편차)를 잰다 */
    const dev = new Map();
    for (const o of train) {
      for (let i = o.path.length; i >= 1; i--) {
        const key = o.path.slice(0, i).join(" ");
        (dev.get(key) ?? dev.set(key, []).get(key)).push(Math.log(o.pyPrice / m.predict(o)));
      }
    }
    const sd = (arr) => {
      const mu = arr.reduce((a, b) => a + b, 0) / arr.length;
      return Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, arr.length - 1));
    };
    const devOf = (path) => {
      for (let i = path.length; i >= 1; i--) {
        const v = dev.get(path.slice(0, i).join(" "));
        if (v && v.length >= 8) return sd(v);
      }
      return 0.25;   /* 근거가 없으면 넉넉히 */
    };
    const byNotice = new Map();
    for (const o of test) {
      const cur = byNotice.get(o.notice);
      const d = Math.abs(o.py - 34);
      if (!cur || d < cur.d) byNotice.set(o.notice, { o, d });
    }
    for (const { o } of byNotice.values()) {
      const pred = m.predict({ ...o, pyBand: "국민", size: "중형" });
      const w = devOf(o.path) * mult;
      const lo = pred * Math.exp(-w), hi = pred * Math.exp(w);
      n++; widthSum += (hi - lo) / pred * 100;
      if (o.pyPrice >= lo && o.pyPrice <= hi) inBand++;
    }
  }
  return { cover: +(inBand / n * 100).toFixed(0), width: +(widthSum / n).toFixed(0) };
}

console.log("\n지역별 신뢰구간 — 실제 분양가가 구간 안에 들어오는 비율");
console.log("─".repeat(78));
console.log(`${"배수".padStart(6)}${"적중률".padStart(9)}${"평균 구간폭".padStart(13)}`);
for (const mult of [0.8, 1.0, 1.28, 1.5, 1.65, 2.0]) {
  const r = cvInterval(STEPS_BEST, mult);
  console.log(`${String(mult).padStart(6)}${(r.cover + "%").padStart(9)}${("±" + Math.round(r.width / 2) + "%").padStart(13)}`);
}

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
  national: { label: bestN.label, steps: bestN.steps, ...bestN.r },
  tuned: bestCfg ? { k: bestCfg.k, useMedian: bestCfg.useMed, ...bestCfg.r } : null,
  factors: final.factors,
}, null, 2) + "\n");
console.log("\ndata/model-search.json 저장");
