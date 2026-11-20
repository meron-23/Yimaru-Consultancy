/**
 * Yimaru Consulting — AI-Powered Content Management System
 * Admin Panel Client Application
 */

// Application State
const state = {
  token: localStorage.getItem('yimaru_admin_token') || null,
  user: null,
  activeTab: 'dashboard',
  selectedAiFile: null,
  currentReviewItem: null, // { type: 'country' | 'scholarship', data: {}, original: {}, missingFields: [] }
  activeLangIdx: 0, // 0: en, 1: am, 2: om, 3: ti
  showSideBySide: false,
  countries: [],
  scholarships: [],
  leads: [],
  stats: null,
  config: null
};

// Flag fallback mapping
const FLAGS = {
  us: '', ca: '', uk: '', de: '', it: '', hu: '',
  pl: '', tr: '', cn: '', my: '', au: '', ie: '',
  se: '', fi: '', fr: '', eu: '', multi: '🌐'
};

const LANG_NAMES = ['English', 'Amharic (አማርኛ)', 'Afaan Oromoo', 'Tigrinya (ትግርኛ)'];

// ==============================================================================
// 1. INITIALIZATION & AUTH
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkAuth();
});

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    handleLogout();
    throw new Error('Session expired or unauthorized. Please log in again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Request failed`);
  }
  return data;
}

async function checkAuth() {
  if (!state.token) {
    showAuthScreen();
    return;
  }

  try {
    const res = await api('/api/auth/me');
    state.user = res.user;
    updateUserUI();
    showAppScreen();
    loadDashboard();
    checkSystemConfig();
  } catch (err) {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

function showAppScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
}

function updateUserUI() {
  if (!state.user) return;
  document.getElementById('user-name').textContent = state.user.name || state.user.email;
  document.getElementById('user-role').textContent = state.user.role === 'super_admin' ? 'Super Admin' : 'Content Admin';
  document.getElementById('user-avatar').textContent = (state.user.name || state.user.email)[0].toUpperCase();
}

function handleLogout() {
  localStorage.removeItem('yimaru_admin_token');
  state.token = null;
  state.user = null;
  showAuthScreen();
  showToast('Logged out successfully', 'info');
}

// ==============================================================================
// 2. EVENT LISTENERS
// ==============================================================================

function initEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');
    errBox.style.display = 'none';

    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('yimaru_admin_token', res.token);
      updateUserUI();
      showAppScreen();
      loadDashboard();
      checkSystemConfig();
      showToast('Welcome back, ' + (state.user.name || 'Admin') + '!', 'success');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Sidebar Nav Tabs
  document.querySelectorAll('.sidebar-nav .nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Quick action buttons
  document.getElementById('quick-ai-btn').addEventListener('click', () => switchTab('ai-upload'));
  document.getElementById('dash-btn-ai').addEventListener('click', () => switchTab('ai-upload'));
  document.getElementById('dash-btn-new-country').addEventListener('click', () => startNewItem('country'));
  document.getElementById('dash-btn-new-sch').addEventListener('click', () => startNewItem('scholarship'));
  document.getElementById('btn-add-country').addEventListener('click', () => startNewItem('country'));
  document.getElementById('btn-add-scholarship').addEventListener('click', () => startNewItem('scholarship'));

  // AI Upload Mode Tabs
  document.querySelectorAll('.ai-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ai-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ai-input-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ai-input-' + btn.dataset.inputMode).classList.add('active');
    });
  });

  // Drag & Drop
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
  });

  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  // Run AI Ingestion
  document.getElementById('btn-run-ai').addEventListener('click', runAiProcessing);

  // Review Screen Controls
  document.getElementById('review-back-btn').addEventListener('click', () => {
    switchTab(state.currentReviewItem?.type === 'country' ? 'countries' : 'scholarships');
  });

  document.querySelectorAll('.lang-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.lang-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeLangIdx = parseInt(pill.dataset.langIdx, 10);
      renderReviewFields();
    });
  });

  document.getElementById('toggle-side-by-side').addEventListener('change', (e) => {
    state.showSideBySide = e.target.checked;
    renderReviewFields();
  });

  document.getElementById('review-btn-save-draft').addEventListener('click', () => saveCurrentReview('draft'));
  document.getElementById('review-btn-request-review').addEventListener('click', () => saveCurrentReview('needs_review'));
  document.getElementById('review-btn-publish').addEventListener('click', () => saveCurrentReview('published'));
  document.getElementById('review-btn-archive').addEventListener('click', () => saveCurrentReview('archived'));

  // Search & Filter listeners
  document.getElementById('countries-search').addEventListener('input', renderCountriesTable);
  document.getElementById('countries-filter-status').addEventListener('change', renderCountriesTable);
  document.getElementById('countries-filter-region').addEventListener('change', renderCountriesTable);

  document.getElementById('scholarships-search').addEventListener('input', renderScholarshipsTable);
  document.getElementById('scholarships-filter-status').addEventListener('change', renderScholarshipsTable);
  document.getElementById('scholarships-filter-level').addEventListener('change', renderScholarshipsTable);
  document.getElementById('scholarships-filter-coverage').addEventListener('change', renderScholarshipsTable);

  document.getElementById('leads-search').addEventListener('input', renderLeadsTable);

  // Settings form
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
      phone: document.getElementById('set-phone').value.trim(),
      email: document.getElementById('set-email').value.trim(),
      telegram: document.getElementById('set-telegram').value.trim(),
      whatsapp: document.getElementById('set-whatsapp').value.trim()
    };

    try {
      await api('/api/site-content/settings', {
        method: 'PUT',
        body: JSON.stringify({ value: settings })
      });
      showToast('Contact settings updated successfully!', 'success');
    } catch (err) {
      showToast('Failed to update settings: ' + err.message, 'error');
    }
  });

  // Modal close
  document.getElementById('lead-modal-close').addEventListener('click', () => {
    document.getElementById('lead-modal').style.display = 'none';
  });
}

function handleSelectedFile(file) {
  state.selectedAiFile = file;
  const tag = document.getElementById('selected-file-name');
  tag.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  tag.style.display = 'inline-block';
}

function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById('tab-' + tabId);
  if (targetPane) targetPane.classList.add('active');

  const titles = {
    'dashboard': ['Dashboard', 'Overview of portal content, pipeline, and activity'],
    'ai-upload': ['AI Content Studio', 'Automated extraction & 4-language translation'],
    'review-publish': ['Content Review & Publishing', 'Inspect extracted fields, verify facts, and approve publication'],
    'countries': ['Study Destinations', 'Manage destination country guides and student visa facts'],
    'scholarships': ['Scholarships & Funding', 'Manage scholarships, eligibility criteria, and open deadlines'],
    'leads': ['Student Assessment Leads', 'Student qualification submissions from the website checker'],
    'settings': ['System & Configuration', 'Database status, AI engine health, and portal settings']
  };

  const [t, s] = titles[tabId] || ['Yimaru CMS', ''];
  document.getElementById('page-title').textContent = t;
  document.getElementById('page-subtitle').textContent = s;

  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'countries') loadCountries();
  if (tabId === 'scholarships') loadScholarships();
  if (tabId === 'leads') loadLeads();
  if (tabId === 'settings') checkSystemConfig();
}

// ==============================================================================
// 3. DASHBOARD & SYSTEM STATUS
// ==============================================================================

async function loadDashboard() {
  try {
    const stats = await api('/api/stats');
    state.stats = stats;

    document.getElementById('stat-countries-total').textContent = stats.countries.total;
    document.getElementById('stat-countries-pub').textContent = `${stats.countries.published} published`;
    document.getElementById('stat-countries-draft').textContent = `${stats.countries.draft} drafts`;

    document.getElementById('stat-scholarships-total').textContent = stats.scholarships.total;
    document.getElementById('stat-scholarships-pub').textContent = `${stats.scholarships.published} published`;
    document.getElementById('stat-scholarships-draft').textContent = `${stats.scholarships.draft} drafts`;

    document.getElementById('stat-leads-total').textContent = stats.leads.total;
    document.getElementById('stat-leads-new').textContent = `${stats.leads.new} new submissions`;

    const needsReviewTotal = (stats.countries.needs_review || 0) + (stats.scholarships.needs_review || 0);
    document.getElementById('stat-review-total').textContent = needsReviewTotal;

    // Sidebar badges
    document.getElementById('nav-count-countries').textContent = stats.countries.total;
    document.getElementById('nav-count-scholarships').textContent = stats.scholarships.total;
    document.getElementById('nav-count-leads').textContent = stats.leads.total;

    // Database pill
    const pillText = document.getElementById('db-status-text');
    const pillDot = document.querySelector('#db-status-pill .status-dot');
    if (stats.isSupabaseConnected) {
      pillText.textContent = 'Supabase Connected';
      pillDot.className = 'status-dot green';
    } else {
      pillText.textContent = 'Local DB Store (Ready)';
      pillDot.className = 'status-dot green';
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function checkSystemConfig() {
  try {
    const cfg = await api('/api/config');
    state.config = cfg;

    const supaStatus = document.getElementById('cfg-supabase-status');
    const supaBadge = document.getElementById('cfg-supabase-badge');
    if (cfg.isSupabaseConfigured) {
      supaStatus.textContent = `Connected to Supabase (${cfg.supabaseUrl})`;
      supaBadge.textContent = 'LIVE';
      supaBadge.className = 'badge badge-success';
    } else {
      supaStatus.textContent = 'Operating with high-fidelity local persistent store (supabase/seed.json)';
      supaBadge.textContent = 'STANDALONE';
      supaBadge.className = 'badge badge-info';
    }

    const aiStatus = document.getElementById('cfg-ai-status');
    const aiBadge = document.getElementById('cfg-ai-badge');
    if (cfg.hasAiConfigured) {
      aiStatus.textContent = 'Cloud AI Provider (Gemini / OpenAI API) configured with multilingual synthesis';
      aiBadge.textContent = 'CLOUD AI';
      aiBadge.className = 'badge badge-success';
    } else {
      aiStatus.textContent = 'Smart heuristic rule-based translation & schema extraction engine (Offline Ready)';
      aiBadge.textContent = 'HEURISTIC';
      aiBadge.className = 'badge badge-warning';
    }
  } catch (err) {
    console.warn('Config check failed:', err);
  }
}

// ==============================================================================
// 4. AI CONTENT INGESTION PIPELINE
// ==============================================================================

async function runAiProcessing() {
  const activeModeBtn = document.querySelector('.ai-tab-btn.active');
  const mode = activeModeBtn ? activeModeBtn.dataset.inputMode : 'file';
  const contentType = document.querySelector('input[name="ai-content-type"]:checked').value;

  const statusBox = document.getElementById('ai-processing-status');
  const errorBox = document.getElementById('ai-error-box');
  const runBtn = document.getElementById('btn-run-ai');

  errorBox.style.display = 'none';
  statusBox.style.display = 'flex';
  runBtn.disabled = true;

  try {
    let result;

    if (mode === 'file') {
      if (!state.selectedAiFile) {
        throw new Error('Please select or drop a PDF, Word DOCX, or TXT document.');
      }
      const formData = new FormData();
      formData.append('file', state.selectedAiFile);
      formData.append('contentType', contentType);

      result = await api('/api/ai/upload', {
        method: 'POST',
        body: formData
      });
    } else if (mode === 'url') {
      const url = document.getElementById('ai-url-input').value.trim();
      if (!url) throw new Error('Please enter a valid website URL.');

      result = await api('/api/ai/upload', {
        method: 'POST',
        body: JSON.stringify({ url, contentType })
      });
    } else if (mode === 'text') {
      const text = document.getElementById('ai-text-input').value.trim();
      if (!text || text.length < 20) throw new Error('Please paste sufficient text content for analysis.');

      result = await api('/api/ai/upload', {
        method: 'POST',
        body: JSON.stringify({ text, contentType })
      });
    }

    showToast('AI analysis & 4-language translation completed!', 'success');

    // Prepare item for review
    state.currentReviewItem = {
      type: result.contentType,
      data: result.data,
      original: JSON.parse(JSON.stringify(result.data)),
      missingFields: result.missingFields || [],
      sourceMetadata: result.sourceMetadata || {},
      status: 'draft',
      isNew: true
    };

    // Switch to Review & Publishing screen
    loadReviewScreen();
    switchTab('review-publish');

  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.style.display = 'block';
  } finally {
    statusBox.style.display = 'none';
    runBtn.disabled = false;
  }
}

// ==============================================================================
// 5. CONTENT REVIEW & PUBLISHING WORKFLOW
// ==============================================================================

function loadReviewScreen() {
  const item = state.currentReviewItem;
  if (!item) return;

  document.getElementById('review-title').textContent = 
    `Review: ${item.type === 'country' ? (item.data.name?.[0] || item.data.id) : (item.data.name || item.data.id)}`;

  const typeBadge = document.getElementById('review-type-badge');
  typeBadge.textContent = item.type.toUpperCase();
  typeBadge.className = 'badge ' + (item.type === 'country' ? 'badge-info' : 'badge-primary');

  const statusBadge = document.getElementById('review-status-badge');
  statusBadge.textContent = (item.status || 'draft').toUpperCase().replace('_', ' ');
  statusBadge.className = 'badge ' + getStatusBadgeClass(item.status || 'draft');

  const sourceInfo = document.getElementById('review-source-info');
  const src = item.sourceMetadata?.filename || item.sourceMetadata?.sourceUrl || 'Manual Entry';
  sourceInfo.textContent = `Source: ${src}`;

  // Warnings Box
  const warnBox = document.getElementById('review-warnings-box');
  const warnList = document.getElementById('review-warnings-list');
  warnList.innerHTML = '';

  if (item.missingFields && item.missingFields.length > 0) {
    warnBox.style.display = 'flex';
    item.missingFields.forEach(f => {
      const li = document.createElement('li');
      li.textContent = `Field "${f.replace('_', ' ')}" could not be verified from the source. Please check and complete.`;
      warnList.appendChild(li);
    });
  } else {
    warnBox.style.display = 'none';
  }

  renderReviewFields();
}

function renderReviewFields() {
  const item = state.currentReviewItem;
  if (!item) return;

  const container = document.getElementById('review-editor-content');
  const langIdx = state.activeLangIdx;
  const showSide = state.showSideBySide && langIdx !== 0;

  if (item.type === 'country') {
    renderCountryReviewFields(container, item.data, langIdx, showSide);
  } else {
    renderScholarshipReviewFields(container, item.data, langIdx, showSide);
  }
}

/**
 * Render fields for Country review
 */
function renderCountryReviewFields(container, d, langIdx, showSide) {
  let html = `
    <div class="form-grid-3 mb-24">
      <div class="form-group">
        <label>Unique Slug ID</label>
        <input type="text" id="rf-id" value="${esc(d.id || '')}">
      </div>
      <div class="form-group">
        <label>Two-Letter Flag Code</label>
        <input type="text" id="rf-f" value="${esc(d.f || '')}" maxlength="4" placeholder="e.g. de, pl, us">
      </div>
      <div class="form-group">
        <label>Region</label>
        <select id="rf-reg">
          <option value="eu" ${d.reg === 'eu' ? 'selected' : ''}>Europe (eu)</option>
          <option value="am" ${d.reg === 'am' ? 'selected' : ''}>Americas (am)</option>
          <option value="as" ${d.reg === 'as' ? 'selected' : ''}>Asia (as)</option>
          <option value="me" ${d.reg === 'me' ? 'selected' : ''}>Middle East (me)</option>
        </select>
      </div>
    </div>
  `;

  // Multilingual: Country Name
  html += renderMultiLangField({
    field: 'name',
    label: 'Country Name',
    currentVal: d.name?.[langIdx] || '',
    enVal: d.name?.[0] || '',
    showSide,
    langIdx
  });

  // Multilingual: Short Tagline
  html += renderMultiLangField({
    field: 'tag',
    label: 'Compelling Tagline',
    currentVal: d.tag?.[langIdx] || '',
    enVal: d.tag?.[0] || '',
    showSide,
    langIdx
  });

  // Multilingual: Full Guide Description
  html += renderMultiLangField({
    field: 'desc',
    label: 'Destination Overview & Guide',
    currentVal: d.desc?.[langIdx] || '',
    enVal: d.desc?.[0] || '',
    isTextarea: true,
    showSide,
    langIdx
  });

  // Facts Grid (Tuition, Living, English, Work)
  html += `
    <div class="form-grid-2 mb-24">
      <div class="form-group">
        <label>Tuition Fees</label>
        <input type="text" id="rf-tu" value="${esc(d.tu || '')}" placeholder="e.g. €2,000–5,000/yr">
      </div>
      <div class="form-group">
        <label>Estimated Living Cost</label>
        <input type="text" id="rf-li" value="${esc(d.li || '')}" placeholder="e.g. €600–900/mo">
      </div>
      <div class="form-group">
        <label>English Requirement</label>
        <input type="text" id="rf-en" value="${esc(typeof d.en === 'string' ? d.en : (d.en?.[langIdx] || d.en?.[0] || ''))}">
      </div>
      <div class="form-group">
        <label>Visa Processing Time</label>
        <input type="text" id="rf-facts-pr" value="${esc(d.facts?.pr || '4–8 weeks')}">
      </div>
    </div>
  `;

  // Multilingual: Work Rights
  html += renderMultiLangField({
    field: 'wk',
    label: 'Work Rights Summary',
    currentVal: d.wk?.[langIdx] || '',
    enVal: d.wk?.[0] || '',
    showSide,
    langIdx
  });

  // Multilingual: Post-Study Work
  html += renderMultiLangField({
    field: 'work',
    label: 'Post-Graduation Work Rights',
    currentVal: d.work?.[langIdx] || '',
    enVal: d.work?.[0] || '',
    isTextarea: true,
    showSide,
    langIdx
  });

  // Top Universities & Popular Fields
  html += `
    <div class="form-grid-2 mb-24">
      <div class="form-group">
        <label>Top Universities (comma-separated)</label>
        <input type="text" id="rf-unis" value="${esc((d.unis || []).join(', '))}">
      </div>
      <div class="form-group">
        <label>Popular Study Fields (comma-separated)</label>
        <input type="text" id="rf-fields" value="${esc((d.fields || []).join(', '))}">
      </div>
    </div>
  `;

  // Student Visa & Steps
  html += `
    <div class="form-group mb-24">
      <label>Visa Requirement Summary</label>
      <input type="text" id="rf-visa" value="${esc(d.visa || '')}">
    </div>
    <div class="form-group mb-24">
      <label>Application Steps (one per line)</label>
      <textarea id="rf-steps" rows="3">${esc((d.steps || []).join('\n'))}</textarea>
    </div>
  `;

  container.innerHTML = html;
  wireFieldListeners();
}

/**
 * Render fields for Scholarship review
 */
function renderScholarshipReviewFields(container, d, langIdx, showSide) {
  let html = `
    <div class="form-grid-3 mb-24">
      <div class="form-group">
        <label>Scholarship ID / Slug</label>
        <input type="text" id="rf-id" value="${esc(d.id || '')}">
      </div>
      <div class="form-group">
        <label>Scholarship Official Name</label>
        <input type="text" id="rf-name" value="${esc(d.name || '')}">
      </div>
      <div class="form-group">
        <label>Short Code</label>
        <input type="text" id="rf-code" value="${esc(d.code || '')}" placeholder="e.g. DAAD, CHEV">
      </div>
    </div>

    <div class="form-grid-3 mb-24">
      <div class="form-group">
        <label>Funding Coverage</label>
        <select id="rf-cov">
          <option value="full" ${d.cov === 'full' ? 'selected' : ''}>Full Funding (Full Tuition + Stipend)</option>
          <option value="part" ${d.cov === 'part' ? 'selected' : ''}>Partial Funding</option>
        </select>
      </div>
      <div class="form-group">
        <label>Education Levels (comma-separated: ba, ma, phd)</label>
        <input type="text" id="rf-lv" value="${esc((d.lv || []).join(', '))}">
      </div>
      <div class="form-group">
        <label>Destination Flags (e.g. de, uk, eu)</label>
        <input type="text" id="rf-fl" value="${esc((d.fl || []).join(', '))}">
      </div>
    </div>
  `;

  // Multilingual: Coverage Details
  html += renderMultiLangField({
    field: 'covers',
    label: 'Funding Coverage Details',
    currentVal: d.covers?.[langIdx] || '',
    enVal: d.covers?.[0] || '',
    showSide,
    langIdx
  });

  // Multilingual: Application Window
  html += renderMultiLangField({
    field: 'win',
    label: 'Application Window / Deadlines',
    currentVal: d.win?.[langIdx] || '',
    enVal: d.win?.[0] || '',
    showSide,
    langIdx
  });

  // Multilingual: Eligibility (Who can apply)
  html += renderMultiLangField({
    field: 'who-0',
    label: 'Primary Eligibility Requirement',
    currentVal: d.who?.[0]?.[langIdx] || (Array.isArray(d.who?.[0]) ? d.who[0][langIdx] : d.who?.[langIdx] || ''),
    enVal: d.who?.[0]?.[0] || (Array.isArray(d.who?.[0]) ? d.who[0][0] : d.who?.[0] || ''),
    showSide,
    langIdx
  });

  // Multilingual: Strategic Advisor Note
  html += renderMultiLangField({
    field: 'note',
    label: 'Advisor Tip / Selection Insight',
    currentVal: d.note?.[langIdx] || '',
    enVal: d.note?.[0] || '',
    isTextarea: true,
    showSide,
    langIdx
  });

  // Official URL
  html += `
    <div class="form-group mb-24">
      <label>Official Application URL</label>
      <input type="url" id="rf-url" value="${esc(d.url || '')}" placeholder="https://...">
    </div>
  `;

  container.innerHTML = html;
  wireFieldListeners();
}

/**
 * Helper to render multilingual field block with side-by-side comparison and per-field regeneration
 */
function renderMultiLangField({ field, label, currentVal, enVal, isTextarea = false, showSide, langIdx }) {
  const langTag = LANG_NAMES[langIdx];
  const regenBtn = langIdx !== 0 ? `
    <button type="button" class="btn-regen" data-regen-field="${field}" data-regen-lang="${['en','am','om','ti'][langIdx]}">
      🔄 Regenerate in ${langTag.split(' ')[0]}
    </button>
  ` : '';

  if (showSide) {
    return `
      <div class="field-review-block">
        <div class="field-header">
          <span class="field-title">${label}</span>
          <div class="field-actions">${regenBtn}</div>
        </div>
        <div class="side-by-side-grid">
          <div class="original-source-box">
            <span class="original-label"> English Source</span>
            <div>${esc(enVal)}</div>
          </div>
          <div>
            <span class="original-label"> ${langTag}</span>
            ${isTextarea 
              ? `<textarea class="rf-multi" data-field="${field}" data-lang-idx="${langIdx}" rows="3">${esc(currentVal)}</textarea>`
              : `<input type="text" class="rf-multi" data-field="${field}" data-lang-idx="${langIdx}" value="${esc(currentVal)}">`
            }
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="field-review-block">
      <div class="field-header">
        <span class="field-title">${label} (${langTag})</span>
        <div class="field-actions">${regenBtn}</div>
      </div>
      ${isTextarea 
        ? `<textarea class="rf-multi" data-field="${field}" data-lang-idx="${langIdx}" rows="3">${esc(currentVal)}</textarea>`
        : `<input type="text" class="rf-multi" data-field="${field}" data-lang-idx="${langIdx}" value="${esc(currentVal)}">`
      }
    </div>
  `;
}

function wireFieldListeners() {
  const item = state.currentReviewItem;
  if (!item) return;

  // Listen to multilingual field input changes
  document.querySelectorAll('.rf-multi').forEach(el => {
    el.addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      const langIdx = parseInt(e.target.dataset.langIdx, 10);
      const val = e.target.value;

      if (field.startsWith('who-')) {
        const whoIdx = parseInt(field.split('-')[1], 10);
        if (!item.data.who) item.data.who = [];
        if (!item.data.who[whoIdx]) item.data.who[whoIdx] = ['', '', '', ''];
        item.data.who[whoIdx][langIdx] = val;
      } else {
        if (!item.data[field]) item.data[field] = ['', '', '', ''];
        item.data[field][langIdx] = val;
      }
    });
  });

  // Listen to regenerate translation button clicks
  document.querySelectorAll('.btn-regen').forEach(btn => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.regenField;
      const lang = btn.dataset.regenLang;
      btn.disabled = true;
      btn.textContent = '⏳ Translating...';

      try {
        let textEn = '';
        if (field.startsWith('who-')) {
          const whoIdx = parseInt(field.split('-')[1], 10);
          textEn = item.data.who?.[whoIdx]?.[0] || '';
        } else {
          textEn = item.data[field]?.[0] || '';
        }

        const res = await api('/api/ai/regenerate-translation', {
          method: 'POST',
          body: JSON.stringify({
            field,
            lang,
            textEn,
            context: `${item.type}: ${item.data.name?.[0] || item.data.name}`
          })
        });

        const langIdx = ['en', 'am', 'om', 'ti'].indexOf(lang);
        if (field.startsWith('who-')) {
          const whoIdx = parseInt(field.split('-')[1], 10);
          item.data.who[whoIdx][langIdx] = res.translation;
        } else {
          item.data[field][langIdx] = res.translation;
        }

        renderReviewFields();
        showToast(`Translation updated for ${lang.toUpperCase()}`, 'success');
      } catch (err) {
        showToast('Translation error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function syncReviewFormData() {
  const item = state.currentReviewItem;
  if (!item) return;

  const d = item.data;
  d.id = (document.getElementById('rf-id')?.value || d.id || '').trim().toLowerCase();

  if (item.type === 'country') {
    d.f = (document.getElementById('rf-f')?.value || d.f || 'eu').trim().toLowerCase();
    d.reg = document.getElementById('rf-reg')?.value || d.reg || 'eu';
    d.tu = document.getElementById('rf-tu')?.value || d.tu || '';
    d.li = document.getElementById('rf-li')?.value || d.li || '';
    d.en = document.getElementById('rf-en')?.value || d.en || '';
    d.visa = document.getElementById('rf-visa')?.value || d.visa || '';

    const unisStr = document.getElementById('rf-unis')?.value || '';
    d.unis = unisStr.split(',').map(s => s.trim()).filter(Boolean);

    const fieldsStr = document.getElementById('rf-fields')?.value || '';
    d.fields = fieldsStr.split(',').map(s => s.trim()).filter(Boolean);

    const stepsStr = document.getElementById('rf-steps')?.value || '';
    d.steps = stepsStr.split('\n').map(s => s.trim()).filter(Boolean);

    if (!d.facts) d.facts = {};
    d.facts.pr = document.getElementById('rf-facts-pr')?.value || d.facts.pr || '4–8 weeks';
    d.facts.tu = d.tu;
    d.facts.li = d.li;
    d.facts.in = d.facts.in || 'September · February';
    d.facts.la = d.facts.la || 'English';

    if (!d.min) d.min = { ielts: 6.0, budget: 8000 };
    if (!d.geo) d.geo = [10.0, 50.0];
    if (!d.code) d.code = d.id.slice(0, 3).toUpperCase();
  } else {
    d.name = document.getElementById('rf-name')?.value || d.name || '';
    d.code = (document.getElementById('rf-code')?.value || d.code || 'MULTI').trim().toUpperCase();
    d.cov = document.getElementById('rf-cov')?.value || d.cov || 'full';
    d.url = document.getElementById('rf-url')?.value || d.url || '';

    const lvStr = document.getElementById('rf-lv')?.value || '';
    d.lv = lvStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const flStr = document.getElementById('rf-fl')?.value || '';
    d.fl = flStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
}

async function saveCurrentReview(newStatus) {
  const item = state.currentReviewItem;
  if (!item) return;

  syncReviewFormData();

  if (!item.data.id) {
    showToast('Please provide a unique slug ID', 'error');
    return;
  }

  try {
    const endpoint = item.type === 'country' ? '/api/countries' : '/api/scholarships';
    const payload = {
      data: item.data,
      status: newStatus,
      featured: item.data.featured || false,
      source_url: item.sourceMetadata?.sourceUrl || '',
      source_metadata: item.sourceMetadata || {}
    };

    if (item.isNew) {
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    } else {
      await api(`${endpoint}/${item.data.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    }

    item.status = newStatus;
    item.isNew = false;
    document.getElementById('review-status-badge').textContent = newStatus.toUpperCase().replace('_', ' ');
    document.getElementById('review-status-badge').className = 'badge ' + getStatusBadgeClass(newStatus);

    const statusLabels = {
      'draft': 'Saved as draft (hidden from public)',
      'needs_review': 'Marked as needing review',
      'published': '🎉 Approved and published LIVE on public website!',
      'archived': 'Archived (hidden from public)'
    };

    showToast(statusLabels[newStatus] || 'Saved successfully', 'success');
    loadDashboard();
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

function startNewItem(type) {
  if (type === 'country') {
    state.currentReviewItem = {
      type: 'country',
      data: {
        id: '',
        f: 'eu',
        reg: 'eu',
        code: 'NEW',
        name: ['', '', '', ''],
        tag: ['', '', '', ''],
        tu: '€3,000–6,000/yr',
        li: '€600–900/mo',
        en: 'IELTS 6.0',
        wk: ['20 hrs/week during term', 'በሳምንት 20 ሰዓት', 'Torbanitti sa\'a 20', 'ኣብ ሰሙን 20 ሰዓት'],
        desc: ['', '', '', ''],
        facts: { tu: '€3,000–6,000/yr', li: '€600–900/mo', in: 'September', pr: '4–8 weeks', la: 'English' },
        fields: ['Computer Science', 'Business', 'Engineering'],
        unis: [],
        visa: 'Student Visa',
        steps: ['Apply for Admission', 'Receive Offer', 'Deposit Tuition', 'Book Embassy Interview'],
        work: ['', '', '', ''],
        sch: [],
        tips: [['Apply early', 'ቀድመው ያመልክቱ', 'Dafanii iyyadhaa', 'ቀልጢፍኩም ኣመልክቱ']],
        min: { ielts: 6.0, budget: 8000 },
        geo: [10.0, 50.0]
      },
      missingFields: [],
      sourceMetadata: { filename: 'Manual Country Creation' },
      status: 'draft',
      isNew: true
    };
  } else {
    state.currentReviewItem = {
      type: 'scholarship',
      data: {
        id: '',
        name: '',
        fl: ['eu'],
        code: 'SCH',
        lv: ['ma'],
        cov: 'full',
        mo: [10, 11, 12, 1],
        inc: ['tuition', 'stipend'],
        covers: ['', '', '', ''],
        win: ['', '', '', ''],
        who: [['', '', '', '']],
        note: ['', '', '', ''],
        url: ''
      },
      missingFields: [],
      sourceMetadata: { filename: 'Manual Scholarship Creation' },
      status: 'draft',
      isNew: true
    };
  }

  loadReviewScreen();
  switchTab('review-publish');
}

// ==============================================================================
// 6. COUNTRIES MANAGEMENT
// ==============================================================================

async function loadCountries() {
  try {
    const list = await api('/api/countries');
    state.countries = list;
    renderCountriesTable();
  } catch (err) {
    showToast('Failed to load countries: ' + err.message, 'error');
  }
}

function renderCountriesTable() {
  const tbody = document.getElementById('countries-table-body');
  const q = (document.getElementById('countries-search').value || '').toLowerCase();
  const status = document.getElementById('countries-filter-status').value;
  const region = document.getElementById('countries-filter-region').value;

  let list = state.countries.filter(c => {
    if (status !== 'all' && c.status !== status) return false;
    if (region !== 'all' && c.data?.reg !== region) return false;
    if (q) {
      const name = Array.isArray(c.data?.name) ? c.data.name.join(' ') : (c.data?.name || '');
      return c.id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    }
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 32px; color: var(--text-muted);">No countries found matching your criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const flag = FLAGS[c.data?.f] || '🌍';
    const name = Array.isArray(c.data?.name) ? c.data.name[0] : (c.data?.name || c.id);
    const reg = { eu: 'Europe', am: 'Americas', as: 'Asia', me: 'Middle East' }[c.data?.reg] || c.data?.reg || 'Global';
    const isPub = c.status === 'published';

    return `
      <tr>
        <td class="cell-flag">${flag}</td>
        <td><strong>${esc(name)}</strong></td>
        <td><code>${esc(c.id)}</code></td>
        <td><span class="badge badge-subtle">${reg}</span></td>
        <td>${esc(c.data?.tu || 'N/A')}</td>
        <td>${esc(c.data?.li || 'N/A')}</td>
        <td><span class="badge ${getStatusBadgeClass(c.status)}">${c.status.replace('_', ' ')}</span></td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-secondary" onclick="editCountry('${esc(c.id)}')">Edit</button>
            <button class="btn btn-sm ${isPub ? 'btn-outline' : 'btn-primary'}" onclick="toggleCountryStatus('${esc(c.id)}', '${isPub ? 'draft' : 'published'}')">
              ${isPub ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.editCountry = function(id) {
  const country = state.countries.find(c => c.id === id);
  if (!country) return;

  state.currentReviewItem = {
    type: 'country',
    data: JSON.parse(JSON.stringify(country.data)),
    original: JSON.parse(JSON.stringify(country.data)),
    missingFields: [],
    sourceMetadata: country.source_metadata || { filename: 'Database Record' },
    status: country.status,
    isNew: false
  };

  loadReviewScreen();
  switchTab('review-publish');
};

window.toggleCountryStatus = async function(id, newStatus) {
  try {
    await api(`/api/countries/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    showToast(`Country status set to ${newStatus}`, 'success');
    loadCountries();
    loadDashboard();
  } catch (err) {
    showToast('Failed to update status: ' + err.message, 'error');
  }
};

// ==============================================================================
// 7. SCHOLARSHIPS MANAGEMENT
// ==============================================================================

async function loadScholarships() {
  try {
    const list = await api('/api/scholarships');
    state.scholarships = list;
    renderScholarshipsTable();
  } catch (err) {
    showToast('Failed to load scholarships: ' + err.message, 'error');
  }
}

function renderScholarshipsTable() {
  const tbody = document.getElementById('scholarships-table-body');
  const q = (document.getElementById('scholarships-search').value || '').toLowerCase();
  const status = document.getElementById('scholarships-filter-status').value;
  const level = document.getElementById('scholarships-filter-level').value;
  const coverage = document.getElementById('scholarships-filter-coverage').value;

  let list = state.scholarships.filter(s => {
    if (status !== 'all' && s.status !== status) return false;
    if (coverage !== 'all' && s.data?.cov !== coverage) return false;
    if (level !== 'all' && Array.isArray(s.data?.lv) && !s.data.lv.includes(level)) return false;
    if (q) {
      const name = s.data?.name || s.id;
      return s.id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    }
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 32px; color: var(--text-muted);">No scholarships found matching your criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const name = s.data?.name || s.id;
    const flags = (s.data?.fl || []).map(f => FLAGS[f] || f).join(' ') || '🌐';
    const cov = s.data?.cov === 'full' ? 'Full Funding' : 'Partial Funding';
    const lvs = (s.data?.lv || []).map(l => l.toUpperCase()).join(', ');
    const win = s.data?.win?.[0] || 'Varies';
    const isPub = s.status === 'published';

    return `
      <tr>
        <td><strong>${esc(name)}</strong></td>
        <td><code>${esc(s.data?.code || s.id)}</code></td>
        <td>${flags}</td>
        <td><span class="badge ${s.data?.cov === 'full' ? 'badge-success' : 'badge-warning'}">${cov}</span></td>
        <td>${lvs}</td>
        <td>${esc(win)}</td>
        <td><span class="badge ${getStatusBadgeClass(s.status)}">${s.status.replace('_', ' ')}</span></td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-secondary" onclick="editScholarship('${esc(s.id)}')">Edit</button>
            <button class="btn btn-sm ${isPub ? 'btn-outline' : 'btn-primary'}" onclick="toggleScholarshipStatus('${esc(s.id)}', '${isPub ? 'draft' : 'published'}')">
              ${isPub ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.editScholarship = function(id) {
  const sch = state.scholarships.find(s => s.id === id);
  if (!sch) return;

  state.currentReviewItem = {
    type: 'scholarship',
    data: JSON.parse(JSON.stringify(sch.data)),
    original: JSON.parse(JSON.stringify(sch.data)),
    missingFields: [],
    sourceMetadata: sch.source_metadata || { filename: 'Database Record' },
    status: sch.status,
    isNew: false
  };

  loadReviewScreen();
  switchTab('review-publish');
};

window.toggleScholarshipStatus = async function(id, newStatus) {
  try {
    await api(`/api/scholarships/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    showToast(`Scholarship status set to ${newStatus}`, 'success');
    loadScholarships();
    loadDashboard();
  } catch (err) {
    showToast('Failed to update status: ' + err.message, 'error');
  }
};

// ==============================================================================
// 8. STUDENT LEADS
// ==============================================================================

async function loadLeads() {
  try {
    const list = await api('/api/leads');
    state.leads = list;
    renderLeadsTable();
  } catch (err) {
    showToast('Failed to load leads: ' + err.message, 'error');
  }
}

function renderLeadsTable() {
  const tbody = document.getElementById('leads-table-body');
  const q = (document.getElementById('leads-search').value || '').toLowerCase();

  let list = state.leads.filter(l => {
    if (q) {
      return (l.name && l.name.toLowerCase().includes(q)) ||
             (l.phone && l.phone.toLowerCase().includes(q)) ||
             (l.email && l.email.toLowerCase().includes(q));
    }
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 32px; color: var(--text-muted);">No student leads recorded yet. Submissions from the website checker will appear here in real-time.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(l => {
    const date = new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const ctrys = (l.countries || []).map(f => FLAGS[f] || f).join(' ') || 'Not specified';
    const contact = l.phone || l.email || 'N/A';
    const crmChip = l.crm_case_id 
      ? `<span class="badge badge-success" style="font-family:monospace;font-size:11px;letter-spacing:.5px;">${esc(l.crm_case_id)}</span>` 
      : `<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 6px;" onclick="syncLeadToCrm('${esc(l.id)}')">Sync to CRM</button>`;

    return `
      <tr>
        <td>${date}</td>
        <td><strong>${esc(l.name || 'Anonymous Student')}</strong></td>
        <td>${esc(contact)} <span class="badge badge-subtle">${esc(l.pref || 'phone')}</span></td>
        <td>${esc(l.level || 'Undergrad')} / ${esc(l.field || 'General')}</td>
        <td>${ctrys}</td>
        <td>${crmChip}</td>
        <td>${esc(l.source || 'website')}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="viewLeadDetails('${esc(l.id)}')">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Label maps for lead fields
const LEVEL_LABELS = {
  'primary': 'Primary School', 'secondary': 'Secondary School',
  'diploma': 'Diploma / Certificate', 'ba': "Bachelor's Degree",
  'bachelors': "Bachelor's Degree", 'bachelor': "Bachelor's Degree",
  'ma': "Master's Degree", 'masters': "Master's Degree", 'master': "Master's Degree",
  'phd': 'PhD / Doctorate', 'doctorate': 'PhD / Doctorate',
  'undergrad': 'Undergraduate', 'postgrad': 'Postgraduate'
};
const FIELD_LABELS = {
  'it': 'Computer Science / IT', 'cs': 'Computer Science / IT',
  'med': 'Medicine', 'medicine': 'Medicine',
  'eng': 'Engineering', 'engineering': 'Engineering',
  'biz': 'Business', 'business': 'Business / Management',
  'law': 'Law', 'edu': 'Education', 'arts': 'Arts & Humanities',
  'science': 'Natural Sciences', 'social': 'Social Sciences'
};
const INTAKE_LABELS = {
  'soon': 'Within 6 months', 'asap': 'As soon as possible',
  '6months': 'Within 6 months', '1year': 'Within 1 year',
  '2years': 'Within 2 years', 'flexible': 'Flexible / Not sure'
};
const LANG_LABELS = { 'en': 'English', 'am': 'Amharic', 'om': 'Afaan Oromo', 'ti': 'Tigrinya' };
const COUNTRY_DISPLAY = {
  'usa': 'United States', 'uk': 'United Kingdom', 'canada': 'Canada',
  'germany': 'Germany', 'france': 'France', 'australia': 'Australia',
  'netherlands': 'Netherlands', 'sweden': 'Sweden', 'norway': 'Norway',
  'finland': 'Finland', 'denmark': 'Denmark', 'switzerland': 'Switzerland',
  'austria': 'Austria', 'italy': 'Italy', 'spain': 'Spain',
  'china': 'China', 'japan': 'Japan', 'turkey': 'Turkey',
  'hungary': 'Hungary', 'poland': 'Poland', 'czechia': 'Czechia',
  'ireland': 'Ireland', 'newzealand': 'New Zealand'
};

function labelVal(val, map) {
  if (!val) return '—';
  const k = String(val).toLowerCase().replace(/[s_-]+/g, '');
  return map[k] || (String(val).charAt(0).toUpperCase() + String(val).slice(1));
}

function parseSummaryPairs(summary) {
  if (!summary) return [];
  const pairs = [];
  // Match "Label: Value" patterns, label is Title Case words
  const regex = /([A-Z][A-Za-z &\/]+?):s*(.+?)(?=s{2,}[A-Z][A-Za-z &\/]+?:|[·•]|$)/g;
  // Also try splitting on common delimiters
  const cleaned = summary.replace(/[·•]/g, '  ');
  let m;
  while ((m = regex.exec(cleaned)) !== null) {
    const key = m[1].trim();
    const val = m[2].trim().replace(/s*[·•]s*$/, '');
    if (key && val && key.length < 50 && !pairs.find(p => p[0] === key)) {
      pairs.push([key, val]);
    }
  }
  return pairs;
}

window.viewLeadDetails = function(leadId) {
  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  const modal = document.getElementById('lead-modal');
  const content = document.getElementById('lead-modal-content');

  const countryTags = (lead.countries || [])
    .map(c => {
      const display = COUNTRY_DISPLAY[c.toLowerCase()] || (c.charAt(0).toUpperCase() + c.slice(1));
      return `<span style="display:inline-block;background:var(--bg-muted);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:12px;margin:2px;">${esc(display)}</span>`;
    }).join('') || '<span style="color:var(--text-muted);">—</span>';

  const prefColor = (lead.pref === 'email') ? '#3B82F6' : '#9A288D';

  const summaryPairs = parseSummaryPairs(lead.summary || '');
  const answers = lead.answers || {};
  const answerKeys = Object.keys(answers);

  function tableRow(key, val, last) {
    return `<div style="display:grid;grid-template-columns:150px 1fr;border-bottom:${last ? 'none' : '1px solid var(--border)'};">
      <div style="padding:9px 14px;background:var(--bg-muted);font-size:12px;font-weight:600;color:var(--text-muted);border-right:1px solid var(--border);white-space:nowrap;">${esc(key)}</div>
      <div style="padding:9px 14px;font-size:13px;color:var(--text-primary);">${esc(val)}</div>
    </div>`;
  }

  content.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">

      <!-- Contact Card -->
      <div style="background:var(--bg-muted);padding:18px 20px;border-radius:var(--radius-md);border-left:4px solid #9A288D;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:12px;">
          <div>
            <h4 style="margin:0 0 4px 0;font-size:17px;">${esc(lead.name || 'Anonymous Student')}</h4>
            <div style="display:flex;align-items:center;gap:6px;">
              ${lead.crm_case_id 
                ? `<span class="badge badge-success" style="font-family:monospace;font-size:11px;">CRM Case: ${esc(lead.crm_case_id)}</span>`
                : `<span class="badge badge-subtle" style="font-size:11px;">Not in CRM</span>`}
              <button class="btn btn-sm btn-outline" style="font-size:11px;padding:2px 8px;" onclick="syncLeadToCrm('${esc(lead.id)}')">
                ${lead.crm_case_id ? 'Re-sync to CRM' : 'Sync to Yimaru CRM'}
              </button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span style="background:${prefColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">${esc(lead.pref || 'phone')}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Phone</div>
            <div style="font-weight:600;">${esc(lead.phone || '—')}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Email</div>
            <div style="font-weight:600;">${lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:#9A288D;">${esc(lead.email)}</a>` : '—'}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">City</div>
            <div style="font-weight:600;">${esc(lead.city || '—')}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Submitted</div>
            <div style="font-size:12px;color:var(--text-muted);">${new Date(lead.created_at).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <!-- Academic Profile -->
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">Academic Profile &amp; Goals</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Education Level</div>
            <div style="font-weight:600;font-size:13px;">${esc(labelVal(lead.level, LEVEL_LABELS))}</div>
          </div>
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Desired Field</div>
            <div style="font-weight:600;font-size:13px;">${esc(labelVal(lead.field, FIELD_LABELS))}</div>
          </div>
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Target Intake</div>
            <div style="font-weight:600;font-size:13px;">${esc(labelVal(lead.intake, INTAKE_LABELS))}</div>
          </div>
          <div style="background:var(--bg-muted);padding:11px 14px;border-radius:var(--radius-md);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">UI Language</div>
            <div style="font-weight:600;font-size:13px;">${esc(labelVal(lead.language, LANG_LABELS))}</div>
          </div>
        </div>
        <div style="background:var(--bg-muted);padding:12px 14px;border-radius:var(--radius-md);">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Target Countries</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">${countryTags}</div>
        </div>
      </div>

      <!-- Full Assessment Details as structured table -->
      ${summaryPairs.length > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">Full Assessment Details</div>
          <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
            ${summaryPairs.map(([k, v], i) => tableRow(k, v, i === summaryPairs.length - 1)).join('')}
          </div>
        </div>
      ` : lead.summary ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">Assessment Summary</div>
          <div style="background:var(--bg-muted);padding:14px;border-radius:var(--radius-md);font-size:13px;line-height:1.65;color:var(--text-primary);">${esc(lead.summary)}</div>
        </div>
      ` : ''}

      <!-- Raw answers only if no summary available -->
      ${!lead.summary && answerKeys.length > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px;">Questionnaire Answers</div>
          <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
            ${answerKeys.map((k, i) => tableRow(
              k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
              Array.isArray(answers[k]) ? answers[k].join(', ') : String(answers[k]),
              i === answerKeys.length - 1
            )).join('')}
          </div>
        </div>
      ` : ''}

    </div>
  `;

  modal.style.display = 'flex';
};

window.syncLeadToCrm = async function(leadId) {
  try {
    showToast('Syncing lead to Yimaru CRM...', 'info');
    const res = await api(`/api/leads/${encodeURIComponent(leadId)}/sync-crm`, {
      method: 'POST'
    });
    showToast(`✓ Case created in Yimaru CRM: ${res.caseId}`, 'success');

    // Update in-memory state
    const lead = state.leads.find(l => l.id === leadId);
    if (lead) {
      lead.crm_case_id = res.caseId;
    }
    renderLeadsTable();

    // If modal is open for this lead, update modal
    const modal = document.getElementById('lead-modal');
    if (modal && modal.style.display === 'flex') {
      viewLeadDetails(leadId);
    }
  } catch (err) {
    showToast(`Failed to sync to Yimaru CRM: ${err.message}`, 'error');
  }
};

// ==============================================================================
// 9. UTILITIES
// ==============================================================================

function getStatusBadgeClass(status) {
  switch (status) {
    case 'published': return 'badge-success';
    case 'draft': return 'badge-subtle';
    case 'needs_review': return 'badge-warning';
    case 'archived': return 'badge-danger';
    default: return 'badge-subtle';
  }
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : (type === 'error' ? '⚠️' : 'ℹ️')}</span>
    <span>${esc(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

