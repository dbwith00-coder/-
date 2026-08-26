/* ============================================================
   법정동코드(LAWD_CD) 확보 경로 탐침
   ------------------------------------------------------------
   실거래가 API 는 시군구를 이름이 아니라 5자리 코드로만 받습니다.
   그런데 행정표준코드 API 는 이 키로 열리지 않았습니다
   (SERVICE_KEY_IS_NOT_REGISTERED — 서비스마다 활용신청이 따로입니다).

   그래서 코드표를 얻을 다른 길을 재 봅니다.
     ① 실거래가 상세(신) 가 다른 코드로는 되는지
     ② 공개된 법정동코드 데이터셋을 그냥 내려받을 수 있는지
     ③ 실거래가 API 자체로 코드를 훑어낼 수 있는지 (응답에 지역명이 옵니다)
        — 되면 남의 저장소에 기대지 않고 자립할 수 있습니다.

   아무것도 커밋하지 않습니다.
   ============================================================ */

import fs from "node:fs";

const KEY = process.env.ODCLOUD_KEY || "";
const q = (o) => new URLSearchParams(o).toString();
const short = (s, n = 300) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const d = new Date();
d.setMonth(d.getMonth() - 1);
const YM = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

const tradeUrl = (path, code) =>
  `https://apis.data.go.kr/1613000/${path}?${q(
    { serviceKey: KEY, LAWD_CD: code, DEAL_YMD: YM, numOfRows: 1, pageNo: 1, _type: "json" })}`;

async function get(url, ms = 20000) {
  const t0 = Date.now();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { Accept: "application/json,text/*;q=0.9", "User-Agent": "jipdang-probe/1.0" },
  });
  const text = await res.text();
  return { status: res.status, text, ms: Date.now() - t0 };
}

const out = { at: new Date().toISOString(), ym: YM };

/* ── ① 상세(신) 이 다른 코드로는 되는가 ────────────────────── */
console.log("① 실거래가 엔드포인트 비교 (같은 코드로)");
out.endpoints = [];
for (const code of ["11650", "41590", "41135"]) {
  for (const path of ["RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
                      "RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"]) {
    try {
      const r = await get(tradeUrl(path, code));
      const j = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
      const total = j?.response?.body?.totalCount
        ?? /<totalCount>(\d+)<\/totalCount>/.exec(r.text)?.[1] ?? "?";
      const name = j?.response?.body?.items?.item?.estateAgentSggNm
        ?? j?.response?.body?.items?.item?.[0]?.estateAgentSggNm ?? "";
      const row = { code, path: path.split("/")[0], status: r.status, total, name };
      out.endpoints.push(row);
      console.log(`   ${code} · ${row.path.padEnd(24)} HTTP ${r.status} totalCount=${String(total).padStart(5)} ${name}`);
    } catch (e) { console.log(`   ${code} · ${path}: ${String(e.message).slice(0, 60)}`); }
    await sleep(120);
  }
}

/* ── ② 공개 법정동코드 데이터셋 ────────────────────────────── */
console.log("\n② 공개된 법정동코드 데이터셋을 받을 수 있는가");
const DATASETS = [
  ["raw.githubusercontent / vuski",
   "https://raw.githubusercontent.com/vuski/admdongkor/master/README.md"],
  ["npm registry (korea-administrative-area)",
   "https://registry.npmjs.org/korea-administrative-area-geo-json"],
  ["data.go.kr 파일 페이지",
   "https://www.data.go.kr/data/15063424/fileData.do"],
];
out.datasets = [];
for (const [name, url] of DATASETS) {
  try {
    const r = await get(url, 15000);
    out.datasets.push({ name, url, status: r.status, bytes: r.text.length });
    console.log(`   ${name.padEnd(38)} HTTP ${r.status} · ${r.text.length}바이트`);
  } catch (e) {
    out.datasets.push({ name, url, error: String(e.message) });
    console.log(`   ${name.padEnd(38)} ✗ ${String(e.message).slice(0, 50)}`);
  }
}

/* ── ③ 실거래가 API 로 코드를 직접 훑기 ────────────────────
   유효한 코드면 응답에 지역명(estateAgentSggNm)이 들어옵니다.
   앞 시도에서 250회를 6.5초에 끝내고 0개를 찾은 건 너무 빨랐다는 뜻 —
   전부 거부당하고 빈 catch 에 먹힌 것으로 보입니다.
   이번엔 동시 3, 실패 사유를 남기고, 서울 실제 구 코드 대역만 훑습니다. */
console.log("\n③ 코드 훑기 — 서울 11110~11380 (271개), 동시 3, 실패 사유 기록");
const found = {};
const errs = {};
let calls = 0, t0 = Date.now();
const codes = [];
for (let i = 11110; i <= 11380; i++) codes.push(String(i));
const queue = [...codes];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const code = queue.shift();
    try {
      const r = await get(tradeUrl("RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade", code), 15000);
      calls++;
      const j = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
      if (!j) { errs[short(r.text, 60)] = (errs[short(r.text, 60)] || 0) + 1; continue; }
      const hdr = j?.response?.header?.resultCode ?? j?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg;
      if (hdr && !/^0+$/.test(String(hdr))) { errs[String(hdr)] = (errs[String(hdr)] || 0) + 1; continue; }
      const it = j?.response?.body?.items?.item;
      const one = Array.isArray(it) ? it[0] : it;
      if (one?.estateAgentSggNm) found[code] = String(one.estateAgentSggNm).trim();
    } catch (e) {
      const k = String(e?.message || e).slice(0, 50);
      errs[k] = (errs[k] || 0) + 1;
    }
    await sleep(40);
  }
}));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
out.scan = { tried: codes.length, calls, found, errs, secs: +secs };
console.log(`   ${calls}회 호출 ${secs}초 · 찾은 코드 ${Object.keys(found).length}개`);
console.log("   " + Object.entries(found).map(([c, n]) => `${c}=${n}`).join("  "));
if (Object.keys(errs).length) {
  console.log("   실패 사유:");
  for (const [k, v] of Object.entries(errs).slice(0, 6)) console.log(`     ${v}회 · ${k}`);
}
const per = calls ? Number(secs) / calls : 0;
console.log(`   전국 환산(17개 시도 × 1000): 약 ${Math.round(17000 * per / 60)}분 · 17,000회 호출`);

/* ── ④ 화성시가 왜 0건인지 — 2025년에 구가 생겼습니다 ────── */
console.log("\n④ 화성시 구 신설 확인 (41590 이 0건이었습니다)");
out.hwaseong = {};
for (const code of ["41590", "41591", "41592", "41593", "41594", "41595"]) {
  try {
    const r = await get(tradeUrl("RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade", code), 15000);
    const j = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
    const it = j?.response?.body?.items?.item;
    const one = Array.isArray(it) ? it[0] : it;
    const total = j?.response?.body?.totalCount ?? "?";
    out.hwaseong[code] = { total, name: one?.estateAgentSggNm ?? "" };
    console.log(`   ${code}  totalCount=${String(total).padStart(4)}  ${one?.estateAgentSggNm ?? ""}`);
  } catch (e) { console.log(`   ${code}  ✗ ${String(e.message).slice(0, 40)}`); }
  await sleep(150);
}

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/probe-lawd.json", JSON.stringify(out, null, 2));
console.log("\ndata/probe-lawd.json 저장");
