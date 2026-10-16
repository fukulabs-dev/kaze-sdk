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

RCT_EXTERN_METHOD(writeBundleFile:(NSString *)relativePath
                  content:(NSString *)content
                  isBase64:(BOOL)isBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(readBundleFile:(NSString *)relativePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(bundleFileExists:(NSString *)relativePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getActiveSlot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(switchActiveSlot:(NSString *)newSlot
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getRollbackSlot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
