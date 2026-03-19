import { ENV_DEFAULTS } from '../../shared/envDefaults';

class EnvConfig {
  get platformUrl(): string {
    return process.env.LEVANTE_PLATFORM_URL || ENV_DEFAULTS.production.LEVANTE_PLATFORM_URL;
  }

  get servicesHost(): string {
    return (process.env.LEVANTE_SERVICES_HOST || ENV_DEFAULTS.production.LEVANTE_SERVICES_HOST)
      .replace(/\/$/, '');
  }
}

export const envConfig = new EnvConfig();
