# PR: Refactor Store Navigation — Separación coherente entre instalados y tienda

## Contexto

Actualmente existe una inconsistencia de UX entre la sección de MCPs y la de Skills:

- **MCPs** (`store-layout.tsx`): muestra en la misma vista los servidores instalados **y** el catálogo (tienda). Son dos secciones apiladas verticalmente en la misma pantalla.
- **Skills** (`SkillsPage.tsx`): muestra en una única vista todas las skills (instaladas y disponibles para instalar), mezcladas en una sola rejilla con badges de estado de instalación.

Ninguna de las dos sigue un patrón claro de "estoy viendo lo que tengo instalado" vs. "estoy explorando la tienda". Este PR unifica el modelo de navegación para ambas secciones.

---

## Objetivo

Crear una navegación coherente y simétrica para MCPs y Skills:

- **Vista por defecto**: muestra únicamente los items instalados/activos.
- **Vista tienda**: catálogo completo navegable, accesible mediante un botón explícito.
- El cambio entre vista instalados ↔ tienda se hace con un botón de acción, no con tabs ni scroll.

---

## Diseño de la navegación

### Estructura de la página

```
┌─────────────────────────────────────────────────────────────────┐
│  [  MCP  ]   [  Skills  ]                         [Ver tienda]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Vista "Instalados" (defecto)                                  │
│   ────────────────────────────                                 │
│   Lista de MCPs activos / Skills instaladas                     │
│   – cada item con sus controles de gestión                     │
│   – placeholder si no hay nada instalado                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Al pulsar **"Ver tienda"**:

```
┌─────────────────────────────────────────────────────────────────┐
│  [  MCP  ]   [  Skills  ]                               [Back]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Tienda / Catálogo                                             │
│   ──────────────────                                           │
│   Filtros + búsqueda                                            │
│   Rejilla de items disponibles                                  │
│   – cada item con botón "Instalar"                             │
│   – badge si ya está instalado                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Reglas de comportamiento

| Interacción | Resultado |
|---|---|
| Cambiar de tab MCP ↔ Skills | Se mantiene el modo actual (instalados o tienda); solo cambia la sección de contenido |
| Pulsar "Ver tienda" | Entra en vista tienda de la sección activa |
| Pulsar "Back" | Vuelve a vista instalados de la sección activa |
| Instalar un item desde la tienda | Se instala; el badge de estado se actualiza en la tarjeta sin salir de la tienda |
| Deep link `mcp-add` o `skill-install` | Navega al store, abre directamente la vista tienda con el modal correspondiente |

---

## Estado actual de cada componente afectado

### `src/renderer/pages/StorePage.tsx`
- Gestiona la tab activa (`mcps` | `skills`).
- Renderiza `<StoreLayout />` para MCPs y `<SkillsPage />` para Skills.
- **Cambio requerido**: añadir estado `installed: boolean` (verdadero = vista instalados, falso = tienda) y pasarlo como prop a `StoreLayout` y `SkillsPage`. Renderizar el botón "Ver tienda" / "Back" en la cabecera de la página desde este componente.

### `src/renderer/components/mcp/store-page/store-layout.tsx`
- Vista única con dos secciones apiladas: "Installed servers" + catálogo de entradas disponibles.
- **Cambio requerido**: extraer las dos secciones en dos vistas independientes:
  - `InstalledMCPView`: sólo servidores activos (actualmente la primera sección).
  - `MCPCatalogView` (o `MCPStoreView`): sólo el catálogo filtrable (actualmente la segunda sección).
- `StoreLayout` renderiza una u otra en función del prop `installed`.

### `src/renderer/pages/SkillsPage.tsx`
- Vista única que muestra todas las skills (instaladas y no instaladas) con badges de estado.
- Incluye filtros de categoría, búsqueda y filtro de scope.
- **Cambio requerido**: extraer en dos vistas independientes:
  - `InstalledSkillsView`: muestra únicamente las skills que tienen al menos una instalación (`isInstalledAnywhere(skill.id) === true`). Permite desinstalar desde aquí.
  - `SkillsCatalogView` (o `SkillsStoreView`): catálogo completo con filtros y botón "Instalar". Muestra badge si ya está instalada en algún scope.
- `SkillsPage` renderiza una u otra según el prop `installed`.

---

## Componentes a modificar

### `StorePage.tsx`

**Nuevo estado:**
```tsx
const [activeSection, setActiveSection] = useState<'mcps' | 'skills'>('mcps');
const [installed, setInstalled] = useState(true);

// Al cambiar de tab se mantiene el modo instalados/tienda actual
const handleSectionChange = (section: 'mcps' | 'skills') => {
  setActiveSection(section);
};
```

**Nueva cabecera:**
```tsx
<div className="flex items-center justify-between">
  {/* Tabs */}
  <div className="flex gap-2">
    <Button
      variant={activeSection === 'mcps' ? 'default' : 'ghost'}
      onClick={() => handleSectionChange('mcps')}
    >
      MCP
    </Button>
    <Button
      variant={activeSection === 'skills' ? 'default' : 'ghost'}
      onClick={() => handleSectionChange('skills')}
    >
      Skills
    </Button>
  </div>

  {/* Toggle instalados / tienda */}
  <Button
    variant="outline"
    onClick={() => setInstalled(prev => !prev)}
  >
    {installed ? t('store.viewStore') : t('store.back')}
  </Button>
</div>
```

**Internacionalización** (claves i18n a añadir):
```json
"store.viewStore": "Ver tienda",
"store.back": "Volver"
```
```json
"store.viewStore": "See store",
"store.back": "Back"
```

---

### `store-layout.tsx`

**Prop nueva:**
```tsx
interface StoreLayoutProps {
  installed: boolean;
}
```

**Lógica de renderizado:**
```tsx
if (installed) {
  return <InstalledMCPView />;
}

return <MCPCatalogView />;
```

`InstalledMCPView` y `MCPCatalogView` son componentes internos extraídos del código actual de `store-layout.tsx`.

**`InstalledMCPView` contiene:**
- La lista de `activeServers` con `IntegrationCard mode="active"`.
- Botones de toggle, configure y delete por servidor.
- Estado vacío si no hay servidores instalados con CTA "Ver tienda".
- Botón para añadir servidor personalizado (JSON / manual).

**`MCPCatalogView` contiene:**
- `ProviderFilter` para source y categoría.
- Búsqueda.
- Grid de `IntegrationCard mode="store"` con entradas del catálogo.
- Las entradas ya instaladas muestran badge "Instalado" pero siguen apareciendo.

---

### `SkillsPage.tsx`

**Prop nueva:**
```tsx
interface SkillsPageProps {
  installed: boolean;
}
```

**Lógica de renderizado:**
```tsx
if (installed) {
  return <InstalledSkillsView />;
}

return <SkillsCatalogView />;
```

**`InstalledSkillsView` contiene:**
- Filtro de scope (`All | Global | <proyecto>`).
- Grid de `SkillCard` únicamente para skills con `isInstalledAnywhere(skill.id) === true`.
- Cada tarjeta muestra los badges de scope actuales y el botón "Desinstalar".
- Estado vacío si no hay skills instaladas con CTA "Ver tienda".

**`SkillsCatalogView` contiene:**
- Buscador + `SkillCategoryFilter`.
- Grid completo del catálogo (`catalog` del store).
- `SkillCard` con badge "Instalado en X scope(s)" si ya está instalada.
- Botón "Instalar" llama a los mismos modales de scope existentes.

---

## Deep links — ajuste necesario

En `App.tsx`, los manejadores de deep links que navegan a la store deben activar `installed = false` para abrir directamente la tienda:

```tsx
// Actualmente:
setCurrentPage('store');

// Después del refactor:
setCurrentPage('store');
setStoreInstalledView(false); // nueva acción expuesta desde StorePage o via contexto/store
```

Alternativa más sencilla: pasar el estado como parámetro de navegación al `StorePage` via la acción `setCurrentPage` con payload `{ section: 'mcps' | 'skills', installed: boolean }`.

---

## Archivos afectados (resumen)

| Archivo | Tipo de cambio |
|---|---|
| `src/renderer/pages/StorePage.tsx` | Añadir estado `installed`, renderizar botón Ver tienda / Back, pasar prop a hijos |
| `src/renderer/components/mcp/store-page/store-layout.tsx` | Recibir prop `installed`, extraer `InstalledMCPView` y `MCPCatalogView` |
| `src/renderer/pages/SkillsPage.tsx` | Recibir prop `installed`, extraer `InstalledSkillsView` y `SkillsCatalogView` |
| `src/renderer/App.tsx` | Actualizar navegación de deep links para pasar `installed: false` |
| Archivos i18n (`en.json`, `es.json`) | Añadir claves `store.viewStore` y `store.back` |

### Archivos que NO deben cambiar (sólo consumen props)
- `SkillCard.tsx`
- `SkillDetailsModal.tsx`
- `SkillInstallScopeModal.tsx`
- `SkillUninstallScopeModal.tsx`
- `integration-card.tsx`
- `provider-filter.tsx`
- `mcpStore.ts`
- `skillsStore.ts`

---

## Criterios de aceptación

- [ ] Al entrar en la página "Store", la vista por defecto es "Instalados" tanto para MCPs como para Skills.
- [ ] El botón "Ver tienda" es visible en la cabecera cuando se está en vista instalados.
- [ ] Al pulsar "Ver tienda", la vista cambia al catálogo y el botón pasa a mostrar "Volver" / "Back".
- [ ] Al pulsar "Back", se regresa a la vista instalados.
- [ ] Al cambiar de tab (MCP ↔ Skills), el modo se mantiene: si estabas en instalados ves los instalados de la otra sección; si estabas en tienda ves la tienda de la otra sección.
- [ ] Los MCPs instalados sólo aparecen en la vista instalados; los no instalados sólo en la tienda. Los ya instalados en la tienda muestran badge pero no se ocultan.
- [ ] Las Skills instaladas aparecen en la vista instalados; el catálogo completo aparece en la tienda con badge de estado si ya están instaladas.
- [ ] Los deep links que activan instalación de MCP o Skill abren directamente la vista tienda.
- [ ] Los filtros (búsqueda, categoría, scope) se mantienen dentro de su vista correspondiente.
- [ ] El estado vacío de "Instalados" tiene un CTA que lleva a la tienda.
- [ ] Las traducciones en ES y EN están completas.

---

## Notas de implementación

1. **No es necesario crear un nuevo router** — el estado `installed` puede vivir en `StorePage` como estado local React (`useState`). No se necesita persistencia entre sesiones.
2. **Los modales de instalación no cambian** — `SkillInstallScopeModal`, `SkillUninstallScopeModal`, `MCPDeepLinkModal` siguen funcionando igual.
3. **Orden recomendado de implementación**:
   1. Modificar `StorePage` (añadir estado + botón).
   2. Refactorizar `store-layout.tsx` (extraer las dos vistas).
   3. Refactorizar `SkillsPage.tsx` (extraer las dos vistas).
   4. Ajustar deep links en `App.tsx`.
   5. Añadir claves i18n.
   6. Tests / typecheck.
