/* ==========================================================================
   Smart Locker System - Master Admin Portal Logic
   ========================================================================== */

const API_BASE = '/api';

let adminPin = "";
let currentAdminPinSession = "";
let lockers = [];
let auditLogs = [];

document.addEventListener("DOMContentLoaded", () => {
  setupAdminKeypad();
  setupEventListeners();

  // Check if session exists in sessionStorage
  const savedPin = sessionStorage.getItem("admin_session_pin");
  if (savedPin) {
    currentAdminPinSession = savedPin;
    showAdminDashboard();
  }
});

function setupAdminKeypad() {
  const keypad = document.getElementById("adminLoginKeypad");
  if (!keypad) return;

  keypad.addEventListener("click", (e) => {
    const btn = e.target.closest(".key-btn");
    if (!btn) return;

    const val = btn.dataset.val;
    const action = btn.dataset.action;

    if (val !== undefined && adminPin.length < 4) {
      adminPin += val;
    } else if (action === "clear") {
      adminPin = "";
    } else if (action === "back") {
      adminPin = adminPin.slice(0, -1);
    }

    updatePinDisplay();
  });
}

function updatePinDisplay() {
  const display = document.getElementById("adminLoginPinDisplay");
  if (display) {
    display.textContent = "•".repeat(adminPin.length) || "••••";
  }
}

function setupEventListeners() {
  // Submit Admin Login
  const btnLogin = document.getElementById("btnAdminLoginSubmit");
  if (btnLogin) {
    btnLogin.addEventListener("click", () => loginAdmin(adminPin));
  }

  // Logout
  const btnLogout = document.getElementById("btnAdminLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      sessionStorage.removeItem("admin_session_pin");
      currentAdminPinSession = "";
      adminPin = "";
      updatePinDisplay();
      document.getElementById("adminDashboardScreen").style.display = "none";
      document.getElementById("adminLoginScreen").style.display = "block";
      showToast("Logged out of Master Admin session", "info");
    });
  }

  // Refresh Lockers
  const btnRefresh = document.getElementById("btnRefreshLockers");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", loadAdminData);
  }

  // Open Change PIN Modal
  const btnChangePin = document.getElementById("btnOpenChangePin");
  if (btnChangePin) {
    btnChangePin.addEventListener("click", () => {
      openModal("modalChangeAdminPin");
    });
  }

  // Close modals
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const targetId = e.target.getAttribute("data-close") || e.target.closest("[data-close]")?.getAttribute("data-close");
      if (targetId) closeModal(targetId);
    });
  });

  // Change PIN Form
  const formChangePin = document.getElementById("formChangeAdminPin");
  if (formChangePin) {
    formChangePin.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPin = document.getElementById("inputCurrentAdminPin").value.trim();
      const newPin = document.getElementById("inputNewAdminPin").value.trim();
      const confirmPin = document.getElementById("inputConfirmAdminPin").value.trim();

      if (newPin !== confirmPin) {
        showToast("New PINs do not match!", "error");
        return;
      }

      if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        showToast("New PIN must be exactly 4 digits", "error");
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/admin/change-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPin, newPin })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, "success");
          currentAdminPinSession = newPin;
          sessionStorage.setItem("admin_session_pin", newPin);
          closeModal("modalChangeAdminPin");
          formChangePin.reset();
        } else {
          showToast(data.message, "error");
        }
      } catch (err) {
        showToast("Error updating Admin PIN", "error");
      }
    });
  }

  // Audit Log Search
  const auditSearch = document.getElementById("adminAuditSearch");
  if (auditSearch) {
    auditSearch.addEventListener("input", (e) => {
      renderAuditRows(e.target.value.trim().toLowerCase());
    });
  }

  // Export CSV
  const btnExport = document.getElementById("btnExportAuditCSV");
  if (btnExport) {
    btnExport.addEventListener("click", exportAuditCSV);
  }
}

async function loginAdmin(pin) {
  if (pin.length !== 4) {
    showToast("Please enter a 4-digit PIN", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (data.success) {
      currentAdminPinSession = pin;
      sessionStorage.setItem("admin_session_pin", pin);
      showToast(data.message, "success");
      showAdminDashboard();
    } else {
      showToast(data.message, "error");
      adminPin = "";
      updatePinDisplay();
    }
  } catch (err) {
    showToast("Failed to connect to backend API server", "error");
  }
}

function showAdminDashboard() {
  document.getElementById("adminLoginScreen").style.display = "none";
  document.getElementById("adminDashboardScreen").style.display = "block";
  loadAdminData();
}

async function loadAdminData() {
  try {
    // Load Lockers
    const lockersRes = await fetch(`${API_BASE}/lockers`);
    const lockersData = await lockersRes.json();
    if (lockersData.success) {
      lockers = lockersData.lockers;
      renderLockerRows();
      updateAdminStats();
    }

    // Load Logs
    const logsRes = await fetch(`${API_BASE}/logs`);
    const logsData = await logsRes.json();
    if (logsData.success) {
      auditLogs = logsData.logs;
      renderAuditRows();
    }
  } catch (err) {
    showToast("Failed loading data from server", "error");
  }
}

function updateAdminStats() {
  let total = lockers.length || 15;
  let available = 0, occupied = 0, maintenance = 0;

  lockers.forEach(l => {
    if (l.status === "AVAILABLE") available++;
    else if (l.status === "OCCUPIED") occupied++;
    else if (l.status === "MAINTENANCE") maintenance++;
  });

  document.getElementById("statAdminTotal").textContent = total;
  document.getElementById("statAdminAvailable").textContent = available;
  document.getElementById("statAdminOccupied").textContent = occupied;
  document.getElementById("statAdminMaintenance").textContent = maintenance;
}

function renderLockerRows() {
  const tbody = document.getElementById("adminLockerRows");
  if (!tbody) return;

  tbody.innerHTML = lockers.map(l => {
    const statusTag = `<span class="status-badge ${l.status}">${l.status}</span>`;
    const depTime = l.depositTime ? new Date(l.depositTime).toLocaleString() : 'N/A';

    return `
      <tr>
        <td><strong>#${l.id}</strong></td>
        <td>${l.size}</td>
        <td>${statusTag}</td>
        <td>${escapeHtml(l.depositorName || '-')}</td>
        <td>${escapeHtml(l.itemDesc || '-')}</td>
        <td>${depTime}</td>
        <td>
          <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
            ${l.status === "OCCUPIED" ? `
              <button class="btn" onclick="forceUnlockLocker(${l.id})" style="font-size: 0.75rem; padding: 0.25rem 0.5rem; background: rgba(239, 68, 68, 0.2); color: var(--rose); border-color: var(--rose);">
                🔓 Force Unlock
              </button>
            ` : ''}
            <button class="btn btn-secondary" onclick="toggleMaintenance(${l.id})" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">
              ${l.status === "MAINTENANCE" ? '🟢 Re-open' : '🛠️ Maintenance'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function forceUnlockLocker(lockerId) {
  if (!confirm(`Are you sure you want to FORCE UNLOCK Locker #${lockerId}? This will vacate the locker immediately.`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin: currentAdminPinSession, lockerId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      loadAdminData();
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    showToast("Error sending force unlock command", "error");
  }
}

async function toggleMaintenance(lockerId) {
  try {
    const res = await fetch(`${API_BASE}/admin/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin: currentAdminPinSession, lockerId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      loadAdminData();
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    showToast("Error updating locker maintenance state", "error");
  }
}

function renderAuditRows(filterQuery = "") {
  const tbody = document.getElementById("adminAuditRows");
  if (!tbody) return;

  const filtered = auditLogs.filter(log => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return log.action.toLowerCase().includes(q) ||
           log.details.toLowerCase().includes(q) ||
           log.lockerId.toString().includes(q);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No audit logs found</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(log => `
    <tr>
      <td>#${log.id}</td>
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td>Locker #${log.lockerId || 'Sys'}</td>
      <td><strong style="color: var(--cyan);">${escapeHtml(log.action)}</strong></td>
      <td>${escapeHtml(log.details)}</td>
    </tr>
  `).join('');
}

function exportAuditCSV() {
  if (auditLogs.length === 0) {
    showToast("No audit logs to export", "warning");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,ID,Timestamp,LockerID,Action,Details\n";
  auditLogs.forEach(log => {
    const detailsClean = `"${log.details.replace(/"/g, '""')}"`;
    csvContent += `${log.id},${log.timestamp},${log.lockerId},${log.action},${detailsClean}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `locker_audit_logs_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Audit logs exported to CSV!", "success");
}

// Helpers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("active");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("active");
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function showToast(message, type = "info") {
  const container = document.getElementById("adminToastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️')}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}
