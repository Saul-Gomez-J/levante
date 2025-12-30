/**
 * OAuth Constants
 *
 * Constantes para el flujo OAuth, incluyendo el puerto fijo
 * para el servidor loopback de redirección.
 */

/**
 * Puerto fijo para el servidor loopback OAuth
 *
 * Elegimos 31337 porque:
 * - Está en el rango de puertos no privilegiados (> 1024)
 * - Es poco probable que esté en uso por otras aplicaciones
 * - Es fácil de recordar para debugging
 *
 * Si este puerto estuviera ocupado, el flujo fallará y se
 * informará al usuario que cierre la aplicación que lo usa.
 */
export const OAUTH_LOOPBACK_PORT = 31337;

/**
 * Hostname para el servidor loopback
 * Siempre 127.0.0.1 por seguridad (no localhost)
 */
export const OAUTH_LOOPBACK_HOST = '127.0.0.1';

/**
 * Path del callback OAuth
 */
export const OAUTH_CALLBACK_PATH = '/callback';

/**
 * Redirect URI fijo para OAuth
 * Se usa tanto en DCR como en authorize
 */
export const OAUTH_REDIRECT_URI = `http://${OAUTH_LOOPBACK_HOST}:${OAUTH_LOOPBACK_PORT}${OAUTH_CALLBACK_PATH}`;

/**
 * Timeout para el callback (5 minutos)
 */
export const OAUTH_CALLBACK_TIMEOUT = 5 * 60 * 1000;
