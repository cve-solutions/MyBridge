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
    const { username, password, displayName } = req.body;

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

    try {
        const userId = db.createUser(username, password, displayName || username);
        req.session.userId = userId;
        req.session.username = username;
        res.json({ success: true, user: { id: userId, username, displayName: displayName || username } });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
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

db.init();

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
gm.init(db, wsClients);

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
