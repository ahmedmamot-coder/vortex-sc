import Foundation
import Capacitor
import UIKit
import WebKit

/// Printing, for real.
///
/// `window.print()` inside a WKWebView does nothing at all — no error, no console warning, no
/// paper. Every "Save as PDF / Print" button in this app goes through one function on the web
/// side (`_openHtml`), which builds a whole branded document as an HTML string. That string
/// arrives here and goes to the system printer, which on iOS is also how you get a PDF: the
/// print sheet has "Save to Files" and a pinch-out preview that saves as PDF.
///
/// The document is rendered in an off-screen WKWebView first rather than printed as a string.
/// UIMarkupTextPrintFormatter exists and is one line, but it ignores CSS — and these documents
/// are a branded A4 layout with a header rule, a logo and a table. Through the formatter they
/// come out as unstyled text, which is worse than not printing.
@objc(VxPrintPlugin)
public class VxPrintPlugin: CAPPlugin {

    /// Held for the lifetime of the print job. A WKWebView that goes out of scope stops loading,
    /// and the print sheet appears over a blank page.
    private var printView: WKWebView?

    @objc func printHtml(_ call: CAPPluginCall) {
        let html = call.getString("html") ?? ""
        let name = call.getString("name") ?? "Vortex SC"

        guard !html.isEmpty else {
            call.reject("Nothing to print.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let config = WKWebViewConfiguration()
            let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 595, height: 842), configuration: config)
            web.navigationDelegate = PrintDelegate.shared
            self.printView = web

            PrintDelegate.shared.onFinish = { [weak self] in
                guard let self = self else { return }
                let info = UIPrintInfo(dictionary: nil)
                info.outputType = .general
                info.jobName = name
                info.orientation = .portrait

                let controller = UIPrintInteractionController.shared
                controller.printInfo = info
                // The renderer the webview provides, so the CSS that was just laid out is the
                // CSS that prints. viewPrintFormatter() is the whole reason for the round trip.
                controller.printFormatter = web.viewPrintFormatter()

                controller.present(animated: true) { _, completed, error in
                    self.printView = nil
                    if let error = error {
                        call.reject("Could not print: \(error.localizedDescription)")
                    } else {
                        call.resolve(["printed": completed])
                    }
                }
            }

            // baseURL is the app's own bundle so the logo and any relative asset resolve. Passing
            // nil leaves the header image broken on every printed page.
            web.loadHTMLString(html, baseURL: Bundle.main.bundleURL)
        }
    }
}

/// A navigation delegate that fires once the document has actually laid out.
///
/// Printing on `didFinish` alone catches the HTML but not always the images; the extra beat lets
/// the logo land. Without it the first print of a session comes out with a gap where the club
/// badge should be, and the second one is fine — which is the kind of bug nobody can reproduce.
private class PrintDelegate: NSObject, WKNavigationDelegate {
    static let shared = PrintDelegate()
    var onFinish: (() -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.onFinish?()
            self?.onFinish = nil
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onFinish?()
        onFinish = nil
    }
}
