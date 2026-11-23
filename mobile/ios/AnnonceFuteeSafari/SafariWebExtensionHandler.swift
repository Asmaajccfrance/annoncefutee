import SafariServices
import os.log

/// Pont natif de l'Extension Web Safari iOS.
/// Lit l'annonce préparée par l'application iPhone Annonce Futée via l'App Group partagé
/// (`group.fr.annoncefutee.partage`) pour autocompléter le formulaire dans Safari.
/// Aucune clé d'IA et aucun identifiant Vinted n'y transitent.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  private let identifiantGroupe = "group.fr.annoncefutee.partage"
  private let cleAnnonce = "annonce_active_json"

  func beginRequest(with context: NSExtensionContext) {
    let item = context.inputItems.first as? NSExtensionItem
    let messageBrut: Any?
    if #available(iOS 15.0, *) {
      messageBrut = item?.userInfo?[SFExtensionMessageKey]
    } else {
      messageBrut = item?.userInfo?["message"]
    }

    let dico = messageBrut as? [String: Any] ?? [:]
    let action = (dico["action"] as? String) ?? "lireAnnonce"
    var reponse: [String: Any] = ["ok": true]

    switch action {
    case "lireAnnonce":
      let coffre = UserDefaults(suiteName: identifiantGroupe)
      if let texte = coffre?.string(forKey: cleAnnonce),
         let data = texte.data(using: .utf8),
         let json = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
        reponse["annonce"] = json
      } else {
        reponse["annonce"] = NSNull()
      }
    case "effacerAnnonce":
      UserDefaults(suiteName: identifiantGroupe)?.removeObject(forKey: cleAnnonce)
      reponse["efface"] = true
    default:
      reponse = ["ok": false, "error": "Action inconnue"]
    }

    let retour = NSExtensionItem()
    if #available(iOS 15.0, *) {
      retour.userInfo = [SFExtensionMessageKey: reponse]
    } else {
      retour.userInfo = ["message": reponse]
    }
    context.completeRequest(returningItems: [retour], completionHandler: nil)
  }
}
