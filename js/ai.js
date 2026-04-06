// ==================== AI BRIDGE PLAYER ====================

class BridgeAI {
    constructor(settings) {
        this.level = settings.level || 'intermediate';
        this.convention = settings.convention || 'sef';
    }

    // ==================== BIDDING AI ====================

    makeBid(gameState, pos) {
        const hand = gameState.hands[pos];
        const eval_ = evaluateHand(hand);
        const bidding = gameState.bidding;
        const partner = partnerOf(pos);
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const isOpening = myBids.length === 0 && partnerBids.length === 0;

        // Add randomness for lower levels
        const noise = this._getNoise();

        if (isOpening) {
            return this._getOpeningBid(eval_, pos, noise, bidding);
        }

        if (myBids.length === 0 && partnerBids.length > 0) {
            return this._getResponse(eval_, pos, partnerBids[0], noise, bidding);
        }

        // Rebids and subsequent - simplified
        return this._getRebid(eval_, pos, bidding, noise);
    }

    _getNoise() {
        switch (this.level) {
            case 'beginner': return Math.floor(Math.random() * 6) - 3; // -3 to +2
            case 'intermediate': return Math.floor(Math.random() * 4) - 2; // -2 to +1
            case 'advanced': return Math.floor(Math.random() * 2) - 1; // -1 to 0
            case 'expert': return 0;
            default: return 0;
        }
    }

    _tryBid(level, suit, pos, bidding) {
        const bid = new Bid('bid', level, suit, pos);
        if (bidding.isValidBid(bid)) return bid;
        return null;
    }

    _pass(pos) {
        return new Bid('pass', null, null, pos);
    }

    _getOpeningBid(eval_, pos, noise, bidding) {
        const hcp = eval_.hcp + noise;
        const tp = eval_.totalPoints + noise;

        // Pass with less than 12 HCP (some conventions allow 11)
        if (hcp < 11) return this._pass(pos);

        // Strong 2C opener (20+ HCP)
        if (hcp >= 20) {
            return this._tryBid(2, 'C', pos, bidding) || this._pass(pos);
        }

        // 1NT opening (15-17 balanced)
        if (eval_.isBalanced && hcp >= 15 && hcp <= 17) {
            return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
        }

        // 2NT opening (20-21 balanced)
        if (eval_.isBalanced && hcp >= 20 && hcp <= 21) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        if (hcp >= 12 || (hcp >= 11 && eval_.distPoints >= 2)) {
            // Open longest suit
            const longest = this._getLongestSuit(eval_);

            // 5+ card major
            if ((eval_.suitCounts['S'] >= 5 || eval_.suitCounts['H'] >= 5)) {
                const major = eval_.suitCounts['S'] >= eval_.suitCounts['H'] ? 'S' : 'H';
                return this._tryBid(1, major, pos, bidding) || this._pass(pos);
            }

            // 4+ card minor
            if (eval_.suitCounts['D'] >= 4) {
                return this._tryBid(1, 'D', pos, bidding) || this._pass(pos);
            }
            return this._tryBid(1, 'C', pos, bidding) || this._pass(pos);
        }

        // Weak two bids (6-10 HCP, 6-card suit)
        if (hcp >= 6 && hcp <= 10) {
            for (const suit of ['S', 'H', 'D']) {
                if (eval_.suitCounts[suit] >= 6) {
                    return this._tryBid(2, suit, pos, bidding) || this._pass(pos);
                }
            }
        }

        return this._pass(pos);
    }

    _getResponse(eval_, pos, partnerBid, noise, bidding) {
        const hcp = eval_.hcp + noise;
        const tp = eval_.totalPoints + noise;

        if (hcp < 6) return this._pass(pos);

        // Response to 1-level suit
        if (partnerBid.level === 1 && partnerBid.suit !== 'NT') {
            // Raise partner with 4+ card support
            if (eval_.suitCounts[partnerBid.suit] >= 4) {
                if (tp >= 13) {
                    // Jump raise
                    return this._tryBid(3, partnerBid.suit, pos, bidding) || this._tryBid(2, partnerBid.suit, pos, bidding) || this._pass(pos);
                }
                if (tp >= 6) {
                    return this._tryBid(2, partnerBid.suit, pos, bidding) || this._pass(pos);
                }
            }

            // New suit at 1 level
            for (const suit of ['S', 'H', 'D', 'C']) {
                if (SUIT_ORDER[suit] > SUIT_ORDER[partnerBid.suit] && eval_.suitCounts[suit] >= 4) {
                    const bid = this._tryBid(1, suit, pos, bidding);
                    if (bid) return bid;
                }
            }

            // 1NT response (6-10 HCP)
            if (hcp >= 6 && hcp <= 10) {
                return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
            }

            // New suit at 2 level (10+ HCP)
            if (hcp >= 10) {
                for (const suit of ['C', 'D', 'H', 'S']) {
                    if (eval_.suitCounts[suit] >= 4) {
                        const bid = this._tryBid(2, suit, pos, bidding);
                        if (bid) return bid;
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
        }

        // Response to 1NT
        if (partnerBid.level === 1 && partnerBid.suit === 'NT') {
            // Stayman with 4-card major and 8+ HCP
            if (hcp >= 8 && (eval_.suitCounts['H'] >= 4 || eval_.suitCounts['S'] >= 4)) {
                return this._tryBid(2, 'C', pos, bidding) || this._pass(pos);
            }
            // Raise to 2NT (8-9)
            if (hcp >= 8 && hcp <= 9) {
                return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
            }
            // 3NT (10-15)
            if (hcp >= 10 && hcp <= 15) {
                return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
            }
            // Transfer with 5+ major
            if (eval_.suitCounts['H'] >= 5) {
                return this._tryBid(2, 'D', pos, bidding) || this._pass(pos);
            }
            if (eval_.suitCounts['S'] >= 5) {
                return this._tryBid(2, 'H', pos, bidding) || this._pass(pos);
            }
        }

        // Response to 2C (strong)
        if (partnerBid.level === 2 && partnerBid.suit === 'C') {
            if (hcp >= 8) {
                // Positive response - bid longest suit
                const longest = this._getLongestSuit(eval_);
                return this._tryBid(2, longest, pos, bidding) || this._tryBid(2, 'D', pos, bidding) || this._pass(pos);
            }
            // Negative response
            return this._tryBid(2, 'D', pos, bidding) || this._pass(pos);
        }

        // Default: pass or simple raise
        if (hcp >= 6 && eval_.suitCounts[partnerBid.suit] >= 3) {
            const raiseLevel = partnerBid.level + 1;
            if (raiseLevel <= 4) {
                return this._tryBid(raiseLevel, partnerBid.suit, pos, bidding) || this._pass(pos);
            }
        }

        return this._pass(pos);
    }

    _getRebid(eval_, pos, bidding, noise) {
        const hcp = eval_.hcp; // No noise on rebids - opener already committed
        const tp = eval_.totalPoints;
        const partner = partnerOf(pos);
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');

        if (!partnerBids.length) {
            // Partner never bid - we can pass or compete
            if (bidding.canDouble(pos) && hcp >= 15) {
                return new Bid('double', null, null, pos);
            }
            return this._pass(pos);
        }

        const myLastBid = myBids[myBids.length - 1];
        const partnerLastBid = partnerBids[partnerBids.length - 1];
        const partnerSuit = partnerLastBid.suit;
        const support = partnerSuit !== 'NT' ? (eval_.suitCounts[partnerSuit] || 0) : 0;

        // ==================== OPENER'S REBID ====================
        // After opening and partner responded in a new suit at 1-level: FORCING
        // Opener MUST bid again
        const isOpenerRebid = myBids.length === 1 && partnerBids.length === 1;

        if (isOpenerRebid) {
            const myOpenSuit = myLastBid.suit;

            // 1) Raise partner's major with 4+ support
            if ((partnerSuit === 'H' || partnerSuit === 'S') && support >= 4) {
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

            // 3) Show a new 4+ card suit at cheapest level
            for (const suit of ['S', 'H', 'D', 'C']) {
                if (suit === myOpenSuit) continue;
                if (eval_.suitCounts[suit] >= 4) {
                    // Try at 1-level first, then 2-level
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

            // 5) Rebid 1NT as fallback (catch-all for 12-14 unbalanced)
            let bid = this._tryBid(1, 'NT', pos, bidding);
            if (bid) return bid;

            // 6) Raise partner's suit with 3 cards
            if (support >= 3) {
                bid = this._tryBid(2, partnerSuit, pos, bidding);
                if (bid) return bid;
            }

            // 7) Absolute fallback - rebid own suit at cheapest level
            for (let l = 2; l <= 4; l++) {
                bid = this._tryBid(l, myOpenSuit, pos, bidding);
                if (bid) return bid;
            }

            // Should never reach here, but just in case
            return this._pass(pos);
        }

        // ==================== RESPONDER'S REBID ====================
        if (myBids.length === 1 && partnerBids.length >= 2) {
            // Partner rebid - decide based on combined strength
            // Raise partner with fit
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
            return this._pass(pos);
        }

        // ==================== LATER ROUNDS ====================
        // Raise partner's last suit if we have fit and points
        if (support >= 3 && hcp >= 14) {
            if ((partnerSuit === 'H' || partnerSuit === 'S') && support >= 3) {
                const bid = this._tryBid(4, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(3, 'NT', pos, bidding);
            if (bid) return bid;
        }

        // Competitive double
        if (bidding.canDouble(pos) && hcp >= 15) {
            return new Bid('double', null, null, pos);
        }

        return this._pass(pos);
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

    // ==================== CARD PLAY AI ====================

    playCard(gameState, pos) {
        const hand = gameState.hands[pos];
        const trick = gameState.currentTrick;
        const playable = gameState.getPlayableCards(pos);

        if (playable.length === 1) return playable[0];

        switch (this.level) {
            case 'beginner':
                return this._playBeginner(playable, trick, gameState, pos);
            case 'intermediate':
                return this._playIntermediate(playable, trick, gameState, pos);
            case 'advanced':
            case 'expert':
                return this._playAdvanced(playable, trick, gameState, pos);
            default:
                return this._playIntermediate(playable, trick, gameState, pos);
        }
    }

    _playBeginner(playable, trick, gameState, pos) {
        // Mostly random, slightly preferring lower cards
        if (Math.random() < 0.6) {
            // Play low
            return playable[playable.length - 1];
        }
        return playable[Math.floor(Math.random() * playable.length)];
    }

    _playIntermediate(playable, trick, gameState, pos) {
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);

        // Leading
        if (!trick.suitLed) {
            return this._chooseOpeningLead(playable, gameState, pos);
        }

        // Following suit
        const cardsInTrick = trick.order.length;
        const suitLed = trick.suitLed;

        // Determine current winner
        let currentWinner = trick.leader;
        let currentWinningCard = trick.cards[trick.leader];
        for (const p of trick.order) {
            const c = trick.cards[p];
            if (c.suit === currentWinningCard.suit && c.value > currentWinningCard.value) {
                currentWinner = p;
                currentWinningCard = c;
            } else if (trump !== 'NT' && c.suit === trump && currentWinningCard.suit !== trump) {
                currentWinner = p;
                currentWinningCard = c;
            }
        }

        const partnerWinning = currentWinner === partner;

        // If we can follow suit
        const followSuit = playable.filter(c => c.suit === suitLed);
        if (followSuit.length > 0) {
            if (partnerWinning) {
                // Play low - partner is winning
                return followSuit[followSuit.length - 1];
            }
            // Try to win
            const winners = followSuit.filter(c => c.value > currentWinningCard.value);
            if (winners.length > 0) {
                return winners[winners.length - 1]; // Win cheaply
            }
            return followSuit[followSuit.length - 1]; // Can't win, play low
        }

        // Can't follow suit
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                // Trump in
                return trumpCards[trumpCards.length - 1]; // Lowest trump
            }
        }

        // Discard lowest card from weakest suit
        return this._getLowestDiscard(playable, gameState, pos);
    }

    _playAdvanced(playable, trick, gameState, pos) {
        // Enhanced intermediate with better decisions
        const trump = gameState.contract.suit;
        const partner = partnerOf(pos);
        const isDeclarer = pos === gameState.declarerPos;
        const isDummy = pos === gameState.dummyPos;

        if (!trick.suitLed) {
            return this._chooseOpeningLead(playable, gameState, pos);
        }

        const suitLed = trick.suitLed;

        // Determine current trick winner
        let currentWinner = trick.leader;
        let currentWinningCard = trick.cards[trick.leader];
        for (const p of trick.order) {
            const c = trick.cards[p];
            if (c.suit === currentWinningCard.suit && c.value > currentWinningCard.value) {
                currentWinner = p;
                currentWinningCard = c;
            } else if (trump !== 'NT' && c.suit === trump && currentWinningCard.suit !== trump) {
                currentWinner = p;
                currentWinningCard = c;
            }
        }

        const partnerWinning = currentWinner === partner;
        const isLast = trick.order.length === 3;

        const followSuit = playable.filter(c => c.suit === suitLed);
        if (followSuit.length > 0) {
            if (partnerWinning && isLast) {
                return followSuit[followSuit.length - 1]; // play low
            }
            if (partnerWinning && !isLast) {
                // Might still need to beat - play second hand low if partner winning
                return followSuit[followSuit.length - 1];
            }
            // Second hand low
            if (trick.order.length === 1 && !isDeclarer) {
                return followSuit[followSuit.length - 1];
            }
            // Third hand high
            if (trick.order.length === 2 && !partnerWinning) {
                const winners = followSuit.filter(c => c.value > currentWinningCard.value);
                if (winners.length > 0) return winners[winners.length - 1];
            }
            // Last hand - win cheaply or duck
            if (isLast) {
                if (!partnerWinning) {
                    const winners = followSuit.filter(c => c.value > currentWinningCard.value);
                    if (winners.length > 0) return winners[winners.length - 1];
                }
                return followSuit[followSuit.length - 1];
            }

            // Default: try to win
            const winners = followSuit.filter(c => c.value > currentWinningCard.value);
            if (winners.length > 0) return winners[winners.length - 1];
            return followSuit[followSuit.length - 1];
        }

        // Can't follow suit
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                // Check if already trumped
                if (currentWinningCard.suit === trump) {
                    const overTrumps = trumpCards.filter(c => c.value > currentWinningCard.value);
                    if (overTrumps.length > 0) return overTrumps[overTrumps.length - 1];
                } else {
                    return trumpCards[trumpCards.length - 1];
                }
            }
        }

        return this._getLowestDiscard(playable, gameState, pos);
    }

    _chooseOpeningLead(playable, gameState, pos) {
        const trump = gameState.contract.suit;
        const contract = gameState.contract;

        // Group by suit
        const bySuit = {};
        for (const card of playable) {
            if (!bySuit[card.suit]) bySuit[card.suit] = [];
            bySuit[card.suit].push(card);
        }

        // Against NT: lead 4th best of longest suit
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

        // Against suit contract
        // Lead partner's suit if known (simplified - just lead longest non-trump)
        let bestSuit = null;
        let bestLen = 0;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length > bestLen || (cards.length === bestLen && cards[0].value > (bySuit[bestSuit]?.[0]?.value || 0))) {
                bestLen = cards.length;
                bestSuit = suit;
            }
        }

        if (bestSuit) {
            // Lead top of sequence or 4th best
            const cards = bySuit[bestSuit];
            if (cards.length >= 2 && cards[0].value - cards[1].value === 1) {
                return cards[0]; // Top of sequence
            }
            if (cards.length >= 4) {
                return cards[3]; // 4th best
            }
            return cards[cards.length - 1]; // Low
        }

        // Lead low trump as last resort
        return playable[playable.length - 1];
    }

    _getLowestDiscard(playable, gameState, pos) {
        // Discard from shortest/weakest suit
        const bySuit = {};
        for (const card of playable) {
            if (!bySuit[card.suit]) bySuit[card.suit] = [];
            bySuit[card.suit].push(card);
        }

        let worstSuit = null;
        let worstScore = Infinity;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === gameState.contract.suit) continue; // Don't discard trumps if possible
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
}

// ==================== CommonJS export for Node.js server use ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BridgeAI };
}
