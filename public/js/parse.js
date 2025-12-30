(() => {
  const DEFAULT_SCENARIO = 'moment';
  const promptCache = {};
  const promptFilePath = '/prompts/MOMENT_SCENARIO.txt';

  const dom = {};
  let selectedFile = null;
  let base64Cache = '';
  let showImageAnalysis = false;
  let actionFeedbackTimer = null;
  let isSuperAdmin = false;
  let debugEnabled = false;
  let streamAbortController = null;
  let streamText = '';
  let streamRenderPending = false;
  let streamAutoScroll = true;
  let streamStarted = false;
  const TASK_STEPS = [
    { id: 'imageProcessing', stepKey: 'image_processing', i18nKey: 'parse.progress.stepImageProcessing' },
    { id: 'visionCall', stepKey: 'image_model_call', i18nKey: 'parse.progress.stepVisionCall' },
    { id: 'visionResult', stepKey: 'image_result_saved', i18nKey: 'parse.progress.stepVisionResult' },
    { id: 'bundle', stepKey: 'prompt_building', i18nKey: 'parse.progress.stepBundle' },
    { id: 'textModel', stepKey: 'llm_call', i18nKey: 'parse.progress.stepTextModel' },
    { id: 'render', stepKey: 'final_result', i18nKey: 'parse.progress.stepRender' }
  ];
  const progressState = {
    steps: [],
    timer: null,
    pollTimer: null,
    canClose: false,
    hasError: false,
    taskId: null
  };

  function cacheDom() {
    dom.dropzone = document.getElementById('dropzone');
    dom.fileInput = document.getElementById('fileInput');
    dom.previewWrapper = document.getElementById('previewWrapper');
    dom.previewImage = document.getElementById('previewImage');
    dom.emptyState = document.getElementById('emptyState');
    dom.fileNameEl = document.getElementById('fileName');
    dom.resetFileBtn = document.getElementById('resetFile');
    dom.textInput = document.getElementById('textInput');
    dom.charCount = document.getElementById('charCount');
    dom.analyzeBtn = document.getElementById('analyzeBtn');
    dom.statusBadge = document.getElementById('statusBadge');
    dom.resultContent = document.getElementById('resultContent');
    dom.resultPlaceholder = document.getElementById('resultPlaceholder');
    dom.imageAnalysisEl = document.getElementById('imageAnalysis');
    dom.rawTextSection = document.getElementById('rawTextSection');
    dom.rawText = document.getElementById('rawText');
    dom.copyRawBtn = document.getElementById('copyRawBtn');
    dom.exportBtn = document.getElementById('exportBtn');
    dom.exportPreview = document.getElementById('exportPreview');
    dom.exportText = document.getElementById('exportText');
    dom.exportMarkdown = document.getElementById('exportMarkdown');
    dom.exportDate = document.getElementById('exportDate');
    dom.exportContent = document.getElementById('exportContent');
    dom.exportPreviewContainer = document.getElementById('exportPreviewContainer');
    dom.savedPreviewImage = document.getElementById('savedPreviewImage');
    dom.copyOptimizedBtn = document.getElementById('copyOptimizedBtn');
    dom.actionFeedback = document.getElementById('actionFeedback');
    dom.analysisToggle = document.getElementById('analysisToggle');
    dom.processingModal = document.getElementById('processingModal');
    dom.analyzeLabel = document.getElementById('analyzeLabel');
    dom.logoutBtn = document.getElementById('logoutBtn');
    dom.creditsValue = document.getElementById('creditsValue');
    dom.adminLink = document.getElementById('adminLink');
    dom.userMenuBtn = document.getElementById('userMenuBtn');
    dom.userMenu = document.getElementById('userMenu');
    dom.userAvatar = document.getElementById('userAvatar');
    dom.deleteAccountBtn = document.getElementById('deleteAccountBtn');
    dom.debugPanel = document.getElementById('debugPanel');
    dom.debugToggle = document.getElementById('debugToggle');
    dom.debugContent = document.getElementById('debugContent');
    dom.progressList = document.getElementById('progressSteps');
    dom.progressCloseBtn = document.getElementById('progressCloseBtn');
    dom.progressError = document.getElementById('progressError');
    console.log('[parse] cacheDom', dom);
  }

  function showActionFeedback(message, isError = false) {
    if (!dom.actionFeedback) return;
    dom.actionFeedback.textContent = message || '';
    dom.actionFeedback.classList.toggle('hidden', !message);
    dom.actionFeedback.classList.toggle('text-rose-600', Boolean(isError));
    dom.actionFeedback.classList.toggle('text-emerald-600', !isError);
    if (actionFeedbackTimer) {
      clearTimeout(actionFeedbackTimer);
    }
    if (message) {
      actionFeedbackTimer = window.setTimeout(() => {
        dom.actionFeedback.classList.add('hidden');
      }, 2200);
    }
  }

  function setStatus(key, color = 'blue') {
    const text = i18n.t(key) || key;
    dom.statusBadge.textContent = text;
    const colorMap = {
      blue: ['bg-blue-50', 'text-blue-600', 'border-blue-100'],
      green: ['bg-emerald-50', 'text-emerald-600', 'border-emerald-100'],
      red: ['bg-rose-50', 'text-rose-600', 'border-rose-100'],
      gray: ['bg-gray-50', 'text-gray-600', 'border-gray-100']
    };
    dom.statusBadge.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm';
    dom.statusBadge.classList.add(...(colorMap[color] || colorMap.blue));
  }

  function updateCharCount() {
    const len = dom.textInput.value.length;
    dom.charCount.textContent = `${len}/500`;
    if (len > 500) {
      dom.textInput.value = dom.textInput.value.slice(0, 500);
      dom.charCount.textContent = '500/500';
    }
  }

  function resetPreview() {
    selectedFile = null;
    base64Cache = '';
    dom.fileInput.value = '';
    dom.previewWrapper.classList.add('hidden');
    dom.emptyState.classList.remove('hidden');
  }

  function formatSeconds(ms) {
    const sec = Math.round(ms / 1000);
    return Number.isFinite(sec) ? `${sec}` : '0';
  }

  function stopProgressTimer() {
    if (progressState.timer) {
      clearInterval(progressState.timer);
      progressState.timer = null;
    }
  }

  function stopPollTimer() {
    if (progressState.pollTimer) {
      clearInterval(progressState.pollTimer);
      progressState.pollTimer = null;
    }
  }

  function showProgressModal() {
    if (!dom.processingModal) return;
    dom.processingModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function hideProgressModal() {
    if (!dom.processingModal) return;
    dom.processingModal.classList.add('hidden');
    document.body.style.overflow = '';
    stopProgressTimer();
  }

  function resetProgressState() {
    stopProgressTimer();
    stopPollTimer();
    progressState.steps = TASK_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      elapsedMs: 0,
      startedAt: null
    }));
    progressState.taskId = null;
    progressState.canClose = false;
    progressState.hasError = false;
    if (dom.progressError) {
      dom.progressError.textContent = '';
      dom.progressError.classList.add('hidden');
    }
    if (dom.progressCloseBtn) {
      dom.progressCloseBtn.disabled = true;
      dom.progressCloseBtn.classList.remove('hidden');
    }
  }

  function renderProgressSteps() {
    if (!dom.progressList) return;
    const statusTextMap = {
      pending: i18n.t('parse.progress.status.pending'),
      active: i18n.t('parse.progress.status.active'),
      done: i18n.t('parse.progress.status.done'),
      error: i18n.t('parse.progress.status.error')
    };
    const now = performance.now();
    dom.progressList.querySelectorAll('.progress-step').forEach((el) => {
      const stepId = el.getAttribute('data-step-id');
      const step = progressState.steps.find((s) => s.id === stepId);
      const dot = el.querySelector('.progress-step-dot');
      const statusEl = el.querySelector('[data-status-text]');
      const timeEl = el.querySelector('[data-time-text]');
      if (!step) return;

      const totalMs = step.elapsedMs;
      const timeLabel = i18n.t('parse.progress.time', { seconds: formatSeconds(totalMs) });
      const statusLabel = statusTextMap[step.status] || statusTextMap.pending;

      el.classList.toggle('is-active', step.status === 'active');
      el.classList.toggle('is-done', step.status === 'done');
      el.classList.toggle('is-error', step.status === 'error');
      if (dot) {
        dot.classList.toggle('bg-blue-500', step.status === 'active');
        dot.classList.toggle('bg-emerald-500', step.status === 'done');
        dot.classList.toggle('bg-rose-500', step.status === 'error');
      }
      if (statusEl) statusEl.textContent = statusLabel;
      if (timeEl) timeEl.textContent = timeLabel;
    });
  }

  function setProgressStatus(stepId, status, elapsedAdd = 0) {
    const step = progressState.steps.find((s) => s.id === stepId);
    if (!step) return;
    if (elapsedAdd > 0) {
      step.elapsedMs += elapsedAdd;
    }
    step.status = status;
    renderProgressSteps();
  }

  function finishProgressSteps() {
    const now = performance.now();
    progressState.steps.forEach((step) => {
      step.status = 'done';
    });
    stopProgressTimer();
    progressState.canClose = true;
    if (dom.progressCloseBtn) dom.progressCloseBtn.disabled = false;
    renderProgressSteps();
  }

  function failProgress(message) {
    const now = performance.now();
    stopProgressTimer();
    stopPollTimer();
    progressState.hasError = true;
    let markedError = false;
    progressState.steps.forEach((step) => {
      if (!markedError && (step.status === 'active' || step.status === 'pending')) {
        step.status = 'error';
        markedError = true;
      }
    });
    progressState.canClose = true;
    if (dom.progressCloseBtn) dom.progressCloseBtn.disabled = false;
    if (dom.progressError) {
      const fallback = i18n.t('common.requestFailed');
      dom.progressError.textContent = i18n.t('parse.progress.error', { message: message || fallback });
      dom.progressError.classList.remove('hidden');
    }
    renderProgressSteps();
  }

  function startProgress() {
    stopProgressTimer();
    stopPollTimer();
    progressState.steps = TASK_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      elapsedMs: 0,
      startedAt: null
    }));
    progressState.taskId = null;
    progressState.canClose = false;
    progressState.hasError = false;
    if (dom.progressError) {
      dom.progressError.textContent = '';
      dom.progressError.classList.add('hidden');
    }
    if (dom.progressCloseBtn) {
      dom.progressCloseBtn.disabled = false;
      dom.progressCloseBtn.classList.remove('hidden');
    }
    showProgressModal();
    if (TASK_STEPS[0]) {
      setProgressStatus(TASK_STEPS[0].id, 'active');
    }
    renderProgressSteps();
    progressState.timer = window.setInterval(renderProgressSteps, 1000);
  }

  function computeElapsedMs(step, serverNowIso) {
    if (!step) return 0;
    const start = step.startedAt ? Date.parse(step.startedAt) : null;
    const end = step.finishedAt ? Date.parse(step.finishedAt) : null;
    const now = serverNowIso ? Date.parse(serverNowIso) : Date.now();
    if (start && end) return Math.max(0, end - start);
    if (start && !end) return Math.max(0, now - start);
    return 0;
  }

  function syncProgressSteps(steps, serverTime) {
    progressState.steps.forEach((uiStep) => {
      const serverStep = steps.find((s) => s.stepKey === uiStep.stepKey);
      if (!serverStep) return;
      const elapsedMs = computeElapsedMs(serverStep, serverTime);
      let status = 'pending';
      if (serverStep.status === 'RUNNING') status = 'active';
      else if (serverStep.status === 'SUCCESS') status = 'done';
      else if (serverStep.status === 'FAILED') status = 'error';
      uiStep.status = status;
      uiStep.elapsedMs = elapsedMs;
    });
    renderProgressSteps();
  }

  function getStepLabel(stepKey, fallback) {
    const match = TASK_STEPS.find((step) => step.stepKey === stepKey);
    if (match?.i18nKey) {
      return i18n.t(match.i18nKey);
    }
    return fallback || stepKey;
  }

  function renderProgressPreview(steps, serverTime) {
    if (!dom.resultContent || !Array.isArray(steps)) return;
    const statusTextMap = {
      pending: i18n.t('parse.progress.status.pending'),
      active: i18n.t('parse.progress.status.active'),
      done: i18n.t('parse.progress.status.done'),
      error: i18n.t('parse.progress.status.error')
    };
    const items = steps
      .map((step) => {
        const elapsedMs = computeElapsedMs(step, serverTime);
        let status = 'pending';
        if (step.status === 'RUNNING') status = 'active';
        else if (step.status === 'SUCCESS') status = 'done';
        else if (step.status === 'FAILED') status = 'error';
        const statusLabel = statusTextMap[status] || statusTextMap.pending;
        const timeLabel = i18n.t('parse.progress.time', { seconds: formatSeconds(elapsedMs) });
        const title = getStepLabel(step.stepKey, step.stepLabel);
        return `
          <li class="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="h-2.5 w-2.5 rounded-full ${
                status === 'done'
                  ? 'bg-emerald-500'
                  : status === 'active'
                    ? 'bg-blue-500'
                    : status === 'error'
                      ? 'bg-rose-500'
                      : 'bg-gray-300'
              }"></span>
              <div>
                <p class="text-sm font-semibold text-gray-900">${title}</p>
                <p class="text-xs text-gray-500">${statusLabel}</p>
              </div>
            </div>
            <div class="text-sm font-semibold text-gray-700 min-w-[96px] text-right">${timeLabel}</div>
          </li>
        `;
      })
      .join('');
    dom.resultContent.innerHTML = `
      <div class="space-y-3">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
          ${i18n.t('parse.progressTitle')}
        </p>
        <ul class="space-y-2">${items}</ul>
      </div>
    `;
    dom.resultContent.classList.remove('hidden');
    dom.resultContent.classList.remove('is-streaming');
    dom.resultPlaceholder.classList.add('hidden');
  }

  async function fetchTaskStatus(taskId, baseText) {
    try {
      const data = await window.appCommon.authFetch(
        `/api/tasks/${taskId}`,
        { method: 'GET', headers: { Authorization: `Bearer ${window.appCommon.getToken()}` } },
        { requireAuth: true }
      );
      const { task, steps, serverTime } = data || {};
      if (!task || !Array.isArray(steps)) return;

      syncProgressSteps(steps, serverTime);

      const allDoneOrError = progressState.steps.every(
        (s) => s.status === 'done' || s.status === 'error'
      );
      if (allDoneOrError) {
        progressState.canClose = true;
        if (dom.progressCloseBtn) dom.progressCloseBtn.disabled = false;
      }

      if (task.status === 'SUCCESS') {
        stopPollTimer();
        let result = task.resultJson || {};
        if (result && typeof result === 'string') {
          try {
            result = JSON.parse(result);
          } catch (err) {
            console.warn('Failed to parse resultJson', err);
            result = {};
          }
        }
        const optimized = result.optimizedText || result.textResult || '';
        const analysis = result.summary || result.visionSummary || '';
        renderResult(optimized, analysis);
        setStatus('parse.statusGenerated', 'green');
        dom.exportPreview.src = dom.previewImage.src;
        dom.exportText.textContent = baseText || i18n.t('parse.noNotes');
        dom.exportMarkdown.innerHTML = marked.parse(optimized || '');
        dom.exportDate.textContent = new Date().toLocaleDateString();
        finishProgressSteps();
        return;
      }
      if (task.status === 'FAILED') {
        stopPollTimer();
        failProgress(task.errorMessage || i18n.t('common.requestFailed'));
        setStatus('parse.statusFailed', 'red');
        return;
      }
    } catch (err) {
      console.error('Poll task error', err);
    }
  }

  async function fetchTaskSummary(taskId) {
    return window.appCommon.authFetch(
      `/api/tasks/${taskId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${window.appCommon.getToken()}` } },
      { requireAuth: true }
    );
  }

  async function showTaskSummary(taskId, errorMessage) {
    resetProgressState();
    try {
      const data = await fetchTaskSummary(taskId);
      const { task, steps, serverTime } = data || {};
      if (Array.isArray(steps)) {
        syncProgressSteps(steps, serverTime);
      }
      if (task?.status === 'FAILED') {
        progressState.hasError = true;
        if (dom.progressError) {
          const fallback = i18n.t('common.requestFailed');
          dom.progressError.textContent = i18n.t('parse.progress.error', {
            message: task.errorMessage || errorMessage || fallback
          });
          dom.progressError.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (dom.progressError) {
        const fallback = i18n.t('common.requestFailed');
        dom.progressError.textContent = i18n.t('parse.progress.error', {
          message: errorMessage || err.message || fallback
        });
        dom.progressError.classList.remove('hidden');
      }
    }
    progressState.canClose = true;
    if (dom.progressCloseBtn) dom.progressCloseBtn.disabled = false;
    renderProgressSteps();
  }

  function setProcessing(isProcessing) {
    if (isProcessing) {
      showProgressModal();
    } else {
      hideProgressModal();
    }
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(i18n.t('parse.alertFileReadFail')));
      reader.readAsDataURL(file);
    });
  }

  async function loadDefaultPrompt() {
    if (promptCache.default !== undefined) return promptCache.default;
    try {
      const res = await fetch(promptFilePath);
      if (!res.ok) throw new Error(`Load prompt failed: ${res.status}`);
      const text = await res.text();
      promptCache.default = text.trim();
    } catch (err) {
      console.warn('Load prompt failed, fallback to empty prompt', err);
      promptCache.default = '';
    }
    return promptCache.default;
  }

  async function callApi(payload) {
    const endpoint = payload.imageBase64 ? '/api/chat/image' : '/api/chat/text';
    const body = payload.imageBase64
      ? { text: payload.text || '', imageBase64: payload.imageBase64, scenario: payload.scenario }
      : { text: payload.text || '', scenario: payload.scenario };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${window.appCommon.getToken()}`
    };
    if (isSuperAdmin && debugEnabled) {
      headers['X-Debug-Trace'] = '1';
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const rawText = await res.text();
    let data = null;
    if (isJson && rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (err) {
        throw new Error('Invalid JSON response');
      }
    }
    if (!res.ok) {
      const message = data?.error || data?.message || rawText?.slice(0, 200) || 'Request failed';
      const err = new Error(message);
      err.code = data?.code;
      throw err;
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format');
    }
    updateDebugPanel(data?.debug);
    const markdown = data.text || data.markdown || '';
    return {
      markdown,
      imageAnalysis: data.imageAnalysis || '',
      credits: data.credits
    };
  }

  function copyText(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function getOptimizedText() {
    if (!dom.resultContent || dom.resultContent.classList.contains('hidden')) {
      return '';
    }
    return (dom.resultContent.innerText || '').trim();
  }

  async function writeToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (err) {
      console.error('Clipboard write failed', err);
      return false;
    }
  }

  async function handleCopyOptimizedText() {
    const text = getOptimizedText();
    if (!text) {
      showActionFeedback(i18n.t('parse.copyNoContent'), true);
      return;
    }
    const success = await writeToClipboard(text);
    if (success) {
      showActionFeedback(i18n.t('parse.copySuccess'));
    } else {
      showActionFeedback(i18n.t('parse.copyFail'), true);
    }
  }

  function resetRawState() {
    if (dom.rawTextSection) dom.rawTextSection.classList.add('hidden');
    if (dom.rawText) dom.rawText.textContent = '';
    if (dom.copyRawBtn) dom.copyRawBtn.disabled = true;
  }

  function applyImageAnalysis(analysis) {
    const shouldShowAnalysis = Boolean(analysis && showImageAnalysis);
    const prefix = i18n.t('parse.imagePointsPrefix');
    dom.imageAnalysisEl.textContent = shouldShowAnalysis ? `${prefix}${analysis}` : '';
    dom.imageAnalysisEl.classList.toggle('hidden', !shouldShowAnalysis);
  }

  function clearStreamState() {
    streamText = '';
    streamRenderPending = false;
    streamStarted = false;
    if (streamAbortController) {
      streamAbortController.abort();
      streamAbortController = null;
    }
  }

  function renderStreamingText(text) {
    const rendered = text ? marked.parse(text) : '';
    dom.resultContent.innerHTML = rendered;
    dom.resultContent.classList.remove('hidden');
    dom.resultContent.classList.add('is-streaming');
    dom.resultPlaceholder.classList.add('hidden');
    if (streamAutoScroll) {
      dom.resultContent.scrollIntoView({ block: 'end', behavior: 'auto' });
    }
  }

  function appendStreamText(delta) {
    if (!delta) return;
    if (!streamStarted) {
      streamStarted = true;
      stopPollTimer();
      dom.resultContent.innerHTML = '';
      dom.resultContent.classList.add('is-streaming');
    }
    streamText += delta;
    if (streamRenderPending) return;
    streamRenderPending = true;
    window.requestAnimationFrame(() => {
      renderStreamingText(streamText);
      streamRenderPending = false;
    });
  }

  function parseSseEvent(raw) {
    const lines = raw.split('\n').filter(Boolean);
    let event = 'message';
    const dataLines = [];
    lines.forEach((line) => {
      if (line.startsWith('event:')) {
        event = line.replace('event:', '').trim();
        return;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.replace(/^data:\s*/, ''));
      }
    });
    const data = dataLines.join('\n');
    if (!data) return null;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (err) {
      payload = { text: data };
    }
    return { event, payload };
  }

  async function streamTaskOutput(taskId) {
    clearStreamState();
    streamAutoScroll = true;
    streamAbortController = new AbortController();
    const res = await fetch(`/api/tasks/${taskId}/stream`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${window.appCommon.getToken()}` },
      signal: streamAbortController.signal
    });
    if (!res.ok || !res.body) {
      throw new Error('Stream request failed');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let donePayload = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      parts.forEach((chunk) => {
        const parsed = parseSseEvent(chunk);
        if (!parsed) return;
        if (parsed.event === 'token') {
          appendStreamText(parsed.payload?.token || '');
        } else if (parsed.event === 'done') {
          donePayload = parsed.payload || null;
        } else if (parsed.event === 'error') {
          throw new Error(parsed.payload?.message || 'Stream error');
        }
      });
    }
    streamAbortController = null;
    return donePayload;
  }

  function updateDebugPanel(debugData) {
    if (!dom.debugPanel || !dom.debugContent) return;
    if (!isSuperAdmin) {
      dom.debugPanel.classList.add('hidden');
      dom.debugContent.textContent = '';
      return;
    }
    dom.debugPanel.classList.remove('hidden');
    if (!debugEnabled) {
      dom.debugContent.textContent = '(debug disabled)';
      return;
    }
    dom.debugContent.textContent = debugData
      ? JSON.stringify(debugData, null, 2)
      : '(no debug payload)';
    dom.debugPanel.classList.remove('hidden');
  }

  function updateSavedPreview(previewSrc) {
    if (!dom.savedPreviewImage || !dom.exportPreviewContainer) return;
    if (!previewSrc) {
      dom.exportPreviewContainer.classList.add('hidden');
      return;
    }
    dom.savedPreviewImage.src = previewSrc;
    dom.exportPreviewContainer.classList.remove('hidden');
  }

  function renderResult(markdown, analysis) {
    const raw = markdown || '';
    const rendered = raw
      ? marked.parse(raw)
      : `<p class="text-sm text-gray-500">${i18n.t('parse.noAnalysisContent')}</p>`;
    dom.resultContent.innerHTML = rendered;

    dom.resultContent.classList.remove('hidden');
    dom.resultContent.classList.remove('is-streaming');
    dom.resultPlaceholder.classList.add('hidden');
    if (dom.rawTextSection && dom.rawText) {
      dom.rawText.textContent = raw || i18n.t('parse.noRawText');
      dom.rawTextSection.classList.toggle('hidden', !raw);
    }
    if (dom.copyRawBtn) {
      dom.copyRawBtn.onclick = () => copyText(raw);
      dom.copyRawBtn.disabled = !raw;
    }
    applyImageAnalysis(analysis);
  }

  function setCredits(value) {
    if (dom.creditsValue) {
      dom.creditsValue.textContent = Number.isFinite(value) ? String(value) : '--';
    }
  }

  function setUserSummary(user) {
    if (!user) return;
    if (dom.userAvatar && user.nickname) {
      dom.userAvatar.textContent = user.nickname.slice(0, 1).toUpperCase();
    }
    if (dom.adminLink) {
      if (user.role === 'admin' || user.role === 'super_admin') {
        dom.adminLink.classList.remove('hidden');
      } else {
        dom.adminLink.classList.add('hidden');
      }
    }
    if (typeof user.credits === 'number') {
      setCredits(user.credits);
    }
  }

  async function handleAnalyze() {
    if (!selectedFile) {
      alert(i18n.t('parse.alertNoImage'));
      return;
    }
    try {
      const me = await window.appCommon.authFetch(
        '/auth/me',
        { headers: { Authorization: `Bearer ${window.appCommon.getToken()}` } },
        { requireAuth: true }
      );
      if (typeof me?.credits === 'number') {
        setCredits(me.credits);
        if (me.credits <= 0) {
          alert(i18n.t('parse.alertCredits'));
          return;
        }
      }
    } catch (err) {
      console.warn('Pre-check credits failed', err);
    }
    dom.analyzeBtn.disabled = true;
    dom.analyzeBtn.classList.add('opacity-90', 'cursor-not-allowed');
    setStatus('parse.statusGenerating', 'gray');
    resetProgressState();
    clearStreamState();
    resetRawState();
    dom.imageAnalysisEl.classList.add('hidden');
    renderStreamingText('');
    dom.analyzeLabel.innerHTML = `
      <svg class="w-5 h-5 text-blue-100 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v2m0 12v2m8-8h-2M6 12H4m12.364-6.364l-1.414 1.414M7.05 16.95l-1.414 1.414m12.728 0l-1.414-1.414M7.05 7.05L5.636 5.636" /></svg>
      ${i18n.t('parse.generating')}
    `;

    try {
      if (!base64Cache && selectedFile) {
        base64Cache = await fileToBase64(selectedFile);
      }

      const promptText = await loadDefaultPrompt();
      const baseText = dom.textInput.value.trim() || i18n.t('parse.defaultUserText');
      const finalText = promptText
        ? `${promptText}\n\n${i18n.t('parse.customInputPrefix')}${baseText || i18n.t('parse.noNotes')}`
        : baseText;

      const payload = {
        imageBase64: base64Cache,
        text: finalText,
        scenario: DEFAULT_SCENARIO,
        userText: baseText,
        type: 'moments_optimize'
      };

      const createRes = await window.appCommon.authFetch(
        '/api/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.appCommon.getToken()}` },
          body: JSON.stringify(payload)
        },
        { requireAuth: true }
      );
      const { taskId } = createRes || {};
      if (!taskId) throw new Error('Task id missing');
      progressState.taskId = taskId;

      const firstSummary = await fetchTaskSummary(taskId);
      if (firstSummary?.steps) {
        renderProgressPreview(firstSummary.steps, firstSummary.serverTime);
      }
      progressState.pollTimer = window.setInterval(async () => {
        if (streamStarted) return;
        try {
          const data = await fetchTaskSummary(taskId);
          if (data?.steps) {
            renderProgressPreview(data.steps, data.serverTime);
          }
        } catch (err) {
          console.warn('Progress preview poll failed', err);
        }
      }, 1000);

      const streamPayload = await streamTaskOutput(taskId);
      const finalResult = streamPayload?.result || {};
      const finalOutputText = finalResult.optimizedText || streamText;
      const finalAnalysis = finalResult.visionSummary || '';
      renderResult(finalOutputText, finalAnalysis);
      setStatus('parse.statusGenerated', 'green');
      dom.exportPreview.src = dom.previewImage.src;
      dom.exportText.textContent = baseText || i18n.t('parse.noNotes');
      dom.exportMarkdown.innerHTML = marked.parse(finalOutputText || '');
      dom.exportDate.textContent = new Date().toLocaleDateString();
      await showTaskSummary(taskId);
    } catch (err) {
      if (err.code === 'INSUFFICIENT_CREDITS') {
        alert(i18n.t('parse.alertCredits'));
      }
      console.error(err);
      setStatus('parse.statusFailed', 'red');
      dom.resultContent.innerHTML = `<p class="text-rose-500 text-sm">Error: ${err.message}</p>`;
      dom.resultContent.classList.remove('hidden');
      dom.resultPlaceholder.classList.add('hidden');
      dom.imageAnalysisEl.classList.add('hidden');
      resetRawState();
      if (progressState.taskId) {
        await showTaskSummary(progressState.taskId, err.message);
      }
    } finally {
      dom.analyzeBtn.disabled = false;
      dom.analyzeBtn.classList.remove('opacity-90', 'cursor-not-allowed');
      dom.analyzeLabel.innerHTML = `
        <svg class="w-5 h-5 text-blue-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        ${i18n.t('parse.start')}
      `;
    }
  }

  async function handleExport() {
    if (!dom.previewImage.src || dom.resultContent.classList.contains('hidden')) {
      alert(i18n.t('parse.alertNoExport'));
      showActionFeedback(i18n.t('parse.alertNoExport'), true);
      return;
    }
    try {
      dom.exportBtn.disabled = true;
      const canvas = await html2canvas(dom.exportContent, { useCORS: true, scale: 2, backgroundColor: '#ffffff' });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Moments_Copy_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      updateSavedPreview(dataUrl);
      showActionFeedback(i18n.t('parse.previewReady'));
    } catch (err) {
      console.error('Export failed', err);
      showActionFeedback(i18n.t('parse.alertExportFail'), true);
      alert(`${i18n.t('parse.alertExportFail')}: ${err.message}`);
    } finally {
      dom.exportBtn.disabled = false;
    }
  }

  async function handleFileChange(file) {
    if (file.size > 5 * 1024 * 1024) {
      alert(i18n.t('parse.alertFileTooLarge'));
      return;
    }
    selectedFile = file;
    base64Cache = '';
    const objectUrl = URL.createObjectURL(file);
    dom.previewImage.src = objectUrl;
    dom.fileNameEl.textContent = file.name;
    dom.previewWrapper.classList.remove('hidden');
    dom.emptyState.classList.add('hidden');
    setStatus('parse.fileSelected', 'blue');
  }

  function bindEvents() {
    console.log('[parse] bindEvents');
    if (dom.dropzone && dom.fileInput) {
      if (dom.dropzone.tagName !== 'LABEL') {
        dom.dropzone.addEventListener('click', () => dom.fileInput.click());
      }
      dom.dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.dropzone.classList.add('border-blue-400', 'bg-blue-50/40');
      });
      dom.dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dom.dropzone.classList.remove('border-blue-400', 'bg-blue-50/40');
      });
      dom.dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dom.dropzone.classList.remove('border-blue-400', 'bg-blue-50/40');
        const file = e.dataTransfer?.files?.[0];
        if (file) await handleFileChange(file);
      });
    }

    if (dom.fileInput) {
      dom.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) {
          await handleFileChange(file);
        } else {
          resetPreview();
        }
      });
    }

    if (dom.resetFileBtn) {
      dom.resetFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        resetPreview();
        setStatus('parse.statusPending', 'blue');
        dom.resultContent.classList.add('hidden');
        dom.resultPlaceholder.classList.remove('hidden');
        dom.imageAnalysisEl.classList.add('hidden');
      });
      dom.resetFileBtn.addEventListener('click', resetRawState);
    }

    dom.analyzeBtn?.addEventListener('click', handleAnalyze);
    dom.textInput?.addEventListener('input', updateCharCount);
    dom.exportBtn?.addEventListener('click', handleExport);
    dom.copyOptimizedBtn?.addEventListener('click', handleCopyOptimizedText);
    dom.analysisToggle?.addEventListener('change', () => {
      showImageAnalysis = dom.analysisToggle.checked;
      if (!showImageAnalysis) {
        dom.imageAnalysisEl.classList.add('hidden');
      } else if (dom.imageAnalysisEl.textContent) {
        dom.imageAnalysisEl.classList.remove('hidden');
      }
    });

    if (dom.resultContent) {
      dom.resultContent.addEventListener('scroll', () => {
        const nearBottom =
          dom.resultContent.scrollTop + dom.resultContent.clientHeight >=
          dom.resultContent.scrollHeight - 12;
        streamAutoScroll = nearBottom;
      });
    }

    dom.logoutBtn?.addEventListener('click', () => {
      console.log('[parse] logout click');
      window.appCommon.clearAuth();
      window.location.href = '/login.html';
    });

    dom.deleteAccountBtn?.addEventListener('click', async () => {
      console.log('[parse] delete click');
      const keyword = i18n.t('profile.deleteConfirmKeyword');
      const text = prompt(i18n.t('profile.deleteConfirmPrompt', { keyword }));
      if (text !== keyword) return;
      try {
        const data = await window.appCommon.authFetch(
          '/api/profile/delete',
          { method: 'POST' },
          { requireAuth: true }
        );
        if (!data?.success) throw new Error(i18n.t('profile.deleteFailed'));
        alert(i18n.t('profile.deleteSuccess'));
        window.appCommon.clearAuth();
        window.location.href = '/login.html';
      } catch (err) {
        alert(err.message || i18n.t('profile.deleteFailed'));
      }
    });

    if (dom.userMenu && dom.userMenuBtn) {
      document.addEventListener('click', () => dom.userMenu?.classList.add('hidden'));
      dom.userMenu.addEventListener('click', (e) => e.stopPropagation());
      dom.userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const shouldShow = dom.userMenu.classList.contains('hidden');
        dom.userMenu.classList.toggle('hidden', !shouldShow);
      });
    }

    if (dom.debugToggle) {
      dom.debugToggle.addEventListener('change', (e) => {
        debugEnabled = Boolean(isSuperAdmin && e.target.checked);
        updateDebugPanel(null);
      });
    }

    dom.progressCloseBtn?.addEventListener('click', () => {
      if (!progressState.canClose) {
        alert(i18n.t('parse.generatingTip'));
        return;
      }
      hideProgressModal();
    });
  }

  async function loadUser() {
    const token = window.appCommon.getToken();
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    try {
      const res = await window.appCommon.authFetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      setUserSummary(res);
      isSuperAdmin = res?.role === 'super_admin';
      debugEnabled = false;
      if (dom.debugToggle) {
        dom.debugToggle.checked = false;
        dom.debugToggle.disabled = !isSuperAdmin;
      }
      updateDebugPanel(null);
    } catch (err) {
      window.appCommon.clearAuth();
      window.location.href = '/login.html';
    }
  }

  async function init() {
    console.log('[parse] init start');
    if (!window.appCommon) {
      console.error('[parse] appCommon missing');
      return;
    }
    cacheDom();
    const auth = window.appCommon.requireAuthOrRedirect();
    if (!auth) {
      console.warn('[parse] no auth, redirecting to login');
      return;
    }
    await window.appCommon.initI18n();
    setStatus('parse.statusPending', 'blue');
    updateCharCount();
    bindEvents();
    await loadUser();
    console.log('[parse] init ready');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
