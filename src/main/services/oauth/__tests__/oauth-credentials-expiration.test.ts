import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthService } from '../OAuthService';
import type { PreferencesService } from '../../preferencesService';
import type { OAuthClientCredentials } from '../types';

// Mock electron
const mockSend = vi.fn();
vi.mock('electron', () => {
    const mock = {
        shell: {
            openExternal: vi.fn(),
        },
        safeStorage: {
            isEncryptionAvailable: vi.fn(() => true),
            encryptString: vi.fn((str: string) => Buffer.from(str, 'utf8')),
            decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8')),
        },
        BrowserWindow: {
            getAllWindows: vi.fn(() => [{
                webContents: {
                    send: (global as any).__MOCK_SEND__ || vi.fn(),
                },
            }]),
        },
    };
    return {
        ...mock,
        default: mock,
    };
});

// Mock logger
vi.mock('../../logging', () => ({
    getLogger: () => ({
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

describe('OAuth Client Credentials Expiration', () => {
    let oauthService: OAuthService;
    let mockPreferences: MockPreferencesService;

    beforeEach(() => {
        mockPreferences = new MockPreferencesService();
        oauthService = new OAuthService(mockPreferences as any as PreferencesService);
    });

    afterEach(() => {
        mockPreferences.reset();
        vi.clearAllMocks();
    });

    describe('isClientSecretValid', () => {
        it('should return true when client_secret_expires_at is 0 (never expires)', async () => {
            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: 0, // Never expires
                },
            };

            // Access private method via any
            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(true);
        });

        it('should return true when client_secret_expires_at is undefined', async () => {
            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    // No client_secret_expires_at
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(true);
        });

        it('should return true when secret has not expired', async () => {
            const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: futureTimestamp,
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(true);
        });

        it('should return false when secret has expired', async () => {
            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(false);
        });

        it('should return false when secret will expire within 5 minute buffer', async () => {
            // Expires in 2 minutes (within 5 minute buffer)
            const nearFutureTimestamp = Math.floor(Date.now() / 1000) + 120;

            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: nearFutureTimestamp,
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(false);
        });
    });

    describe('getValidClientCredentials', () => {
        it('should return null when no credentials exist', async () => {
            const result = await (oauthService as any).getValidClientCredentials('nonexistent-server');
            expect(result).toBeNull();
        });

        it('should return credentials when they are valid', async () => {
            const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: futureTimestamp,
                },
            });

            const result = await (oauthService as any).getValidClientCredentials('test-server');

            expect(result).not.toBeNull();
            expect(result.clientId).toBe('test-client');
        });

        it('should delete expired credentials and return null', async () => {
            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                    // No registration_client_uri, so cannot refresh
                },
            });

            const result = await (oauthService as any).getValidClientCredentials('test-server');

            expect(result).toBeNull();

            // Verify credentials were deleted
            const stored = await mockPreferences.get('mcpServers.test-server.oauth.clientCredentials');
            expect(stored).toBeUndefined();
        });

        it('should attempt re-registration when expired but has registration_client_uri', async () => {
            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;
            const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'old-client',
                clientSecret: 'old-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                    registration_client_uri: 'https://auth.example.com/clients/123',
                    registration_access_token: 'ENCRYPTED:cmVnaXN0cmF0aW9uLXRva2Vu', // "registration-token" in base64
                },
            });

            // Mock fetch for re-registration
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    client_id: 'new-client',
                    client_secret: 'new-secret',
                    client_secret_expires_at: futureTimestamp,
                }),
            });

            const result = await (oauthService as any).getValidClientCredentials('test-server');

            expect(result).not.toBeNull();
            expect(result.clientId).toBe('new-client');
            expect(result.clientSecret).toBe('new-secret');

            // Verify new credentials were saved
            const stored = await mockPreferences.get('mcpServers.test-server.oauth.clientCredentials');
            expect(stored).toBeDefined();
        });

        it('should notify user when credentials expire and cannot be refreshed', async () => {
            const mockSend = vi.fn();
            (global as any).__MOCK_SEND__ = mockSend;

            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                    // No registration_client_uri
                },
            });

            await (oauthService as any).getValidClientCredentials('test-server');

            expect(mockSend).toHaveBeenCalledWith(
                'levante/oauth/credentials-expired',
                expect.objectContaining({
                    serverId: 'test-server',
                    reason: 'client_secret_expired',
                })
            );
        });
    });
});
