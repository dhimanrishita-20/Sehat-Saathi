
const $ = (id) => document.getElementById(id);

const authView = $("authView");
const dashboardView = $("dashboardView");
const authForm = $("authForm");
const visitForm = $("visitForm");

let token = sessionStorage.getItem("sehatToken") || "";
let currentUser = null;
let visits = [];
let authMode = "login";
let reminderTimer = null;

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(id, message, success = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle("success", success);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && token) {
      logout(false);
    }
    throw new Error(data.message || "Something went wrong.");
  }
  return data;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";

  $("loginTab").classList.toggle("active", !registering);
  $("registerTab").classList.toggle("active", registering);
  $("nameLabel").classList.toggle("hidden", !registering);
  $("name").required = registering;
  $("password").autocomplete = registering ? "new-password" : "current-password";
  $("authTitle").textContent = registering ? "Create your account" : "Welcome back!";
  $("authSubtitle").textContent = registering
    ? "Set up your personal hospital visit tracker."
    : "Log in to manage your visits.";
  $("authSubmit").textContent = registering ? "Create account" : "Login to Sehat Saathi";
  showMessage("authMessage", "");
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("registerTab").addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("authMessage", "");

  const payload = {
    email: $("email").value.trim(),
    password: $("password").value
  };

  if (authMode === "register") {
    payload.name = $("name").value.trim();
  }

  try {
    const result = await api(
      authMode === "register"
        ? "/api/auth/register"
        : "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );

    if (authMode === "register") {
      setAuthMode("login");
      showMessage("authMessage", result.message, true);
      return;
    }

    token = result.token;
    currentUser = result.user;
    sessionStorage.setItem("sehatToken", token);
    await openDashboard();
  } catch (error) {
    showMessage("authMessage", error.message);
  }
});

async function openDashboard() {
  try {
    const result = await api("/api/auth/me");
    currentUser = result.user;

    authView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    $("userName").textContent = currentUser.name;

    await loadVisits();

    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = setInterval(checkReminders, 30000);
    checkReminders();
  } catch (error) {
    if (token) logout(false);
    showMessage("authMessage", error.message);
  }
}

function logout(showNotice = false) {
  token = "";
  currentUser = null;
  visits = [];

  sessionStorage.removeItem("sehatToken");
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;

  dashboardView.classList.add("hidden");
  authView.classList.remove("hidden");
  $("logoutBtn").classList.add("hidden");

  if (showNotice) setAuthMode("login");
}

$("logoutBtn").addEventListener("click", () => logout(true));

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short"
      });
}

function isUpcoming(visit) {
  return visit.status === "Upcoming" && new Date(visit.date) > new Date();
}

function updateStats() {
  $("upcomingCount").textContent =
    visits.filter(isUpcoming).length;

  $("totalCount").textContent = visits.length;

  $("pendingCount").textContent = visits
    .filter(isUpcoming)
    .reduce(
      (sum, visit) =>
        sum + visit.documents.filter(
          (doc) => doc.required && !doc.packed
        ).length,
      0
    );
}

async function loadVisits() {
  visits = await api("/api/visits");
  updateStats();
  renderVisits();
  renderDocumentSelector();
}

function renderVisits() {
  const filter = $("visitFilter").value;
  const filtered = visits.filter(
    (visit) => filter === "All" || visit.status === filter
  );

  if (!filtered.length) {
    $("visitList").innerHTML =
      '<p class="muted">No visits found. Add your first appointment!</p>';
    return;
  }

  $("visitList").innerHTML = filtered.map((visit) => {
    const remaining = visit.documents.filter(
      (doc) => doc.required && !doc.packed
    ).length;

    return `
      <article class="visit-card">
        <div class="section-heading">
          <h3>${escapeHTML(visit.hospital)}</h3>
          <span class="status ${escapeHTML(visit.status)}">
            ${escapeHTML(visit.status)}
          </span>
        </div>
        <p class="visit-meta">📅 ${escapeHTML(formatDate(visit.date))}</p>
        ${visit.doctor ? `<p>👨‍⚕️ ${escapeHTML(visit.doctor)}</p>` : ""}
        ${visit.department ? `<p>🏥 ${escapeHTML(visit.department)}</p>` : ""}
        ${visit.reason ? `<p>${escapeHTML(visit.reason)}</p>` : ""}
        <p class="visit-meta">Documents remaining: ${remaining}</p>
        <div class="card-actions">
          <button data-action="documents" data-id="${visit._id}">Documents</button>
          <button data-action="edit" data-id="${visit._id}">Edit</button>
          ${visit.status === "Upcoming" ? `
            <button data-action="complete" data-id="${visit._id}">Complete</button>
            <button data-action="cancel" data-id="${visit._id}">Cancel</button>
          ` : ""}
          <button class="danger" data-action="delete" data-id="${visit._id}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

$("visitFilter").addEventListener("change", renderVisits);

$("visitList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const visit = visits.find((item) => item._id === id);
  if (!visit) return;

  try {
    if (action === "documents") {
      $("documentVisit").value = id;
      renderChecklist();
      $("documentChecklist").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (action === "complete" || action === "cancel") {
      const status = action === "complete" ? "Completed" : "Cancelled";
      if (!confirm(`Mark this appointment as ${status.toLowerCase()}?`)) return;

      await api(`/api/visits/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
    }

    if (action === "delete") {
      if (!confirm("Permanently delete this visit?")) return;

      await api(`/api/visits/${id}`, { method: "DELETE" });
    }

    if (action === "edit") {
      const hospital = prompt("Hospital name:", visit.hospital);
      if (hospital === null) return;

      const doctor = prompt("Doctor name:", visit.doctor || "");
      if (doctor === null) return;

      const department = prompt("Department:", visit.department || "");
      if (department === null) return;

      const date = prompt(
        "Appointment date and time (YYYY-MM-DDTHH:mm):",
        visit.date.slice(0, 16)
      );
      if (date === null) return;

      const parsedDate = new Date(date);
      if (!date || Number.isNaN(parsedDate.getTime()) ||
          parsedDate <= new Date()) {
        throw new Error("Enter a valid future appointment date and time.");
      }

      await api(`/api/visits/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ hospital, doctor, department, date })
      });
    }

    showMessage("globalMessage", "Visit updated successfully.", true);
    await loadVisits();
  } catch (error) {
    showMessage("globalMessage", error.message);
  }
});

visitForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("visitMessage", "");

  const formData = new FormData(visitForm);
  const date = formData.get("date");

  try {
    if (!date || new Date(date) <= new Date()) {
      throw new Error("Please choose a future appointment date and time.");
    }

    await api("/api/visits", {
      method: "POST",
      body: JSON.stringify({
        hospital: formData.get("hospital"),
        doctor: formData.get("doctor"),
        department: formData.get("department"),
        reason: formData.get("reason"),
        date,
        reminderMinutes: Number(formData.get("reminderMinutes"))
      })
    });

    visitForm.reset();
    setMinimumDate();
    showMessage("visitMessage", "Appointment added successfully!", true);
    await loadVisits();
  } catch (error) {
    showMessage("visitMessage", error.message);
  }
});

function setMinimumDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $("visitDate").min = now.toISOString().slice(0, 16);
}
setMinimumDate();

function renderDocumentSelector() {
  const previous = $("documentVisit").value;

  const available = visits.filter(
    (visit) => visit.status === "Upcoming"
  );

  $("documentVisit").innerHTML =
    '<option value="">Choose an appointment</option>' +
    available.map((visit) => `
      <option value="${visit._id}">
        ${escapeHTML(visit.hospital)} — ${escapeHTML(formatDate(visit.date))}
      </option>
    `).join("");

  if (available.some((visit) => visit._id === previous)) {
    $("documentVisit").value = previous;
  } else if (available.length) {
    $("documentVisit").value = available[0]._id;
  }

  renderChecklist();
}

$("documentVisit").addEventListener("change", renderChecklist);

function renderChecklist() {
  const visit = visits.find(
    (item) => item._id === $("documentVisit").value
  );

  if (!visit) {
    $("documentChecklist").innerHTML =
      '<p class="muted">Add an upcoming appointment to see its checklist.</p>';
    return;
  }

  $("documentChecklist").innerHTML = visit.documents.map((doc) => `
    <div class="check-item">
      <input type="checkbox" id="doc-${doc._id}"
        data-document-id="${doc._id}" ${doc.packed ? "checked" : ""}>
      <label for="doc-${doc._id}">
        ${escapeHTML(doc.name)}
        ${doc.required ? "" : " (optional)"}
      </label>
    </div>
  `).join("");
}

$("documentChecklist").addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input[data-document-id]");
  if (!checkbox) return;

  const visit = visits.find(
    (item) => item._id === $("documentVisit").value
  );
  if (!visit) return;

  checkbox.disabled = true;

  try {
    await api(
      `/api/visits/${visit._id}/documents/${checkbox.dataset.documentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ packed: checkbox.checked })
      }
    );
    await loadVisits();
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showMessage("globalMessage", error.message);
  } finally {
    checkbox.disabled = false;
  }
});

// Browser notifications are best-effort and only run while
// this page is open. Notifications require permission and a supported browser.
$("notifyBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showMessage("globalMessage", "This browser does not support notifications.");
    return;
  }

  const permission = await Notification.requestPermission();

  showMessage(
    "globalMessage",
    permission === "granted"
      ? "Browser notifications enabled. Keep this page open for reminders."
      : "Notifications were not enabled. You can still see appointments on your dashboard.",
    permission === "granted"
  );

  checkReminders();
});

function checkReminders() {
  if (!token || !("Notification" in window) ||
      Notification.permission !== "granted") return;

  const now = Date.now();
  const notifiedKey = "sehatNotified";
  const notified = new Set(
    JSON.parse(sessionStorage.getItem(notifiedKey) || "[]")
  );

  visits.forEach((visit) => {
    if (visit.status !== "Upcoming") return;

    const appointmentTime = new Date(visit.date).getTime();
    const reminderTime =
      appointmentTime - Number(visit.reminderMinutes || 0) * 60000;

    const key = `${visit._id}:${visit.date}:${visit.reminderMinutes}`;

    if (
      now >= reminderTime &&
      now < appointmentTime + 30 * 60000 &&
      !notified.has(key)
    ) {
      new Notification("Sehat Saathi appointment reminder", {
        body: `${visit.hospital} — ${formatDate(visit.date)}`
      });

      notified.add(key);
    }
  });

  sessionStorage.setItem(notifiedKey, JSON.stringify([...notified]));
}

async function initialize() {
  if (!token) return;

  try {
    await openDashboard();
  } catch {
    logout(false);
  }
}

initialize();
