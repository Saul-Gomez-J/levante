/**
 * Script de prueba para el sistema Winston Logger
 *
 * Ejecutar desde el main process después de iniciar la app
 * o crear un IPC handler temporal para ejecutarlo desde renderer
 */

import { getLogger, setLogTimezone } from '../src/main/services/logging';

export function testWinstonLogging() {
  const logger = getLogger();

  console.log('\n=== INICIANDO PRUEBAS DE WINSTON LOGGER ===\n');

  // Test 1: Todas las categorías
  console.log('Test 1: Probando todas las categorías...');
  logger.aiSdk.debug('Test AI SDK debug', { provider: 'test' });
  logger.mcp.info('Test MCP info', { serverId: 'test-server' });
  logger.database.warn('Test Database warn', { query: 'SELECT *' });
  logger.ipc.error('Test IPC error', { channel: 'test-channel' });
  logger.preferences.debug('Test Preferences debug', { key: 'theme' });
  logger.models.info('Test Models info', { modelCount: 10 });
  logger.core.info('Test Core info', { status: 'ok' });
  logger.analytics.debug('Test Analytics debug', { event: 'test' });
  logger.oauth.info('Test OAuth info', { serverId: 'test' });

  // Test 2: Todos los niveles
  console.log('\nTest 2: Probando todos los niveles...');
  logger.core.debug('Nivel DEBUG - información detallada');
  logger.core.info('Nivel INFO - información general');
  logger.core.warn('Nivel WARN - advertencia');
  logger.core.error('Nivel ERROR - error crítico');

  // Test 3: Contexto complejo
  console.log('\nTest 3: Probando contexto complejo...');
  logger.aiSdk.info('Mensaje con contexto complejo', {
    nested: {
      object: {
        with: 'multiple',
        levels: [1, 2, 3]
      }
    },
    array: ['item1', 'item2', 'item3'],
    number: 42,
    boolean: true,
    null: null,
    undefined: undefined
  });

  // Test 4: Timezone
  console.log('\nTest 4: Probando timezone...');
  logger.core.info('Log con timezone auto (sistema local)');

  setLogTimezone('America/New_York');
  logger.core.info('Log con timezone America/New_York');

  setLogTimezone('Europe/Madrid');
  logger.core.info('Log con timezone Europe/Madrid');

  setLogTimezone('Asia/Tokyo');
  logger.core.info('Log con timezone Asia/Tokyo');

  // Restaurar a auto
  setLogTimezone('auto');
  logger.core.info('Timezone restaurado a auto');

  // Test 5: Generación masiva (para probar rotación)
  console.log('\nTest 5: Generando logs masivos para probar rotación...');
  console.log('Generando 1000 logs...');
  for (let i = 0; i < 1000; i++) {
    logger.core.debug(`Log masivo #${i}`, {
      iteration: i,
      timestamp: Date.now(),
      data: 'X'.repeat(100) // 100 caracteres de padding
    });
  }
  console.log('✓ 1000 logs generados');

  // Test 6: Errores con stack traces
  console.log('\nTest 6: Probando errores con stack traces...');
  try {
    throw new Error('Error de prueba intencional');
  } catch (error) {
    logger.core.error('Error capturado', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    });
  }

  console.log('\n=== PRUEBAS COMPLETADAS ===');
  console.log('\nVerifica los archivos de log en: ~/levante/');
  console.log('Comando: ls -lh ~/levante/*.log');
  console.log('Ver contenido: tail -f ~/levante/levante-*.log');
}

// Exportar para usar en otros lugares
export default testWinstonLogging;
