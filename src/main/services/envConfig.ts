import { app } from 'electron';
import { ENV_DEFAULTS } from '../../shared/envDefaults';

class EnvConfig {
  private get defaults() {
    return app.isPackaged
      ? ENV_DEFAULTS.production
      : ENV_DEFAULTS.development;
  }

  get platformUrl(): string {
    return this.defaults.LEVANTE_PLATFORM_URL;
  }

  get servicesHost(): string {
    return this.defaults.LEVANTE_SERVICES_HOST.replace(/\/$/, '');
  }
}

export const envConfig = new EnvConfig();
