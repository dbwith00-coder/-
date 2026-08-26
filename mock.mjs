import http from "node:http";
import fs from "node:fs";
import path from "node:path";

/* 실제 API 를 흉내 낸 목 서버.
   ── /lh                             LH 계열 봉투 [{resHeader},{dsList}]
   ── /ApplyhomeInfoDetailSvc/v1/...  청약홈 봉투 {page,perPage,...,data:[]}
   청약홈 쪽 필드는 Swagger 확정 스키마를 그대로 따랐습니다. */

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

/* 청약홈 APT 분양정보 상세 (getAPTLttotPblancDetail_model) */
const APT_DETAIL = [
  {
    HOUSE_MANAGE_NO: "2026000123", PBLANC_NO: "2026000123",
    HOUSE_NM: "래미안 원페를라", HOUSE_SECD: "01", HOUSE_SECD_NM: "APT",
    HOUSE_DTL_SECD: "01", HOUSE_DTL_SECD_NM: "민영",
    RENT_SECD: "0", RENT_SECD_NM: "분양주택",
    SUBSCRPT_AREA_CODE: "100", SUBSCRPT_AREA_CODE_NM: "서울",
    HSSPLY_ZIP: "06691", HSSPLY_ADRES: "서울특별시 서초구 방배동 946-8번지 일원",
    TOT_SUPLY_HSHLDCO: 482, RCRIT_PBLANC_DE: "2026-08-20",
    RCEPT_BGNDE: "2026-08-24", RCEPT_ENDDE: "2026-08-28",
    SPSPLY_RCEPT_BGNDE: "2026-08-24", SPSPLY_RCEPT_ENDDE: "2026-08-24",
    GNRL_RNK1_CRSPAREA_RCPTDE: "2026-08-26", GNRL_RNK1_CRSPAREA_ENDDE: "2026-08-26",
    PRZWNER_PRESNATN_DE: "2026-09-03",
    CNTRCT_CNCLS_BGNDE: "2026-09-15", CNTRCT_CNCLS_ENDDE: "2026-09-17",
    CNSTRCT_ENTRPS_NM: "삼성물산(주)", BSNS_MBY_NM: "방배6구역 주택재건축정비사업조합",
    MVN_PREARNGE_YM: "202811",
    SPECLT_RDN_EARTH_AT: "Y", MDAT_TRGET_AREA_SECD: "Y", PARCPRC_ULS_AT: "Y",
    IMPRMN_BSNS_AT: "Y", PUBLIC_HOUSE_EARTH_AT: "N", LRSCL_BLDLND_AT: "N",
    PBLANC_URL: "https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do",
  },
  {
    HOUSE_MANAGE_NO: "2026000456", PBLANC_NO: "2026000456",
    HOUSE_NM: "고양창릉 신혼희망타운", HOUSE_SECD: "10", HOUSE_SECD_NM: "신혼희망타운",
    HOUSE_DTL_SECD: "03", HOUSE_DTL_SECD_NM: "국민",
    SUBSCRPT_AREA_CODE: "410", SUBSCRPT_AREA_CODE_NM: "경기",
    HSSPLY_ADRES: "경기도 고양시 덕양구 화전동 일원",
    TOT_SUPLY_HSHLDCO: 620, RCRIT_PBLANC_DE: "2026-08-14",
    RCEPT_BGNDE: "2026-09-10", RCEPT_ENDDE: "2026-09-14",
    SPSPLY_RCEPT_BGNDE: "2026-09-10", SPSPLY_RCEPT_ENDDE: "2026-09-10",
    PRZWNER_PRESNATN_DE: "2026-09-22",
    CNSTRCT_ENTRPS_NM: "한국토지주택공사", BSNS_MBY_NM: "한국토지주택공사",
    MVN_PREARNGE_YM: "202903",
    SPECLT_RDN_EARTH_AT: "N", MDAT_TRGET_AREA_SECD: "N", PARCPRC_ULS_AT: "Y",
    IMPRMN_BSNS_AT: "N", PUBLIC_HOUSE_EARTH_AT: "Y", LRSCL_BLDLND_AT: "Y",
    PUBLIC_HOUSE_SPCLW_APPLC_AT: "Y",
    PBLANC_URL: "https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do",
  },
];

/* 청약홈 APT 주택형별 상세 (getAPTLttotPblancMdl_model) — 금액 단위는 만원 */
const APT_MDL = [
  { HOUSE_MANAGE_NO: "2026000123", PBLANC_NO: "2026000123", MODEL_NO: "01",
    HOUSE_TY: "059.9200A", SUPLY_AR: "84.1200", SUPLY_HSHLDCO: 62, SPSPLY_HSHLDCO: 58,
    MNYCH_HSHLDCO: 12, NWWDS_HSHLDCO: 21, LFE_FRST_HSHLDCO: 11,
    OLD_PARNTS_SUPORT_HSHLDCO: 4, INSTT_RECOMEND_HSHLDCO: 10, ETC_HSHLDCO: 0,
    LTTOT_TOP_AMOUNT: "168000" },
  { HOUSE_MANAGE_NO: "2026000123", PBLANC_NO: "2026000123", MODEL_NO: "02",
    HOUSE_TY: "074.9800B", SUPLY_AR: "102.3400", SUPLY_HSHLDCO: 48, SPSPLY_HSHLDCO: 40,
    MNYCH_HSHLDCO: 8, NWWDS_HSHLDCO: 15, LFE_FRST_HSHLDCO: 8,
    OLD_PARNTS_SUPORT_HSHLDCO: 3, INSTT_RECOMEND_HSHLDCO: 6, ETC_HSHLDCO: 0,
    LTTOT_TOP_AMOUNT: "205000" },
  { HOUSE_MANAGE_NO: "2026000123", PBLANC_NO: "2026000123", MODEL_NO: "03",
    HOUSE_TY: "084.9500A", SUPLY_AR: "115.7700", SUPLY_HSHLDCO: 140, SPSPLY_HSHLDCO: 134,
    MNYCH_HSHLDCO: 27, NWWDS_HSHLDCO: 48, LFE_FRST_HSHLDCO: 24,
    OLD_PARNTS_SUPORT_HSHLDCO: 9, INSTT_RECOMEND_HSHLDCO: 26, ETC_HSHLDCO: 0,
    LTTOT_TOP_AMOUNT: "232000" },
  { HOUSE_MANAGE_NO: "2026000456", PBLANC_NO: "2026000456", MODEL_NO: "01",
    HOUSE_TY: "055.0000", SUPLY_AR: "76.2000", SUPLY_HSHLDCO: 210, SPSPLY_HSHLDCO: 180,
    NWWDS_HSHLDCO: 120, NWBB_HSHLDCO: 48, YGMN_HSHLDCO: 12,
    LTTOT_TOP_AMOUNT: "42000" },
  { HOUSE_MANAGE_NO: "2026000456", PBLANC_NO: "2026000456", MODEL_NO: "02",
    HOUSE_TY: "059.9000", SUPLY_AR: "82.5000", SUPLY_HSHLDCO: 130, SPSPLY_HSHLDCO: 100,
    NWWDS_HSHLDCO: 64, NWBB_HSHLDCO: 30, YGMN_HSHLDCO: 6,
    LTTOT_TOP_AMOUNT: "48000" },
];

const XML_ERR = `<?xml version="1.0"?><OpenAPI_ServiceResponse><cmmMsgHeader>` +
  `<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const envelope = (data) => ({
  page: 1, perPage: 100, totalCount: data.length, currentCount: data.length,
  matchCount: data.length, data,
});

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const key = u.searchParams.get("serviceKey");
  const p = u.pathname;
  const isApi = p === "/lh" || p === "/odc" || p.startsWith("/ApplyhomeInfoDetailSvc/");

  if (isApi) {
    if (key === "BADKEY") { res.writeHead(200, { "Content-Type": "application/xml" }); return res.end(XML_ERR); }
    if (key === "SERVERDOWN") { res.writeHead(500, { "Content-Type": "text/plain" }); return res.end("upstream 500"); }
    res.writeHead(200, { "Content-Type": "application/json" });

    if (p.endsWith("/getAPTLttotPblancDetail")) {
      /* 모집공고일 하한 조건이 오면 실제처럼 걸러줍니다 */
      const gte = u.searchParams.get("cond[RCRIT_PBLANC_DE::GTE]");
      const rows = gte ? APT_DETAIL.filter((r) => r.RCRIT_PBLANC_DE >= gte) : APT_DETAIL;
      return res.end(JSON.stringify(envelope(rows)));
    }
    if (p.endsWith("/getAPTLttotPblancMdl")) {
      const hm = u.searchParams.get("cond[HOUSE_MANAGE_NO::EQ]");
      const pb = u.searchParams.get("cond[PBLANC_NO::EQ]");
      const rows = APT_MDL.filter((r) =>
        (!hm || r.HOUSE_MANAGE_NO === hm) && (!pb || r.PBLANC_NO === pb));
      return res.end(JSON.stringify(envelope(rows)));
    }
    if (p === "/lh") return res.end(JSON.stringify(LH));
    return res.end(JSON.stringify(envelope([])));
  }

  const f = p === "/" ? "/index.html" : p;
  const fp = path.join(process.cwd(), "dist", f);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404); res.end("nope");
}).listen(8899, () => console.log("mock on 8899"));
