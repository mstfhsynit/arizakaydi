(function initApp() {
  const STORAGE_TOKEN = "demo_token";
  const STORAGE_USER = "demo_user";
  const STORAGE_THEME = "theme";

  let liveClockInterval = null;
  let notificationPollInterval = null;
  let notificationDocClickHandler = null;
  let activeRequests = 0;
  let toastContainer = null;
  let loadingOverlay = null;
  let activeModal = null;
  let socketIoScriptPromise = null;
  let realtimeSocket = null;
  let realtimeSocketToken = "";
  let latestOnlinePayload = null;
  const onlineUserListeners = new Set();

  let localeData = {};
  let currentLocale = "tr";
  let localePromise = null;

  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN);
  }

  function getUser() {
    const raw = localStorage.getItem(STORAGE_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(STORAGE_TOKEN, token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(user));
  }

  function clearSession() {
    disconnectRealtimeSocket();
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    return path.split(".").reduce((acc, part) => {
      if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
        return acc[part];
      }
      return undefined;
    }, obj);
  }

  function applyTemplate(text, params = {}) {
    return String(text).replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : "";
    });
  }

  function t(key, params = {}, fallback = "") {
    const value = getByPath(localeData, key);
    if (typeof value === "string") {
      return applyTemplate(value, params);
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (value !== undefined) {
      return value;
    }
    if (fallback) {
      return applyTemplate(fallback, params);
    }
    return key;
  }

  function getI18n(key, fallback = null) {
    const value = getByPath(localeData, key);
    if (value === undefined) return fallback;
    return value;
  }

  function applyI18n(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const translated = t(key, {}, el.textContent || "");
      if (el.tagName.toLowerCase() === "title") {
        document.title = translated;
        return;
      }
      el.textContent = translated;
    });

    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.setAttribute("placeholder", t(key, {}, el.getAttribute("placeholder") || ""));
    });

    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      el.setAttribute("title", t(key, {}, el.getAttribute("title") || ""));
    });

    root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria-label");
      el.setAttribute("aria-label", t(key, {}, el.getAttribute("aria-label") || ""));
    });
  }

  async function loadLocale(locale = "tr") {
    currentLocale = locale;
    try {
      const response = await fetch(`/locales/${locale}.json`);
      if (!response.ok) {
        throw new Error("Dil dosyası alınamadı.");
      }
      localeData = await response.json();
    } catch (error) {
      localeData = {};
    }
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({
        attrs: {
          width: "16",
          height: "16",
          "stroke-width": "1.8",
        },
      });
    }
  }

  function ensureUiInfrastructure() {
    if (!toastContainer) {
      toastContainer = document.getElementById("toast-container");
      if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "toast-container";
        toastContainer.className = "toast-container";
        document.body.appendChild(toastContainer);
      }
    }

    if (!loadingOverlay) {
      loadingOverlay = document.getElementById("global-loading");
      if (!loadingOverlay) {
        loadingOverlay = document.createElement("div");
        loadingOverlay.id = "global-loading";
        loadingOverlay.className = "loading-overlay";
        loadingOverlay.innerHTML = `
          <div class="loading-box">
            <span class="spinner"></span>
            <span class="loading-text">${escapeHtml(t("loading.global"))}</span>
          </div>
        `;
        document.body.appendChild(loadingOverlay);
      }
    }
  }

  function setGlobalLoading(visible) {
    ensureUiInfrastructure();
    if (visible) {
      loadingOverlay.classList.add("visible");
    } else {
      loadingOverlay.classList.remove("visible");
    }
  }

  function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
      if (!button.dataset.defaultText) {
        button.dataset.defaultText = button.textContent;
      }
      button.disabled = true;
      button.textContent = loadingText || t("request.saveLoading");
      return;
    }
    button.disabled = false;
    if (button.dataset.defaultText) {
      button.textContent = button.dataset.defaultText;
    }
  }

  function toast(message, type = "info") {
    if (!message) return;
    ensureUiInfrastructure();

    const toastEl = document.createElement("div");
    toastEl.className = `toast toast-${type}`;
    toastEl.textContent = message;
    toastContainer.appendChild(toastEl);

    setTimeout(() => {
      toastEl.classList.add("toast-out");
    }, 2600);

    setTimeout(() => {
      toastEl.remove();
    }, 3000);
  }

  function showMessage(selectorOrNode, text, type) {
    const el =
      typeof selectorOrNode === "string"
        ? document.querySelector(selectorOrNode)
        : selectorOrNode;
    if (!el) return;
    el.textContent = text || "";
    el.className = `message ${type || ""}`.trim();
    if (!text) el.className = "message";
  }

  function clearFieldErrors(formEl) {
    if (!formEl) return;
    formEl.querySelectorAll("[data-error-for]").forEach((el) => {
      el.textContent = "";
    });
  }

  function showFieldError(formEl, fieldName, message) {
    if (!formEl) return;
    const target = formEl.querySelector(`[data-error-for="${fieldName}"]`);
    if (target) {
      target.textContent = message || "";
    }
  }

  function normalizeForClass(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  function translateLookup(group, value) {
    return t(`${group}.${value}`, {}, value || "-");
  }

  function statusBadge(status) {
    const normalized = normalizeForClass(status);
    const label = translateLookup("status", status);
    return `<span class="badge badge-status-${normalized}">${escapeHtml(label)}</span>`;
  }

  function urgencyBadge(urgency) {
    const normalized = normalizeForClass(urgency);
    const label = translateLookup("urgency", urgency);
    return `<span class="badge badge-urgency-${normalized}">${escapeHtml(label)}</span>`;
  }

  function renderEmptyState(colspan, title, description) {
    const emptyTitle = title || t("empty.defaultTitle");
    const emptyDescription = description || t("empty.defaultDescription");
    return `
      <tr>
        <td colspan="${colspan}">
          <div class="empty-state">
            <div class="empty-icon"></div>
            <p class="empty-title">${escapeHtml(emptyTitle)}</p>
            <p class="empty-description">${escapeHtml(emptyDescription)}</p>
          </div>
        </td>
      </tr>
    `;
  }

  async function apiFetchSilent(url, options = {}) {
    const token = getToken();
    const headers = Object.assign({}, options.headers || {});
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;
    if (!headers["Content-Type"] && options.body && !isFormData) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, Object.assign({}, options, { headers }));
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (response.status === 401) {
      clearSession();
      if (location.pathname !== "/login") {
        location.href = "/login";
      }
    }

    if (!response.ok) {
      throw new Error((data && data.message) || t("messages.operationFailed"));
    }

    return data;
  }

  function notificationRoleClassByMessage(message) {
    const text = String(message || "").toLowerCase();
    if (text.includes("durum")) return "notification-type-status";
    if (text.includes("yorum")) return "notification-type-comment";
    return "notification-type-ticket";
  }

  function updateNotificationBadge(unreadCount) {
    const badge = document.getElementById("notification-badge");
    if (!badge) return;

    const count = Number(unreadCount) || 0;
    if (count <= 0) {
      badge.hidden = true;
      badge.textContent = "0";
      return;
    }

    badge.hidden = false;
    badge.textContent = count > 99 ? "99+" : String(count);
  }

  function setNotificationDropdownOpen(isOpen) {
    const dropdown = document.getElementById("notification-dropdown");
    if (!dropdown) return;
    dropdown.hidden = !isOpen;
  }

  function renderNotifications(rows) {
    const listEl = document.getElementById("notification-list");
    const emptyEl = document.getElementById("notification-empty");
    if (!listEl || !emptyEl) return;

    if (!Array.isArray(rows) || !rows.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = rows
      .map((item) => {
        const unreadClass = Number(item.is_read) === 0 ? "notification-item-unread" : "";
        const typeClass = notificationRoleClassByMessage(item.message);
        return `
          <article class="notification-item ${unreadClass}">
            <div class="notification-dot ${typeClass}"></div>
            <div class="notification-body">
              <p class="notification-message">${escapeHtml(item.message || "-")}</p>
              <p class="notification-time">${escapeHtml(formatDateTime(item.created_at))}</p>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function loadNotificationCount() {
    const data = await apiFetchSilent("/api/notifications/unread-count");
    updateNotificationBadge(data && data.unreadCount);
    return Number(data && data.unreadCount) || 0;
  }

  async function loadNotificationList() {
    const rows = await apiFetchSilent("/api/notifications?limit=20");
    renderNotifications(rows);
    return rows;
  }

  async function markNotificationsReadAll() {
    await apiFetchSilent("/api/notifications/read-all", { method: "PATCH" });
  }

  async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = Object.assign({}, options.headers || {});
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;
    if (!headers["Content-Type"] && options.body && !isFormData) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    activeRequests += 1;
    setGlobalLoading(true);
    try {
      const response = await fetch(url, Object.assign({}, options, { headers }));
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }

      if (response.status === 401) {
        clearSession();
        if (location.pathname !== "/login") {
          location.href = "/login";
        }
      }

      if (!response.ok) {
        throw new Error((data && data.message) || t("messages.operationFailed"));
      }

      return data;
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
      if (!activeRequests) {
        setGlobalLoading(false);
      }
    }
  }

  function notifyOnlineUserListeners(eventName, payload) {
    latestOnlinePayload = {
      eventName,
      payload,
    };

    onlineUserListeners.forEach((listener) => {
      try {
        listener(eventName, payload);
      } catch (error) {
      }
    });
  }

  function disconnectRealtimeSocket() {
    if (realtimeSocket) {
      realtimeSocket.off("user_connected");
      realtimeSocket.off("user_disconnected");
      realtimeSocket.disconnect();
    }
    realtimeSocket = null;
    realtimeSocketToken = "";
    latestOnlinePayload = null;
  }

  function getOnlineUsersSnapshot() {
    return latestOnlinePayload ? latestOnlinePayload.payload : null;
  }

  function subscribeOnlineUsers(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    onlineUserListeners.add(listener);
    if (latestOnlinePayload) {
      listener(latestOnlinePayload.eventName, latestOnlinePayload.payload);
    }

    return () => {
      onlineUserListeners.delete(listener);
    };
  }

  function loadSocketIoClient() {
    if (window.io && typeof window.io === "function") {
      return Promise.resolve(window.io);
    }

    if (socketIoScriptPromise) {
      return socketIoScriptPromise;
    }

    socketIoScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/socket.io/socket.io.js";
      script.async = true;
      script.onload = () => {
        if (window.io && typeof window.io === "function") {
          resolve(window.io);
          return;
        }
        socketIoScriptPromise = null;
        reject(new Error("Canlı bağlantı istemcisi yüklenemedi."));
      };
      script.onerror = () => {
        socketIoScriptPromise = null;
        reject(new Error("Canlı bağlantı istemcisi yüklenemedi."));
      };

      document.head.appendChild(script);
    });

    return socketIoScriptPromise;
  }

  async function ensureRealtimeSocket() {
    if (location.pathname === "/login") {
      return null;
    }

    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      disconnectRealtimeSocket();
      return null;
    }

    if (realtimeSocket && realtimeSocket.connected && realtimeSocketToken === token) {
      return realtimeSocket;
    }

    const ioFactory = await loadSocketIoClient();

    if (realtimeSocket && realtimeSocketToken !== token) {
      disconnectRealtimeSocket();
    }

    if (!realtimeSocket) {
      realtimeSocket = ioFactory({
        auth: { token },
      });
      realtimeSocketToken = token;

      realtimeSocket.on("user_connected", (payload) => {
        notifyOnlineUserListeners("user_connected", payload);
      });

      realtimeSocket.on("user_disconnected", (payload) => {
        notifyOnlineUserListeners("user_disconnected", payload);
      });

      realtimeSocket.on("connect_error", () => {
      });
    }

    return realtimeSocket;
  }

  function requireAuth(allowedRoles = []) {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      location.href = "/login";
      return null;
    }
    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      location.href = "/dashboard";
      return null;
    }
    return user;
  }

  function closeActiveModal(result, resolver) {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  function confirmDialog(title, message, confirmText, cancelText) {
    const finalTitle = title || t("modal.confirmTitle");
    const finalConfirm = confirmText || t("modal.confirmText");
    const finalCancel = cancelText || t("modal.cancelText");

    return new Promise((resolve) => {
      if (activeModal) {
        activeModal.remove();
        activeModal = null;
      }

      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal-card">
          <h3 class="modal-title">${escapeHtml(finalTitle)}</h3>
          <p class="lead-text">${escapeHtml(message || "")}</p>
          <div class="modal-actions">
            <button type="button" class="secondary" data-modal-cancel>${escapeHtml(finalCancel)}</button>
            <button type="button" data-modal-confirm>${escapeHtml(finalConfirm)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      activeModal = overlay;

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          closeActiveModal(false, resolve);
        }
      });

      overlay.querySelector("[data-modal-cancel]").addEventListener("click", () => {
        closeActiveModal(false, resolve);
      });

      overlay.querySelector("[data-modal-confirm]").addEventListener("click", () => {
        closeActiveModal(true, resolve);
      });
    });
  }

  function promptForm(config = {}) {
    const {
      title = t("modal.formTitle"),
      description = "",
      submitText = t("modal.save"),
      cancelText = t("modal.cancelText"),
      fields = [],
    } = config;

    return new Promise((resolve) => {
      if (activeModal) {
        activeModal.remove();
        activeModal = null;
      }

      const fieldsHtml = fields
        .map((field) => {
          const type = field.type || "text";
          const required = field.required ? "required" : "";
          const safeName = escapeHtml(field.name || "");
          const safeLabel = escapeHtml(field.label || field.name || "Alan");
          const safePlaceholder = escapeHtml(field.placeholder || "");
          const safeValue = escapeHtml(field.value || "");
          const requiredMark = field.required ? ' <span class="required">*</span>' : "";

          if (type === "select") {
            const options = Array.isArray(field.options) ? field.options : [];
            const optionsHtml = options
              .map((option) => {
                const optionValue = escapeHtml(option.value);
                const optionLabel = escapeHtml(option.label || option.value);
                const selected = String(option.value) === String(field.value) ? "selected" : "";
                return `<option value="${optionValue}" ${selected}>${optionLabel}</option>`;
              })
              .join("");

            return `
              <label>
                ${safeLabel}${requiredMark}
                <select name="${safeName}" ${required}>${optionsHtml}</select>
              </label>
              <small class="field-error" data-modal-error="${safeName}"></small>
            `;
          }

          return `
            <label>
              ${safeLabel}${requiredMark}
              <input type="${escapeHtml(type)}" name="${safeName}" value="${safeValue}" placeholder="${safePlaceholder}" ${required} />
            </label>
            <small class="field-error" data-modal-error="${safeName}"></small>
          `;
        })
        .join("");

      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal-card">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          ${description ? `<p class="lead-text">${escapeHtml(description)}</p>` : ""}
          <form data-modal-form>
            ${fieldsHtml}
            <div class="modal-actions">
              <button type="button" class="secondary" data-modal-cancel>${escapeHtml(cancelText)}</button>
              <button type="submit" data-modal-submit>${escapeHtml(submitText)}</button>
            </div>
          </form>
        </div>
      `;

      document.body.appendChild(overlay);
      activeModal = overlay;

      const form = overlay.querySelector("[data-modal-form]");
      const firstInput = form.querySelector("input, select, textarea");
      if (firstInput) {
        firstInput.focus();
      }

      function clearErrors() {
        form.querySelectorAll("[data-modal-error]").forEach((el) => {
          el.textContent = "";
        });
      }

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          closeActiveModal(null, resolve);
        }
      });

      form.querySelector("[data-modal-cancel]").addEventListener("click", () => {
        closeActiveModal(null, resolve);
      });

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        clearErrors();

        const values = {};
        let hasError = false;

        fields.forEach((field) => {
          const fieldInput = form.elements[field.name];
          const rawValue = fieldInput ? fieldInput.value : "";
          const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
          values[field.name] = value;

          if (field.required && !value) {
            const errorTarget = form.querySelector(`[data-modal-error="${field.name}"]`);
            if (errorTarget) {
              errorTarget.textContent = t("validation.fieldRequired", {
                field: field.label || field.name,
              });
            }
            hasError = true;
          }
        });

        if (hasError) return;
        closeActiveModal(values, resolve);
      });
    });
  }

  async function changePassword() {
    const values = await promptForm({
      title: t("modal.passwordTitle"),
      description: t("modal.passwordDesc"),
      submitText: t("modal.passwordSave"),
      fields: [
        {
          name: "currentPassword",
          label: t("modal.passwordCurrent"),
          type: "password",
          required: true,
        },
        {
          name: "newPassword",
          label: t("modal.passwordNew"),
          type: "password",
          required: true,
        },
        {
          name: "newPasswordRepeat",
          label: t("modal.passwordRepeat"),
          type: "password",
          required: true,
        },
      ],
    });
    if (!values) return;

    if (values.newPassword.length < 4) {
      toast(t("validation.passwordMin"), "error");
      return;
    }
    if (values.newPassword !== values.newPasswordRepeat) {
      toast(t("validation.passwordMismatch"), "error");
      return;
    }

    try {
      const result = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          newPasswordRepeat: values.newPasswordRepeat,
        }),
      });
      toast(result.message || t("messages.passwordChanged"), "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function formatDateTime(value) {
    if (!value) return "-";
    let date = null;

    if (typeof value === "string" && value.includes(" ")) {
      date = new Date(`${value.replace(" ", "T")}Z`);
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString("tr-TR");
  }

  function getTheme() {
    return localStorage.getItem(STORAGE_THEME) === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    const finalTheme = theme === "dark" ? "dark" : "light";
    document.body.classList.toggle("dark", finalTheme === "dark");
    localStorage.setItem(STORAGE_THEME, finalTheme);
    updateThemeButton();
  }

  function toggleTheme() {
    const next = getTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  function updateThemeButton() {
    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;

    const theme = getTheme();
    btn.setAttribute("data-theme", theme);
    btn.setAttribute(
      "title",
      theme === "dark" ? t("theme.light") : t("theme.dark")
    );
    btn.innerHTML =
      theme === "dark"
        ? `<i data-lucide="sun"></i><span class="sr-only">${escapeHtml(t("theme.light"))}</span>`
        : `<i data-lucide="moon"></i><span class="sr-only">${escapeHtml(t("theme.dark"))}</span>`;
    refreshIcons();
  }

  function buildSidebarLinks(user) {
    const links = [{ href: "/dashboard", key: "nav.dashboard", icon: "layout-dashboard" }];
    if (user.role === "user" || user.role === "manager") {
      links.push({
        href: "/create-request",
        key: "nav.createRequest",
        icon: "plus-square",
      });
    }
    if (user.role === "user") {
      links.push({ href: "/my-requests", key: "nav.myRequests", icon: "clipboard-list" });
    }
    if (user.role === "admin" || user.role === "manager") {
      links.push({ href: "/admin-panel", key: "nav.allRequests", icon: "table-properties" });
    }
    if (user.role === "admin") {
      links.push({ href: "/users", key: "nav.users", icon: "users" });
    }
    return links;
  }

  function buildNavbar() {
    ensureUiInfrastructure();
    const user = getUser();
    if (!user) return;

    const sidebarRoot = document.getElementById("sidebar") || document.getElementById("navbar");
    const topbarRoot = document.getElementById("topbar");
    const links = buildSidebarLinks(user);

    if (sidebarRoot) {
      const renderedLinks = links
        .map((link) => {
          const active = location.pathname === link.href ? "active" : "";
          return `
            <a href="${link.href}" class="side-link ${active}">
              <i data-lucide="${link.icon}" class="nav-link-icon"></i>
              <span>${escapeHtml(t(link.key))}</span>
            </a>
          `;
        })
        .join("");

      sidebarRoot.innerHTML = `
        <div class="sidebar-brand">
          <p class="brand-kicker">${escapeHtml(t("app.brandKicker"))}</p>
          <h2>${escapeHtml(t("app.brandTitle"))}</h2>
        </div>
        <nav class="side-nav">${renderedLinks}</nav>
      `;
    }

    if (topbarRoot) {
      topbarRoot.innerHTML = `
        <h3 class="topbar-title">${escapeHtml(t("app.topbarTitle"))}</h3>
        <div class="topbar-actions">
          <span class="small" id="live-clock"></span>
          <span class="small user-meta">${escapeHtml(user.ad)} ${escapeHtml(user.soyad)}</span>
          <span class="role-chip">${escapeHtml(t(`role.${user.role}`))}</span>
          <div class="notification-wrap">
            <button type="button" id="notification-btn" class="secondary icon-btn notification-btn" title="Bildirimler">
              <i data-lucide="bell"></i>
              <span id="notification-badge" class="notification-badge" hidden>0</span>
            </button>
            <div id="notification-dropdown" class="notification-dropdown" hidden>
              <div class="notification-header">Bildirimler</div>
              <div id="notification-empty" class="small" hidden>Bildirim bulunmuyor.</div>
              <div id="notification-list" class="notification-list"></div>
            </div>
          </div>
          <button type="button" id="theme-toggle-btn" class="secondary icon-btn" data-i18n-title="app.themeToggleTitle"></button>
          <button type="button" id="change-password-btn" class="secondary">${escapeHtml(t("nav.changePassword"))}</button>
          <button type="button" id="logout-btn">${escapeHtml(t("nav.logout"))}</button>
        </div>
      `;
    }

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await apiFetchSilent("/api/auth/logout", { method: "POST" });
        } catch (error) {
        }
        clearSession();
        location.href = "/login";
      });
    }

    const changePasswordBtn = document.getElementById("change-password-btn");
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener("click", changePassword);
    }

    const themeToggleBtn = document.getElementById("theme-toggle-btn");
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener("click", toggleTheme);
    }

    const notificationBtn = document.getElementById("notification-btn");
    const notificationWrap = document.querySelector(".notification-wrap");
    if (notificationBtn && notificationWrap) {
      loadNotificationCount().catch(() => {});

      notificationBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const dropdown = document.getElementById("notification-dropdown");
        const shouldOpen = dropdown ? dropdown.hidden : false;
        setNotificationDropdownOpen(shouldOpen);

        if (!shouldOpen) return;

        try {
          const [rows, unreadCount] = await Promise.all([
            loadNotificationList(),
            loadNotificationCount(),
          ]);

          if (unreadCount > 0) {
            await markNotificationsReadAll();
            const markedRows = Array.isArray(rows)
              ? rows.map((row) => Object.assign({}, row, { is_read: 1 }))
              : [];
            renderNotifications(markedRows);
            updateNotificationBadge(0);
          }
        } catch (error) {
          toast(error.message, "error");
        }
      });

      if (notificationDocClickHandler) {
        document.removeEventListener("click", notificationDocClickHandler);
      }

      notificationDocClickHandler = (event) => {
        if (!notificationWrap.contains(event.target)) {
          setNotificationDropdownOpen(false);
        }
      };
      document.addEventListener("click", notificationDocClickHandler);
    }

    if (notificationPollInterval) {
      clearInterval(notificationPollInterval);
    }
    notificationPollInterval = setInterval(() => {
      loadNotificationCount().catch(() => {});
    }, 30000);

    ensureRealtimeSocket().catch(() => {});

    const clockEl = document.getElementById("live-clock");
    if (clockEl) {
      const renderClock = () => {
        clockEl.textContent = `${t("app.clockPrefix")}: ${new Date().toLocaleString("tr-TR")}`;
      };
      renderClock();
      if (liveClockInterval) {
        clearInterval(liveClockInterval);
      }
      liveClockInterval = setInterval(renderClock, 1000);
    }

    applyI18n(document);
    updateThemeButton();
    refreshIcons();
  }

  async function ready() {
    if (!localePromise) {
      localePromise = loadLocale("tr");
    }
    await localePromise;
    ensureUiInfrastructure();
    const loadingText = document.querySelector(".loading-text");
    if (loadingText) {
      loadingText.textContent = t("loading.global");
    }
    applyI18n(document);
    refreshIcons();
  }

  applyTheme(getTheme());

  window.App = {
    getToken,
    getUser,
    setSession,
    clearSession,
    escapeHtml,
    t,
    getI18n,
    applyI18n,
    translateLookup,
    showMessage,
    clearFieldErrors,
    showFieldError,
    toast,
    apiFetch,
    requireAuth,
    buildNavbar,
    formatDateTime,
    statusBadge,
    urgencyBadge,
    renderEmptyState,
    setButtonLoading,
    confirmDialog,
    promptForm,
    refreshIcons,
    ready,
    applyTheme,
    toggleTheme,
    getTheme,
    subscribeOnlineUsers,
    getOnlineUsersSnapshot,
    ensureRealtimeSocket,
  };
})();

