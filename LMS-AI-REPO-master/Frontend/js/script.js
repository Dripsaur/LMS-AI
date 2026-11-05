const API_URL = 'https://imcc-lms.onrender.com'; // Put your actual Render URL here
let activeClassCreationRequest = null;
let notificationBadgePoll = null;

function updateWelcomeGreeting(user = {}) {
  const heading = document.getElementById('greetingHeading');
  if (!heading) return;
  const role = String(user.role || '').toLowerCase();
  const name = role === 'admin'
    ? 'Admin'
    : String(user.name || user.first_name || '').trim();
  heading.textContent = `Welcome back${name ? `, ${name}` : ''}.`;
  const displayName = name || 'IMCC User';
  const nameElement = document.getElementById('signedInName');
  if (nameElement) nameElement.textContent = displayName;
  const avatar = document.getElementById('profileAvatar');
  if (avatar) {
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('');
    avatar.textContent = initials.toUpperCase() || 'IM';
  }
}

async function refreshNotificationBadge() {
  const userId = getCurrentUserId();
  const bell = document.getElementById('notificationBtn');
  if (!userId || !bell) return;
  try {
    const response = await fetch(`/api/notifications/dashboard?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) return;
    const data = await response.json();
    const alerts = [
      ...(Array.isArray(data.priorityAlerts) ? data.priorityAlerts : []),
      ...(Array.isArray(data.systemAlerts) ? data.systemAlerts : [])
    ];
    const readKey = `lms_read_notifications_${userId}`;
    let readIds = [];
    try { readIds = JSON.parse(localStorage.getItem(readKey) || '[]'); } catch (_) { readIds = []; }
    const unread = alerts.some((item) => {
      const id = String(item.notification_id ?? item.id ?? `${item.title || ''}:${item.created_at || ''}`);
      return !readIds.includes(id);
    });
    bell.classList.toggle('has-unread', unread);
  } catch (error) {
    console.warn('Could not refresh notification badge:', error.message);
  }
}

function syncUserSessionUI() {
  const sessionData = localStorage.getItem('lms_current_user');
  const adminPanel = document.getElementById('adminPanel');
  if (!sessionData) {
    if (adminPanel) adminPanel.style.display = 'none';
    document.body.classList.remove('admin-account-view');
    return;
  }

  const userSession = JSON.parse(sessionData);
  const currentRole = userSession.role || 'student';
  updateWelcomeGreeting(userSession);
  const isAdmin = currentRole.toLowerCase() === 'admin';
  if (adminPanel) adminPanel.style.display = isAdmin ? 'block' : 'none';
  document.body.classList.toggle('admin-account-view', isAdmin);
  if (isAdmin) loadAndDisplayUserAccounts();
  const canManageWork = currentRole === 'dean' || currentRole === 'teacher';

  const createClassBtn = document.getElementById('createClassBtn');
  const joinClassBtn = document.getElementById('joinClassBtn');
  const addWorkBtn = document.getElementById('addWorkBtn');
  const adminControlPanelBtn = document.getElementById('adminControlPanelBtn');
  const standardNavButtons = document.querySelectorAll('.nav-btn:not(#adminControlPanelBtn)');
  document.body.classList.toggle('joined-class-view', currentRole !== 'dean');
  if (createClassBtn) createClassBtn.hidden = !['dean', 'teacher', 'instructor'].includes(String(currentRole).toLowerCase()) || isAdmin;
  if (joinClassBtn) joinClassBtn.hidden = ['dean', 'teacher', 'instructor', 'admin', 'superadmin'].includes(String(currentRole).toLowerCase());
  if (addWorkBtn) addWorkBtn.hidden = !canManageWork;
  standardNavButtons.forEach((button) => { button.hidden = isAdmin; });
  if (adminControlPanelBtn) {
    adminControlPanelBtn.hidden = !isAdmin;
    adminControlPanelBtn.classList.toggle('active', isAdmin);
  }
  if (isAdmin) {
    document.querySelectorAll('.content-section').forEach((section) => section.classList.remove('active'));
  }

  localStorage.setItem('lms_user_role', currentRole);
  const signedInRole = document.getElementById('signedInRole');
  if (signedInRole) {
    const roleLabels = { dean: 'Dean', teacher: 'Instructor', instructor: 'Instructor', student: 'Student', admin: 'Admin', superadmin: 'Super Admin' };
    signedInRole.textContent = roleLabels[currentRole.toLowerCase()] || currentRole;
  }
  if (typeof loadDashboardCourses === 'function') loadDashboardCourses();
  if (typeof loadAssignmentsPage === 'function') loadAssignmentsPage();
  refreshNotificationBadge();
  if (!notificationBadgePoll) notificationBadgePoll = window.setInterval(refreshNotificationBadge, 60000);
  if (String(currentRole).toLowerCase() === 'dean' && typeof loadPendingClassRequests === 'function') loadPendingClassRequests();
}

function showConfirmationDialog({ title, message, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay';
    overlay.innerHTML = `
      <section class="app-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmMessage">
        <div class="app-confirm-icon" aria-hidden="true">!</div>
        <div class="app-confirm-content">
          <h2 id="appConfirmTitle"></h2>
          <p id="appConfirmMessage"></p>
        </div>
        <div class="app-confirm-actions">
          <button type="button" class="app-confirm-cancel">Cancel</button>
          <button type="button" class="app-confirm-danger"></button>
        </div>
      </section>`;

    const titleElement = overlay.querySelector('#appConfirmTitle');
    const messageElement = overlay.querySelector('#appConfirmMessage');
    const cancelButton = overlay.querySelector('.app-confirm-cancel');
    const confirmButton = overlay.querySelector('.app-confirm-danger');
    titleElement.textContent = title;
    messageElement.textContent = message;
    confirmButton.textContent = confirmLabel;

    const close = (confirmed) => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      previouslyFocused?.focus?.();
      resolve(confirmed);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close(false);
    };

    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(overlay);
    confirmButton.focus();
  });
}

function showToast(message, { type = 'success' } = {}) {
  document.getElementById('appToast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'appToast';
  toast.className = `app-toast${type === 'error' ? ' app-toast-error' : ''}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<span class="app-toast-icon" aria-hidden="true">${type === 'error' ? '!' : '✓'}</span><span></span>`;
  toast.querySelector('span:last-child').textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function showActionConfirmationToast({ title = 'Delete class work?', message, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    document.getElementById('appDeleteConfirmToast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'appDeleteConfirmToast';
    toast.className = 'app-delete-confirm-toast';
    toast.setAttribute('role', 'alertdialog');
    toast.setAttribute('aria-modal', 'false');
    toast.innerHTML = '<div class="app-delete-confirm-copy"><strong></strong><span></span></div><div class="app-delete-confirm-actions"><button type="button" class="app-delete-cancel">Cancel</button><button type="button" class="app-delete-confirm"></button></div>';
    toast.querySelector('strong').textContent = title;
    toast.querySelector('span').textContent = message;
    const cancelButton = toast.querySelector('.app-delete-cancel');
    const confirmButton = toast.querySelector('.app-delete-confirm');
    confirmButton.textContent = confirmLabel;
    let settled = false;
    const close = (confirmed) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      toast.remove();
      resolve(confirmed);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close(false);
    };
    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(toast);
    cancelButton.focus();
  });
}

async function createNewUserAccount() {
  const name = document.getElementById('adminNewName').value.trim();
  const email = document.getElementById('adminNewEmail').value.trim();
  const role = document.getElementById('adminNewRole').value;

  if (!email) {
    alert('Please enter an institutional email address.');
    return;
  }

  try {
    const authToken = localStorage.getItem('lms_auth_token');
    const res = await fetch('/api/admin/assign-role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken || ''}`,
      },
      body: JSON.stringify({ name, email, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to create account.');
      return;
    }

    alert(data.message);
    document.getElementById('adminNewName').value = '';
    document.getElementById('adminNewEmail').value = '';
    loadAndDisplayUserAccounts();
  } catch (err) {
    console.error('Create User Error:', err);
    alert('Server connection error.');
  }
}

// Fetch registered accounts and show them in the appropriate role table.
async function loadAndDisplayUserAccounts() {
  const deansBody = document.getElementById('deansTableBody');
  const teachersBody = document.getElementById('teachersTableBody');
  const studentsBody = document.getElementById('studentsTableBody');
  if (!deansBody || !teachersBody || !studentsBody) return;

  const escapeCell = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
  const renderRows = (list, emptyMessage) => list.length
    ? list.map((user) => `<tr><td style="padding: 8px 10px; border: 1px solid #ddd;">${escapeCell(user.student_id)}</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${escapeCell(user.name)}</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${escapeCell(user.email)}</td></tr>`).join('')
    : `<tr><td colspan="3" style="padding: 10px; text-align: center; color: #888;">${emptyMessage}</td></tr>`;

  try {
const res = await fetch('/api/admin/users');
const users = await res.json();
if (!res.ok) throw new Error(users.error || 'Failed to load accounts.');

    const deans = users.filter((user) => user.role === 'dean');
    const teachers = users.filter((user) => user.role === 'teacher' || user.role === 'instructor');
    const students = users.filter((user) => user.role === 'student');
    deansBody.innerHTML = renderRows(deans, 'No Deans registered.');
    teachersBody.innerHTML = renderRows(teachers, 'No Instructors registered.');
    studentsBody.innerHTML = renderRows(students, 'No Students registered.');
  } catch (err) {
    console.error('Failed to load users:', err);
    const message = 'Unable to load account records.';
    deansBody.innerHTML = renderRows([], message);
    teachersBody.innerHTML = renderRows([], message);
    studentsBody.innerHTML = renderRows([], message);
  }
}

function canManageClassWork() {
  const userSession = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
  const currentRole = String(userSession.role || 'student').toLowerCase().replace(/\s+/g, '');
  return ['dean', 'teacher', 'instructor', 'admin', 'superadmin'].includes(currentRole);
}

function getCurrentUserId() {
  const userSession = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
  // Account IDs can be institutional IDs such as "qpc36415", not just numbers.
  // Keep the exact stored identifier for all role-aware API requests.
  return String(userSession.userId ?? userSession.student_id ?? '').trim() || null;
}

async function identifyChatbaseUser() {
  const authToken = localStorage.getItem('lms_auth_token');
  if (!authToken) return;

  try {
    const response = await fetch('/api/chatbase-token', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to get Chatbase token.');

    if (window.chatbase) {
      window.chatbase('identify', { token: data.token });
    }
  } catch (error) {
    console.error('Chatbase identification failed:', error);
  }
}

// Opens the direct Super Admin credential view from the login page.
function openSuperAdminLogin() {
  toggleLoginTab('admin');
  const usernameInput = document.getElementById('adminLoginEmail');
  usernameInput?.focus();
}

// Switch between Google SSO and Super Admin Login forms.
function toggleLoginTab(tab) {
  const googleSec = document.getElementById('googleAuthSection');
  const adminSec = document.getElementById('adminAuthSection');
  const backButton = document.getElementById('btnBackToNormal');
  const errorElem = document.getElementById('loginError');

  if (errorElem) errorElem.style.display = 'none';
  if (tab === 'google') {
    if (googleSec) googleSec.style.display = 'block';
    if (adminSec) adminSec.style.display = 'none';
    if (backButton) backButton.style.display = 'none';
  } else {
    if (googleSec) googleSec.style.display = 'none';
    if (adminSec) adminSec.style.display = 'block';
    if (backButton) backButton.style.display = 'block';
  }
}

// Login via email address or student ID and password.
async function loginWithCredentials() {
  const email = document.getElementById('adminLoginEmail').value.trim();
  const password = document.getElementById('adminLoginPassword').value.trim();
  const errorElem = document.getElementById('loginError');

  if (!email || !password) {
    errorElem.innerText = 'Please enter both Email/ID and Password.';
    errorElem.style.display = 'block';
    return;
  }

  try {
  const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
 
    if (!res.ok) {
      errorElem.innerText = data.error || 'Login failed.';
      errorElem.style.display = 'block';
      return;
    }

    localStorage.setItem('lms_current_user', JSON.stringify({
      ...data.user,
      userId: data.user.student_id,
    }));
    localStorage.setItem('lms_user_role', data.user.role);
    localStorage.setItem('lms_auth_token', data.authToken);
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.style.display = 'none';
    syncUserSessionUI();
    identifyChatbaseUser();
    window.refreshChatbotVisibility?.();
    showLoginWelcome(data.user.name, data.user.role);
  } catch (err) {
    console.error('Login Error:', err);
    errorElem.innerText = 'Cannot connect to backend server.';
    errorElem.style.display = 'block';
  }
}

// Keeps compatibility with the earlier Admin-tab markup.
function loginAsAdmin() {
  return loginWithCredentials();
}

function showLoginWelcome(userName, role) {
  const modal = document.getElementById('loginWelcomeModal');
  const title = document.getElementById('loginWelcomeTitle');
  const message = document.getElementById('loginWelcomeMessage');
  const continueButton = document.getElementById('closeLoginWelcome');
  if (!modal || !title || !message) return;

  const displayName = userName || 'there';
  const roleLabel = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : 'LMS';
  title.textContent = `Welcome, ${displayName}`;
  message.textContent = `You are signed in as ${roleLabel}. Your dashboard is ready.`;
  modal.classList.remove('hidden');
  continueButton?.focus();
}

function closeLoginWelcome() {
  document.getElementById('loginWelcomeModal')?.classList.add('hidden');
}

function completeGoogleLogin(user, authToken) {
  localStorage.setItem('lms_current_user', JSON.stringify({ ...user, userId: user.student_id }));
  localStorage.setItem('lms_user_role', user.role);
  if (authToken) localStorage.setItem('lms_auth_token', authToken);

  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) loginScreen.style.display = 'none';
  syncUserSessionUI();
  identifyChatbaseUser();
  window.refreshChatbotVisibility?.();
  showLoginWelcome(user.name, user.role);
}

async function handleGoogleSSOLogin(response) {
  const errorElem = document.getElementById('loginError');
  if (errorElem) errorElem.style.display = 'none';

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google sign-in failed.');
    completeGoogleLogin(data.user, data.authToken);
  } catch (error) {
    console.error('Google login error:', error);
    if (errorElem) {
      errorElem.innerText = error.message || 'Cannot connect to backend server.';
      errorElem.style.display = 'block';
    }
  }
}

/* ============== REAL GOOGLE SSO ============== */
function initRealGoogleSSO() {
  const box = document.getElementById('googleRealBtn');
  const clientId = box?.dataset.clientId;
  if (!box || !clientId) return;

  const waitForGsi = () => {
    if (!window.google?.accounts?.id) {
      window.setTimeout(waitForGsi, 300);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleSSOLogin,
      auto_select: false,
    });
    box.replaceChildren();
    window.google.accounts.id.renderButton(box, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'sign_in_with',
      width: 300,
    });
  };

  waitForGsi();
}

function logoutUser() {
  localStorage.removeItem('lms_current_user');
  localStorage.removeItem('lms_user_role');
  localStorage.removeItem('lms_auth_token');
  window.refreshChatbotVisibility?.();
  window.location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('loginScreen');
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', logoutUser);
  document.getElementById('closeLoginWelcome')?.addEventListener('click', closeLoginWelcome);
  document.getElementById('loginWelcomeModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'loginWelcomeModal') closeLoginWelcome();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLoginWelcome();
  });

  const activeUser = localStorage.getItem('lms_current_user');
  if (activeUser) {
    if (loginScreen) loginScreen.style.display = 'none';
    syncUserSessionUI();
    identifyChatbaseUser();
  } else if (loginScreen) {
    loginScreen.style.display = 'flex';
  }

  const navButtons = document.querySelectorAll('.nav-btn');
  const contentSections = document.querySelectorAll('.content-section');
  const classesDashboardActions = document.getElementById('classesDashboardActions');
  const updateClassesDashboardActions = (sectionId) => {
    if (classesDashboardActions) classesDashboardActions.hidden = sectionId !== 'classes';
  };
  updateClassesDashboardActions(document.querySelector('.content-section.active')?.id || '');

  const activateSection = (targetId) => {
    contentSections.forEach((section) => {
      section.classList.toggle('active', section.id === targetId);
    });
    updateClassesDashboardActions(targetId);
  };

  const classSearch = document.getElementById('classSearchInput');
  const classFilters = document.querySelectorAll('[data-class-filter]');
  let selectedClassFilter = 'all';
  const applyClassFilters = () => {
    const query = String(classSearch?.value || '').trim().toLowerCase();
    const cards = [...document.querySelectorAll('#coursesContainer .course-card')];
    let visible = 0;
    cards.forEach((card) => {
      const archived = card.dataset.classStatus === 'archived';
      const text = `${card.textContent} ${card.dataset.courseTitle || ''} ${card.dataset.courseCategory || ''}`.toLowerCase();
      const matchesFilter = selectedClassFilter === 'all' || (selectedClassFilter === 'archived' ? archived : !archived);
      const show = matchesFilter && (!query || text.includes(query));
      card.hidden = !show;
      if (show) visible++;
    });
    const count = document.getElementById('classCount');
    if (count) count.textContent = `${visible} ${visible === 1 ? 'class' : 'classes'}`;
    let empty = document.getElementById('classFilterEmpty');
    if (!empty && cards.length) {
      empty = document.createElement('p'); empty.id = 'classFilterEmpty'; empty.className = 'course-loader';
      document.getElementById('coursesContainer')?.appendChild(empty);
    }
    if (empty) { empty.textContent = query ? 'No classes match your search.' : `No ${selectedClassFilter === 'all' ? '' : `${selectedClassFilter} `}classes found.`; empty.hidden = visible > 0 || cards.length === 0; }
  };
  classSearch?.addEventListener('input', applyClassFilters);
  classFilters.forEach((filter) => filter.addEventListener('click', () => {
    selectedClassFilter = filter.dataset.classFilter || 'all';
    classFilters.forEach((item) => { const active = item === filter; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    applyClassFilters();
  }));
  window.applyClassFilters = applyClassFilters;

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      navButtons.forEach((navButton) => navButton.classList.remove('active'));
       button.classList.add('active');
      const target = button.getAttribute('data-target');
      activateSection(target);
      if (target === 'assignments') loadAssignmentsPage();
      if (target === 'classes' && String(localStorage.getItem('lms_user_role') || '').toLowerCase() === 'dean') loadPendingClassRequests();
      if (target === 'calendar') renderMonthlyCalendarPro({ role: localStorage.getItem('lms_user_role') || 'student', userId: getCurrentUserId() }, document.getElementById('aaCalendarRoot'));
      if (target === 'resources') renderResourcesPage({ role: localStorage.getItem('lms_user_role') || 'student', userId: getCurrentUserId() }, document.getElementById('aaResourcesRoot'));
    });
  });

  const notificationBtn = document.getElementById('notificationBtn');
  const joinClassBtn = document.getElementById('joinClassBtn');
  const joinClassModal = document.getElementById('joinClassModal');
  const notificationModal = document.getElementById('notificationModal');
  const closeModals = document.querySelectorAll('.close-modal');
  const classCodeInput = document.getElementById('classCodeInput');
  const classCodeMessage = document.getElementById('classCodeMessage');
  const submitClassCode = document.getElementById('submitClassCode');

  const resetJoinModal = () => {
    classCodeInput.value = '';
    const currentRole = JSON.parse(localStorage.getItem('lms_current_user') || '{}').role;
    classCodeMessage.textContent = currentRole === 'teacher'
      ? 'Ask the dean for the class code to join this class.'
      : 'Ask your instructor for the class code to join this class.';
    classCodeMessage.classList.remove('error');
    submitClassCode.textContent = 'Join';
    submitClassCode.disabled = false;
  };

  classCodeInput?.addEventListener('input', () => {
    classCodeInput.value = classCodeInput.value.toUpperCase();
  });

  joinClassBtn?.addEventListener('click', () => {
    resetJoinModal();
    joinClassModal?.classList.remove('hidden');
    classCodeInput?.focus();
  });

  notificationBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    openNotificationModal();
  });

  document.addEventListener('click', (event) => {
    if (!notificationModal || notificationModal.classList.contains('hidden')) return;
    if (!notificationModal.contains(event.target) && !notificationBtn?.contains(event.target)) {
      closeNotificationModal();
    }
  });

  closeModals.forEach((button) => {
    button.addEventListener('click', () => {
      const modal = button.closest('.modal');
      modal?.classList.add('hidden');
    });
  });

  window.addEventListener('click', (event) => {
    if (event.target === joinClassModal || event.target === notificationModal) {
      if (event.target === joinClassModal) {
        joinClassModal.classList.add('hidden');
      }
      if (event.target === notificationModal) {
        notificationModal.classList.add('hidden');
      }
    }
  });

  submitClassCode?.addEventListener('click', async () => {
    const code = classCodeInput.value.trim().toUpperCase();
    if (!code) {
      classCodeMessage.textContent = 'Please enter your class code to proceed.';
      classCodeMessage.classList.add('error');
      classCodeInput.focus();
      return;
    }

    try {
      submitClassCode.textContent = 'Joining...';
      submitClassCode.disabled = true;
      classCodeMessage.classList.remove('error');
      classCodeMessage.textContent = 'Checking class code...';
      const response = await fetch('/api/classes/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: getCurrentUserId(), classCode: code }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Unable to join this class.');

      classCodeMessage.textContent = data.message;
      setTimeout(() => {
        joinClassModal?.classList.add('hidden');
        resetJoinModal();
      }, 1200);
      await fetchDashboardData(getCurrentUserId());
    } catch (error) {
      classCodeMessage.textContent = error.message || 'Connection error. Please try again.';
      classCodeMessage.classList.add('error');
      classCodeInput.focus();
    } finally {
      submitClassCode.disabled = false;
      submitClassCode.textContent = 'Join';
    }
  });

  // Create Class modal and flow
  const createClassBtn = document.getElementById('createClassBtn');
  const createClassModal = document.getElementById('createClassModal');
  const classNameInput = document.getElementById('classNameInput');
  const classCourseInput = document.getElementById('classCourseInput');
  const classCourseNameInput = document.getElementById('classCourseNameInput');
  const classYearInput = document.getElementById('classYearInput');
  const classInstructorInput = document.getElementById('classInstructorInput');
  const classSectionInput = document.getElementById('classSectionInput');
  const classCategoryInput = document.getElementById('classCategoryInput');
  const createClassMessage = document.getElementById('createClassMessage');
  const classCodeDisplay = document.getElementById('classCodeDisplay');
  const createClassCourseLabel = document.getElementById('createClassCourseLabel');
  const copyCreateCodeBtn = document.getElementById('copyCreateCodeBtn');
  const createClassSubmit = document.getElementById('createClassSubmit');
  const createClassFormGroup = document.getElementById('createClassFormGroup');
  const createClassSuccessBox = document.getElementById('createClassSuccessBox');
  const finishCreateBtn = document.getElementById('finishCreateBtn');
  const classesContainer = document.querySelector('#classes .course-list');

  const switchRole = (selectedRole) => {
    const role = ['dean', 'teacher', 'instructor', 'student'].includes(selectedRole) ? selectedRole : 'student';
    const isDean = role === 'dean';
    localStorage.setItem('lms_user_role', role);
    document.body.classList.toggle('joined-class-view', !isDean);
    if (createClassBtn) createClassBtn.hidden = !['dean', 'teacher', 'instructor'].includes(role);
    if (joinClassBtn) joinClassBtn.hidden = isDean || ['teacher', 'instructor', 'admin', 'superadmin'].includes(String(role).toLowerCase());
    const addWorkBtn = document.getElementById('addWorkBtn');
    if (addWorkBtn) addWorkBtn.hidden = !['dean', 'teacher'].includes(role);
    loadDashboardCourses();
  };

  const savedSession = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
  const savedRole = savedSession.role || 'student';
  switchRole(savedRole);
  if (activeUser) syncUserSessionUI();

  const resetCreateModal = () => {
    if (classNameInput) classNameInput.value = '';
    if (classCourseInput) classCourseInput.value = '';
    if (classCourseNameInput) classCourseNameInput.value = '';
    if (classYearInput) classYearInput.value = '';
    if (classInstructorInput) classInstructorInput.value = '';
    if (classSectionInput) classSectionInput.value = '';
    if (classCategoryInput) classCategoryInput.value = '';
    if (createClassMessage) {
      createClassMessage.textContent = '';
      createClassMessage.classList.remove('error');
    }
    if (classCodeDisplay) classCodeDisplay.value = '';
    if (copyCreateCodeBtn) {
      copyCreateCodeBtn.textContent = 'Copy';
      copyCreateCodeBtn.classList.remove('copied');
    }
    if (createClassFormGroup) createClassFormGroup.hidden = false;
    if (createClassSuccessBox) createClassSuccessBox.hidden = true;
    const codeGroup = document.getElementById('createClassCodeGroup');
    if (codeGroup) codeGroup.hidden = false;
    const successTitle = document.getElementById('createClassSuccessTitle');
    const successMessage = document.getElementById('createClassSuccessMessage');
    if (successTitle) successTitle.textContent = 'Class Created Successfully!';
    if (successMessage) successMessage.textContent = 'Share this join code with your students:';
    const copyButton = document.getElementById('copyCreateCodeBtn');
    if (copyButton) copyButton.hidden = false;
    const deanSelect = document.getElementById('classApprovingDeanSelect');
    if (deanSelect) deanSelect.value = '';
    if (createClassSubmit) {
      createClassSubmit.textContent = 'Create Class';
      createClassSubmit.disabled = false;
    }
  };

  createClassBtn?.addEventListener('click', () => {
    resetCreateModal();
    createClassModal?.classList.remove('hidden');
    classNameInput?.focus();
  });

  copyCreateCodeBtn?.addEventListener('click', () => {
    const code = classCodeDisplay?.value || '';
    if (!code) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        showToast('Class code copied to clipboard.');
      });
    }
  });

  createClassSubmit?.addEventListener('click', async () => {
    const className = (classNameInput?.value || '').trim();
    const courseCode = (classCourseInput?.value || '').trim();
    const course = (classCourseNameInput?.value || courseCode).trim();
    const year = (classYearInput?.value || '').trim();
    const instructor = (classInstructorInput?.value || '').trim();
    const section = (classSectionInput?.value || '').trim();
    const subjectNotes = (classCategoryInput?.value || '').trim();

    if (!className) {
      if (createClassMessage) {
        createClassMessage.textContent = 'Please enter a class name.';
        createClassMessage.classList.add('error');
      }
      classNameInput?.focus();
      return;
    }

    createClassSubmit.textContent = 'Creating...';
    createClassSubmit.disabled = true;
    createClassMessage.textContent = 'Creating class...';
    createClassMessage.classList.remove('error');

    try {
      const response = await fetch('/api/classes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: className,
          course,
          courseCode,
          yearLevel: year,
          instructor,
          section,
          subText: subjectNotes,
          teacherId: getCurrentUserId(),
          createdBy: getCurrentUserId(),
        }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Unable to create class.');

      if (classCodeDisplay) classCodeDisplay.value = data.classCode;
      if (createClassFormGroup) createClassFormGroup.hidden = true;
      if (createClassSuccessBox) createClassSuccessBox.hidden = false;
      await fetchDashboardData(getCurrentUserId());
      copyCreateCodeBtn?.focus();
    } catch (error) {
      createClassMessage.textContent = error.message || 'Unable to create class. Please try again.';
      createClassMessage.classList.add('error');
    } finally {
      createClassSubmit.disabled = false;
      createClassSubmit.textContent = 'Create Class';
    }
  });

  finishCreateBtn?.addEventListener('click', async () => {
    createClassModal?.classList.add('hidden');
    await fetchDashboardData(getCurrentUserId());
  });

  const heroPrimary = document.getElementById('heroPrimary');
  const openClassModal = document.getElementById('openClassModal');
  const confirmOpenClass = document.getElementById('confirmOpenClass');
  const viewDetailsBtn = document.getElementById('viewDetailsBtn');
  const viewDetailsModal = document.getElementById('viewDetailsModal');
  const closeDetails = document.getElementById('closeDetails');
  const closeNotification = document.getElementById('closeNotification');
  const courseInfoModal = document.getElementById('courseInfoModal');
  const courseInfoCategory = document.getElementById('courseInfoCategory');
  const courseInfoTitle = document.getElementById('courseInfoTitle');
  const courseInfoList = document.getElementById('courseInfoList');
  const courseInfoDescription = document.getElementById('courseInfoDescription');
  const courseInfoAction = document.getElementById('courseInfoAction');
  const classDetailSection = document.getElementById('classDetail');
  const detailClassCategory = document.getElementById('detailClassCategory');
  const detailClassTitle = document.getElementById('detailClassTitle');
  const detailClassSubtitle = document.getElementById('detailClassSubtitle');
  const detailClassCode = document.getElementById('detailClassCode');
  const copyDetailCodeBtn = document.getElementById('copyDetailCode');
  const classMembersBtn = document.getElementById('classMembersBtn');
  copyDetailCodeBtn?.closest('.form-note')?.after(classMembersBtn);
  const detailMaterialsList = document.getElementById('detailMaterialsList');
  const detailResourcesList = document.getElementById('detailResourcesList');
  const detailAnnouncementsList = document.getElementById('detailAnnouncementsList');
  const detailUpcomingList = document.getElementById('detailUpcomingList');
  const detailAssignmentsList = document.getElementById('detailAssignmentsList');
  const detailActivitiesList = document.getElementById('detailActivitiesList');
  const classWorkList = document.getElementById('classWorkList');
  const upcomingList = document.getElementById('upcomingList');
  const addWorkBtn = document.getElementById('addWorkBtn');
  const uploadModal = document.getElementById('uploadModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelUploadBtn = document.getElementById('cancelUploadBtn');
  const uploadForm = document.getElementById('uploadForm');
  const workType = document.getElementById('workType');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const dropZoneText = document.getElementById('dropZoneText');
  const assessmentFields = document.getElementById('assessmentFields');
  const uploadFormMessage = document.getElementById('uploadFormMessage');
  const backToClassesBtn = document.getElementById('backToClassesBtn');
  const streamContentArea = document.getElementById('streamContentArea');
  const itemDetailView = document.getElementById('itemDetailView');
  const tabStreamBtn = document.getElementById('tabStreamBtn');
  const tabDetailBtn = document.getElementById('tabDetailBtn');
  const tabRecordBtn = document.getElementById('tabRecordBtn');
  const backToStreamBtn = document.getElementById('backToStreamBtn');
  const classRecordView = document.getElementById('classRecordView');
  const classRecordHead = document.getElementById('classRecordHead');
  const classRecordBody = document.getElementById('classRecordBody');
  const classRecordTitle = document.getElementById('classRecordTitle');
  const classRecordDescription = document.getElementById('classRecordDescription');
  const exportClassRecordBtn = document.getElementById('exportClassRecordBtn');
  const studentSubmissionPanel = document.getElementById('studentSubmissionPanel');
  const submissionStatus = document.getElementById('submissionStatus');
  const submissionFileList = document.getElementById('submissionFileList');
  const submissionFileInput = document.getElementById('submissionFileInput');
  const addSubmissionFileBtn = document.getElementById('addSubmissionFileBtn');
  const submissionAddMenu = document.getElementById('submissionAddMenu');
  const submissionLinkForm = document.getElementById('submissionLinkForm');
  const submissionLinkUrl = document.getElementById('submissionLinkUrl');
  const saveSubmissionLinkBtn = document.getElementById('saveSubmissionLinkBtn');
  const cancelSubmissionLinkBtn = document.getElementById('cancelSubmissionLinkBtn');
  const submitWorkBtn = document.getElementById('submitWorkBtn');
  const submissionReviewPanel = document.getElementById('submissionReviewPanel');
  const submissionReviewList = document.getElementById('submissionReviewList');
  const submissionGradeNote = document.getElementById('submissionGradeNote');
  const classCommentsList = document.getElementById('classCommentsList');
  const classCommentsHeading = document.getElementById('classCommentsHeading');
  const classCommentForm = document.getElementById('classCommentForm');
  const classCommentInput = document.getElementById('classCommentInput');
  const classCommentMessage = document.getElementById('classCommentMessage');
  let activeCourseId = null;
  let currentCourseData = { materials: [], assignments: [] };
  let selectedWorkItem = null;
  let classRecordData = null;
  let activeRecordTab = 'grades';
  const submissionStates = new Map();

  const setClassCommentMessage = (message = '', isError = false) => {
    if (!classCommentMessage) return;
    classCommentMessage.textContent = message;
    classCommentMessage.hidden = !message;
    classCommentMessage.classList.toggle('error', isError);
  };

  const loadClassComments = async (courseId, workItem) => {
    if (!classCommentsList || !workItem) return;
    const workType = workItem.dbTable;
    const workId = workItem.id;
    classCommentsList.innerHTML = '<p class="class-comments-empty">Loading comments...</p>';
    try {
      const params = new URLSearchParams({ work_type: workType, work_id: String(workId) });
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/comments?${params}`);
      const comments = await response.json();
      if (!response.ok) throw new Error(comments.error || 'Unable to load comments.');
      if (activeCourseId !== courseId || selectedWorkItem?.dbTable !== workType || selectedWorkItem?.id !== workId) return;
      classCommentsList.innerHTML = '';
      if (!comments.length) {
        classCommentsList.innerHTML = '<p class="class-comments-empty">No comments yet. Start the conversation.</p>';
        return;
      }
      comments.forEach((comment) => {
        const item = document.createElement('article');
        item.className = 'class-comment-item';
        const author = document.createElement('strong');
        author.textContent = comment.author_name || 'IMCC user';
        const timestamp = document.createElement('time');
        timestamp.dateTime = comment.created_at;
        timestamp.textContent = new Date(comment.created_at).toLocaleString();
        const content = document.createElement('p');
        content.textContent = comment.content;
        item.append(author, timestamp, content);
        classCommentsList.appendChild(item);
      });
    } catch (error) {
      classCommentsList.innerHTML = '<p class="class-comments-empty">Unable to load comments.</p>';
      setClassCommentMessage(error.message || 'Unable to load comments.', true);
    }
  };

  classCommentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeCourseId || !selectedWorkItem || !classCommentInput) return;
    const courseId = activeCourseId;
    const workItem = selectedWorkItem;
    const content = classCommentInput.value.trim();
    if (!content) return setClassCommentMessage('Write a comment before posting.', true);
    const submitButton = classCommentForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setClassCommentMessage('Posting...');
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('lms_auth_token') || ''}`,
        },
        body: JSON.stringify({
          content,
          author_id: getCurrentUserId(),
          work_type: workItem.dbTable,
          work_id: workItem.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to post the comment.');
      classCommentInput.value = '';
      setClassCommentMessage('Comment posted.');
      await loadClassComments(courseId, workItem);
    } catch (error) {
      setClassCommentMessage(error.message || 'Unable to post the comment.', true);
    } finally {
      submitButton.disabled = false;
    }
  });

  const scrollToClassView = (element) => {
    if (!element) return;
    requestAnimationFrame(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const closeClassMembers = () => document.getElementById('classMembersOverlay')?.remove();

  const openClassMembers = async () => {
    if (!activeCourseId) return;
    closeClassMembers();
    const overlay = document.createElement('div');
    overlay.id = 'classMembersOverlay';
    overlay.className = 'class-members-overlay';
    overlay.innerHTML = `<section class="class-members-dialog" role="dialog" aria-modal="true" aria-labelledby="classMembersTitle"><div class="class-members-dialog-head"><div><span class="class-members-icon" aria-hidden="true">&#128101;</span><h2 id="classMembersTitle">Class Members</h2></div><button type="button" class="class-members-close" aria-label="Close class members">&times;</button></div><p class="class-members-subtitle">Loading members&hellip;</p><div class="class-members-list"></div></section>`;
    document.body.appendChild(overlay);
    const closeButton = overlay.querySelector('.class-members-close');
    closeButton?.addEventListener('click', closeClassMembers);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeClassMembers(); });
    const onKeyDown = (event) => { if (event.key === 'Escape') { closeClassMembers(); document.removeEventListener('keydown', onKeyDown); } };
    document.addEventListener('keydown', onKeyDown);

    try {
      const session = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
      const userId = String(session.student_id || session.user_id || getCurrentUserId() || '');
      const response = await fetch(`/api/courses/${encodeURIComponent(activeCourseId)}/members?user_id=${encodeURIComponent(userId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load class members.');
      const members = Array.isArray(result.members) ? result.members : [];
      const requests = Array.isArray(result.requests) ? result.requests : [];
      const canApprove = ['dean', 'teacher', 'instructor'].includes(String(session.role || '').toLowerCase());
      overlay.querySelector('.class-members-subtitle').textContent = `${members.length} enrolled student${members.length === 1 ? '' : 's'} in ${detailClassTitle?.textContent || 'this class'}.`;
      const memberRows = members.length
        ? members.map((member, index) => `<div class="class-member-row"><span class="class-member-avatar" aria-hidden="true">${escapeHtml(String(member.student_name || '?').trim().charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(member.student_name || `Student #${member.student_id}`)}</strong><small>${member.year_level ? escapeHtml(member.year_level) : 'Class member'}</small></div>${canApprove ? `<button type="button" class="class-member-remove" data-member-remove="${escapeHtml(member.student_id)}" data-member-name="${escapeHtml(member.student_name || `Student #${member.student_id}`)}">Remove</button>` : `<span class="class-member-number">${index + 1}</span>`}</div>`).join('')
        : '<p class="class-members-empty">No students have joined this class yet.</p>';
      const requestRows = requests.length
        ? requests.map((request) => `<div class="class-member-row class-join-request"><span class="class-member-avatar" aria-hidden="true">${escapeHtml(String(request.student_name || '?').trim().charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(request.student_name || `Student #${request.student_id}`)}</strong><small>${request.year_level ? escapeHtml(request.year_level) : 'Awaiting approval'}</small></div>${canApprove ? `<div class="class-request-actions"><button type="button" class="class-request-approve" data-request-action="approve" data-student-id="${escapeHtml(request.student_id)}">Approve</button><button type="button" class="class-request-delete" data-request-action="delete" data-student-id="${escapeHtml(request.student_id)}">Delete</button></div>` : '<span class="class-request-pending">Pending</span>'}</div>`).join('')
        : '<p class="class-members-empty">No students are waiting for approval.</p>';
      overlay.querySelector('.class-members-list').innerHTML = `${canApprove ? `<h3 class="class-members-section-title">Join requests <span>${requests.length}</span></h3>${requestRows}` : ''}<h3 class="class-members-section-title">Enrolled students</h3>${memberRows}`;
      overlay.querySelectorAll('[data-member-remove]').forEach((button) => button.addEventListener('click', async () => {
        const studentId = button.dataset.memberRemove;
        const studentName = button.dataset.memberName || `student ${studentId}`;
        const confirmed = await showConfirmationDialog({
          title: 'Remove student from class?',
          message: `${studentName} will lose access to this class. Their submitted work and grades will be retained.`,
          confirmLabel: 'Remove student',
        });
        if (!confirmed) return;
        button.disabled = true;
        try {
          const removeResponse = await fetch(`/api/courses/${encodeURIComponent(activeCourseId)}/students/${encodeURIComponent(studentId)}?teacher_id=${encodeURIComponent(userId)}`, { method: 'DELETE' });
          const removeResult = await removeResponse.json().catch(() => ({}));
          if (!removeResponse.ok) throw new Error(removeResult.error || 'Unable to remove student.');
          await openClassMembers();
          const classRecordRoot = document.getElementById('crRoot');
          if (classRecordRoot && !classRecordView?.hidden) await renderClassRecordPro(activeCourseId, { role: session.role, userId }, classRecordRoot, detailClassTitle?.textContent);
          showToast(`${studentName} was removed from the class.`);
        } catch (error) {
          button.disabled = false;
          window.alert(error.message || 'Unable to remove student.');
        }
      }));
      overlay.querySelectorAll('[data-request-action]').forEach((button) => button.addEventListener('click', async () => {
        const action = button.dataset.requestAction;
        const studentId = button.dataset.studentId;
        const endpoint = `/api/courses/${encodeURIComponent(activeCourseId)}/join-requests/${encodeURIComponent(studentId)}`;
        button.disabled = true;
        try {
          const actionResponse = await fetch(action === 'approve' ? `${endpoint}/approve` : `${endpoint}?user_id=${encodeURIComponent(userId)}`, {
            method: action === 'approve' ? 'POST' : 'DELETE',
            ...(action === 'approve' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) } : {}),
          });
          const actionResult = await actionResponse.json();
          if (!actionResponse.ok) throw new Error(actionResult.error || 'Unable to update join request.');
          await openClassMembers();
          if (action === 'approve') await fetchDashboardData(getCurrentUserId());
        } catch (error) {
          button.disabled = false;
          window.alert(error.message || 'Unable to update join request.');
        }
      }));
    } catch (error) {
      overlay.querySelector('.class-members-subtitle').textContent = error.message || 'Unable to load class members.';
    }
  };

  const showClassTab = (activeView) => {
    [streamContentArea, itemDetailView, classRecordView].forEach((view) => {
      if (!view) return;
      view.hidden = view !== activeView;
      view.classList.remove('class-tab-swipe');
    });
    if (!activeView) return;
    requestAnimationFrame(() => {
      activeView.classList.remove('class-tab-swipe');
      void activeView.offsetWidth;
      activeView.classList.add('class-tab-swipe');
    });
  };

  const canSubmitWork = (item) => {
    const role = JSON.parse(localStorage.getItem('lms_current_user') || '{}').role;
    return role === 'student' && ['task', 'activity', 'assignment', 'quiz'].includes(String(item?.type || '').toLowerCase());
  };

  const renderSubmissionPanel = (item) => {
    if (!studentSubmissionPanel || !submissionFileList || !submissionStatus || !submitWorkBtn || !addSubmissionFileBtn) return;
    if (!canSubmitWork(item)) {
      studentSubmissionPanel.hidden = true;
      return;
    }

    const state = submissionStates.get(item.id) || { file: null, submitted: false, score: null, feedback: '' };
    studentSubmissionPanel.hidden = false;
    const isGraded = Number.isInteger(state.score);
    const dueDate = item.dueDate ? new Date(`${String(item.dueDate).slice(0, 10)}T00:00:00`) : null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isMissing = !state.submitted && dueDate && dueDate < today && ['activity', 'quiz'].includes(String(item.type || '').toLowerCase());
    submissionStatus.textContent = isGraded ? 'Graded' : state.submitted ? 'Submitted' : isMissing ? 'Missing' : 'Assigned';
    submissionStatus.className = `submission-status ${isGraded ? 'graded' : state.submitted ? 'turned-in' : isMissing ? 'missing' : 'assigned'}`;
    if (submissionGradeNote) {
      submissionGradeNote.hidden = !isGraded;
      submissionGradeNote.textContent = isGraded
        ? `Score: ${state.score}/${Number.isFinite(Number(item.totalPoints)) ? Number(item.totalPoints) : 100}${state.feedback ? ` — Feedback: ${state.feedback}` : ''}`
        : '';
    }
    submitWorkBtn.textContent = state.submitted ? 'Unsubmit' : 'Submit';
    submitWorkBtn.classList.toggle('unsubmit', state.submitted);
    addSubmissionFileBtn.hidden = state.submitted;
    if (state.submitted && submissionAddMenu) submissionAddMenu.hidden = true;

    submissionFileList.innerHTML = '';
    const fileName = state.fileName || state.file?.name || state.linkTitle;
    if (!fileName && !state.submissionUrl) {
      const empty = document.createElement('div');
      empty.className = 'submission-empty';
      empty.textContent = 'No work added yet';
      submissionFileList.appendChild(empty);
      return;
    }
    const fileRow = document.createElement('div');
    fileRow.className = 'submission-file';
    const fileLabel = document.createElement('span');
    fileLabel.className = 'submission-file-name';
    fileLabel.textContent = `📄 ${fileName}`;
    if (state.submissionUrl) {
      const link = document.createElement('a');
      link.className = 'submission-file-link';
      link.href = state.submissionUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = fileName || 'Open submitted link';
      fileRow.appendChild(link);
    } else {
      fileRow.appendChild(fileLabel);
    }
    if (!state.submitted) {
      const removeButton = document.createElement('button');
      removeButton.className = 'submission-remove';
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', 'Remove attached work');
      removeButton.textContent = '×';
      removeButton.addEventListener('click', () => {
        submissionStates.set(item.id, { ...state, file: null, fileName: '', linkTitle: '', submissionUrl: '', submissionKind: '' });
        if (submissionFileInput) submissionFileInput.value = '';
        renderSubmissionPanel(item);
      });
      fileRow.appendChild(removeButton);
    }
    submissionFileList.appendChild(fileRow);
  };

  const loadStudentSubmission = async (item) => {
    if (!canSubmitWork(item)) return;
    try {
      const response = await fetch(`/api/assignments/${item.id}/submission?student_id=${getCurrentUserId()}`);
      const result = await response.json();
      if (!response.ok || !result.submission) return;
      const current = submissionStates.get(item.id) || {};
      submissionStates.set(item.id, {
        ...current,
        fileName: result.submission.file_name,
        linkTitle: result.submission.submission_url ? result.submission.file_name : '',
        submissionUrl: result.submission.submission_url || '',
        submissionKind: result.submission.submission_kind || '',
        submitted: true,
        score: result.submission.score,
        feedback: result.submission.feedback || '',
      });
      renderSubmissionPanel(item);
    } catch (error) {
      console.error('Unable to load your submission:', error);
    }
  };

  const loadSubmissionReviews = async (item) => {
    if (!submissionReviewPanel || !submissionReviewList) return;
    const role = JSON.parse(localStorage.getItem('lms_current_user') || '{}').role;
    const canReview = ['dean', 'teacher'].includes(role) && item?.dbTable === 'assignments';
    if (!canReview) {
      submissionReviewPanel.hidden = true;
      return;
    }

    submissionReviewPanel.hidden = false;
    submissionReviewList.innerHTML = '<p class="submission-review-empty">Loading submissions...</p>';
    try {
      const response = await fetch(`/api/assignments/${item.id}/submissions`);
      const submissions = await response.json();
      if (!response.ok) throw new Error(submissions.error || 'Unable to load submissions.');
      submissionReviewList.innerHTML = '';
      if (!submissions.length) {
        submissionReviewList.innerHTML = '<p class="submission-review-empty">No student submissions yet.</p>';
        return;
      }
      submissions.forEach((submission) => {
        const row = document.createElement('div');
        row.className = 'submission-review-item';
        const details = document.createElement('div');
        const student = document.createElement('strong');
        student.textContent = `Student #${submission.student_id}`;
        const timestamp = document.createElement('small');
        timestamp.textContent = `Submitted ${new Date(submission.submitted_at).toLocaleString()}`;
        details.append(student, timestamp);
        const link = document.createElement('a');
        link.href = submission.submission_url || submission.file_path;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = submission.file_name || 'Open file';
        row.append(details, link);
        const controls = document.createElement('div');
        controls.className = 'submission-grading-controls';
        const scoreInput = document.createElement('input');
        scoreInput.type = 'number';
        scoreInput.min = '0';
        const totalPoints = Number.isFinite(Number(item.totalPoints)) ? Number(item.totalPoints) : 100;
        scoreInput.max = String(totalPoints);
        scoreInput.placeholder = `Score (out of ${totalPoints})`;
        scoreInput.value = Number.isInteger(submission.score) ? String(submission.score) : '';
        scoreInput.setAttribute('aria-label', `Score for student ${submission.student_id}`);
        const feedbackInput = document.createElement('textarea');
        feedbackInput.placeholder = 'Feedback (optional)';
        feedbackInput.value = submission.feedback || '';
        feedbackInput.setAttribute('aria-label', `Feedback for student ${submission.student_id}`);
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = 'Save grade';
        saveButton.addEventListener('click', async () => {
          const score = Number(scoreInput.value);
          if (!Number.isInteger(score) || score < 0 || score > totalPoints) {
            window.alert(`Enter a whole-number score from 0 to ${totalPoints}.`);
            return;
          }
          saveButton.disabled = true;
          try {
            const gradeResponse = await fetch(`/api/assignments/${item.id}/submissions/${encodeURIComponent(submission.student_id)}/grade`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ score, feedback: feedbackInput.value.trim() }),
            });
            const gradeResult = await gradeResponse.json();
            if (!gradeResponse.ok) throw new Error(gradeResult.error || 'Unable to save grade.');
            await loadSubmissionReviews(item);
          } catch (error) {
            window.alert(error.message || 'Unable to save grade.');
            saveButton.disabled = false;
          }
        });
        controls.append(scoreInput, feedbackInput, saveButton);
        row.appendChild(controls);
        submissionReviewList.appendChild(row);
      });
    } catch (error) {
      submissionReviewList.innerHTML = `<p class="submission-review-empty">${escapeHtml(error.message || 'Unable to load submissions.')}</p>`;
    }
  };

  const showSection = (sectionId) => {
    contentSections.forEach((section) => {
      section.classList.toggle('active', section.id === sectionId);
    });
    updateClassesDashboardActions(sectionId);
  };

  const switchToStreamView = () => {
    showClassTab(streamContentArea);
    if (tabDetailBtn) {
      tabDetailBtn.hidden = true;
      tabDetailBtn.setAttribute('aria-selected', 'false');
    }
    if (tabStreamBtn) {
      tabStreamBtn.classList.add('active');
      tabStreamBtn.setAttribute('aria-selected', 'true');
    }
    if (tabRecordBtn) {
      tabRecordBtn.classList.remove('active');
      tabRecordBtn.setAttribute('aria-selected', 'false');
    }
  };

  const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const getRecordScore = (studentId, assignmentId) => classRecordData?.scores.find((score) => (
    String(score.student_id) === String(studentId) && Number(score.assignment_id) === Number(assignmentId)
  ))?.score;

  const renderClassRecord = () => {
    if (!classRecordHead || !classRecordBody || !classRecordData) return;
    const { students, assignments } = classRecordData;
    if (activeRecordTab === 'roster') {
      classRecordTitle.textContent = 'Enrolled Class List';
      classRecordDescription.textContent = 'Official roster of students enrolled in this class.';
      classRecordHead.innerHTML = '<tr><th>#</th><th>Student ID</th><th>Student name</th><th>Academic year</th><th>Year level</th></tr>';
      classRecordBody.innerHTML = students.length
        ? students.map((student, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.student_name)}</td><td>${escapeHtml(student.academic_year || '—')}</td><td>${escapeHtml(student.year_level || '—')}</td></tr>`).join('')
        : '<tr><td class="record-empty" colspan="5">No students are enrolled in this class yet.</td></tr>';
      return;
    }

    classRecordTitle.textContent = 'Class Record & Grading';
    classRecordDescription.textContent = 'Review recorded grades across all class assignments.';
    classRecordHead.innerHTML = `<tr><th>Student ID</th><th>Student name</th>${assignments.map((assignment) => `<th>${escapeHtml(assignment.title)} (${assignment.total_points || 100})</th>`).join('')}<th>Final grade</th></tr>`;
    classRecordBody.innerHTML = students.length
      ? students.map((student) => {
        const graded = assignments.map((assignment) => ({
          score: getRecordScore(student.student_id, assignment.assignment_id),
          total: Number(assignment.total_points) || 100,
        })).filter(({ score }) => Number.isFinite(Number(score)));
        const finalGrade = assignments.length && graded.length === assignments.length
          ? `${Math.round(graded.reduce((sum, { score, total }) => sum + (Number(score) / total) * 100, 0) / graded.length)}%`
          : 'Incomplete';
        return `<tr><td>${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.student_name)}</td>${assignments.map((assignment) => {
          const score = getRecordScore(student.student_id, assignment.assignment_id);
          return `<td>${Number.isFinite(Number(score)) ? `${escapeHtml(score)} / ${assignment.total_points || 100}` : 'Not graded'}</td>`;
        }).join('')}<td><strong>${finalGrade}</strong></td></tr>`;
      }).join('')
      : `<tr><td class="record-empty" colspan="${assignments.length + 3}">No students are enrolled in this class yet.</td></tr>`;
  };

  const openClassRecord = async () => {
    if (!activeCourseId || !canManageClassWork()) return;
    showClassTab(classRecordView);
    tabStreamBtn?.classList.remove('active');
    tabDetailBtn?.setAttribute('aria-selected', 'false');
    tabRecordBtn?.classList.add('active');
    tabRecordBtn?.setAttribute('aria-selected', 'true');
    await renderClassRecordPro(activeCourseId, { role: localStorage.getItem('lms_user_role') || 'instructor', userId: getCurrentUserId() }, document.getElementById('crRoot'), detailClassTitle?.textContent);
    scrollToClassView(classRecordView);
    return;
    classRecordHead.innerHTML = '';
    classRecordBody.innerHTML = '<tr><td class="record-empty">Loading class record…</td></tr>';
    try {
      const response = await fetch(`/api/courses/${activeCourseId}/record`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load the class record.');
      classRecordData = result;
      renderClassRecord();
    } catch (error) {
      classRecordBody.innerHTML = `<tr><td class="record-empty">${escapeHtml(error.message || 'Unable to load the class record.')}</td></tr>`;
    }
  };

  const exportCurrentClassRecord = () => {
    if (!classRecordData) return;
    const { students, assignments } = classRecordData;
    const isRoster = activeRecordTab === 'roster';
    const rows = isRoster
      ? [['Student ID', 'Student name', 'Academic year', 'Year level'], ...students.map((student) => [student.student_id, student.student_name, student.academic_year || '', student.year_level || ''])]
      : [['Student ID', 'Student name', ...assignments.map((assignment) => `${assignment.title} (${assignment.total_points || 100})`), 'Final grade'], ...students.map((student) => {
        const scores = assignments.map((assignment) => getRecordScore(student.student_id, assignment.assignment_id));
        const allGraded = assignments.length > 0 && scores.every((score) => Number.isFinite(Number(score)));
        const final = allGraded ? `${Math.round(scores.reduce((sum, score, index) => sum + (Number(score) / (Number(assignments[index].total_points) || 100)) * 100, 0) / scores.length)}%` : 'Incomplete';
        return [student.student_id, student.student_name, ...scores.map((score, index) => Number.isFinite(Number(score)) ? `${score} / ${assignments[index].total_points || 100}` : 'Not graded'), final];
      })];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = isRoster ? 'class-roster.csv' : 'class-record.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const openItemDetail = (item) => {
    if (!item || !streamContentArea || !itemDetailView) return;
    const title = document.getElementById('detailItemTitle');
    const meta = document.getElementById('detailItemMeta');
    const description = document.getElementById('detailItemDescription');
    const icon = document.getElementById('detailItemIcon');
    const fileContainer = document.getElementById('detailFileContainer');
    const itemType = String(item.type || 'Lesson').toLowerCase();
    selectedWorkItem = item;
    if (submissionAddMenu) submissionAddMenu.hidden = true;
    if (submissionLinkForm) submissionLinkForm.hidden = true;
    if (classCommentsHeading) classCommentsHeading.textContent = `Comments on this ${item.type || 'class work'}`;
    setClassCommentMessage();
    if (classCommentInput) classCommentInput.value = '';
    loadClassComments(activeCourseId, item);
    renderSubmissionPanel(item);
    loadStudentSubmission(item);
    loadSubmissionReviews(item);
    const iconData = itemType === 'quiz'
      ? { symbol: '\u{1F4DD}', className: 'quiz' }
      : itemType === 'activity'
        ? { symbol: '\u{1F4CB}', className: 'activity' }
        : { symbol: '\u{1F4D6}', className: 'lesson' };

    if (title) title.textContent = item.title;
    if (meta) meta.textContent = item.detail || `${item.type || 'Class work'}`;
    if (description) {
      description.hidden = !item.description;
      description.textContent = item.description || '';
    }
    if (icon) {
      icon.textContent = iconData.symbol;
      icon.className = `detail-item-icon ${iconData.className}`;
    }
    if (fileContainer) {
      fileContainer.innerHTML = '';
      if (item.url) {
        const fileCard = document.createElement('button');
        fileCard.type = 'button';
        fileCard.className = 'detail-file-card';
        fileCard.innerHTML = `<span class="detail-file-preview">PDF / DOC</span><span><strong>${escapeHtml(item.title)}</strong><small>Click to view file &nearr;</small></span>`;
        fileCard.addEventListener('click', () => window.open(item.url, '_blank', 'noopener'));
        fileContainer.appendChild(fileCard);
      } else {
        fileContainer.textContent = 'No attached document for this item.';
      }
    }
    showClassTab(itemDetailView);
    scrollToClassView(itemDetailView);
    if (tabDetailBtn) {
      tabDetailBtn.hidden = false;
      tabDetailBtn.textContent = item.title;
      tabDetailBtn.setAttribute('aria-selected', 'true');
    }
    if (tabStreamBtn) {
      tabStreamBtn.classList.remove('active');
      tabStreamBtn.setAttribute('aria-selected', 'false');
    }
  };

  tabStreamBtn?.addEventListener('click', switchToStreamView);
  classMembersBtn?.addEventListener('click', openClassMembers);
  backToStreamBtn?.addEventListener('click', switchToStreamView);
  tabDetailBtn?.addEventListener('click', () => openItemDetail(selectedWorkItem));
  tabRecordBtn?.addEventListener('click', openClassRecord);
  document.querySelectorAll('[data-record-tab]').forEach((button) => button.addEventListener('click', () => {
    activeRecordTab = button.dataset.recordTab;
    document.querySelectorAll('[data-record-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    renderClassRecord();
    scrollToClassView(classRecordView);
  }));
  exportClassRecordBtn?.addEventListener('click', exportCurrentClassRecord);
  addSubmissionFileBtn?.addEventListener('click', () => {
    if (submissionLinkForm) submissionLinkForm.hidden = true;
    if (submissionAddMenu) submissionAddMenu.hidden = !submissionAddMenu.hidden;
  });
  submissionAddMenu?.querySelectorAll('[data-submission-method]').forEach((option) => option.addEventListener('click', () => {
    const method = option.dataset.submissionMethod;
    submissionAddMenu.hidden = true;
    if (method === 'upload') {
      submissionFileInput?.click();
      return;
    }
    if (method === 'link') {
      if (submissionLinkForm && submissionLinkUrl) {
        submissionLinkForm.hidden = false;
        submissionLinkUrl.value = '';
        submissionLinkUrl.focus();
      }
      return;
    }
  }));
  cancelSubmissionLinkBtn?.addEventListener('click', () => {
    if (submissionLinkForm) submissionLinkForm.hidden = true;
    if (submissionLinkUrl) submissionLinkUrl.value = '';
  });
  saveSubmissionLinkBtn?.addEventListener('click', () => {
    if (!selectedWorkItem || !submissionLinkUrl) return;
    const rawUrl = submissionLinkUrl.value.trim();
    if (!rawUrl) return window.alert('Paste a link before attaching it.');
    let parsedUrl = null;
    const isInternalPath = rawUrl.startsWith('/') && !rawUrl.startsWith('//');
    try { parsedUrl = new URL(rawUrl, window.location.origin); } catch (_) { /* Invalid URL. */ }
    if (!isInternalPath && (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol))) {
      return window.alert('Use an internal LMS path or a valid http:// or https:// link.');
    }
    const submissionUrl = isInternalPath ? rawUrl : parsedUrl.href;
    let linkTitle = parsedUrl.hostname;
    if (isInternalPath) {
      const finalPathPart = rawUrl.split(/[?#]/)[0].split('/').filter(Boolean).pop() || 'Internal LMS link';
      try { linkTitle = decodeURIComponent(finalPathPart); } catch (_) { linkTitle = finalPathPart; }
    }
    const current = submissionStates.get(selectedWorkItem.id) || { submitted: false };
    submissionStates.set(selectedWorkItem.id, {
      ...current,
      file: null,
      fileName: '',
      linkTitle: linkTitle.slice(0, 200),
      submissionUrl,
      submissionKind: 'link',
    });
    if (submissionFileInput) submissionFileInput.value = '';
    if (submissionLinkForm) submissionLinkForm.hidden = true;
    renderSubmissionPanel(selectedWorkItem);
  });
  submissionFileInput?.addEventListener('change', () => {
    const file = submissionFileInput.files?.[0];
    if (!file || !selectedWorkItem) return;
    const current = submissionStates.get(selectedWorkItem.id) || { submitted: false };
    submissionStates.set(selectedWorkItem.id, { ...current, file, fileName: file.name, linkTitle: '', submissionUrl: '', submissionKind: '' });
    renderSubmissionPanel(selectedWorkItem);
  });
  submitWorkBtn?.addEventListener('click', async () => {
    if (!selectedWorkItem) return;
    const current = submissionStates.get(selectedWorkItem.id) || { file: null, submitted: false };
    if (!current.submitted && !current.file && !current.submissionUrl) {
      window.alert('Please add a file or link before submitting your work.');
      return;
    }
    if (!current.submitted) {
      const confirmed = await showConfirmationDialog({
        title: 'Submit this assignment?',
        message: 'Please confirm that your work is ready to be submitted.',
        confirmLabel: 'Submit assignment',
      });
      if (!confirmed) return;
    }
    submitWorkBtn.disabled = true;
    try {
      if (current.submitted) {
        const response = await fetch(`/api/assignments/${selectedWorkItem.id}/submission?student_id=${getCurrentUserId()}`, {
          method: 'DELETE',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to unsubmit your work.');
        submissionStates.set(selectedWorkItem.id, { ...current, file: null, fileName: '', linkTitle: '', submissionUrl: '', submissionKind: '', submitted: false, score: null, feedback: '' });
      } else {
        let requestOptions;
        if (current.file) {
          const formData = new FormData();
          formData.append('student_id', getCurrentUserId());
          formData.append('file', current.file);
          requestOptions = { method: 'POST', body: formData };
        } else {
          requestOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              student_id: getCurrentUserId(),
              submission_url: current.submissionUrl,
              submission_kind: current.submissionKind,
              file_name: current.linkTitle,
            }),
          };
        }
        const response = await fetch(`/api/assignments/${selectedWorkItem.id}/submission`, requestOptions);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to submit your work.');
        submissionStates.set(selectedWorkItem.id, { ...current, submitted: true });
      }
      renderSubmissionPanel(selectedWorkItem);
    } catch (error) {
      window.alert(error.message || 'Unable to update your submission.');
    } finally {
      submitWorkBtn.disabled = false;
    }
  });

  const renderClassWork = async (materials = [], assignments = []) => {
    if (!classWorkList) return;
    classWorkList.innerHTML = '';
    const currentRole = String(JSON.parse(localStorage.getItem('lms_current_user') || '{}').role || 'student').toLowerCase();
    const isStudent = currentRole === 'student';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const assignmentsWithStatus = isStudent ? await Promise.all(assignments.map(async (assignment) => {
      try {
        const response = await fetch(`/api/assignments/${assignment.assignment_id}/submission?student_id=${encodeURIComponent(getCurrentUserId())}`);
        const data = await response.json();
        return { ...assignment, isSubmitted: response.ok && Boolean(data.submission) };
      } catch (_) { return { ...assignment, isSubmitted: false }; }
    })) : assignments;
    const work = [
      ...materials.map((material) => ({
        id: material.material_id,
        dbTable: 'materials',
        type: 'Lesson',
        title: material.title || material.file_name || 'Untitled lesson',
        description: material.description || '',
        detail: material.file_size || 'PDF document',
        url: material.pdf_url
          ? (String(material.pdf_url).startsWith('/uploads/')
            ? `/api/materials/${encodeURIComponent(material.material_id)}/preview`
            : material.pdf_url)
          : null,
      })),
      ...assignmentsWithStatus.map((assignment) => {
        const dueDate = assignment.due_date ? new Date(`${String(assignment.due_date).slice(0, 10)}T00:00:00`) : null;
        const isMissing = isStudent && !assignment.isSubmitted && dueDate && dueDate < today && ['activity', 'quiz'].includes(String(assignment.type || '').toLowerCase());
        return ({
        id: assignment.assignment_id,
        dbTable: 'assignments',
        type: assignment.type || 'Activity',
        title: assignment.title || 'Untitled activity',
        description: assignment.description || '',
        totalPoints: assignment.total_points,
        dueDate: assignment.due_date,
        missing: isMissing,
        detail: `${isMissing ? 'MISSING — ' : ''}${assignment.due_date ? `Due ${new Date(assignment.due_date).toLocaleDateString()}` : 'No due date'}${assignment.total_points ? ` · ${assignment.total_points} pts` : ''}`,
        url: assignment.file_url
          ? (String(assignment.file_url).startsWith('/uploads/')
            ? `/api/assignments/${encodeURIComponent(assignment.assignment_id)}/preview`
            : assignment.file_url)
          : null,
        });
      }),
    ];
    currentCourseData = { materials, assignments };

    if (!work.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = canManageClassWork()
        ? 'No class work uploaded yet. Click Add Work to add a lesson, activity, or quiz.'
        : 'No class work has been uploaded yet.';
      classWorkList.appendChild(empty);
      return;
    }

    work.forEach((item) => {
      const row = document.createElement('li');
      row.className = `class-work-item${item.missing ? ' missing-work' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open ${item.title}`);
      row.addEventListener('click', () => openItemDetail(item));
      row.addEventListener('keydown', (event) => {
        if (event.target !== row) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openItemDetail(item);
        }
      });
      const copy = document.createElement('div');
      const type = document.createElement('span');
      type.className = 'work-type';
      type.textContent = item.missing ? `Missing ${item.type}` : item.type;
      if (item.missing) type.style.color = '#c62828';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('p');
      detail.textContent = item.detail;
      if (item.missing) { detail.style.color = '#c62828'; detail.style.fontWeight = '800'; }
      copy.append(type, title, detail);
      row.appendChild(copy);
      const actions = document.createElement('div');
      actions.className = 'work-item-actions';
      if (item.url) {
        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'ghost-btn';
        openButton.textContent = 'Open';
        openButton.addEventListener('click', (event) => {
          event.stopPropagation();
          window.open(item.url, '_blank', 'noopener');
        });
        actions.appendChild(openButton);
      }
      if (canManageClassWork()) {
      const menuButton = document.createElement('button');
      menuButton.type = 'button';
      menuButton.className = 'work-menu-button';
      menuButton.setAttribute('aria-label', `Actions for ${item.title}`);
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.textContent = '⋮';
      const menu = document.createElement('div');
      menu.className = 'work-dropdown-menu';
      menu.hidden = true;
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-work-button';
      deleteButton.textContent = 'Delete';
      menu.appendChild(deleteButton);
      menuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.work-dropdown-menu').forEach((otherMenu) => {
          if (otherMenu !== menu) otherMenu.hidden = true;
        });
        menu.hidden = !menu.hidden;
        menuButton.setAttribute('aria-expanded', String(!menu.hidden));
      });
      deleteButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        menu.hidden = true;
        menuButton.setAttribute('aria-expanded', 'false');
        if (!await showActionConfirmationToast({ message: `Delete "${item.title}"? This cannot be undone.` })) return;
        deleteButton.disabled = true;
        try {
          const response = await fetch(`/api/${item.dbTable}/${item.id}`, { method: 'DELETE' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Failed to delete class work.');
          const activeCard = document.querySelector(`.course-card[data-course-id="${activeCourseId}"]`);
          if (activeCard) await openCourseDetail(activeCard);
        } catch (error) {
          showToast(error.message || 'Failed to delete class work.');
          deleteButton.disabled = false;
        }
      });
      actions.append(menuButton, menu);
      }
      row.appendChild(actions);
      classWorkList.appendChild(row);
    });
  };

  document.addEventListener('click', () => {
    document.querySelectorAll('.work-dropdown-menu').forEach((menu) => {
      menu.hidden = true;
    });
  });

  const renderUpcomingWork = (assignments = []) => {
    if (!upcomingList) return;
    upcomingList.innerHTML = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(today);
    deadline.setDate(deadline.getDate() + 7);

    const upcoming = assignments
      .map((assignment) => ({
        ...assignment,
        due: assignment.due_date ? new Date(`${assignment.due_date}T00:00:00`) : null,
      }))
      .filter((assignment) => assignment.due && !Number.isNaN(assignment.due.getTime()) && assignment.due >= today && assignment.due <= deadline)
      .sort((first, second) => first.due - second.due);

    if (!upcoming.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No upcoming deadlines this week.';
      upcomingList.appendChild(empty);
      return;
    }

    upcoming.forEach((assignment) => {
      const daysRemaining = Math.round((assignment.due - today) / 86400000);
      const urgent = daysRemaining <= 1;
      const timeLabel = daysRemaining === 0 ? 'Due today' : daysRemaining === 1 ? 'Due tomorrow' : `Due in ${daysRemaining} days`;
      const row = document.createElement('li');
      row.className = `upcoming-item${urgent ? ' urgent' : ''}`;
      const meta = document.createElement('div');
      const type = document.createElement('span');
      type.className = 'work-type';
      type.textContent = assignment.type || 'Activity';
      const timing = document.createElement('span');
      timing.className = 'deadline-label';
      timing.textContent = timeLabel;
      meta.append(type, timing);
      const title = document.createElement('strong');
      title.textContent = assignment.title || 'Untitled work';
      const detail = document.createElement('p');
      detail.textContent = `${assignment.due.toLocaleDateString()}${assignment.total_points ? ` · ${assignment.total_points} pts` : ''}`;
      row.append(meta, title, detail);
      upcomingList.appendChild(row);
    });
  };

  const openCourseDetail = async (card) => {
    if (!card || !classDetailSection) return;
    const courseId = Number(card.dataset.courseId);
    if (!courseId) return;
    activeCourseId = courseId;
    setClassCommentMessage();
    if (classCommentInput) classCommentInput.value = '';
    if (tabRecordBtn) tabRecordBtn.hidden = !canManageClassWork();

    const fillDetailList = (listElement, items, emptyMessage) => {
      if (!listElement) return;
      listElement.innerHTML = '';
      const entries = items.length ? items : [emptyMessage];
      entries.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        listElement.appendChild(li);
      });
    };

    const fillClickableDetailList = (listElement, items, emptyMessage, labelFor, onClick) => {
      if (!listElement) return;
      listElement.innerHTML = '';

      if (!items.length) {
        fillDetailList(listElement, [], emptyMessage);
        return;
      }

      items.forEach((item) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghost-btn';
        button.textContent = labelFor(item);
        button.addEventListener('click', () => onClick(item));
        li.appendChild(button);
        listElement.appendChild(li);
      });
    };

    detailClassCategory.textContent = 'Loading class...';
    detailClassTitle.textContent = card.dataset.courseTitle || 'Selected Class';
    detailClassSubtitle.textContent = 'Loading lessons, assignments, and announcements...';
    fillDetailList(detailMaterialsList, ['Loading...'], 'No materials uploaded yet.');
    fillDetailList(detailResourcesList, ['Loading...'], 'No resources uploaded yet.');
    fillDetailList(detailAnnouncementsList, ['Loading...'], 'No announcements posted yet.');
    fillDetailList(detailUpcomingList, ['Loading...'], 'No assignments due.');
    fillDetailList(detailAssignmentsList, ['Loading...'], 'No assignments due.');
    fillDetailList(detailActivitiesList, ['Loading...'], 'No quizzes or activities available.');
      renderClassWork();
      renderUpcomingWork();
      switchToStreamView();
      showSection('classDetail');
      scrollToClassView(classDetailSection);

    try {
      const response = await fetch(`/api/courses/${courseId}/full-details`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load this class.');

      const {
        course,
        materials = [],
        resources = [],
        assignments = [],
        announcements = [],
      } = data;
      detailClassCategory.textContent = course.code || 'Class';
      detailClassTitle.textContent = course.title || 'Selected Class';
      detailClassSubtitle.textContent = course.status || 'Active session';
      if (detailClassCode) detailClassCode.textContent = course.class_code || 'Not available';
      renderClassWork(materials, assignments);
      renderUpcomingWork(assignments);
      fillClickableDetailList(
        detailMaterialsList,
        materials,
        'No materials uploaded yet.',
        (material) => `PDF: ${material.title || material.file_name || 'Untitled document'}`,
        (material) => {
          if (material.pdf_url) window.open(
            String(material.pdf_url).startsWith('/uploads/')
              ? `/api/materials/${encodeURIComponent(material.material_id)}/preview`
              : material.pdf_url,
            '_blank',
            'noopener'
          );
        }
      );
      fillClickableDetailList(
        detailResourcesList,
        resources,
        'No resource links uploaded yet.',
        (resource) => resource.title || resource.link_url || 'Resource link',
        (resource) => {
          if (resource.link_url) window.open(resource.link_url, '_blank', 'noopener');
        }
      );
      announcements.forEach((announcement) => {
        announcement.description ||= announcement.content;
      });
      fillDetailList(detailAnnouncementsList, announcements.map((announcement) => `${announcement.title || 'Class update'} — ${announcement.description || 'Important class update.'}`), 'No announcements posted yet.');
      fillDetailList(detailUpcomingList, assignments.map((assignment) => {
        const dueDate = assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : 'No due date';
        return `${assignment.title || 'Assignment'} — Due: ${dueDate}`;
      }), 'No quizzes or assignments due.');
      fillClickableDetailList(
        detailUpcomingList,
        assignments,
        'No quizzes or assignments due.',
        (assignment) => {
          const dueDate = assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : 'No due date';
          return `${assignment.type || 'Assignment'}: ${assignment.title || 'Untitled'} (Due: ${dueDate})`;
        },
        (assignment) => {
          const dueDate = assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : 'No due date';
          window.alert(`Opening ${assignment.type || 'assignment'}: ${assignment.title || 'Untitled'}\nDue date: ${dueDate}`);
        }
      );
      const activityTypes = new Set(['quiz', 'activity']);
      const classAssignments = assignments.filter((assignment) => !activityTypes.has(String(assignment.type || '').toLowerCase()));
      const activities = assignments.filter((assignment) => activityTypes.has(String(assignment.type || '').toLowerCase()));
      const openAssessment = (assessment) => {
        const dueDate = assessment.due_date ? new Date(assessment.due_date).toLocaleDateString() : 'No due date';
        window.alert(`Opening ${assessment.type || 'assignment'}: ${assessment.title || 'Untitled'}\nDue date: ${dueDate}`);
      };
      const assessmentLabel = (assessment) => {
        const dueDate = assessment.due_date ? `Due ${new Date(assessment.due_date).toLocaleDateString()}` : 'No due date';
        const points = assessment.total_points ? ` · ${assessment.total_points} pts` : '';
        return `${assessment.title || 'Untitled'} — ${dueDate}${points}`;
      };
      fillClickableDetailList(detailAssignmentsList, classAssignments, 'No assignments due.', assessmentLabel, openAssessment);
      fillClickableDetailList(detailActivitiesList, activities, 'No quizzes or activities available.', assessmentLabel, openAssessment);
    } catch (error) {
      detailClassSubtitle.textContent = error.message || 'Unable to load this class.';
      fillDetailList(detailMaterialsList, [], 'No materials available.');
      fillDetailList(detailResourcesList, [], 'No resources available.');
      fillDetailList(detailAnnouncementsList, [], 'No announcements available.');
      fillDetailList(detailUpcomingList, [], 'No assignments available.');
      fillDetailList(detailAssignmentsList, [], 'No assignments available.');
      fillDetailList(detailActivitiesList, [], 'No quizzes or activities available.');
      renderClassWork();
      renderUpcomingWork();
    }
    return;

    const category = card.dataset.courseCategory || 'Class';
    const title = card.dataset.courseTitle || 'Selected Class';
    const description = card.dataset.courseDescription || 'Open the class to view its materials, announcements, and upcoming work.';
    const materials = card.dataset.classMaterials ? JSON.parse(card.dataset.classMaterials) : [];
    const resources = card.dataset.classResources ? JSON.parse(card.dataset.classResources) : [];
    const announcements = card.dataset.classAnnouncements ? JSON.parse(card.dataset.classAnnouncements) : [];
    const upcoming = card.dataset.classUpcoming ? JSON.parse(card.dataset.classUpcoming) : [];

    detailClassCategory.textContent = category;
    detailClassTitle.textContent = title;
    detailClassSubtitle.textContent = description;
    // show class join code in the detail header (if present)
    if (detailClassCode) detailClassCode.textContent = card.dataset.classCode || '—';

    const fillList = (listElement, items) => {
      if (!listElement) return;
      listElement.innerHTML = '';
      items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        listElement.appendChild(li);
      });
      if (items.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'No items to show yet.';
        listElement.appendChild(empty);
      }
    };

    fillList(detailMaterialsList, materials);
    fillList(detailResourcesList, resources);
    fillList(detailAnnouncementsList, announcements);
    fillList(detailUpcomingList, upcoming);

    showSection('classDetail');
  };

  const setWorkTypeFields = () => {
    const isAssessment = ['Activity', 'Quiz'].includes(workType?.value);
    assessmentFields?.classList.toggle('hidden', !isAssessment);
  };

  const updateDropZoneUI = (file) => {
    if (dropZoneText) dropZoneText.textContent = file ? `Selected file: ${file.name}` : 'Drag & drop your file here, or Browse';
  };

  const selectDroppedFile = (files) => {
    if (!files?.length) return;
    const file = files[0];
    const fileExtension = `.${file.name.split('.').pop().toLowerCase()}`;
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.zip'];
    if (!allowedExtensions.includes(fileExtension)) {
      if (uploadFormMessage) uploadFormMessage.textContent = 'Use a PDF, DOC/DOCX, PPT/PPTX, PNG, or ZIP file.';
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      if (uploadFormMessage) uploadFormMessage.textContent = 'Files must be 25 MB or smaller.';
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    if (uploadFormMessage) uploadFormMessage.textContent = '';
    updateDropZoneUI(file);
  };

  const closeUploadModal = () => {
    uploadModal?.classList.add('hidden');
    if (uploadFormMessage) uploadFormMessage.textContent = '';
    updateDropZoneUI();
  };

  addWorkBtn?.addEventListener('click', () => {
    if (!canManageClassWork()) return;
    if (!activeCourseId) return;
    uploadForm?.reset();
    setWorkTypeFields();
    uploadModal?.classList.remove('hidden');
  });
  closeModalBtn?.addEventListener('click', closeUploadModal);
  cancelUploadBtn?.addEventListener('click', closeUploadModal);
  uploadModal?.addEventListener('click', (event) => {
    if (event.target === uploadModal) closeUploadModal();
  });
  workType?.addEventListener('change', setWorkTypeFields);
  dropZone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput?.click(); }
  });
  ['dragenter', 'dragover'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  }));
  dropZone?.addEventListener('drop', (event) => selectDroppedFile(event.dataTransfer.files));
  fileInput?.addEventListener('change', (event) => selectDroppedFile(event.target.files));

  uploadForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManageClassWork()) {
      if (uploadFormMessage) uploadFormMessage.textContent = 'Only Deans and Instructors can add class work.';
      return;
    }
    if (!activeCourseId) return;

    const workTitleField = document.getElementById('workTitle');
    if (!workTitleField?.value.trim()) {
      workTitleField?.classList.add('required-missing');
      workTitleField?.setAttribute('aria-invalid', 'true');
      if (uploadFormMessage) {
        uploadFormMessage.textContent = 'Please enter a title for this class work.';
        uploadFormMessage.classList.add('error');
      }
      workTitleField?.focus();
      return;
    }
    workTitleField.classList.remove('required-missing');
    workTitleField.setAttribute('aria-invalid', 'false');
    uploadFormMessage?.classList.remove('error');

    const saveWorkBtn = document.getElementById('saveWorkBtn');
    const formData = new FormData();
    formData.append('type', workType.value);
    formData.append('title', document.getElementById('workTitle').value.trim());
    formData.append('description', document.getElementById('workDescription').value.trim());
    formData.append('file_link', document.getElementById('fileUrl').value.trim());
    formData.append('dueDate', document.getElementById('dueDate').value || '');
    formData.append('totalPoints', document.getElementById('totalPoints').value);
    if (fileInput?.files[0]) formData.append('file', fileInput.files[0]);

    try {
      saveWorkBtn.disabled = true;
      saveWorkBtn.textContent = 'Uploading...';
      const response = await fetch(`/api/courses/${activeCourseId}/classwork`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to upload class work.');

      closeUploadModal();
      const activeCard = document.querySelector(`.course-card[data-course-id="${activeCourseId}"]`);
      if (activeCard) await openCourseDetail(activeCard);
    } catch (error) {
      if (uploadFormMessage) uploadFormMessage.textContent = error.message || 'Failed to upload class work.';
    } finally {
      saveWorkBtn.disabled = false;
      saveWorkBtn.textContent = 'Upload';
    }
  });

  document.getElementById('workTitle')?.addEventListener('input', (event) => {
    const field = event.currentTarget;
    if (!field.value.trim()) return;
    field.classList.remove('required-missing');
    field.setAttribute('aria-invalid', 'false');
    uploadFormMessage?.classList.remove('error');
  });

  classesContainer?.addEventListener('click', async (event) => {
    const openClassButton = event.target.closest('[data-open-class]');
    const menuButton = event.target.closest('[data-course-menu]');
    const actionButton = event.target.closest('[data-course-action]');

    if (openClassButton) {
      event.stopPropagation();
      openCourseDetail(openClassButton.closest('.course-card'));
      return;
    }

    if (menuButton) {
      event.stopPropagation();
      const menu = menuButton.nextElementSibling;
      document.querySelectorAll('.card-dropdown-menu').forEach((otherMenu) => {
        if (otherMenu !== menu) {
          otherMenu.hidden = true;
          otherMenu.previousElementSibling?.setAttribute('aria-expanded', 'false');
        }
      });
      if (menu) {
        menu.hidden = !menu.hidden;
        menuButton.setAttribute('aria-expanded', String(!menu.hidden));
      }
      return;
    }

    if (actionButton) {
      event.stopPropagation();
      const card = actionButton.closest('.course-card');
      const courseId = Number(card?.dataset.courseId);
      const action = actionButton.dataset.courseAction;
      const currentRole = String(localStorage.getItem('lms_user_role') || 'student').toLowerCase();
      const isDean = currentRole === 'dean';
      const isStaff = isDean || ['teacher', 'instructor'].includes(currentRole);
      const menu = actionButton.closest('.card-dropdown-menu');
      if (menu) {
        menu.hidden = true;
        menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
      }

      if (action === 'unenroll' && (isDean || ['teacher', 'instructor'].includes(currentRole))) {
        const confirmed = await showActionConfirmationToast({
          title: 'Unenroll from this class?',
          message: isDean
            ? 'This class will be removed from your dean dashboard. The assigned instructor and enrolled students will keep their access.'
            : 'This class will be removed from your instructor dashboard and your instructor assignment will be cleared.',
          confirmLabel: 'Unenroll',
        });
        if (confirmed) unenrollStaffFromCourse(courseId);
      } else if (action === 'unenroll' && !isDean) {
        const confirmed = await showActionConfirmationToast({
          title: 'Unenroll from this class?',
          message: 'You will lose access to this class and its coursework.',
          confirmLabel: 'Unenroll',
        });
        if (confirmed) manageCourseEnrollment(courseId);
      }

      if (isStaff && (action === 'archive' || action === 'activate')) {
        const confirmed = await showActionConfirmationToast({
          title: action === 'archive' ? 'Archive this class?' : 'Restore this class?',
          message: action === 'archive' ? 'The class will be marked as archived.' : 'The class will return to the active classes list.',
          confirmLabel: action === 'archive' ? 'Archive' : 'Restore',
        });
        if (confirmed) updateCourseCardStatus(courseId, action === 'archive' ? 'Archived' : 'Active');
      }

      if (isStaff && action === 'edit') openEditClassCard(card);

      if (action === 'delete' && isDean) {
        const confirmed = await showConfirmationDialog({
          title: 'Delete this class?',
          message: 'This permanently removes the class and its related content. This action cannot be undone.',
          confirmLabel: 'Delete class',
        });
        if (confirmed) deleteCourse(courseId);
      }
      return;
    }

    const card = event.target.closest('.course-card.clickable');
    if (card) openCourseDetail(card);
  });

  classesContainer?.addEventListener('keydown', (event) => {
    if (event.target.closest('.course-card-menu')) return;
    const card = event.target.closest('.course-card.clickable');
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openCourseDetail(card);
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-course-menu], .card-dropdown-menu')) return;
    document.querySelectorAll('.card-dropdown-menu').forEach((menu) => {
      menu.hidden = true;
      menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
    });
  });

  // copy class code from the detail view
  copyDetailCodeBtn?.addEventListener('click', () => {
    const txt = detailClassCode?.textContent || '';
    if (!txt) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(() => {
        showToast('Class code copied to clipboard.');
      });
    }
  });

  backToClassesBtn?.addEventListener('click', () => {
    showSection('classes');
  });

  heroPrimary?.addEventListener('click', () => {
    openClassModal?.classList.remove('hidden');
  });

  confirmOpenClass?.addEventListener('click', () => {
    const modalText = openClassModal.querySelector('.modal-copy');
    if (modalText) {
      modalText.textContent = 'Opening class dashboard... you can now view lessons, assignments, and resources.';
    }
    setTimeout(() => {
      openClassModal?.classList.add('hidden');
      if (modalText) {
        modalText.textContent = 'This action takes you into the selected class dashboard, where you can access lessons, assignments, and class notes.';
      }
    }, 900);
  });

  viewDetailsBtn?.addEventListener('click', () => {
    viewDetailsModal?.classList.remove('hidden');
  });

  closeDetails?.addEventListener('click', () => {
    viewDetailsModal?.classList.add('hidden');
  });

  closeNotification?.addEventListener('click', () => {
    notificationModal?.classList.add('hidden');
  });

  window.addEventListener('click', (event) => {
    if (
      event.target === joinClassModal ||
      event.target === openClassModal ||
      event.target === viewDetailsModal ||
      event.target === notificationModal ||
      event.target === courseInfoModal
    ) {
      if (event.target === joinClassModal) {
        joinClassModal.classList.add('hidden');
      }
      if (event.target === openClassModal) {
        openClassModal.classList.add('hidden');
      }
      if (event.target === viewDetailsModal) {
        viewDetailsModal.classList.add('hidden');
      }
      if (event.target === notificationModal) {
        notificationModal.classList.add('hidden');
      }
      if (event.target === courseInfoModal) {
        courseInfoModal.classList.add('hidden');
      }
    }
  });
});

async function openNotificationModal() {
  const modal = document.getElementById('notificationModal');
  const button = document.getElementById('notificationBtn');
  if (modal) {
    if (!modal.classList.contains('hidden')) {
      closeNotificationModal();
      return;
    }
    modal.classList.remove('hidden');
    modal.style.display = 'block';
    const buttonBounds = button?.getBoundingClientRect();
    if (buttonBounds) {
      modal.style.top = `${buttonBounds.bottom + 10}px`;
      if (window.innerWidth <= 520) {
        modal.style.left = '12px';
        modal.style.right = '12px';
      } else {
        modal.style.left = 'auto';
        modal.style.right = `${Math.max(12, window.innerWidth - buttonBounds.right)}px`;
      }
    }
    button?.setAttribute('aria-expanded', 'true');
  }

  try {
    const res = await fetch(`/api/notifications/dashboard?user_id=${encodeURIComponent(getCurrentUserId() || '')}`);
    const data = await res.json();
    const summary = data.summary || {};

    const activeClasses = summary.activeClasses ?? 0;
    const assignmentsDue = summary.assignmentsDue ?? 0;
    const events = summary.events ?? 0;
    const resources = summary.resources ?? 0;

    const countActiveClasses = document.getElementById('countActiveClasses');
    const countAssignmentsDue = document.getElementById('countAssignmentsDue');
    const countEvents = document.getElementById('countEvents');
    const countResources = document.getElementById('countResources');
    const notifBadge = document.getElementById('notifBadge');
    const priorityContainer = document.getElementById('priorityAlertsList');
    const systemContainer = document.getElementById('systemAlertsList');

    if (countActiveClasses) countActiveClasses.textContent = activeClasses;
    if (countAssignmentsDue) countAssignmentsDue.textContent = assignmentsDue;
    if (countEvents) countEvents.textContent = events;
    if (countResources) countResources.textContent = resources;
    if (notifBadge) {
      const totalHighlights = (data.priorityAlerts || []).length + (data.systemAlerts || []).length;
      notifBadge.textContent = `${totalHighlights} Highlights`;
    }

    const readKey = `lms_read_notifications_${getCurrentUserId() || 'guest'}`;
    let readIds = [];
    try { readIds = JSON.parse(localStorage.getItem(readKey) || '[]'); } catch (_) { readIds = []; }
    const alerts = [
      ...(Array.isArray(data.priorityAlerts) ? data.priorityAlerts : []).map((item) => ({ ...item, group: 'priority' })),
      ...(Array.isArray(data.systemAlerts) ? data.systemAlerts : []).map((item) => ({ ...item, group: 'system' })),
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const alertId = (item) => String(item.notification_id ?? item.id ?? `${item.group}:${item.title || ''}:${item.created_at || ''}`);
    const renderAlerts = (items) => items.length ? items.map((item) => {
      const isRead = readIds.includes(alertId(item));
      const actions = isRead
        ? `<details class="notification-action-menu"><summary aria-label="Notification options">⋮</summary><div class="notification-action-options"><button type="button" class="notification-delete-action" data-delete-notification="${escapeHtml(alertId(item))}">Delete notification</button></div></details>`
        : '<span class="notification-action-spacer" aria-hidden="true"></span>';
      return `<div class="notification-alert-row${isRead ? ' is-read' : ''}" data-alert-id="${escapeHtml(alertId(item))}" role="button" tabindex="0" aria-label="Mark ${escapeHtml(item.title || 'notification')} as read"><span class="notification-alert-icon" aria-hidden="true">${item.group === 'priority' ? '◷' : '▤'}</span><div class="notification-alert-copy"><strong>${escapeHtml(item.title || 'Notification')}</strong><span>${escapeHtml(item.message || '')} · ${escapeHtml(formatTimeAgo(item.created_at))}</span></div>${isRead ? '<span class="notification-read-indicator" aria-label="Read">✓</span>' : '<i class="notification-unread-dot" aria-label="Unread"></i>'}${actions}</div>`;
    }).join('') : '<p class="notification-empty">You’re all caught up.</p>';
    const unread = alerts.filter((item) => !readIds.includes(alertId(item)));
    const earlier = alerts.filter((item) => readIds.includes(alertId(item)));
    const notificationHeader = modal?.querySelector('.notification-header');
    if (notificationHeader) {
      let readAll = notificationHeader.querySelector('.notification-read-all');
      if (!readAll) {
        readAll = document.createElement('button'); readAll.type = 'button'; readAll.className = 'notification-read-all';
        notificationHeader.appendChild(readAll);
      }
      readAll.textContent = 'Mark all as read';
      readAll.onclick = () => {
        readIds = alerts.map(alertId);
        localStorage.setItem(readKey, JSON.stringify(readIds));
        if (priorityContainer) priorityContainer.innerHTML = '<p class="notification-empty">You’re all caught up.</p>';
        if (systemContainer) {
          systemContainer.innerHTML = renderAlerts(alerts);
          systemContainer.querySelectorAll('[data-delete-notification]').forEach(attachDeleteHandler);
        }
        bell?.classList.remove('has-unread');
      };
    }

    if (priorityContainer) {
      priorityContainer.innerHTML = renderAlerts(unread);
      const priorityLabel = priorityContainer.parentElement?.querySelector('.notification-group-label');
      if (priorityLabel) priorityLabel.textContent = 'NEW';
    }

    if (systemContainer) {
      systemContainer.innerHTML = renderAlerts(earlier);
      const systemLabel = systemContainer.parentElement?.querySelector('.notification-group-label');
      if (systemLabel) systemLabel.textContent = 'EARLIER';
    }
    const bell = document.getElementById('notificationBtn');
    bell?.classList.toggle('has-unread', unread.length > 0);

    const attachDeleteHandler = (deleteButton) => {
      if (deleteButton.dataset.deleteBound) return;
      deleteButton.dataset.deleteBound = 'true';
      deleteButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        const notificationId = deleteButton.dataset.deleteNotification;
        const confirmed = await showConfirmationDialog({
          title: 'Delete notification?',
          message: 'This notification will be removed from your list.',
          confirmLabel: 'Delete'
        });
        if (!confirmed) return;
        deleteButton.disabled = true;
        try {
          const response = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: getCurrentUserId() || '' })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Could not delete the notification.');
          readIds = readIds.filter((id) => id !== notificationId);
          localStorage.setItem(readKey, JSON.stringify(readIds));
          modal?.classList.add('hidden');
          if (modal) modal.style.display = 'none';
          showToast('Notification deleted.');
          await openNotificationModal();
          refreshNotificationBadge();
        } catch (error) {
          deleteButton.disabled = false;
          showToast(error.message || 'Could not delete the notification.', { type: 'error' });
        }
      });
    };

    modal?.querySelectorAll('.notification-alert-row[data-alert-id]').forEach((row) => {
      const markAsRead = () => {
        const id = row.dataset.alertId;
        if (readIds.includes(id)) return;
        readIds.push(id);
        localStorage.setItem(readKey, JSON.stringify(readIds));
        row.classList.add('is-read');
        row.querySelector('.notification-unread-dot')?.remove();
        row.setAttribute('aria-label', 'Notification marked as read');
        const readIndicator = document.createElement('span');
        readIndicator.className = 'notification-read-indicator';
        readIndicator.setAttribute('aria-label', 'Read');
        readIndicator.textContent = '✓';
        const actionMenu = document.createElement('details');
        actionMenu.className = 'notification-action-menu';
        actionMenu.innerHTML = '<summary aria-label="Notification options">⋮</summary><div class="notification-action-options"><button type="button" class="notification-delete-action">Delete notification</button></div>';
        const actionButton = actionMenu.querySelector('.notification-delete-action');
        actionButton.dataset.deleteNotification = id;
        row.querySelector('.notification-action-spacer')?.replaceWith(readIndicator, actionMenu);
        attachDeleteHandler(actionButton);
        const alert = alerts.find((item) => alertId(item) === id);
        if (alert && systemContainer && row.parentElement !== systemContainer) {
          if (systemContainer.querySelector('.notification-empty')) systemContainer.innerHTML = '';
          systemContainer.appendChild(row);
        }
        const remainingUnread = alerts.some((item) => !readIds.includes(alertId(item)));
        bell?.classList.toggle('has-unread', remainingUnread);
        if (!remainingUnread && priorityContainer) priorityContainer.innerHTML = '<p class="notification-empty">You’re all caught up.</p>';
      };
      row.addEventListener('click', markAsRead);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); markAsRead(); }
      });
    });
    modal?.querySelectorAll('[data-delete-notification]').forEach(attachDeleteHandler);
  } catch (error) {
    console.error('Error opening notification modal:', error);
  }
}

function closeNotificationModal() {
  const modal = document.getElementById('notificationModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  document.getElementById('notificationBtn')?.setAttribute('aria-expanded', 'false');
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (Number.isNaN(date.getTime())) {
    return 'Just now';
  }

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

async function fetchDashboardData(studentId) {
  if (!Number.isInteger(studentId)) {
    await loadDashboardCourses([]);
    return;
  }

  try {
    const response = await fetch(`/api/dashboard/${studentId}`);
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    const { student = {}, hero = {}, stats = {}, courses = [] } = data;
    const loggedInUser = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
    updateWelcomeGreeting(Object.keys(loggedInUser).length ? loggedInUser : student);
    document.getElementById('academicInfo').textContent = '';
    document.getElementById('heroTitle').textContent = hero.title || 'No upcoming announcement';
    document.getElementById('heroCopy').textContent = hero.sub_text || '';
    const activeClasses = stats.activeClasses ?? stats.active_classes ?? 0;
    const assignmentsDue = stats.assignmentsDue ?? stats.assignments_due ?? 0;
    const events = stats.events ?? 0;

    const countActiveClasses = document.getElementById('countActiveClasses');
    const countAssignmentsDue = document.getElementById('countAssignmentsDue');
    const countEvents = document.getElementById('countEvents');
    const countResources = document.getElementById('countResources');
    if (countActiveClasses) countActiveClasses.textContent = activeClasses;
    if (countAssignmentsDue) countAssignmentsDue.textContent = assignmentsDue;
    if (countEvents) countEvents.textContent = events;
    if (countResources) countResources.textContent = 12;
    await loadDashboardCourses(courses);
  } catch (error) {
    console.error('Failed to connect to backend:', error);
    const container = document.getElementById('coursesContainer');
    if (container) container.innerHTML = '<p class="course-loader">Unable to load active classes.</p>';
  }
}

async function loadDashboardCourses(fallbackCourses = []) {
  const role = localStorage.getItem('lms_user_role') || 'student';
  const userId = getCurrentUserId();

  if (!userId) {
    renderCourseCards([]);
    return;
  }

  try {
    const response = await fetch(`/api/courses?role=${role}&user_id=${userId}`);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    renderCourseCards(await response.json());
  } catch (error) {
    console.error('Failed to load role-based courses:', error);
    renderCourseCards(fallbackCourses);
  }
}

async function loadPendingClassRequests() {
  const panel = document.getElementById('classRequestsPanel');
  const list = document.getElementById('classRequestsList');
  if (!panel || !list) return;
  const deanId = String(getCurrentUserId() || '').trim();
  if (!deanId || String(localStorage.getItem('lms_user_role') || '').toLowerCase() !== 'dean') {
    panel.hidden = true;
    return;
  }
  list.innerHTML = '<p class="class-request-empty">Loading class requests...</p>';
  try {
    const response = await fetch(`/api/classes/requests?dean_id=${encodeURIComponent(deanId)}`);
    const requests = await response.json();
    if (!response.ok) throw new Error(requests.error || 'Unable to load class requests.');
    const items = Array.isArray(requests) ? requests : [];
    panel.hidden = items.length === 0;
    const count = document.getElementById('classRequestsCount');
    if (count) count.textContent = `${items.length} pending`;
    list.innerHTML = items.map((request) => `
      <article class="class-request-card">
        <div><p class="eyebrow">${escapeHtml(request.course_code || request.course_name || 'New class')}</p><h4>${escapeHtml(request.title)}</h4><p>Submitted by ${escapeHtml(request.submitted_by_name || request.instructor_name || 'Instructor')}</p></div>
        <button type="button" class="class-request-review-btn" data-review-class-request="${escapeHtml(request.request_id)}">Review details</button>
      </article>`).join('');
    list.querySelectorAll('[data-review-class-request]').forEach((button) => button.addEventListener('click', () => {
      const request = items.find((item) => String(item.request_id) === String(button.dataset.reviewClassRequest));
      if (request) openClassRequestReview(request);
    }));
  } catch (error) {
    panel.hidden = false;
    list.innerHTML = `<p class="class-request-empty error">${escapeHtml(error.message || 'Unable to load class requests.')}</p>`;
  }
}

function openClassRequestReview(request) {
  activeClassCreationRequest = request;
  const details = document.getElementById('classRequestReviewDetails');
  const message = document.getElementById('classRequestReviewMessage');
  const approveButton = document.getElementById('approveClassRequestBtn');
  if (!details) return;
  const rows = [
    ['Class name', request.title], ['Course', request.course_name], ['Course code', request.course_code],
    ['Year', request.year_level], ['Section', request.section], ['Instructor', request.instructor_name || request.submitted_by_name],
    ['Subject notes', request.subject_notes], ['Requested by', request.submitted_by_name],
  ].filter(([, value]) => String(value || '').trim());
  details.innerHTML = rows.map(([label, value]) => `<div class="class-request-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  if (message) { message.textContent = ''; message.classList.remove('error'); }
  if (approveButton) { approveButton.disabled = false; approveButton.textContent = 'Approve and create class'; }
  document.getElementById('classRequestReviewModal')?.classList.remove('hidden');
}

function renderCourseCards(courses) {
  const container = document.getElementById('coursesContainer');
  if (!container) return;
  container.removeAttribute('data-loading');
  const currentRole = String(localStorage.getItem('lms_user_role') || 'student').toLowerCase();
  const isDean = currentRole === 'dean';
  const isInstructor = ['teacher', 'instructor'].includes(currentRole);
  const currentUserId = getCurrentUserId();

  if (!courses.length) {
    container.innerHTML = '<p class="course-loader">No active classes found.</p>';
    return;
  }

  const renderCards = (courseList) => courseList.map((course) => {
    const metadata = parseCourseMetadata(course.sub_text || '', course.code || 'Course');
    const statusText = escapeHtml(course.status || 'Active');
    const courseCodeText = escapeHtml(metadata.courseCode || course.code || 'Course');
    const titleText = escapeHtml(course.title || 'Untitled course');
    const instructorText = escapeHtml(metadata.instructor || 'Instructor not set');
    const yearText = escapeHtml(metadata.year || '');
    const sectionText = escapeHtml(metadata.section || '');
    const subjectText = escapeHtml(metadata.note || '');
    const classCodeText = escapeHtml(course.class_code || 'Not available');
    const isArchived = /archiv/i.test(String(course.status || ''));
    const isAssignedInstructor = isInstructor && String(course.teacher_id || '') === String(currentUserId || '');
    const roleActions = isDean
      ? `<button type="button" data-course-action="unenroll">Unenroll</button><button type="button" data-course-action="${isArchived ? 'activate' : 'archive'}">${isArchived ? 'Unarchive' : 'Archive'}</button><button type="button" data-course-action="edit">Edit</button>`
      : isAssignedInstructor
        ? `<button type="button" data-course-action="unenroll">Unenroll</button><button type="button" data-course-action="${isArchived ? 'activate' : 'archive'}">${isArchived ? 'Unarchive' : 'Archive'}</button><button type="button" data-course-action="edit">Edit</button>`
        : '<button type="button" data-course-action="unenroll">Unenroll</button>';

    const metadataRows = [
      courseCodeText ? `<div class="course-meta-line"><span class="meta-label">Course Code:</span> ${courseCodeText}</div>` : '',
      yearText ? `<div class="course-meta-line"><span class="meta-label">Year:</span> ${yearText}</div>` : '',
      `<div class="course-meta-line"><span class="meta-label">Instructor:</span> ${instructorText}</div>`,
    ].filter(Boolean).join('');

    return `
      <article class="course-card clickable" tabindex="0" role="button"
        data-course-id="${escapeHtml(String(course.course_id || ''))}"
        data-class-status="${/archiv/i.test(String(course.status || '')) ? 'archived' : 'active'}"
        data-course-category="${escapeHtml(course.code || 'Course')}"
        data-course-title="${titleText}"
        data-course-description="${escapeHtml(course.sub_text || '')}"
        data-class-code="${isDean ? classCodeText : ''}"
        data-class-materials="[]" data-class-resources="[]" data-class-announcements="[]" data-class-upcoming="[]">
        <div class="course-title-row">
          <div class="course-title-wrap">
            <p class="eyebrow">${courseCodeText}${sectionText ? ` <span class="course-section-label">· Section ${sectionText}</span>` : ''}</p>
            <h3>${titleText}</h3>
          </div>
          <div class="course-card-actions">
            <span class="tag">${statusText}</span>
            ${roleActions ? `<div class="course-card-menu">
              <button class="three-dots-btn" type="button" data-course-menu aria-label="Class options" aria-expanded="false">&#8942;</button>
              <div class="card-dropdown-menu" hidden>
                ${roleActions}
              </div>
            </div>` : ''}
          </div>
        </div>
        <div class="course-detail-meta">
          ${metadataRows}
          ${subjectText ? `<p class="course-note">${subjectText}</p>` : ''}
        </div>
        <div class="course-card-footer"><span>${isArchived ? 'View archive' : 'Open class'}</span><span aria-hidden="true">→</span></div>
      </article>
    `;
  }).join('');
  if (isDean) {
    const deanClasses = courses.filter((course) => String(course.teacher_id || '') === String(currentUserId || ''));
    const instructorClasses = courses.filter((course) => String(course.teacher_id || '') !== String(currentUserId || ''));
    container.innerHTML = `<h3 class="course-group-heading">Your Classes</h3>${deanClasses.length ? renderCards(deanClasses) : '<p class="course-group-empty">You are not assigned as the instructor for any classes yet.</p>'}<h3 class="course-group-heading">Classes Assigned to Other Instructors</h3>${instructorClasses.length ? renderCards(instructorClasses) : '<p class="course-group-empty">No classes are assigned to other instructors.</p>'}`;
  } else {
    container.innerHTML = renderCards(courses);
  }
  window.applyClassFilters?.();
}

function splitCourseMetadata(value) {
  return String(value || '')
    .split(/\s*(?:•|\u00e2\u20ac\u00a2|\u00c2\u00e2\u20ac\u00a2)\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCourseMetadata(rawText, fallbackCode) {
  const cleanedText = String(rawText || '').trim();

  if (!cleanedText) {
    return {
      courseName: fallbackCode,
      courseCode: fallbackCode,
      instructor: 'Instructor not set',
      year: '',
      section: '',
      note: '',
    };
  }

  const [metaPart = '', notePart = ''] = cleanedText.split('|').map((part) => part.trim());
  const metaParts = splitCourseMetadata(metaPart);

  const courseName = metaParts[0] || fallbackCode;
  const courseCode = metaParts[1] || fallbackCode;
  const year = metaParts[2] || '';
  const instructor = metaParts[3] || 'Instructor not set';
  const section = metaParts[4] || '';

  return {
    courseName,
    courseCode,
    year,
    instructor,
    section,
    note: notePart,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function manageCourseEnrollment(courseId) {
  try {
    const response = await fetch('/api/courses/unenroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: getCurrentUserId(), course_id: courseId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to unenroll from this class.');
    await fetchDashboardData(getCurrentUserId());
  } catch (error) {
    window.alert(error.message || 'Error connecting to the server.');
  }
}

let activeEditingClassCardId = null;

async function unenrollStaffFromCourse(courseId) {
  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/staff-unenroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: getCurrentUserId() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to unenroll from this class.');
    showToast(data.message || 'Class removed from your classes.');
    await loadDashboardCourses();
  } catch (error) {
    window.alert(error.message || 'Unable to unenroll from this class.');
  }
}

async function updateCourseCardStatus(courseId, status) {
  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: getCurrentUserId(), status }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to update class status.');
    showToast(status === 'Archived' ? 'Class archived.' : 'Class restored.');
    await loadDashboardCourses();
  } catch (error) {
    window.alert(error.message || 'Unable to update class status.');
  }
}

function openEditClassCard(card) {
  if (!card) return;
  activeEditingClassCardId = card.dataset.courseId;
  const metadata = parseCourseMetadata(card.dataset.courseDescription || '', card.dataset.courseCategory || '');
  document.getElementById('editClassTitle').value = card.dataset.courseTitle || '';
  document.getElementById('editClassCourseName').value = metadata.courseName === card.dataset.courseCategory ? '' : metadata.courseName;
  document.getElementById('editClassCourseCode').value = metadata.courseCode || card.dataset.courseCategory || '';
  document.getElementById('editClassYear').value = metadata.year || '';
  document.getElementById('editClassInstructor').value = metadata.instructor === 'Instructor not set' ? '' : metadata.instructor;
  document.getElementById('editClassSection').value = metadata.section || '';
  document.getElementById('editClassSubjectNotes').value = metadata.note || '';
  const message = document.getElementById('editClassCardMessage');
  if (message) { message.textContent = ''; message.classList.remove('error'); }
  document.getElementById('editClassCardModal')?.classList.remove('hidden');
}

async function saveEditedClassCard() {
  if (!activeEditingClassCardId) return;
  const button = document.getElementById('saveEditedClassCardBtn');
  const message = document.getElementById('editClassCardMessage');
  button.disabled = true;
  button.textContent = 'Saving...';
  if (message) { message.textContent = 'Saving class information...'; message.classList.remove('error'); }
  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(activeEditingClassCardId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: getCurrentUserId(),
        title: document.getElementById('editClassTitle').value.trim(),
        courseName: document.getElementById('editClassCourseName').value.trim(),
        courseCode: document.getElementById('editClassCourseCode').value.trim(),
        yearLevel: document.getElementById('editClassYear').value.trim(),
        instructor: document.getElementById('editClassInstructor').value.trim(),
        section: document.getElementById('editClassSection').value.trim(),
        subjectNotes: document.getElementById('editClassSubjectNotes').value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to save class information.');
    document.getElementById('editClassCardModal')?.classList.add('hidden');
    activeEditingClassCardId = null;
    showToast('Class information updated.');
    await loadDashboardCourses();
  } catch (error) {
    if (message) { message.textContent = error.message || 'Unable to save class information.'; message.classList.add('error'); }
  } finally {
    button.disabled = false;
    button.textContent = 'Save changes';
  }
}

async function deleteCourse(courseId) {
  try {
    const role = localStorage.getItem('lms_user_role') || 'student';
    const response = await fetch(`/api/classes/${courseId}?teacher_id=${getCurrentUserId()}&role=${encodeURIComponent(role)}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to delete this class.');
    await fetchDashboardData(getCurrentUserId());
  } catch (error) {
    window.alert(error.message || 'Error connecting to the server.');
  }
}

async function loadAssignmentsPage() {
  const currentRole = localStorage.getItem('lms_user_role') || 'student';
  const container = document.getElementById('assignmentsContainer');
  if (!container) return;

  try {
    const res = await fetch(`/api/pages/assignments?role=${currentRole}&user_id=${getCurrentUserId()}`);
    const assignments = await res.json();
    if (!res.ok) throw new Error(assignments.error || 'Unable to load assignments.');

    if (!Array.isArray(assignments) || assignments.length === 0) {
      container.innerHTML = `
        <div style="background: white; border: 1px solid #f8bbd0; border-radius: 8px; text-align: center; padding: 40px; color: #888;">
          <p style="font-size: 16px; font-weight: bold; color: #4a001f; margin-bottom: 6px;">No assignments found.</p>
          <p style="font-size: 13px; margin: 0;">Add an Activity, Task, or Quiz inside any class card to view it here.</p>
        </div>`;
      return;
    }

    container.innerHTML = assignments.map((item, index) => {
      const type = escapeHtml(item.type || 'Activity');
      const title = escapeHtml(item.title || 'Untitled activity');
      const courseTitle = escapeHtml(item.course_title || 'Class Work');
      const courseCode = escapeHtml(item.course_code || '');
      const description = escapeHtml(item.description || '');
      const dueDate = item.due_date ? new Date(`${String(item.due_date).slice(0, 10)}T00:00:00`) : null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dueLabel = dueDate ? dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date';
      const isStudent = String(currentRole).toLowerCase() === 'student';
      const isMissing = isStudent && !item.submission_id && dueDate && dueDate < today && ['activity', 'quiz'].includes(String(item.type || '').toLowerCase());
      const statusLabel = isMissing ? 'Missing' : item.submission_id ? 'Submitted' : (dueDate ? `Due ${dueLabel}` : 'Assigned to you');
      const statusStyle = isMissing ? 'color:#b42318;background:#fee4e2;' : item.submission_id ? 'color:#1e7e34;background:#e6f4ea;' : 'color:#666;background:#f5f5f5;';

      return `
        <div style="background: #fff; border: 1px solid #f8bbd0; border-left: 5px solid ${item.type === 'Quiz' ? '#9c27b0' : '#d81b60'}; border-radius: 8px; padding: 18px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 10px; font-weight: 800; background: #fff0f5; color: #d81b60; padding: 2px 8px; border-radius: 10px; text-transform: uppercase;">${type}</span>
              <span style="font-size: 12px; color: #777; font-weight: bold;">${courseTitle}${courseCode ? ` (${courseCode})` : ''}</span>
            </div>
            <h4 style="margin: 0 0 6px 0; color: #111; font-size: 16px; font-weight: 800;">${title}</h4>
            <p style="margin: 0 0 6px; font-size: 12px; color: ${isMissing ? '#b42318' : '#6b7280'}; font-weight: 700;">${isMissing ? `Missing — was due ${dueLabel}` : `Due: ${dueLabel}`}</p>
            ${description ? `<p style="margin: 0; font-size: 13px; color: #555;">${description}</p>` : ''}
          </div>
          <div>
            <span style="font-size: 11px; font-weight: bold; ${currentRole === 'dean' ? 'color:#666;background:#f5f5f5;' : statusStyle} padding: 6px 12px; border-radius: 12px;">${currentRole === 'dean' ? 'Dean View' : statusLabel}</span>
            <button class="aa-btn assignment-open-btn" type="button" data-assignment-index="${index}">Open</button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.assignment-open-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const assignment = assignments[Number(button.dataset.assignmentIndex)];
        if (assignment) openAssignmentModal(assignment, { role: currentRole, userId: getCurrentUserId() });
      });
    });
  } catch (err) {
    console.error('Error loading assignments:', err);
    container.innerHTML = '<p style="color: red; font-size: 13px;">Error loading assignments. Check server console.</p>';
  }
}

fetchDashboardData(getCurrentUserId());

/* Assignment modal: students submit work; instructors and deans review and grade it. */
function aaEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function aaStyles() {
  if (document.getElementById('aaStyles')) return;
  const style = document.createElement('style');
  style.id = 'aaStyles';
  style.textContent = `
    .aa-overlay { position: fixed; inset: 0; z-index: 10002; display: grid; place-items: center; padding: 16px; background: rgba(17, 24, 39, .55); }
    .aa-modal { width: min(720px, 100%); max-height: 85vh; overflow: auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 24px 64px rgba(17, 24, 39, .3); }
    .aa-modal h3 { margin: 10px 0 4px; color: #4a1730; }.aa-muted { color: #6b7280; font-size: 13px; }.aa-badge { display: inline-block; padding: 3px 9px; border-radius: 99px; background: #fce7f3; color: #9d174d; font-size: 11px; font-weight: 700; text-transform: uppercase; }.aa-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; }.aa-row input { width: 80px; padding: 8px; }.aa-row textarea { flex: 1; min-width: 160px; padding: 8px; }.aa-btn { margin: 10px 0 0 8px; padding: 8px 14px; border: 0; border-radius: 8px; color: #fff; background: #4a1730; cursor: pointer; font: inherit; font-weight: 600; }.aa-btn.green { background: #166534; }.aa-btn.gray { background: #6b7280; }.aa-close { float: right; border: 0; background: none; font-size: 24px; cursor: pointer; }.aa-file { color: #9d174d; font-weight: 700; }`;
  document.head.appendChild(style);
}

function aaExtraStyles() {
  if (document.getElementById('aaStyles2')) return;
  const style = document.createElement('style');
  style.id = 'aaStyles2';
  style.textContent = `.aa-head{display:flex;gap:12px;align-items:center;margin-bottom:4px}.aa-head .icon{font-size:30px;background:#fde8ef;display:grid;place-items:center;width:52px;height:52px;border-radius:12px}.aa-head h3{margin:0;font-size:22px;color:#222}.aa-sub{color:#777;font-size:13px}.aa-divider{border:0;border-top:1px solid #eee;margin:14px 0}.aa-workcard{border:1px solid #e5e5e5;border-radius:12px;padding:16px;max-width:430px}.aa-workcard .top{display:flex;justify-content:space-between;align-items:center;gap:12px}.aa-status{border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700}.aa-status.assigned{background:#e7f0fe;color:#1a73e8}.aa-status.submitted{background:#e6f4ea;color:#1e7e34}.aa-status.graded{background:#fef7e0;color:#b06000}.aa-drop{border:2px dashed #ccc;border-radius:10px;padding:14px;text-align:center;cursor:pointer}.aa-drop.hasfile{border-style:solid;color:#333;background:#fafafa}.aa-submitbtn{background:#166534;color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:700}.aa-unsubmit{background:#fff;color:#d33;border:1px solid #d33;border-radius:10px;padding:9px 13px;cursor:pointer}.aa-score{margin-top:10px;font-size:14px}`;
  document.head.appendChild(style);
}

async function openAssignmentModal(assignment, context) {
  aaStyles(); aaExtraStyles();
  const isStaff = !['student'].includes(String(context.role || '').toLowerCase());
  const icon = String(assignment.type || '').toLowerCase() === 'quiz' ? '📝' : '📄';
  const documentUrl = assignment.document_path
    ? (String(assignment.document_path).startsWith('/uploads/')
      ? `/api/assignments/${encodeURIComponent(assignment.assignment_id)}/preview`
      : assignment.document_path)
    : null;
  const overlay = document.createElement('div');
  overlay.className = 'aa-overlay';
  overlay.innerHTML = `<div class="aa-modal" role="dialog" aria-modal="true" aria-label="Assignment details"><button class="aa-close" type="button" aria-label="Close">&times;</button><div class="aa-head"><div class="icon" aria-hidden="true">${icon}</div><div><h3>${aaEscape(assignment.title)}</h3><div class="aa-sub">${aaEscape(assignment.course_title)}${assignment.course_code ? ` (${aaEscape(assignment.course_code)})` : ''} · Due ${assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : 'No due date'} · ${assignment.total_points ?? 100} points</div></div></div>${documentUrl ? `<p><a class="aa-file" href="${aaEscape(documentUrl)}" target="_blank" rel="noopener">View attached document</a></p>` : ''}<hr class="aa-divider"><div class="aa-body">Loading…</div></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.aa-close').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  const body = overlay.querySelector('.aa-body');
  if (isStaff) await aaStaffView(body, assignment);
  else await aaStudentView(body, assignment, context);
}

async function aaStudentView(body, assignment, context) {
  aaExtraStyles();
  const response = await fetch('/api/assignments/' + assignment.assignment_id + '/submission?student_id=' + encodeURIComponent(context.userId));
  const data = await response.json();
  if (!response.ok) { body.textContent = data.error || 'Unable to load your submission.'; return; }

  let submission = data.submission;
  let pending = { file: null, fileName: '', linkTitle: '', submissionUrl: '', submissionKind: '' };
  const render = () => {
    const isSubmitted = Boolean(submission);
    const isGraded = submission?.score != null;
    const statusClass = isGraded ? 'graded' : isSubmitted ? 'turned-in' : 'assigned';
    const statusLabel = isGraded ? 'Graded' : isSubmitted ? 'Submitted' : 'Assigned';
    const attachmentName = submission?.file_name || pending.fileName || pending.linkTitle;
    const attachmentUrl = submission?.submission_url || submission?.file_path || pending.submissionUrl;
    const attachmentMarkup = attachmentUrl
      ? '<div class="submission-file"><a class="submission-file-link" href="' + aaEscape(attachmentUrl) + '" target="_blank" rel="noopener">' + aaEscape(attachmentName || 'Open submitted work') + '</a>' +
        (!isSubmitted ? '<button class="submission-remove" type="button" aria-label="Remove attached work">×</button>' : '') + '</div>'
      : pending.file
        ? '<div class="submission-file"><span class="submission-file-name">' + aaEscape(pending.fileName) + '</span><button class="submission-remove" type="button" aria-label="Remove attached work">×</button></div>'
        : '<div class="submission-empty">No work added yet</div>';
    const gradeMarkup = isGraded
      ? '<p class="submission-grade-note">Score: ' + aaEscape(submission.score) + '/' + aaEscape(assignment.total_points ?? 100) + '<br>Feedback: ' + aaEscape(submission.feedback || '—') + '</p>'
      : isSubmitted ? '<p class="aa-sub">Waiting for an instructor to grade this work.</p>' : '';
    body.innerHTML =
      '<div class="aa-workcard student-submission-panel">' +
        '<div class="submission-heading"><h3>Your work</h3><span class="submission-status ' + statusClass + '">' + statusLabel + '</span></div>' +
        '<p class="aa-sub">' + (isSubmitted ? 'Submitted ' + new Date(submission.submitted_at).toLocaleString() : 'Attach your work when you are ready.') + '</p>' +
        gradeMarkup +
        '<div class="submission-file-list">' + attachmentMarkup + '</div>' +
        (isSubmitted ? '' :
          '<input type="file" class="aa-file-input" hidden>' +
          '<div class="submission-add-menu" hidden>' +
            '<button type="button" data-assignment-method="upload">Upload a file</button>' +
            '<button type="button" data-assignment-method="link">Submit a link</button>' +
          '</div>' +
          '<div class="submission-link-form" hidden>' +
            '<label>Link<input class="aa-link-url" type="text" maxlength="2000" placeholder="Paste an internal or web link"></label>' +
            '<div class="submission-link-actions"><button class="aa-attach-link" type="button">Attach link</button><button class="aa-cancel-link" type="button">Cancel</button></div>' +
          '</div>' +
          '<button class="submission-add-file-btn aa-add-work" type="button">+ Add link or upload</button>') +
        '<button class="submission-toggle-btn aa-submit-work' + (isSubmitted ? ' unsubmit' : '') + '" type="button">' + (isSubmitted ? 'Unsubmit' : 'Submit') + '</button>' +
      '</div><hr class="aa-divider"><p><strong>Comments</strong></p><input type="text" placeholder="Add comment…" style="width:100%;padding:10px;box-sizing:border-box">';

    if (isSubmitted) {
      body.querySelector('.aa-submit-work').addEventListener('click', async () => {
        if (!window.confirm('Remove your submission?')) return;
        const result = await fetch('/api/assignments/' + assignment.assignment_id + '/submission?student_id=' + encodeURIComponent(context.userId), { method: 'DELETE' });
        if (!result.ok) {
          const error = await result.json().catch(() => ({}));
          window.alert(error.error || 'Unable to remove your submission.');
          return;
        }
        submission = null;
        render();
      });
      return;
    }

    const fileInput = body.querySelector('.aa-file-input');
    const menu = body.querySelector('.submission-add-menu');
    const linkForm = body.querySelector('.submission-link-form');
    body.querySelector('.aa-add-work').addEventListener('click', () => {
      linkForm.hidden = true;
      menu.hidden = !menu.hidden;
    });
    menu.querySelectorAll('[data-assignment-method]').forEach((option) => option.addEventListener('click', () => {
      menu.hidden = true;
      if (option.dataset.assignmentMethod === 'upload') {
        fileInput.click();
        return;
      }
      linkForm.hidden = false;
      linkForm.querySelector('.aa-link-url').value = '';
      linkForm.querySelector('.aa-link-url').focus();
    }));
    linkForm.querySelector('.aa-cancel-link').addEventListener('click', () => { linkForm.hidden = true; });
    linkForm.querySelector('.aa-attach-link').addEventListener('click', () => {
      const rawUrl = linkForm.querySelector('.aa-link-url').value.trim();
      if (!rawUrl) return window.alert('Paste a link before attaching it.');
      const isInternalPath = rawUrl.startsWith('/') && !rawUrl.startsWith('//');
      let parsedUrl = null;
      try { parsedUrl = new URL(rawUrl, window.location.origin); } catch (_) { /* Invalid URL. */ }
      if (!isInternalPath && (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol))) {
        return window.alert('Use an internal LMS path or a valid http:// or https:// link.');
      }
      let linkTitle = parsedUrl.hostname;
      if (isInternalPath) {
        const pathPart = rawUrl.split(/[?#]/)[0].split('/').filter(Boolean).pop() || 'Internal LMS link';
        try { linkTitle = decodeURIComponent(pathPart); } catch (_) { linkTitle = pathPart; }
      }
      pending = {
        file: null,
        fileName: '',
        linkTitle: linkTitle.slice(0, 200),
        submissionUrl: isInternalPath ? rawUrl : parsedUrl.href,
        submissionKind: 'link',
      };
      render();
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      pending = { file, fileName: file.name, linkTitle: '', submissionUrl: '', submissionKind: '' };
      render();
    });
    body.querySelector('.submission-remove')?.addEventListener('click', () => {
      pending = { file: null, fileName: '', linkTitle: '', submissionUrl: '', submissionKind: '' };
      render();
    });
    body.querySelector('.aa-submit-work').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!pending.file && !pending.submissionUrl) {
        window.alert('Add a file or link before submitting your work.');
        return;
      }
      const confirmed = await showConfirmationDialog({
        title: 'Submit this assignment?',
        message: 'Please confirm that your work is ready to be submitted.',
        confirmLabel: 'Submit assignment',
      });
      if (!confirmed) return;
      button.disabled = true;
      let requestOptions;
      if (pending.file) {
        const formData = new FormData();
        formData.append('file', pending.file);
        formData.append('student_id', String(context.userId));
        requestOptions = { method: 'POST', body: formData };
      } else {
        requestOptions = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: String(context.userId),
            submission_url: pending.submissionUrl,
            submission_kind: 'link',
            file_name: pending.linkTitle,
          }),
        };
      }
      try {
        const result = await fetch('/api/assignments/' + assignment.assignment_id + '/submission', requestOptions);
        const resultData = await result.json();
        if (!result.ok) throw new Error(resultData.error || 'Submission failed.');
        await aaStudentView(body, assignment, context);
      } catch (error) {
        window.alert(error.message || 'Submission failed.');
        button.disabled = false;
      }
    });
  };
  render();
}
async function aaStaffView(body, assignment) {
  const response = await fetch(`/api/assignments/${assignment.assignment_id}/submissions`);
  const submissions = await response.json();
  if (!response.ok) { body.textContent = submissions.error || 'Unable to load submissions.'; return; }
  if (!submissions.length) { body.innerHTML = '<p class="aa-muted">No student submissions yet.</p>'; return; }
  body.innerHTML = submissions.map((submission, index) => `<div class="aa-row" data-submission-index="${index}"><div style="flex:1;min-width:150px"><strong>Student #${aaEscape(submission.student_id)}</strong><br><span class="aa-muted">${new Date(submission.submitted_at).toLocaleString()}</span><br><a class="aa-file" href="${aaEscape(submission.submission_url || submission.file_path)}" target="_blank" rel="noopener">${aaEscape(submission.file_name)}</a></div><input type="number" min="0" max="${assignment.total_points ?? 100}" value="${submission.score ?? ''}" placeholder="Score"><textarea rows="2" placeholder="Feedback">${aaEscape(submission.feedback || '')}</textarea><button class="aa-btn green save-grade" type="button">Save grade</button></div>`).join('');
  body.querySelectorAll('.save-grade').forEach((button) => button.addEventListener('click', async () => {
    const row = button.closest('.aa-row'); const submission = submissions[Number(row.dataset.submissionIndex)];
    const result = await fetch(`/api/assignments/${assignment.assignment_id}/submissions/${encodeURIComponent(submission.student_id)}/grade`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: Number(row.querySelector('input').value), feedback: row.querySelector('textarea').value }) });
    const data = await result.json();
    if (!result.ok) { window.alert(data.error || 'Failed to save grade.'); return; }
    await aaStaffView(body, assignment);
  }));
}

let aaCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
function aaCalendarStyles() {
  if (document.getElementById('aaCalendarStyles')) return;
  const style = document.createElement('style'); style.id = 'aaCalendarStyles';
  style.textContent = `.aa-cal{background:#fff;padding:20px;border-radius:12px}.aa-cal-head{display:flex;gap:10px;align-items:center;margin-bottom:12px}.aa-cal-head strong{flex:1;font-size:18px}.aa-cal-nav,.aa-cal-add{border:0;border-radius:8px;padding:8px 12px;cursor:pointer}.aa-cal-add{background:#4a1730;color:#fff}.aa-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid #eee}.aa-cal-day,.aa-cal-cell{min-height:76px;padding:7px;border-right:1px solid #eee;border-bottom:1px solid #eee}.aa-cal-day{min-height:auto;background:#fafafa;font-size:12px;font-weight:700}.aa-cal-cell{cursor:pointer}.aa-cal-cell.muted{color:#aaa;background:#fcfcfc}.aa-cal-num{font-weight:700;font-size:13px}.aa-cal-event{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px;padding:3px 5px;border-radius:5px;background:#fce7f3;color:#9d174d;font-size:11px}.aa-cal-event.assignment{background:#e7f0fe;color:#1a73e8}`; document.head.appendChild(style);
}
async function renderCalendarPage(context, root) {
  if (!root) return; aaCalendarStyles();
  const monthKey = `${aaCalendarMonth.getFullYear()}-${String(aaCalendarMonth.getMonth() + 1).padStart(2, '0')}`;
  root.innerHTML = '<div class="aa-cal">Loading calendar…</div>';
  const response = await fetch(`/api/pages/calendar?role=${encodeURIComponent(context.role)}&user_id=${context.userId}&month=${monthKey}`);
  const items = response.ok ? await response.json() : [];
  const isStaff = String(context.role).toLowerCase() !== 'student';
  const first = new Date(aaCalendarMonth.getFullYear(), aaCalendarMonth.getMonth(), 1); const start = new Date(first); start.setDate(1 - first.getDay());
  const byDay = {};
  items.forEach((item) => {
    const startDate = new Date(`${String(item.start_date).slice(0, 10)}T00:00:00`);
    const endDate = item.end_date ? new Date(`${String(item.end_date).slice(0, 10)}T00:00:00`) : startDate;
    for (const date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const key = date.toISOString().slice(0, 10);
      (byDay[key] ||= []).push(item);
    }
  });
  const cells = Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); const key = date.toISOString().slice(0, 10); const list = byDay[key] || []; return `<div class="aa-cal-cell ${date.getMonth() !== aaCalendarMonth.getMonth() ? 'muted' : ''}" data-date="${key}"><div class="aa-cal-num">${date.getDate()}</div>${list.slice(0, 2).map((item) => `<div class="aa-cal-event ${item.kind === 'assignment' ? 'assignment' : ''}" title="${aaEscape(item.title)}">${aaEscape(item.title)}</div>`).join('')}${list.length > 2 ? `<div class="aa-cal-event">+${list.length - 2} more</div>` : ''}</div>`; }).join('');
  root.innerHTML = `<div class="aa-cal"><div class="aa-cal-head"><button class="aa-cal-nav" data-nav="-1">‹</button><strong>${aaCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><button class="aa-cal-nav" data-nav="1">›</button>${isStaff ? '<button class="aa-cal-add">+ Add Event</button>' : ''}</div><div class="aa-cal-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day) => `<div class="aa-cal-day">${day}</div>`).join('')}${cells}</div></div>`;
  root.querySelectorAll('.aa-cal-nav').forEach((button) => button.addEventListener('click', () => { aaCalendarMonth.setMonth(aaCalendarMonth.getMonth() + Number(button.dataset.nav)); renderCalendarPage(context, root); }));
  root.querySelectorAll('.aa-cal-cell').forEach((cell) => cell.addEventListener('click', () => { const dayItems = byDay[cell.dataset.date] || []; if (dayItems.length) window.alert(dayItems.map((item) => `${item.title}${item.description ? `\n${item.description}` : ''}`).join('\n\n')); }));
  root.querySelector('.aa-cal-add')?.addEventListener('click', () => aaAddEventModal(context, () => renderCalendarPage(context, root)));
  let swipeStartX = null;
  root.querySelector('.aa-cal-grid').addEventListener('touchstart', (event) => { swipeStartX = event.touches[0].clientX; }, { passive: true });
  root.querySelector('.aa-cal-grid').addEventListener('touchend', (event) => {
    if (swipeStartX === null) return;
    const distance = event.changedTouches[0].clientX - swipeStartX;
    if (Math.abs(distance) > 60) { aaCalendarMonth.setMonth(aaCalendarMonth.getMonth() + (distance > 0 ? -1 : 1)); renderCalendarPage(context, root); }
    swipeStartX = null;
  }, { passive: true });
}
function aaAddEventModal(context, reload) {
  openEventModalPro(context, aaCalendarMonth.toISOString().slice(0, 10), reload);
}

/* ============ MONTHLY OVERVIEW CALENDAR (final) ============ */
let mcalMonth = new Date();
const mcalKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const mcalEsc = (value) => aaEscape(value);
function mcalStyles() {
  if (document.getElementById('mcalStyles')) return;
  const style = document.createElement('style'); style.id = 'mcalStyles';
  style.textContent = `.cal-kicker{color:#d6336c;font-weight:800;font-size:12px;letter-spacing:1px}.cal-h2{margin:2px 0 3px;font-size:24px;color:#333}.cal-pillbtn{background:#fbdce8;color:#d6336c;border:0;border-radius:999px;padding:7px 14px;font-weight:700;cursor:pointer}.cal-card,.cal-item{background:#fdeef5;border:1px solid #f7cddd;border-radius:8px;padding:18px;margin-bottom:16px}.cal-top,.cal-navrow{display:flex;gap:8px;align-items:center}.cal-top{justify-content:space-between}.cal-month{font-size:18px;font-weight:800}.cal-count{background:#f9c9dd;color:#c2255c;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px}.cal-sub{color:#8a6470;font-size:13px}.cal-heading-sub{margin:0 0 14px}.cal-days,.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;text-align:center}.cal-days{font-size:11px;font-weight:800;color:#8a6470;margin:12px 0 8px}.cal-cell{border-radius:8px;padding:10px 0;font-weight:800;color:#8f1d3f;background:#fbe3ec;cursor:pointer}.cal-cell.out{background:#eef2f7;color:#b6c2cf;cursor:default}.cal-cell.past{border:1px solid #f76c6c}.cal-cell.today{background:#fdf3d7;border:1px solid #f5a623}.cal-cell.up{background:#d3f3ef;border:1px solid #20b2aa}.cal-item .cat{color:#c2255c;font-weight:800;font-size:14px}.cal-item .ttl{color:#333;font-weight:700;margin:4px 0}.cal-item .dsc{color:#8a6470;font-size:13px}`;
  document.head.appendChild(style);
}
function renderMonthlyCalendar(context, root) {
  if (!root) return; mcalStyles();
  const staff = ['instructor','teacher','dean','admin','superadmin'].includes(String(context.role).toLowerCase());
  root.innerHTML = `<div style="display:flex;justify-content:space-between"><div><div class="cal-kicker">CALENDAR</div><div class="cal-h2">Monthly Overview</div></div><button class="cal-pillbtn" data-today>This Week</button></div><div class="cal-card"><div class="cal-top"><span class="cal-month"></span><span class="cal-count"></span></div><p class="cal-sub">Upcoming deadlines and key school events.</p><div class="cal-navrow"><button class="cal-pillbtn" data-shift="-1">‹</button><button class="cal-pillbtn" data-shift="1">›</button>${staff ? '<button class="cal-pillbtn" data-add>+ Add Event</button>' : ''}</div><div class="cal-days">${['SUN','MON','TUE','WED','THU','FRI','SAT'].map((day) => `<div>${day}</div>`).join('')}</div><div class="cal-grid"></div></div><div class="cal-list"></div>`;
  const load = async () => { const response = await fetch(`/api/pages/calendar?role=${encodeURIComponent(context.role)}&user_id=${context.userId}&month=${mcalKey(mcalMonth)}`); const items = response.ok ? await response.json() : []; draw(items); };
  const draw = (items) => { const grid = root.querySelector('.cal-grid'); const today = new Date(); today.setHours(0,0,0,0); const byDay = {}; items.forEach((item) => { const start = new Date(`${String(item.start_date).slice(0,10)}T00:00:00`); const end = item.end_date ? new Date(`${String(item.end_date).slice(0,10)}T00:00:00`) : start; for (const date = new Date(start); date <= end; date.setDate(date.getDate()+1)) if (date.getMonth() === mcalMonth.getMonth() && date.getFullYear() === mcalMonth.getFullYear()) (byDay[date.getDate()] ||= []).push(item); }); const first = new Date(mcalMonth.getFullYear(),mcalMonth.getMonth(),1).getDay(); const days = new Date(mcalMonth.getFullYear(),mcalMonth.getMonth()+1,0).getDate(); let cells = Array.from({length:first}, () => '<div class="cal-cell out"></div>'); for(let day=1;day<=days;day++){const date=new Date(mcalMonth.getFullYear(),mcalMonth.getMonth(),day); const list=byDay[day]||[]; cells.push(`<div class="cal-cell ${date.getTime()===today.getTime()?'today':list.length?(date<today?'past':'up'):''}" data-day="${day}">${day}</div>`);} grid.innerHTML=cells.join(''); root.querySelector('.cal-month').textContent=mcalMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'}); root.querySelector('.cal-count').textContent=`${items.length} Event${items.length===1?'':'s'}`; root.querySelector('.cal-list').innerHTML=items.length?items.map((item)=>`<div class="cal-item"><div class="cat">${item.kind==='event'?'School Event':'Assignment'}</div><div class="ttl">${mcalEsc(item.title)}</div><div class="dsc">${mcalEsc(item.description||item.course_title||'')}</div></div>`).join(''):'<p class="cal-sub">Nothing scheduled this month.</p>'; };
  root.querySelectorAll('[data-shift]').forEach((button)=>button.onclick=()=>{mcalMonth.setMonth(mcalMonth.getMonth()+Number(button.dataset.shift));load();}); root.querySelector('[data-today]').onclick=()=>{mcalMonth=new Date();load();}; root.querySelector('[data-add]')?.addEventListener('click',()=>mcalEventModal(context,null,load));
  let swipeStartX = null;
  const grid = root.querySelector('.cal-grid');
  grid.addEventListener('touchstart', (event) => { swipeStartX = event.touches[0].clientX; }, { passive: true });
  grid.addEventListener('touchend', (event) => {
    if (swipeStartX === null) return;
    const distance = event.changedTouches[0].clientX - swipeStartX;
    if (Math.abs(distance) > 60) { mcalMonth.setMonth(mcalMonth.getMonth() + (distance > 0 ? -1 : 1)); load(); }
    swipeStartX = null;
  }, { passive: true });
  load();
}
function mcalEventModal(context, defaultDate, reload) { openEventModalPro(context, defaultDate, reload); }

/* ============ PROFESSIONAL ADD-EVENT MODAL ============ */
function openEventModalPro(ctx, defaultDate, onDone) {
  const old = document.getElementById('evProOverlay'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'evProOverlay';
  ov.innerHTML = `
  <style>
    #evProOverlay{position:fixed;inset:0;background:rgba(60,10,30,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
    .evp-card{width:min(560px,94vw);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
    .evp-head{background:linear-gradient(135deg,#e0477e,#b02458);color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}
    .evp-head h3{margin:0;font-size:18px}
    .evp-head p{margin:2px 0 0;font-size:12px;opacity:.85}
    .evp-x{background:rgba(255,255,255,.18);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px}
    .evp-x:hover{background:rgba(255,255,255,.32)}
    .evp-body{padding:20px 22px}
    .evp-label{display:block;font-size:11px;font-weight:800;letter-spacing:.6px;color:#8f1d3f;text-transform:uppercase;margin:14px 0 6px}
    .evp-input,.evp-select,.evp-textarea{width:100%;padding:11px 12px;border:1.5px solid #ecd3dd;border-radius:10px;font-size:14px;outline:none;background:#fff;box-sizing:border-box}
    .evp-input:focus,.evp-select:focus,.evp-textarea:focus{border-color:#d6336c;box-shadow:0 0 0 3px rgba(214,51,108,.12)}
    .evp-row{display:flex;gap:14px}
    .evp-row>div{flex:1}
    .evp-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid #f3e1e9;background:#fdf7fa}
    .evp-btn{border:none;border-radius:999px;padding:11px 22px;font-weight:800;cursor:pointer;font-size:14px}
    .evp-cancel{background:#fff;color:#8f1d3f;border:1.5px solid #ecd3dd}
    .evp-cancel:hover{background:#fdeef5}
    .evp-save{background:linear-gradient(135deg,#e0477e,#d6336c);color:#fff;box-shadow:0 6px 16px rgba(214,51,108,.35)}
    .evp-save:hover{filter:brightness(1.06)}
    .evp-save:disabled{opacity:.6;cursor:wait}
    .evp-err{color:#c62828;font-size:12px;margin-top:12px;display:none}
    .evp-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e7e34;color:#fff;padding:10px 22px;border-radius:999px;font-weight:700;box-shadow:0 8px 20px rgba(0,0,0,.25);z-index:10000}
  </style>
  <div class="evp-card">
    <div class="evp-head">
      <div><h3>📅 Add School Event</h3><p>Appears on every role's calendar instantly.</p></div>
      <button class="evp-x" type="button">✕</button>
    </div>
    <div class="evp-body">
      <label class="evp-label">Event title *</label>
      <input class="evp-input" id="evpTitle" placeholder="e.g. CCS Day Celebration" maxlength="80">
      <label class="evp-label">Event type</label>
      <select class="evp-select" id="evpType">
        <option>School Event</option><option>Celebration</option><option>Deadline</option><option>Exam</option><option>Meeting</option>
      </select>
      <label class="evp-label">Description (optional)</label>
      <textarea class="evp-textarea" id="evpDesc" rows="2" placeholder="Short details students and staff should know…"></textarea>
      <div class="evp-row">
        <div><label class="evp-label">From *</label><input class="evp-input" type="date" id="evpStart"></div>
        <div><label class="evp-label">To (optional)</label><input class="evp-input" type="date" id="evpEnd"></div>
      </div>
      <p class="evp-err" id="evpErr"></p>
    </div>
    <div class="evp-foot">
      <button class="evp-btn evp-cancel" type="button">Cancel</button>
      <button class="evp-btn evp-save" type="button">Save Event</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  if (defaultDate) ov.querySelector('#evpStart').value = defaultDate;
  const close = () => ov.remove();
  ov.querySelector('.evp-x').onclick = close;
  ov.querySelector('.evp-cancel').onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  ov.querySelector('.evp-save').onclick = async () => {
    const err = ov.querySelector('#evpErr');
    const title = ov.querySelector('#evpTitle').value.trim();
    const type = ov.querySelector('#evpType').value;
    const desc = ov.querySelector('#evpDesc').value.trim();
    const start = ov.querySelector('#evpStart').value;
    const end = ov.querySelector('#evpEnd').value || null;
    err.style.display = 'none';
    const fail = (m) => { err.textContent = m; err.style.display = 'block'; };
    if (!title) return fail('Please enter an event title.');
    if (!start) return fail('Please choose a start date.');
    if (end && end < start) return fail('The "To" date cannot be before the "From" date.');
    const btn = ov.querySelector('.evp-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await fetch('/api/pages/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc ? `[${type}] ${desc}` : `[${type}]`, start_date: start, end_date: end, role: ctx.role, user_id: ctx.userId }),
    });
    const j = await r.json().catch(() => ({}));
    btn.disabled = false; btn.textContent = 'Save Event';
    if (!r.ok) return fail(j.error || 'Could not save the event.');
    close();
    const t = document.createElement('div');
    t.className = 'evp-toast'; t.textContent = 'Event added to the calendar ✅';
    document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
    if (onDone) onDone();
  };
}

/* ============ CALENDAR PRO: type colors + legend + exact dates ============ */
const MCAL_TYPES = {
  exam: { label: 'Exam', cls: 't-exam', dot: '#3b82f6' },
  celebration: { label: 'Celebration', cls: 't-celebration', dot: '#f5a623' },
  deadline: { label: 'Deadline', cls: 't-deadline', dot: '#f76c6c' },
  meeting: { label: 'Meeting', cls: 't-meeting', dot: '#8b5cf6' },
  'school event': { label: 'School Event', cls: 't-event', dot: '#20b2aa' },
};
const MCAL_DUE = { label: 'Class Due', cls: 't-due', dot: '#d6336c' };
const mcalTypeOf = (item) => {
  const match = String(item.description || '').match(/^\[([^\]]+)\]/);
  return MCAL_TYPES[(match ? match[1] : 'School Event').toLowerCase()] || MCAL_TYPES['school event'];
};
const mcalCleanDesc = (item) => String(item.description || '').replace(/^\[[^\]]+\]\s*/, '');
const mcalToday = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date; };
const mcalExactDate = (item) => {
  const format = (date) => date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const start = new Date(`${String(item.start_date).slice(0, 10)}T00:00:00`);
  const end = item.end_date && String(item.end_date).slice(0, 10);
  return end && end !== String(item.start_date).slice(0, 10) ? `${format(start)} – ${format(new Date(`${end}T00:00:00`))}` : format(start);
};
function showCalendarEventDetails(items) {
  document.getElementById('calendarEventDetails')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'calendarEventDetails';
  overlay.className = 'calendar-event-overlay';
  overlay.innerHTML = `<section class="calendar-event-dialog" role="dialog" aria-modal="true" aria-labelledby="calendarEventTitle"><button class="calendar-event-close" type="button" aria-label="Close event details">×</button><div class="calendar-event-heading"><span class="calendar-event-heading-icon" aria-hidden="true">◷</span><div><p>Calendar</p><h2 id="calendarEventTitle">Event details</h2></div></div><div class="calendar-event-list"></div></section>`;

  const list = overlay.querySelector('.calendar-event-list');
  items.forEach((item) => {
    const type = item.kind === 'event' ? mcalTypeOf(item) : MCAL_DUE;
    const description = mcalCleanDesc(item);
    const card = document.createElement('article');
    card.className = 'calendar-event-card';
    card.innerHTML = `<span class="calendar-event-type"></span><h3></h3><p class="calendar-event-date"></p><p class="calendar-event-class" hidden></p><p class="calendar-event-description" hidden></p>`;
    const typeElement = card.querySelector('.calendar-event-type');
    typeElement.textContent = type.label;
    typeElement.style.setProperty('--event-color', type.dot);
    card.querySelector('h3').textContent = item.title || 'Untitled event';
    card.querySelector('.calendar-event-date').textContent = `📅 ${mcalExactDate(item)}`;
    const classElement = card.querySelector('.calendar-event-class');
    if (item.kind === 'assignment' && item.course_title) {
      classElement.hidden = false;
      classElement.textContent = `▣ From class: ${item.course_title}`;
    }
    const descriptionElement = card.querySelector('.calendar-event-description');
    if (description) {
      descriptionElement.hidden = false;
      descriptionElement.textContent = description;
    }
    list.appendChild(card);
  });

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
  overlay.querySelector('.calendar-event-close').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  overlay.querySelector('.calendar-event-close').focus();
}

function mcalStyles2() {
  if (document.getElementById('mcalStyles2')) return;
  const style = document.createElement('style'); style.id = 'mcalStyles2';
  style.textContent = `.cal-legend2{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#555;margin:4px 0 12px}.cal-legend2 span{display:inline-flex;align-items:center;gap:6px}.cal-legend2 i{width:12px;height:12px;border-radius:4px;display:inline-block}.cal-cell.t-exam{background:#dbeafe;border-color:#3b82f6;color:#1d4ed8}.cal-cell.t-celebration{background:#fdf3d7;border-color:#f5a623;color:#8a5a00}.cal-cell.t-deadline{background:#fbdce3;border-color:#f76c6c;color:#b02438}.cal-cell.t-meeting{background:#ede9fe;border-color:#8b5cf6;color:#5b21b6}.cal-cell.t-event{background:#d3f3ef;border-color:#20b2aa;color:#0f766e}.cal-cell.t-due{background:#fbe3ec;border-color:#d6336c;color:#8f1d3f}.cal-cell.today{border:2px solid #f5a623}.cal-item .cat2{font-weight:800;font-size:12px;letter-spacing:.5px;text-transform:uppercase}.cal-item .date2{color:#8a6470;font-size:13px;font-weight:700;margin:2px 0}.cal-item-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.cal-event-menu{position:relative;flex:none}.cal-event-menu summary{display:grid;place-items:center;width:30px;height:30px;border:1px solid #ead7df;border-radius:9px;background:#fff;color:#725867;font-size:20px;line-height:1;cursor:pointer;list-style:none}.cal-event-menu summary::-webkit-details-marker{display:none}.cal-event-menu[open] summary{border-color:#d6336c;color:#a6224e}.cal-event-menu-options{position:absolute;z-index:8;top:34px;right:0;min-width:140px;padding:5px;border:1px solid #ead7df;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(60,20,40,.16)}.cal-event-delete{width:100%;padding:9px 10px;border:0;border-radius:7px;background:#fff;color:#b42345;text-align:left;font:inherit;font-size:13px;font-weight:700;cursor:pointer}.cal-event-delete:hover{background:#fff0f3}.cal-event-delete:disabled{opacity:.55;cursor:wait}`;
  document.head.appendChild(style);
}
function renderMonthlyCalendarPro(ctx, root) {
  if (!root) return; mcalStyles(); mcalStyles2();
  const isDean = String(ctx.role || '').toLowerCase().replace(/\s+/g, '') === 'dean';
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start"><div><div class="cal-kicker">CALENDAR</div><div class="cal-h2">Monthly Overview</div><p class="cal-sub cal-heading-sub">Keep track of upcoming deadlines and school events.</p></div><button class="cal-pillbtn" id="calTodayBtn">This Week</button></div><div class="cal-card"><div class="cal-top"><span class="cal-month" id="calLabel"></span><span class="cal-count" id="calCount"></span></div><div class="cal-legend2">${Object.values(MCAL_TYPES).map((type) => `<span><i style="background:${type.dot}"></i>${type.label}</span>`).join('')}<span><i style="background:${MCAL_DUE.dot}"></i>${MCAL_DUE.label}</span><span><i style="background:#fff;border:2px solid #f5a623"></i>Today</span></div><div class="cal-navrow"><button class="cal-pillbtn" id="calPrev">‹</button><button class="cal-pillbtn" id="calNext">›</button>${isDean ? '<button class="cal-pillbtn" id="calAdd">+ Add Event</button>' : ''}</div><div class="cal-days">${['SUN','MON','TUE','WED','THU','FRI','SAT'].map((day) => `<div>${day}</div>`).join('')}</div><div class="cal-grid" id="calGrid"></div></div><div id="calList"></div>`;
  let month = new Date(); const grid = root.querySelector('#calGrid');
  const shift = (amount) => { month = new Date(month.getFullYear(), month.getMonth() + amount, 1); load(); };
  root.querySelector('#calPrev').onclick = () => shift(-1); root.querySelector('#calNext').onclick = () => shift(1);
  root.querySelector('#calTodayBtn').onclick = () => { month = new Date(); load(); };
  root.querySelector('#calAdd')?.addEventListener('click', () => openEventModalPro(ctx, null, load));
  async function load() {
    root.querySelector('#calLabel').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); grid.innerHTML = '<p class="cal-sub">Loading…</p>';
    const response = await fetch(`/api/pages/calendar?role=${encodeURIComponent(ctx.role)}&user_id=${encodeURIComponent(ctx.userId)}&month=${mcalKey(month)}`);
    draw(response.ok ? await response.json() : []);
  }  
  function draw(items) {
    items = Array.isArray(items) ? items : []; const today = mcalToday(); const byDay = {};
    items.forEach((item) => { const start = new Date(`${String(item.start_date).slice(0, 10)}T00:00:00`); const end = item.end_date ? new Date(`${String(item.end_date).slice(0, 10)}T00:00:00`) : start; for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) if (date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear()) (byDay[date.getDate()] ||= []).push(item); });
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay(); const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); let cells = '<div class="cal-cell out"></div>'.repeat(first);
    for (let day = 1; day <= days; day++) { const date = new Date(month.getFullYear(), month.getMonth(), day); const list = byDay[day] || []; let cls = `cal-cell${date.getTime() === today.getTime() ? ' today' : ''}`; if (list.length) { const event = list.find((item) => item.kind === 'event'); cls += event ? ` ${mcalTypeOf(event).cls}` : ' t-due'; } cells += `<div class="${cls}" data-day="${day}">${day}</div>`; }
    grid.innerHTML = cells; root.querySelector('#calCount').textContent = `${items.length} Event${items.length === 1 ? '' : 's'}`;
    grid.querySelectorAll('[data-day]').forEach((cell) => cell.onclick = () => { const list = byDay[Number(cell.dataset.day)] || []; if (list.length) showCalendarEventDetails(list); });
    const sorted = [...items].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    root.querySelector('#calList').innerHTML = sorted.length ? sorted.map((item) => { const type = item.kind === 'event' ? mcalTypeOf(item) : null; const isPast = new Date(`${String(item.start_date).slice(0, 10)}T00:00:00`) < today; const label = type ? type.label : (isPast ? 'Missed Assignment' : 'Upcoming Activity'); const color = type ? type.dot : (isPast ? '#f76c6c' : MCAL_DUE.dot); const classLine = item.kind === 'assignment' && item.course_title ? `<div class="dsc" style="color:#b02458;font-weight:800">▣ From class: ${mcalEsc(item.course_title)}</div>` : ''; const desc = mcalCleanDesc(item) || ''; const actions = isDean && item.kind === 'event' ? `<details class="cal-event-menu"><summary aria-label="Event options">⋮</summary><div class="cal-event-menu-options"><button type="button" class="cal-event-delete" data-delete-event="${Number(item.id)}">Delete event</button></div></details>` : ''; return `<div class="cal-item"><div class="cal-item-title-row"><div><div class="cat2" style="color:${color}">${label}</div><div class="ttl">${mcalEsc(item.title)}</div></div>${actions}</div>${classLine}<div class="date2">📅 ${mcalExactDate(item)}</div>${desc ? `<div class="dsc">${mcalEsc(desc)}</div>` : ''}</div>`; }).join('') : '<p class="cal-sub">Nothing scheduled this month.</p>';
    root.querySelectorAll('[data-delete-event]').forEach((button) => {
      button.addEventListener('click', async () => {
        const confirmed = await showConfirmationDialog({
          title: 'Delete calendar event?',
          message: 'This event will be removed from the calendar and cannot be restored.',
          confirmLabel: 'Delete event'
        });
        if (!confirmed) return;
        button.disabled = true;
        try {
          const response = await fetch(`/api/pages/events/${encodeURIComponent(button.dataset.deleteEvent)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: ctx.role, user_id: ctx.userId })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Could not delete the event.');
          showToast('Calendar event deleted.');
          await load();
        } catch (error) {
          button.disabled = false;
          showToast(error.message || 'Could not delete the event.', { type: 'error' });
        }
      });
    });
  }
  load();
}

/* ============ RESOURCES PAGE: Study Library ============ */
const resEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const resIcon = (url) => {
  const extension = String(url || '').split('?')[0].split('.').pop().toLowerCase();
  if (extension === 'pdf') return '📕';
  if (['doc', 'docx'].includes(extension)) return '📝';
  if (['ppt', 'pptx'].includes(extension)) return '📊';
  if (['png', 'jpg', 'jpeg'].includes(extension)) return '🖼️';
  if (extension === 'zip') return '🗜️';
  return '🔗';
};
function resStyles() {
  if (document.getElementById('resStyles')) return;
  const style = document.createElement('style'); style.id = 'resStyles';
  style.textContent = `.res-search{width:100%;max-width:420px;padding:11px 16px;border:1.5px solid #ecd3dd;border-radius:8px;outline:none;margin-bottom:16px;font-size:14px;box-sizing:border-box}.res-search:focus{border-color:#d6336c;box-shadow:0 0 0 3px rgba(214,51,108,.12)}.res-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}.res-card{background:#fff;border:1px solid #f0dfe6;border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 2px 8px rgba(176,36,88,.06)}.res-icon{width:46px;height:46px;border-radius:8px;background:#fde8ef;display:flex;align-items:center;justify-content:center;font-size:22px}.res-title{font-weight:800;color:#333}.res-class{color:#b02458;font-size:12px;font-weight:700}.res-actions{display:flex;gap:8px;margin-top:auto}.res-view,.res-dl{flex:1;text-align:center;border-radius:8px;padding:9px 0;font-weight:700;text-decoration:none;font-size:13px}.res-view{border:1.5px solid #d6336c;color:#b02458;background:#fff}.res-view:hover{background:#fde8ef}.res-dl{background:linear-gradient(135deg,#e0477e,#d6336c);color:#fff}.res-dl:hover{filter:brightness(1.07)}`;
  document.head.appendChild(style);
}
function renderResourcesPage(ctx, root) {
  if (!root) return; mcalStyles(); resStyles();
  const isStaff = ['instructor', 'teacher', 'dean', 'admin', 'superadmin'].includes(String(ctx.role || '').toLowerCase().replace(/\s+/g, ''));
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start"><div><div class="cal-kicker">RESOURCES</div><div class="cal-h2">Study Library</div><p class="cal-sub cal-heading-sub">Lessons and materials shared by your instructors.</p></div>${isStaff ? '<button class="cal-pillbtn" id="resAdd">+ Add Resource</button>' : ''}</div><input class="res-search" id="resSearch" placeholder="🔍 Search by title or class…"><div class="res-grid" id="resGrid"></div>`;
  let items = []; const grid = root.querySelector('#resGrid');
  const draw = (filter = '') => { const query = filter.toLowerCase(); const visible = items.filter((item) => !query || String(item.title).toLowerCase().includes(query) || String(item.course_title || '').toLowerCase().includes(query)); grid.innerHTML = visible.length ? visible.map((item) => { const viewUrl = String(item.pdf_url).startsWith('/uploads/') ? `/api/materials/${encodeURIComponent(item.material_id)}/preview` : item.pdf_url; return `<div class="res-card"><div class="res-icon">${resIcon(item.pdf_url)}</div><div class="res-title">${resEsc(item.title)}</div><div class="res-class">📘 ${resEsc(item.course_title || '')}${item.course_code ? ` (${resEsc(item.course_code)})` : ''}</div>${item.pdf_url ? `<div class="res-actions"><a class="res-view" href="${resEsc(viewUrl)}" target="_blank" rel="noopener">◉ View</a><a class="res-dl" href="/api/materials/${encodeURIComponent(item.material_id)}/download">⇩ Download</a></div>` : '<div class="res-class">No file attached</div>'}</div>`; }).join('') : '<p class="cal-sub">No resources found.</p>'; };
  root.querySelector('#resSearch').oninput = (event) => draw(event.target.value);
  root.querySelector('#resAdd')?.addEventListener('click', () => resAddModal(ctx, load));
  async function load() { grid.innerHTML = '<p class="cal-sub">Loading…</p>'; const response = await fetch(`/api/pages/resources?role=${encodeURIComponent(ctx.role)}&user_id=${encodeURIComponent(ctx.userId)}`); items = response.ok ? await response.json() : []; draw(); }
  load();
}
function resAddModal(ctx, onDone) {
  const previous = document.getElementById('resProOverlay'); if (previous) previous.remove();
  const overlay = document.createElement('div'); overlay.id = 'resProOverlay';
  overlay.innerHTML = `<style>#resProOverlay{position:fixed;inset:0;background:rgba(60,10,30,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}.res-modal{width:min(560px,94vw);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.35)}.res-modal-head{background:linear-gradient(135deg,#e0477e,#b02458);color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}.res-modal-head h3{margin:0;font-size:18px}.res-modal-body{padding:20px 22px}.res-modal-label{display:block;font-size:11px;font-weight:800;letter-spacing:.6px;color:#8f1d3f;text-transform:uppercase;margin:14px 0 6px}.res-modal-input{width:100%;padding:11px 12px;border:1.5px solid #ecd3dd;border-radius:10px;font-size:14px;box-sizing:border-box}.res-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid #f3e1e9;background:#fdf7fa}.res-modal-btn{border:0;border-radius:999px;padding:11px 22px;font-weight:800;cursor:pointer}.res-modal-save{background:linear-gradient(135deg,#e0477e,#d6336c);color:#fff}.res-modal-error{color:#c62828;font-size:12px;margin-top:12px;display:none}</style><div class="res-modal"><div class="res-modal-head"><h3>📚 Add Resource</h3><button type="button" data-close>✕</button></div><div class="res-modal-body"><label class="res-modal-label">Resource title *</label><input class="res-modal-input" id="resTitle" placeholder="e.g. Chapter 1 – Networking Basics"><label class="res-modal-label">Class *</label><select class="res-modal-input" id="resClass"><option value="">Loading classes…</option></select><label class="res-modal-label">File</label><input class="res-modal-input" type="file" id="resFile"><label class="res-modal-label">Or paste a link</label><input class="res-modal-input" id="resLink" placeholder="https://…"><p class="res-modal-error" id="resError"></p></div><div class="res-modal-foot"><button class="res-modal-btn" type="button" data-close>Cancel</button><button class="res-modal-btn res-modal-save" id="resSave" type="button">Save Resource</button></div></div>`;
  document.body.appendChild(overlay); const close = () => overlay.remove(); overlay.querySelectorAll('[data-close]').forEach((button) => button.onclick = close); overlay.onclick = (event) => { if (event.target === overlay) close(); };
  fetch(`/api/pages/my-classes?role=${encodeURIComponent(ctx.role)}&user_id=${encodeURIComponent(ctx.userId)}`)
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load your classes.');
      return data;
    })
    .then((classes) => {
      overlay.querySelector('#resClass').innerHTML = (Array.isArray(classes) ? classes : [])
        .map((course) => `<option value="${course.course_id}">${resEsc(course.title)}${course.code ? ` (${resEsc(course.code)})` : ''}</option>`)
        .join('') || '<option value="">No classes available</option>';
    })
    .catch((error) => {
      overlay.querySelector('#resClass').innerHTML = '<option value="">Unable to load classes</option>';
      const message = overlay.querySelector('#resError');
      message.textContent = error.message;
      message.style.display = 'block';
    });
  overlay.querySelector('#resSave').onclick = async () => { const error = overlay.querySelector('#resError'); const title = overlay.querySelector('#resTitle').value.trim(); const courseId = overlay.querySelector('#resClass').value; const file = overlay.querySelector('#resFile').files[0]; const link = overlay.querySelector('#resLink').value.trim(); const fail = (message) => { error.textContent = message; error.style.display = 'block'; }; error.style.display = 'none'; if (!title) return fail('Please enter a title.'); if (!courseId) return fail('Please choose a class.'); if (!file && !link) return fail('Attach a file or paste a link.'); const button = overlay.querySelector('#resSave'); button.disabled = true; button.textContent = 'Saving…'; const form = new FormData(); form.append('title', title); form.append('course_id', courseId); form.append('role', ctx.role); form.append('user_id', String(ctx.userId)); if (file) form.append('file', file); if (link) form.append('file_link', link); const response = await fetch('/api/pages/resources', { method: 'POST', body: form }); const data = await response.json().catch(() => ({})); button.disabled = false; button.textContent = 'Save Resource'; if (!response.ok) return fail(data.error || 'Could not save the resource.'); close(); if (onDone) onDone(); };
}

/* ============ CLASS RECORD: roster + grade grid + export reports ============ */
const crEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
function crStyles() {
  if (document.getElementById('crStyles')) return;
  const style = document.createElement('style'); style.id = 'crStyles';
  style.textContent = `.cr-card{background:#fff;border:1px solid #f0dfe6;border-radius:14px;padding:16px;margin-bottom:16px;overflow:auto}.cr-h{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin:6px 0 10px}.cr-title{font-size:16px;font-weight:800;color:#8f1d3f}.cr-roster-toggle{padding:4px 0;border:0;background:transparent;font:inherit;cursor:pointer;text-align:left}.cr-roster-toggle:hover,.cr-roster-toggle:focus-visible{text-decoration:underline}.cr-roster-toggle[aria-expanded="true"]::after{content:'  ▴';font-size:12px}.cr-roster-toggle[aria-expanded="false"]::after{content:'  ▾';font-size:12px}.cr-btn{border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px}.cr-csv{background:linear-gradient(135deg,#e0477e,#d6336c);color:#fff}.cr-print{background:#fff;color:#8f1d3f;border:1.5px solid #ecd3dd}.cr-table{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}.cr-table th{background:#fdeef5;color:#8f1d3f;padding:8px 10px;text-align:left}.cr-table td{border:1px solid #f3e1e9;padding:8px 10px}.cr-pts{display:block;font-size:10px;color:#b06080;font-weight:600}.cr-id{color:#999;font-size:11px}.cr-pass{color:#1e7e34;font-weight:800}.cr-fail{color:#c62828;font-weight:800}.cr-none{color:#bbb;text-align:center}.cr-avg{font-weight:800;color:#8f1d3f}`;
  style.textContent += `.cr-search-wrap{display:flex;align-items:center;gap:9px;width:min(330px,100%);padding:0 12px;border:1px solid #e3d7dd;border-radius:9px;background:#fff;color:#a6224e;box-shadow:0 2px 7px rgba(46,28,38,.035)}.cr-search-wrap:focus-within{border-color:#a6224e;box-shadow:0 0 0 3px rgba(166,34,78,.1)}.cr-search-wrap>span{font-size:20px;line-height:1}.cr-search-wrap input{width:100%;min-width:0;padding:10px 0;border:0!important;outline:0!important;background:transparent;font:inherit;font-size:13px}.cr-search-wrap input:focus{box-shadow:none!important}.cr-search-empty{padding:14px;color:#786b72;text-align:center;font-size:13px}.cr-table tr[hidden]{display:none}.cr-student-info-link{padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:800;text-align:left;cursor:pointer}.cr-student-info-link:hover,.cr-student-info-link:focus-visible{color:#a6224e;text-decoration:underline}.cr-student-info-overlay{position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(42,20,30,.42);backdrop-filter:blur(3px)}.cr-student-info-card{width:min(480px,100%);overflow:hidden;border:1px solid #f0dfe6;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(55,20,38,.24)}.cr-student-info-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;background:linear-gradient(135deg,#e0477e,#b02458);color:#fff}.cr-student-info-head h3{margin:0;font-size:18px}.cr-student-info-close{width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;font-size:22px;cursor:pointer}.cr-student-info-body{padding:12px 22px 20px}.cr-student-info-table{width:100%;border-collapse:collapse;font-size:14px}.cr-student-info-table th,.cr-student-info-table td{padding:13px 12px;border:1px solid #f0dfe6;text-align:left}.cr-student-info-table th{width:38%;background:#fdeef5;color:#8f1d3f;font-weight:700}.cr-student-info-table td{color:#392a32;font-weight:600}`;
  document.head.appendChild(style);
}
async function renderClassRecordPro(courseId, ctx, root, courseTitle) {
  if (!root) return; crStyles(); root.innerHTML = '<p class="cal-sub">Loading class record…</p>';
  const response = await fetch(`/api/courses/${courseId}/record`);
  if (!response.ok) { root.innerHTML = '<p class="cal-sub">Failed to load the class record.</p>'; return; }
  const data = await response.json(); const students = data.students || []; const assignments = data.assignments || []; const classYearLevel = data.course_year || ''; const scores = {};
  (data.scores || []).forEach((score) => { scores[`${score.student_id}|${score.assignment_id}`] = score; });
  const percentage = (score, assignment) => (Number(score.score) / Number(assignment.total_points || 100)) * 100;
  const displayStudentId = (studentId) => String(studentId ?? '').replace(/\D/g, '');
  const displayCourse = (student) => String(student.course || student.year_level || '').trim().replace(/^BS\s*-?\s*IT$/i, 'BS-IT');
  const studentSearchText = (student) => crEsc([student.student_name, student.student_id, student.year_level, student.course, student.academic_year].filter(Boolean).join(' '));
  const grid = assignments.length ? `<table class="cr-table"><thead><tr><th>Student</th>${assignments.map((assignment) => `<th>${crEsc(assignment.title)}<span class="cr-pts">/ ${assignment.total_points} pts</span></th>`).join('')}</tr></thead><tbody>${students.map((student, index) => { const cells = assignments.map((assignment) => { const score = scores[`${student.student_id}|${assignment.assignment_id}`]; if (!score || score.score == null) return '<td class="cr-none">—</td>'; const pct = percentage(score, assignment); return `<td class="${pct >= 75 ? 'cr-pass' : 'cr-fail'}">${score.score}</td>`; }).join(''); return `<tr class="cr-grade-row" data-search="${studentSearchText(student)}"><td><button type="button" class="cr-student-info-link" data-student-index="${index}" aria-label="View ${crEsc(student.student_name)}'s information">${crEsc(student.student_name)}</button> <span class="cr-id">${crEsc(displayStudentId(student.student_id))}</span></td>${cells}</tr>`; }).join('')}</tbody></table>` : '<p class="cr-id">No activities or quizzes created yet.</p>';
  root.innerHTML = `<div class="cr-h"><label class="cr-search-wrap"><span aria-hidden="true">⌕</span><input id="crStudentSearch" type="search" placeholder="Search name, ID, or course" aria-label="Search students by name, ID, or course"></label><span style="display:flex;gap:8px"><button class="cr-btn cr-csv" id="crCsv">⬇ Export CSV</button><button class="cr-btn cr-print" id="crPrint">🖨 Print / Save PDF</button></span></div><div class="cr-h"><span class="cr-title">🎓 Grade Grid</span></div><div class="cr-card">${grid}${students.length && assignments.length ? '<p class="cr-search-empty" id="crGridNoResults" hidden>No students match your search.</p>' : ''}</div>`;
  root.querySelectorAll('.cr-student-info-link').forEach((button) => {
    button.addEventListener('click', () => {
      const student = students[Number(button.dataset.studentIndex)];
      if (!student) return;
      const overlay = document.createElement('div');
      overlay.className = 'cr-student-info-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML = `<section class="cr-student-info-card" role="dialog" aria-modal="true" aria-labelledby="crStudentInfoTitle"><header class="cr-student-info-head"><h3 id="crStudentInfoTitle">Student Information</h3><button type="button" class="cr-student-info-close" aria-label="Close">×</button></header><div class="cr-student-info-body"><table class="cr-student-info-table"><tbody><tr><th scope="row">Student ID</th><td>${crEsc(displayStudentId(student.student_id) || '—')}</td></tr><tr><th scope="row">Name</th><td>${crEsc(student.student_name || '—')}</td></tr><tr><th scope="row">Year Level</th><td>${crEsc(classYearLevel || student.year_level || '—')}</td></tr><tr><th scope="row">Course</th><td>${crEsc(displayCourse(student) || '—')}</td></tr></tbody></table></div></section>`;
      const closeOnEscape = (event) => { if (event.key === 'Escape') close(); };
      const close = () => { overlay.remove(); document.removeEventListener('keydown', closeOnEscape); };
      overlay.querySelector('.cr-student-info-close').addEventListener('click', close);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
      document.addEventListener('keydown', closeOnEscape);
      document.body.appendChild(overlay);
      overlay.querySelector('.cr-student-info-close').focus();
    });
  });
  root.querySelector('#crStudentSearch')?.addEventListener('input', (event) => {
    const query = event.currentTarget.value.trim().toLocaleLowerCase();
    let visibleCount = 0;
    root.querySelectorAll('.cr-grade-row').forEach((row) => {
      const matches = !query || row.dataset.search.toLocaleLowerCase().includes(query);
      row.hidden = !matches;
      if (matches) visibleCount++;
    });
    const noGridResults = root.querySelector('#crGridNoResults');
    if (noGridResults) noGridResults.hidden = visibleCount > 0;
  });
  root.querySelector('#crCsv').onclick = () => { const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`; const header = ['Student ID', 'Student Name', 'Year Level', 'Course', 'Academic Year', ...assignments.map((assignment) => `${assignment.title} (/${assignment.total_points})`)]; const rows = [header]; students.forEach((student) => { const values = assignments.map((assignment) => { const score = scores[`${student.student_id}|${assignment.assignment_id}`]; return !score || score.score == null ? '' : score.score; }); rows.push([displayStudentId(student.student_id), student.student_name, classYearLevel || student.year_level || '', displayCourse(student), student.academic_year || '', ...values]); }); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv' })); link.download = `Class-Record-${String(courseTitle || courseId).replace(/[^\w-]+/g, '_')}.csv`; link.click(); URL.revokeObjectURL(link.href); };
  root.querySelector('#crPrint').onclick = () => { const popup = window.open('', '_blank'); popup.document.write(`<html><head><title>Class Record</title><style>body{font-family:Segoe UI,Arial;padding:24px;color:#222}table{border-collapse:collapse;width:100%;margin-top:14px;font-size:12px}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#fdeef5}</style></head><body><h1>IMCC LMS — Class Record</h1><h2>${crEsc(courseTitle || `Class #${courseId}`)}</h2><p>Generated ${new Date().toLocaleString()}</p>${grid}</body></html>`); popup.document.close(); popup.focus(); popup.print(); };
}

/* ===== FINAL UPGRADE: Google SSO main + Super Admin hyperlink =====
   This final block supersedes the earlier login handlers in this file. */
/* ===== ULTIMATE GOOGLE SSO BLOCK (final) ===== */
// GOOGLE_CLIENT_ID is intentionally NOT hardcoded here.
// It is fetched at runtime from /api/config (set via GOOGLE_CLIENT_ID env var on the backend).

(function loadGsiScript() {
  if (document.querySelector('script[src*="accounts.google.com/gsi"]')) return;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  document.head.appendChild(s);
})();

async function handleGoogleSSOLogin(response) {
  const errorElem = document.getElementById('loginError');
  if (errorElem) errorElem.style.display = 'none';

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google sign-in failed.');
    completeGoogleLogin(data.user, data.authToken);
  } catch (error) {
    console.error('Google login error:', error);
    if (errorElem) {
      errorElem.textContent = error.message || 'Cannot connect to backend server.';
      errorElem.style.display = 'block';
    }
  }
}

function toggleLoginTab(tab) {
  const googleSec = document.getElementById('googleAuthSection');
  const adminSec = document.getElementById('adminAuthSection');
  const backButton = document.getElementById('btnBackToNormal');
  const errorElem = document.getElementById('loginError');
  if (errorElem) errorElem.style.display = 'none';
  if (tab === 'google') {
    if (googleSec) googleSec.style.display = 'block';
    if (adminSec) adminSec.style.display = 'none';
    if (backButton) backButton.style.display = 'none';
  } else {
    if (googleSec) googleSec.style.display = 'none';
    if (adminSec) adminSec.style.display = 'block';
    if (backButton) backButton.style.display = 'block';
  }
}

function initRealGoogleSSO(googleClientId) {
  if (!googleClientId) {
    console.warn('[SSO] GOOGLE_CLIENT_ID is not configured. Google sign-in will be unavailable.');
    return;
  }
  const setup = () => {
    if (!window.google?.accounts?.id) return false;
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleSSOLogin,
      auto_select: false,
    });
    let holder = document.getElementById('googleRealBtn');
    if (!holder) {
      const oldBtn = Array.from(document.querySelectorAll('#loginScreen button')).find((b) => /sign in with google/i.test(b.textContent || ''));
      const anchor = oldBtn || document.getElementById('googleAuthSection');
      if (anchor) {
        holder = document.createElement('div');
        holder.id = 'googleRealBtn';
        holder.style.cssText = 'display:flex;justify-content:center;margin:12px 0;';
        anchor.parentNode.insertBefore(holder, anchor.nextSibling);
        if (oldBtn) oldBtn.style.display = 'none';
      }
    }
    if (holder && !holder.dataset.rendered) {
      google.accounts.id.renderButton(holder, { theme: 'outline', size: 'large', shape: 'pill', width: 260 });
      holder.dataset.rendered = '1';
    }
    return true;
  };
  const wait = () => { if (!setup()) setTimeout(wait, 400); };
  wait();
  setTimeout(setup, 2000);
}

document.addEventListener('DOMContentLoaded', async () => {
  toggleLoginTab('google');
  const st = document.createElement('style');
  st.textContent = '.superadmin-link{background:none!important;border:none!important;box-shadow:none!important;color:#8a6470!important;font-size:12px!important;font-weight:600!important;text-decoration:underline!important;padding:4px!important;margin:12px auto 4px!important;display:block!important;cursor:pointer}';
  document.head.appendChild(st);
  document.querySelectorAll('#loginScreen button, #loginScreen a').forEach((el) => {
    if ((el.textContent || '').trim() === 'Super Admin') el.classList.add('superadmin-link');
  });
  // Fetch GOOGLE_CLIENT_ID from backend config (never hardcode it in frontend source)
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    initRealGoogleSSO(cfg.googleClientId || '');
  } catch (_e) {
    console.warn('[SSO] Could not load /api/config; Google sign-in may be unavailable.');
    initRealGoogleSSO('');
  }
});

/* ===== SUPER ADMIN = ROLE REGISTRAR (final) ===== */
async function assignRoleToEmail() {
  const emailInput = document.getElementById('adminNewEmail');
  const roleSelect = document.getElementById('adminNewRole');
  const nameInput = document.getElementById('adminNewName');
  const email = (emailInput?.value || '').trim().toLowerCase();
  const role = roleSelect?.value || 'student';
  const name = (nameInput?.value || '').trim();

  if (!email) {
    window.alert('Please enter the institutional email (e.g. name@imcc.edu.ph).');
    return;
  }

  try {
    const authToken = localStorage.getItem('lms_auth_token');
    const res = await fetch('/api/admin/assign-role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken || ''}`,
      },
      body: JSON.stringify({ email, role, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error || 'Failed to assign role.');
      return;
    }
    const roleLabel = { student: 'Student', teacher: 'Instructor', dean: 'Dean' }[role] || role;
    showToast(`Role assigned successfully. ${email} now has ${roleLabel} access.`);
    if (emailInput) emailInput.value = '';
    if (nameInput) nameInput.value = '';
    loadAndDisplayUserAccounts();
  } catch (err) {
    console.error('Assign role error:', err);
    window.alert('Server connection error.');
  }
}

async function loadAndDisplayUserAccounts() {
  const deansBody = document.getElementById('deansTableBody');
  const teachersBody = document.getElementById('teachersTableBody');
  const studentsBody = document.getElementById('studentsTableBody');
  if (!deansBody || !teachersBody || !studentsBody) return;

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
  const rows = (list, empty) => list.length
    ? list.map((user) => `<tr><td style="padding:8px 10px;border:1px solid #ddd;">${esc(user.student_id)}</td><td style="padding:8px 10px;border:1px solid #ddd;">${esc(user.name)}</td><td style="padding:8px 10px;border:1px solid #ddd;">${esc(user.email)}</td></tr>`).join('')
    : `<tr><td colspan="3" style="padding:10px;text-align:center;color:#888;">${empty}</td></tr>`;

  try {
    const res = await fetch('/api/admin/users');
    const users = await res.json();
    if (!res.ok) throw new Error(users.error || 'Failed to load accounts.');
    const list = Array.isArray(users) ? users : [];
    deansBody.innerHTML = rows(list.filter((user) => String(user.role || '').toLowerCase() === 'dean'), 'No Deans registered.');
    teachersBody.innerHTML = rows(list.filter((user) => ['teacher', 'instructor'].includes(String(user.role || '').toLowerCase())), 'No Instructors registered.');
    studentsBody.innerHTML = rows(list.filter((user) => String(user.role || '').toLowerCase() === 'student'), 'No Students registered.');
  } catch (_err) {
    deansBody.innerHTML = rows([], 'Unable to load account records.');
    teachersBody.innerHTML = rows([], 'Unable to load account records.');
    studentsBody.innerHTML = rows([], 'Unable to load account records.');
  }
}

function upgradeAdminPanel() {
  const panel = document.getElementById('adminPanel');
  if (!panel || panel.dataset.roleRegistrarUpgraded) return;
  panel.dataset.roleRegistrarUpgraded = '1';

  const emailInput = document.getElementById('adminNewEmail');
  if (emailInput) emailInput.placeholder = 'name@imcc.edu.ph';

  const assignButton = panel.querySelector('button[onclick="createNewUserAccount()"]');
  if (assignButton) {
    assignButton.textContent = '✔ Assign Role';
    assignButton.onclick = assignRoleToEmail;
  }
}

document.addEventListener('DOMContentLoaded', upgradeAdminPanel);

/* ===== DEAN: Instructor picker + auto-join instructor dashboard ===== */
async function loadInstructorOptions() {
  const input = document.getElementById('classInstructorInput');
  if (!input) return;
  let select = document.getElementById('classInstructorSelect');
  const user = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
  const role = String(user.role || localStorage.getItem('lms_user_role') || '').toLowerCase();
  const deanField = document.getElementById('approvingDeanField');
  const submitButton = document.getElementById('createClassSubmit');
  if (['teacher', 'instructor'].includes(role)) {
    input.value = String(user.name || user.first_name || '');
    input.readOnly = true;
    input.style.display = '';
    if (select) select.hidden = true;
    if (deanField) deanField.hidden = false;
    if (submitButton) submitButton.textContent = 'Send for approval';
    await loadApprovingDeanOptions();
    return;
  }
  input.readOnly = false;
  if (deanField) deanField.hidden = true;
  if (submitButton) submitButton.textContent = 'Create Class';
  if (!select) {
    select = document.createElement('select');
    select.id = 'classInstructorSelect';
    select.style.cssText = 'width:100%;padding:12px;border:1.5px solid #ecd3dd;border-radius:10px;font-size:14px;background:#fff;box-sizing:border-box;margin-top:4px;';
    input.parentNode.insertBefore(select, input.nextSibling);
    input.style.display = 'none';
  }
  select.innerHTML = '<option value="">Loading instructors…</option>';
  try {
    const res = await fetch('/api/admin/users');
    const users = await res.json();
    const list = Array.isArray(users) ? users : [];
    const currentUser = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
    const currentUserId = String(currentUser.student_id || currentUser.user_id || getCurrentUserId() || '');
    const isDean = String(currentUser.role || localStorage.getItem('lms_user_role') || '').toLowerCase() === 'dean';
    const teachers = list.filter((u) => ['teacher', 'instructor'].includes(String(u.role || '').toLowerCase()));
    select.hidden = false;
    input.style.display = 'none';
    if (isDean && currentUserId) {
      const deanAccount = list.find((u) => String(u.student_id) === currentUserId);
      const selfOption = deanAccount || { student_id: currentUserId, name: currentUser.name || currentUser.first_name || 'Dean', email: currentUser.email || '' };
      teachers.push({ ...selfOption, role: 'dean', isCurrentDean: true });
    }
    select.innerHTML = '<option value="">— No instructor assigned —</option>' +
      teachers.map((u) => `<option value="${escapeHtml(u.student_id)}" data-name="${escapeHtml(u.name || '')}">${escapeHtml(u.name || '')}${u.isCurrentDean ? ' (Dean — You)' : ` (${escapeHtml(u.email || '')})`}</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Unable to load instructors</option>';
  }
}

async function loadApprovingDeanOptions() {
  const select = document.getElementById('classApprovingDeanSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Loading deans...</option>';
  try {
    const response = await fetch('/api/admin/users');
    const users = await response.json();
    if (!response.ok) throw new Error('Unable to load deans');
    const deans = (Array.isArray(users) ? users : []).filter((user) => String(user.role || '').toLowerCase() === 'dean');
    select.innerHTML = '<option value="">Select a dean</option>' + deans.map((dean) =>
      `<option value="${escapeHtml(dean.student_id)}">${escapeHtml(dean.name || 'Dean')}${dean.email ? ` (${escapeHtml(dean.email)})` : ''}</option>`
    ).join('');
    if (!deans.length) select.innerHTML = '<option value="">No deans are available</option>';
  } catch (_error) {
    select.innerHTML = '<option value="">Unable to load deans</option>';
  }
}

function upgradeCreateClassInstructorPicker() {
  const submitBtn = document.getElementById('createClassSubmit');
  if (!submitBtn || submitBtn.dataset.upgraded) return;
  submitBtn.dataset.upgraded = '1';
  const fresh = submitBtn.cloneNode(true); // removes the old submit listener safely
  submitBtn.parentNode.replaceChild(fresh, submitBtn);
  const classNameField = document.getElementById('classNameInput');
  classNameField?.addEventListener('input', () => {
    const missing = !classNameField.value.trim();
    classNameField.classList.toggle('required-missing', missing);
    classNameField.setAttribute('aria-invalid', String(missing));
  });
  fresh.addEventListener('click', async () => {
    const className = (document.getElementById('classNameInput')?.value || '').trim();
    const courseCode = (document.getElementById('classCourseInput')?.value || '').trim();
    const course = (document.getElementById('classCourseNameInput')?.value || courseCode).trim();
    const year = (document.getElementById('classYearInput')?.value || '').trim();
    const section = (document.getElementById('classSectionInput')?.value || '').trim();
    const subjectNotes = (document.getElementById('classCategoryInput')?.value || '').trim();
    const select = document.getElementById('classInstructorSelect');
    const selected = select?.selectedOptions?.[0];
    const instructorIdRaw = (select?.value || '').trim();
    const instructorName = (selected?.dataset?.name || selected?.textContent || '').trim();
    const currentUser = JSON.parse(localStorage.getItem('lms_current_user') || '{}');
    const currentRole = String(currentUser.role || localStorage.getItem('lms_user_role') || '').toLowerCase();
    const isInstructor = ['teacher', 'instructor'].includes(currentRole);
    const approvingDeanId = String(document.getElementById('classApprovingDeanSelect')?.value || '').trim();
    const msg = document.getElementById('createClassMessage');
    if (!className) {
      classNameField?.classList.add('required-missing');
      classNameField?.setAttribute('aria-invalid', 'true');
      if (msg) { msg.textContent = 'Please enter a class name.'; msg.classList.add('error'); }
      classNameField?.focus();
      return;
    }
    if (isInstructor && !approvingDeanId) {
      if (msg) { msg.textContent = 'Select the dean who will review this class.'; msg.classList.add('error'); }
      document.getElementById('classApprovingDeanSelect')?.focus();
      return;
    }
    classNameField?.classList.remove('required-missing');
    classNameField?.setAttribute('aria-invalid', 'false');
    fresh.textContent = isInstructor ? 'Sending...' : 'Creating...';
    fresh.disabled = true;
    if (msg) { msg.textContent = isInstructor ? 'Sending class request...' : 'Creating class...'; msg.classList.remove('error'); }
    try {
      const response = await fetch(isInstructor ? '/api/classes/requests' : '/api/classes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: className,
          course,
          courseCode,
          yearLevel: year,
          instructor: isInstructor ? String(currentUser.name || currentUser.first_name || '') : instructorName || 'Instructor not set',
          section,
          subText: subjectNotes,
          teacherId: isInstructor ? getCurrentUserId() : instructorIdRaw || null,
          createdBy: getCurrentUserId(),
          deanId: approvingDeanId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create class.');
      const codeDisplay = document.getElementById('classCodeDisplay');
      const codeGroup = document.getElementById('createClassCodeGroup');
      const successTitle = document.getElementById('createClassSuccessTitle');
      const successMessage = document.getElementById('createClassSuccessMessage');
      const copyButton = document.getElementById('copyCreateCodeBtn');
      if (codeDisplay) codeDisplay.value = data.classCode || '';
      if (isInstructor) {
        if (codeGroup) codeGroup.hidden = true;
        if (copyButton) copyButton.hidden = true;
        if (successTitle) successTitle.textContent = 'Class request sent';
        if (successMessage) successMessage.textContent = 'Your selected dean will review the class details. The class will appear in your dashboard after approval.';
      }
      const formGroup = document.getElementById('createClassFormGroup');
      const successBox = document.getElementById('createClassSuccessBox');
      if (formGroup) formGroup.hidden = true;
      if (successBox) successBox.hidden = false;
      if (!isInstructor) await fetchDashboardData(getCurrentUserId());
    } catch (error) {
      if (msg) { msg.textContent = error.message || 'Unable to create class. Please try again.'; msg.classList.add('error'); }
    } finally {
      fresh.disabled = false;
      fresh.textContent = isInstructor ? 'Send for approval' : 'Create Class';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  upgradeCreateClassInstructorPicker();
  document.getElementById('createClassBtn')?.addEventListener('click', loadInstructorOptions);
  document.getElementById('saveEditedClassCardBtn')?.addEventListener('click', saveEditedClassCard);
  document.getElementById('approveClassRequestBtn')?.addEventListener('click', async (event) => {
    if (!activeClassCreationRequest) return;
    const button = event.currentTarget;
    const message = document.getElementById('classRequestReviewMessage');
    button.disabled = true;
    button.textContent = 'Approving...';
    if (message) { message.textContent = 'Creating the approved class...'; message.classList.remove('error'); }
    try {
      const response = await fetch(`/api/classes/requests/${encodeURIComponent(activeClassCreationRequest.request_id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deanId: getCurrentUserId() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to approve this request.');
      document.getElementById('classRequestReviewModal')?.classList.add('hidden');
      activeClassCreationRequest = null;
      showToast(`Class approved. Join code: ${data.classCode}`);
      await Promise.all([loadDashboardCourses(), loadPendingClassRequests()]);
    } catch (error) {
      if (message) { message.textContent = error.message || 'Unable to approve this request.'; message.classList.add('error'); }
    } finally {
      button.disabled = false;
      button.textContent = 'Approve and create class';
    }
  });
});


/* ===== Show assigned instructor name on class cards ===== */
async function loadDashboardCourses(fallbackCourses = []) {
  const role = localStorage.getItem('lms_user_role') || 'student';
  const userId = getCurrentUserId();
  if (!userId) {
    renderCourseCards([]);
    return;
  }
  try {
    const [response, usersRes] = await Promise.all([
      fetch(`/api/courses?role=${role}&user_id=${userId}`),
      fetch('/api/admin/users').catch(() => null),
    ]);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const users = usersRes && usersRes.ok ? await usersRes.json() : [];
    const names = new Map((Array.isArray(users) ? users : []).map((u) => [String(u.student_id), String(u.name || '')]));
    const courses = await response.json();
    courses.forEach((course) => {
      const name = String(course.instructor_name || names.get(String(course.teacher_id)) || '').trim();
      if (!name) return;
      const [metaPart = '', notePart = ''] = String(course.sub_text || '').split('|').map((p) => p.trim());
      const metaParts = splitCourseMetadata(metaPart);
      while (metaParts.length < 5) metaParts.push('');
      if (!metaParts[3] || /^(instructor not set|no instructor assigned)$/i.test(metaParts[3])) {
        metaParts[3] = name;
        course.sub_text = `${metaParts.join(' • ')}${notePart ? ` | ${notePart}` : ''}`;
      }
    });
    renderCourseCards(courses);
  } catch (error) {
    console.error('Failed to load role-based courses:', error);
    renderCourseCards(fallbackCourses);
  }
}
