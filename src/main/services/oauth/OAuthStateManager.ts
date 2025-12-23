import * as crypto from 'crypto';
import { getLogger } from '../logging';
import type { StoredState } from './types';
import { OAuthFlowError } from './types';

/**
 * OAuthStateManager
 *
 * Gestiona state parameters para prevenir CSRF attacks en OAuth flow
 * - Genera state parameters aleatorios
 * - Almacena temporalmente con timeout
 * - Valida state en callback
 */
export class OAuthStateManager {
    private logger = getLogger();
    private states = new Map<string, StoredState>();
    private readonly DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutos

    /**
     * Genera un state parameter aleatorio
     * Mínimo 128 bits de entropía (RFC 6749)
     */
    generateState(): string {
        // 16 bytes = 128 bits
        const state = crypto.randomBytes(16).toString('hex');

        this.logger.oauth.debug('State parameter generated', {
            statePreview: state.substring(0, 8) + '...',
        });

        return state;
    }

    /**
     * Almacena state con información asociada
     */
    storeState(
        state: string,
        serverId: string,
        codeVerifier: string,
        redirectUri: string,
        timeout: number = this.DEFAULT_TIMEOUT
    ): void {
        const expiresAt = Date.now() + timeout;

        this.states.set(state, {
            serverId,
            codeVerifier,
            expiresAt,
            redirectUri,
        });

        this.logger.oauth.debug('State stored', {
            serverId,
            statePreview: state.substring(0, 8) + '...',
            expiresAt: new Date(expiresAt).toISOString(),
        });

        // Auto-cleanup después del timeout
        setTimeout(() => {
            this.deleteState(state);
        }, timeout);
    }

    /**
     * Valida y recupera state
     * Lanza error si state es inválido o expirado
     */
    validateAndRetrieveState(state: string): StoredState {
        const stored = this.states.get(state);

        if (!stored) {
            this.logger.oauth.warn('Invalid state parameter', {
                statePreview: state.substring(0, 8) + '...',
            });
            throw new OAuthFlowError(
                'Invalid state parameter - not found',
                'INVALID_STATE'
            );
        }

        // Verificar expiración
        if (Date.now() >= stored.expiresAt) {
            this.logger.oauth.warn('Expired state parameter', {
                serverId: stored.serverId,
                expiredAt: new Date(stored.expiresAt).toISOString(),
            });

            this.deleteState(state);

            throw new OAuthFlowError(
                'State parameter expired',
                'STATE_EXPIRED',
                { expiresAt: stored.expiresAt }
            );
        }

        this.logger.oauth.debug('State validated successfully', {
            serverId: stored.serverId,
        });

        // Eliminar state después de uso (one-time use)
        this.deleteState(state);

        return stored;
    }

    /**
     * Elimina un state
     */
    deleteState(state: string): void {
        const existed = this.states.delete(state);

        if (existed) {
            this.logger.oauth.debug('State deleted', {
                statePreview: state.substring(0, 8) + '...',
            });
        }
    }

    /**
     * Limpia todos los states expirados
     * Útil para mantenimiento
     */
    cleanExpiredStates(): number {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [state, stored] of this.states.entries()) {
            if (now >= stored.expiresAt) {
                this.states.delete(state);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.oauth.info('Expired states cleaned', { count: cleanedCount });
        }

        return cleanedCount;
    }

    /**
     * Obtiene el número de states activos
     */
    getActiveStatesCount(): number {
        return this.states.size;
    }

    /**
     * Limpia todos los states (útil para testing)
     */
    clearAll(): void {
        const count = this.states.size;
        this.states.clear();
        this.logger.oauth.debug('All states cleared', { count });
    }
}
