const SPREADSHEET_ID = "1NgAiSK8ZDZWSX6lAvhromq66Ci2UxB8dIwDBDzhGwWo";

function doGet(e) {
  const callback = String(e && e.parameter.callback || "");
  let response = { ok: true };
  if (e && e.parameter.action === "settings") {
    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    response.settings = readLessonSettings(getOrCreateSettingsSheet(book));
  }
  const json = JSON.stringify(response);
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const data = JSON.parse(e.parameter.payload || "{}");
    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (data.eventType === "login") return authenticateStudent(book, data);
    const identity = verifySession(data.authToken);
    if (!identity) throw new Error("로그인 유효시간이 만료되었습니다. 다시 로그인해 주세요.");
    data.studentId = identity.studentId;
    data.name = identity.name;
    data.birthDate = identity.birthDate;
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

function authenticateStudent(book, data) {
  const nonce = String(data.nonce || "");
  try {
    const cache = CacheService.getScriptCache();
    const attemptKey = loginAttemptKey(data.studentId);
    const attempts = Number(cache.get(attemptKey) || 0);
    if (attempts >= 10) throw new Error("로그인 시도가 너무 많습니다. 10분 후 다시 시도해 주세요.");
    const sheet = findSheetByNormalizedName(book, "수강생명단");
    if (!sheet || sheet.getLastRow() < 2) throw new Error("수강생 명단이 등록되지 않았습니다.");
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues();
    const inputBirth = normalizeBirthDate(data.birthDate);
    const row = rows.find(value => String(value[0]).trim() === String(data.studentId).trim()
      && String(value[1]).trim() === String(data.name).trim()
      && normalizeBirthDate(value[2]) === inputBirth
      && String(value[3] || "").replace(/\s/g, "") === "사용");
    if (!row) {
      cache.put(attemptKey, String(attempts + 1), 600);
      return loginResponse({ ok: false, nonce, message: "등록된 수강생 정보와 일치하지 않습니다." });
    }
    const token = Utilities.getUuid() + Utilities.getUuid();
    const identity = { studentId: String(row[0]).trim(), name: String(row[1]).trim(), birthDate: inputBirth };
    cache.remove(attemptKey);
    cache.put("session_" + token, JSON.stringify(identity), 21600);
    return loginResponse({
      ok: true,
      nonce,
      authToken: token,
      authExpiresAt: Date.now() + 21600000,
      hasProgressRecord: hasStudentRecord(book.getSheetByName("강의별 진도"), identity.studentId),
      hasExamRecord: hasStudentRecord(book.getSheetByName("시험 결과"), identity.studentId),
      ...identity
    });
  } catch (error) {
    return loginResponse({ ok: false, nonce, message: error.message });
  }
}

function findSheetByNormalizedName(book, normalizedName) {
  return book.getSheets().find(sheet => sheet.getName().replace(/\s/g, "") === normalizedName) || null;
}

function hasStudentRecord(sheet, studentId) {
  if (!sheet || sheet.getLastRow() < 2) return false;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  return ids.includes(String(studentId));
}

function loginAttemptKey(studentId) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(studentId || ""));
  return "login_attempt_" + Utilities.base64EncodeWebSafe(digest).slice(0, 32);
}

function setupStudentRosterSheet() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = book.getSheetByName("수강생 명단");
  if (!sheet) sheet = book.insertSheet("수강생 명단");
  sheet.getRange(1, 1, 1, 4).setValues([["학번", "이름", "생년월일", "상태"]]);
  sheet.getRange("A:C").setNumberFormat("@");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 4);
}

function verifySession(token) {
  if (!token) return null;
  const saved = CacheService.getScriptCache().get("session_" + String(token));
  if (!saved) return null;
  try { return JSON.parse(saved); } catch (_) { return null; }
}

function normalizeBirthDate(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits.length === 8 ? digits.slice(2) : digits;
}

function loginResponse(data) {
  data.source = "welfare-course-login";
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return HtmlService.createHtmlOutput("<script>window.top.postMessage(" + json + ", '*');</script>")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getOrCreateSettingsSheet(book) {
  let sheet = book.getSheetByName("강의 공개 설정");
  if (!sheet) {
    sheet = book.insertSheet("강의 공개 설정");
    sheet.getRange(1, 1, 1, 4).setValues([["강의 번호", "강의 제목", "공개 상태", "공개 예정일"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readLessonSettings(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().map(row => ({
    lessonId: Number(row[0]),
    isPublic: row[2] !== "비공개",
    releaseDate: row[3] instanceof Date ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(row[3] || "")
  })).filter(item => item.lessonId);
}

function writeLessonSettings(sheet, settings) {
  const titles = [
    "건강과 인체의 이해 및 노인 신체, 인지, 정신 특성", "복지용구 제도 개요 및 노인장기요양보험",
    "복지용구의 이해와 활용(이동,이승)", "복지용구의 이해와 활용(기거,입욕 배설)",
    "복지용구사업소 설립계획 및 운영", "복지용구 소독 및 관리",
    "복지용구 이해와 활동(일상생활훈련)", "복지용구 안전과 환경관리(주택개조)"
  ];
  const values = titles.map((title, i) => {
    const item = settings.find(value => Number(value.lessonId) === i + 1) || {};
    return [i + 1, title, item.isPublic === false ? "비공개" : "공개", item.releaseDate || ""];
  });
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clearContent();
  sheet.getRange(2, 1, values.length, 4).setValues(values);
  sheet.getRange(2, 4, values.length, 1).setNumberFormat("yyyy-mm-dd");
  sheet.autoResizeColumns(1, 4);
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
