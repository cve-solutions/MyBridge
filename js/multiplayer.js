// ==================== MULTIPLAYER CONTROLLER ====================
// Handles WS-driven multiplayer game mode integrated into BridgeApp.
// BridgeApp delegates bid/play actions here when in multiplayer mode.

class MultiplayerController {
    constructor(app) {
        this.app = app;          // BridgeApp instance
        this.tableId = null;
        this.myPosition = null;
        this.tableState = null;  // Last known table state from server
        this.isActive = false;
    }

    // ==================== JOINING / LEAVING ====================

    async createTable(settings) {
        try {
            const res = await fetch('/api/tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            const data = await res.json();
            if (data.error) { this.app._showMessage(data.error); return null; }
            this._enterTable(data.table);
            return data.table;
        } catch (e) {
            this.app._showMessage('Erreur de connexion.');
            return null;
        }
    }

    async joinTable(code, position) {
        try {
            const res = await fetch('/api/tables/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, position })
            });
            const data = await res.json();
            if (data.error) { this.app._showMessage(data.error); return null; }
            this._enterTable(data.table);
            return data.table;
        } catch (e) {
            this.app._showMessage('Erreur de connexion.');
            return null;
        }
    }

    async leaveTable() {
        if (!this.tableId) return;
        try {
            await fetch(`/api/tables/${this.tableId}/leave`, { method: 'POST' });
        } catch (e) { /* ignore */ }
        this._exitTable();
    }

    async startGame() {
        if (!this.tableId) return;
        try {
            const res = await fetch(`/api/tables/${this.tableId}/start`, { method: 'POST' });
            const data = await res.json();
            if (data.error) this.app._showMessage(data.error);
        } catch (e) { /* ignore */ }
    }

    async invitePlayer(toUserId, position) {
        if (!this.tableId) return;
        try {
            await fetch(`/api/tables/${this.tableId}/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toUserId, position })
            });
        } catch (e) { /* ignore */ }
    }

    _enterTable(tableData) {
        this.isActive = true;
        this.tableId = tableData.tableId;
        this.myPosition = tableData.myPosition;
        this.tableState = tableData;
        this._renderLobby(tableData);
    }

    _exitTable() {
        this.isActive = false;
        this.tableId = null;
        this.myPosition = null;
        this.tableState = null;
        // Return to settings screen
        this.app._showScreen('settings-screen');
        // Switch to Tables tab
        const tablesTab = document.querySelector('[data-main-tab="tables-panel"]');
        if (tablesTab) tablesTab.click();
    }

    // ==================== WS MESSAGE HANDLING ====================

    handleMessage(msg) {
        switch (msg.type) {
            case 'table_list':
                this._renderTableList(msg.tables);
                break;

            case 'table_updated':
                if (msg.tableId === this.tableId) {
                    if (this.tableState) {
                        this.tableState.seats = msg.seats;
                        this.tableState.seatNames = msg.seatNames;
                        this.tableState.status = msg.status;
                    }
                    this._renderLobby(this.tableState);
                }
                break;

            case 'table_player_left':
                if (msg.tableId === this.tableId) {
                    if (this.tableState) {
                        this.tableState.seats = msg.seats;
                        this.tableState.seatNames = msg.seatNames;
                    }
                    this._renderLobby(this.tableState);
                }
                break;

            case 'table_game_state':
                if (msg.tableId === this.tableId) {
                    this._applyFullGameState(msg.state);
                }
                break;

            case 'table_bid_placed':
                if (msg.tableId === this.tableId) {
                    this._applyBidPlaced(msg);
                }
                break;

            case 'table_play_started':
                if (msg.tableId === this.tableId) {
                    this._applyPlayStarted(msg);
                }
                break;

            case 'table_card_played':
                if (msg.tableId === this.tableId) {
                    this._applyCardPlayed(msg);
                }
                break;

            case 'table_deal_complete':
                if (msg.tableId === this.tableId) {
                    this._applyDealComplete(msg);
                }
                break;

            case 'table_claim_accepted':
                if (msg.tableId === this.tableId) {
                    this.app._showMessage('Revendication acceptée !');
                }
                break;

            case 'table_error':
                this.app._showMessage(msg.error || 'Erreur.');
                break;

            case 'table_invitation':
                this._showInvitationToast(msg);
                break;
        }
    }

    // ==================== STATE APPLICATION ====================

    _applyFullGameState(state) {
        if (!state) return;
        this.tableState = { ...this.tableState, ...state };
        this.myPosition = state.myPosition;

        const gs = state.gameState;
        if (!gs) {
            // Still in lobby
            this._renderLobby(this.tableState);
            return;
        }

        // Build local GameState from server data
        const app = this.app;
        const localSettings = { seat: this.myPosition || 'S', ...app.settings };
        app.gameState = this._buildGameState(gs, localSettings);
        app.settings.seat = this.myPosition || 'S';

        this._showGameScreen();
        this._syncUIFromState(gs);
    }

    _buildGameState(gsData, settings) {
        const gs = new GameState(settings);
        gs.dealNumber = gsData.dealNumber || 1;
        gs.phase = gsData.phase;
        gs.dealer = gsData.dealer;
        gs.vulnerability = gsData.vulnerability;
        gs.contract = gsData.contract || null;
        gs.tricksWon = { ...gsData.tricksWon };
        gs.totalScore = { ...(gsData.totalScore || { NS: 0, EW: 0 }) };

        // Reconstruct hands
        gs.hands = {};
        gs.originalHands = {};
        for (const pos of POSITIONS) {
            gs.hands[pos] = (gsData.hands[pos] || []).filter(c => c !== null).map(c => new Card(c.suit, c.rank));
            gs.originalHands[pos] = (gsData.originalHands[pos] || []).filter(c => c !== null).map(c => new Card(c.suit, c.rank));
        }

        // Reconstruct bidding
        if (gsData.bidding) {
            gs.bidding = new BiddingManager(gsData.dealer);
            for (const b of gsData.bidding.bids) {
                const bid = new Bid(b.type, b.level, b.suit, b.player);
                // Replay bids without triggering side effects
                gs.bidding.bids.push(bid);
                if (b.type === 'pass') {
                    gs.bidding.passCount++;
                } else {
                    gs.bidding.passCount = 0;
                    if (b.type === 'bid') {
                        gs.bidding.lastBid = bid;
                        gs.bidding.lastBidder = b.player;
                        gs.bidding.doubled = false;
                        gs.bidding.redoubled = false;
                    } else if (b.type === 'double') {
                        gs.bidding.doubled = true;
                    } else if (b.type === 'redouble') {
                        gs.bidding.redoubled = true;
                    }
                    gs.bidding.currentBidder = nextPos(b.player);
                }
            }
            gs.bidding.isComplete = gsData.bidding.isComplete;
            gs.bidding.contract = gsData.bidding.contract;
            gs.bidding.currentBidder = gsData.bidding.currentBidder || gs.bidding.currentBidder;
        }

        // Reconstruct tricks
        gs.tricks = (gsData.tricks || []).map(td => {
            const t = new Trick(td.leader, td.trump);
            t.suitLed = td.suitLed;
            t.order = [...td.order];
            for (const [p, c] of Object.entries(td.cards || {})) {
                t.cards[p] = new Card(c.suit, c.rank);
            }
            return t;
        });

        // Reconstruct current trick
        if (gsData.currentTrick) {
            const ct = gsData.currentTrick;
            const t = new Trick(ct.leader, ct.trump);
            t.suitLed = ct.suitLed;
            t.order = [...(ct.order || [])];
            for (const [p, c] of Object.entries(ct.cards || {})) {
                t.cards[p] = new Card(c.suit, c.rank);
            }
            gs.currentTrick = t;
        }

        return gs;
    }

    _syncUIFromState(gsData) {
        const app = this.app;
        const gs = app.gameState;
        if (!gs) return;

        // Update seat labels to show player names
        this._updateSeatLabels();

        app._updateInfoBar();
        app._renderAllHands();

        if (gsData.phase === 'bidding' && !gsData.bidding.isComplete) {
            app._showBiddingPanel();
            app._hideTrickArea();
            app._updateBiddingHistory();
            app._updateBiddingControls();
            app._updatePlayerLabels();
        } else if (gsData.phase === 'playing') {
            app._hideBiddingPanel();
            app._showTrickArea();
            app._updatePlayerLabels();
            // Restore current trick display
            if (gs.currentTrick) {
                for (const p of gs.currentTrick.order) {
                    app._displayTrickCard(p, gs.currentTrick.cards[p]);
                }
            }
            app._updateClaimBtn();
        } else if (gsData.phase === 'scoring') {
            app._showScoreScreen();
        }
    }

    _applyBidPlaced(msg) {
        const app = this.app;
        const gs = app.gameState;
        if (!gs || !gs.bidding) return;

        const bid = new Bid(msg.bid.type, msg.bid.level, msg.bid.suit, msg.bid.player);
        gs.bidding.bids.push(bid);
        gs.bidding.isComplete = msg.biddingComplete;
        if (msg.contract) gs.bidding.contract = msg.contract;
        if (msg.currentBidder) gs.bidding.currentBidder = msg.currentBidder;

        // Update pass/double state
        if (bid.type === 'pass') {
            gs.bidding.passCount++;
        } else {
            gs.bidding.passCount = 0;
            if (bid.type === 'bid') {
                gs.bidding.lastBid = bid;
                gs.bidding.lastBidder = bid.player;
                gs.bidding.doubled = false;
                gs.bidding.redoubled = false;
            } else if (bid.type === 'double') gs.bidding.doubled = true;
            else if (bid.type === 'redouble') gs.bidding.redoubled = true;
        }

        app._updateBiddingHistory();
        app._updatePlayerLabels();

        if (msg.biddingComplete) {
            gs.contract = msg.contract;
            app._updateInfoBar();
        } else {
            app._updateBiddingControls();
        }
    }

    _applyPlayStarted(msg) {
        const app = this.app;
        const gs = app.gameState;
        if (!gs) return;

        gs.phase = 'playing';
        gs.contract = msg.contract;

        // Rebuild current trick
        const ct = msg.currentTrick;
        gs.currentTrick = new Trick(ct.leader, ct.trump);

        app._hideBiddingPanel();
        app._showTrickArea();
        app._updateInfoBar();
        app._renderAllHands();
        app._updatePlayerLabels();
        app._updateClaimBtn();
    }

    _applyCardPlayed(msg) {
        const app = this.app;
        const gs = app.gameState;
        if (!gs || !gs.currentTrick) return;

        const card = new Card(msg.card.suit, msg.card.rank);
        const pos = msg.position;

        // Remove card from hand
        const idx = gs.hands[pos].findIndex(c => c.suit === card.suit && c.rank === card.rank);
        if (idx !== -1) gs.hands[pos].splice(idx, 1);

        // Add to trick
        gs.currentTrick.playCard(pos, card);
        gs.tricksWon = { ...msg.tricksWon };

        // Display in trick area
        app._displayTrickCard(pos, card);
        app._renderAllHands();
        app._updateInfoBar();

        if (msg.trickComplete) {
            app._hideUndoBtn();
            const delay = (app.settings.trickDelay || 2) * 1000;
            setTimeout(() => {
                app._clearTrickDisplay();

                if (msg.gameComplete) {
                    // Wait for deal_complete message to show score
                } else if (msg.currentTrick) {
                    // Restore new trick from server
                    const ct = msg.currentTrick;
                    gs.currentTrick = new Trick(ct.leader, ct.trump);
                    gs.currentTrick.suitLed = ct.suitLed;
                    gs.currentTrick.order = [...ct.order];
                    for (const [p, c] of Object.entries(ct.cards || {})) {
                        gs.currentTrick.cards[p] = new Card(c.suit, c.rank);
                    }
                    // Complete trick was moved to tricks array
                    app._updatePlayerLabels();
                    app._updateClaimBtn();
                }
            }, delay);
        } else {
            app._updatePlayerLabels();
            app._updateClaimBtn();
        }
    }

    _applyDealComplete(msg) {
        const app = this.app;
        const gs = app.gameState;
        if (!gs) return;

        gs.phase = 'scoring';
        gs.totalScore = { ...msg.totalScore };

        // Reveal all hands if provided
        if (msg.allHands) {
            for (const pos of POSITIONS) {
                if (msg.allHands[pos]) {
                    gs.originalHands[pos] = msg.allHands[pos].map(c => new Card(c.suit, c.rank));
                }
            }
        }

        app._showScoreScreen();
    }

    // ==================== HUMAN ACTION INTERCEPTS ====================

    sendBid(bid) {
        this._sendWs({
            type: 'table_bid',
            tableId: this.tableId,
            bid: { type: bid.type, level: bid.level || null, suit: bid.suit || null }
        });
    }

    sendPlay(card) {
        this._sendWs({
            type: 'table_play',
            tableId: this.tableId,
            card: { suit: card.suit, rank: card.rank }
        });
    }

    sendClaim() {
        this._sendWs({ type: 'table_claim', tableId: this.tableId });
    }

    sendNextDeal() {
        this._sendWs({ type: 'table_next_deal', tableId: this.tableId });
    }

    _sendWs(msg) {
        const ws = this.app.community ? this.app.community.ws : null;
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(msg));
        }
    }

    // ==================== LOBBY RENDERING ====================

    _renderLobby(tableData) {
        if (!tableData) return;
        const container = document.getElementById('mp-lobby');
        if (!container) return;

        const seats = tableData.seats || { N: null, E: null, S: null, W: null };
        const names = tableData.seatNames || { N: 'IA', E: 'IA', S: 'IA', W: 'IA' };
        const myPos = tableData.myPosition;
        const isCreator = tableData.createdBy === this.app.community?.myUserId;
        const status = tableData.status;

        const posLabels = { N: 'Nord', E: 'Est', S: 'Sud', W: 'Ouest' };
        let html = `
            <div class="mp-lobby-box">
                <div class="mp-lobby-header">
                    <span class="mp-lobby-code">Table: <strong>${tableData.code}</strong></span>
                    <span class="mp-lobby-status status-${status}">${status === 'waiting' ? 'En attente' : 'En cours'}</span>
                </div>
                <p class="hint-text">Partagez ce code à vos partenaires pour qu'ils rejoignent la table.</p>
                <div class="mp-seat-grid">
        `;

        for (const pos of POSITIONS) {
            const userId = seats[pos];
            const name = names[pos] || 'IA';
            const isMe = (pos === myPos);
            const isTaken = userId !== null;
            html += `
                <div class="mp-seat ${isMe ? 'mp-seat-me' : ''} ${isTaken ? 'mp-seat-taken' : 'mp-seat-empty'}">
                    <span class="mp-seat-pos">${posLabels[pos]}</span>
                    <span class="mp-seat-name">${isTaken ? name : 'Libre (IA)'}</span>
                    ${!isTaken && !myPos && status === 'waiting'
                        ? `<button class="game-action-btn mp-take-seat-btn" data-pos="${pos}">Prendre</button>`
                        : ''}
                </div>
            `;
        }

        html += `</div>`;

        if (status === 'waiting') {
            if (isCreator) {
                html += `<button class="primary-btn" id="mp-start-btn" style="margin-top:15px;">Démarrer la partie</button>`;
            }
        }

        html += `<button class="secondary-btn" id="mp-leave-btn" style="margin-top:10px;">Quitter la table</button>`;
        html += `</div>`;

        container.innerHTML = html;

        // Bind buttons
        container.querySelectorAll('.mp-take-seat-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await this.joinTable(tableData.code, btn.dataset.pos);
            });
        });

        const startBtn = container.querySelector('#mp-start-btn');
        if (startBtn) startBtn.addEventListener('click', () => this.startGame());

        const leaveBtn = container.querySelector('#mp-leave-btn');
        if (leaveBtn) leaveBtn.addEventListener('click', () => this.leaveTable());

        // Show lobby panel
        this._showLobbyPanel();
    }

    _showLobbyPanel() {
        // Switch to tables tab and show lobby
        document.querySelectorAll('.main-tab-panel').forEach(p => p.classList.add('hidden'));
        const tablesPanel = document.getElementById('tables-panel');
        if (tablesPanel) {
            tablesPanel.classList.remove('hidden');
            const lobbySection = document.getElementById('mp-lobby-section');
            if (lobbySection) lobbySection.classList.remove('hidden');
            const tableListSection = document.getElementById('mp-table-list-section');
            if (tableListSection) tableListSection.classList.add('hidden');
        }
        document.querySelectorAll('.main-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mainTab === 'tables-panel');
        });
    }

    _showGameScreen() {
        const app = this.app;
        app._layoutTable();
        app._showScreen('game-screen');
        // Update position labels with player names
        this._updateSeatLabels();
        if (app.community) app.community.notifyEnterGame();
    }

    _updateSeatLabels() {
        const app = this.app;
        const gs = app.gameState;
        if (!gs || !this.tableState) return;

        const names = this.tableState.seatNames || {};

        for (const pos of POSITIONS) {
            const posName = pos === 'N' ? 'north' : pos === 'E' ? 'east' : pos === 'S' ? 'south' : 'west';
            const label = document.getElementById(`label-${posName}`);
            if (!label) continue;

            const name = names[pos] || 'IA';
            const isMe = (pos === this.myPosition);
            let text = POSITION_FR[pos] + ' — ' + name + (isMe ? ' (Vous)' : '');

            if (gs.phase === 'playing' && gs.contract) {
                if (pos === gs.declarerPos) text += ' - Déclarant';
                else if (pos === gs.dummyPos) text += ' - Mort';
            }

            label.textContent = text;
        }
    }

    // ==================== TABLE LIST ====================

    _renderTableList(tables) {
        const container = document.getElementById('mp-table-list');
        if (!container) return;

        if (!tables || tables.length === 0) {
            container.innerHTML = '<p class="hint-text">Aucune table active. Créez-en une !</p>';
            return;
        }

        const posLabels = { N: 'N', E: 'E', S: 'S', W: 'O' };
        let html = '';

        for (const t of tables) {
            const seats = t.seats || {};
            const names = t.seatNames || {};
            const seatInfo = POSITIONS.map(p => {
                const taken = seats[p] !== null;
                return `<span class="mp-tl-seat ${taken ? 'taken' : 'free'}" title="${names[p] || 'Libre'}">${posLabels[p]}</span>`;
            }).join('');

            html += `
                <div class="mp-table-row" data-table-id="${t.tableId}" data-code="${t.code}">
                    <span class="mp-tl-code">${t.code}</span>
                    <span class="mp-tl-seats">${seatInfo}</span>
                    <span class="mp-tl-status status-${t.status}">${t.status === 'waiting' ? 'Attente' : 'En jeu'}</span>
                    <span class="mp-tl-deal">D${t.dealNumber}</span>
                </div>
            `;
        }

        container.innerHTML = html;

        container.querySelectorAll('.mp-table-row').forEach(row => {
            row.addEventListener('click', () => {
                const code = row.dataset.code;
                document.getElementById('mp-join-code').value = code;
            });
        });
    }

    async loadTableList() {
        try {
            const res = await fetch('/api/tables');
            if (res.ok) {
                const tables = await res.json();
                this._renderTableList(tables);
            }
        } catch (e) { /* ignore */ }
    }

    // ==================== INVITATION TOAST ====================

    _showInvitationToast(msg) {
        const posLabels = { N: 'Nord', E: 'Est', S: 'Sud', W: 'Ouest' };
        const posLabel = msg.position ? ` (${posLabels[msg.position] || msg.position})` : '';
        const toast = document.createElement('div');
        toast.className = 'mp-invitation-toast';
        toast.innerHTML = `
            <strong>${msg.fromUser.name}</strong> vous invite à rejoindre la table <strong>${msg.tableCode}</strong>${posLabel}.
            <div class="mp-invitation-actions">
                <button class="game-action-btn game-action-claim" id="inv-accept-${msg.invitationId}">Accepter</button>
                <button class="game-action-btn" id="inv-decline-${msg.invitationId}">Refuser</button>
            </div>
        `;
        document.body.appendChild(toast);

        const accept = toast.querySelector(`#inv-accept-${msg.invitationId}`);
        const decline = toast.querySelector(`#inv-decline-${msg.invitationId}`);

        accept.addEventListener('click', async () => {
            toast.remove();
            await fetch(`/api/invitations/${msg.invitationId}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accept: true })
            });
            // Join the table
            if (msg.position) {
                await this.joinTable(msg.tableCode, msg.position);
            }
        });

        decline.addEventListener('click', async () => {
            toast.remove();
            await fetch(`/api/invitations/${msg.invitationId}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accept: false })
            });
        });

        // Auto-dismiss after 30 seconds
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 30000);
    }
}
