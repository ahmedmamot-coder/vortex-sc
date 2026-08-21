#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(VxFilesPlugin, "VxFiles",
           CAP_PLUGIN_METHOD(save, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(openUrl, CAPPluginReturnPromise);
)
