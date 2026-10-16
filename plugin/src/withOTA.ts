export interface ExpoConfigLike {
  name: string;
  slug: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ConfigPlugin<T = unknown> = (config: ExpoConfigLike, props?: T) => ExpoConfigLike;

const withOTA: ConfigPlugin = (config) => {
  return {
    ...config,
    extra: {
      ...config.extra,
      otaEnabled: true,
    },
  };
};

export default withOTA;
