import Capacitor
import UIKit

/// The app's web view controller (Main.storyboard). Registers the app's own plugin, which lives
/// in this target rather than in an npm package. (The status bar is hidden by Info.plist and
/// the StatusBar plugin; Capacitor's controller doesn't let apps override that property.)
class HubViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HubNativePlugin())
    }
}
