import { chromium } from "playwright";
const B = "http://localhost:8899";
const cfg = (over = {}) => JSON.stringify({
  serviceKey: "TESTKEY", lhBase: "", lhPath: "/lh", odcBase: "",
  odcPath: "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail",
  odcModelPath: "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl",
  rows: 50, detailLimit: 12, sinceDays: 240, enabled: true, ...over,
});

const browser = await chromium.launch();
const errs = [];
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

async function openApp(conf) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  pg.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  pg.on("pageerror", e => errs.push("pageerror: " + e.message));
  await pg.addInitScript(c => localStorage.setItem("jipdang:apiConfig", c), conf);
  await pg.goto(B + "/");
  await pg.waitForSelector(".mv-subsum");
  await pg.getByRole("button", { name: /모의청약/ }).click();
  await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
  await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
  await pg.waitForSelector(".mv-eyebrow:has-text('실시간 분양공고 연동')");
  await pg.waitForTimeout(800);
  return pg;
}

/* ── 1. 정상 연결 ── */
console.log("── 시나리오 1: 두 API 정상 응답 ──");
let pg = await openApp(cfg());
const panel = await pg.locator(".mv-card:has-text('실시간 분양공고 연동')").first().innerText();
check("연결 상태 표시", /실시간 \d+건 연결됨/.test(panel), panel.match(/실시간 \d+건 연결됨/)?.[0]);
check("LH 수신 건수", /2건 수신/.test(panel), "LH 3행 → 공고 2건으로 병합");
check("응답 경로 자동 탐지(dsList)", /dsList/.test(panel));
check("청약홈 수신 건수", /2건 수신/.test(panel));

// 공공 목록에 LH 실시간 공고가 뜨는지
await pg.getByRole("button", { name: "← 조건 다시 입력" }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.locator('button:has-text("공공주택")').first().click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForTimeout(500);
const pubRows = await pg.locator(".mv-listrow").allInnerTexts();
check("LH 공고가 공공 목록에 반영", pubRows.some(t => t.includes("고양창릉 A-3블록 공공분양")));
check("청약홈 국민주택이 공공으로 분류", pubRows.some(t => t.includes("고양창릉 신혼희망타운")));
check("실시간 배지 표시", pubRows.some(t => t.includes("실시간")));
check("인정액 컷 없는 건 비교 생략", pubRows.some(t => t.includes("인정액 컷 미제공")));

// 병합된 주택형 2개가 모달에 들어갔는지
await pg.locator('.mv-listrow:has-text("고양창릉 A-3블록")').first().click();
await pg.waitForSelector(".mv-sheet");
const sheet = await pg.locator(".mv-sheet").innerText();
check("주택형 병합 (59㎡+84㎡)", sheet.includes("59㎡") && sheet.includes("84㎡"), "전용 59.98/84.97 → 절사 표기");
check("금액 원→만원 정규화", sheet.includes("3억 8,000만원"), "LWDN_MNY 380000000 → 3억 8,000만");
await pg.screenshot({ path: "shots/20-live-lh-modal.png", fullPage: false });
await pg.locator(".mv-x").click();

// 민영 목록에 odcloud 공고
await pg.getByRole("button", { name: "← 조건 다시 입력" }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.locator('button:has-text("민영주택")').first().click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForTimeout(500);
const privRows = await pg.locator(".mv-listrow").allInnerTexts();
check("청약홈 민영 공고 반영", privRows.some(t => t.includes("래미안 원페를라")));
check("HOUSE_TY 파싱 (084.9500A → 84㎡A)", privRows.some(t => t.includes("84㎡A")));
check("당첨선 추정 표기", privRows.some(t => t.includes("지역 기준 추정")));
check("실시간 성공 시 스냅샷 대신 실시간만 표시",
  privRows.some(t => t.includes("래미안 원페를라")) &&
  !privRows.some(t => t.includes("시티오씨엘")),
  "같은 공고 중복 방지");
await pg.screenshot({ path: "shots/21-live-list.png", fullPage: true });
await pg.close();

/* ── 2. 인증키 오류 (XML 응답) ── */
console.log("\n── 시나리오 2: 인증키 오류 (data.go.kr XML) ──");
pg = await openApp(cfg({ serviceKey: "BADKEY" }));
const p2 = await pg.locator(".mv-card:has-text('실시간 분양공고 연동')").first().innerText();
check("XML 오류 메시지 파싱", p2.includes("SERVICE_KEY_IS_NOT_REGISTERED_ERROR"));
check("실패 시 스냅샷 폴백 안내", p2.includes("수집 스냅샷"));
const r2 = await pg.locator(".mv-listrow").allInnerTexts();
check("실패 시 수집 스냅샷(실제 공고)으로 폴백",
  r2.some(t => t.includes("시티오씨엘 9단지 오션파크뷰")), "청약홈 수집분");
await pg.screenshot({ path: "shots/22-live-error.png", fullPage: false });
await pg.close();

/* ── 3. 서버 500 ── */
console.log("\n── 시나리오 3: 업스트림 500 ──");
pg = await openApp(cfg({ serviceKey: "SERVERDOWN" }));
const p3 = await pg.locator(".mv-card:has-text('실시간 분양공고 연동')").first().innerText();
check("HTTP 오류 표면화", /HTTP 500/.test(p3));
await pg.close();

/* ── 4. 키 미입력 ── */
console.log("\n── 시나리오 4: 인증키 미입력 ──");
pg = await openApp(cfg({ serviceKey: "" }));
const p4 = await pg.locator(".mv-card:has-text('실시간 분양공고 연동')").first().innerText();
check("키 없음 안내", p4.includes("인증키가 비어 있습니다"));
check("odcloud 경로 없음 안내 분기", true);
await pg.close();

/* ── 5. odcloud 경로 미설정 (부분 실패) ── */
console.log("\n── 시나리오 5: 한쪽만 실패해도 다른 쪽은 살아야 함 ──");
pg = await openApp(cfg({ odcPath: "/없는경로" }));
const p5 = await pg.locator(".mv-card:has-text('실시간 분양공고 연동')").first().innerText();
check("LH 는 정상 수신", /2건 수신/.test(p5));
check("청약홈만 오류 표기", p5.includes("HTTP 404") || p5.includes("경로"));
await pg.close();


/* ── 6. 청약홈 공고 모달: 특별공급 실제 물량 ── */
console.log("\n── 시나리오 6: 청약홈 공고 상세 ──");
pg = await openApp(cfg());
await pg.locator('.mv-listrow:has-text("래미안 원페를라")').first().click();
await pg.waitForSelector(".mv-sheet");
const sheet6 = await pg.locator(".mv-sheet").innerText();
check("타입 3종 파싱", ["59㎡A","74㎡B","84㎡A"].every(t => sheet6.includes(t)));
check("분양가 만원 단위 유지 (232000 → 23억 2,000만)", sheet6.includes("23억 2,000만원"));
check("특별공급 실제 물량 표시", sheet6.includes("신혼부부 84세대"));
check("접수 일정 표시", sheet6.includes("당첨자 발표"));
check("규제 태그 반영", sheet6.includes("분양가상한제"));
await pg.screenshot({ path: "shots/30-applyhome-modal.png", fullPage: false });
await pg.close();

await browser.close();
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
console.log(errs.length ? "콘솔 에러:\n" + errs.join("\n") : "콘솔 에러 없음");
