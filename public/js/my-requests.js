document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const user = App.requireAuth(["user"]);
  if (!user) return;
  App.buildNavbar();

  const tbody = document.getElementById("requests-body");
  const messageEl = document.getElementById("message");
  const deleteResolvedBtn = document.getElementById("delete-resolved-btn");

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = App.renderEmptyState(
        9,
        App.t("empty.defaultTitle"),
        App.t("empty.myRequestsDescription")
      );
      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const urgentClass = row.aciliyet === "Acil" ? "urgent-row" : "";
        return `
          <tr class="${urgentClass}">
            <td>${row.id}</td>
            <td>${App.escapeHtml(row.blok)}</td>
            <td>${App.escapeHtml(App.translateLookup("category", row.kategori))}</td>
            <td>${App.escapeHtml(App.translateLookup("subcategory", row.alt_kategori))}</td>
            <td>${App.urgencyBadge(row.aciliyet)}</td>
            <td>${App.statusBadge(row.durum)}</td>
            <td>${App.escapeHtml(row.aciklama || "-")}</td>
            <td>${App.formatDateTime(row.created_at)}</td>
            <td>
              <a href="/request-detail?id=${row.id}" class="btn btn-secondary">Detay</a>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadRequests() {
    try {
      const rows = await App.apiFetch("/api/requests/my");
      renderRows(rows);
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    }
  }

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

  await loadRequests();
});
