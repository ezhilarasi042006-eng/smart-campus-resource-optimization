(() => {
  "use strict";
  const state = { resources: [], bookings: [], insights: null, utilizationChart: null, analyticsChart: null, selectedResourceId: null };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const icons = { "Classroom": "▦", "Laboratory": "⌘", "Seminar Hall": "▤", "Meeting Room": "▣", "Equipment": "⌁" };
  const classForCategory = category => String(category || "").toLowerCase().replace(/\s+/g, "-");
  const fmtDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "—");
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const fmtTime = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  const fmtDateTime = value => `${fmtDate(value)} · ${fmtTime(value)}`;
  const utilizationClass = value => Number(value) >= 80 ? "high" : Number(value) < 40 ? "low" : "";
  const statusPill = status => `<span class="status-pill ${status === "Cancelled" ? "status-cancelled" : "status-confirmed"}">${esc(status)}</span>`;
  const resourceIcon = category => icons[category] || "▦";

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function toast(title, message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type === "error" ? "error" : ""}`;
    node.innerHTML = `<span class="toast-icon">${type === "error" ? "!" : "✓"}</span><div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
    $("#toastRegion").appendChild(node);
    window.setTimeout(() => node.remove(), 4600);
  }

  function navigate(viewName) {
    const view = document.querySelector(`#view-${viewName}`);
    if (!view) return;
    $$(".view").forEach(item => item.classList.toggle("active", item === view));
    $$(".nav-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === viewName));
    const label = ({ overview: "Overview", resources: "Resources", bookings: "Bookings", analytics: "Analytics", insights: "AI Insights", settings: "Settings" })[viewName] || "Overview";
    $("#pageCrumb").textContent = label;
    $("#sidebar").classList.remove("open");
    if (viewName === "analytics") renderAnalytics();
    if (viewName === "bookings") renderAllBookings();
    if (viewName === "insights") renderAllInsights();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderMetrics() {
    if (!state.insights) return;
    const insight = state.insights;
    const optimize = insight.highDemandCount + insight.underutilizedCount;
    $("#totalResources").textContent = insight.totalResources;
    $("#averageUtilization").textContent = insight.averageUtilization;
    $("#activeBookings").textContent = insight.activeBookings;
    $("#optimizationCount").textContent = optimize;
    $("#chartAverage").textContent = `${insight.averageUtilization}%`;
    $("#analyticsAverage").textContent = insight.averageUtilization;
    $("#analyticsHigh").textContent = insight.highDemandCount;
    $("#analyticsLow").textContent = insight.underutilizedCount;
    $("#resourceNavCount").textContent = state.resources.length;
  }

  function renderResourceCard(resource) {
    const u = Number(resource.utilization);
    const cls = utilizationClass(u);
    return `<article class="resource-card">
      <div class="resource-card-top"><span class="resource-symbol ${classForCategory(resource.category)}">${resourceIcon(resource.category)}</span><span class="status-chip">${esc(resource.status || "Available")}</span></div>
      <div class="category-label">${esc(resource.category)}</div><h3>${esc(resource.name)}</h3>
      <div class="resource-location"><span>⌖</span>${esc(resource.location)}</div>
      <div class="utilization-row"><span>Utilization</span><span class="utilization-value">${u}%</span></div>
      <div class="progress-track"><div class="progress-fill ${cls}" style="width:${Math.max(0,Math.min(100,u))}%"></div></div>
      <div class="resource-card-bottom"><span class="capacity-label">Capacity <strong>${Number(resource.capacity) === 1 ? "1 kit" : `${esc(resource.capacity)} seats`}</strong></span><button class="text-action" data-resource-details="${esc(resource.id)}">View details →</button></div>
    </article>`;
  }

  function filterResources(search, category) {
    const term = String(search || "").trim().toLowerCase();
    const cat = String(category || "all").toLowerCase();
    return state.resources.filter(r => {
      const matchCategory = cat === "all" || r.category.toLowerCase() === cat;
      const matchTerm = !term || [r.name, r.id, r.category, r.location, r.description].some(v => String(v).toLowerCase().includes(term));
      return matchCategory && matchTerm;
    });
  }

  function renderResourceGrids() {
    const homeSearch = $("#resourceSearch").value;
    const homeCategory = $("#categoryFilter").value;
    const homeItems = filterResources(homeSearch, homeCategory).slice(0, 6);
    $("#resourceGrid").innerHTML = homeItems.length ? homeItems.map(renderResourceCard).join("") : '<div class="loading-card">No resources match your filters.</div>';
    $("#resourceResultsCount").textContent = `${filterResources(homeSearch, homeCategory).length} resources`;
    const pageItems = filterResources($("#resourceSearchPage").value, $("#categoryFilterPage").value);
    $("#resourceGridPage").innerHTML = pageItems.length ? pageItems.map(renderResourceCard).join("") : '<div class="loading-card">No resources match your filters.</div>';
    bindResourceDetails();
  }

  function renderBookings() {
    const all = state.bookings.slice().sort((a,b) => new Date(a.start) - new Date(b.start));
    const confirmed = all.filter(b => b.status === "Confirmed").length;
    const cancelled = all.filter(b => b.status === "Cancelled").length;
    $("#bookingTotal").textContent = all.length;
    $("#bookingConfirmed").textContent = confirmed;
    $("#bookingCancelled").textContent = cancelled;
    const recent = all.slice().sort((a,b) => new Date(b.createdAt || b.start) - new Date(a.createdAt || a.start)).slice(0, 5);
    $("#recentBookingsBody").innerHTML = recent.length ? recent.map(b => `<tr>
      <td><div class="table-resource"><span class="table-resource-icon">${resourceIcon((state.resources.find(r=>r.id===b.resourceId)||{}).category)}</span><span class="table-resource-name"><strong>${esc(b.resourceName)}</strong><small>${esc(b.id)}</small></span></div></td>
      <td><div class="person-cell"><strong>${esc(b.bookerName)}</strong><small>${esc(b.email)}</small></div></td>
      <td>${esc(fmtDate(b.start))}<br><small>${esc(fmtTime(b.start))} – ${esc(fmtTime(b.end))}</small></td><td>${statusPill(b.status)}</td><td></td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">No bookings yet. Create the first reservation.</td></tr>';
    renderAllBookings();
  }

  function renderAllBookings() {
    const filter = $("#bookingStatusFilter").value;
    const list = state.bookings.slice().sort((a,b) => new Date(b.createdAt || b.start) - new Date(a.createdAt || a.start))
      .filter(b => filter === "all" || b.status === filter);
    $("#allBookingsBody").innerHTML = list.length ? list.map(b => `<tr>
      <td><strong>${esc(b.id)}</strong></td><td><div class="table-resource"><span class="table-resource-icon">${resourceIcon((state.resources.find(r=>r.id===b.resourceId)||{}).category)}</span><span class="table-resource-name"><strong>${esc(b.resourceName)}</strong><small>${esc(b.resourceId)}</small></span></div></td>
      <td><div class="person-cell"><strong>${esc(b.bookerName)}</strong><small>${esc(b.email)}</small></div></td>
      <td>${esc(fmtDate(b.start))}<br><small>${esc(fmtTime(b.start))} – ${esc(fmtTime(b.end))}</small></td><td>${statusPill(b.status)}</td>
      <td>${b.status === "Confirmed" ? `<button class="action-cancel" data-cancel-booking="${esc(b.id)}">Cancel</button>` : '<span class="capacity-label">No action</span>'}</td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No reservations in this view.</td></tr>';
    $$("[data-cancel-booking]").forEach(button => button.addEventListener("click", () => cancelBooking(button.dataset.cancelBooking)));
  }

  function insightIcon(type) {
    if (type === "underused") return { symbol: "⌄", cls: "low" };
    if (type === "allocation") return { symbol: "⇄", cls: "balance" };
    return { symbol: "↗", cls: "" };
  }

  function renderInsightPreview() {
    const list = (state.insights?.recommendations || []).slice(0, 3);
    $("#insightPreviewList").innerHTML = list.length ? list.map(item => {
      const icon = insightIcon(item.type);
      return `<article class="insight-item"><span class="insight-symbol ${icon.cls}">${icon.symbol}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><span class="insight-priority ${item.priority.toLowerCase()}">${esc(item.priority)} priority</span></div></article>`;
    }).join("") : '<div class="loading-line">No recommendations available.</div>';
  }

  function renderAnalytics() {
    if (!state.insights || !state.resources.length) return;
    const items = state.resources;
    const high = items.filter(r => Number(r.utilization) >= 80).length;
    const mid = items.filter(r => Number(r.utilization) >= 40 && Number(r.utilization) < 80).length;
    const low = items.filter(r => Number(r.utilization) < 40).length;
    const groups = [
      { name: "High demand", count: high, color: "high", desc: "≥ 80%" },
      { name: "Balanced use", count: mid, color: "", desc: "40–79%" },
      { name: "Underutilized", count: low, color: "low", desc: "< 40%" }
    ];
    $("#distributionBars").innerHTML = groups.map(g => `<div><div class="distribution-row-head"><span>${g.name} <small>(${g.desc})</small></span><strong>${g.count} resource${g.count===1?"":"s"}</strong></div><div class="progress-track"><div class="progress-fill ${g.color}" style="width:${items.length ? g.count/items.length*100 : 0}%"></div></div></div>`).join("");
    $("#analyticsTableBody").innerHTML = items.map(r => `<tr><td><div class="table-resource"><span class="table-resource-icon">${resourceIcon(r.category)}</span><span class="table-resource-name"><strong>${esc(r.name)}</strong><small>${esc(r.id)}</small></span></div></td><td>${esc(r.category)}</td><td>${Number(r.capacity) === 1 ? "1 kit" : `${esc(r.capacity)} seats`}</td><td><strong>${Number(r.utilization)}%</strong></td><td><span class="status-pill ${Number(r.utilization)>=80?"status-cancelled":Number(r.utilization)<40?"status-confirmed":"status-confirmed"}">${Number(r.utilization)>=80?"High demand":Number(r.utilization)<40?"Underutilized":"Balanced"}</span></td></tr>`).join("");
    if (typeof Chart === "undefined") return;
    const labels = items.map(r => r.name);
    const values = items.map(r => Number(r.utilization));
    const colors = values.map(v => v >= 80 ? "#ed9b60" : v < 40 ? "#50b89a" : "#7765df");
    if (state.analyticsChart) state.analyticsChart.destroy();
    const ctx = $("#analyticsChart").getContext("2d");
    state.analyticsChart = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Utilization (%)", data: values, backgroundColor: colors, borderRadius: 5, maxBarThickness: 36 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.parsed.y}% utilized` } } },
        scales: { y: { beginAtZero: true, max: 100, grid: { color: "#eef1f7" }, ticks: { stepSize: 20, color: "#8e99ac", font: { size: 9 } } }, x: { grid: { display: false }, ticks: { color: "#8e99ac", maxRotation: 35, minRotation: 0, font: { size: 9 } } } } }
    });
  }

  function renderAllInsights() {
    if (!state.insights) return;
    const insight = state.insights;
    $("#insightStats").innerHTML = `<article class="insight-stat"><small>High-demand resources</small><strong>${insight.highDemandCount}</strong><span>Utilization ≥ 80%</span></article><article class="insight-stat"><small>Underutilized resources</small><strong>${insight.underutilizedCount}</strong><span>Utilization below 40%</span></article><article class="insight-stat"><small>Average utilization</small><strong>${insight.averageUtilization}%</strong><span>Mean of sample resource profiles</span></article>`;
    $("#allInsightsList").innerHTML = insight.recommendations.length ? insight.recommendations.map(item => {
      const icon = insightIcon(item.type);
      return `<article class="recommendation-card"><div class="recommendation-card-head"><span class="insight-symbol ${icon.cls}">${icon.symbol}</span><div><h3>${esc(item.title)}</h3><p>${esc(item.message)}</p></div></div><div class="recommendation-meta"><span>Resource: ${esc(item.resourceName || "Campus-wide")}</span><span class="insight-priority ${item.priority.toLowerCase()}">${esc(item.priority)}</span></div></article>`;
    }).join("") : '<div class="loading-card">No recommendations at this time.</div>';
  }

  function renderChart() {
    if (typeof Chart === "undefined" || !state.resources.length) return;
    if (state.utilizationChart) state.utilizationChart.destroy();
    const labels = state.resources.map(r => r.name);
    const values = state.resources.map(r => Number(r.utilization));
    const colors = values.map(v => v >= 80 ? "#ed9b60" : v < 40 ? "#50b89a" : "#7765df");
    state.utilizationChart = new Chart($("#utilizationChart").getContext("2d"), {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.parsed.y}% utilization` } } },
        scales: { y: { beginAtZero: true, max: 100, grid: { color: "#eff2f7" }, ticks: { stepSize: 25, color: "#9aa4b5", font: { size: 9 } } }, x: { grid: { display: false }, ticks: { color: "#8e99ac", maxRotation: 30, minRotation: 0, font: { size: 8 } } } } }
    });
  }

  function populateResourceSelect() {
    const select = $("#bookingResource");
    const current = select.value;
    select.innerHTML = '<option value="">Choose a resource…</option>' + state.resources.map(r => `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.category)}</option>`).join("");
    if (current && state.resources.some(r => r.id === current)) select.value = current;
  }

  function openBookingModal(resourceId = "") {
    $("#bookingForm").reset();
    $("#bookingFormError").hidden = true;
    $("#bookingFormError").textContent = "";
    populateResourceSelect();
    if (resourceId) $("#bookingResource").value = resourceId;
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    now.setSeconds(0, 0);
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const localInput = date => {
      const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return adjusted.toISOString().slice(0, 16);
    };
    $("#bookingStart").value = localInput(start);
    $("#bookingEnd").value = localInput(end);
    $("#bookingStart").min = localInput(now);
    $("#bookingEnd").min = localInput(start);
    $("#bookingModal").hidden = false;
    document.body.style.overflow = "hidden";
    $("#bookingResource").focus();
  }

  function closeModal(id) {
    $(id).hidden = true;
    if ($("#bookingModal").hidden && $("#resourceModal").hidden) document.body.style.overflow = "";
  }

  async function submitBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("#submitBookingBtn");
    const formError = $("#bookingFormError");
    formError.hidden = true;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    button.disabled = true;
    button.textContent = "Saving reservation…";
    try {
      const result = await api("/api/bookings", { method: "POST", body: JSON.stringify(payload) });
      closeModal("#bookingModal");
      await loadData();
      toast("Booking confirmed", `${result.booking.resourceName} has been reserved successfully.`);
      navigate("bookings");
    } catch (error) {
      formError.textContent = error.message;
      formError.hidden = false;
      toast("Could not create booking", error.message, "error");
    } finally {
      button.disabled = false;
      button.innerHTML = 'Confirm booking <span>→</span>';
    }
  }

  async function cancelBooking(id) {
    const booking = state.bookings.find(b => b.id === id);
    if (!booking) return;
    if (!window.confirm(`Cancel the reservation for ${booking.resourceName} booked by ${booking.bookerName}?`)) return;
    try {
      await api(`/api/bookings/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
      await loadData();
      toast("Booking cancelled", "The reservation is cancelled and no longer blocks this time slot.");
    } catch (error) { toast("Cancellation failed", error.message, "error"); }
  }

  function bindResourceDetails() {
    $$("[data-resource-details]").forEach(button => button.addEventListener("click", () => openResourceDetails(button.dataset.resourceDetails)));
  }

  function openResourceDetails(id) {
    const r = state.resources.find(item => item.id === id);
    if (!r) return;
    state.selectedResourceId = id;
    $("#resourceModalTitle").textContent = r.name;
    $("#resourceModalContent").innerHTML = `<div class="detail-top"><span class="resource-symbol ${classForCategory(r.category)}">${resourceIcon(r.category)}</span><div><h3>${esc(r.name)}</h3><p>${esc(r.id)} · ${esc(r.category)}</p></div></div><p class="detail-description">${esc(r.description)}</p><div class="detail-facts"><div class="detail-fact"><small>Location</small><strong>${esc(r.location)}</strong></div><div class="detail-fact"><small>Capacity</small><strong>${Number(r.capacity)===1?"1 kit":`${esc(r.capacity)} seats`}</strong></div><div class="detail-fact"><small>Utilization profile</small><strong>${Number(r.utilization)}%</strong></div><div class="detail-fact"><small>Availability status</small><strong>${esc(r.status)}</strong></div></div><div class="utilization-row"><span>Utilization</span><span class="utilization-value">${Number(r.utilization)}%</span></div><div class="progress-track"><div class="progress-fill ${utilizationClass(r.utilization)}" style="width:${Math.max(0,Math.min(100,Number(r.utilization)))}%"></div></div><h3 style="font:700 11px Manrope;margin:18px 0 10px">Features & equipment</h3><div class="feature-list">${(r.features||[]).map(feature=>`<span class="feature-chip">${esc(feature)}</span>`).join("")}</div>`;
    $("#resourceModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  async function loadData() {
    const [resourceData, bookingData, insightData] = await Promise.all([
      api("/api/resources"), api("/api/bookings"), api("/api/insights")
    ]);
    state.resources = resourceData.resources || [];
    state.bookings = bookingData.bookings || [];
    state.insights = insightData;
    renderMetrics();
    renderResourceGrids();
    renderBookings();
    renderInsightPreview();
    renderChart();
    populateResourceSelect();
    renderAnalytics();
    renderAllInsights();
    $("#apiHealthText").textContent = "API responded successfully at /api/health.";
    $("#apiHealthBadge").textContent = "Connected";
  }

  async function checkHealth() {
    try {
      await api("/api/health");
      $("#apiHealthText").textContent = "API responded successfully at /api/health.";
      $("#apiHealthBadge").textContent = "Connected";
    } catch (error) {
      $("#apiHealthText").textContent = error.message;
      $("#apiHealthBadge").textContent = "Unavailable";
    }
  }

  function bindEvents() {
    $$(".nav-item[data-view]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
    $$("[data-navigate]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.navigate)));
    $("#viewInsightsBtn").addEventListener("click", () => navigate("insights"));
    $("#newBookingBtn").addEventListener("click", () => openBookingModal());
    $("#resourcesNewBooking").addEventListener("click", () => openBookingModal());
    $("#bookingsNewBooking").addEventListener("click", () => openBookingModal());
    $("#closeBookingModal").addEventListener("click", () => closeModal("#bookingModal"));
    $("#cancelBookingModal").addEventListener("click", () => closeModal("#bookingModal"));
    $("#closeResourceModal").addEventListener("click", () => closeModal("#resourceModal"));
    $("#closeResourceDetails").addEventListener("click", () => closeModal("#resourceModal"));
    $("#bookThisResource").addEventListener("click", () => {
      const id = state.selectedResourceId;
      closeModal("#resourceModal");
      openBookingModal(id);
    });
    $("#bookingForm").addEventListener("submit", submitBooking);
    $("#bookingStart").addEventListener("change", () => { $("#bookingEnd").min = $("#bookingStart").value; });
    $("#bookingStatusFilter").addEventListener("change", renderAllBookings);
    $("#resourceSearch").addEventListener("input", renderResourceGrids);
    $("#categoryFilter").addEventListener("change", renderResourceGrids);
    $("#resourceSearchPage").addEventListener("input", renderResourceGrids);
    $("#categoryFilterPage").addEventListener("change", renderResourceGrids);
    $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#notificationBtn").addEventListener("click", () => toast("All caught up", "No new system notifications.", "success"));
    [$("#bookingModal"), $("#resourceModal")].forEach(backdrop => backdrop.addEventListener("click", event => {
      if (event.target === backdrop) closeModal(`#${backdrop.id}`);
    }));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeModal("#bookingModal"); closeModal("#resourceModal"); $("#sidebar").classList.remove("open"); }
    });
  }

  async function init() {
    bindEvents();
    try { await loadData(); }
    catch (error) {
      toast("Could not load campus data", error.message, "error");
      $("#resourceGrid").innerHTML = '<div class="loading-card">Unable to load resources. Check that the Node.js server is running, then refresh.</div>';
    }
    await checkHealth();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
