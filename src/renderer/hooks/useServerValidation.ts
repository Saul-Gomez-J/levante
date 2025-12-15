import { useState, useEffect } from 'react';
import type { MCPServerConfig } from '@/types/mcp';
import type { ValidationResult, TrustLevel } from '@/constants/mcpSecurity';
import { OFFICIAL_MCP_PACKAGES } from '@/constants/mcpSecurity';

/**
 * Hook to validate MCP server configuration
 */
export function useServerValidation(config: Partial<MCPServerConfig> | null): ValidationResult {
  const [validation, setValidation] = useState<ValidationResult>({
    structureValid: false,
    trustLevel: 'unknown',
    warnings: [],
    errors: []
  });

  useEffect(() => {
    if (!config) {
      setValidation({
        structureValid: true,
        trustLevel: 'unknown',
        warnings: ['This server will execute with your system permissions'],
        errors: []
      });
      return;
    }

    // Determine trust level
    let trustLevel: TrustLevel = 'unknown';
    let isOfficialPackage = false;

    if (config.transport === 'stdio' && config.args && config.args.length > 0) {
      const packageName = config.args[0];
      isOfficialPackage = OFFICIAL_MCP_PACKAGES.includes(packageName as any);

      if (isOfficialPackage) {
        trustLevel = 'verified-official';
      } else if (packageName.startsWith('@modelcontextprotocol/')) {
        trustLevel = 'community';
      }
    }

    const warnings = ['This server will execute with your system permissions'];

    setValidation({
      structureValid: true,
      isOfficialPackage,
      trustLevel,
      warnings,
      errors: []
    });
  }, [config]);

  return validation;
}
