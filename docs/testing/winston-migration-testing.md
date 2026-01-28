# Guía de Pruebas - Migración a Winston Logger

Esta guía documenta cómo probar la migración del sistema de logging a Winston.

## 🎯 Objetivos de las Pruebas

- ✅ Verificar logs en consola (desarrollo)
- ✅ Verificar archivos de log generados
- ✅ Probar rotación de archivos
- ✅ Verificar zero overhead para categorías deshabilitadas
- ✅ Probar timezone
- ✅ Verificar comportamiento en producción (JSON estructurado)

## 📋 Pre-requisitos

1. Compilar la aplicación: `pnpm build`
2. Tener configurado `.env.local` o `.env`

## 1️⃣ Configuración Inicial

### Desarrollo (Verbose)

Crea `.env.local` en la raíz del proyecto:

```bash
# Habilitar todos los logs
DEBUG_ENABLED=true
DEBUG_AI_SDK=true
DEBUG_MCP=true
DEBUG_DATABASE=true
DEBUG_IPC=true
DEBUG_PREFERENCES=true
DEBUG_MODELS=true
DEBUG_CORE=true
DEBUG_ANALYTICS=true
DEBUG_OAUTH=true
LOG_LEVEL=debug

# Archivos de log
LOG_TO_FILE=true
LOG_FILE_PATH=levante.log

# Rotación (1MB para testing rápido)
LOG_MAX_SIZE=1048576
LOG_MAX_FILES=3
LOG_MAX_AGE=7
LOG_COMPRESS=false
LOG_DATE_PATTERN=YYYY-MM-DD-HHmmss
```

### Producción (Minimal)

```bash
NODE_ENV=production
DEBUG_ENABLED=true  # Solo errors y warns
LOG_LEVEL=warn
LOG_TO_FILE=true
LOG_COMPRESS=true
LOG_MAX_SIZE=52428800  # 50MB
LOG_MAX_FILES=10
LOG_MAX_AGE=30
```

## 2️⃣ Ubicación de Archivos de Log

Los logs se guardan en: `~/levante/`

```bash
# Ver archivos
ls -lh ~/levante/

# Output esperado en desarrollo:
# levante-2025-01-28-143025.log
# .winston-audit.json

# Output esperado en producción:
# levante-2025-01-28-143025.log       (todos los logs)
# levante-error-2025-01-28-143025.log (solo errores)
# .winston-audit.json
# .winston-error-audit.json
```

## 3️⃣ Pruebas de Consola (Desarrollo)

### Iniciar la Aplicación

1. Compilar: `pnpm build`
2. Ejecutar el binario generado

### Verificaciones en Consola

Deberías ver logs coloreados:

```
[2025-01-28 14:30:25] [CORE] [INFO] Application initialized
[2025-01-28 14:30:26] [AI-SDK] [DEBUG] Model provider loaded
{
  "provider": "openai",
  "models": 15
}
```

✅ **Checklist**:
- [ ] Logs tienen timestamps con timezone
- [ ] Categorías en mayúsculas entre corchetes
- [ ] Niveles (DEBUG, INFO, WARN, ERROR) coloreados
- [ ] Contexto en JSON formateado
- [ ] Colores ANSI funcionando

## 4️⃣ Pruebas de Archivos de Log

### Ver Logs en Tiempo Real

```bash
# Ver todos los logs
tail -f ~/levante/levante-*.log

# Filtrar por categoría
tail -f ~/levante/levante-*.log | grep "AI-SDK"

# Filtrar por nivel
tail -f ~/levante/levante-*.log | grep "ERROR"
```

### Verificar Formato

**Desarrollo** (legible):
```
[2025-01-28 14:30:25] [CORE] [INFO] Application started
```

**Producción** (JSON):
```json
{
  "timestamp": "2025-01-28T14:30:25.123Z",
  "level": "info",
  "category": "core",
  "message": "Application started"
}
```

✅ **Checklist**:
- [ ] Archivo se crea automáticamente
- [ ] Formato correcto según entorno
- [ ] Timestamps incluidos
- [ ] Contexto se guarda correctamente

## 5️⃣ Pruebas de Rotación

### Forzar Rotación Rápida

1. Configurar tamaño pequeño: `LOG_MAX_SIZE=1048576` (1MB)
2. Usar la app intensivamente o ejecutar script de prueba
3. Verificar múltiples archivos:

```bash
ls -lh ~/levante/levante-*.log

# Deberías ver:
# levante-2025-01-28-143025.log  (actual)
# levante-2025-01-28-142530.log  (rotado 1)
# levante-2025-01-28-141045.log  (rotado 2)
```

### Verificar Audit File

```bash
cat ~/levante/.winston-audit.json
```

Deberías ver JSON con tracking de todos los archivos rotados.

### Verificar Compresión (Producción)

```bash
ls -lh ~/levante/*.gz

# Deberías ver archivos comprimidos:
# levante-2025-01-27-120000.log.gz
```

✅ **Checklist**:
- [ ] Se crean múltiples archivos al superar maxSize
- [ ] Audit file existe y es JSON válido
- [ ] Archivos viejos se eliminan según maxAge
- [ ] Compresión funciona en producción

## 6️⃣ Pruebas de Categorías (Zero Overhead)

### Test: Deshabilitar Categoría

1. Editar `.env.local`:
   ```bash
   DEBUG_AI_SDK=false
   ```

2. Reiniciar app

3. Verificar:
   - ❌ No hay logs `[AI-SDK]` en consola
   - ❌ No hay logs `[AI-SDK]` en archivo
   - ✅ Otras categorías funcionan

### Test: Cambiar Nivel

1. Editar `.env.local`:
   ```bash
   LOG_LEVEL=warn
   ```

2. Reiniciar app

3. Verificar:
   - ❌ No hay logs DEBUG
   - ❌ No hay logs INFO
   - ✅ Hay logs WARN
   - ✅ Hay logs ERROR

✅ **Checklist**:
- [ ] Categorías deshabilitadas no logean
- [ ] Nivel de log filtra correctamente
- [ ] Otras categorías no afectadas

## 7️⃣ Pruebas de Timezone

### Cambiar Timezone Programáticamente

En el main process:

```typescript
import { setLogTimezone } from './services/logging';

// Probar diferentes timezones
setLogTimezone('America/New_York');  // EDT/EST
setLogTimezone('Europe/Madrid');     // CET/CEST
setLogTimezone('Asia/Tokyo');        // JST
setLogTimezone('auto');              // Sistema local
```

### Verificar Timestamps

Verifica que los timestamps reflejan la timezone correcta:

```bash
tail -f ~/levante/levante-*.log
```

✅ **Checklist**:
- [ ] `auto` usa hora del sistema
- [ ] Timezones IANA funcionan correctamente
- [ ] Formato timestamp consistente

## 8️⃣ Script de Pruebas Automatizado

Ejecuta el script de pruebas creado:

```typescript
// En cualquier parte del main process donde tengas acceso
import testWinstonLogging from '../scripts/test-winston-logging';

// Ejecutar todas las pruebas
testWinstonLogging();
```

Este script prueba:
- ✅ Todas las categorías
- ✅ Todos los niveles
- ✅ Contexto complejo
- ✅ Timezone
- ✅ Generación masiva (rotación)
- ✅ Errores con stack traces

## 9️⃣ Pruebas de Producción

### Configurar Producción

```bash
NODE_ENV=production pnpm build
```

### Verificaciones Específicas de Producción

1. **No hay consola**:
   - ❌ No deberías ver logs en stdout/stderr

2. **Dos archivos**:
   ```bash
   ls ~/levante/levante-*.log
   # levante-YYYY-MM-DD-HHMMSS.log        (all logs)
   # levante-error-YYYY-MM-DD-HHMMSS.log  (only errors)
   ```

3. **JSON estructurado**:
   ```bash
   tail -n 1 ~/levante/levante-*.log | jq .
   ```
   Debe mostrar JSON válido.

4. **Solo warns y errors**:
   ```bash
   grep -E '"level":"(debug|info)"' ~/levante/levante-*.log
   ```
   No debería encontrar nada (solo warn/error en prod).

5. **Compresión**:
   ```bash
   ls ~/levante/*.gz
   ```
   Archivos antiguos deberían estar comprimidos.

✅ **Checklist Producción**:
- [ ] Sin salida a consola
- [ ] Dos archivos (all + errors)
- [ ] Formato JSON estructurado
- [ ] Solo level warn y error
- [ ] Compresión gzip funciona
- [ ] Categorías verbose deshabilitadas

## 🔍 Verificación de Compatibilidad

### API Sin Cambios

Verifica que el siguiente código funciona sin modificaciones:

```typescript
import { getLogger } from './services/logging';
const logger = getLogger();

// Mismo API que antes
logger.aiSdk.debug('Test', { key: 'value' });
logger.mcp.info('Server started');
logger.core.error('Critical error', { error });

// Timezone
import { setLogTimezone } from './services/logging';
setLogTimezone('America/New_York');

// Configuration
logger.configure({
  level: 'warn',
  categories: { 'ai-sdk': false }
});
```

✅ **Checklist**:
- [ ] Imports sin cambios
- [ ] Métodos de logging sin cambios
- [ ] Configuración sin cambios
- [ ] Timezone sin cambios

## 📊 Métricas de Éxito

### Performance (Zero Overhead)

Crea un test de performance simple:

```typescript
// Categoría habilitada
console.time('enabled-10k');
for (let i = 0; i < 10000; i++) {
  logger.core.info('Test', { i });
}
console.timeEnd('enabled-10k');
// Esperado: < 500ms

// Categoría deshabilitada
logger.configure({ categories: { 'ai-sdk': false } });
console.time('disabled-10k');
for (let i = 0; i < 10000; i++) {
  logger.aiSdk.debug('Test', { i });
}
console.timeEnd('disabled-10k');
// Esperado: < 5ms (zero overhead)
```

✅ **Métricas Esperadas**:
- Categoría habilitada: < 500ms para 10k logs
- Categoría deshabilitada: < 5ms para 10k logs (99% reducción)

## ✅ Checklist Final

- [ ] Typecheck pasa sin errores
- [ ] App inicia correctamente
- [ ] Logs en consola (desarrollo)
- [ ] Archivos de log creados
- [ ] Rotación funciona
- [ ] Zero overhead verificado
- [ ] Timezone funciona
- [ ] Producción: JSON estructurado
- [ ] Producción: sin consola
- [ ] Producción: archivo de errores separado
- [ ] Compatibilidad API 100%

## 🐛 Troubleshooting

### No se crean archivos de log

1. Verificar `LOG_TO_FILE=true`
2. Verificar permisos en `~/levante/`
3. Verificar que `directoryService` funciona

### Logs no aparecen en consola

1. Verificar `DEBUG_ENABLED=true`
2. Verificar categoría habilitada
3. Verificar `LOG_LEVEL`

### Errores de Winston

Revisar logs del sistema:
```bash
tail -f ~/levante/levante-*.log | grep -i winston
```

## 📚 Referencias

- [Plan de Implementación](../../docs/research/winston-migration-plan.md)
- [Documentación Logging](../LOGGING.md)
- [Winston Documentation](https://github.com/winstonjs/winston)
- [Winston Daily Rotate File](https://github.com/winstonjs/winston-daily-rotate-file)
