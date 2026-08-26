/* ============================================================
   단일 파일 검사 — 서버 없이(file://) 진짜로 도는지
   ------------------------------------------------------------
   배포본을 하나로 합쳤을 때 흔히 깨지는 것들을 봅니다.
     · 번들이 남의 도메인을 부르지 않는지 (인터넷 없이도 돌아야 합니다)
     · 콘솔 에러 없이 화면이 그려지는지
     · 허브 → 모의청약 → 결과까지 실제로 넘어가는지
     · 분양공고 스냅샷이 파일 안에 들어 있는지
   ============================================================ */
import { chromium } from "playwright";

const file = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage();
const errs = [], external = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) external.push(r.url()); });

await p.goto("file://" + file, { waitUntil: "load" });
await p.waitForTimeout(2500);

let pass = 0, fail = 0;
const t = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

t("제목 태그", (await p.title()).includes("집당"), await p.title());
const hub = await p.innerText("body");
t("허브가 그려짐", hub.includes("청약") && hub.includes("입주설계"));
t("가점이 계산돼 있음", /\d+\s*\/\s*84/.test(hub), (/(\d+)\s*\/\s*84/.exec(hub) || [])[0]);
t("공고 건수가 박혀 있음", /분양\s*\d{3}/.test(hub), (/분양\s*\d+/.exec(hub) || [])[0]);
t("콘솔 에러 없음", errs.length === 0, errs.slice(0, 2).join(" | "));
t("바깥 도메인 호출 없음", external.length === 0, external.slice(0, 2).join(" | "));

/* 허브 → 모의청약 */
await (await p.$$("button"))[0].click();
await p.waitForTimeout(1200);
const step1 = await p.innerText("body");
t("모의청약으로 이동", step1.length > hub.length / 2 && !/보기 →/.test(step1.slice(0, 200)));
t("입력 화면 진입", /만\s*나이|무주택|부양가족|청약통장|생년/.test(step1));

/* 끝까지 눌러서 결과 화면까지 */
for (let i = 0; i < 6; i++) {
  const next = await p.$('button:has-text("다음"), button:has-text("결과"), button:has-text("확인")');
  if (!next) break;
  await next.click();
  await p.waitForTimeout(700);
}
const later = await p.innerText("body");
t("진행 중 에러 없음", errs.length === 0, errs.slice(0, 2).join(" | "));
t("분양 관련 화면 도달", /공고|분양가|접수/.test(later));

await b.close();
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
