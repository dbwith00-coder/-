/* ============================================================
   커뮤니티 게시판 검사 — "정말 저장되는가"
   ------------------------------------------------------------
   예전 코드는 window.storage 라는 없는 API 에 저장하려 해서, 글이 화면에만
   남고 새로고침하면 사라졌습니다. 그 회귀를 다시는 놓치지 않도록
   **새로고침을 실제로 거쳐서** 확인합니다.

     글쓰기 → 목록에 나타남 → 새로고침 → 여전히 있음
     → 글 열기 → 댓글 → 새로고침 → 댓글도 있음
     → 삭제 → 새로고침 → 사라짐
   ============================================================ */
import { chromium } from "playwright";

const file = "file://" + process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

let pass = 0, fail = 0;
const t = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

const goCommunity = async () => {
  await p.goto(file, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.click('button:has-text("커뮤니티")');
  await p.waitForTimeout(600);
};

const TITLE = "동탄 청약 같이 준비해요";
const BODY = "84타입 노려보려는데 가점 51점이면 승산 있을까요";
const COMMENT = "그 정도면 특공 쪽이 나을 수도 있어요";

/* ── 글쓰기 ── */
await goCommunity();
t("커뮤니티 화면 진입", (await p.innerText("body")).includes("글쓰기"));

await p.fill('input[placeholder="닉네임"]', "동탄러");
await p.fill('input[placeholder="제목"]', TITLE);
await p.fill('textarea', BODY);
const submit = await p.$('button:has-text("등록")');
t("등록 버튼이 눌릴 수 있는 상태", !(await submit.isDisabled()));
await submit.click();
await p.waitForTimeout(600);

let body = await p.innerText("body");
t("글이 목록에 나타남", body.includes(TITLE));
t("글 개수 표시", /전체 글 1개/.test(body), (/전체 글 \d+개/.exec(body) || [])[0]);

/* ── 새로고침해도 남아 있는가 (여기가 핵심) ── */
await goCommunity();
body = await p.innerText("body");
t("새로고침 후에도 글이 남음", body.includes(TITLE));
t("닉네임도 기억됨", (await p.inputValue('input[placeholder="닉네임"]')) === "동탄러");

/* ── 댓글 ── */
await p.click(`button:has-text("${TITLE}")`);
await p.waitForTimeout(500);
t("글 상세 진입", (await p.innerText("body")).includes(BODY));
await p.fill('input[placeholder="닉네임"]', "이웃");
await p.fill('textarea', COMMENT);
await p.click('button:has-text("댓글 등록")');
await p.waitForTimeout(600);
body = await p.innerText("body");
t("댓글이 달림", body.includes(COMMENT));
t("댓글 수 표시", /댓글 1개/.test(body));

/* ── 새로고침해도 댓글이 남는가 ── */
await goCommunity();
body = await p.innerText("body");
t("목록에 댓글 수가 보임", /댓글 1\b/.test(body));
await p.click(`button:has-text("${TITLE}")`);
await p.waitForTimeout(500);
t("새로고침 후에도 댓글이 남음", (await p.innerText("body")).includes(COMMENT));

/* ── 삭제 ── */
await p.click('button:has-text("삭제") >> nth=0');
await p.waitForTimeout(600);
await goCommunity();
body = await p.innerText("body");
t("삭제한 글이 사라짐", !body.includes(TITLE));
t("빈 게시판 안내 표시", body.includes("아직 글이 없습니다"));

t("콘솔 에러 없음", errs.length === 0, errs.slice(0, 2).join(" | "));

await b.close();
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
