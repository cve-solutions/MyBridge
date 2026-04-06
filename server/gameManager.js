// ==================== MULTIPLAYER GAME MANAGER ====================

const bridge = require('../js/bridge.js');
const { BridgeAI } = require('../js/ai.js');

const {
    GameState, BiddingManager, Trick, Card, Bid,
    POSITIONS, nextPos, partnerOf, teamOf,
    getVulnerability, getDealer,
    SUIT_SYMBOLS, RANK_DISPLAY
} = bridge;

// ==================== TABLE STATE ====================

class TableState {
    constructor(tableId, code, createdBy, settings = {}) {
        this.tableId = tableId;
        this.code = code;
        this.createdBy = createdBy;
        this.settings = {
            convention: settings.convention || 'sef',
            scoring: settings.scoring || 'duplicate',
            trickDelay: settings.trickDelay || 2
        };
        this.seats = { N: null, E: null, S: null, W: null }; // userId | null
        this.seatNames = { N: 'IA', E: 'IA', S: 'IA', W: 'IA' }; // display names
        this.observers = new Set();
        this.status = 'waiting'; // waiting, playing, finished
        this.gameState = null;
        this.dealNumber = 1;
        this.totalScore = { NS: 0, EW: 0 };
        this.ai = new BridgeAI({ level: 'intermediate', convention: this.settings.convention });
        this._aiTimers = {};
        this._pendingNextDeal = false;
    }

    getHumanPositions() {
        return POSITIONS.filter(p => this.seats[p] !== null);
    }

    isAIPosition(pos) {
        return this.seats[pos] === null;
    }

    getUserPosition(userId) {
        for (const pos of POSITIONS) {
            if (this.seats[pos] === userId) return pos;
        }
        return null;
    }

    getFilledSeats() {
        return POSITIONS.filter(p => this.seats[p] !== null).length;
    }

    serializeForClient(forUserId = null) {
        return {
            tableId: this.tableId,
            code: this.code,
            createdBy: this.createdBy,
            settings: { ...this.settings },
            seats: { ...this.seats },
            seatNames: { ...this.seatNames },
            observers: Array.from(this.observers),
            status: this.status,
            dealNumber: this.dealNumber,
            totalScore: { ...this.totalScore },
            myPosition: forUserId ? this.getUserPosition(forUserId) : null,
            gameState: this.gameState ? this._serializeGameState(forUserId) : null
        };
    }

    _serializeGameState(forUserId = null) {
        const gs = this.gameState;
        if (!gs) return null;

        const myPos = forUserId ? this.getUserPosition(forUserId) : null;
        const dummyPos = gs.contract ? gs.contract.dummy : null;
        const phase = gs.phase;

        // Determine which hands to reveal
        const revealHands = {};
        for (const pos of POSITIONS) {
            // Reveal: own hand, dummy during play/scoring, all during scoring
            revealHands[pos] = (pos === myPos) ||
                (phase === 'playing' && pos === dummyPos) ||
                (phase === 'scoring');
        }

        const handsData = {};
        for (const pos of POSITIONS) {
            handsData[pos] = revealHands[pos]
                ? gs.hands[pos].map(c => ({ suit: c.suit, rank: c.rank }))
                : gs.hands[pos].map(() => null); // hidden cards
        }

        const originalHandsData = {};
        for (const pos of POSITIONS) {
            originalHandsData[pos] = gs.originalHands[pos]
                ? (phase === 'scoring' || pos === myPos
                    ? gs.originalHands[pos].map(c => ({ suit: c.suit, rank: c.rank }))
                    : gs.originalHands[pos].map(() => null))
                : [];
        }

        return {
            phase: gs.phase,
            dealer: gs.dealer,
            vulnerability: gs.vulnerability,
            dealNumber: gs.dealNumber,
            hands: handsData,
            originalHands: originalHandsData,
            bidding: gs.bidding ? {
                bids: gs.bidding.bids.map(b => ({
                    type: b.type, level: b.level, suit: b.suit, player: b.player
                })),
                currentBidder: gs.bidding.currentBidder,
                isComplete: gs.bidding.isComplete,
                contract: gs.bidding.contract,
                doubled: gs.bidding.doubled,
                redoubled: gs.bidding.redoubled
            } : null,
            contract: gs.contract,
            tricksWon: { ...gs.tricksWon },
            tricks: gs.tricks.map(t => ({
                leader: t.leader,
                trump: t.trump,
                cards: Object.fromEntries(
                    Object.entries(t.cards).map(([p, c]) => [p, { suit: c.suit, rank: c.rank }])
                ),
                order: [...t.order],
                suitLed: t.suitLed,
                winner: t.getWinner()
            })),
            currentTrick: gs.currentTrick ? {
                leader: gs.currentTrick.leader,
                trump: gs.currentTrick.trump,
                cards: Object.fromEntries(
                    Object.entries(gs.currentTrick.cards).map(([p, c]) => [p, { suit: c.suit, rank: c.rank }])
                ),
                order: [...gs.currentTrick.order],
                suitLed: gs.currentTrick.suitLed,
                currentPlayer: gs.currentTrick.currentPlayer
            } : null,
            totalScore: { ...this.totalScore }
        };
    }
}

// ==================== GLOBAL STATE ====================

const activeTables = new Map(); // tableId -> TableState
let _wsClients = null;
let _db = null;

function init(db, wsClients) {
    _db = db;
    _wsClients = wsClients;
    _loadTablesFromDB();
}

function _loadTablesFromDB() {
    let rows;
    try {
        rows = _db.prepare(`
            SELECT id, code, status, created_by, settings_json
            FROM multiplayer_tables WHERE status IN ('waiting', 'playing')
        `).all();
    } catch (e) {
        console.warn('Could not load tables from DB (table may not exist yet):', e.message);
        return;
    }

    for (const row of rows) {
        let settings = {};
        try { settings = JSON.parse(row.settings_json || '{}'); } catch (e) { /* corrupted */ }
        const table = new TableState(row.id, row.code, row.created_by, settings);
        table.status = row.status;

        const seats = _db.prepare('SELECT position, user_id FROM table_seats WHERE table_id = ?').all(row.id);
        for (const seat of seats) {
            table.seats[seat.position] = seat.user_id;
        }

        activeTables.set(row.id, table);
    }
}

// ==================== BROADCAST HELPERS ====================

function _broadcastToTable(table, message) {
    if (!_wsClients) return;
    const msg = JSON.stringify(message);
    const userIds = [
        ...POSITIONS.map(p => table.seats[p]).filter(id => id !== null),
        ...table.observers
    ];
    for (const userId of userIds) {
        const ws = _wsClients.get(userId);
        if (ws && ws.readyState === 1) ws.send(msg);
    }
}

function sendToUser(userId, message) {
    if (!_wsClients) return;
    const ws = _wsClients.get(userId);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

// ==================== TABLE MANAGEMENT ====================

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (Array.from(activeTables.values()).some(t => t.code === code));
    return code;
}

function createTable(userId, username, settings = {}) {
    const code = generateCode();
    const settingsJson = JSON.stringify({
        convention: settings.convention || 'sef',
        scoring: settings.scoring || 'duplicate'
    });

    const result = _db.prepare(`
        INSERT INTO multiplayer_tables (code, status, created_by, settings_json)
        VALUES (?, 'waiting', ?, ?)
    `).run(code, userId, settingsJson);

    const tableId = result.lastInsertRowid;
    const table = new TableState(tableId, code, userId, settings);
    activeTables.set(tableId, table);

    return { success: true, table: table.serializeForClient(userId) };
}

function joinTable(userId, username, code, position) {
    const table = Array.from(activeTables.values()).find(t => t.code === code.toUpperCase().trim());
    if (!table) return { error: 'Table introuvable. Vérifiez le code.' };
    if (table.status !== 'waiting') return { error: "Cette table n'accepte plus de joueurs." };
    if (!POSITIONS.includes(position)) return { error: 'Position invalide.' };
    if (table.seats[position] !== null) return { error: 'Cette place est déjà prise.' };
    if (table.getUserPosition(userId) !== null) return { error: 'Vous êtes déjà à cette table.' };

    table.seats[position] = userId;
    table.seatNames[position] = username;
    _db.prepare('INSERT OR REPLACE INTO table_seats (table_id, position, user_id) VALUES (?, ?, ?)').run(table.tableId, position, userId);

    // Notify all players at the table
    _broadcastToTable(table, {
        type: 'table_updated',
        tableId: table.tableId,
        seats: { ...table.seats },
        seatNames: { ...table.seatNames },
        status: table.status
    });

    return { success: true, table: table.serializeForClient(userId) };
}

function joinAsObserver(userId, tableId) {
    const table = activeTables.get(tableId);
    if (!table) return { error: 'Table introuvable.' };
    if (table.getUserPosition(userId) !== null) return { error: 'Vous êtes déjà joueur à cette table.' };
    table.observers.add(userId);

    // Send current game state to observer
    sendToUser(userId, {
        type: 'table_game_state',
        tableId: table.tableId,
        state: table.serializeForClient(null)
    });

    return { success: true };
}

function leaveTable(userId, tableId) {
    const table = activeTables.get(tableId);
    if (!table) return;

    const pos = table.getUserPosition(userId);
    if (pos) {
        table.seats[pos] = null;
        table.seatNames[pos] = 'IA';
        _db.prepare('DELETE FROM table_seats WHERE table_id = ? AND position = ?').run(tableId, pos);

        _broadcastToTable(table, {
            type: 'table_player_left',
            tableId,
            position: pos,
            seats: { ...table.seats },
            seatNames: { ...table.seatNames }
        });

        // If game is in progress and it was this player's turn, trigger AI to take over
        if (table.status === 'playing' && table.gameState) {
            const gs = table.gameState;
            const isTheirTurn = (gs.phase === 'bidding' && gs.bidding && gs.bidding.currentBidder === pos) ||
                (gs.phase === 'playing' && gs.currentTrick && gs.currentTrick.currentPlayer === pos);
            if (isTheirTurn) {
                _processNextAction(table);
            }
        }
    }
    table.observers.delete(userId);

    // Clean up waiting tables with no players
    if (table.getFilledSeats() === 0 && table.status === 'waiting') {
        activeTables.delete(tableId);
        _db.prepare('DELETE FROM multiplayer_tables WHERE id = ?').run(tableId);
    }
}

// ==================== GAME FLOW ====================

function startGame(userId, tableId) {
    const table = activeTables.get(tableId);
    if (!table) return { error: 'Table introuvable.' };
    if (table.createdBy !== userId) return { error: 'Seul le créateur peut démarrer la partie.' };
    if (table.status === 'playing') return { error: 'Partie déjà en cours.' };
    if (table.getFilledSeats() < 1) return { error: 'Au moins 1 joueur requis.' };

    table.status = 'playing';
    _db.prepare('UPDATE multiplayer_tables SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?').run('playing', tableId);

    _startDeal(table);
    return { success: true };
}

function _startDeal(table) {
    // Cancel pending timers
    for (const key of Object.keys(table._aiTimers)) {
        clearTimeout(table._aiTimers[key]);
    }
    table._aiTimers = {};
    table._pendingNextDeal = false;

    const fakeSettings = { seat: 'S', convention: table.settings.convention, scoring: table.settings.scoring };
    table.gameState = new GameState(fakeSettings);
    table.gameState.dealNumber = table.dealNumber;
    table.gameState.startDeal();

    // Notify each player with their personalized view
    for (const pos of POSITIONS) {
        const uid = table.seats[pos];
        if (uid !== null) {
            sendToUser(uid, {
                type: 'table_game_state',
                tableId: table.tableId,
                state: table.serializeForClient(uid)
            });
        }
    }
    // Observers get full state
    for (const uid of table.observers) {
        sendToUser(uid, {
            type: 'table_game_state',
            tableId: table.tableId,
            state: table.serializeForClient(null)
        });
    }

    _processNextAction(table);
}

function _processNextAction(table) {
    const gs = table.gameState;
    if (!gs) return;

    if (gs.phase === 'bidding' && !gs.bidding.isComplete) {
        const bidder = gs.bidding.currentBidder;
        if (table.isAIPosition(bidder)) {
            table._aiTimers['bid'] = setTimeout(() => {
                delete table._aiTimers['bid'];
                _executeAIBid(table, bidder);
            }, 700);
        }
        // Human turn: wait for client message

    } else if (gs.phase === 'playing') {
        const currentPlayer = gs.currentTrick ? gs.currentTrick.currentPlayer : null;
        if (currentPlayer && table.isAIPosition(currentPlayer)) {
            table._aiTimers['play'] = setTimeout(() => {
                delete table._aiTimers['play'];
                _executeAIPlay(table, currentPlayer);
            }, 700);
        }
    }
}

function _executeAIBid(table, pos) {
    const gs = table.gameState;
    if (!gs || gs.phase !== 'bidding' || gs.bidding.isComplete) return;

    const bid = table.ai.makeBid(gs, pos);
    gs.bidding.placeBid(bid);

    _broadcastToTable(table, {
        type: 'table_bid_placed',
        tableId: table.tableId,
        bid: { type: bid.type, level: bid.level, suit: bid.suit, player: bid.player },
        biddingComplete: gs.bidding.isComplete,
        contract: gs.bidding.contract,
        currentBidder: gs.bidding.isComplete ? null : gs.bidding.currentBidder
    });

    if (gs.bidding.isComplete) {
        _finalizeBidding(table);
    } else {
        _processNextAction(table);
    }
}

function _finalizeBidding(table) {
    const gs = table.gameState;
    const contract = gs.bidding.contract;

    if (!contract) {
        gs.phase = 'scoring';
        _broadcastToTable(table, {
            type: 'table_deal_complete',
            tableId: table.tableId,
            passedOut: true,
            score: { ns: 0, ew: 0, details: [] },
            totalScore: { ...table.totalScore },
            dealNumber: table.dealNumber
        });
        return;
    }

    gs.contract = contract;

    table._aiTimers['finalize'] = setTimeout(() => {
        delete table._aiTimers['finalize'];
        gs.startPlay();
        _broadcastToTable(table, {
            type: 'table_play_started',
            tableId: table.tableId,
            contract: gs.contract,
            leader: nextPos(gs.contract.declarer),
            currentTrick: {
                leader: gs.currentTrick.leader,
                trump: gs.currentTrick.trump,
                cards: {},
                order: [],
                suitLed: null,
                currentPlayer: gs.currentTrick.currentPlayer
            }
        });
        _processNextAction(table);
    }, 1500);
}

function _executeAIPlay(table, pos) {
    const gs = table.gameState;
    if (!gs || gs.phase !== 'playing') return;
    const card = table.ai.playCard(gs, pos);
    _applyCardPlay(table, pos, card);
}

function _applyCardPlay(table, pos, card) {
    const gs = table.gameState;
    const result = gs.playCard(pos, card);

    _broadcastToTable(table, {
        type: 'table_card_played',
        tableId: table.tableId,
        position: pos,
        card: { suit: card.suit, rank: card.rank },
        trickComplete: !!result.trickWinner,
        trickWinner: result.trickWinner,
        tricksWon: { ...gs.tricksWon },
        gameComplete: result.complete,
        newTrick: result.newTrick,
        currentTrick: gs.currentTrick ? {
            leader: gs.currentTrick.leader,
            trump: gs.currentTrick.trump,
            cards: Object.fromEntries(
                Object.entries(gs.currentTrick.cards).map(([p, c]) => [p, { suit: c.suit, rank: c.rank }])
            ),
            order: [...gs.currentTrick.order],
            suitLed: gs.currentTrick.suitLed,
            currentPlayer: gs.currentTrick.currentPlayer
        } : null
    });

    if (result.complete) {
        const delay = (table.settings.trickDelay || 2) * 1000;
        table._aiTimers['score'] = setTimeout(() => {
            delete table._aiTimers['score'];
            _finalizeGame(table);
        }, delay);
    } else if (result.trickWinner) {
        const delay = (table.settings.trickDelay || 2) * 1000;
        table._aiTimers['nexttrick'] = setTimeout(() => {
            delete table._aiTimers['nexttrick'];
            _processNextAction(table);
        }, delay);
    } else {
        table._aiTimers['nextplay'] = setTimeout(() => {
            delete table._aiTimers['nextplay'];
            _processNextAction(table);
        }, 700);
    }
}

function _finalizeGame(table) {
    const gs = table.gameState;
    const score = gs.contract ? gs.getScore() : { ns: 0, ew: 0, details: [] };

    table.totalScore.NS += score.ns;
    table.totalScore.EW += score.ew;

    // Persist the completed deal
    if (gs.contract) {
        try {
            _db.prepare(`
                INSERT INTO multiplayer_games (table_id, deal_number, deal_json, contract_json, score_ns, score_ew, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                table.tableId,
                table.dealNumber,
                JSON.stringify(Object.fromEntries(
                    Object.entries(gs.originalHands).map(([p, cs]) => [p, cs.map(c => ({ suit: c.suit, rank: c.rank }))])
                )),
                JSON.stringify(gs.contract),
                score.ns,
                score.ew
            );
        } catch (e) { /* non-fatal */ }
    }

    _broadcastToTable(table, {
        type: 'table_deal_complete',
        tableId: table.tableId,
        score,
        totalScore: { ...table.totalScore },
        dealNumber: table.dealNumber,
        // Send all hands for post-deal analysis
        allHands: Object.fromEntries(
            Object.entries(gs.originalHands).map(([p, cs]) => [p, cs.map(c => ({ suit: c.suit, rank: c.rank }))])
        ),
        allTricks: gs.tricks.map(t => ({
            leader: t.leader,
            cards: Object.fromEntries(Object.entries(t.cards).map(([p, c]) => [p, { suit: c.suit, rank: c.rank }])),
            order: [...t.order],
            winner: t.getWinner()
        }))
    });

    table.dealNumber++;
}

// ==================== HUMAN ACTIONS ====================

function processHumanBid(userId, tableId, bidData) {
    const table = activeTables.get(tableId);
    if (!table) return { error: 'Table introuvable.' };

    const gs = table.gameState;
    if (!gs || gs.phase !== 'bidding') return { error: 'Phase incorrecte.' };

    const pos = table.getUserPosition(userId);
    if (!pos) return { error: "Vous n'êtes pas à cette table." };
    if (gs.bidding.currentBidder !== pos) return { error: "Ce n'est pas votre tour d'enchérir." };

    const bid = new Bid(bidData.type, bidData.level || null, bidData.suit || null, pos);
    if (!gs.bidding.isValidBid(bid)) return { error: 'Enchère invalide.' };

    gs.bidding.placeBid(bid);

    _broadcastToTable(table, {
        type: 'table_bid_placed',
        tableId,
        bid: { type: bid.type, level: bid.level, suit: bid.suit, player: pos },
        biddingComplete: gs.bidding.isComplete,
        contract: gs.bidding.contract,
        currentBidder: gs.bidding.isComplete ? null : gs.bidding.currentBidder
    });

    if (gs.bidding.isComplete) {
        _finalizeBidding(table);
    } else {
        _processNextAction(table);
    }

    return { success: true };
}

function processHumanPlay(userId, tableId, cardData) {
    const table = activeTables.get(tableId);
    if (!table) return { error: 'Table introuvable.' };

    const gs = table.gameState;
    if (!gs || gs.phase !== 'playing') return { error: 'Phase incorrecte.' };

    const pos = table.getUserPosition(userId);
    if (!pos) return { error: "Vous n'êtes pas à cette table." };

    const currentPlayer = gs.currentTrick ? gs.currentTrick.currentPlayer : null;
    if (!currentPlayer) return { error: 'Aucun joueur actif.' };

    // Declarer can also play dummy's cards
    const dummyPos = gs.contract ? gs.contract.dummy : null;
    const declarerPos = gs.contract ? gs.contract.declarer : null;
    const isDeclarerPlayingDummy = (currentPlayer === dummyPos && pos === declarerPos);

    if (currentPlayer !== pos && !isDeclarerPlayingDummy) {
        return { error: "Ce n'est pas votre tour de jouer." };
    }

    const playPos = isDeclarerPlayingDummy ? dummyPos : pos;
    const hand = gs.hands[playPos];
    const card = hand.find(c => c.suit === cardData.suit && c.rank === cardData.rank);
    if (!card) return { error: 'Carte introuvable.' };

    const playable = gs.getPlayableCards(playPos);
    if (!playable.some(c => c.equals(card))) return { error: 'Vous devez fournir !' };

    _applyCardPlay(table, playPos, card);
    return { success: true };
}

function processHumanClaim(userId, tableId) {
    const table = activeTables.get(tableId);
    if (!table) return { error: 'Table introuvable.' };

    const gs = table.gameState;
    if (!gs || gs.phase !== 'playing') return { error: 'Phase incorrecte.' };

    const pos = table.getUserPosition(userId);
    const declarerPos = gs.contract ? gs.contract.declarer : null;
    if (pos !== declarerPos) return { error: 'Seul le déclarant peut revendiquer.' };

    // Award all remaining tricks to the declaring team
    const declarerTeam = teamOf(declarerPos);
    const remaining = Math.max(0, 13 - gs.tricks.length);
    gs.tricksWon[declarerTeam] += remaining;
    gs.phase = 'scoring';

    // Cancel AI timers
    for (const key of Object.keys(table._aiTimers)) {
        clearTimeout(table._aiTimers[key]);
    }
    table._aiTimers = {};

    _broadcastToTable(table, {
        type: 'table_claim_accepted',
        tableId,
        position: pos,
        remainingTricks: remaining
    });

    _finalizeGame(table);
    return { success: true };
}

function startNextDeal(userId, tableId) {
    const table = activeTables.get(tableId);
    if (!table) return { error: 'Table introuvable.' };

    // Any player at the table can advance to next deal
    if (table.getUserPosition(userId) === null) return { error: "Vous n'êtes pas à cette table." };

    if (table._pendingNextDeal) return { success: true }; // Already queued
    table._pendingNextDeal = true;

    setTimeout(() => {
        _startDeal(table);
    }, 500);

    return { success: true };
}

// ==================== QUERIES ====================

function getTableList() {
    return Array.from(activeTables.values()).map(t => ({
        tableId: t.tableId,
        code: t.code,
        status: t.status,
        createdBy: t.createdBy,
        seats: { ...t.seats },
        seatNames: { ...t.seatNames },
        filledSeats: t.getFilledSeats(),
        dealNumber: t.dealNumber,
        totalScore: { ...t.totalScore },
        settings: { ...t.settings }
    }));
}

function getTable(tableId) {
    return activeTables.get(tableId) || null;
}

function broadcastTableList() {
    if (!_wsClients) return;
    const list = getTableList();
    const msg = JSON.stringify({ type: 'table_list', tables: list });
    for (const [, ws] of _wsClients) {
        if (ws.readyState === 1) ws.send(msg);
    }
}

module.exports = {
    init,
    createTable,
    joinTable,
    joinAsObserver,
    leaveTable,
    startGame,
    processHumanBid,
    processHumanPlay,
    processHumanClaim,
    startNextDeal,
    getTableList,
    getTable,
    sendToUser,
    broadcastTableList
};
