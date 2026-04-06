// ==================== BRIDGE GAME ENGINE ====================

const SUITS = ['C', 'D', 'H', 'S'];
const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' };
const SUIT_NAMES = { C: 'Trèfle', D: 'Carreau', H: 'Cœur', S: 'Pique', NT: 'Sans-Atout' };
const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3, NT: 4 };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const RANK_DISPLAY = { '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', J: 'V', Q: 'D', K: 'R', A: 'A' };
const HCP_VALUES = { A: 4, K: 3, Q: 2, J: 1 };
const POSITIONS = ['N', 'E', 'S', 'W'];
const POSITION_NAMES = { N: 'Nord', E: 'Est', S: 'Sud', W: 'Ouest' };
const POSITION_FR = { N: 'Nord', E: 'Est', S: 'Sud', W: 'Ouest' };

function nextPos(pos) {
    return POSITIONS[(POSITIONS.indexOf(pos) + 1) % 4];
}

function partnerOf(pos) {
    return POSITIONS[(POSITIONS.indexOf(pos) + 2) % 4];
}

function isRedSuit(suit) {
    return suit === 'D' || suit === 'H';
}

function teamOf(pos) {
    return (pos === 'N' || pos === 'S') ? 'NS' : 'EW';
}

// ==================== CARD ====================
class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.value = RANK_VALUES[rank];
    }

    toString() {
        return `${RANK_DISPLAY[this.rank]}${SUIT_SYMBOLS[this.suit]}`;
    }

    get hcp() {
        return HCP_VALUES[this.rank] || 0;
    }

    get isRed() {
        return isRedSuit(this.suit);
    }

    equals(other) {
        return this.suit === other.suit && this.rank === other.rank;
    }
}

// ==================== DECK ====================
function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(new Card(suit, rank));
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function dealCards() {
    const deck = shuffleDeck(createDeck());
    const hands = { N: [], E: [], S: [], W: [] };
    for (let i = 0; i < 52; i++) {
        hands[POSITIONS[i % 4]].push(deck[i]);
    }
    // Sort each hand by suit then rank
    for (const pos of POSITIONS) {
        hands[pos].sort((a, b) => {
            if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) {
                return SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit]; // Spades first
            }
            return b.value - a.value; // High cards first
        });
    }
    return hands;
}

// ==================== BID ====================
class Bid {
    constructor(type, level, suit, player, alertText = null) {
        this.type = type; // 'bid', 'pass', 'double', 'redouble'
        this.level = level; // 1-7 for bids
        this.suit = suit;   // C, D, H, S, NT for bids
        this.player = player;
        this.alertText = alertText; // Optional alert description (artificial bids)
    }

    get index() {
        if (this.type !== 'bid') return -1;
        return (this.level - 1) * 5 + SUIT_ORDER[this.suit];
    }

    isHigherThan(other) {
        if (!other || other.type !== 'bid') return true;
        return this.index > other.index;
    }

    toString() {
        if (this.type === 'pass') return 'Passe';
        if (this.type === 'double') return 'Contre';
        if (this.type === 'redouble') return 'Surcontre';
        const suitStr = this.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[this.suit];
        return `${this.level}${suitStr}`;
    }

    toDisplayHTML() {
        const alertBadge = this.alertText ? '<span class="bid-alert-badge" title="' + this.alertText.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '">!</span>' : '';
        if (this.type === 'pass') return '<span class="pass">Passe</span>' + alertBadge;
        if (this.type === 'double') return '<span class="double">X</span>' + alertBadge;
        if (this.type === 'redouble') return '<span class="redouble">XX</span>' + alertBadge;
        const suitStr = this.suit === 'NT' ? 'SA' :
            `<span class="${isRedSuit(this.suit) ? 'red' : ''}">${SUIT_SYMBOLS[this.suit]}</span>`;
        return `${this.level}${suitStr}${alertBadge}`;
    }
}

// ==================== BIDDING MANAGER ====================
class BiddingManager {
    constructor(dealer) {
        this.dealer = dealer;
        this.bids = [];
        this.currentBidder = dealer;
        this.lastBid = null;
        this.doubled = false;
        this.redoubled = false;
        this.lastBidder = null;
        this.passCount = 0;
        this.isComplete = false;
        this.contract = null;
    }

    get hasBids() {
        return this.bids.some(b => b.type === 'bid');
    }

    canDouble(player) {
        if (!this.lastBid || this.doubled || this.redoubled) return false;
        // Can only double opponents' bid
        return teamOf(player) !== teamOf(this.lastBidder);
    }

    canRedouble(player) {
        if (!this.doubled || this.redoubled) return false;
        // Can only redouble partner's bid that was doubled
        return teamOf(player) === teamOf(this.lastBidder);
    }

    isValidBid(bid) {
        if (bid.type === 'pass') return true;
        if (bid.type === 'double') return this.canDouble(bid.player);
        if (bid.type === 'redouble') return this.canRedouble(bid.player);
        if (bid.type === 'bid') {
            return !this.lastBid || bid.isHigherThan(this.lastBid);
        }
        return false;
    }

    placeBid(bid) {
        if (this.isComplete) return false;
        if (!this.isValidBid(bid)) return false;

        this.bids.push(bid);

        if (bid.type === 'pass') {
            this.passCount++;
        } else {
            this.passCount = 0;
            if (bid.type === 'bid') {
                this.lastBid = bid;
                this.lastBidder = bid.player;
                this.doubled = false;
                this.redoubled = false;
            } else if (bid.type === 'double') {
                this.doubled = true;
            } else if (bid.type === 'redouble') {
                this.redoubled = true;
            }
        }

        // Check if bidding is complete
        if (this.passCount >= 3 && this.hasBids) {
            this.isComplete = true;
            this._resolveContract();
        } else if (this.passCount >= 4 && !this.hasBids) {
            this.isComplete = true;
            this.contract = null; // Passed out
        }

        this.currentBidder = nextPos(this.currentBidder);
        return true;
    }

    _resolveContract() {
        if (!this.lastBid) return;

        const declarerTeam = teamOf(this.lastBidder);
        const suit = this.lastBid.suit;

        // Find the first player in the declaring team who bid this suit
        let declarer = null;
        for (const bid of this.bids) {
            if (bid.type === 'bid' && bid.suit === suit && teamOf(bid.player) === declarerTeam) {
                declarer = bid.player;
                break;
            }
        }

        this.contract = {
            level: this.lastBid.level,
            suit: this.lastBid.suit,
            declarer: declarer,
            doubled: this.doubled,
            redoubled: this.redoubled,
            dummy: partnerOf(declarer)
        };
    }

    getBidHistory() {
        // Returns rows aligned to W N E S order
        const startIdx = POSITIONS.indexOf(this.dealer);
        const rows = [];
        let currentRow = new Array(4).fill(null);

        // Fill initial empty cells
        const dealerCol = this.dealer === 'W' ? 0 : this.dealer === 'N' ? 1 : this.dealer === 'E' ? 2 : 3;
        let col = dealerCol;

        for (const bid of this.bids) {
            if (col === 0 && rows.length > 0 || (col === 0 && currentRow.some(c => c !== null))) {
                if (col === 0 && currentRow.some(c => c !== null)) {
                    rows.push(currentRow);
                    currentRow = new Array(4).fill(null);
                }
            }
            currentRow[col] = bid;
            col = (col + 1) % 4;
            if (col === 0 && currentRow.some(c => c !== null)) {
                rows.push(currentRow);
                currentRow = new Array(4).fill(null);
            }
        }
        if (currentRow.some(c => c !== null)) {
            rows.push(currentRow);
        }

        return rows;
    }
}

// ==================== TRICK ====================
class Trick {
    constructor(leader, trump) {
        this.leader = leader;
        this.trump = trump;
        this.cards = {};
        this.order = [];
        this.suitLed = null;
    }

    get isComplete() {
        return this.order.length === 4;
    }

    playCard(player, card) {
        if (this.cards[player]) return false;
        this.cards[player] = card;
        this.order.push(player);
        if (!this.suitLed) {
            this.suitLed = card.suit;
        }
        return true;
    }

    getWinner() {
        if (!this.isComplete) return null;

        let winner = this.leader;
        let winningCard = this.cards[winner];

        for (const player of this.order.slice(1)) {
            const card = this.cards[player];
            if (card.suit === winningCard.suit && card.value > winningCard.value) {
                winner = player;
                winningCard = card;
            } else if (this.trump !== 'NT' && card.suit === this.trump && winningCard.suit !== this.trump) {
                winner = player;
                winningCard = card;
            }
        }
        return winner;
    }

    get currentPlayer() {
        if (this.isComplete) return null;
        let pos = this.leader;
        for (let i = 0; i < this.order.length; i++) {
            pos = nextPos(pos);
        }
        // Actually, let's just calculate it properly
        if (this.order.length === 0) return this.leader;
        return nextPos(this.order[this.order.length - 1]);
    }
}

// ==================== SCORING ====================
function calculateScore(contract, tricksMade, vulnerable) {
    if (!contract) return { ns: 0, ew: 0, details: [] };

    const level = contract.level;
    const suit = contract.suit;
    const declarer = contract.declarer;
    const doubled = contract.doubled;
    const redoubled = contract.redoubled;
    const team = teamOf(declarer);
    const isVuln = vulnerable;

    const required = level + 6;
    const made = tricksMade;
    const overtricks = made - required;
    const details = [];

    let score = 0;

    if (overtricks >= 0) {
        // Contract made
        // Trick score
        let trickScore = 0;
        const isMinor = (suit === 'C' || suit === 'D');
        const perTrick = isMinor ? 20 : 30;
        trickScore = level * perTrick;
        if (suit === 'NT') trickScore += 10; // First trick at NT is 40

        if (doubled) trickScore *= 2;
        if (redoubled) trickScore *= 4;

        score += trickScore;
        details.push({ label: `Contrat ${level}${suit === 'NT' ? 'SA' : SUIT_SYMBOLS[suit]}`, value: trickScore });

        // Overtrick bonus
        if (overtricks > 0) {
            let otScore = 0;
            if (redoubled) {
                otScore = overtricks * (isVuln ? 400 : 200);
            } else if (doubled) {
                otScore = overtricks * (isVuln ? 200 : 100);
            } else {
                otScore = overtricks * perTrick;
            }
            score += otScore;
            details.push({ label: `Surlevées (${overtricks})`, value: otScore });
        }

        // Game bonus
        if (trickScore >= 100) {
            const gameBonus = isVuln ? 500 : 300;
            score += gameBonus;
            details.push({ label: 'Prime de manche', value: gameBonus });
        } else {
            score += 50;
            details.push({ label: 'Prime partielle', value: 50 });
        }

        // Slam bonus
        if (level === 6) {
            const slamBonus = isVuln ? 750 : 500;
            score += slamBonus;
            details.push({ label: 'Prime petit chelem', value: slamBonus });
        } else if (level === 7) {
            const slamBonus = isVuln ? 1500 : 1000;
            score += slamBonus;
            details.push({ label: 'Prime grand chelem', value: slamBonus });
        }

        // Insult bonus for made doubled/redoubled
        if (doubled) {
            score += 50;
            details.push({ label: 'Prime de contré', value: 50 });
        }
        if (redoubled) {
            score += 100;
            details.push({ label: 'Prime de surcontré', value: 100 });
        }

    } else {
        // Contract down
        const down = -overtricks;
        let penalty = 0;

        if (redoubled) {
            if (isVuln) {
                penalty = down === 1 ? 400 : 400 + (down - 1) * 600;
            } else {
                penalty = down === 1 ? 200 : down === 2 ? 600 : down === 3 ? 1000 : 1000 + (down - 3) * 600;
            }
        } else if (doubled) {
            if (isVuln) {
                penalty = down === 1 ? 200 : 200 + (down - 1) * 300;
            } else {
                penalty = down === 1 ? 100 : down === 2 ? 300 : down === 3 ? 500 : 500 + (down - 3) * 300;
            }
        } else {
            penalty = down * (isVuln ? 100 : 50);
        }

        score = -penalty;
        details.push({ label: `Chute de ${down}`, value: -penalty });
    }

    const result = { ns: 0, ew: 0, details };
    if (team === 'NS') {
        result.ns = score;
        result.ew = -score;
    } else {
        result.ew = score;
        result.ns = -score;
    }

    return result;
}

// ==================== VULNERABILITY ====================
function getVulnerability(dealNumber) {
    // Standard 16-board vulnerability cycle
    const board = ((dealNumber - 1) % 16) + 1;
    const vulnTable = {
        1: 'None', 2: 'NS', 3: 'EW', 4: 'Both',
        5: 'NS', 6: 'EW', 7: 'Both', 8: 'None',
        9: 'EW', 10: 'Both', 11: 'None', 12: 'NS',
        13: 'Both', 14: 'None', 15: 'NS', 16: 'EW'
    };
    return vulnTable[board];
}

function getDealer(dealNumber) {
    return POSITIONS[(dealNumber - 1) % 4];
}

function isVulnerable(pos, vulnerability) {
    if (vulnerability === 'None') return false;
    if (vulnerability === 'Both') return true;
    if (vulnerability === 'NS') return pos === 'N' || pos === 'S';
    if (vulnerability === 'EW') return pos === 'E' || pos === 'W';
    return false;
}

// ==================== HAND EVALUATION ====================
function evaluateHand(cards) {
    let hcp = 0;
    const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
    const suitCards = { S: [], H: [], D: [], C: [] };

    for (const card of cards) {
        hcp += card.hcp;
        suitCounts[card.suit]++;
        suitCards[card.suit].push(card);
    }

    // Distribution points
    let distPoints = 0;
    for (const suit of SUITS) {
        if (suitCounts[suit] === 0) distPoints += 3;
        else if (suitCounts[suit] === 1) distPoints += 2;
        else if (suitCounts[suit] === 2) distPoints += 1;
    }

    // Losing trick count
    let ltc = 0;
    for (const suit of SUITS) {
        const sc = suitCards[suit].sort((a, b) => b.value - a.value);
        const count = Math.min(sc.length, 3);
        for (let i = 0; i < count; i++) {
            if (i === 0 && sc[0]?.rank !== 'A') ltc++;
            else if (i === 1 && sc[1]?.rank !== 'K') ltc++;
            else if (i === 2 && sc[2]?.rank !== 'Q') ltc++;
        }
    }

    const totalPoints = hcp + distPoints;
    const longestSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0];
    const isBalanced = Object.values(suitCounts).every(c => c >= 2) &&
        Object.values(suitCounts).filter(c => c === 2).length <= 1;

    return {
        hcp, distPoints, totalPoints, suitCounts, suitCards,
        ltc, longestSuit: longestSuit[0], longestSuitLength: longestSuit[1],
        isBalanced
    };
}

// ==================== GAME STATE ====================
class GameState {
    constructor(settings) {
        this.settings = settings;
        this.dealNumber = 1;
        this.phase = 'idle'; // idle, dealing, bidding, playing, scoring
        this.hands = {};
        this.originalHands = {};
        this.bidding = null;
        this.contract = null;
        this.currentTrick = null;
        this.tricks = [];
        this.tricksWon = { NS: 0, EW: 0 };
        this.totalScore = { NS: 0, EW: 0 };
        this.vulnerability = 'None';
        this.dealer = 'N';
    }

    get humanPos() {
        return this.settings.seat;
    }

    get dummyPos() {
        return this.contract ? this.contract.dummy : null;
    }

    get declarerPos() {
        return this.contract ? this.contract.declarer : null;
    }

    isHumanControlled(pos) {
        if (pos === this.humanPos) return true;
        // Human plays dummy's cards when human is declarer
        if (this.contract && this.declarerPos === this.humanPos && pos === this.dummyPos) return true;
        return false;
    }

    shouldShowCards(pos) {
        if (pos === this.humanPos) return true;
        if (this.phase === 'playing' && pos === this.dummyPos) return true;
        if (this.phase === 'scoring') return true;
        return false;
    }

    startDeal() {
        this.dealer = getDealer(this.dealNumber);
        this.vulnerability = getVulnerability(this.dealNumber);
        this.hands = dealCards();
        this.originalHands = {};
        for (const pos of POSITIONS) {
            this.originalHands[pos] = [...this.hands[pos]];
        }
        this.bidding = new BiddingManager(this.dealer);
        this.contract = null;
        this.currentTrick = null;
        this.tricks = [];
        this.tricksWon = { NS: 0, EW: 0 };
        this.phase = 'bidding';
    }

    startPlay() {
        this.phase = 'playing';
        const leader = nextPos(this.contract.declarer);
        this.currentTrick = new Trick(leader, this.contract.suit);
    }

    getPlayableCards(pos) {
        const hand = this.hands[pos];
        if (!this.currentTrick || this.currentTrick.suitLed === null) return hand;

        const suitLed = this.currentTrick.suitLed;
        const followSuit = hand.filter(c => c.suit === suitLed);
        return followSuit.length > 0 ? followSuit : hand;
    }

    playCard(pos, card) {
        if (!this.currentTrick) return false;

        // Remove card from hand
        const idx = this.hands[pos].findIndex(c => c.equals(card));
        if (idx === -1) return false;
        this.hands[pos].splice(idx, 1);

        this.currentTrick.playCard(pos, card);

        if (this.currentTrick.isComplete) {
            const winner = this.currentTrick.getWinner();
            this.tricksWon[teamOf(winner)]++;
            this.tricks.push(this.currentTrick);

            if (this.tricks.length === 13) {
                this.phase = 'scoring';
                return { complete: true, trickWinner: winner };
            }

            // Start new trick
            const newTrick = new Trick(winner, this.contract.suit);
            this.currentTrick = newTrick;
            return { complete: false, trickWinner: winner, newTrick: true };
        }

        return { complete: false, trickWinner: null, newTrick: false };
    }

    getScore() {
        const declarerTeam = teamOf(this.contract.declarer);
        const tricksMade = this.tricksWon[declarerTeam];
        const isVuln = isVulnerable(this.contract.declarer, this.vulnerability);
        return calculateScore(this.contract, tricksMade, isVuln);
    }

    // ==================== SNAPSHOT / UNDO ====================

    snapshot() {
        const hands = {};
        for (const pos of POSITIONS) {
            hands[pos] = this.hands[pos].map(c => new Card(c.suit, c.rank));
        }

        let trickData = null;
        if (this.currentTrick) {
            trickData = {
                leader: this.currentTrick.leader,
                trump: this.currentTrick.trump,
                cards: {},
                order: [...this.currentTrick.order],
                suitLed: this.currentTrick.suitLed
            };
            for (const [p, card] of Object.entries(this.currentTrick.cards)) {
                trickData.cards[p] = new Card(card.suit, card.rank);
            }
        }

        // Deep-copy completed tricks
        const tricks = this.tricks.map(t => {
            const tc = new Trick(t.leader, t.trump);
            for (const [p, card] of Object.entries(t.cards)) {
                tc.cards[p] = new Card(card.suit, card.rank);
            }
            tc.order = [...t.order];
            tc.suitLed = t.suitLed;
            return tc;
        });

        return {
            hands,
            trickData,
            tricks,
            tricksWon: { ...this.tricksWon },
            phase: this.phase
        };
    }

    restoreSnapshot(snap) {
        this.hands = snap.hands;
        this.tricksWon = { ...snap.tricksWon };
        this.phase = snap.phase;
        this.tricks = snap.tricks;

        if (snap.trickData) {
            const trick = new Trick(snap.trickData.leader, snap.trickData.trump);
            trick.cards = snap.trickData.cards;
            trick.order = [...snap.trickData.order];
            trick.suitLed = snap.trickData.suitLed;
            this.currentTrick = trick;
        } else {
            this.currentTrick = null;
        }
    }
}

// ==================== ALERT DETECTION ====================
// Detects conventional bids that require an alert in bridge
function shouldAlert(bid, bidding, convention) {
    if (bid.type !== 'bid' && bid.type !== 'double') return null;

    const bids = bidding.bids;
    const lastRealBid = bidding.lastBid;
    const partner = partnerOf(bid.player);
    const partnerBids = bids.filter(b => b.player === partner && b.type === 'bid');
    const myBids = bids.filter(b => b.player === bid.player && b.type === 'bid');
    const isOpening = myBids.length === 0 && partnerBids.length === 0;
    const isResponse = myBids.length === 0 && partnerBids.length > 0;

    if (bid.type === 'bid') {
        // 2C artificial strong opening (nearly all conventions)
        if (isOpening && bid.level === 2 && bid.suit === 'C') {
            return 'Bicolore fort ou main forte (20+ HCP), artificiel';
        }

        // Stayman: 2C response to 1NT partner opening
        if (isResponse && bid.level === 2 && bid.suit === 'C') {
            const partnerOpened1NT = partnerBids.length > 0 && partnerBids[0].level === 1 && partnerBids[0].suit === 'NT';
            if (partnerOpened1NT) return 'Stayman — demande une majeure 4e';
        }

        // Transfers over 1NT (Jacoby): 2D → cœur, 2H → pique
        if (isResponse && bid.level === 2 && bid.suit === 'D') {
            const partnerOpened1NT = partnerBids.length > 0 && partnerBids[0].level === 1 && partnerBids[0].suit === 'NT';
            if (partnerOpened1NT && (convention !== 'acol')) return 'Transfert — indique 5+ cœurs';
        }
        if (isResponse && bid.level === 2 && bid.suit === 'H') {
            const partnerOpened1NT = partnerBids.length > 0 && partnerBids[0].level === 1 && partnerBids[0].suit === 'NT';
            if (partnerOpened1NT && (convention !== 'acol')) return 'Transfert — indique 5+ piques';
        }

        // Blackwood 4NT
        if (bid.level === 4 && bid.suit === 'NT' && lastRealBid && lastRealBid.player !== bid.player) {
            return 'Blackwood — demande le nombre d\'as';
        }

        // Gerber 4C over NT
        if (bid.level === 4 && bid.suit === 'C' && lastRealBid && lastRealBid.suit === 'NT') {
            return 'Gerber — demande le nombre d\'as';
        }

        // Negative double
        if (bid.type === 'double') {
            const opponentBid = bids.filter(b => b.type === 'bid' &&
                teamOf(b.player) !== teamOf(bid.player)).slice(-1)[0];
            if (opponentBid && opponentBid.level <= 2 && partnerBids.length > 0) {
                return 'Contre négatif — indique les majeures non annoncées';
            }
        }
    }

    return null;
}

// ==================== CommonJS export for Node.js server use ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Card, Bid, BiddingManager, Trick, GameState,
        calculateScore, evaluateHand, dealCards, createDeck, shuffleDeck,
        getVulnerability, getDealer, isVulnerable,
        nextPos, partnerOf, teamOf, shouldAlert,
        POSITIONS, SUITS, RANKS, RANK_VALUES, RANK_DISPLAY,
        SUIT_SYMBOLS, SUIT_ORDER, HCP_VALUES, POSITION_NAMES, POSITION_FR
    };
}
