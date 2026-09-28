#import "RCTKikoReminders.h"

// The generated Swift header declares every @objc class in the app target, and
// its own `@import`s are skipped in Objective-C++ (no C++ modules), so the
// frameworks those classes use must be imported before it.
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

#import "Kiko-Swift.h"

@implementation RCTKikoReminders

RCT_EXPORT_MODULE(KikoReminders)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeKikoRemindersSpecJSI>(params);
}

// Registered only once the TurboModule hands over its callback: emitting
// before then calls an empty std::function and aborts the app.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];

  __weak RCTKikoReminders *weakSelf = self;
  [KikoRemindersCenter.shared
      setResponseEmitter:^(NSString *reminderId) {
        [weakSelf emitOnResponse:reminderId];
      }
                   owner:self];
}

// The callback points into the JS runtime being torn down, so it must never
// fire after invalidation.
- (void)invalidate
{
  [KikoRemindersCenter.shared removeResponseEmitterForOwner:self];
}

- (void)authorizationStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [KikoRemindersCenter.shared authorizationStatusWithCompletion:^(NSString *status) {
    resolve(status);
  }];
}

- (void)requestAuthorization:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [KikoRemindersCenter.shared requestAuthorizationWithCompletion:^(BOOL granted) {
    resolve(@(granted));
  }];
}

- (void)replaceRequests:(NSString *)requestsJson
    keepSnoozeReminderIds:(NSArray *)keepSnoozeReminderIds
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [KikoRemindersCenter.shared replaceRequestsWithJson:requestsJson
                                keepSnoozeReminderIds:keepSnoozeReminderIds
                                           completion:^(NSError *_Nullable error) {
                                             if (error != nil) {
                                               reject(@"replace_requests_failed", error.localizedDescription, error);
                                               return;
                                             }

                                             resolve(nil);
                                           }];
}

- (void)registerCategories:(NSString *)snoozeTitle
    hiddenPreviewsBodyPlaceholder:(NSString *)hiddenPreviewsBodyPlaceholder
{
  [KikoRemindersCenter.shared registerCategoriesWithSnoozeTitle:snoozeTitle
                                                    placeholder:hiddenPreviewsBodyPlaceholder];
}

- (void)drainResponses:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([KikoRemindersCenter.shared drainResponses]);
}

@end
