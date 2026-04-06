// ==================== AI BRIDGE PLAYER ====================
// 6 levels: beginner, initiate, intermediate, confirmed, expert, master
// 5 conventions: sef, sayc, acol, 2over1, standard

class BridgeAI {
    constructor(settings) {
        this.level = settings.level || 'intermediate';
        this.convention = settings.convention || 'sef';
    }

    // ==================== CONVENTION CONFIG ====================

    _getConventionConfig() {
        const configs = {
            sef:      { ntMin: 15, ntMax: 17, strong2C: 20, weakNT: false, fiveCardMajor: true, weak2D: false },
            sayc:     { ntMin: 15, ntMax: 17, strong2C: 22, weakNT: false, fiveCardMajor: true, weak2D: true },
            acol:     { ntMin: 12, ntMax: 14, strong2C: 23, weakNT: true,  fiveCardMajor: false, weak2D: false },
            '2over1': { ntMin: 15, ntMax: 17, strong2C: 22, weakNT: false, fiveCardMajor: true, weak2D: true },
            standard: { ntMin: 15, ntMax: 17, strong2C: 22, weakNT: false, fiveCardMajor: true, weak2D: true }
        };
        return configs[this.convention] || configs.sef;
    }

    _levelIndex() {
        const levels = ['beginner','initiate','intermediate','confirmed','expert','master'];
        return levels.indexOf(this.level);
    }

    // ==================== BIDDING AI ====================

    makeBid(gameState, pos) {
        const hand = gameState.hands[pos];
        if (!hand || hand.length === 0) return this._pass(pos);
        const eval_ = evaluateHand(hand);
        const bidding = gameState.bidding;
        const partner = partnerOf(pos);
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const opponentBids = bidding.bids.filter(b => teamOf(b.player) !== teamOf(pos) && b.type === 'bid');
        const isOpening = myBids.length === 0 && partnerBids.length === 0;
        const noise = this._getNoise();

        // Beginner forgets conventions 30% of the time
        if (this.level === 'beginner' && Math.random() < 0.3) {
            return this._getBeginnerRandomBid(eval_, pos, bidding);
        }

        // Competitive bidding: if opponents have bid
        if (opponentBids.length > 0 && myBids.length === 0 && partnerBids.length === 0) {
            return this._getCompetitiveBid(eval_, pos, noise, bidding, opponentBids);
        }

        if (isOpening) {
            return this._getOpeningBid(eval_, pos, noise, bidding);
        }

        if (myBids.length === 0 && partnerBids.length > 0) {
            return this._getResponse(eval_, pos, partnerBids[0], noise, bidding);
        }

        return this._getRebid(eval_, pos, bidding, noise);
    }

    _getNoise() {
        switch (this.level) {
            case 'beginner':     return Math.floor(Math.random() * 7) - 3;
            case 'initiate':     return Math.floor(Math.random() * 5) - 2;
            case 'intermediate': return Math.floor(Math.random() * 3) - 1;
            default:             return 0;
        }
    }

    _tryBid(level, suit, pos, bidding, alertText) {
        const bid = new Bid('bid', level, suit, pos, alertText || null);
        if (bidding.isValidBid(bid)) return bid;
        return null;
    }

    _pass(pos) { return new Bid('pass', null, null, pos); }

    _getBeginnerRandomBid(eval_, pos, bidding) {
        const hcp = eval_.hcp;
        if (hcp < 10) return this._pass(pos);
        if (hcp >= 12) {
            const suit = this._getLongestSuit(eval_);
            return this._tryBid(1, suit, pos, bidding) || this._pass(pos);
        }
        return this._pass(pos);
    }

    // ==================== OPENING BIDS ====================

    _getOpeningBid(eval_, pos, noise, bidding) {
        const hcp = eval_.hcp + noise;
        const tp = eval_.totalPoints + noise;
        const conf = this._getConventionConfig();

        if (hcp < 11) return this._pass(pos);

        // Strong 2C
        if (hcp >= conf.strong2C) {
            return this._tryBid(2, 'C', pos, bidding, 'Fort artificiel') || this._pass(pos);
        }

        // 2NT (20-21 balanced, or 20-22 in some systems)
        if (eval_.isBalanced && hcp >= 20 && hcp <= 22) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        // 1NT opening (convention-dependent range)
        if (eval_.isBalanced && hcp >= conf.ntMin && hcp <= conf.ntMax) {
            return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
        }

        // For Acol: strong 1NT is already 12-14, so 15-19 balanced opens suit then rebids NT
        if (hcp >= 12 || (hcp >= 11 && eval_.distPoints >= 2)) {
            // 5+ card major (in 5th major systems)
            if (conf.fiveCardMajor) {
                if (eval_.suitCounts['S'] >= 5 || eval_.suitCounts['H'] >= 5) {
                    const major = eval_.suitCounts['S'] >= eval_.suitCounts['H'] ? 'S' : 'H';
                    return this._tryBid(1, major, pos, bidding) || this._pass(pos);
                }
            } else {
                // Acol: 4th major - open 1M with 4+ cards
                if (eval_.suitCounts['S'] >= 4 || eval_.suitCounts['H'] >= 4) {
                    const major = eval_.suitCounts['S'] >= eval_.suitCounts['H'] ? 'S' : 'H';
                    return this._tryBid(1, major, pos, bidding) || this._pass(pos);
                }
            }

            // Minor opening
            if (eval_.suitCounts['D'] >= 4) {
                return this._tryBid(1, 'D', pos, bidding) || this._pass(pos);
            }
            return this._tryBid(1, 'C', pos, bidding) || this._pass(pos);
        }

        // Weak two bids (6-10 HCP, 6-card suit)
        if (hcp >= 6 && hcp <= 10 && this._levelIndex() >= 1) {
            if (conf.weak2D) {
                for (const suit of ['S', 'H', 'D']) {
                    if (eval_.suitCounts[suit] >= 6) {
                        return this._tryBid(2, suit, pos, bidding) || this._pass(pos);
                    }
                }
            } else {
                // SEF: only 2H/2S weak
                for (const suit of ['S', 'H']) {
                    if (eval_.suitCounts[suit] >= 6) {
                        return this._tryBid(2, suit, pos, bidding) || this._pass(pos);
                    }
                }
            }
        }

        return this._pass(pos);
    }

    // ==================== RESPONSES ====================

    _getResponse(eval_, pos, partnerBid, noise, bidding) {
        const hcp = eval_.hcp + noise;
        const tp = eval_.totalPoints + noise;
        const conf = this._getConventionConfig();

        if (hcp < 6) return this._pass(pos);

        // Response to 1NT
        if (partnerBid.level === 1 && partnerBid.suit === 'NT') {
            return this._respondTo1NT(eval_, pos, hcp, bidding, conf);
        }

        // Response to 2C (strong)
        if (partnerBid.level === 2 && partnerBid.suit === 'C') {
            return this._respondTo2C(eval_, pos, hcp, bidding);
        }

        // Response to 1-level suit
        if (partnerBid.level === 1 && partnerBid.suit !== 'NT') {
            return this._respondTo1Suit(eval_, pos, hcp, tp, partnerBid, bidding, conf);
        }

        // Default: raise or pass
        if (hcp >= 6 && partnerBid.suit !== 'NT' && eval_.suitCounts[partnerBid.suit] >= 3) {
            const raiseLevel = partnerBid.level + 1;
            if (raiseLevel <= 4) {
                return this._tryBid(raiseLevel, partnerBid.suit, pos, bidding) || this._pass(pos);
            }
        }

        return this._pass(pos);
    }

    _respondTo1NT(eval_, pos, hcp, bidding, conf) {
        // FIX: Texas transfers have PRIORITY over Stayman with 5+ card major
        if (this._levelIndex() >= 1) {
            if (eval_.suitCounts['H'] >= 5) {
                return this._tryBid(2, 'D', pos, bidding, 'Transfert \u2665') || this._pass(pos);
            }
            if (eval_.suitCounts['S'] >= 5) {
                return this._tryBid(2, 'H', pos, bidding, 'Transfert \u2660') || this._pass(pos);
            }
        }

        // Stayman with 4-card major (no 5-card major) and 8+ HCP
        if (hcp >= 8 && (eval_.suitCounts['H'] === 4 || eval_.suitCounts['S'] === 4)) {
            return this._tryBid(2, 'C', pos, bidding, 'Stayman') || this._pass(pos);
        }

        // Raise to 2NT (invitational 8-9)
        if (hcp >= 8 && hcp <= 9) {
            return this._tryBid(2, 'NT', pos, bidding) || this._pass(pos);
        }

        // 3NT (10-15)
        if (hcp >= 10 && hcp <= 15) {
            return this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }

        // Slam interest (16+)
        if (hcp >= 16) {
            return this._tryBid(4, 'NT', pos, bidding, 'Blackwood') || this._tryBid(3, 'NT', pos, bidding) || this._pass(pos);
        }

        return this._pass(pos);
    }

    _respondTo2C(eval_, pos, hcp, bidding) {
        if (hcp >= 8) {
            const longest = this._getLongestSuit(eval_);
            return this._tryBid(2, longest, pos, bidding) || this._tryBid(2, 'D', pos, bidding) || this._pass(pos);
        }
        // Negative: 2D
        return this._tryBid(2, 'D', pos, bidding, 'N\u00e9gatif') || this._pass(pos);
    }

    _respondTo1Suit(eval_, pos, hcp, tp, partnerBid, bidding, conf) {
        const pSuit = partnerBid.suit;
        const minSupport = (conf.fiveCardMajor && (pSuit === 'H' || pSuit === 'S')) ? 3 : 4;

        // Raise partner with sufficient support
        if (eval_.suitCounts[pSuit] >= minSupport) {
            if (tp >= 13) {
                return this._tryBid(3, pSuit, pos, bidding) || this._tryBid(2, pSuit, pos, bidding) || this._pass(pos);
            }
            if (tp >= 6) {
                return this._tryBid(2, pSuit, pos, bidding) || this._pass(pos);
            }
        }

        // New suit at 1 level
        for (const suit of ['S', 'H', 'D', 'C']) {
            if (SUIT_ORDER[suit] > SUIT_ORDER[pSuit] && eval_.suitCounts[suit] >= 4) {
                const bid = this._tryBid(1, suit, pos, bidding);
                if (bid) return bid;
            }
        }

        // 1NT (6-10)
        if (hcp >= 6 && hcp <= 10) {
            return this._tryBid(1, 'NT', pos, bidding) || this._pass(pos);
        }

        // New suit at 2 level (10+ HCP, or 12+ for 2/1 GF)
        const min2Level = this.convention === '2over1' ? 12 : 10;
        if (hcp >= min2Level) {
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

        return this._pass(pos);
    }

    // ==================== COMPETITIVE BIDDING ====================

    _getCompetitiveBid(eval_, pos, noise, bidding, opponentBids) {
        const hcp = eval_.hcp + noise;
        const lastOppBid = opponentBids[opponentBids.length - 1];
        const lvl = this._levelIndex();

        // Only confirmed+ levels do competitive bidding
        if (lvl < 3) {
            if (hcp < 12) return this._pass(pos);
            // Simple overcall with 5+ card suit
            const longest = this._getLongestSuit(eval_);
            if (eval_.suitCounts[longest] >= 5 && hcp >= 8) {
                const bid = this._tryBid(lastOppBid.level, longest, pos, bidding);
                if (bid) return bid;
                return this._tryBid(lastOppBid.level + 1, longest, pos, bidding) || this._pass(pos);
            }
            return this._pass(pos);
        }

        // Takeout double: 12+ HCP, short in opponent's suit, support for unbid suits
        if (hcp >= 12 && lastOppBid.suit !== 'NT' && eval_.suitCounts[lastOppBid.suit] <= 2) {
            const unbidMajors = ['H', 'S'].filter(s => s !== lastOppBid.suit);
            const hasSupport = unbidMajors.every(s => eval_.suitCounts[s] >= 3) ||
                               unbidMajors.some(s => eval_.suitCounts[s] >= 4);
            if (hasSupport && bidding.canDouble(pos)) {
                return new Bid('double', null, null, pos, 'Contre d\'appel');
            }
        }

        // Overcall: 8-16 HCP with 5+ card suit
        if (hcp >= 8 && hcp <= 16) {
            const longest = this._getLongestSuit(eval_);
            if (eval_.suitCounts[longest] >= 5) {
                let bid = this._tryBid(lastOppBid.level, longest, pos, bidding);
                if (bid) return bid;
                bid = this._tryBid(lastOppBid.level + 1, longest, pos, bidding);
                if (bid) return bid;
            }
        }

        // 1NT overcall: 15-18 balanced with stopper in opponent's suit
        if (hcp >= 15 && hcp <= 18 && eval_.isBalanced && lastOppBid.suit !== 'NT') {
            const hasStopper = eval_.suitCards[lastOppBid.suit] &&
                eval_.suitCards[lastOppBid.suit].some(c => c.rank === 'A' || c.rank === 'K');
            if (hasStopper) {
                const bid = this._tryBid(1, 'NT', pos, bidding);
                if (bid) return bid;
            }
        }

        return this._pass(pos);
    }

    // ==================== REBIDS ====================

    _getRebid(eval_, pos, bidding, noise) {
        const hcp = eval_.hcp;
        const tp = eval_.totalPoints;
        const partner = partnerOf(pos);
        const myBids = bidding.bids.filter(b => b.player === pos && b.type === 'bid');
        const partnerBids = bidding.bids.filter(b => b.player === partner && b.type === 'bid');

        if (!partnerBids.length) {
            if (bidding.canDouble(pos) && hcp >= 15 && this._levelIndex() >= 3) {
                return new Bid('double', null, null, pos);
            }
            return this._pass(pos);
        }

        const myLastBid = myBids[myBids.length - 1];
        const partnerLastBid = partnerBids[partnerBids.length - 1];
        const partnerSuit = partnerLastBid.suit;
        const support = partnerSuit !== 'NT' ? (eval_.suitCounts[partnerSuit] || 0) : 0;
        const isOpenerRebid = myBids.length === 1 && partnerBids.length === 1;

        // Blackwood: expert+ with good fit and 16+ HCP
        if (this._levelIndex() >= 4 && support >= 4 && hcp >= 16 && (partnerSuit === 'H' || partnerSuit === 'S')) {
            if (partnerLastBid.level >= 2 && partnerLastBid.level <= 3) {
                const bid = this._tryBid(4, 'NT', pos, bidding, 'Blackwood');
                if (bid) return bid;
            }
        }

        if (isOpenerRebid) {
            return this._getOpenerRebid(eval_, pos, bidding, myLastBid, partnerLastBid, support, hcp, tp);
        }

        // Responder's rebid
        if (myBids.length === 1 && partnerBids.length >= 2) {
            if (support >= 3) {
                if (tp >= 10) {
                    const bid = this._tryBid(partnerLastBid.level + 1, partnerSuit, pos, bidding);
                    if (bid) return bid;
                }
            }
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

        // Later rounds
        if (support >= 3 && hcp >= 14) {
            if ((partnerSuit === 'H' || partnerSuit === 'S') && support >= 3) {
                const bid = this._tryBid(4, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(3, 'NT', pos, bidding);
            if (bid) return bid;
        }

        if (bidding.canDouble(pos) && hcp >= 15 && this._levelIndex() >= 3) {
            return new Bid('double', null, null, pos);
        }

        return this._pass(pos);
    }

    _getOpenerRebid(eval_, pos, bidding, myLastBid, partnerLastBid, support, hcp, tp) {
        const partnerSuit = partnerLastBid.suit;
        const myOpenSuit = myLastBid.suit;

        // Raise partner's major with 4+ support
        if ((partnerSuit === 'H' || partnerSuit === 'S') && support >= 4) {
            if (tp >= 16) {
                const bid = this._tryBid(3, partnerSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(2, partnerSuit, pos, bidding);
            if (bid) return bid;
        }

        // Rebid NT with balanced hand
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

        // Show new 4+ card suit
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

        // Rebid own suit with 6+
        if (eval_.suitCounts[myOpenSuit] >= 6) {
            if (hcp >= 16) {
                const bid = this._tryBid(3, myOpenSuit, pos, bidding);
                if (bid) return bid;
            }
            const bid = this._tryBid(2, myOpenSuit, pos, bidding);
            if (bid) return bid;
        }

        // Fallbacks
        let bid = this._tryBid(1, 'NT', pos, bidding);
        if (bid) return bid;
        if (support >= 3) {
            bid = this._tryBid(2, partnerSuit, pos, bidding);
            if (bid) return bid;
        }
        for (let l = 2; l <= 4; l++) {
            bid = this._tryBid(l, myOpenSuit, pos, bidding);
            if (bid) return bid;
        }
        return this._pass(pos);
    }

    _getLongestSuit(eval_) {
        let best = 'C', bestLen = 0;
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
        if (!hand || hand.length === 0) return null;
        const trick = gameState.currentTrick;
        const playable = gameState.getPlayableCards(pos);

        if (!playable || playable.length === 0) return hand[0];
        if (playable.length === 1) return playable[0];

        const lvl = this._levelIndex();
        if (lvl <= 0) return this._playBeginner(playable, trick, gameState, pos);
        if (lvl <= 1) return this._playInitiate(playable, trick, gameState, pos);
        if (lvl <= 2) return this._playIntermediate(playable, trick, gameState, pos);
        return this._playAdvanced(playable, trick, gameState, pos);
    }

    // ---------- Helper: determine current trick winner ----------
    _trickWinner(trick, trump) {
        if (!trick.order.length) return null;
        let winner = trick.leader;
        let winCard = trick.cards[trick.leader];
        for (const p of trick.order.slice(1)) {
            const c = trick.cards[p];
            if (c.suit === winCard.suit && c.value > winCard.value) {
                winner = p; winCard = c;
            } else if (trump !== 'NT' && c.suit === trump && winCard.suit !== trump) {
                winner = p; winCard = c;
            }
        }
        return { winner, card: winCard };
    }

    // ---------- BEGINNER: mostly random ----------
    _playBeginner(playable, trick, gs, pos) {
        if (Math.random() < 0.5) return playable[playable.length - 1];
        return playable[Math.floor(Math.random() * playable.length)];
    }

    // ---------- INITIATE: basic follow/win ----------
    _playInitiate(playable, trick, gs, pos) {
        const trump = gs.contract.suit;
        if (!trick.suitLed) return this._chooseLeadBasic(playable, gs, pos);

        const tw = this._trickWinner(trick, trump);
        const partnerWinning = tw && tw.winner === partnerOf(pos);
        const suitCards = playable.filter(c => c.suit === trick.suitLed);

        if (suitCards.length > 0) {
            if (partnerWinning) return suitCards[suitCards.length - 1];
            const winners = suitCards.filter(c => c.value > tw.card.value);
            if (winners.length > 0) return winners[winners.length - 1];
            return suitCards[suitCards.length - 1];
        }

        // Can't follow: trump if possible
        if (trump !== 'NT') {
            const trumps = playable.filter(c => c.suit === trump);
            if (trumps.length > 0 && !partnerWinning) return trumps[trumps.length - 1];
        }
        return playable[playable.length - 1];
    }

    // ---------- INTERMEDIATE: standard play ----------
    _playIntermediate(playable, trick, gs, pos) {
        const trump = gs.contract.suit;
        const partner = partnerOf(pos);

        if (!trick.suitLed) return this._chooseOpeningLead(playable, gs, pos);

        const tw = this._trickWinner(trick, trump);
        const partnerWinning = tw && tw.winner === partner;
        const suitCards = playable.filter(c => c.suit === trick.suitLed);

        if (suitCards.length > 0) {
            if (partnerWinning) return suitCards[suitCards.length - 1];
            const winners = suitCards.filter(c => c.value > tw.card.value);
            if (winners.length > 0) return winners[winners.length - 1]; // win cheaply
            return suitCards[suitCards.length - 1];
        }

        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                if (tw.card.suit === trump) {
                    const over = trumpCards.filter(c => c.value > tw.card.value);
                    if (over.length > 0) return over[over.length - 1];
                } else {
                    return trumpCards[trumpCards.length - 1];
                }
            }
        }
        return this._getLowestDiscard(playable, gs, pos);
    }

    // ---------- ADVANCED/EXPERT/MASTER: tactical play ----------
    _playAdvanced(playable, trick, gs, pos) {
        const trump = gs.contract.suit;
        const partner = partnerOf(pos);
        const isDeclarer = pos === gs.declarerPos;
        const isDefense = !isDeclarer && pos !== gs.dummyPos;
        const lvl = this._levelIndex();

        // Leading
        if (!trick.suitLed) {
            if (isDeclarer && lvl >= 4) return this._chooseDeclarerLead(playable, gs, pos);
            if (isDefense && lvl >= 3) return this._chooseDefensiveLead(playable, gs, pos);
            return this._chooseOpeningLead(playable, gs, pos);
        }

        const tw = this._trickWinner(trick, trump);
        const partnerWinning = tw && tw.winner === partner;
        const isLast = trick.order.length === 3;
        const isSecond = trick.order.length === 1;
        const isThird = trick.order.length === 2;
        const suitCards = playable.filter(c => c.suit === trick.suitLed);

        if (suitCards.length > 0) {
            // Partner winning and we're last: play low
            if (partnerWinning && isLast) return suitCards[suitCards.length - 1];

            // Second hand low (defense, confirmed+)
            if (isSecond && isDefense && lvl >= 3) {
                // Exception: play AK doubleton high
                if (suitCards.length === 2 && suitCards[0].rank === 'A' && suitCards[1].rank === 'K') {
                    return suitCards[0];
                }
                return suitCards[suitCards.length - 1];
            }

            // Third hand high
            if (isThird && !partnerWinning) {
                const winners = suitCards.filter(c => c.value > tw.card.value);
                if (winners.length > 0) return winners[winners.length - 1]; // cheapest winner
                return suitCards[suitCards.length - 1];
            }

            // Last hand: win cheaply or duck
            if (isLast) {
                if (!partnerWinning) {
                    const winners = suitCards.filter(c => c.value > tw.card.value);
                    if (winners.length > 0) return winners[winners.length - 1];
                }
                return suitCards[suitCards.length - 1];
            }

            // Finesse attempt (confirmed+): if declarer and have AQ or KJ tenace
            if (isDeclarer && lvl >= 3) {
                const finCard = this._tryFinesse(suitCards, trick, gs, pos);
                if (finCard) return finCard;
            }

            // Default: try to win cheaply
            const winners = suitCards.filter(c => c.value > tw.card.value);
            if (winners.length > 0) return winners[winners.length - 1];
            return suitCards[suitCards.length - 1];
        }

        // Can't follow suit
        if (trump !== 'NT') {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length > 0 && !partnerWinning) {
                if (tw.card.suit === trump) {
                    const over = trumpCards.filter(c => c.value > tw.card.value);
                    if (over.length > 0) return over[over.length - 1];
                } else {
                    return trumpCards[trumpCards.length - 1];
                }
            }
        }

        // Discard with signal (expert+)
        if (isDefense && lvl >= 4) return this._signalDiscard(playable, gs, pos);
        return this._getLowestDiscard(playable, gs, pos);
    }

    // ==================== FINESSE ====================

    _tryFinesse(suitCards, trick, gs, pos) {
        if (suitCards.length < 2) return null;
        const sorted = [...suitCards].sort((a, b) => b.value - a.value);

        // AQ finesse: play Q hoping K is on left
        if (sorted[0].rank === 'A' && sorted[1].rank === 'Q') {
            if (Math.random() < 0.7) return sorted[1]; // play Q
        }

        // KJ finesse: play J hoping Q is on left
        if (sorted[0].rank === 'K' && sorted.length >= 2 && sorted[1].rank === 'J') {
            if (Math.random() < 0.6) return sorted[1];
        }

        return null;
    }

    // ==================== LEADS ====================

    _chooseLeadBasic(playable, gs, pos) {
        // Simple lead: longest non-trump suit, low card
        const trump = gs.contract.suit;
        const bySuit = {};
        for (const c of playable) {
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        }
        let bestSuit = null, bestLen = 0;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length > bestLen) { bestLen = cards.length; bestSuit = suit; }
        }
        if (bestSuit) return bySuit[bestSuit][bySuit[bestSuit].length - 1];
        return playable[playable.length - 1];
    }

    _chooseOpeningLead(playable, gs, pos) {
        const trump = gs.contract.suit;
        const bySuit = {};
        for (const c of playable) {
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        }

        // Against NT: 4th best of longest suit
        if (trump === 'NT') {
            let bestSuit = null, bestLen = 0;
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (cards.length > bestLen) { bestLen = cards.length; bestSuit = suit; }
            }
            if (bestSuit && bySuit[bestSuit].length >= 4) return bySuit[bestSuit][3];
            if (bestSuit) return bySuit[bestSuit][bySuit[bestSuit].length - 1];
        }

        // Against suit contract
        // Lead singleton (confirmed+) hoping to ruff
        if (this._levelIndex() >= 3) {
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (suit === trump) continue;
                if (cards.length === 1) return cards[0]; // singleton lead
            }
        }

        // Top of sequence (KQJ, QJT, etc.)
        let bestSuit = null, bestLen = 0;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length > bestLen || (cards.length === bestLen && cards[0].value > (bySuit[bestSuit]?.[0]?.value || 0))) {
                bestLen = cards.length; bestSuit = suit;
            }
        }

        if (bestSuit) {
            const cards = bySuit[bestSuit];
            // Top of touching honors
            if (cards.length >= 2 && cards[0].value - cards[1].value === 1) return cards[0];
            if (cards.length >= 4) return cards[3]; // 4th best
            return cards[cards.length - 1];
        }

        return playable[playable.length - 1];
    }

    // Declarer lead (expert+): lead toward honors, draw trumps
    _chooseDeclarerLead(playable, gs, pos) {
        const trump = gs.contract.suit;

        // Early game: draw trumps if we have length
        if (trump !== 'NT' && gs.tricks.length <= 2) {
            const trumpCards = playable.filter(c => c.suit === trump);
            if (trumpCards.length >= 3) return trumpCards[0]; // high trump to draw
        }

        // Lead toward tenaces in dummy/hand
        return this._chooseOpeningLead(playable, gs, pos);
    }

    // Defensive lead (confirmed+)
    _chooseDefensiveLead(playable, gs, pos) {
        const trump = gs.contract.suit;
        const bySuit = {};
        for (const c of playable) {
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        }

        // Lead through declarer's suit (lead the suit dummy is short in)
        // Simplified: lead longest non-trump suit
        if (trump === 'NT') {
            // Continue partner's suit if we know it
            // For now: lead 4th best of longest
            let best = null, bestLen = 0;
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (cards.length > bestLen) { bestLen = cards.length; best = suit; }
            }
            if (best && bySuit[best].length >= 4) return bySuit[best][3];
            if (best) return bySuit[best][bySuit[best].length - 1];
        }

        // Against suit: lead singleton, or partner's suit, or safe exit
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            if (cards.length === 1) return cards[0];
        }

        return this._chooseOpeningLead(playable, gs, pos);
    }

    // ==================== DISCARDS ====================

    _getLowestDiscard(playable, gs, pos) {
        const bySuit = {};
        for (const c of playable) {
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        }
        let worstSuit = null, worstScore = Infinity;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === gs.contract.suit) continue;
            const score = cards.reduce((s, c) => s + c.hcp, 0) + cards.length;
            if (score < worstScore) { worstScore = score; worstSuit = suit; }
        }
        if (worstSuit) return bySuit[worstSuit][bySuit[worstSuit].length - 1];
        return playable[playable.length - 1];
    }

    // Signal discard (expert+): discard from suit you don't want led
    _signalDiscard(playable, gs, pos) {
        const trump = gs.contract.suit;
        const bySuit = {};
        for (const c of playable) {
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        }

        // Discard high from suit we don't want, low from suit we want
        let weakest = null, weakestHcp = Infinity;
        for (const [suit, cards] of Object.entries(bySuit)) {
            if (suit === trump) continue;
            const hcpTotal = cards.reduce((s, c) => s + c.hcp, 0);
            if (hcpTotal < weakestHcp) { weakestHcp = hcpTotal; weakest = suit; }
        }

        if (weakest && bySuit[weakest].length > 0) {
            // Discard high card from weak suit as a signal
            return bySuit[weakest][0]; // highest of weak suit
        }
        return this._getLowestDiscard(playable, gs, pos);
    }
}

// ==================== CommonJS export for Node.js server use ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BridgeAI };
}
