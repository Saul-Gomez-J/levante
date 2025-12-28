# Plan de Implementación: Fases 3 y 4 - OAuth Private Client Support

> Plan detallado con código específico para implementar las fases 3 (Credenciales Manuales) y 4 (Credenciales Pre-configuradas) del soporte para clientes privados OAuth.

## Estado Actual (Post Fases 1 y 2)

### ✅ Fase 1 Completada
- `OAuthDiscoveryService.registerClient()` acepta `ClientRegistrationOptions` con `preferConfidential` y `tokenEndpointAuthMethod`
- Tipos `ClientRegistrationOptions` y `TokenEndpointAuthMethod` definidos en `types.ts`
- DCR puede solicitar registro como cliente confidencial

### ✅ Fase 2 Completada
- Función `applyClientAuthentication()` en `OAuthFlowManager.ts` implementa `client_secret_basic` (HTTP Basic Auth)
- `exchangeCodeForTokens()`, `refreshAccessToken()` y `revokeToken()` soportan ambos métodos de autenticación

---

## Fase 3: Credenciales Manuales (Skip DCR)

**Objetivo**: Permitir configurar `client_id` y `client_secret` manualmente, omitiendo DCR.

### Resumen de Cambios

| Archivo | Tipo de Cambio |
|---------|----------------|
| `src/main/services/oauth/types.ts` | Añadir tipos `ManualClientCredentials` |
| `src/main/services/oauth/OAuthService.ts` | Actualizar `AuthorizeParams`, añadir lógica skip DCR |
| `src/main/ipc/oauthHandlers.ts` | Nuevo handler `levante/oauth/configure-credentials` |

---

### 3.1 Actualizar `types.ts`

**Ubicación**: `src/main/services/oauth/types.ts`

**Añadir después de línea 555 (después de `ClientRegistrationOptions`):**

```typescript
/**
 * Credenciales de cliente proporcionadas manualmente (skip DCR)
 */
export interface ManualClientCredentials {
    /** Client ID registrado manualmente */
    clientId: string;

    /** Client Secret del cliente confidencial */
    clientSecret: string;

    /** Método de autenticación a usar para el token endpoint */
    tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
}

/**
 * Preferencia de tipo de cliente para DCR automático
 */
export interface ClientTypePreference {
    /** Si es true, intenta registrarse como cliente confidencial */
    preferConfidential: boolean;

    /** Método de autenticación preferido si se obtiene client_secret */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}
```

---

### 3.2 Actualizar `OAuthService.ts`

**Ubicación**: `src/main/services/oauth/OAuthService.ts`

#### 3.2.1 Actualizar interfaz `AuthorizeParams` (líneas 27-34)

**Reemplazar:**
```typescript
export interface AuthorizeParams {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;  // Optional: from Dynamic Registration in Phase 5
    wwwAuthHeader?: string;
}
```

**Por:**
```typescript
export interface AuthorizeParams {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;  // Optional: from Dynamic Registration in Phase 5
    wwwAuthHeader?: string;

    // Fase 3: Credenciales manuales (skip DCR)
    manualCredentials?: {
        clientId: string;
        clientSecret: string;
        tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
    };

    // Fase 3: Preferencia para DCR si no hay credenciales manuales
    clientTypePreference?: {
        preferConfidential: boolean;
        tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
    };
}
```

#### 3.2.2 Actualizar importaciones (línea 17-23)

**Reemplazar:**
```typescript
import type {
    OAuthTokens,
    AuthorizationServerMetadata,
    OAuthServiceError,
    OAuthClientCredentials,
    TokenEndpointAuthMethod,
} from './types';
```

**Por:**
```typescript
import type {
    OAuthTokens,
    AuthorizationServerMetadata,
    OAuthServiceError,
    OAuthClientCredentials,
    TokenEndpointAuthMethod,
    OAuthServerConfig,
} from './types';
```

#### 3.2.3 Modificar método `authorize()` - Añadir lógica de credenciales manuales

**Ubicación**: Dentro de `authorize()`, reemplazar STEP 3 (líneas 129-208)

**Reemplazar el bloque completo del STEP 3:**
```typescript
            // Step 3: Dynamic Client Registration (if needed)
            let clientId = providedClientId;
            let clientSecret: string | undefined;
            let tokenEndpointAuthMethod: TokenEndpointAuthMethod = 'none';

            if (!clientId) {
                logger.oauth.info(
                    'Step 3: No client_id provided, attempting Dynamic Client Registration'
                );

                // Check if AS supports Dynamic Client Registration
                if (this.discoveryService.supportsClientRegistration(metadata)) {
                    logger.oauth.info(
                        'Dynamic Client Registration supported, attempting registration'
                    );

                    try {
                        const credentials =
                            await this.discoveryService.registerClient(
                                metadata.registration_endpoint!,
                                authServerId,
                                {
                                    redirectUris: [redirectUri],
                                    // Por ahora, seguimos como public client
                                    // En fases futuras, esto podría venir de configuración
                                    preferConfidential: false,
                                }
                            );

                        clientId = credentials.clientId;
                        clientSecret = credentials.clientSecret;
                        tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod ?? 'none';

                        // Save credentials to preferences (encrypted)
                        await this.saveClientCredentials(serverId, credentials);

                        logger.oauth.info('Dynamic Client Registration successful', {
                            clientId: this.sanitizeForLog(clientId),
                            hasClientSecret: !!clientSecret,
                        });
                    } catch (registrationError) {
                        // Cleanup redirect server
                        await redirectServer.stop();

                        // Dynamic Registration failed
                        logger.oauth.error('Dynamic Client Registration failed', {
                            error:
                                registrationError instanceof Error
                                    ? registrationError.message
                                    : registrationError,
                        });

                        // For now, we throw an error informing the user
                        return {
                            success: false,
                            error: `Dynamic Client Registration failed: ${registrationError instanceof Error
                                ? registrationError.message
                                : 'Unknown error'
                                }. This server requires manual client configuration (feature coming soon).`,
                        };
                    }
                } else {
                    // Cleanup redirect server
                    await redirectServer.stop();

                    // No Dynamic Registration available
                    logger.oauth.warn(
                        'Dynamic Client Registration not supported by Authorization Server'
                    );

                    return {
                        success: false,
                        error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration will be required (feature coming soon).',
                    };
                }
            } else {
                logger.oauth.info('Step 3: Using provided client_id', {
                    clientId: this.sanitizeForLog(clientId),
                });
            }
```

**Por este nuevo código:**
```typescript
            // Step 3: Obtener credenciales de cliente
            let clientId = providedClientId;
            let clientSecret: string | undefined;
            let tokenEndpointAuthMethod: TokenEndpointAuthMethod = 'none';

            // CASO A: Credenciales manuales proporcionadas - Skip DCR
            if (params.manualCredentials) {
                logger.oauth.info('Step 3: Using manual client credentials (skipping DCR)', {
                    serverId,
                    hasSecret: true,
                    authMethod: params.manualCredentials.tokenEndpointAuthMethod,
                });

                clientId = params.manualCredentials.clientId;
                clientSecret = params.manualCredentials.clientSecret;
                tokenEndpointAuthMethod = params.manualCredentials.tokenEndpointAuthMethod;

                // Guardar credenciales manuales
                await this.saveManualCredentials(serverId, {
                    clientId,
                    clientSecret,
                    tokenEndpointAuthMethod,
                    authServerId,
                });
            }
            // CASO B: clientId proporcionado directamente
            else if (clientId) {
                logger.oauth.info('Step 3: Using provided client_id', {
                    clientId: this.sanitizeForLog(clientId),
                });
            }
            // CASO C: Intentar obtener credenciales existentes
            else {
                const existingCredentials = await this.getClientCredentials(serverId);

                if (existingCredentials && this.isClientSecretValid(existingCredentials)) {
                    logger.oauth.info('Step 3: Using existing client credentials', {
                        serverId,
                        hasSecret: !!existingCredentials.clientSecret,
                        authMethod: existingCredentials.tokenEndpointAuthMethod,
                    });

                    clientId = existingCredentials.clientId;
                    clientSecret = existingCredentials.clientSecret;
                    tokenEndpointAuthMethod = existingCredentials.tokenEndpointAuthMethod ?? 'none';
                }
                // CASO D: DCR automático
                else if (this.discoveryService.supportsClientRegistration(metadata)) {
                    logger.oauth.info(
                        'Step 3: No credentials found, attempting Dynamic Client Registration'
                    );

                    try {
                        const credentials =
                            await this.discoveryService.registerClient(
                                metadata.registration_endpoint!,
                                authServerId,
                                {
                                    redirectUris: [redirectUri],
                                    preferConfidential: params.clientTypePreference?.preferConfidential ?? false,
                                    tokenEndpointAuthMethod: params.clientTypePreference?.tokenEndpointAuthMethod,
                                }
                            );

                        clientId = credentials.clientId;
                        clientSecret = credentials.clientSecret;
                        tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod ?? 'none';

                        // Save credentials to preferences (encrypted)
                        await this.saveClientCredentials(serverId, credentials);

                        logger.oauth.info('Dynamic Client Registration successful', {
                            clientId: this.sanitizeForLog(clientId),
                            hasClientSecret: !!clientSecret,
                            authMethod: tokenEndpointAuthMethod,
                        });
                    } catch (registrationError) {
                        // Cleanup redirect server
                        await redirectServer.stop();

                        logger.oauth.error('Dynamic Client Registration failed', {
                            error:
                                registrationError instanceof Error
                                    ? registrationError.message
                                    : registrationError,
                        });

                        return {
                            success: false,
                            error: `Dynamic Client Registration failed: ${registrationError instanceof Error
                                ? registrationError.message
                                : 'Unknown error'
                                }. Manual client configuration is required.`,
                        };
                    }
                } else {
                    // Cleanup redirect server
                    await redirectServer.stop();

                    logger.oauth.warn(
                        'Dynamic Client Registration not supported by Authorization Server'
                    );

                    return {
                        success: false,
                        error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration is required.',
                    };
                }
            }
```

#### 3.2.4 Añadir método `saveManualCredentials()` (después de `saveClientCredentials`, ~línea 528)

**Añadir después del método `saveClientCredentials()`:**

```typescript
    /**
     * Guarda credenciales configuradas manualmente (no DCR)
     *
     * @param serverId - MCP server ID
     * @param credentials - Credenciales manuales
     */
    private async saveManualCredentials(
        serverId: string,
        credentials: {
            clientId: string;
            clientSecret: string;
            tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
            authServerId: string;
        }
    ): Promise<void> {
        // Construir objeto de credenciales compatible con OAuthClientCredentials
        const clientCredentials: OAuthClientCredentials = {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            registeredAt: Date.now(),
            authServerId: credentials.authServerId,
            tokenEndpointAuthMethod: credentials.tokenEndpointAuthMethod,
            // Marcar como manual (sin registration metadata)
        };

        // Usar el mismo método de guardado que DCR
        await this.saveClientCredentials(serverId, clientCredentials);

        // Marcar en la config OAuth que son credenciales manuales
        const existingConfig = await this.preferencesService.get(
            `mcpServers.${serverId}.oauth`
        ) as OAuthServerConfig | null;

        await this.preferencesService.set(`mcpServers.${serverId}.oauth`, {
            ...existingConfig,
            isPreConfigured: true,
            tokenEndpointAuthMethod: credentials.tokenEndpointAuthMethod,
        });

        logger.oauth.info('Manual client credentials saved', {
            serverId,
            clientId: this.sanitizeForLog(credentials.clientId),
            authMethod: credentials.tokenEndpointAuthMethod,
        });
    }
```

#### 3.2.5 Añadir método `isClientSecretValid()` (después de `saveManualCredentials`)

```typescript
    /**
     * Verifica si el client_secret ha expirado
     * RFC 7591: client_secret_expires_at = 0 significa que nunca expira
     *
     * @param credentials - Credenciales a verificar
     * @returns true si el secret es válido (no expirado)
     */
    private isClientSecretValid(credentials: OAuthClientCredentials): boolean {
        const expiresAt = credentials.registrationMetadata?.client_secret_expires_at;

        // 0 = nunca expira (RFC 7591)
        if (!expiresAt || expiresAt === 0) {
            return true;
        }

        // Añadir buffer de 5 minutos
        const EXPIRY_BUFFER = 5 * 60 * 1000;
        return Date.now() < (expiresAt * 1000) - EXPIRY_BUFFER;
    }
```

#### 3.2.6 Añadir método público `configureManualCredentials()` (después de `disconnect`)

```typescript
    /**
     * Configura credenciales de cliente manualmente (sin iniciar flujo OAuth)
     * Útil para pre-configurar credenciales antes de conectar
     *
     * @param params - Parámetros de configuración
     */
    async configureManualCredentials(params: {
        serverId: string;
        clientId: string;
        clientSecret: string;
        tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
        authServerUrl?: string;
    }): Promise<void> {
        logger.oauth.info('Configuring manual client credentials', {
            serverId: params.serverId,
            hasAuthServerUrl: !!params.authServerUrl,
            authMethod: params.tokenEndpointAuthMethod,
        });

        await this.saveManualCredentials(params.serverId, {
            clientId: params.clientId,
            clientSecret: params.clientSecret,
            tokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
            authServerId: params.authServerUrl || '',
        });

        logger.oauth.info('Manual credentials configured successfully', {
            serverId: params.serverId,
        });
    }
```

---

### 3.3 Actualizar `oauthHandlers.ts`

**Ubicación**: `src/main/ipc/oauthHandlers.ts`

#### 3.3.1 Actualizar registro de handlers (dentro de `setupOAuthHandlers()`, después de línea 59)

**Añadir después de `ipcMain.handle('levante/oauth/list', handleList);`:**

```typescript
  // Configure manual credentials (skip DCR)
  ipcMain.handle('levante/oauth/configure-credentials', handleConfigureCredentials);
```

#### 3.3.2 Actualizar `handleAuthorize()` para soportar nuevos parámetros (líneas 77-142)

**Reemplazar la firma y cuerpo de `handleAuthorize`:**

```typescript
/**
 * Start OAuth authorization flow
 */
async function handleAuthorize(
  _event: any,
  params: {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;
    wwwAuthHeader?: string;
    // Fase 3: Credenciales manuales
    manualCredentials?: {
      clientId: string;
      clientSecret: string;
      tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
    };
    // Fase 3: Preferencia de tipo de cliente para DCR
    clientTypePreference?: {
      preferConfidential: boolean;
      tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
    };
  }
): Promise<{
  success: boolean;
  error?: string;
  tokens?: any;
}> {
  try {
    await initializeServices();

    logger.oauth.info('IPC: Starting OAuth authorization', {
      serverId: params.serverId,
      url: params.mcpServerUrl,
      hasWWWAuth: !!params.wwwAuthHeader,
      hasManualCredentials: !!params.manualCredentials,
      hasClientTypePreference: !!params.clientTypePreference,
    });

    const result = await oauthService.authorize({
      serverId: params.serverId,
      mcpServerUrl: params.mcpServerUrl,
      scopes: params.scopes,
      clientId: params.clientId,
      wwwAuthHeader: params.wwwAuthHeader,
      manualCredentials: params.manualCredentials,
      clientTypePreference: params.clientTypePreference,
    });

    if (result.success) {
      logger.oauth.info('IPC: OAuth authorization successful', {
        serverId: params.serverId,
      });

      return {
        success: true,
        tokens: {
          expiresAt: result.tokens?.expiresAt,
          scope: result.tokens?.scope,
        },
      };
    } else {
      logger.oauth.error('IPC: OAuth authorization failed', {
        serverId: params.serverId,
        error: result.error,
      });

      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    logger.oauth.error('IPC: OAuth authorization error', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

#### 3.3.3 Añadir nuevo handler `handleConfigureCredentials()` (después de `handleList`, ~línea 341)

```typescript
/**
 * Configure manual OAuth credentials (skip DCR)
 */
async function handleConfigureCredentials(
  _event: any,
  params: {
    serverId: string;
    clientId: string;
    clientSecret: string;
    tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
    authServerUrl?: string;
  }
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await initializeServices();

    logger.oauth.info('IPC: Configuring manual OAuth credentials', {
      serverId: params.serverId,
      hasAuthServerUrl: !!params.authServerUrl,
      authMethod: params.tokenEndpointAuthMethod,
    });

    await oauthService.configureManualCredentials({
      serverId: params.serverId,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
      authServerUrl: params.authServerUrl,
    });

    logger.oauth.info('IPC: Manual credentials configured', {
      serverId: params.serverId,
    });

    return { success: true };
  } catch (error) {
    logger.oauth.error('IPC: Configure credentials error', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

#### 3.3.4 Actualizar mensaje de log de registro de handlers

**En `setupOAuthHandlers()`, actualizar el mensaje final:**

```typescript
  logger.oauth.info('OAuth handlers registered successfully (MCP + OpenRouter + Configure Credentials)');
```

---

## Fase 4: Credenciales Pre-configuradas desde Config del Servidor MCP

**Objetivo**: Leer credenciales `client_id` y `client_secret` desde la configuración del servidor MCP existente.

### Resumen de Cambios

| Archivo | Tipo de Cambio |
|---------|----------------|
| `src/main/services/oauth/types.ts` | Actualizar `OAuthServerConfig` |
| `src/main/services/oauth/OAuthService.ts` | Añadir detección de credenciales pre-configuradas |

---

### 4.1 Actualizar `types.ts`

**Ubicación**: `src/main/services/oauth/types.ts`

**Reemplazar `OAuthServerConfig` (líneas 505-512):**

```typescript
/**
 * OAuth configuration stored in preferences
 */
export interface OAuthServerConfig {
    enabled: boolean;
    authServerId: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    redirectUri?: string;
}
```

**Por:**
```typescript
/**
 * OAuth configuration stored in preferences
 */
export interface OAuthServerConfig {
    /** OAuth habilitado para este servidor */
    enabled: boolean;

    /** URL del Authorization Server */
    authServerId: string;

    /** Client ID registrado */
    clientId: string;

    /** Client Secret (encriptado con ENCRYPTED: prefix) */
    clientSecret?: string;

    /** Scopes a solicitar */
    scopes: string[];

    /** Redirect URI configurado */
    redirectUri?: string;

    /** Método de autenticación para token endpoint (Fase 3/4) */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;

    /** Indica si las credenciales fueron pre-configuradas vs DCR (Fase 4) */
    isPreConfigured?: boolean;

    /** Credenciales de cliente (de DCR o manual) */
    clientCredentials?: OAuthClientCredentials;
}
```

---

### 4.2 Actualizar `OAuthService.ts`

#### 4.2.1 Añadir método `getPreConfiguredCredentials()` (después de `getClientCredentials`)

**Añadir después del método `getClientCredentials()` (~línea 583):**

```typescript
    /**
     * Obtiene credenciales pre-configuradas desde la config OAuth del servidor MCP
     * (antes de iniciar el flujo OAuth)
     *
     * Estas son credenciales que vienen directamente en la configuración del servidor,
     * no de DCR ni de configuración manual posterior.
     *
     * @param serverId - MCP server ID
     * @returns Credenciales pre-configuradas o null
     */
    private async getPreConfiguredCredentials(
        serverId: string
    ): Promise<OAuthClientCredentials | null> {
        const config = await this.preferencesService.get(
            `mcpServers.${serverId}.oauth`
        ) as OAuthServerConfig | null;

        if (!config) {
            return null;
        }

        // Verificar que tenga credenciales completas pre-configuradas
        // Requiere: clientId + clientSecret + isPreConfigured flag
        if (!config.clientId || !config.clientSecret || !config.isPreConfigured) {
            return null;
        }

        logger.oauth.debug('Found pre-configured credentials', {
            serverId,
            hasAuthServerId: !!config.authServerId,
            authMethod: config.tokenEndpointAuthMethod,
        });

        // Desencriptar clientSecret si está encriptado
        const decryptedSecret = this.decryptIfNeeded(config.clientSecret);

        return {
            clientId: config.clientId,
            clientSecret: decryptedSecret,
            registeredAt: 0, // Pre-configured, no registration timestamp
            authServerId: config.authServerId || '',
            tokenEndpointAuthMethod: config.tokenEndpointAuthMethod ?? 'client_secret_post',
        };
    }

    /**
     * Desencripta un valor si tiene el prefijo ENCRYPTED:
     *
     * @param value - Valor posiblemente encriptado
     * @returns Valor desencriptado
     */
    private decryptIfNeeded(value: string): string {
        if (value.startsWith('ENCRYPTED:')) {
            return safeStorage.decryptString(
                Buffer.from(value.replace('ENCRYPTED:', ''), 'base64')
            );
        }
        return value;
    }
```

#### 4.2.2 Modificar `authorize()` para detectar credenciales pre-configuradas

**En el método `authorize()`, añadir detección de pre-configured ANTES del Step 3.**

**Encontrar la línea que dice:**
```typescript
            // Step 3: Obtener credenciales de cliente
```

**Añadir ANTES de esa línea:**
```typescript
            // Step 2.5: Verificar si hay credenciales pre-configuradas
            const preConfiguredCredentials = await this.getPreConfiguredCredentials(serverId);

            if (preConfiguredCredentials) {
                logger.oauth.info('Step 2.5: Found pre-configured credentials, will skip DCR', {
                    serverId,
                    hasSecret: !!preConfiguredCredentials.clientSecret,
                    authMethod: preConfiguredCredentials.tokenEndpointAuthMethod,
                });
            }

```

**Luego, modificar el CASO A dentro del Step 3 para priorizar pre-configured:**

**Encontrar:**
```typescript
            // CASO A: Credenciales manuales proporcionadas - Skip DCR
            if (params.manualCredentials) {
```

**Reemplazar todo el Step 3 con:**
```typescript
            // Step 3: Obtener credenciales de cliente
            let clientId = providedClientId;
            let clientSecret: string | undefined;
            let tokenEndpointAuthMethod: TokenEndpointAuthMethod = 'none';

            // CASO A: Credenciales manuales proporcionadas en la llamada - Máxima prioridad
            if (params.manualCredentials) {
                logger.oauth.info('Step 3: Using manual client credentials from params (skipping DCR)', {
                    serverId,
                    hasSecret: true,
                    authMethod: params.manualCredentials.tokenEndpointAuthMethod,
                });

                clientId = params.manualCredentials.clientId;
                clientSecret = params.manualCredentials.clientSecret;
                tokenEndpointAuthMethod = params.manualCredentials.tokenEndpointAuthMethod;

                // Guardar credenciales manuales
                await this.saveManualCredentials(serverId, {
                    clientId,
                    clientSecret,
                    tokenEndpointAuthMethod,
                    authServerId,
                });
            }
            // CASO B: Credenciales pre-configuradas en config del servidor
            else if (preConfiguredCredentials) {
                logger.oauth.info('Step 3: Using pre-configured credentials (skipping DCR)', {
                    serverId,
                    hasSecret: !!preConfiguredCredentials.clientSecret,
                    authMethod: preConfiguredCredentials.tokenEndpointAuthMethod,
                });

                clientId = preConfiguredCredentials.clientId;
                clientSecret = preConfiguredCredentials.clientSecret;
                tokenEndpointAuthMethod = preConfiguredCredentials.tokenEndpointAuthMethod ?? 'client_secret_post';
            }
            // CASO C: clientId proporcionado directamente (sin secret)
            else if (clientId) {
                logger.oauth.info('Step 3: Using provided client_id', {
                    clientId: this.sanitizeForLog(clientId),
                });
            }
            // CASO D: Intentar obtener credenciales DCR existentes
            else {
                const existingCredentials = await this.getClientCredentials(serverId);

                if (existingCredentials && this.isClientSecretValid(existingCredentials)) {
                    logger.oauth.info('Step 3: Using existing DCR credentials', {
                        serverId,
                        hasSecret: !!existingCredentials.clientSecret,
                        authMethod: existingCredentials.tokenEndpointAuthMethod,
                    });

                    clientId = existingCredentials.clientId;
                    clientSecret = existingCredentials.clientSecret;
                    tokenEndpointAuthMethod = existingCredentials.tokenEndpointAuthMethod ?? 'none';
                }
                // CASO E: DCR automático como fallback
                else if (this.discoveryService.supportsClientRegistration(metadata)) {
                    logger.oauth.info(
                        'Step 3: No credentials found, attempting Dynamic Client Registration'
                    );

                    try {
                        const credentials =
                            await this.discoveryService.registerClient(
                                metadata.registration_endpoint!,
                                authServerId,
                                {
                                    redirectUris: [redirectUri],
                                    preferConfidential: params.clientTypePreference?.preferConfidential ?? false,
                                    tokenEndpointAuthMethod: params.clientTypePreference?.tokenEndpointAuthMethod,
                                }
                            );

                        clientId = credentials.clientId;
                        clientSecret = credentials.clientSecret;
                        tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod ?? 'none';

                        // Save credentials to preferences (encrypted)
                        await this.saveClientCredentials(serverId, credentials);

                        logger.oauth.info('Dynamic Client Registration successful', {
                            clientId: this.sanitizeForLog(clientId),
                            hasClientSecret: !!clientSecret,
                            authMethod: tokenEndpointAuthMethod,
                        });
                    } catch (registrationError) {
                        // Cleanup redirect server
                        await redirectServer.stop();

                        logger.oauth.error('Dynamic Client Registration failed', {
                            error:
                                registrationError instanceof Error
                                    ? registrationError.message
                                    : registrationError,
                        });

                        return {
                            success: false,
                            error: `Dynamic Client Registration failed: ${registrationError instanceof Error
                                ? registrationError.message
                                : 'Unknown error'
                                }. Manual client configuration is required.`,
                        };
                    }
                } else {
                    // Cleanup redirect server
                    await redirectServer.stop();

                    logger.oauth.warn(
                        'Dynamic Client Registration not supported by Authorization Server'
                    );

                    return {
                        success: false,
                        error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration is required.',
                    };
                }
            }
```

---

## Resumen de Archivos Modificados

### Fase 3

| Archivo | Líneas Aproximadas | Tipo de Cambio |
|---------|-------------------|----------------|
| `types.ts` | +20 líneas después de 555 | Añadir `ManualClientCredentials`, `ClientTypePreference` |
| `OAuthService.ts` | Líneas 27-34 | Actualizar `AuthorizeParams` |
| `OAuthService.ts` | Líneas 17-23 | Actualizar importaciones |
| `OAuthService.ts` | Líneas 129-208 | Reemplazar lógica STEP 3 |
| `OAuthService.ts` | +40 líneas después de 528 | Añadir `saveManualCredentials()` |
| `OAuthService.ts` | +15 líneas | Añadir `isClientSecretValid()` |
| `OAuthService.ts` | +25 líneas después de 444 | Añadir `configureManualCredentials()` |
| `oauthHandlers.ts` | Línea 60 | Registrar nuevo handler |
| `oauthHandlers.ts` | Líneas 77-142 | Actualizar `handleAuthorize` |
| `oauthHandlers.ts` | +45 líneas después de 341 | Añadir `handleConfigureCredentials` |

### Fase 4

| Archivo | Líneas Aproximadas | Tipo de Cambio |
|---------|-------------------|----------------|
| `types.ts` | Líneas 505-512 | Actualizar `OAuthServerConfig` |
| `OAuthService.ts` | +50 líneas después de 583 | Añadir `getPreConfiguredCredentials()`, `decryptIfNeeded()` |
| `OAuthService.ts` | Antes de Step 3 | Añadir detección de pre-configured |
| `OAuthService.ts` | Step 3 completo | Añadir CASO B para pre-configured |

---

## Diagrama de Flujo Actualizado

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE AUTORIZACIÓN                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────┐                                           │
│  │ 1. ¿manualCredentials   │                                           │
│  │    en params?           │                                           │
│  └──────────┬──────────────┘                                           │
│             │                                                           │
│      ┌──────┴──────┐                                                   │
│      │             │                                                   │
│      ▼             ▼                                                   │
│  ┌───────┐    ┌────────────────┐                                       │
│  │  SÍ   │    │       NO       │                                       │
│  └───┬───┘    └───────┬────────┘                                       │
│      │                │                                                │
│      ▼                ▼                                                │
│  ┌────────────┐  ┌────────────────────────┐                           │
│  │ Usar       │  │ 2. ¿Pre-configured     │                           │
│  │ manual     │  │    credentials en      │                           │
│  │ creds      │  │    config del server?  │                           │
│  │ Skip DCR   │  └───────────┬────────────┘                           │
│  └────┬───────┘              │                                        │
│       │            ┌─────────┴────────┐                               │
│       │            │                  │                               │
│       │            ▼                  ▼                               │
│       │       ┌────────┐       ┌───────────┐                          │
│       │       │   SÍ   │       │    NO     │                          │
│       │       └───┬────┘       └─────┬─────┘                          │
│       │           │                  │                                │
│       │           ▼                  ▼                                │
│       │      ┌─────────┐       ┌────────────────┐                     │
│       │      │ Usar    │       │ 3. ¿Existing   │                     │
│       │      │ pre-    │       │    DCR creds?  │                     │
│       │      │ config  │       └───────┬────────┘                     │
│       │      │ Skip DCR│               │                              │
│       │      └────┬────┘       ┌───────┴───────┐                      │
│       │           │            │               │                      │
│       │           │            ▼               ▼                      │
│       │           │       ┌────────┐    ┌───────────┐                 │
│       │           │       │   SÍ   │    │    NO     │                 │
│       │           │       └───┬────┘    └─────┬─────┘                 │
│       │           │           │               │                       │
│       │           │           ▼               ▼                       │
│       │           │      ┌─────────┐    ┌────────────┐                │
│       │           │      │ Usar    │    │ 4. DCR     │                │
│       │           │      │ existing│    │ automático │                │
│       │           │      └────┬────┘    └──────┬─────┘                │
│       │           │           │                │                      │
│       └───────────┴───────────┴────────────────┘                      │
│                               │                                       │
│                               ▼                                       │
│              ┌──────────────────────────────┐                         │
│              │ Authorization Code Flow      │                         │
│              │ (PKCE + auth method)         │                         │
│              └──────────────────────────────┘                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tests Sugeridos

### Tests Fase 3

```typescript
// OAuthService.test.ts
describe('manual credentials flow', () => {
    it('should skip DCR when manual credentials provided', async () => {
        const result = await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
            manualCredentials: {
                clientId: 'my-client-id',
                clientSecret: 'my-client-secret',
                tokenEndpointAuthMethod: 'client_secret_post',
            },
        });

        // Verificar que NO se llamó a registerClient
        expect(discoveryService.registerClient).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('should use client_secret_basic when specified in manual credentials', async () => {
        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
            manualCredentials: {
                clientId: 'client',
                clientSecret: 'secret',
                tokenEndpointAuthMethod: 'client_secret_basic',
            },
        });

        // Verificar que el token request usa Basic Auth
        const tokenCall = fetchMock.mock.calls.find(c => c[0].includes('/token'));
        expect(tokenCall[1].headers['Authorization']).toContain('Basic ');
    });

    it('should save manual credentials with isPreConfigured flag', async () => {
        await oauthService.configureManualCredentials({
            serverId: 'test-server',
            clientId: 'my-client',
            clientSecret: 'my-secret',
            tokenEndpointAuthMethod: 'client_secret_post',
        });

        const saved = await preferencesService.get('mcpServers.test-server.oauth');
        expect(saved.isPreConfigured).toBe(true);
        expect(saved.tokenEndpointAuthMethod).toBe('client_secret_post');
    });
});
```

### Tests Fase 4

```typescript
// OAuthService.test.ts
describe('pre-configured credentials', () => {
    it('should skip DCR when pre-configured credentials exist', async () => {
        // Setup: pre-configure credentials
        await preferencesService.set('mcpServers.test-server.oauth', {
            enabled: true,
            clientId: 'pre-configured-client',
            clientSecret: 'ENCRYPTED:...', // Would be actual encrypted value
            tokenEndpointAuthMethod: 'client_secret_post',
            isPreConfigured: true,
            authServerId: 'https://auth.example.com',
            scopes: ['mcp:read'],
        });

        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
        });

        // Verificar que NO se llamó a registerClient
        expect(discoveryService.registerClient).not.toHaveBeenCalled();
    });

    it('should use pre-configured auth method in token request', async () => {
        await preferencesService.set('mcpServers.test-server.oauth', {
            enabled: true,
            clientId: 'client',
            clientSecret: 'ENCRYPTED:...', // Encrypted secret
            tokenEndpointAuthMethod: 'client_secret_basic',
            isPreConfigured: true,
            authServerId: 'https://auth.example.com',
            scopes: [],
        });

        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
        });

        // Verificar que el token request usa Basic Auth
        const tokenCall = fetchMock.mock.calls.find(c => c[0].includes('/token'));
        expect(tokenCall[1].headers['Authorization']).toContain('Basic ');
    });

    it('should fallback to DCR if pre-configured flag is false', async () => {
        await preferencesService.set('mcpServers.test-server.oauth', {
            enabled: true,
            clientId: 'client',
            clientSecret: 'secret',
            isPreConfigured: false, // NOT pre-configured
            authServerId: 'https://auth.example.com',
            scopes: [],
        });

        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
        });

        // Verificar que SÍ se llamó a registerClient (fallback DCR)
        expect(discoveryService.registerClient).toHaveBeenCalled();
    });
});
```

---

## Consideraciones de Seguridad

1. **Encriptación**: Todos los `client_secret` se encriptan con `safeStorage` antes de persistir
2. **No logs**: Nunca loguear valores de secrets, solo indicadores booleanos (`hasSecret: true`)
3. **Memoria**: Los secrets desencriptados solo existen en memoria durante el flujo OAuth
4. **Transporte**: Solo HTTPS para endpoints de token (excepto localhost)
5. **Validación**: Verificar expiración de secrets antes de cada uso

---

## Orden de Implementación Recomendado

1. **Primero**: Actualizar `types.ts` (ambas fases)
2. **Segundo**: Implementar Fase 3 en `OAuthService.ts` (nuevos métodos)
3. **Tercero**: Actualizar `oauthHandlers.ts` (nuevo handler)
4. **Cuarto**: Implementar Fase 4 en `OAuthService.ts` (pre-configured detection)
5. **Quinto**: Tests unitarios
6. **Sexto**: Tests de integración

---

**Creado**: 2025-12-28
**Basado en**: PLAN-private-client-support.md v1.0.0
