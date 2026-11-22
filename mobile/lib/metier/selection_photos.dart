class ResultatSelection {
  const ResultatSelection(this.selection, {required this.refuse});

  final List<bool> selection;
  final bool refuse;
}

class SelectionPhotos {
  static const maxPhotos = 10;
  static const maxAnalyse = 5;

  static List<bool> parDefaut(int nombre) {
    return [for (var i = 0; i < nombre; i++) i < maxAnalyse];
  }

  static ResultatSelection basculer(List<bool> selection, int index) {
    if (index < 0 || index >= selection.length) {
      return ResultatSelection(selection, refuse: true);
    }
    if (selection[index]) {
      final copie = [...selection]..[index] = false;
      return ResultatSelection(copie, refuse: false);
    }
    final deja = selection.where((c) => c).length;
    if (deja >= maxAnalyse) {
      return ResultatSelection(selection, refuse: true);
    }
    final copie = [...selection]..[index] = true;
    return ResultatSelection(copie, refuse: false);
  }

  static String libelleContinuer(int cout) {
    if (cout <= 1) return 'Continuer, $cout crédit';
    return 'Continuer, $cout crédits';
  }

  static String libellePhoto(String nom, int cout) {
    if (cout <= 1) return '$nom, $cout crédit';
    return '$nom, $cout crédits';
  }
}
