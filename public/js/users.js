document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const currentUser = App.requireAuth(["admin"]);
  if (!currentUser) return;
  App.buildNavbar();

  const form = document.getElementById("create-user-form");
  const tbody = document.getElementById("users-body");
  const messageEl = document.getElementById("message");
  const createUserBtn = document.getElementById("create-user-btn");

  async function loadUsers() {
    try {
      const users = await App.apiFetch("/api/users");
      if (!users.length) {
        tbody.innerHTML = App.renderEmptyState(
          6,
          App.t("empty.usersTitle"),
          App.t("empty.usersDescription")
        );
        return;
      }
      tbody.innerHTML = users
        .map((user) => {
          const roleLabel = App.t(`role.${user.role}`);
          return `
            <tr data-role="${App.escapeHtml(user.role)}">
              <td>${user.id}</td>
              <td>${App.escapeHtml(user.ad)} ${App.escapeHtml(user.soyad)}</td>
              <td>${App.escapeHtml(user.username)}</td>
              <td><span class="role-chip">${App.escapeHtml(roleLabel)}</span></td>
              <td>${App.escapeHtml(user.demo_password || "-")}</td>
              <td>
                <div class="table-actions">
                  <button type="button" class="secondary" data-edit-id="${user.id}">${App.escapeHtml(
                    App.t("users.edit")
                  )}</button>
                  <button type="button" class="danger" data-delete-id="${user.id}">${App.escapeHtml(
                    App.t("users.remove")
                  )}</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.clearFieldErrors(form);
    App.showMessage(messageEl, "", "");

    const payload = {
      ad: String(form.ad.value || "").trim(),
      soyad: String(form.soyad.value || "").trim(),
      username: String(form.username.value || "").trim(),
      password: String(form.password.value || ""),
      password_repeat: String(form.password_repeat.value || ""),
      role: String(form.role.value || "user"),
    };

    if (!payload.password) {
      App.showFieldError(form, "password", App.t("validation.passwordRequired"));
      return;
    }
    if (!payload.password_repeat) {
      App.showFieldError(form, "password_repeat", App.t("validation.passwordRepeatRequired"));
      return;
    }
    if (payload.password !== payload.password_repeat) {
      const msg = App.t("validation.passwordMismatch");
      App.showFieldError(form, "password_repeat", msg);
      App.showMessage(messageEl, msg, "error");
      App.toast(msg, "error");
      return;
    }

    try {
      App.setButtonLoading(createUserBtn, true, App.t("users.addLoading"));
      const result = await App.apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      App.showMessage(messageEl, result.message, "success");
      App.toast(result.message, "success");
      form.reset();
      form.role.value = "user";
      await loadUsers();
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(createUserBtn, false);
    }
  });

  tbody.addEventListener("click", async (event) => {
    const editButton = event.target.closest("button[data-edit-id]");
    const deleteButton = event.target.closest("button[data-delete-id]");

    if (editButton) {
      const id = Number(editButton.getAttribute("data-edit-id"));
      const row = editButton.closest("tr");
      if (!row) return;

      const nameParts = row.children[1].textContent.trim().split(" ");
      const adDefault = nameParts[0] || "";
      const soyadDefault = nameParts.slice(1).join(" ") || "";
      const usernameDefault = row.children[2].textContent.trim();
      const roleDefault = row.getAttribute("data-role") || "user";

      const values = await App.promptForm({
        title: App.t("users.editModalTitle"),
        description: App.t("users.editModalDesc"),
        submitText: App.t("users.editModalSave"),
        fields: [
          { name: "ad", label: App.t("users.firstName"), value: adDefault, required: true },
          { name: "soyad", label: App.t("users.lastName"), value: soyadDefault, required: true },
          {
            name: "username",
            label: App.t("users.username"),
            value: usernameDefault,
            required: true,
          },
          {
            name: "role",
            label: App.t("users.role"),
            type: "select",
            value: roleDefault,
            required: true,
            options: [
              { value: "user", label: App.t("role.user") },
              { value: "admin", label: App.t("role.admin") },
              { value: "manager", label: App.t("role.manager") },
            ],
          },
          {
            name: "password",
            label: App.t("users.password"),
            type: "password",
            placeholder: App.t("users.passwordOptional"),
          },
          {
            name: "password_repeat",
            label: App.t("users.passwordRepeat"),
            type: "password",
            placeholder: App.t("users.passwordRepeatOptional"),
          },
        ],
      });
      if (!values) return;

      const payload = {
        ad: values.ad,
        soyad: values.soyad,
        username: values.username,
        role: values.role,
      };
      if (values.password) {
        payload.password = values.password;
        payload.password_repeat = values.password_repeat;
        if (!payload.password_repeat) {
          const msg = App.t("validation.passwordRepeatRequired");
          App.showMessage(messageEl, msg, "error");
          App.toast(msg, "error");
          return;
        }
        if (payload.password !== payload.password_repeat) {
          const msg = App.t("validation.passwordMismatch");
          App.showMessage(messageEl, msg, "error");
          App.toast(msg, "error");
          return;
        }
      }

      try {
        const result = await App.apiFetch(`/api/users/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        App.showMessage(messageEl, result.message, "success");
        App.toast(result.message, "success");
        await loadUsers();
      } catch (error) {
        App.showMessage(messageEl, error.message, "error");
        App.toast(error.message, "error");
      }
    }

    if (deleteButton) {
      const id = Number(deleteButton.getAttribute("data-delete-id"));
      const ok = await App.confirmDialog(
        App.t("users.deleteModalTitle"),
        App.t("users.deleteModalMessage"),
        App.t("users.deleteModalConfirm"),
        App.t("users.deleteModalCancel")
      );
      if (!ok) return;

      try {
        const result = await App.apiFetch(`/api/users/${id}`, {
          method: "DELETE",
        });
        App.showMessage(messageEl, result.message, "success");
        App.toast(result.message, "success");
        await loadUsers();
      } catch (error) {
        App.showMessage(messageEl, error.message, "error");
        App.toast(error.message, "error");
      }
    }
  });

  loadUsers();
});
