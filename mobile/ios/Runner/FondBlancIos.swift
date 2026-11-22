import CoreImage
import Flutter
import Foundation
import UIKit
import Vision

enum FondBlancIos {
  private static let contexteCi = CIContext(options: nil)

  static func appliquer(chemin: String, result: @escaping FlutterResult) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard #available(iOS 17.0, *) else {
        DispatchQueue.main.async { result(nil) }
        return
      }
      guard let imageUi = chargerEtReduire(chemin: chemin),
            let cgImage = imageUi.cgImage else {
        DispatchQueue.main.async { result(nil) }
        return
      }

      do {
        let requete = VNGenerateForegroundInstanceMaskRequest()
        let gestionnaire = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try gestionnaire.perform([requete])

        guard let observation = requete.results?.first,
              !observation.allInstances.isEmpty else {
          DispatchQueue.main.async { result(nil) }
          return
        }

        let masquePixel = try observation.generateScaledMaskForImage(
          forInstances: observation.allInstances,
          from: gestionnaire
        )
        let imageOriginale = CIImage(cgImage: cgImage)
        let imageMasque = CIImage(cvPixelBuffer: masquePixel)
        let fondBlanc = CIImage(color: .white).cropped(to: imageOriginale.extent)

        guard let filtre = CIFilter(name: "CIBlendWithMask") else {
          DispatchQueue.main.async { result(nil) }
          return
        }
        filtre.setValue(imageOriginale, forKey: kCIInputImageKey)
        filtre.setValue(fondBlanc, forKey: kCIInputBackgroundImageKey)
        filtre.setValue(imageMasque, forKey: kCIInputMaskImageKey)

        guard let sortieCi = filtre.outputImage,
              let sortieCg = contexteCi.createCGImage(sortieCi, from: imageOriginale.extent) else {
          DispatchQueue.main.async { result(nil) }
          return
        }

        let rendu = UIImage(cgImage: sortieCg)
        guard let donnees = rendu.jpegData(compressionQuality: 0.9) else {
          DispatchQueue.main.async { result(nil) }
          return
        }

        DispatchQueue.main.async {
          result(FlutterStandardTypedData(bytes: donnees))
        }
      } catch {
        DispatchQueue.main.async { result(nil) }
      }
    }
  }

  private static func chargerEtReduire(chemin: String) -> UIImage? {
    guard let brute = UIImage(contentsOfFile: chemin) else { return nil }
    let largeur = brute.size.width
    let hauteur = brute.size.height
    if largeur <= 0 || hauteur <= 0 { return nil }

    let coteMax: CGFloat = 1280
    let echelle = min(1.0, coteMax / max(largeur, hauteur))
    let tailleCible = CGSize(
      width: round(largeur * echelle),
      height: round(hauteur * echelle)
    )

    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1.0
    let moteur = UIGraphicsImageRenderer(size: tailleCible, format: format)
    return moteur.image { _ in
      brute.draw(in: CGRect(origin: .zero, size: tailleCible))
    }
  }
}

/// Partage local sécurisé entre l'application iPhone et l'Extension Web Safari Annonce Futée
/// via l'App Group Apple (`group.fr.annoncefutee.partage`). Aucune donnée Vinted ni clé IA.
enum PartageSafariIos {
  static let identifiantGroupe = "group.fr.annoncefutee.partage"
  static let cleAnnonce = "annonce_active_json"

  static func enregistrer(champs: [String: String]) -> Bool {
    guard let donnees = try? JSONSerialization.data(withJSONObject: champs, options: []),
          let texte = String(data: donnees, encoding: .utf8) else {
      return false
    }
    // Pas de repli sur les UserDefaults normaux : l'extension Safari ne pourrait pas les lire.
    // Si l'App Group n'est pas activé dans Xcode, on signale l'échec à l'application.
    guard let coffreGroupe = UserDefaults(suiteName: identifiantGroupe) else {
      return false
    }
    coffreGroupe.set(texte, forKey: cleAnnonce)
    return true
  }

  static func effacer() {
    UserDefaults(suiteName: identifiantGroupe)?.removeObject(forKey: cleAnnonce)
  }
}
