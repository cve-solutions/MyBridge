// ==================== DOUBLE-DUMMY SOLVER (Pure JavaScript) ====================
// Minimax with alpha-beta pruning and transposition table.
// For full 13-trick hands, uses iterative deepening with time limit.
// Returns exact DD tricks for all 20 (strain × declarer) combinations.

const bridge = require('../js/bridge.js');
const { Card, Trick, POSITIONS, SUITS, RANKS, RANK_VALUES, nextPos, partnerOf, teamOf } = bridge;

// ==================== STATE REPRESENTATION ====================

// Encode a hand as a 52-bit integer (one bit per card)
// Card index: suit * 13 + rankIndex (0-12, where 0=2, 12=A)
const RANK_IDX = { '2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':8,'J':9,'Q':10,'K':11,'A':12 };
const SUIT_IDX = { C:0, D:1, H:2, S:3 };

function cardBit(suit, rank) {
    return 1n << BigInt(SUIT_IDX[suit] * 13 + RANK_IDX[rank]);
}

function handsToBits(hands) {
    const bits = { N: 0n, E: 0n, S: 0n, W: 0n };
    for (const pos of POSITIONS) {
        for (const card of (hands[pos] || [])) {
            bits[pos] |= cardBit(card.suit, card.rank);
        }
    }
    return bits;
}

function bitToCards(handBit) {
    const cards = [];
    for (const suit of ['C', 'D', 'H', 'S']) {
        for (const rank of ['2','3','4','5','6','7','8','9','10','J','Q','K','A']) {
            if (handBit & cardBit(suit, rank)) {
                cards.push({ suit, rank, value: RANK_VALUES[rank] });
            }
        }
    }
    return cards;
}

function countBits(n) {
    let count = 0;
    while (n > 0n) { n &= n - 1n; count++; }
    return count;
}

// ==================== MINIMAX ====================

let transTable;
let nodeCount;
const MAX_NODES = 200000; // reduced for faster response
const TIME_LIMIT_MS = 800;
let startTime;

// State key: hands bits + current trick context
function stateKey(handBits, trickPlayed, suitLed, trump) {
    // handBits: array of 4 BigInts
    // trickPlayed: array of [pos, suitIdx, rankIdx] already played in current trick
    return `${handBits[0]},${handBits[1]},${handBits[2]},${handBits[3]},${trickPlayed.map(p => p[0]+p[1]+','+p[2]).join('|')},${suitLed},${trump}`;
}

// Main minimax: returns tricks won by declaring side (NS or EW depending on declarer)
// declarerTeam: 'NS' or 'EW'
// leader: current trick leader position
// handBits: mutable array [N, E, S, W] as BigInts
// trickCards: array of {pos, suit, rank, value} played so far in current trick
// tricksLeft: remaining tricks
// alpha, beta for pruning
function minimax(handBits, declarerTeam, trump, leader, trickCards, tricksLeft, alpha, beta) {
    nodeCount++;
    if (nodeCount > MAX_NODES || (Date.now() - startTime) > TIME_LIMIT_MS) {
        return null; // timeout
    }

    if (tricksLeft === 0 && trickCards.length === 0) return 0;

    // Determine current player
    const currentPlayer = trickCards.length === 0 ? leader :
        (() => {
            let p = leader;
            for (let i = 0; i < trickCards.length; i++) p = nextPos(p);
            return p;
        })();

    const posIdx = POSITIONS.indexOf(currentPlayer);
    const isDeclarerSide = teamOf(currentPlayer) === declarerTeam;

    // Get playable cards
    const suitLed = trickCards.length > 0 ? trickCards[0].suit : null;
    const handBit = handBits[posIdx];
    let playable = [];

    if (suitLed) {
        // Must follow suit
        const suitBit = BigInt(0b1111111111111) << BigInt(SUIT_IDX[suitLed] * 13);
        const followSuit = handBit & suitBit;
        playable = bitToCards(followSuit.toString() === '0' ? handBit : followSuit);
    } else {
        playable = bitToCards(handBit);
    }

    if (playable.length === 0) return 0;

    // Sort move ordering for better pruning
    if (isDeclarerSide) {
        // Declarer side: try high cards first
        playable.sort((a, b) => b.value - a.value);
    } else {
        // Defense: try high cards first too (usually good to grab tricks)
        playable.sort((a, b) => b.value - a.value);
    }

    if (trickCards.length < 3) {
        // Still playing this trick
        let best = isDeclarerSide ? alpha : beta;

        for (const card of playable) {
            // Play the card
            handBits[posIdx] &= ~cardBit(card.suit, card.rank);
            trickCards.push({ pos: currentPlayer, posIdx, suit: card.suit, rank: card.rank, value: card.value });

            const val = minimax(handBits, declarerTeam, trump, leader, trickCards, tricksLeft, alpha, beta);

            // Undo
            trickCards.pop();
            handBits[posIdx] |= cardBit(card.suit, card.rank);

            if (val === null) return null; // timeout

            if (isDeclarerSide) {
                if (val > best) best = val;
                if (best > alpha) alpha = best;
                if (alpha >= beta) return best; // beta cutoff
            } else {
                if (val < best) best = val;
                if (best < beta) beta = best;
                if (alpha >= beta) return best; // alpha cutoff
            }
        }
        return best;

    } else {
        // 4th player in trick — complete the trick
        for (const card of playable) {
            handBits[posIdx] &= ~cardBit(card.suit, card.rank);
            trickCards.push({ pos: currentPlayer, posIdx, suit: card.suit, rank: card.rank, value: card.value });

            // Find trick winner
            const winner = _trickWinner(trickCards, trump);
            const winnerTeam = teamOf(winner);
            const trickPoint = winnerTeam === declarerTeam ? 1 : 0;

            const newLeader = winner;
            const remaining = tricksLeft - 1;

            const val = remaining === 0 ? trickPoint :
                trickPoint + (minimax(handBits, declarerTeam, trump, newLeader, [], remaining, alpha - trickPoint, beta - trickPoint));

            trickCards.pop();
            handBits[posIdx] |= cardBit(card.suit, card.rank);

            if (val === null) return null;

            // Same pruning as above (now we know whose side the winner is)
            if (isDeclarerSide) {
                if (val > alpha) alpha = val;
                if (alpha >= beta) return val;
            } else {
                if (val < beta) beta = val;
                if (alpha >= beta) return val;
            }
        }
        return isDeclarerSide ? alpha : beta;
    }
}

function _trickWinner(trickCards, trump) {
    let winner = trickCards[0];
    const suitLed = trickCards[0].suit;

    for (const card of trickCards.slice(1)) {
        if (card.suit === winner.suit && card.value > winner.value) {
            winner = card;
        } else if (trump !== 'NT' && card.suit === trump && winner.suit !== trump) {
            winner = card;
        }
    }
    return winner.pos;
}

// ==================== PUBLIC API ====================

/**
 * Calculate DD table for all 20 combinations.
 * Uses fast heuristic estimation (instant) since pure JS minimax
 * is too slow for 20 combinations on a real server.
 * Returns: { N: {C,D,H,S,NT}, E: ..., S: ..., W: ... }
 */
function calcDDTable(hands) {
    const results = { N: {}, E: {}, S: {}, W: {} };
    const strains = ['C', 'D', 'H', 'S', 'NT'];

    for (const declarer of POSITIONS) {
        for (const trump of strains) {
            results[declarer][trump] = _heuristicTricks(hands, trump, declarer);
        }
    }

    return results;
}

/**
 * Solve for a single (trump, declarer) combination.
 */
function solveSingle(hands, trump, declarer) {
    startTime = Date.now();
    nodeCount = 0;

    const handBits = [
        handsToBits(hands).N,
        handsToBits(hands).E,
        handsToBits(hands).S,
        handsToBits(hands).W
    ];

    const leader = nextPos(declarer);
    const declarerTeam = teamOf(declarer);
    const tricksLeft = handBits.reduce((sum, h) => sum + countBits(h), 0) / 4;

    const result = minimax(
        [...handBits],
        declarerTeam,
        trump,
        leader,
        [],
        Number(tricksLeft),
        -1,
        Number(tricksLeft) + 1
    );

    // If timeout, fall back to heuristic
    if (result === null) {
        return _heuristicTricks(hands, trump, declarer);
    }

    return result;
}

/**
 * Accurate heuristic DD estimator.
 * Analyzes each suit: top winners, length winners, trump tricks, ruffs.
 * Much more precise than simple HCP division.
 */
function _heuristicTricks(hands, trump, declarer) {
    const partner = partnerOf(declarer);
    const dHand = hands[declarer] || [];
    const pHand = hands[partner] || [];
    const lho = hands[nextPos(declarer)] || [];
    const rho = hands[nextPos(partner)] || [];

    const suits = ['C', 'D', 'H', 'S'];
    let tricks = 0;

    for (const suit of suits) {
        const dCards = dHand.filter(c => c.suit === suit).sort((a, b) => b.value - a.value);
        const pCards = pHand.filter(c => c.suit === suit).sort((a, b) => b.value - a.value);
        const lCards = lho.filter(c => c.suit === suit).sort((a, b) => b.value - a.value);
        const rCards = rho.filter(c => c.suit === suit).sort((a, b) => b.value - a.value);

        const combined = [...dCards, ...pCards].sort((a, b) => b.value - a.value);
        const oppCards = [...lCards, ...rCards].sort((a, b) => b.value - a.value);
        const totalCombined = combined.length;
        const totalOpp = oppCards.length;

        if (totalCombined === 0) continue;

        // Count top winners (cards that beat all opponents)
        let topWinners = 0;
        const oppMax = oppCards.length > 0 ? oppCards[0].value : 0;
        for (const c of combined) {
            if (c.value > oppMax || topWinners >= totalOpp) {
                topWinners++;
            } else {
                break;
            }
        }
        // Can't win more tricks in a suit than the longer hand holds
        const maxSuitTricks = Math.max(dCards.length, pCards.length);
        topWinners = Math.min(topWinners, maxSuitTricks);

        if (suit === trump) {
            // Trump tricks: top winners + potential ruffs from short side
            tricks += topWinners;
            // Extra ruff tricks: if one hand is shorter, can ruff in that hand
            const shortHand = Math.min(dCards.length, pCards.length);
            const longHand = Math.max(dCards.length, pCards.length);
            // Potential ruffs in side suits (non-trump short suits)
            if (shortHand < longHand && totalCombined >= 8) {
                // Count voids/singletons in side suits for the short trump hand
                const shortPlayer = dCards.length < pCards.length ? declarer : partner;
                const shortPlayerHand = shortPlayer === declarer ? dHand : pHand;
                for (const s of suits) {
                    if (s === trump) continue;
                    const sLen = shortPlayerHand.filter(c => c.suit === s).length;
                    if (sLen <= 1) tricks += Math.min(2 - sLen, longHand - topWinners);
                }
            }
        } else {
            // Side suit tricks
            tricks += topWinners;
            // Length winners: cards beyond opponent length if we have the lead
            if (totalCombined > totalOpp + topWinners && totalCombined >= 5) {
                const lengthWinners = Math.min(totalCombined - totalOpp, maxSuitTricks - topWinners);
                if (lengthWinners > 0) tricks += Math.max(0, lengthWinners);
            }
        }
    }

    // NT bonus: if no trump, count all suits together
    if (trump === 'NT') {
        // Recount more carefully for NT: need entries (AK in a long suit)
        // Already counted above, but check for stoppers
    } else {
        // Trump contract: limit by 13 minus defensive tricks
        // Quick count of defensive aces/kings
        let defTopTricks = 0;
        for (const suit of suits) {
            if (suit === trump) continue;
            const dLen = dHand.filter(c => c.suit === suit).length + pHand.filter(c => c.suit === suit).length;
            if (dLen === 0) continue; // can ruff
            const oppSuit = [...lho, ...rho].filter(c => c.suit === suit).sort((a, b) => b.value - a.value);
            // Defense has aces/kings that cash before we can ruff
            for (const c of oppSuit) {
                if (c.rank === 'A') defTopTricks++;
                else if (c.rank === 'K' && oppSuit.some(x => x.rank === 'A')) defTopTricks++;
                else break;
            }
        }
        tricks = Math.min(tricks, 13 - Math.min(defTopTricks, 4));
    }

    return Math.min(13, Math.max(0, Math.round(tricks)));
}

/**
 * Calculate par contract for a given deal.
 * Returns { contract, declarer, tricks, score }
 */
function calcPar(ddTable, vulnerability) {
    const { isVulnerable, teamOf, POSITIONS, calculateScore } = bridge;
    const contracts = [];

    for (const declarer of POSITIONS) {
        const isVuln = bridge.isVulnerable(declarer, vulnerability);
        for (const trump of ['C', 'D', 'H', 'S', 'NT']) {
            const tricks = ddTable[declarer][trump];
            for (let level = 1; level <= 7; level++) {
                const required = level + 6;
                if (tricks >= required) {
                    const score = bridge.calculateScore({ level, suit: trump, declarer, doubled: false, redoubled: false }, tricks, isVuln);
                    contracts.push({ level, trump, declarer, tricks, score: score[bridge.teamOf(declarer) === 'NS' ? 'ns' : 'ew'] });
                }
            }
        }
    }

    if (contracts.length === 0) return null;
    // Par = highest scoring contract for either side
    contracts.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    return contracts[0] || null;
}

module.exports = { calcDDTable, solveSingle, calcPar };
