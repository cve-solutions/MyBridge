// ==================== LOGIN / REGISTER ====================

function showTab(tab) {
    document.getElementById('error-msg').classList.remove('visible');
    document.getElementById('success-msg').classList.remove('visible');

    if (tab === 'login') {
        document.getElementById('tab-login').classList.add('active');
        document.getElementById('tab-register').classList.remove('active');
        document.getElementById('form-login').classList.remove('hidden');
        document.getElementById('form-register').classList.add('hidden');
    } else {
        document.getElementById('tab-register').classList.add('active');
        document.getElementById('tab-login').classList.remove('active');
        document.getElementById('form-register').classList.remove('hidden');
        document.getElementById('form-login').classList.add('hidden');
    }
}

function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.add('visible');
    document.getElementById('success-msg').classList.remove('visible');
}

function showSuccess(msg) {
    var el = document.getElementById('success-msg');
    el.textContent = msg;
    el.classList.add('visible');
    document.getElementById('error-msg').classList.remove('visible');
}

async function handleLogin(e) {
    e.preventDefault();
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var btn = document.getElementById('login-btn');

    btn.disabled = true;
    btn.textContent = 'Connexion...';

    try {
        var res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });

        var data = await res.json();

        if (res.ok) {
            showSuccess('Connexion réussie ! Redirection...');
            setTimeout(function() { window.location.href = '/'; }, 500);
        } else {
            showError(data.error || 'Erreur de connexion.');
        }
    } catch (err) {
        showError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Se connecter';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    var username = document.getElementById('reg-username').value.trim();
    var displayName = document.getElementById('reg-display').value.trim();
    var email = document.getElementById('reg-email').value.trim();
    var password = document.getElementById('reg-password').value;
    var password2 = document.getElementById('reg-password2').value;
    var btn = document.getElementById('register-btn');

    if (password !== password2) {
        showError('Les mots de passe ne correspondent pas.');
        return;
    }

    if (displayName && displayName.length < 2) {
        showError('Le nom d\'affichage doit faire au moins 2 caractères.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Création...';

    try {
        var res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password, displayName: displayName, email: email })
        });

        var data = await res.json();

        if (res.ok) {
            showSuccess('Compte créé ! Redirection...');
            setTimeout(function() { window.location.href = '/'; }, 500);
        } else {
            showError(data.error || "Erreur lors de l'inscription.");
        }
    } catch (err) {
        showError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Créer mon compte';
    }
}

// Bind event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('tab-login').addEventListener('click', function() { showTab('login'); });
    document.getElementById('tab-register').addEventListener('click', function() { showTab('register'); });
    document.getElementById('form-login').addEventListener('submit', handleLogin);
    document.getElementById('form-register').addEventListener('submit', handleRegister);
});
