const CONFIG = {
  passingScore: 80,
  // Google Apps Script를 배포한 뒤 발급된 /exec 주소를 입력하세요.
  resultsEndpoint: "https://script.google.com/macros/s/AKfycbxeczRU1B-ZZwZMAaHZcv_kxbiDyHs2nPzUXnnRmZ1Ism4JtyQJqb9Iqhr02gGOgoBOGg/exec",
  lessons: [
    ["건강과 인체의 이해 및 노인 신체, 인지, 정신 특성", "노인의 건강과 인체 특성을 이해합니다."],
    ["복지용구 제도 개요 및 노인장기요양보험", "복지용구 제도와 노인장기요양보험의 기본 구조를 알아봅니다."],
    ["복지용구의 이해와 활용(이동,이승)", "이동과 이승에 필요한 복지용구의 활용법을 익힙니다."],
    ["복지용구의 이해와 활용(기거,입욕 배설)", "기거, 입욕 및 배설 관련 복지용구를 살펴봅니다."],
    ["복지용구사업소 설립계획 및 운영", "복지용구사업소의 설립 준비와 운영 원칙을 배웁니다."],
    ["복지용구 소독 및 관리", "복지용구의 올바른 소독과 관리 방법을 익힙니다."],
    ["복지용구 이해와 활동(일상생활훈련)", "일상생활훈련에 활용되는 복지용구를 이해합니다."],
    ["복지용구 안전과 환경관리(주택개조)", "안전한 생활환경 조성과 주택개조의 기초를 배웁니다."]
  ].map((item, i) => ({
    id: i + 1, title: item[0], description: item[1],
    // 아직 전달되지 않은 강의에는 임시 공개 샘플 영상을 표시합니다.
    src: i === 0 ? "./videos/lesson-01.mp4"
      : i === 1 ? "./videos/lesson-02.mp4"
      : i === 3 ? "./videos/lesson-04.mp4"
      : "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
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
const views = ["loginView", "classroomView", "lessonView", "examView", "completeView"];
let session = JSON.parse(localStorage.getItem("edu-session") || "null");
let currentLesson = 0;
let lastVideoTime = 0;
let internalSeek = false;
let saveTimer = null;
let reviewMode = false;
let cloudSyncTimer = null;
let examTimerInterval = null;
let lessonSettings = getSavedLessonSettings();

function defaultLessonSettings() {
  return CONFIG.lessons.map(lesson => ({ lessonId: lesson.id, isPublic: true, releaseDate: "" }));
}
function getSavedLessonSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("edu-lesson-settings") || "null");
    if (!Array.isArray(saved)) return defaultLessonSettings();
    return CONFIG.lessons.map(lesson => {
      const item = saved.find(value => Number(value.lessonId) === lesson.id);
      return { lessonId: lesson.id, isPublic: item?.isPublic !== false, releaseDate: item?.releaseDate || "" };
    });
  } catch (_) { return defaultLessonSettings(); }
}
function saveLessonSettings(settings) {
  lessonSettings = settings;
  localStorage.setItem("edu-lesson-settings", JSON.stringify(settings));
}
function isLessonAvailable(index) {
  const setting = lessonSettings[index] || { isPublic: true, releaseDate: "" };
  if (setting.isPublic) return true;
  if (!setting.releaseDate) return false;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return setting.releaseDate <= localToday;
}
function releaseLabel(index) {
  const date = lessonSettings[index]?.releaseDate;
  if (!date) return "공개 준비 중";
  const [, month, day] = date.split("-");
  return `${Number(month)}월 ${Number(day)}일 공개`;
}

function progressKey() { return `edu-progress-${session?.studentId || "guest"}`; }
function resultKey() { return `edu-result-${session?.studentId || "guest"}`; }
function examStartKey() { return `edu-exam-start-${session?.studentId || "guest"}`; }
function examDraftKey() { return `edu-exam-draft-${session?.studentId || "guest"}`; }
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
    authToken: session.authToken || "",
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
  if (!CONFIG.resultsEndpoint || !session) return;
  if (session.authExpiresAt && Date.now() >= session.authExpiresAt) {
    alert("로그인 시간이 만료되었습니다. 진도 저장을 위해 다시 로그인해 주세요.");
    $("lessonVideo").pause();
    localStorage.removeItem("edu-session");
    session = null;
    showView("loginView");
    return;
  }
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
  $("userArea").classList.toggle("hidden", id === "loginView");
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
    const available = isLessonAvailable(i);
    const action = available ? (p === 100 ? "복습하기" : "수강하기") : releaseLabel(i);
    const state = available ? (p === 100 ? "수강 완료" : p > 0 ? "수강 중" : "미수강") : "공개 예정";
    return `<article class="lesson-card ${i === currentLesson ? "active" : ""} ${p === 100 ? "complete" : ""} ${available ? "" : "unavailable"}"><div class="lesson-card-top"><span class="folder-tab">${i + 1}강</span><span class="lesson-state">${state}</span></div><div class="lesson-card-body"><div class="lesson-card-icon" aria-hidden="true"><span></span></div><h3>${lesson.title}</h3><div class="card-progress-row"><span>수강률</span><strong>${p}%</strong></div><div class="card-progress"><i style="width:${p}%"></i></div><button class="course-action ${p === 100 && available ? "review" : ""}" data-index="${i}" type="button" ${available ? "" : "disabled"}>${action}${available ? '<span aria-hidden="true">→</span>' : ""}</button></div></article>`;
  }).join("");
  document.querySelectorAll(".course-action").forEach(btn => btn.addEventListener("click", () => openLesson(Number(btn.dataset.index))));
}
function openLesson(index) {
  if (!isLessonAvailable(index)) return;
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
  $("prevLesson").disabled = index === 0 || !isLessonAvailable(index - 1);
  $("nextLesson").disabled = index === CONFIG.lessons.length - 1 || !isLessonAvailable(index + 1);
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
  const draft = JSON.parse(localStorage.getItem(examDraftKey()) || "[]");
  $("examForm").innerHTML = CONFIG.questions.map((q, qi) => `<section class="question-card"><h2><span class="step-label">문항 ${qi + 1}</span><br>${q.text}</h2>${q.options.map((o, oi) => `<label class="option"><input type="radio" name="q${qi}" value="${oi}" ${draft[qi] === oi ? "checked" : ""} required><span>${o}</span></label>`).join("")}</section>`).join("") + `<div class="submit-bar"><button class="primary-button" type="submit">답안 제출하기</button></div>`;
  $("examForm").addEventListener("change", () => {
    const form = new FormData($("examForm"));
    localStorage.setItem(examDraftKey(), JSON.stringify(CONFIG.questions.map((_, i) => {
      const value = form.get(`q${i}`);
      return value === null ? null : Number(value);
    })));
  });
}
function startExamCountdown() {
  clearInterval(examTimerInterval);
  const update = () => {
    const startedAt = Number(localStorage.getItem(examStartKey()));
    const remaining = Math.max(0, 60 * 60 * 1000 - (Date.now() - startedAt));
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    $("examTimer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    $("examTimer").classList.toggle("urgent", remaining <= 5 * 60 * 1000);
    if (remaining <= 0) submitExam(true);
  };
  update();
  examTimerInterval = setInterval(update, 1000);
}
function submitExam(autoSubmitted = false) {
  if (!session || localStorage.getItem(resultKey())) return;
  if (!getProgress().every(p => p.completed)) { enterClassroom(); return; }
  clearInterval(examTimerInterval);
  const form = new FormData($("examForm"));
  const answers = CONFIG.questions.map((_, i) => {
    const value = form.get(`q${i}`);
    return value === null ? -1 : Number(value);
  });
  const correctCount = CONFIG.questions.filter((question, i) => question.correctAnswer === answers[i]).length;
  const score = Math.round(correctCount / CONFIG.questions.length * 100);
  const result = { studentId: session.studentId, name: session.name, answers, score, passStatus: score >= CONFIG.passingScore ? "완료" : "미완료", submittedAt: new Date().toISOString(), status: "제출 완료", autoSubmitted };
  localStorage.setItem(resultKey(), JSON.stringify(result));
  localStorage.removeItem(examDraftKey());
  syncToGoogleDrive("exam_submit");
  $("submissionInfo").textContent = `${autoSubmitted ? "제한 시간 종료 · 자동 제출 · " : ""}제출 일시 · ${new Date(result.submittedAt).toLocaleString("ko-KR")}`;
  showView("completeView");
}
function enterClassroom() {
  $("userName").textContent = `${session.name} 수강생`;
  showView("classroomView");
  loadLesson(currentLesson);
}
function loadCloudLessonSettings() {
  if (!CONFIG.resultsEndpoint) return;
  const callbackName = `applyLessonSettings_${Date.now()}`;
  const script = document.createElement("script");
  window[callbackName] = data => {
    if (data?.ok && Array.isArray(data.settings) && data.settings.length) {
      saveLessonSettings(data.settings);
      if (!$("classroomView").classList.contains("hidden")) renderLessonList();
    }
    delete window[callbackName]; script.remove();
  };
  script.onerror = () => { delete window[callbackName]; script.remove(); };
  script.src = `${CONFIG.resultsEndpoint}?action=settings&callback=${callbackName}&t=${Date.now()}`;
  document.head.appendChild(script);
}
function normalizeBirthDate(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits.length === 8 ? digits.slice(2) : digits;
}

function authenticateStudent(values) {
  return new Promise(resolve => {
    const nonce = `login_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const frame = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");
    const frameName = `auth_${Date.now()}`;
    let finished = false;
    const cleanup = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      form.remove();
      setTimeout(() => frame.remove(), 100);
      resolve(result);
    };
    const receive = event => {
      const data = event.data;
      // Chrome에서는 Apps Script 샌드박스 메시지의 origin이 "null"일 수 있다.
      // 요청별 nonce와 고정 source도 함께 확인하므로 이 경우를 허용한다.
      const trustedGoogleOrigin = event.origin === "null"
        || event.origin === "https://script.google.com"
        || /^https:\/\/[^/]+-script\.googleusercontent\.com$/.test(event.origin);
      if (!trustedGoogleOrigin || !data || data.source !== "welfare-course-login" || data.nonce !== nonce) return;
      cleanup(data);
    };
    const timer = setTimeout(() => cleanup({ ok: false, message: "로그인 확인 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요." }), 30000);
    window.addEventListener("message", receive);
    frame.name = frameName;
    frame.hidden = true;
    form.method = "POST";
    form.action = CONFIG.resultsEndpoint;
    form.target = frameName;
    form.hidden = true;
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({ eventType: "login", nonce, ...values });
    form.appendChild(input);
    document.body.append(frame, form);
    form.submit();
  });
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = { studentId: $("studentId").value.trim(), name: $("studentName").value.trim(), birthDate: $("birthDate").value };
  const submitButton = e.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  $("loginError").textContent = "등록 정보를 확인하고 있습니다…";
  const result = await authenticateStudent(values);
  submitButton.disabled = false;
  if (!result.ok) { $("loginError").textContent = result.message || "등록된 수강생 정보와 일치하지 않습니다."; return; }
  session = { studentId: result.studentId, name: result.name, birthDate: result.birthDate, authToken: result.authToken, authExpiresAt: result.authExpiresAt || null, loginAt: new Date().toISOString() };
  if (result.hasProgressRecord === false) localStorage.removeItem(progressKey());
  if (result.hasExamRecord === false) {
    localStorage.removeItem(resultKey());
    localStorage.removeItem(examStartKey());
    localStorage.removeItem(examDraftKey());
  }
  localStorage.setItem("edu-session", JSON.stringify(session));
  $("loginError").textContent = "";
  enterClassroom();
  syncToGoogleDrive("login");
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
  if (localStorage.getItem(resultKey())) { alert("이미 제출된 시험입니다."); return; }
  $("lessonVideo").pause();
  if (!localStorage.getItem(examStartKey())) localStorage.setItem(examStartKey(), String(Date.now()));
  renderExam(); showView("examView"); startExamCountdown();
});
$("examForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitExam(false);
});
$("backToClassroom").addEventListener("click", enterClassroom);
setupVideoGuards();
loadCloudLessonSettings();
if (session && (!session.authToken || (session.authExpiresAt && Date.now() >= session.authExpiresAt))) {
  localStorage.removeItem("edu-session");
  session = null;
}
if (session) enterClassroom(); else showView("loginView");
