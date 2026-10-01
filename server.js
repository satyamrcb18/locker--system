require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// JWT Verification Middleware
function verifyJwt(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Access denied. Token missing." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: "Invalid or expired JWT token." });
  }
}

// Serve static frontend files from 'public' and 'admin'
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

/* ==========================================================================
   API ENDPOINTS
   ========================================================================== */

// 1. Get stats overview
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Get all lockers status
app.get('/api/lockers', (req, res) => {
  try {
    const lockers = db.getLockers();
    res.json({ success: true, lockers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Deposit Item into Locker
app.post('/api/lockers/deposit', (req, res) => {
  const { lockerId, depositorName, itemDesc, pin } = req.body;

  if (!lockerId || !depositorName || !itemDesc || !pin) {
    return res.status(400).json({ success: false, message: "All fields are required (lockerId, depositorName, itemDesc, pin)" });
  }

  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ success: false, message: "PIN must be exactly 4 digits" });
  }

  const result = db.depositLocker(lockerId, depositorName, itemDesc, pin);
  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// 4. Retrieve Item from Locker
app.post('/api/lockers/retrieve', (req, res) => {
  const { lockerId, pin } = req.body;

  if (!lockerId || !pin) {
    return res.status(400).json({ success: false, message: "Locker ID and PIN are required" });
  }

  const result = db.retrieveLocker(lockerId, pin);
  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// 5. Admin Login
app.post('/api/admin/login', (req, res) => {
  const { pin, username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'satyam';
  const adminPass = process.env.ADMIN_PASS || 'SatyamLockerAdmin2026!';

  let isValid = false;
  if (username && password) {
    isValid = (username === adminUser && password === adminPass);
  } else if (pin) {
    isValid = db.verifyAdminPin(pin);
  }

  if (!isValid) {
    db.addLog(0, "ADMIN_LOGIN_FAIL", "Failed admin login attempt");
    return res.status(401).json({ success: false, message: "Invalid credentials or Master Admin PIN" });
  }

  const token = jwt.sign(
    { role: process.env.ADMIN_ROLE || 'SUPER_ADMIN', username: username || 'admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  db.addLog(0, "ADMIN_LOGIN", "Master Admin authenticated via JWT");
  res.json({
    success: true,
    message: "Admin authenticated successfully",
    token: token,
    username: username || 'admin',
    role: process.env.ADMIN_ROLE || 'SUPER_ADMIN',
    isDefault: db.getStats().adminIsDefault
  });
});

// 6. Admin Change PIN
app.post('/api/admin/change-pin', (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!currentPin || !newPin) {
    return res.status(400).json({ success: false, message: "Current PIN and New PIN are required" });
  }

  if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
    return res.status(400).json({ success: false, message: "New PIN must be exactly 4 digits" });
  }

  const result = db.changeAdminPin(currentPin, newPin);
  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// 7. Admin Force Unlock Locker
app.post('/api/admin/unlock', (req, res) => {
  const { adminPin, lockerId } = req.body;
  if (!adminPin || !lockerId) {
    return res.status(400).json({ success: false, message: "Admin PIN and Locker ID are required" });
  }

  if (!db.verifyAdminPin(adminPin)) {
    return res.status(401).json({ success: false, message: "Unauthorized Admin PIN" });
  }

  const result = db.forceUnlock(lockerId);
  res.json(result);
});

// 8. Admin Toggle Maintenance Mode
app.post('/api/admin/maintenance', (req, res) => {
  const { adminPin, lockerId } = req.body;
  if (!adminPin || !lockerId) {
    return res.status(400).json({ success: false, message: "Admin PIN and Locker ID are required" });
  }

  if (!db.verifyAdminPin(adminPin)) {
    return res.status(401).json({ success: false, message: "Unauthorized Admin PIN" });
  }

  const result = db.toggleMaintenance(lockerId);
  res.json(result);
});

// 9. Get Audit Logs
app.get('/api/logs', (req, res) => {
  try {
    const logs = db.getLogs();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Fallback to index.html for main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Smart Locker System Server running on port ${PORT}`);
  console.log(`📱 User App:  http://localhost:${PORT}/`);
  console.log(`⚡ Admin App: http://localhost:${PORT}/admin/admin.html`);
  console.log(`====================================================`);
});
