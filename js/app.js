// ==================== APPLICATION CONTROLLER ====================

class BridgeApp {
    constructor() {
        this.settings = {
            seat: 'S',
            level: 'intermediate',
            convention: 'sef',
            scoring: 'duplicate',
            trickDelay: 2
        };
        this.gameState = null;
        this.ai = null;
        this.selectedBidLevel = null;
        this.selectedBidSuit = null;
        this.aiDelay = 800;

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

        // Trick delay slider
        const slider = document.getElementById('trick-delay-slider');
        const sliderValue = document.getElementById('trick-delay-value');
        if (slider) {
            slider.addEventListener('input', () => {
                const val = parseFloat(slider.value);
                this.settings.trickDelay = val;
                sliderValue.textContent = val.toFixed(1) + 's';
            });
        }

        // Convention double-click info
        document.querySelectorAll('[data-convention]').forEach(el => {
            el.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this._showConventionInfo(el.dataset.convention);
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
        document.getElementById('analyze-btn').addEventListener('click', () => this._showAnalysis());
        document.getElementById('back-settings-btn').addEventListener('click', () => this._showScreen('settings-screen'));

        // Modal close buttons
        document.getElementById('convention-close-btn').addEventListener('click', () => {
            document.getElementById('convention-modal').classList.add('hidden');
        });
        document.getElementById('analysis-close-btn').addEventListener('click', () => {
            document.getElementById('analysis-modal').classList.add('hidden');
        });

        // Close modals on overlay click
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });
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
        this._layoutTable();
        this._showScreen('game-screen');
        this._startDeal();
    }

    // ==================== DYNAMIC TABLE LAYOUT ====================

    // Maps bridge positions (N/E/S/W) to screen positions (bottom/top/left/right)
    // Human player is always at the bottom of the screen
    _getScreenMap() {
        // Clockwise from the human: human, LHO, partner, RHO
        // Screen: bottom, left, top, right
        const order = { S: ['S','W','N','E'], N: ['N','E','S','W'], E: ['E','S','W','N'], W: ['W','N','E','S'] };
        const seats = order[this.settings.seat];
        return {
            [seats[0]]: 'bottom',
            [seats[1]]: 'left',
            [seats[2]]: 'top',
            [seats[3]]: 'right'
        };
    }

    _layoutTable() {
        const map = this._getScreenMap();
        this._screenMap = map;

        // Assign screen position classes to hand areas
        for (const pos of POSITIONS) {
            const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
            const handEl = document.getElementById(`hand-${posName}`);
            // Remove old seat classes
            handEl.classList.remove('seat-top', 'seat-bottom', 'seat-left', 'seat-right');
            // Add new one
            handEl.classList.add(`seat-${map[pos]}`);
        }

        // Assign screen position classes to trick cards
        for (const pos of POSITIONS) {
            const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
            const trickEl = document.getElementById(`trick-${posName}`);
            trickEl.classList.remove('trick-pos-top', 'trick-pos-bottom', 'trick-pos-left', 'trick-pos-right');
            trickEl.classList.add(`trick-pos-${map[pos]}`);
        }
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
                cardEl.innerHTML = this._cardHTML(card);
                if (card.isRed) cardEl.classList.add('red-card');

                if (isHumanTurn && playableCards.some(c => c.equals(card))) {
                    cardEl.classList.add('playable');
                    cardEl.addEventListener('click', () => this._humanPlayCard(pos, card));
                }
            } else {
                cardEl.classList.add('face-down');
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

            // Show Declarer / Dummy role during play
            if (gs.phase === 'playing' && gs.contract) {
                if (pos === gs.declarerPos) {
                    text += ' - Déclarant';
                } else if (pos === gs.dummyPos) {
                    text += ' - Mort';
                }
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
        for (const posName of ['north', 'south', 'east', 'west']) {
            const el = document.getElementById(`trick-${posName}`);
            el.innerHTML = '';
            el.classList.add('empty');
            el.classList.remove('red-card');
        }
    }

    _displayTrickCard(pos, card) {
        const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
        const el = document.getElementById(`trick-${posName}`);
        el.innerHTML = this._cardHTML(card);
        el.classList.remove('empty');
        el.classList.toggle('red-card', card.isRed);
    }

    _cardHTML(card) {
        const r = RANK_DISPLAY[card.rank];
        const s = SUIT_SYMBOLS[card.suit];
        return `<div class="card-tl"><span>${r}</span><span>${s}</span></div>` +
               `<div class="card-center">${s}</div>` +
               `<div class="card-br"><span>${r}</span><span>${s}</span></div>`;
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
            }, this.settings.trickDelay * 1000);
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
        // Trick delay
        const slider = document.getElementById('trick-delay-slider');
        const sliderValue = document.getElementById('trick-delay-value');
        if (slider && this.settings.trickDelay) {
            slider.value = this.settings.trickDelay;
            sliderValue.textContent = parseFloat(this.settings.trickDelay).toFixed(1) + 's';
        }
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

    // ==================== DEAL ANALYSIS ====================

    _showAnalysis() {
        const gs = this.gameState;
        if (!gs) return;

        let html = '';

        // 1. Show all 4 hands
        html += '<div class="analysis-section"><h4>Les 4 mains</h4>';
        for (const pos of POSITIONS) {
            const hand = gs.originalHands[pos];
            if (!hand) continue;
            const eval_ = evaluateHand(hand);
            const label = POSITION_FR[pos] + (pos === gs.humanPos ? ' (Vous)' : ' (IA)');
            html += `<p style="margin-bottom:2px"><strong>${label}</strong> — ${eval_.hcp} HCP, ${eval_.totalPoints} pts totaux`;
            if (eval_.isBalanced) html += ', équilibrée';
            html += '</p><div class="analysis-hand">';
            for (const suit of ['S', 'H', 'D', 'C']) {
                const cards = hand.filter(c => c.suit === suit).sort((a, b) => b.value - a.value);
                const isRed = suit === 'H' || suit === 'D';
                const sym = SUIT_SYMBOLS[suit];
                const cardStr = cards.map(c => RANK_DISPLAY[c.rank]).join(' ');
                html += `<span class="analysis-suit"><span class="suit-symbol" style="color:${isRed ? '#e74c3c' : '#fff'}">${sym}</span> ${cardStr || '—'}</span>`;
            }
            html += '</div>';
        }
        html += '</div>';

        // 2. Bidding sequence
        if (gs.bidding && gs.bidding.bids.length > 0) {
            html += '<div class="analysis-section"><h4>Séquence d\'enchères</h4>';
            html += '<div class="analysis-bid-sequence">';
            for (const bid of gs.bidding.bids) {
                const label = POSITION_FR[bid.player];
                html += `<span class="analysis-bid"><strong>${label}:</strong> ${bid.toString()}</span>`;
            }
            html += '</div>';

            if (gs.contract) {
                const c = gs.contract;
                const suitStr = c.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[c.suit];
                html += `<p class="analysis-comment">Contrat final: <strong>${c.level}${suitStr}</strong> par <strong>${POSITION_FR[c.declarer]}</strong>`;
                if (c.doubled) html += ' contré';
                if (c.redoubled) html += ' surcontré';
                html += `<br>Mort: <strong>${POSITION_FR[c.dummy]}</strong></p>`;
            }
            html += '</div>';
        }

        // 3. Play analysis
        if (gs.contract && gs.tricks.length > 0) {
            const declarerTeam = teamOf(gs.contract.declarer);
            const required = gs.contract.level + 6;
            const made = gs.tricksWon[declarerTeam];
            const diff = made - required;

            html += '<div class="analysis-section"><h4>Résultat du jeu</h4>';
            html += `<p class="analysis-comment">Levées requises: <strong>${required}</strong> — Réalisées: <strong>${made}</strong> — `;
            if (diff >= 0) {
                html += `<span style="color:#2ecc71">Contrat réussi${diff > 0 ? ` (+${diff} surlevée${diff > 1 ? 's' : ''})` : ''}</span>`;
            } else {
                html += `<span style="color:#e74c3c">Chute de ${-diff}</span>`;
            }
            html += '</p>';

            // Trick by trick
            html += '<h4 style="margin-top:12px">Levée par levée</h4>';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em; color:#bbb">';
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1)"><th style="padding:4px;text-align:left">#</th><th>Ouest</th><th>Nord</th><th>Est</th><th>Sud</th><th>Gagnant</th></tr>';
            for (let i = 0; i < gs.tricks.length; i++) {
                const trick = gs.tricks[i];
                const winner = trick.getWinner();
                const winTeam = teamOf(winner);
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">';
                html += `<td style="padding:3px"><strong>${i + 1}</strong></td>`;
                for (const p of ['W', 'N', 'E', 'S']) {
                    const card = trick.cards[p];
                    if (card) {
                        const isRed = card.isRed;
                        const style = isRed ? 'color:#e74c3c' : 'color:#fff';
                        const bold = p === winner ? 'font-weight:bold;text-decoration:underline' : '';
                        html += `<td style="text-align:center;padding:3px;${style};${bold}">${card.toString()}</td>`;
                    } else {
                        html += '<td style="text-align:center;padding:3px">-</td>';
                    }
                }
                html += `<td style="text-align:center;padding:3px;color:${winTeam === teamOf(gs.humanPos) ? '#2ecc71' : '#e74c3c'}">${POSITION_FR[winner]}</td>`;
                html += '</tr>';
            }
            html += '</table></div>';
        }

        // 4. Score recap
        if (gs.contract) {
            const score = gs.getScore();
            html += '<div class="analysis-section"><h4>Score</h4>';
            for (const detail of score.details) {
                const cls = detail.value >= 0 ? '#2ecc71' : '#e74c3c';
                html += `<p class="analysis-comment">${detail.label}: <span style="color:${cls}">${detail.value > 0 ? '+' : ''}${detail.value}</span></p>`;
            }
            html += '</div>';
        }

        document.getElementById('analysis-body').innerHTML = html;
        document.getElementById('analysis-modal').classList.remove('hidden');
    }

    // ==================== CONVENTION INFO ====================

    _showConventionInfo(convention) {
        const info = this._conventionDescriptions[convention];
        if (!info) return;
        document.getElementById('convention-modal-title').textContent = info.title;
        document.getElementById('convention-modal-body').innerHTML = info.html;
        document.getElementById('convention-modal').classList.remove('hidden');
    }

    get _conventionDescriptions() {
        return {
            sef: {
                title: 'SEF - Standard Enseignement Fran\u00e7ais',
                html: `
                    <p>Le SEF est le syst\u00e8me d'ench\u00e8res officiel de la F\u00e9d\u00e9ration Fran\u00e7aise de Bridge. C'est le syst\u00e8me le plus r\u00e9pandu en France.</p>
                    <p><strong>Principes cl\u00e9s :</strong></p>
                    <ul>
                        <li><strong>Majeure 5e</strong> : L'ouverture de 1\u2665 ou 1\u2660 promet au moins 5 cartes</li>
                        <li><strong>1SA = 15-17 HCP</strong> : Main \u00e9quilibr\u00e9e (4-3-3-3, 4-4-3-2 ou 5-3-3-2)</li>
                        <li><strong>2\u2663 fort</strong> : Ouverture artificielle et forcing, 20+ HCP ou 8\u00bd lev\u00e9es de jeu</li>
                        <li><strong>2\u2666 multi</strong> : Bicolore majeur faible (6 cartes dans une majeure, 6-10 HCP)</li>
                        <li><strong>Stayman</strong> : 2\u2663 sur 1SA pour chercher un fit majeur 4-4</li>
                        <li><strong>Texas</strong> : 2\u2666 = transfert \u2665, 2\u2665 = transfert \u2660</li>
                        <li><strong>R\u00e9ponse au palier de 2</strong> : Changement de couleur forcing (11+ HCP)</li>
                    </ul>
                `
            },
            sayc: {
                title: 'SAYC - Standard American Yellow Card',
                html: `
                    <p>Le SAYC est le syst\u00e8me standard utilis\u00e9 par d\u00e9faut dans les tournois en ligne am\u00e9ricains. Simple et efficace.</p>
                    <p><strong>Principes cl\u00e9s :</strong></p>
                    <ul>
                        <li><strong>Majeure 5e</strong> : 1\u2665/1\u2660 promettent 5+ cartes</li>
                        <li><strong>1SA = 15-17 HCP</strong> : Main \u00e9quilibr\u00e9e</li>
                        <li><strong>2\u2663 fort</strong> : Artificiel, forcing de manche (22+ HCP)</li>
                        <li><strong>2\u2666/2\u2665/2\u2660 faible</strong> : 6 cartes, 5-11 HCP (barrage)</li>
                        <li><strong>Stayman et Texas</strong> : Sur l'ouverture de 1SA</li>
                        <li><strong>Soutien limit\u00e9</strong> : Le soutien simple (1\u2660-2\u2660) = 6-10 points</li>
                        <li><strong>R\u00e9ponse 1SA</strong> : 6-10 HCP, forcing un tour</li>
                    </ul>
                `
            },
            '2over1': {
                title: '2/1 Game Forcing',
                html: `
                    <p>Syst\u00e8me am\u00e9ricain avanc\u00e9. Toute r\u00e9ponse au palier de 2 dans une nouvelle couleur est forcing de manche.</p>
                    <p><strong>Principes cl\u00e9s :</strong></p>
                    <ul>
                        <li><strong>R\u00e9ponse 2 sur 1</strong> : Un changement de couleur au palier de 2 (ex: 1\u2660 - 2\u2663) est forcing de manche (12+ HCP)</li>
                        <li><strong>1SA forcing</strong> : La r\u00e9ponse de 1SA sur 1\u2665/1\u2660 est forcing un tour (6-12 HCP)</li>
                        <li><strong>Majeure 5e</strong> et <strong>1SA = 15-17</strong></li>
                        <li><strong>Bergen raises</strong> : 3\u2663 = soutien faible (7-9), 3\u2666 = soutien limite (10-12)</li>
                        <li><strong>Avantage</strong> : Les ench\u00e8res de d\u00e9veloppement sont plus pr\u00e9cises car le palier de manche est garanti</li>
                        <li><strong>Inconv\u00e9nient</strong> : Plus complexe, n\u00e9cessite un bon partenariat</li>
                    </ul>
                `
            },
            acol: {
                title: 'Acol',
                html: `
                    <p>Syst\u00e8me britannique tr\u00e8s populaire au Royaume-Uni. Naturel et flexible.</p>
                    <p><strong>Principes cl\u00e9s :</strong></p>
                    <ul>
                        <li><strong>Majeure 4e</strong> : L'ouverture de 1\u2665/1\u2660 ne promet que 4 cartes</li>
                        <li><strong>1SA faible = 12-14 HCP</strong> : Main \u00e9quilibr\u00e9e (diff\u00e9rent des autres syst\u00e8mes !)</li>
                        <li><strong>2\u2663 fort artificiel</strong> : 23+ HCP ou 9\u00bd lev\u00e9es de jeu</li>
                        <li><strong>Acol Two Bids</strong> : 2\u2666/2\u2665/2\u2660 = main forte de 8+ lev\u00e9es de jeu dans la couleur nomm\u00e9e</li>
                        <li><strong>Blackwood</strong> : 4SA demande les As</li>
                        <li><strong>Stayman</strong> : 2\u2663 sur 1SA</li>
                        <li><strong>Particularit\u00e9</strong> : Le 1SA faible donne un avantage comp\u00e9titif en attaque</li>
                    </ul>
                `
            },
            standard: {
                title: 'Standard American',
                html: `
                    <p>Le syst\u00e8me de base am\u00e9ricain, proche du SAYC mais avec quelques diff\u00e9rences.</p>
                    <p><strong>Principes cl\u00e9s :</strong></p>
                    <ul>
                        <li><strong>Majeure 5e</strong> : 1\u2665/1\u2660 promettent 5+ cartes</li>
                        <li><strong>1SA = 15-17 HCP</strong> : Main \u00e9quilibr\u00e9e</li>
                        <li><strong>Ouverture mineure</strong> : 1\u2663 = 3+ cartes, 1\u2666 = 4+ cartes (parfois 3)</li>
                        <li><strong>2\u2663 fort</strong> : Artificiel et forcing</li>
                        <li><strong>2\u2666/2\u2665/2\u2660 faible</strong> : 6 cartes, 5-11 HCP</li>
                        <li><strong>Stayman et Texas</strong> : Conventions standard sur 1SA</li>
                        <li><strong>Limit raise</strong> : Soutien au palier de 3 = invitationnel (11-12 points avec fit)</li>
                        <li><strong>Convient aux</strong> : D\u00e9butants et joueurs occasionnels</li>
                    </ul>
                `
            }
        };
    }
}

// ==================== LAUNCH ====================
document.addEventListener('DOMContentLoaded', () => {
    window.bridgeApp = new BridgeApp();
});
