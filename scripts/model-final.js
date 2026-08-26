/* ============================================================
   분양가 모델 탐색 6 — 시세 없이 짜낼 수 있는 마지막 몇 %
   ------------------------------------------------------------
   실거래가는 일일 호출 한도에 걸려 아직 못 받았습니다. 그래서 지금
   가진 정보(위치·성격·사업유형)만으로 더 줄일 여지가 있는지 봅니다.

   지금까지 따로따로 재 본 것들:
     지역 트리(성격 포함)   평균 12.71%
     인근·최근 비교법        평균 13.42%
   둘은 서로 다른 실수를 합니다. 트리는 노드가 비면 통째로 위로 올라가고,
   비교법은 거리가 멀어도 조금씩은 참고합니다. **섞으면 나아질 수 있는데
   아직 안 해봤습니다.** 그 외에 안 해본 것들도 같이 잽니다.

     ① 축소계수 K 미세 격자
     ② 노드 대푯값: 평균 / 중앙값 / 절사평균
     ③ 경로 구조 두 가지의 앙상블
     ④ 트리 + 비교법 로그공간 혼합

   검증은 늘 하던 **공고 단위 5겹 교차검증**입니다.
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const SEP = String.fromCharCode(1);
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
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
/* 절사평균 — 양 끝을 잘라내 튀는 값에 덜 흔들립니다 */
const trimmed = (a, f = 0.1) => {
  if (a.length < 5) return mean(a);
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * f);
  return mean(s.slice(k, s.length - k));
};

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
    pyPrice: ref.pp,
    m: (new Date(s.when || "2026-01-01").getTime() - M0) / (1000 * 86400 * 30.44),
    n: s.n, gu,
  });
}
console.log(`공고 ${sites.length}건 · ${SNAP.collectedAt}\n`);
const K = 5;
sites.forEach((s, i) => (s.fold = i % K));

/* ── 경로 두 가지 ─────────────────────────────────────────── */
const PATH_A = (s) => [s.sido, s.rural, s.sgg, s.redev, s.emd].filter(Boolean);
const PATH_B = (s) => s.tok.slice(0, 4);

function buildTree(train, pathOf, k, agg) {
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
    const m = agg(v);
    est.set(key, parent == null ? m : (v.length * m + k * parent) / (v.length + k));
  }
  return (o) => {
    const p = pathOf(o);
    for (let i = p.length; i >= 0; i--) {
      const key = p.slice(0, i).join(SEP);
      if (est.has(key)) return { log: est.get(key), depth: i, n: (nodes.get(key) || []).length };
    }
    return { log: est.get("") ?? 0, depth: 0, n: 0 };
  };
}

/* ── 인근·최근 비교법 ─────────────────────────────────────── */
const commonDepth = (a, b) => {
  let d = 0;
  while (d < a.length && d < b.length && a[d] === b[d]) d++;
  return d;
};
function buildComps(train, { GEO = 300, TAU = 9 } = {}) {
  const rows = train.map((o) => ({ tok: o.tok, m: o.m, log: Math.log(o.pyPrice) }));
  return (o) => {
    let sw = 0, sx = 0;
    for (const t of rows) {
      const w = Math.pow(GEO, commonDepth(o.tok, t.tok)) * Math.exp(-Math.abs(o.m - t.m) / TAU);
      sw += w; sx += w * t.log;
    }
    return { log: sw ? sx / sw : 0 };
  };
}

const score = (errs) => ({
  n: errs.length, mae: +mean(errs).toFixed(2), p50: +median(errs).toFixed(2),
  p80: +pct(errs, 0.8).toFixed(2),
  w10: +(errs.filter((e) => e <= 10).length / errs.length * 100).toFixed(0),
  w20: +(errs.filter((e) => e <= 20).length / errs.length * 100).toFixed(0),
});
const row = (label, r) =>
  console.log(`${label.padEnd(32)}${(r.mae + "%").padStart(9)}${(r.p50 + "%").padStart(8)}`
    + `${(r.p80 + "%").padStart(9)}${(r.w10 + "%").padStart(8)}${(r.w20 + "%").padStart(8)}`);
const head = (t) => {
  console.log("\n" + t);
  console.log("-".repeat(74));
  console.log(`${"모델".padEnd(32)}${"평균".padStart(9)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
};

/* make(train) → (site) => {log, depth} */
function cv(make) {
  const errs = [], depths = [];
  for (let f = 0; f < K; f++) {
    const train = sites.filter((s) => s.fold !== f);
    const P = make(train);
    for (const o of sites.filter((s) => s.fold === f)) {
      const r = P(o);
      const p = Math.exp(r.log);
      errs.push(Math.abs(p - o.pyPrice) / o.pyPrice * 100);
      depths.push(r.depth ?? 0);
    }
  }
  return { ...score(errs), errs, depths };
}

const AGG = { 평균: mean, 중앙값: median, 절사평균: trimmed };

head("① 축소계수 K · 대푯값");
let best = null;
for (const [aggName, agg] of Object.entries(AGG)) {
  for (const k of [0.2, 0.35, 0.5, 0.7, 1.0]) {
    const r = cv((tr) => buildTree(tr, PATH_A, k, agg));
    if (!best || r.mae < best.r.mae) best = { label: `트리A K=${k} ${aggName}`, k, agg, aggName, r };
  }
}
for (const [aggName, agg] of Object.entries(AGG)) {
  const r = cv((tr) => buildTree(tr, PATH_A, best.k, agg));
  row(`트리A · K=${best.k} · ${aggName}`, r);
}
for (const k of [0.2, 0.35, 0.5, 0.7, 1.0]) {
  const r = cv((tr) => buildTree(tr, PATH_A, k, best.agg));
  row(`트리A · K=${k} · ${best.aggName}`, r);
}
console.log(`\n가장 좋음: ${best.label} → 평균 ${best.r.mae}% · 중앙 ${best.r.p50}%`);

head("② 경로 구조 앙상블 (A=성격 포함, B=순수 주소)");
const treeA = (tr) => buildTree(tr, PATH_A, best.k, best.agg);
const treeB = (tr) => buildTree(tr, PATH_B, best.k, best.agg);
row("A 단독", cv(treeA));
row("B 단독", cv(treeB));
let bestEns = null;
for (const w of [0.2, 0.3, 0.4, 0.5]) {
  const r = cv((tr) => {
    const a = treeA(tr), b = treeB(tr);
    return (o) => {
      const ra = a(o), rb = b(o);
      return { log: (1 - w) * ra.log + w * rb.log, depth: ra.depth };
    };
  });
  row(`A:B = ${Math.round((1 - w) * 100)}:${Math.round(w * 100)}`, r);
  if (!bestEns || r.mae < bestEns.r.mae) bestEns = { w, r };
}

head("③ 트리 + 인근·최근 비교법 혼합");
let bestMix = null;
for (const w of [0, 0.15, 0.25, 0.35, 0.5, 0.7]) {
  const r = cv((tr) => {
    const a = treeA(tr), c = buildComps(tr);
    return (o) => {
      const ra = a(o);
      return { log: (1 - w) * ra.log + w * c(o).log, depth: ra.depth };
    };
  });
  row(`트리:비교법 = ${Math.round((1 - w) * 100)}:${Math.round(w * 100)}`, r);
  if (!bestMix || r.mae < bestMix.r.mae) bestMix = { w, r };
}

head("④ 셋 다 섞기");
let bestAll = null;
/* ⚠️ 격자를 넓힐수록 교차검증 자체에 맞춰 깎을 위험이 있습니다.
   표본이 공고 345건이라 0.3%p 안쪽 차이는 잡음으로 봐야 합니다.
   그래서 최고점만 보지 않고, 상위권이 어디에 모여 있는지도 같이 봅니다. */
const grid = [];
for (const wb of [0, 0.15, 0.25, 0.35, 0.5]) {
  for (const wc of [0, 0.1, 0.15, 0.25, 0.35]) {
    if (wb + wc > 0.7) continue;
    const r = cv((tr) => {
      const a = treeA(tr), b = treeB(tr), c = buildComps(tr);
      return (o) => {
        const ra = a(o);
        return { log: (1 - wb - wc) * ra.log + wb * b(o).log + wc * c(o).log, depth: ra.depth };
      };
    });
    grid.push({ wb, wc, r });
    if (!bestAll || r.mae < bestAll.r.mae) bestAll = { wb, wc, r };
  }
}
for (const g of grid.sort((a, b) => a.r.mae - b.r.mae).slice(0, 6)) {
  row(`A ${Math.round((1 - g.wb - g.wc) * 100)} : B ${Math.round(g.wb * 100)} : 비교법 ${Math.round(g.wc * 100)}`, g.r);
}
console.log(`  상위 6개가 ${grid[0].r.mae}% ~ ${grid[5].r.mae}% 안에 몰려 있습니다 — 이 차이는 잡음입니다.`);

/* ── 최종 후보의 신뢰도 등급별 성능 ─────────────────────────── */
const FINAL = (tr) => {
  const a = treeA(tr), b = treeB(tr), c = buildComps(tr);
  const { wb, wc } = bestAll;
  return (o) => {
    const ra = a(o);
    return { log: (1 - wb - wc) * ra.log + wb * b(o).log + wc * c(o).log, depth: ra.depth };
  };
};
const fin = cv(FINAL);
head("⑤ 최종 후보 — 신뢰도 등급별");
const byDepth = {};
fin.errs.forEach((e, i) => {
  const d = fin.depths[i];
  const g = d >= 5 ? 5 : d === 4 ? 4 : d === 3 ? 3 : 2;
  (byDepth[g] ??= []).push(e);
});
const NAME = { 5: "높음 — 읍면동·지구까지 일치", 4: "보통 — 시군구까지 일치",
               3: "낮음 — 시군구 실적 통째로", 2: "매우 낮음 — 시도에서 빌림" };
row("전체", fin);
for (const d of [5, 4, 3, 2]) if (byDepth[d]) row(`  ${NAME[d]}`, score(byDepth[d]));

const out = {
  at: new Date().toISOString(), sites: sites.length,
  chosen: { path: "A+B+comps", k: best.k, agg: best.aggName, wb: bestAll.wb, wc: bestAll.wc },
  all: score(fin.errs),
  byDepth: Object.fromEntries([5, 4, 3, 2].filter((d) => byDepth[d]).map((d) => [d, score(byDepth[d])])),
};
fs.writeFileSync("data/model-final.json", JSON.stringify(out, null, 2));
console.log(`\n선택: 트리A ${Math.round((1 - bestAll.wb - bestAll.wc) * 100)}% + 트리B ${Math.round(bestAll.wb * 100)}%`
  + ` + 비교법 ${Math.round(bestAll.wc * 100)}% · K=${best.k} · ${best.aggName}`);
console.log("data/model-final.json 저장");
