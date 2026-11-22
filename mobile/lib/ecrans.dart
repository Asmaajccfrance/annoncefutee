import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:gal/gal.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import 'firefox_android.dart';
import 'metier/modeles.dart';
import 'metier/selection_photos.dart';
import 'metier/session_annonce.dart';
import 'post_it.dart';
import 'safari_ios.dart';
import 'theme/composants.dart';
import 'theme/tokens.dart';

class PorteeSession extends InheritedNotifier<SessionAnnonce> {
  const PorteeSession({
    required SessionAnnonce session,
    required super.child,
    super.key,
  }) : super(notifier: session);

  static SessionAnnonce of(BuildContext context) {
    final session = context
        .dependOnInheritedWidgetOfExactType<PorteeSession>()
        ?.notifier;
    if (session == null) {
      throw StateError('Session introuvable.');
    }
    return session;
  }
}

class Racine extends StatelessWidget {
  const Racine({super.key});

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    if (!session.connecte) return const EcranConnexion();
    final Widget ecran;
    switch (session.etape) {
      case 'preparation':
        ecran = const EcranPreparation();
      case 'annonce':
        ecran = const EcranAnnonce();
      case 'fin':
        ecran = const EcranFin();
      default:
        return const EcranPhotos();
    }
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) session.retourEtape();
      },
      child: ecran,
    );
  }
}

void _ouvrirCompte(BuildContext context) {
  Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => const EcranCompte()),
  );
}

void _ouvrirAnnonces(BuildContext context) {
  Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => const EcranAnnoncesEnregistrees()),
  );
}

void _ouvrirInscription(BuildContext context) {
  Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => const EcranInscription()),
  );
}

/// Le clavier notifie le champ après sa sortie de l'arbre. On ne libère
/// le contrôleur tout de suite que s'il n'a plus d'écouteur.
class _ControleurSaisie extends TextEditingController {
  _ControleurSaisie({super.text});

  void relacher() {
    if (!hasListeners) {
      dispose();
      return;
    }
    Future<void>.delayed(Duration.zero, dispose);
  }
}

String _messageCopie(String cle) {
  switch (cle) {
    case 'titre':
      return 'Titre copié.';
    case 'prix':
      return 'Prix copié.';
    case 'description':
      return 'Description copiée.';
    default:
      return 'Copié.';
  }
}

class EcranConnexion extends StatefulWidget {
  const EcranConnexion({super.key});

  @override
  State<EcranConnexion> createState() => _EcranConnexionState();
}

class _EcranConnexionState extends State<EcranConnexion> {
  final _email = _ControleurSaisie();
  final _motDePasse = _ControleurSaisie();
  final _focusEmail = FocusNode();
  final _focusMotDePasse = FocusNode();
  var _enCours = false;
  var _masquerMotDePasse = true;
  var _erreur = '';

  @override
  void deactivate() {
    if (_focusEmail.hasFocus) _focusEmail.unfocus();
    if (_focusMotDePasse.hasFocus) _focusMotDePasse.unfocus();
    super.deactivate();
  }

  @override
  void dispose() {
    _focusEmail.dispose();
    _focusMotDePasse.dispose();
    _email.relacher();
    _motDePasse.relacher();
    super.dispose();
  }

  Future<void> _entrer() async {
    setState(() {
      _enCours = true;
      _erreur = '';
    });
    try {
      await PorteeSession.of(context).connecter(_email.text, _motDePasse.text);
      TextInput.finishAutofillContext();
    } catch (e) {
      if (mounted) setState(() => _erreur = e.toString());
    } finally {
      if (mounted) setState(() => _enCours = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return EcranCadre(
      message: _erreur,
      ton: _erreur.isEmpty ? TonMessage.aucun : TonMessage.erreur,
      corps: LayoutBuilder(
        builder: (context, contraintes) {
          final libre = contraintes.maxHeight.isFinite
              ? (contraintes.maxHeight - 96).clamp(0.0, double.infinity)
              : 0.0;
          return SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 88),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: libre),
              child: AutofillGroup(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Image.asset(
                      'assets/marque/logo.jpg',
                      height: 120,
                      semanticLabel: 'Annonce Futée',
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Des annonces plus malignes.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 24),
                    TextField(
                      controller: _email,
                      focusNode: _focusEmail,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.email],
                      autocorrect: false,
                      decoration: const InputDecoration(labelText: 'E-mail'),
                      onSubmitted: (_) => _focusMotDePasse.requestFocus(),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _motDePasse,
                      focusNode: _focusMotDePasse,
                      obscureText: _masquerMotDePasse,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: 'Mot de passe',
                        suffixIcon: IconButton(
                          tooltip: _masquerMotDePasse
                              ? 'Afficher le mot de passe'
                              : 'Masquer le mot de passe',
                          onPressed: () => setState(
                            () => _masquerMotDePasse = !_masquerMotDePasse,
                          ),
                          icon: Icon(
                            _masquerMotDePasse
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                            color: Couleurs.encreDouce,
                          ),
                        ),
                      ),
                      onSubmitted: (_) => _enCours ? null : _entrer(),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _enCours ? null : _entrer,
                      child: Text(_enCours ? 'Connexion…' : 'Se connecter'),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: _enCours
                          ? null
                          : () => _ouvrirInscription(context),
                      child: const Text('Créer un compte · Offre découverte'),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      mentionIndependante,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class EcranInscription extends StatefulWidget {
  const EcranInscription({super.key});

  @override
  State<EcranInscription> createState() => _EcranInscriptionState();
}

class _EcranInscriptionState extends State<EcranInscription> {
  final _nom = _ControleurSaisie();
  final _email = _ControleurSaisie();
  final _motDePasse = _ControleurSaisie();
  final _confirmation = _ControleurSaisie();
  final _focusNom = FocusNode();
  final _focusEmail = FocusNode();
  final _focusMotDePasse = FocusNode();
  final _focusConfirmation = FocusNode();
  var _masquer = true;
  var _enCours = false;
  var _chargeInitiale = false;
  var _message = '';
  var _ton = TonMessage.aucun;
  Timer? _minuteur;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_chargeInitiale) {
      _chargeInitiale = true;
      unawaited(PorteeSession.of(context).chargerForfaits());
    }
  }

  @override
  void deactivate() {
    if (_focusNom.hasFocus) _focusNom.unfocus();
    if (_focusEmail.hasFocus) _focusEmail.unfocus();
    if (_focusMotDePasse.hasFocus) _focusMotDePasse.unfocus();
    if (_focusConfirmation.hasFocus) _focusConfirmation.unfocus();
    super.deactivate();
  }

  @override
  void dispose() {
    _minuteur?.cancel();
    _focusNom.dispose();
    _focusEmail.dispose();
    _focusMotDePasse.dispose();
    _focusConfirmation.dispose();
    _nom.relacher();
    _email.relacher();
    _motDePasse.relacher();
    _confirmation.relacher();
    super.dispose();
  }

  void _afficherInfo(String texte, TonMessage ton) {
    _minuteur?.cancel();
    setState(() {
      _message = texte;
      _ton = ton;
    });
    if (ton == TonMessage.succes) {
      _minuteur = Timer(const Duration(milliseconds: 2800), () {
        if (mounted) {
          setState(() {
            _message = '';
            _ton = TonMessage.aucun;
          });
        }
      });
    }
  }

  Future<void> _creerCompte() async {
    if (_nom.text.trim().isEmpty ||
        _email.text.trim().isEmpty ||
        _motDePasse.text.isEmpty) {
      _afficherInfo('Remplis tous les champs.', TonMessage.erreur);
      return;
    }
    if (_motDePasse.text != _confirmation.text) {
      _afficherInfo(
        'La confirmation du mot de passe ne correspond pas.',
        TonMessage.erreur,
      );
      return;
    }
    if (_motDePasse.text.length < 10) {
      _afficherInfo(
        'Le mot de passe doit contenir au moins 10 caractères (lettres et chiffres).',
        TonMessage.erreur,
      );
      return;
    }
    setState(() {
      _enCours = true;
      _message = '';
      _ton = TonMessage.aucun;
    });
    try {
      await PorteeSession.of(context).inscrire(
        nom: _nom.text,
        email: _email.text,
        motDePasse: _motDePasse.text,
        confirmation: _confirmation.text,
      );
      TextInput.finishAutofillContext();
      if (mounted) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _enCours = false;
          _message = e.toString();
          _ton = TonMessage.erreur;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    final catalogue = session.catalogueForfaits;
    return EcranCadre(
      message: _message,
      ton: _ton,
      corps: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
        children: [
          Text('Créer un compte', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          Text(
            'Démarre gratuitement avec l\'offre Découverte. Les forfaits supérieurs ouvriront prochainement.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 14),
          _GrilleForfaits(
            forfaits: catalogue.forfaits,
            slugSelectionne: 'free',
            onToucherInactif: (forfait) => _afficherInfo(
              'Le forfait ${forfait.nom} (${forfait.prixAffiche}) n\'est pas encore actif : profite de l\'offre Découverte gratuite.',
              TonMessage.succes,
            ),
          ),
          const SizedBox(height: 18),
          if (!catalogue.inscriptionsOuvertes)
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              margin: const EdgeInsets.only(bottom: 14),
              decoration: BoxDecoration(
                color: Couleurs.attentionFond,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'Accès anticipé : l\'ouverture publique des inscriptions arrive très bientôt. Si tu disposes déjà d\'un compte, connecte-toi.',
                style: TextStyle(
                  color: Couleurs.attention,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ),
          AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  key: const ValueKey('inscription-nom'),
                  controller: _nom,
                  focusNode: _focusNom,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  decoration: const InputDecoration(
                    labelText: 'Prénom ou pseudo',
                  ),
                  onSubmitted: (_) => _focusEmail.requestFocus(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('inscription-email'),
                  controller: _email,
                  focusNode: _focusEmail,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'E-mail'),
                  onSubmitted: (_) => _focusMotDePasse.requestFocus(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('inscription-mdp'),
                  controller: _motDePasse,
                  focusNode: _focusMotDePasse,
                  obscureText: _masquer,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.newPassword],
                  decoration: InputDecoration(
                    labelText: 'Mot de passe',
                    hintText: '10 caractères min., lettres et chiffres',
                    suffixIcon: IconButton(
                      tooltip: _masquer ? 'Afficher' : 'Masquer',
                      onPressed: () => setState(() => _masquer = !_masquer),
                      icon: Icon(
                        _masquer
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                        color: Couleurs.encreDouce,
                      ),
                    ),
                  ),
                  onSubmitted: (_) => _focusConfirmation.requestFocus(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('inscription-confirmation'),
                  controller: _confirmation,
                  focusNode: _focusConfirmation,
                  obscureText: _masquer,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _enCours ? null : _creerCompte(),
                  decoration: const InputDecoration(
                    labelText: 'Confirmer le mot de passe',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _enCours || !catalogue.inscriptionsOuvertes
                ? null
                : _creerCompte,
            child: Text(
              _enCours
                  ? 'Création du compte…'
                  : (catalogue.inscriptionsOuvertes
                        ? 'Commencer gratuitement'
                        : 'Inscriptions bientôt ouvertes'),
            ),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: _enCours ? null : () => Navigator.of(context).pop(),
            child: const Text('J\'ai déjà un compte · Se connecter'),
          ),
          const SizedBox(height: 16),
          Text(
            mentionIndependante,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _GrilleForfaits extends StatelessWidget {
  const _GrilleForfaits({
    required this.forfaits,
    required this.slugSelectionne,
    this.onToucherInactif,
  });

  final List<ForfaitOffre> forfaits;
  final String slugSelectionne;
  final void Function(ForfaitOffre forfait)? onToucherInactif;

  @override
  Widget build(BuildContext context) {
    final lignes = <Widget>[];
    for (var i = 0; i < forfaits.length; i += 2) {
      final gauche = forfaits[i];
      final droite = i + 1 < forfaits.length ? forfaits[i + 1] : null;
      if (lignes.isNotEmpty) lignes.add(const SizedBox(height: 8));
      lignes.add(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _CarteForfait(
                forfait: gauche,
                estSelectionne: gauche.slug == slugSelectionne,
                onToucherInactif: onToucherInactif,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: droite == null
                  ? const SizedBox.shrink()
                  : _CarteForfait(
                      forfait: droite,
                      estSelectionne: droite.slug == slugSelectionne,
                      onToucherInactif: onToucherInactif,
                    ),
            ),
          ],
        ),
      );
    }
    return Column(children: lignes);
  }
}

class _CarteForfait extends StatelessWidget {
  const _CarteForfait({
    required this.forfait,
    required this.estSelectionne,
    this.onToucherInactif,
  });

  final ForfaitOffre forfait;
  final bool estSelectionne;
  final void Function(ForfaitOffre forfait)? onToucherInactif;

  @override
  Widget build(BuildContext context) {
    final actif = forfait.actif;
    final bordure = estSelectionne && actif ? Couleurs.violet : Couleurs.trait;
    final fond = estSelectionne && actif ? Couleurs.lavande : Couleurs.fondDoux;
    return Opacity(
      opacity: actif ? 1.0 : 0.68,
      child: Material(
        color: fond,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: !actif && onToucherInactif != null
              ? () => onToucherInactif!(forfait)
              : null,
          child: Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: bordure,
                width: estSelectionne && actif ? 1.8 : 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        forfait.nom,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: policeTitre,
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                          color: Couleurs.encre,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: actif ? Couleurs.violet : Couleurs.blanc,
                        borderRadius: BorderRadius.circular(999),
                        border: actif
                            ? null
                            : Border.all(color: Couleurs.trait),
                      ),
                      child: Text(
                        actif ? 'Offre découverte' : 'Bientôt',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: actif
                              ? Couleurs.blanc
                              : Couleurs.encreDouce,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  forfait.prixAffiche,
                  style: TextStyle(
                    fontFamily: policeTitre,
                    fontWeight: FontWeight.w700,
                    fontSize: 17,
                    color: actif ? Couleurs.violet : Couleurs.encre,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  forfait.detailCredits,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Couleurs.encreDouce,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class EcranPhotos extends StatefulWidget {
  const EcranPhotos({super.key});

  @override
  State<EcranPhotos> createState() => _EcranPhotosState();
}

class _EcranPhotosState extends State<EcranPhotos> {
  final _precisions = _ControleurSaisie();
  final _focusPrecisions = FocusNode();

  @override
  void deactivate() {
    if (_focusPrecisions.hasFocus) _focusPrecisions.unfocus();
    super.deactivate();
  }

  @override
  void dispose() {
    _focusPrecisions.dispose();
    _precisions.relacher();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    if (!_focusPrecisions.hasFocus && _precisions.text != session.precisions) {
      _precisions.text = session.precisions;
    }
    final choisies = session.photos.where((p) => p.pourAnalyse).toList();
    return EcranCadre(
      onCompte: () => _ouvrirCompte(context),
      onAnnonces: () => _ouvrirAnnonces(context),
      nombreAnnonces: session.annoncesEnregistrees.length,
      badgeCredits: session.credits.badgeCourt,
      message: session.message,
      ton: session.message.isEmpty ? TonMessage.aucun : TonMessage.erreur,
      corps: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
        children: [
          Text(
            'Étape 1 · Nouvelle annonce',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 6),
          Text(
            '${session.photos.length} / ${SelectionPhotos.maxPhotos} photos · ${choisies.length} pour l\'analyse',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 4),
          Text(
            'Les cinq premières sont retenues. Touche une photo pour changer.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (session.annoncesEnregistrees.isNotEmpty) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => _ouvrirAnnonces(context),
              icon: const Icon(Icons.bookmarks_outlined, size: 18),
              label: Text(
                session.annoncesEnregistrees.length == 1
                    ? '1 annonce enregistrée'
                    : '${session.annoncesEnregistrees.length} annonces enregistrées',
              ),
            ),
          ],
          const SizedBox(height: 12),
          if (session.photos.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
              decoration: BoxDecoration(
                color: Couleurs.fondDoux,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Couleurs.trait),
              ),
              child: Column(
                children: [
                  const Icon(
                    Icons.add_photo_alternate_outlined,
                    size: 32,
                    color: Couleurs.violet,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Prends ou choisis les photos de ton article pour rédiger l\'annonce.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final photo in session.photos)
                  _Vignette(
                    photo: photo,
                    rangAnalyse: photo.pourAnalyse
                        ? choisies.indexOf(photo) + 1
                        : null,
                    session: session,
                  ),
              ],
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _prendre(context, ImageSource.camera),
                  icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  label: const Text('Appareil'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _prendre(context, ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined, size: 18),
                  label: const Text('Galerie'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _precisions,
            focusNode: _focusPrecisions,
            minLines: 1,
            maxLines: 3,
            maxLength: 300,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              labelText: 'Précisions sur l\'article (facultatif)',
              hintText: 'Taille coupée, défaut à signaler, dimensions…',
              counterText: '',
            ),
            onChanged: session.noterPrecisions,
          ),
          const SizedBox(height: 12),
          _BarreStyleRedaction(session: session),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: session.peutContinuer ? session.continuer : null,
            child: Text(session.libelleContinuer),
          ),
          if (session.photos.isNotEmpty || session.champs != null) ...[
            const SizedBox(height: 4),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: Couleurs.erreur),
              onPressed: () => _supprimerCourante(context),
              child: const Text('Supprimer l\'annonce'),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _prendre(BuildContext context, ImageSource source) async {
    final session = PorteeSession.of(context);
    final reste = SelectionPhotos.maxPhotos - session.photos.length;
    if (reste <= 0) {
      await session.ajouterPhoto(Uint8List(0));
      return;
    }
    final selecteur = ImagePicker();
    final fichiers = <XFile>[];
    if (source == ImageSource.camera) {
      final photo = await selecteur.pickImage(source: source);
      if (photo != null) fichiers.add(photo);
    } else {
      fichiers.addAll(await selecteur.pickMultiImage(limit: reste));
    }
    for (final fichier in fichiers.take(reste)) {
      await session.ajouterPhoto(await fichier.readAsBytes());
    }
  }
}

class _BarreStyleRedaction extends StatelessWidget {
  const _BarreStyleRedaction({required this.session});

  final SessionAnnonce session;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text('Description :', style: Theme.of(context).textTheme.bodySmall),
        for (final choix in StylesAnnonce.choix)
          _PuceOption(
            libelle: choix.$2,
            actif: session.style == choix.$1,
            onTap: () => session.choisirStyle(choix.$1),
          ),
        _PuceOption(
          libelle: '# Hashtags',
          actif: session.hashtags,
          onTap: () => session.basculerHashtags(!session.hashtags),
        ),
      ],
    );
  }
}

class _PuceOption extends StatelessWidget {
  const _PuceOption({
    required this.libelle,
    required this.actif,
    required this.onTap,
  });

  final String libelle;
  final bool actif;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: actif ? Couleurs.lavande : Couleurs.fondDoux,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: actif ? Couleurs.violet : Couleurs.trait,
          ),
        ),
        child: Text(
          libelle,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: actif ? FontWeight.w700 : FontWeight.w500,
            color: actif ? Couleurs.violet : Couleurs.encreDouce,
          ),
        ),
      ),
    );
  }
}

class _Vignette extends StatelessWidget {
  const _Vignette({
    required this.photo,
    required this.rangAnalyse,
    required this.session,
  });

  final PhotoAnnonce photo;
  final int? rangAnalyse;
  final SessionAnnonce session;

  @override
  Widget build(BuildContext context) {
    final rang = rangAnalyse;
    return SizedBox(
      width: 104,
      child: Column(
        children: [
          GestureDetector(
            onTap: () => session.basculer(photo.id),
            child: Stack(
              children: [
                Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: photo.pourAnalyse
                          ? Couleurs.violet
                          : Couleurs.trait,
                      width: photo.pourAnalyse ? 2 : 1,
                    ),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.file(
                      File(photo.cheminOriginal),
                      width: 100,
                      height: 100,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                Positioned(
                  top: 6,
                  right: 6,
                  child: Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: photo.pourAnalyse
                          ? Couleurs.violet
                          : Couleurs.blanc.withValues(alpha: 0.9),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: photo.pourAnalyse
                            ? Couleurs.violet
                            : Couleurs.encreDouce,
                      ),
                    ),
                    child: rang != null
                        ? Text(
                            '$rang',
                            style: const TextStyle(
                              color: Couleurs.blanc,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          )
                        : const SizedBox.shrink(),
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            style: TextButton.styleFrom(
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            ),
            onPressed: () => session.retirerPhoto(photo.id),
            child: const Text('Retirer', style: TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

class EcranPreparation extends StatelessWidget {
  const EcranPreparation({super.key});

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    return EcranCadre(
      onRetour: session.retourEtape,
      onCompte: () => _ouvrirCompte(context),
      onAnnonces: () => _ouvrirAnnonces(context),
      nombreAnnonces: session.annoncesEnregistrees.length,
      badgeCredits: session.credits.badgeCourt,
      corps: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              children: [
                Text(
                  'Étape 2 · Préparation',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 6),
                Text(
                  session.analyseEnVol
                      ? 'Analyse du texte en cours… Tu peux préparer tes photos en parallèle.'
                      : (session.champs != null
                            ? 'L\'annonce est prête. Ajuste tes photos ou passe à la suite.'
                            : 'Prépare tes photos, puis ouvre l\'annonce.'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                for (var i = 0; i < session.photos.length; i++) ...[
                  _CartePhoto(
                    key: ValueKey(session.photos[i].id),
                    photo: session.photos[i],
                    estPremiere: i == 0,
                  ),
                  const SizedBox(height: 14),
                ],
                if (session.selectionDifferente) ...[
                  Text(
                    'Le choix de photos a changé : l\'analyse n\'est pas relancée seule.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: session.analyseEnVol
                        ? null
                        : session.relancerAnalyse,
                    child: Text(session.libelleRelancer),
                  ),
                  const SizedBox(height: 8),
                ],
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
            decoration: const BoxDecoration(
              color: Couleurs.blanc,
              border: Border(top: BorderSide(color: Couleurs.trait)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FilledButton(
                  onPressed: () => session.aller('annonce'),
                  child: const Text('Voir l\'annonce'),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    TextButton(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                      ),
                      onPressed: () => _nouvelle(context),
                      child: const Text('Nouvelle annonce'),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        foregroundColor: Couleurs.erreur,
                      ),
                      onPressed: () => _supprimerCourante(context),
                      child: const Text('Supprimer'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CartePhoto extends StatefulWidget {
  const _CartePhoto({
    required this.photo,
    required this.estPremiere,
    super.key,
  });

  final PhotoAnnonce photo;
  final bool estPremiere;

  @override
  State<_CartePhoto> createState() => _CartePhotoState();
}

class _CartePhotoState extends State<_CartePhoto>
    with AutomaticKeepAliveClientMixin {
  late final _ControleurSaisie _consigne = _ControleurSaisie(
    text: widget.photo.consigne,
  );
  final _focusConsigne = FocusNode();
  var _voirOriginale = false;
  var _autresPoses = false;
  var _aDuTexte = false;
  var _versionConnue = 0;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _versionConnue = widget.photo.versionRendu;
    _aDuTexte = widget.photo.consigne.trim().isNotEmpty;
    _consigne.addListener(_suivreTexte);
  }

  void _suivreTexte() {
    final rempli = _consigne.text.trim().isNotEmpty;
    if (rempli != _aDuTexte && mounted) {
      setState(() => _aDuTexte = rempli);
    }
  }

  void _verifierCacheImage() {
    if (_versionConnue == widget.photo.versionRendu) return;
    _versionConnue = widget.photo.versionRendu;
    _voirOriginale = false;
    final prepare = widget.photo.cheminPrepare;
    if (prepare != null) {
      unawaited(FileImage(File(prepare)).evict());
    }
  }

  @override
  void deactivate() {
    if (_focusConsigne.hasFocus) _focusConsigne.unfocus();
    super.deactivate();
  }

  @override
  void dispose() {
    _consigne.removeListener(_suivreTexte);
    _focusConsigne.dispose();
    _consigne.relacher();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    _verifierCacheImage();
    final photo = widget.photo;
    final session = PorteeSession.of(context);
    final chemin = _voirOriginale
        ? photo.cheminOriginal
        : (photo.cheminVisible ?? photo.cheminOriginal);
    final cout = session.credits.photoCost;
    final desactive = photo.iaEnCours || !session.credits.peutPhoto();

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Couleurs.fondDoux,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Couleurs.trait),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Container(
              color: Couleurs.blanc,
              child: Image.file(
                File(chemin),
                key: ValueKey('$chemin-${photo.versionRendu}'),
                height: 184,
                fit: BoxFit.contain,
              ),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: Text(
                  _voirOriginale ? 'Aperçu : photo d\'origine' : photo.affichage,
                  style: const TextStyle(
                    color: Couleurs.encre,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: photo.pourAnalyse
                    ? 'Retirer de l\'analyse'
                    : 'Ajouter à l\'analyse',
                onPressed: () => session.basculer(photo.id),
                icon: Icon(
                  photo.pourAnalyse
                      ? Icons.check_circle
                      : Icons.circle_outlined,
                  color: photo.pourAnalyse
                      ? Couleurs.violet
                      : Couleurs.encreDouce,
                ),
              ),
            ],
          ),
          if (photo.aRenduPrepare && !photo.iaEnCours)
            Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  onPressed: () =>
                      setState(() => _voirOriginale = !_voirOriginale),
                  icon: Icon(
                    _voirOriginale
                        ? Icons.auto_fix_high_outlined
                        : Icons.compare_outlined,
                    size: 16,
                  ),
                  label: Text(
                    _voirOriginale ? 'Voir le rendu' : 'Comparer l\'originale',
                    style: const TextStyle(fontSize: 12.5),
                  ),
                ),
                TextButton.icon(
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  onPressed: () => session.revenirOrigine(photo.id),
                  icon: const Icon(Icons.undo, size: 16),
                  label: const Text(
                    'Rétablir l\'originale',
                    style: TextStyle(fontSize: 12.5),
                  ),
                ),
              ],
            ),
          if (photo.iaEnCours) ...[
            const SizedBox(height: 4),
            const LinearProgressIndicator(),
          ],
          if (photo.message.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              photo.message,
              style: const TextStyle(color: Couleurs.erreur, fontSize: 13),
            ),
          ],
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: desactive
                ? null
                : () => session.photoIa(photo.id, 'fond_blanc'),
            child: Text(
              cout == null
                  ? 'Fond blanc IA'
                  : SelectionPhotos.libellePhoto('Fond blanc IA', cout),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: widget.estPremiere
                ? const ValueKey('consigne')
                : ValueKey('consigne-${photo.id}'),
            controller: _consigne,
            focusNode: _focusConsigne,
            minLines: 1,
            maxLines: 3,
            maxLength: 300,
            textInputAction: TextInputAction.send,
            decoration: const InputDecoration(
              fillColor: Couleurs.blanc,
              labelText: 'Demande pour l\'IA (facultatif)',
              hintText: 'Ex. mets la TV dans une chambre d\'ado…',
              counterText: '',
            ),
            onChanged: (texte) => session.noterConsigne(photo.id, texte),
            onSubmitted: (_) {
              if (!desactive && _aDuTexte) {
                session.genererDemandeIa(photo.id);
              }
            },
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              backgroundColor: _aDuTexte ? Couleurs.lavande : Couleurs.blanc,
              foregroundColor: _aDuTexte
                  ? Couleurs.violet
                  : Couleurs.encreDouce,
              side: BorderSide(
                color: _aDuTexte ? Couleurs.violet : Couleurs.trait,
              ),
            ),
            onPressed: desactive || !_aDuTexte
                ? null
                : () {
                    _focusConsigne.unfocus();
                    session.genererDemandeIa(photo.id);
                  },
            icon: const Icon(Icons.auto_awesome_outlined, size: 18),
            label: Text(
              cout == null
                  ? 'Générer ma demande'
                  : SelectionPhotos.libellePhoto('Générer', cout),
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.fromLTRB(10, 7, 10, 7),
            decoration: BoxDecoration(
              color: Couleurs.attentionFond,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              cout == null
                  ? 'Attention : « Générer » et les poses ci-dessous envoient ta demande à l\'IA et utilisent des crédits (Fond blanc IA l\'ignore).'
                  : 'Attention : « Générer » ou une pose ci-dessous utilise ${cout <= 1 ? '$cout crédit' : '$cout crédits'} (Fond blanc IA ignore le texte).',
              style: const TextStyle(
                color: Couleurs.attention,
                fontSize: 12.5,
                height: 1.35,
              ),
            ),
          ),
          const SizedBox(height: 8),
          _GrilleModesIa(
            modes: ModesPhotoIa.principaux,
            desactive: desactive,
            cout: cout,
            onChoisir: (mode) => session.photoIa(photo.id, mode),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
              ),
              onPressed: () => setState(() => _autresPoses = !_autresPoses),
              icon: Icon(
                _autresPoses ? Icons.expand_less : Icons.expand_more,
                size: 18,
              ),
              label: const Text(
                'Autres poses (enfant, bébé, animaux)',
                style: TextStyle(fontSize: 12.5),
              ),
            ),
          ),
          if (_autresPoses)
            _GrilleModesIa(
              modes: ModesPhotoIa.autres,
              desactive: desactive,
              cout: cout,
              onChoisir: (mode) => session.photoIa(photo.id, mode),
            ),
        ],
      ),
    );
  }
}

class _GrilleModesIa extends StatelessWidget {
  const _GrilleModesIa({
    required this.modes,
    required this.desactive,
    required this.cout,
    required this.onChoisir,
  });

  final List<(String, String)> modes;
  final bool desactive;
  final int? cout;
  final void Function(String mode) onChoisir;

  @override
  Widget build(BuildContext context) {
    final lignes = <Widget>[];
    for (var i = 0; i < modes.length; i += 2) {
      final gauche = modes[i];
      final droite = i + 1 < modes.length ? modes[i + 1] : null;
      if (lignes.isNotEmpty) lignes.add(const SizedBox(height: 8));
      lignes.add(
        Row(
          children: [
            Expanded(
              child: _BoutonModeIa(
                libelle: _texte(gauche.$2),
                onPressed: desactive ? null : () => onChoisir(gauche.$1),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: droite == null
                  ? const SizedBox.shrink()
                  : _BoutonModeIa(
                      libelle: _texte(droite.$2),
                      onPressed: desactive ? null : () => onChoisir(droite.$1),
                    ),
            ),
          ],
        ),
      );
    }
    return Column(children: lignes);
  }

  String _texte(String nom) {
    final c = cout;
    if (c == null) return nom;
    return '$nom · $c cr.';
  }
}

class _BoutonModeIa extends StatelessWidget {
  const _BoutonModeIa({required this.libelle, required this.onPressed});

  final String libelle;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      style: OutlinedButton.styleFrom(
        backgroundColor: Couleurs.blanc,
        minimumSize: const Size.fromHeight(42),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      ),
      onPressed: onPressed,
      child: Text(
        libelle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class EcranAnnonce extends StatefulWidget {
  const EcranAnnonce({super.key});

  @override
  State<EcranAnnonce> createState() => _EcranAnnonceState();
}

class _EcranAnnonceState extends State<EcranAnnonce> {
  var _message = '';
  var _ton = TonMessage.aucun;
  Timer? _minuteur;

  @override
  void dispose() {
    _minuteur?.cancel();
    super.dispose();
  }

  void _notifierSucces(String texte) {
    _minuteur?.cancel();
    setState(() {
      _message = texte;
      _ton = TonMessage.succes;
    });
    _minuteur = Timer(const Duration(milliseconds: 2400), () {
      if (mounted) {
        setState(() {
          _message = '';
          _ton = TonMessage.aucun;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    final champs = session.champs;
    final attente =
        session.analyseEtat == 'attente' ||
        (champs == null && session.analyseEnVol);
    final message = _message.isNotEmpty
        ? _message
        : (champs == null ? session.analyseMessage : '');
    final ton = _message.isNotEmpty
        ? _ton
        : (session.analyseMessage.isEmpty || champs != null
              ? TonMessage.aucun
              : TonMessage.erreur);
    return EcranCadre(
      onRetour: session.retourEtape,
      onCompte: () => _ouvrirCompte(context),
      onAnnonces: () => _ouvrirAnnonces(context),
      nombreAnnonces: session.annoncesEnregistrees.length,
      badgeCredits: session.credits.badgeCourt,
      message: message,
      ton: ton,
      corps: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
        children: [
          Text(
            'Étape 3 · Annonce',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (champs != null) ...[
            const SizedBox(height: 6),
            Text(
              'Touche un texte ou le prix pour le corriger avant de terminer.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 12),
          if (attente)
            const SqueletteEtiquette()
          else if (champs == null) ...[
            Text(
              session.analyseMessage.isEmpty
                  ? 'L\'annonce n\'est pas encore prête.'
                  : session.analyseMessage,
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: session.analyseEnVol ? null : session.relancerAnalyse,
              child: Text(session.libelleRelancer),
            ),
          ] else ...[
            EtiquetteAnnonce(
              champs: champs,
              onModifier: (cle, libelle) =>
                  _editer(context, session, cle, libelle),
              onCopier: (cle) => _copierChamp(cle, champs.valeur(cle)),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => session.aller('fin'),
              child: const Text('Continuer'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _sauvegarderAnnonce(session),
              icon: Icon(
                session.enregistreeAJour
                    ? Icons.bookmark_added_outlined
                    : Icons.bookmark_add_outlined,
                size: 18,
              ),
              label: Text(session.libelleEnregistrerAnnonce),
            ),
          ],
          TextButton(
            onPressed: () => session.aller('preparation'),
            child: const Text('Retour à la préparation'),
          ),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            children: [
              TextButton(
                onPressed: () => _nouvelle(context),
                child: const Text('Nouvelle annonce'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: Couleurs.erreur),
                onPressed: () => _supprimerCourante(context),
                child: const Text('Supprimer l\'annonce'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _sauvegarderAnnonce(SessionAnnonce session) async {
    final dejaEnregistree = session.idAnnonceEnregistree != null;
    await session.enregistrerAnnonce();
    unawaited(HapticFeedback.selectionClick());
    if (mounted) {
      _notifierSucces(
        dejaEnregistree
            ? 'Annonce mise à jour.'
            : 'Annonce enregistrée dans Mes annonces.',
      );
    }
  }

  Future<void> _copierChamp(String cle, String texte) async {
    if (texte.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: texte));
    unawaited(HapticFeedback.selectionClick());
    if (mounted) _notifierSucces(_messageCopie(cle));
  }
}

class EcranFin extends StatefulWidget {
  const EcranFin({super.key});

  @override
  State<EcranFin> createState() => _EcranFinState();
}

class _EcranFinState extends State<EcranFin> with WidgetsBindingObserver {
  final _postIt = const PostItCanal();
  final _safariIos = const SafariIosCanal();
  final _firefox = const FirefoxAndroidCanal();
  var _message = '';
  var _ton = TonMessage.aucun;
  var _postItActif = false;
  var _photosDejaEnregistrees = false;
  var _ouvrirPostItAuRetour = false;
  Timer? _minuteur;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_verifierPostIt());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _minuteur?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_auRetourApplication());
    }
  }

  Future<void> _verifierPostIt() async {
    final actif = await _postIt.actif();
    if (mounted) setState(() => _postItActif = actif);
  }

  Future<void> _auRetourApplication() async {
    if (_ouvrirPostItAuRetour) {
      _ouvrirPostItAuRetour = false;
      final autorise = await _postIt.autorise();
      if (autorise && mounted) {
        await _ouvrirVintedAvecPostIt(PorteeSession.of(context));
        return;
      }
    }
    await _verifierPostIt();
  }

  void _afficher(String texte, TonMessage ton) {
    _minuteur?.cancel();
    setState(() {
      _message = texte;
      _ton = ton;
    });
    if (ton == TonMessage.succes) {
      _minuteur = Timer(const Duration(milliseconds: 2600), () {
        if (mounted) {
          setState(() {
            _message = '';
            _ton = TonMessage.aucun;
          });
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    final champs = session.champs;
    return EcranCadre(
      onRetour: session.retourEtape,
      onCompte: () => _ouvrirCompte(context),
      onAnnonces: () => _ouvrirAnnonces(context),
      nombreAnnonces: session.annoncesEnregistrees.length,
      badgeCredits: session.credits.badgeCourt,
      message: _message,
      ton: _ton,
      corps: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                Text(
                  'Étape 4 · Terminer',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text(
                  'Copie un champ, puis colle-le dans Vinted.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 12),
                if (session.photos.isNotEmpty)
                  SizedBox(
                    height: 96,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (final photo in session.photos)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: Image.file(
                                File(
                                  photo.cheminVisible ?? photo.cheminOriginal,
                                ),
                                key: ValueKey(
                                  '${photo.cheminVisible}-${photo.versionRendu}',
                                ),
                                width: 96,
                                height: 96,
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                const SizedBox(height: 16),
                if (champs != null)
                  EtiquetteAnnonce(
                    champs: champs,
                    onCopier: (cle) => _copier(cle, champs.valeur(cle)),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => _enregistrer(session),
                  child: const Text('Enregistrer les photos'),
                ),
                const SizedBox(height: 8),
                if (champs != null && Platform.isIOS) ...[
                  OutlinedButton.icon(
                    onPressed: () => _ouvrirSafariAutocompletionIos(session),
                    icon: const Icon(Icons.auto_fix_high_outlined, size: 18),
                    label: const Text('Ouvrir Vinted dans Safari (autocomplétion)'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _ouvrirVinted,
                    child: const Text('Ouvrir l\'app Vinted'),
                  ),
                ] else if (champs != null) ...[
                  OutlinedButton.icon(
                    onPressed: () => _ouvrirFirefoxAutocompletion(session),
                    icon: const Icon(Icons.auto_fix_high_outlined, size: 18),
                    label: const Text('Ouvrir dans Firefox (autocomplétion)'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => _ouvrirVintedAvecPostIt(session),
                    icon: const Icon(Icons.sticky_note_2_outlined, size: 18),
                    label: const Text('Ouvrir Vinted + Post-it flottant'),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _ouvrirVinted,
                          child: const Text('Ouvrir Vinted'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _basculerPostItSeul(session),
                          icon: Icon(
                            _postItActif
                                ? Icons.close
                                : Icons.layers_outlined,
                            size: 18,
                          ),
                          label: Text(
                            _postItActif ? 'Fermer Post-it' : 'Post-it seul',
                          ),
                        ),
                      ),
                    ],
                  ),
                ] else
                  OutlinedButton(
                    onPressed: _ouvrirVinted,
                    child: const Text('Ouvrir Vinted'),
                  ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => _sauvegarderAnnonce(session),
                  icon: Icon(
                    session.enregistreeAJour
                        ? Icons.bookmark_added_outlined
                        : Icons.bookmark_add_outlined,
                    size: 18,
                  ),
                  label: Text(session.libelleEnregistrerAnnonce),
                ),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 8,
                  children: [
                    TextButton(
                      onPressed: () => _nouvelle(context),
                      child: const Text('Nouvelle annonce'),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        foregroundColor: Couleurs.erreur,
                      ),
                      onPressed: () => _supprimerCourante(context),
                      child: const Text('Supprimer l\'annonce'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Text(
              mentionIndependante,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _copier(String cle, String texte) async {
    if (texte.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: texte));
    unawaited(HapticFeedback.selectionClick());
    if (mounted) _afficher(_messageCopie(cle), TonMessage.succes);
  }

  Future<void> _sauvegarderAnnonce(SessionAnnonce session) async {
    final dejaEnregistree = session.idAnnonceEnregistree != null;
    await session.enregistrerAnnonce();
    unawaited(HapticFeedback.selectionClick());
    if (mounted) {
      _afficher(
        dejaEnregistree
            ? 'Annonce mise à jour.'
            : 'Annonce enregistrée dans Mes annonces.',
        TonMessage.succes,
      );
    }
  }

  Future<bool> _enregistrer(
    SessionAnnonce session, {
    bool silencieux = false,
  }) async {
    try {
      if (!await Gal.hasAccess()) {
        final acces = await Gal.requestAccess();
        if (!acces) {
          if (mounted) {
            _afficher('Accès à la galerie refusé.', TonMessage.erreur);
          }
          return false;
        }
      }
      var nombre = 0;
      for (final photo in session.photos) {
        await Gal.putImage(
          photo.cheminPrepare ?? photo.cheminOriginal,
          album: 'Annonce Futée',
        );
        nombre++;
      }
      _photosDejaEnregistrees = true;
      unawaited(HapticFeedback.selectionClick());
      if (mounted && !silencieux) {
        final texte = nombre <= 1
            ? '$nombre photo enregistrée dans la galerie.'
            : '$nombre photos enregistrées dans la galerie.';
        _afficher(texte, TonMessage.succes);
      }
      return true;
    } catch (_) {
      if (mounted && !silencieux) {
        _afficher('Enregistrement impossible.', TonMessage.erreur);
      }
      return false;
    }
  }

  Future<void> _ouvrirFirefoxAutocompletion(SessionAnnonce session) async {
    final champs = session.champs;
    if (champs == null) {
      await _ouvrirVinted();
      return;
    }
    if (!_photosDejaEnregistrees && session.photos.isNotEmpty) {
      await _enregistrer(session, silencieux: true);
    }
    final statut = await _firefox.ouvrir(champs);
    if (!mounted) return;
    if (statut == 'ouvert') return;
    if (statut == 'absent') {
      final installer = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Firefox non détecté'),
          content: const Text(
            'Pour remplir automatiquement ton annonce sans copier-coller sur Android, installe gratuitement Firefox depuis le Play Store ainsi que l\'extension Annonce Futée.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Plus tard'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Voir sur Play Store'),
            ),
          ],
        ),
      );
      if (installer == true) {
        await launchUrl(
          Uri.parse('https://play.google.com/store/apps/details?id=org.mozilla.firefox'),
          mode: LaunchMode.externalApplication,
        );
      }
      return;
    }
    _afficher('Firefox n\'a pas pu être ouvert.', TonMessage.erreur);
  }

  Future<void> _ouvrirSafariAutocompletionIos(SessionAnnonce session) async {
    final champs = session.champs;
    if (champs == null) {
      await _ouvrirVinted();
      return;
    }
    if (!_photosDejaEnregistrees && session.photos.isNotEmpty) {
      await _enregistrer(session, silencieux: true);
    }
    if (champs.titre.trim().isNotEmpty) {
      await Clipboard.setData(ClipboardData(text: champs.titre.trim()));
    }
    await _safariIos.enregistrerPourSafari(champs);
    final cible = Uri.parse('https://www.vinted.fr/items/new');
    final ouvert = await launchUrl(cible, mode: LaunchMode.externalApplication);
    if (!ouvert && mounted) {
      _afficher('Safari n\'a pas pu être ouvert.', TonMessage.erreur);
    }
  }

  Future<void> _ouvrirVintedAvecPostIt(SessionAnnonce session) async {
    final champs = session.champs;
    if (champs == null) {
      await _ouvrirVinted();
      return;
    }
    final pret = await _assurerAutorisationPostIt();
    if (!pret) return;
    if (!_photosDejaEnregistrees && session.photos.isNotEmpty) {
      await _enregistrer(session, silencieux: true);
    }
    if (champs.titre.trim().isNotEmpty) {
      await Clipboard.setData(ClipboardData(text: champs.titre.trim()));
    }
    final affiche = await _postIt.afficher(champs);
    if (mounted) setState(() => _postItActif = affiche);
    if (!affiche) {
      if (mounted) {
        _afficher('Le Post-it n\'a pas pu être affiché.', TonMessage.erreur);
      }
      return;
    }
    await _ouvrirVinted();
  }

  Future<void> _basculerPostItSeul(SessionAnnonce session) async {
    if (_postItActif) {
      await _postIt.fermer();
      if (mounted) {
        setState(() => _postItActif = false);
        _afficher('Post-it fermé.', TonMessage.succes);
      }
      return;
    }
    final champs = session.champs;
    if (champs == null) return;
    final pret = await _assurerAutorisationPostIt();
    if (!pret) return;
    final affiche = await _postIt.afficher(champs);
    if (mounted) {
      setState(() => _postItActif = affiche);
      if (affiche) {
        _afficher(
          'Post-it affiché au premier plan. Tu peux ouvrir Vinted.',
          TonMessage.succes,
        );
      } else {
        _afficher('Le Post-it n\'a pas pu être affiché.', TonMessage.erreur);
      }
    }
  }

  Future<bool> _assurerAutorisationPostIt() async {
    if (await _postIt.autorise()) return true;
    if (!mounted) return false;
    final accord = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Autoriser le Post-it flottant'),
        content: const Text(
          'Pour afficher tes textes en petit bloc-notes par-dessus Vinted, active « Autoriser la superposition sur d\'autres applications » pour Annonce Futée, puis reviens en arrière.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Plus tard'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Ouvrir le réglage'),
          ),
        ],
      ),
    );
    if (accord != true) return false;
    _ouvrirPostItAuRetour = true;
    await _postIt.demanderAutorisation();
    return false;
  }

  Future<void> _ouvrirVinted() async {
    final cible = Uri.parse('https://www.vinted.fr/items/new');
    var ouvert = false;
    try {
      ouvert = await launchUrl(
        cible,
        mode: LaunchMode.externalNonBrowserApplication,
      );
    } catch (_) {
      ouvert = false;
    }
    if (!ouvert) {
      ouvert = await launchUrl(cible, mode: LaunchMode.externalApplication);
    }
    if (!ouvert && mounted) {
      _afficher('Vinted n\'a pas pu être ouvert.', TonMessage.erreur);
    }
  }
}

class EcranCompte extends StatefulWidget {
  const EcranCompte({super.key});

  @override
  State<EcranCompte> createState() => _EcranCompteState();
}

class _EcranCompteState extends State<EcranCompte> {
  var _message = '';
  var _ton = TonMessage.aucun;
  var _forfaitsCharges = false;
  Timer? _minuteur;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_forfaitsCharges) {
      _forfaitsCharges = true;
      unawaited(PorteeSession.of(context).chargerForfaits());
    }
  }

  @override
  void dispose() {
    _minuteur?.cancel();
    super.dispose();
  }

  void _notifier(String texte, TonMessage ton) {
    _minuteur?.cancel();
    setState(() {
      _message = texte;
      _ton = ton;
    });
    if (ton == TonMessage.succes) {
      _minuteur = Timer(const Duration(milliseconds: 2600), () {
        if (mounted) {
          setState(() {
            _message = '';
            _ton = TonMessage.aucun;
          });
        }
      });
    }
  }

  Future<void> _ouvrirChangementMotDePasse(SessionAnnonce session) async {
    final modifie = await showDialog<bool>(
      context: context,
      builder: (_) => _DialogueMotDePasse(session: session),
    );
    if (modifie == true && mounted) {
      unawaited(HapticFeedback.selectionClick());
      _notifier('Mot de passe mis à jour.', TonMessage.succes);
    }
  }

  Future<void> _ouvrirSuppressionCompte(SessionAnnonce session) async {
    final supprime = await showDialog<bool>(
      context: context,
      builder: (_) => _DialogueSuppressionCompte(session: session),
    );
    if (supprime == true && mounted) {
      unawaited(const PostItCanal().fermer());
      Navigator.of(context).popUntil((route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    final credits = session.credits;
    return EcranCadre(
      message: _message,
      ton: _ton,
      corps: RefreshIndicator(
        onRefresh: () async {
          try {
            await session.rafraichirCompte();
          } catch (_) {}
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Compte',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  tooltip: 'Actualiser les crédits',
                  onPressed: () async {
                    try {
                      await session.rafraichirCompte();
                    } catch (_) {}
                  },
                  icon: const Icon(
                    Icons.refresh,
                    size: 20,
                    color: Couleurs.encreDouce,
                  ),
                ),
              ],
            ),
            Text(
              credits.email.isEmpty ? '--' : credits.email,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            LigneChamp(
              nom: 'Forfait actuel',
              valeur: credits.forfaitSlug == 'free'
                  ? '${credits.forfaitNom} · Gratuit'
                  : credits.forfaitNom,
            ),
            LigneChamp(nom: 'Crédits', valeur: credits.texteCredits),
            LigneChamp(nom: 'Quota du mois', valeur: credits.texteQuota),
            LigneChamp(nom: 'Utilisés', valeur: credits.texteUtilises),
            LigneChamp(
              nom: 'Une analyse',
              valeur: credits.texteCout(credits.analysisCost),
            ),
            LigneChamp(
              nom: 'Une photo IA',
              valeur: credits.texteCout(credits.photoCost),
            ),
            if (credits.compteTest)
              const LigneChamp(nom: 'Accès', valeur: 'Compte de test'),
            const SizedBox(height: 20),
            Text(
              'Nos forfaits',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Profite de l\'offre Découverte gratuite. Les forfaits payants sont désactivés pour l\'instant.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 10),
            _GrilleForfaits(
              forfaits: session.catalogueForfaits.forfaits,
              slugSelectionne: credits.forfaitSlug,
              onToucherInactif: (forfait) => _notifier(
                'Forfait ${forfait.nom} (${forfait.prixAffiche}) bientôt disponible.',
                TonMessage.succes,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Préférences d\'annonce',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            _BarreStyleRedaction(session: session),
            const SizedBox(height: 8),
            LigneChamp(
              nom: 'Expédition',
              valeur: session.signature.trim().isEmpty
                  ? 'Par défaut'
                  : session.signature,
              onTap: () => _editerSignature(context, session),
            ),
            const SizedBox(height: 20),
            Text(
              'Sécurité et compte',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _ouvrirChangementMotDePasse(session),
              icon: const Icon(Icons.lock_outline, size: 18),
              label: const Text('Changer le mot de passe'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () async {
                unawaited(const PostItCanal().fermer());
                await session.deconnecter();
                if (context.mounted) Navigator.of(context).pop();
              },
              child: const Text('Déconnexion'),
            ),
            if (!credits.compteTest) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                style: TextButton.styleFrom(foregroundColor: Couleurs.erreur),
                onPressed: () => _ouvrirSuppressionCompte(session),
                icon: const Icon(Icons.delete_forever_outlined, size: 18),
                label: const Text('Supprimer définitivement mon compte'),
              ),
            ],
            const SizedBox(height: 24),
            Text(
              mentionIndependante,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _DialogueMotDePasse extends StatefulWidget {
  const _DialogueMotDePasse({required this.session});

  final SessionAnnonce session;

  @override
  State<_DialogueMotDePasse> createState() => _DialogueMotDePasseState();
}

class _DialogueMotDePasseState extends State<_DialogueMotDePasse> {
  final _actuel = _ControleurSaisie();
  final _nouveau = _ControleurSaisie();
  final _confirmation = _ControleurSaisie();
  var _masquer = true;
  var _enCours = false;
  var _erreur = '';

  @override
  void dispose() {
    _actuel.relacher();
    _nouveau.relacher();
    _confirmation.relacher();
    super.dispose();
  }

  Future<void> _valider() async {
    if (_actuel.text.isEmpty || _nouveau.text.isEmpty) {
      setState(() => _erreur = 'Remplis tous les champs.');
      return;
    }
    if (_nouveau.text != _confirmation.text) {
      setState(
        () => _erreur =
            'La confirmation du nouveau mot de passe ne correspond pas.',
      );
      return;
    }
    if (_nouveau.text.length < 10) {
      setState(
        () => _erreur =
            'Le nouveau mot de passe doit contenir au moins 10 caractères (lettres et chiffres).',
      );
      return;
    }
    setState(() {
      _enCours = true;
      _erreur = '';
    });
    try {
      await widget.session.changerMotDePasse(
        actuel: _actuel.text,
        nouveau: _nouveau.text,
        confirmation: _confirmation.text,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _enCours = false;
          _erreur = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Changer le mot de passe'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const ValueKey('mdp-actuel'),
              controller: _actuel,
              obscureText: _masquer,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Mot de passe actuel',
                suffixIcon: IconButton(
                  tooltip: _masquer ? 'Afficher' : 'Masquer',
                  onPressed: () => setState(() => _masquer = !_masquer),
                  icon: Icon(
                    _masquer
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    size: 18,
                    color: Couleurs.encreDouce,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('mdp-nouveau'),
              controller: _nouveau,
              obscureText: _masquer,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Nouveau mot de passe',
                hintText: '10 caractères min., lettres et chiffres',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('mdp-confirmation'),
              controller: _confirmation,
              obscureText: _masquer,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _enCours ? null : _valider(),
              decoration: const InputDecoration(
                labelText: 'Confirmer le nouveau mot de passe',
              ),
            ),
            if (_erreur.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                _erreur,
                style: const TextStyle(color: Couleurs.erreur, fontSize: 13),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _enCours ? null : () => Navigator.pop(context, false),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: _enCours ? null : _valider,
          child: Text(_enCours ? 'Enregistrement…' : 'Mettre à jour'),
        ),
      ],
    );
  }
}

class _DialogueSuppressionCompte extends StatefulWidget {
  const _DialogueSuppressionCompte({required this.session});

  final SessionAnnonce session;

  @override
  State<_DialogueSuppressionCompte> createState() =>
      _DialogueSuppressionCompteState();
}

class _DialogueSuppressionCompteState
    extends State<_DialogueSuppressionCompte> {
  final _motDePasse = _ControleurSaisie();
  var _masquer = true;
  var _enCours = false;
  var _erreur = '';

  @override
  void dispose() {
    _motDePasse.relacher();
    super.dispose();
  }

  Future<void> _confirmer() async {
    if (_motDePasse.text.isEmpty) {
      setState(() => _erreur = 'Saisis ton mot de passe pour confirmer.');
      return;
    }
    setState(() {
      _enCours = true;
      _erreur = '';
    });
    try {
      await widget.session.supprimerCompte(_motDePasse.text);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _enCours = false;
          _erreur = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Supprimer le compte ?'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Cette action est irréversible : ton compte, tes crédits restants et tes annonces enregistrées sur cet appareil seront définitivement effacés.',
              style: TextStyle(fontSize: 13.5, height: 1.4),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('mdp-suppression-compte'),
              controller: _motDePasse,
              obscureText: _masquer,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _enCours ? null : _confirmer(),
              decoration: InputDecoration(
                labelText: 'Confirme ton mot de passe',
                suffixIcon: IconButton(
                  tooltip: _masquer ? 'Afficher' : 'Masquer',
                  onPressed: () => setState(() => _masquer = !_masquer),
                  icon: Icon(
                    _masquer
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    size: 18,
                    color: Couleurs.encreDouce,
                  ),
                ),
              ),
            ),
            if (_erreur.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                _erreur,
                style: const TextStyle(color: Couleurs.erreur, fontSize: 13),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _enCours ? null : () => Navigator.pop(context, false),
          child: const Text('Annuler'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Couleurs.erreur),
          onPressed: _enCours ? null : _confirmer,
          child: Text(_enCours ? 'Suppression…' : 'Supprimer mon compte'),
        ),
      ],
    );
  }
}

Future<void> _editerSignature(
  BuildContext context,
  SessionAnnonce session,
) async {
  final controleur = _ControleurSaisie(text: session.signature);
  final enregistre = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Phrase d\'expédition'),
      content: TextField(
        controller: controleur,
        autofocus: true,
        maxLength: 300,
        maxLines: 3,
        decoration: const InputDecoration(
          hintText: 'Ex. Envoi rapide et soigné sous 24h.',
          counterText: '',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Enregistrer'),
        ),
      ],
    ),
  );
  final texte = controleur.text;
  if (enregistre == true) session.noterSignature(texte);
  controleur.relacher();
}

Future<void> _editer(
  BuildContext context,
  SessionAnnonce session,
  String cle,
  String libelle,
) async {
  final controleur = _ControleurSaisie(
    text: session.champs?.valeur(cle) ?? '',
  );
  final enregistre = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(libelle),
      content: TextField(
        controller: controleur,
        autofocus: true,
        maxLines: cle == 'description' || cle == 'aVerifier' ? 6 : 1,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Enregistrer'),
        ),
      ],
    ),
  );
  final texte = controleur.text;
  if (enregistre == true) session.modifierChamp(cle, texte);
  controleur.relacher();
}

class EcranAnnoncesEnregistrees extends StatefulWidget {
  const EcranAnnoncesEnregistrees({super.key});

  @override
  State<EcranAnnoncesEnregistrees> createState() =>
      _EcranAnnoncesEnregistreesState();
}

class _EcranAnnoncesEnregistreesState
    extends State<EcranAnnoncesEnregistrees> {
  var _message = '';
  var _ton = TonMessage.aucun;
  Timer? _minuteur;

  @override
  void dispose() {
    _minuteur?.cancel();
    super.dispose();
  }

  void _notifier(String texte, TonMessage ton) {
    _minuteur?.cancel();
    setState(() {
      _message = texte;
      _ton = ton;
    });
    _minuteur = Timer(const Duration(milliseconds: 2400), () {
      if (mounted) {
        setState(() {
          _message = '';
          _ton = TonMessage.aucun;
        });
      }
    });
  }

  Future<void> _ouvrir(SessionAnnonce session, AnnonceResume resume) async {
    if (session.peutEnregistrerAnnonce &&
        !session.enregistreeAJour &&
        session.idAnnonceEnregistree != resume.id) {
      final choix = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Remplacer l\'annonce en cours ?'),
          content: const Text(
            'Une annonce non enregistrée est en cours. Tu peux l\'enregistrer avant d\'ouvrir celle-ci.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, 'annuler'),
              child: const Text('Annuler'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, 'remplacer'),
              child: const Text('Sans enregistrer'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'sauver'),
              child: const Text('Enregistrer et ouvrir'),
            ),
          ],
        ),
      );
      if (choix == null || choix == 'annuler') return;
      if (choix == 'sauver') await session.enregistrerAnnonce();
    }
    final ok = await session.ouvrirAnnonceEnregistree(resume.id);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      _notifier('Impossible d\'ouvrir cette annonce.', TonMessage.erreur);
    }
  }

  Future<void> _supprimer(SessionAnnonce session, AnnonceResume resume) async {
    final accord = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Supprimer cette annonce ?'),
        content: Text(
          '« ${resume.titreAffiche} » sera supprimée définitivement de l\'application.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Couleurs.erreur),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Supprimer'),
          ),
        ],
      ),
    );
    if (accord == true) {
      await session.supprimerAnnonceEnregistree(resume.id);
      if (mounted) _notifier('Annonce supprimée.', TonMessage.succes);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = PorteeSession.of(context);
    final liste = session.annoncesEnregistrees;
    return EcranCadre(
      message: _message,
      ton: _ton,
      corps: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                Text(
                  'Mes annonces',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 6),
                Text(
                  liste.isEmpty
                      ? 'Aucune annonce enregistrée pour le moment.'
                      : '${liste.length} ${liste.length == 1 ? 'annonce conservée' : 'annonces conservées'} sur cet appareil. Touche une annonce pour l\'ouvrir.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 16),
                if (liste.isEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 28,
                    ),
                    decoration: BoxDecoration(
                      color: Couleurs.fondDoux,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Couleurs.trait),
                    ),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.bookmarks_outlined,
                          size: 32,
                          color: Couleurs.violet,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Quand une annonce est générée, appuie sur « Enregistrer l\'annonce » pour la retrouver ici à tout moment.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  )
                else
                  for (final resume in liste) ...[
                    _CarteAnnonceEnregistree(
                      resume: resume,
                      estOuverte: session.idAnnonceEnregistree == resume.id,
                      onOuvrir: () => _ouvrir(session, resume),
                      onSupprimer: () => _supprimer(session, resume),
                    ),
                    const SizedBox(height: 10),
                  ],
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
            decoration: const BoxDecoration(
              color: Couleurs.blanc,
              border: Border(top: BorderSide(color: Couleurs.trait)),
            ),
            child: FilledButton(
              onPressed: () async {
                final navigator = Navigator.of(context);
                if (session.peutEnregistrerAnnonce &&
                    !session.enregistreeAJour) {
                  await _nouvelle(context);
                  if (!session.peutEnregistrerAnnonce) navigator.pop();
                } else {
                  await session.nouvelleAnnonce();
                  navigator.pop();
                }
              },
              child: const Text('Nouvelle annonce'),
            ),
          ),
        ],
      ),
    );
  }
}

class _CarteAnnonceEnregistree extends StatelessWidget {
  const _CarteAnnonceEnregistree({
    required this.resume,
    required this.estOuverte,
    required this.onOuvrir,
    required this.onSupprimer,
  });

  final AnnonceResume resume;
  final bool estOuverte;
  final VoidCallback onOuvrir;
  final VoidCallback onSupprimer;

  @override
  Widget build(BuildContext context) {
    final vignette = resume.cheminVignette;
    final prix = resume.prixAffiche;
    return Material(
      color: estOuverte ? Couleurs.lavande : Couleurs.fondDoux,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onOuvrir,
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: estOuverte ? Couleurs.violet : Couleurs.trait,
            ),
          ),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: vignette != null
                    ? Image.file(
                        File(vignette),
                        width: 60,
                        height: 60,
                        fit: BoxFit.cover,
                      )
                    : Container(
                        width: 60,
                        height: 60,
                        color: Couleurs.blanc,
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.image_outlined,
                          color: Couleurs.encreDouce,
                        ),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      resume.titreAffiche,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: policeTitre,
                        fontWeight: FontWeight.w600,
                        fontSize: 15.5,
                        color: Couleurs.encre,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      resume.sousTitre,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: Couleurs.encreDouce,
                      ),
                    ),
                    if (estOuverte) ...[
                      const SizedBox(height: 4),
                      const Text(
                        'Ouverte actuellement',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: Couleurs.violet,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (prix.isNotEmpty) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Couleurs.violet,
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: Text(
                    prix,
                    style: const TextStyle(
                      fontFamily: policeTitre,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                      color: Couleurs.blanc,
                    ),
                  ),
                ),
              ],
              IconButton(
                tooltip: 'Supprimer cette annonce',
                onPressed: onSupprimer,
                icon: const Icon(
                  Icons.delete_outline,
                  size: 20,
                  color: Couleurs.erreur,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> _supprimerCourante(BuildContext context) async {
  final session = PorteeSession.of(context);
  final estEnregistree = session.idAnnonceEnregistree != null;
  final accord = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Supprimer l\'annonce ?'),
      content: Text(
        estEnregistree
            ? 'Cette annonce enregistrée et ses photos seront supprimées définitivement de l\'application.'
            : 'L\'annonce en cours et ses photos seront supprimées de cet appareil.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Annuler'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Couleurs.erreur),
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Supprimer'),
        ),
      ],
    ),
  );
  if (accord == true && context.mounted) {
    await session.supprimerAnnonceCourante();
  }
}

Future<void> _nouvelle(BuildContext context) async {
  final session = PorteeSession.of(context);
  if (session.idAnnonceEnregistree != null && session.enregistreeAJour) {
    await session.nouvelleAnnonce();
    return;
  }
  final peutSauver = session.champs != null;
  final choix = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Nouvelle annonce'),
      content: Text(
        peutSauver
            ? 'Veux-tu enregistrer cette annonce dans « Mes annonces » avant d\'en commencer une nouvelle ?'
            : 'Les photos de l\'annonce en cours seront retirées pour recommencer à zéro.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, 'annuler'),
          child: const Text('Annuler'),
        ),
        if (peutSauver)
          TextButton(
            onPressed: () => Navigator.pop(context, 'effacer'),
            child: const Text('Sans enregistrer'),
          ),
        FilledButton(
          onPressed: () =>
              Navigator.pop(context, peutSauver ? 'sauver' : 'effacer'),
          child: Text(peutSauver ? 'Enregistrer et créer' : 'Recommencer'),
        ),
      ],
    ),
  );
  if (!context.mounted || choix == null || choix == 'annuler') return;
  if (choix == 'sauver') await session.enregistrerAnnonce();
  await session.nouvelleAnnonce();
}
