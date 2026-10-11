(() => {
  'use strict';
  const STORAGE_KEY = 'cos301-mock-exam-v2';
  const DURATION = 120 * 60;
  const answerFields = [...document.querySelectorAll('[data-answer]')];
  const questionCards = [...document.querySelectorAll('.question-card')];
  const navItems = [...document.querySelectorAll('.nav-item')];
  const timerDisplay = document.getElementById('timerDisplay');
  const timerState = document.getElementById('timerState');
  const timerNote = document.getElementById('timerNote');
  const toast = document.getElementById('toast');
  let timerRemaining = DURATION;
  let timerInterval = null;
  let timerStarted = false;
  let toastTimeout = null;
  let filterUnanswered = false;
  let state = { answers: {}, flagged: [], timerRemaining: DURATION, timerStarted: false, timerFinished: false, submitted: false, manualMarks: {} };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2400);
  }
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  }
  function fieldValue(field) {
    if (field.type === 'radio') {
      const checked = document.querySelector(`input[type="radio"][name="${CSS.escape(field.name)}"]:checked`);
      return checked ? checked.value : '';
    }
    if (field.type === 'checkbox') {
      return [...document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(field.name)}"]:checked`)].map(el => el.value);
    }
    return field.value;
  }
  function collectAnswers() {
    const answers = {};
    answerFields.forEach(field => { answers[field.dataset.answer] = fieldValue(field); });
    const radios = [...new Set([...document.querySelectorAll('input[type="radio"]')].map(el => el.name))];
    radios.forEach(name => { answers[name] = fieldValue(document.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]`)); });
    const checks = [...new Set([...document.querySelectorAll('input[type="checkbox"]')].map(el => el.name))];
    checks.forEach(name => { answers[name] = fieldValue(document.querySelector(`input[type="checkbox"][name="${CSS.escape(name)}"]`)); });
    return answers;
  }
  function isNonEmpty(value) {
    if (Array.isArray(value)) return value.length > 0;
    return String(value ?? '').trim().length > 0;
  }
  function questionIsAnswered(card, answers) {
    const q = card.dataset.question;
    const relevant = Object.entries(answers).filter(([key]) => {
      if (q === '1') return key.startsWith('q1_');
      if (q === '2') return key.startsWith('q2_');
      if (q === '3') return key === 'q3';
      return key.startsWith(`q${q}_`);
    });
    return relevant.some(([, value]) => isNonEmpty(value));
  }
  function answeredFieldCount(answers) {
    return Object.values(answers).filter(isNonEmpty).length;
  }
  function saveState(silent = true) {
    state.answers = collectAnswers();
    state.flagged = questionCards.filter(card => card.querySelector('.review-toggle.is-flagged')).map(card => card.dataset.question);
    state.timerRemaining = timerRemaining;
    state.timerStarted = timerStarted;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      document.getElementById('saveStatus').textContent = 'All changes saved locally';
      if (!silent) showToast('Your answers have been saved in this browser.');
    } catch (error) {
      document.getElementById('saveStatus').textContent = 'Could not save locally';
      if (!silent) showToast('Browser storage is unavailable. Export a copy of your answers.');
    }
    updateProgress();
  }
  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
      Object.entries(state.answers || {}).forEach(([key, value]) => {
        const direct = document.querySelector(`[data-answer="${CSS.escape(key)}"]`);
        if (direct && direct.type !== 'radio' && direct.type !== 'checkbox') direct.value = value;
        else if (direct && direct.tagName === 'SELECT') direct.value = value;
        else if (key.startsWith('q2_') && value) {
          const radio = document.querySelector(`input[type="radio"][name="${CSS.escape(key)}"][value="${CSS.escape(value)}"]`);
          if (radio) radio.checked = true;
        } else if (key === 'q3' && Array.isArray(value)) {
          value.forEach(option => { const check = document.querySelector(`input[type="checkbox"][name="q3"][value="${CSS.escape(option)}"]`); if (check) check.checked = true; });
        }
      });
      (state.flagged || []).forEach(q => {
        const card = document.querySelector(`.question-card[data-question="${q}"]`);
        if (card) setFlag(card, true);
      });
      timerRemaining = Number.isFinite(state.timerRemaining) ? Math.max(0, state.timerRemaining) : DURATION;
      const shouldResumeTimer = Boolean(state.timerStarted && timerRemaining > 0 && !state.submitted);
      timerStarted = false;
      renderTimer();
      if (shouldResumeTimer) startTimer(false);
    } catch (error) {
      console.warn('Could not restore mock exam state.', error);
    }
  }
  function updateProgress() {
    const answers = collectAnswers();
    const attempted = questionCards.filter(card => questionIsAnswered(card, answers)).length;
    const percent = Math.round((attempted / questionCards.length) * 100);
    document.getElementById('progressPercent').textContent = `${percent}%`;
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `${attempted} of ${questionCards.length} questions attempted`;
    questionCards.forEach(card => {
      const answered = questionIsAnswered(card, answers);
      const nav = document.querySelector(`.nav-item[data-target="q${card.dataset.question}"]`);
      if (nav) nav.classList.toggle('answered', answered);
      card.classList.toggle('needs-attention', filterUnanswered && !answered);
    });
    if (filterUnanswered) applyUnansweredFilter();
  }
  function setFlag(card, flag) {
    const button = card.querySelector('.review-toggle');
    button.classList.toggle('is-flagged', flag);
    button.innerHTML = flag ? '★ <span>Review</span>' : '☆ <span>Review</span>';
    button.setAttribute('aria-pressed', String(flag));
    const nav = document.querySelector(`.nav-item[data-target="q${card.dataset.question}"]`);
    if (nav) nav.classList.toggle('flagged', flag);
  }
  function renderTimer() {
    timerDisplay.textContent = formatTime(timerRemaining);
    timerState.textContent = timerRemaining <= 0 ? 'Finished' : timerStarted ? 'Running' : state.timerFinished ? 'Paused' : 'Ready';
    document.getElementById('startTimer').textContent = timerRemaining <= 0 ? 'Time complete' : timerStarted ? 'Pause timer' : state.timerFinished ? 'Resume timer' : 'Start timer';
    document.getElementById('startTimer').disabled = timerRemaining <= 0;
    timerNote.textContent = timerRemaining <= 0 ? 'Time is up. You can still review and export your responses.' : timerStarted ? 'Timer is running. Your answers continue to save automatically.' : 'The timer is optional. Your answers save automatically in this browser.';
  }
  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerStarted = false;
    state.timerFinished = timerRemaining <= 0;
    renderTimer();
    saveState();
  }
  function startTimer(showMessage = true) {
    if (timerRemaining <= 0) return;
    if (timerStarted) {
      stopTimer();
      if (showMessage) showToast('Timer paused.');
      return;
    }
    timerStarted = true;
    state.timerFinished = false;
    timerInterval = setInterval(() => {
      timerRemaining -= 1;
      renderTimer();
      if (timerRemaining <= 0) {
        timerRemaining = 0;
        stopTimer();
        showToast('Time is up. Review or export your answers.');
      } else if (timerRemaining % 5 === 0) saveState();
    }, 1000);
    renderTimer();
    saveState();
    if (showMessage) showToast('Timer started. Good luck!');
  }
  function applyUnansweredFilter() {
    const answers = collectAnswers();
    questionCards.forEach(card => {
      const unanswered = !questionIsAnswered(card, answers);
      card.classList.toggle('hidden-by-filter', filterUnanswered && !unanswered);
    });
    document.getElementById('unansweredBtn').textContent = filterUnanswered ? 'Show all questions' : 'Show unanswered';
  }
  function getQuestionTitle(card) { return card.querySelector('.question-title h3')?.textContent || `Question ${card.dataset.question}`; }
  function openReview() {
    const answers = collectAnswers();
    const attempted = questionCards.filter(card => questionIsAnswered(card, answers));
    document.getElementById('summaryAttempted').textContent = `${attempted.length} / ${questionCards.length}`;
    document.getElementById('summaryFields').textContent = String(answeredFieldCount(answers));
    document.getElementById('summaryReview').textContent = String(questionCards.filter(card => card.querySelector('.review-toggle.is-flagged')).length);
    const list = document.getElementById('summaryList');
    list.innerHTML = '';
    questionCards.forEach(card => {
      const answered = questionIsAnswered(card, answers);
      const flagged = Boolean(card.querySelector('.review-toggle.is-flagged'));
      const row = document.createElement('div');
      row.className = 'summary-row';
      const number = document.createElement('span'); number.className = 'summary-q'; number.textContent = String(card.dataset.question).padStart(2, '0');
      const detail = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = getQuestionTitle(card);
      const small = document.createElement('small'); small.textContent = `${card.dataset.marks} marks${flagged ? ' · Marked for review' : ''}`;
      detail.append(title, small);
      const badge = document.createElement('span'); badge.className = `summary-badge${answered ? ' done' : ''}`; badge.textContent = answered ? 'Attempted' : 'Unanswered';
      row.append(number, detail, badge);
      row.addEventListener('click', () => { closeReview(); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      row.style.cursor = 'pointer';
      list.append(row);
    });
    const modal = document.getElementById('reviewModal');
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    document.getElementById('closeModal').focus();
  }
  function closeReview() {
    const modal = document.getElementById('reviewModal');
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
  }
  const memo = {
    q1: { title: 'Question 1 · Matching concepts (5 marks)', answer: '1.1 B · 1.2 D · 1.3 E · 1.4 C · 1.5 F', explanation: 'Fitness function: automated continuous architecture check. Anemic Domain Model: data-only domain objects with business logic elsewhere. Bulkhead: isolates resource pools. Design Token: reusable design value from a single source. Circuit Breaker: stops calls to a failing dependency after a threshold.' },
    q2: { title: 'Question 2 · Multiple choice (10 marks)', answer: '2.1 B · 2.2 B · 2.3 B · 2.4 C · 2.5 A', explanation: 'CurrencyAmount is a value object; scalability is classified under Flexibility in this paper’s supplied memo, latency under Performance Efficiency/Time Behavior; tactics are design moves and patterns are reusable structural organisations; the shared schema/co-deployment is a distributed monolith; containers share the host kernel while VMs have guest kernels.' },
    q3: { title: 'Question 3 · CI/CD multiple-select (5 marks)', answer: 'A, B, D, E', explanation: 'A: protect main with passing checks. B: build once and promote the same immutable artifact. D: contract tests detect unversioned breaking changes. E: performance budgets can be checked automatically. C and F are incorrect.' },
    q4: { title: 'Question 4 · Reliability and availability (10 marks)', answer: '4.1 MTTF = (580 + 860 + 700 + 660) / 4 = 700 hours. 4.2 MTTR = (20 + 10 + 30 + 20) / 4 = 20 hours. 4.3 MTBF = MTTF + MTTR = 720 hours. 4.4 Availability = 700 / (700 + 20) = 97.22%. 4.5 New availability = 700 / (700 + 0.5) ≈ 99.93%, so yes, three nines is achieved.', explanation: 'Award credit for correct formula, substitution, units and final result as requested in each subquestion.' },
    q5: { title: 'Question 5 · Quality attribute scenario (10 marks)', answer: '5.1 Example: Source: student clients; Stimulus: request burst plus slow/unavailable payment gateway; Environment: peak registration load; Artifact: registration API/payment integration; Response: isolate calls with circuit breaker and accept payment-pending registrations without exhausting threads; Response measure: p99 submission latency ≤ 2,000 ms and 0% lost registration records. 5.2 Reliability; fault tolerance (also recoverability is relevant). 5.3 CI integration test using WireMock and Resilience4j; inject 5,000 ms gateway latency and fail build if p99 exceeds 2,000 ms or unhandled HTTP 500s occur.', explanation: '5.1 award for all six distinct scenario parts and at least two measurable response targets. 5.2 award for attribute and sub-characteristic. 5.3 award for a concrete automated mechanism and explicit failure threshold.' },
    q6: { title: 'Question 6 · API contracts and DTOs (10 marks)', answer: '6.1 Design-first agrees and versions the OpenAPI contract before implementation; mock servers generated from it let frontend and backend work in parallel against the same interface. 6.2 A contract test validates live responses against the saved schema; changing student_number:string to student_id:integer breaks both field name and type, so CI fails before release. 6.3 Exposing ORM entities couples the public API to persistence, can leak fields and permits over-posting; DTOs expose only intended fields and stabilise the external contract.', explanation: 'Use the marks shown beside each subquestion: 4, 3 and 3. Give credit for the mechanism and its consequence, not just naming the term.' },
    q7: { title: 'Question 7 · Deployment and failure domains (18 marks)', answer: '7.1 Four issues: database colocated with app containers on Host 1; database only in AZ 1; direct public ingress without L7 load balancer; HTTP port 80 over the public internet/no TLS or trust-boundary annotation. 7.2 Host 1 failure kills API containers and primary DB; auth in AZ 2 loses DB access; no replica exists in AZ 2, so the service cannot continue and uncommitted in-memory state may be lost. 7.3 A good diagram has an HTTPS :443 L7 load balancer, app/auth instances in both AZs, a managed primary and standby/replica across AZs with a stated replication/failover approach, separated private data tier, trust boundaries, and labelled protocols/ports/synchronous semantics.', explanation: '7.1 up to 2 marks per valid issue with consequence. 7.2 credit for complete causal chain. 7.3 assess redundancy, separation of stateful data, entry point/trust boundaries, and clear communication annotations. A diagram should not claim zero SPOFs without explaining managed load-balancer/database failover.' },
    q8: { title: 'Question 8 · Capacity and queues (16 marks)', answer: '8.1 API capacity = (4 × 50) / 0.1 = 2,000 RPS. 8.2 DB pool capacity = 80 / 0.1 = 800 RPS; database connection pool is the bottleneck, so sustainable throughput is 800 RPS. 8.3 Backlog rate = 1,200 − 800 = 400 requests/s; after 30 s: 400 × 30 = 12,000 requests. 8.4 Suitable strategy: cache read-heavy seat availability, route reads to replicas, use connection pooling such as PgBouncer, and consider queue/CQRS for asynchronous work; explain trade-offs and preserve correctness for reservation writes.', explanation: 'The memo’s requested backlog is the synchronous request backlog based on the 800 RPS bottleneck. The payment queue’s 400 payments/s is a separate downstream limit unless the answer explicitly and reasonably models one payment per request.' },
    q9: { title: 'Question 9 · ADR and trade-offs (16 marks)', answer: 'A defensible memo choice is a modular monolith with Domain-Driven bounded contexts: one deployable unit, public module interfaces, no cross-domain persistence access, and static CI checks such as ArchUnit. Positive: ACID transactions and simpler operations. Negative: whole-unit deployment/scaling and the need to enforce boundaries. Sensitivity point example: strict package encapsulation affects modifiability/maintainability. Trade-off point: one deployable unit improves consistency/operational simplicity but reduces independent deployment and granular scaling. Microservices add network latency/failure modes, Saga compensation/eventual-consistency complexity, monitoring overhead, and require organisational maturity.', explanation: 'Other choices can earn credit if the ADR addresses the stated constraints, explicitly discusses positive and negative consequences, and technically defends the choice. The memo’s preferred answer is not the only imaginable architecture.' }
  };
  const correctMatch = { q1_1: 'B', q1_2: 'D', q1_3: 'E', q1_4: 'C', q1_5: 'F' };
  const correctChoice = { q2_1: 'B', q2_2: 'B', q2_3: 'B', q2_4: 'C', q2_5: 'A' };
  const objectiveMarks = { q1_1: 1, q1_2: 1, q1_3: 1, q1_4: 1, q1_5: 1, q2_1: 2, q2_2: 2, q2_3: 2, q2_4: 2, q2_5: 2 };
  function numberFromAnswer(value) {
    const matches = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
    return matches ? matches.map(Number) : [];
  }
  function includesExpectedNumber(value, expected, tolerance = 0.06) {
    return numberFromAnswer(value).some(n => Math.abs(n - expected) <= tolerance);
  }
  function gradeObjective(answers) {
    const rows = [];
    Object.entries(correctMatch).forEach(([key, expected]) => rows.push({ key, max: 1, score: answers[key] === expected ? 1 : 0, expected }));
    Object.entries(correctChoice).forEach(([key, expected]) => rows.push({ key, max: 2, score: answers[key] === expected ? 2 : 0, expected }));
    const selected = Array.isArray(answers.q3) ? answers.q3 : [];
    const correctSet = ['A','B','D','E'];
    const correctCount = selected.filter(v => correctSet.includes(v)).length;
    const wrongCount = selected.filter(v => !correctSet.includes(v)).length;
    rows.push({ key: 'q3', max: 5, score: Math.max(0, Math.min(5, correctCount * 1.25 - wrongCount)), expected: 'A, B, D, E' });
    const q4expected = { q4_1: 700, q4_2: 20, q4_3: 720, q4_4: 97.22, q4_5: 99.93 };
    const q4marks = { q4_1: 2, q4_2: 2, q4_3: 2, q4_4: 2, q4_5: 2 };
    Object.entries(q4expected).forEach(([key, expected]) => rows.push({ key, max: q4marks[key], score: includesExpectedNumber(answers[key], expected, key === 'q4_4' || key === 'q4_5' ? 0.08 : 0.01) ? q4marks[key] : 0, expected: String(expected) }));
    const q8expected = { q8_1: [2000], q8_2: [800], q8_3: [400,12000] };
    const q8marks = { q8_1: 3, q8_2: 4, q8_3: 4 };
    Object.entries(q8expected).forEach(([key, expectedList]) => {
      const nums = numberFromAnswer(answers[key]);
      const count = expectedList.filter(expected => nums.some(n => Math.abs(n - expected) <= Math.max(0.05, expected * 0.001))).length;
      rows.push({ key, max: q8marks[key], score: expectedList.length === 1 ? (count ? q8marks[key] : 0) : count * 2, expected: expectedList.join(' and ') });
    });
    return rows;
  }
  const writtenRubric = [
    ['q5_1', 6, 'Six labelled parts: source, stimulus, environment, artifact, response, and at least two measurable response targets.'],
    ['q5_2', 2, 'Reliability; fault tolerance (recoverability is also relevant).'],
    ['q5_3', 2, 'Automated integration/fitness test, realistic gateway fault/latency injection, and explicit build-failure thresholds.'],
    ['q6_1', 4, 'OpenAPI contract agreed first; fewer mismatches; mock server enables parallel frontend/backend development.'],
    ['q6_2', 3, 'Contract test compares live response to schema; detects both renamed key and changed type; CI blocks release.'],
    ['q6_3', 3, 'Entity exposure couples persistence to API and risks leaks/over-posting; DTOs limit fields and stabilise contract.'],
    ['q7_1', 8, 'Four valid vulnerabilities, each with a reason/consequence.'],
    ['q7_2', 4, 'Host/app/database failure, auth loses DB access, no cross-AZ database failover, service outage/state implications.'],
    ['q7_3', 6, 'Cross-AZ app redundancy, separated stateful DB with replication/failover, L7 entry point/trust boundaries, labelled protocol/port/semantics.'],
    ['q8_4', 5, 'Use relevant read/write separation, caching, replicas, connection pooling and/or async queueing; justify correctness and trade-offs.'],
    ['q9_1', 8, 'ADR title/status, context/constraints/alternatives, clear decision, positive and negative consequences.'],
    ['q9_2', 4, 'Correct definitions plus one grounded sensitivity point and trade-off point with quality attributes that improve/degrade.'],
    ['q9_3', 4, 'Technically challenges “always superior” with network latency/failure, Saga vs ACID, monitoring/operations and team readiness.']
  ];
  function answerText(key) {
    const v = collectAnswers()[key];
    return Array.isArray(v) ? v.join(', ') : String(v || '').trim();
  }
  function lockAnswers(locked) {
    document.querySelectorAll('[data-answer], input[name^="q2_"], input[name="q3"]').forEach(el => { el.disabled = locked; });
    document.querySelectorAll('.review-toggle, #insertTemplate, #expandDiagram, #startTimer, #resetTimer').forEach(el => { el.disabled = locked; });
    document.querySelector('.status-pill').innerHTML = locked ? '<span></span> Submitted' : '<span></span> In progress';
  }
  function showResults() {
    const answers = collectAnswers();
    const autoRows = gradeObjective(answers);
    const autoScore = autoRows.reduce((sum, r) => sum + r.score, 0);
    const manualScore = writtenRubric.reduce((sum, r) => sum + Math.min(r[1], Math.max(0, Number(state.manualMarks?.[r[0]] ?? 0))), 0);
    const total = autoScore + manualScore;
    let overlay = document.getElementById('resultsOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'resultsOverlay'; overlay.className = 'results-overlay'; document.body.append(overlay); }
    const autoByKey = Object.fromEntries(autoRows.map(r => [r.key, r]));
    const parts = Object.entries(memo).map(([q, item]) => {
      const keys = Object.keys(answers).filter(k => k.startsWith(q + '_') || (q === 'q3' && k === 'q3'));
      const user = keys.map(k => `${k}: ${Array.isArray(answers[k]) ? answers[k].join(', ') : (answers[k] || '[No answer]')}`).join('\n');
      const objective = autoRows.filter(r => r.key.startsWith(q + '_') || r.key === q);
      const score = objective.reduce((sum,r)=>sum+r.score,0);
      const max = objective.reduce((sum,r)=>sum+r.max,0);
      const rubric = writtenRubric.filter(r => r[0].startsWith(q + '_'));
      const earnedManual = rubric.reduce((sum,r)=>sum+Math.min(r[1],Math.max(0,Number(state.manualMarks?.[r[0]] ?? 0))),0);
      const manualMax = rubric.reduce((sum,r)=>sum+r[1],0);
      return `<section class="result-question" data-result-q="${q}"><div class="result-q-head"><h3>${item.title}</h3><span class="result-score">${score + earnedManual} / ${max + manualMax} marks</span></div><div class="result-columns"><div><h4>Your response</h4><pre class="student-answer">${escapeHtml(user || 'No answer recorded for this question.')}</pre></div><div><h4>Memo / expected answer</h4><p class="memo-answer">${escapeHtml(item.answer)}</p><p class="memo-explanation">${escapeHtml(item.explanation)}</p></div></div>${rubric.length ? `<div class="rubric-area"><h4>Written-answer marking rubric</h4>${rubric.map(r=>`<label class="rubric-row"><span><strong>${r[0].replace('_',' · ').toUpperCase()}</strong><small>${escapeHtml(r[2])}</small></span><span class="mark-entry"><input type="number" min="0" max="${r[1]}" step="0.5" value="${Number(state.manualMarks?.[r[0]] ?? 0)}" data-manual-mark="${r[0]}" aria-label="Marks awarded for ${r[0]}"><small>/ ${r[1]}</small></span></label>`).join('')}<p class="rubric-help">Use the memo to award partial marks fairly. These written marks are self-assessed; the browser cannot reliably judge the quality of open-ended reasoning.</p></div>` : ''}</section>`;
    }).join('');
    overlay.innerHTML = `<div class="results-shell"><header class="results-header"><div><span class="eyebrow">ATTEMPT COMPLETE</span><h1>Your results & answer memo</h1><p>Objective and numerical answers are checked automatically. Use the marking guides for written questions, then adjust your awarded marks.</p></div><button class="button button-outline" id="closeResults">Close results</button></header><section class="results-scorecard"><div><span>Current score</span><strong id="resultsTotal">${total.toFixed(1)} / 100</strong></div><div><span>Auto-marked score</span><strong>${autoScore.toFixed(1)} / ${autoRows.reduce((s,r)=>s+r.max,0)}</strong></div><div><span>Written self-assessment</span><strong id="manualTotal">${manualScore.toFixed(1)} / ${writtenRubric.reduce((s,r)=>s+r[1],0)}</strong></div></section><div class="results-tools"><p><strong>Marking note:</strong> For written responses, enter the marks you believe you earned using the rubric and memo. Your overall score updates as you change them.</p><div class="results-buttons"><button class="button button-outline" id="exportResults">Export answers + marks</button><button class="button button-primary" id="retakeExam">Retake test</button></div></div><div class="results-content">${parts}</div><div class="results-bottom"><button class="button button-outline" id="retakeExamBottom">Retake test from the beginning</button></div></div>`;
    overlay.classList.add('open');
    overlay.querySelectorAll('[data-manual-mark]').forEach(input => input.addEventListener('input', () => {
      const max = Number(input.max); const value = Math.min(max, Math.max(0, Number(input.value || 0)));
      state.manualMarks[input.dataset.manualMark] = value; input.value = value; saveState();
      const newManual = writtenRubric.reduce((sum,r)=>sum+Math.min(r[1],Math.max(0,Number(state.manualMarks?.[r[0]] ?? 0))),0);
      document.getElementById('manualTotal').textContent = `${newManual.toFixed(1)} / ${writtenRubric.reduce((s,r)=>s+r[1],0)}`;
      document.getElementById('resultsTotal').textContent = `${(autoScore + newManual).toFixed(1)} / 100`;
      overlay.querySelectorAll('.result-question').forEach(section => {
        const inputs = [...section.querySelectorAll('[data-manual-mark]')];
        if (!inputs.length) return;
        const manual = inputs.reduce((sum,el)=>sum+Number(el.value||0),0);
        const rubricMax = inputs.reduce((sum,el)=>sum+Number(el.max),0);
        const badge = section.querySelector('.result-score');
        const objectivePart = autoRows.filter(r => r.key.startsWith(section.dataset.resultQ + '_') || r.key === section.dataset.resultQ).reduce((sum,r)=>sum+r.score,0);
        badge.textContent = `${(objectivePart + manual).toFixed(1)} / ${badge.textContent.split('/')[1].trim()}`;
      });
    }));
    const close = () => { overlay.classList.remove('open'); };
    overlay.querySelector('#closeResults').addEventListener('click', close);
    overlay.querySelector('#exportResults').addEventListener('click', () => exportAnswers(true));
    overlay.querySelectorAll('#retakeExam, #retakeExamBottom').forEach(btn => btn.addEventListener('click', retakeExam));
    overlay.scrollTop = 0;
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function finishExam() {
    if (state.submitted) { showResults(); return; }
    if (!confirm('Submit this attempt? Your answers will be locked until you choose Retake test. The memo will then be revealed.')) return;
    if (timerStarted) stopTimer();
    state.submitted = true;
    state.manualMarks = state.manualMarks || {};
    saveState(); lockAnswers(true); closeReview(); showResults();
    showToast('Attempt submitted. Review the memo and your results below.');
  }
  function retakeExam() {
    if (!confirm('Start a fresh attempt? Your current answers and marks will be cleared from this browser. Export them first if you want to keep a copy.')) return;
    clearInterval(timerInterval); timerInterval = null; timerRemaining = DURATION; timerStarted = false; filterUnanswered = false;
    state = { answers: {}, flagged: [], timerRemaining: DURATION, timerStarted: false, timerFinished: false, submitted: false, manualMarks: {} };
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    document.querySelectorAll('[data-answer]').forEach(el => { if (el.type === 'checkbox' || el.type === 'radio') el.checked = false; else el.value = ''; });
    document.querySelectorAll('.review-toggle').forEach(button => setFlag(button.closest('.question-card'), false));
    document.querySelectorAll('[data-answer], input[name^="q2_"], input[name="q3"]').forEach(el => { el.disabled = false; });
    document.querySelectorAll('.review-toggle, #insertTemplate, #expandDiagram, #startTimer, #resetTimer').forEach(el => { el.disabled = false; });
    document.querySelector('.status-pill').innerHTML = '<span></span> In progress';
    document.getElementById('resultsOverlay')?.classList.remove('open');
    timerState.textContent = 'Ready'; renderTimer(); saveState(); updateProgress();
    window.scrollTo({top: 0, behavior: 'smooth'}); showToast('Fresh attempt started. Good luck!');
  }

  function exportAnswers(includeMarks = false) {
    saveState();
    const answers = collectAnswers();
    const lines = ['COS 301 — SOFTWARE ENGINEERING', 'ADVANCED SEMESTER TEST · ATTEMPT', `Exported: ${new Date().toLocaleString()}`, `Timer remaining: ${formatTime(timerRemaining)}`, `Submitted: ${state.submitted ? 'Yes' : 'No'}`, '', ''];
    if (includeMarks && state.submitted) { lines.push('WRITTEN SELF-ASSESSED MARKS'); writtenRubric.forEach(r => lines.push(`${r[0]}: ${state.manualMarks?.[r[0]] ?? 0}/${r[1]}`)); lines.push(''); }
    questionCards.forEach(card => {
      lines.push(`${'='.repeat(68)}`, `QUESTION ${card.dataset.question}: ${getQuestionTitle(card)} (${card.dataset.marks} marks)`, '-'.repeat(68));
      const q = card.dataset.question;
      const relevant = Object.entries(answers).filter(([key]) => {
        if (q === '1') return key.startsWith('q1_');
        if (q === '2') return key.startsWith('q2_');
        if (q === '3') return key === 'q3';
        return key.startsWith(`q${q}_`);
      });
      relevant.forEach(([key, value]) => {
        const formatted = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        lines.push(`${key}: ${formatted.trim() || '[No answer]'}`);
      });
      if (card.querySelector('.review-toggle.is-flagged')) lines.push('[MARKED FOR REVIEW]');
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'COS301_Mock_Exam_Answers.txt';
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showToast('Your answers have been exported.');
  }

  answerFields.forEach(field => {
    field.addEventListener('input', () => saveState());
    field.addEventListener('change', () => saveState());
  });
  document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => saveState());
  });
  document.querySelectorAll('.review-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('.question-card');
      setFlag(card, !button.classList.contains('is-flagged'));
      saveState();
      showToast(button.classList.contains('is-flagged') ? 'Question marked for review.' : 'Review mark removed.');
    });
  });
  navItems.forEach(button => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.target);
    if (!target) return;
    filterUnanswered = false;
    applyUnansweredFilter();
    navItems.forEach(item => item.classList.toggle('active', item === button));
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navItems.forEach(item => item.classList.toggle('active', item.dataset.target === visible.target.id));
  }, { rootMargin: '-12% 0px -70% 0px', threshold: [0, .15, .4] });
  questionCards.forEach(card => observer.observe(card));
  document.getElementById('startTimer').addEventListener('click', () => startTimer(true));
  document.getElementById('resetTimer').addEventListener('click', () => {
    clearInterval(timerInterval); timerInterval = null; timerRemaining = DURATION; timerStarted = false; state.timerFinished = false; renderTimer(); saveState(); showToast('Timer reset to 2 hours.');
  });
  document.getElementById('unansweredBtn').addEventListener('click', () => {
    filterUnanswered = !filterUnanswered; applyUnansweredFilter();
    if (filterUnanswered) {
      const first = questionCards.find(card => !questionIsAnswered(card, collectAnswers()));
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else showToast('All questions have at least one response.');
    }
  });
  ['finishBtn', 'finalReview'].forEach(id => document.getElementById(id).addEventListener('click', openReview));
  document.getElementById('closeModal').addEventListener('click', closeReview);
  document.getElementById('backToPaper').addEventListener('click', closeReview);
  document.getElementById('reviewModal').addEventListener('click', event => { if (event.target.id === 'reviewModal') closeReview(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeReview(); });
  document.getElementById('exportTop').addEventListener('click', exportAnswers);
  document.getElementById('submitExam').addEventListener('click', finishExam);
  document.getElementById('dismissNotice').addEventListener('click', () => document.querySelector('.exam-notice').remove());
  document.getElementById('insertTemplate').addEventListener('click', () => {
    const area = document.querySelector('[data-answer="q7_3"]');
    if (area.value.trim() && !confirm('Replace your current diagram text with the starter template?')) return;
    area.value = `+--------------------------------------------------------------------------------+\n| AWS Region: af-south-1                                                         |\n|                                                                                |\n|  [Trust boundary: public edge]                                                 |\n|    Clients --> <<L7 Load Balancer>>                                            |\n|                         |                                                      |\n|             +-----------+-----------+                                          |\n|             v                       v                                          |\n|       [AZ 1 / app]            [AZ 2 / app]                                     |\n|       API instance(s)         API instance(s)                                  |\n|             |                       |                                          |\n|             +-----------+-----------+                                          |\n|                         v                                                      |\n|               [Private data boundary]                                         |\n|                Primary DB <--> Standby/Replica                                |\n|                                                                                |\n| Label protocols, ports, synchronous/asynchronous edges,                       |\n| replication, health checks, failover and trust boundaries.                    |\n+--------------------------------------------------------------------------------+`;
    saveState(); area.focus(); showToast('Starter template inserted. Adapt it to your design.');
  });
  document.getElementById('expandDiagram').addEventListener('click', () => {
    const area = document.querySelector('[data-answer="q7_3"]');
    area.rows = area.rows === 14 ? 25 : 14;
    area.focus();
  });
  window.addEventListener('beforeunload', () => { state.timerRemaining = timerRemaining; state.timerStarted = timerStarted; try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, answers: collectAnswers(), flagged: questionCards.filter(c => c.querySelector('.review-toggle.is-flagged')).map(c => c.dataset.question) })); } catch (_) {} });
  loadState();
  if (state.submitted) { lockAnswers(true); showResults(); }
  updateProgress();
})();
