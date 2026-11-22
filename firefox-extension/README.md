# Annonce Futée — Extension Firefox (Android & PC)

Cette extension permet d'**autocompléter sans copier-coller** le formulaire de vente Vinted (`Titre`, `Description`, `Prix`) directement dans **Firefox sur Android** (et sur Firefox PC), en lien direct avec l'application Android **Annonce Futée**.

*(Notice : j'ai inclus `"gecko_android"` et construit le bandeau DOM sans `innerHTML` afin de passer la validation automatique de sécurité Mozilla AMO du premier coup).*

---

## Comment ça fonctionne avec l'application Android

1. L'utilisateur prépare ses photos et son annonce dans l'application Android **Annonce Futée**.
2. À l'**Étape 4 · Terminer**, il appuie sur **« Ouvrir dans Firefox (autocomplétion) »** :
   - Les photos préparées s'enregistrent automatiquement dans l'album `Annonce Futée` de sa galerie.
   - Firefox Android s'ouvre directement sur `vinted.fr/items/new` avec l'annonce transmise.
   - `capture.js` (`document_start`) intercepte l'annonce instantanément et nettoie l'URL.
   - Dès que les champs Vinted apparaissent, `content.js` **autocomplète tout seul `Titre`, `Description` et `Prix`** et affiche en bas de l'écran les pastilles `Marque`, `État`, `Taille`, `Couleurs`, `Matière`, `Catégorie` pour choisir les menus déroulants en quelques secondes.
   - **Règle absolue respectée** : l'extension ne clique jamais sur *Publier* ou *Ajouter* et ne contient aucune clé d'IA.

---

## Publier gratuitement sur Mozilla Add-ons (pour tous les téléphones Android)

1. Crée un compte développeur gratuit sur **https://addons.mozilla.org/fr/developers/**.
2. Clique sur **« Soumettre un nouveau module »** → *Sur ce site (listé)* ou *Auto-hébergé (non listé, signé immédiatement pour tes testeurs)*.
3. Dépose le fichier **`Annonce-Futee-Firefox.zip`** (déjà généré dans `Downloads/`) et coche **Firefox pour Android** + **Firefox**.
4. Une fois validé/signé par Mozilla, n'importe quel utilisateur Android l'installe en 1 clic depuis Firefox Android.

### Tester immédiatement sur PC ou Android (sans attendre Mozilla)
- **Sur Firefox PC** : ouvre `about:debugging#/runtime/this-firefox` → *Charger un module complémentaire temporaire…* → sélectionne `firefox-extension/manifest.json`.
- **Sur Android (sans signature)** : installe **Firefox Nightly** ou **Iceraven** depuis le Play Store → *Paramètres → À propos → touche 5 fois le logo Firefox* pour activer le mode développeur → installe depuis le fichier `.zip`.
