#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(VxBiometricPlugin, "VxBiometric",
           CAP_PLUGIN_METHOD(isAvailable, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(verify, CAPPluginReturnPromise);
)
