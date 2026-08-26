import http from "node:http";
import fs from "node:fs";
import path from "node:path";

/* 실제 API 를 흉내 낸 목 서버.
   LH 계열: [{resHeader:[...]},{dsList:[...]}]  / odcloud: {data:[...]} */
const LH = [
  { resHeader: [{ RS_CD: "00", RS_NM: "정상" }] },
  { dsList: [
    { PAN_ID: "2026-0001", PAN_NM: "고양창릉 A-3블록 공공분양", CNP_CD_NM: "경기 고양시",
      SPL_INST_NM: "LH 한국토지주택공사", PAN_NT_ST_DT: "2026-09-01", PAN_SS: "접수중",
      TOT_SUPLY_HSHLDCO: "1100", SUPLY_HSHLDCO: "340", EXCLUSE_AR: "59.98", LWDN_MNY: "380000000" },
    { PAN_ID: "2026-0001", PAN_NM: "고양창릉 A-3블록 공공분양", CNP_CD_NM: "경기 고양시",
      SPL_INST_NM: "LH 한국토지주택공사", PAN_NT_ST_DT: "2026-09-01", PAN_SS: "접수중",
      TOT_SUPLY_HSHLDCO: "1100", SUPLY_HSHLDCO: "180", EXCLUSE_AR: "84.97", LWDN_MNY: "520000000" },
    { PAN_ID: "2026-0002", PAN_NM: "부산 에코델타 B2 공공분양", CNP_CD_NM: "부산 강서구",
      SPL_INST_NM: "LH 한국토지주택공사", PAN_NT_ST_DT: "2026-10-15", PAN_SS: "공고중",
      TOT_SUPLY_HSHLDCO: "640", SUPLY_HSHLDCO: "300", EXCLUSE_AR: "74.5", LWDN_MNY: "410000000" },
  ] },
];

const ODC = {
  page: 1, perPage: 50, totalCount: 2, currentCount: 2, matchCount: 2,
  data: [
    { HOUSE_NM: "서초 래미안 원페를라", SIDO: "서울 서초구", BSNS_MBY_NM: "삼성물산",
      RCRIT_PBLANC_DE: "2026-09-20", HSHLD_CO: "482", EXCLUSE_AR: "84.9",
      LTTOT_TOP_AMOUNT: "2180000000" },
    { HOUSE_NM: "검단 파밀리에 엘리프", SIDO: "인천 서구", BSNS_MBY_NM: "신동아건설",
      RCRIT_PBLANC_DE: "2026-08-28", HSHLD_CO: "268", EXCLUSE_AR: "59.9",
      LTTOT_TOP_AMOUNT: "440000000" },
  ],
};

const XML_ERR = `<?xml version="1.0"?><OpenAPI_ServiceResponse><cmmMsgHeader>` +
  `<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const key = u.searchParams.get("serviceKey");

  if (u.pathname === "/lh" || u.pathname === "/odc") {
    if (key === "BADKEY") { res.writeHead(200, { "Content-Type": "application/xml" }); return res.end(XML_ERR); }
    if (key === "SERVERDOWN") { res.writeHead(500, { "Content-Type": "text/plain" }); return res.end("upstream 500"); }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(u.pathname === "/lh" ? LH : ODC));
  }

  const f = u.pathname === "/" ? "/index.html" : u.pathname;
  const fp = path.join(process.cwd(), "dist", f);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404); res.end("nope");
}).listen(8899, () => console.log("mock on 8899"));
