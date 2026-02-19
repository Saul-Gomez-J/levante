/**
 * Utilidades de diff para la herramienta Edit.
 * Adaptado de pi-mono/packages/coding-agent
 */

import { createPatch } from "diff";

export interface FuzzyMatchResult {
  found: boolean;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  confidence: number;
}

/**
 * Buscar texto con tolerancia a whitespace
 */
export function fuzzyFindText(content: string, searchText: string): FuzzyMatchResult {
  // Intento 1: búsqueda exacta
  let index = content.indexOf(searchText);
  if (index !== -1) {
    return {
      found: true,
      startIndex: index,
      endIndex: index + searchText.length,
      matchedText: searchText,
      confidence: 1.0,
    };
  }

  // Intento 2: normalizar whitespace y buscar
  const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();
  const normalizedSearch = normalizeWs(searchText);

  // Buscar en el contenido normalizado
  const normalizedContent = normalizeWs(content);
  const normalizedIndex = normalizedContent.indexOf(normalizedSearch);

  if (normalizedIndex !== -1) {
    // Encontrar posición real en contenido original
    // Esto es aproximado - buscar la mejor coincidencia
    const lines = content.split("\n");
    const searchLines = searchText.split("\n").map(l => l.trim()).filter(l => l);

    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const candidateLines = lines.slice(i, i + searchLines.length);
      const candidateNorm = candidateLines.map(l => l.trim()).join(" ");

      if (candidateNorm === searchLines.join(" ")) {
        const startIdx = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
        const endIdx = startIdx + candidateLines.join("\n").length;

        return {
          found: true,
          startIndex: startIdx,
          endIndex: endIdx,
          matchedText: content.slice(startIdx, endIdx),
          confidence: 0.9,
        };
      }
    }
  }

  return {
    found: false,
    startIndex: -1,
    endIndex: -1,
    matchedText: "",
    confidence: 0,
  };
}

/**
 * Generar diff entre dos strings
 */
export function generateDiffString(
  oldContent: string,
  newContent: string,
  filename: string = "file"
): string {
  const patch = createPatch(filename, oldContent, newContent, "", "");

  // Remover header del patch (primeras 2 líneas)
  const lines = patch.split("\n");
  return lines.slice(2).join("\n");
}

/**
 * Contar líneas cambiadas en un diff
 */
export function countDiffChanges(diff: string): { added: number; removed: number } {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }

  return { added, removed };
}
