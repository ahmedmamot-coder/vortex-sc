#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor finds a plugin through this macro, not through the Swift class alone. Without the
// .m file the plugin compiles, ships, and is simply absent from Capacitor.Plugins at runtime —
// so window.print() falls back to doing nothing and the wrapper is exactly the thing it was
// written to stop being.
CAP_PLUGIN(VxPrintPlugin, "VxPrint",
           CAP_PLUGIN_METHOD(printHtml, CAPPluginReturnPromise);
)
