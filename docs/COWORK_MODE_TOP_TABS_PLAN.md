# Plan de Implementación: Mover Botón Cowork Mode a la Parte Superior

## Objetivo

Mover el botón de activación del modo Cowork desde el dropdown de `ToolsMenu` (icono de engranaje en la barra de herramientas del input) a la **parte superior de la pantalla** como un selector de tabs estilo pill, tal como se muestra en la imagen de referencia:

```
┌──────────────────────────────┐
│   [ Chat ]  [ Cowork ]      │
└──────────────────────────────┘
```

**Alcance:**
- Solo el botón de activación (toggle on/off) se mueve al tab superior
- El selector de directorio (CWD) y las configuraciones de cowork permanecen en el `ToolsMenu` dropdown
- No se incluye el tab "Código" (solo Chat y Cowork)

---

## Archivos a Modificar

| # | Archivo | Acción | Descripción |
|---|---------|--------|-------------|
| 1 | `src/renderer/components/chat/ChatModeTabs.tsx` | **CREAR** | Nuevo componente de tabs Chat/Cowork |
| 2 | `src/renderer/pages/ChatPage.tsx` | **MODIFICAR** | Renderizar ChatModeTabs en la parte superior |
| 3 | `src/renderer/components/chat/ToolsMenu.tsx` | **MODIFICAR** | Eliminar toggle switch de cowork del dropdown |
| 4 | `src/renderer/locales/en/chat.json` | **MODIFICAR** | Agregar strings i18n para tabs |
| 5 | `src/renderer/locales/es/chat.json` | **MODIFICAR** | Agregar strings i18n para tabs |

---

## Paso 1: Crear el componente `ChatModeTabs`

**Archivo:** `src/renderer/components/chat/ChatModeTabs.tsx` (NUEVO)

Este componente usa el `Tabs` existente de shadcn/ui (Radix UI) para mantener consistencia visual con el resto de la app.

```tsx
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';

interface ChatModeTabsProps {
  coworkMode: boolean;
  onCoworkModeChange: (enabled: boolean) => void;
}

export function ChatModeTabs({ coworkMode, onCoworkModeChange }: ChatModeTabsProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex justify-center py-2">
      <Tabs
        value={coworkMode ? 'cowork' : 'chat'}
        onValueChange={(value) => onCoworkModeChange(value === 'cowork')}
      >
        <TabsList>
          <TabsTrigger value="chat">
            {t('mode_tabs.chat', 'Chat')}
          </TabsTrigger>
          <TabsTrigger value="cowork">
            {t('mode_tabs.cowork', 'Cowork')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
```

**Justificación del diseño:**
- Usa `Tabs`/`TabsList`/`TabsTrigger` de `@radix-ui/react-tabs` (ya existe en `src/renderer/components/ui/tabs.tsx`)
- El estilo por defecto de `TabsList` ya produce el look pill con fondo `bg-muted`, bordes redondeados `rounded-lg`, y padding `p-1`
- El `TabsTrigger` activo tiene `bg-background text-foreground shadow` — exactamente como la imagen de referencia
- Solo 2 tabs: "Chat" (cowork OFF) y "Cowork" (cowork ON)
- Centrado horizontalmente con `justify-center`
- No usa `TabsContent` porque no hay contenido asociado a las tabs — solo cambia el estado

---

## Paso 2: Integrar ChatModeTabs en ChatPage

**Archivo:** `src/renderer/pages/ChatPage.tsx`

### 2.1 Agregar import

Agregar al bloque de imports (después de la línea 30):

```diff
 import { ChatPromptInput } from '@/components/chat/ChatPromptInput';
 import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
+import { ChatModeTabs } from '@/components/chat/ChatModeTabs';
 import { useTranslation } from 'react-i18next';
```

### 2.2 Renderizar el componente de tabs

En el JSX del return, insertar `ChatModeTabs` **después del error display y antes del contenido** (después de la línea 1091, antes de `{isChatEmpty ? (`):

```diff
           })()}
+          {/* Mode tabs: Chat / Cowork */}
+          <ChatModeTabs
+            coworkMode={coworkMode ?? false}
+            onCoworkModeChange={setCoworkMode}
+          />
           {isChatEmpty ? (
             // Empty state with welcome screen
```

### Resultado visual en el layout:

```
┌─ TopBar (MainLayout header) ────────────────────────────┐
│  [Nav buttons] [Page Title]  ...  [Settings] [Menu]     │
├──────────────────────────────────────────────────────────┤
│              [ Chat ]  [ Cowork ]                        │  ← NUEVO
├──────────────────────────────────────────────────────────┤
│  [Welcome/Chat content]                                  │
│  ...                                                     │
│  ┌─ ChatPromptInput (bottom) ──────────────────────────┐ │
│  │ [Text input]                                         │ │
│  │ [ToolsMenu] [AddContext] | [ModelSelect] [Submit]   │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## Paso 3: Eliminar el toggle de Cowork del ToolsMenu dropdown

**Archivo:** `src/renderer/components/chat/ToolsMenu.tsx`

### 3.1 Eliminar la fila del toggle switch de cowork

Eliminar las líneas 159-178 (el div clickable con el toggle switch):

```diff
         <DropdownMenuContent align="start" className="w-72">
-          {/* Cowork Mode Toggle */}
-          <div
-            className="flex items-center justify-between rounded-sm px-3 py-2 hover:bg-accent cursor-pointer"
-            onClick={() => onCoworkModeChange(!coworkMode)}
-          >
-            <div className="flex items-center gap-2">
-              <Code2 size={16} className="text-muted-foreground" />
-              <span className="text-sm">{t('tools_menu.cowork.label', 'Cowork')}</span>
-              {coworkMode && (
-                <Badge variant="secondary" className={cn("text-xs", coworkModeCwd ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>
-                  {t('tools_menu.cowork.active', 'active')}
-                </Badge>
-              )}
-            </div>
-            <Switch
-              checked={coworkMode}
-              onCheckedChange={onCoworkModeChange}
-              onClick={(e) => e.stopPropagation()}
-            />
-          </div>
           {/* Cowork Directory Selector - only show when cowork is enabled */}
           {coworkMode && (
```

**Lo que se mantiene en el ToolsMenu:**
- El selector de directorio (CWD) — líneas 180-225 — sigue visible cuando cowork está ON
- El indicador externo (pill azul/ámbar) — líneas 264-293 — sigue funcionando
- El BackgroundTasksDropdown — línea 296-298 — sigue funcionando
- Los toggles de Skills y MCP — sin cambios

### 3.2 Limpiar imports no usados (opcional)

Si `Switch` ya no se usa en el componente por otro motivo, podría eliminarse del import. Pero `Switch` se sigue usando para Skills y MCP toggles, así que se mantiene.

Sin embargo, `Code2` solo se usaba en el toggle de cowork (línea 165) y en el indicador externo (líneas 281, 289). Verificar que sigue usándose antes de eliminar.

→ **`Code2` SÍ se sigue usando** en el indicador externo (líneas 281 y 289), así que no se elimina.

---

## Paso 4: Agregar strings i18n

### 4.1 Inglés

**Archivo:** `src/renderer/locales/en/chat.json`

Agregar nuevo bloque `mode_tabs` al nivel raíz (después de `"welcome"` y antes de `"actions"`):

```diff
   "welcome": {
     "greeting": "How's your day going, {{userName}}?",
     "greeting_default": "How's your day going?",
     "default_user_name": "User"
   },
+  "mode_tabs": {
+    "chat": "Chat",
+    "cowork": "Cowork"
+  },
   "actions": {
```

### 4.2 Español

**Archivo:** `src/renderer/locales/es/chat.json`

Agregar nuevo bloque `mode_tabs` al nivel raíz (después de `"welcome"` y antes de `"actions"`):

```diff
   "welcome": {
     "greeting": "¿Qué tal tu día, {{userName}}?",
     "greeting_default": "¿Qué tal tu día?",
     "default_user_name": "Usuario"
   },
+  "mode_tabs": {
+    "chat": "Chat",
+    "cowork": "Cowork"
+  },
   "actions": {
```

> Nota: "Chat" y "Cowork" son nombres propios/branding, se mantienen iguales en ambos idiomas.

---

## Paso 5: Verificación

Ejecutar `pnpm typecheck` para verificar que no hay errores de TypeScript.

### Checklist de verificación manual:

- [ ] Las tabs "Chat" y "Cowork" aparecen centradas en la parte superior del área de chat
- [ ] Al hacer clic en "Cowork", se activa `coworkMode` (la preferencia se persiste)
- [ ] Al hacer clic en "Chat", se desactiva `coworkMode`
- [ ] El indicador externo (pill azul/ámbar) sigue apareciendo cuando cowork está ON
- [ ] El selector de directorio sigue accesible desde el dropdown de Settings (gear icon)
- [ ] El BackgroundTasksDropdown sigue apareciendo cuando cowork está ON
- [ ] El toggle de cowork ya NO aparece en el dropdown de Settings
- [ ] Las tabs se muestran correctamente en tema claro y oscuro
- [ ] i18n funciona correctamente en inglés y español

---

## Flujo de Props Actualizado

```
ChatPage
├── coworkMode (usePreference)
├── setCoworkMode (usePreference)
│
├── ChatModeTabs                    ← NUEVO (parte superior)
│   ├── coworkMode
│   └── onCoworkModeChange → setCoworkMode
│
└── ChatPromptInput                 ← (parte inferior, sin cambios)
    └── ToolsMenu
        ├── coworkMode (read-only, para mostrar dir selector)
        ├── onCoworkModeChange      ← YA NO SE USA PARA TOGGLE
        ├── coworkModeCwd
        ├── onCoworkModeCwdChange
        ├── coworkModeCwdSource
        └── onResetCoworkModeCwdOverride
```

> **Nota:** `onCoworkModeChange` sigue pasándose al ToolsMenu por compatibilidad de la interfaz, pero ya no se llama dentro del dropdown. Se podría eliminar del ToolsMenu en una limpieza futura, pero no es necesario para este cambio.

---

## Resumen de Cambios por Archivo

### `src/renderer/components/chat/ChatModeTabs.tsx` (NUEVO — 23 líneas)
- Componente funcional con Radix Tabs
- 2 tabs: "Chat" y "Cowork"
- Props: `coworkMode`, `onCoworkModeChange`

### `src/renderer/pages/ChatPage.tsx` (+4 líneas)
- +1 línea import
- +3 líneas JSX (componente + props)

### `src/renderer/components/chat/ToolsMenu.tsx` (-20 líneas)
- Eliminar bloque del toggle switch (líneas 159-178)

### `src/renderer/locales/en/chat.json` (+4 líneas)
- Agregar `mode_tabs.chat` y `mode_tabs.cowork`

### `src/renderer/locales/es/chat.json` (+4 líneas)
- Agregar `mode_tabs.chat` y `mode_tabs.cowork`

**Total: 1 archivo nuevo, 4 archivos modificados, ~35 líneas añadidas, ~20 eliminadas**
