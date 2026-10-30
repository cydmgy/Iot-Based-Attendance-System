// ============================================================
// BPES Portal - Core Application Router & State Management
// Batasan Paaralang Elementarya ng San
// ============================================================

function getApiBase() {
  // In production the frontend is served by the same Express process,
  // so the API is always on the same origin (no port override needed).
  // Locally the dev server runs on :3000, which is also the correct origin.
  return window.location.origin;
}

const API_BASE = getApiBase();

let activePortal = 'welcome';
let systemConfig = { defaultIotKey: 'BPES-2026' };
let isBackendOnline = false;

let rooms = [];
let subjects = [];
let students = [];
let teachers = [];
let allLogs = [];
let overrideModal = null;

let studentUser = {
  id: '',
  name: 'Student',
  student_id: '',
  rfid: '',
  course: 'Elementary',
  section: 'Diamond',
  year: 1
};

let currentTeacherUser = {
  id: '',
  name: 'Faculty Member',
  email: ''
};

// ── Session State Management ──────────────────────────────────

function getAuthRole() {
  return sessionStorage.getItem('auth_role') || null;
}

function getAuthToken() {
  return sessionStorage.getItem('auth_token') || null;
}

function restoreAuthSession() {
  const token = getAuthToken();
  const role = getAuthRole();
  const savedUserJson = sessionStorage.getItem('auth_user');

  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  if (savedUserJson) {
    try {
      const user = JSON.parse(savedUserJson);
      if (role === 'student') {
        studentUser = { ...studentUser, ...user };
      } else if (role === 'teacher') {
        currentTeacherUser = { ...currentTeacherUser, ...user };
      }
    } catch (e) {
      console.warn('Failed to parse saved auth_user', e);
    }
  }
}

// ── DOM Initialization ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  restoreAuthSession();
  
  // Verify backend connectivity and load initial system collections
  await loadSystemData();

  // Route to the appropriate initial page
  const hash = window.location.hash ? window.location.hash.replace('#', '') : '';
  const initialPage = resolveAuthorizedPage(hash);
  await loadPage(initialPage);
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  const target = hash === 'instructor' ? 'teacher' : hash;
  if (target && target !== activePortal) {
    loadPage(target);
  }
});

function resolveAuthorizedPage(requestedPage) {
  const urlParams = new URLSearchParams(window.location.search);
  const debugRole = urlParams.get('debugRole');
  if (debugRole) {
    sessionStorage.setItem('auth_role', debugRole);
    return requestedPage || debugRole;
  }

  const target = requestedPage === 'instructor' ? 'teacher' : requestedPage;
  const role = getAuthRole();

  // Public pages accessible to anyone
  if (target === 'welcome' || target === 'register') {
    return target;
  }

  // If already authenticated and trying to visit login or root, go to portal
  if (role) {
    if (target === 'student' && role === 'student') return 'student';
    if (target === 'teacher' && role === 'teacher') return 'teacher';
    if (target === 'admin' && role === 'admin') return 'admin';
    if (!target || target === 'login') return role;
  }

  // If requesting specific protected role portal while not logged in
  if (target === 'student' || target === 'teacher' || target === 'admin') {
    return 'login';
  }

  if (target === 'login') return 'login';

  // Default initial landing page for unauthenticated visitors is welcome
  return 'welcome';
}

// ── System Data Loader (Axios) ────────────────────────────────

async function loadSystemData() {
  try {
    const pingRes = await axios.get(`${API_BASE}/api/ping`, { timeout: 3000 }).catch(() => null);
    isBackendOnline = !!(pingRes && pingRes.data && pingRes.data.status === 'online');

    if (!isBackendOnline) {
      console.warn(`[BPES Portal] Backend offline at ${API_BASE}. Run 'node server.js' to connect.`);
      updateBackendStatusUI(false);
      return;
    }

    const [cfgRes, roomsRes, subjRes, stdRes, tchRes] = await Promise.all([
      axios.get(`${API_BASE}/api/config`, { timeout: 4000 }).catch(() => ({ data: {} })),
      axios.get(`${API_BASE}/api/rooms`, { timeout: 4000 }).catch(() => ({ data: { rooms: [] } })),
      axios.get(`${API_BASE}/api/subjects`, { timeout: 4000 }).catch(() => ({ data: { subjects: [] } })),
      axios.get(`${API_BASE}/api/students`, { timeout: 4000 }).catch(() => ({ data: { students: [] } })),
      axios.get(`${API_BASE}/api/teachers`, { timeout: 4000 }).catch(() => ({ data: { teachers: [] } }))
    ]);

    systemConfig = { ...systemConfig, ...cfgRes.data };
    rooms = roomsRes.data.rooms || [];
    subjects = subjRes.data.subjects || [];
    students = stdRes.data.students || [];
    teachers = tchRes.data.teachers || [];

    updateBackendStatusUI(true);

    if (activePortal === 'login') {
      populateLoginStudentPicker();
    }

  } catch (err) {
    console.error('Data initialization error:', err);
    isBackendOnline = false;
    updateBackendStatusUI(false);
  }
}

function updateBackendStatusUI(online) {
  const badge = document.getElementById('backend-status-badge');
  if (!badge) return;

  if (online) {
    badge.className = 'alert alert-success py-2 small d-flex align-items-center justify-content-center gap-2 mb-4';
    badge.style.borderRadius = 'var(--radius-input)';
    badge.style.background = 'var(--color-primary-light)';
    badge.style.color = 'var(--color-primary)';
    badge.style.border = '1px solid var(--color-primary-border)';
    badge.innerHTML = `<i class="fas fa-check-circle"></i> Database &amp; Attendance Node Connected`;
  } else {
    badge.className = 'alert alert-warning py-2 small d-flex flex-column align-items-center justify-content-center gap-1 mb-4 text-center';
    badge.style.borderRadius = 'var(--radius-input)';
    badge.style.background = 'var(--color-amber-bg)';
    badge.style.color = 'var(--color-amber)';
    badge.style.border = '1px solid var(--color-amber-border)';
    badge.innerHTML = `
      <div class="fw-bold"><i class="fas fa-triangle-exclamation me-1"></i> Backend Server Disconnected</div>
      <div class="small" style="color: #666;">Start <code>node server.js</code> to enable live sync and IoT card reads.</div>
      <button class="btn btn-sm btn-dark mt-1 py-1 px-3 fw-bold" style="font-size: 0.75rem" onclick="retryBackendConnection()">
        <i class="fas fa-rotate me-1"></i> Retry Connection
      </button>
    `;
  }
}

async function retryBackendConnection() {
  const badge = document.getElementById('backend-status-badge');
  if (badge) {
    badge.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Checking ${escapeHtml(API_BASE)}...`;
  }
  await loadSystemData();
}

function populateLoginStudentPicker() {
  const pickerWrapper = document.getElementById('student-picker-wrapper');
  const picker = document.getElementById('login-student-picker');
  if (picker && students.length > 0) {
    picker.innerHTML = '<option value="">-- Choose enrolled student to auto-fill --</option>' +
      students.map(s => `<option value="${s.id}">${s.full_name} (LRN: ${s.student_id})</option>`).join('');
    if (pickerWrapper) pickerWrapper.classList.remove('d-none');
  }
}

function onSelectStudentProfile(studentId) {
  if (!studentId) return;
  const matched = students.find(s => s.id === studentId);
  if (matched) {
    const lrnInput = document.getElementById('student-login-lrn');
    const pinInput = document.getElementById('student-login-pin');
    if (lrnInput) lrnInput.value = matched.student_id;
    if (pinInput) {
      const defaultPin = matched.student_id && matched.student_id.length >= 4 
        ? matched.student_id.slice(-4) 
        : matched.student_id;
      pinInput.value = defaultPin;
    }
  }
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = isPass ? 'fas fa-eye-slash' : 'fas fa-eye';
  }
}

// ── Unified Authentication Handlers (Figma Screen 1 & 5) ──────────────

async function handleUnifiedLogin(e) {
  e.preventDefault();
  const alertEl = document.getElementById('login-alert');
  const btn = document.getElementById('btn-submit-login');
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');

  const username = (userInput?.value || '').trim();
  const password = (passInput?.value || '').trim();

  if (alertEl) alertEl.innerHTML = '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Logging In...';
  }

  try {
    // 1. If username is admin
    if (username.toLowerCase() === 'admin') {
      const res = await axios.post(`${API_BASE}/api/auth/admin`, { username, password });
      if (res.data.success) {
        sessionStorage.setItem('auth_role', 'admin');
        sessionStorage.setItem('auth_token', res.data.token);
        sessionStorage.setItem('auth_user', JSON.stringify(res.data.user || { role: 'admin' }));
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        await loadPage('admin');
        return;
      }
    }

    // 2. If username contains '@', try teacher auth first
    if (username.includes('@')) {
      const res = await axios.post(`${API_BASE}/api/auth/teacher`, { email: username, password });
      if (res.data.success) {
        sessionStorage.setItem('auth_role', 'teacher');
        sessionStorage.setItem('auth_token', res.data.token);
        sessionStorage.setItem('auth_user', JSON.stringify(res.data.user));
        currentTeacherUser = { ...currentTeacherUser, ...res.data.user };
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        await loadPage('teacher');
        return;
      }
    }

    // 3. Try student auth by student_id/LRN + PIN/password
    try {
      const stdRes = await axios.post(`${API_BASE}/api/auth/student`, { student_id: username, pin: password });
      if (stdRes.data.success) {
        sessionStorage.setItem('auth_role', 'student');
        sessionStorage.setItem('auth_token', stdRes.data.token);
        sessionStorage.setItem('auth_user', JSON.stringify(stdRes.data.user));
        studentUser = { ...studentUser, ...stdRes.data.user };
        axios.defaults.headers.common['Authorization'] = `Bearer ${stdRes.data.token}`;
        await loadPage('student');
        return;
      }
    } catch (stdErr) {
      // If student lookup failed, attempt teacher lookup with username as email
      try {
        const tchRes = await axios.post(`${API_BASE}/api/auth/teacher`, { email: username, password });
        if (tchRes.data.success) {
          sessionStorage.setItem('auth_role', 'teacher');
          sessionStorage.setItem('auth_token', tchRes.data.token);
          sessionStorage.setItem('auth_user', JSON.stringify(tchRes.data.user));
          currentTeacherUser = { ...currentTeacherUser, ...tchRes.data.user };
          axios.defaults.headers.common['Authorization'] = `Bearer ${tchRes.data.token}`;
          await loadPage('teacher');
          return;
        }
      } catch (tchErr) {
        throw stdErr;
      }
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Invalid username or password';
    if (alertEl) {
      alertEl.innerHTML = `
        <div class="alert alert-danger py-2 small shadow-sm mb-3" style="border-radius: var(--radius-input);">
          <i class="fas fa-circle-exclamation me-1"></i> ${escapeHtml(msg)}
        </div>
      `;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Log In</span>';
    }
  }
}

async function handleUnifiedRegister(e) {
  e.preventDefault();
  const alertEl = document.getElementById('register-alert');
  const btn = document.getElementById('btn-submit-register');
  const username = document.getElementById('reg-username')?.value.trim();
  const fullName = document.getElementById('reg-fullname')?.value.trim() || username;
  const email = document.getElementById('reg-email')?.value.trim();
  const password = document.getElementById('reg-password')?.value.trim();
  const confirmPassword = document.getElementById('reg-confirm-password')?.value.trim();

  if (alertEl) alertEl.innerHTML = '';

  if (password !== confirmPassword) {
    if (alertEl) {
      alertEl.innerHTML = `
        <div class="alert alert-danger py-2 small shadow-sm mb-3" style="border-radius: var(--radius-input);">
          <i class="fas fa-circle-exclamation me-1"></i> Passwords do not match.
        </div>
      `;
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Creating Account...';
  }

  try {
    const res = await axios.post(`${API_BASE}/api/auth/register-student`, {
      student_id: username,
      full_name: fullName,
      email: email || undefined,
      course: 'Elementary',
      year_level: 1,
      section: 'Diamond',
      pin: password
    });

    if (res.data.success) {
      sessionStorage.setItem('auth_role', 'student');
      sessionStorage.setItem('auth_token', res.data.token);
      sessionStorage.setItem('auth_user', JSON.stringify(res.data.user));

      studentUser = { ...studentUser, ...res.data.user };
      axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

      await loadSystemData();
      await loadPage('student');
    } else {
      throw new Error(res.data.error || 'Registration failed');
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Registration error occurred';
    if (alertEl) {
      alertEl.innerHTML = `
        <div class="alert alert-danger py-2 small shadow-sm mb-3" style="border-radius: var(--radius-input);">
          <i class="fas fa-circle-exclamation me-1"></i> ${escapeHtml(msg)}
        </div>
      `;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Create Account</span>';
    }
  }
}

// ── Mobile Drawer Open / Close Helpers ─────────────────────────

function openAdminMobileDrawer() {
  document.getElementById('adminMobileDrawer')?.classList.add('open');
  document.getElementById('adminMobileBackdrop')?.classList.add('show');
}
function closeAdminMobileDrawer() {
  document.getElementById('adminMobileDrawer')?.classList.remove('open');
  document.getElementById('adminMobileBackdrop')?.classList.remove('show');
}

function openTeacherMobileDrawer() {
  document.getElementById('teacherMobileDrawer')?.classList.add('open');
  document.getElementById('teacherMobileBackdrop')?.classList.add('show');
}
function closeTeacherMobileDrawer() {
  document.getElementById('teacherMobileDrawer')?.classList.remove('open');
  document.getElementById('teacherMobileBackdrop')?.classList.remove('show');
}

function openStudentMobileDrawer() {
  document.getElementById('studentMobileDrawer')?.classList.add('open');
  document.getElementById('studentMobileBackdrop')?.classList.add('show');
}
function closeStudentMobileDrawer() {
  document.getElementById('studentMobileDrawer')?.classList.remove('open');
  document.getElementById('studentMobileBackdrop')?.classList.remove('show');
}

async function handleTeacherLogin(e) {
  e.preventDefault();
  const alertEl = document.getElementById('teacher-login-alert');
  const btn = document.getElementById('teacher-login-btn');
  const emailInput = document.getElementById('teacher-login-email');
  const passInput = document.getElementById('teacher-login-password');

  const email = (emailInput?.value || '').trim();
  const password = (passInput?.value || '').trim();

  if (alertEl) alertEl.innerHTML = '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Authenticating...';
  }

  try {
    const res = await axios.post(`${API_BASE}/api/auth/teacher`, { email, password });
    if (res.data.success) {
      sessionStorage.setItem('auth_role', 'teacher');
      sessionStorage.setItem('auth_token', res.data.token);
      sessionStorage.setItem('auth_user', JSON.stringify(res.data.user));

      currentTeacherUser = { ...currentTeacherUser, ...res.data.user };
      axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

      await loadPage('teacher');
    } else {
      throw new Error(res.data.error || 'Authentication failed');
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Login error occurred';
    if (alertEl) {
      alertEl.innerHTML = `
        <div class="alert alert-danger py-2 small shadow-sm mb-3" style="border-radius: var(--radius-input);">
          <i class="fas fa-circle-exclamation me-1"></i> ${escapeHtml(msg)}
        </div>
      `;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In as Teacher</span> <i class="fas fa-arrow-right ms-2"></i>';
    }
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const alertEl = document.getElementById('admin-login-alert');
  const btn = document.getElementById('admin-login-btn');
  const userInput = document.getElementById('admin-login-username');
  const passInput = document.getElementById('admin-login-password');

  const username = (userInput?.value || '').trim();
  const password = (passInput?.value || '').trim();

  if (alertEl) alertEl.innerHTML = '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Authenticating...';
  }

  try {
    const res = await axios.post(`${API_BASE}/api/auth/admin`, { username, password });
    if (res.data.success) {
      sessionStorage.setItem('auth_role', 'admin');
      sessionStorage.setItem('auth_token', res.data.token);
      sessionStorage.setItem('auth_user', JSON.stringify(res.data.user));

      axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

      await loadPage('admin');
    } else {
      throw new Error(res.data.error || 'Authentication failed');
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Login error occurred';
    if (alertEl) {
      alertEl.innerHTML = `
        <div class="alert alert-danger py-2 small shadow-sm mb-3" style="border-radius: var(--radius-input);">
          <i class="fas fa-circle-exclamation me-1"></i> ${escapeHtml(msg)}
        </div>
      `;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In as Administrator</span> <i class="fas fa-arrow-right ms-2"></i>';
    }
  }
}

function logout() {
  sessionStorage.removeItem('auth_role');
  sessionStorage.removeItem('auth_token');
  sessionStorage.removeItem('auth_user');
  delete axios.defaults.headers.common['Authorization'];
  toggleMobileDrawer(false);
  loadPage('welcome');
}

// ── Mobile Drawer Global Controls ─────────────────────────────

function toggleMobileDrawer(open) {
  const drawer = document.getElementById('bpes-global-drawer');
  const backdrop = document.getElementById('bpes-global-drawer-backdrop');
  if (drawer && backdrop) {
    drawer.classList.toggle('active', !!open);
    backdrop.classList.toggle('active', !!open);
  }
}

function openAdminMobileDrawer() {
  const contextLabel = document.getElementById('drawer-context-label');
  const titleLabel = document.getElementById('drawer-title-label');
  const navContainer = document.getElementById('drawer-nav-items');

  if (contextLabel) contextLabel.textContent = 'ADMIN / BPES PORTAL';
  if (titleLabel) titleLabel.textContent = 'Navigation';
  if (navContainer) {
    navContainer.innerHTML = `
      <a href="#" class="bpes-drawer-item active" id="drawer-item-adm-students" onclick="selectAdminDrawerTab('students')">
        <i class="fas fa-users"></i>
        <span>Student Enrollment</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-adm-teachers" onclick="selectAdminDrawerTab('teachers')">
        <i class="fas fa-chalkboard-user"></i>
        <span>Teachers Directory</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-adm-logs" onclick="selectAdminDrawerTab('logs')">
        <i class="fas fa-clock-rotate-left"></i>
        <span>Attendance Stream</span>
      </a>
    `;
  }
  toggleMobileDrawer(true);
}

function selectAdminDrawerTab(tab) {
  toggleMobileDrawer(false);
  if (typeof showAdminTab === 'function') {
    showAdminTab(tab);
  }
}

function openTeacherMobileDrawer() {
  const contextLabel = document.getElementById('drawer-context-label');
  const titleLabel = document.getElementById('drawer-title-label');
  const navContainer = document.getElementById('drawer-nav-items');

  if (contextLabel) contextLabel.textContent = 'TEACHER / BPES PORTAL';
  if (titleLabel) titleLabel.textContent = 'Navigation';
  if (navContainer) {
    navContainer.innerHTML = `
      <a href="#" class="bpes-drawer-item active" id="drawer-item-tch-dashboard" onclick="selectTeacherDrawerTab('dashboard')">
        <i class="fas fa-home"></i>
        <span>Dashboard</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-tch-attendance" onclick="selectTeacherDrawerTab('attendance')">
        <i class="fas fa-check-square"></i>
        <span>Attendance</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-tch-export" onclick="selectTeacherDrawerTab('export')">
        <i class="fas fa-download"></i>
        <span>Export Attendance</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-tch-leave" onclick="selectTeacherDrawerTab('leave')">
        <i class="fas fa-file-text"></i>
        <span>Student Leave Requests</span>
      </a>
    `;
  }
  toggleMobileDrawer(true);
}

function selectTeacherDrawerTab(tab) {
  toggleMobileDrawer(false);
  if (typeof showTeacherTab === 'function') {
    showTeacherTab(tab);
  }
}

function openStudentMobileDrawer() {
  const contextLabel = document.getElementById('drawer-context-label');
  const titleLabel = document.getElementById('drawer-title-label');
  const navContainer = document.getElementById('drawer-nav-items');

  if (contextLabel) contextLabel.textContent = 'STUDENT / BPES PORTAL';
  if (titleLabel) titleLabel.textContent = 'Navigation';
  if (navContainer) {
    navContainer.innerHTML = `
      <a href="#" class="bpes-drawer-item active" id="drawer-item-std-overview" onclick="selectStudentDrawerTab('overview')">
        <i class="fas fa-home"></i>
        <span>Dashboard</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-std-logs" onclick="selectStudentDrawerTab('logs')">
        <i class="fas fa-clock"></i>
        <span>Attendance History</span>
      </a>
      <a href="#" class="bpes-drawer-item" id="drawer-item-std-leave" onclick="selectStudentDrawerTab('leave')">
        <i class="fas fa-file-text"></i>
        <span>File Excuse / Leave</span>
      </a>
      <a href="#" class="bpes-drawer-item" onclick="toggleMobileDrawer(false); openChangePinModal();">
        <i class="fas fa-key"></i>
        <span>Change Security PIN</span>
      </a>
    `;
  }
  toggleMobileDrawer(true);
}

function selectStudentDrawerTab(tab) {
  toggleMobileDrawer(false);
  if (typeof showStudentTab === 'function') {
    showStudentTab(tab);
  }
}

async function ensureAuthTokenForRole(role) {
  // Returns the current session token if one exists.
  // Hardcoded credentials were removed for security — users must log in manually.
  const token = sessionStorage.getItem('auth_token');
  return token || null;
}

// ── Modular Page Router ───────────────────────────────────────

async function loadPage(page) {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  // Cleanup active intervals when changing pages
  if (typeof stopAutoRefreshLogs === 'function') stopAutoRefreshLogs();
  if (typeof stopTeacherAutoRefresh === 'function') stopTeacherAutoRefresh();
  toggleMobileDrawer(false);

  let targetPage = (page === 'instructor') ? 'teacher' : (page || 'welcome');
  const urlParams = new URLSearchParams(window.location.search);
  const debugRole = urlParams.get('debugRole');
  if (debugRole) {
    sessionStorage.setItem('auth_role', debugRole);
    await ensureAuthTokenForRole(debugRole);
  }
  const currentRole = getAuthRole();

  // Route protection
  if (targetPage === 'student' && currentRole !== 'student') {
    targetPage = 'login';
  } else if (targetPage === 'teacher' && currentRole !== 'teacher') {
    targetPage = 'login';
  } else if (targetPage === 'admin' && currentRole !== 'admin') {
    targetPage = 'login';
  }

  try {
    const response = await fetch(`pages/${targetPage}.html`);
    if (!response.ok) throw new Error(`Failed to load page: ${targetPage} (${response.status})`);
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    doc.querySelectorAll('script').forEach(s => s.remove());
    appContainer.innerHTML = doc.body ? doc.body.innerHTML : html;
    activePortal = targetPage;
    
    if (window.location.hash !== `#${targetPage}`) {
      history.replaceState(null, '', `#${targetPage}`);
    }

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Initialize specific page controllers
    if (targetPage === 'login') {
      updateBackendStatusUI(isBackendOnline);
      populateLoginStudentPicker();
    } else if (targetPage === 'student' && typeof initStudentPortal === 'function') {
      initStudentPortal();
    } else if (targetPage === 'teacher' && typeof initTeacherPortal === 'function') {
      initTeacherPortal();
    } else if (targetPage === 'admin' && typeof initAdminPortal === 'function') {
      initAdminPortal();
    }

    const targetTab = urlParams.get('tab');
    if (targetTab) {
      if (targetPage === 'admin' && typeof showAdminTab === 'function') showAdminTab(targetTab);
      if (targetPage === 'teacher' && typeof showTeacherTab === 'function') showTeacherTab(targetTab);
      if (targetPage === 'student' && typeof showStudentTab === 'function') showStudentTab(targetTab);
    }
  } catch (err) {
    console.error(`Page routing error for '${targetPage}':`, err);
    appContainer.innerHTML = `
      <div class="container py-5 text-center">
        <div class="bpes-card d-inline-block text-start p-4" style="max-width: 500px;">
          <h5 class="fw-bold text-danger"><i class="fas fa-triangle-exclamation me-2"></i> Error Loading Page</h5>
          <p class="mb-2">Could not load <code>pages/${escapeHtml(targetPage)}.html</code>.</p>
          <button class="bpes-btn-primary bpes-btn-sm mt-3" onclick="loadPage('welcome')">Return to Welcome Page</button>
        </div>
      </div>
    `;
  }
}

// ── Shared UI Utilities ───────────────────────────────────────

function notify(target, message, type = 'success') {
  const container = document.getElementById(`${target}-alert-box`);
  if (!container) return;
  const icon = type === 'success' ? 'check-circle' : type === 'warning' ? 'triangle-exclamation' : 'circle-exclamation';
  const alertClass = type === 'success' ? 'alert-success' : type === 'warning' ? 'alert-warning' : 'alert-danger';
  container.innerHTML = `
    <div class="alert ${alertClass} alert-dismissible fade show shadow-sm mb-4" role="alert" style="border-radius: var(--radius-input);">
      <i class="fas fa-${icon} me-2"></i> ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
  `;
  setTimeout(() => { if (container) container.innerHTML = ''; }, 4500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
