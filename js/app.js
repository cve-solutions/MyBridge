// ==================== APPLICATION CONTROLLER ====================

class BridgeApp {
    constructor() {
        this.settings = {
            seat: 'S',
            level: 'intermediate',
            convention: 'sef',
            scoring: 'duplicate'
        };
        this.gameState = null;
        this.ai = null;
        this.selectedBidLevel = null;
        this.selectedBidSuit = null;
        this.aiDelay = 800;
        this.trickClearDelay = 1200;

        this._initUI();
        this._loadUserSettings();
    }

    // ==================== UI INITIALIZATION ====================

    _initUI() {
        // Seat selection
        document.querySelectorAll('.seat-pos').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.seat-pos').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                this.settings.seat = el.dataset.seat;
            });
        });

        // Level selection
        document.querySelectorAll('[data-level]').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('[data-level]').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                this.settings.level = el.dataset.level;
            });
        });

        // Convention selection
        document.querySelectorAll('[data-convention]').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('[data-convention]').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                this.settings.convention = el.dataset.convention;
            });
        });

        // Scoring selection
        document.querySelectorAll('[data-scoring]').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('[data-scoring]').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                this.settings.scoring = el.dataset.scoring;
            });
        });

        // Start game
        document.getElementById('start-game-btn').addEventListener('click', () => this._startGame());

        // Settings button (back to settings)
        document.getElementById('settings-btn').addEventListener('click', () => this._showScreen('settings-screen'));

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this._logout());
        }

        // Bidding controls
        document.querySelectorAll('.bid-level-btn').forEach(el => {
            el.addEventListener('click', () => this._selectBidLevel(parseInt(el.dataset.level)));
        });

        document.querySelectorAll('.bid-suit-btn').forEach(el => {
            el.addEventListener('click', () => this._selectBidSuit(el.dataset.suit));
        });

        document.getElementById('bid-pass').addEventListener('click', () => this._humanBid('pass'));
        document.getElementById('bid-double').addEventListener('click', () => this._humanBid('double'));
        document.getElementById('bid-redouble').addEventListener('click', () => this._humanBid('redouble'));
        document.getElementById('bid-confirm').addEventListener('click', () => this._humanBid('bid'));

        // Score screen
        document.getElementById('next-deal-btn').addEventListener('click', () => this._nextDeal());
        document.getElementById('back-settings-btn').addEventListener('click', () => this._showScreen('settings-screen'));
    }

    // ==================== SCREEN MANAGEMENT ====================

    _showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    // ==================== GAME FLOW ====================

    _startGame() {
        this._saveUserSettings();
        this.gameState = new GameState(this.settings);
        this.ai = new BridgeAI(this.settings);
        this._showScreen('game-screen');
        this._startDeal();
    }

    _startDeal() {
        this.gameState.startDeal();
        this._updateInfoBar();
        this._updateBiddingHeader();
        this._renderAllHands();
        this._showBiddingPanel();
        this._hideTrickArea();

        // Start AI bidding if AI starts
        this._processBidding();
    }

    _nextDeal() {
        this.gameState.dealNumber++;
        this._showScreen('game-screen');
        this._startDeal();
    }

    // ==================== INFO BAR ====================

    _updateInfoBar() {
        const gs = this.gameState;
        document.getElementById('dealer-display').textContent = POSITION_FR[gs.dealer];

        const vulnDisplay = {
            'None': 'Personne',
            'NS': 'Nord-Sud',
            'EW': 'Est-Ouest',
            'Both': 'Tous'
        };
        document.getElementById('vuln-display').textContent = vulnDisplay[gs.vulnerability];

        if (gs.contract) {
            const c = gs.contract;
            const suitStr = c.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[c.suit];
            let contractStr = `${c.level}${suitStr} par ${POSITION_FR[c.declarer]}`;
            if (c.doubled) contractStr += ' contré';
            if (c.redoubled) contractStr += ' surcontré';
            document.getElementById('contract-display').textContent = contractStr;
        } else {
            document.getElementById('contract-display').textContent = '-';
        }

        document.getElementById('tricks-ns').textContent = gs.tricksWon.NS;
        document.getElementById('tricks-ew').textContent = gs.tricksWon.EW;
    }

    // ==================== HAND RENDERING ====================

    _renderAllHands() {
        for (const pos of POSITIONS) {
            this._renderHand(pos);
        }
        this._updatePlayerLabels();
    }

    _renderHand(pos) {
        const gs = this.gameState;
        const container = document.getElementById(`cards-${pos.toLowerCase() === 'n' ? 'north' : pos.toLowerCase() === 'e' ? 'east' : pos.toLowerCase() === 's' ? 'south' : 'west'}`);
        const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
        const containerEl = document.getElementById(`cards-${posName}`);
        containerEl.innerHTML = '';

        const hand = gs.hands[pos];
        const showCards = gs.shouldShowCards(pos);
        const isPlayPhase = gs.phase === 'playing';
        const isHumanTurn = isPlayPhase && gs.currentTrick &&
            gs.currentTrick.currentPlayer === pos &&
            gs.isHumanControlled(pos);

        const playableCards = isHumanTurn ? gs.getPlayableCards(pos) : [];

        for (const card of hand) {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';

            if (showCards) {
                cardEl.innerHTML = `<span class="card-rank">${RANK_DISPLAY[card.rank]}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>`;
                if (card.isRed) cardEl.classList.add('red-card');

                if (isHumanTurn && playableCards.some(c => c.equals(card))) {
                    cardEl.classList.add('playable');
                    cardEl.addEventListener('click', () => this._humanPlayCard(pos, card));
                }
            } else {
                cardEl.classList.add('face-down');
                cardEl.innerHTML = '<span class="card-rank">&nbsp;</span><span class="card-suit">&nbsp;</span>';
            }

            containerEl.appendChild(cardEl);
        }
    }

    _updatePlayerLabels() {
        const gs = this.gameState;
        for (const pos of POSITIONS) {
            const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
            const label = document.getElementById(`label-${posName}`);

            let text = POSITION_FR[pos];
            if (pos === gs.humanPos) {
                text += ' (Vous)';
            } else {
                text += ' (IA)';
            }

            label.textContent = text;
            label.classList.remove('active-player', 'dummy-label');

            if (gs.phase === 'bidding' && gs.bidding && gs.bidding.currentBidder === pos && !gs.bidding.isComplete) {
                label.classList.add('active-player');
            }
            if (gs.phase === 'playing' && gs.currentTrick && gs.currentTrick.currentPlayer === pos) {
                label.classList.add('active-player');
            }
            if (gs.phase === 'playing' && gs.dummyPos === pos) {
                label.classList.add('dummy-label');
            }
        }
    }

    // ==================== BIDDING ====================

    _showBiddingPanel() {
        document.getElementById('bidding-panel').classList.remove('hidden');
        document.getElementById('trick-area').classList.add('hidden');
        this._resetBidSelection();
        this._updateBiddingControls();
    }

    _hideBiddingPanel() {
        document.getElementById('bidding-panel').classList.add('hidden');
    }

    _updateBiddingHeader() {
        // Update header based on dealer position
        const gs = this.gameState;
        const header = document.querySelector('.bid-header');
        header.innerHTML = '<span>Ouest</span><span>Nord</span><span>Est</span><span>Sud</span>';
    }

    _updateBiddingHistory() {
        const gs = this.gameState;
        const rows = gs.bidding.getBidHistory();
        const container = document.getElementById('bid-history-rows');
        container.innerHTML = '';

        // We need to map bids to W, N, E, S columns
        const allBids = gs.bidding.bids;
        const dealerIdx = POSITIONS.indexOf(gs.dealer);

        // Create display order: W=0, N=1, E=2, S=3
        const displayOrder = ['W', 'N', 'E', 'S'];
        const dealerCol = displayOrder.indexOf(gs.dealer);

        let bidIdx = 0;
        let col = dealerCol;
        let rowEl = document.createElement('div');
        rowEl.className = 'bid-row';

        // Add empty cells before dealer
        for (let i = 0; i < dealerCol; i++) {
            const cell = document.createElement('span');
            cell.className = 'bid-cell';
            cell.textContent = '-';
            rowEl.appendChild(cell);
        }

        for (const bid of allBids) {
            const cell = document.createElement('span');
            cell.className = 'bid-cell';
            cell.innerHTML = bid.toDisplayHTML();

            rowEl.appendChild(cell);
            col = (col + 1) % 4;

            if (col === 0) {
                container.appendChild(rowEl);
                rowEl = document.createElement('div');
                rowEl.className = 'bid-row';
            }
        }

        if (rowEl.children.length > 0) {
            container.appendChild(rowEl);
        }

        // Auto scroll
        const historyEl = document.getElementById('bidding-history');
        historyEl.scrollTop = historyEl.scrollHeight;
    }

    _resetBidSelection() {
        this.selectedBidLevel = null;
        this.selectedBidSuit = null;
        document.querySelectorAll('.bid-level-btn').forEach(b => b.classList.remove('selected'));
        document.querySelectorAll('.bid-suit-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById('bid-confirm').disabled = true;
    }

    _selectBidLevel(level) {
        this.selectedBidLevel = level;
        document.querySelectorAll('.bid-level-btn').forEach(b => {
            b.classList.toggle('selected', parseInt(b.dataset.level) === level);
        });
        this._updateBidConfirmButton();
    }

    _selectBidSuit(suit) {
        this.selectedBidSuit = suit;
        document.querySelectorAll('.bid-suit-btn').forEach(b => {
            b.classList.toggle('selected', b.dataset.suit === suit);
        });
        this._updateBidConfirmButton();
    }

    _updateBidConfirmButton() {
        const canConfirm = this.selectedBidLevel && this.selectedBidSuit;
        document.getElementById('bid-confirm').disabled = !canConfirm;
    }

    _updateBiddingControls() {
        const gs = this.gameState;
        const isHumanTurn = gs.bidding && gs.bidding.currentBidder === gs.humanPos && !gs.bidding.isComplete;

        // Enable/disable all controls
        const controls = document.getElementById('bidding-controls');
        controls.style.opacity = isHumanTurn ? '1' : '0.4';
        controls.style.pointerEvents = isHumanTurn ? 'auto' : 'none';

        if (isHumanTurn) {
            // Update double/redouble availability
            document.getElementById('bid-double').disabled = !gs.bidding.canDouble(gs.humanPos);
            document.getElementById('bid-redouble').disabled = !gs.bidding.canRedouble(gs.humanPos);

            // Disable bid levels/suits that would be invalid
            document.querySelectorAll('.bid-level-btn').forEach(btn => {
                const level = parseInt(btn.dataset.level);
                let hasValidBid = false;
                for (const suit of ['C', 'D', 'H', 'S', 'NT']) {
                    const testBid = new Bid('bid', level, suit, gs.humanPos);
                    if (gs.bidding.isValidBid(testBid)) {
                        hasValidBid = true;
                        break;
                    }
                }
                btn.disabled = !hasValidBid;
            });
        }
    }

    _humanBid(type) {
        const gs = this.gameState;
        if (!gs.bidding || gs.bidding.currentBidder !== gs.humanPos) return;

        let bid;
        if (type === 'pass') {
            bid = new Bid('pass', null, null, gs.humanPos);
        } else if (type === 'double') {
            bid = new Bid('double', null, null, gs.humanPos);
        } else if (type === 'redouble') {
            bid = new Bid('redouble', null, null, gs.humanPos);
        } else if (type === 'bid') {
            if (!this.selectedBidLevel || !this.selectedBidSuit) return;
            bid = new Bid('bid', this.selectedBidLevel, this.selectedBidSuit, gs.humanPos);
        }

        if (!gs.bidding.isValidBid(bid)) {
            this._showMessage('Enchère non valide !');
            return;
        }

        gs.bidding.placeBid(bid);
        this._resetBidSelection();
        this._updateBiddingHistory();
        this._updatePlayerLabels();

        if (gs.bidding.isComplete) {
            this._finalizeBidding();
        } else {
            this._processBidding();
        }
    }

    _processBidding() {
        const gs = this.gameState;
        if (!gs.bidding || gs.bidding.isComplete) return;

        const currentBidder = gs.bidding.currentBidder;

        if (currentBidder === gs.humanPos) {
            // Human's turn - enable controls
            this._updateBiddingControls();
            this._updatePlayerLabels();
            return;
        }

        // AI's turn
        this._updateBiddingControls();
        this._updatePlayerLabels();

        setTimeout(() => {
            const bid = this.ai.makeBid(gs, currentBidder);
            gs.bidding.placeBid(bid);
            this._updateBiddingHistory();
            this._updatePlayerLabels();

            if (gs.bidding.isComplete) {
                this._finalizeBidding();
            } else {
                this._processBidding();
            }
        }, this.aiDelay);
    }

    _finalizeBidding() {
        const gs = this.gameState;
        const contract = gs.bidding.contract;

        if (!contract) {
            // Passed out
            this._showMessage('Donne passée !');
            setTimeout(() => {
                this.gameState.phase = 'scoring';
                this._showScoreScreen();
            }, 2000);
            return;
        }

        gs.contract = contract;
        this._updateInfoBar();

        const suitStr = contract.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[contract.suit];
        this._showMessage(`Contrat: ${contract.level}${suitStr} par ${POSITION_FR[contract.declarer]}`);

        setTimeout(() => {
            gs.startPlay();
            this._hideBiddingPanel();
            this._showTrickArea();
            this._renderAllHands();
            this._processPlay();
        }, 2000);
    }

    // ==================== CARD PLAY ====================

    _showTrickArea() {
        // Mark trick area as visible (used as a state flag)
        document.getElementById('trick-area').classList.remove('hidden');
        this._clearTrickDisplay();
    }

    _hideTrickArea() {
        document.getElementById('trick-area').classList.add('hidden');
        this._clearTrickDisplay();
    }

    _clearTrickDisplay() {
        for (const pos of ['north', 'south', 'east', 'west']) {
            const el = document.getElementById(`trick-${pos}`);
            el.innerHTML = '';
            el.className = `trick-card trick-${pos} empty`;
        }
    }

    _displayTrickCard(pos, card) {
        const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
        const el = document.getElementById(`trick-${posName}`);
        el.innerHTML = `<span class="card-rank">${RANK_DISPLAY[card.rank]}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>`;
        el.className = `trick-card trick-${posName}` + (card.isRed ? ' red-card' : '');
    }

    _processPlay() {
        const gs = this.gameState;
        if (gs.phase !== 'playing') return;

        const currentPlayer = gs.currentTrick.currentPlayer;
        if (!currentPlayer) return;

        this._updatePlayerLabels();
        this._updateInfoBar();

        if (gs.isHumanControlled(currentPlayer)) {
            // Human's turn - render hand with clickable cards
            this._renderAllHands();
            return;
        }

        // AI's turn - play immediately (delay between cards is handled in _executePlay)
        this._renderAllHands();
        const card = this.ai.playCard(gs, currentPlayer);
        this._executePlay(currentPlayer, card);
    }

    _humanPlayCard(pos, card) {
        const gs = this.gameState;
        if (gs.phase !== 'playing') return;
        if (gs.currentTrick.currentPlayer !== pos) return;

        // Verify card is playable
        const playable = gs.getPlayableCards(pos);
        if (!playable.some(c => c.equals(card))) {
            this._showMessage('Vous devez fournir !');
            return;
        }

        this._executePlay(pos, card);
    }

    _executePlay(pos, card) {
        const gs = this.gameState;

        // Display card in trick area
        this._displayTrickCard(pos, card);

        // Execute in game state
        const result = gs.playCard(pos, card);

        // Re-render hands to reflect the card that was just played
        this._renderAllHands();

        if (result.trickWinner) {
            // Trick complete - pause so player can see all 4 cards
            this._updateInfoBar();

            setTimeout(() => {
                this._clearTrickDisplay();

                if (result.complete) {
                    // All 13 tricks played
                    this._showScoreScreen();
                } else {
                    // Next trick
                    this._processPlay();
                }
            }, this.trickClearDelay);
        } else {
            // Next player in same trick - add delay so each card is visible
            const nextPlayer = gs.currentTrick.currentPlayer;
            if (nextPlayer && !gs.isHumanControlled(nextPlayer)) {
                // AI plays next: wait before playing so current card is visible
                setTimeout(() => {
                    this._processPlay();
                }, this.aiDelay);
            } else {
                // Human plays next: render immediately with clickable cards
                this._processPlay();
            }
        }
    }

    // ==================== SCORING ====================

    _showScoreScreen() {
        const gs = this.gameState;
        this._showScreen('score-screen');

        const detailsEl = document.getElementById('score-details');

        if (!gs.contract) {
            detailsEl.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">Donne passée - pas de score</p>';
            return;
        }

        const score = gs.getScore();
        const declarerTeam = teamOf(gs.contract.declarer);
        const required = gs.contract.level + 6;
        const made = gs.tricksWon[declarerTeam];

        let html = '';

        // Contract info
        const suitStr = gs.contract.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[gs.contract.suit];
        html += `<div class="score-line"><span>Contrat</span><span>${gs.contract.level}${suitStr} par ${POSITION_FR[gs.contract.declarer]}</span></div>`;
        html += `<div class="score-line"><span>Levées requises</span><span>${required}</span></div>`;
        html += `<div class="score-line"><span>Levées réalisées</span><span>${made}</span></div>`;
        html += `<div class="score-line"><span>Résultat</span><span>${made >= required ? `+${made - required}` : `${made - required}`}</span></div>`;

        html += '<div style="height:15px"></div>';

        // Score details
        for (const detail of score.details) {
            const cls = detail.value >= 0 ? 'score-positive' : 'score-negative';
            html += `<div class="score-line"><span>${detail.label}</span><span class="${cls}">${detail.value > 0 ? '+' : ''}${detail.value}</span></div>`;
        }

        // Total
        const nsScore = score.ns;
        const cls = nsScore >= 0 ? 'score-positive' : 'score-negative';
        html += `<div class="score-line total"><span>Score Nord-Sud</span><span class="${cls}">${nsScore > 0 ? '+' : ''}${nsScore}</span></div>`;

        // Update running total
        gs.totalScore.NS += score.ns;
        gs.totalScore.EW += score.ew;

        html += `<div class="score-line" style="margin-top:15px"><span>Total cumulé NS</span><span>${gs.totalScore.NS}</span></div>`;
        html += `<div class="score-line"><span>Total cumulé EO</span><span>${gs.totalScore.EW}</span></div>`;

        detailsEl.innerHTML = html;

        this._saveGameResult();
    }

    // ==================== MESSAGES ====================

    _showMessage(text) {
        const el = document.getElementById('message-area');
        el.textContent = text;
        el.classList.add('visible');
        setTimeout(() => el.classList.remove('visible'), 3000);
    }

    // ==================== USER SETTINGS API ====================

    async _loadUserSettings() {
        try {
            const res = await fetch('/api/settings');
            if (!res.ok) return;
            const settings = await res.json();
            this.settings = { ...this.settings, ...settings };
            this._applySettingsToUI();
        } catch (e) {
            // Offline or no server - use defaults
        }
    }

    _applySettingsToUI() {
        // Seat
        document.querySelectorAll('.seat-pos').forEach(el => {
            el.classList.toggle('selected', el.dataset.seat === this.settings.seat);
        });
        // Level
        document.querySelectorAll('[data-level]').forEach(el => {
            el.classList.toggle('selected', el.dataset.level === this.settings.level);
        });
        // Convention
        document.querySelectorAll('[data-convention]').forEach(el => {
            el.classList.toggle('selected', el.dataset.convention === this.settings.convention);
        });
        // Scoring
        document.querySelectorAll('[data-scoring]').forEach(el => {
            el.classList.toggle('selected', el.dataset.scoring === this.settings.scoring);
        });
    }

    async _saveUserSettings() {
        try {
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.settings)
            });
        } catch (e) {
            // Offline - settings saved locally only
        }
    }

    async _saveGameResult() {
        const gs = this.gameState;
        if (!gs.contract) return;
        const score = gs.getScore();
        const declarerTeam = teamOf(gs.contract.declarer);
        const suitStr = gs.contract.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[gs.contract.suit];
        try {
            await fetch('/api/games', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dealNumber: gs.dealNumber,
                    contract: `${gs.contract.level}${suitStr}`,
                    declarer: gs.contract.declarer,
                    tricksMade: gs.tricksWon[declarerTeam],
                    scoreNS: score.ns,
                    scoreEW: score.ew
                })
            });
        } catch (e) {
            // Offline
        }
    }

    async _logout() {
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (e) {
            // ignore
        }
        window.location.href = '/';
    }
}

// ==================== LAUNCH ====================
document.addEventListener('DOMContentLoaded', () => {
    window.bridgeApp = new BridgeApp();
});
