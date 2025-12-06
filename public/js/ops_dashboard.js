window.addEventListener('DOMContentLoaded', () => {
    initOpsDashboard();
});

function initOpsDashboard() {
    console.log('Ops dashboard initialized');

    const state = {
        currentRange: 'today'
    };

    const dom = {
        summary: {
            totalParses: document.getElementById('kpi-total-parses'),
            successRate: document.getElementById('kpi-success-rate'),
            avgLatency: document.getElementById('kpi-avg-latency'),
            tokensToday: document.getElementById('kpi-tokens-today'),
            costToday: document.getElementById('kpi-cost-today'),
            activeUsers: document.getElementById('kpi-active-users')
        },
        funnelSteps: document.querySelectorAll('[data-role="funnel-step"]'),
        segments: document.querySelectorAll('[data-role="segment-row"]'),
        tokenStats: document.querySelectorAll('[data-field^="tokens-"], [data-field^="cost-"]'),
        activation: {
            total: document.querySelector('[data-field="activation-total"]'),
            used: document.querySelector('[data-field="activation-used"]'),
            rate: document.querySelector('[data-field="activation-rate"]'),
            today: document.querySelector('[data-field="activation-today"]')
        },
        quotaRows: document.querySelectorAll('[data-role="quota-row"]'),
        alerts: document.querySelectorAll('[data-role="alert-item"]'),
        rangeTags: document.querySelectorAll('.range-selector .tag'),
        rangeValue: document.querySelector('.fake-input-value'),
        languageToggle: document.getElementById('languageToggle')
    };

    initDashboardI18n(dom).catch((err) => console.error('I18n init failed:', err));

    bindRangeSelectors(dom, state);
    loadAndRender(dom, state, state.currentRange);
}

async function loadDashboardData(range = 'today') {
    const url = `/api/ops/dashboard?range=${encodeURIComponent(range)}`;
    const token = getAuthToken();
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
    });

    if (!response.ok) {
        console.error('Dashboard API error:', response.status, response.statusText);
        throw new Error(`Failed to fetch dashboard data: ${response.status}`);
    }

    return await response.json();
}

function loadAndRender(dom, state, range) {
    updateRangeDisplay(dom, range);
    dom.rangeTags.forEach((tag) => {
        const tagRange = tag.getAttribute('data-range') || 'today';
        tag.classList.toggle('active', tagRange === range);
    });
    loadDashboardData(range)
        .then((data) => {
            renderSummary(dom, data.summary || {});
            renderFunnel(dom, data.funnel || []);
            renderSegments(dom, data.segments || []);
            renderTokens(dom, data.tokens || {});
            renderActivation(dom, data.activation || {});
            renderQuota(dom, data.quotaWarnings || []);
            renderAlerts(dom, data.alerts || []);
        })
        .catch((err) => {
            console.error('Failed to render dashboard:', err);
        });
}

function bindRangeSelectors(dom, state) {
    dom.rangeTags.forEach((tag) => {
        tag.addEventListener('click', () => {
            const range = tag.getAttribute('data-range') || 'today';
            if (range === state.currentRange) return;
            state.currentRange = range;
            loadAndRender(dom, state, range);
        });
    });
}

function updateRangeDisplay(dom, range) {
    if (!dom.rangeValue) return;
    const active = Array.from(dom.rangeTags || []).find(
        (tag) => (tag.getAttribute('data-range') || 'today') === range
    );
    const text = active ? active.textContent.trim() : range;
    dom.rangeValue.textContent = text;
}

function getAuthToken() {
    const params = new URLSearchParams(window.location.search);
    const tokenFromQuery = params.get('token');
    if (tokenFromQuery) return tokenFromQuery;
    try {
        const cached = localStorage.getItem('momentsAuth');
        if (!cached) return '';
        const parsed = JSON.parse(cached);
        return parsed?.token || '';
    } catch (err) {
        console.warn('Failed to read auth token:', err);
        return '';
    }
}

function renderSummary(dom, summary) {
    if (!summary || !dom.summary) return;
    dom.summary.totalParses.textContent = summary.totalParses;
    dom.summary.successRate.textContent = (summary.successRate * 100).toFixed(1) + "%";
    dom.summary.avgLatency.textContent = (summary.avgLatencyMs / 1000).toFixed(1) + "s";
    dom.summary.tokensToday.textContent = summary.tokensToday.toLocaleString();
    dom.summary.costToday.textContent = "$ " + summary.costToday.toFixed(2);
    dom.summary.activeUsers.textContent = summary.activeUsers;
}

function renderFunnel(dom, funnel) {
    if (!Array.isArray(funnel)) return;
    dom.funnelSteps.forEach(stepEl => {
        const stepKey = stepEl.getAttribute('data-step');
        const data = funnel.find(item => item.step === stepKey);
        if (!data) return;
        const nameEl = stepEl.querySelector('[data-field="step-name"]');
        const countEl = stepEl.querySelector('[data-field="count"]');
        const percentEl = stepEl.querySelector('[data-field="percentage"]');
        if (nameEl) nameEl.textContent = capitalize(stepKey);
        if (countEl) countEl.querySelector('.funnel-bar-fill')?.setAttribute('style', `width:${Math.round(data.ratio * 100)}%`);
        if (percentEl) percentEl.textContent = Math.round(data.ratio * 100) + "%";
    });
}

function renderSegments(dom, segments) {
    if (!Array.isArray(segments)) return;
    dom.segments.forEach((segmentEl, index) => {
        const data = segments[index];
        if (!data) return;
        const nameEl = segmentEl.querySelector('[data-field="segment-name"] span:last-child');
        const countEl = segmentEl.querySelector('[data-field="segment-count"]');
        const descEl = segmentEl.querySelector('[data-field="segment-desc"]');
        if (nameEl) nameEl.textContent = formatSegmentName(data.segment);
        if (countEl) countEl.textContent = `${data.count} Users`;
        if (descEl) descEl.textContent = data.desc;
    });
}

function renderTokens(dom, tokens) {
    if (!tokens) return;
    dom.tokenStats.forEach(el => {
        const field = el.getAttribute('data-field');
        if (field === 'tokens-total') el.textContent = tokens.totalToday.toLocaleString();
        if (field === 'tokens-average') el.textContent = `Avg ${tokens.avgPerReq}`;
        if (field === 'cost-today') el.textContent = `$ ${tokens.costToday.toFixed(2)}`;
        if (field === 'cost-month') el.textContent = `Mo. Total $ ${tokens.costMonth.toFixed(1)}`;
    });
}

function renderActivation(dom, activation) {
    if (!activation || !dom.activation) return;
    if (dom.activation.total) dom.activation.total.textContent = `${activation.total} Units`;
    if (dom.activation.used) dom.activation.used.textContent = `${activation.used} Units (${(activation.rate * 100).toFixed(1)}%)`;
    if (dom.activation.rate) dom.activation.rate.style.width = `${(activation.rate * 100).toFixed(1)}%`;
    if (dom.activation.today) dom.activation.today.textContent = activation.today;
}

function renderQuota(dom, quotas) {
    if (!Array.isArray(quotas)) return;
    dom.quotaRows.forEach((rowEl, index) => {
        const data = quotas[index];
        if (!data) return;
        const userEl = rowEl.querySelector('[data-field="user"] span:last-child');
        const usedEl = rowEl.querySelector('[data-field="used"]');
        const remainingEl = rowEl.querySelector('[data-field="remaining"]');
        const lastParseEl = rowEl.querySelector('[data-field="last-parse"]');
        if (userEl) userEl.textContent = data.user;
        if (usedEl) usedEl.textContent = data.used;
        if (remainingEl) remainingEl.textContent = data.remaining;
        if (lastParseEl) lastParseEl.textContent = data.lastParse;
    });
}

function renderAlerts(dom, alerts) {
    if (!Array.isArray(alerts)) return;
    dom.alerts.forEach((alertEl, index) => {
        const data = alerts[index];
        if (!data) return;
        alertEl.setAttribute('data-level', data.level);
        const titleEl = alertEl.querySelector('[data-field="alert-title"]');
        const msgEl = alertEl.querySelector('[data-field="alert-message"]');
        if (titleEl) titleEl.textContent = data.title;
        if (msgEl) msgEl.textContent = data.message;
    });
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSegmentName(key) {
    const map = {
        high: "High Freq",
        light: "Light Users",
        churn: "Risk",
        silent: "Dormant"
    };
    return map[key] || capitalize(key);
}

const DASHBOARD_LANG_KEY = 'momentsLang';
const DASHBOARD_SUPPORTED_LANGS = ['en', 'zh'];

async function initDashboardI18n(dom) {
    const initialLang = getStoredLanguage();
    await setDashboardLanguage(dom, initialLang);
    if (dom.languageToggle) {
        dom.languageToggle.addEventListener('click', async () => {
            const next = toggleLanguage(getStoredLanguage());
            await setDashboardLanguage(dom, next);
        });
    }
}

function getStoredLanguage() {
    const stored = localStorage.getItem(DASHBOARD_LANG_KEY);
    if (stored && DASHBOARD_SUPPORTED_LANGS.includes(stored)) return stored;
    return 'zh';
}

function toggleLanguage(current) {
    return current === 'zh' ? 'en' : 'zh';
}

function saveLanguage(lang) {
    localStorage.setItem(DASHBOARD_LANG_KEY, lang);
}

async function setDashboardLanguage(dom, lang) {
    const normalized = DASHBOARD_SUPPORTED_LANGS.includes(lang) ? lang : 'zh';
    saveLanguage(normalized);
    const translations = await loadDashboardTranslations(normalized);
    applyDashboardTranslations(translations);
    updateToggleLabel(dom, normalized);
}

async function loadDashboardTranslations(lang) {
    const prefix = window.location.origin.startsWith('file') ? 'locales' : '/locales';
    const urls = [`${prefix}/${lang}/dashboard.json`, `locales/${lang}/dashboard.json`];
    for (const url of urls) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) {
            return res.json();
        }
    }
    throw new Error(`Failed to load dashboard translations: 404`);
}

function applyDashboardTranslations(translations) {
    const nodes = document.querySelectorAll('[data-i18n]');
    nodes.forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const translated = translations[key];
        if (!translated) return;
        const attr = el.getAttribute('data-i18n-attr');
        if (attr) {
            el.setAttribute(attr, translated);
        } else {
            el.textContent = translated;
        }
    });
}

function updateToggleLabel(dom, lang) {
    if (!dom.languageToggle) return;
    dom.languageToggle.textContent = lang === 'zh' ? 'EN' : '中文';
}
