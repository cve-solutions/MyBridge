// ==================== COMMUNITY: Players, Chat, Rankings ====================

class CommunityManager {
    constructor(app) {
        this.app = app;
        this.ws = null;
        this.onlineUsers = new Set();
        this.inGameUsers = new Set();
        this.currentChatUserId = null;
        this.myUserId = null;
        this.unreadCounts = {};
        this._initUI();
        this._connectWebSocket();
        this._fetchMyId();
    }

    // ==================== INIT ====================

    _initUI() {
        // Community tabs
        document.querySelectorAll('.community-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.community-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.community-panel').forEach(p => p.classList.add('hidden'));
                document.getElementById(`panel-${tab.dataset.tab}`).classList.remove('hidden');
                if (tab.dataset.tab === 'rankings') this.loadRankings();
            });
        });

        // Chat modal
        document.getElementById('chat-close-btn').addEventListener('click', () => this._closeChat());
        document.getElementById('chat-send-btn').addEventListener('click', () => this._sendMessage());
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendMessage();
            }
        });

        // Close chat on overlay click
        document.getElementById('chat-modal').addEventListener('click', (e) => {
            if (e.target.id === 'chat-modal') this._closeChat();
        });

        this._initProfile();
    }

    async _fetchMyId() {
        try {
            const res = await fetch('/api/me');
            if (res.ok) {
                const data = await res.json();
                this.myUserId = data.id;
                this.loadPlayers();
                this._loadUnreadCounts();
                this._loadMyRating();
            }
        } catch (e) { /* ignore */ }
    }

    async _loadMyRating() {
        try {
            const res = await fetch('/api/my-rating');
            if (res.ok) {
                const myRating = await res.json();
                this._renderMyRating(myRating);
            }
        } catch (e) { /* ignore */ }
    }

    // ==================== WEBSOCKET ====================

    _connectWebSocket() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${proto}//${location.host}`);

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._handleWsMessage(msg);
            } catch (e) { /* ignore */ }
        };

        this.ws.onopen = () => {
            this._wsRetryDelay = 1000;
        };

        this.ws.onclose = () => {
            // Reconnect with exponential backoff
            this._wsRetryDelay = Math.min((this._wsRetryDelay || 1000) * 2, 30000);
            setTimeout(() => this._connectWebSocket(), this._wsRetryDelay);
        };

        this.ws.onerror = () => { /* handled by onclose */ };

        // Keepalive ping every 30s
        this._pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    _handleWsMessage(msg) {
        if (msg.type === 'online_status') {
            this.onlineUsers = new Set(msg.online);
            this.inGameUsers = new Set(msg.inGame);
            this._updatePlayerListStatus();
            this._updateChatStatus();
        } else if (msg.type === 'chat_message') {
            const chatMsg = msg.message;
            // If chat is open with this user, display immediately
            if (this.currentChatUserId === chatMsg.from_user_id) {
                this._appendChatMessage(chatMsg);
                // Mark as read
                fetch(`/api/chat/${chatMsg.from_user_id}`);
            } else {
                // Increment unread count
                this.unreadCounts[chatMsg.from_user_id] = (this.unreadCounts[chatMsg.from_user_id] || 0) + 1;
                this._updatePlayerListUnread();
            }
        } else if (msg.type && msg.type.startsWith('table_')) {
            // Route multiplayer messages to the multiplayer controller
            if (this.app && this.app.multiplayer) {
                this.app.multiplayer.handleMessage(msg);
            }
        }
    }

    sendWs(message) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(message));
        }
    }

    notifyEnterGame() {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ type: 'enter_game' }));
        }
    }

    notifyLeaveGame() {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ type: 'leave_game' }));
        }
    }

    // ==================== PLAYER LIST ====================

    async loadPlayers() {
        try {
            const res = await fetch('/api/players');
            if (!res.ok) return;
            const players = await res.json();
            this._renderPlayerList(players);
        } catch (e) { /* ignore */ }
    }

    _renderPlayerList(players) {
        const container = document.getElementById('player-list');
        if (!players.length) {
            container.innerHTML = '<p class="hint-text">Aucun joueur inscrit</p>';
            return;
        }

        // Sort: online first, then by rating
        players.sort((a, b) => {
            if (a.online && !b.online) return -1;
            if (!a.online && b.online) return 1;
            return b.rating - a.rating;
        });

        container.innerHTML = '';
        for (const p of players) {
            const isMe = p.id === this.myUserId;
            const statusClass = p.inGame ? 'in-game' : (p.online ? 'online' : 'offline');
            const statusTitle = p.inGame ? 'En partie' : (p.online ? 'En ligne' : 'Hors ligne');
            const unread = this.unreadCounts[p.id] || 0;

            const el = document.createElement('div');
            el.className = 'player-list-item';
            el.dataset.userId = p.id;
            el.title = isMe ? 'C\'est vous' : `Double-cliquez pour chatter avec ${p.displayName}`;

            let html = `<span class="player-status-dot ${statusClass}" title="${statusTitle}"></span>`;
            html += `<div class="player-info">`;
            html += `<div class="player-name">${this._escapeHtml(p.displayName)}</div>`;
            html += `<div class="player-detail">${p.gamesPlayed} parties · ${p.wins} victoires</div>`;
            html += `</div>`;
            html += `<span class="player-rating-badge">${p.rating}</span>`;
            if (isMe) {
                html += `<span class="player-you-badge">Vous</span>`;
            }
            if (unread > 0 && !isMe) {
                html += `<span class="player-unread-badge" data-unread-for="${p.id}">${unread}</span>`;
            }

            el.innerHTML = html;

            if (!isMe) {
                el.addEventListener('dblclick', () => this._openChat(p.id, p.displayName));
            }

            container.appendChild(el);
        }
    }

    _updatePlayerListStatus() {
        document.querySelectorAll('.player-list-item').forEach(el => {
            const userId = parseInt(el.dataset.userId);
            const dot = el.querySelector('.player-status-dot');
            if (!dot) return;

            const inGame = this.inGameUsers.has(userId);
            const online = this.onlineUsers.has(userId);

            dot.classList.remove('online', 'offline', 'in-game');
            if (inGame) {
                dot.classList.add('in-game');
                dot.title = 'En partie';
            } else if (online) {
                dot.classList.add('online');
                dot.title = 'En ligne';
            } else {
                dot.classList.add('offline');
                dot.title = 'Hors ligne';
            }
        });
    }

    _updatePlayerListUnread() {
        document.querySelectorAll('.player-list-item').forEach(el => {
            const userId = parseInt(el.dataset.userId);
            const existing = el.querySelector('.player-unread-badge');
            const count = this.unreadCounts[userId] || 0;

            if (count > 0) {
                if (existing) {
                    existing.textContent = count;
                } else if (userId !== this.myUserId) {
                    const badge = document.createElement('span');
                    badge.className = 'player-unread-badge';
                    badge.dataset.unreadFor = userId;
                    badge.textContent = count;
                    el.appendChild(badge);
                }
            } else if (existing) {
                existing.remove();
            }
        });
    }

    async _loadUnreadCounts() {
        try {
            const res = await fetch('/api/chat-unread');
            if (!res.ok) return;
            const data = await res.json();
            this.unreadCounts = {};
            for (const row of data) {
                this.unreadCounts[row.from_user_id] = row.count;
            }
            this._updatePlayerListUnread();
        } catch (e) { /* ignore */ }
    }

    // ==================== CHAT ====================

    async _openChat(userId, displayName) {
        this.currentChatUserId = userId;
        document.getElementById('chat-modal-title').textContent = displayName;
        document.getElementById('chat-messages').innerHTML = '<p class="hint-text">Chargement...</p>';
        document.getElementById('chat-input').value = '';
        document.getElementById('chat-modal').classList.remove('hidden');
        this._updateChatStatus();

        try {
            const res = await fetch(`/api/chat/${userId}`);
            if (!res.ok) return;
            const messages = await res.json();
            const container = document.getElementById('chat-messages');
            container.innerHTML = '';

            if (messages.length === 0) {
                container.innerHTML = '<p class="hint-text" style="text-align:center; padding:20px;">Aucun message. Commencez la conversation !</p>';
            } else {
                for (const msg of messages) {
                    this._appendChatMessage(msg);
                }
            }

            // Clear unread
            this.unreadCounts[userId] = 0;
            this._updatePlayerListUnread();

            document.getElementById('chat-input').focus();
        } catch (e) { /* ignore */ }
    }

    _closeChat() {
        this.currentChatUserId = null;
        document.getElementById('chat-modal').classList.add('hidden');
    }

    _appendChatMessage(msg) {
        const container = document.getElementById('chat-messages');
        // Remove "no messages" hint
        const hint = container.querySelector('.hint-text');
        if (hint) hint.remove();

        const isSent = msg.from_user_id === this.myUserId;
        const el = document.createElement('div');
        el.className = `chat-msg ${isSent ? 'sent' : 'received'}`;

        const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
        el.innerHTML = `<div>${this._escapeHtml(msg.message)}</div><div class="chat-time">${time}</div>`;

        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
    }

    async _sendMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text || !this.currentChatUserId) return;

        input.value = '';

        try {
            const res = await fetch(`/api/chat/${this.currentChatUserId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });
            if (res.ok) {
                const msg = await res.json();
                this._appendChatMessage(msg);
            }
        } catch (e) { /* ignore */ }

        input.focus();
    }

    _updateChatStatus() {
        const statusEl = document.getElementById('chat-status');
        if (!statusEl || !this.currentChatUserId) return;

        if (this.inGameUsers.has(this.currentChatUserId)) {
            statusEl.className = 'chat-status in-game';
            statusEl.textContent = 'En partie';
        } else if (this.onlineUsers.has(this.currentChatUserId)) {
            statusEl.className = 'chat-status online';
            statusEl.textContent = 'En ligne';
        } else {
            statusEl.className = 'chat-status offline';
            statusEl.textContent = 'Hors ligne';
        }
    }

    // ==================== RANKINGS ====================

    async loadRankings() {
        try {
            const [rankingsRes, myRatingRes] = await Promise.all([
                fetch('/api/rankings'),
                fetch('/api/my-rating')
            ]);

            if (rankingsRes.ok) {
                const rankings = await rankingsRes.json();
                this._renderRankings(rankings);
            }

            if (myRatingRes.ok) {
                const myRating = await myRatingRes.json();
                this._renderMyRating(myRating);
            }
        } catch (e) { /* ignore */ }
    }

    _renderMyRating(r) {
        const box = document.getElementById('my-rating-box');
        box.innerHTML = `
            <div class="rating-value">${Math.round(r.rating)}</div>
            <div class="rating-title">${r.title}</div>
            <div class="rating-stats">${r.gamesPlayed} parties · ${r.wins} victoires · Record: ${Math.round(r.peakRating)}</div>
        `;
    }

    _renderRankings(rankings) {
        const container = document.getElementById('rankings-list');
        if (!rankings.length) {
            container.innerHTML = '<p class="hint-text">Aucun classement disponible. Jouez des parties pour apparaître !</p>';
            return;
        }

        container.innerHTML = '';
        for (const r of rankings) {
            const el = document.createElement('div');
            el.className = 'ranking-row';

            let posClass = '';
            if (r.rank === 1) posClass = 'gold';
            else if (r.rank === 2) posClass = 'silver';
            else if (r.rank === 3) posClass = 'bronze';

            const isMe = r.id === this.myUserId;

            el.innerHTML = `
                <span class="ranking-pos ${posClass}">${r.rank}</span>
                <span class="ranking-name">${this._escapeHtml(r.displayName)}${isMe ? ' <span style="color:#2ecc71">(Vous)</span>' : ''}</span>
                <span class="ranking-rating">${r.rating}</span>
                <span class="ranking-title-badge">${r.title}</span>
            `;
            container.appendChild(el);
        }
    }

    // ==================== PROFILE ====================

    _initProfile() {
        document.getElementById('profile-btn').addEventListener('click', () => this._openProfile());
        document.getElementById('profile-close-btn').addEventListener('click', () => {
            document.getElementById('profile-modal').classList.add('hidden');
        });
        document.getElementById('profile-modal').addEventListener('click', (e) => {
            if (e.target.id === 'profile-modal') document.getElementById('profile-modal').classList.add('hidden');
        });
        document.getElementById('profile-save-btn').addEventListener('click', () => this._saveProfile());
    }

    async _openProfile() {
        document.getElementById('profile-modal').classList.remove('hidden');

        try {
            const [profileRes, historyRes] = await Promise.all([
                fetch('/api/profile'),
                fetch('/api/game-history')
            ]);

            if (profileRes.ok) {
                const p = await profileRes.json();
                document.getElementById('profile-username').textContent = p.displayName || p.username;
                document.getElementById('profile-email').value = p.email || '';
                document.getElementById('profile-club-name').value = p.clubName || '';
                document.getElementById('profile-club-code').value = p.clubCode || '';
                document.getElementById('profile-ffb-license').value = p.ffbLicense || '';

                // Ranking section
                const rankHtml = `
                    <div class="profile-rank-card">
                        <div class="rank-label">Rating</div>
                        <div class="rank-value">${Math.round(p.rating)}</div>
                        <div class="rank-sub">Record: ${Math.round(p.peakRating)}</div>
                    </div>
                    <div class="profile-rank-card">
                        <div class="rank-label">Catégorie</div>
                        <div class="rank-value" style="font-size:0.9em">${p.title}</div>
                    </div>
                    <div class="profile-rank-card">
                        <div class="rank-label">Parties</div>
                        <div class="rank-value">${p.gamesPlayed}</div>
                        <div class="rank-sub">${p.wins} victoires</div>
                    </div>
                    <div class="profile-rank-card">
                        <div class="rank-label">Membre depuis</div>
                        <div class="rank-value" style="font-size:0.8em">${p.memberSince ? new Date(p.memberSince).toLocaleDateString('fr-FR') : '-'}</div>
                    </div>
                `;
                document.getElementById('profile-ranking').innerHTML = rankHtml;
            }

            if (historyRes.ok) {
                const data = await historyRes.json();
                this._renderGameSummary(data.summary);
                this._renderGameHistory(data.history);
            }
        } catch (e) { /* ignore */ }
    }

    async _saveProfile() {
        const btn = document.getElementById('profile-save-btn');
        btn.disabled = true;
        btn.textContent = 'Enregistrement...';

        try {
            await fetch('/api/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: document.getElementById('profile-email').value,
                    clubName: document.getElementById('profile-club-name').value,
                    clubCode: document.getElementById('profile-club-code').value,
                    ffbLicense: document.getElementById('profile-ffb-license').value
                })
            });
            btn.textContent = 'Enregistré !';
            setTimeout(() => { btn.textContent = 'Enregistrer'; btn.disabled = false; }, 1500);
        } catch (e) {
            btn.textContent = 'Erreur';
            setTimeout(() => { btn.textContent = 'Enregistrer'; btn.disabled = false; }, 1500);
        }
    }

    _renderGameSummary(summary) {
        if (!summary) return;
        const el = document.getElementById('profile-summary');
        el.innerHTML = `
            <div class="summary-card">
                <div class="summary-val">${summary.totalGames}</div>
                <div class="summary-lbl">Donnes jouées</div>
            </div>
            <div class="summary-card">
                <div class="summary-val">${summary.winRate}%</div>
                <div class="summary-lbl">Taux de réussite</div>
            </div>
            <div class="summary-card">
                <div class="summary-val">${summary.averageScore > 0 ? '+' : ''}${summary.averageScore}</div>
                <div class="summary-lbl">Score moyen</div>
            </div>
            <div class="summary-card">
                <div class="summary-val">${summary.bestScore > 0 ? '+' : ''}${summary.bestScore}</div>
                <div class="summary-lbl">Meilleur score</div>
            </div>
        `;
    }

    _renderGameHistory(history) {
        const el = document.getElementById('profile-history');
        if (!history || history.length === 0) {
            el.innerHTML = '<p class="hint-text">Aucune partie jouée</p>';
            return;
        }

        let html = '<table><thead><tr>';
        html += '<th>Date</th><th>Donne</th><th>Contrat</th><th>Décl.</th><th>Levées</th><th>Score NS</th><th>Résultat</th>';
        html += '</tr></thead><tbody>';

        for (const g of history) {
            const date = g.played_at ? new Date(g.played_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-';
            const time = g.played_at ? new Date(g.played_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
            const scoreColor = g.score_ns > 0 ? '#2ecc71' : (g.score_ns < 0 ? '#e74c3c' : '#888');
            const result = g.score_ns > 0 ? 'Réussi' : (g.score_ns < 0 ? 'Chute' : 'Passé');
            const resultIcon = g.score_ns > 0 ? '+' : (g.score_ns < 0 ? '-' : '=');

            html += '<tr>';
            html += `<td title="${time}">${date}</td>`;
            html += `<td>${g.deal_number || '-'}</td>`;
            html += `<td>${g.contract || 'Passée'}</td>`;
            html += `<td>${g.declarer || '-'}</td>`;
            html += `<td>${g.tricks_made != null ? g.tricks_made : '-'}</td>`;
            html += `<td style="color:${scoreColor};font-weight:bold">${g.score_ns > 0 ? '+' : ''}${g.score_ns}</td>`;
            html += `<td style="color:${scoreColor}">${result}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        el.innerHTML = html;
    }

    // ==================== UTILS ====================

    _escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }
}
