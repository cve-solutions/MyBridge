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
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

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
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: path.join(__dirname, 'data')
    }),
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
    res.json({ id: req.session.userId, username: req.session.username });
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

// ==================== START ====================

db.init();

const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`MyBridge server running on http://127.0.0.1:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => {
        db.close();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close(() => {
        db.close();
        process.exit(0);
    });
});
