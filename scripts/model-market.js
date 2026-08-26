/* ============================================================
   분양가 모델 탐색 5 — 주변 시세를 넣으면 얼마나 줄어드는가
   ------------------------------------------------------------
   위치만 아는 모델은 평균 12.71% 에서 멈췄습니다. 한계도 쟀습니다 —
   같은 읍면동·6개월 안에 분양한 두 단지끼리도 평당가가 10.8% 벌어집니다.
   그 차이를 만드는 게 주변 아파트 가격대(시세)입니다.

   그래서 예측 방식을 바꿔 봅니다.

     지금:  평당 분양가 = 지역 트리 값
     시세:  평당 분양가 = 주변 실거래 평당가 × (분양가/시세 비율)

   비율 쪽이 이치에 맞습니다. 분양가는 절대 금액이 아니라 주변 시세에
   맞춰 정해지고, 그 비율은 상한제 여부·지역 성격에 따라 달라집니다.
   상한제 단지는 시세의 70~85%, 비상한제는 90~110% 쯤입니다.

   검증은 앞과 똑같이 **공고 단위 5겹 교차검증**입니다.
   시세는 그 공고 시점 앞뒤 자료만 씁니다 — 미래 거래를 보면 반칙입니다.
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const TRADES = JSON.parse(fs.readFileSync("data/trades.json", "utf8"));
const LAWD = JSON.parse(fs.readFileSync("data/lawd.json", "utf8"));

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

const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;
const TAXI = /지구|블록|BL|신도시|택지/;

/* ── 시세 조회 ────────────────────────────────────────────
   data/trades.json 은 "시군구코드|법정동|연월" → [중앙값, 건수] 입니다.
   공고 시점 기준 ±WIN 개월 안의 칸을 모아 중앙값을 냅니다.
   법정동이 안 맞으면 시군구 전체로 물러납니다. */
const WIN = 6;
const cellIndex = {};                 /* "코드|동" → [[연월, 값, 건수]...] */
const sggIndex = {};                  /* "코드"     → [[연월, 값, 건수]...] */
for (const [k, v] of Object.entries(TRADES.cells)) {
  const [code, dong, ym] = k.split("|");
  (cellIndex[`${code}|${dong}`] ??= []).push([ym, v[0], v[1]]);
  (sggIndex[code] ??= []).push([ym, v[0], v[1]]);
}
const ymNum = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6));
const near = (list, ym) => {
  if (!list) return null;
  const t = ymNum(ym);
  const vals = [], ws = [];
  for (const [y, v, n] of list) {
    if (Math.abs(ymNum(y) - t) > WIN) continue;
    for (let i = 0; i < Math.min(n, 40); i++) vals.push(v);   /* 건수만큼 가중 */
    ws.push(n);
  }
  if (!vals.length) return null;
  return { v: median(vals), n: ws.reduce((a, b) => a + b, 0) };
};

function lawdOf(gu) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  for (const n of [tok.slice(0, 3).join(" "), tok.slice(0, 2).join(" ")]) {
    if (LAWD.sgg[n]) return LAWD.sgg[n];
  }
  return null;
}

/* ── 관측치 ───────────────────────────────────────────────── */
const sites = [];
let noCode = 0, noMarket = 0;
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

  const code = lawdOf(gu);
  if (!code) noCode++;
  const when = new Date(s.when || "2026-01-01");
  const ym = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, "0")}`;
  const dong = tok[2] || "";
  const mDong = code ? near(cellIndex[`${code}|${dong}`], ym) : null;
  const mSgg = code ? near(sggIndex[code], ym) : null;
  const market = mDong || mSgg;
  if (!market) noMarket++;

  const rural = /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(gu) ? "읍면"
    : TAXI.test(gu) ? "택지" : "시가지";
  sites.push({
    sido: tok[0], sgg: tok[1] || "", emd: dong, rural,
    redev: (s.tags || []).includes("정비사업") ? "재개발" : "일반",
    capped: (s.tags || []).includes("분양가상한제") ? "Y" : "N",
    supply: s.supply || "민영",
    pyPrice: ref.pp,
    market: market?.v ?? null, marketN: market?.n ?? 0,
    marketLevel: mDong ? "동" : mSgg ? "시군구" : "없음",
    n: s.n, gu, ym,
  });
}
console.log(`공고 ${sites.length}건 · 시세 붙은 것 ${sites.filter((s) => s.market).length}건`);
console.log(`  코드 매칭 실패 ${noCode}건 · 시세 없음 ${noMarket}건`);
const lv = {};
sites.forEach((s) => (lv[s.marketLevel] = (lv[s.marketLevel] || 0) + 1));
console.log(`  시세 단계: ` + Object.entries(lv).map(([k, v]) => `${k} ${v}건`).join(" · "));

/* 분양가/시세 비율이 실제로 어떤 모양인지 먼저 봅니다 */
const withM = sites.filter((s) => s.market);
const ratios = withM.map((s) => s.pyPrice / s.market);
console.log(`\n분양가 ÷ 시세 비율 — 중앙 ${median(ratios).toFixed(3)}`
  + ` · 25분위 ${pct(ratios, 0.25).toFixed(3)} · 75분위 ${pct(ratios, 0.75).toFixed(3)}`);
for (const [lbl, f] of [
  ["분양가상한제 Y", (s) => s.capped === "Y"], ["분양가상한제 N", (s) => s.capped === "N"],
  ["재개발", (s) => s.redev === "재개발"], ["일반", (s) => s.redev === "일반"],
  ["읍면", (s) => s.rural === "읍면"], ["택지", (s) => s.rural === "택지"], ["시가지", (s) => s.rural === "시가지"],
  ["공공", (s) => s.supply === "공공"], ["민영", (s) => s.supply === "민영"],
]) {
  const v = withM.filter(f).map((s) => s.pyPrice / s.market);
  if (v.length >= 8) console.log(`  ${lbl.padEnd(14)} n=${String(v.length).padStart(3)}  중앙 ${median(v).toFixed(3)}`);
}

/* ── 교차검증 ─────────────────────────────────────────────── */
const K = 5;
sites.forEach((s, i) => (s.fold = i % K));
const pathOf = (s) => [s.sido, s.rural, s.sgg, s.redev, s.emd].filter(Boolean);
const K_SHRINK = 0.5;

function buildTree(train, valueOf) {
  const nodes = new Map();
  for (const o of train) {
    const v = valueOf(o);
    if (v == null || !isFinite(v)) continue;
    const p = pathOf(o);
    for (let i = 0; i <= p.length; i++) {
      const key = p.slice(0, i).join(SEP);
      (nodes.get(key) ?? nodes.set(key, []).get(key)).push(Math.log(v));
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
  return (p) => {
    for (let i = p.length; i >= 0; i--) {
      const key = p.slice(0, i).join(SEP);
      if (est.has(key)) return { v: Math.exp(est.get(key)), depth: i };
    }
    return { v: Math.exp(est.get("") ?? 0), depth: 0 };
  };
}

const score = (errs) => ({
  n: errs.length, mae: +mean(errs).toFixed(2), p50: +median(errs).toFixed(2),
  p80: +pct(errs, 0.8).toFixed(2),
  w10: +(errs.filter((e) => e <= 10).length / errs.length * 100).toFixed(0),
  w20: +(errs.filter((e) => e <= 20).length / errs.length * 100).toFixed(0),
});
const row = (label, r) =>
  console.log(`${label.padEnd(30)}${String(r.n).padStart(5)}건${(r.mae + "%").padStart(9)}`
    + `${(r.p50 + "%").padStart(8)}${(r.p80 + "%").padStart(9)}${(r.w10 + "%").padStart(8)}${(r.w20 + "%").padStart(8)}`);
const head = (t) => {
  console.log("\n" + t);
  console.log("-".repeat(77));
  console.log(`${"모델".padEnd(30)}${"표본".padStart(6)}${"평균".padStart(9)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
};

/* 여러 방식을 같은 잣대로 */
function cv(predictor, only = () => true) {
  const errs = [];
  for (let f = 0; f < K; f++) {
    const train = sites.filter((s) => s.fold !== f);
    const test = sites.filter((s) => s.fold === f && only(s));
    const P = predictor(train);
    for (const o of test) {
      const p = P(o);
      if (p == null || !isFinite(p) || p <= 0) continue;
      errs.push(Math.abs(p - o.pyPrice) / o.pyPrice * 100);
    }
  }
  return score(errs);
}

/* ① 지금 모델 — 지역 트리만 */
const treeOnly = (train) => {
  const t = buildTree(train, (o) => o.pyPrice);
  return (o) => t(pathOf(o)).v;
};
/* ② 시세만 — 비율을 전국 하나로 */
const ratioFlat = (train) => {
  const r = median(train.filter((o) => o.market).map((o) => o.pyPrice / o.market));
  const t = buildTree(train, (o) => o.pyPrice);
  return (o) => (o.market ? o.market * r : t(pathOf(o)).v);
};
/* ③ 시세 × 지역별 비율 — 비율 자체를 트리로 학습 */
const ratioTree = (train) => {
  const rt = buildTree(train.filter((o) => o.market), (o) => o.pyPrice / o.market);
  const t = buildTree(train, (o) => o.pyPrice);
  return (o) => (o.market ? o.market * rt(pathOf(o)).v : t(pathOf(o)).v);
};
/* ④ ③ + 상한제·공급유형 보정 */
const ratioTreeAdj = (train) => {
  const rt = buildTree(train.filter((o) => o.market), (o) => o.pyPrice / o.market);
  const t = buildTree(train, (o) => o.pyPrice);
  const adj = {};
  for (const key of ["capped", "supply"]) {
    const b = {};
    for (const o of train) {
      if (!o.market) continue;
      let p = o.market * rt(pathOf(o)).v;
      for (const [k2, tab] of Object.entries(adj)) p *= tab[o[k2]] ?? 1;
      (b[o[key]] ??= []).push(Math.log(o.pyPrice / p));
    }
    adj[key] = Object.fromEntries(Object.entries(b)
      .filter(([, v]) => v.length >= 10).map(([k, v]) => [k, Math.exp(mean(v))]));
  }
  return (o) => {
    if (!o.market) return t(pathOf(o)).v;
    let p = o.market * rt(pathOf(o)).v;
    for (const [k, tab] of Object.entries(adj)) p *= tab[o[k]] ?? 1;
    return p;
  };
};
/* ⑤ 트리와 시세를 로그공간에서 섞기 — 어느 쪽도 혼자선 완전하지 않으니 */
const blend = (w) => (train) => {
  const rt = buildTree(train.filter((o) => o.market), (o) => o.pyPrice / o.market);
  const t = buildTree(train, (o) => o.pyPrice);
  return (o) => {
    const a = t(pathOf(o)).v;
    if (!o.market) return a;
    const b = o.market * rt(pathOf(o)).v;
    return Math.exp((1 - w) * Math.log(a) + w * Math.log(b));
  };
};

head("전체 공고 기준");
const base = cv(treeOnly);
row("① 지역 트리만 (지금)", base);
row("② 시세 × 전국 비율", cv(ratioFlat));
row("③ 시세 × 지역별 비율", cv(ratioTree));
row("④ ③ + 상한제·공급유형 보정", cv(ratioTreeAdj));
let bestW = null;
for (const w of [0.2, 0.35, 0.5, 0.65, 0.8]) {
  const r = cv(blend(w));
  row(`⑤ 트리:시세 = ${Math.round((1 - w) * 100)}:${Math.round(w * 100)}`, r);
  if (!bestW || r.mae < bestW.r.mae) bestW = { w, r };
}

head("시세가 실제로 붙은 공고만 (시세 방식의 진짜 성능)");
const onlyM = (s) => !!s.market;
row("① 지역 트리만", cv(treeOnly, onlyM));
row("③ 시세 × 지역별 비율", cv(ratioTree, onlyM));
row("④ ③ + 보정", cv(ratioTreeAdj, onlyM));
row(`⑤ 최적 혼합 (시세 ${Math.round(bestW.w * 100)}%)`, cv(blend(bestW.w), onlyM));

head("시세를 동 단위로 잡은 공고만 (가장 좋은 조건)");
const onlyDong = (s) => s.marketLevel === "동";
row("① 지역 트리만", cv(treeOnly, onlyDong));
row("④ 시세 × 지역별 비율 + 보정", cv(ratioTreeAdj, onlyDong));
row(`⑤ 최적 혼합`, cv(blend(bestW.w), onlyDong));

const final = cv(ratioTreeAdj);
fs.writeFileSync("data/model-market.json", JSON.stringify({
  at: new Date().toISOString(), sites: sites.length,
  withMarket: withM.length, byLevel: lv,
  ratioMedian: +median(ratios).toFixed(4),
  baseline: base, ratioTreeAdj: final, bestBlend: { w: bestW.w, ...bestW.r },
}, null, 2));
console.log("\ndata/model-market.json 저장");
