#import <KikoSpecs/KikoSpecs.h>

NS_ASSUME_NONNULL_BEGIN

/// The `DisplayRegions` TurboModule: a thin adapter that forwards every call to
/// the Swift `DisplayRegionsCenter`.
@interface RCTDisplayRegions : NativeDisplayRegionsSpecBase <NativeDisplayRegionsSpec>
@end

NS_ASSUME_NONNULL_END
