/* ============================================================
   분양가 모델 탐색 2 — 실무에서 쓰는 방식을 그대로 옮겨봅니다
   ------------------------------------------------------------
   지금 모델은 "그 지역 분양가 평균"입니다. 그런데 분양 실무에서
   예상 분양가를 뽑을 때 쓰는 방법은 크게 셋입니다.

     ① 인근 비교법  — 근처에서 최근 분양한 단지의 평당가를 가져와 맞춥니다.
                      가장 널리 쓰입니다. 핵심은 "근처"와 "최근" 둘 다입니다.
     ② 원가법      — 택지비 + 기본형건축비 + 가산비. 분양가상한제 단지의
                      법정 산정식이기도 합니다. 국토부 고시 기본형건축비는
                      2026.3 기준 ㎡당 222만원(전용 60~85㎡, 16~25층).
     ③ 시세 대비   — 주변 시세의 몇 % 로 잡습니다. 상한제 밖 단지에서 씁니다.
                      쓰지 말라고 하셔서 뺐습니다.

   ①은 지금 안 쓰고 있습니다. 지역 평균은 "근처"만 보고 "최근"은 안 봅니다.
   ②는 하한선으로 쓸 수 있습니다 — 실제 데이터의 최저가가 평당 1,050만원인데
   이건 건축비 734만 + 가산 + 최소 택지비와 거의 정확히 맞습니다.

   검증은 앞과 똑같이 **공고 단위 5겹 교차검증**입니다.
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
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;
const HIGH_END = /아크로|디에이치|르엘|오티에르|트리마제|원베일리|블레스티지|써밋|라클래시/;
const TIER1 = /자이|래미안|힐스테이트|푸르지오|편한세상|롯데캐슬|더샵|아이파크|위브|SK뷰|포레나|한신더휴|호반|우미린/;

/* ── 공고 단위로 모읍니다 — 예측 대상이 "공고 하나의 국민평형"이므로 ── */
const M0 = new Date("2025-08-01").getTime();
const monthIdx = (d) => {
  const t = new Date(String(d || "2026-01-01")).getTime();
  return isNaN(t) ? 6 : (t - M0) / (1000 * 60 * 60 * 24 * 30.44);
};

const sites = [];
for (const s of SNAP.sites) {
  if (s.scoreless || NOT_SALE.test(s.n)) continue;
  const path = String(s.gu || "").split(/\s+/).filter(Boolean).slice(0, 4);
  if (!path.length) continue;
  /* 국민평형(34평)에 가장 가까운 타입 하나 */
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
  const tags = s.tags || [];
  const brandText = `${s.brand} ${s.n}`;
  sites.push({
    key: `${s.n}|${s.gu}`, path, py: ref.py, pyPrice: ref.pyPrice,
    m: monthIdx(s.when),
    supply: s.supply || "민영",
    capped: tags.includes("분양가상한제") ? "Y" : "N",
    redev: tags.includes("정비사업") ? "Y" : "N",
    tier: HIGH_END.test(brandText) ? "하이엔드" : TIER1.test(brandText) ? "1군" : "일반",
    rural: /[면리]$|면 |리 /.test(String(s.gu || "")) ? "읍면리"
         : /동$|동 |가$/.test(String(s.gu || "")) ? "동" : "기타",
  });
}
console.log(`공고 ${sites.length}건 (국민평형 1건씩) · ${SNAP.collectedAt}\n`);

const K = 5;
sites.forEach((s, i) => (s.fold = i % K));

/* 두 주소가 몇 토큰까지 같은지 — 0(다른 시도) ~ 4(같은 동) */
const depthOf = (a, b) => {
  let d = 0;
  while (d < a.length && d < b.length && a[d] === b[d]) d++;
  return d;
};

/* ── ① 인근·최근 비교법 ────────────────────────────────────
   가까울수록, 최근일수록 크게 칩니다.
     가중치 = GEO^깊이 × exp(-|개월차| / TAU)
   GEO 가 크면 "바로 옆 단지"만 보고, 작으면 넓게 평균냅니다. */
function comps(train, target, { GEO, TAU, MIN_W }) {
  let sw = 0, swx = 0;
  for (const t of train) {
    const d = depthOf(target.path, t.path);
    const w = Math.pow(GEO, d) * Math.exp(-Math.abs(target.m - t.m) / TAU);
    sw += w; swx += w * Math.log(t.pyPrice);
  }
  if (sw < MIN_W) return null;
  return Math.exp(swx / sw);
}

/* ── 잔차 보정 ────────────────────────────────────────────── */
function fitFactors(train, predict, keys) {
  const factors = [];
  for (const key of keys) {
    const b = {};
    for (const o of train) {
      let p = predict(o);
      if (!p) continue;
      for (const f of factors) p *= f.tab[o[f.key]] ?? 1;
      (b[o[key]] ??= []).push(Math.log(o.pyPrice / p));
    }
    const tab = {};
    for (const [k, v] of Object.entries(b)) if (v.length >= 12) tab[k] = Math.exp(mean(v));
    factors.push({ key, tab });
  }
  return factors;
}

function score(errs) {
  return {
    n: errs.length,
    mae: +mean(errs).toFixed(2),
    p50: +median(errs).toFixed(2),
    p80: +pct(errs, 0.8).toFixed(2),
    p90: +pct(errs, 0.9).toFixed(2),
    w10: +(errs.filter((e) => e <= 10).length / errs.length * 100).toFixed(0),
    w20: +(errs.filter((e) => e <= 20).length / errs.length * 100).toFixed(0),
  };
}

/* truncate: 테스트할 때 주소를 몇 토큰까지만 아는 걸로 칠지.
   뉴스에서 찾은 현장은 보통 시군구까지밖에 모릅니다(2토큰). */
function cvComps(opt, keys = [], truncate = 4) {
  const errs = [];
  for (let k = 0; k < K; k++) {
    const train = sites.filter((s) => s.fold !== k);
    const test = sites.filter((s) => s.fold === k);
    const base = (o) => comps(train, o, opt);
    const factors = keys.length ? fitFactors(train, base, keys) : [];
    for (const o of test) {
      const q = { ...o, path: o.path.slice(0, truncate) };
      let p = comps(train, q, opt);
      if (!p) continue;
      for (const f of factors) p *= f.tab[q[f.key]] ?? 1;
      errs.push(Math.abs(p - o.pyPrice) / o.pyPrice * 100);
    }
  }
  return score(errs);
}

const row = (label, r) =>
  console.log(`${label.padEnd(30)}${(r.mae + "%").padStart(8)}${(r.p50 + "%").padStart(8)}`
    + `${(r.p80 + "%").padStart(9)}${(r.w10 + "%").padStart(8)}${(r.w20 + "%").padStart(8)}`);
const head = (t) => {
  console.log("\n" + t);
  console.log("─".repeat(71));
  console.log(`${"모델".padEnd(30)}${"평균".padStart(8)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
};

/* ── 격자 탐색 ────────────────────────────────────────────── */
head("① 인근·최근 비교법 — 가중치 모양 찾기 (주소 전체를 안다고 치고)");
let best = null;
for (const GEO of [8, 12, 20, 35, 60, 120, 300]) {
  for (const TAU of [2, 3, 4, 6, 9, 1e6]) {
    const r = cvComps({ GEO, TAU, MIN_W: 0.5 });
    if (!best || r.mae < best.r.mae) best = { GEO, TAU, r };
  }
}
for (const GEO of [12, 20, 35, 60, 120, 300]) {
  const r = cvComps({ GEO, TAU: best.TAU, MIN_W: 0.5 });
  row(`GEO ${String(GEO).padStart(3)} · TAU ${best.TAU === 1e6 ? "∞" : best.TAU}개월`, r);
}
console.log("  (GEO=거리 민감도, 클수록 '바로 그 동네'만 봅니다)");
for (const TAU of [2, 3, 4, 6, 9, 1e6]) {
  const r = cvComps({ GEO: best.GEO, TAU, MIN_W: 0.5 });
  row(`GEO ${best.GEO} · TAU ${TAU === 1e6 ? "∞ (시점 무시)" : TAU + "개월"}`, r);
}
console.log(`\n최적: GEO ${best.GEO} · TAU ${best.TAU === 1e6 ? "∞(시점 무시)" : best.TAU + "개월"}`
  + `  →  평균 ${best.r.mae}% · 중앙 ${best.r.p50}%`);

const OPT = { GEO: best.GEO, TAU: best.TAU, MIN_W: 0.5 };

head("② 비교법 + 조건 보정");
const KEYSETS = [
  ["보정 없음", []],
  ["+ 읍면리", ["rural"]],
  ["+ 읍면리·공급유형", ["rural", "supply"]],
  ["+ 읍면리·공급·브랜드", ["rural", "supply", "tier"]],
  ["+ 전부(상한제·정비사업까지)", ["rural", "supply", "tier", "capped", "redev"]],
];
let best2 = null;
for (const [label, keys] of KEYSETS) {
  const r = cvComps(OPT, keys);
  row(label, r);
  if (!best2 || r.mae < best2.r.mae) best2 = { label, keys, r };
}

head("③ 실제 상황 — 주소를 어디까지 아느냐에 따라");
for (const [label, tr] of [["동까지 안다 (공고 있음)", 4], ["구까지 (3토큰)", 3], ["시군구까지 (뉴스 현장)", 2]]) {
  row(label, cvComps(OPT, best2.keys, tr));
}

fs.writeFileSync("data/model-comps.json", JSON.stringify({
  at: new Date().toISOString(), sites: sites.length,
  opt: OPT, keys: best2.keys,
  full: cvComps(OPT, best2.keys, 4),
  sgg: cvComps(OPT, best2.keys, 2),
}, null, 2));
console.log("\ndata/model-comps.json 저장");
