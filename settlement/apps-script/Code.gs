/**
 * 현장 손익·정산 관리 — Google Apps Script 서버 코드
 *
 * 1) 아래 SPREADSHEET_IDS 에 연결할 구글 시트 ID 를 넣습니다.
 *    시트 주소 https://docs.google.com/spreadsheets/d/<여기가 ID>/edit 의 <ID> 부분입니다.
 * 2) 같은 프로젝트에 HTML 파일 "Index" 를 만들고 settlement/index.html 내용을 붙여넣습니다.
 * 3) 배포 → 새 배포 → 웹 앱 (실행 사용자: 나, 액세스: 나만 또는 조직 내 사용자).
 *
 * 시트는 공개할 필요가 없습니다. 웹 앱이 배포한 사람의 권한으로 시트를 읽습니다.
 */
const SPREADSHEET_IDS = [
  // '1AbC...xyz',
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('현장 손익·정산 관리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 모든 시트의 값을 계산된 결과(수식 결과값)로 돌려줍니다. 날짜는 yyyy-MM-dd 문자열. */
function getWorkbooks() {
  const tz = Session.getScriptTimeZone();
  return SPREADSHEET_IDS.map(function (id) {
    try {
      const ss = SpreadsheetApp.openById(id);
      return {
        id: id,
        name: ss.getName(),
        sheets: ss.getSheets().map(function (sh) {
          const values = sh.getDataRange().getValues().map(function (row) {
            return row.map(function (v) {
              if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
              return v === '' ? null : v;
            });
          });
          return { name: sh.getName(), values: values };
        }),
      };
    } catch (e) {
      return { id: id, error: String(e && e.message || e) };
    }
  });
}
