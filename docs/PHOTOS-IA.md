# Photos IA : mise en place sur le serveur

Nouvelle route : `POST /api/v1/photos/enhance` (compte connecté).
Corps : `{ "image": "<JPEG en base64>", "mode": "studio" | "mannequin_femme" | "mannequin_homme" }`.
Réponse : `{ "data": { "image": "<JPEG en base64>", "mode": "...", "generated_by_ai": true }, "credits": { ... } }`.

## Fichiers

Nouveaux :
- `app/Services/Photos/PhotoBrief.php` (consignes données au modèle d'image)
- `app/Services/Photos/EnhancePhoto.php` (réservation des crédits, appel, journal)
- `app/Services/OpenAI/OpenAIImageClient.php` (appel `POST /images/edits`)
- `app/Http/Requests/EnhancePhotoRequest.php`
- `app/Http/Controllers/Api/PhotoController.php`
- `tests/Feature/PhotoApiTest.php`

Modifiés :
- `routes/api.php` (route + limiteur `photos`)
- `app/Providers/AppServiceProvider.php` (limiteur `photos`)
- `app/Services/Credits/CreditLedger.php` (`reserve()` accepte l'opération et le montant retenu ; une demande à la fois par type d'opération ; `photo_cost` dans le résumé)
- `config/openai.php` (bloc `image`), `config/credits.php` (`photo_cost`, `photos_per_minute`, `photo_hold_micros`)
- `.env.example`

Aucune migration.

## Déploiement

1. Copier les fichiers, en gardant les chemins.
2. Ajouter dans `.env` les variables `OPENAI_IMAGE_*`, `CREDITS_PHOTO_COST`, `PHOTO_*` de `.env.example`.
3. `php artisan config:cache && php artisan route:cache`.
4. Vérifier : `php artisan route:list --path=photos`.

## À vérifier avant d'ouvrir aux clients

- La clé OpenAI du serveur a-t-elle accès au modèle d'image (`OPENAI_IMAGE_MODEL`) ? Certains comptes doivent d'abord valider leur organisation.
- Le temps d'exécution PHP autorisé par l'hébergeur : une image peut demander 30 à 60 secondes. Si l'hébergeur coupe avant, la demande échoue (aucun crédit n'est débité).
- Les tarifs : renseigner `OPENAI_IMAGE_INPUT_COST_PER_MILLION` et `OPENAI_IMAGE_OUTPUT_COST_PER_MILLION` d'après la page de prix d'OpenAI. Tant qu'ils valent 0, chaque image compte pour `OPENAI_IMAGE_FLAT_COST_USD` (0,10 $) dans les plafonds quotidiens.
- `LISTING_DAILY_USER_COST_USD` (1 $ par défaut) limite donc un compte à une dizaine d'images par jour : à ajuster selon l'offre.

## État des essais

- 71 tests PHPUnit passent (service d'images simulé).
- Essai complet extension + serveur local + faux service d'images répondant en 35 secondes : image reçue, ajoutée au formulaire, 5 crédits débités.
- Non testé : un appel réel à OpenAI, et l'hébergement de production.
