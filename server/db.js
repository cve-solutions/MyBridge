// ==================== DATABASE LAYER ====================
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'mybridge.db');
const SALT_ROUNDS = 12;

// ELO-style rating constants (federation bridge style)
const DEFAULT_RATING = 1200;
const K_FACTOR_NEW = 40;    // New players (< 20 games)
const K_FACTOR_NORMAL = 20; // Normal players
const K_FACTOR_HIGH = 10;   // High-rated players (> 1800)

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

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            message TEXT NOT NULL,
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_chat_from ON chat_messages(from_user_id);
        CREATE INDEX IF NOT EXISTS idx_chat_to ON chat_messages(to_user_id);
        CREATE INDEX IF NOT EXISTS idx_chat_unread ON chat_messages(to_user_id, read);

        CREATE TABLE IF NOT EXISTS player_ratings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            rating REAL DEFAULT ${DEFAULT_RATING},
            games_played INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            peak_rating REAL DEFAULT ${DEFAULT_RATING},
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS player_profiles (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            email TEXT DEFAULT '',
            club_name TEXT DEFAULT '',
            club_code TEXT DEFAULT '',
            ffb_license TEXT DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS multiplayer_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'waiting',
            created_by INTEGER REFERENCES users(id),
            settings_json TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            ended_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS table_seats (
            table_id INTEGER REFERENCES multiplayer_tables(id) ON DELETE CASCADE,
            position TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id),
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (table_id, position)
        );

        CREATE TABLE IF NOT EXISTS table_invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id INTEGER REFERENCES multiplayer_tables(id) ON DELETE CASCADE,
            from_user_id INTEGER REFERENCES users(id),
            to_user_id INTEGER REFERENCES users(id),
            position TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS multiplayer_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id INTEGER REFERENCES multiplayer_tables(id) ON DELETE CASCADE,
            deal_number INTEGER,
            deal_json TEXT,
            contract_json TEXT,
            score_ns INTEGER,
            score_ew INTEGER,
            completed_at DATETIME
        );

        CREATE INDEX IF NOT EXISTS idx_mp_games_table ON multiplayer_games(table_id);

        CREATE TABLE IF NOT EXISTS ffb_clubs (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            city TEXT DEFAULT '',
            postal_code TEXT DEFAULT '',
            address TEXT DEFAULT '',
            department TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            slug TEXT DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_ffb_clubs_name ON ffb_clubs(name);
        CREATE INDEX IF NOT EXISTS idx_ffb_clubs_city ON ffb_clubs(city);
        CREATE INDEX IF NOT EXISTS idx_ffb_clubs_dept ON ffb_clubs(department);
    `);

    // Migration: add role column if missing
    try {
        db.prepare('SELECT role FROM users LIMIT 0').get();
    } catch (e) {
        db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    }

    // Migration: add email column if missing
    try {
        db.prepare('SELECT email FROM users LIMIT 0').get();
    } catch (e) {
        db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
    }

    // Migration: add unique indexes for email and display_name (ignore if exists)
    try {
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email != '' AND email IS NOT NULL");
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_unique ON users(display_name) WHERE display_name != '' AND display_name IS NOT NULL");
    } catch (e) { /* indexes may already exist */ }

    // Migration: recreate ffb_clubs with new schema if old schema has 'siren' column
    try {
        db.prepare('SELECT siren FROM ffb_clubs LIMIT 0').get();
        // Old schema detected — drop and recreate (data will be re-synced)
        db.exec('DROP TABLE IF EXISTS ffb_clubs');
        db.exec(`CREATE TABLE ffb_clubs (
            code TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT DEFAULT '',
            postal_code TEXT DEFAULT '', address TEXT DEFAULT '', department TEXT DEFAULT '',
            phone TEXT DEFAULT '', email TEXT DEFAULT '', slug TEXT DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('[DB] Migrated ffb_clubs table (siren → code FFB)');
    } catch (e) { /* already new schema or table doesn't exist yet */ }

    // Migration: add trick_delay column if missing (existing installs)
    try {
        db.prepare('SELECT trick_delay FROM user_settings LIMIT 0').get();
    } catch (e) {
        db.exec('ALTER TABLE user_settings ADD COLUMN trick_delay REAL DEFAULT 2.0');
    }

    // Migration: add player_ratings for existing users
    const usersWithoutRating = db.prepare(`
        SELECT u.id FROM users u LEFT JOIN player_ratings pr ON u.id = pr.user_id WHERE pr.user_id IS NULL
    `).all();
    if (usersWithoutRating.length > 0) {
        const insertRating = db.prepare('INSERT OR IGNORE INTO player_ratings (user_id) VALUES (?)');
        const tx = db.transaction(() => {
            for (const u of usersWithoutRating) {
                insertRating.run(u.id);
            }
        });
        tx();
    }

    // Create default admin account if no admin exists
    const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (!adminExists) {
        // Check if 'admin' user already exists (from before role system)
        const existingAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
        if (existingAdmin) {
            // Promote existing 'admin' user and reset password
            const adminHash = bcrypt.hashSync('admin', SALT_ROUNDS);
            db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?").run(adminHash, existingAdmin.id);
            console.log('[DB] Existing "admin" user promoted to admin role (password reset to: admin)');
        } else {
            // Create new admin account
            const adminHash = bcrypt.hashSync('admin', SALT_ROUNDS);
            const res = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', ?, 'Administrateur', 'admin')").run(adminHash);
            db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(res.lastInsertRowid);
            db.prepare('INSERT OR IGNORE INTO player_ratings (user_id) VALUES (?)').run(res.lastInsertRowid);
            console.log('[DB] Default admin account created (username: admin, password: admin)');
        }
    }

    return db;
}

function createUser(username, password, displayName, email) {
    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name, email) VALUES (?, ?, ?, ?)');
    const result = stmt.run(username, hash, displayName || username, email || '');

    // Create default settings and rating
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(result.lastInsertRowid);
    db.prepare('INSERT INTO player_ratings (user_id) VALUES (?)').run(result.lastInsertRowid);

    return result.lastInsertRowid;
}

function isUsernameTaken(username) {
    return !!db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

function isEmailTaken(email) {
    if (!email) return false;
    return !!db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND email != ''").get(email);
}

function isDisplayNameTaken(displayName) {
    if (!displayName) return false;
    return !!db.prepare("SELECT id FROM users WHERE display_name = ? COLLATE NOCASE AND display_name != ''").get(displayName);
}

function authenticateUser(username, password) {
    const stmt = db.prepare('SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?');
    const user = stmt.get(username);
    if (!user) return null;

    if (!bcrypt.compareSync(password, user.password_hash)) return null;

    // Update last login
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    return { id: user.id, username: user.username, displayName: user.display_name, role: user.role || 'user' };
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
    const validLevels = ['beginner', 'initiate', 'intermediate', 'confirmed', 'advanced', 'expert', 'master'];
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

// ==================== PLAYER LIST ====================

function getAllPlayers() {
    return db.prepare(`
        SELECT u.id, u.username, u.display_name, u.last_login,
               COALESCE(pr.rating, ${DEFAULT_RATING}) as rating,
               COALESCE(pr.games_played, 0) as games_played,
               COALESCE(pr.wins, 0) as wins,
               COALESCE(pr.peak_rating, ${DEFAULT_RATING}) as peak_rating
        FROM users u
        LEFT JOIN player_ratings pr ON u.id = pr.user_id
        ORDER BY pr.rating DESC, u.display_name ASC
    `).all();
}

// ==================== CHAT ====================

function sendMessage(fromUserId, toUserId, message) {
    const text = message.trim().slice(0, 500);
    if (!text) return null;
    const stmt = db.prepare('INSERT INTO chat_messages (from_user_id, to_user_id, message) VALUES (?, ?, ?)');
    const result = stmt.run(fromUserId, toUserId, text);
    return {
        id: result.lastInsertRowid,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        message: text,
        read: 0,
        created_at: new Date().toISOString()
    };
}

function getConversation(userId1, userId2, limit = 50) {
    return db.prepare(`
        SELECT cm.*, u.display_name as from_name
        FROM chat_messages cm
        JOIN users u ON u.id = cm.from_user_id
        WHERE (cm.from_user_id = ? AND cm.to_user_id = ?)
           OR (cm.from_user_id = ? AND cm.to_user_id = ?)
        ORDER BY cm.created_at DESC LIMIT ?
    `).all(userId1, userId2, userId2, userId1, limit).reverse();
}

function markMessagesRead(toUserId, fromUserId) {
    db.prepare('UPDATE chat_messages SET read = 1 WHERE to_user_id = ? AND from_user_id = ? AND read = 0')
        .run(toUserId, fromUserId);
}

function getUnreadCounts(userId) {
    return db.prepare(`
        SELECT from_user_id, COUNT(*) as count
        FROM chat_messages WHERE to_user_id = ? AND read = 0
        GROUP BY from_user_id
    `).all(userId);
}

// ==================== RANKINGS ====================

function getKFactor(rating, gamesPlayed) {
    if (gamesPlayed < 20) return K_FACTOR_NEW;
    if (rating > 1800) return K_FACTOR_HIGH;
    return K_FACTOR_NORMAL;
}

function getRankTitle(rating) {
    if (rating >= 2400) return 'Grand Maître';
    if (rating >= 2100) return 'Maître';
    if (rating >= 1800) return 'Expert';
    if (rating >= 1500) return 'Confirmé';
    if (rating >= 1200) return 'Intermédiaire';
    if (rating >= 1000) return 'Initié';
    return 'Débutant';
}

function updateRating(userId, won, aiLevel) {
    // AI opponent rating based on level
    const aiRatings = {
        beginner: 800,
        initiate: 1000,
        intermediate: 1200,
        confirmed: 1500,
        advanced: 1600,
        expert: 1800,
        master: 2100
    };
    const opponentRating = aiRatings[aiLevel] || 1200;

    let row = db.prepare('SELECT rating, games_played, wins, peak_rating FROM player_ratings WHERE user_id = ?').get(userId);
    if (!row) {
        db.prepare('INSERT INTO player_ratings (user_id) VALUES (?)').run(userId);
        row = { rating: DEFAULT_RATING, games_played: 0, wins: 0, peak_rating: DEFAULT_RATING };
    }

    const expected = 1 / (1 + Math.pow(10, (opponentRating - row.rating) / 400));
    const actual = won ? 1 : 0;
    const k = getKFactor(row.rating, row.games_played);
    const newRating = Math.max(100, Math.round((row.rating + k * (actual - expected)) * 10) / 10);
    const newPeak = Math.max(row.peak_rating, newRating);

    db.prepare(`
        UPDATE player_ratings
        SET rating = ?, games_played = games_played + 1, wins = wins + ?, peak_rating = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(newRating, won ? 1 : 0, newPeak, userId);

    return { rating: newRating, delta: Math.round((newRating - row.rating) * 10) / 10, title: getRankTitle(newRating) };
}

function getPlayerRating(userId) {
    const row = db.prepare('SELECT rating, games_played, wins, peak_rating FROM player_ratings WHERE user_id = ?').get(userId);
    if (!row) return { rating: DEFAULT_RATING, gamesPlayed: 0, wins: 0, peakRating: DEFAULT_RATING, title: getRankTitle(DEFAULT_RATING) };
    return {
        rating: row.rating,
        gamesPlayed: row.games_played,
        wins: row.wins,
        peakRating: row.peak_rating,
        title: getRankTitle(row.rating)
    };
}

function getRankings(limit = 50) {
    return db.prepare(`
        SELECT u.id, u.username, u.display_name,
               pr.rating, pr.games_played, pr.wins, pr.peak_rating
        FROM player_ratings pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.games_played > 0
        ORDER BY pr.rating DESC
        LIMIT ?
    `).all(limit);
}

// ==================== PLAYER PROFILE ====================

function getPlayerProfile(userId) {
    const profile = db.prepare('SELECT email, club_name, club_code, ffb_license FROM player_profiles WHERE user_id = ?').get(userId);
    const user = db.prepare('SELECT username, display_name, created_at FROM users WHERE id = ?').get(userId);
    const rating = getPlayerRating(userId);

    return {
        username: user ? user.username : '',
        displayName: user ? user.display_name : '',
        memberSince: user ? user.created_at : '',
        email: profile ? profile.email : '',
        clubName: profile ? profile.club_name : '',
        clubCode: profile ? profile.club_code : '',
        ffbLicense: profile ? profile.ffb_license : '',
        ...rating
    };
}

function savePlayerProfile(userId, profile) {
    const email = (profile.email || '').trim().slice(0, 100);
    const clubName = (profile.clubName || '').trim().slice(0, 100);
    const clubCode = (profile.clubCode || '').trim().slice(0, 20);
    const ffbLicense = (profile.ffbLicense || '').trim().slice(0, 20);

    db.prepare(`
        INSERT INTO player_profiles (user_id, email, club_name, club_code, ffb_license, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            email = excluded.email,
            club_name = excluded.club_name,
            club_code = excluded.club_code,
            ffb_license = excluded.ffb_license,
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, email, clubName, clubCode, ffbLicense);
}

function getGameHistory(userId, limit = 100) {
    return db.prepare(`
        SELECT id, deal_number, contract, declarer, tricks_made, score_ns, score_ew, played_at
        FROM game_stats
        WHERE user_id = ?
        ORDER BY played_at DESC
        LIMIT ?
    `).all(userId, limit);
}

function getGameSummary(userId) {
    const total = db.prepare('SELECT COUNT(*) as count FROM game_stats WHERE user_id = ?').get(userId);
    const won = db.prepare(`
        SELECT COUNT(*) as count FROM game_stats WHERE user_id = ? AND score_ns > 0
    `).get(userId);
    const avgScore = db.prepare('SELECT AVG(score_ns) as avg FROM game_stats WHERE user_id = ?').get(userId);
    const bestScore = db.prepare('SELECT MAX(score_ns) as best FROM game_stats WHERE user_id = ?').get(userId);
    const contracts = db.prepare(`
        SELECT contract, COUNT(*) as count,
               SUM(CASE WHEN score_ns > 0 THEN 1 ELSE 0 END) as successes
        FROM game_stats WHERE user_id = ? AND contract IS NOT NULL
        GROUP BY contract ORDER BY count DESC LIMIT 10
    `).all(userId);

    return {
        totalGames: total.count,
        gamesWon: won.count,
        winRate: total.count > 0 ? Math.round((won.count / total.count) * 100) : 0,
        averageScore: Math.round(avgScore.avg || 0),
        bestScore: bestScore.best || 0,
        favoriteContracts: contracts
    };
}

// ==================== MULTIPLAYER INVITATIONS ====================

function createInvitation(tableId, fromUserId, toUserId, position) {
    // Cancel any previous pending invitation from same person to same table+target
    db.prepare(`
        UPDATE table_invitations SET status = 'cancelled'
        WHERE table_id = ? AND from_user_id = ? AND to_user_id = ? AND status = 'pending'
    `).run(tableId, fromUserId, toUserId);

    const result = db.prepare(`
        INSERT INTO table_invitations (table_id, from_user_id, to_user_id, position)
        VALUES (?, ?, ?, ?)
    `).run(tableId, fromUserId, toUserId, position);

    return result.lastInsertRowid;
}

function respondToInvitation(invitationId, toUserId, accept) {
    const inv = db.prepare('SELECT * FROM table_invitations WHERE id = ? AND to_user_id = ? AND status = ?').get(invitationId, toUserId, 'pending');
    if (!inv) return null;
    db.prepare('UPDATE table_invitations SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', invitationId);
    return inv;
}

// ==================== ADMIN: USER MANAGEMENT ====================

function getAllUsers() {
    return db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.last_login,
               COALESCE(pr.rating, 1200) as rating,
               COALESCE(pr.games_played, 0) as games_played
        FROM users u
        LEFT JOIN player_ratings pr ON u.id = pr.user_id
        ORDER BY u.created_at DESC
    `).all();
}

function setUserRole(userId, role) {
    const valid = ['user', 'admin'];
    if (!valid.includes(role)) return false;
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    return true;
}

function deleteUser(userId) {
    // Don't allow deleting the last admin
    const admins = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (user && user.role === 'admin' && admins.count <= 1) return false;

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return true;
}

function isAdmin(userId) {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    return user && user.role === 'admin';
}

// ==================== FFB CLUBS ====================

function searchClubs(query, limit = 20) {
    const q = `%${query}%`;
    return db.prepare(`
        SELECT code, name, city, postal_code, department
        FROM ffb_clubs
        WHERE name LIKE ? OR city LIKE ? OR postal_code LIKE ? OR code LIKE ?
        ORDER BY name ASC
        LIMIT ?
    `).all(q, q, q, q, limit);
}

function getClubCount() {
    const row = db.prepare('SELECT COUNT(*) as count FROM ffb_clubs').get();
    return row ? row.count : 0;
}

function upsertClubs(clubs) {
    const stmt = db.prepare(`
        INSERT INTO ffb_clubs (code, name, city, postal_code, address, department, phone, email, slug, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(code) DO UPDATE SET
            name = excluded.name,
            city = excluded.city,
            postal_code = excluded.postal_code,
            address = excluded.address,
            department = excluded.department,
            phone = excluded.phone,
            email = excluded.email,
            slug = excluded.slug,
            updated_at = CURRENT_TIMESTAMP
    `);
    const tx = db.transaction(() => {
        for (const c of clubs) {
            stmt.run(c.code, c.name, c.city, c.postalCode, c.address, c.department, c.phone || '', c.email || '', c.slug || '');
        }
    });
    tx();
}

function getClubSyncInfo() {
    const count = getClubCount();
    const row = db.prepare('SELECT MAX(updated_at) as last_sync FROM ffb_clubs').get();
    return { count, lastSync: row ? row.last_sync : null };
}

// ==================== APP CONFIG ====================

function getConfig(key, defaultValue = '') {
    const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

function setConfig(key, value) {
    db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function getOllamaConfig() {
    return {
        url: getConfig('ollama_url', 'http://localhost:11434'),
        model: getConfig('ollama_model', ''),
        enabled: getConfig('ollama_enabled', 'false') === 'true'
    };
}

function setOllamaConfig(config) {
    if (config.url !== undefined) setConfig('ollama_url', config.url);
    if (config.model !== undefined) setConfig('ollama_model', config.model);
    if (config.enabled !== undefined) setConfig('ollama_enabled', config.enabled ? 'true' : 'false');
}

function close() {
    if (db) db.close();
}

module.exports = {
    init, createUser, authenticateUser, isUsernameTaken, isEmailTaken, isDisplayNameTaken,
    getUserSettings, saveUserSettings,
    saveGameResult, getUserStats,
    getAllPlayers, sendMessage, getConversation, markMessagesRead, getUnreadCounts,
    updateRating, getPlayerRating, getRankings, getRankTitle,
    getPlayerProfile, savePlayerProfile, getGameHistory, getGameSummary,
    searchClubs, getClubCount, upsertClubs, getClubSyncInfo,
    getAllUsers, setUserRole, deleteUser, isAdmin,
    getConfig, setConfig, getOllamaConfig, setOllamaConfig,
    createInvitation, respondToInvitation,
    close
};
