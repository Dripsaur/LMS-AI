const API_URL = 'https://imcc-lms.onrender.com'; // Put your actual Render URL here

function updateWelcomeGreeting(user = {}) {
  const heading = document.getElementById('greetingHeading');
  if (!heading) return;
  const role = String(user.role || '').toLowerCase();
  const name = role === 'admin'
    ? 'Admin'
    : String(user.name || user.first_name || '').trim();
  heading.textContent = `WELCOME TO IMCC LMS PORTAL${name ? `, ${name.toUpperCase()}` : ''}`;
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
  if (createClassBtn) createClassBtn.hidden = currentRole !== 'dean' || isAdmin;
  if (joinClassBtn) joinClassBtn.hidden = currentRole === 'dean' || isAdmin;
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

function showToast(message) {
  document.getElementById('appToast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'appToast';
  toast.className = 'app-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = '<span class="app-toast-icon" aria-hidden="true">✓</span><span></span>';
  toast.querySelector('span:last-child').textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
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

  const activateSection = (targetId) => {
    contentSections.forEach((section) => {
      section.classList.toggle('active', section.id === targetId);
    });
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
    const role = ['dean', 'teacher', 'student'].includes(selectedRole) ? selectedRole : 'student';
    const isDean = role === 'dean';
    localStorage.setItem('lms_user_role', role);
    document.body.classList.toggle('joined-class-view', !isDean);
    if (createClassBtn) createClassBtn.hidden = !isDean;
    if (joinClassBtn) joinClassBtn.hidden = isDean || role === 'admin';
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
  const submitWorkBtn = document.getElementById('submitWorkBtn');
  const submissionReviewPanel = document.getElementById('submissionReviewPanel');
  const submissionReviewList = document.getElementById('submissionReviewList');
  const submissionGradeNote = document.getElementById('submissionGradeNote');
  const classCommentsList = document.getElementById('classCommentsList');
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

  const loadClassComments = async (courseId) => {
    if (!classCommentsList) return;
    classCommentsList.innerHTML = '<p class="class-comments-empty">Loading comments...</p>';
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/comments`);
      const comments = await response.json();
      if (!response.ok) throw new Error(comments.error || 'Unable to load comments.');
      if (activeCourseId !== courseId) return;
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
    if (!activeCourseId || !classCommentInput) return;
    const content = classCommentInput.value.trim();
    if (!content) return setClassCommentMessage('Write a comment before posting.', true);
    const submitButton = classCommentForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setClassCommentMessage('Posting...');
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(activeCourseId)}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('lms_auth_token') || ''}`,
        },
        body: JSON.stringify({ content, author_id: getCurrentUserId() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to post the comment.');
      classCommentInput.value = '';
      setClassCommentMessage('Comment posted.');
      await loadClassComments(activeCourseId);
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
      const response = await fetch(`/api/courses/${encodeURIComponent(activeCourseId)}/members`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load class members.');
      const members = Array.isArray(result.members) ? result.members : [];
      overlay.querySelector('.class-members-subtitle').textContent = `${members.length} member${members.length === 1 ? '' : 's'} enrolled in ${detailClassTitle?.textContent || 'this class'}.`;
      overlay.querySelector('.class-members-list').innerHTML = members.length
        ? members.map((member, index) => `<div class="class-member-row"><span class="class-member-avatar" aria-hidden="true">${escapeHtml(String(member.student_name || '?').trim().charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(member.student_name || `Student #${member.student_id}`)}</strong><small>${member.year_level ? escapeHtml(member.year_level) : 'Class member'}</small></div><span class="class-member-number">${index + 1}</span></div>`).join('')
        : '<p class="class-members-empty">No students have joined this class yet.</p>';
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

    submissionFileList.innerHTML = '';
    const fileName = state.fileName || state.file?.name;
    if (!fileName) {
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
    fileRow.appendChild(fileLabel);
    if (!state.submitted) {
      const removeButton = document.createElement('button');
      removeButton.className = 'submission-remove';
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', 'Remove attached file');
      removeButton.textContent = '×';
      removeButton.addEventListener('click', () => {
        submissionStates.set(item.id, { ...state, file: null, fileName: '' });
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
        link.href = submission.file_path;
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
  addSubmissionFileBtn?.addEventListener('click', () => submissionFileInput?.click());
  submissionFileInput?.addEventListener('change', () => {
    const file = submissionFileInput.files?.[0];
    if (!file || !selectedWorkItem) return;
    const current = submissionStates.get(selectedWorkItem.id) || { submitted: false };
    submissionStates.set(selectedWorkItem.id, { ...current, file, fileName: file.name });
    renderSubmissionPanel(selectedWorkItem);
  });
  submitWorkBtn?.addEventListener('click', async () => {
    if (!selectedWorkItem) return;
    const current = submissionStates.get(selectedWorkItem.id) || { file: null, submitted: false };
    if (!current.submitted && !current.file) {
      window.alert('Please add a file before submitting your work.');
      return;
    }
    submitWorkBtn.disabled = true;
    try {
      if (current.submitted) {
        const response = await fetch(`/api/assignments/${selectedWorkItem.id}/submission?student_id=${getCurrentUserId()}`, {
          method: 'DELETE',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to unsubmit your work.');
        submissionStates.set(selectedWorkItem.id, { ...current, file: null, fileName: '', submitted: false, score: null, feedback: '' });
      } else {
        const formData = new FormData();
        formData.append('student_id', getCurrentUserId());
        formData.append('file', current.file);
        const response = await fetch(`/api/assignments/${selectedWorkItem.id}/submission`, {
          method: 'POST',
          body: formData,
        });
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
        if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
        deleteButton.disabled = true;
        try {
          const response = await fetch(`/api/${item.dbTable}/${item.id}`, { method: 'DELETE' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Failed to delete class work.');
          const activeCard = document.querySelector(`.course-card[data-course-id="${activeCourseId}"]`);
          if (activeCard) await openCourseDetail(activeCard);
        } catch (error) {
          window.alert(error.message || 'Failed to delete class work.');
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
    loadClassComments(courseId);
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
        if (otherMenu !== menu) otherMenu.hidden = true;
      });
      if (menu) menu.hidden = !menu.hidden;
      return;
    }

    if (actionButton) {
      event.stopPropagation();
      const card = actionButton.closest('.course-card');
      const courseId = Number(card?.dataset.courseId);
      const action = actionButton.dataset.courseAction;
      const currentRole = String(localStorage.getItem('lms_user_role') || 'student').toLowerCase();
      const isDean = currentRole === 'dean';
      const canManageClasses = ['dean', 'teacher', 'instructor'].includes(currentRole);
      const menu = actionButton.closest('.card-dropdown-menu');
      if (menu) menu.hidden = true;

      if (action === 'view-code' && isDean) {
        window.alert(`Class Code: ${card?.dataset.classCode || 'Not available'}\n\nShare this code with your students so they can join.`);
      }

      if (action === 'unenroll' && !isDean && window.confirm('Are you sure you want to unenroll from this class?')) {
        manageCourseEnrollment(courseId);
      }

      if (action === 'delete' && canManageClasses) {
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

  document.addEventListener('click', () => {
    document.querySelectorAll('.card-dropdown-menu').forEach((menu) => {
      menu.hidden = true;
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
    const res = await fetch('/api/notifications/dashboard');
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
      return `<div class="notification-alert-row${isRead ? ' is-read' : ''}"><span class="notification-alert-icon" aria-hidden="true">${item.group === 'priority' ? '◷' : '▤'}</span><div class="notification-alert-copy"><strong>${escapeHtml(item.title || 'Notification')}</strong><span>${escapeHtml(item.message || '')} · ${escapeHtml(formatTimeAgo(item.created_at))}</span></div><i class="notification-unread-dot" aria-label="Unread"></i></div>`;
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
        if (systemContainer) systemContainer.innerHTML = renderAlerts(alerts);
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

  container.innerHTML = courses.map((course) => {
    const metadata = parseCourseMetadata(course.sub_text || '', course.code || 'Course');
    const statusText = escapeHtml(course.status || 'Active');
    const courseNameText = escapeHtml(metadata.courseName || course.code || 'Course');
    const courseCodeText = escapeHtml(metadata.courseCode || course.code || 'Course');
    const titleText = escapeHtml(course.title || 'Untitled course');
    const instructorText = escapeHtml(metadata.instructor || 'Instructor not set');
    const yearText = escapeHtml(metadata.year || '');
    const sectionText = escapeHtml(metadata.section || '');
    const subjectText = escapeHtml(metadata.note || '');
    const classCodeText = escapeHtml(course.class_code || 'Not available');
    const sectionBadgeText = sectionText ? ` <span class="meta-label">Section:</span> ${sectionText}` : '';
    const canDelete = isDean || (isInstructor && String(course.teacher_id || '') === String(currentUserId || ''));
    const roleActions = canDelete
      ? `${isDean ? '<button type="button" data-course-action="view-code">View code</button>' : ''}<button class="danger-option" type="button" data-course-action="delete">Delete class</button>`
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
            <p class="eyebrow">${courseNameText}${sectionBadgeText}</p>
            <h3>${titleText}</h3>
          </div>
          <div class="course-card-actions">
            <span class="tag">${statusText}</span>
            <div class="course-card-menu">
              <button class="three-dots-btn" type="button" data-course-menu aria-label="Class options" aria-expanded="false">&#8942;</button>
              <div class="card-dropdown-menu" hidden>
                ${roleActions}
              </div>
            </div>
          </div>
        </div>
        <div class="course-detail-meta">
          ${metadataRows}
          ${subjectText ? `<p class="course-note">${subjectText}</p>` : ''}
        </div>
      </article>
    `;
  }).join('');
  window.applyClassFilters?.();
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
  const metaParts = metaPart.split('•').map((part) => part.trim()).filter(Boolean);

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
  const response = await fetch(`/api/assignments/${assignment.assignment_id}/submission?student_id=${encodeURIComponent(context.userId)}`);
  const data = await response.json();
  const submission = data.submission;
  if (!response.ok) { body.textContent = data.error || 'Unable to load your submission.'; return; }
  const status = submission?.score != null ? ['Graded', 'graded'] : submission ? ['Submitted', 'submitted'] : ['Assigned', 'assigned'];
  body.innerHTML = `<div class="aa-workcard"><div class="top"><strong>Your work</strong><span class="aa-status ${status[1]}">${status[0]}</span></div><p class="aa-sub">${submission ? `Submitted ${new Date(submission.submitted_at).toLocaleString()}` : 'Attach your work when you are ready.'}</p>${submission ? `<p>File: <a class="aa-file" href="${aaEscape(submission.file_path)}" target="_blank" rel="noopener">${aaEscape(submission.file_name)}</a></p>${submission.score != null ? `<p class="aa-score"><strong>Score: ${submission.score}/${assignment.total_points ?? 100}</strong><br>Feedback: ${aaEscape(submission.feedback || '—')}</p>` : '<p class="aa-sub">Waiting for an instructor to grade this work.</p>'}<button class="aa-unsubmit" type="button">Unsubmit</button>` : `<input type="file" class="aa-file-input" hidden><div class="aa-drop" role="button" tabindex="0">Choose a file to upload</div><p><button class="aa-submitbtn" type="button">Submit work</button></p>`}</div><hr class="aa-divider"><p><strong>Comments</strong></p><input type="text" placeholder="Add comment…" style="width:100%;padding:10px;box-sizing:border-box">`;
  if (submission) {
    body.querySelector('.aa-unsubmit').addEventListener('click', async () => {
      if (!window.confirm('Remove your submission?')) return;
      await fetch(`/api/assignments/${assignment.assignment_id}/submission?student_id=${encodeURIComponent(context.userId)}`, { method: 'DELETE' });
      await aaStudentView(body, assignment, context);
    });
    return;
  }
  const fileInput = body.querySelector('.aa-file-input');
  const dropZone = body.querySelector('.aa-drop');
  const chooseFile = () => fileInput.click();
  dropZone.addEventListener('click', chooseFile);
  dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') chooseFile(); });
  fileInput.addEventListener('change', () => { const file = fileInput.files[0]; if (file) { dropZone.textContent = `📄 ${file.name}`; dropZone.classList.add('hasfile'); } });
  body.querySelector('.aa-submitbtn').addEventListener('click', async () => {
    if (!fileInput.files.length) { window.alert('Choose a file first.'); return; }
    const form = new FormData(); form.append('file', fileInput.files[0]); form.append('student_id', String(context.userId));
    const result = await fetch(`/api/assignments/${assignment.assignment_id}/submission`, { method: 'POST', body: form });
    const resultData = await result.json();
    if (!result.ok) { window.alert(resultData.error || 'Submission failed.'); return; }
    await aaStudentView(body, assignment, context);
  });
}

async function aaStaffView(body, assignment) {
  const response = await fetch(`/api/assignments/${assignment.assignment_id}/submissions`);
  const submissions = await response.json();
  if (!response.ok) { body.textContent = submissions.error || 'Unable to load submissions.'; return; }
  if (!submissions.length) { body.innerHTML = '<p class="aa-muted">No student submissions yet.</p>'; return; }
  body.innerHTML = submissions.map((submission, index) => `<div class="aa-row" data-submission-index="${index}"><div style="flex:1;min-width:150px"><strong>Student #${aaEscape(submission.student_id)}</strong><br><span class="aa-muted">${new Date(submission.submitted_at).toLocaleString()}</span><br><a class="aa-file" href="${aaEscape(submission.file_path)}" target="_blank" rel="noopener">${aaEscape(submission.file_name)}</a></div><input type="number" min="0" max="${assignment.total_points ?? 100}" value="${submission.score ?? ''}" placeholder="Score"><textarea rows="2" placeholder="Feedback">${aaEscape(submission.feedback || '')}</textarea><button class="aa-btn green save-grade" type="button">Save grade</button></div>`).join('');
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
  style.textContent = `.cal-kicker{color:#d6336c;font-weight:800;font-size:12px;letter-spacing:1px}.cal-h2{margin:2px 0 14px;font-size:24px;color:#333}.cal-pillbtn{background:#fbdce8;color:#d6336c;border:0;border-radius:999px;padding:7px 14px;font-weight:700;cursor:pointer}.cal-card,.cal-item{background:#fdeef5;border:1px solid #f7cddd;border-radius:8px;padding:18px;margin-bottom:16px}.cal-top,.cal-navrow{display:flex;gap:8px;align-items:center}.cal-top{justify-content:space-between}.cal-month{font-size:18px;font-weight:800}.cal-count{background:#f9c9dd;color:#c2255c;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px}.cal-sub{color:#8a6470;font-size:13px}.cal-days,.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;text-align:center}.cal-days{font-size:11px;font-weight:800;color:#8a6470;margin:12px 0 8px}.cal-cell{border-radius:8px;padding:10px 0;font-weight:800;color:#8f1d3f;background:#fbe3ec;cursor:pointer}.cal-cell.out{background:#eef2f7;color:#b6c2cf;cursor:default}.cal-cell.past{border:1px solid #f76c6c}.cal-cell.today{background:#fdf3d7;border:1px solid #f5a623}.cal-cell.up{background:#d3f3ef;border:1px solid #20b2aa}.cal-item .cat{color:#c2255c;font-weight:800;font-size:14px}.cal-item .ttl{color:#333;font-weight:700;margin:4px 0}.cal-item .dsc{color:#8a6470;font-size:13px}`;
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
  style.textContent = `.cal-legend2{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#555;margin:4px 0 12px}.cal-legend2 span{display:inline-flex;align-items:center;gap:6px}.cal-legend2 i{width:12px;height:12px;border-radius:4px;display:inline-block}.cal-cell.t-exam{background:#dbeafe;border-color:#3b82f6;color:#1d4ed8}.cal-cell.t-celebration{background:#fdf3d7;border-color:#f5a623;color:#8a5a00}.cal-cell.t-deadline{background:#fbdce3;border-color:#f76c6c;color:#b02438}.cal-cell.t-meeting{background:#ede9fe;border-color:#8b5cf6;color:#5b21b6}.cal-cell.t-event{background:#d3f3ef;border-color:#20b2aa;color:#0f766e}.cal-cell.t-due{background:#fbe3ec;border-color:#d6336c;color:#8f1d3f}.cal-cell.today{border:2px solid #f5a623}.cal-item .cat2{font-weight:800;font-size:12px;letter-spacing:.5px;text-transform:uppercase}.cal-item .date2{color:#8a6470;font-size:13px;font-weight:700;margin:2px 0}`;
  document.head.appendChild(style);
}
function renderMonthlyCalendarPro(ctx, root) {
  if (!root) return; mcalStyles(); mcalStyles2();
  const isStaff = ['instructor', 'teacher', 'dean', 'admin', 'superadmin'].includes(String(ctx.role || '').toLowerCase().replace(/\s+/g, ''));
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start"><div><div class="cal-kicker">CALENDAR</div><div class="cal-h2">Monthly Overview</div></div><button class="cal-pillbtn" id="calTodayBtn">This Week</button></div><div class="cal-card"><div class="cal-top"><span class="cal-month" id="calLabel"></span><span class="cal-count" id="calCount"></span></div><p class="cal-sub">Upcoming deadlines and key school events.</p><div class="cal-legend2">${Object.values(MCAL_TYPES).map((type) => `<span><i style="background:${type.dot}"></i>${type.label}</span>`).join('')}<span><i style="background:${MCAL_DUE.dot}"></i>${MCAL_DUE.label}</span><span><i style="background:#fff;border:2px solid #f5a623"></i>Today</span></div><div class="cal-navrow"><button class="cal-pillbtn" id="calPrev">‹</button><button class="cal-pillbtn" id="calNext">›</button>${isStaff ? '<button class="cal-pillbtn" id="calAdd">+ Add Event</button>' : ''}</div><div class="cal-days">${['SUN','MON','TUE','WED','THU','FRI','SAT'].map((day) => `<div>${day}</div>`).join('')}</div><div class="cal-grid" id="calGrid"></div></div><div id="calList"></div>`;
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
    root.querySelector('#calList').innerHTML = sorted.length ? sorted.map((item) => { const type = item.kind === 'event' ? mcalTypeOf(item) : null; const isPast = new Date(`${String(item.start_date).slice(0, 10)}T00:00:00`) < today; const label = type ? type.label : (isPast ? 'Missed Assignment' : 'Upcoming Activity'); const color = type ? type.dot : (isPast ? '#f76c6c' : MCAL_DUE.dot); const classLine = item.kind === 'assignment' && item.course_title ? `<div class="dsc" style="color:#b02458;font-weight:800">▣ From class: ${mcalEsc(item.course_title)}</div>` : ''; const desc = mcalCleanDesc(item) || ''; return `<div class="cal-item"><div class="cat2" style="color:${color}">${label}</div><div class="ttl">${mcalEsc(item.title)}</div>${classLine}<div class="date2">📅 ${mcalExactDate(item)}</div>${desc ? `<div class="dsc">${mcalEsc(desc)}</div>` : ''}</div>`; }).join('') : '<p class="cal-sub">Nothing scheduled this month.</p>';
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
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start"><div><div class="cal-kicker">RESOURCES</div><div class="cal-h2">Study Library</div></div>${isStaff ? '<button class="cal-pillbtn" id="resAdd">+ Add Resource</button>' : ''}</div><p class="cal-sub">Lessons and materials shared by your instructors.</p><input class="res-search" id="resSearch" placeholder="🔍 Search by title or class…"><div class="res-grid" id="resGrid"></div>`;
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
  style.textContent = `.cr-card{background:#fff;border:1px solid #f0dfe6;border-radius:14px;padding:16px;margin-bottom:16px;overflow:auto}.cr-h{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin:6px 0 10px}.cr-title{font-size:16px;font-weight:800;color:#8f1d3f}.cr-btn{border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px}.cr-csv{background:linear-gradient(135deg,#e0477e,#d6336c);color:#fff}.cr-print{background:#fff;color:#8f1d3f;border:1.5px solid #ecd3dd}.cr-remove{background:#fff;color:#c62828;border:1px solid #c62828;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}.cr-table{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}.cr-table th{background:#fdeef5;color:#8f1d3f;padding:8px 10px;text-align:left}.cr-table td{border:1px solid #f3e1e9;padding:8px 10px}.cr-pts{display:block;font-size:10px;color:#b06080;font-weight:600}.cr-id{color:#999;font-size:11px}.cr-pass{color:#1e7e34;font-weight:800}.cr-fail{color:#c62828;font-weight:800}.cr-none{color:#bbb;text-align:center}.cr-avg{font-weight:800;color:#8f1d3f}`;
  document.head.appendChild(style);
}
async function renderClassRecordPro(courseId, ctx, root, courseTitle) {
  if (!root) return; crStyles(); root.innerHTML = '<p class="cal-sub">Loading class record…</p>';
  const response = await fetch(`/api/courses/${courseId}/record`);
  if (!response.ok) { root.innerHTML = '<p class="cal-sub">Failed to load the class record.</p>'; return; }
  const data = await response.json(); const students = data.students || []; const assignments = data.assignments || []; const scores = {};
  (data.scores || []).forEach((score) => { scores[`${score.student_id}|${score.assignment_id}`] = score; });
  const staff = ['instructor', 'teacher', 'dean', 'admin', 'superadmin'].includes(String(ctx.role || '').toLowerCase().replace(/\s+/g, ''));
  const percentage = (score, assignment) => (Number(score.score) / Number(assignment.total_points || 100)) * 100;
  const grid = assignments.length ? `<table class="cr-table"><thead><tr><th>Student</th>${assignments.map((assignment) => `<th>${crEsc(assignment.title)}<span class="cr-pts">/ ${assignment.total_points} pts</span></th>`).join('')}<th>Average</th></tr></thead><tbody>${students.map((student) => { let count = 0; let total = 0; const cells = assignments.map((assignment) => { const score = scores[`${student.student_id}|${assignment.assignment_id}`]; if (!score || score.score == null) return '<td class="cr-none">—</td>'; const pct = percentage(score, assignment); count++; total += pct; return `<td class="${pct >= 75 ? 'cr-pass' : 'cr-fail'}">${score.score}</td>`; }).join(''); return `<tr><td><strong>${crEsc(student.student_name)}</strong> <span class="cr-id">#${crEsc(student.student_id)}</span></td>${cells}<td class="cr-avg">${count ? `${Math.round(total / count)}%` : '—'}</td></tr>`; }).join('')}</tbody></table>` : '<p class="cr-id">No activities or quizzes created yet.</p>';
  root.innerHTML = `<div class="cr-h"><span class="cr-title">📋 Class List (${students.length} student${students.length === 1 ? '' : 's'})</span></div><div class="cr-card">${students.length ? `<table class="cr-table"><thead><tr><th>#</th><th>Student ID</th><th>Name</th><th>Year Level</th><th>Academic Year</th>${staff ? '<th></th>' : ''}</tr></thead><tbody>${students.map((student, index) => `<tr><td>${index + 1}</td><td>${crEsc(student.student_id)}</td><td><strong>${crEsc(student.student_name)}</strong></td><td>${crEsc(student.year_level || '—')}</td><td>${crEsc(student.academic_year || '—')}</td>${staff ? `<td><button class="cr-remove" data-sid="${crEsc(student.student_id)}" data-student-name="${crEsc(student.student_name)}">Remove</button></td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="cr-id">No students enrolled yet.</p>'}</div><div class="cr-h"><span class="cr-title">🎓 Grade Grid</span><span style="display:flex;gap:8px"><button class="cr-btn cr-csv" id="crCsv">⬇ Export CSV</button><button class="cr-btn cr-print" id="crPrint">🖨 Print / Save PDF</button></span></div><div class="cr-card">${grid}</div>`;
  root.querySelectorAll('.cr-remove').forEach((button) => button.onclick = async () => {
    const studentName = button.dataset.studentName || `student #${button.dataset.sid}`;
    const confirmed = await showConfirmationDialog({
      title: 'Remove student?',
      message: `${studentName} will lose access to this class. Their submitted work and grades will be retained.`,
      confirmLabel: 'Remove student',
    });
    if (!confirmed) return;

    button.disabled = true;
    const result = await fetch(`/api/courses/${courseId}/students/${encodeURIComponent(button.dataset.sid)}?teacher_id=${encodeURIComponent(ctx.userId)}`, { method: 'DELETE' });
    if (!result.ok) {
      button.disabled = false;
      return window.alert((await result.json().catch(() => ({}))).error || 'Failed to remove student.');
    }
    showToast(`${studentName} has been removed from this class.`);
    renderClassRecordPro(courseId, ctx, root, courseTitle);
  });
  root.querySelector('#crCsv').onclick = () => { const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`; const header = ['Student ID', 'Student Name', 'Year Level', 'Academic Year', ...assignments.map((assignment) => `${assignment.title} (/${assignment.total_points})`), 'Average %']; const rows = [header]; students.forEach((student) => { let count = 0; let total = 0; const values = assignments.map((assignment) => { const score = scores[`${student.student_id}|${assignment.assignment_id}`]; if (!score || score.score == null) return ''; count++; total += percentage(score, assignment); return score.score; }); rows.push([student.student_id, student.student_name, student.year_level || '', student.academic_year || '', ...values, count ? Math.round(total / count) : '']); }); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv' })); link.download = `Class-Record-${String(courseTitle || courseId).replace(/[^\w-]+/g, '_')}.csv`; link.click(); URL.revokeObjectURL(link.href); };
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
    const teachers = list.filter((u) => ['teacher', 'instructor'].includes(String(u.role || '').toLowerCase()));
    select.innerHTML = '<option value="">— No instructor assigned —</option>' +
      teachers.map((u) => `<option value="${String(u.student_id).replace(/"/g, '&quot;')}" data-name="${String(u.name || '').replace(/"/g, '&quot;')}">${u.name} (${u.email})</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Unable to load instructors</option>';
  }
}

function upgradeCreateClassInstructorPicker() {
  const submitBtn = document.getElementById('createClassSubmit');
  if (!submitBtn || submitBtn.dataset.upgraded) return;
  submitBtn.dataset.upgraded = '1';
  const fresh = submitBtn.cloneNode(true); // removes the old submit listener safely
  submitBtn.parentNode.replaceChild(fresh, submitBtn);
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
    const msg = document.getElementById('createClassMessage');
    if (!className) {
      if (msg) { msg.textContent = 'Please enter a class name.'; msg.classList.add('error'); }
      return;
    }
    fresh.textContent = 'Creating...';
    fresh.disabled = true;
    if (msg) { msg.textContent = 'Creating class...'; msg.classList.remove('error'); }
    try {
      const response = await fetch('/api/classes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: className,
          course,
          courseCode,
          yearLevel: year,
          instructor: instructorName || 'Instructor not set',
          section,
          subText: subjectNotes,
          // A dean may deliberately leave the class unassigned.  Do not turn
          // that into an assignment to the dean's own account.
          teacherId: instructorIdRaw || null,
          createdBy: getCurrentUserId(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create class.');
      const codeDisplay = document.getElementById('classCodeDisplay');
      if (codeDisplay) codeDisplay.value = data.classCode;
      const formGroup = document.getElementById('createClassFormGroup');
      const successBox = document.getElementById('createClassSuccessBox');
      if (formGroup) formGroup.hidden = true;
      if (successBox) successBox.hidden = false;
      await fetchDashboardData(getCurrentUserId());
    } catch (error) {
      if (msg) { msg.textContent = error.message || 'Unable to create class. Please try again.'; msg.classList.add('error'); }
    } finally {
      fresh.disabled = false;
      fresh.textContent = 'Create Class';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  upgradeCreateClassInstructorPicker();
  document.getElementById('createClassBtn')?.addEventListener('click', loadInstructorOptions);
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
      const metaParts = metaPart.split('•').map((p) => p.trim());
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
