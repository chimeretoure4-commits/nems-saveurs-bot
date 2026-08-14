# Nems Saveurs — Bot prototype

Prototype minimal pour la logique du bot WhatsApp.

Installation

```bash
npm install
```

Lancer le serveur (port 3000)

```bash
npm start
```

Administration / Assistante

L'interface assistante et les endpoints admin sont protégés par une authentification Basic HTTP.
Par défaut les identifiants sont `admin` / `changeme`. Définissez des variables d'environnement pour les changer :

```bash
export ADMIN_USER=nom
export ADMIN_PASS=motdepasse
```

Sur Windows PowerShell :

```powershell
$env:ADMIN_USER = "nom"
$env:ADMIN_PASS = "motdepasse"
```

Accès assistante : `GET /assistant` (le navigateur demandera les identifiants).

API admin JSON :
- `GET /admin/orders` — lister les commandes
- `POST /admin/orders/:id/delivery` — définir `deliveryFee` et `status`

WhatsApp

Numéro du bot WhatsApp : +221776886486


Tests

Installer les dépendances puis lancer les tests :

```bash
npm install
npm test
```

Déploiement (Docker)

Construire et lancer l'image :

```bash
docker build -t nems-saveurs-bot .
docker run -p 3000:3000 --env-file .env -d nems-saveurs-bot
```

Notes WhatsApp Business Platform

- Pour envoyer/recevoir des messages réels, configurez la WhatsApp Business Platform (Meta) et pointez le `Webhook` vers `https://<votre-host>/webhook`.
- Assurez-vous que `WHATSAPP_NUMBER` dans `.env` correspond au numéro enregistré.
- Ne pas laisser le bot répondre hors catalogue — la logique actuelle empêche les inventions et transfère aux humains quand nécessaire.



Webhook

POST `/webhook` JSON: `{ "from":"+229XXXXXXXX", "text":"Je veux 20 nems cuits" }`

Le serveur répondra avec un champ `reply` contenant le message à renvoyer au client.
