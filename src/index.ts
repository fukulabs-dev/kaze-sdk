export * from './guard';
export * from './updater';
export * from './storage';
export * from './useOTA';
export * from './sha256';
export * from './staging';
export * from './types';
export * from './native';

export interface OTAOptions {
  serverUrl: string;
  appId: string;
  platform?: 'android' | 'ios';
  runtimeVersion?: string;
  channel?: string;
  strategy?: 'background' | 'immediate';
  checkOnResume?: boolean;
}

export function initOTA(options: OTAOptions) {
  return {
    configured: true,
    options: {
      ...options,
      channel: options.channel || 'production',
      strategy: options.strategy || 'background',
    },
  };
}
