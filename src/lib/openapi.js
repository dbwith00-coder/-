/* ============================================================
   공공데이터 오픈API 연동 — 브라우저 설정 계층
   ------------------------------------------------------------
   대상 2종
   ① LH 분양임대공고별 공급정보  https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1
   ② odcloud 청약 데이터셋       https://api.odcloud.kr/api  (Swagger stage 37000)

   ⚠️ 두 호스트 모두 CORS 헤더를 주지 않아 브라우저 직접 호출은 불가능합니다.
      기본값을 상대경로(/openapi/...)로 두고 vite.config.js 의 프록시가 중계합니다.
   ⚠️ 인증키는 코드에 박지 않습니다. .env.local 또는 화면의 "API 설정" 값을 씁니다.

   파싱·정규화 규칙은 notices-core.js 에 있고, 수집 워크플로와 공유합니다.
   ============================================================ */

export * from "./notices-core.js";

const LS_KEY = "jipdang:apiConfig";
const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

export const DEFAULT_CONFIG = {
  serviceKey: ENV.VITE_ODCLOUD_KEY || "",
  lhBase: ENV.VITE_LH_BASE || "/openapi/lh",
  lhPath: ENV.VITE_LH_PATH || "/lhLeaseNoticeSplInfo1",
  odcBase: ENV.VITE_ODC_BASE || "/openapi/odcloud",
  odcPath: ENV.VITE_ODC_PATH || "",
  rows: 50,
  enabled: true,
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* 저장 불가 환경 무시 */ }
}
