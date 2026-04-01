// ==================== DATABASE LAYER ====================
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'mybridge.db');
const SALT_ROUNDS = 12;

let db;

function init() {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            seat TEXT DEFAULT 'S',
            level TEXT DEFAULT 'intermediate',
            convention TEXT DEFAULT 'sef',
            scoring TEXT DEFAULT 'duplicate',
            trick_delay REAL DEFAULT 2.0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS game_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            deal_number INTEGER,
            contract TEXT,
            declarer TEXT,
            tricks_made INTEGER,
            score_ns INTEGER,
            score_ew INTEGER,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_game_stats_user ON game_stats(user_id);
    `);

    // Migration: add trick_delay column if missing (existing installs)
    try {
        db.prepare('SELECT trick_delay FROM user_settings LIMIT 0').get();
    } catch (e) {
        db.exec('ALTER TABLE user_settings ADD COLUMN trick_delay REAL DEFAULT 2.0');
    }

    return db;
}

function createUser(username, password, displayName) {
    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)');
    const result = stmt.run(username, hash, displayName || username);

    // Create default settings
    const settingsStmt = db.prepare('INSERT INTO user_settings (user_id) VALUES (?)');
    settingsStmt.run(result.lastInsertRowid);

    return result.lastInsertRowid;
}

function authenticateUser(username, password) {
    const stmt = db.prepare('SELECT id, username, password_hash, display_name FROM users WHERE username = ?');
    const user = stmt.get(username);
    if (!user) return null;

    if (!bcrypt.compareSync(password, user.password_hash)) return null;

    // Update last login
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    return { id: user.id, username: user.username, displayName: user.display_name };
}

function getUserSettings(userId) {
    const stmt = db.prepare('SELECT seat, level, convention, scoring, trick_delay FROM user_settings WHERE user_id = ?');
    const row = stmt.get(userId);
    if (!row) return { seat: 'S', level: 'intermediate', convention: 'sef', scoring: 'duplicate', trickDelay: 2 };
    return { seat: row.seat, level: row.level, convention: row.convention, scoring: row.scoring, trickDelay: row.trick_delay || 2 };
}

function saveUserSettings(userId, settings) {
    const allowed = ['seat', 'level', 'convention', 'scoring'];
    const validSeats = ['N', 'E', 'S', 'W'];
    const validLevels = ['beginner', 'intermediate', 'advanced', 'expert'];
    const validConventions = ['sef', 'sayc', '2over1', 'acol', 'standard'];
    const validScoring = ['duplicate', 'rubber'];

    const seat = validSeats.includes(settings.seat) ? settings.seat : 'S';
    const level = validLevels.includes(settings.level) ? settings.level : 'intermediate';
    const convention = validConventions.includes(settings.convention) ? settings.convention : 'sef';
    const scoring = validScoring.includes(settings.scoring) ? settings.scoring : 'duplicate';
    const trickDelay = Math.max(1, Math.min(10, parseFloat(settings.trickDelay) || 2));

    const stmt = db.prepare(`
        INSERT INTO user_settings (user_id, seat, level, convention, scoring, trick_delay, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            seat = excluded.seat,
            level = excluded.level,
            convention = excluded.convention,
            scoring = excluded.scoring,
            trick_delay = excluded.trick_delay,
            updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(userId, seat, level, convention, scoring, trickDelay);
}

function saveGameResult(userId, result) {
    const stmt = db.prepare(`
        INSERT INTO game_stats (user_id, deal_number, contract, declarer, tricks_made, score_ns, score_ew)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId, result.dealNumber, result.contract, result.declarer, result.tricksMade, result.scoreNS, result.scoreEW);
}

function getUserStats(userId) {
    const total = db.prepare('SELECT COUNT(*) as count FROM game_stats WHERE user_id = ?').get(userId);
    const avgScore = db.prepare('SELECT AVG(score_ns) as avg FROM game_stats WHERE user_id = ?').get(userId);
    const recent = db.prepare(`
        SELECT contract, declarer, tricks_made, score_ns, score_ew, played_at
        FROM game_stats WHERE user_id = ? ORDER BY played_at DESC LIMIT 10
    `).all(userId);

    return {
        totalGames: total.count,
        averageScore: Math.round(avgScore.avg || 0),
        recentGames: recent
    };
}

function close() {
    if (db) db.close();
}

module.exports = { init, createUser, authenticateUser, getUserSettings, saveUserSettings, saveGameResult, getUserStats, close };
