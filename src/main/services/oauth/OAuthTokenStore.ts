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
 * Gestión segura de tokens OAuth con encriptación automática
 * usando electron.safeStorage (Keychain/DPAPI/libsecret)
 */
export class OAuthTokenStore {
    private logger = getLogger();
    private readonly ENCRYPTED_PREFIX = 'ENCRYPTED:';

    constructor(private preferencesService: PreferencesService) { }

    /**
     * Encripta un valor usando safeStorage de Electron
     */
    private encrypt(value: string): string {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                this.logger.oauth.warn('Encryption not available, storing in plaintext');
                throw new TokenStoreError(
                    'Encryption not available on this system',
                    'ENCRYPTION_FAILED'
                );
            }

            const encrypted = safeStorage.encryptString(value);
            const base64 = encrypted.toString('base64');

            return `${this.ENCRYPTED_PREFIX}${base64}`;
        } catch (error) {
            this.logger.oauth.error('Failed to encrypt token', {
                error: error instanceof Error ? error.message : error,
            });
            if (error instanceof TokenStoreError) {
                throw error;
            }
            throw new TokenStoreError(
                'Failed to encrypt token',
                'ENCRYPTION_FAILED'
            );
        }
    }

    /**
     * Desencripta un valor previamente encriptado
     */
    private decrypt(encrypted: string): string {
        try {
            if (!encrypted.startsWith(this.ENCRYPTED_PREFIX)) {
                throw new TokenStoreError(
                    'Invalid encrypted format - missing ENCRYPTED: prefix',
                    'INVALID_FORMAT'
                );
            }

            const base64Data = encrypted.replace(this.ENCRYPTED_PREFIX, '');
            const buffer = Buffer.from(base64Data, 'base64');

            const decrypted = safeStorage.decryptString(buffer);
            return decrypted;
        } catch (error) {
            this.logger.oauth.error('Failed to decrypt token', {
                error: error instanceof Error ? error.message : error,
            });
            if (error instanceof TokenStoreError) {
                throw error;
            }
            throw new TokenStoreError(
                'Failed to decrypt token',
                'DECRYPTION_FAILED'
            );
        }
    }

    /**
     * Guarda tokens OAuth para un servidor específico
     * Los tokens se encriptan automáticamente antes de guardar
     */
    async saveTokens(serverId: string, tokens: OAuthTokens): Promise<void> {
        try {
            this.logger.oauth.info('Saving OAuth tokens', { serverId });

            // Encriptar tokens sensibles
            const stored: StoredOAuthTokens = {
                accessToken: this.encrypt(tokens.accessToken),
                refreshToken: tokens.refreshToken
                    ? this.encrypt(tokens.refreshToken)
                    : undefined,
                expiresAt: tokens.expiresAt,
                tokenType: tokens.tokenType,
                scope: tokens.scope,
                issuedAt: Date.now(),
            };

            // Guardar en preferences
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
     * Los tokens se desencriptan automáticamente
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

            // Desencriptar tokens
            const tokens: OAuthTokens = {
                accessToken: this.decrypt(stored.accessToken),
                refreshToken: stored.refreshToken
                    ? this.decrypt(stored.refreshToken)
                    : undefined,
                expiresAt: stored.expiresAt,
                tokenType: stored.tokenType,
                scope: stored.scope,
            };

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

    /**
     * Verifica si safeStorage está disponible en el sistema
     */
    isEncryptionAvailable(): boolean {
        return safeStorage.isEncryptionAvailable();
    }
}
