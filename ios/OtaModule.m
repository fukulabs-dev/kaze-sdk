#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(OtaModule, NSObject)

RCT_EXTERN_METHOD(getCurrentBundlePath:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restartApp)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
