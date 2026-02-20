document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const user = App.requireAuth(["user", "admin", "manager"]);
  if (!user) return;
  App.buildNavbar();

  const MAX_COMMENT_LENGTH = 1000;

  const messageEl = document.getElementById("message");
  const downloadBtn = document.getElementById("download-attachment-btn");
  const commentForm = document.getElementById("comment-form");
  const commentInput = document.getElementById("comment-input");
  const commentSubmitBtn = document.getElementById("comment-submit-btn");
  const commentsListEl = document.getElementById("comments-list");
  const commentsEmptyEl = document.getElementById("comments-empty");
  const historyListEl = document.getElementById("history-list");
  const historyEmptyEl = document.getElementById("history-empty");
  const statusHistoryListEl = document.getElementById("status-history-list");
  const statusHistoryEmptyEl = document.getElementById("status-history-empty");
  const resolutionRowEl = document.getElementById("detail-resolution-row");
  const resolutionLabelEl = document.getElementById("detail-resolution-label");
  const resolutionTimeEl = document.getElementById("detail-resolution-time");
  let tabButtons = Array.from(document.querySelectorAll(".detail-tab"));

  const sections = {
    details: document.getElementById("section-details"),
    comments: document.getElementById("section-comments"),
    history: document.getElementById("section-history"),
    statusHistory: document.getElementById("section-status-history"),
  };

  const fields = {
    id: document.getElementById("detail-id"),
    owner: document.getElementById("detail-owner"),
    blok: document.getElementById("detail-blok"),
    kategori: document.getElementById("detail-kategori"),
    altKategori: document.getElementById("detail-alt-kategori"),
    aciliyet: document.getElementById("detail-aciliyet"),
    durum: document.getElementById("detail-durum"),
    aciklama: document.getElementById("detail-aciklama"),
    tarih: document.getElementById("detail-tarih"),
    attachment: document.getElementById("detail-attachment"),
  };

  let requestId = null;
  let canComment = false;
  const canViewStatusHistory = user.role === "admin" || user.role === "manager";
  const canViewResolutionDuration = user.role === "admin" || user.role === "manager";

  function setText(el, value) {
    if (!el) return;
    el.textContent = value || "-";
  }

  function validateComment(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
      return { error: "Yorum alanı boş bırakılamaz.", value: "" };
    }
    if (value.length > MAX_COMMENT_LENGTH) {
      return { error: "Yorum en fazla 1000 karakter olabilir.", value: "" };
    }
    return { error: "", value };
  }

  function roleLabel(role) {
    return App.t(`role.${role}`, {}, role || "-");
  }

  function roleClass(role) {
    const value = String(role || "").toLowerCase();
    if (value === "admin") return "comment-role comment-role-admin";
    if (value === "manager") return "comment-role comment-role-manager";
    return "comment-role comment-role-user";
  }

  function actionLabel(action) {
    if (action === "created") return "Kayıt oluşturuldu";
    if (action === "status_changed") return "Durum güncellendi";
    if (action === "commented") return "Yorum eklendi";
    if (action === "file_uploaded") return "Dosya yüklendi";
    if (action === "closed") return "Kayıt kapatıldı";
    return action || "-";
  }

  function prepareStatusHistoryVisibility() {
    if (canViewStatusHistory) {
      return;
    }

    const statusHistoryTab = document.getElementById("status-history-tab");
    if (statusHistoryTab) {
      statusHistoryTab.remove();
    }

    if (sections.statusHistory) {
      sections.statusHistory.remove();
      sections.statusHistory = null;
    }

    tabButtons = Array.from(document.querySelectorAll(".detail-tab"));
  }

  function prepareResolutionDurationVisibility() {
    if (canViewResolutionDuration) {
      return;
    }

    if (resolutionRowEl) {
      resolutionRowEl.remove();
    }
  }

  function formatResolutionDuration(secondsInput) {
    const totalSeconds = Math.max(0, Math.floor(Number(secondsInput) || 0));
    const yearSeconds = 365 * 24 * 60 * 60;
    const monthSeconds = 30 * 24 * 60 * 60;
    const daySeconds = 24 * 60 * 60;
    const hourSeconds = 60 * 60;

    let remaining = totalSeconds;
    const years = Math.floor(remaining / yearSeconds);
    remaining -= years * yearSeconds;

    const months = Math.floor(remaining / monthSeconds);
    remaining -= months * monthSeconds;

    const days = Math.floor(remaining / daySeconds);
    remaining -= days * daySeconds;

    const hours = Math.floor(remaining / hourSeconds);
    remaining -= hours * hourSeconds;

    const minutes = Math.floor(remaining / 60);
    remaining -= minutes * 60;

    const parts = [];
    if (years > 0) parts.push(`${years} yıl`);
    if (months > 0) parts.push(`${months} ay`);
    if (days > 0) parts.push(`${days} gün`);
    if (hours > 0) parts.push(`${hours} saat`);
    if (minutes > 0) parts.push(`${minutes} dakika`);
    if (remaining > 0) parts.push(`${remaining} saniye`);

    if (!parts.length) {
      return "0 saniye";
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return `${parts[0]} ${parts[1]}`;
  }

  function activateTab(tabKey) {
    Object.entries(sections).forEach(([key, element]) => {
      if (!element) return;
      element.hidden = key !== tabKey;
    });

    tabButtons.forEach((button) => {
      const isActive = button.getAttribute("data-tab-target") === tabKey;
      button.classList.toggle("active", isActive);
    });
  }

  function renderComments(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      commentsListEl.innerHTML = "";
      commentsEmptyEl.hidden = false;
      return;
    }

    commentsEmptyEl.hidden = true;
    commentsListEl.innerHTML = rows
      .map((item) => {
        const fullName = `${item.ad || ""} ${item.soyad || ""}`.trim() || "-";
        const createdText = App.formatDateTime(item.created_at);
        const updatedText = App.formatDateTime(item.updated_at);
        const timeText =
          item.updated_at && item.updated_at !== item.created_at
            ? `${createdText} (güncellendi: ${updatedText})`
            : createdText;

        return `
          <article class="comment-item">
            <div class="comment-head">
              <div class="comment-user">
                <span>${App.escapeHtml(fullName)}</span>
                <span class="${roleClass(item.role)}">${App.escapeHtml(roleLabel(item.role))}</span>
              </div>
              <span class="comment-time">${App.escapeHtml(timeText)}</span>
            </div>
            <div class="comment-body">${App.escapeHtml(item.comment || "")}</div>
          </article>
        `;
      })
      .join("");
  }

  function renderHistory(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      historyListEl.innerHTML = "";
      historyEmptyEl.hidden = false;
      return;
    }

    historyEmptyEl.hidden = true;
    historyListEl.innerHTML = rows
      .map((item) => {
        const fullName = `${item.ad || ""} ${item.soyad || ""}`.trim() || "-";
        return `
          <article class="history-item">
            <div class="history-head">
              <span class="history-action">${App.escapeHtml(actionLabel(item.action))}</span>
              <span class="comment-time">${App.escapeHtml(App.formatDateTime(item.created_at))}</span>
            </div>
            <div class="history-meta">
              <span class="comment-user">${App.escapeHtml(fullName)}</span>
              <span class="${roleClass(item.role)}">${App.escapeHtml(roleLabel(item.role))}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderStatusHistory(rows) {
    if (!canViewStatusHistory || !statusHistoryListEl || !statusHistoryEmptyEl) {
      return;
    }

    if (!Array.isArray(rows) || !rows.length) {
      statusHistoryListEl.innerHTML = "";
      statusHistoryEmptyEl.hidden = false;
      return;
    }

    statusHistoryEmptyEl.hidden = true;
    statusHistoryListEl.innerHTML = rows
      .map((item) => {
        const fromStatus = item.old_status || "-";
        const toStatus = item.new_status || "-";
        const durationText = item.duration_text || "";

        return `
          <article class="status-history-item">
            <div class="status-history-transition">
              ${App.statusBadge(fromStatus)}
              <span class="status-history-arrow">→</span>
              ${App.statusBadge(toStatus)}
            </div>
            <div class="status-history-meta">
              <span class="comment-time">${App.escapeHtml(App.formatDateTime(item.changed_at))}</span>
              ${
                durationText
                  ? `<span class="status-history-duration">${App.escapeHtml(durationText)}</span>`
                  : `<span class="status-history-duration status-history-duration-muted">Devam ediyor</span>`
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderResolutionDuration(payload) {
    if (!canViewResolutionDuration || !resolutionTimeEl) {
      return;
    }

    if (resolutionLabelEl) {
      resolutionLabelEl.textContent = "Geçen Süre";
    }

    const durationText =
      payload && typeof payload.duration === "string" ? payload.duration.trim() : "";
    if (!durationText) {
      resolutionTimeEl.textContent = "Çözülene kadar hesaplanıyor";
      return;
    }

    resolutionTimeEl.textContent = durationText;
  }

  function parseFileName(contentDisposition, fallback) {
    const raw = String(contentDisposition || "");
    const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, ""));
    }
    const plainMatch = raw.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (plainMatch && plainMatch[1]) {
      return plainMatch[1].trim();
    }
    return fallback;
  }

  async function downloadAttachment(id) {
    const token = App.getToken();
    const response = await fetch(`/api/requests/${id}/attachment`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      let message = "Dosya indirilemedi.";
      try {
        const data = await response.json();
        if (data && data.message) {
          message = data.message;
        }
      } catch (error) {
        message = "Dosya indirilemedi.";
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const fallbackName = `request-${id}-attachment`;
    const fileName = parseFileName(response.headers.get("content-disposition"), fallbackName);
    const objectUrl = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.URL.revokeObjectURL(objectUrl);
  }

  async function loadComments() {
    const rows = await App.apiFetch(`/api/requests/${requestId}/comments`);
    renderComments(rows);
  }

  async function loadHistory() {
    const rows = await App.apiFetch(`/api/requests/${requestId}/history`);
    renderHistory(rows);
  }

  async function loadStatusHistory() {
    if (!canViewStatusHistory) return;
    const rows = await App.apiFetch(`/api/requests/${requestId}/status-history`);
    renderStatusHistory(rows);
  }

  async function loadResolutionDuration() {
    if (!canViewResolutionDuration) return;
    const payload = await App.apiFetch(`/api/requests/${requestId}/resolution-duration`);
    renderResolutionDuration(payload);
  }

  function renderDetail(row) {
    setText(fields.id, String(row.id || "-"));
    setText(fields.owner, row.acan_kisi || `${row.ad || ""} ${row.soyad || ""}`.trim() || "-");
    setText(fields.blok, row.blok || "-");
    setText(fields.kategori, App.translateLookup("category", row.kategori || "-"));
    setText(fields.altKategori, App.translateLookup("subcategory", row.alt_kategori || "-"));
    fields.aciliyet.innerHTML = App.urgencyBadge(row.aciliyet || "-");
    fields.durum.innerHTML = App.statusBadge(row.durum || "-");
    setText(fields.aciklama, row.aciklama || "-");
    setText(fields.tarih, App.formatDateTime(row.created_at));
    if (canViewResolutionDuration && resolutionTimeEl) {
      if (resolutionLabelEl) {
        resolutionLabelEl.textContent = "Geçen Süre";
      }
      resolutionTimeEl.textContent = "Yükleniyor...";
    }

    if (row.attachment_path) {
      setText(fields.attachment, "Var");
      downloadBtn.hidden = false;
    } else {
      setText(fields.attachment, "Yok");
      downloadBtn.hidden = true;
    }

    canComment = user.role === "admin" || (user.role === "user" && row.user_id === user.id);
    commentForm.hidden = !canComment;
  }

  function parseRequestId() {
    const raw = new URLSearchParams(window.location.search).get("id");
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  }

  prepareStatusHistoryVisibility();
  prepareResolutionDurationVisibility();

  requestId = parseRequestId();
  if (!requestId) {
    App.showMessage(messageEl, "Geçersiz kayıt id.", "error");
    App.toast("Geçersiz kayıt id.", "error");
    return;
  }

  try {
    const row = await App.apiFetch(`/api/requests/${requestId}`);
    renderDetail(row);
    const loadTasks = [loadComments(), loadHistory()];
    if (canViewStatusHistory) {
      loadTasks.push(loadStatusHistory());
    }
    if (canViewResolutionDuration) {
      loadTasks.push(loadResolutionDuration());
    }
    await Promise.all(loadTasks);
  } catch (error) {
    App.showMessage(messageEl, error.message, "error");
    App.toast(error.message, "error");
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabKey = button.getAttribute("data-tab-target");
      activateTab(tabKey);
    });
  });

  downloadBtn.addEventListener("click", async () => {
    if (!requestId) return;

    try {
      App.setButtonLoading(downloadBtn, true, "İndiriliyor...");
      await downloadAttachment(requestId);
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(downloadBtn, false);
    }
  });

  commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canComment) return;

    App.clearFieldErrors(commentForm);
    const { error, value } = validateComment(commentInput.value);
    if (error) {
      App.showFieldError(commentForm, "comment", error);
      App.showMessage(messageEl, error, "error");
      App.toast(error, "error");
      return;
    }

    try {
      App.setButtonLoading(commentSubmitBtn, true, "Kaydediliyor...");
      const result = await App.apiFetch(`/api/requests/${requestId}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: value }),
      });
      commentInput.value = "";
      App.showMessage(messageEl, result.message, "success");
      App.toast(result.message, "success");
      await Promise.all([loadComments(), loadHistory()]);
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(commentSubmitBtn, false);
    }
  });

  activateTab("details");
});

