const PRODUCTION_BASE_URL = 'https://services.levanteapp.com';

export class ServicesConfig {
  static getBaseUrl(): string {
    if (process.env.NODE_ENV === 'production') {
      return PRODUCTION_BASE_URL;
    }

    const envUrl = process.env.SERVICE_BASE_URL;
    if (envUrl) {
      return envUrl.replace(/\/$/, '');
    }

    throw new Error(
      '[ServicesConfig] SERVICE_BASE_URL environment variable is required in non-production environments'
    );
  }
}
