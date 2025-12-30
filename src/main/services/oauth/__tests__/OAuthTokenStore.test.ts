import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { safeStorage } from 'electron';
import { OAuthTokenStore } from '../OAuthTokenStore';
import { OAuthTokenStoreError } from '../types';
import type { OAuthTokens } from '../types';
import type { PreferencesService } from '../../preferencesService';

// Mock electron
vi.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((str: string) => Buffer.from(str, 'utf8')),
        decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8')),
    },
}));

// Mock logger
vi.mock('../../logging', () => ({
    getLogger: () => ({
        core: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        oauth: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    }),
}));

// Mock PreferencesService
class MockPreferencesService {
    private store: Record<string, any> = {};

    async get<T>(key: string): Promise<T | undefined> {
        const keys = key.split('.');
        let value: any = this.store;

        for (const k of keys) {
            value = value?.[k];
            if (value === undefined) return undefined;
        }

        return value as T;
    }

    async set(key: string, value: any): Promise<void> {
        const keys = key.split('.');
        const lastKey = keys.pop()!;
        let target: any = this.store;

        for (const k of keys) {
            if (!target[k]) target[k] = {};
            target = target[k];
        }

        target[lastKey] = value;
    }

    async getAll(): Promise<any> {
        return this.store;
    }

    reset(): void {
        this.store = {};
    }
}

describe('OAuthTokenStore', () => {
    let tokenStore: OAuthTokenStore;
    let mockPreferences: MockPreferencesService;

    const createMockTokens = (expiresIn = 3600): OAuthTokens => ({
        accessToken: 'test-access-token-123',
        refreshToken: 'test-refresh-token-456',
        expiresAt: Date.now() + expiresIn * 1000,
        tokenType: 'Bearer',
        scope: 'mcp:read mcp:write',
    });

    beforeEach(() => {
        mockPreferences = new MockPreferencesService();
        tokenStore = new OAuthTokenStore(mockPreferences as any as PreferencesService);
        vi.clearAllMocks();
    });

    afterEach(() => {
        mockPreferences.reset();
    });

    describe('saveTokens', () => {
        it('should encrypt and save tokens', async () => {
            const serverId = 'test-server-1';
            const tokens = createMockTokens();

            await tokenStore.saveTokens(serverId, tokens);

            const stored = await mockPreferences.get(`oauthTokens.${serverId}`);
            expect(stored).toBeDefined();
            expect((stored as any).accessToken).toMatch(/^ENCRYPTED:/);
            expect((stored as any).refreshToken).toMatch(/^ENCRYPTED:/);
            expect((stored as any).expiresAt).toBe(tokens.expiresAt);
            expect((stored as any).tokenType).toBe('Bearer');
        });

        it('should save tokens without refresh token', async () => {
            const serverId = 'test-server-2';
            const tokens: OAuthTokens = {
                accessToken: 'test-access-token',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens(serverId, tokens);

            const stored = await mockPreferences.get(`oauthTokens.${serverId}`);
            expect(stored).toBeDefined();
            expect((stored as any).refreshToken).toBeUndefined();
        });

        it('should include issuedAt timestamp', async () => {
            const serverId = 'test-server-3';
            const tokens = createMockTokens();
            const beforeSave = Date.now();

            await tokenStore.saveTokens(serverId, tokens);

            const stored = await mockPreferences.get(`oauthTokens.${serverId}`);
            const afterSave = Date.now();

            expect((stored as any).issuedAt).toBeGreaterThanOrEqual(beforeSave);
            expect((stored as any).issuedAt).toBeLessThanOrEqual(afterSave);
        });
    });

    describe('getTokens', () => {
        it('should decrypt and return tokens', async () => {
            const serverId = 'test-server-4';
            const originalTokens = createMockTokens();

            await tokenStore.saveTokens(serverId, originalTokens);
            const retrieved = await tokenStore.getTokens(serverId);

            expect(retrieved).toBeDefined();
            expect(retrieved!.accessToken).toBe(originalTokens.accessToken);
            expect(retrieved!.refreshToken).toBe(originalTokens.refreshToken);
            expect(retrieved!.expiresAt).toBe(originalTokens.expiresAt);
            expect(retrieved!.tokenType).toBe('Bearer');
        });

        it('should return null if tokens do not exist', async () => {
            const serverId = 'non-existent-server';
            const tokens = await tokenStore.getTokens(serverId);

            expect(tokens).toBeNull();
        });

        it('should handle tokens without refresh token', async () => {
            const serverId = 'test-server-5';
            const originalTokens: OAuthTokens = {
                accessToken: 'test-access-token',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens(serverId, originalTokens);
            const retrieved = await tokenStore.getTokens(serverId);

            expect(retrieved).toBeDefined();
            expect(retrieved!.refreshToken).toBeUndefined();
        });
    });

    describe('deleteTokens', () => {
        it('should delete tokens for a server', async () => {
            const serverId = 'test-server-6';
            const tokens = createMockTokens();

            await tokenStore.saveTokens(serverId, tokens);

            // Verify tokens exist
            let retrieved = await tokenStore.getTokens(serverId);
            expect(retrieved).toBeDefined();

            // Delete tokens
            await tokenStore.deleteTokens(serverId);

            // Verify tokens are gone
            retrieved = await tokenStore.getTokens(serverId);
            expect(retrieved).toBeNull();
        });

        it('should not throw if deleting non-existent tokens', async () => {
            const serverId = 'non-existent-server';

            await expect(tokenStore.deleteTokens(serverId)).resolves.not.toThrow();
        });
    });

    describe('isTokenExpired', () => {
        it('should return false for valid tokens', () => {
            const tokens = createMockTokens(3600); // 1 hour from now
            expect(tokenStore.isTokenExpired(tokens)).toBe(false);
        });

        it('should return true for expired tokens', () => {
            const tokens = createMockTokens(-10); // 10 seconds ago
            expect(tokenStore.isTokenExpired(tokens)).toBe(true);
        });

        it('should include 60 second buffer for clock skew', () => {
            const tokens = createMockTokens(30); // 30 seconds from now
            // Should be considered expired due to 60 second buffer
            expect(tokenStore.isTokenExpired(tokens)).toBe(true);
        });

        it('should handle tokens expiring exactly now', () => {
            const tokens: OAuthTokens = {
                accessToken: 'test',
                expiresAt: Date.now(),
                tokenType: 'Bearer',
            };
            expect(tokenStore.isTokenExpired(tokens)).toBe(true);
        });
    });

    describe('getAllTokenizedServers', () => {
        it('should return list of servers with tokens', async () => {
            await tokenStore.saveTokens('server-1', createMockTokens());
            await tokenStore.saveTokens('server-2', createMockTokens());
            await tokenStore.saveTokens('server-3', createMockTokens());

            const servers = await tokenStore.getAllTokenizedServers();

            expect(servers).toHaveLength(3);
            expect(servers).toContain('server-1');
            expect(servers).toContain('server-2');
            expect(servers).toContain('server-3');
        });

        it('should return empty array if no tokens exist', async () => {
            const servers = await tokenStore.getAllTokenizedServers();
            expect(servers).toEqual([]);
        });
    });

    describe('cleanExpiredTokens', () => {
        it('should remove expired tokens without refresh token', async () => {
            const expiredTokens: OAuthTokens = {
                accessToken: 'expired',
                expiresAt: Date.now() - 10000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens('expired-server', expiredTokens);
            await tokenStore.saveTokens('valid-server', createMockTokens(3600));

            const cleanedCount = await tokenStore.cleanExpiredTokens();

            expect(cleanedCount).toBe(1);

            const expiredRetrieved = await tokenStore.getTokens('expired-server');
            const validRetrieved = await tokenStore.getTokens('valid-server');

            expect(expiredRetrieved).toBeNull();
            expect(validRetrieved).toBeDefined();
        });

        it('should keep expired tokens with refresh token', async () => {
            const expiredWithRefresh: OAuthTokens = {
                accessToken: 'expired',
                refreshToken: 'can-refresh',
                expiresAt: Date.now() - 10000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens('expired-but-refreshable', expiredWithRefresh);

            const cleanedCount = await tokenStore.cleanExpiredTokens();

            expect(cleanedCount).toBe(0);

            const retrieved = await tokenStore.getTokens('expired-but-refreshable');
            expect(retrieved).toBeDefined();
        });

        it('should return 0 if no expired tokens', async () => {
            await tokenStore.saveTokens('server-1', createMockTokens(3600));
            await tokenStore.saveTokens('server-2', createMockTokens(7200));

            const cleanedCount = await tokenStore.cleanExpiredTokens();
            expect(cleanedCount).toBe(0);
        });
    });

    describe('isEncryptionAvailable', () => {
        it('should return true when safeStorage is available', () => {
            expect(tokenStore.isEncryptionAvailable()).toBe(true);
        });

        it('should return false when safeStorage is not available', () => {
            vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
            expect(tokenStore.isEncryptionAvailable()).toBe(false);
        });
    });

    describe('encryption errors', () => {
        it('should throw when encryption is not available', async () => {
            vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);

            const serverId = 'test-server';
            const tokens = createMockTokens();

            await expect(tokenStore.saveTokens(serverId, tokens)).rejects.toThrow(
                OAuthTokenStoreError
            );
        });

        it('should throw on invalid encrypted format during decryption', async () => {
            const serverId = 'test-server';

            // Manually insert invalid encrypted data
            await mockPreferences.set(`oauthTokens.${serverId}`, {
                accessToken: 'INVALID_NO_PREFIX',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            });

            await expect(tokenStore.getTokens(serverId)).rejects.toThrow(
                OAuthTokenStoreError
            );
        });
    });

    describe('edge cases', () => {
        it('should handle very long tokens', async () => {
            const longToken = 'a'.repeat(10000);
            const tokens: OAuthTokens = {
                accessToken: longToken,
                refreshToken: longToken,
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens('long-token-server', tokens);
            const retrieved = await tokenStore.getTokens('long-token-server');

            expect(retrieved!.accessToken).toBe(longToken);
            expect(retrieved!.refreshToken).toBe(longToken);
        });

        it('should handle special characters in tokens', async () => {
            const specialToken = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
            const tokens: OAuthTokens = {
                accessToken: specialToken,
                refreshToken: specialToken,
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens('special-char-server', tokens);
            const retrieved = await tokenStore.getTokens('special-char-server');

            expect(retrieved!.accessToken).toBe(specialToken);
            expect(retrieved!.refreshToken).toBe(specialToken);
        });

        it('should handle unicode tokens', async () => {
            const unicodeToken = '你好世界🌍🚀';
            const tokens: OAuthTokens = {
                accessToken: unicodeToken,
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            await tokenStore.saveTokens('unicode-server', tokens);
            const retrieved = await tokenStore.getTokens('unicode-server');

            expect(retrieved!.accessToken).toBe(unicodeToken);
        });
    });
});
