# API Feedback: Bundle endpoint — incluir todos los archivos en `files`

**Para:** Developer de la API de skills (`http://localhost:5180`)
**Endpoint afectado:** `GET /api/skills/:category/:name/bundle`

---

## Contexto

Desde Levante consumimos el endpoint `/bundle` para descargar e instalar skills localmente. El objetivo es que Levante replique en disco la estructura exacta de archivos de la skill, sin tener que inferir ni inventar ningún nombre.

---

## Problema actual

La respuesta actual del endpoint tiene esta forma:

```json
{
  "id": "development/remotion-best-practices",
  "name": "remotion-best-practices",
  "description": "...",
  "category": "development",
  "content": "## When to use\n\n...",   ← contenido de SKILL.md, sin nombre de archivo
  "files": {
    "rules/3d.md": "...",
    "rules/animations.md": "...",
    "rules/assets.md": "..."
    // ...39 archivos compañeros
  }
}
```

El archivo principal (`SKILL.md`) llega como un campo especial `content` sin nombre de archivo. Los archivos compañeros (`rules/*.md`) sí vienen en `files` con su ruta relativa como clave.

Esto obliga a Levante a **inventar el nombre** del archivo principal. Hemos usado `{name}.md` pero el estándar real es `SKILL.md`. Cualquier nombre que pongamos nosotros es una suposición nuestra, y puede no coincidir con el estándar o cambiar en el futuro.

---

## Lo que pedimos

Que el endpoint incluya **todos los archivos de la skill dentro de `files`**, incluyendo el archivo principal, con su ruta relativa real como clave:

```json
{
  "id": "development/remotion-best-practices",
  "name": "remotion-best-practices",
  "description": "...",
  "category": "development",
  "files": {
    "SKILL.md": "## When to use\n\n...",   ← archivo principal con su nombre real
    "rules/3d.md": "...",
    "rules/animations.md": "...",
    "rules/assets.md": "..."
    // ...todos los archivos
  }
}
```

El campo `content` puede mantenerse por retrocompatibilidad si hay otros consumidores, pero **la fuente de verdad para la instalación debe ser `files`**.

---

## Por qué es importante

Con `files` como lista completa:

1. **Levante no necesita conocer la convención de nombres** — solo itera `files` y escribe cada entrada en `{skillDir}/{ruta}`.
2. **El estándar de estructura lo controla el servidor**, no el cliente — si el nombre cambia de `SKILL.md` a otro en el futuro, Levante no necesita ningún cambio.
3. **Consistencia garantizada** — el directorio instalado en disco es un espejo exacto de lo que define el servidor.
4. **Eliminamos asunciones en el cliente** — actualmente Levante asume que `bundle.content` corresponde a un archivo llamado `SKILL.md`. Si esa asunción es incorrecta para alguna skill, la instalación queda mal silenciosamente.

---

## Estructura esperada en disco tras la instalación

Con el cambio propuesto, Levante simplemente haría:

```
for (const [relativePath, content] of Object.entries(bundle.files)) {
  write( path.join(skillDir, relativePath), content )
}
```

Y el resultado en disco sería exactamente:

```
.levante/skills/development/remotion-best-practices/
├── SKILL.md
└── rules/
    ├── 3d.md
    ├── animations.md
    └── ...
```

---

## Resumen del cambio solicitado

| | Antes | Después |
|---|---|---|
| Archivo principal | Campo separado `content` (sin nombre) | `files["SKILL.md"]` |
| Archivos compañeros | `files["rules/3d.md"]`, etc. | Sin cambio |
| Lógica en Levante | Inferir nombre del archivo principal | Solo iterar `files` |
