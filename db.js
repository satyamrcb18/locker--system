const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'db_store.json');

// Default initial 15 lockers configuration
function createDefaultLockers() {
  const lockers = [];
  for (let i = 1; i <= 15; i++) {
    let size = "SMALL";
    if (i > 5 && i <= 11) size = "MEDIUM";
    else if (i > 11) size = "LARGE";

    lockers.push({
      id: i,
      size: size,
      status: "AVAILABLE", // AVAILABLE, OCCUPIED, MAINTENANCE
      depositorName: "",
      itemDesc: "",
      pinHash: "",
      salt: "",
      depositTime: null,
      failedAttempts: 0,
      lockoutUntil: null,
      qrToken: ""
    });
  }
  return lockers;
}

// Generate default admin configuration
function generateSalt(len = 16) {
  return crypto.randomBytes(len).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

function createDefaultAdminConfig() {
  const salt = generateSalt();
  // Default PIN: 9999
  const pinHash = hashPin('9999', salt);
  return {
    salt: salt,
    pinHash: pinHash,
    isFactoryDefault: true,
    lastUpdated: new Date().toISOString()
  };
}

class StorageDB {
  constructor() {
    this.data = {
      lockers: [],
      adminConfig: null,
      auditLogs: [],
      analytics: []
    };
    this.load();
  }

  load() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
      } catch (err) {
        console.error("Error reading database file, initializing defaults:", err);
        this.initDefaults();
      }
    } else {
      this.initDefaults();
    }
  }

  initDefaults() {
    this.data = {
      lockers: createDefaultLockers(),
      adminConfig: createDefaultAdminConfig(),
      auditLogs: [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          lockerId: 0,
          action: "SYSTEM_INIT",
          details: "Locker Backend Server & Storage Database initialized"
        }
      ],
      analytics: []
    };
    this.save();
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error("Failed to write to database file:", err);
    }
  }

  // --- Locker Operations ---
  getLockers() {
    return this.data.lockers;
  }

  getLockerById(id) {
    const lockerId = parseInt(id, 10);
    return this.data.lockers.find(l => l.id === lockerId);
  }

  depositLocker(lockerId, name, itemDesc, pin) {
    const locker = this.getLockerById(lockerId);
    if (!locker) return { success: false, message: "Locker not found" };
    if (locker.status !== "AVAILABLE") return { success: false, message: "Locker is not available" };

    const salt = generateSalt();
    const pinHash = hashPin(pin, salt);
    const depositTime = new Date().toISOString();
    const qrToken = `LOCKER-${locker.id}-${Date.now()}`;

    locker.status = "OCCUPIED";
    locker.depositorName = name;
    locker.itemDesc = itemDesc;
    locker.salt = salt;
    locker.pinHash = pinHash;
    locker.depositTime = depositTime;
    locker.failedAttempts = 0;
    locker.lockoutUntil = null;
    locker.qrToken = qrToken;

    this.addLog(locker.id, "DEPOSIT", `Item deposited by ${name}: "${itemDesc}"`);
    this.save();

    return {
      success: true,
      message: `Item successfully deposited into Locker #${locker.id}`,
      locker: {
        id: locker.id,
        size: locker.size,
        depositorName: locker.depositorName,
        depositTime: locker.depositTime,
        qrToken: locker.qrToken
      }
    };
  }

  retrieveLocker(lockerId, pin) {
    const locker = this.getLockerById(lockerId);
    if (!locker) return { success: false, message: "Locker not found" };
    if (locker.status !== "OCCUPIED") return { success: false, message: "Locker is not occupied" };

    // Check lockout
    if (locker.lockoutUntil && new Date(locker.lockoutUntil) > new Date()) {
      const remainingSecs = Math.ceil((new Date(locker.lockoutUntil) - new Date()) / 1000);
      return { success: false, message: `Locker locked due to repeated invalid PIN attempts. Try again in ${remainingSecs} seconds.` };
    }

    // Verify PIN
    const testHash = hashPin(pin, locker.salt);
    if (testHash !== locker.pinHash) {
      locker.failedAttempts = (locker.failedAttempts || 0) + 1;
      this.addLog(locker.id, "RETRIEVE_FAILED", `Invalid PIN attempt (${locker.failedAttempts}/3)`);

      if (locker.failedAttempts >= 3) {
        // Lockout for 5 minutes
        locker.lockoutUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        this.addLog(locker.id, "LOCKOUT", `Locker locked out for 5 minutes due to 3 invalid PIN attempts`);
      }
      this.save();
      return { success: false, message: "Incorrect PIN entered" };
    }

    // Calculate duration & analytics
    const depositDate = new Date(locker.depositTime);
    const durationMs = Date.now() - depositDate.getTime();
    this.recordAnalytics(locker.size, durationMs, locker.depositTime);

    const depositor = locker.depositorName;
    const item = locker.itemDesc;

    // Reset locker state
    locker.status = "AVAILABLE";
    locker.depositorName = "";
    locker.itemDesc = "";
    locker.pinHash = "";
    locker.salt = "";
    locker.depositTime = null;
    locker.failedAttempts = 0;
    locker.lockoutUntil = null;
    locker.qrToken = "";

    this.addLog(locker.id, "RETRIEVE_SUCCESS", `Item "${item}" retrieved by ${depositor}`);
    this.save();

    return {
      success: true,
      message: `Locker #${locker.id} retrieved successfully! Thank you.`,
      durationMs: durationMs
    };
  }

  // --- Admin Operations ---
  verifyAdminPin(pin) {
    if (!this.data.adminConfig) return false;
    const testHash = hashPin(pin, this.data.adminConfig.salt);
    return testHash === this.data.adminConfig.pinHash;
  }

  changeAdminPin(oldPin, newPin) {
    if (!this.verifyAdminPin(oldPin)) {
      return { success: false, message: "Current admin PIN is incorrect" };
    }

    const salt = generateSalt();
    const pinHash = hashPin(newPin, salt);
    this.data.adminConfig = {
      salt: salt,
      pinHash: pinHash,
      isFactoryDefault: false,
      lastUpdated: new Date().toISOString()
    };
    this.addLog(0, "ADMIN_PIN_CHANGE", "Admin Master PIN updated successfully");
    this.save();
    return { success: true, message: "Admin PIN changed successfully" };
  }

  forceUnlock(lockerId) {
    const locker = this.getLockerById(lockerId);
    if (!locker) return { success: false, message: "Locker not found" };

    const item = locker.itemDesc || "None";
    const depositor = locker.depositorName || "N/A";

    locker.status = "AVAILABLE";
    locker.depositorName = "";
    locker.itemDesc = "";
    locker.pinHash = "";
    locker.salt = "";
    locker.depositTime = null;
    locker.failedAttempts = 0;
    locker.lockoutUntil = null;
    locker.qrToken = "";

    this.addLog(locker.id, "FORCE_UNLOCK", `Admin force unlocked locker. Vacated item: "${item}" belonging to ${depositor}`);
    this.save();
    return { success: true, message: `Locker #${locker.id} has been force unlocked & vacated.` };
  }

  toggleMaintenance(lockerId) {
    const locker = this.getLockerById(lockerId);
    if (!locker) return { success: false, message: "Locker not found" };

    if (locker.status === "MAINTENANCE") {
      locker.status = "AVAILABLE";
      this.addLog(locker.id, "MAINTENANCE_OFF", `Locker returned to service (AVAILABLE)`);
    } else {
      locker.status = "MAINTENANCE";
      this.addLog(locker.id, "MAINTENANCE_ON", `Locker placed under maintenance`);
    }
    this.save();
    return { success: true, status: locker.status, message: `Locker #${locker.id} status updated to ${locker.status}` };
  }

  // --- Audit Logs ---
  addLog(lockerId, action, details) {
    const log = {
      id: this.data.auditLogs.length + 1,
      timestamp: new Date().toISOString(),
      lockerId: lockerId,
      action: action,
      details: details
    };
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs.pop();
    }
  }

  getLogs() {
    return this.data.auditLogs;
  }

  // --- Analytics ---
  recordAnalytics(size, durationMs, depositTimestamp) {
    this.data.analytics.push({
      size: size,
      durationMs: durationMs,
      depositTime: depositTimestamp,
      timestamp: new Date().toISOString()
    });
    if (this.data.analytics.length > 500) {
      this.data.analytics.shift();
    }
  }

  getStats() {
    const total = this.data.lockers.length;
    let available = 0, occupied = 0, maintenance = 0, approaching = 0, overdue = 0;
    const now = Date.now();

    this.data.lockers.forEach(l => {
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

    return {
      total,
      available,
      occupied,
      maintenance,
      approaching,
      overdue,
      adminIsDefault: this.data.adminConfig ? this.data.adminConfig.isFactoryDefault : true
    };
  }
}

module.exports = new StorageDB();
