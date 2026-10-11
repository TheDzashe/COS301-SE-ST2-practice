(() => {
  'use strict';
  const STORAGE_KEY = 'cos301-notebooklm-question-bank-v1';
  const modules = window.NOTEBOOK_MODULES || [];
  const modelAnswers = window.NOTEBOOK_ANSWERS || {};
  const moduleRoot = document.getElementById('notebookModules');
  const searchInput = document.getElementById('questionSearch');
  const unansweredButton = document.getElementById('toggleUnanswered');
  const toast = document.getElementById('notebookToast');
  let answers = {};
  let unansweredOnly = false;
  let toastTimer;

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    answers = saved && typeof saved === 'object' ? saved : {};
  } catch (_) { answers = {}; }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
      updateProgress();
    } catch (_) { showToast('Browser storage is unavailable. Export your answers to keep a copy.'); }
  }

  function formatPrompt(body) {
    // The source was extracted from a document with many paragraphs joined together.
    // Add line breaks before multiple-choice options to make them easier to scan.
    return String(body || '').replace(/\s+(?=[A-D]\.\s)/g, '\n').trim();
  }

  function render() {
    moduleRoot.replaceChildren();
    modules.forEach((module, index) => {
      const details = document.createElement('details');
      details.className = 'notebook-module';
      details.open = index === 0;
      const summary = document.createElement('summary');
      summary.className = 'module-summary';
      const title = document.createElement('span');
      title.className = 'module-title';
      title.textContent = `MODULE ${module.number} · ${module.title}`;
      const count = document.createElement('span');
      count.className = 'module-count';
      count.textContent = `${module.questions.length} questions`;
      summary.append(title, count);
      details.append(summary);

      const questionsWrap = document.createElement('div');
      questionsWrap.className = 'notebook-question-list';
      module.questions.forEach(question => {
        const card = document.createElement('article');
        card.className = 'notebook-question';
        card.dataset.question = question.number;
        card.dataset.search = `${module.title} ${question.number} ${question.type} ${question.body} ${modelAnswers[question.number] || ''}`.toLowerCase();

        const heading = document.createElement('div');
        heading.className = 'notebook-question-heading';
        const qTitle = document.createElement('h3');
        qTitle.textContent = `Question ${question.number} · ${question.type}`;
        const status = document.createElement('span');
        status.className = 'answer-status';
        status.textContent = (answers[question.number] || '').trim() ? 'Answered' : 'Not answered';
        heading.append(qTitle, status);

        const prompt = document.createElement('div');
        prompt.className = 'notebook-prompt';
        prompt.textContent = formatPrompt(question.body);

        const answerLabel = document.createElement('label');
        answerLabel.className = 'notebook-answer-label';
        answerLabel.htmlFor = `answer-${question.number.replace('.', '-')}`;
        answerLabel.textContent = 'Your answer';
        const textarea = document.createElement('textarea');
        textarea.id = answerLabel.htmlFor;
        textarea.className = 'notebook-answer';
        textarea.rows = question.type.toLowerCase().includes('diagram') ? 8 : 5;
        textarea.placeholder = question.type.toLowerCase().includes('diagram')
          ? 'Construct your labelled ASCII diagram here…'
          : 'Write your answer here…';
        textarea.value = answers[question.number] || '';
        textarea.addEventListener('input', () => {
          answers[question.number] = textarea.value;
          status.textContent = textarea.value.trim() ? 'Answered' : 'Not answered';
          card.classList.toggle('has-answer', Boolean(textarea.value.trim()));
          save();
          applyFilters();
        });
        card.classList.toggle('has-answer', Boolean(textarea.value.trim()));

        const modelAnswer = modelAnswers[question.number];
        if (modelAnswer) {
          const modelAnswerToggle = document.createElement('button');
          modelAnswerToggle.type = 'button';
          modelAnswerToggle.className = 'button button-outline model-answer-toggle';
          modelAnswerToggle.textContent = 'Show model answer';
          modelAnswerToggle.setAttribute('aria-expanded', 'false');

          const modelAnswerPanel = document.createElement('div');
          modelAnswerPanel.className = 'model-answer-panel';
          modelAnswerPanel.hidden = true;

          const modelAnswerHeading = document.createElement('h4');
          modelAnswerHeading.textContent = 'Marking memorandum / worked solution';
          const modelAnswerText = document.createElement('pre');
          modelAnswerText.className = 'model-answer-text';
          modelAnswerText.textContent = modelAnswer;
          modelAnswerPanel.append(modelAnswerHeading, modelAnswerText);

          modelAnswerToggle.addEventListener('click', () => {
            const isOpen = !modelAnswerPanel.hidden;
            modelAnswerPanel.hidden = isOpen;
            modelAnswerToggle.textContent = isOpen ? 'Show model answer' : 'Hide model answer';
            modelAnswerToggle.setAttribute('aria-expanded', String(!isOpen));
          });
          card.append(heading, prompt, answerLabel, textarea, modelAnswerToggle, modelAnswerPanel);
        } else {
          card.append(heading, prompt, answerLabel, textarea);
        }
        questionsWrap.append(card);
      });
      details.append(questionsWrap);
      moduleRoot.append(details);
    });
    updateProgress();
    applyFilters();
  }

  function updateProgress() {
    const total = modules.reduce((sum, module) => sum + module.questions.length, 0);
    const attempted = modules.flatMap(module => module.questions).filter(q => (answers[q.number] || '').trim()).length;
    const percent = total ? Math.round(attempted / total * 100) : 0;
    document.getElementById('notebookProgress').textContent = `${percent}%`;
    document.getElementById('notebookProgressText').textContent = `${attempted} of ${total} answered`;
    document.getElementById('notebookProgressFill').style.width = `${percent}%`;
    document.querySelectorAll('.notebook-module').forEach((details, index) => {
      const module = modules[index];
      const done = module.questions.filter(q => (answers[q.number] || '').trim()).length;
      const count = details.querySelector('.module-count');
      if (count) count.textContent = `${done}/${module.questions.length} answered`;
    });
  }

  function applyFilters() {
    const term = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.notebook-module').forEach((details, index) => {
      let visibleCount = 0;
      details.querySelectorAll('.notebook-question').forEach(card => {
        const answered = Boolean((answers[card.dataset.question] || '').trim());
        const visible = (!unansweredOnly || !answered) && (!term || card.dataset.search.includes(term));
        card.hidden = !visible;
        if (visible) visibleCount++;
      });
      details.hidden = visibleCount === 0;
      if ((term || unansweredOnly) && visibleCount) details.open = true;
    });
    unansweredButton.textContent = unansweredOnly ? 'Show all questions' : 'Show unanswered';
  }

  function exportAnswers() {
    const lines = ['COS 301 — NotebookLM Comprehensive Question Bank', ''];
    modules.forEach(module => {
      lines.push('='.repeat(72), `MODULE ${module.number}: ${module.title}`, '='.repeat(72));
      module.questions.forEach(question => {
        lines.push(`QUESTION ${question.number} (${question.type})`, question.body, '', 'YOUR ANSWER:', (answers[question.number] || '').trim() || '[No answer]', '');
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'COS301_NotebookLM_Question_Bank_Answers.txt';
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showToast('NotebookLM answers exported.');
  }

  searchInput.addEventListener('input', applyFilters);
  unansweredButton.addEventListener('click', () => { unansweredOnly = !unansweredOnly; applyFilters(); });
  document.getElementById('exportNotebook').addEventListener('click', exportAnswers);
  document.getElementById('clearNotebook').addEventListener('click', () => {
    if (!confirm('Clear all answers saved for the NotebookLM question bank? This will not affect your original mock exam.')) return;
    answers = {};
    save();
    render();
    showToast('NotebookLM answers cleared. The original mock exam is unchanged.');
  });
  render();
})();
