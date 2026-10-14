/* global window, document, fetch */
(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Small API helper
  // ---------------------------------------------------------------
  const API_BASE = (window.location.protocol.startsWith('http') && window.location.port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? 'http://localhost:3000'
    : '';

  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api${path}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: 'include',
      });
    } catch (netErr) {
      console.error('API network error:', netErr);
      throw new Error(
        'Unable to connect to the server. Please ensure the backend server is running at http://localhost:3000.'
      );
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }

    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------
  // Toast (shadcn style)
  // ---------------------------------------------------------------
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function showToast(message, type = 'info') {
    let iconName = 'info';
    let iconColor = 'text-blue-600';
    if (type === 'success') {
      iconName = 'check-circle-2';
      iconColor = 'text-emerald-600';
    } else if (type === 'error') {
      iconName = 'alert-circle';
      iconColor = 'text-rose-600';
    }

    toastEl.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4 shrink-0 ${iconColor}"></i><span class="text-xs sm:text-sm">${escapeHtml(message)}</span>`;
    toastEl.className = `toast show ${type}`;
    if (window.lucide) window.lucide.createIcons();

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 4500);
  }

  // ---------------------------------------------------------------
  // View switching
  // ---------------------------------------------------------------
  const viewAuth = document.getElementById('view-auth');
  const viewEmployee = document.getElementById('view-employee');
  const viewAdmin = document.getElementById('view-admin');

  function showOnly(view) {
    [viewAuth, viewEmployee, viewAdmin].forEach((v) => v.classList.add('hidden'));
    view.classList.remove('hidden');
    document.documentElement.classList.remove('preload-employee', 'preload-admin');
    document.documentElement.removeAttribute('data-preload-panel');
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
  }

  // ---------------------------------------------------------------
  // Kolkata clock & Date Helpers (India Standard Time)
  // ---------------------------------------------------------------
  function kolkataNowStrings() {
    const now = new Date();
    const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // Format: YYYY-MM-DD
    const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
    return { date, time };
  }

  function startClock(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    function tick() {
      const { time } = kolkataNowStrings();
      el.textContent = `${time} IST`;
    }
    tick();
    setInterval(tick, 15000);
  }

  // =================================================================
  // AUTH SCREEN
  // =================================================================
  const formLogin = document.getElementById('form-login');
  const formForgotRequest = document.getElementById('form-forgot-request');
  const formForgotReset = document.getElementById('form-forgot-reset');

  function showAuthForm(name) {
    [formLogin, formForgotRequest, formForgotReset].forEach((f) => {
      if (f) f.classList.add('hidden');
    });
    const target = document.getElementById(`form-${name}`);
    if (target) target.classList.remove('hidden');
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
  }

  // ---- Login ----
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const data = await api('/login', { method: 'POST', body: { email, password } });
      showToast(data.message || 'Login successful.', 'success');
      routeUser(data.user);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Switch to Forgot Password
  const btnToForgot = document.getElementById('btn-to-forgot');
  if (btnToForgot) {
    btnToForgot.addEventListener('click', () => {
      const loginEmail = document.getElementById('login-email')?.value.trim() || '';
      const forgotEmailInput = document.getElementById('forgot-email');
      if (forgotEmailInput && loginEmail) {
        forgotEmailInput.value = loginEmail;
      }
      const errEl = document.getElementById('forgot-request-error');
      if (errEl) errEl.textContent = '';
      showAuthForm('forgot-request');
    });
  }

  // Back to login buttons
  document.querySelectorAll('.btn-back-to-login').forEach((btn) => {
    btn.addEventListener('click', () => {
      showAuthForm('login');
    });
  });

  // ---- Forgot Password: Step 1 (Request OTP) ----
  let pendingForgotEmail = '';
  if (formForgotRequest) {
    formForgotRequest.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('forgot-request-error');
      errEl.textContent = '';
      const email = document.getElementById('forgot-email').value.trim();
      const submitBtn = formForgotRequest.querySelector('button[type="submit"]');
      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<span>Sending verification code...</span><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
          if (window.lucide) window.lucide.createIcons();
        }

        const data = await api('/forgot-password', { method: 'POST', body: { email } });
        pendingForgotEmail = data.email || email;
        const targetText = document.getElementById('forgot-target-text');
        if (targetText) targetText.textContent = `Password reset code sent to ${pendingForgotEmail}.`;

        const resetCodeInput = document.getElementById('reset-otp-code');
        if (resetCodeInput) {
          resetCodeInput.value = '';
        }

        showAuthForm('forgot-reset');
        showToast(data.message || 'Verification code sent to your company email.', 'success');
        resetCodeInput?.focus();
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
          if (window.lucide) window.lucide.createIcons();
        }
      }
    });
  }

  // ---- Forgot Password: Resend Code ----
  const btnResendForgotOtp = document.getElementById('btn-resend-forgot-otp');
  if (btnResendForgotOtp) {
    btnResendForgotOtp.addEventListener('click', async () => {
      try {
        btnResendForgotOtp.disabled = true;
        btnResendForgotOtp.classList.add('opacity-50');
        const data = await api('/resend-forgot-password', { method: 'POST', body: { email: pendingForgotEmail } });
        const resetCodeInput = document.getElementById('reset-otp-code');
        if (resetCodeInput) {
          resetCodeInput.value = '';
          resetCodeInput.focus();
        }
        showToast(data.message || 'A new verification code has been sent to your email.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnResendForgotOtp.disabled = false;
        btnResendForgotOtp.classList.remove('opacity-50');
      }
    });
  }

  // ---- Forgot Password: Step 2 (Submit Code & New Password) ----
  if (formForgotReset) {
    formForgotReset.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('forgot-reset-error');
      errEl.textContent = '';

      const otp = document.getElementById('reset-otp-code').value.trim();
      const password = document.getElementById('reset-new-password').value;
      const confirmPassword = document.getElementById('reset-confirm-password').value;

      if (!otp || otp.length !== 6) {
        errEl.textContent = 'Please enter the 6-digit verification code.';
        return;
      }

      if (password.length < 8) {
        errEl.textContent = 'New password must be at least 8 characters long.';
        return;
      }

      if (password !== confirmPassword) {
        errEl.textContent = 'New Password and Confirm Password do not match.';
        return;
      }

      const submitBtn = formForgotReset.querySelector('button[type="submit"]');
      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<span>Updating password...</span><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
          if (window.lucide) window.lucide.createIcons();
        }

        const data = await api('/reset-password', {
          method: 'POST',
          body: {
            email: pendingForgotEmail,
            otp,
            password,
            confirmPassword,
          },
        });
        showToast(data.message || 'Password reset successfully! You can now log in.', 'success');
        // Pre-fill email in login form
        const loginEmailInput = document.getElementById('login-email');
        if (loginEmailInput) loginEmailInput.value = pendingForgotEmail;
        const loginPassInput = document.getElementById('login-password');
        if (loginPassInput) {
          loginPassInput.value = '';
          loginPassInput.focus();
        }
        formForgotReset.reset();
        showAuthForm('login');
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
          if (window.lucide) window.lucide.createIcons();
        }
      }
    });
  }

  // Password Visibility Toggles
  document.querySelectorAll('.btn-toggle-pwd').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.innerHTML = `<i data-lucide="${isPass ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
      if (window.lucide) window.lucide.createIcons();
    });
  });

  // =================================================================
  // FIRST-TIME LOGIN PASSWORD SETUP MODAL
  // =================================================================
  const modalFirstTimePassword = document.getElementById('modal-first-time-password');
  const formFirstTimePassword = document.getElementById('form-first-time-password');

  function openFirstTimePasswordModal(user) {
    if (!modalFirstTimePassword) return;
    const nameEl = document.getElementById('first-login-name');
    if (nameEl && user) nameEl.textContent = user.fullName || 'Employee';
    const errEl = document.getElementById('first-login-error');
    if (errEl) errEl.textContent = '';
    const newPassInput = document.getElementById('first-login-new-password');
    const confirmPassInput = document.getElementById('first-login-confirm-password');
    if (newPassInput) newPassInput.value = '';
    if (confirmPassInput) confirmPassInput.value = '';

    modalFirstTimePassword.classList.remove('hidden');
    modalFirstTimePassword.classList.add('flex');
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
    newPassInput?.focus();
  }

  function closeFirstTimePasswordModal() {
    if (!modalFirstTimePassword) return;
    modalFirstTimePassword.classList.add('hidden');
    modalFirstTimePassword.classList.remove('flex');
  }

  if (formFirstTimePassword) {
    formFirstTimePassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('first-login-error');
      if (errEl) errEl.textContent = '';

      const newPassword = document.getElementById('first-login-new-password')?.value || '';
      const confirmNewPassword = document.getElementById('first-login-confirm-password')?.value || '';

      if (newPassword.length < 8) {
        if (errEl) errEl.textContent = 'Password must be at least 8 characters long.';
        return;
      }
      if (newPassword !== confirmNewPassword) {
        if (errEl) errEl.textContent = 'New password and confirmation do not match.';
        return;
      }

      const submitBtn = document.getElementById('btn-submit-first-login');
      const originalHtml = submitBtn ? submitBtn.innerHTML : '';

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<span>Updating password...</span><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
          if (window.lucide) window.lucide.createIcons();
        }

        const data = await api('/first-time-password', {
          method: 'POST',
          body: { newPassword, confirmNewPassword },
        });

        if (currentUser) {
          currentUser.mustChangePassword = false;
        }

        closeFirstTimePasswordModal();
        showToast(data.message || 'Password successfully created! Welcome to your dashboard.', 'success');
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHtml;
          if (window.lucide) window.lucide.createIcons();
        }
      }
    });
  }

  // =================================================================
  // ROUTING & PERSISTENCE (after login / on refresh)
  // =================================================================
  const PANEL_HASH_MAP = {
    'panel-book': '#book',
    'panel-schedule': '#schedule',
    'panel-mine': '#mine',
    'panel-admin-overview': '#overview',
    'panel-admin-bookings': '#bookings',
    'panel-admin-allot': '#allot',
    'panel-admin-users': '#employees',
  };

  const HASH_PANEL_MAP = {
    '#book': 'panel-book',
    '#schedule': 'panel-schedule',
    '#mine': 'panel-mine',
    '#my-bookings': 'panel-mine',
    '#overview': 'panel-admin-overview',
    '#bookings': 'panel-admin-bookings',
    '#all-bookings': 'panel-admin-bookings',
    '#allot': 'panel-admin-allot',
    '#users': 'panel-admin-users',
    '#employees': 'panel-admin-users',
  };

  let currentUser = null;

  function routeUser(user) {
    currentUser = user;

    // Cache user credentials and identity to prevent refresh flash
    try {
      localStorage.setItem('algorisys_user_role', user.role);
      sessionStorage.setItem('algorisys_user_role', user.role);
      localStorage.setItem('algorisys_user_info', JSON.stringify({
        fullName: user.fullName,
        department: user.department,
        role: user.role
      }));
    } catch (e) {}

    const btnGotoAdmin = document.getElementById('btn-goto-admin');
    if (btnGotoAdmin) {
      if (user.role === 'ADMIN') {
        btnGotoAdmin.classList.remove('hidden');
      } else {
        btnGotoAdmin.classList.add('hidden');
      }
    }

    const currentHash = (window.location.hash || '').toLowerCase();
    const savedConsole = localStorage.getItem('algorisys_active_console') || sessionStorage.getItem('algorisys_active_console');

    if (user.role === 'ADMIN') {
      // If admin was specifically viewing employee console or hash points to an employee panel
      if (savedConsole === 'employee' || ['#book', '#schedule', '#mine', '#my-bookings'].includes(currentHash)) {
        initEmployeeView(user);
        showOnly(viewEmployee);
      } else {
        initAdminView(user);
        showOnly(viewAdmin);
      }
    } else {
      initEmployeeView(user);
      showOnly(viewEmployee);
    }

    // Force mandatory password change on first login
    if (user.mustChangePassword) {
      openFirstTimePasswordModal(user);
    }

    if (window.lucide) window.lucide.createIcons();
  }

  async function boot() {
    // Header switchers between Admin Console and Employee Booking view
    const btnGotoAdmin = document.getElementById('btn-goto-admin');
    if (btnGotoAdmin) {
      btnGotoAdmin.addEventListener('click', () => {
        if (!currentUser || currentUser.role !== 'ADMIN') return;
        try {
          localStorage.setItem('algorisys_active_console', 'admin');
          sessionStorage.setItem('algorisys_active_console', 'admin');
        } catch (e) {}
        initAdminView(currentUser);
        showOnly(viewAdmin);
      });
    }

    const btnGotoEmployee = document.getElementById('btn-goto-employee');
    if (btnGotoEmployee) {
      btnGotoEmployee.addEventListener('click', () => {
        if (!currentUser) return;
        try {
          localStorage.setItem('algorisys_active_console', 'employee');
          sessionStorage.setItem('algorisys_active_console', 'employee');
        } catch (e) {}
        initEmployeeView(currentUser);
        showOnly(viewEmployee);
      });
    }

    // Browser back/forward button hash support
    window.addEventListener('hashchange', () => {
      if (!currentUser) return;
      const hash = (window.location.hash || '').toLowerCase();
      const panelId = HASH_PANEL_MAP[hash];
      if (!panelId) return;
      if (panelId.startsWith('panel-admin') && currentUser.role === 'ADMIN') {
        if (viewAdmin.classList.contains('hidden')) {
          showOnly(viewAdmin);
        }
        switchPanel(viewAdmin, panelId, false);
      } else if (['panel-book', 'panel-schedule', 'panel-mine'].includes(panelId)) {
        if (viewEmployee.classList.contains('hidden')) {
          showOnly(viewEmployee);
        }
        switchPanel(viewEmployee, panelId, false);
        if (panelId === 'panel-book') {
          const curDate = document.getElementById('book-date')?.value || kolkataNowStrings().date;
          loadRoomOccupancy(curDate);
        } else if (panelId === 'panel-schedule') {
          const tgtDate = document.getElementById('sched-date-picker')?.value || kolkataNowStrings().date;
          refreshSchedule(tgtDate);
        } else if (panelId === 'panel-mine') {
          refreshMyBookings();
        }
      }
    });

    try {
      const data = await api('/me');
      routeUser(data.user);
    } catch (e) {
      try {
        localStorage.removeItem('algorisys_user_role');
        localStorage.removeItem('algorisys_active_console');
        localStorage.removeItem('algorisys_active_panel');
        localStorage.removeItem('algorisys_user_info');
        sessionStorage.removeItem('algorisys_user_role');
        sessionStorage.removeItem('algorisys_active_console');
        sessionStorage.removeItem('algorisys_active_panel');
        sessionStorage.removeItem('algorisys_user_info');
        document.documentElement.classList.remove('has-session', 'preload-employee', 'preload-admin');
        document.documentElement.removeAttribute('data-preload-panel');
      } catch (err) {}
      showOnly(viewAuth);
      showAuthForm('login');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // =================================================================
  // EMPLOYEE DASHBOARD
  // =================================================================
  let employeeInitialized = false;

  function initEmployeeView(user) {
    document.getElementById('emp-who').textContent = `${user.fullName} · ${user.department}`;
    startClock('emp-clock');

    // Initialize calendar date picker limits (min = today)
    const { date: today } = kolkataNowStrings();
    const bookDateInput = document.getElementById('book-date');
    if (bookDateInput) {
      bookDateInput.min = today;
      if (!bookDateInput.value) bookDateInput.value = today;
      bookDateInput.addEventListener('change', () => {
        const val = bookDateInput.value || today;
        loadRoomOccupancy(val);
      });
    }

    const btnBookToday = document.getElementById('btn-book-today');
    if (btnBookToday) {
      btnBookToday.addEventListener('click', () => {
        const { date: todayDate } = kolkataNowStrings();
        bookDateInput.value = todayDate;
        loadRoomOccupancy(todayDate);
      });
    }

    const schedPicker = document.getElementById('sched-date-picker');
    if (schedPicker) {
      schedPicker.min = today;
      if (!schedPicker.value) schedPicker.value = today;
      schedPicker.addEventListener('change', () => {
        refreshSchedule(schedPicker.value);
      });
    }

    // Determine target panel (honor URL hash, then stored preference, defaulting to panel-book)
    const currentHash = (window.location.hash || '').toLowerCase();
    const savedPanel = HASH_PANEL_MAP[currentHash]
      || localStorage.getItem('algorisys_active_panel')
      || sessionStorage.getItem('algorisys_active_panel')
      || 'panel-book';

    const validEmployeePanels = ['panel-book', 'panel-schedule', 'panel-mine'];
    const targetPanel = validEmployeePanels.includes(savedPanel) ? savedPanel : 'panel-book';

    switchPanel(viewEmployee, targetPanel, false);
    loadHallsInto('book-hall', false, '-- Select Conference Hall --').then(() => {
      syncRoomCards();
      loadRoomOccupancy(bookDateInput ? bookDateInput.value || today : today);
    });
    loadColleaguesDatalist();

    if (targetPanel === 'panel-schedule') {
      refreshSchedule(today);
    } else if (targetPanel === 'panel-mine') {
      refreshMyBookings();
    } else {
      refreshSchedule(today);
      refreshMyBookings();
    }

    if (employeeInitialized) return;
    employeeInitialized = true;

    // Visual cards are synchronized via syncRoomCards() in module scope

    // Attach click listeners to visual room selection cards
    document.querySelectorAll('.room-select-card').forEach((card) => {
      card.addEventListener('click', () => {
        const hallId = card.dataset.hallId;
        const hallSelect = document.getElementById('book-hall');
        if (hallSelect && hallId) {
          hallSelect.value = hallId;
          syncRoomCards();
          checkLiveConflict();
        }
      });
    });

    viewEmployee.querySelectorAll('.tabbar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchPanel(viewEmployee, btn.dataset.panel);
        if (btn.dataset.panel === 'panel-book') {
          const currentVal = document.getElementById('book-date')?.value || kolkataNowStrings().date;
          loadRoomOccupancy(currentVal);
        }
        if (btn.dataset.panel === 'panel-schedule') {
          const targetDate = document.getElementById('sched-date-picker').value || kolkataNowStrings().date;
          refreshSchedule(targetDate);
        }
        if (btn.dataset.panel === 'panel-mine') refreshMyBookings();
      });
    });

    document.getElementById('emp-logout').addEventListener('click', logout);

    const purposeEl = document.getElementById('book-purpose');
    purposeEl.addEventListener('input', () => {
      document.getElementById('purpose-count').textContent = purposeEl.value.length;
    });

    // Attendee Dropdown Selection from Database
    const bookSelect = document.getElementById('book-employee-select');
    if (bookSelect) {
      bookSelect.addEventListener('change', () => {
        if (bookSelect.value === '__ALL__') {
          selectAllAttendees('book');
          bookSelect.value = '';
        } else if (bookSelect.value) {
          addAttendee('book', bookSelect.value);
          bookSelect.value = '';
        }
      });
    }

    const bookFilter = document.getElementById('book-employee-filter');
    if (bookFilter) {
      bookFilter.addEventListener('input', () => {
        filterEmployeeDropdown('book-employee-select', bookFilter.value);
      });
      bookFilter.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const select = document.getElementById('book-employee-select');
          if (select) {
            const firstVisible = Array.from(select.options).slice(1).find((opt) => !opt.hidden);
            if (firstVisible && firstVisible.value) {
              if (firstVisible.value === '__ALL__') {
                selectAllAttendees('book');
              } else {
                addAttendee('book', firstVisible.value);
              }
              bookFilter.value = '';
              filterEmployeeDropdown('book-employee-select', '');
            }
          }
        }
      });
    }

    const bookSelectAllBtn = document.getElementById('book-select-all-btn');
    if (bookSelectAllBtn) {
      bookSelectAllBtn.addEventListener('click', () => selectAllAttendees('book'));
    }

    const bookClearBtn = document.getElementById('book-clear-attendees-btn');
    if (bookClearBtn) {
      bookClearBtn.addEventListener('click', () => clearAttendees('book'));
    }

    // Live conflict checks as user selects hall, start time, end time
    document.getElementById('book-hall').addEventListener('change', () => {
      syncRoomCards();
      checkLiveConflict();
    });
    document.getElementById('book-start').addEventListener('input', checkLiveConflict);
    document.getElementById('book-end').addEventListener('input', checkLiveConflict);

    document.getElementById('btn-confirm-booking').addEventListener('click', confirmBooking);

    const btnSchedToday = document.getElementById('btn-sched-today');
    if (btnSchedToday) {
      btnSchedToday.addEventListener('click', () => {
        const { date: todayDate } = kolkataNowStrings();
        schedPicker.value = todayDate;
        refreshSchedule(todayDate);
      });
    }
  }

  function switchPanel(scope, panelId, updateHistory = true) {
    if (!scope) return;
    scope.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    scope.querySelectorAll('.tabbar-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === panelId));
    const target = document.getElementById(panelId);
    if (target) target.classList.remove('hidden');

    try {
      localStorage.setItem('algorisys_active_panel', panelId);
      sessionStorage.setItem('algorisys_active_panel', panelId);
      if (scope === viewAdmin) {
        localStorage.setItem('algorisys_active_console', 'admin');
        sessionStorage.setItem('algorisys_active_console', 'admin');
      } else if (scope === viewEmployee) {
        localStorage.setItem('algorisys_active_console', 'employee');
        sessionStorage.setItem('algorisys_active_console', 'employee');
      }
    } catch (e) {}

    if (updateHistory && PANEL_HASH_MAP[panelId]) {
      try {
        if (window.location.hash !== PANEL_HASH_MAP[panelId]) {
          history.replaceState(null, '', PANEL_HASH_MAP[panelId]);
        }
      } catch (e) {}
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
  }

  async function loadHallsInto(selectId, includeAllOption = false, defaultSelectText = '') {
    try {
      const data = await api('/halls');
      const select = document.getElementById(selectId);
      if (!select) return [];
      select.innerHTML = '';
      if (defaultSelectText) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = defaultSelectText;
        select.appendChild(opt);
      } else if (includeAllOption) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = 'All halls';
        select.appendChild(opt);
      }
      data.halls.forEach((h) => {
        const opt = document.createElement('option');
        opt.value = h.id; opt.textContent = h.name;
        select.appendChild(opt);
      });
      return data.halls;
    } catch (err) {
      showToast(err.message, 'error');
      return [];
    }
  }

  // Cached database active colleagues
  let cachedColleagues = [];

  // Currently selected attendees for employee booking
  let bookSelectedAttendees = [];

  // Currently selected attendees for admin room allotment
  let allotSelectedAttendees = [];

  // Fetches active employees from database and populates dropdowns
  async function loadColleagues() {
    try {
      const data = await api('/colleagues');
      if (data && Array.isArray(data.colleagues)) {
        cachedColleagues = data.colleagues;
        populateEmployeeDropdown('book-employee-select', cachedColleagues);
        populateEmployeeDropdown('allot-colleague-select', cachedColleagues);

        // Also populate datalist if it exists for backwards-compatibility
        const list = document.getElementById('colleagues-list');
        if (list) {
          list.innerHTML = '';
          cachedColleagues.forEach((c) => {
            const opt = document.createElement('option');
            opt.value = c.name;
            list.appendChild(opt);
          });
        }
      }
    } catch (e) {
      console.warn('Could not load registered employees:', e.message);
    }
  }

  function loadColleaguesDatalist() {
    return loadColleagues();
  }

  function populateEmployeeDropdown(selectId, colleaguesList) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- Choose employee from database to add --';
    select.appendChild(defaultOpt);

    const selectAllOpt = document.createElement('option');
    selectAllOpt.value = '__ALL__';
    selectAllOpt.textContent = '👥 Select All Attendees';
    selectAllOpt.className = 'font-semibold text-blue-700 bg-blue-50';
    select.appendChild(selectAllOpt);

    const isBook = selectId === 'book-employee-select';
    const bookerId = isBook && currentUser ? currentUser.id : null;
    const bookerEmail = isBook && currentUser ? (currentUser.email || '').toLowerCase().trim() : '';

    const allotUserSelect = document.getElementById('allot-user');
    const assignedUserId = !isBook && allotUserSelect ? Number(allotUserSelect.value) : 0;

    colleaguesList.forEach((c) => {
      // Exclude the person booking the meeting (he is the organizer)
      if (bookerId && c.id === bookerId) return;
      if (bookerEmail && (c.email || '').toLowerCase().trim() === bookerEmail) return;
      if (assignedUserId && c.id === assignedUserId) return;

      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name;
      opt.dataset.name = c.name;
      opt.dataset.email = c.email;
      opt.dataset.department = c.department || '';
      select.appendChild(opt);
    });
  }

  function filterEmployeeDropdown(selectId, filterText) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const term = (filterText || '').toLowerCase().trim();

    Array.from(select.options).forEach((opt, idx) => {
      if (idx === 0) {
        opt.hidden = false;
        return;
      }
      if (opt.value === '__ALL__') {
        opt.hidden = Boolean(term && term.length > 2 && !'select all attendees'.includes(term));
        return;
      }
      if (!term) {
        opt.hidden = false;
      } else {
        const text = (opt.textContent || '').toLowerCase();
        opt.hidden = !text.includes(term);
      }
    });
  }

  function renderSelectedAttendees(type) {
    const isBook = type === 'book';
    const list = isBook ? bookSelectedAttendees : allotSelectedAttendees;
    const container = document.getElementById(isBook ? 'book-selected-attendees-list' : 'allot-selected-attendees-list');
    const badge = document.getElementById(isBook ? 'book-attendees-counter-badge' : 'allot-attendees-counter-badge');
    const hiddenInput = document.getElementById(isBook ? 'book-participants' : 'allot-participants');
    const countInput = document.getElementById(isBook ? 'book-attendees' : 'allot-attendees');

    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `<span class="text-xs text-slate-400 italic" id="${isBook ? 'book-no-attendees-hint' : 'allot-no-attendees-hint'}">No employees selected yet. Pick from the dropdown above.</span>`;
      if (badge) badge.textContent = '0 selected';
      if (hiddenInput) hiddenInput.value = '';
      if (countInput) countInput.value = '1';
      return;
    }

    if (badge) badge.textContent = `${list.length} selected`;
    if (hiddenInput) hiddenInput.value = list.map((c) => c.name).join(', ');
    if (countInput) countInput.value = String(Math.max(1, list.length));

    container.innerHTML = '';
    list.forEach((emp) => {
      const chip = document.createElement('div');
      chip.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
        isBook ? 'bg-blue-100 text-blue-900 border border-blue-200' : 'bg-slate-200 text-slate-900 border border-slate-300'
      } shadow-2xs transition`;

      chip.innerHTML = `
        <i data-lucide="user" class="w-3.5 h-3.5 ${isBook ? 'text-blue-700' : 'text-slate-700'} shrink-0"></i>
        <span class="font-semibold">${escapeHtml(emp.name)}</span>
        <span class="text-[10px] ${isBook ? 'bg-blue-200/70 text-blue-800' : 'bg-slate-300 text-slate-800'} px-1.5 py-0.5 rounded">${escapeHtml(emp.department || 'General')}</span>
        <button type="button" class="ml-1 text-slate-400 hover:text-rose-600 rounded p-0.5 hover:bg-rose-50 transition cursor-pointer" title="Remove ${escapeHtml(emp.name)}">
          <i data-lucide="x" class="w-3.5 h-3.5"></i>
        </button>
      `;

      const removeBtn = chip.querySelector('button');
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeAttendee(type, emp.id);
      });

      container.appendChild(chip);
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function addAttendee(type, empId) {
    const list = type === 'book' ? bookSelectedAttendees : allotSelectedAttendees;
    const emp = cachedColleagues.find((c) => String(c.id) === String(empId));
    if (!emp) return;

    // Prevent adding the person booking the meeting as an attendee
    if (type === 'book' && currentUser && (emp.id === currentUser.id || (emp.email || '').toLowerCase() === (currentUser.email || '').toLowerCase())) {
      showToast('You are the organizer booking this meeting and cannot be added as an attendee.', 'info');
      return;
    }

    if (type === 'allot') {
      const allotUserSelect = document.getElementById('allot-user');
      const assignedUserId = allotUserSelect ? Number(allotUserSelect.value) : 0;
      if (assignedUserId && emp.id === assignedUserId) {
        showToast('This employee is the assigned organizer booking this meeting.', 'info');
        return;
      }
    }

    if (!list.some((item) => item.id === emp.id)) {
      list.push(emp);
      renderSelectedAttendees(type);
    }
  }

  function removeAttendee(type, empId) {
    if (type === 'book') {
      bookSelectedAttendees = bookSelectedAttendees.filter((c) => c.id !== empId);
    } else {
      allotSelectedAttendees = allotSelectedAttendees.filter((c) => c.id !== empId);
    }
    renderSelectedAttendees(type);
  }

  function selectAllAttendees(type) {
    if (type === 'book') {
      const bookerId = currentUser ? currentUser.id : null;
      const bookerEmail = currentUser ? (currentUser.email || '').toLowerCase().trim() : '';

      // Select all colleagues EXCEPT the person booking the meeting
      bookSelectedAttendees = cachedColleagues.filter((c) => {
        if (bookerId && c.id === bookerId) return false;
        if (bookerEmail && (c.email || '').toLowerCase().trim() === bookerEmail) return false;
        return true;
      });
    } else {
      const allotUserSelect = document.getElementById('allot-user');
      const assignedUserId = allotUserSelect ? Number(allotUserSelect.value) : 0;

      // Select all colleagues EXCEPT the employee booking the meeting
      allotSelectedAttendees = cachedColleagues.filter((c) => {
        if (assignedUserId && c.id === assignedUserId) return false;
        return true;
      });
    }
    renderSelectedAttendees(type);
  }

  function clearAttendees(type) {
    if (type === 'book') {
      bookSelectedAttendees = [];
    } else {
      allotSelectedAttendees = [];
    }
    renderSelectedAttendees(type);
  }

  function getBookingFormValues() {
    const { date: today } = kolkataNowStrings();
    const dateInput = document.getElementById('book-date');
    const date = (dateInput && dateInput.value) || '';
    const hallId = (document.getElementById('book-hall')?.value || '').trim();
    const startTime = (document.getElementById('book-start')?.value || '').trim();
    const endTime = (document.getElementById('book-end')?.value || '').trim();
    const participants = (document.getElementById('book-participants')?.value || '').trim();
    let attendees = parseInt(document.getElementById('book-attendees')?.value, 10);
    if (isNaN(attendees) || attendees < 1) {
      if (participants) {
        attendees = participants.split(',').map((p) => p.trim()).filter(Boolean).length || 1;
      } else {
        attendees = 1;
      }
    }
    const purpose = (document.getElementById('book-purpose')?.value || '').trim();
    return { date, hallId, startTime, endTime, attendees, participants, purpose };
  }

  // Synchronize Visual Room Selection Cards with the select element (module scope)
  function syncRoomCards() {
    const hallSelect = document.getElementById('book-hall');
    if (!hallSelect) return;
    const currentHallId = String(hallSelect.value || '');
    document.querySelectorAll('.room-select-card').forEach((card) => {
      const cardHallId = String(card.dataset.hallId);
      const isSelected = Boolean(currentHallId) && cardHallId === currentHallId;
      card.classList.toggle('selected', isSelected);
      const indicator = card.querySelector('.room-active-indicator');
      if (indicator) {
        if (isSelected) {
          indicator.classList.remove('hidden');
          indicator.classList.add('inline-flex');
        } else {
          indicator.classList.add('hidden');
          indicator.classList.remove('inline-flex');
        }
      }
    });
    updateRoomOccupancySummary();
  }

  // Completely resets/clears all booking form inputs, attendee counts, and errors
  function resetBookingForm() {
    const hallSelect = document.getElementById('book-hall');
    if (hallSelect) hallSelect.value = '';
    syncRoomCards();

    const startInput = document.getElementById('book-start');
    if (startInput) startInput.value = '';

    const endInput = document.getElementById('book-end');
    if (endInput) endInput.value = '';

    clearAttendees('book');
    const bookFilter = document.getElementById('book-employee-filter');
    if (bookFilter) {
      bookFilter.value = '';
      filterEmployeeDropdown('book-employee-select', '');
    }
    const bookSelect = document.getElementById('book-employee-select');
    if (bookSelect) bookSelect.value = '';

    const purposeInput = document.getElementById('book-purpose');
    if (purposeInput) purposeInput.value = '';

    const purposeCount = document.getElementById('purpose-count');
    if (purposeCount) purposeCount.textContent = '0';

    const warningBox = document.getElementById('live-slot-warning');
    if (warningBox) warningBox.classList.add('hidden');

    const errEl = document.getElementById('book-error');
    if (errEl) errEl.textContent = '';
  }

  // Live occupancy state cache for instant conflict checking
  let currentOccupancyData = null;
  function updateRoomOccupancySummary() {
    const summaryContainer = document.getElementById('room-occupancy-summary');
    if (!summaryContainer) return;

    const hallSelect = document.getElementById('book-hall');
    const selectedHallId = hallSelect && hallSelect.value ? Number(hallSelect.value) : 0;

    if (!selectedHallId) {
      summaryContainer.innerHTML = `
        <div class="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-xs text-slate-500 flex items-center gap-2">
          <i data-lucide="info" class="w-4 h-4 text-slate-400 shrink-0"></i>
          <span>Please select a conference hall to view its reserved slots and availability for this date.</span>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (!currentOccupancyData || !currentOccupancyData.schedule) {
      summaryContainer.innerHTML = '';
      return;
    }

    const hallObj = currentOccupancyData.schedule.find((h) => Number(h.hallId) === selectedHallId);

    if (!hallObj) {
      summaryContainer.innerHTML = '';
      return;
    }

    const { date: today, time: nowTime } = kolkataNowStrings();
    const queryDate = currentOccupancyData.date || today;
    const isToday = currentOccupancyData.isToday;
    const bookings = hallObj.bookings || [];

    if (bookings.length === 0) {
      summaryContainer.innerHTML = `
        <div class="p-3 sm:p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200/90 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-xs transition shadow-2xs">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <i data-lucide="check" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="font-bold text-emerald-950">${escapeHtml(hallObj.hallName)} is completely available all day</p>
              <p class="text-[11px] text-emerald-700">No conflicting reservations on ${escapeHtml(queryDate)}. All hours are open to book.</p>
            </div>
          </div>
          <span class="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider bg-emerald-200/70 text-emerald-900 px-2.5 py-1 rounded-md shrink-0 self-start sm:self-auto">
            <i data-lucide="sparkles" class="w-3 h-3"></i>
            All Slots Free
          </span>
        </div>
      `;
    } else {
      let chipsHtml = '';
      bookings.forEach((b) => {
        const isOngoing = isToday && nowTime >= b.startTime && nowTime < b.endTime;
        chipsHtml += `
          <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition shadow-2xs ${
            isOngoing 
              ? 'bg-rose-50 border-rose-300 text-rose-900 ring-1 ring-rose-300' 
              : 'bg-white border-slate-200 text-slate-800'
          }">
            <i data-lucide="clock" class="w-3.5 h-3.5 ${isOngoing ? 'text-rose-600 animate-pulse' : 'text-slate-400'}"></i>
            <span>${b.startTime} – ${b.endTime}</span>
            ${isOngoing ? '<span class="text-[9px] uppercase tracking-wide bg-rose-200 text-rose-900 px-1.5 py-0.5 rounded font-extrabold animate-pulse">In Session</span>' : ''}
            ${b.purpose ? `<span class="text-[11px] text-slate-500 font-sans font-normal truncate max-w-[140px]" title="${escapeHtml(b.purpose)}">· ${escapeHtml(b.purpose)}</span>` : ''}
          </div>
        `;
      });

      summaryContainer.innerHTML = `
        <div class="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 text-xs transition shadow-2xs">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 pb-2.5 mb-2.5 border-b border-slate-200/80">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
              <span class="font-bold text-slate-900">Occupied Hours for ${escapeHtml(hallObj.hallName)}:</span>
              <span class="text-[11px] text-slate-500 font-medium">(${bookings.length} reserved slot${bookings.length > 1 ? 's' : ''})</span>
            </div>
            <div class="text-[11px] text-slate-500 font-medium flex items-center gap-1">
              <i data-lucide="info" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span>Select start/end times outside these occupied hours</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            ${chipsHtml}
          </div>
        </div>
      `;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  async function loadRoomOccupancy(requestedDate) {
    const { date: today, time: nowTime } = kolkataNowStrings();
    const queryDate = requestedDate || today;

    const dateLabel = document.getElementById('occupancy-date-label');
    const badge = document.getElementById('booking-selected-date-badge');
    const note = document.getElementById('occupancy-refresh-note');

    if (dateLabel) {
      dateLabel.textContent = queryDate === today ? `Today (${queryDate})` : queryDate;
    }
    if (badge) {
      badge.textContent = queryDate;
    }
    if (note) {
      note.textContent = `${nowTime} IST`;
    }

    try {
      const data = await api(`/bookings/schedule?date=${encodeURIComponent(queryDate)}`);
      currentOccupancyData = data;

      // Update room badges on visual selection cards
      if (data && data.schedule) {
        data.schedule.forEach((hall) => {
          const badgeEl = document.getElementById(`room-status-badge-${hall.hallId}`);
          if (!badgeEl) return;

          const bookings = hall.bookings || [];
          const hasOngoing = data.isToday && bookings.some((b) => nowTime >= b.startTime && nowTime < b.endTime);

          if (hasOngoing) {
            badgeEl.className = 'text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1 animate-pulse';
            badgeEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>In Session Now';
          } else if (bookings.length === 0) {
            badgeEl.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1';
            badgeEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Free ${data.isToday ? 'Today' : 'All Day'}`;
          } else {
            badgeEl.className = 'text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1';
            badgeEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>${bookings.length} Slot${bookings.length > 1 ? 's' : ''} Occupied`;
          }
        });
      }

      updateRoomOccupancySummary();
      checkLiveConflict();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Automatic real-time conflict evaluator (runs as user types times without needing a button)
  function checkLiveConflict() {
    const warningBox = document.getElementById('live-slot-warning');
    if (!warningBox) return;

    const hallSelect = document.getElementById('book-hall');
    const hallId = Number(hallSelect ? hallSelect.value : 0);
    const hallName = hallSelect && hallSelect.options[hallSelect.selectedIndex] && hallSelect.value ? hallSelect.options[hallSelect.selectedIndex].text : 'Conference Hall';
    const startTime = (document.getElementById('book-start')?.value || '').trim();
    const endTime = (document.getElementById('book-end')?.value || '').trim();
    const bookDate = (document.getElementById('book-date')?.value || '').trim();
    const { date: today, time: nowTime } = kolkataNowStrings();

    if (!hallId || !startTime || !endTime) {
      warningBox.classList.add('hidden');
      return;
    }

    if (startTime >= endTime) {
      warningBox.className = 'mb-4 p-2.5 rounded-xl text-xs font-medium border bg-amber-50 text-amber-800 border-amber-200 flex items-center gap-2';
      warningBox.innerHTML = '<i data-lucide="alert-circle" class="w-4 h-4 text-amber-600 shrink-0"></i><span>End time must be after start time.</span>';
      warningBox.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (bookDate === today && startTime < nowTime) {
      warningBox.className = 'mb-4 p-2.5 rounded-xl text-xs font-medium border bg-rose-50 text-rose-800 border-rose-200 flex items-center gap-2';
      warningBox.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-rose-600 shrink-0"></i><span>Start time cannot be in the past for today (current time is ${nowTime} IST).</span>`;
      warningBox.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (currentOccupancyData && currentOccupancyData.schedule) {
      const hallObj = currentOccupancyData.schedule.find((h) => Number(h.hallId) === hallId);
      if (hallObj && hallObj.bookings) {
        const conflict = hallObj.bookings.find((b) => b.startTime < endTime && b.endTime > startTime);
        if (conflict) {
          warningBox.className = 'mb-4 p-3 rounded-xl text-xs font-medium border bg-rose-50 text-rose-900 border-rose-200 flex items-start gap-2 shadow-2xs';
          warningBox.innerHTML = `
            <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-600 shrink-0 mt-0.5"></i>
            <div>
              <strong>${escapeHtml(hallName)} is already occupied during this time!</strong>
              <div class="mt-0.5 text-rose-700">Occupied slot: <strong>${conflict.startTime} – ${conflict.endTime}</strong> ${conflict.purpose ? `(${escapeHtml(conflict.purpose)})` : ''}. Please pick another slot.</div>
            </div>
          `;
          warningBox.classList.remove('hidden');
          if (window.lucide) window.lucide.createIcons();
          return;
        }
      }

      // Check if the current user already has a booking in ANY hall during this time window
      for (const anyHall of currentOccupancyData.schedule) {
        if (anyHall.bookings) {
          const myConflict = anyHall.bookings.find((b) => b.isMine && b.startTime < endTime && b.endTime > startTime);
          if (myConflict) {
            warningBox.className = 'mb-4 p-3 rounded-xl text-xs font-medium border bg-amber-50 text-amber-900 border-amber-300 flex items-start gap-2 shadow-2xs';
            warningBox.innerHTML = `
              <i data-lucide="alert-circle" class="w-4 h-4 text-amber-600 shrink-0 mt-0.5"></i>
              <div>
                <strong>You already have an active booking in ${escapeHtml(anyHall.hallName)}!</strong>
                <div class="mt-0.5 text-amber-800">Your reserved slot: <strong>${myConflict.startTime} – ${myConflict.endTime}</strong>. The same person cannot block both halls for the same time.</div>
              </div>
            `;
            warningBox.classList.remove('hidden');
            if (window.lucide) window.lucide.createIcons();
            return;
          }
        }
      }
    }

    // No conflict: slot is open and free
    warningBox.className = 'mb-4 p-2.5 rounded-xl text-xs font-medium border bg-emerald-50 text-emerald-800 border-emerald-200 flex items-center gap-2';
    warningBox.innerHTML = `<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0"></i><span><strong>${escapeHtml(hallName)} is open &amp; free</strong> from ${startTime} to ${endTime}!</span>`;
    warningBox.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  function showBookingPassModal(b) {
    const modal = document.getElementById('modal-booking-pass');
    if (!modal) return;
    
    const codeEl = document.getElementById('pass-booking-code');
    const hallEl = document.getElementById('pass-hall-name');
    const countEl = document.getElementById('pass-attendees-badge');
    const dateEl = document.getElementById('pass-date');
    const timeEl = document.getElementById('pass-time');
    const partEl = document.getElementById('pass-participants');
    const purpEl = document.getElementById('pass-purpose');

    if (codeEl) codeEl.textContent = b.bookingCode || b.bookingId || '#ALG-CONF';
    if (hallEl) hallEl.textContent = b.hallName || b.hall || 'Executive Room';
    const count = Number(b.attendees) || 1;
    if (countEl) countEl.textContent = `${count} Attendee${count > 1 ? 's' : ''}`;
    if (dateEl) dateEl.textContent = b.date;
    if (timeEl) timeEl.textContent = `${b.startTime} - ${b.endTime} IST`;
    if (partEl) partEl.textContent = b.participants || 'All team participants';
    if (purpEl) purpEl.textContent = b.purpose || 'Executive meeting';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();

    const closeModal = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    };

    const btnClose = document.getElementById('btn-close-pass');
    const btnDone = document.getElementById('btn-pass-book-another');
    const btnView = document.getElementById('btn-pass-view-bookings');

    if (btnClose) btnClose.onclick = closeModal;
    if (btnDone) btnDone.onclick = closeModal;
    if (btnView) {
      btnView.onclick = () => {
        closeModal();
        if (currentUser && currentUser.role === 'ADMIN') {
          switchPanel(viewAdmin, 'panel-admin-bookings');
          refreshAdminBookings();
        } else {
          switchPanel(viewEmployee, 'panel-mine');
          refreshMyBookings();
        }
      };
    }
  }

  async function confirmBooking() {
    const errEl = document.getElementById('book-error');
    errEl.textContent = '';
    const { date, hallId, startTime, endTime, attendees, participants, purpose } = getBookingFormValues();
    const { date: today, time: nowTime } = kolkataNowStrings();

    if (!date) {
      errEl.textContent = 'Please select a meeting date.';
      document.getElementById('book-date')?.focus();
      return;
    }
    if (!hallId) {
      errEl.textContent = 'Please choose a conference hall from Step 1 above.';
      document.getElementById('visual-room-cards')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!startTime) {
      errEl.textContent = 'Please enter a start time.';
      document.getElementById('book-start')?.focus();
      return;
    }
    if (!endTime) {
      errEl.textContent = 'Please enter an end time.';
      document.getElementById('book-end')?.focus();
      return;
    }
    if (startTime >= endTime) {
      errEl.textContent = 'End time must be after start time.';
      document.getElementById('book-end')?.focus();
      return;
    }
    if (date < today) {
      errEl.textContent = 'Cannot book a past date.';
      return;
    }
    if (date === today && startTime < nowTime) {
      errEl.textContent = `Start time cannot be in the past for today. Current time is ${nowTime} IST.`;
      return;
    }
    if (!attendees || isNaN(attendees) || attendees < 1) {
      errEl.textContent = 'Please specify members count (at least 1).';
      document.getElementById('book-attendees')?.focus();
      return;
    }
    if (!participants || !participants.trim()) {
      errEl.textContent = 'Please select at least one employee from the registered employees dropdown.';
      document.getElementById('book-employee-select')?.focus();
      return;
    }
    if (!purpose || !purpose.trim()) {
      errEl.textContent = 'Please enter the meeting purpose / agenda before booking.';
      document.getElementById('book-purpose')?.focus();
      return;
    }

    try {
      const res = await api('/bookings', {
        method: 'POST',
        body: { date, hallId: Number(hallId), startTime, endTime, attendees, participants, purpose },
      });
      showToast(res.message || 'Booking confirmed! A notification has been sent.', 'success');

      const hallSelect = document.getElementById('book-hall');
      const hallName = hallSelect && hallSelect.options[hallSelect.selectedIndex] ? hallSelect.options[hallSelect.selectedIndex].text : 'Board Room';

      showBookingPassModal({
        bookingCode: res.booking?.bookingId || res.bookingId || '',
        hallName: res.booking?.hall || hallName,
        date,
        startTime,
        endTime,
        attendees,
        participants,
        purpose,
      });

      // Clear the booking form / feed completely
      resetBookingForm();
      
      // Instantly refresh the room occupancy cards for this date
      loadRoomOccupancy(date);
      refreshSchedule(date);
      refreshMyBookings();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  async function refreshSchedule(requestedDate) {
    const container = document.getElementById('schedule-container');
    const dateLabel = document.getElementById('sched-date');
    const { date: today, time: nowTime } = kolkataNowStrings();
    const dateToQuery = requestedDate || today;

    try {
      const data = await api(`/bookings/schedule?date=${encodeURIComponent(dateToQuery)}`);
      
      let dayDesc = 'Today';
      if (data.date > today) {
        dayDesc = 'Future Date';
      } else if (data.date < today) {
        dayDesc = 'Past Date';
      }

      dateLabel.innerHTML = `
        <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
        <span>Schedule for: <strong>${data.date}</strong> (${dayDesc}) · Current IST: ${nowTime}</span>
      `;
      
      container.innerHTML = '';
      data.schedule.forEach((hall) => {
        const block = document.createElement('div');
        block.className = 'bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs';
        
        const heading = document.createElement('div');
        heading.className = 'text-sm font-bold text-slate-900 pb-3 mb-3 border-b border-slate-100 flex items-center justify-between';
        heading.innerHTML = `
          <span class="flex items-center gap-2">
            <i data-lucide="door-closed" class="w-4 h-4 text-slate-500"></i>
            ${escapeHtml(hall.hallName)}
          </span>
          <span class="text-[11px] font-medium text-slate-500 font-mono">${hall.bookings.length} ${hall.bookings.length === 1 ? 'slot' : 'slots'}</span>
        `;
        block.appendChild(heading);

        if (hall.bookings.length === 0) {
          const p = document.createElement('div');
          p.className = 'text-xs text-slate-400 italic p-6 bg-slate-50/70 rounded-xl border border-dashed border-slate-200 text-center flex flex-col items-center gap-1.5';
          p.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4 text-slate-300"></i><span>All day available on ${data.date}</span>`;
          block.appendChild(p);
        } else {
          const list = document.createElement('div');
          list.className = 'space-y-2';
          hall.bookings.forEach((b) => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between p-2.5 rounded-lg border text-xs transition ' + 
              (b.isMine 
                ? 'bg-blue-50/80 border-blue-200 text-blue-900 font-semibold' 
                : 'bg-slate-50/90 border-slate-200/80 text-slate-700 font-medium');
            row.innerHTML = `
              <div class="flex items-center gap-2 min-w-0">
                <i data-lucide="${b.isMine ? 'user-check' : 'clock'}" class="w-3.5 h-3.5 shrink-0 ${b.isMine ? 'text-blue-600' : 'text-slate-400'}"></i>
                <span class="truncate font-mono">${b.startTime} – ${b.endTime}</span>
                <span class="text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded font-medium">${b.attendees} ${b.attendees === 1 ? 'person' : 'persons'}</span>
                ${b.participants ? `<span class="text-[10px] text-slate-500 truncate max-w-[130px]" title="${escapeHtml(b.participants)}">(${escapeHtml(b.participants)})</span>` : ''}
                ${b.concludedEarly ? '<span class="text-[9px] uppercase tracking-wide bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold shrink-0">Freed Early</span>' : ''}
                ${b.isMine ? '<span class="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold shrink-0">Yours</span>' : ''}
              </div>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${b.concludedEarly ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'} shrink-0">${b.concludedEarly ? 'Concluded' : 'Booked'}</span>
            `;
            list.appendChild(row);
          });
          block.appendChild(list);
        }
        container.appendChild(block);
      });
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function refreshMyBookings() {
    const tbody = document.querySelector('#my-bookings-table tbody');
    const emptyNote = document.getElementById('my-bookings-empty');
    try {
      const data = await api('/bookings/my');
      tbody.innerHTML = '';
      if (data.bookings.length === 0) {
        emptyNote.classList.remove('hidden');
      } else {
        emptyNote.classList.add('hidden');
        data.bookings.forEach((b) => {
          const isBoard = b.hall.toLowerCase().includes('board');
          const hallBadge = isBoard
            ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold room-badge-board"><i data-lucide="presentation" class="w-3.5 h-3.5"></i>${escapeHtml(b.hall)}</span>`
            : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold room-badge-small"><i data-lucide="users" class="w-3.5 h-3.5"></i>${escapeHtml(b.hall)}</span>`;

          const statusBadge = b.isOngoing
            ? `<span class="status-pill bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-300 font-bold"><span class="w-1.5 h-1.5 rounded-full bg-rose-600 animate-session-pulse"></span>ACTIVE NOW</span>`
            : `<span class="status-pill ${b.status}">${b.status}</span>`;

          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-50/70 transition-colors text-xs border-b border-slate-100 last:border-0';
          tr.innerHTML = `
            <td class="px-3.5 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap">${b.bookingId}</td>
            <td class="px-3.5 py-3 whitespace-nowrap font-medium">${b.date}</td>
            <td class="px-3.5 py-3 whitespace-nowrap">${hallBadge}</td>
            <td class="px-3.5 py-3 font-mono whitespace-nowrap">${b.startTime}–${b.endTime}</td>
            <td class="px-3.5 py-3">
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold font-mono">${b.attendees || 1}</span>
                <span class="text-[11px] text-slate-400">person${(b.attendees || 1) > 1 ? 's' : ''}</span>
              </div>
              ${b.participants ? `<div class="text-[11px] text-slate-600 font-medium truncate max-w-[170px] mt-0.5" title="${escapeHtml(b.participants)}">${escapeHtml(b.participants)}</div>` : ''}
            </td>
            <td class="px-3.5 py-3 max-w-xs truncate" title="${escapeHtml(b.purpose)}">${escapeHtml(b.purpose)}</td>
            <td class="px-3.5 py-3 whitespace-nowrap">${statusBadge}</td>
            <td class="px-3.5 py-3 text-right whitespace-nowrap"></td>
          `;
          const actionTd = tr.lastElementChild;
          if (b.canCancel) {
            const btn = document.createElement('button');
            btn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-md transition cursor-pointer shadow-2xs';
            btn.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3"></i><span>Cancel</span>`;
            btn.title = 'Cancel this booking before it starts';
            btn.addEventListener('click', () => cancelOwnBooking(b.bookingId));
            actionTd.appendChild(btn);
          } else if (b.canFreeRoom) {
            const btn = document.createElement('button');
            btn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-md transition cursor-pointer shadow-2xs';
            btn.innerHTML = `<i data-lucide="door-open" class="w-3.5 h-3.5 text-emerald-600"></i><span>Free Room Now</span>`;
            btn.title = 'Conclude meeting early and free the conference hall immediately for other colleagues';
            btn.addEventListener('click', () => freeRoomEarly(b.bookingId));
            actionTd.appendChild(btn);
          } else if (b.concludedEarly) {
            actionTd.innerHTML = '<span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded"><i data-lucide="check" class="w-3 h-3"></i>Freed Early</span>';
          } else {
            actionTd.innerHTML = '<span class="text-slate-300 font-mono text-xs">—</span>';
          }
          tbody.appendChild(tr);
        });
        if (window.lucide) window.lucide.createIcons();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function cancelOwnBooking(bookingId) {
    if (!confirm(`Cancel booking ${bookingId}? This room will become available for colleagues.`)) return;
    try {
      const data = await api(`/bookings/${bookingId}/cancel`, { method: 'POST' });
      showToast(data.message || 'Booking cancelled.', 'success');
      refreshMyBookings();
      const currentBookDate = document.getElementById('book-date')?.value || kolkataNowStrings().date;
      loadRoomOccupancy(currentBookDate);
      const schedPicker = document.getElementById('sched-date-picker');
      refreshSchedule(schedPicker ? schedPicker.value : null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function freeRoomEarly(bookingId) {
    if (!confirm(`Conclude meeting and free this room early?\n\nThis will instantly release the room starting right now so other employees can book it!`)) return;
    try {
      const data = await api(`/bookings/${bookingId}/end-early`, { method: 'POST' });
      showToast(data.message || 'Room freed successfully! Available for others.', 'success');
      refreshMyBookings();
      const currentBookDate = document.getElementById('book-date')?.value || kolkataNowStrings().date;
      loadRoomOccupancy(currentBookDate);
      const schedPicker = document.getElementById('sched-date-picker');
      refreshSchedule(schedPicker ? schedPicker.value : null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =================================================================
  // ADMIN DASHBOARD
  // =================================================================
  let adminInitialized = false;

  function initAdminView(user) {
    const u = user || currentUser;
    const adminWho = document.getElementById('admin-who');
    if (adminWho && u) {
      adminWho.textContent = `${u.fullName} · Admin Console`;
    }
    startClock('admin-clock');

    const { date: today } = kolkataNowStrings();
    const allotDateInput = document.getElementById('allot-date');
    if (allotDateInput) {
      allotDateInput.min = today;
      if (!allotDateInput.value) allotDateInput.value = today;
    }

    const currentHash = (window.location.hash || '').toLowerCase();
    const savedPanel = HASH_PANEL_MAP[currentHash]
      || localStorage.getItem('algorisys_active_panel')
      || sessionStorage.getItem('algorisys_active_panel')
      || 'panel-admin-overview';

    const validAdminPanels = ['panel-admin-overview', 'panel-admin-bookings', 'panel-admin-allot', 'panel-admin-users'];
    const targetPanel = validAdminPanels.includes(savedPanel) ? savedPanel : 'panel-admin-overview';

    switchPanel(viewAdmin, targetPanel, false);
    if (targetPanel === 'panel-admin-overview') refreshAdminSummary();
    if (targetPanel === 'panel-admin-bookings') refreshAdminBookings();
    if (targetPanel === 'panel-admin-users') refreshAdminUsers();
    if (targetPanel === 'panel-admin-allot') {
      loadUsersIntoAllotDropdown();
      loadHallsInto('allot-hall', false, '-- Select Conference Hall --');
    }

    loadHallsInto('filter-hall', true);
    loadHallsInto('allot-hall', false, '-- Select Conference Hall --');
    loadUsersIntoAllotDropdown();
    loadColleaguesDatalist();
    if (targetPanel !== 'panel-admin-overview') refreshAdminSummary();
    if (targetPanel !== 'panel-admin-bookings') refreshAdminBookings();
    if (targetPanel !== 'panel-admin-users') refreshAdminUsers();

    if (adminInitialized) return;
    adminInitialized = true;

    viewAdmin.querySelectorAll('.tabbar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchPanel(viewAdmin, btn.dataset.panel);
        if (btn.dataset.panel === 'panel-admin-overview') refreshAdminSummary();
        if (btn.dataset.panel === 'panel-admin-bookings') refreshAdminBookings();
        if (btn.dataset.panel === 'panel-admin-users') refreshAdminUsers();
        if (btn.dataset.panel === 'panel-admin-allot') {
          loadUsersIntoAllotDropdown();
          loadHallsInto('allot-hall', false, '-- Select Conference Hall --');
        }
      });
    });

    document.getElementById('admin-logout').addEventListener('click', logout);
    document.getElementById('btn-apply-filters').addEventListener('click', refreshAdminBookings);
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      document.getElementById('filter-date').value = '';
      document.getElementById('filter-hall').value = '';
      document.getElementById('filter-employee').value = '';
      document.getElementById('filter-status').value = '';
      refreshAdminBookings();
    });

    // Admin Allot Room form submit
    const btnAllotSubmit = document.getElementById('btn-admin-allot-submit');
    if (btnAllotSubmit) {
      btnAllotSubmit.addEventListener('click', handleAdminAllotSubmit);
    }

    // Admin Allot Attendee Dropdown Selection from Database
    const allotSelect = document.getElementById('allot-colleague-select');
    if (allotSelect) {
      allotSelect.addEventListener('change', () => {
        if (allotSelect.value === '__ALL__') {
          selectAllAttendees('allot');
          allotSelect.value = '';
        } else if (allotSelect.value) {
          addAttendee('allot', allotSelect.value);
          allotSelect.value = '';
        }
      });
    }

    const allotFilter = document.getElementById('allot-employee-filter');
    if (allotFilter) {
      allotFilter.addEventListener('input', () => {
        filterEmployeeDropdown('allot-colleague-select', allotFilter.value);
      });
      allotFilter.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const select = document.getElementById('allot-colleague-select');
          if (select) {
            const firstVisible = Array.from(select.options).slice(1).find((opt) => !opt.hidden);
            if (firstVisible && firstVisible.value) {
              if (firstVisible.value === '__ALL__') {
                selectAllAttendees('allot');
              } else {
                addAttendee('allot', firstVisible.value);
              }
              allotFilter.value = '';
              filterEmployeeDropdown('allot-colleague-select', '');
            }
          }
        }
      });
    }

    const allotSelectAllBtn = document.getElementById('allot-select-all-btn');
    if (allotSelectAllBtn) {
      allotSelectAllBtn.addEventListener('click', () => selectAllAttendees('allot'));
    }

    const allotClearBtn = document.getElementById('allot-clear-attendees-btn');
    if (allotClearBtn) {
      allotClearBtn.addEventListener('click', () => clearAttendees('allot'));
    }

    const allotUserSelect = document.getElementById('allot-user');
    if (allotUserSelect) {
      allotUserSelect.addEventListener('change', () => {
        const bookerId = Number(allotUserSelect.value);
        if (bookerId) {
          // Exclude the person booking the meeting from attendees
          allotSelectedAttendees = allotSelectedAttendees.filter((c) => c.id !== bookerId);
          renderSelectedAttendees('allot');
          populateEmployeeDropdown('allot-colleague-select', cachedColleagues);
        }
      });
    }

    const allotHallSelect = document.getElementById('allot-hall');
    if (allotHallSelect) {
      allotHallSelect.addEventListener('change', updateAdminHallPreview);
    }

    // Admin Register Employee Modal Handlers
    const modalRegisterEmp = document.getElementById('modal-register-employee');
    const btnOpenRegisterEmp = document.getElementById('btn-open-register-employee');
    const btnCloseRegisterEmp = document.getElementById('btn-close-register-modal');
    const btnCancelRegisterEmp = document.getElementById('btn-cancel-register-emp');
    const btnGenPass = document.getElementById('btn-admin-gen-password');
    const formAdminRegisterEmp = document.getElementById('form-admin-register-employee');

    function openRegisterEmployeeModal() {
      if (!modalRegisterEmp) return;
      const errEl = document.getElementById('admin-register-error');
      if (errEl) errEl.textContent = '';
      formAdminRegisterEmp?.reset();
      modalRegisterEmp.classList.remove('hidden');
      modalRegisterEmp.classList.add('flex');
      if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
      document.getElementById('admin-emp-name')?.focus();
    }

    function closeRegisterEmployeeModal() {
      if (!modalRegisterEmp) return;
      modalRegisterEmp.classList.add('hidden');
      modalRegisterEmp.classList.remove('flex');
    }

    if (btnOpenRegisterEmp) btnOpenRegisterEmp.addEventListener('click', openRegisterEmployeeModal);
    if (btnCloseRegisterEmp) btnCloseRegisterEmp.addEventListener('click', closeRegisterEmployeeModal);
    if (btnCancelRegisterEmp) btnCancelRegisterEmp.addEventListener('click', closeRegisterEmployeeModal);

    if (btnGenPass) {
      btnGenPass.addEventListener('click', () => {
        const passInput = document.getElementById('admin-emp-password');
        if (passInput) {
          const randomNum = Math.floor(1000 + Math.random() * 9000);
          passInput.value = `Algorisys@${randomNum}`;
          passInput.type = 'text';
        }
      });
    }

    if (formAdminRegisterEmp) {
      formAdminRegisterEmp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('admin-register-error');
        if (errEl) errEl.textContent = '';

        const fullName = document.getElementById('admin-emp-name')?.value.trim();
        const email = document.getElementById('admin-emp-email')?.value.trim();
        const department = document.getElementById('admin-emp-dept')?.value.trim();
        const designation = document.getElementById('admin-emp-designation')?.value.trim() || 'Team Member';
        const password = document.getElementById('admin-emp-password')?.value;
        const role = document.getElementById('admin-emp-role')?.value || 'EMPLOYEE';

        const submitBtn = document.getElementById('btn-submit-register-emp');
        const originalHtml = submitBtn ? submitBtn.innerHTML : '';

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>Registering...</span><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
            if (window.lucide) window.lucide.createIcons();
          }

          const data = await api('/admin/users', {
            method: 'POST',
            body: { fullName, email, department, designation, password, role },
          });

          showToast(data.message || `Employee ${fullName} registered!`, 'success');
          closeRegisterEmployeeModal();
          refreshAdminUsers();
          refreshAdminSummary();
          loadUsersIntoAllotDropdown();
          loadColleaguesDatalist();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml;
            if (window.lucide) window.lucide.createIcons();
          }
        }
      });
    }

    // Admin Edit Employee Modal Handlers
    const btnCloseEditEmp = document.getElementById('btn-close-edit-modal');
    const btnCancelEditEmp = document.getElementById('btn-cancel-edit-emp');
    const btnEditGenPass = document.getElementById('btn-edit-gen-password');
    const formAdminEditEmp = document.getElementById('form-admin-edit-employee');

    if (btnCloseEditEmp) btnCloseEditEmp.addEventListener('click', closeEditEmployeeModal);
    if (btnCancelEditEmp) btnCancelEditEmp.addEventListener('click', closeEditEmployeeModal);

    if (btnEditGenPass) {
      btnEditGenPass.addEventListener('click', () => {
        const passInput = document.getElementById('edit-emp-password');
        if (passInput) {
          const randomNum = Math.floor(1000 + Math.random() * 9000);
          passInput.value = `Algorisys@${randomNum}`;
          passInput.type = 'text';
          const mustChangeEl = document.getElementById('edit-emp-must-change');
          if (mustChangeEl) mustChangeEl.checked = true;
        }
      });
    }

    if (formAdminEditEmp) {
      formAdminEditEmp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('admin-edit-error');
        if (errEl) errEl.textContent = '';

        const id = document.getElementById('edit-emp-id')?.value;
        const fullName = document.getElementById('edit-emp-name')?.value.trim();
        const email = document.getElementById('edit-emp-email')?.value.trim();
        const department = document.getElementById('edit-emp-dept')?.value.trim();
        const designation = document.getElementById('edit-emp-designation')?.value.trim() || 'Team Member';
        const role = document.getElementById('edit-emp-role')?.value || 'EMPLOYEE';
        const active = document.getElementById('edit-emp-status')?.value === '1';
        const password = document.getElementById('edit-emp-password')?.value;
        const mustChangePassword = document.getElementById('edit-emp-must-change')?.checked;

        const submitBtn = document.getElementById('btn-submit-edit-emp');
        const originalHtml = submitBtn ? submitBtn.innerHTML : '';

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>Saving...</span><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
            if (window.lucide) window.lucide.createIcons();
          }

          const data = await api(`/admin/users/${id}`, {
            method: 'PUT',
            body: { fullName, email, department, designation, role, active, password, mustChangePassword },
          });

          showToast(data.message || `Employee "${fullName}" updated!`, 'success');
          closeEditEmployeeModal();
          refreshAdminUsers();
          refreshAdminSummary();
          loadUsersIntoAllotDropdown();
          loadColleaguesDatalist();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml;
            if (window.lucide) window.lucide.createIcons();
          }
        }
      });
    }
  }

  function updateAdminHallPreview() {
    const select = document.getElementById('allot-hall');
    const preview = document.getElementById('admin-hall-preview');
    if (!select || !preview) return;
    const val = String(select.value || '');
    if (!val) {
      preview.classList.add('hidden');
      preview.classList.remove('flex');
      return;
    }
    preview.classList.remove('hidden');
    preview.classList.add('flex');
    const img = document.getElementById('admin-hall-preview-img');
    const title = document.getElementById('admin-hall-preview-title');
    const cap = document.getElementById('admin-hall-preview-capacity');
    const desc = document.getElementById('admin-hall-preview-desc');
    const chips = document.getElementById('admin-hall-preview-chips');

    if (val === '1') {
      if (img) img.src = '/images/board-room.jpg';
      if (title) title.textContent = 'Board Room';
      if (cap) cap.textContent = '10 Seats';
      if (desc) desc.textContent = 'Executive Suite · Leadership & Board Meetings';
    } else {
      if (img) img.src = '/images/small-conference-room.jpg';
      if (title) title.textContent = 'Small Conference Room';
      if (cap) cap.textContent = '6 Seats';
      if (desc) desc.textContent = 'Collaboration Hub · 1-on-1s & Team Syncs';
    }
    if (chips) chips.innerHTML = '';
    if (window.lucide) window.lucide.createIcons();
  }

  async function loadUsersIntoAllotDropdown() {
    const select = document.getElementById('allot-user');
    if (!select) return;
    try {
      const data = await api('/admin/users');
      select.innerHTML = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- Select Employee --';
      select.appendChild(defaultOpt);
      data.users.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.fullName;
        select.appendChild(opt);
      });
    } catch (e) {
      console.error('Failed to load users for allotment:', e);
    }
  }

  async function handleAdminAllotSubmit() {
    const errEl = document.getElementById('allot-error');
    errEl.textContent = '';

    const userSelectVal = (document.getElementById('allot-user')?.value || '').trim();
    const hallSelectVal = (document.getElementById('allot-hall')?.value || '').trim();
    const userId = userSelectVal ? Number(userSelectVal) : 0;
    const hallId = hallSelectVal ? Number(hallSelectVal) : 0;
    const date = (document.getElementById('allot-date')?.value || '').trim();
    const startTime = (document.getElementById('allot-start')?.value || '').trim();
    const endTime = (document.getElementById('allot-end')?.value || '').trim();
    const participants = (document.getElementById('allot-participants')?.value || '').trim();
    let attendees = parseInt(document.getElementById('allot-attendees')?.value, 10);
    if (isNaN(attendees) || attendees < 1) {
      if (participants) {
        attendees = participants.split(',').map((p) => p.trim()).filter(Boolean).length || 1;
      } else {
        attendees = 1;
      }
    }
    const purpose = (document.getElementById('allot-purpose')?.value || '').trim();

    const { date: today, time: nowTime } = kolkataNowStrings();

    if (!userId) {
      errEl.textContent = 'Please select an employee.';
      document.getElementById('allot-user')?.focus();
      return;
    }
    if (!hallId) {
      errEl.textContent = 'Please select a conference hall.';
      document.getElementById('allot-hall')?.focus();
      return;
    }
    if (!date) {
      errEl.textContent = 'Please select a meeting date.';
      document.getElementById('allot-date')?.focus();
      return;
    }
    if (!startTime) {
      errEl.textContent = 'Please enter a start time.';
      document.getElementById('allot-start')?.focus();
      return;
    }
    if (!endTime) {
      errEl.textContent = 'Please enter an end time.';
      document.getElementById('allot-end')?.focus();
      return;
    }
    if (startTime >= endTime) {
      errEl.textContent = 'End time must be after start time.';
      document.getElementById('allot-end')?.focus();
      return;
    }
    if (date < today) {
      errEl.textContent = 'Cannot allot meeting for a past date.';
      return;
    }
    if (date === today && startTime < nowTime) {
      errEl.textContent = `Start time cannot be in the past for today. Current time is ${nowTime} IST.`;
      return;
    }
    if (!attendees || isNaN(attendees) || attendees < 1) {
      errEl.textContent = 'Please specify members count (at least 1).';
      document.getElementById('allot-attendees')?.focus();
      return;
    }
    if (!participants || !participants.trim()) {
      errEl.textContent = 'Please select at least one employee from the registered employees dropdown.';
      document.getElementById('allot-colleague-select')?.focus();
      return;
    }
    if (!purpose || !purpose.trim()) {
      errEl.textContent = 'Please add meeting purpose / reason before allotting.';
      document.getElementById('allot-purpose')?.focus();
      return;
    }

    try {
      const res = await api('/admin/bookings', {
        method: 'POST',
        body: { userId, hallId, date, startTime, endTime, attendees, participants, purpose },
      });
      showToast(res.message || 'Meeting allotted successfully! Notification email sent.', 'success');

      const hallSelect = document.getElementById('allot-hall');
      const hallName = hallSelect && hallSelect.options[hallSelect.selectedIndex] ? hallSelect.options[hallSelect.selectedIndex].text : 'Conference Hall';

      showBookingPassModal({
        bookingCode: res.booking?.bookingId || res.bookingId || '',
        hallName: res.booking?.hall || hallName,
        date,
        startTime,
        endTime,
        attendees,
        participants,
        purpose,
      });

      document.getElementById('allot-user').value = '';
      document.getElementById('allot-hall').value = '';
      updateAdminHallPreview();
      document.getElementById('allot-start').value = '';
      document.getElementById('allot-end').value = '';
      document.getElementById('allot-purpose').value = '';
      clearAttendees('allot');
      const allotFilter = document.getElementById('allot-employee-filter');
      if (allotFilter) {
        allotFilter.value = '';
        filterEmployeeDropdown('allot-colleague-select', '');
      }
      const allotSelect = document.getElementById('allot-colleague-select');
      if (allotSelect) allotSelect.value = '';
      const allotErr = document.getElementById('allot-error');
      if (allotErr) allotErr.textContent = '';
      
      // Switch back to All Bookings view
      refreshAdminBookings();
      refreshAdminSummary();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  async function refreshAdminSummary() {
    try {
      const data = await api('/admin/summary');
      document.getElementById('stat-today').textContent = data.todaysBookings;
      document.getElementById('stat-active').textContent = data.activeBookings;
      document.getElementById('stat-cancelled').textContent = data.cancelledBookings;
      document.getElementById('stat-employees').textContent = data.totalEmployees;
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function refreshAdminBookings() {
    const date = document.getElementById('filter-date').value;
    const hallSelect = document.getElementById('filter-hall');
    const hall = hallSelect.options[hallSelect.selectedIndex] ? hallSelect.options[hallSelect.selectedIndex].text : '';
    const hallValue = hallSelect.value ? hall : '';
    const employee = document.getElementById('filter-employee').value.trim();
    const status = document.getElementById('filter-status').value;

    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (hallValue) params.set('hall', hallValue);
    if (employee) params.set('employee', employee);
    if (status) params.set('status', status);

    const tbody = document.getElementById('admin-bookings-body');
    try {
      const data = await api(`/admin/bookings?${params.toString()}`);
      tbody.innerHTML = '';
      if (data.bookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="14" class="px-4 py-8 text-center text-xs text-slate-400 italic">No bookings match the filter criteria.</td></tr>`;
        return;
      }
      data.bookings.forEach((b) => {
        const isBoard = b.hall.toLowerCase().includes('board');
        const hallBadge = isBoard
          ? `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold room-badge-board"><i data-lucide="presentation" class="w-3.5 h-3.5"></i>${escapeHtml(b.hall)}</span>`
          : `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold room-badge-small"><i data-lucide="users" class="w-3.5 h-3.5"></i>${escapeHtml(b.hall)}</span>`;

        const statusBadge = b.isOngoing
          ? `<span class="status-pill bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-300 font-bold"><span class="w-1.5 h-1.5 rounded-full bg-rose-600 animate-session-pulse"></span>ACTIVE NOW</span>`
          : `<span class="status-pill ${b.status}">${b.status}</span>`;

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/70 transition-colors text-xs border-b border-slate-100 last:border-0';
        tr.innerHTML = `
          <td class="px-3.5 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">${b.bookingId}</td>
          <td class="px-3.5 py-2.5 whitespace-nowrap font-medium">${b.date}</td>
          <td class="px-3.5 py-2.5 font-mono whitespace-nowrap">${b.startTime}–${b.endTime}</td>
          <td class="px-3.5 py-2.5 whitespace-nowrap">${hallBadge}</td>
          <td class="px-3.5 py-2.5 text-xs">
            <div class="flex items-center gap-1">
              <span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold font-mono">${b.attendees || 1}</span>
              ${b.concludedEarly ? '<span class="text-[9px] uppercase tracking-wide bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold">Freed</span>' : ''}
            </div>
            ${b.participants ? `<div class="text-[11px] text-slate-500 font-normal truncate max-w-[150px] mt-0.5" title="${escapeHtml(b.participants)}">${escapeHtml(b.participants)}</div>` : ''}
          </td>
          <td class="px-3.5 py-2.5 font-semibold text-slate-900 whitespace-nowrap">${escapeHtml(b.employeeName)}</td>
          <td class="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">${escapeHtml(b.employeeEmail)}</td>
          <td class="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">${escapeHtml(b.department)}</td>
          <td class="px-3.5 py-2.5 max-w-[180px] truncate" title="${escapeHtml(b.purpose)}">${escapeHtml(b.purpose)}</td>
          <td class="px-3.5 py-2.5 whitespace-nowrap">${statusBadge}</td>
          <td class="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">${formatDateTime(b.createdAt)}</td>
          <td class="px-3.5 py-2.5 text-slate-400 whitespace-nowrap">${b.cancelledAt ? formatDateTime(b.cancelledAt) : '—'}</td>
          <td class="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">${escapeHtml(b.cancelledBy || '—')}</td>
          <td class="px-3.5 py-2.5 text-right whitespace-nowrap"></td>
        `;
        const actionTd = tr.lastElementChild;
        if (b.status === 'BOOKED') {
          const btn = document.createElement('button');
          btn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-md transition cursor-pointer shadow-2xs';
          btn.innerHTML = `<i data-lucide="ban" class="w-3 h-3"></i><span>Cancel</span>`;
          btn.addEventListener('click', () => adminCancelBooking(b.bookingId));
          actionTd.appendChild(btn);
        } else {
          actionTd.innerHTML = '<span class="text-slate-300 font-mono text-xs">—</span>';
        }
        tbody.appendChild(tr);
      });
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function adminCancelBooking(bookingId) {
    if (!confirm(`Cancel booking ${bookingId}? This cannot be undone.`)) return;
    try {
      const data = await api(`/admin/bookings/${bookingId}/cancel`, { method: 'POST' });
      showToast(data.message || 'Booking cancelled.', 'success');
      refreshAdminBookings();
      refreshAdminSummary();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function refreshAdminUsers() {
    const tbody = document.getElementById('admin-users-body');
    try {
      const data = await api('/admin/users');
      tbody.innerHTML = '';
      data.users.forEach((u) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/70 transition-colors text-xs border-b border-slate-100 last:border-0';
        const firstLoginBadge = u.mustChangePassword
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200"><i data-lucide="clock" class="w-3 h-3"></i>Pending First Login</span>`
          : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><i data-lucide="check" class="w-3 h-3"></i>Password Set</span>`;

        tr.innerHTML = `
          <td class="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">${escapeHtml(u.fullName)}</td>
          <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${escapeHtml(u.email)}</td>
          <td class="px-4 py-3 text-slate-700 whitespace-nowrap">${escapeHtml(u.department)}</td>
          <td class="px-4 py-3 text-slate-600 whitespace-nowrap font-medium">${escapeHtml(u.designation || '—')}</td>
          <td class="px-4 py-3"><span class="inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${u.role === 'ADMIN' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-600'}">${u.role}</span></td>
          <td class="px-4 py-3"><span class="status-pill ${u.active ? 'BOOKED' : 'CANCELLED'}">${u.active ? 'Active' : 'Inactive'}</span></td>
          <td class="px-4 py-3 whitespace-nowrap">${firstLoginBadge}</td>
          <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${formatDateTime(u.createdAt)}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap"></td>
        `;
        const actionTd = tr.lastElementChild;
        const isSelf = currentUser && currentUser.id === u.id;
        if (!isSelf) {
          const actionWrap = document.createElement('div');
          actionWrap.className = 'inline-flex items-center gap-1.5 justify-end';

          // Edit Employee Details button
          const editBtn = document.createElement('button');
          editBtn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-600 hover:text-white rounded-md transition cursor-pointer shadow-2xs';
          editBtn.innerHTML = `<i data-lucide="pencil" class="w-3 h-3"></i><span>Edit</span>`;
          editBtn.title = 'Edit employee profile, designation, or reset password';
          editBtn.addEventListener('click', () => openEditEmployeeModal(u));
          actionWrap.appendChild(editBtn);

          // Role toggle button (Admin can allot role to any user)
          const roleBtn = document.createElement('button');
          if (u.role === 'ADMIN') {
            roleBtn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md transition cursor-pointer shadow-2xs';
            roleBtn.innerHTML = `<i data-lucide="user-minus" class="w-3 h-3 text-slate-500"></i><span>Make Employee</span>`;
            roleBtn.title = 'Remove Super Admin rights from this user';
            roleBtn.addEventListener('click', () => changeUserRole(u.id, 'EMPLOYEE'));
          } else {
            roleBtn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded-md transition cursor-pointer shadow-2xs';
            roleBtn.innerHTML = `<i data-lucide="shield-check" class="w-3 h-3 text-amber-600"></i><span>Make Admin</span>`;
            roleBtn.title = 'Promote user to Super Admin';
            roleBtn.addEventListener('click', () => changeUserRole(u.id, 'ADMIN'));
          }
          actionWrap.appendChild(roleBtn);

          // Active toggle button
          const btn = document.createElement('button');
          btn.className = u.active
            ? 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-md transition cursor-pointer shadow-2xs'
            : 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition cursor-pointer shadow-2xs';
          btn.innerHTML = `<i data-lucide="${u.active ? 'user-x' : 'user-check'}" class="w-3 h-3"></i><span>${u.active ? 'Deactivate' : 'Activate'}</span>`;
          btn.addEventListener('click', () => toggleUser(u.id));
          actionWrap.appendChild(btn);

          // Permanently Remove Employee from database
          const delBtn = document.createElement('button');
          delBtn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-600 hover:text-white rounded-md transition cursor-pointer shadow-2xs';
          delBtn.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3"></i><span>Remove</span>`;
          delBtn.title = 'Permanently delete this employee from the database';
          delBtn.addEventListener('click', () => deleteUserFromDb(u.id, u.fullName, u.email));
          actionWrap.appendChild(delBtn);

          actionTd.appendChild(actionWrap);
        } else {
          const selfWrap = document.createElement('div');
          selfWrap.className = 'inline-flex items-center gap-1.5 justify-end';

          const editSelfBtn = document.createElement('button');
          editSelfBtn.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-600 hover:text-white rounded-md transition cursor-pointer shadow-2xs';
          editSelfBtn.innerHTML = `<i data-lucide="pencil" class="w-3 h-3"></i><span>Edit</span>`;
          editSelfBtn.title = 'Edit your profile details or password';
          editSelfBtn.addEventListener('click', () => openEditEmployeeModal(u));
          selfWrap.appendChild(editSelfBtn);

          const selfBadge = document.createElement('span');
          selfBadge.className = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wider ml-1';
          selfBadge.textContent = '(You)';
          selfWrap.appendChild(selfBadge);

          actionTd.appendChild(selfWrap);
        }
        tbody.appendChild(tr);
      });
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function openEditEmployeeModal(user) {
    const modalEditEmp = document.getElementById('modal-edit-employee');
    if (!modalEditEmp || !user) return;
    const errEl = document.getElementById('admin-edit-error');
    if (errEl) errEl.textContent = '';

    document.getElementById('edit-emp-id').value = user.id || '';
    document.getElementById('edit-emp-name').value = user.fullName || '';
    document.getElementById('edit-emp-email').value = user.email || '';
    document.getElementById('edit-emp-dept').value = user.department || '';
    document.getElementById('edit-emp-designation').value = user.designation || '';
    document.getElementById('edit-emp-role').value = user.role || 'EMPLOYEE';
    document.getElementById('edit-emp-status').value = user.active ? '1' : '0';
    document.getElementById('edit-emp-password').value = '';
    document.getElementById('edit-emp-must-change').checked = Boolean(user.mustChangePassword);

    const isSelf = currentUser && currentUser.id === user.id;
    const roleSelect = document.getElementById('edit-emp-role');
    const statusSelect = document.getElementById('edit-emp-status');
    if (roleSelect) roleSelect.disabled = isSelf;
    if (statusSelect) statusSelect.disabled = isSelf;

    modalEditEmp.classList.remove('hidden');
    modalEditEmp.classList.add('flex');
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
    document.getElementById('edit-emp-name')?.focus();
  }

  function closeEditEmployeeModal() {
    const modalEditEmp = document.getElementById('modal-edit-employee');
    if (!modalEditEmp) return;
    modalEditEmp.classList.add('hidden');
    modalEditEmp.classList.remove('flex');
  }

  async function changeUserRole(userId, newRole) {
    const confirmMsg = newRole === 'ADMIN'
      ? 'Promote this employee to Super Administrator? They will have full privileges to allot and cancel any meetings.'
      : 'Change this user role back to regular Employee?';
    if (!confirm(confirmMsg)) return;

    try {
      const data = await api(`/admin/users/${userId}/role`, {
        method: 'POST',
        body: { role: newRole },
      });
      showToast(data.message || `Role updated to ${newRole}.`, 'success');
      refreshAdminUsers();
      refreshAdminSummary();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleUser(userId) {
    try {
      const data = await api(`/admin/users/${userId}/toggle`, { method: 'POST' });
      showToast(data.message, 'success');
      refreshAdminUsers();
      refreshAdminSummary();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteUserFromDb(userId, fullName, email) {
    const confirmed = confirm(
      `⚠️ PERMANENT DATABASE DELETION\n\nAre you sure you want to permanently delete employee:\n"${fullName}" (${email})?\n\nThis will completely remove this employee and all their room bookings from the database. This action CANNOT be undone.`
    );
    if (!confirmed) return;

    try {
      const data = await api(`/admin/users/${userId}`, { method: 'DELETE' });
      showToast(data.message || 'Employee removed from database.', 'success');
      refreshAdminUsers();
      refreshAdminSummary();
      refreshAdminBookings();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =================================================================
  // Shared helpers
  // =================================================================
  async function logout() {
    try { await api('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    currentUser = null;
    employeeInitialized = false;
    adminInitialized = false;
    try {
      localStorage.removeItem('algorisys_user_role');
      localStorage.removeItem('algorisys_active_console');
      localStorage.removeItem('algorisys_active_panel');
      localStorage.removeItem('algorisys_user_info');
      sessionStorage.removeItem('algorisys_user_role');
      sessionStorage.removeItem('algorisys_active_console');
      sessionStorage.removeItem('algorisys_active_panel');
      sessionStorage.removeItem('algorisys_user_info');
      document.documentElement.classList.remove('has-session', 'preload-employee', 'preload-admin');
      document.documentElement.removeAttribute('data-preload-panel');
    } catch (e) {}
    window.location.hash = '';
    window.location.reload();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoString;
    }
  }

  // ---------------------------------------------------------------
  // PWA: register service worker (silently ignored if unsupported)
  // ---------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  boot();
})();
