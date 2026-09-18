import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    // Created HERE, before `super`, even under the scene lifecycle.
    // expo-dev-launcher's app-delegate subscriber runs inside `super` and
    // fatalErrors ("Cannot find the keyWindow") if `delegate.window` is nil —
    // and no scene exists yet at this point. SceneDelegate attaches this same
    // window to the scene once one connects.
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

/// Puts the app's window on screen under the UIScene lifecycle.
///
/// Apps built with the iOS 27 SDK (Xcode 27) that still use the old
/// app-delegate-only lifecycle are terminated at launch: UIKit traps in
/// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` with
/// SIGTRAP before any JavaScript runs — the app opens and instantly closes.
///
/// The window itself is still created in AppDelegate, because
/// expo-dev-launcher requires it there (see the note in AppDelegate). All this
/// does is move that window onto the scene once iOS provides one, and pass on
/// the link the app was opened with.
///
/// Declared in Info.plist under UIApplicationSceneManifest. Kept in this file
/// rather than its own so the Xcode project needs no manual source-list edit.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let window = appDelegate.window
    else { return }

    window.windowScene = windowScene
    self.window = window
    window.makeKeyAndVisible()

    // Under the scene lifecycle, the link that cold-launched the app arrives
    // here rather than in launchOptions. expo-dev-client takes its Metro server
    // URL from that link through the app delegate, so forward it — otherwise
    // the dev build opens to its launcher with no server.
    for context in connectionOptions.urlContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Links opened while the app is already running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal links while running.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
