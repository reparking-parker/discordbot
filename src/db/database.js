const Database = require('better-sqlite3');

let db;

function initDb(dbPath = './database.sqlite') {
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      threshold_type TEXT DEFAULT 'fixed',
      threshold_value INTEGER DEFAULT 5,
      poll_duration_seconds INTEGER DEFAULT 300,
      user_cooldown_seconds INTEGER DEFAULT 600
    );

    CREATE TABLE IF NOT EXISTS user_cooldowns (
      guild_id TEXT,
      user_id TEXT,
      last_used_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS active_mutes (
      guild_id TEXT,
      user_id TEXT,
      unmute_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
}

function getGuildSettings(guildId) {
  const row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    return {
      threshold_type: 'fixed',
      threshold_value: 5,
      poll_duration_seconds: 300,
      user_cooldown_seconds: 600
    };
  }
  return row;
}

function updateGuildSetting(guildId, key, value) {
  const allowedKeys = ['threshold_type', 'threshold_value', 'poll_duration_seconds', 'user_cooldown_seconds'];
  if (!allowedKeys.includes(key)) throw new Error('Invalid setting key');

  db.prepare(`
    INSERT INTO guild_settings (guild_id, ${key}) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET ${key} = excluded.${key}
  `).run(guildId, value);
}

function checkUserCooldown(guildId, userId, cooldownSeconds) {
  const row = db.prepare('SELECT last_used_at FROM user_cooldowns WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!row) return true;
  const now = Math.floor(Date.now() / 1000);
  return (now - row.last_used_at) >= cooldownSeconds;
}

function updateUserCooldown(guildId, userId) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO user_cooldowns (guild_id, user_id, last_used_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET last_used_at = excluded.last_used_at
  `).run(guildId, userId, now);
}

function saveActiveMute(guildId, userId, unmuteAtTimestamp) {
  db.prepare(`
    INSERT INTO active_mutes (guild_id, user_id, unmute_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET unmute_at = excluded.unmute_at
  `).run(guildId, userId, unmuteAtTimestamp);
}

function removeActiveMute(guildId, userId) {
  db.prepare('DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function getPendingMutes() {
  return db.prepare('SELECT * FROM active_mutes').all();
}

module.exports = { initDb, getGuildSettings, updateGuildSetting, checkUserCooldown, updateUserCooldown, saveActiveMute, removeActiveMute, getPendingMutes };
