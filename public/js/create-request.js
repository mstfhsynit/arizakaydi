document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_ATTACHMENT_EXTENSIONS = [".jpg", ".png", ".pdf"];

  const user = App.requireAuth(["user", "manager"]);
  if (!user) return;
  App.buildNavbar();

  const form = document.getElementById("request-form");
  const messageEl = document.getElementById("message");
  const submitBtn = document.getElementById("request-submit-btn");
  const blokSelect = document.getElementById("blok-select");
  const kategoriSelect = document.getElementById("kategori-select");
  const altKategoriSelect = document.getElementById("alt-kategori-select");
  const aciliyetSelect = document.getElementById("aciliyet-select");
  const adSoyadInput = form.querySelector("input[name='adSoyad']");

  adSoyadInput.value = `${user.ad} ${user.soyad}`;

  let options = null;
  try {
    options = await App.apiFetch("/api/requests/options");
  } catch (error) {
    App.showMessage(messageEl, error.message, "error");
    App.toast(error.message, "error");
    return;
  }

  function mapLabel(group, value) {
    return App.translateLookup(group, value);
  }

  function fillSelect(select, list, group) {
    select.innerHTML = list
      .map((item) => {
        const label = group ? mapLabel(group, item) : item;
        return `<option value="${App.escapeHtml(item)}">${App.escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function fillAltKategori() {
    const kategori = kategoriSelect.value;
    const altList = options.altKategoriler[kategori] || [];
    fillSelect(altKategoriSelect, altList, "subcategory");
  }

  function getFileExtension(name) {
    const raw = String(name || "");
    const dotIndex = raw.lastIndexOf(".");
    if (dotIndex < 0) return "";
    return raw.slice(dotIndex).toLowerCase();
  }

  function validateAttachment(file) {
    if (!file) return "";

    const ext = getFileExtension(file.name);
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext)) {
      return App.t(
        "validation.attachmentType",
        {},
        "Sadece .jpg, .png ve .pdf dosyaları yüklenebilir."
      );
    }

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return App.t(
        "validation.attachmentSize",
        {},
        "Dosya boyutu en fazla 5MB olmalıdır."
      );
    }

    return "";
  }

  fillSelect(blokSelect, options.bloklar, "");
  fillSelect(kategoriSelect, options.kategoriler, "category");
  fillSelect(aciliyetSelect, options.aciliyet, "urgency");
  fillAltKategori();

  kategoriSelect.addEventListener("change", fillAltKategori);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.clearFieldErrors(form);
    App.showMessage(messageEl, "", "");

    const payload = {
      adSoyad: String(form.adSoyad.value || "").trim(),
      blok: String(form.blok.value || "").trim(),
      kategori: String(form.kategori.value || "").trim(),
      alt_kategori: String(form.alt_kategori.value || "").trim(),
      aciliyet: String(form.aciliyet.value || "").trim(),
      aciklama: String(form.aciklama.value || "").trim(),
    };
    const attachmentFile =
      form.attachment && form.attachment.files && form.attachment.files.length
        ? form.attachment.files[0]
        : null;

    const attachmentError = validateAttachment(attachmentFile);
    if (attachmentError) {
      App.showFieldError(form, "attachment", attachmentError);
      App.showMessage(messageEl, attachmentError, "error");
      App.toast(attachmentError, "error");
      return;
    }

    const aciklamaZorunlu =
      payload.aciliyet === "Acil" || payload.alt_kategori === "Diger";
    if (aciklamaZorunlu && !payload.aciklama) {
      const errorText = App.t("validation.descriptionRequired");
      App.showFieldError(form, "aciklama", errorText);
      App.showMessage(messageEl, errorText, "error");
      App.toast(errorText, "error");
      return;
    }

    try {
      App.setButtonLoading(submitBtn, true, App.t("request.saveLoading"));
      const formData = new FormData();
      formData.append("adSoyad", payload.adSoyad);
      formData.append("blok", payload.blok);
      formData.append("kategori", payload.kategori);
      formData.append("alt_kategori", payload.alt_kategori);
      formData.append("aciliyet", payload.aciliyet);
      formData.append("aciklama", payload.aciklama);
      if (attachmentFile) {
        formData.append("attachment", attachmentFile);
      }

      const result = await App.apiFetch("/api/requests", {
        method: "POST",
        body: formData,
      });
      App.showMessage(messageEl, result.message, "success");
      App.toast(result.message, "success");
      form.aciklama.value = "";
      form.aciliyet.value = "Normal";
      form.attachment.value = "";
    } catch (error) {
      App.showMessage(messageEl, error.message, "error");
      App.toast(error.message, "error");
    } finally {
      App.setButtonLoading(submitBtn, false);
    }
  });
});
