const CONFIG = {
  demoMode: true,
  passingScore: 80,
  // Google Apps Script를 배포한 뒤 발급된 /exec 주소를 입력하세요.
  resultsEndpoint: "https://script.google.com/macros/s/AKfycbxeczRU1B-ZZwZMAaHZcv_kxbiDyHs2nPzUXnnRmZ1Ism4JtyQJqb9Iqhr02gGOgoBOGg/exec",
  admin: { id: "admin", password: "admin" },
  // 실제 서버 연동 전 임시 수강생입니다.
  students: [{ studentId: "2026001", name: "홍길동", birthDate: "1990-01-01" }],
  lessons: [
    ["복지용구 제도의 이해", "복지용구 급여제도와 상담사의 역할을 알아봅니다."],
    ["노인장기요양보험 기초", "장기요양보험의 구조와 대상자를 이해합니다."],
    ["복지용구 품목 안내", "주요 급여 품목의 특징과 용도를 살펴봅니다."],
    ["대상자 욕구 파악", "상담 과정에서 필요한 욕구 파악 방법을 배웁니다."],
    ["안전한 제품 사용법", "제품별 안전 수칙과 사용 지도 방법을 익힙니다."],
    ["상담 실무와 기록", "효과적인 상담 진행과 기록 원칙을 확인합니다."],
    ["개인정보 보호", "수강생과 대상자의 개인정보 보호 기준을 배웁니다."],
    ["현장 사례 및 종합정리", "실제 사례를 통해 전체 교육 내용을 정리합니다."]
  ].map((item, i) => ({
    id: i + 1, title: item[0], description: item[1],
    // 임시 공개 샘플 영상입니다. 실제 영상 주소로 교체하세요.
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  })),
  questions: [
    { text: "복지용구 상담 시 가장 먼저 확인해야 할 사항으로 적절한 것은?", options: ["대상자의 상태와 생활환경", "제품의 색상", "광고 문구", "판매 순위"], correctAnswer: 0 },
    { text: "수강생 또는 대상자의 개인정보를 다룰 때 올바른 태도는?", options: ["업무 목적에 필요한 범위에서만 이용한다", "모든 직원에게 공유한다", "개인 기기에 저장한다", "별도 동의 없이 홍보에 활용한다"], correctAnswer: 0 },
    { text: "제품 사용 안내에 반드시 포함해야 할 내용은?", options: ["안전 수칙과 주의사항", "판매자의 개인 의견", "경쟁 제품의 단점", "불필요한 전문용어"], correctAnswer: 0 },
    { text: "상담 기록을 작성하는 주된 이유는?", options: ["상담 내용과 후속 조치를 정확히 관리하기 위해", "문서의 양을 늘리기 위해", "개인적인 평가를 남기기 위해", "광고에 사용하기 위해"], correctAnswer: 0 },
    { text: "대상자에게 적절한 복지용구를 안내하는 기준은?", options: ["신체 상태와 사용 환경", "가장 비싼 제품", "상담사의 취향", "재고가 많은 제품"], correctAnswer: 0 }
  ]
};

const $ = (id) => document.getElementById(id);
const views = ["loginView", "adminLoginView", "classroomView", "lessonView", "examView", "completeView", "adminView"];
let session = JSON.parse(localStorage.getItem("edu-session") || "null");
let currentLesson = 0;
let lastVideoTime = 0;
let internalSeek = false;
let saveTimer = null;
let reviewMode = false;
let cloudSyncTimer = null;

function progressKey() { return `edu-progress-${session?.studentId || "guest"}`; }
function resultKey() { return `edu-result-${session?.studentId || "guest"}`; }
function getProgress() {
  return JSON.parse(localStorage.getItem(progressKey()) || JSON.stringify(CONFIG.lessons.map(() => ({ watchedUntil: 0, duration: 0, completed: false }))));
}
function saveProgress(data) { localStorage.setItem(progressKey(), JSON.stringify(data)); }
function buildResultPayload(eventType) {
  const progress = getProgress();
  const result = JSON.parse(localStorage.getItem(resultKey()) || "null");
  return {
    eventType,
    studentId: session.studentId,
    name: session.name,
    birthDate: session.birthDate || "",
    lessonProgress: progress.map(percent),
    overallProgress: progress.every(p => p.completed) ? 100 : overall(progress),
    completedLessons: progress.filter(p => p.completed).length,
    answers: result?.answers || [],
    score: result?.score ?? "",
    passStatus: result?.passStatus || "",
    submittedAt: result?.submittedAt || "",
    lastAccessAt: new Date().toISOString()
  };
}
async function syncToGoogleDrive(eventType) {
  if (!CONFIG.resultsEndpoint || !session || session.role === "admin") return;
  const body = new URLSearchParams({ payload: JSON.stringify(buildResultPayload(eventType)) });
  try {
    await fetch(CONFIG.resultsEndpoint, { method: "POST", mode: "no-cors", body });
  } catch (error) {
    console.warn("결과 저장소에 연결하지 못했습니다. 다음 저장 시 다시 시도합니다.");
  }
}
function scheduleCloudSync(eventType = "progress") {
  if (!CONFIG.resultsEndpoint) return;
  if (cloudSyncTimer) return;
  cloudSyncTimer = setTimeout(async () => {
    cloudSyncTimer = null;
    await syncToGoogleDrive(eventType);
  }, 10000);
}
function showView(id) {
  views.forEach(v => $(v).classList.toggle("hidden", v !== id));
  $("userArea").classList.toggle("hidden", id === "loginView" || id === "adminLoginView");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function percent(item) {
  if (item.completed) return 100;
  return item.duration ? Math.min(99, Math.floor(item.watchedUntil / item.duration * 100)) : 0;
}
function overall(progress) {
  const known = progress.every(p => p.duration > 0);
  if (known) {
    const watched = progress.reduce((s, p) => s + (p.completed ? p.duration : p.watchedUntil), 0);
    const total = progress.reduce((s, p) => s + p.duration, 0);
    return Math.floor(watched / total * 100);
  }
  return Math.floor(progress.reduce((s, p) => s + percent(p), 0) / CONFIG.lessons.length);
}
function renderLessonList() {
  const progress = getProgress();
  $("lessonList").innerHTML = CONFIG.lessons.map((lesson, i) => {
    const p = percent(progress[i]);
    const action = p === 100 ? "복습하기" : "수강하기";
    return `<article class="lesson-card ${i === currentLesson ? "active" : ""} ${p === 100 ? "complete" : ""}"><div class="lesson-card-top"><span class="folder-tab">${i + 1}강</span><span class="lesson-state">${p === 100 ? "수강 완료" : p > 0 ? "수강 중" : "미수강"}</span></div><div class="lesson-card-body"><div class="lesson-card-icon" aria-hidden="true"><span></span></div><h3>${lesson.title}</h3><div class="card-progress-row"><span>수강률</span><strong>${p}%</strong></div><div class="card-progress"><i style="width:${p}%"></i></div><button class="course-action ${p === 100 ? "review" : ""}" data-index="${i}" type="button">${action}<span aria-hidden="true">→</span></button></div></article>`;
  }).join("");
  document.querySelectorAll(".course-action").forEach(btn => btn.addEventListener("click", () => openLesson(Number(btn.dataset.index))));
}
function openLesson(index) {
  loadLesson(index, getProgress()[index].completed);
  $("lessonModeBadge").textContent = reviewMode ? "복습 중 · 진도 미반영" : "학습 중";
  $("lessonModeBadge").classList.toggle("review", reviewMode);
  showView("lessonView");
}
function renderProgress() {
  const progress = getProgress();
  const done = progress.filter(p => p.completed).length;
  const totalPercent = done === CONFIG.lessons.length ? 100 : overall(progress);
  $("overallPercent").textContent = `${totalPercent}%`;
  $("overallBar").style.width = `${totalPercent}%`;
  $("overallCount").textContent = `${done} / ${CONFIG.lessons.length}강 완료`;
  $("lessonPercent").textContent = `${percent(progress[currentLesson])}%`;
  const ready = done === CONFIG.lessons.length;
  $("startExamBtn").disabled = !ready;
  document.querySelector(".exam-gate").classList.toggle("ready", ready);
  $("examGateMessage").textContent = ready ? "모든 강의를 완료했습니다. 지금 시험에 응시할 수 있습니다." : `8개 강의를 모두 완료하면 시험에 응시할 수 있습니다. (${done}/8 완료)`;
  renderLessonList();
}
function loadLesson(index, isReview = false) {
  const video = $("lessonVideo");
  video.pause();
  currentLesson = index;
  reviewMode = isReview;
  const lesson = CONFIG.lessons[index];
  $("lessonNumber").textContent = `${index + 1}강`;
  $("lessonTitle").textContent = lesson.title;
  $("lessonDescription").textContent = lesson.description;
  $("prevLesson").disabled = index === 0;
  $("nextLesson").disabled = index === CONFIG.lessons.length - 1;
  video.src = lesson.src || "";
  $("videoEmpty").classList.toggle("hidden", Boolean(lesson.src));
  video.classList.toggle("hidden", !lesson.src);
  lastVideoTime = 0;
  renderProgress();
}
function storeVideoProgress() {
  const video = $("lessonVideo");
  if (reviewMode || video.paused || video.ended || video.seeking || document.hidden || video.playbackRate !== 1 || !video.duration) return;
  const progress = getProgress();
  const item = progress[currentLesson];
  item.duration = video.duration;
  // 연속 정상 재생 구간만 앞으로 확장합니다. 이미 본 구간의 반복 재생은 중복되지 않습니다.
  if (video.currentTime <= item.watchedUntil + 1.75 && video.currentTime >= lastVideoTime) item.watchedUntil = Math.max(item.watchedUntil, video.currentTime);
  lastVideoTime = video.currentTime;
  saveProgress(progress);
  scheduleCloudSync("progress");
  renderProgress();
}
function setupVideoGuards() {
  const video = $("lessonVideo");
  video.addEventListener("loadedmetadata", () => {
    const progress = getProgress();
    progress[currentLesson].duration = video.duration;
    saveProgress(progress);
    internalSeek = true;
    video.currentTime = reviewMode ? 0 : Math.min(progress[currentLesson].watchedUntil, Math.max(0, video.duration - .2));
    lastVideoTime = video.currentTime;
    setTimeout(() => internalSeek = false, 100);
    renderProgress();
  });
  video.addEventListener("ratechange", () => { if (video.playbackRate !== 1) video.playbackRate = 1; });
  video.addEventListener("seeking", () => {
    if (internalSeek) return;
    const item = getProgress()[currentLesson];
    if (video.currentTime > item.watchedUntil + 1.5) {
      internalSeek = true;
      video.currentTime = item.watchedUntil;
      setTimeout(() => internalSeek = false, 100);
    }
  });
  video.addEventListener("play", () => { lastVideoTime = video.currentTime; });
  video.addEventListener("ended", () => {
    if (reviewMode) return;
    const progress = getProgress();
    const item = progress[currentLesson];
    if (item.duration && item.watchedUntil >= item.duration - 2) {
      item.watchedUntil = item.duration;
      item.completed = true;
      saveProgress(progress);
      syncToGoogleDrive("lesson_complete");
      renderProgress();
    }
  });
  saveTimer = setInterval(storeVideoProgress, 1000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) video.pause(); });
}
function renderExam() {
  $("examForm").innerHTML = CONFIG.questions.map((q, qi) => `<section class="question-card"><h2><span class="step-label">문항 ${qi + 1}</span><br>${q.text}</h2>${q.options.map((o, oi) => `<label class="option"><input type="radio" name="q${qi}" value="${oi}" required><span>${o}</span></label>`).join("")}</section>`).join("") + `<div class="submit-bar"><button class="primary-button" type="submit">답안 제출하기</button></div>`;
}
function enterClassroom() {
  $("userName").textContent = `${session.name} 수강생`;
  showView("classroomView");
  loadLesson(currentLesson);
}
function overallForAdmin(progress) {
  const known = progress.every(p => p.duration > 0);
  if (known) {
    const watched = progress.reduce((sum, p) => sum + (p.completed ? p.duration : p.watchedUntil), 0);
    const total = progress.reduce((sum, p) => sum + p.duration, 0);
    return total ? Math.floor(watched / total * 100) : 0;
  }
  return Math.floor(progress.reduce((sum, p) => sum + percent(p), 0) / CONFIG.lessons.length);
}
function renderAdmin() {
  const rows = CONFIG.students.map(student => {
    const empty = CONFIG.lessons.map(() => ({ watchedUntil: 0, duration: 0, completed: false }));
    const progress = JSON.parse(localStorage.getItem(`edu-progress-${student.studentId}`) || JSON.stringify(empty));
    const result = JSON.parse(localStorage.getItem(`edu-result-${student.studentId}`) || "null");
    const done = progress.filter(p => p.completed).length;
    return { ...student, done, totalPercent: done === 8 ? 100 : overallForAdmin(progress), result };
  });
  $("adminStudentCount").textContent = `${rows.length}명`;
  $("adminCompleteCount").textContent = `${rows.filter(row => row.done === 8).length}명`;
  $("adminSubmitCount").textContent = `${rows.filter(row => row.result).length}명`;
  $("adminTableBody").innerHTML = rows.map(row => `<tr><td>${row.studentId}</td><td><strong>${row.name}</strong></td><td>${row.totalPercent}%</td><td>${row.done} / 8강</td><td><span class="status-pill ${row.result ? "done" : ""}">${row.result ? "제출 완료" : "미제출"}</span></td><td>${row.result?.score ?? "-"}${row.result ? "점" : ""}</td><td><span class="status-pill ${row.result?.passStatus === "완료" ? "done" : ""}">${row.result?.passStatus || "-"}</span></td><td>${row.result ? new Date(row.result.submittedAt).toLocaleString("ko-KR") : "-"}</td></tr>`).join("");
}
function enterAdmin() {
  $("lessonVideo").pause();
  $("userName").textContent = "관리자";
  renderAdmin();
  showView("adminView");
}
function normalizeBirthDate(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits.length === 8 ? digits.slice(2) : digits;
}

$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const values = { studentId: $("studentId").value.trim(), name: $("studentName").value.trim(), birthDate: $("birthDate").value };
  const found = CONFIG.students.find(s => s.studentId === values.studentId && s.name === values.name && normalizeBirthDate(s.birthDate) === normalizeBirthDate(values.birthDate));
  if (!found) { $("loginError").textContent = "등록된 수강생 정보와 일치하지 않습니다."; return; }
  session = { studentId: found.studentId, name: found.name, birthDate: normalizeBirthDate(found.birthDate), loginAt: new Date().toISOString() };
  localStorage.setItem("edu-session", JSON.stringify(session));
  $("loginError").textContent = "";
  enterClassroom();
  syncToGoogleDrive("login");
});
$("openAdminLogin").addEventListener("click", () => {
  $("loginError").textContent = "";
  showView("adminLoginView");
});
$("backToStudentLogin").addEventListener("click", () => {
  $("adminLoginError").textContent = "";
  showView("loginView");
});
$("adminLoginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("adminId").value.trim();
  const password = $("adminPassword").value;
  if (id !== CONFIG.admin.id || password !== CONFIG.admin.password) {
    $("adminLoginError").textContent = "아이디 또는 비밀번호가 일치하지 않습니다.";
    return;
  }
  session = { studentId: "admin", name: "관리자", role: "admin", loginAt: new Date().toISOString() };
  localStorage.setItem("edu-session", JSON.stringify(session));
  $("adminLoginError").textContent = "";
  enterAdmin();
});
$("logoutBtn").addEventListener("click", () => { $("lessonVideo").pause(); localStorage.removeItem("edu-session"); session = null; showView("loginView"); });
$("prevLesson").addEventListener("click", () => loadLesson(Math.max(0, currentLesson - 1)));
$("nextLesson").addEventListener("click", () => loadLesson(Math.min(CONFIG.lessons.length - 1, currentLesson + 1)));
$("returnToClassroom").addEventListener("click", () => {
  $("lessonVideo").pause();
  enterClassroom();
});
$("startExamBtn").addEventListener("click", () => {
  if (!getProgress().every(p => p.completed)) return;
  $("lessonVideo").pause(); renderExam(); showView("examView");
});
$("examForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!getProgress().every(p => p.completed)) { enterClassroom(); return; }
  if (localStorage.getItem(resultKey())) { alert("이미 제출된 시험입니다."); return; }
  const form = new FormData(e.target);
  const answers = CONFIG.questions.map((_, i) => Number(form.get(`q${i}`)));
  const correctCount = CONFIG.questions.filter((question, i) => question.correctAnswer === answers[i]).length;
  const score = Math.round(correctCount / CONFIG.questions.length * 100);
  const result = { studentId: session.studentId, name: session.name, answers, score, passStatus: score >= CONFIG.passingScore ? "완료" : "미완료", submittedAt: new Date().toISOString(), status: "제출 완료" };
  localStorage.setItem(resultKey(), JSON.stringify(result));
  syncToGoogleDrive("exam_submit");
  $("submissionInfo").textContent = `제출 일시 · ${new Date(result.submittedAt).toLocaleString("ko-KR")}`;
  showView("completeView");
});
$("backToClassroom").addEventListener("click", enterClassroom);
$("refreshAdmin").addEventListener("click", renderAdmin);

setupVideoGuards();
if (session?.role === "admin") enterAdmin(); else if (session) enterClassroom(); else showView("loginView");
