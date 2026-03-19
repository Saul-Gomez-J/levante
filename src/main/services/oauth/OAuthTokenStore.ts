import { safeStorage } from 'electron';
import { getLogger } from '../logging';
import type { PreferencesService } from '../preferencesService';
import type {
    OAuthTokens,
    StoredOAuthTokens,
} from './types';
import { OAuthTokenStoreError as TokenStoreError } from './types';

/**
 * OAuthTokenStore
 *
 * Gestión de tokens OAuth almacenados en plaintext en ~/levante/ui-preferences.json.
 * Soporta lectura de tokens legacy encriptados con safeStorage para migración transparente.
 */
export class OAuthTokenStore {
    private logger = getLogger();
    private readonly ENCRYPTED_PREFIX = 'ENCRYPTED:';

    constructor(private preferencesService: PreferencesService) { }

    /**
     * Desencripta un valor legacy encriptado con safeStorage.
     * Solo se usa para migrar tokens existentes.
     */
    private decryptLegacy(value: string): string {
        const base64Data = value.replace(this.ENCRYPTED_PREFIX, '');
        const buffer = Buffer.from(base64Data, 'base64');
        return safeStorage.decryptString(buffer);
    }

    /**
     * Lee un valor de token, manejando tanto plaintext como legacy encriptado.
     * Si el valor tiene prefijo ENCRYPTED: intenta desencriptar con safeStorage.
     */
    private readTokenValue(value: string): string {
        if (!value.startsWith(this.ENCRYPTED_PREFIX)) {
            return value;
        }

        // Legacy encrypted token — decrypt and let caller re-save as plaintext
        try {
            this.logger.oauth.info('Migrating legacy encrypted token to plaintext');
            return this.decryptLegacy(value);
        } catch (error) {
            this.logger.oauth.error('Failed to decrypt legacy token', {
                error: error instanceof Error ? error.message : error,
            });
            throw new TokenStoreError(
                'Failed to decrypt legacy token',
                'DECRYPTION_FAILED'
            );
        }
    }

    /**
     * Guarda tokens OAuth para un servidor específico
     * Los tokens se guardan en plaintext en ~/levante/ui-preferences.json
     */
    async saveTokens(serverId: string, tokens: OAuthTokens): Promise<void> {
        try {
            this.logger.oauth.info('Saving OAuth tokens', { serverId });

            const stored: StoredOAuthTokens = {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken || undefined,
                expiresAt: tokens.expiresAt,
                tokenType: tokens.tokenType,
                scope: tokens.scope,
                issuedAt: Date.now(),
            };

            await this.preferencesService.set(`oauthTokens.${serverId}`, stored);

            this.logger.oauth.debug('OAuth tokens saved successfully', {
                serverId,
                hasRefreshToken: !!tokens.refreshToken,
                expiresAt: new Date(tokens.expiresAt).toISOString(),
            });
        } catch (error) {
            this.logger.oauth.error('Failed to save OAuth tokens', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });
            throw error;
        }
    }

    /**
     * Obtiene tokens OAuth para un servidor específico
     * Soporta lectura de tokens legacy encriptados (migración transparente)
     */
    async getTokens(serverId: string): Promise<OAuthTokens | null> {
        try {
            const stored = await this.preferencesService.get<StoredOAuthTokens>(
                `oauthTokens.${serverId}`
            );

            if (!stored) {
                this.logger.oauth.debug('No OAuth tokens found', { serverId });
                return null;
            }

            const accessToken = this.readTokenValue(stored.accessToken);
            const refreshToken = stored.refreshToken
                ? this.readTokenValue(stored.refreshToken)
                : undefined;

            const tokens: OAuthTokens = {
                accessToken,
                refreshToken,
                expiresAt: stored.expiresAt,
                tokenType: stored.tokenType,
                scope: stored.scope,
            };

            // If legacy encrypted tokens were found, re-save as plaintext
            if (
                stored.accessToken.startsWith(this.ENCRYPTED_PREFIX) ||
                (stored.refreshToken && stored.refreshToken.startsWith(this.ENCRYPTED_PREFIX))
            ) {
                this.logger.oauth.info('Re-saving migrated tokens as plaintext', { serverId });
                await this.saveTokens(serverId, tokens);
            }

            this.logger.oauth.debug('OAuth tokens retrieved', {
                serverId,
                hasRefreshToken: !!tokens.refreshToken,
                isExpired: this.isTokenExpired(tokens),
            });

            return tokens;
        } catch (error) {
            if (error instanceof TokenStoreError) {
                throw error;
            }

            this.logger.oauth.error('Failed to get OAuth tokens', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });
            return null;
        }
    }

    /**
     * Elimina tokens OAuth para un servidor específico
     */
    async deleteTokens(serverId: string): Promise<void> {
        try {
            this.logger.oauth.info('Deleting OAuth tokens', { serverId });

            // Obtener todas las preferencias
            const allPrefs = await this.preferencesService.getAll();

            // Eliminar tokens del servidor
            if (allPrefs.oauthTokens && allPrefs.oauthTokens[serverId]) {
                delete allPrefs.oauthTokens[serverId];
                await this.preferencesService.set('oauthTokens', allPrefs.oauthTokens);
            }

            this.logger.oauth.debug('OAuth tokens deleted', { serverId });
        } catch (error) {
            this.logger.oauth.error('Failed to delete OAuth tokens', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });
            throw error;
        }
    }

    /**
     * Verifica si un token está expirado
     * Incluye buffer de 60 segundos para clock skew
     */
    isTokenExpired(tokens: OAuthTokens): boolean {
        const CLOCK_SKEW_BUFFER = 60000; // 60 seconds
        const now = Date.now();
        const expiresWithBuffer = tokens.expiresAt - CLOCK_SKEW_BUFFER;

        const expired = now >= expiresWithBuffer;

        if (expired) {
            this.logger.oauth.debug('Token expired', {
                expiresAt: new Date(tokens.expiresAt).toISOString(),
                now: new Date(now).toISOString(),
                secondsUntilExpiry: Math.floor((tokens.expiresAt - now) / 1000),
            });
        }

        return expired;
    }

    /**
     * Obtiene todos los servidores con tokens OAuth almacenados
     */
    async getAllTokenizedServers(): Promise<string[]> {
        try {
            const allPrefs = await this.preferencesService.getAll();
            const tokens = allPrefs.oauthTokens || {};
            return Object.keys(tokens);
        } catch (error) {
            this.logger.oauth.error('Failed to get tokenized servers', {
                error: error instanceof Error ? error.message : error,
            });
            return [];
        }
    }

    /**
     * Limpia tokens expirados de todos los servidores
     * Útil para mantenimiento y limpieza periódica
     */
    async cleanExpiredTokens(): Promise<number> {
        try {
            this.logger.oauth.info('Cleaning expired OAuth tokens');

            const serverIds = await this.getAllTokenizedServers();
            let cleanedCount = 0;

            for (const serverId of serverIds) {
                const tokens = await this.getTokens(serverId);

                if (tokens && this.isTokenExpired(tokens) && !tokens.refreshToken) {
                    // Solo eliminar si no tiene refresh token
                    await this.deleteTokens(serverId);
                    cleanedCount++;
                }
            }

            this.logger.oauth.info('Expired tokens cleaned', { count: cleanedCount });
            return cleanedCount;
        } catch (error) {
            this.logger.oauth.error('Failed to clean expired tokens', {
                error: error instanceof Error ? error.message : error,
            });
            return 0;
        }
    }
}
