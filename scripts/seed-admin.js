const db = require('../db');

console.log("==========================================");
console.log("   Smart Locker System - Seed Admin Script  ");
console.log("==========================================");

try {
  db.initDefaults();
  console.log("✅ Admin configuration seeded successfully.");
  console.log("🔑 Default Master Admin PIN: 9999");
  console.log("📁 Database file created/reset at db_store.json");
} catch (err) {
  console.error("❌ Failed to seed admin configuration:", err);
  process.exit(1);
}
