/* ============================================================
   실거래가(시세) 소스 탐침
   ------------------------------------------------------------
   분양예정가 추정에 "주변 시세"를 넣으려면 실거래가가 필요합니다.
   국토부 실거래가 API가 지금 인증키로 열리는지, 어떤 엔드포인트가
   살아 있는지, 응답 모양이 어떤지 러너에서 직접 두드려 봅니다.

   ⚠️ data.go.kr 키는 서비스마다 따로 "활용신청"을 해야 열립니다.
      청약홈 키가 그대로 통할 수도, SERVICE_ACCESS_DENIED 가 날 수도
      있습니다. 그걸 확인하는 게 이 스크립트의 목적입니다.

   아무것도 커밋하지 않습니다 — 접근 가능 여부만 봅니다.
   ============================================================ */

import fs from "node:fs";

const KEY = process.env.ODCLOUD_KEY || "";
const q = (o) => new URLSearchParams(o).toString();
const short = (s, n = 400) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

/* XML 응답에서 태그 하나 뽑기 */
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};

async function probe(name, url, note = "") {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      headers: { Accept: "application/json,text/xml;q=0.9,*/*;q=0.8", "User-Agent": "jipdang-probe/1.0" },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* XML */ }

    /* 성공/실패 판정 — data.go.kr 은 200 으로 에러를 돌려주기도 합니다 */
    const code = json?.response?.header?.resultCode ?? tag(text, "resultCode");
    const msg = json?.response?.header?.resultMsg ?? tag(text, "resultMsg")
      ?? tag(text, "returnAuthMsg") ?? tag(text, "errMsg");
    const total = json?.response?.body?.totalCount ?? tag(text, "totalCount");

    /* 첫 행의 필드 이름 — 뭘 쓸 수 있는지 보려고 */
    let firstItemKeys = null, firstItem = null;
    const it = json?.response?.body?.items?.item;
    if (Array.isArray(it) && it[0]) { firstItemKeys = Object.keys(it[0]); firstItem = it[0]; }
    else if (it && typeof it === "object") { firstItemKeys = Object.keys(it); firstItem = it; }
    else {
      const m = /<item>([\s\S]*?)<\/item>/.exec(text);
      if (m) {
        firstItemKeys = [...m[1].matchAll(/<([A-Za-z0-9_]+)>/g)].map((x) => x[1]);
        firstItem = Object.fromEntries(
          [...m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)].map((x) => [x[1], x[2].trim()]));
      }
    }

    return {
      name, note, url: url.replace(encodeURIComponent(KEY), "«KEY»").replace(KEY, "«KEY»"),
      httpOk: res.ok, status: res.status, ms: Date.now() - t0,
      contentType: res.headers.get("content-type"), bytes: text.length,
      resultCode: code, resultMsg: msg, totalCount: total,
      firstItemKeys, firstItem,
      preview: firstItemKeys ? null : short(text),
    };
  } catch (e) {
    return { name, note, url: url.replace(KEY, "«KEY»"), httpOk: false, status: 0,
             ms: Date.now() - t0, error: String(e?.message || e) };
  }
}

/* 지난달 — 실거래는 당월 자료가 비어 있을 수 있습니다 */
const d = new Date();
d.setMonth(d.getMonth() - 1);
const YM = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

/* 41590 화성시 · 11650 서초구 — 거래가 많아 비어 있을 일이 없는 곳 */
const TARGETS = [
  ["아파트 매매 실거래가 상세(신)",
   `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?${q(
     { serviceKey: KEY, LAWD_CD: "41590", DEAL_YMD: YM, numOfRows: 5, pageNo: 1 })}`,
   "가장 쓰고 싶은 것 — 전용면적·거래금액·법정동이 다 옵니다"],

  ["아파트 매매 실거래가 상세(신) · JSON",
   `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?${q(
     { serviceKey: KEY, LAWD_CD: "41590", DEAL_YMD: YM, numOfRows: 5, pageNo: 1, _type: "json" })}`,
   "같은 것 JSON 형식"],

  ["아파트 매매 실거래가(기본)",
   `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?${q(
     { serviceKey: KEY, LAWD_CD: "11650", DEAL_YMD: YM, numOfRows: 5, pageNo: 1, _type: "json" })}`,
   "상세가 막히면 대안"],

  ["행정표준코드 법정동코드",
   `https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList?${q(
     { ServiceKey: KEY, pageNo: 1, numOfRows: 5, type: "json", locatadd_nm: "경기도 화성시" })}`,
   "시군구 이름 → LAWD_CD 5자리. 이게 있어야 전국을 돌 수 있습니다"],

  ["청약홈 분양정보(대조군)",
   `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail?${q(
     { serviceKey: KEY, page: 1, perPage: 1 })}`,
   "키 자체가 살아 있는지 확인용"],
];

const out = [];
for (const [name, url, note] of TARGETS) {
  const r = await probe(name, url, note);
  out.push(r);
  console.log(`\n▸ ${name}`);
  console.log(`   ${note}`);
  console.log(`   HTTP ${r.status} · ${r.ms}ms · ${r.bytes ?? 0}바이트`);
  if (r.error) console.log(`   ✗ ${r.error}`);
  if (r.resultCode != null) console.log(`   resultCode=${r.resultCode}  resultMsg=${r.resultMsg}`);
  if (r.totalCount != null) console.log(`   totalCount=${r.totalCount}`);
  if (r.firstItemKeys) console.log(`   필드: ${r.firstItemKeys.join(", ")}`);
  if (r.firstItem) console.log(`   첫 행: ${short(JSON.stringify(r.firstItem), 300)}`);
  if (r.preview) console.log(`   본문: ${r.preview}`);
}

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/probe-trades.json",
  JSON.stringify({ at: new Date().toISOString(), ym: YM, keyLen: KEY.length, results: out }, null, 2));

console.log("\n" + "=".repeat(70));
const ok = out.filter((r) => r.httpOk && (r.resultCode == null || /^0+$/.test(String(r.resultCode))));
console.log(`열린 것 ${ok.length}/${out.length}: ${ok.map((r) => r.name).join(" · ") || "없음"}`);
console.log("data/probe-trades.json 저장");
