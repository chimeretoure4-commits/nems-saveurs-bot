Guide de déploiement — Nems Saveurs Bot
=====================================

1) Variables d'environnement
- Copier `.env.example` puis remplir les valeurs réelles:
  - `ADMIN_USER` et `ADMIN_PASS` — identifiants admin basiques (prototype).
  - `WHATSAPP_NUMBER` — numéro WhatsApp Business (format +NNN...).
  - Pour production, stocker ces valeurs dans un secret manager.

2) Tests locaux
- Installer les dépendances et lancer les tests:

```powershell
npm cache verify
rm -r -fo node_modules
Remove-Item -Force package-lock.json
npm install
npm test
```

3) Construire l'image Docker (si Docker installé)

```powershell
docker build -t <registry>/nems-saveurs-bot:latest .
# Exemple local sans push
docker build -t nems-saveurs-bot:local .
```

4) Pousser sur un registry
- Exemple Docker Hub (connectez-vous d'abord):

```powershell
docker login
docker tag nems-saveurs-bot:local <your-hub-user>/nems-saveurs-bot:latest
docker push <your-hub-user>/nems-saveurs-bot:latest
```

5) Déployer et config webhook WhatsApp
- Déployer le conteneur sur votre plateforme (Heroku, Azure, VPS, etc.).
- Exposer `PORT` 3000 et configurer l'URL publique HTTPS.
- Sur la console Facebook/WhatsApp Business, configurer le webhook:
  - URL de callback: `https://<votre-domaine>/webhook`
  - Verify token: valeur au choix (ajouter dans `.env` si nécessaire).
  - Événements: messages entrants et statut de message.

6) Notes de sécurité et production
- Remplacer l'auth Basic Admin par un système d'authentification plus sûr.
- Remplacer le stockage fichier (`data/orders.json`) par une base de données.
- Logger et surveiller via un APM (Application Insights, Sentry, etc.).

7) Aide et dépannage
- Pour obtenir un **QR WhatsApp** (authentifier une session via WhatsApp Web) :
  - Installer les dépendances :

```powershell
npm install
```

  - Lancer le connecteur local (génère `data/wa-qr.png` à scanner) :

```powershell
node src/wa-connector.js
```

  - Scanner `data/wa-qr.png` avec l'app WhatsApp (Menu > Appareils liés > Lier un appareil).
  - Les informations d'authentification seront enregistrées dans le dossier `auth_info/` pour réutilisation.

Remarque : cette méthode utilise la bibliothèque non-officielle `@adiwajshing/baileys`. Pour une intégration officielle en production, utilisez l'API Cloud WhatsApp de Meta (tokens, webhooks) et suivez la documentation officielle.

- Si `npm test` échoue localement: supprimer `node_modules`, nettoyer le cache, relancer `npm install`.
- Si Docker absent: installer Docker Desktop (Windows) puis relancer les commandes ci-dessus.
