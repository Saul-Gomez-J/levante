// Timezone global compartida (migrado de transports.ts)
let globalTimezone: string = 'auto';

/**
 * Configurar timezone global para todos los logs
 * @param timezone Identificador IANA (ej: 'Europe/Madrid') o 'auto' para sistema
 */
export function setLogTimezone(timezone: string): void {
  globalTimezone = timezone;
}

/**
 * Obtener timezone configurada
 */
export function getLogTimezone(): string {
  return globalTimezone;
}

/**
 * Formatear timestamp con timezone configurada
 * Migrado de transports.ts líneas 28-58
 */
export function formatTimestampWithTimezone(timestamp: Date, timezone: string): string {
  try {
    if (timezone === 'auto' || !timezone) {
      // Usar hora local del sistema
      const year = timestamp.getFullYear();
      const month = String(timestamp.getMonth() + 1).padStart(2, '0');
      const day = String(timestamp.getDate()).padStart(2, '0');
      const hours = String(timestamp.getHours()).padStart(2, '0');
      const minutes = String(timestamp.getMinutes()).padStart(2, '0');
      const seconds = String(timestamp.getSeconds()).padStart(2, '0');
      return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
    }

    // Usar timezone IANA especificado
    const formatted = timestamp.toLocaleString('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(',', '');

    return `[${formatted}]`;
  } catch {
    // Fallback a ISO si timezone inválido
    return `[${timestamp.toISOString().replace('T', ' ').slice(0, -5)}]`;
  }
}
