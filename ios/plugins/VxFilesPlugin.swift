import Foundation
import Capacitor
import UIKit
import SafariServices

/// Saving a file, and opening a link.
///
/// `<a download>` is inert in a WKWebView: the tap does nothing and nothing is logged, which is
/// how every CSV and PDF export in this app can look broken while appearing to work. There is no
/// Downloads folder on iOS, so the file goes to the share sheet — which is how you save a file on
/// a phone: the user picks Files, Mail, WhatsApp, wherever it is going.
///
/// `openUrl` is here for the other half of the same problem. `window.open()` returns nil unless
/// the host implements WKUIDelegate, and `_openUrl()` is how a child's document is opened — so
/// documents simply never appeared. External links open in SFSafariViewController, which is also
/// what Google requires for OAuth: an embedded webview gets `disallowed_useragent`.
@objc(VxFilesPlugin)
public class VxFilesPlugin: CAPPlugin {

    @objc func save(_ call: CAPPluginCall) {
        let filename = sanitise(call.getString("filename") ?? "vortex.txt")
        let data = call.getString("data") ?? ""
        let isBase64 = call.getBool("base64") ?? false

        let bytes: Data?
        if isBase64 {
            bytes = Data(base64Encoded: data, options: .ignoreUnknownCharacters)
        } else {
            bytes = data.data(using: .utf8)
        }

        guard let bytes = bytes else {
            call.reject("That file could not be read.")
            return
        }

        // Written to the temporary directory, not Documents. These are exports on their way to
        // the share sheet, not the app's own data — leaving them in Documents would put every
        // CSV a coach ever exported into the iCloud backup, forever.
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try bytes.write(to: url, options: .atomic)
        } catch {
            call.reject("Could not save that file: \(error.localizedDescription)")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.bridge?.viewController else {
                call.reject("The app is not on screen.")
                return
            }
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // Required on iPad or the app crashes on presentation rather than showing the sheet.
            if let pop = share.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 60, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            share.completionWithItemsHandler = { _, completed, _, _ in
                // Clean up whether or not it was saved: a declined share still left the file.
                try? FileManager.default.removeItem(at: url)
                call.resolve(["saved": completed])
            }
            vc.present(share, animated: true)
        }
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("That link is not valid.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.bridge?.viewController else {
                call.reject("The app is not on screen.")
                return
            }
            if url.scheme == "http" || url.scheme == "https" {
                let safari = SFSafariViewController(url: url)
                safari.preferredControlTintColor = UIColor(red: 0.024, green: 0.494, blue: 0.918, alpha: 1) // #067EEA
                vc.present(safari, animated: true)
                call.resolve(["opened": true])
            } else {
                // A non-web scheme is another app — whatsapp://, mailto:, tel:. Hand it to the
                // system, and say so honestly when nothing on the phone can open it.
                UIApplication.shared.open(url, options: [:]) { ok in
                    call.resolve(["opened": ok])
                }
            }
        }
    }

    /// A filename that cannot escape the temporary directory or collide with a path separator.
    private func sanitise(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .replacingOccurrences(of: "..", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "vortex.txt" : String(cleaned.prefix(120))
    }
}
