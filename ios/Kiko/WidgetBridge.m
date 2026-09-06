#import <React/RCTBridgeModule.h>

// Bridging macros exposing the Swift `WidgetBridge` class (`WidgetBridge.swift`)
// to React Native. Selector names and arity must match the JS wrapper's
// expectations in `src/widget/widget-bridge.ts` exactly.
@interface RCT_EXTERN_MODULE(WidgetBridge, NSObject)

RCT_EXTERN_METHOD(writeSnapshot:(NSString *)json
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(reloadWidget)

@end
