import UIKit
import Capacitor

/// The APNs half of notifications, and the Face ID gate on launch.
///
/// Capacitor's PushNotifications plugin asks for permission and calls `register()`, but the
/// device token itself arrives on the AppDelegate — so without these two callbacks the plugin's
/// `registration` listener never fires. The app then shows "notifications enabled" and no
/// notification ever arrives, which is the failure this whole file exists to prevent: silence
/// that looks like success.
///
/// Add to the project as-is; Capacitor's generated `AppDelegate.swift` stays untouched, which is
/// what keeps `npx cap sync ios` from overwriting this.
extension AppDelegate {

    // MARK: - APNs

    public func application(_ application: UIApplication,
                            didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // Handed straight to Capacitor, which converts it to the hex string the JS side receives
        // and stores against the device in push_subscriptions.
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications,
                                        object: deviceToken)
    }

    public func application(_ application: UIApplication,
                            didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Reaches the JS `registrationError` listener, so the Settings screen can say something
        // true instead of claiming notifications are on.
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                        object: error)
    }

    // MARK: - The privacy screen

    /// What the app looks like in the iOS app switcher.
    ///
    /// Whatever is on screen when the app goes to the background is what iOS screenshots for the
    /// switcher, and that screenshot survives on disk. On this app the screen is often a
    /// swimmer's medical certificate or a parent's phone number. A cover view over the window
    /// while backgrounded means the switcher shows the club badge instead.
    public func applicationWillResignActive(_ application: UIApplication) {
        guard let window = self.window else { return }
        let cover = UIView(frame: window.bounds)
        cover.tag = 0x565854   // "VXT"
        cover.backgroundColor = UIColor(red: 0.039, green: 0.059, blue: 0.102, alpha: 1) // #0A0F1A
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let logo = UIImageView(image: UIImage(named: "AppIcon"))
        logo.contentMode = .scaleAspectFit
        logo.frame = CGRect(x: 0, y: 0, width: 84, height: 84)
        logo.center = CGPoint(x: cover.bounds.midX, y: cover.bounds.midY)
        logo.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin,
                                 .flexibleLeftMargin, .flexibleRightMargin]
        cover.addSubview(logo)

        window.addSubview(cover)
    }

    public func applicationDidBecomeActive(_ application: UIApplication) {
        self.window?.viewWithTag(0x565854)?.removeFromSuperview()
    }
}
