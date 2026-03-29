export const ENV_DEFAULTS = {
  production: {
    LEVANTE_PLATFORM_URL: 'https://platform.levanteapp.com',
    LEVANTE_SERVICES_HOST: 'https://services.levanteapp.com',
  },
  development: {
    LEVANTE_PLATFORM_URL: 'https://platform.levanteapp.com',
    LEVANTE_SERVICES_HOST: 'http://localhost:5180',
  },
} as const;
