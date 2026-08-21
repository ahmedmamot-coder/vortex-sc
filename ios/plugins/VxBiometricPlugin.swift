import Foundation
import Capacitor
import LocalAuthentication

/// Face ID over the club's data.
///
/// Not decoration for Guideline 4.2, though it is that too: this app holds 300+ children's
/// medical certificates, passports and home contact details, and until now anybody who picked up
/// an unlocked coach's phone had all of it. A parent handing their phone to their child to watch
/// a video is the ordinary case, not the paranoid one.
///
/// Deliberately advisory rather than a key: nothing is encrypted behind this, it gates the UI.
/// Encrypting the local cache is worth doing and is a bigger change; saying it is a lock when it
/// is a gate would be the dishonest version.
@objc(VxBiometricPlugin)
public class VxBiometricPlugin: CAPPlugin {

    @objc func isAvailable(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let can = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        var kind = "none"
        if can {
            switch context.biometryType {
            case .faceID: kind = "faceId"
            case .touchID: kind = "touchId"
            default: kind = "passcode"
            }
        }
        call.resolve(["available": can, "type": kind])
    }

    @objc func verify(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock Vortex SC"
        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"

        // .deviceOwnerAuthentication, not .deviceOwnerAuthenticationWithBiometrics: the second
        // one has no passcode fallback, so a coach whose Face ID fails in a steamy poolside
        // changing room — which is most mornings — is locked out of the register entirely.
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No passcode set on the phone at all. Refusing entry would lock the user out of
            // their own club app over a setting they may not control.
            call.resolve(["verified": true, "skipped": true, "reason": "no-passcode-set"])
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
            DispatchQueue.main.async {
                if ok {
                    call.resolve(["verified": true])
                } else {
                    let code = (err as? LAError)?.code
                    call.resolve([
                        "verified": false,
                        "cancelled": code == .userCancel || code == .appCancel || code == .systemCancel
                    ])
                }
            }
        }
    }
}
