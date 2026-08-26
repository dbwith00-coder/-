/* ============================================================
   분양가 모델 탐색 3 — 지역 트리에 "성격"을 끼워 넣기
   ------------------------------------------------------------
   오차 상위를 열어 보면 두 덩어리로 갈립니다.

     ① 읍·면·신규택지를 40~70% 과대예측
        안성 아양지구, 가평 설악면, 강화 선원면, 제주 조천읍, 원주 무실지구…
        같은 시/군 안의 "동" 실적을 물려받아서 그렇습니다.
        실제 분양가는 원가 하한(평당 1,050~1,400만)에 붙어 있습니다.

     ② 역세권 정비사업을 40~56% 과소예측
        수지자이 에디시온, 철산역자이, 힐스테이트 광명11, 상동역 롯데캐슬…
        같은 구의 일반 분양 실적에 눌립니다.

   앞서 이걸 "곱셈 보정 한 개"로 처리해 봤지만 효과가 없었습니다.
   전국 하나의 계수로 누르면, 비싼 수도권 읍면과 싼 지방 읍면이 서로
   상쇄돼 ×0.99 같은 무의미한 값이 나오기 때문입니다.

   그래서 보정이 아니라 **트리 자체를 쪼갭니다**.
       [시도] → [지역성격] → [시군구] → [읍면동] → [사업유형]
   이러면 "경기도 읍면" 노드가 따로 생겨서, 안성 읍면은 안성 동이 아니라
   경기도 읍면 평균 쪽으로 끌려갑니다. 축소는 그대로 걸립니다.
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
const HIGH_END = /아크로|디에이치|르엘|오티에르|트리마제|원베일리|블레스티지|써밋|라클래시/;
const TIER1 = /자이|래미안|힐스테이트|푸르지오|편한세상|롯데캐슬|더샵|아이파크|위브|SK뷰|포레나|한신더휴|호반|우미린/;
/* 주소에 지구·블록이 들어가면 공공택지입니다 — 상한제라 값이 다르게 형성됩니다 */
const TAXI = /지구|블록|BL|신도시|택지/;
/* 역세권 단지는 단지명 앞에 역 이름을 답니다 */
const STATION = /역세권|[가-힣]역\s|^[가-힣]{2,4}역/;

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
    const pyPrice = t.price / py;
    if (pyPrice < 300 || pyPrice > 12000) continue;
    const d = Math.abs(py - 34);
    if (!ref || d < ref.d) ref = { d, py, pyPrice };
  }
  if (!ref) continue;
  const tags = s.tags || [];
  const brandText = `${s.brand} ${s.n}`;
  /* 지역 성격 — 읍·면·리인지, 공공택지인지, 일반 시가지인지 */
  const rural = /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(gu) ? "읍면"
    : TAXI.test(gu) ? "택지" : "시가지";
  sites.push({
    key: `${s.n}|${gu}`, sido: tok[0], sgg: tok[1] || "", emd: tok[2] || "", tok,
    py: ref.py, pyPrice: ref.pyPrice,
    supply: s.supply || "민영",
    capped: tags.includes("분양가상한제") ? "Y" : "N",
    redev: tags.includes("정비사업") ? "재개발" : "일반",
    tier: HIGH_END.test(brandText) ? "하이엔드" : TIER1.test(brandText) ? "1군" : "일반",
    rural, station: STATION.test(s.n) ? "역세권" : "일반",
    n: s.n, gu,
  });
}
console.log(`공고 ${sites.length}건 · ${SNAP.collectedAt}`);
const cnt = {};
sites.forEach((s) => (cnt[s.rural] = (cnt[s.rural] || 0) + 1));
console.log("지역 성격: " + Object.entries(cnt).map(([k, v]) => `${k} ${v}건`).join(" · ") + "\n");

const K = 5;
sites.forEach((s, i) => (s.fold = i % K));

/* ── 경로 만들기 — 여기가 이 실험의 전부입니다 ────────────── */
const PATHS = {
  "현재 (시도>시군구>읍면동)": (s) => s.tok.slice(0, 4),
  "성격을 시도 밑에": (s) => [s.sido, s.rural, s.sgg, s.emd].filter(Boolean),
  "성격을 시군구 밑에": (s) => [s.sido, s.sgg, s.rural, s.emd].filter(Boolean),
  "성격 + 정비사업": (s) => [s.sido, s.rural, s.sgg, s.emd, s.redev].filter(Boolean),
  "성격 + 정비사업 + 역세권": (s) => [s.sido, s.rural, s.sgg, s.emd, s.redev, s.station].filter(Boolean),
  "성격 + 정비사업(구 단위)": (s) => [s.sido, s.rural, s.sgg, s.redev, s.emd].filter(Boolean),
};
/* 뉴스 현장은 읍면동을 모를 수 있습니다 — 그때 쓸 짧은 경로 */
const TRUNC = {
  "현재 (시도>시군구>읍면동)": (s) => s.tok.slice(0, 2),
  "성격을 시도 밑에": (s) => [s.sido, s.rural, s.sgg],
  "성격을 시군구 밑에": (s) => [s.sido, s.sgg, s.rural],
  "성격 + 정비사업": (s) => [s.sido, s.rural, s.sgg],
  "성격 + 정비사업 + 역세권": (s) => [s.sido, s.rural, s.sgg],
  "성격 + 정비사업(구 단위)": (s) => [s.sido, s.rural, s.sgg, s.redev],
};

function buildTree(train, pathOf, k) {
  const nodes = new Map();
  for (const o of train) {
    const p = pathOf(o);
    for (let i = 0; i <= p.length; i++) {
      const key = p.slice(0, i).join(SEP);
      (nodes.get(key) ?? nodes.set(key, []).get(key)).push(Math.log(o.pyPrice));
    }
  }
  const est = new Map();
  const depth = (x) => (x === "" ? 0 : x.split(SEP).length);
  for (const key of [...nodes.keys()].sort((a, b) => depth(a) - depth(b))) {
    const v = nodes.get(key);
    const parent = key === "" ? null : est.get(key.split(SEP).slice(0, -1).join(SEP));
    const m = mean(v);
    est.set(key, parent == null ? m : (v.length * m + k * parent) / (v.length + k));
  }
  return (p) => {
    for (let i = p.length; i >= 0; i--) {
      const key = p.slice(0, i).join(SEP);
      if (est.has(key)) return Math.exp(est.get(key));
    }
    return Math.exp(est.get("") ?? 0);
  };
}

function cv(pathOf, testPathOf, k) {
  const errs = [];
  for (let f = 0; f < K; f++) {
    const tree = buildTree(sites.filter((s) => s.fold !== f), pathOf, k);
    for (const o of sites.filter((s) => s.fold === f)) {
      const p = tree(testPathOf(o));
      errs.push(Math.abs(p - o.pyPrice) / o.pyPrice * 100);
    }
  }
  return {
    n: errs.length, mae: +mean(errs).toFixed(2), p50: +median(errs).toFixed(2),
    p80: +pct(errs, 0.8).toFixed(2),
    w10: +(errs.filter((e) => e <= 10).length / errs.length * 100).toFixed(0),
    w20: +(errs.filter((e) => e <= 20).length / errs.length * 100).toFixed(0),
  };
}

const row = (label, r) =>
  console.log(`${label.padEnd(30)}${(r.mae + "%").padStart(8)}${(r.p50 + "%").padStart(8)}`
    + `${(r.p80 + "%").padStart(9)}${(r.w10 + "%").padStart(8)}${(r.w20 + "%").padStart(8)}`);
const head = (t) => {
  console.log("\n" + t);
  console.log("-".repeat(71));
  console.log(`${"경로 구조".padEnd(30)}${"평균".padStart(8)}${"중앙".padStart(8)}${"80분위".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
};

head("주소를 끝까지 아는 경우 (공고가 이미 난 단지)");
let best = null;
for (const [label, pathOf] of Object.entries(PATHS)) {
  let b = null;
  for (const k of [1, 2, 3, 5, 8]) {
    const r = cv(pathOf, pathOf, k);
    if (!b || r.mae < b.r.mae) b = { k, r };
  }
  row(`${label} (K=${b.k})`, b.r);
  if (!best || b.r.mae < best.r.mae) best = { label, pathOf, ...b };
}
console.log(`\n가장 좋음: ${best.label} · K=${best.k}  ->  평균 ${best.r.mae}% · 중앙 ${best.r.p50}%`);
head("축소계수 K 를 바꿔 가며 (경로: " + best.label + ")");
for (const k of [0, 0.5, 1, 2, 3, 5, 8, 15]) row(`K = ${k}`, cv(best.pathOf, best.pathOf, k));

head("시군구까지만 아는 경우 (뉴스에서 찾은 현장)");
let bestT = null;
for (const [label, pathOf] of Object.entries(PATHS)) {
  let b = null;
  for (const k of [1, 2, 3, 5, 8]) {
    const r = cv(pathOf, TRUNC[label], k);
    if (!b || r.mae < b.r.mae) b = { k, r };
  }
  row(`${label} (K=${b.k})`, b.r);
  if (!bestT || b.r.mae < bestT.r.mae) bestT = { label, k: b.k, r: b.r };
}
console.log(`\n가장 좋음: ${bestT.label} · K=${bestT.k}  ->  평균 ${bestT.r.mae}% · 중앙 ${bestT.r.p50}%`);

fs.writeFileSync("data/model-tree.json", JSON.stringify({
  at: new Date().toISOString(), sites: sites.length,
  best: { label: best.label, k: best.k, ...best.r },
  bestTruncated: { label: bestT.label, k: bestT.k, ...bestT.r },
}, null, 2));
console.log("\ndata/model-tree.json 저장");
