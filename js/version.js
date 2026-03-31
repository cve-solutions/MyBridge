// Load and display version badge
fetch('/version.json')
    .then(function(r) { return r.json(); })
    .then(function(d) {
        var el = document.getElementById('version-badge');
        if (el) el.textContent = 'v' + d.version;
    })
    .catch(function() {});
