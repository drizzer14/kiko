#import "RCTDisplayRegions.h"

// The generated Swift header declares every @objc class in the app target, and
// its own `@import`s are skipped in Objective-C++ (no C++ modules), so the
// frameworks those classes use must be imported before it.
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

#import "Kiko-Swift.h"

@implementation RCTDisplayRegions

RCT_EXPORT_MODULE(DisplayRegions)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDisplayRegionsSpecJSI>(params);
}

// Registered only once the TurboModule hands over its callback: emitting
// before then calls an empty std::function and aborts the app.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];

  __weak RCTDisplayRegions *weakSelf = self;
  [DisplayRegionsCenter.shared
      setChangeEmitter:^(NSString *snapshotJson) {
        [weakSelf emitOnChange:snapshotJson];
      }
                 owner:self];
}

// The callback points into the JS runtime being torn down, so it must never
// fire after invalidation: the center emits under the lock this call takes, so
// an emit in flight finishes first and none starts after it.
- (void)invalidate
{
  [DisplayRegionsCenter.shared removeChangeEmitterForOwner:self];
}

// Synchronous so the first render already has the real layout; UIKit reads
// belong on the main queue.
- (NSString *)getSnapshot
{
  __block NSString *snapshotJson = @"";

  RCTUnsafeExecuteOnMainQueueSync(^{
    snapshotJson = [DisplayRegionsCenter.shared snapshotJson];
  });

  return snapshotJson;
}

@end
