import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../metier/modeles.dart';
import 'tokens.dart';

enum TonMessage { aucun, succes, erreur }

class BarreMarque extends StatelessWidget implements PreferredSizeWidget {
  const BarreMarque({
    this.onCompte,
    this.onAnnonces,
    this.nombreAnnonces = 0,
    this.onRetour,
    this.badgeCredits = '',
    super.key,
  });

  final VoidCallback? onCompte;
  final VoidCallback? onAnnonces;
  final int nombreAnnonces;
  final VoidCallback? onRetour;
  final String badgeCredits;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      toolbarHeight: 64,
      leading: onRetour == null
          ? null
          : IconButton(
              tooltip: 'Retour',
              onPressed: onRetour,
              icon: const Icon(Icons.arrow_back),
            ),
      titleSpacing: onRetour == null ? 16 : 4,
      title: Row(
        children: [
          Image.asset(
            'assets/marque/icone.png',
            width: 34,
            height: 34,
            semanticLabel: 'Annonce Futée',
          ),
          const SizedBox(width: 10),
          const Flexible(
            child: Text(
              'Annonce Futée',
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontFamily: policeTitre,
                fontWeight: FontWeight.w700,
                fontSize: 18,
                color: Couleurs.encre,
              ),
            ),
          ),
        ],
      ),
      actions: [
        if (onCompte != null && badgeCredits.isNotEmpty)
          Center(
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: onCompte,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: Couleurs.lavande,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  badgeCredits,
                  style: const TextStyle(
                    color: Couleurs.violet,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ),
            ),
          ),
        if (onAnnonces != null)
          IconButton(
            tooltip: 'Mes annonces',
            onPressed: onAnnonces,
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.bookmarks_outlined),
                if (nombreAnnonces > 0)
                  Positioned(
                    right: -5,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: Couleurs.violet,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '$nombreAnnonces',
                        style: const TextStyle(
                          color: Couleurs.blanc,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        if (onCompte != null)
          IconButton(
            tooltip: 'Compte',
            onPressed: onCompte,
            icon: const Icon(Icons.person_outline),
          ),
      ],
    );
  }
}

class EcranCadre extends StatelessWidget {
  const EcranCadre({
    required this.corps,
    this.onCompte,
    this.onAnnonces,
    this.nombreAnnonces = 0,
    this.onRetour,
    this.badgeCredits = '',
    this.message = '',
    this.ton = TonMessage.aucun,
    super.key,
  });

  final Widget corps;
  final VoidCallback? onCompte;
  final VoidCallback? onAnnonces;
  final int nombreAnnonces;
  final VoidCallback? onRetour;
  final String badgeCredits;
  final String message;
  final TonMessage ton;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: BarreMarque(
        onCompte: onCompte,
        onAnnonces: onAnnonces,
        nombreAnnonces: nombreAnnonces,
        onRetour: onRetour,
        badgeCredits: badgeCredits,
      ),
      body: Stack(
        children: [
          corps,
          if (message.isNotEmpty && ton != TonMessage.aucun)
            Positioned(
              left: 16,
              right: 16,
              bottom: 12,
              child: IgnorePointer(
                child: MessageBandeau(message, ton: ton),
              ),
            ),
        ],
      ),
    );
  }
}

class MessageBandeau extends StatelessWidget {
  const MessageBandeau(this.texte, {required this.ton, super.key});

  final String texte;
  final TonMessage ton;

  @override
  Widget build(BuildContext context) {
    final erreur = ton == TonMessage.erreur;
    return Material(
      color: erreur
          ? Couleurs.erreur.withValues(alpha: 0.08)
          : Couleurs.succesFond,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: erreur ? Couleurs.erreur : Couleurs.succesFond),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Text(
          texte,
          style: TextStyle(
            color: erreur ? Couleurs.erreur : Couleurs.succes,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}

class EtiquetteAnnonce extends StatelessWidget {
  const EtiquetteAnnonce({
    required this.champs,
    this.onModifier,
    this.onCopier,
    super.key,
  });

  final ChampsAnnonce champs;
  final void Function(String cle, String libelle)? onModifier;
  final void Function(String cle)? onCopier;

  @override
  Widget build(BuildContext context) {
    final points = champs.aVerifier.trim();
    final modifier = onModifier;
    final copier = onCopier;
    final titrePropre = champs.titre.trim();
    final prixPropre = champs.prix.trim();
    return Container(
      padding: const EdgeInsets.fromLTRB(38, 16, 16, 16),
      decoration: BoxDecoration(
        color: Couleurs.lavande,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Stack(
        children: [
          const Positioned(top: 3, left: -24, child: _Oeillet()),
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: modifier == null
                          ? null
                          : () => modifier('titre', 'Titre'),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              titrePropre.isEmpty ? 'Sans titre' : champs.titre,
                              style: const TextStyle(
                                fontFamily: policeTitre,
                                fontWeight: FontWeight.w600,
                                fontSize: 17,
                                height: 1.25,
                                color: Couleurs.encre,
                              ),
                            ),
                          ),
                          if (modifier != null)
                            const Padding(
                              padding: EdgeInsets.only(left: 4, top: 3),
                              child: Icon(
                                Icons.edit_outlined,
                                size: 14,
                                color: Couleurs.encreDouce,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (copier != null && titrePropre.isNotEmpty)
                    _BoutonCopier(
                      tooltip: 'Copier le titre',
                      onPressed: () => copier('titre'),
                    ),
                  const SizedBox(width: 6),
                  GestureDetector(
                    onTap: modifier != null
                        ? () => modifier('prix', 'Prix')
                        : (copier != null && prixPropre.isNotEmpty
                              ? () => copier('prix')
                              : null),
                    child: Transform.rotate(
                      angle: -2 * math.pi / 180,
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(10, 4, 10, 5),
                        decoration: BoxDecoration(
                          color: Couleurs.violet,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          _prix(champs.prix),
                          style: const TextStyle(
                            fontFamily: policeTitre,
                            fontWeight: FontWeight.w700,
                            fontSize: 19,
                            height: 1.1,
                            color: Couleurs.blanc,
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (copier != null && prixPropre.isNotEmpty)
                    _BoutonCopier(
                      tooltip: 'Copier le prix',
                      onPressed: () => copier('prix'),
                    ),
                ],
              ),
              if (champs.description.isNotEmpty) ...[
                const SizedBox(height: 8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: modifier == null
                            ? null
                            : () => modifier('description', 'Description'),
                        child: Text(
                          champs.description,
                          style: const TextStyle(
                            fontSize: 13,
                            height: 1.45,
                            color: Couleurs.encre,
                          ),
                        ),
                      ),
                    ),
                    if (copier != null)
                      _BoutonCopier(
                        tooltip: 'Copier la description',
                        onPressed: () => copier('description'),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              for (final champ in const [
                ('marque', 'Marque'),
                ('etat', 'État'),
                ('taille', 'Taille'),
                ('couleurs', 'Couleurs'),
                ('matiere', 'Matière'),
                ('categorie', 'Catégorie'),
                ('sousCategorie', 'Sous-catégorie'),
              ])
                LigneChamp(
                  nom: champ.$2,
                  valeur: champs.valeur(champ.$1),
                  onTap: modifier == null
                      ? null
                      : () => modifier(champ.$1, champ.$2),
                  onCopier:
                      copier == null || champs.valeur(champ.$1).trim().isEmpty
                      ? null
                      : () => copier(champ.$1),
                ),
              if (points.isNotEmpty) ...[
                const SizedBox(height: 10),
                GestureDetector(
                  onTap: modifier == null
                      ? null
                      : () => modifier('aVerifier', 'Points à vérifier'),
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                    decoration: BoxDecoration(
                      color: Couleurs.attentionFond,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      points,
                      style: const TextStyle(
                        color: Couleurs.attention,
                        fontSize: 12.5,
                        height: 1.4,
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  static String _prix(String prix) {
    final propre = prix.trim();
    if (propre.isEmpty) return '-- €';
    if (propre.contains('€')) return propre;
    return '$propre €';
  }
}

class _BoutonCopier extends StatelessWidget {
  const _BoutonCopier({required this.tooltip, required this.onPressed});

  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      onPressed: onPressed,
      icon: const Icon(Icons.copy, size: 16, color: Couleurs.encreDouce),
    );
  }
}

class _Oeillet extends StatelessWidget {
  const _Oeillet();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(
        color: Couleurs.blanc,
        shape: BoxShape.circle,
        border: Border.all(color: Couleurs.oeillet, width: 2),
      ),
    );
  }
}

class LigneChamp extends StatelessWidget {
  const LigneChamp({
    required this.nom,
    required this.valeur,
    this.onTap,
    this.onCopier,
    super.key,
  });

  final String nom;
  final String valeur;
  final VoidCallback? onTap;
  final VoidCallback? onCopier;

  @override
  Widget build(BuildContext context) {
    final vide = valeur.trim().isEmpty;
    final actionCopier = onCopier;
    final peutCopier = actionCopier != null && !vide;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 2),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: Couleurs.trait)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 108,
              child: Text(
                nom,
                style: const TextStyle(
                  color: Couleurs.encreDouce,
                  fontSize: 13,
                ),
              ),
            ),
            Expanded(
              child: Text(
                vide ? '--' : valeur,
                textAlign: TextAlign.right,
                style: const TextStyle(
                  color: Couleurs.encre,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (onTap != null && !peutCopier)
              const Padding(
                padding: EdgeInsets.only(left: 6),
                child: Icon(
                  Icons.edit_outlined,
                  size: 14,
                  color: Couleurs.encreDouce,
                ),
              ),
            if (actionCopier != null && !vide)
              _BoutonCopier(tooltip: 'Copier', onPressed: actionCopier),
          ],
        ),
      ),
    );
  }
}

class SqueletteEtiquette extends StatefulWidget {
  const SqueletteEtiquette({super.key});

  @override
  State<SqueletteEtiquette> createState() => _SqueletteEtiquetteState();
}

class _SqueletteEtiquetteState extends State<SqueletteEtiquette>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controleur = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat();

  @override
  void dispose() {
    _controleur.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 128),
      padding: const EdgeInsets.fromLTRB(38, 16, 16, 16),
      decoration: BoxDecoration(
        color: Couleurs.lavande,
        borderRadius: BorderRadius.circular(14),
      ),
      child: AnimatedBuilder(
        animation: _controleur,
        builder: (context, _) {
          final decalage = _controleur.value;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Trait(largeur: 0.7, hauteur: 16, decalage: decalage),
              _Trait(largeur: 0.92, decalage: decalage),
              _Trait(largeur: 0.84, decalage: decalage),
              _Trait(largeur: 0.48, bas: 0, decalage: decalage),
            ],
          );
        },
      ),
    );
  }
}

class _Trait extends StatelessWidget {
  const _Trait({
    required this.largeur,
    required this.decalage,
    this.hauteur = 11,
    this.bas = 11,
  });

  final double largeur;
  final double decalage;
  final double hauteur;
  final double bas;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      widthFactor: largeur,
      child: Container(
        height: hauteur,
        margin: EdgeInsets.only(bottom: bas),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(6),
          gradient: LinearGradient(
            begin: Alignment(-1 + decalage * 2, 0),
            end: Alignment(decalage * 2, 0),
            colors: const [
              Couleurs.squelette,
              Couleurs.lavande,
              Couleurs.squelette,
            ],
          ),
        ),
      ),
    );
  }
}
