/* ============================================================
   분양가 모델 학습 — 실제 분양가에서 계수를 뽑습니다
   ------------------------------------------------------------
   scripts/model-tree.js · model-comps.js · model-conf.js · model-final.js 로
   여러 구성을 공고 단위 교차검증해 고른 결과를, 여기서 전체 데이터에 다시
   학습시켜 src/data/price-model-fit.js 로 냅니다.

   구조 — 지역 트리 **두 개**를 반씩 섞습니다.

     트리A  [시도] → [읍면/택지/시가지] → [시군구] → [재개발/일반] → [읍면동·지구]
     트리B  [시도] → [시군구] → [읍면동] → [상세]        (주소 그대로)

   왜 둘인가: 서로 다른 실수를 합니다. A는 성격을 갈라 놓아 안성 아양지구(읍면)가
   안성 시내 평균에 끌려 올라가는 걸 막지만, 성격 층이 하나 더 끼어 있어
   표본이 더 잘게 쪼개집니다. B는 잘게 쪼개지지 않는 대신 성격을 못 봅니다.
   로그공간에서 반씩 섞으면 둘 다보다 낫습니다 (12.64/12.95 → 12.38).

   표본이 적은 잎은 부모 쪽으로 끌어당깁니다(축소계수 K=0.35).
   노드 대푯값은 **절사평균**입니다 — 양 끝 10%를 잘라내 한 건짜리 이상치에
   덜 흔들립니다(단순평균 12.69 → 12.64).

   신뢰도 — 추정이 트리A의 어느 깊이에서 멈췄는지를 그대로 등급으로 씁니다.
     읍면동·지구까지 같은 사례가 있었으면 "높음", 시군구까지면 "보통",
     시군구 실적을 통째로 쓰면 "낮음", 시도에서 빌려오면 "매우 낮음".
     등급별 실제 오차는 교차검증으로 재서 FIT_CV.byDepth 에 넣고,
     화면 범위도 그 값(80분위)을 씁니다.

   ⚠️ 여기 숫자는 전부 model-final.json 에서 옵니다. 손으로 적지 않습니다.
   ============================================================ */

import fs from "node:fs";

const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const FINAL = JSON.parse(fs.readFileSync("data/model-final.json", "utf8"));

const SEP = String.fromCharCode(1);
const K_SHRINK = FINAL.chosen?.k ?? 0.35;
const W_B = 0.5;                    /* 트리B 가중치 — model-final.js 격자탐색 */

const NOT_SALE = /분양전환|토지임대|임대주택|공가세대|우선분양|장기전세|행복주택/;
const TAXI = /지구|블록|BL|신도시|택지/;

const PY_PER_M2 = 1.35 / 3.3058;
const pyOf = (t) => {
  const m = String(t).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) * PY_PER_M2 : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const trimmed = (v, f = 0.1) => {
  if (v.length < 5) return mean(v);
  const s = [...v].sort((a, b) => a - b);
  const k = Math.floor(s.length * f);
  return mean(s.slice(k, s.length - k));
};

/* 주소 → 성격. 학습과 조회가 **똑같은** 규칙을 써야 합니다. */
export function ruralOf(gu) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  return /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(String(gu))
    ? "읍면" : TAXI.test(String(gu)) ? "택지" : "시가지";
}

/* ── 관측치 — 공고 하나당 국민평형 1건 (예측 대상과 같은 단위) ── */
const obs = [];
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
    if (!ref || d < ref.d) ref = { d, pyPrice };
  }
  if (!ref) continue;
  const rural = ruralOf(gu);
  const redev = (s.tags || []).includes("정비사업") ? "재개발" : "일반";
  obs.push({
    tok, sido: tok[0], sgg: tok[1] || "", emd: tok[2] || "", rural, redev,
    pathA: [tok[0], rural, tok[1], redev, tok[2]].filter(Boolean),
    pathB: tok.slice(0, 4),
    pyPrice: ref.pyPrice, gu,
  });
}
console.log(`학습 공고 ${obs.length}건 (공고당 국민평형 1건)`);

/* ── 트리 만들기 ──────────────────────────────────────────── */
function buildTree(pathKey) {
  const nodes = new Map();
  for (const o of obs) {
    const p = o[pathKey];
    for (let i = 0; i <= p.length; i++) {
      const k = p.slice(0, i).join(SEP);
      (nodes.get(k) ?? nodes.set(k, []).get(k)).push(Math.log(o.pyPrice));
    }
  }
  const depthOf = (k) => (k === "" ? 0 : k.split(SEP).length);
  const val = {}, cnt = {};
  for (const k of [...nodes.keys()].sort((a, b) => depthOf(a) - depthOf(b))) {
    const v = nodes.get(k);
    const parent = k === "" ? null : val[k.split(SEP).slice(0, -1).join(SEP)];
    const m = trimmed(v);
    val[k] = parent == null ? m : (v.length * m + K_SHRINK * parent) / (v.length + K_SHRINK);
    cnt[k] = v.length;
  }
  return { val, cnt };
}
const A = buildTree("pathA");
const B = buildTree("pathB");

/* ── 지명 색인 ────────────────────────────────────────────
   뉴스 현장은 주소가 아니라 "동탄", "탕정", "부산" 같은 낱말로 옵니다.
   낱말 → [시도, 시군구, 읍면동, 성격] 으로 두면 조회할 때 트리A·B 경로를
   둘 다 다시 만들 수 있습니다.

   세 층을 다 넣습니다. 시도만 알면 시도 노드라도 써야 하고("부산"),
   지구 이름만 나오면 그걸 써야 합니다("첨단3지구", "풍무역세권").

   접미사를 뗀 형태도 같이 넣되("반포동"→"반포"), 그 형태가 이미 위 단계
   이름으로 등록돼 있으면 넣지 않습니다 — "의정부동"에서 '동'을 떼면
   의정부시와 충돌해 시 전체를 가리키는 말이 특정 동 값을 내놓게 됩니다. */
const SUFFIX = /(특별자치도|광역시|특별시|자치시|자치도|시|군|구|읍|면|동|리|가)$/;
const place = {};
const taken = new Set();          /* 위 단계에서 이미 쓴 짧은 형태 */
const put = (word, row, n) => {
  if (!word || word.length < 2) return;
  const cur = place[word];
  if (!cur || n > cur[4]) place[word] = [...row, n];
};
/* 층별 표본 수 — 어느 후보를 남길지 고르는 기준 */
const tally = (key) => obs.filter(key).length;

/* 1층 · 시도 */
for (const sido of [...new Set(obs.map((o) => o.sido))]) {
  const n = tally((o) => o.sido === sido);
  put(sido, [sido, "", "", "시가지"], n);
  const short = sido.replace(SUFFIX, "");
  if (short.length >= 2) { put(short, [sido, "", "", "시가지"], n); taken.add(short); }
}
/* 2층 · 시군구 (성격은 그 시군구에서 가장 흔한 것) */
const sggSeen = new Set();
for (const o of obs) {
  const key = `${o.sido}|${o.sgg}`;
  if (!o.sgg || sggSeen.has(key)) continue;
  sggSeen.add(key);
  const rows = obs.filter((x) => x.sido === o.sido && x.sgg === o.sgg);
  const byRural = {};
  rows.forEach((x) => (byRural[x.rural] = (byRural[x.rural] || 0) + 1));
  const rural = Object.entries(byRural).sort((a, b) => b[1] - a[1])[0][0];
  put(o.sgg, [o.sido, o.sgg, "", rural], rows.length);
  const short = o.sgg.replace(SUFFIX, "");
  if (short.length >= 2 && !taken.has(short)) { put(short, [o.sido, o.sgg, "", rural], rows.length); taken.add(short); }
}
/* 3층 · 읍면동·지구 */
const emdSeen = new Set();
for (const o of obs) {
  const key = `${o.sido}|${o.sgg}|${o.emd}`;
  if (!o.emd || emdSeen.has(key)) continue;
  emdSeen.add(key);
  const n = obs.filter((x) => x.sido === o.sido && x.sgg === o.sgg && x.emd === o.emd).length;
  const row = [o.sido, o.sgg, o.emd, o.rural];
  put(o.emd, row, n);
  const short = o.emd.replace(SUFFIX, "");
  if (short.length >= 2 && !taken.has(short)) put(short, row, n);
}

/* ── 저장 ─────────────────────────────────────────────────── */
const cv = FINAL.all, byDepth = FINAL.byDepth || {};
const NAME = { 5: "높음", 4: "보통", 3: "낮음", 2: "매우 낮음" };
const out = `/* 자동 생성 — scripts/calibrate.js
   청약홈 실제 분양가 공고 ${obs.length}건으로 학습한 분양가 모델.
   손으로 고치지 마세요. 수집이 갱신되면 npm run calibrate 로 다시 만듭니다.

   트리A [시도]>[읍면·택지·시가지]>[시군구]>[재개발·일반]>[읍면동·지구]
   트리B [시도]>[시군구]>[읍면동]>[상세]
   평당가 = exp( ${1 - W_B} × log(A) + ${W_B} × log(B) )
   축소계수 K=${K_SHRINK} · 노드 대푯값 절사평균(양끝 10%)

   성능(공고 단위 5겹 교차검증 — 학습에 안 쓴 공고를 위치만 보고 예측):
     전체        평균 ${cv?.mae}% · 중앙 ${cv?.p50}% · ±10% 안 ${cv?.w10}%
${[5, 4, 3, 2].filter((d) => byDepth[d]).map((d) =>
  `     신뢰도 ${NAME[d].padEnd(5)} 평균 ${String(byDepth[d].mae).padStart(5)}% · 중앙 ${String(byDepth[d].p50).padStart(5)}% · 범위 ±${Math.round(byDepth[d].p80)}%  (${byDepth[d].n}건)`).join("\n")} */
export const SEP = "\\u0001";
export const FIT_META = ${JSON.stringify({
  at: new Date().toISOString(), samples: obs.length,
  kShrink: K_SHRINK, wB: W_B, agg: "trimmed10",
  collectedAt: SNAP.collectedAt,
}, null, 2)};
export const FIT_CV = ${JSON.stringify({ all: cv, byDepth }, null, 2)};
export const FIT_A = ${JSON.stringify(Object.fromEntries(
  Object.entries(A.val).map(([k, v]) => [k, +v.toFixed(5)])), null, 0)};
export const FIT_A_N = ${JSON.stringify(A.cnt, null, 0)};
export const FIT_B = ${JSON.stringify(Object.fromEntries(
  Object.entries(B.val).map(([k, v]) => [k, +v.toFixed(5)])), null, 0)};
export const FIT_B_N = ${JSON.stringify(B.cnt, null, 0)};
/* 지명 낱말 → [시도, 시군구, 읍면동, 성격, 표본수] */
export const FIT_PLACE = ${JSON.stringify(place, null, 0)};
`;
fs.writeFileSync("src/data/price-model-fit.js", out, "utf8");

console.log(`트리A 노드 ${Object.keys(A.val).length}개 · 트리B 노드 ${Object.keys(B.val).length}개`
  + ` · 지명 색인 ${Object.keys(place).length}개`);
console.log(`교차검증 전체 평균 ${cv?.mae}% · 중앙 ${cv?.p50}%`);
for (const d of [5, 4, 3, 2]) {
  const s = byDepth[d];
  if (s) console.log(`  신뢰도 ${NAME[d].padEnd(5)} ${String(s.n).padStart(3)}건  평균 ${String(s.mae).padStart(5)}%  중앙 ${String(s.p50).padStart(5)}%  범위 ±${Math.round(s.p80)}%`);
}
console.log("src/data/price-model-fit.js 생성");
