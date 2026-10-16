#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(OtaModule, NSObject)

RCT_EXTERN_METHOD(getCurrentBundlePath:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setBundleBlacklisted:(NSString *)hash)

RCT_EXTERN_METHOD(isBundleBlacklisted:(NSString *)hash
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setBundleStable:(NSString *)hash)

RCT_EXTERN_METHOD(clearBlacklist)

RCT_EXTERN_METHOD(restartApp)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
