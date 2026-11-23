# Annonce Futée — Version iPhone (Application iOS + Extension Safari autocomplétion)

Ce dossier regroupe tout le nécessaire pour l'écosystème **iPhone (iOS)** :

1. **Application native iPhone Flutter** : située dans `../mobile/ios/` (partage 100 % des écrans, du thème et du métier de `../mobile/lib/`).
   - Détourage automatique gratuit sur l'appareil via **Apple Vision** (`VNGenerateForegroundInstanceMaskRequest`, `../mobile/ios/Runner/FondBlancIos.swift`).
   - Partage sécurisé de l'annonce préparée vers Safari via **App Group** (`group.fr.annoncefutee.partage`).
2. **Extension Web Safari iPhone (`safari-extension/`)** : permet d'**autocompléter les champs sur `vinted.fr/items/new` directement dans Safari sur iPhone**, puisque iOS interdit à une application tierce d'écrire dans l'application native Vinted ou d'afficher un Post-it flottant par-dessus une autre app.

---

## Comment fonctionne l'autocomplétion sur iPhone

1. L'utilisateur prépare ses photos et son annonce dans l'app iPhone **Annonce Futée**.
2. À l'**Étape 4 · Terminer**, il appuie sur **« Ouvrir Vinted dans Safari (autocomplétion) »** :
   - Ses photos préparées s'enregistrent automatiquement dans la photothèque de l'iPhone.
   - Les champs de l'annonce sont transmis localement à l'extension Safari via l'App Group Apple.
   - Safari s'ouvre sur `https://www.vinted.fr/items/new`.
3. Sur la page Vinted dans Safari, un bandeau **Annonce Futée** s'affiche en bas de l'écran :
   - Un toucher sur **« Pré-remplir Titre, Description et Prix »** remplit instantanément les champs du formulaire Vinted.
   - Les pastilles (`Marque`, `État`, `Taille`, `Couleurs`, `Matière`, `Catégorie`) restent affichées juste au-dessus pour choisir les menus déroulants en quelques secondes.
   - **Conformité** : l'extension ne clique jamais sur *Publier* / *Ajouter* et ne stocke aucune clé d'IA.
4. *Mode direct dans Safari* : l'utilisateur peut aussi ouvrir l'extension depuis l'icône puzzle de Safari iPhone, se connecter et analyser directement les photos déjà déposées sur `vinted.fr/items/new`.

---

## Compilation sur un Mac (Xcode requis par Apple)

Apple impose macOS + Xcode + un compte Apple Developer pour compiler et signer un fichier `.ipa` iOS :

```bash
cd ../mobile
flutter pub get
flutter build ios --release
open ios/Runner.xcworkspace
```

Dans **Xcode** :
1. Sur la cible **`Runner`** → *Signing & Capabilities* : équipe Apple Developer + **App Groups** `group.fr.annoncefutee.partage` (`Runner.entitlements`).
2. La cible **`AnnonceFuteeSafari`** (`mobile/ios/AnnonceFuteeSafari/`, bundle ID `fr.annoncefutee.annonceFutee.SafariExtension`) est déjà embarquée dans `Runner.app/PlugIns` via *Embed App Extensions*. Même App Group (`SafariExtension.entitlements`). Les sources de référence restent aussi dans `iphone/safari-extension/`.
3. Sur l'iPhone : *Réglages → Apps → Safari → Extensions → Annonce Futée → Autoriser*.
