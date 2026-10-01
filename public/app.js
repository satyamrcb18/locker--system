/* ==========================================================================
   Smart Locker System - Public Client Application Engine (API & PWA)
   ========================================================================== */

const API_BASE = 'https://locker-backend-bf7b.onrender.com/api';
let lockers = [];
let currentFilter = "ALL";
let searchQuery = "";
let selectedLockerId = null;
let depositPin = "";
let retrievePin = "";
let lastReceiptData = null;

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  registerServiceWorker();
  setupEventListeners();
  loadLockers();

  // Auto refresh every 5 seconds
  setInterval(loadLockers, 5000);
});

// PWA Service Worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('ServiceWorker registered'))
      .catch(err => console.log('ServiceWorker registration failed:', err));
  }
}

// Theme Engine
function initTheme() {
  const savedTheme = localStorage.getItem("locker_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeUI(savedTheme);

  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("locker_theme", next);
      updateThemeUI(next);
    });
  }
}

function updateThemeUI(theme) {
  const icon = document.getElementById("themeToggleIcon");
  const text = document.getElementById("themeToggleText");
  if (icon && text) {
    icon.textContent = theme === "light" ? "🌙" : "☀️";
    text.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
  }
}

// API Loader
async function loadLockers() {
  try {
    const res = await fetch(`${API_BASE}/lockers`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        lockers = data.lockers;
        renderLockers();
        updateStats();
        populateDepositSelect();
        return;
      }
    }
  } catch (e) {
    console.warn("Backend API unavailable, using fallback/cached lockers", e);
  }
}

// Stats & Dashboard
function updateStats() {
  const total = lockers.length || 15;
  let available = 0, occupied = 0, maintenance = 0, overdue = 0, approaching = 0;
  const now = Date.now();

  lockers.forEach(l => {
    if (l.status === "AVAILABLE") available++;
    else if (l.status === "MAINTENANCE") maintenance++;
    else if (l.status === "OCCUPIED") {
      occupied++;
      if (l.depositTime) {
        const elapsed = now - new Date(l.depositTime).getTime();
        if (elapsed >= 24 * 60 * 60 * 1000) overdue++;
        else if (elapsed >= 20 * 60 * 60 * 1000) approaching++;
      }
    }
  });

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statAvailable").textContent = available;
  document.getElementById("statOccupied").textContent = occupied;
  document.getElementById("statApproaching").textContent = approaching;
  document.getElementById("statOverdue").textContent = overdue;
  document.getElementById("statMaintenance").textContent = maintenance;
}

// Render Locker Cards
function renderLockers() {
  const grid = document.getElementById("lockerGrid");
  if (!grid) return;

  const now = Date.now();
  let filtered = lockers.filter(l => {
    // Filter Tab
    if (currentFilter === "SMALL" && l.size !== "SMALL") return false;
    if (currentFilter === "MEDIUM" && l.size !== "MEDIUM") return false;
    if (currentFilter === "LARGE" && l.size !== "LARGE") return false;
    if (currentFilter === "APPROACHING") {
      if (l.status !== "OCCUPIED" || !l.depositTime) return false;
      const elapsed = now - new Date(l.depositTime).getTime();
      if (elapsed < 20 * 60 * 60 * 1000 || elapsed >= 24 * 60 * 60 * 1000) return false;
    }
    if (currentFilter === "OVERDUE") {
      if (l.status !== "OCCUPIED" || !l.depositTime) return false;
      const elapsed = now - new Date(l.depositTime).getTime();
      if (elapsed < 24 * 60 * 60 * 1000) return false;
    }

    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = l.id.toString() === q || `locker ${l.id}`.includes(q);
      const matchName = l.depositorName && l.depositorName.toLowerCase().includes(q);
      return matchId || matchName;
    }

    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">
      <p style="font-size: 1.2rem;">No lockers match your search filter.</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(l => {
    let statusClass = l.status.toLowerCase();
    let statusText = l.status === "AVAILABLE" ? "🟢 Available" : (l.status === "OCCUPIED" ? "🔒 Occupied" : "🛠️ Maintenance");

    let durationText = "";
    if (l.status === "OCCUPIED" && l.depositTime) {
      const mins = Math.floor((now - new Date(l.depositTime).getTime()) / (1000 * 60));
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      durationText = hours > 0 ? `${hours}h ${remMins}m` : `${remMins}m`;

      if (mins >= 24 * 60) {
        statusClass = "overdue";
        statusText = "⚠️ OVERDUE (>24h)";
      } else if (mins >= 20 * 60) {
        statusClass = "approaching";
        statusText = "⏳ DUE SOON (20h+)";
      }
    }

    return `
      <div class="locker-card ${statusClass}" onclick="handleLockerClick(${l.id})">
        <div class="locker-header">
          <span class="locker-num">#${l.id < 10 ? '0' + l.id : l.id}</span>
          <span class="locker-size-badge">${l.size}</span>
        </div>
        <div class="locker-body">
          <div class="locker-status-tag">${statusText}</div>
          ${l.status === "OCCUPIED" ? `
            <div class="depositor-info">Occupant: <strong>${escapeHtml(l.depositorName)}</strong></div>
            ${durationText ? `<div class="depositor-info" style="font-size: 0.78rem; margin-top: 0.2rem;">Time: <strong>${durationText}</strong></div>` : ''}
          ` : ''}
        </div>
        <div class="locker-action-hint">
          <span>${l.status === "AVAILABLE" ? 'Tap to Deposit' : (l.status === "OCCUPIED" ? 'Tap to Retrieve' : 'Maintenance Mode')}</span>
          <span>➜</span>
        </div>
      </div>
    `;
  }).join('');
}

function populateDepositSelect() {
  const select = document.getElementById("depositLockerSelect");
  if (!select) return;

  const available = lockers.filter(l => l.status === "AVAILABLE");
  if (available.length === 0) {
    select.innerHTML = `<option value="">No lockers available</option>`;
  } else {
    select.innerHTML = available.map(l => `<option value="${l.id}">Locker #${l.id} (${l.size})</option>`).join('');
  }
}

function handleLockerClick(id) {
  const locker = lockers.find(l => l.id === id);
  if (!locker) return;

  if (locker.status === "AVAILABLE") {
    openDepositModal(id);
  } else if (locker.status === "OCCUPIED") {
    openRetrieveModal(id);
  } else {
    showToast("Locker is under maintenance", "warning");
  }
}

// Modal Handlers
function openDepositModal(lockerId = null) {
  selectedLockerId = lockerId;
  depositPin = "";
  updatePinDisplay("depositPinDisplay", depositPin);
  populateDepositSelect();

  if (lockerId) {
    const select = document.getElementById("depositLockerSelect");
    if (select) select.value = lockerId;
  }

  openModal("modalDeposit");
}

function openRetrieveModal(lockerId) {
  selectedLockerId = lockerId;
  retrievePin = "";
  updatePinDisplay("retrievePinDisplay", retrievePin);

  const title = document.getElementById("retrieveLockerTitle");
  if (title) title.textContent = `Locker #${lockerId}`;

  openModal("modalRetrieve");
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("active");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("active");
}

function updatePinDisplay(elementId, pin) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = "•".repeat(pin.length) || "••••";
  }
}

// Event Listeners
function setupEventListeners() {
  // Quick Deposit Button
  const btnDep = document.getElementById("btnDepositAny");
  if (btnDep) btnDep.addEventListener("click", () => openDepositModal());

  // Scan Retrieve Button
  const btnScan = document.getElementById("btnScanRetrieve");
  if (btnScan) btnScan.addEventListener("click", () => openModal("modalQrScan"));

  // Tab filters
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      currentFilter = e.target.dataset.filter;
      renderLockers();
    });
  });

  // Search input
  const searchInput = document.getElementById("lockerSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      renderLockers();
    });
  }

  // Close buttons
  document.querySelectorAll(".close-btn, [data-close]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const targetId = e.target.getAttribute("data-close") || e.target.closest("[data-close]")?.getAttribute("data-close");
      if (targetId) closeModal(targetId);
    });
  });

  // Keypad Handlers
  setupKeypad("depositKeypad", (val) => {
    if (depositPin.length < 4) depositPin += val;
    updatePinDisplay("depositPinDisplay", depositPin);
  }, () => {
    depositPin = "";
    updatePinDisplay("depositPinDisplay", depositPin);
  }, () => {
    depositPin = depositPin.slice(0, -1);
    updatePinDisplay("depositPinDisplay", depositPin);
  });

  setupKeypad("retrieveKeypad", (val) => {
    if (retrievePin.length < 4) retrievePin += val;
    updatePinDisplay("retrievePinDisplay", retrievePin);
  }, () => {
    retrievePin = "";
    updatePinDisplay("retrievePinDisplay", retrievePin);
  }, () => {
    retrievePin = retrievePin.slice(0, -1);
    updatePinDisplay("retrievePinDisplay", retrievePin);
  });

  // Form Deposit
  const formDeposit = document.getElementById("formDeposit");
  if (formDeposit) {
    formDeposit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const select = document.getElementById("depositLockerSelect");
      const lockerId = parseInt(select.value, 10);
      const name = document.getElementById("depositName").value.trim();
      const item = document.getElementById("depositItem").value.trim();

      if (!lockerId || !name || !item || depositPin.length !== 4) {
        showToast("Please fill all fields and enter a 4-digit PIN", "error");
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/lockers/deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId, depositorName: name, itemDesc: item, pin: depositPin })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, "success");
          closeModal("modalDeposit");
          formDeposit.reset();
          depositPin = "";
          loadLockers();
          showReceiptTicket(data.locker || { id: lockerId, depositorName: name, itemDesc: item, depositTime: new Date().toISOString() });
        } else {
          showToast(data.message, "error");
        }
      } catch (err) {
        showToast("Error connecting to server", "error");
      }
    });
  }

  // Submit Retrieve
  const btnRetrieve = document.getElementById("btnSubmitRetrieve");
  if (btnRetrieve) {
    btnRetrieve.addEventListener("click", async () => {
      if (!selectedLockerId || retrievePin.length !== 4) {
        showToast("Please enter your 4-digit PIN", "error");
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/lockers/retrieve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId, pin: retrievePin })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, "success");
          closeModal("modalRetrieve");
          retrievePin = "";
          loadLockers();
        } else {
          showToast(data.message, "error");
        }
      } catch (err) {
        showToast("Error connecting to server", "error");
      }
    });
  }

  // Manual Locker ID scan go
  const btnManualGo = document.getElementById("btnManualLockerGo");
  if (btnManualGo) {
    btnManualGo.addEventListener("click", () => {
      const input = document.getElementById("manualLockerIdInput");
      const id = parseInt(input.value, 10);
      if (id >= 1 && id <= 15) {
        closeModal("modalQrScan");
        handleLockerClick(id);
      } else {
        showToast("Enter a valid locker ID (1-15)", "error");
      }
    });
  }
}

function setupKeypad(keypadId, onNumber, onClear, onBack) {
  const keypad = document.getElementById(keypadId);
  if (!keypad) return;

  keypad.addEventListener("click", (e) => {
    const btn = e.target.closest(".key-btn");
    if (!btn) return;

    const val = btn.dataset.val;
    const action = btn.dataset.action;

    if (val !== undefined) onNumber(val);
    else if (action === "clear") onClear();
    else if (action === "back") onBack();
  });
}

function showReceiptTicket(lockerData) {
  const ticket = document.getElementById("ticketContent");
  if (!ticket) return;

  ticket.innerHTML = `
    <div class="ticket-header">
      <h3>🔐 SMART VAULT RECEIPT</h3>
      <p style="font-size: 0.75rem; color: #64748b;">Keep this ticket for retrieving your locker</p>
    </div>
    <div class="ticket-row"><span>Locker ID:</span><span>#${lockerData.id}</span></div>
    <div class="ticket-row"><span>Depositor:</span><span>${escapeHtml(lockerData.depositorName || 'User')}</span></div>
    <div class="ticket-row"><span>Date & Time:</span><span>${new Date(lockerData.depositTime || Date.now()).toLocaleString()}</span></div>
    <div class="qr-container">
      <div id="qrcode"></div>
      <p>Scan code at kiosk to retrieve</p>
    </div>
  `;

  openModal("modalTicket");

  setTimeout(() => {
    const qrDiv = document.getElementById("qrcode");
    if (qrDiv && window.QRCode) {
      qrDiv.innerHTML = "";
      new QRCode(qrDiv, {
        text: `LOCKER-${lockerData.id}-${Date.now()}`,
        width: 120,
        height: 120
      });
    }
  }, 100);
}

// Utility Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️')}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}
