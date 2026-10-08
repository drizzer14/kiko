#import <KikoSpecs/KikoSpecs.h>

NS_ASSUME_NONNULL_BEGIN

/// The `KikoReminders` TurboModule: a thin adapter that forwards every call to
/// the Swift `KikoRemindersCenter`.
@interface RCTKikoReminders : NativeKikoRemindersSpecBase <NativeKikoRemindersSpec>
@end

NS_ASSUME_NONNULL_END
