const bcrypt = require("bcrypt");
const { db, run, get } = require("./database");

async function initDatabase() {
  await run("PRAGMA foreign_keys = ON");

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      soyad TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','admin','manager')),
      demo_password TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ad_soyad TEXT,
      blok TEXT NOT NULL CHECK(blok IN ('A','B','C','D','E','F')),
      kategori TEXT NOT NULL CHECK(kategori IN ('Ariza','Tadilat')),
      alt_kategori TEXT NOT NULL,
      aciliyet TEXT NOT NULL CHECK(aciliyet IN ('Normal','Acil')),
      aciklama TEXT,
      attachment_path TEXT,
      durum TEXT NOT NULL DEFAULT 'Bekleniyor' CHECK(durum IN ('Bekleniyor','Islemde','Cozuldu')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_duration INTEGER CHECK(resolved_duration >= 0),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      comment TEXT NOT NULL CHECK(LENGTH(TRIM(comment)) > 0 AND LENGTH(comment) <= 1000),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES requests(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id
    ON ticket_comments(ticket_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','status_changed','commented','file_uploaded','closed')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES requests(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id
    ON ticket_history(ticket_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      old_status TEXT NOT NULL CHECK(old_status IN ('Bekleniyor','Islemde','Cozuldu')),
      new_status TEXT NOT NULL CHECK(new_status IN ('Bekleniyor','Islemde','Cozuldu')),
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES requests(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_status_history_ticket_id
    ON status_history(ticket_id, changed_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON notifications(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read
    ON notifications(user_id, is_read)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      ip_address TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_system_logs_created_at
    ON system_logs(created_at)
  `);

  const requestColumns = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(requests)", [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });

  const hasAdSoyadColumn = requestColumns.some((col) => col.name === "ad_soyad");
  if (!hasAdSoyadColumn) {
    await run("ALTER TABLE requests ADD COLUMN ad_soyad TEXT");
  }

  const hasAttachmentPathColumn = requestColumns.some((col) => col.name === "attachment_path");
  if (!hasAttachmentPathColumn) {
    await run("ALTER TABLE requests ADD COLUMN attachment_path TEXT");
  }

  const hasResolvedAtColumn = requestColumns.some((col) => col.name === "resolved_at");
  if (!hasResolvedAtColumn) {
    await run("ALTER TABLE requests ADD COLUMN resolved_at DATETIME");
  }

  const hasResolvedDurationColumn = requestColumns.some((col) => col.name === "resolved_duration");
  if (!hasResolvedDurationColumn) {
    await run("ALTER TABLE requests ADD COLUMN resolved_duration INTEGER");
  }

  await run(`
    UPDATE requests
    SET ad_soyad = (
      SELECT u.ad || ' ' || u.soyad
      FROM users u
      WHERE u.id = requests.user_id
    )
    WHERE ad_soyad IS NULL OR TRIM(ad_soyad) = ''
  `);

  await run(`
    UPDATE requests
    SET resolved_at = COALESCE(
      (
        SELECT MIN(sh.changed_at)
        FROM status_history sh
        WHERE sh.ticket_id = requests.id AND sh.new_status = 'Cozuldu'
      ),
      (
        SELECT MIN(h.created_at)
        FROM ticket_history h
        WHERE h.ticket_id = requests.id AND h.action = 'closed'
      )
    )
    WHERE durum = 'Cozuldu' AND (resolved_at IS NULL OR TRIM(CAST(resolved_at AS TEXT)) = '')
  `);

  await run(`
    UPDATE requests
    SET resolved_duration = CASE
      WHEN (strftime('%s', resolved_at) - strftime('%s', created_at)) < 0 THEN 0
      ELSE CAST(strftime('%s', resolved_at) - strftime('%s', created_at) AS INTEGER)
    END
    WHERE durum = 'Cozuldu'
      AND resolved_at IS NOT NULL
      AND (resolved_duration IS NULL OR TRIM(CAST(resolved_duration AS TEXT)) = '')
  `);

  const usersCount = await get("SELECT COUNT(*) AS count FROM users");
  if (usersCount.count > 0) {
    return;
  }

  const seedUsers = [
    {
      ad: "Demo",
      soyad: "Admin",
      username: "admin",
      password: "admin123",
      role: "admin",
    },
    {
      ad: "Demo",
      soyad: "Mudur",
      username: "manager",
      password: "manager123",
      role: "manager",
    },
    {
      ad: "Demo",
      soyad: "Ogretmen",
      username: "teacher",
      password: "teacher123",
      role: "user",
    },
  ];

  for (const user of seedUsers) {
    const hashed = await bcrypt.hash(user.password, 10);
    await run(
      `
      INSERT INTO users (ad, soyad, username, password, role, demo_password)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [user.ad, user.soyad, user.username, hashed, user.role, user.password]
    );
  }
}

module.exports = {
  initDatabase,
};
