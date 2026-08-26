import { chromium } from "playwright";
import fs from "node:fs";
const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 1100 } });
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
pg.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await pg.goto("file://" + process.cwd() + "/standalone.html");
await pg.waitForSelector(".mv-subsum");
await pg.getByRole("button", { name: /모의청약/ }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForTimeout(1200);

let pass = 0, fail = 0;
const ck = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };

const body = await pg.locator(".mv-wrap").innerText();
const expUpcoming = SNAP.sites.filter(s => s.status === "접수 예정" && !s.scoreless).length;
const expNoScore = SNAP.sites.filter(s => s.scoreless && s.status !== "접수 마감").length;
ck("스냅샷 건수 표기", body.includes(`${SNAP.count}건`), `${SNAP.count}건`);
ck("접수 중 섹션", body.includes("접수 중 공고"));
ck("접수 예정 섹션 존재", body.includes("접수 예정 공고"));
ck("접수 예정은 공고 난 상태임을 명시", body.includes("모집공고는 이미 나왔고"));
ck("접수 예정 건수", body.includes(`${expUpcoming}건 · 공고 났고 접수 시작 전`), `${expUpcoming}건`);
ck("공고 전 현장은 별도 섹션 안내", body.includes("아직 공고 자체가 안 난 현장"));
ck("무순위 섹션", expNoScore > 0 ? body.includes("무순위 · 잔여세대") : true, `${expNoScore}건`);
ck("가칭 샘플 제거", !body.includes("가칭"), "동탄 레이크팰리스 등 삭제");
ck("아크메르 동탄 유지", body.includes("아크메르 동탄"));


// 뉴스 후보 섹션
const NEWS = JSON.parse(fs.readFileSync("src/data/upcoming-news.json", "utf8"));
ck("뉴스 후보 섹션", body.includes("분양 예정 단지 후보"));
ck("공식 아님 경고", body.includes("공공 API 에 없습니다") || body.includes("확정 정보가 아니고"));
ck("후보 건수 표기", body.includes(`후보 ${NEWS.count}건`), `${NEWS.count}건`);
ck("상위 후보 노출", body.includes(NEWS.candidates[0].name), NEWS.candidates[0].name);

// 마감 숨김 기본 동작
const rowsHidden = (await pg.locator(".mv-listrow").allInnerTexts()).length;
await pg.locator('button:has-text("접수 마감 숨김")').first().click();
await pg.waitForTimeout(600);
const rowsShown = (await pg.locator(".mv-listrow").allInnerTexts()).length;
ck("마감 포함 토글", rowsShown > rowsHidden, `${rowsHidden}행 → ${rowsShown}행`);

// D-day 표기
await pg.locator('button:has-text("✓ 접수 마감 포함")').first().click();
await pg.waitForTimeout(400);
const upSec = await pg.locator('.mv-card:has-text("접수 시작일 빠른 순")').first().innerText();
ck("D-day 또는 접수일 표기", /D-\d+|오늘 접수 시작|접수일 미정/.test(upSec));

await pg.screenshot({ path: "shots/50-nationwide.png", fullPage: true });
await b.close();
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
console.log(errs.length ? "에러:\n" + errs.slice(0,5).join("\n") : "콘솔 에러 없음");
