// ==================== MYBRIDGE SERVER ====================

// Load .env file if present (no external dependency)
const fs = require('fs');
const envPath = require('path').join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');
const db = require('./db');
const gm = require('./gameManager');
const dds = require('./dds');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const app = express();

// ==================== MIDDLEWARE ====================

if (TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "ws:", "wss:"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session store using better-sqlite3 (no deprecated dependencies)
class BetterSqliteStore extends session.Store {
    constructor(options = {}) {
        super();
        const dbPath = path.join(options.dir || __dirname, options.db || 'sessions.db');
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expired INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
        `);
        // Cleanup expired sessions every 15 minutes
        this._cleanup = setInterval(() => {
            this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
        }, 15 * 60 * 1000);
    }

    get(sid, cb) {
        try {
            const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
            cb(null, row ? JSON.parse(row.sess) : null);
        } catch (e) { cb(e); }
    }

    set(sid, sess, cb) {
        try {
            const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
            const expired = Date.now() + maxAge;
            this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
            cb(null);
        } catch (e) { cb(e); }
    }

    destroy(sid, cb) {
        try {
            this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            cb(null);
        } catch (e) { cb(e); }
    }

    close() {
        clearInterval(this._cleanup);
        this.db.close();
    }
}

const sessionStore = new BetterSqliteStore({
    dir: path.join(__dirname, 'data'),
    db: 'sessions.db'
});

// Session
app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: TRUST_PROXY,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax'
    },
    name: 'mybridge.sid'
}));

// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== AUTH MIDDLEWARE ====================

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
    }
    if (!db.isAdmin(req.session.userId)) {
        return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    }
    next();
}

// ==================== STATIC FILES ====================

// Serve login page for unauthenticated users
app.get('/', (req, res, next) => {
    if (!req.session.userId) {
        return res.sendFile(path.join(__dirname, '..', 'login.html'));
    }
    next();
});

// Protect game files behind auth
app.get('/index.html', (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '..'), {
    index: false // We handle / route ourselves
}));

// Serve game page for authenticated users accessing /
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ==================== AUTH ROUTES ====================

app.post('/api/register', authLimiter, (req, res) => {
    const { username, password, displayName, email } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }

    if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ error: 'Le nom d\'utilisateur doit faire entre 3 et 30 caractères.' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res.status(400).json({ error: 'Le nom d\'utilisateur ne peut contenir que lettres, chiffres, - et _.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Format d\'email invalide.' });
    }

    // Check uniqueness before insert (clear error messages)
    if (db.isUsernameTaken(username)) {
        return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
    }
    if (email && db.isEmailTaken(email)) {
        return res.status(409).json({ error: 'Cet email est déjà utilisé par un autre compte.' });
    }
    const finalDisplayName = displayName || username;
    if (db.isDisplayNameTaken(finalDisplayName)) {
        return res.status(409).json({ error: 'Ce nom d\'affichage est déjà utilisé par un autre joueur.' });
    }

    try {
        const userId = db.createUser(username, password, finalDisplayName, email);
        req.session.userId = userId;
        req.session.username = username;
        res.json({ success: true, user: { id: userId, username, displayName: finalDisplayName } });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Ce nom d\'utilisateur ou email est déjà pris.' });
        }
        console.error('Register error:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

app.post('/api/login', authLimiter, (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }

    const user = db.authenticateUser(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    res.json({ success: true, user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la déconnexion.' });
        }
        res.clearCookie('mybridge.sid');
        res.json({ success: true });
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    const isAdm = db.isAdmin(req.session.userId);
    res.json({ id: req.session.userId, username: req.session.username, role: isAdm ? 'admin' : 'user' });
});

// ==================== SETTINGS ROUTES ====================

app.get('/api/settings', apiLimiter, requireAuth, (req, res) => {
    const settings = db.getUserSettings(req.session.userId);
    res.json(settings);
});

app.put('/api/settings', apiLimiter, requireAuth, (req, res) => {
    db.saveUserSettings(req.session.userId, req.body);
    res.json({ success: true });
});

// ==================== GAME STATS ROUTES ====================

app.post('/api/games', apiLimiter, requireAuth, (req, res) => {
    db.saveGameResult(req.session.userId, req.body);
    res.json({ success: true });
});

app.get('/api/stats', apiLimiter, requireAuth, (req, res) => {
    const stats = db.getUserStats(req.session.userId);
    res.json(stats);
});

// ==================== PLAYER LIST + RANKINGS ====================

app.get('/api/players', apiLimiter, requireAuth, (req, res) => {
    const players = db.getAllPlayers();
    // Add online status
    const result = players.map(p => ({
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        lastLogin: p.last_login,
        rating: Math.round(p.rating),
        gamesPlayed: p.games_played,
        wins: p.wins,
        peakRating: Math.round(p.peak_rating),
        online: onlineUsers.has(p.id),
        inGame: inGameUsers.has(p.id)
    }));
    res.json(result);
});

app.get('/api/rankings', apiLimiter, requireAuth, (req, res) => {
    const rankings = db.getRankings();
    res.json(rankings.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        displayName: r.display_name,
        rating: Math.round(r.rating),
        gamesPlayed: r.games_played,
        wins: r.wins,
        peakRating: Math.round(r.peak_rating),
        title: db.getRankTitle(r.rating)
    })));
});

app.get('/api/my-rating', apiLimiter, requireAuth, (req, res) => {
    const rating = db.getPlayerRating(req.session.userId);
    res.json(rating);
});

app.post('/api/update-rating', apiLimiter, requireAuth, (req, res) => {
    const { won, aiLevel } = req.body;
    const result = db.updateRating(req.session.userId, !!won, aiLevel || 'intermediate');
    res.json(result);
});

// ==================== PLAYER PROFILE ====================

app.get('/api/profile', apiLimiter, requireAuth, (req, res) => {
    const profile = db.getPlayerProfile(req.session.userId);
    res.json(profile);
});

app.put('/api/profile', apiLimiter, requireAuth, (req, res) => {
    db.savePlayerProfile(req.session.userId, req.body);
    res.json({ success: true });
});

app.get('/api/game-history', apiLimiter, requireAuth, (req, res) => {
    const history = db.getGameHistory(req.session.userId);
    const summary = db.getGameSummary(req.session.userId);
    res.json({ history, summary });
});

// ==================== CHAT ====================

app.get('/api/chat/:userId', apiLimiter, requireAuth, (req, res) => {
    const otherUserId = parseInt(req.params.userId);
    if (isNaN(otherUserId)) return res.status(400).json({ error: 'ID invalide' });
    db.markMessagesRead(req.session.userId, otherUserId);
    const messages = db.getConversation(req.session.userId, otherUserId);
    res.json(messages);
});

app.post('/api/chat/:userId', apiLimiter, requireAuth, (req, res) => {
    const otherUserId = parseInt(req.params.userId);
    if (isNaN(otherUserId)) return res.status(400).json({ error: 'ID invalide' });
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message vide' });

    const msg = db.sendMessage(req.session.userId, otherUserId, message);
    if (!msg) return res.status(400).json({ error: 'Erreur envoi' });

    // Real-time delivery via WebSocket
    const targetWs = wsClients.get(otherUserId);
    if (targetWs && targetWs.readyState === 1) {
        const fromUser = db.getAllPlayers().find(p => p.id === req.session.userId);
        targetWs.send(JSON.stringify({
            type: 'chat_message',
            message: {
                ...msg,
                from_name: fromUser ? fromUser.display_name : 'Inconnu'
            }
        }));
    }

    res.json(msg);
});

app.get('/api/chat-unread', apiLimiter, requireAuth, (req, res) => {
    const unread = db.getUnreadCounts(req.session.userId);
    res.json(unread);
});

// ==================== MULTIPLAYER ROUTES ====================

// List active tables
app.get('/api/tables', apiLimiter, requireAuth, (req, res) => {
    res.json(gm.getTableList());
});

// Create a new table
app.post('/api/tables', apiLimiter, requireAuth, (req, res) => {
    const { convention, scoring } = req.body;
    const result = gm.createTable(req.session.userId, req.session.username, { convention, scoring });
    if (result.error) return res.status(400).json(result);
    gm.broadcastTableList();
    res.json(result);
});

// Join a table by code
app.post('/api/tables/join', apiLimiter, requireAuth, (req, res) => {
    const { code, position } = req.body;
    if (!code || !position) return res.status(400).json({ error: 'Code et position requis.' });
    const result = gm.joinTable(req.session.userId, req.session.username, code, position);
    if (result.error) return res.status(400).json(result);
    gm.broadcastTableList();
    res.json(result);
});

// Join as observer
app.post('/api/tables/:id/observe', apiLimiter, requireAuth, (req, res) => {
    const tableId = parseInt(req.params.id);
    if (isNaN(tableId)) return res.status(400).json({ error: 'ID invalide.' });
    const result = gm.joinAsObserver(req.session.userId, tableId);
    if (result.error) return res.status(400).json(result);
    res.json(result);
});

// Leave a table
app.post('/api/tables/:id/leave', apiLimiter, requireAuth, (req, res) => {
    const tableId = parseInt(req.params.id);
    gm.leaveTable(req.session.userId, tableId);
    gm.broadcastTableList();
    res.json({ success: true });
});

// Start the game at a table
app.post('/api/tables/:id/start', apiLimiter, requireAuth, (req, res) => {
    const tableId = parseInt(req.params.id);
    if (isNaN(tableId)) return res.status(400).json({ error: 'ID invalide.' });
    const result = gm.startGame(req.session.userId, tableId);
    if (result.error) return res.status(400).json(result);
    gm.broadcastTableList();
    res.json(result);
});

// Get table state
app.get('/api/tables/:id', apiLimiter, requireAuth, (req, res) => {
    const tableId = parseInt(req.params.id);
    const table = gm.getTable(tableId);
    if (!table) return res.status(404).json({ error: 'Table introuvable.' });
    res.json(table.serializeForClient(req.session.userId));
});

// Send invitation
app.post('/api/tables/:id/invite', apiLimiter, requireAuth, (req, res) => {
    const tableId = parseInt(req.params.id);
    const { toUserId, position } = req.body;
    if (!toUserId) return res.status(400).json({ error: 'Joueur cible requis.' });

    const table = gm.getTable(tableId);
    if (!table) return res.status(404).json({ error: 'Table introuvable.' });
    if (table.getUserPosition(req.session.userId) === null && table.createdBy !== req.session.userId) {
        return res.status(403).json({ error: 'Vous ne pouvez inviter que depuis votre table.' });
    }

    const invitationId = db.createInvitation(tableId, req.session.userId, toUserId, position || null);

    // Real-time notification
    const fromUser = db.getAllPlayers().find(p => p.id === req.session.userId);
    gm.sendToUser(toUserId, {
        type: 'table_invitation',
        invitationId,
        fromUser: { id: req.session.userId, name: fromUser ? fromUser.display_name : 'Inconnu' },
        tableId,
        tableCode: table.code,
        position: position || null
    });

    res.json({ success: true, invitationId });
});

// Respond to invitation
app.post('/api/invitations/:id/respond', apiLimiter, requireAuth, (req, res) => {
    const invId = parseInt(req.params.id);
    const { accept } = req.body;
    const inv = db.respondToInvitation(invId, req.session.userId, !!accept);
    if (!inv) return res.status(404).json({ error: 'Invitation introuvable.' });

    if (accept && inv.position) {
        const result = gm.joinTable(req.session.userId, req.session.username, '', inv.position, inv.table_id);
        // Fallback: join by table ID directly
        const table = gm.getTable(inv.table_id);
        if (table && table.seats[inv.position] === null) {
            table.seats[inv.position] = req.session.userId;
            table.seatNames[inv.position] = req.session.username;
            db.prepare('INSERT OR REPLACE INTO table_seats (table_id, position, user_id) VALUES (?, ?, ?)').run(inv.table_id, inv.position, req.session.userId);
            gm.broadcastTableList();
        }
        return res.json({ success: true, tableId: inv.table_id });
    }
    res.json({ success: true });
});

// ==================== WEBSOCKET ====================

// Track online users and their WebSocket connections
const onlineUsers = new Set();   // user IDs
const inGameUsers = new Set();   // user IDs currently in a game
const wsClients = new Map();     // userId -> ws

function broadcastOnlineStatus() {
    const onlineList = Array.from(onlineUsers);
    const inGameList = Array.from(inGameUsers);
    const msg = JSON.stringify({ type: 'online_status', online: onlineList, inGame: inGameList });
    for (const [, ws] of wsClients) {
        if (ws.readyState === 1) ws.send(msg);
    }
}

// ==================== FFB CLUBS ====================

// Search clubs (local DB)
app.get('/api/clubs/search', apiLimiter, requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const results = db.searchClubs(q);
    res.json(results);
});

// Club sync info
// ==================== OLLAMA / LLM ====================

// Score each model for bridge analysis suitability (higher = better)
function _scoreBridgeModels(models) {
    if (!models.length) return '';

    // Extract parameter count from parameter_size string like "14B", "7.6B", "70B"
    function parseParams(paramStr) {
        if (!paramStr) return 0;
        const m = paramStr.match(/([\d.]+)\s*([BMK])/i);
        if (!m) return 0;
        const val = parseFloat(m[1]);
        const unit = m[2].toUpperCase();
        if (unit === 'B') return val;
        if (unit === 'M') return val / 1000;
        if (unit === 'K') return val / 1e6;
        return val;
    }

    // Families/architectures known for good reasoning & multilingual
    const familyBonus = {
        'qwen2': 25, 'qwen2.5': 30, 'qwen3': 35,
        'llama': 15, 'llama3': 20, 'llama3.1': 22, 'llama3.2': 22, 'llama4': 25,
        'gemma': 12, 'gemma2': 18, 'gemma3': 22,
        'mistral': 15, 'mixtral': 20,
        'phi': 10, 'phi3': 14, 'phi4': 18,
        'command-r': 20, 'deepseek': 22, 'deepseek-r1': 28,
        'yi': 12
    };

    // Name patterns that indicate bad fit (code-only, vision-only, embedding)
    const penaltyPatterns = [
        /\bcode\b/i, /\bcoder\b/i, /\bembed/i, /\bvision\b/i,
        /\bstarcoder/i, /\bcodellama/i, /\bsqlcoder/i
    ];

    // Name patterns that indicate good fit for reasoning/chat
    const bonusPatterns = [
        /\binstruct\b/i, /\bchat\b/i, /\bthink\b/i, /\breason\b/i
    ];

    const scored = models.map(m => {
        let score = 0;
        const name = m.name.toLowerCase();
        const params = parseParams(m.paramSize);

        // 1. Size score (bigger = better reasoning, capped at 70B for speed)
        if (params > 0) {
            if (params >= 30) score += 40;      // 30B+ excellent
            else if (params >= 14) score += 35;  // 14B+ very good
            else if (params >= 7) score += 25;   // 7B+ good
            else if (params >= 3) score += 15;   // 3B+ acceptable
            else score += 5;                     // <3B weak
            // Penalty for very large (too slow for interactive use)
            if (params > 70) score -= 10;
        } else {
            // Guess from file size (1B params ≈ 0.5-1 Go on disk)
            const sizeGo = m.sizeBytes / 1e9;
            if (sizeGo >= 15) score += 35;
            else if (sizeGo >= 5) score += 25;
            else if (sizeGo >= 2) score += 15;
            else score += 5;
        }

        // 2. Family bonus (known good architectures)
        for (const [fam, bonus] of Object.entries(familyBonus)) {
            if (m.family.toLowerCase().includes(fam) || name.includes(fam.replace('.', ''))) {
                score += bonus;
                break;
            }
        }

        // 3. Quantization (prefer higher quality)
        const quant = (m.quantization || '').toUpperCase();
        if (quant.includes('F16') || quant.includes('FP16')) score += 10;
        else if (quant.includes('Q8')) score += 8;
        else if (quant.includes('Q6')) score += 6;
        else if (quant.includes('Q5')) score += 4;
        else if (quant.includes('Q4')) score += 2;
        else if (quant.includes('Q3') || quant.includes('Q2')) score -= 5;

        // 4. Name-based bonuses/penalties
        if (penaltyPatterns.some(p => p.test(name))) score -= 20;
        if (bonusPatterns.some(p => p.test(name))) score += 5;

        // 5. Multilingual bonus (these models handle French well)
        if (/qwen|gemma|llama|mistral|mixtral|command|aya/.test(name)) score += 5;

        return { name: m.name, score };
    });

    scored.sort((a, b) => b.score - a.score);

    console.log('[LLM] Model scores:', scored.map(s => `${s.name}=${s.score}`).join(', '));
    return scored[0]?.name || models[0]?.name || '';
}

// Get Ollama config (any user can check if enabled)
app.get('/api/llm/status', apiLimiter, requireAuth, (req, res) => {
    const config = db.getOllamaConfig();
    res.json({ enabled: config.enabled, model: config.model });
});

// Admin: get full config
app.get('/api/admin/ollama', apiLimiter, requireAdmin, (req, res) => {
    res.json(db.getOllamaConfig());
});

// Admin: save config
app.put('/api/admin/ollama', apiLimiter, requireAdmin, (req, res) => {
    db.setOllamaConfig(req.body);
    res.json({ success: true });
});

// Admin: test connection + list models
app.post('/api/admin/ollama/test', apiLimiter, requireAdmin, async (req, res) => {
    const url = (req.body.url || 'http://localhost:11434').replace(/\/+$/, '');
    try {
        const tagRes = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!tagRes.ok) return res.json({ success: false, error: `Ollama a répondu ${tagRes.status}` });
        const data = await tagRes.json();
        const models = (data.models || []).map(m => ({
            name: m.name,
            size: m.size ? Math.round(m.size / 1e9 * 10) / 10 + ' Go' : '?',
            sizeBytes: m.size || 0,
            family: m.details?.family || '',
            paramSize: m.details?.parameter_size || '',
            quantization: m.details?.quantization_level || ''
        }));

        // Intelligent model scoring for bridge analysis
        const recommended = _scoreBridgeModels(models);
        res.json({ success: true, models, recommended });
    } catch (e) {
        res.json({ success: false, error: e.message || 'Connexion impossible' });
    }
});

// User: request LLM analysis for a deal
app.post('/api/llm/analyze', apiLimiter, requireAuth, async (req, res) => {
    const config = db.getOllamaConfig();
    if (!config.enabled || !config.model) {
        return res.status(400).json({ error: 'Analyse IA non activée.' });
    }

    const { hands, bidding, contract, tricks, vulnerability, humanPos } = req.body;
    if (!hands) return res.status(400).json({ error: 'Données de la donne requises.' });

    // Build the prompt
    const suitSym = { C: '♣', D: '♦', H: '♥', S: '♠' };
    const rankFR = { J: 'V', Q: 'D', K: 'R', A: 'A' };
    const posFR = { N: 'Nord', E: 'Est', S: 'Sud', W: 'Ouest' };

    function formatHand(cards) {
        const suits = ['S', 'H', 'D', 'C'];
        return suits.map(s => {
            const sc = (cards || []).filter(c => c.suit === s).sort((a, b) => b.value - a.value);
            return suitSym[s] + ' ' + (sc.map(c => rankFR[c.rank] || c.rank).join(' ') || '—');
        }).join('  ');
    }

    let prompt = `En tant que Grand Maître de Bridge, analysez cette donne de façon pédagogique en français.

## Les 4 mains
`;
    for (const pos of ['N', 'E', 'S', 'W']) {
        const h = hands[pos] || [];
        const hcp = h.reduce((s, c) => s + ({ A: 4, K: 3, Q: 2, J: 1 }[c.rank] || 0), 0);
        prompt += `${posFR[pos]}: ${formatHand(h)} (${hcp} HCP)\n`;
    }

    prompt += `\nVulnérabilité: ${vulnerability || 'Personne'}\n`;
    prompt += `Le joueur humain est en ${posFR[humanPos] || 'Sud'}.\n`;

    if (bidding && bidding.length > 0) {
        prompt += `\n## Enchères jouées\n`;
        for (const b of bidding) {
            prompt += `${posFR[b.player]}: ${b.text}\n`;
        }
    }

    if (contract) {
        prompt += `\nContrat final: ${contract}\n`;
    }

    if (tricks && tricks.length > 0) {
        prompt += `\n## Jeu de la carte (levées)\n`;
        for (let i = 0; i < tricks.length; i++) {
            const t = tricks[i];
            prompt += `Levée ${i + 1}: `;
            for (const p of ['W', 'N', 'E', 'S']) {
                if (t[p]) prompt += `${posFR[p]}=${t[p]} `;
            }
            if (t.winner) prompt += `→ ${posFR[t.winner]}`;
            prompt += '\n';
        }
    }

    prompt += `
## Consignes
1. **Enchères** : Expliquez ce que le Maître aurait enchéri et pourquoi (en citant les HCP, la distribution, les conventions).
2. **Jeu de la carte** : Expliquez l'entame idéale, les impasses à tenter, le plan de jeu du déclarant, la stratégie de défense.
3. **Conseils** : Donnez 2-3 conseils concrets pour que le joueur s'améliore sur cette donne.
Soyez précis, pédagogique, et utilisez le vocabulaire bridge français.`;

    try {
        const url = config.url.replace(/\/+$/, '');
        const ollamaRes = await fetch(`${url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model,
                prompt: prompt,
                stream: false,
                options: { temperature: 0.3, num_predict: 2000 }
            }),
            signal: AbortSignal.timeout(60000)
        });

        if (!ollamaRes.ok) {
            return res.status(502).json({ error: `Ollama erreur ${ollamaRes.status}` });
        }

        const data = await ollamaRes.json();
        res.json({ analysis: data.response || 'Pas de réponse.' });
    } catch (e) {
        console.error('[LLM] Error:', e.message);
        res.status(502).json({ error: 'Erreur de communication avec Ollama: ' + e.message });
    }
});

// ==================== DOUBLE-DUMMY SOLVER ====================

app.post('/api/dds', apiLimiter, requireAuth, (req, res) => {
    const { hands } = req.body;
    if (!hands) return res.status(400).json({ error: 'Mains requises.' });

    try {
        const Card = require('../js/bridge.js').Card;
        const reconstructed = {};
        for (const pos of ['N', 'E', 'S', 'W']) {
            reconstructed[pos] = (hands[pos] || []).map(c => new Card(c.suit, c.rank));
        }

        // Only solve the 5 strains for each declarer (fast: heuristic fallback on timeout)
        const ddTable = dds.calcDDTable(reconstructed);
        const vulnerability = req.body.vulnerability || 'None';
        const par = dds.calcPar(ddTable, vulnerability);

        res.json({ ddTable, par });
    } catch (e) {
        console.error('[DDS] Error:', e.message);
        res.status(500).json({ error: 'Erreur de calcul.' });
    }
});

// ==================== ADMIN ROUTES ====================

// List all users
app.get('/api/admin/users', apiLimiter, requireAdmin, (req, res) => {
    res.json(db.getAllUsers());
});

// Change user role
app.put('/api/admin/users/:id/role', apiLimiter, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'Rôle requis.' });
    if (userId === req.session.userId && role !== 'admin') {
        return res.status(400).json({ error: 'Vous ne pouvez pas vous retirer le rôle admin.' });
    }
    db.setUserRole(userId, role);
    res.json({ success: true });
});

// Delete user
app.delete('/api/admin/users/:id', apiLimiter, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId === req.session.userId) {
        return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    const ok = db.deleteUser(userId);
    if (!ok) return res.status(400).json({ error: 'Impossible de supprimer cet utilisateur.' });
    res.json({ success: true });
});

app.get('/api/admin/clubs', apiLimiter, requireAdmin, (req, res) => {
    res.json(db.getClubSyncInfo());
});

// Trigger manual club sync (any authenticated user for now)
app.post('/api/admin/clubs/sync', apiLimiter, requireAdmin, async (req, res) => {
    try {
        const count = await syncFFBClubs();
        res.json({ success: true, count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fetch all bridge clubs from API and store locally
async function syncFFBClubs() {
    const allClubs = [];
    let page = 1;
    const perPage = 25;

    console.log('[FFB Sync] Starting club sync...');

    while (true) {
        const url = `https://recherche-entreprises.api.gouv.fr/search?q=bridge+club&per_page=${perPage}&page=${page}&etat_administratif=A`;
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[FFB Sync] API error on page ${page}: ${response.status}`);
            break;
        }
        const data = await response.json();
        const results = data.results || [];
        if (results.length === 0) break;

        for (const r of results) {
            allClubs.push({
                siren: r.siren || '',
                name: r.nom_complet || '',
                city: r.siege?.libelle_commune || '',
                postalCode: r.siege?.code_postal || '',
                address: r.siege?.adresse || '',
                department: r.siege?.departement || ''
            });
        }

        if (results.length < perPage) break;
        page++;
        // Respectful rate: 200ms between pages
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (allClubs.length > 0) {
        db.upsertClubs(allClubs);
    }

    console.log(`[FFB Sync] Done: ${allClubs.length} clubs synced.`);
    return allClubs.length;
}

// Auto-sync clubs weekly (every Sunday at 3am)
function scheduleWeeklyClubSync() {
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    // Next Sunday 3am
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()) % 7);
    nextSunday.setHours(3, 0, 0, 0);
    if (nextSunday <= now) nextSunday.setDate(nextSunday.getDate() + 7);

    const delay = nextSunday - now;
    setTimeout(() => {
        syncFFBClubs().catch(e => console.error('[FFB Sync] Auto-sync error:', e.message));
        setInterval(() => {
            syncFFBClubs().catch(e => console.error('[FFB Sync] Auto-sync error:', e.message));
        }, ONE_WEEK);
    }, delay);

    console.log(`[FFB Sync] Next auto-sync scheduled for ${nextSunday.toISOString()}`);
}

// ==================== START ====================

const sqliteDb = db.init();

// Auto-sync clubs on first start if DB is empty, then schedule weekly
const clubInfo = db.getClubSyncInfo();
if (clubInfo.count === 0) {
    console.log('[FFB Sync] No clubs in DB, triggering initial sync...');
    syncFFBClubs().catch(e => console.error('[FFB Sync] Initial sync error:', e.message));
}
scheduleWeeklyClubSync();

const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`MyBridge server running on http://127.0.0.1:${PORT}`);
});

// WebSocket server shares the HTTP server
const wss = new WebSocketServer({ server });

// Initialize game manager with DB and wsClients (injected after wss setup)
// gm.init() is called after wsClients is populated (see below)

// Parse session from WebSocket upgrade request
wss.on('connection', (ws, req) => {
    // Parse cookies to find session ID
    const cookies = {};
    if (req.headers.cookie) {
        for (const part of req.headers.cookie.split(';')) {
            const [k, ...v] = part.trim().split('=');
            cookies[k] = decodeURIComponent(v.join('='));
        }
    }

    const sidRaw = cookies['mybridge.sid'];
    if (!sidRaw) { ws.close(); return; }

    // Decode signed cookie (express-session uses s: prefix)
    let sid = sidRaw;
    if (sid.startsWith('s:')) {
        const val = sid.slice(2);
        const dot = val.indexOf('.');
        if (dot !== -1) {
            const unsigned = val.slice(0, dot);
            const sig = val.slice(dot + 1);
            const expected = crypto.createHmac('sha256', SESSION_SECRET).update(unsigned).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
            if (sig === expected) {
                sid = unsigned;
            } else {
                ws.close(); return;
            }
        }
    }

    // Look up session
    sessionStore.get(sid, (err, session) => {
        if (err || !session || !session.userId) {
            ws.close(); return;
        }

        const userId = session.userId;
        ws.userId = userId;

        // Register
        wsClients.set(userId, ws);
        onlineUsers.add(userId);
        broadcastOnlineStatus();

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'enter_game') {
                    inGameUsers.add(userId);
                    broadcastOnlineStatus();
                } else if (msg.type === 'leave_game') {
                    inGameUsers.delete(userId);
                    broadcastOnlineStatus();
                } else if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));

                // ---- Multiplayer game actions ----
                } else if (msg.type === 'table_bid') {
                    const result = gm.processHumanBid(userId, msg.tableId, msg.bid);
                    if (result.error) ws.send(JSON.stringify({ type: 'table_error', error: result.error }));

                } else if (msg.type === 'table_play') {
                    const result = gm.processHumanPlay(userId, msg.tableId, msg.card);
                    if (result.error) ws.send(JSON.stringify({ type: 'table_error', error: result.error }));

                } else if (msg.type === 'table_claim') {
                    const result = gm.processHumanClaim(userId, msg.tableId);
                    if (result.error) ws.send(JSON.stringify({ type: 'table_error', error: result.error }));

                } else if (msg.type === 'table_next_deal') {
                    gm.startNextDeal(userId, msg.tableId);

                } else if (msg.type === 'table_get_state') {
                    const table = gm.getTable(msg.tableId);
                    if (table) {
                        ws.send(JSON.stringify({
                            type: 'table_game_state',
                            tableId: msg.tableId,
                            state: table.serializeForClient(userId)
                        }));
                    }
                }
            } catch (e) { /* ignore invalid messages */ }
        });

        ws.on('close', () => {
            wsClients.delete(userId);
            onlineUsers.delete(userId);
            inGameUsers.delete(userId);
            broadcastOnlineStatus();
            // Notify game manager of disconnection (seat becomes AI temporarily)
            // Tables will keep running with AI for that seat
        });
    });
});

// Initialize game manager now that wsClients map exists
gm.init(sqliteDb, wsClients);

// Graceful shutdown
function shutdown() {
    console.log('Shutting down...');
    wss.close();
    server.close(() => {
        sessionStore.close();
        db.close();
        process.exit(0);
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
