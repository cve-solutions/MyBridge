#!/usr/bin/env bash
# ==================== MyBridge - Installation Script ====================
# Usage:
#   sudo bash setup.sh              # Fresh install
#   sudo bash setup.sh --update     # Update existing installation
#
# Domain: bridge.buscaillet.fr
# Stack:  Node.js + Express + SQLite + NGINX + Let's Encrypt
# ========================================================================

set -euo pipefail

# ==================== CONFIGURATION ====================
DOMAIN="bridge.buscaillet.fr"
APP_DIR="/opt/mybridge"
APP_USER="mybridge"
APP_GROUP="mybridge"
NODE_VERSION="20"
REPO_URL="https://github.com/cve-solutions/MyBridge.git"
BRANCH="main"
SERVICE_NAME="mybridge"
CERTBOT_EMAIL=""  # Will be asked during install

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ==================== PRE-CHECKS ====================
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Ce script doit être exécuté en tant que root (sudo)."
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "OS non supporté. Debian/Ubuntu requis."
        exit 1
    fi
    . /etc/os-release
    if [[ "$ID" != "debian" && "$ID" != "ubuntu" ]]; then
        log_error "OS non supporté: $ID. Debian/Ubuntu requis."
        exit 1
    fi
    log_ok "OS détecté: $PRETTY_NAME"
}

# ==================== PERMISSIONS ====================
fix_permissions() {
    # App root must be traversable by NGINX (www-data)
    chmod 755 "$APP_DIR"

    # Static directories: readable by NGINX
    find "$APP_DIR/css" "$APP_DIR/js" -type d -exec chmod 755 {} \; 2>/dev/null || true
    find "$APP_DIR/css" "$APP_DIR/js" -type f -exec chmod 644 {} \; 2>/dev/null || true

    # HTML and public files at root
    chmod 644 "$APP_DIR"/*.html 2>/dev/null || true
    chmod 644 "$APP_DIR"/version.json 2>/dev/null || true

    # Server data dir: only mybridge user
    chmod 750 "$APP_DIR/server" 2>/dev/null || true
}

# ==================== UPDATE MODE ====================
do_update() {
    log_info "=========================================="
    log_info "  MyBridge - Mise à jour"
    log_info "=========================================="

    if [[ ! -d "$APP_DIR" ]]; then
        log_error "Installation non trouvée dans $APP_DIR. Lancez le script sans --update."
        exit 1
    fi

    log_info "Arrêt du service..."
    systemctl stop "$SERVICE_NAME" || true

    log_info "Sauvegarde de la base de données..."
    BACKUP_DIR="/opt/mybridge-backups"
    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    if [[ -f "$APP_DIR/server/data/mybridge.db" ]]; then
        cp "$APP_DIR/server/data/mybridge.db" "$BACKUP_DIR/mybridge_${TIMESTAMP}.db"
        log_ok "Backup: $BACKUP_DIR/mybridge_${TIMESTAMP}.db"
    fi

    log_info "Mise à jour du code source..."
    cd "$APP_DIR"
    sudo -u "$APP_USER" git fetch origin "$BRANCH"
    sudo -u "$APP_USER" git reset --hard "origin/$BRANCH"

    log_info "Mise à jour des dépendances Node.js..."
    cd "$APP_DIR/server"
    sudo -u "$APP_USER" npm install --omit=dev

    log_info "Mise à jour des permissions..."
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
    fix_permissions

    log_info "Mise à jour de la configuration NGINX..."
    cp "$APP_DIR/nginx/bridge.conf" "/etc/nginx/sites-available/${DOMAIN}"
    if [[ "$APP_DIR" != "/opt/mybridge" ]]; then
        sed -i "s|root /opt/mybridge;|root ${APP_DIR};|" "/etc/nginx/sites-available/${DOMAIN}"
    fi

    log_info "Rechargement NGINX..."
    nginx -t && systemctl reload nginx

    log_info "Redémarrage du service..."
    systemctl start "$SERVICE_NAME"

    # Cleanup old backups (keep last 10)
    ls -t "$BACKUP_DIR"/mybridge_*.db 2>/dev/null | tail -n +11 | xargs -r rm --

    # Show version
    if [[ -f "$APP_DIR/version.json" ]]; then
        APP_VERSION=$(grep -oP '"version":\s*"\K[^"]+' "$APP_DIR/version.json")
        log_ok "Version: $APP_VERSION"
    fi

    log_ok "=========================================="
    log_ok "  Mise à jour terminée avec succès !"
    log_ok "=========================================="
    exit 0
}

# ==================== FRESH INSTALL ====================
install_system_deps() {
    log_info "Mise à jour des paquets système..."
    apt-get update -qq

    log_info "Installation des dépendances système..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        curl \
        wget \
        git \
        build-essential \
        python3 \
        nginx \
        certbot \
        python3-certbot-nginx \
        sqlite3 \
        openssl \
        ufw \
        fail2ban \
        rsync \
        logrotate \
        > /dev/null

    log_ok "Dépendances système installées."
}

install_nodejs() {
    if command -v node &> /dev/null; then
        CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ "$CURRENT_NODE" -ge "$NODE_VERSION" ]]; then
            log_ok "Node.js $(node --version) déjà installé."
            return
        fi
    fi

    log_info "Installation de Node.js ${NODE_VERSION}.x..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null
    log_ok "Node.js $(node --version) installé."
}

create_app_user() {
    if id "$APP_USER" &>/dev/null; then
        log_ok "Utilisateur $APP_USER existe déjà."
        return
    fi

    log_info "Création de l'utilisateur système $APP_USER..."
    useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" --create-home "$APP_USER"
    log_ok "Utilisateur $APP_USER créé."
}

clone_application() {
    if [[ -d "$APP_DIR/.git" ]]; then
        log_info "Mise à jour du dépôt existant..."
        cd "$APP_DIR"
        sudo -u "$APP_USER" git fetch origin "$BRANCH"
        sudo -u "$APP_USER" git checkout "$BRANCH"
        sudo -u "$APP_USER" git reset --hard "origin/$BRANCH"
    else
        log_info "Clonage du dépôt..."
        # Remove default home dir content if exists
        rm -rf "${APP_DIR:?}/"* "${APP_DIR}"/.[!.]* 2>/dev/null || true
        git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
        chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
    fi

    # Ensure NGINX (www-data) can read static files
    fix_permissions

    log_ok "Code source en place."
}

install_node_deps() {
    log_info "Installation des dépendances Node.js..."
    cd "$APP_DIR/server"
    sudo -u "$APP_USER" npm install --omit=dev
    log_ok "Dépendances Node.js installées."
}

create_data_dir() {
    log_info "Création du répertoire de données..."
    mkdir -p "$APP_DIR/server/data"
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/server/data"
    chmod 750 "$APP_DIR/server/data"
    log_ok "Répertoire de données prêt."
}

generate_session_secret() {
    SECRET_FILE="$APP_DIR/server/.env"
    if [[ -f "$SECRET_FILE" ]]; then
        log_ok "Fichier .env existe déjà."
        return
    fi

    log_info "Génération du secret de session..."
    SESSION_SECRET=$(openssl rand -hex 32)
    cat > "$SECRET_FILE" << EOF
SESSION_SECRET=${SESSION_SECRET}
PORT=3000
TRUST_PROXY=true
DB_PATH=${APP_DIR}/server/data/mybridge.db
NODE_ENV=production
EOF
    chown "$APP_USER:$APP_GROUP" "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    log_ok "Secret de session généré."
}

# ==================== SYSTEMD SERVICE ====================
setup_systemd() {
    log_info "Configuration du service systemd..."

    cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=MyBridge - Jeu de Bridge en ligne
Documentation=https://github.com/cve-solutions/MyBridge
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${APP_DIR}/server/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/server/data
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false
RestrictRealtime=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    log_ok "Service systemd configuré."
}

# ==================== NGINX ====================
setup_nginx() {
    log_info "Configuration de NGINX..."

    # Generate DH params if not exists
    DH_DIR="/etc/nginx/ssl"
    mkdir -p "$DH_DIR"
    if [[ ! -f "$DH_DIR/dhparam.pem" ]]; then
        log_info "Génération des paramètres DH (peut prendre quelques minutes)..."
        openssl dhparam -out "$DH_DIR/dhparam.pem" 2048 2>/dev/null
        log_ok "Paramètres DH générés."
    fi

    # Create certbot webroot
    mkdir -p /var/www/certbot

    # Remove default nginx site
    rm -f /etc/nginx/sites-enabled/default

    # First, create a temporary HTTP-only config for certbot
    cat > "/etc/nginx/sites-available/${DOMAIN}" << 'TMPEOF'
server {
    listen 80;
    listen [::]:80;
    server_name bridge.buscaillet.fr;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        allow all;
    }

    location / {
        return 200 'MyBridge - En cours d installation...';
        add_header Content-Type text/plain;
    }
}
TMPEOF

    ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

    nginx -t
    systemctl restart nginx
    log_ok "NGINX configuré (HTTP temporaire)."
}

# ==================== LET'S ENCRYPT ====================
setup_ssl() {
    log_info "Configuration du certificat SSL Let's Encrypt..."

    # Ask for email if not set
    if [[ -z "$CERTBOT_EMAIL" ]]; then
        read -rp "Adresse email pour Let's Encrypt (notifications de renouvellement): " CERTBOT_EMAIL
    fi

    if [[ -z "$CERTBOT_EMAIL" ]]; then
        log_error "Email requis pour Let's Encrypt."
        exit 1
    fi

    # Check if certificate already exists
    if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
        log_ok "Certificat SSL existe déjà."
    else
        log_info "Demande du certificat SSL pour ${DOMAIN}..."
        certbot certonly \
            --webroot \
            --webroot-path /var/www/certbot \
            --domain "$DOMAIN" \
            --email "$CERTBOT_EMAIL" \
            --agree-tos \
            --non-interactive \
            --force-renewal
        log_ok "Certificat SSL obtenu."
    fi

    # Now install the full NGINX config with SSL
    log_info "Installation de la configuration NGINX complète..."
    cp "$APP_DIR/nginx/bridge.conf" "/etc/nginx/sites-available/${DOMAIN}"

    # Update the root path if APP_DIR differs from default
    if [[ "$APP_DIR" != "/opt/mybridge" ]]; then
        sed -i "s|root /opt/mybridge;|root ${APP_DIR};|" "/etc/nginx/sites-available/${DOMAIN}"
    fi

    nginx -t
    systemctl reload nginx
    log_ok "NGINX configuré avec SSL."

    # Setup auto-renewal
    log_info "Configuration du renouvellement automatique..."
    cat > /etc/cron.d/certbot-mybridge << EOF
# Renouvellement automatique du certificat Let's Encrypt
0 3 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
EOF
    log_ok "Renouvellement automatique configuré."
}

# ==================== FIREWALL ====================
setup_firewall() {
    log_info "Configuration du pare-feu UFW..."

    ufw --force reset > /dev/null 2>&1
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow ssh
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable

    log_ok "Pare-feu configuré (SSH, HTTP, HTTPS)."
}

# ==================== FAIL2BAN ====================
setup_fail2ban() {
    log_info "Configuration de Fail2Ban..."

    cat > /etc/fail2ban/jail.d/mybridge.conf << 'EOF'
[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
action = iptables-multiport[name=ReqLimit, port="http,https"]
logpath = /var/log/nginx/bridge.error.log
findtime = 600
bantime = 3600
maxretry = 10

[nginx-botsearch]
enabled = true
logpath = /var/log/nginx/bridge.access.log
maxretry = 5

[sshd]
enabled = true
maxretry = 5
bantime = 3600
EOF

    systemctl restart fail2ban
    log_ok "Fail2Ban configuré."
}

# ==================== LOGROTATE ====================
setup_logrotate() {
    log_info "Configuration de la rotation des logs..."

    cat > /etc/logrotate.d/mybridge << EOF
/var/log/nginx/bridge.*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 \$(cat /run/nginx.pid)
    endscript
}
EOF

    log_ok "Rotation des logs configurée."
}

# ==================== MAIN ====================
main() {
    echo ""
    echo -e "${BLUE}=========================================="
    echo "  ♠ MyBridge - Installation Complète ♥"
    echo -e "==========================================${NC}"
    echo ""

    check_root
    check_os

    # Check for --update flag
    if [[ "${1:-}" == "--update" ]]; then
        do_update
    fi

    log_info "Début de l'installation..."
    echo ""

    # Step 1: System
    install_system_deps
    install_nodejs
    create_app_user

    # Step 2: Application
    clone_application
    install_node_deps
    create_data_dir
    generate_session_secret

    # Step 3: Service
    setup_systemd

    # Step 4: Web server
    setup_nginx
    setup_ssl

    # Step 5: Security
    setup_firewall
    setup_fail2ban
    setup_logrotate

    # Step 6: Start
    log_info "Démarrage du service MyBridge..."
    systemctl start "$SERVICE_NAME"
    sleep 2

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_ok "Service MyBridge démarré avec succès."
    else
        log_error "Le service a échoué au démarrage. Vérifiez: journalctl -u $SERVICE_NAME"
    fi

    echo ""
    log_ok "=========================================="
    log_ok "  Installation terminée avec succès !"
    log_ok "=========================================="
    echo ""
    if [[ -f "$APP_DIR/version.json" ]]; then
        APP_VERSION=$(grep -oP '"version":\s*"\K[^"]+' "$APP_DIR/version.json")
        echo -e "  ${GREEN}Version:${NC}    v${APP_VERSION}"
    fi
    echo -e "  ${GREEN}URL:${NC}        https://${DOMAIN}"
    echo -e "  ${GREEN}Service:${NC}    systemctl status ${SERVICE_NAME}"
    echo -e "  ${GREEN}Logs:${NC}       journalctl -u ${SERVICE_NAME} -f"
    echo -e "  ${GREEN}NGINX:${NC}      /etc/nginx/sites-available/${DOMAIN}"
    echo -e "  ${GREEN}Data:${NC}       ${APP_DIR}/server/data/"
    echo -e "  ${GREEN}Backup:${NC}     /opt/mybridge-backups/"
    echo ""
    echo -e "  ${YELLOW}Mise à jour:${NC}  sudo bash ${APP_DIR}/setup.sh --update"
    echo ""
}

main "$@"
