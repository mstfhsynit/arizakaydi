document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const user = App.requireAuth(["admin", "manager"]);
  if (!user) return;
  App.buildNavbar();

  const isAdmin = user.role === "admin";
  const messageEl = document.getElementById("message");
  const tbody = document.getElementById("requests-body");
  const filterForm = document.getElementById("filter-form");
  const reloadBtn = document.getElementById("reload-btn");
  const deleteResolvedBtn = document.getElementById("delete-resolved-btn");

  const filters = {
    blok: document.getElementById("f-blok"),
    kategori: document.getElementById("f-kategori"),
    durum: document.getElementById("f-durum"),
    aciliyet: document.getElementById("f-aciliyet"),
  };

  let options = null;

  function mapFilterLabel(field, value) {
    if (field === "kategori") return App.translateLookup("category", value);
    if (field === "durum") return App.translateLookup("status", value);
    if (field === "aciliyet") return App.translateLookup("urgency", value);
    return value;
  }

  function fillFilter(select, list, field) {
    const allLabel = App.t("adminPanel.allOption");
    const defaultOption = `<option value="">${App.escapeHtml(allLabel)}</option>`;
    const optionsHtml = list
      .map((item) => {
        const label = mapFilterLabel(field, item);
        return `<option value="${App.escapeHtml(item)}">${App.escapeHtml(label)}</option>`;
      })
      .join("");
    select.innerHTML = defaultOption + optionsHtml;
  }

  function currentQuery() {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, select]) => {
      const value = String(select.value || "").trim();
      if (value) query.append(key, value);
    });
    const queryString = query.toString();
    return queryString ? `?${queryString}` : "";
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = App.renderEmptyState(
        10,
        App.t("empty.defaultTitle"),
        App.t("empty.adminRequestsDescription")
      );
      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const urgentClass = row.aciliyet === "Acil" ? "urgent-row" : "";
        const detailAction = `<a href="/request-detail?id=${row.id}" class="btn btn-secondary">Detay</a>`;
        const statusAction = isAdmin
          ? `
            <div class="table-actions">
              ${detailAction}
              <select data-status-select="${row.id}">
                ${options.durumlar
                  .map((status) => {
                    const selected = status === row.durum ? "selected" : "";
                    return `<option value="${status}" ${selected}>${App.escapeHtml(
                      App.translateLookup("status", status)
                    )}</option>`;
                  })
                  .join("")}
              </select>
              <button type="button" data-update-btn="${row.id}" class="secondary">${App.escapeHtml(
                App.t("adminPanel.update")
              )}</button>
            </div>
          `
          : `<div class="table-actions">${detailAction}<span class="small">${App.escapeHtml(
              App.t("adminPanel.readonly")
            )}</span></div>`;

        return `
          <tr class="${urgentClass}">
            <td>${row.id}</td>
            <td>${App.escapeHtml(
              row.acan_kisi || `${row.ad || ""} ${row.soyad || ""}`.trim() || "-"
            )}</td>
            <td>${App.escapeHtml(row.blok)}</td>
            <td>${App.escapeHtml(App.translateLookup("category", row.kategori))}</td>
            <td>${App.escapeHtml(App.translateLookup("subcategory", row.alt_kategori))}</td>
            <td>${App.urgencyBadge(row.aciliyet)}</td>
            <td>${App.statusBadge(row.durum)}</td>
            <td>${App.escapeHtml(row.aciklama || "-")}</td>
            <td>${App.formatDateTime(row.created_at)}</td>
            <td>${statusAction}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadRequests() {
    try {
      App.showMessage(messageEl, "", "");
      const rows = await App.apiFetch(`/api/requests${currentQuery()}`);
      renderRows(rows);
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    }
  }

  async function boot() {
    try {
      options = await App.apiFetch("/api/requests/options");
      fillFilter(filters.blok, options.bloklar, "blok");
      fillFilter(filters.kategori, options.kategoriler, "kategori");
      fillFilter(filters.durum, options.durumlar, "durum");
      fillFilter(filters.aciliyet, options.aciliyet, "aciliyet");
      await loadRequests();
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    }
  }

  reloadBtn.addEventListener("click", loadRequests);
  filterForm.addEventListener("change", () => {
    loadRequests();
  });

  deleteResolvedBtn.addEventListener("click", async () => {
    const confirmed = await App.confirmDialog(
      "Çözülenleri sil",
      "Tüm çözülen kayıtlar silinecek. Emin misiniz?",
      "Sil",
      "Vazgeç"
    );
    if (!confirmed) {
      return;
    }

    try {
      App.setButtonLoading(deleteResolvedBtn, true, "Siliniyor...");
      const result = await App.apiFetch("/api/requests/delete-resolved", {
        method: "DELETE",
      });
      App.showMessage(messageEl, result.message, "success");
      App.toast(result.message, "success");
      await loadRequests();
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(deleteResolvedBtn, false);
    }
  });

  tbody.addEventListener("click", async (event) => {
    if (!isAdmin) return;
    const button = event.target.closest("button[data-update-btn]");
    if (!button) return;

    const id = button.getAttribute("data-update-btn");
    const select = tbody.querySelector(`select[data-status-select="${id}"]`);
    if (!select) return;
    const durum = select.value;

    try {
      App.setButtonLoading(button, true, App.t("adminPanel.updateLoading"));
      const result = await App.apiFetch(`/api/requests/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ durum }),
      });
      App.showMessage(messageEl, result.message, "success");
      App.toast(result.message, "success");
      await loadRequests();
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(button, false);
    }
  });

  boot();
});
