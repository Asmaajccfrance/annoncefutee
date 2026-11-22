import 'package:material_ui/material_ui.dart';

import 'tokens.dart';

ThemeData themeAnnonce() {
  final bouton = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(10),
  );
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: Couleurs.blanc,
    canvasColor: Couleurs.blanc,
    dividerColor: Couleurs.trait,
    colorScheme: const ColorScheme.light(
      primary: Couleurs.violet,
      onPrimary: Couleurs.blanc,
      secondary: Couleurs.violetFonce,
      onSecondary: Couleurs.blanc,
      surface: Couleurs.blanc,
      onSurface: Couleurs.encre,
      error: Couleurs.erreur,
      onError: Couleurs.blanc,
    ),
    textTheme: const TextTheme(
      bodyLarge: TextStyle(color: Couleurs.encre, fontSize: 16, height: 1.45),
      bodyMedium: TextStyle(color: Couleurs.encre, fontSize: 15, height: 1.45),
      bodySmall: TextStyle(
        color: Couleurs.encreDouce,
        fontSize: 13,
        height: 1.4,
      ),
      titleLarge: TextStyle(
        fontFamily: policeTitre,
        fontWeight: FontWeight.w600,
        fontSize: 22,
        height: 1.15,
        color: Couleurs.encre,
        letterSpacing: -0.2,
      ),
      titleMedium: TextStyle(
        fontFamily: policeTitre,
        fontWeight: FontWeight.w600,
        fontSize: 17,
        height: 1.25,
        color: Couleurs.encre,
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Couleurs.blanc,
      foregroundColor: Couleurs.encre,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Couleurs.blanc,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Couleurs.violet,
        foregroundColor: Couleurs.blanc,
        disabledBackgroundColor: Couleurs.trait,
        disabledForegroundColor: Couleurs.encreDouce,
        minimumSize: const Size.fromHeight(48),
        shape: bouton,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Couleurs.encre,
        minimumSize: const Size.fromHeight(48),
        side: const BorderSide(color: Couleurs.trait),
        shape: bouton,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: Couleurs.encreDouce),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Couleurs.fondDoux,
      labelStyle: const TextStyle(color: Couleurs.encreDouce),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Couleurs.trait),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Couleurs.trait),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Couleurs.violet, width: 1.5),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: Couleurs.violet,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Couleurs.blanc,
      surfaceTintColor: Couleurs.blanc,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  );
}
