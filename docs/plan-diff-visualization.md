# Runbook de Implementación: Visualización de Diff para `write` y `edit`

## 1. Objetivo

Implementar una visualización de diff (líneas añadidas/eliminadas con color) para resultados de herramientas de código:

- `write` (backend + frontend)
- `edit` (frontend, porque ya genera diff en backend)

La visualización debe aparecer en el Sheet lateral del componente `ToolCall`, con opción de alternar a vista JSON cruda (`Raw`).

Este runbook está escrito para ejecución directa por otra IA: incluye contexto, decisiones obligatorias, pasos exactos, código final y pruebas.

---

## 2. Alcance y No-Alcance

### Alcance (sí implementar)

- Generar diff en `write.ts` leyendo contenido previo antes de sobrescribir.
- Renderizar diff visual en frontend para `write` y `edit`.
- Evitar falsos positivos de diff en caso de "sin cambios reales".
- Mantener fallback a vista JSON/CodeMirror para cualquier otro tool result.
- Incluir pruebas mínimas automáticas y validación manual.

### No-alcance (no tocar)

- No cambiar el modelado actual de éxito/error de `tool-call` en UI.
- No refactorizar `aiService.ts` ni `ElectronChatTransport.ts` más allá de esta feature.
- No añadir dependencias externas para renderizado de diff.

---

## 3. Contexto técnico actual (base real del repo)

### Backend

- `src/main/services/ai/codingTools/tools/write.ts`:
  - escribe archivo directamente con `writeFile`.
  - no lee contenido previo.
  - no genera `diff`, `linesAdded`, `linesRemoved`.
- `src/main/services/ai/codingTools/tools/edit.ts`:
  - sí genera `diff` con `generateDiffString`.
  - sí calcula `linesAdded` y `linesRemoved`.
- `src/main/services/ai/codingTools/tools/edit-diff.ts`:
  - `generateDiffString` usa `createPatch(...)` y hace `slice(2)`.
  - resultado incluye headers `---`/`+++` aunque no haya cambios reales.
  - `countDiffChanges` cuenta solo líneas `+` y `-` de contenido real.

### Frontend

- `src/renderer/components/ai-elements/tool-call.tsx`:
  - `ResultSection` renderiza todo en CodeMirror.
  - no hay componente de diff visual.
  - no distingue herramientas `write`/`edit` para render.

### Observación crítica obligatoria

En diffs de "sin cambios", el string puede no estar vacío por los headers `---`/`+++`.  
Por eso **NO** se puede usar `diff.trim().length > 0` como criterio de "hay cambios reales".

---

## 4. Decisiones de diseño obligatorias

1. Detección de cambios reales:
   - usar `linesAdded > 0 || linesRemoved > 0` como criterio principal.
   - no usar longitud del string diff como criterio principal.

2. Scope de render diff en UI:
   - mostrar DiffViewer solo para tools `write` o `edit`.
   - para otros tools, mantener renderer genérico actual.

3. Consistencia parser/render:
   - líneas `---` y `+++` deben ignorarse visualmente en DiffViewer.
   - si solo existen headers y no hay hunks, mostrar "Sin cambios detectados".

4. Robustez de lectura en `write.ts`:
   - ignorar solo `ENOENT` al leer archivo previo.
   - cualquier otro error de lectura debe propagarse (no silenciarse).

5. Rendimiento:
   - en `ResultSection`, evaluar branch diff antes de serializar JSON para CodeMirror.
   - evitar `JSON.stringify` pesado cuando no se usará (vista diff activa).

6. Dependencias:
   - no añadir nuevas dependencias.
   - parser de unified diff implementado localmente.

---

## 5. Archivos a modificar/crear

### Modificar

- `src/main/services/ai/codingTools/tools/write.ts`
- `src/renderer/components/ai-elements/tool-call.tsx`

### Crear

- `src/renderer/components/ai-elements/diff-viewer.tsx`
- `src/main/services/ai/codingTools/tools/write.test.ts`
- `src/main/services/ai/codingTools/tools/edit-diff.test.ts`

---

## 6. Implementación paso a paso

## Paso 1: Backend `write.ts` genera diff de forma segura

### Archivo

`src/main/services/ai/codingTools/tools/write.ts`

### Cambios exactos

1. Añadir import de `readFile`.
2. Añadir import de `generateDiffString` y `countDiffChanges`.
3. Antes de `writeFile`, intentar leer contenido previo:
   - si error `ENOENT`, tratar como archivo nuevo (`previousContent = ""`).
   - si error distinto, re-lanzar (`throw`).
4. Tras escribir, generar diff y métricas.
5. Devolver `diff`, `linesAdded`, `linesRemoved` en la respuesta.

### Código final completo esperado

```typescript
/**
 * Herramienta Write: escribir archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { resolveToCwd } from "../utils/path-utils";
import { countDiffChanges, generateDiffString } from "./edit-diff";

export interface WriteToolConfig {
  cwd: string;
}

export function createWriteTool(config: WriteToolConfig) {
  return tool({
    description: `Write content to a file. Creates parent directories if needed.
The file_path must be an absolute path or relative to the current directory.
IMPORTANT: This will overwrite existing files. Always read a file first before writing if it exists.`,

    inputSchema: z.object({
      file_path: z.string().describe("The path to the file to write"),
      content: z.string().describe("The content to write to the file"),
    }),

    execute: async ({ file_path, content }: { file_path: string; content: string }) => {
      try {
        const resolvedPath = resolveToCwd(file_path, config.cwd);

        // Leer contenido previo solo para generar diff.
        // Ignorar únicamente ENOENT (archivo no existe todavía).
        let previousContent = "";
        try {
          previousContent = await readFile(resolvedPath, "utf8");
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") {
            throw error;
          }
        }

        // Crear directorio padre si no existe
        await mkdir(dirname(resolvedPath), { recursive: true });

        // Escribir archivo
        await writeFile(resolvedPath, content, "utf8");

        const lines = content.split("\n").length;
        const bytes = Buffer.byteLength(content, "utf8");

        // Generar diff y métricas de cambios
        const diff = generateDiffString(previousContent, content, file_path);
        const changes = countDiffChanges(diff);

        return {
          success: true,
          path: resolvedPath,
          diff,
          linesAdded: changes.added,
          linesRemoved: changes.removed,
          message: `Successfully wrote ${lines} lines (${bytes} bytes) to ${file_path}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to write file: ${message}`,
        };
      }
    },
  });
}
```

---

## Paso 2: Crear `DiffViewer` para unified diff

### Archivo

`src/renderer/components/ai-elements/diff-viewer.tsx`

### Requisitos obligatorios del parser

- `+` (no `+++`) => línea añadida.
- `-` (no `---`) => línea eliminada.
- `@@ ... @@` => header de hunk.
- espacio inicial => contexto.
- `---`, `+++`, `Index:`, `===` => ignorar visualmente.
- si tras parsear no hay líneas renderizables => mostrar "Sin cambios detectados".

### Código completo esperado

```typescript
import { cn } from '@/lib/utils';

type DiffLineType = 'added' | 'removed' | 'context' | 'hunk';

interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffViewerProps {
  diff: string;
  className?: string;
}

function shouldIgnoreLine(line: string): boolean {
  return (
    line.startsWith('---') ||
    line.startsWith('+++') ||
    line.startsWith('Index:') ||
    line.startsWith('===') ||
    line.startsWith('\\ No newline at end of file')
  );
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const parsed: DiffLine[] = [];

  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (!line) continue;
    if (shouldIgnoreLine(line)) continue;

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = Number.parseInt(match[1], 10);
        newLineNum = Number.parseInt(match[2], 10);
      }
      parsed.push({ type: 'hunk', content: line });
      continue;
    }

    if (line.startsWith('+')) {
      parsed.push({
        type: 'added',
        content: line.slice(1),
        newLineNum: newLineNum++,
      });
      continue;
    }

    if (line.startsWith('-')) {
      parsed.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNum: oldLineNum++,
      });
      continue;
    }

    if (line.startsWith(' ')) {
      parsed.push({
        type: 'context',
        content: line.slice(1),
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    }
  }

  return parsed;
}

export function DiffViewer({ diff, className }: DiffViewerProps) {
  const lines = parseUnifiedDiff(diff || '');

  if (lines.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-3 py-2">
        Sin cambios detectados
      </div>
    );
  }

  return (
    <div className={cn('rounded-md border overflow-hidden font-mono text-xs', className)}>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              if (line.type === 'hunk') {
                return (
                  <tr key={idx} className="bg-blue-50 dark:bg-blue-950/30">
                    <td
                      colSpan={3}
                      className="px-3 py-0.5 text-blue-600 dark:text-blue-400 select-none text-[10px]"
                    >
                      {line.content}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={idx}
                  className={cn(
                    line.type === 'added' && 'bg-green-50 dark:bg-green-950/30',
                    line.type === 'removed' && 'bg-red-50 dark:bg-red-950/30',
                    line.type === 'context' && 'bg-background',
                  )}
                >
                  <td
                    className={cn(
                      'w-10 px-2 py-0 text-right select-none border-r text-[10px]',
                      'text-muted-foreground/50',
                      line.type === 'added' &&
                        'border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-950/50',
                      line.type === 'removed' &&
                        'border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-950/50',
                      line.type === 'context' && 'border-border/50',
                    )}
                  >
                    {line.oldLineNum ?? ''}
                  </td>

                  <td
                    className={cn(
                      'w-10 px-2 py-0 text-right select-none border-r text-[10px]',
                      'text-muted-foreground/50',
                      line.type === 'added' &&
                        'border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-950/50',
                      line.type === 'removed' &&
                        'border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-950/50',
                      line.type === 'context' && 'border-border/50',
                    )}
                  >
                    {line.newLineNum ?? ''}
                  </td>

                  <td className="px-2 py-0 whitespace-pre">
                    <span
                      className={cn(
                        'mr-2 select-none font-bold',
                        line.type === 'added' && 'text-green-600 dark:text-green-400',
                        line.type === 'removed' && 'text-red-600 dark:text-red-400',
                        line.type === 'context' && 'text-muted-foreground/30',
                      )}
                    >
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    <span
                      className={cn(
                        line.type === 'added' && 'text-green-900 dark:text-green-100',
                        line.type === 'removed' && 'text-red-900 dark:text-red-100',
                        line.type === 'context' && 'text-foreground/80',
                      )}
                    >
                      {line.content}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Paso 3: Actualizar `tool-call.tsx` para branch diff robusto y eficiente

### Archivo

`src/renderer/components/ai-elements/tool-call.tsx`

### 3.1 Añadir import

Añadir:

```typescript
import { DiffViewer } from '@/components/ai-elements/diff-viewer';
```

### 3.2 Pasar nombre de tool a `ResultSection`

Buscar:

```tsx
<ResultSection result={toolCall.result} />
```

Reemplazar por:

```tsx
<ResultSection result={toolCall.result} toolName={toolCall.name} />
```

### 3.3 Reemplazar `ResultSection` completa

Requisitos obligatorios:

- Detectar diff solo en tools `write` o `edit`.
- Criterio de cambios reales:
  - principal: `linesAdded > 0 || linesRemoved > 0`.
  - fallback: si no hay métricas numéricas, detectar hunk `@@`.
- Hacer early return del branch diff antes de serialización JSON pesada.
- Mantener vista JSON/CodeMirror original para todo lo demás.

Código completo esperado:

```typescript
function ResultSection({
  result,
  toolName,
}: {
  result: NonNullable<ToolCallData['result']>;
  toolName: string;
}) {
  const theme = useThemeDetector();
  const [wrapEnabled, setWrapEnabled] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const content = result.success ? result.content : result.error;

  const normalizedToolName = (toolName || '').trim().toLowerCase();
  const isDiffTool = normalizedToolName === 'write' || normalizedToolName === 'edit';

  const objectContent =
    typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : null;

  const diffText = typeof objectContent?.diff === 'string' ? objectContent.diff : '';
  const linesAdded = typeof objectContent?.linesAdded === 'number' ? objectContent.linesAdded : null;
  const linesRemoved =
    typeof objectContent?.linesRemoved === 'number' ? objectContent.linesRemoved : null;
  const pathValue = typeof objectContent?.path === 'string' ? objectContent.path : '';

  const hasChangeCounters = linesAdded !== null && linesRemoved !== null;
  const hasRealChangesFromCounters = hasChangeCounters && (linesAdded > 0 || linesRemoved > 0);
  const hasRealChangesFromHunk = !hasChangeCounters && /(^|\n)@@ /.test(diffText);
  const hasRealDiffChanges = hasRealChangesFromCounters || hasRealChangesFromHunk;

  const canRenderDiff =
    result.success &&
    isDiffTool &&
    diffText.trim().length > 0 &&
    hasRealDiffChanges;

  const copyDiffToClipboard = () => {
    if (diffText) {
      navigator.clipboard.writeText(diffText);
    }
  };

  const shortPath = pathValue
    ? pathValue.split(/[\\/]/).slice(-2).join('/')
    : '';

  // Branch temprano: evita serializar JSON pesado cuando se muestra diff.
  if (canRenderDiff && !showRawJson) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
            Cambios en archivo
          </h4>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRawJson(true)}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Raw
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyDiffToClipboard}
              className="gap-2"
              title="Copiar diff"
            >
              <Copy className="w-4 h-4" />
              Copiar
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {linesAdded !== null && linesAdded > 0 && (
            <span className="text-green-600 dark:text-green-400 font-medium">
              +{linesAdded} añadidas
            </span>
          )}
          {linesRemoved !== null && linesRemoved > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              -{linesRemoved} eliminadas
            </span>
          )}
          {shortPath && (
            <span
              className="text-muted-foreground ml-auto font-mono truncate max-w-[220px]"
              title={pathValue}
            >
              {shortPath}
            </span>
          )}
        </div>

        <DiffViewer diff={diffText} />
      </div>
    );
  }

  // Vista genérica original (JSON/texto)
  let isJSON = false;
  let contentString = '';

  if (typeof content === 'object' && content !== null) {
    isJSON = true;
    contentString = JSON.stringify(content, null, 2);
  } else if (typeof content === 'string') {
    const trimmed = content.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        isJSON = true;
        contentString = JSON.stringify(parsed, null, 2);
      } catch {
        isJSON = false;
        contentString = content;
      }
    } else {
      contentString = content;
    }
  } else {
    contentString = String(content || '');
  }

  const lineCount = contentString.split('\n').length;
  const adaptiveHeight = Math.min(Math.max(lineCount * 20, 300), 600);
  const fullscreenHeight = Math.min(Math.max(lineCount * 20, 600), 2000);

  const copyToClipboard = () => {
    if (contentString) {
      navigator.clipboard.writeText(contentString);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          {result.success ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              Resultado
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              Error
            </>
          )}
        </h4>
        <div className="flex gap-2">
          {canRenderDiff && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRawJson(false)}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Diff
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWrapEnabled(!wrapEnabled)}
            className={cn('gap-2', wrapEnabled && 'bg-accent')}
            title={wrapEnabled ? 'Desactivar ajuste de línea' : 'Activar ajuste de línea'}
          >
            <WrapText className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFullscreenOpen(true)}
            className="gap-2"
            title="Vista completa"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={copyToClipboard} className="gap-2">
            <Copy className="w-4 h-4" />
            Copiar
          </Button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <CodeMirror
          value={contentString}
          height={`${adaptiveHeight}px`}
          extensions={
            isJSON
              ? wrapEnabled
                ? [json(), EditorView.lineWrapping]
                : [json()]
              : wrapEnabled
                ? [EditorView.lineWrapping]
                : []
          }
          theme={theme === 'dark' ? oneDark : 'light'}
          editable={false}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: false,
            highlightActiveLine: false,
            foldGutter: true,
            bracketMatching: true,
            autocompletion: false,
          }}
        />
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-[90vw] h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {result.success ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  Resultado - Vista Completa
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  Error - Vista Completa
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 flex flex-col gap-3 overflow-auto">
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWrapEnabled(!wrapEnabled)}
                className={cn('gap-2', wrapEnabled && 'bg-accent')}
                title={wrapEnabled ? 'Desactivar ajuste de línea' : 'Activar ajuste de línea'}
              >
                <WrapText className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={copyToClipboard} className="gap-2">
                <Copy className="w-4 h-4" />
                Copiar
              </Button>
            </div>

            <div className="border rounded-md overflow-hidden">
              <CodeMirror
                value={contentString}
                height={`${fullscreenHeight}px`}
                extensions={
                  isJSON
                    ? wrapEnabled
                      ? [json(), EditorView.lineWrapping]
                      : [json()]
                    : wrapEnabled
                      ? [EditorView.lineWrapping]
                      : []
                }
                theme={theme === 'dark' ? oneDark : 'light'}
                editable={false}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: false,
                  highlightActiveLine: false,
                  foldGutter: true,
                  bracketMatching: true,
                  autocompletion: false,
                }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

## Paso 4: Tests automáticos mínimos obligatorios

No existen tests previos para `codingTools` en este repo.  
Se deben crear estos dos archivos para cubrir la parte crítica de esta feature.

## 4.1 Test de `write.ts`

### Archivo nuevo

`src/main/services/ai/codingTools/tools/write.test.ts`

### Casos a cubrir

1. Archivo nuevo:
   - `linesAdded` > 0
   - `linesRemoved` = 0
   - `diff` contiene hunk.

2. Sobrescribir archivo existente con cambios:
   - `linesAdded` y/o `linesRemoved` reflejan cambios.

3. Sobrescribir con contenido idéntico:
   - `linesAdded` = 0
   - `linesRemoved` = 0
   - `diff` puede tener headers, pero sin cambios contados.

4. Error de lectura distinto de `ENOENT`:
   - no se silencia.
   - resultado `success: false`.

### Código completo sugerido

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWriteTool } from './write';

describe('createWriteTool', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'write-tool-test-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('genera diff para archivo nuevo', async () => {
    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'a.txt',
      content: 'linea1\nlinea2\n',
    });

    expect(result.success).toBe(true);
    expect(result.linesAdded).toBeGreaterThan(0);
    expect(result.linesRemoved).toBe(0);
    expect(result.diff).toContain('@@');

    const finalContent = await readFile(join(cwd, 'a.txt'), 'utf8');
    expect(finalContent).toBe('linea1\nlinea2\n');
  });

  it('genera diff para archivo existente con cambios', async () => {
    await writeFile(join(cwd, 'b.txt'), 'uno\ndos\n', 'utf8');

    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'b.txt',
      content: 'uno\ntres\n',
    });

    expect(result.success).toBe(true);
    expect((result.linesAdded ?? 0) + (result.linesRemoved ?? 0)).toBeGreaterThan(0);
    expect(result.diff).toContain('@@');
  });

  it('reporta cero cambios cuando el contenido es idéntico', async () => {
    await writeFile(join(cwd, 'same.txt'), 'igual\n', 'utf8');

    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'same.txt',
      content: 'igual\n',
    });

    expect(result.success).toBe(true);
    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
  });

  it('no silencia errores de lectura distintos de ENOENT', async () => {
    await mkdir(join(cwd, 'dir-as-file'), { recursive: true });

    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'dir-as-file',
      content: 'contenido',
    });

    expect(result.success).toBe(false);
    expect(String(result.error || '')).toContain('Failed to write file');
  });
});
```

## 4.2 Test de utilidades de diff

### Archivo nuevo

`src/main/services/ai/codingTools/tools/edit-diff.test.ts`

### Casos a cubrir

1. Diff sin cambios:
   - string no vacío (headers posibles).
   - `countDiffChanges` retorna 0/0.

2. Diff con cambios:
   - `added` y `removed` correctos.

### Código completo sugerido

```typescript
import { describe, expect, it } from 'vitest';
import { countDiffChanges, generateDiffString } from './edit-diff';

describe('edit-diff utilities', () => {
  it('countDiffChanges devuelve 0/0 cuando no hay cambios reales', () => {
    const diff = generateDiffString('hola\n', 'hola\n', 'a.txt');
    const counts = countDiffChanges(diff);

    expect(diff.length).toBeGreaterThan(0);
    expect(counts.added).toBe(0);
    expect(counts.removed).toBe(0);
  });

  it('countDiffChanges cuenta líneas añadidas y eliminadas', () => {
    const diff = generateDiffString('a\nb\n', 'a\nc\n', 'a.txt');
    const counts = countDiffChanges(diff);

    expect(counts.added).toBeGreaterThan(0);
    expect(counts.removed).toBeGreaterThan(0);
  });
});
```

---

## Paso 5: Validación manual obligatoria en UI

### Preparación

1. Ejecutar app en modo dev.
2. Abrir chat con coding tools habilitadas.
3. Usar prompts que disparen `write` y `edit`.

### Escenarios manuales

1. `write` creando archivo nuevo:
   - en drawer de tool call aparece vista diff.
   - líneas añadidas en verde.
   - contador `+N` visible.

2. `write` sobrescribiendo con cambios:
   - aparecen líneas verdes/rojas.
   - `+N/-N` correcto.
   - botón `Raw` cambia a JSON.
   - botón `Diff` vuelve al visualizador.

3. `write` con contenido idéntico:
   - NO debe entrar automáticamente a vista diff.
   - debe mostrarse vista genérica (JSON/CodeMirror) o "Sin cambios" solo si se llega al viewer.

4. `edit` con cambios:
   - debe renderizar diff visual igual que `write`.

5. tool distinto (ej. `bash`, `read`):
   - debe mantener render genérico de siempre.
   - no debe intentar usar DiffViewer aunque exista campo `diff` incidental.

---

## 7. Comandos de verificación

Ejecutar después de implementar:

```bash
pnpm typecheck
pnpm lint
pnpm test src/main/services/ai/codingTools/tools/write.test.ts src/main/services/ai/codingTools/tools/edit-diff.test.ts
```

Si `pnpm test` no acepta rutas múltiples en esta configuración, ejecutar:

```bash
pnpm test
```

---

## 8. Criterios de aceptación (Definition of Done)

La feature se considera lista solo si se cumplen todos:

1. `write.ts` devuelve `diff`, `linesAdded`, `linesRemoved` sin silenciar errores de lectura no-ENOENT.
2. Existe `DiffViewer` y renderiza unified diff con colores.
3. `tool-call.tsx` muestra diff solo para `write`/`edit`.
4. No hay falso positivo de diff por usar longitud de string.
5. No hay inconsistencia con headers `---/+++` (se ignoran visualmente).
6. Branch diff evita serialización JSON pesada cuando está activo.
7. Typecheck, lint y tests pasan.
8. Validación manual de los 5 escenarios completada.

---

## 9. Notas de implementación importantes

- Mantener idioma UI en español donde ya existe (botones: `Copiar`, `Raw`, `Diff`).
- No introducir dependencias nuevas de visualización.
- No modificar el comportamiento actual de estado `success/error` de `tool-call` (queda explícitamente fuera de alcance en este runbook).
- Si durante implementación aparece un archivo no contemplado por este plan, documentar el motivo del cambio en el PR.

