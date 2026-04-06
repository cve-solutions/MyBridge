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
        this._undoSnapshot = null;
        this._executePendingTimeout = null;
        this.isMultiplayer = false;

        this._initUI();
        this._loadUserSettings();
        this.community = new CommunityManager(this);
        this.multiplayer = new MultiplayerController(this);
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

        // Main tabs (Paramètres / Joueurs / Tables)
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.main-tab-panel').forEach(p => p.classList.add('hidden'));
                document.getElementById(tab.dataset.mainTab).classList.remove('hidden');
                // Load community data when switching to Joueurs tab
                if (tab.dataset.mainTab === 'community-panel' && this.community) {
                    this.community.loadPlayers();
                    this.community.loadRankings();
                }
                // Load table list when switching to Tables tab
                if (tab.dataset.mainTab === 'tables-panel' && this.multiplayer) {
                    this.multiplayer.loadTableList();
                }
            });
        });

        // Tables tab buttons
        const mpCreateBtn = document.getElementById('mp-create-btn');
        if (mpCreateBtn) {
            mpCreateBtn.addEventListener('click', () => {
                const convention = document.getElementById('mp-convention').value;
                const scoring = document.getElementById('mp-scoring').value;
                this.multiplayer.createTable({ convention, scoring });
            });
        }

        const mpJoinBtn = document.getElementById('mp-join-btn');
        if (mpJoinBtn) {
            mpJoinBtn.addEventListener('click', () => {
                const code = document.getElementById('mp-join-code').value.trim().toUpperCase();
                const position = document.getElementById('mp-join-pos').value;
                if (!code) { this._showMessage('Entrez un code de table.'); return; }
                this.multiplayer.joinTable(code, position);
            });
        }

        const mpRefreshBtn = document.getElementById('mp-refresh-btn');
        if (mpRefreshBtn) {
            mpRefreshBtn.addEventListener('click', () => {
                if (this.multiplayer) this.multiplayer.loadTableList();
            });
        }

        // Start game (both buttons)
        document.getElementById('start-game-btn').addEventListener('click', () => this._startGame());
        document.getElementById('start-game-btn-2').addEventListener('click', () => this._startGame());

        // Settings button (back to settings)
        document.getElementById('settings-btn').addEventListener('click', () => {
            if (this.community) this.community.notifyLeaveGame();
            if (this.community) this.community.loadPlayers();
            this._showScreen('settings-screen');
        });

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
        document.getElementById('back-settings-btn').addEventListener('click', () => {
            if (this.community) this.community.notifyLeaveGame();
            if (this.community) this.community.loadPlayers();
            this._showScreen('settings-screen');
        });

        // Modal close buttons
        document.getElementById('convention-close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeModal('convention-modal');
        });
        document.getElementById('analysis-close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeModal('analysis-modal');
        });
        document.getElementById('tricks-modal-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeModal('tricks-modal');
        });
        document.getElementById('bidding-history-modal-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeModal('bidding-history-modal');
        });
        document.getElementById('claim-cancel-btn').addEventListener('click', () => {
            this._closeModal('claim-modal');
        });
        document.getElementById('claim-confirm-btn').addEventListener('click', () => {
            this._closeModal('claim-modal');
            this._executeClaim();
        });

        // Game action buttons
        document.getElementById('show-tricks-btn').addEventListener('click', () => this._showPreviousTricks());
        document.getElementById('show-bidding-btn').addEventListener('click', () => this._showBiddingHistoryModal());
        document.getElementById('undo-btn').addEventListener('click', () => this._undoLastCard());
        document.getElementById('claim-btn').addEventListener('click', () => this._promptClaim());

        // Close modals on overlay click
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this._closeModal(modal.id);
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
        this.isMultiplayer = false;
        this._saveUserSettings();
        this.gameState = new GameState(this.settings);
        this.ai = new BridgeAI(this.settings);
        this._layoutTable();
        this._showScreen('game-screen');
        if (this.community) this.community.notifyEnterGame();
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

        // Update position badges on center rectangle
        this._updatePositionBadges();
    }

    _updatePositionBadges() {
        const map = this._screenMap;
        const gs = this.gameState;
        const badgeLetters = { N: 'N', S: 'S', E: 'E', W: 'O' };

        for (const pos of POSITIONS) {
            const screenPos = map[pos];
            const badgeEl = document.getElementById(`badge-${screenPos}`);
            if (!badgeEl) continue;

            const letterEl = badgeEl.querySelector('.badge-letter');
            const nameEl = badgeEl.querySelector('.badge-name');

            letterEl.textContent = badgeLetters[pos];
            letterEl.classList.remove('human', 'ai');
            letterEl.classList.add(pos === gs.humanPos ? 'human' : 'ai');

            let name = POSITION_FR[pos];
            if (pos === gs.humanPos) {
                name += ' (Vous)';
            } else {
                name += ' (IA)';
            }
            nameEl.textContent = name;
        }
    }

    _startDeal() {
        // Reset undo state
        this._undoSnapshot = null;
        if (this._executePendingTimeout) {
            clearTimeout(this._executePendingTimeout);
            this._executePendingTimeout = null;
        }

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
        if (this.isMultiplayer) {
            this.multiplayer.sendNextDeal();
            return;
        }
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

        // Update table trick counters
        const tableNs = document.getElementById('table-tricks-ns');
        const tableEw = document.getElementById('table-tricks-ew');
        if (tableNs) tableNs.textContent = gs.tricksWon.NS;
        if (tableEw) tableEw.textContent = gs.tricksWon.EW;
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
        const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
        const containerEl = document.getElementById(`cards-${posName}`);
        containerEl.innerHTML = '';

        const hand = gs.hands[pos];
        const showCards = gs.shouldShowCards(pos);
        const isPlayPhase = gs.phase === 'playing';
        const isDummy = isPlayPhase && pos === gs.dummyPos;
        const isHumanTurn = isPlayPhase && gs.currentTrick &&
            gs.currentTrick.currentPlayer === pos &&
            gs.isHumanControlled(pos);

        const playableCards = isHumanTurn ? gs.getPlayableCards(pos) : [];

        // Dummy hand: render grouped by suit
        if (isDummy && showCards) {
            containerEl.classList.add('dummy-hand');
            for (const suit of ['S', 'H', 'D', 'C']) {
                const suitCards = hand.filter(c => c.suit === suit).sort((a, b) => b.value - a.value);
                const isRed = suit === 'H' || suit === 'D';
                const suitRow = document.createElement('div');
                suitRow.className = 'dummy-suit-row';
                const suitLabel = document.createElement('span');
                suitLabel.className = `dummy-suit-label${isRed ? ' red' : ''}`;
                suitLabel.textContent = SUIT_SYMBOLS[suit];
                suitRow.appendChild(suitLabel);

                if (suitCards.length === 0) {
                    const voidEl = document.createElement('span');
                    voidEl.className = 'dummy-void';
                    voidEl.textContent = '—';
                    suitRow.appendChild(voidEl);
                } else {
                    for (const card of suitCards) {
                        const cardEl = document.createElement('div');
                        cardEl.className = 'card';
                        if (isRed) cardEl.classList.add('red-card');
                        cardEl.innerHTML = this._cardHTML(card);
                        if (isHumanTurn && playableCards.some(c => c.equals(card))) {
                            cardEl.classList.add('playable');
                            cardEl.addEventListener('click', () => this._humanPlayCard(pos, card));
                        }
                        suitRow.appendChild(cardEl);
                    }
                }
                containerEl.appendChild(suitRow);
            }
            return;
        }

        containerEl.classList.remove('dummy-hand');

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
        const map = this._screenMap;

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

            // Update position badges on center rectangle
            if (map) {
                const screenPos = map[pos];
                const badgeEl = document.getElementById(`badge-${screenPos}`);
                if (badgeEl) {
                    const nameEl = badgeEl.querySelector('.badge-name');

                    let badgeText = POSITION_FR[pos];
                    if (pos === gs.humanPos) {
                        badgeText += ' (Vous)';
                    } else {
                        badgeText += ' (IA)';
                    }
                    if (gs.phase === 'playing' && gs.contract) {
                        if (pos === gs.declarerPos) badgeText += ' - Décl.';
                        else if (pos === gs.dummyPos) badgeText += ' - Mort';
                    }
                    nameEl.textContent = badgeText;

                    badgeEl.classList.remove('active-badge', 'dummy-badge');

                    const isActive = (gs.phase === 'bidding' && gs.bidding && gs.bidding.currentBidder === pos && !gs.bidding.isComplete) ||
                                     (gs.phase === 'playing' && gs.currentTrick && gs.currentTrick.currentPlayer === pos);
                    if (isActive) badgeEl.classList.add('active-badge');

                    if (gs.phase === 'playing' && gs.dummyPos === pos) {
                        badgeEl.classList.add('dummy-badge');
                    }
                }
            }
        }
    }

    // ==================== BIDDING ====================

    _showBiddingPanel() {
        document.getElementById('bidding-panel').classList.remove('hidden');
        document.getElementById('trick-area').classList.add('hidden');
        this._resetBidSelection();
        this._updateBiddingControls();
        // Hide play-phase buttons
        document.getElementById('show-tricks-btn').classList.add('hidden');
        document.getElementById('show-bidding-btn').classList.add('hidden');
        document.getElementById('undo-btn').classList.add('hidden');
        document.getElementById('claim-btn').classList.add('hidden');
    }

    _hideBiddingPanel() {
        document.getElementById('bidding-panel').classList.add('hidden');
        // Show play-phase buttons
        document.getElementById('show-bidding-btn').classList.remove('hidden');
        document.getElementById('show-tricks-btn').classList.remove('hidden');
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

        // Check if alert is needed for this bid
        const detectedAlert = shouldAlert(bid, gs.bidding, this.settings.convention);

        // In multiplayer mode, send to server instead of local processing
        if (this.isMultiplayer) {
            this._resetBidSelection();
            if (detectedAlert) {
                this._promptAlert(bid, detectedAlert, (alertText) => {
                    bid.alertText = alertText;
                    this.multiplayer.sendBid(bid);
                });
                return;
            }
            this.multiplayer.sendBid(bid);
            return;
        }

        if (detectedAlert) {
            bid.alertText = detectedAlert; // Auto-set in solo mode
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
            this._updateClaimBtn();
            return;
        }

        // AI's turn - hide claim button
        document.getElementById('claim-btn').classList.add('hidden');
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

        // In multiplayer mode, send to server
        if (this.isMultiplayer) {
            this.multiplayer.sendPlay(card);
            return;
        }

        // Save snapshot for undo before human plays
        this._undoSnapshot = gs.snapshot();
        this._hideUndoBtn(); // hide until we decide whether to show
        this._executePendingTimeout = null;

        this._executePlay(pos, card, true);
    }

    _executePlay(pos, card, isHumanCard = false) {
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
            // After trick completes, undo is no longer possible
            this._undoSnapshot = null;
            this._hideUndoBtn();

            this._executePendingTimeout = setTimeout(() => {
                this._executePendingTimeout = null;
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
                // After human played, show undo button briefly before AI plays
                if (isHumanCard) {
                    this._showUndoBtn();
                }
                // AI plays next: wait before playing so current card is visible
                this._executePendingTimeout = setTimeout(() => {
                    this._executePendingTimeout = null;
                    this._hideUndoBtn();
                    this._undoSnapshot = null;
                    this._processPlay();
                }, this.aiDelay);
            } else {
                // Human plays next: show claim if applicable, render immediately
                this._undoSnapshot = null;
                this._hideUndoBtn();
                this._updateClaimBtn();
                this._processPlay();
            }
        }
    }

    _showUndoBtn() {
        document.getElementById('undo-btn').classList.remove('hidden');
    }

    _hideUndoBtn() {
        document.getElementById('undo-btn').classList.add('hidden');
    }

    _updateClaimBtn() {
        const gs = this.gameState;
        if (!gs || gs.phase !== 'playing') {
            document.getElementById('claim-btn').classList.add('hidden');
            return;
        }
        // Only show claim when it's the human's turn as declarer
        const isDeclarer = gs.humanPos === gs.declarerPos;
        const isDummyController = gs.humanPos === gs.declarerPos;
        const currentPlayer = gs.currentTrick ? gs.currentTrick.currentPlayer : null;
        const isHumanTurn = currentPlayer && gs.isHumanControlled(currentPlayer);
        if (isHumanTurn && isDeclarer && gs.tricks.length > 0) {
            document.getElementById('claim-btn').classList.remove('hidden');
        } else {
            document.getElementById('claim-btn').classList.add('hidden');
        }
    }

    _undoLastCard() {
        if (!this._undoSnapshot) return;

        // Cancel pending AI timeout
        if (this._executePendingTimeout) {
            clearTimeout(this._executePendingTimeout);
            this._executePendingTimeout = null;
        }

        this.gameState.restoreSnapshot(this._undoSnapshot);
        this._undoSnapshot = null;
        this._hideUndoBtn();

        // Clear trick display and re-render
        this._clearTrickDisplay();
        // Re-display cards that are already in the current trick
        const gs = this.gameState;
        if (gs.currentTrick) {
            for (const p of gs.currentTrick.order) {
                this._displayTrickCard(p, gs.currentTrick.cards[p]);
            }
        }
        this._renderAllHands();
        this._updateInfoBar();
        this._processPlay();
    }

    _promptClaim() {
        const gs = this.gameState;
        if (!gs || gs.phase !== 'playing') return;
        const remaining = 13 - gs.tricks.length;
        const declarerTeam = teamOf(gs.declarerPos);
        const current = gs.tricksWon[declarerTeam];
        const required = gs.contract.level + 6;
        const needed = Math.max(0, required - current);

        document.getElementById('claim-modal-text').innerHTML =
            `Vous revendiquez <strong>${remaining} levée${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}</strong>.<br>` +
            `Levées acquises: <strong>${current}</strong> — Requises: <strong>${required}</strong><br>` +
            (remaining >= needed
                ? `<span style="color:#2ecc71">Le contrat sera réussi.</span>`
                : `<span style="color:#e74c3c">Le contrat sera chuté (manque ${needed - remaining} levée${needed - remaining > 1 ? 's' : ''}).</span>`);
        this._openModal('claim-modal');
    }

    _executeClaim() {
        const gs = this.gameState;
        if (!gs || gs.phase !== 'playing') return;

        if (this.isMultiplayer) {
            this.multiplayer.sendClaim();
            return;
        }

        const declarerTeam = teamOf(gs.declarerPos);
        const remaining = 13 - gs.tricks.length;
        // Award all remaining tricks to the declaring team
        gs.tricksWon[declarerTeam] += remaining;
        gs.phase = 'scoring';
        this._hideUndoBtn();
        document.getElementById('claim-btn').classList.add('hidden');
        this._clearTrickDisplay();
        this._showScoreScreen();
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
        this._updatePlayerRating(gs, score);
    }

    _updatePlayerRating(gs, score) {
        if (!gs.contract) return;
        const declarerTeam = teamOf(gs.contract.declarer);
        const humanTeam = teamOf(gs.humanPos);
        const won = (humanTeam === declarerTeam && score.ns >= 0) || (humanTeam !== declarerTeam && score.ns < 0);
        fetch('/api/update-rating', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ won, aiLevel: this.settings.level })
        }).catch(() => {});
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

    // ==================== MODAL HELPERS ====================

    _openModal(id) {
        const el = document.getElementById(id);
        el.style.display = 'flex';
        el.classList.remove('hidden');
    }

    _closeModal(id) {
        const el = document.getElementById(id);
        el.style.display = 'none';
        el.classList.add('hidden');
    }

    // ==================== PREVIOUS TRICKS MODAL ====================

    _showPreviousTricks() {
        const gs = this.gameState;
        if (!gs || gs.tricks.length === 0) {
            this._showMessage('Aucune levée terminée pour le moment.');
            return;
        }

        const humanTeam = teamOf(gs.humanPos);
        let html = `<table class="tricks-table">
            <tr>
                <th>#</th>
                <th>Ouest</th><th>Nord</th><th>Est</th><th>Sud</th>
                <th>Gagnant</th>
            </tr>`;

        for (let i = 0; i < gs.tricks.length; i++) {
            const trick = gs.tricks[i];
            const winner = trick.getWinner();
            const winTeam = teamOf(winner);
            const isOurTrick = winTeam === humanTeam;
            html += '<tr>';
            html += `<td><strong>${i + 1}</strong></td>`;
            for (const p of ['W', 'N', 'E', 'S']) {
                const card = trick.cards[p];
                if (card) {
                    const colorClass = card.isRed ? 'card-red' : 'card-black';
                    const boldClass = p === winner ? 'won-by-winner' : '';
                    html += `<td class="${colorClass} ${boldClass}">${card.toString()}</td>`;
                } else {
                    html += '<td>-</td>';
                }
            }
            const winnerClass = isOurTrick ? 'winner-ns' : 'winner-ew';
            html += `<td class="${winnerClass}">${POSITION_FR[winner]}</td>`;
            html += '</tr>';
        }

        html += '</table>';
        html += `<p style="margin-top:10px; font-size:0.85em; color:#888">
            NS: <strong>${gs.tricksWon.NS}</strong> levée${gs.tricksWon.NS > 1 ? 's' : ''} &nbsp;|&nbsp;
            EO: <strong>${gs.tricksWon.EW}</strong> levée${gs.tricksWon.EW > 1 ? 's' : ''}
        </p>`;

        document.getElementById('tricks-modal-body').innerHTML = html;
        this._openModal('tricks-modal');
    }

    // ==================== BIDDING HISTORY MODAL (during play) ====================

    _showBiddingHistoryModal() {
        const gs = this.gameState;
        if (!gs || !gs.bidding) return;

        const allBids = gs.bidding.bids;
        const displayOrder = ['W', 'N', 'E', 'S'];
        const dealerCol = displayOrder.indexOf(gs.dealer);

        let html = '<div class="bid-header"><span>Ouest</span><span>Nord</span><span>Est</span><span>Sud</span></div>';

        let col = dealerCol;
        let rowHtml = '';
        let cells = 0;

        // Empty cells before dealer
        for (let i = 0; i < dealerCol; i++) {
            rowHtml += '<span class="bid-cell">-</span>';
            cells++;
        }

        for (const bid of allBids) {
            rowHtml += `<span class="bid-cell">${bid.toDisplayHTML()}</span>`;
            cells++;
            col = (col + 1) % 4;
            if (col === 0) {
                html += `<div class="bid-row">${rowHtml}</div>`;
                rowHtml = '';
                cells = 0;
            }
        }

        // Fill remaining cells in last row
        if (cells > 0) {
            while (cells % 4 !== 0) {
                rowHtml += '<span class="bid-cell"></span>';
                cells++;
            }
            html += `<div class="bid-row">${rowHtml}</div>`;
        }

        // Final contract
        if (gs.contract) {
            const c = gs.contract;
            const suitStr = c.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[c.suit];
            html += `<div class="final-contract-line">
                Contrat: <strong>${c.level}${suitStr}</strong> par <strong>${POSITION_FR[c.declarer]}</strong>
                ${c.doubled ? ' contré' : ''}${c.redoubled ? ' surcontré' : ''}
                — Mort: <strong>${POSITION_FR[c.dummy]}</strong>
            </div>`;
        }

        document.getElementById('bidding-history-modal-body').innerHTML = html;
        this._openModal('bidding-history-modal');
    }

    // ==================== ALERT SYSTEM ====================

    _promptAlert(bid, detectedText, callback) {
        // In solo mode or for auto-detected alerts, just use the detected text
        // In multiplayer, we'd show a prompt - for now auto-fill
        callback(detectedText);
    }

    // ==================== CONVENTION CARD ====================

    _showConventionInfo(convention) {
        const info = this._getConventionInfo(convention);
        document.getElementById('convention-modal-title').textContent = info.name;
        document.getElementById('convention-modal-body').innerHTML = info.body;
        this._openModal('convention-modal');
    }

    _getConventionInfo(conv) {
        const infos = {
            sef: {
                name: 'SEF — Standard Français',
                body: `<p>Le Standard Français (SEF) est la base des conventions en bridge français.</p>
                    <ul>
                        <li><strong>Ouvertures 5e majeure</strong> : 1♥ et 1♠ promettent 5+ cartes</li>
                        <li><strong>1SA</strong> : 15-17 HCP, main équilibrée</li>
                        <li><strong>2♣</strong> : artificiel, 20+ HCP ou main de jeu</li>
                        <li><strong>2♦/♥/♠</strong> : enchères faibles (6-10 HCP, 6 cartes)</li>
                        <li><strong>Stayman (2♣/1SA)</strong> : demande majeure 4e du partenaire</li>
                        <li><strong>Transferts Jacoby</strong> : 2♦ → ♥, 2♥ → ♠ sur 1SA</li>
                        <li><strong>Blackwood 4SA</strong> : demande les as</li>
                    </ul>`
            },
            sayc: {
                name: 'SAYC — Standard American Yellow Card',
                body: `<p>Convention américaine standard, la plus répandue aux États-Unis.</p>
                    <ul>
                        <li><strong>5e majeure</strong> : 1♥/1♠ promettent 5+ cartes</li>
                        <li><strong>1SA</strong> : 15-17 HCP</li>
                        <li><strong>2♣</strong> : artificiel fort (22+ HCP ou main de jeu)</li>
                        <li><strong>2♦/♥/♠</strong> : enchères faibles, 6+ cartes, 5-10 HCP</li>
                        <li><strong>Transferts Jacoby</strong> sur 1SA</li>
                        <li><strong>Stayman</strong> sur 1SA et 2SA</li>
                        <li><strong>Blackwood, Gerber</strong> pour les as</li>
                    </ul>`
            },
            '2over1': {
                name: '2/1 Game Forcing',
                body: `<p>Variante du SAYC très populaire en compétition.</p>
                    <ul>
                        <li><strong>2 sur 1 non forcé</strong> : engagement de manche (12+ HCP)</li>
                        <li><strong>1SA forcing</strong> sur 1♥/1♠ (10-12 HCP)</li>
                        <li><strong>Bergen Raises</strong> : soutiens directs au palier 3</li>
                        <li><strong>Drury (2♣)</strong> : redemande après 1♥/1♠ en 3e/4e main</li>
                        <li><strong>Jacoby 2SA</strong> : soutien forcing de manche en majeure</li>
                    </ul>`
            },
            acol: {
                name: 'Acol',
                body: `<p>Système britannique, le plus joué au Royaume-Uni.</p>
                    <ul>
                        <li><strong>4e majeure</strong> : 1♥/1♠ peuvent avoir 4 cartes</li>
                        <li><strong>1SA</strong> : 12-14 HCP équilibrée</li>
                        <li><strong>2♣</strong> : artificiel, main très forte</li>
                        <li><strong>2♦/♥/♠</strong> : mains de jeu, 8+ de levées</li>
                        <li><strong>Pas de transferts</strong> sur 1SA (Stayman simple)</li>
                        <li><strong>Blackwood</strong> pour les as</li>
                        <li><strong>Benjaminisés</strong> : variante courante</li>
                    </ul>`
            },
            standard: {
                name: 'Standard American',
                body: `<p>Base du bridge américain, ancêtre du SAYC.</p>
                    <ul>
                        <li><strong>5e majeure</strong> : 1♥/1♠ = 5+ cartes</li>
                        <li><strong>1SA</strong> : 16-18 HCP</li>
                        <li><strong>2♣</strong> : main forte (23+ ou main de jeu)</li>
                        <li><strong>2♦/♥/♠</strong> : enchères intermédiaires</li>
                        <li><strong>Stayman</strong> sur 1SA</li>
                        <li><strong>Blackwood</strong> : 4SA pour les as</li>
                    </ul>`
            }
        };
        return infos[conv] || { name: conv, body: '<p>Information non disponible.</p>' };
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
            html += '<div class="analysis-section"><h4>Séquence d\'enchères jouée</h4>';
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

            // Expert bidding sequence
            html += this._generateExpertBiddingAnalysis(gs);
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

            // Ideal play simulation
            html += this._generateIdealPlayAnalysis(gs);
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

        // 5. Expert recommendations
        html += this._generateExpertAdvice(gs);

        document.getElementById('analysis-body').innerHTML = html;
        this._openModal('analysis-modal');
    }

    // Simulate expert-level bidding for all 4 hands
    _generateExpertBiddingAnalysis(gs) {
        if (!gs.originalHands || !gs.dealer) return '';

        const expertAI = new BridgeAI({ level: 'expert', convention: this.settings.convention });
        const simBidding = new BiddingManager(gs.dealer);

        let safety = 0;
        while (!simBidding.isComplete && safety < 40) {
            const pos = simBidding.currentBidder;
            const hand = gs.originalHands[pos];
            if (!hand) break;

            // Build a minimal gameState-like object for the AI
            const fakeGS = {
                hands: gs.originalHands,
                bidding: simBidding,
                humanPos: '__none__'
            };
            const bid = expertAI.makeBid(fakeGS, pos);
            simBidding.placeBid(bid);
            safety++;
        }

        let html = '<div class="analysis-section"><h4>Séquence d\'enchères expert (' + this._conventionLabel() + ')</h4>';
        html += '<div class="analysis-bid-sequence">';
        for (const bid of simBidding.bids) {
            const label = POSITION_FR[bid.player];
            html += `<span class="analysis-bid"><strong>${label}:</strong> ${bid.toString()}</span>`;
        }
        html += '</div>';

        if (simBidding.contract) {
            const c = simBidding.contract;
            const suitStr = c.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[c.suit];
            html += `<p class="analysis-comment">Contrat expert: <strong>${c.level}${suitStr}</strong> par <strong>${POSITION_FR[c.declarer]}</strong>`;
            if (c.doubled) html += ' contré';
            if (c.redoubled) html += ' surcontré';
            html += `<br>Mort: <strong>${POSITION_FR[c.dummy]}</strong></p>`;

            // Compare with actual contract
            if (gs.contract) {
                const actualIdx = (gs.contract.level - 1) * 5 + SUIT_ORDER[gs.contract.suit];
                const expertIdx = (c.level - 1) * 5 + SUIT_ORDER[c.suit];
                if (expertIdx > actualIdx) {
                    html += `<p class="analysis-comment" style="color:#f1c40f">L'expert aurait enchéri plus haut.</p>`;
                } else if (expertIdx < actualIdx) {
                    html += `<p class="analysis-comment" style="color:#f1c40f">L'expert aurait enchéri plus prudemment.</p>`;
                } else if (c.declarer !== gs.contract.declarer) {
                    html += `<p class="analysis-comment" style="color:#f1c40f">Même contrat, mais joué par un déclarant différent.</p>`;
                } else {
                    html += `<p class="analysis-comment" style="color:#2ecc71">Même contrat que l'expert !</p>`;
                }
            }
        } else {
            html += `<p class="analysis-comment">L'expert aurait passé cette donne.</p>`;
        }

        html += '</div>';
        return html;
    }

    // Simulate ideal play using expert AI for all 4 positions
    _generateIdealPlayAnalysis(gs) {
        if (!gs.contract || !gs.originalHands) return '';

        const expertAI = new BridgeAI({ level: 'expert', convention: this.settings.convention });

        // Clone hands for simulation
        const simHands = {};
        for (const pos of POSITIONS) {
            simHands[pos] = gs.originalHands[pos] ? [...gs.originalHands[pos]] : [];
        }

        const contract = gs.contract;
        const trump = contract.suit;
        const leader = nextPos(contract.declarer);
        const simTricks = [];
        let currentLeader = leader;
        const simTricksWon = { NS: 0, EW: 0 };

        for (let t = 0; t < 13; t++) {
            const trick = new Trick(currentLeader, trump);
            let currentPlayer = currentLeader;

            for (let c = 0; c < 4; c++) {
                const hand = simHands[currentPlayer];
                if (!hand || hand.length === 0) break;

                // Get playable cards
                let playable;
                if (trick.suitLed) {
                    const followSuit = hand.filter(card => card.suit === trick.suitLed);
                    playable = followSuit.length > 0 ? followSuit : hand;
                } else {
                    playable = hand;
                }

                // Build minimal gameState for AI
                const fakeGS = {
                    hands: simHands,
                    contract: contract,
                    currentTrick: trick,
                    declarerPos: contract.declarer,
                    dummyPos: contract.dummy,
                    originalHands: gs.originalHands,
                    getPlayableCards: (pos) => {
                        const h = simHands[pos];
                        if (!trick.suitLed) return h;
                        const fs = h.filter(cd => cd.suit === trick.suitLed);
                        return fs.length > 0 ? fs : h;
                    }
                };

                const card = expertAI.playCard(fakeGS, currentPlayer);

                // Remove card from hand
                const idx = simHands[currentPlayer].findIndex(cd => cd.equals(card));
                if (idx !== -1) simHands[currentPlayer].splice(idx, 1);
                trick.playCard(currentPlayer, card);

                currentPlayer = nextPos(currentPlayer);
            }

            const winner = trick.getWinner();
            if (winner) {
                simTricksWon[teamOf(winner)]++;
                currentLeader = winner;
            }
            simTricks.push(trick);
        }

        const declarerTeam = teamOf(contract.declarer);
        const expertMade = simTricksWon[declarerTeam];
        const required = contract.level + 6;
        const expertDiff = expertMade - required;
        const actualMade = gs.tricksWon[declarerTeam];

        let html = '<div class="analysis-section"><h4>Jeu de la carte idéal (simulation expert)</h4>';

        html += `<p class="analysis-comment">Levées réalisées par l'expert: <strong>${expertMade}</strong> / ${required} requises — `;
        if (expertDiff >= 0) {
            html += `<span style="color:#2ecc71">Contrat réussi${expertDiff > 0 ? ` (+${expertDiff})` : ''}</span>`;
        } else {
            html += `<span style="color:#e74c3c">Chute de ${-expertDiff}</span>`;
        }
        html += '</p>';

        // Compare with actual play
        if (expertMade !== actualMade) {
            const delta = expertMade - actualMade;
            if (delta > 0) {
                html += `<p class="analysis-comment" style="color:#f1c40f">L'expert gagne <strong>${delta} levée${delta > 1 ? 's' : ''} de plus</strong> que le jeu réel.</p>`;
            } else {
                html += `<p class="analysis-comment" style="color:#2ecc71">Le jeu réel fait <strong>${-delta} levée${-delta > 1 ? 's' : ''} de plus</strong> que la simulation expert.</p>`;
            }
        } else {
            html += `<p class="analysis-comment" style="color:#2ecc71">Le jeu réel a atteint le même résultat que l'expert !</p>`;
        }

        // Trick by trick table
        html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em; color:#bbb; margin-top:8px">';
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1)"><th style="padding:4px;text-align:left">#</th><th>Ouest</th><th>Nord</th><th>Est</th><th>Sud</th><th>Gagnant</th></tr>';
        for (let i = 0; i < simTricks.length; i++) {
            const trick = simTricks[i];
            const winner = trick.getWinner();
            const winTeam = winner ? teamOf(winner) : '';
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
            html += `<td style="text-align:center;padding:3px;color:${winTeam === teamOf(gs.humanPos) ? '#2ecc71' : '#e74c3c'}">${winner ? POSITION_FR[winner] : '-'}</td>`;
            html += '</tr>';
        }
        html += '</table></div>';

        return html;
    }

    _conventionLabel() {
        const labels = {
            sef: 'SEF',
            sayc: 'SAYC',
            '2over1': '2/1 GF',
            acol: 'Acol',
            standard: 'Standard Am.'
        };
        return labels[this.settings.convention] || this.settings.convention;
    }

    _generateExpertAdvice(gs) {
        const tips = [];
        const humanPos = gs.humanPos;
        const humanHand = gs.originalHands[humanPos];
        if (!humanHand) return '';
        const humanEval = evaluateHand(humanHand);
        const partnerPos = partnerOf(humanPos);
        const partnerHand = gs.originalHands[partnerPos];
        const partnerEval = partnerHand ? evaluateHand(partnerHand) : null;
        const combinedHCP = humanEval.hcp + (partnerEval ? partnerEval.hcp : 0);

        // ---- Bidding advice ----
        const humanBids = gs.bidding ? gs.bidding.bids.filter(b => b.player === humanPos && b.type === 'bid') : [];
        const partnerBids = gs.bidding ? gs.bidding.bids.filter(b => b.player === partnerPos && b.type === 'bid') : [];

        // Opening analysis
        if (humanBids.length === 0 && humanEval.hcp >= 12) {
            tips.push({
                type: 'encheres',
                icon: 'warning',
                text: `Vous aviez ${humanEval.hcp} HCP et n'avez pas ouvert. Avec 12+ HCP, vous devriez ouvrir les ench\u00e8res.`
            });
        }

        if (humanBids.length > 0 && humanBids[0].level === 1 && humanBids[0].suit !== 'NT') {
            const openSuit = humanBids[0].suit;
            if ((openSuit === 'H' || openSuit === 'S') && humanEval.suitCounts[openSuit] < 5) {
                tips.push({
                    type: 'encheres',
                    icon: 'error',
                    text: `Vous avez ouvert 1${SUIT_SYMBOLS[openSuit]} avec seulement ${humanEval.suitCounts[openSuit]} cartes. En majeure 5e, il faut 5+ cartes pour ouvrir d'une majeure.`
                });
            }
        }

        // NT opening check
        if (humanEval.isBalanced && humanEval.hcp >= 15 && humanEval.hcp <= 17) {
            const opened1NT = humanBids.length > 0 && humanBids[0].level === 1 && humanBids[0].suit === 'NT';
            if (!opened1NT && humanBids.length > 0) {
                tips.push({
                    type: 'encheres',
                    icon: 'info',
                    text: `Avec ${humanEval.hcp} HCP et une main \u00e9quilibr\u00e9e, l'ouverture de 1SA \u00e9tait \u00e0 consid\u00e9rer.`
                });
            }
        }

        // Combined strength analysis
        if (gs.contract && partnerEval) {
            const required = gs.contract.level + 6;
            const declarerTeam = teamOf(gs.contract.declarer);
            const isOurContract = teamOf(humanPos) === declarerTeam;

            if (isOurContract) {
                // Check if right contract level
                if (combinedHCP >= 25 && gs.contract.level < 3 && gs.contract.suit === 'NT') {
                    tips.push({
                        type: 'encheres',
                        icon: 'info',
                        text: `Avec ${combinedHCP} HCP combin\u00e9s, la manche (3SA ou 4 en majeure) \u00e9tait envisageable.`
                    });
                }
                if (combinedHCP >= 33 && gs.contract.level < 6) {
                    tips.push({
                        type: 'encheres',
                        icon: 'info',
                        text: `Avec ${combinedHCP} HCP combin\u00e9s, un chelem (palier 6) \u00e9tait possible.`
                    });
                }

                // Fit analysis
                for (const suit of ['S', 'H']) {
                    const fitCount = humanEval.suitCounts[suit] + (partnerEval ? partnerEval.suitCounts[suit] : 0);
                    if (fitCount >= 8) {
                        const playedInSuit = gs.contract.suit === suit;
                        if (!playedInSuit && gs.contract.suit === 'NT') {
                            tips.push({
                                type: 'encheres',
                                icon: 'info',
                                text: `Vous aviez un fit de ${fitCount} cartes \u00e0 ${SUIT_SYMBOLS[suit]}. Un contrat en ${SUIT_SYMBOLS[suit]} aurait pu \u00eatre pr\u00e9f\u00e9rable \u00e0 SA.`
                            });
                        }
                    }
                }
            }
        }

        // ---- Play advice ----
        if (gs.contract && gs.tricks.length > 0) {
            const declarerTeam = teamOf(gs.contract.declarer);
            const isOurContract = teamOf(humanPos) === declarerTeam;
            const trump = gs.contract.suit;

            // Analyze each trick for the human's play
            for (let i = 0; i < gs.tricks.length; i++) {
                const trick = gs.tricks[i];
                const humanCard = trick.cards[humanPos];
                if (!humanCard) continue;

                const winner = trick.getWinner();
                const partnerCard = trick.cards[partnerPos];
                const suitLed = trick.suitLed;

                // Did human lead? Check opening lead
                if (i === 0 && trick.leader === humanPos && !isOurContract) {
                    // Defensive lead analysis
                    if (trump === 'NT' && humanCard.suit) {
                        const suitLen = humanEval.suitCounts[humanCard.suit];
                        const longestSuit = humanEval.longestSuit;
                        const longestLen = humanEval.suitCounts[longestSuit];
                        if (suitLen < longestLen && longestLen >= 4) {
                            tips.push({
                                type: 'jeu',
                                icon: 'info',
                                text: `Lev\u00e9e 1 : Contre SA, privil\u00e9giez l'entame dans votre plus longue couleur (${SUIT_SYMBOLS[longestSuit]}, ${longestLen} cartes) pour \u00e9tablir vos lev\u00e9es de longueur.`
                            });
                        }
                    }
                }

                // Trump not pulled early (declarer)
                if (isOurContract && humanPos === gs.contract.declarer && trump !== 'NT' && i <= 2) {
                    if (trick.leader === humanPos && humanCard.suit !== trump) {
                        const trumpCount = gs.originalHands[humanPos].filter(c => c.suit === trump).length;
                        if (trumpCount >= 5) {
                            const adversaryTrumps = ['E', 'W', 'N', 'S']
                                .filter(p => teamOf(p) !== declarerTeam)
                                .some(p => gs.originalHands[p] && gs.originalHands[p].some(c => c.suit === trump));
                            if (adversaryTrumps && i === 0) {
                                tips.push({
                                    type: 'jeu',
                                    icon: 'info',
                                    text: `En tant que d\u00e9clarant avec ${trumpCount} atouts, pensez \u00e0 faire tomber les atouts adverses t\u00f4t (jouer atout d\u00e8s que possible).`
                                });
                            }
                        }
                    }
                }
            }

            // General result advice
            const required = gs.contract.level + 6;
            const made = gs.tricksWon[declarerTeam];
            const diff = made - required;

            if (isOurContract && diff < 0) {
                tips.push({
                    type: 'general',
                    icon: 'warning',
                    text: `Le contrat a chut\u00e9 de ${-diff}. Avec ${combinedHCP} HCP combin\u00e9s, un contrat plus prudent aurait peut-\u00eatre \u00e9t\u00e9 pr\u00e9f\u00e9rable.`
                });
            }

            if (!isOurContract && diff >= 0) {
                tips.push({
                    type: 'general',
                    icon: 'info',
                    text: `Les adversaires ont r\u00e9ussi leur contrat. Cherchez si une entame diff\u00e9rente ou un signal d\u00e9fensif aurait pu les mettre en difficult\u00e9.`
                });
            }

            if (isOurContract && diff >= 2) {
                tips.push({
                    type: 'encheres',
                    icon: 'info',
                    text: `+${diff} surlevées ! Vous auriez pu ench\u00e9rir plus haut. Un contrat de ${gs.contract.level + Math.min(diff, 2)}${gs.contract.suit === 'NT' ? 'SA' : SUIT_SYMBOLS[gs.contract.suit]} \u00e9tait peut-\u00eatre faisable.`
                });
            }
        }

        if (tips.length === 0) {
            tips.push({
                type: 'general',
                icon: 'ok',
                text: 'Bien jou\u00e9 ! Rien de particulier \u00e0 signaler sur cette donne.'
            });
        }

        // Render
        const iconMap = {
            error: '\u274c',
            warning: '\u26a0\ufe0f',
            info: '\ud83d\udca1',
            ok: '\u2705'
        };

        let html = '<div class="analysis-section"><h4>Recommandations de l\'expert</h4>';
        const biddingTips = tips.filter(t => t.type === 'encheres');
        const playTips = tips.filter(t => t.type === 'jeu');
        const generalTips = tips.filter(t => t.type === 'general');

        if (biddingTips.length) {
            html += '<p style="color:#e94560;margin-bottom:6px"><strong>Ench\u00e8res</strong></p>';
            for (const t of biddingTips) {
                html += `<p class="analysis-comment">${iconMap[t.icon]} ${t.text}</p>`;
            }
        }
        if (playTips.length) {
            html += '<p style="color:#e94560;margin-bottom:6px;margin-top:10px"><strong>Jeu de la carte</strong></p>';
            for (const t of playTips) {
                html += `<p class="analysis-comment">${iconMap[t.icon]} ${t.text}</p>`;
            }
        }
        if (generalTips.length) {
            html += '<p style="color:#e94560;margin-bottom:6px;margin-top:10px"><strong>G\u00e9n\u00e9ral</strong></p>';
            for (const t of generalTips) {
                html += `<p class="analysis-comment">${iconMap[t.icon]} ${t.text}</p>`;
            }
        }
        html += '</div>';
        return html;
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
