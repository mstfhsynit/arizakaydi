document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const existingToken = App.getToken();
  const existingUser = App.getUser();
  if (existingToken && existingUser) {
    location.href = "/dashboard";
    return;
  }

  const form = document.getElementById("login-form");
  const messageEl = document.getElementById("message");
  const submitBtn = document.getElementById("login-submit-btn");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.clearFieldErrors(form);
    App.showMessage(messageEl, "", "");

    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username) {
      App.showFieldError(form, "username", App.t("validation.usernameRequired"));
      return;
    }
    if (!password) {
      App.showFieldError(form, "password", App.t("validation.passwordRequired"));
      return;
    }

    try {
      App.setButtonLoading(submitBtn, true, App.t("login.buttonLoading"));
      const data = await App.apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      App.setSession(data.token, data.user);
      App.toast(App.t("login.success"), "success");
      location.href = "/dashboard";
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(submitBtn, false);
    }
  });
});
