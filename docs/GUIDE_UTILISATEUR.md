# MyBridge - Guide d'utilisation

**Version : 0.1.x**

---

## Table des matières

1. [Présentation](#1-présentation)
2. [Accès et connexion](#2-accès-et-connexion)
3. [Écran des paramètres](#3-écran-des-paramètres)
4. [Déroulement d'une partie](#4-déroulement-dune-partie)
5. [Phase d'enchères](#5-phase-denchères)
6. [Phase de jeu de la carte](#6-phase-de-jeu-de-la-carte)
7. [Écran de score](#7-écran-de-score)
8. [Notation et calcul des scores](#8-notation-et-calcul-des-scores)
9. [Comportement de l'IA](#9-comportement-de-lia)
10. [Interface et navigation](#10-interface-et-navigation)
11. [Installation serveur](#11-installation-serveur)
12. [Référence rapide](#12-référence-rapide)

---

## 1. Présentation

MyBridge est un jeu de Bridge en ligne jouable dans un navigateur web. Vous jouez seul contre trois adversaires contrôlés par une intelligence artificielle. Le jeu respecte les règles officielles du Bridge de contrat :

- Jeu de 52 cartes, 4 joueurs (Nord, Est, Sud, Ouest)
- Paires : Nord-Sud contre Est-Ouest
- Phase d'enchères puis phase de jeu de la carte (13 levées)
- Scoring complet du Bridge duplicate ou rubber

### Notation des cartes

Les cartes sont affichées avec la notation française :

| Symbole | Signification |
|---------|--------------|
| A       | As           |
| R       | Roi          |
| D       | Dame         |
| V       | Valet        |
| 2 à 10  | Valeur nominale |
| ♠       | Pique (noir) |
| ♥       | Cœur (rouge) |
| ♦       | Carreau (rouge) |
| ♣       | Trèfle (noir) |

Les cartes sont triées dans votre main par couleur (Pique, Cœur, Carreau, Trèfle) puis par valeur décroissante.

---

## 2. Accès et connexion

### Page de connexion

Lorsque vous accédez à l'application, une page de connexion s'affiche avec deux onglets :

**Onglet « Connexion »**
- Saisissez votre nom d'utilisateur et votre mot de passe
- Cliquez sur **Se connecter**

**Onglet « Inscription »**
- **Nom d'utilisateur** : entre 3 et 30 caractères, uniquement lettres, chiffres, tirets (-) et underscores (_)
- **Nom d'affichage** : facultatif, nom visible en jeu (par défaut = nom d'utilisateur)
- **Mot de passe** : 6 caractères minimum
- **Confirmer le mot de passe** : doit être identique
- Cliquez sur **Créer mon compte**

Après connexion ou inscription réussie, vous êtes automatiquement redirigé vers l'écran des paramètres.

### Session

Votre session reste active 7 jours. Vous n'avez pas besoin de vous reconnecter à chaque visite. Vos paramètres de jeu sont sauvegardés automatiquement sur votre compte.

### Déconnexion

En cours de partie, cliquez sur le bouton **Quitter** (en rouge dans la barre d'information en haut) pour vous déconnecter et revenir à la page de connexion.

---

## 3. Écran des paramètres

Après connexion, vous arrivez sur l'écran de configuration. Vos choix sont sauvegardés automatiquement sur votre compte et restaurés à votre prochaine visite.

### 3.1 Choix de la place

Un diagramme représente la table de Bridge vue de dessus avec les quatre positions :

```
        Nord (N)
Ouest (O)  [table]  Est (E)
        Sud (S)
```

- Cliquez sur la position souhaitée pour la sélectionner
- La position sélectionnée est surlignée en rouge
- **Par défaut : Sud**
- Les trois autres positions sont jouées par l'IA

**Partenariat :** Nord et Sud jouent ensemble contre Est et Ouest.

### 3.2 Niveau de difficulté

Quatre niveaux sont disponibles :

| Niveau | Description |
|--------|-------------|
| **Débutant** | L'IA joue de manière approximative. Elle tend à jouer ses cartes basses (60% du temps) ou aléatoirement. Les enchères sont imprécises (bruit de -3 à +2 points). |
| **Intermédiaire** (défaut) | L'IA applique les principes fondamentaux : gagner au plus juste, jouer petit quand le partenaire gagne, entamer la 4e meilleure de la plus longue. Bruit d'enchères réduit (-2 à +1). |
| **Avancé** | L'IA applique les règles tactiques : 2e en bas, 3e en haut, surcoupe si possible, défausse intelligente. Bruit d'enchères minime (-1 à 0). |
| **Expert** | Aucune imprécision dans les enchères. Même logique de jeu qu'Avancé. |

### 3.3 Conventions d'enchères

Cinq systèmes d'enchères sont proposés :

| Convention | Description |
|-----------|-------------|
| **SEF** (défaut) | Standard Français - Majeure 5e, 1SA = 15-17 |
| **SAYC** | Standard American Yellow Card |
| **2/1 Game Forcing** | 2 sur 1 forcing de manche |
| **Acol** | Système britannique - Majeure 4e, 1SA faible |
| **Standard American** | Système standard américain |

> **Note :** Dans la version actuelle, l'IA utilise un système d'enchères unifié basé sur les principes communs (ouverture 12+ HCP, majeure 5e, 1SA 15-17, 2♣ fort). Le choix de convention est enregistré dans votre profil pour de futures améliorations.

### 3.4 Mode de score

| Mode | Description |
|------|-------------|
| **Duplicate** (défaut) | Scoring standard duplicate : prime de manche, primes de chelem, pénalités selon la vulnérabilité |
| **Rubber** | Rubber bridge (même calcul de score dans la version actuelle) |

### 3.5 Lancer la partie

Cliquez sur **Commencer la partie** pour démarrer. Vos paramètres sont sauvegardés à ce moment.

---

## 4. Déroulement d'une partie

Chaque partie se compose de **donnes** successives. Une donne suit toujours le même déroulement :

```
Distribution → Enchères → Jeu de la carte → Score
```

### 4.1 Distribution

- Les 52 cartes sont mélangées et distribuées : 13 cartes par joueur
- Vous voyez uniquement votre main (cartes face visible)
- Les mains des adversaires et du partenaire sont face cachée (dos bleu)

### 4.2 Donneur et vulnérabilité

Le donneur et la vulnérabilité suivent le cycle standard sur 16 donnes :

| Donne | Donneur | Vulnérabilité |
|-------|---------|---------------|
| 1     | Nord    | Personne      |
| 2     | Est     | Nord-Sud      |
| 3     | Sud     | Est-Ouest     |
| 4     | Ouest   | Tous          |
| 5-16  | (cycle) | (cycle standard) |

Ces informations sont affichées dans la **barre d'information** en haut de l'écran.

---

## 5. Phase d'enchères

### 5.1 Panneau d'enchères

Le panneau d'enchères s'affiche au centre de la table et contient :

**Historique des enchères** : Un tableau à 4 colonnes (Ouest, Nord, Est, Sud) affichant toutes les enchères passées. Le donneur commence, les cases avant lui sont marquées « - ».

**Contrôles d'enchères** (actifs uniquement quand c'est votre tour) :

1. **Paliers** (1 à 7) : Sélectionnez le niveau de l'enchère
2. **Couleurs** : ♣ ♦ ♥ ♠ SA - Sélectionnez la couleur
3. **Actions** :
   - **Passe** : Toujours disponible
   - **Contre** : Disponible uniquement après une enchère adverse (non encore contrée)
   - **Surcontre** : Disponible uniquement après un contre adverse sur votre enchère
   - **Enchérir** : Valide votre enchère (palier + couleur sélectionnés)

### 5.2 Comment enchérir

1. Attendez que le label de votre position clignote en rouge (indiquant votre tour)
2. **Pour faire une enchère** : Cliquez sur un palier (1-7), puis sur une couleur (♣♦♥♠ SA), puis sur **Enchérir**
3. **Pour passer** : Cliquez directement sur **Passe**
4. **Pour contrer** : Cliquez sur **Contre** (bouton actif uniquement si applicable)

### 5.3 Règles de validité

- Chaque enchère doit être supérieure à la précédente (palier plus élevé, ou même palier avec couleur supérieure)
- Ordre des couleurs : ♣ < ♦ < ♥ < ♠ < SA
- Les paliers déjà inférieurs à la dernière enchère sont grisés et non cliquables
- Si vous tentez une enchère invalide, le message « Enchère non valide ! » s'affiche

### 5.4 Fin des enchères

Les enchères se terminent quand :
- **3 passes consécutives** après au moins une enchère → Le contrat est déterminé
- **4 passes consécutives** au début → La donne est passée (aucun score, donne suivante)

### 5.5 Détermination du contrat

Le contrat est la dernière enchère validée. Le **déclarant** est le premier joueur de la paire gagnante à avoir nommé la couleur du contrat final. Son partenaire devient le **mort**.

Un message s'affiche : « Contrat: [niveau][couleur] par [position] »

---

## 6. Phase de jeu de la carte

### 6.1 Mise en place

- L'entame est faite par le joueur à gauche du déclarant
- Après l'entame, la main du mort est retournée (cartes visibles pour tous)
- Le déclarant joue ses propres cartes ET celles du mort

### 6.2 Affichage de la table

```
              Nord
               |
    Ouest -- [levée] -- Est
               |
              Sud
```

- **Votre main** : Cartes en bas (ou à la position choisie), face visible
- **Le mort** : Cartes face visible, avec le label en jaune
- **Adversaires** : Cartes face cachée
- **Zone de levée** : Au centre, affiche les 4 cartes jouées dans la levée en cours
- **Joueur actif** : Son label clignote en rouge

### 6.3 Jouer une carte

Quand c'est votre tour (ou le tour du mort si vous êtes déclarant) :

1. Les cartes jouables sont entourées d'un **bord jaune**
2. Survolez une carte jouable pour la faire monter
3. **Cliquez** sur la carte pour la jouer
4. La carte apparaît dans la zone de levée au centre

### 6.4 Obligation de fournir

- Vous **devez** jouer une carte de la couleur demandée si vous en possédez
- Seules les cartes de la couleur demandée sont jouables (bord jaune)
- Si vous n'avez pas la couleur, toutes vos cartes sont jouables (vous pouvez couper ou défausser)
- Si vous tentez de jouer une carte non autorisée : « Vous devez fournir ! »

### 6.5 Gain de la levée

Une fois 4 cartes jouées :
- La plus haute carte de la couleur d'entame gagne la levée
- Sauf si un atout a été joué : le plus haut atout gagne
- En Sans-Atout (SA) : pas de coupe possible, la plus haute carte de la couleur d'entame gagne
- Le gagnant de la levée entame la levée suivante
- Les compteurs de levées NS/EO sont mis à jour dans la barre d'information
- La levée disparaît après 1,2 seconde

### 6.6 Rythme de jeu

- L'IA joue avec un délai de **0,8 seconde** par action
- Les levées restent affichées **1,2 seconde** avant de disparaître

---

## 7. Écran de score

Après les 13 levées, l'écran de score s'affiche avec :

### 7.1 Informations affichées

| Ligne | Description |
|-------|-------------|
| **Contrat** | Niveau, couleur et déclarant (ex: 4♠ par Sud) |
| **Levées requises** | Niveau + 6 (ex: 4♠ → 10 levées requises) |
| **Levées réalisées** | Nombre de levées gagnées par le déclarant |
| **Résultat** | Différence : +N (surlevées) ou -N (chute) |
| **Détails du score** | Décomposition des points (voir section 8) |
| **Score Nord-Sud** | Score total de la donne pour NS |
| **Total cumulé NS** | Score cumulé sur toutes les donnes jouées |
| **Total cumulé EO** | Score cumulé sur toutes les donnes jouées |

### 7.2 Actions disponibles

- **Donne suivante** : Lance une nouvelle donne (le numéro de donne s'incrémente, le donneur et la vulnérabilité changent)
- **Retour aux paramètres** : Revient à l'écran de configuration (permet de changer de place, niveau, etc.)

---

## 8. Notation et calcul des scores

Le scoring suit les règles officielles du Bridge duplicate.

### 8.1 Contrat réussi

**Points de levées (trick score) :**

| Couleur | Points par levée contractée |
|---------|---------------------------|
| ♣ Trèfle | 20 par levée |
| ♦ Carreau | 20 par levée |
| ♥ Cœur | 30 par levée |
| ♠ Pique | 30 par levée |
| SA | 40 pour la 1re levée, 30 ensuite |

- Contré : points de levées x2
- Surcontré : points de levées x4

**Surlevées :**

| Condition | Points par surlevée |
|-----------|-------------------|
| Non contré, mineure | 20 |
| Non contré, majeure/SA | 30 |
| Contré, non vulnérable | 100 |
| Contré, vulnérable | 200 |
| Surcontré, non vulnérable | 200 |
| Surcontré, vulnérable | 400 |

**Prime de manche** (si points de levées >= 100) :

| Vulnérabilité | Prime |
|---------------|-------|
| Non vulnérable | 300 |
| Vulnérable | 500 |

**Prime partielle** (si points de levées < 100) : **50 points**

**Primes de chelem :**

| Chelem | Non vulnérable | Vulnérable |
|--------|---------------|------------|
| Petit chelem (6 niveau) | 500 | 750 |
| Grand chelem (7 niveau) | 1000 | 1500 |

**Primes d'insulte :**
- Contrat contré réussi : +50
- Contrat surcontré réussi : +100

### 8.2 Contrat chuté

**Pénalités (non contré) :**
- Non vulnérable : 50 par levée de chute
- Vulnérable : 100 par levée de chute

**Pénalités (contré, non vulnérable) :**
- 1re chute : 100
- 2e chute : 300 (total)
- 3e chute : 500 (total)
- Suivantes : +300 chacune

**Pénalités (contré, vulnérable) :**
- 1re chute : 200
- Suivantes : +300 chacune

**Pénalités (surcontré) :** Toutes les pénalités contrées sont doublées.

---

## 9. Comportement de l'IA

### 9.1 Enchères de l'IA

L'IA évalue sa main selon :
- **HCP** (High Card Points) : As=4, Roi=3, Dame=2, Valet=1
- **Points de distribution** : chicane=3, singleton=2, doubleton=1
- **Longueur des couleurs** et **main équilibrée** (toutes les couleurs >= 2 cartes)

Séquences d'enchères gérées :
- **Ouverture** : 1 en couleur (12+ HCP), 1SA (15-17 équilibré), 2♣ fort (20+), ouverture de barrage (2 faible avec 6 cartes, 6-10 HCP), 2SA (20-21 équilibré)
- **Réponses** : soutien du partenaire, changement de couleur, réponse en SA, Stayman sur 1SA, transferts, réponse au 2♣ fort
- **Redemandes** : contres d'appel (15+ HCP), essai de manche, SA compétitif, répétition de couleur

### 9.2 Jeu de la carte

**Entame :**
- Contre SA : 4e meilleure de la plus longue couleur
- Contre un contrat à la couleur : plus longue couleur hors atout, tête de séquence ou 4e meilleure

**En cours de jeu :**

| Niveau | Stratégie |
|--------|-----------|
| Débutant | Joue souvent la plus basse (60%) ou au hasard |
| Intermédiaire | Gagne au plus juste, joue petit si le partenaire gagne, coupe quand possible, défausse la couleur la plus faible |
| Avancé/Expert | 2e en bas, 3e en haut, surcoupe quand nécessaire, gagne au plus économique en dernière position |

---

## 10. Interface et navigation

### 10.1 Barre d'information

Située en haut de l'écran de jeu, elle affiche en permanence :

| Élément | Description |
|---------|-------------|
| Donneur | Position du donneur pour la donne en cours |
| Vulnérabilité | Personne / Nord-Sud / Est-Ouest / Tous |
| Contrat | Affiché après la fin des enchères (ex: 3SA par Nord contré) |
| Levées NS | Compteur de levées Nord-Sud |
| Levées EO | Compteur de levées Est-Ouest |
| ⚙ | Retour aux paramètres |
| Quitter | Déconnexion |

### 10.2 Labels des joueurs

- **« (Vous) »** : Indique votre position
- **« (IA) »** : Indique les positions contrôlées par l'ordinateur
- **Clignotement rouge** : Indique le joueur dont c'est le tour
- **Texte jaune** : Indique le mort pendant la phase de jeu

### 10.3 Cartes

- **Face visible** : Valeur et couleur affichées (rouge pour ♥♦, noir pour ♠♣)
- **Face cachée** : Dos bleu avec motif hachuré
- **Bord jaune** : Carte jouable (cliquez dessus)
- **Survol** : La carte monte pour indiquer qu'elle est sélectionnable

### 10.4 Badge de version

Le numéro de version de l'application est affiché discrètement en bas à droite de l'écran sur toutes les pages.

---

## 11. Installation serveur

### 11.1 Prérequis

- Serveur Debian ou Ubuntu
- Accès root (sudo)
- Nom de domaine pointant vers le serveur (bridge.buscaillet.fr)
- Port 80 et 443 ouverts

### 11.2 Installation

```bash
sudo bash setup.sh
```

Le script installe automatiquement :
- Node.js 20, NGINX, Certbot, SQLite, UFW, Fail2Ban
- Crée un utilisateur système dédié (`mybridge`)
- Clone le code source, installe les dépendances npm
- Obtient un certificat SSL Let's Encrypt
- Configure le pare-feu (SSH, HTTP, HTTPS uniquement)
- Démarre le service via systemd

### 11.3 Mise à jour

```bash
sudo bash /opt/mybridge/setup.sh --update
```

La mise à jour :
1. Arrête le service
2. Sauvegarde la base de données (dans `/opt/mybridge-backups/`)
3. Met à jour le code source depuis le dépôt Git
4. Met à jour les dépendances npm
5. Redémarre le service
6. Conserve les 10 dernières sauvegardes

### 11.4 Commandes utiles

| Commande | Description |
|----------|-------------|
| `systemctl status mybridge` | État du service |
| `journalctl -u mybridge -f` | Logs en temps réel |
| `systemctl restart mybridge` | Redémarrer le service |
| `sqlite3 /opt/mybridge/server/data/mybridge.db` | Accéder à la base de données |

---

## 12. Référence rapide

### Déroulement en un coup d'œil

```
Connexion → Paramètres → Enchères → Jeu (13 levées) → Score → Donne suivante
```

### Raccourcis de jeu

| Action | Comment |
|--------|---------|
| Enchérir | Palier → Couleur → Enchérir |
| Passer | Cliquer « Passe » |
| Contrer | Cliquer « Contre » |
| Jouer une carte | Cliquer sur une carte à bord jaune |
| Revenir aux paramètres | Cliquer ⚙ |
| Se déconnecter | Cliquer « Quitter » |

### Ordre des couleurs (enchères)

```
♣ < ♦ < ♥ < ♠ < SA
```

### Points d'honneurs (HCP)

```
As = 4 | Roi = 3 | Dame = 2 | Valet = 1
```
