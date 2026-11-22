import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let messager = engineBridge.applicationRegistrar.messenger()

    let canalFondBlanc = FlutterMethodChannel(
      name: "annonce_futee/fond_blanc",
      binaryMessenger: messager
    )
    canalFondBlanc.setMethodCallHandler { call, result in
      if call.method == "appliquer",
         let args = call.arguments as? [String: Any],
         let chemin = args["chemin"] as? String,
         !chemin.isEmpty {
        FondBlancIos.appliquer(chemin: chemin, result: result)
      } else {
        result(nil)
      }
    }

    let canalPostIt = FlutterMethodChannel(
      name: "annonce_futee/post_it",
      binaryMessenger: messager
    )
    canalPostIt.setMethodCallHandler { call, result in
      switch call.method {
      case "autorise", "demanderAutorisation", "afficher", "actif":
        result(false)
      case "fermer":
        result(true)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    let canalSafari = FlutterMethodChannel(
      name: "annonce_futee/safari_partage",
      binaryMessenger: messager
    )
    canalSafari.setMethodCallHandler { call, result in
      switch call.method {
      case "enregistrer":
        let args = call.arguments as? [String: Any]
        let champs = args?["champs"] as? [String: String] ?? [:]
        result(PartageSafariIos.enregistrer(champs: champs))
      case "effacer":
        PartageSafariIos.effacer()
        result(true)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
