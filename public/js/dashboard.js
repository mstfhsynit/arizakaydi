document.addEventListener("DOMContentLoaded", async () => {
  await App.ready();

  const user = App.requireAuth();
  if (!user) return;

  App.buildNavbar();

  const welcomeEl = document.getElementById("welcome");
  const statTotal = document.getElementById("stat-total");
  const statBekleniyor = document.getElementById("stat-bekleniyor");
  const statIslemde = document.getElementById("stat-islemde");
  const statCozuldu = document.getElementById("stat-cozuldu");

  const statSkeletonTotal = document.getElementById("skeleton-stat-total");
  const statSkeletonPending = document.getElementById("skeleton-stat-pending");
  const statSkeletonInProgress = document.getElementById("skeleton-stat-in-progress");
  const statSkeletonResolved = document.getElementById("skeleton-stat-resolved");

  const analyticsGridEl = document.getElementById("dashboard-analytics-grid");
  const lineTrendPanelEl = document.getElementById("panel-line-trend");
  const statusDistributionPanelEl = document.getElementById("panel-status-distribution");

  const lineChartEl = document.getElementById("line-chart");
  const lineChartSkeletonEl = document.getElementById("line-chart-skeleton");
  const lineChartLabelsEl = document.getElementById("line-chart-labels");
  const statusChartEl = document.getElementById("status-chart");
  const statusChartSkeletonEl = document.getElementById("status-chart-skeleton");
  const onlineUsersPanelEl = document.getElementById("online-users-panel");
  const onlineUsersMetaEl = document.getElementById("online-users-meta");
  const onlineUsersListEl = document.getElementById("online-users-list");

  function resolveRoleVisibility(role) {
    if (role === "admin") {
      return {
        lineTrend: true,
        statusDistribution: true,
      };
    }

    if (role === "super_admin") {
      return {
        lineTrend: true,
        statusDistribution: true,
      };
    }

    if (role === "manager") {
      return {
        lineTrend: false,
        statusDistribution: true,
      };
    }

    return {
      lineTrend: false,
      statusDistribution: false,
    };
  }

  function removePanel(panelEl) {
    if (panelEl && panelEl.parentElement) {
      panelEl.remove();
    }
  }

  function pruneEmptyDashboardGrid(gridEl) {
    if (!gridEl) return;
    if (!gridEl.querySelector(".dashboard-panel")) {
      gridEl.remove();
    }
  }

  const visibility = resolveRoleVisibility(user.role);
  const canViewLineTrend = visibility.lineTrend;
  const canViewStatusDistribution = visibility.statusDistribution;

  if (!canViewLineTrend) {
    removePanel(lineTrendPanelEl);
  }

  if (!canViewStatusDistribution) {
    removePanel(statusDistributionPanelEl);
  }

  pruneEmptyDashboardGrid(analyticsGridEl);

  welcomeEl.textContent = App.t("dashboard.welcome", {
    name: `${user.ad} ${user.soyad}`,
  });

  function animateCount(el, target, duration = 800) {
    const safeTarget = Number(target) || 0;
    const startAt = performance.now();

    function step(now) {
      const progress = Math.min((now - startAt) / duration, 1);
      const value = Math.round(progress * safeTarget);
      el.textContent = value;
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function showStat(el, skeletonEl, value) {
    if (skeletonEl) skeletonEl.hidden = true;
    if (el) {
      el.hidden = false;
      animateCount(el, value);
    }
  }

  function renderLineChart(days) {
    const items = Array.isArray(days) ? days : [];
    if (!items.length) {
      lineChartSkeletonEl.hidden = true;
      lineChartEl.hidden = false;
      lineChartEl.innerHTML = "";
      lineChartLabelsEl.innerHTML = "";
      return;
    }

    const width = 700;
    const height = 260;
    const paddingLeft = 36;
    const paddingRight = 18;
    const paddingTop = 18;
    const paddingBottom = 36;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const maxCount = Math.max(...items.map((item) => Number(item.count) || 0), 1);
    const stepX = items.length > 1 ? chartWidth / (items.length - 1) : 0;

    const points = items.map((item, index) => {
      const count = Number(item.count) || 0;
      const x = paddingLeft + index * stepX;
      const y = paddingTop + chartHeight - (count / maxCount) * chartHeight;
      return { x, y, count };
    });

    const pointText = points.map((point) => `${point.x},${point.y}`).join(" ");
    const areaText = `${paddingLeft},${paddingTop + chartHeight} ${pointText} ${
      paddingLeft + chartWidth
    },${paddingTop + chartHeight}`;

    const yGridCount = 4;
    const gridLines = [];
    for (let i = 0; i <= yGridCount; i += 1) {
      const y = paddingTop + (chartHeight / yGridCount) * i;
      gridLines.push(
        `<line x1="${paddingLeft}" y1="${y}" x2="${paddingLeft + chartWidth}" y2="${y}" class="line-grid" />`
      );
    }

    lineChartEl.innerHTML = `
      <g>${gridLines.join("")}</g>
      <polygon points="${areaText}" class="line-area"></polygon>
      <polyline points="${pointText}" class="line-path"></polyline>
      ${points
        .map(
          (point) =>
            `<circle cx="${point.x}" cy="${point.y}" r="4" class="line-point"><title>${point.count}</title></circle>`
        )
        .join("")}
    `;

    lineChartLabelsEl.innerHTML = items
      .map(
        (item) => `
          <div class="chart-label-item">
            <span class="chart-label-day">${App.escapeHtml(item.label || "-")}</span>
            <span class="chart-label-value">${App.escapeHtml(String(item.count || 0))}</span>
          </div>
        `
      )
      .join("");

    lineChartSkeletonEl.hidden = true;
    lineChartEl.hidden = false;
  }

  function renderStatusChart(distribution, total) {
    const rows = Array.isArray(distribution) ? distribution : [];
    const safeTotal = Number(total) || 0;

    statusChartEl.innerHTML = rows
      .map((row) => {
        const count = Number(row.count) || 0;
        const percent = safeTotal > 0 ? Math.round((count / safeTotal) * 100) : 0;
        const label = App.translateLookup("status", row.status);
        return `
          <article class="status-row">
            <div class="status-row-head">
              <span>${App.escapeHtml(label)}</span>
              <span>${App.escapeHtml(String(count))} (${percent}%)</span>
            </div>
            <div class="status-row-bar-track">
              <div class="status-row-bar-fill status-fill-${App.escapeHtml(
                String(row.key || "")
              )}" style="width:${percent}%"></div>
            </div>
          </article>
        `;
      })
      .join("");

    statusChartSkeletonEl.hidden = true;
    statusChartEl.hidden = false;
  }

  function renderOnlineUsers(payload) {
    if (!onlineUsersPanelEl || !onlineUsersMetaEl || !onlineUsersListEl) {
      return;
    }

    const users =
      payload && Array.isArray(payload.onlineUsers) ? payload.onlineUsers : [];

    onlineUsersMetaEl.textContent = `${users.length} kullanıcı çevrim içi`;

    if (!users.length) {
      onlineUsersListEl.innerHTML = `<p class="small">Çevrim içi kullanıcı yok.</p>`;
      return;
    }

    onlineUsersListEl.innerHTML = users
      .map((item) => {
        const fullName = `${item.ad || ""} ${item.soyad || ""}`.trim() || "-";
        const roleLabel = App.t(`role.${item.role}`, {}, item.role || "-");
        const connectedAt = App.formatDateTime(item.connected_at);

        return `
          <article class="online-user-item">
            <div class="online-user-head">
              <span class="online-user-name">${App.escapeHtml(fullName)}</span>
              <span class="role-chip">${App.escapeHtml(roleLabel)}</span>
            </div>
            <div class="online-user-meta">
              <span>@${App.escapeHtml(item.username || "-")}</span>
              <span>Bağlantı: ${App.escapeHtml(connectedAt)}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function initOnlineUsersPanel() {
    const canViewOnlineUsers =
      user.role === "admin" || user.role === "manager";
    if (!onlineUsersPanelEl || !canViewOnlineUsers) {
      return;
    }

    onlineUsersPanelEl.hidden = false;

    App.subscribeOnlineUsers((eventName, payload) => {
      if (eventName === "user_connected" || eventName === "user_disconnected") {
        renderOnlineUsers(payload);
      }
    });

    App.apiFetch("/api/online-users")
      .then((payload) => {
        renderOnlineUsers(payload);
      })
      .catch((error) => {
        if (String(error.message || "").includes("yetkiniz yok")) {
          onlineUsersPanelEl.hidden = true;
          return;
        }
        App.toast(error.message, "error");
      });

    App.ensureRealtimeSocket().catch(() => {});
  }

  async function loadSummary() {
    try {
      const summary = await App.apiFetch("/api/requests/summary");

      const cards = summary.cards || {};
      showStat(statTotal, statSkeletonTotal, cards.total || 0);
      showStat(statBekleniyor, statSkeletonPending, cards.pending || 0);
      showStat(statIslemde, statSkeletonInProgress, cards.in_progress || 0);
      showStat(statCozuldu, statSkeletonResolved, cards.resolved || 0);

      if (canViewLineTrend) {
        renderLineChart(summary.last7Days || []);
      }

      if (canViewStatusDistribution) {
        renderStatusChart(summary.statusDistribution || [], cards.total || 0);
      }
    } catch (error) {
      App.toast(error.message, "error");
    }
  }

  loadSummary();
  initOnlineUsersPanel();
});


