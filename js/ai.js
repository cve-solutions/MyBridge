// ==================== AI BRIDGE PLAYER ====================
// Supports 6 levels: beginner, initiate, intermediate, confirmed, expert, master
// Supports conventions: sef, sayc, acol, two_over_one, standard

// Node.js: import bridge globals that are available as globals in browser
if (typeof module !== 'undefined' && typeof evaluateHand === 'undefined') {
    const _b = require('./bridge.js');
    global.evaluateHand = _b.evaluateHand;
    global.Bid = _b.Bid;
    global.POSITIONS = _b.POSITIONS;
    global.SUITS = _b.SUITS;
    global.SUIT_ORDER = _b.SUIT_ORDER;
    global.SUIT_SYMBOLS = _b.SUIT_SYMBOLS;
    global.RANK_VALUES = _b.RANK_VALUES;
    global.HCP_VALUES = _b.HCP_VALUES;
    global.partnerOf = _b.partnerOf;
    global.nextPos = _b.nextPos;
    global.teamOf = _b.teamOf;
    global.isRedSuit = function(s) { return s === 'D' || s === 'H'; };
}

class BridgeAI {
    constructor(settings) {
        this.level = settings.level || 'intermediate';
        this.convention = settings.convention || 'sef';
    }

    // ==================== CONVENTION CONFIG ====================

    _getConventionConfig() {
        switch (this.convention) {
            case 'sef':
                return {
                    ntRange: [15, 17],
                    strongClubHCP: 20,
                    weakTwoRange: [6, 10],
                    weakTwoSuits: (this.level === 'beginner' || this.level === 'initiate')
                        ? ['H', 'S'] : ['D', 'H', 'S'],
                    weakTwoMinLen: 6,
                    useMulti2D: (this.level !== 'beginner' && this.level !== 'initiate'),
                    fiveCardMajors: true,
                    majorRaiseNeed: 3,
                    twoNTRange: [20, 21],
                    name: 'sef'
                };
            case 'sayc':
                return {
                    ntRange: [15, 17],
                    strongClubHCP: 22,
                    weakTwoRange: [5, 11],
                    weakTwoSuits: ['D', 'H', 'S'],
                    weakTwoMinLen: 6,
                    useMulti2D: false,
                    fiveCardMajors: true,
                    majorRaiseNeed: 3,
                    twoNTRange: [20, 21],
                    name: 'sayc'
                };
            case 'acol':
                return {
                    ntRange: [12, 14],
                    strongClubHCP: 23,
                    weakTwoRange: null,
                    weakTwoSuits: [],
                    weakTwoMinLen: 6,
                    useMulti2D: false,
                    fiveCardMajors: false,
                    majorRaiseNeed: 4,
                    acolTwos: true,
                    acolTwoMinTricks: 8,
                    twoNTRange: [20, 22],
                    name: 'acol'
                };
            case '2over1':
            case 'two_over_one':
                return {
                    ntRange: [15, 17],
                    strongClubHCP: 22,
                    weakTwoRange: [5, 11],
                    weakTwoSuits: ['D', 'H', 'S'],
                    weakTwoMinLen: 6,
                    useMulti2D: false,
                    fiveCardMajors: true,
                    majorRaiseNeed: 3,
                    twoOverOneGF: true,
                    oneNTForcing: true,
                    twoNTRange: [20, 21],
                    name: 'two_over_one'
                };
            case 'standard':
            default:
                return {
                    ntRange: [15, 17],
                    strongClubHCP: 22,
                    weakTwoRange: [5, 11],
                    weakTwoSuits: ['D', 'H', 'S'],
                    weakTwoMinLen: 6,
                    useMulti2D: false,
                    fiveCardMajors: true,
                    majorRaiseNeed: 3,
                    twoNTRange: [20, 21],
                    name: 'standard'
                };
        }
    }

    // ==================== LEVEL HELPERS ====================

    _levelAtLeast(target) {
        const order = ['beginner', 'initiate', 'intermediate', 'confirmed', 'expert', 'master'];
        return order.indexOf(this.level) >= order.indexOf(target);
    }

    _getNoise() {
        switch (this.level) {
            case 'beginner': return Math.floor(Math.random() * 7) - 3;
            case 'initiate': return Math.floor(Math.random() * 5) - 2;
            case 'intermediate': return Math.floor(Math.random() * 3) - 1;
            case 'confirmed':
            case 'expert':
            case 'master':
                return 0;
            default: return 0;
        }
    }

    _forgetConvention() {
        if (this.level === 'beginner') return Math.random() < 0.30;
        if (this.level === 'initiate') return Math.random() < 0.10;
        return false;
    }

    // ==================== BIDDING HELPERS ====================

    _tryBid(level, suit, pos, bidding, alertText) {
        const bid = new Bid('bid', level, suit, pos, alertText || null);
        if (bidding.isValidBid(bid)) return bid;
        return null;
    }

    _pass(pos) {
        return new Bid('pass', null, null, pos);
    }

    _double(pos) {
        return new Bid('double', null, null, pos);
    }

    _getLongestSuit(eval_) {
        let best = 'C';
        let bestLen = 0;
        for (const suit of ['S', 'H', 'D', 'C']) {
            if (eval_.suitCounts[suit] > bestLen) {
                bestLen = eval_.suitCounts[suit];
                best = suit;
            }
        }
        return best;
    }

    _getLongestMajor(eval_) {
        if (eval_.suitCounts['S'] >= eval_.suitCounts['H']) {
            return eval_.suitCounts['S'] >= 4 ? 'S' : null;
        }
        return eval_.suitCounts['H'] >= 4 ? 'H' : null;
    }

    _countAces(eval_) {
        let count = 0;
        for (const suit of ['S', 'H', 'D', 'C']) {
            const cards = eval_.suitCards[suit];
            if (cards && cards.some(c => c.rank === 'A')) count++;
        }
        return count;
    }

    _hasStoppers(eval_, suits) {
        for (const suit of suits) {
            const cards = eval_.suitCards[suit];
            if (!cards || cards.length === 0) return false;
            const hasA = cards.some(c => c.rank === 'A');
            const hasK = cards.some(c => c.rank === 'K') && cards.length >= 2;
            const hasQ = cards.some(c => c.rank === 'Q') && cards.length >= 3;
            if (!hasA && !hasK && !hasQ) return false;
        }
        return true;
    }

    _estimatePlayingTricks(eval_) {
        let tricks = 0;
        for (const suit of ['S', 'H', 'D', 'C']) {
            const cards = eval_.suitCards[suit].sort((a, b) => b.value - a.value);
            const len = cards.length;
            if (len === 0) continue;
            let suitTricks = 0;
            for (let i = 0; i < Math.min(len, 4); i++) {
                if (cards[i].rank === 'A') suitTricks += 1;
                else if (cards[i].rank === 'K' && len >= 2) suitTricks += 0.9;
                else if (cards[i].rank === 'Q' && len >= 3) suitTricks += 0.7;
                else if (cards[i].rank === 'J' && len >= 4) suitTricks += 0.4;
            }
            if (len >= 5) suitTricks += (len - 4) * 0.8;
            if (len >= 7) suitTricks += (len - 6) * 0.5;
            tricks += suitTricks;
        }
        return tricks;
    }

    // ==================== MAIN BIDDING ====================

    makeBid(gameState, pos) {
        const hand = gameState.hands[pos];
        const eval_ = evaluateHand(hand);
        const bidding = gameState.bidding;
        const partner = partnerOf(pos);
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const isOpening = myBids.length === 0 && partnerBids.length === 0;
        const opponentBids = bidding.bids.filter(b => teamOf(b.player) !== teamOf(pos) && b.type === 'bid');

        const noise = this._getNoise();
        const cfg = this._getConventionConfig();

        // Beginner: random mistakes
        if (this.level === 'beginner' && Math.random() < 0.15) {
            return this._pass(pos);
        }

        // Competitive bidding for confirmed+
        if (opponentBids.length > 0 && this._levelAtLeast('confirmed')) {
            const compBid = this._getCompetitiveBid(eval_, pos, bidding, noise, cfg, myBids, partnerBids);
            if (compBid) return compBid;
        }

        if (isOpening) {
            return this._getOpeningBid(eval_, pos, noise, bidding, cfg);
        }

        if (myBids.length === 0 && partnerBids.length > 0) {
            return this._getResponse(eval_, pos, partnerBids[0], noise, bidding, cfg, partnerBids);
        }

        return this._getRebid(eval_, pos, bidding, noise, cfg);
    }

    // ==================== OPENING BIDS ====================

    _getOpeningBid(eval_, pos, noise, bidding, cfg) {
        const hcp = eval_.hcp + noise;
        const tp = eval_.totalPoints + noise;

        if (hcp < 11) {
            // Weak two bids check
            if (cfg.weakTwoRange && hcp >= cfg.weakTwoRange[0] && hcp <= cfg.weakTwoRange[1]) {
                if (!this._forgetConvention()) {
                    for (const suit of cfg.weakTwoSuits) {
                        if (suit === 'D' && cfg.useMulti2D) continue;
                        if (eval_.suitCounts[suit] >= cfg.weakTwoMinLen) {
                            return this._tryBid(2, suit, pos, bidding) || this._pass(pos);
                        }
                    }
                    // Multi 2D (SEF)
                    if (cfg.useMulti2D) {
                        for (const suit of ['H', 'S']) {
                            if (eval_.suitCounts[suit] >= 6) {
                                return this._tryBid(2, 'D', pos, bidding, 'Multi - 6 cartes majeures, 6-10 HCP') || this._pass(pos);
                            }
                        }
                    }
                }
            }
            // Acol two bids (strong distributional, 8+ playing tricks)
            if (cfg.acolTwos && this._estimatePlayingTricks(eval_) >= cfg.acolTwoMinTricks) {
                const longest = this._getLongestSuit(eval_);
                if (longest !== 'C' && eval_.suitCounts[longest] >= 5) {
                    return this._tryBid(2, longest, pos, bidding) || this._pass(pos);
                }
            }
            return this._pass(pos);
        }

        // Strong 2C opener
        if (hcp >= cfg.strongClubHCP) {
            return this._tryBid(2, 'C', pos, bidding, 'Fort artificiel') || this._pass(pos);
        }

        // 2NT opening (balanced, strong)
        if (eval_.isBalanced && hcp >= cfg.twoNTRange[0] && hcp <= cfg.twoNTRange[1]) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        // 1NT opening (balanced, in range)
        if (eval_.isBalanced && hcp >= cfg.ntRange[0] && hcp <= cfg.ntRange[1]) {
            return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
        }

        if (hcp >= 12 || (hcp >= 11 && eval_.distPoints >= 2)) {
            // Major suit opening
            if (cfg.fiveCardMajors) {
                // 5-card major systems
                if (eval_.suitCounts['S'] >= 5 || eval_.suitCounts['H'] >= 5) {
                    const major = eval_.suitCounts['S'] >= eval_.suitCounts['H'] ? 'S' : 'H';
                    return this._tryBid(1, major, pos, bidding) || this._pass(pos);
                }
            } else {
                // 4-card major (Acol)
                if (eval_.suitCounts['S'] >= 4 || eval_.suitCounts['H'] >= 4) {
                    const major = eval_.suitCounts['S'] >= eval_.suitCounts['H'] ? 'S' : 'H';
                    return this._tryBid(1, major, pos, bidding) || this._pass(pos);
                }
            }

            // Minor suit opening
            if (eval_.suitCounts['D'] >= eval_.suitCounts['C'] && eval_.suitCounts['D'] >= 4) {
                return this._tryBid(1, 'D', pos, bidding) || this._pass(pos);
            }
            return this._tryBid(1, 'C', pos, bidding) || this._pass(pos);
        }

        // Weak two bids for hands with 11 HCP but missed above
        if (cfg.weakTwoRange && hcp >= cfg.weakTwoRange[0] && hcp <= cfg.weakTwoRange[1]) {
            if (!this._forgetConvention()) {
                for (const suit of cfg.weakTwoSuits) {
                    if (suit === 'D' && cfg.useMulti2D) continue;
                    if (eval_.suitCounts[suit] >= cfg.weakTwoMinLen) {
                        return this._tryBid(2, suit, pos, bidding) || this._pass(pos);
                    }
                }
            }
        }

        return this._pass(pos);
    }

    // ==================== RESPONSE TO PARTNER'S OPENING ====================

    _getResponse(eval_, pos, partnerBid, noise, bidding, cfg, partnerBids) {
        const hcp = eval_.hcp + noise;
        const tp = eval_.totalPoints + noise;

        if (hcp < 6) return this._pass(pos);

        // Response to 1NT
        if (partnerBid.level === 1 && partnerBid.suit === 'NT') {
            return this._respondTo1NT(eval_, pos, hcp, tp, bidding, cfg);
        }

        // Response to 2C (strong artificial)
        if (partnerBid.level === 2 && partnerBid.suit === 'C') {
            return this._respondTo2C(eval_, pos, hcp, bidding, cfg);
        }

        // Response to 2NT
        if (partnerBid.level === 2 && partnerBid.suit === 'NT') {
            return this._respondTo2NT(eval_, pos, hcp, tp, bidding, cfg);
        }

        // Response to weak two
        if (partnerBid.level === 2 && partnerBid.suit !== 'NT' && partnerBid.suit !== 'C') {
            return this._respondToWeak2(eval_, pos, hcp, tp, partnerBid, bidding, cfg);
        }

        // Response to 1-level suit
        if (partnerBid.level === 1 && partnerBid.suit !== 'NT') {
            return this._respondTo1Suit(eval_, pos, hcp, tp, partnerBid, bidding, cfg);
        }

        // Default: pass or simple raise
        if (hcp >= 6 && partnerBid.suit !== 'NT' && eval_.suitCounts[partnerBid.suit] >= 3) {
            const raiseLevel = partnerBid.level + 1;
            if (raiseLevel <= 4) {
                return this._tryBid(raiseLevel, partnerBid.suit, pos, bidding) || this._pass(pos);
            }
        }

        return this._pass(pos);
    }

    // ==================== RESPOND TO 1NT ====================

    _respondTo1NT(eval_, pos, hcp, tp, bidding, cfg) {
        const has5H = eval_.suitCounts['H'] >= 5;
        const has5S = eval_.suitCounts['S'] >= 5;
        const has4H = eval_.suitCounts['H'] >= 4;
        const has4S = eval_.suitCounts['S'] >= 4;

        // Fix 1: Texas transfer FIRST with 5+ card major
        if (!this._forgetConvention()) {
            if (has5H) {
                // Transfer to hearts: bid 2D
                const bid = this._tryBid(2, 'D', pos, bidding, 'Transfert ♥');
                if (bid) return bid;
            }
            if (has5S) {
                // Transfer to spades: bid 2H
                const bid = this._tryBid(2, 'H', pos, bidding, 'Transfert ♠');
                if (bid) return bid;
            }
        }

        // Stayman with 4-card major and 8+ HCP (only when NO 5-card major)
        if (hcp >= 8 && (has4H || has4S) && !has5H && !has5S) {
            if (!this._forgetConvention()) {
                const bid = this._tryBid(2, 'C', pos, bidding, 'Stayman');
                if (bid) return bid;
            }
        }

        // With 5+ major and forgot convention, just bid naturally
        if (has5H && hcp >= 8) {
            const bid = this._tryBid(2, 'H', pos, bidding);
            if (bid) return bid;
        }
        if (has5S && hcp >= 8) {
            const bid = this._tryBid(2, 'S', pos, bidding);
            if (bid) return bid;
        }

        // Raise to 2NT (8-9 HCP)
        if (hcp >= 8 && hcp <= 9) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        // 3NT (10-15)
        if (hcp >= 10 && hcp <= 15) {
            return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }

        // 4NT quantitative (16-17)
        if (hcp >= 16 && hcp <= 17) {
            return this._tryBid(4, 'NT', pos, bidding) || this._pass(pos);
        }

        // 6NT (18-19)
        if (hcp >= 18 && hcp <= 19) {
            return this._tryBid(6, 'NT', pos, bidding) || this._pass(pos);
        }

        return this._pass(pos);
    }

    // ==================== RESPOND TO 2C (STRONG) ====================

    _respondTo2C(eval_, pos, hcp, bidding, cfg) {
        if (hcp >= 8) {
            // Positive response: show longest suit
            const longest = this._getLongestSuit(eval_);
            if (eval_.suitCounts[longest] >= 5) {
                const bid = this._tryBid(2, longest, pos, bidding);
                if (bid) return bid;
            }
            // 2NT with balanced positive
            if (eval_.isBalanced) {
                const bid = this._tryBid(2, 'NT', pos, bidding);
                if (bid) return bid;
            }
            // Show any 4+ card suit
            for (const suit of ['S', 'H', 'D']) {
                if (eval_.suitCounts[suit] >= 4) {
                    const bid = this._tryBid(2, suit, pos, bidding);
                    if (bid) return bid;
                }
            }
        }
        // Negative / waiting: 2D
        return this._tryBid(2, 'D', pos, bidding) || this._pass(pos);
    }

    // ==================== RESPOND TO 2NT ====================

    _respondTo2NT(eval_, pos, hcp, tp, bidding, cfg) {
        // Stayman with 4-card major
        if (hcp >= 4 && (eval_.suitCounts['H'] >= 4 || eval_.suitCounts['S'] >= 4)) {
            if (!this._forgetConvention()) {
                return this._tryBid(3, 'C', pos, bidding, 'Stayman') || this._pass(pos);
            }
        }
        // Transfer with 5+ major
        if (eval_.suitCounts['H'] >= 5) {
            return this._tryBid(3, 'D', pos, bidding, 'Transfert ♥') || this._pass(pos);
        }
        if (eval_.suitCounts['S'] >= 5) {
            return this._tryBid(3, 'H', pos, bidding, 'Transfert ♠') || this._pass(pos);
        }
        // 3NT with 4-10 HCP
        if (hcp >= 4 && hcp <= 10) {
            return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }
        // Slam interest
        if (hcp >= 11) {
            return this._tryBid(4, 'NT', pos, bidding) || this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }
        return this._pass(pos);
    }

    // ==================== RESPOND TO WEAK 2 ====================

    _respondToWeak2(eval_, pos, hcp, tp, partnerBid, bidding, cfg) {
        const pSuit = partnerBid.suit;
        const support = eval_.suitCounts[pSuit] || 0;

        // Raise with fit
        if (support >= 3) {
            if (tp >= 16) {
                return this._tryBid(4, pSuit, pos, bidding) || this._tryBid(3, pSuit, pos, bidding) || this._pass(pos);
            }
            if (tp >= 8) {
                return this._tryBid(3, pSuit, pos, bidding) || this._pass(pos);
            }
        }

        // New suit forcing with 16+ HCP
        if (hcp >= 16) {
            for (const suit of ['S', 'H', 'D', 'C']) {
                if (suit !== pSuit && eval_.suitCounts[suit] >= 5) {
                    const bid = this._tryBid(3, suit, pos, bidding);
                    if (bid) return bid;
                }
            }
        }

        // 2NT relay / feature ask
        if (hcp >= 15 && this._levelAtLeast('intermediate')) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        // 3NT with stoppers
        if (hcp >= 16 && eval_.isBalanced) {
            return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }

        return this._pass(pos);
    }

    // ==================== RESPOND TO 1-LEVEL SUIT ====================

    _respondTo1Suit(eval_, pos, hcp, tp, partnerBid, bidding, cfg) {
        const pSuit = partnerBid.suit;
        const support = eval_.suitCounts[pSuit] || 0;
        const isMajor = pSuit === 'H' || pSuit === 'S';
        const raiseNeed = cfg.majorRaiseNeed;

        // Raise partner's major
        if (isMajor && support >= raiseNeed) {
            // Limit raise (10-12 tp)
            if (tp >= 13) {
                const bid = this._tryBid(3, pSuit, pos, bidding);
                if (bid) return bid;
            }
            if (tp >= 6) {
                return this._tryBid(2, pSuit, pos, bidding) || this._pass(pos);
            }
        }

        // Game raise with 4+ support and 13+ tp
        if (isMajor && support >= 4 && tp >= 13) {
            return this._tryBid(4, pSuit, pos, bidding) || this._tryBid(3, pSuit, pos, bidding) || this._pass(pos);
        }

        // Raise partner's minor with 5+ support
        if (!isMajor && support >= 5 && tp >= 6) {
            return this._tryBid(2, pSuit, pos, bidding) || this._pass(pos);
        }

        // New suit at 1-level (6+ HCP, 4+ cards)
        for (const suit of ['S', 'H', 'D', 'C']) {
            if (SUIT_ORDER[suit] > SUIT_ORDER[pSuit] && eval_.suitCounts[suit] >= 4) {
                const bid = this._tryBid(1, suit, pos, bidding);
                if (bid) return bid;
            }
        }

        // 1NT response (6-10 HCP, no fit, no suit to show)
        if (hcp >= 6 && hcp <= 10) {
            // In 2/1, 1NT over major is forcing
            if (cfg.oneNTForcing && isMajor) {
                return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
            }
            return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
        }

        // New suit at 2-level
        if (hcp >= 10) {
            // In 2/1 system, a 2-level response to a major is game forcing (need 12+)
            const minFor2Level = (cfg.twoOverOneGF && isMajor) ? 12 : 10;
            if (hcp >= minFor2Level) {
                for (const suit of ['C', 'D', 'H', 'S']) {
                    if (eval_.suitCounts[suit] >= 4) {
                        const bid = this._tryBid(2, suit, pos, bidding);
                        if (bid) return bid;
                    }
                }
            }
        }

        // 2NT (11-12 balanced)
        if (hcp >= 11 && hcp <= 12 && eval_.isBalanced) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        // 3NT (13-15 balanced)
        if (hcp >= 13 && hcp <= 15 && eval_.isBalanced) {
            return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }

        return this._pass(pos);
    }

    // ==================== COMPETITIVE BIDDING (confirmed+) ====================

    _getCompetitiveBid(eval_, pos, bidding, noise, cfg, myBids, partnerBids) {
        const hcp = eval_.hcp + noise;
        const opponentBids = bidding.bids.filter(b => teamOf(b.player) !== teamOf(pos) && b.type === 'bid');
        const lastOppBid = opponentBids[opponentBids.length - 1];
        if (!lastOppBid) return null;

        const oppSuit = lastOppBid.suit;
        const oppLevel = lastOppBid.level;

        // Partner has already bid - check if we should compete
        if (partnerBids.length > 0 && myBids.length > 0) {
            // Already in auction, handle via normal rebid
            return null;
        }

        // Takeout double: 12+ HCP, short in opponent suit, support for unbid suits
        if (myBids.length === 0 && oppLevel <= 3 && bidding.canDouble(pos)) {
            const oppSuitCount = eval_.suitCounts[oppSuit] || 0;
            if (hcp >= 12 && oppSuitCount <= 1) {
                // Check we have 3+ in at least 3 unbid suits
                let supportedSuits = 0;
                for (const suit of ['S', 'H', 'D', 'C']) {
                    if (suit !== oppSuit && eval_.suitCounts[suit] >= 3) {
                        supportedSuits++;
                    }
                }
                if (supportedSuits >= 2) {
                    return this._double(pos);
                }
            }
        }

        // Overcall: 8-16 HCP with 5+ card suit
        if (myBids.length === 0 && oppLevel <= 2) {
            if (hcp >= 8 && hcp <= 16) {
                for (const suit of ['S', 'H', 'D', 'C']) {
                    if (suit === oppSuit) continue;
                    if (eval_.suitCounts[suit] >= 5) {
                        // Try at cheapest level
                        const bid = this._tryBid(oppLevel, suit, pos, bidding)
                            || this._tryBid(oppLevel + 1, suit, pos, bidding);
                        if (bid) return bid;
                    }
                }
            }
            // 1NT overcall (15-18, balanced, stopper in opponent suit)
            if (hcp >= 15 && hcp <= 18 && eval_.isBalanced) {
                const oppCards = eval_.suitCards[oppSuit] || [];
                const hasStopper = oppCards.some(c => c.rank === 'A')
                    || (oppCards.some(c => c.rank === 'K') && oppCards.length >= 2)
                    || (oppCards.some(c => c.rank === 'Q') && oppCards.length >= 3);
                if (hasStopper) {
                    const bid = this._tryBid(1, 'NT', pos, bidding);
                    if (bid) return bid;
                }
            }
        }

        // Advancing partner's takeout double
        if (partnerBids.length === 0 && myBids.length === 0) {
            const partnerDoubles = bidding.bids.filter(b => b.player === partnerOf(pos) && b.type === 'double');
            if (partnerDoubles.length > 0) {
                // Partner doubled, we must bid (unless opponent bid)
                const lastAction = bidding.bids[bidding.bids.length - 1];
                if (lastAction.type === 'pass' || lastAction.player === partnerOf(pos)) {
                    // Find cheapest bid in our longest non-opponent suit
                    let bestSuit = null;
                    let bestLen = 0;
                    for (const suit of ['S', 'H', 'D', 'C']) {
                        if (suit === oppSuit) continue;
                        if (eval_.suitCounts[suit] > bestLen) {
                            bestLen = eval_.suitCounts[suit];
                            bestSuit = suit;
                        }
                    }
                    if (bestSuit) {
                        // Jump with 10+ HCP
                        if (hcp >= 10) {
                            const jumpBid = this._tryBid(oppLevel + 2, bestSuit, pos, bidding);
                            if (jumpBid) return jumpBid;
                        }
                        const bid = this._tryBid(oppLevel + 1, bestSuit, pos, bidding)
                            || this._tryBid(oppLevel, bestSuit, pos, bidding);
                        if (bid) return bid;
                        // NT with stopper
                        if (hcp >= 10 && eval_.isBalanced) {
                            const bid = this._tryBid(1, 'NT', pos, bidding)
                                || this._tryBid(2, 'NT', pos, bidding);
                            if (bid) return bid;
                        }
                    }
                }
            }
        }

        return null;
    }

    // ==================== REBIDS ====================

    _getRebid(eval_, pos, bidding, noise, cfg) {
        const hcp = eval_.hcp;
        const tp = eval_.totalPoints;
        const partner = partnerOf(pos);
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');

        if (!partnerBids.length) {
            if (bidding.canDouble(pos) && hcp >= 15) {
                return this._double(pos);
            }
            return this._pass(pos);
        }

        const myLastBid = myBids[myBids.length - 1];
        const partnerLastBid = partnerBids[partnerBids.length - 1];
        const partnerSuit = partnerLastBid.suit;
        const support = partnerSuit !== 'NT' ? (eval_.suitCounts[partnerSuit] || 0) : 0;

        // Blackwood check (expert+)
        if (this._levelAtLeast('expert') && !this._forgetConvention()) {
            const blackwoodBid = this._checkBlackwood(eval_, pos, bidding, partnerBids, myBids, cfg);
            if (blackwoodBid) return blackwoodBid;
        }

        // ==================== OPENER's REBID ====================
        const isOpenerRebid = myBids.length === 1 && partnerBids.length === 1;

        if (isOpenerRebid) {
            return this._getOpenerRebid(eval_, pos, bidding, hcp, tp, myLastBid, partnerLastBid, support, cfg);
        }

        // ==================== RESPONDER's REBID ====================
        if (myBids.length === 1 && partnerBids.length >= 2) {
            return this._getResponderRebid(eval_, pos, bidding, hcp, tp, myLastBid, partnerLastBid, support, cfg);
        }

        // ==================== LATER ROUNDS ====================
        // Raise partner with fit and points
        if (support >= 3 && hcp >= 14) {
            if ((partnerSuit === 'H' || partnerSuit === 'S') && support >= 3) {
                const bid = this._tryBid(4, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(3, 'NT', pos, bidding);
            if (bid) return bid;
        }

        if (bidding.canDouble(pos) && hcp >= 15) {
            return this._double(pos);
        }

        return this._pass(pos);
    }

    _getOpenerRebid(eval_, pos, bidding, hcp, tp, myLastBid, partnerLastBid, support, cfg) {
        const myOpenSuit = myLastBid.suit;
        const partnerSuit = partnerLastBid.suit;
        const raiseNeed = cfg.majorRaiseNeed;

        // After 1NT opening and partner Stayman/Transfer
        if (myLastBid.level === 1 && myLastBid.suit === 'NT') {
            return this._rebidAfter1NT(eval_, pos, bidding, hcp, partnerLastBid, cfg);
        }

        // 1) Raise partner's major with support
        if ((partnerSuit === 'H' || partnerSuit === 'S') && support >= raiseNeed) {
            if (tp >= 19) {
                const bid = this._tryBid(4, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
            if (tp >= 16) {
                const bid = this._tryBid(3, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(2, partnerSuit, pos, bidding);
            if (bid) return bid;
        }

        // 2) Rebid NT with balanced hand
        if (eval_.isBalanced) {
            if (hcp >= 18 && hcp <= 19) {
                const bid = this._tryBid(2, 'NT', pos, bidding);
                if (bid) return bid;
            }
            if (hcp >= 12 && hcp <= 14) {
                const bid = this._tryBid(1, 'NT', pos, bidding);
                if (bid) return bid;
            }
        }

        // 3) Show a new 4+ card suit
        for (const suit of ['S', 'H', 'D', 'C']) {
            if (suit === myOpenSuit) continue;
            if (eval_.suitCounts[suit] >= 4) {
                let bid = this._tryBid(1, suit, pos, bidding);
                if (bid) return bid;
                if (hcp >= 12) {
                    bid = this._tryBid(2, suit, pos, bidding);
                    if (bid) return bid;
                }
            }
        }

        // 4) Rebid own suit with 6+ cards
        if (eval_.suitCounts[myOpenSuit] >= 6) {
            if (hcp >= 16) {
                const bid = this._tryBid(3, myOpenSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(2, myOpenSuit, pos, bidding);
            if (bid) return bid;
        }

        // 5) Rebid 1NT fallback
        let bid = this._tryBid(1, 'NT', pos, bidding);
        if (bid) return bid;

        // 6) Raise partner with 3 cards
        if (support >= 3) {
            bid = this._tryBid(2, partnerSuit, pos, bidding);
            if (bid) return bid;
        }

        // 7) Fallback: rebid own suit
        for (let l = 2; l <= 4; l++) {
            bid = this._tryBid(l, myOpenSuit, pos, bidding);
            if (bid) return bid;
        }

        return this._pass(pos);
    }

    // After opener bid 1NT and partner responded
    _rebidAfter1NT(eval_, pos, bidding, hcp, partnerBid, cfg) {
        const pSuit = partnerBid.suit;
        const pLevel = partnerBid.level;

        // Partner bid Stayman (2C) -> show 4-card major
        if (pLevel === 2 && pSuit === 'C') {
            if (eval_.suitCounts['H'] >= 4 && eval_.suitCounts['S'] >= 4) {
                // Both majors: bid hearts first (SEF) or spades (SAYC)
                const first = cfg.name === 'sef' ? 'H' : 'S';
                return this._tryBid(2, first, pos, bidding) || this._pass(pos);
            }
            if (eval_.suitCounts['H'] >= 4) {
                return this._tryBid(2, 'H', pos, bidding) || this._pass(pos);
            }
            if (eval_.suitCounts['S'] >= 4) {
                return this._tryBid(2, 'S', pos, bidding) || this._pass(pos);
            }
            // No 4-card major: bid 2D
            return this._tryBid(2, 'D', pos, bidding) || this._pass(pos);
        }

        // Partner bid Texas transfer (2D -> hearts, 2H -> spades)
        if (pLevel === 2 && pSuit === 'D') {
            // Complete transfer: bid 2H
            return this._tryBid(2, 'H', pos, bidding) || this._pass(pos);
        }
        if (pLevel === 2 && pSuit === 'H') {
            // Complete transfer: bid 2S
            return this._tryBid(2, 'S', pos, bidding) || this._pass(pos);
        }

        // Partner raised to 2NT: accept with max, pass with min
        if (pLevel === 2 && pSuit === 'NT') {
            if (hcp >= 16) {
                return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
            }
            return this._pass(pos);
        }

        // Partner jumped to 3NT: pass (game reached)
        if (pLevel === 3 && pSuit === 'NT') {
            return this._pass(pos);
        }

        return this._pass(pos);
    }

    _getResponderRebid(eval_, pos, bidding, hcp, tp, myLastBid, partnerLastBid, support, cfg) {
        const partnerSuit = partnerLastBid.suit;

        // Partner rebid their suit or showed new suit
        if (support >= 3) {
            if (tp >= 10) {
                const bid = this._tryBid(partnerLastBid.level + 1, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
        }

        // Game bid with strong hand
        if (hcp >= 12 && support >= 3 && (partnerSuit === 'H' || partnerSuit === 'S')) {
            const bid = this._tryBid(4, partnerSuit, pos, bidding);
            if (bid) return bid;
        }

        if (hcp >= 12 && eval_.isBalanced) {
            const bid = this._tryBid(3, 'NT', pos, bidding);
            if (bid) return bid;
        }

        // Rebid own suit with 6+ cards
        if (myLastBid.suit !== 'NT' && eval_.suitCounts[myLastBid.suit] >= 6) {
            const bid = this._tryBid(myLastBid.level + 1, myLastBid.suit, pos, bidding);
            if (bid) return bid;
        }

        return this._pass(pos);
    }

    // ==================== BLACKWOOD (expert+) ====================

    _checkBlackwood(eval_, pos, bidding, partnerBids, myBids, cfg) {
        if (!partnerBids.length || !myBids.length) return null;

        const partner = partnerOf(pos);
        const partnerLastBid = partnerBids[partnerBids.length - 1];
        const myLastBid = myBids[myBids.length - 1];

        // Check if partner bid 4NT (Blackwood asking)
        if (partnerLastBid.level === 4 && partnerLastBid.suit === 'NT') {
            // Respond to Blackwood
            const aces = this._countAces(eval_);
            const responses = ['C', 'D', 'H', 'S'];
            const responseSuit = responses[aces % 4]; // 0/4=C, 1=D, 2=H, 3=S
            return this._tryBid(5, responseSuit, pos, bidding) || this._pass(pos);
        }

        // Check if we should initiate Blackwood
        // We need a fit established at 3+ level
        const fitSuit = this._findAgreedSuit(bidding, pos);
        if (fitSuit && fitSuit !== 'NT') {
            const totalTP = eval_.totalPoints;
            // If we think slam is possible (33+ combined points expected)
            if (totalTP >= 17 && eval_.hcp >= 15) {
                // Check we are at 4-level
                const currentLevel = bidding.lastBid ? bidding.lastBid.level : 0;
                if (currentLevel >= 3 && currentLevel <= 4) {
                    const bid = this._tryBid(4, 'NT', pos, bidding, 'Blackwood');
                    if (bid) return bid;
                }
            }
        }

        return null;
    }

    _findAgreedSuit(bidding, pos) {
        const partner = partnerOf(pos);
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');

        for (const myBid of myBids) {
            if (myBid.suit === 'NT') continue;
            for (const pBid of partnerBids) {
                if (pBid.suit === myBid.suit) return myBid.suit;
            }
        }
        return null;
    }

    // ==================== CARD PLAY ====================

    playCard(gameState, pos) {
        const hand = gameState.hands[pos];
        const trick = gameState.currentTrick;
        const playable = gameState.getPlayableCards(pos);

        if (playable.length === 1) return playable[0];

        switch (this.level) {
            case 'beginner':
                return this._playBeginner(playable, trick, gameState, pos);
            case 'initiate':
                return this._playInitiate(playable, trick, gameState, pos);
            case 'intermediate':
                return this._playIntermediate(playable, trick, gameState, pos);
            case 'confirmed':
                return this._playConfirmed(playable, trick, gameState, pos);
            case 'expert':
                return this._playAdvanced(playable, trick, gameState, pos);
            case 'master':
                return this._playMaster(playable, trick, gameState, pos);
            default:
                return this._playIntermediate(playable, trick, gameState, pos);
        }
    }

    // ==================== BEGINNER PLAY (mostly random) ====================

    _playBeginner(playable, trick, gameState, pos) {
        if (Math.random() < 0.6) {
            return playable[playable.length - 1];
        }
        return playable[Math.floor(Math.random() * playable.length)];
    }

    // ==================== INITIATE PLAY (basic logic) ====================

    _playInitiate(playable, trick, gameState, pos) {
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);

        if (!trick.suitLed) {
            // Lead highest card from longest suit (simple)
            const bySuit = this._groupBySuit(playable);
            let bestSuit = null;
            let bestLen = 0;
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (cards.length > bestLen) {
                    bestLen = cards.length;
                    bestSuit = suit;
                }
            }
            if (bestSuit) return bySuit[bestSuit][0];
            return playable[0];
        }

        // Basic following: try to win, else play low
        const suitLed = trick.suitLed;
        const followSuit = playable.filter(c => c.suit === suitLed);
        const currentWinning = this._getCurrentWinningCard(trick, trump);

        if (followSuit.length > 0) {
            if (this._isPartnerWinning(trick, partner, trump)) {
                return followSuit[followSuit.length - 1]; // play low
            }
            const winners = followSuit.filter(c => c.value > currentWinning.value);
            if (winners.length > 0) return winners[winners.length - 1]; // win cheaply
            return followSuit[followSuit.length - 1]; // can't win, play low
        }

        // Can't follow: trump if possible
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !this._isPartnerWinning(trick, partner, trump)) {
                return trumpCards[trumpCards.length - 1];
            }
        }

        return playable[playable.length - 1];
    }

    // ==================== INTERMEDIATE PLAY ====================

    _playIntermediate(playable, trick, gameState, pos) {
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);

        if (!trick.suitLed) {
            return this._chooseOpeningLead(playable, gameState, pos);
        }

        const suitLed = trick.suitLed;
        const currentWinning = this._getCurrentWinningCard(trick, trump);
        const currentWinner = this._getCurrentWinner(trick, trump);
        const partnerWinning = currentWinner === partner;

        const followSuit = playable.filter(c => c.suit === suitLed);
        if (followSuit.length > 0) {
            if (partnerWinning) {
                return followSuit[followSuit.length - 1]; // play low
            }
            const winners = followSuit.filter(c => c.value > currentWinning.value);
            if (winners.length > 0) {
                return winners[winners.length - 1]; // win cheaply
            }
            return followSuit[followSuit.length - 1];
        }

        // Can't follow suit
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                return trumpCards[trumpCards.length - 1];
            }
        }

        return this._getLowestDiscard(playable, gameState, pos);
    }

    // ==================== CONFIRMED PLAY (adds finesse) ====================

    _playConfirmed(playable, trick, gameState, pos) {
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);
        const isDeclarer = pos === gameState.declarerPos;

        if (!trick.suitLed) {
            // Try finesse lead
            if (isDeclarer || pos === gameState.dummyPos) {
                const finesseLead = this._tryFinesseLead(playable, gameState, pos);
                if (finesseLead) return finesseLead;
            }
            return this._chooseOpeningLeadAdvanced(playable, gameState, pos);
        }

        const suitLed = trick.suitLed;
        const currentWinning = this._getCurrentWinningCard(trick, trump);
        const currentWinner = this._getCurrentWinner(trick, trump);
        const partnerWinning = currentWinner === partner;
        const cardsPlayed = trick.order.length;

        const followSuit = playable.filter(c => c.suit === suitLed);
        if (followSuit.length > 0) {
            // Second hand low (but high with AK doubleton)
            if (cardsPlayed === 1 && !isDeclarer) {
                if (followSuit.length === 2
                    && followSuit[0].rank === 'A'
                    && followSuit[1].rank === 'K') {
                    return followSuit[0]; // Play A from AK doubleton
                }
                return followSuit[followSuit.length - 1]; // Second hand low
            }

            // Third hand high (cheapest winning card)
            if (cardsPlayed === 2 && !partnerWinning) {
                const winners = followSuit.filter(c => c.value > currentWinning.value);
                if (winners.length > 0) return winners[winners.length - 1]; // cheapest winner
                return followSuit[followSuit.length - 1];
            }

            if (partnerWinning) {
                return followSuit[followSuit.length - 1];
            }

            const winners = followSuit.filter(c => c.value > currentWinning.value);
            if (winners.length > 0) return winners[winners.length - 1];
            return followSuit[followSuit.length - 1];
        }

        // Can't follow suit
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                if (currentWinning.suit === trump) {
                    const overTrumps = trumpCards.filter(c => c.value > currentWinning.value);
                    if (overTrumps.length > 0) return overTrumps[overTrumps.length - 1];
                } else {
                    return trumpCards[trumpCards.length - 1];
                }
            }
        }

        return this._getLowestDiscard(playable, gameState, pos);
    }

    // ==================== EXPERT/ADVANCED PLAY ====================

    _playAdvanced(playable, trick, gameState, pos) {
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);
        const isDeclarer = pos === gameState.declarerPos;
        const isDummy = pos === gameState.dummyPos;

        if (!trick.suitLed) {
            // Declarer: plan de jeu
            if (isDeclarer || isDummy) {
                const planLead = this._planDeJeuLead(playable, gameState, pos);
                if (planLead) return planLead;
                const finesseLead = this._tryFinesseLead(playable, gameState, pos);
                if (finesseLead) return finesseLead;
            }
            return this._chooseOpeningLeadAdvanced(playable, gameState, pos);
        }

        const suitLed = trick.suitLed;
        const currentWinning = this._getCurrentWinningCard(trick, trump);
        const currentWinner = this._getCurrentWinner(trick, trump);
        const partnerWinning = currentWinner === partner;
        const isLast = trick.order.length === 3;
        const cardsPlayed = trick.order.length;

        const followSuit = playable.filter(c => c.suit === suitLed);
        if (followSuit.length > 0) {
            // Second hand low (with AK doubleton exception)
            if (cardsPlayed === 1 && !isDeclarer) {
                if (followSuit.length === 2
                    && followSuit[0].rank === 'A'
                    && followSuit[1].rank === 'K') {
                    return followSuit[0];
                }
                return followSuit[followSuit.length - 1];
            }

            // Third hand high - economy (cheapest winning card)
            if (cardsPlayed === 2 && !partnerWinning) {
                const winners = followSuit.filter(c => c.value > currentWinning.value);
                if (winners.length > 0) return winners[winners.length - 1];
            }

            // Last hand: win cheaply or duck
            if (isLast) {
                if (!partnerWinning) {
                    const winners = followSuit.filter(c => c.value > currentWinning.value);
                    if (winners.length > 0) return winners[winners.length - 1];
                }
                return followSuit[followSuit.length - 1];
            }

            if (partnerWinning) return followSuit[followSuit.length - 1];

            const winners = followSuit.filter(c => c.value > currentWinning.value);
            if (winners.length > 0) return winners[winners.length - 1];
            return followSuit[followSuit.length - 1];
        }

        // Can't follow suit
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                if (currentWinning.suit === trump) {
                    const overTrumps = trumpCards.filter(c => c.value > currentWinning.value);
                    if (overTrumps.length > 0) return overTrumps[overTrumps.length - 1];
                } else {
                    return trumpCards[trumpCards.length - 1];
                }
            }
        }

        // Expert discard: suit preference signal
        return this._getSmartDiscard(playable, gameState, pos);
    }

    // ==================== MASTER PLAY ====================

    _playMaster(playable, trick, gameState, pos) {
        // Master uses the same as expert but with endplay awareness
        const trump = gameState.contract.suit;
        const isDeclarer = pos === gameState.declarerPos;

        if (!trick.suitLed && isDeclarer) {
            // Check for endplay opportunity
            const endplay = this._tryEndplay(playable, gameState, pos);
            if (endplay) return endplay;
        }

        return this._playAdvanced(playable, trick, gameState, pos);
    }

    // ==================== OPENING LEAD LOGIC ====================

    _chooseOpeningLead(playable, gameState, pos) {
        const trump = gameState.contract.suit;
        const bySuit = this._groupBySuit(playable);

        // Against NT: 4th best of longest suit
        if (trump === 'NT') {
            let bestSuit = null;
            let bestLen = 0;
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (cards.length > bestLen) {
                    bestLen = cards.length;
                    bestSuit = suit;
                }
            }
            if (bestSuit && bySuit[bestSuit].length >= 4) {
                return bySuit[bestSuit][3]; // 4th best
            }
            if (bestSuit) {
                return bySuit[bestSuit][bySuit[bestSuit].length - 1];
            }
        }

        // Against suit: lead longest non-trump
        let bestSuit = null;
        let bestLen = 0;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length > bestLen || (cards.length === bestLen &&
                cards[0].value > (bySuit[bestSuit] ? bySuit[bestSuit][0].value : 0))) {
                bestLen = cards.length;
                bestSuit = suit;
            }
        }

        if (bestSuit) {
            const cards = bySuit[bestSuit];
            // Top of sequence
            if (cards.length >= 2 && cards[0].value - cards[1].value === 1) {
                return cards[0];
            }
            if (cards.length >= 4) {
                return cards[3]; // 4th best
            }
            return cards[cards.length - 1];
        }

        return playable[playable.length - 1];
    }

    // ==================== ADVANCED OPENING LEAD (confirmed+) ====================

    _chooseOpeningLeadAdvanced(playable, gameState, pos) {
        const trump = gameState.contract.suit;
        const contract = gameState.contract;
        const bySuit = this._groupBySuit(playable);

        // Against NT: 4th best of longest and strongest suit
        if (trump === 'NT') {
            let bestSuit = null;
            let bestScore = -1;
            for (const [suit, cards] of Object.entries(bySuit)) {
                // Score = length * 10 + HCP in suit
                const suitHCP = cards.reduce((s, c) => s + c.hcp, 0);
                const score = cards.length * 10 + suitHCP;
                if (score > bestScore) {
                    bestScore = score;
                    bestSuit = suit;
                }
            }
            if (bestSuit) {
                const cards = bySuit[bestSuit];
                // Top of sequence (KQJ, QJ10, etc.)
                if (cards.length >= 3 && cards[0].value - cards[1].value === 1 && cards[1].value - cards[2].value === 1) {
                    return cards[0];
                }
                // 4th best
                if (cards.length >= 4) return cards[3];
                return cards[cards.length - 1];
            }
        }

        // Against suit contract
        // 1) Lead singleton (hoping to ruff)
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length === 1) {
                // Don't lead singleton A
                if (cards[0].rank !== 'A') {
                    return cards[0];
                }
            }
        }

        // 2) Top of sequence (KQJ, QJ10)
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length >= 3) {
                if (cards[0].value - cards[1].value === 1 && cards[1].value - cards[2].value === 1) {
                    return cards[0];
                }
            }
            // Lead K from KQ
            if (cards.length >= 2 && cards[0].rank === 'K' && cards[1].rank === 'Q') {
                return cards[0];
            }
        }

        // 3) Avoid leading from AKx into declarer's suit (heuristic: avoid leading A without K)
        // 4) Lead from longest non-trump suit
        let bestSuit = null;
        let bestLen = 0;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            // Skip suits headed by lone A (avoid leading unsupported A)
            if (cards[0].rank === 'A' && (cards.length < 2 || cards[1].rank !== 'K')) continue;
            if (cards.length > bestLen) {
                bestLen = cards.length;
                bestSuit = suit;
            }
        }

        if (bestSuit) {
            const cards = bySuit[bestSuit];
            if (cards.length >= 4) return cards[3]; // 4th best
            return cards[cards.length - 1]; // Low
        }

        // Fallback: any non-trump lead
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit !== trump) return cards[cards.length - 1];
        }

        return playable[playable.length - 1];
    }

    // ==================== FINESSE LOGIC (confirmed+) ====================

    _tryFinesseLead(playable, gameState, pos) {
        const trump = gameState.contract.suit;
        const isDeclarer = pos === gameState.declarerPos;
        const dummyPos = gameState.dummyPos;
        const declarerPos = gameState.declarerPos;

        if (!isDeclarer && pos !== dummyPos) return null;

        // We are declarer or dummy leading
        const partnerPos = isDeclarer ? dummyPos : declarerPos;
        const partnerHand = gameState.hands[partnerPos];
        if (!partnerHand) return null;

        const bySuit = this._groupBySuit(playable);

        // Look for finesse opportunities: lead low toward partner's honor
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump && trump !== 'NT') continue; // don't finesse in trump usually

            const partnerCards = partnerHand.filter(c => c.suit === suit);
            if (partnerCards.length === 0) continue;
            partnerCards.sort((a, b) => b.value - a.value);

            // Partner has AQ -> lead low toward AQ (finesse for K)
            if (partnerCards.some(c => c.rank === 'A') && partnerCards.some(c => c.rank === 'Q')) {
                if (cards.length >= 1) {
                    return cards[cards.length - 1]; // lead low
                }
            }

            // Partner has K -> lead low toward K (finesse for A)
            if (partnerCards.some(c => c.rank === 'K') && !partnerCards.some(c => c.rank === 'A')) {
                if (cards.length >= 2) {
                    return cards[cards.length - 1]; // lead low
                }
            }

            // Partner has KJ -> lead low toward KJ (finesse for Q)
            if (partnerCards.some(c => c.rank === 'K') && partnerCards.some(c => c.rank === 'J')) {
                if (cards.length >= 1) {
                    return cards[cards.length - 1];
                }
            }

            // We have AQ -> this is our tenace, we want RHO to lead into it
            // But if we're leading, lead from partner toward our AQ
            // (This is handled when partner leads toward us)
        }

        return null;
    }

    // ==================== PLAN DE JEU (expert+) ====================

    _planDeJeuLead(playable, gameState, pos) {
        const trump = gameState.contract.suit;
        const isDeclarer = pos === gameState.declarerPos;
        const dummyPos = gameState.dummyPos;

        if (!isDeclarer && pos !== dummyPos) return null;
        if (gameState.tricks.length > 2) return null; // Only plan at start

        const partnerPos = isDeclarer ? dummyPos : gameState.declarerPos;
        const partnerHand = gameState.hands[partnerPos];
        if (!partnerHand) return null;

        const myHand = playable;
        const bySuitMe = this._groupBySuit(myHand);
        const bySuitPartner = this._groupBySuit(partnerHand);

        // Count sure tricks
        let sureTricks = 0;
        let bestDevSuit = null;
        let bestDevPotential = 0;

        for (const suit of ['S', 'H', 'D', 'C']) {
            const myCards = (bySuitMe[suit] || []).sort((a, b) => b.value - a.value);
            const pCards = (bySuitPartner[suit] || []).sort((a, b) => b.value - a.value);
            const combined = [...myCards, ...pCards].sort((a, b) => b.value - a.value);

            // Count top tricks
            let tricks = 0;
            for (let i = 0; i < combined.length; i++) {
                if (combined[i].value >= 14 - i) tricks++; // A, AK, AKQ, etc.
                else break;
            }
            sureTricks += tricks;

            // Development potential: long suits
            const totalLen = myCards.length + pCards.length;
            const devPotential = totalLen >= 8 ? totalLen - 7 : 0;
            if (devPotential > bestDevPotential && suit !== trump) {
                bestDevPotential = devPotential;
                bestDevSuit = suit;
            }
        }

        // Lead toward honors in the short hand
        for (const suit of ['S', 'H', 'D', 'C']) {
            const myCards = bySuitMe[suit] || [];
            const pCards = (bySuitPartner[suit] || []);

            // If partner has honors in a shorter holding, lead toward them
            if (pCards.length > 0 && pCards.length < myCards.length) {
                const pHasHonor = pCards.some(c => c.hcp > 0);
                if (pHasHonor && myCards.length >= 2) {
                    return myCards[myCards.length - 1]; // lead low toward partner's honor
                }
            }
        }

        // Lead from longest suit to establish tricks
        if (bestDevSuit && bySuitMe[bestDevSuit] && bySuitMe[bestDevSuit].length >= 1) {
            const cards = bySuitMe[bestDevSuit];
            // Lead 4th best or low
            if (cards.length >= 4) return cards[3];
            return cards[cards.length - 1];
        }

        return null;
    }

    // ==================== ENDPLAY (master) ====================

    _tryEndplay(playable, gameState, pos) {
        const trump = gameState.contract.suit;

        // Simple endplay: if we have only trump and one suit left,
        // and opponent is squeezed, exit with the right card
        if (gameState.tricks.length < 9) return null; // Too early for endplay

        const bySuit = this._groupBySuit(playable);
        const suitCount = Object.keys(bySuit).length;

        // With 2-3 cards left, check for throw-in opportunity
        if (playable.length <= 4 && suitCount >= 2) {
            // Find a suit where we have only small cards (exit cards)
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (suit === trump) continue;
                if (cards.length === 1 && cards[0].hcp === 0) {
                    // Exit with this card to endplay opponent
                    // (They will have to lead into our tenace)
                    const otherSuits = Object.entries(bySuit).filter(([s]) => s !== suit);
                    const hasTenace = otherSuits.some(([s, cs]) => {
                        if (cs.length >= 2) {
                            return cs[0].value - cs[1].value === 2; // AQ or KJ type
                        }
                        return false;
                    });
                    if (hasTenace) return cards[0]; // throw-in card
                }
            }
        }

        return null;
    }

    // ==================== DISCARD LOGIC ====================

    _getLowestDiscard(playable, gameState, pos) {
        const bySuit = this._groupBySuit(playable);
        const trump = gameState.contract.suit;

        let worstSuit = null;
        let worstScore = Infinity;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            const score = cards.reduce((s, c) => s + c.hcp, 0) + cards.length;
            if (score < worstScore) {
                worstScore = score;
                worstSuit = suit;
            }
        }

        if (worstSuit) {
            return bySuit[worstSuit][bySuit[worstSuit].length - 1];
        }
        return playable[playable.length - 1];
    }

    _getSmartDiscard(playable, gameState, pos) {
        // Expert discard: suit preference signal
        // Discard from suits we don't want partner to lead
        const bySuit = this._groupBySuit(playable);
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);

        let worstSuit = null;
        let worstScore = Infinity;

        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            // Score considers: HCP (protect honors), length (keep guards), texture
            const suitHCP = cards.reduce((s, c) => s + c.hcp, 0);
            const hasSequence = cards.length >= 2 && cards[0].value - cards[1].value === 1;
            const score = suitHCP * 3 + cards.length * 2 + (hasSequence ? 5 : 0);
            if (score < worstScore) {
                worstScore = score;
                worstSuit = suit;
            }
        }

        if (worstSuit) {
            return bySuit[worstSuit][bySuit[worstSuit].length - 1];
        }
        return playable[playable.length - 1];
    }

    // ==================== UTILITY HELPERS ====================

    _groupBySuit(cards) {
        const bySuit = {};
        for (const card of cards) {
            if (!bySuit[card.suit]) bySuit[card.suit] = [];
            bySuit[card.suit].push(card);
        }
        // Sort each suit high to low
        for (const suit of Object.keys(bySuit)) {
            bySuit[suit].sort((a, b) => b.value - a.value);
        }
        return bySuit;
    }

    _getCurrentWinningCard(trick, trump) {
        let winningCard = trick.cards[trick.leader];
        for (const p of trick.order) {
            const c = trick.cards[p];
            if (c.suit === winningCard.suit && c.value > winningCard.value) {
                winningCard = c;
            } else if (trump !== 'NT' && c.suit === trump && winningCard.suit !== trump) {
                winningCard = c;
            }
        }
        return winningCard;
    }

    _getCurrentWinner(trick, trump) {
        let winner = trick.leader;
        let winningCard = trick.cards[trick.leader];
        for (const p of trick.order) {
            const c = trick.cards[p];
            if (c.suit === winningCard.suit && c.value > winningCard.value) {
                winner = p;
                winningCard = c;
            } else if (trump !== 'NT' && c.suit === trump && winningCard.suit !== trump) {
                winner = p;
                winningCard = c;
            }
        }
        return winner;
    }

    _isPartnerWinning(trick, partner, trump) {
        return this._getCurrentWinner(trick, trump) === partner;
    }
}

// ==================== CommonJS export for Node.js server use ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BridgeAI };
}
