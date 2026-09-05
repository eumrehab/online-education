const SPREADSHEET_ID = "1NgAiSK8ZDZWSX6lAvhromq66Ci2UxB8dIwDBDzhGwWo";

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const data = JSON.parse(e.parameter.payload || "{}");
    if (!data.studentId || !data.name) throw new Error("수강생 정보가 없습니다.");

    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    upsertStudent(book.getSheetByName("수강생 현황"), data);
    upsertProgress(book.getSheetByName("강의별 진도"), data);
    if (data.eventType === "exam_submit") upsertExam(book.getSheetByName("시험 결과"), data);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function findStudentRow(sheet, studentId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
  const index = ids.indexOf(String(studentId));
  return index === -1 ? lastRow + 1 : index + 2;
}

function upsertStudent(sheet, data) {
  const row = findStudentRow(sheet, data.studentId);
  sheet.getRange(row, 1, 1, 6).setValues([[
    String(data.studentId), data.name, String(data.birthDate || ""),
    Number(data.overallProgress || 0) / 100, Number(data.completedLessons || 0),
    new Date(data.lastAccessAt)
  ]]);
  sheet.getRange(row, 4).setNumberFormat("0%");
  sheet.getRange(row, 6).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  if (data.eventType === "exam_submit") {
    sheet.getRange(row, 7, 1, 2).setValues([[
      Number(data.score || 0), data.passStatus === "완료" ? "합격" : "불합격"
    ]]);
  }
}

function upsertProgress(sheet, data) {
  const row = findStudentRow(sheet, data.studentId);
  const lessons = Array.from({ length: 8 }, (_, i) => Number(data.lessonProgress?.[i] || 0) / 100);
  sheet.getRange(row, 1, 1, 12).setValues([[
    String(data.studentId), data.name, ...lessons,
    Number(data.overallProgress || 0) / 100, new Date(data.lastAccessAt)
  ]]);
  sheet.getRange(row, 3, 1, 9).setNumberFormat("0%");
  sheet.getRange(row, 12).setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function upsertExam(sheet, data) {
  const row = findStudentRow(sheet, data.studentId);
  const answers = Array.from({ length: 5 }, (_, i) => data.answers?.[i] ?? "");
  sheet.getRange(row, 1, 1, 11).setValues([[
    String(data.studentId), data.name, "제출 완료", new Date(data.submittedAt), ...answers,
    Number(data.score || 0), data.passStatus === "완료" ? "합격" : "불합격"
  ]]);
  sheet.getRange(row, 4).setNumberFormat("yyyy-mm-dd hh:mm:ss");
}
