# Arquitectura de Eventos: Guia Completa

Este documento explica en profundidad cómo funciona una arquitectura basada en eventos, desde los conceptos más básicos hasta la implementación real.

---

## Indice

1. [El Problema que Resuelve](#1-el-problema-que-resuelve)
2. [Conceptos Fundamentales](#2-conceptos-fundamentales)
3. [Implementacion Paso a Paso](#3-implementacion-paso-a-paso)
4. [Que Ocurre Cuando Llamas subscribe()](#4-que-ocurre-cuando-llamas-subscribe)
5. [Que Ocurre Cuando Se Emite un Evento](#5-que-ocurre-cuando-se-emite-un-evento)
6. [Flujo Completo con Diagramas](#6-flujo-completo-con-diagramas)
7. [Comparacion con Codigo Tradicional](#7-comparacion-con-codigo-tradicional)
8. [Patrones Avanzados](#8-patrones-avanzados)
9. [Cuando Usar y Cuando No](#9-cuando-usar-y-cuando-no)

---

## 1. El Problema que Resuelve

### Codigo Tradicional (Acoplado)

Imagina que tienes un sistema de chat. Cuando llega un mensaje, quieres:
1. Guardarlo en la base de datos
2. Mostrarlo en la UI
3. Enviar analytics
4. Notificar a otros usuarios

**Sin eventos, el codigo se ve asi:**

```typescript
class ChatService {

  async processMessage(message: Message) {
    // El ChatService CONOCE y DEPENDE de todos estos servicios
    await this.database.save(message);
    await this.ui.render(message);
    await this.analytics.track(message);
    await this.notifications.send(message);
  }
}
```

**Problemas:**

```
┌─────────────────────────────────────────────────────────────┐
│                      ChatService                            │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│         ▼                 ▼                 ▼               │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐           │
│   │ Database │     │    UI    │     │Analytics │    ...    │
│   └──────────┘     └──────────┘     └──────────┘           │
│                                                             │
│   ChatService CONOCE a todos sus consumidores               │
│   Si agregas uno nuevo, modificas ChatService               │
│   Si uno falla, puede afectar a los demas                   │
└─────────────────────────────────────────────────────────────┘
```

### Con Eventos (Desacoplado)

```typescript
class ChatService {

  async processMessage(message: Message) {
    // El ChatService NO CONOCE a nadie
    // Solo dice "paso esto" y quien quiera escuchar, escucha
    this.emit({ type: "message_received", message });
  }
}

// En otro lugar, quien quiera escuchar:
chatService.subscribe((event) => {
  if (event.type === "message_received") {
    database.save(event.message);
  }
});
```

**Ventajas:**

```
┌─────────────────────────────────────────────────────────────┐
│                      ChatService                            │
│                           │                                 │
│                     emit(event)                             │
│                           │                                 │
│                           ▼                                 │
│                    ┌─────────────┐                          │
│                    │  Event Bus  │  (lista de funciones)    │
│                    └─────────────┘                          │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐               │
│         ▼                 ▼                 ▼               │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐           │
│   │ Database │     │    UI    │     │Analytics │           │
│   └──────────┘     └──────────┘     └──────────┘           │
│                                                             │
│   ChatService NO CONOCE a nadie                             │
│   Agregar consumidores no requiere modificar ChatService    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Conceptos Fundamentales

### 2.1 Los Tres Actores

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   EMISOR              CANAL               SUSCRIPTOR        │
│   (Publisher)         (Event Bus)         (Subscriber)      │
│                                                             │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐        │
│   │  Agent  │ ─────► │  Lista  │ ─────► │Listener │        │
│   └─────────┘        │   de    │        └─────────┘        │
│                      │funciones│        ┌─────────┐        │
│   Genera eventos     │         │ ─────► │Listener │        │
│                      └─────────┘        └─────────┘        │
│                                         ┌─────────┐        │
│                      Almacena las ────► │Listener │        │
│                      funciones          └─────────┘        │
│                      suscritas                              │
│                                         Reaccionan          │
│                                         al evento           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Que es un "Listener"?

Un listener es simplemente **una funcion**. Nada mas.

```typescript
// Esto es un listener:
const miListener = (event) => {
  console.log("Recibi:", event);
};

// Es solo una funcion que recibe un evento
// No tiene nada de especial
```

### 2.3 Que es "Suscribirse"?

Suscribirse = **agregar tu funcion a una lista**.

```typescript
// Internamente, subscribe hace esto:
class EventEmitter {
  // Una lista (Set) de funciones
  private listeners = new Set<Function>();

  subscribe(fn: Function) {
    // Agregar la funcion a la lista
    this.listeners.add(fn);
  }
}
```

### 2.4 Que es "Emitir"?

Emitir = **llamar a todas las funciones de la lista**.

```typescript
class EventEmitter {
  private listeners = new Set<Function>();

  emit(event: any) {
    // Recorrer la lista y llamar a cada funcion
    for (const fn of this.listeners) {
      fn(event);  // <-- Simplemente llama a la funcion
    }
  }
}
```

---

## 3. Implementacion Paso a Paso

### Paso 1: La Version Mas Simple Posible

```typescript
// event-emitter.ts

class SimpleEventEmitter {
  // Un Set es como un array pero sin duplicados
  private listeners: Set<Function> = new Set();

  // Agregar una funcion a la lista
  subscribe(fn: Function): void {
    this.listeners.add(fn);
  }

  // Llamar a todas las funciones
  emit(data: any): void {
    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
```

**Uso:**

```typescript
const emitter = new SimpleEventEmitter();

// Agregar funciones a la lista
emitter.subscribe((data) => console.log("Listener 1:", data));
emitter.subscribe((data) => console.log("Listener 2:", data));

// Llamar a todas las funciones
emitter.emit("Hola mundo");

// Output:
// Listener 1: Hola mundo
// Listener 2: Hola mundo
```

### Paso 2: Agregar Capacidad de Desuscribirse

```typescript
class EventEmitter {
  private listeners: Set<Function> = new Set();

  // Ahora retorna una funcion para desuscribirse
  subscribe(fn: Function): () => void {
    this.listeners.add(fn);

    // Retornar funcion que elimina el listener
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(data: any): void {
    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
```

**Uso:**

```typescript
const emitter = new EventEmitter();

// subscribe() ahora retorna una funcion
const unsubscribe = emitter.subscribe((data) => {
  console.log("Recibido:", data);
});

emitter.emit("Mensaje 1");  // Se imprime
emitter.emit("Mensaje 2");  // Se imprime

// Llamar a la funcion retornada para desuscribirse
unsubscribe();

emitter.emit("Mensaje 3");  // NO se imprime (ya no esta suscrito)
```

### Paso 3: Agregar Tipos (TypeScript)

```typescript
// Definir los tipos de eventos posibles
type AgentEvent =
  | { type: "message_start"; message: string }
  | { type: "message_end"; message: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; result: any };

class TypedEventEmitter {
  // El Set ahora tiene tipo especifico
  private listeners: Set<(event: AgentEvent) => void> = new Set();

  subscribe(fn: (event: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: AgentEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }
}
```

**Uso con tipos:**

```typescript
const emitter = new TypedEventEmitter();

emitter.subscribe((event) => {
  // TypeScript sabe que event puede ser message_start, message_end, etc.

  if (event.type === "message_end") {
    // TypeScript sabe que aqui event tiene .message
    console.log("Mensaje terminado:", event.message);
  }

  if (event.type === "tool_end") {
    // TypeScript sabe que aqui event tiene .toolName y .result
    console.log("Tool terminado:", event.toolName, event.result);
  }
});
```

---

## 4. Que Ocurre Cuando Llamas subscribe()

Vamos paso a paso con este codigo:

```typescript
agent.subscribe((event) => {
  if (event.type === "message_end") {
    trackAnalytics(event.message);
  }
});
```

### Paso 1: Se Crea la Funcion

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Cuando JavaScript lee esto:                               │
│                                                             │
│   (event) => {                                              │
│     if (event.type === "message_end") {                     │
│       trackAnalytics(event.message);                        │
│     }                                                       │
│   }                                                         │
│                                                             │
│   Crea un OBJETO FUNCION en memoria:                        │
│                                                             │
│   ┌─────────────────────────────────────┐                   │
│   │ Function Object                     │                   │
│   │ ─────────────────                   │                   │
│   │ Direccion: 0x7F2A                   │                   │
│   │ Codigo: (el codigo de arriba)       │                   │
│   │ Closure: { trackAnalytics: ... }    │                   │
│   └─────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 2: Se Llama a subscribe()

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   agent.subscribe(fn)                                       │
│          │                                                  │
│          │  fn = referencia a 0x7F2A                        │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────────────────────────────┐                   │
│   │ class Agent {                       │                   │
│   │   private listeners = new Set();   │                   │
│   │                                     │                   │
│   │   subscribe(fn) {                   │                   │
│   │     this.listeners.add(fn); ◄───────┼── Se ejecuta     │
│   │     return () => {                  │                   │
│   │       this.listeners.delete(fn);   │                   │
│   │     };                              │                   │
│   │   }                                 │                   │
│   │ }                                   │                   │
│   └─────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 3: La Funcion Se Agrega al Set

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ANTES de subscribe():                                     │
│                                                             │
│   agent.listeners = Set { }  (vacio)                        │
│                                                             │
│   ─────────────────────────────────────                     │
│                                                             │
│   DESPUES de subscribe():                                   │
│                                                             │
│   agent.listeners = Set { 0x7F2A }                          │
│                            │                                │
│                            │  (referencia a tu funcion)     │
│                            ▼                                │
│                    ┌─────────────────┐                      │
│                    │ Tu funcion que  │                      │
│                    │ llama a         │                      │
│                    │ trackAnalytics  │                      │
│                    └─────────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 4: Se Retorna la Funcion de Desuscripcion

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   const unsubscribe = agent.subscribe(fn);                  │
│         │                                                   │
│         │                                                   │
│         ▼                                                   │
│   unsubscribe = () => {                                     │
│     this.listeners.delete(fn);  // fn = 0x7F2A              │
│   }                                                         │
│                                                             │
│   Si llamas unsubscribe():                                  │
│   - Se elimina 0x7F2A del Set                               │
│   - Tu funcion ya no sera llamada                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Estado Final Despues de subscribe()

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         MEMORIA                             │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Agent                                               │   │
│   │ ─────                                               │   │
│   │ listeners: Set {                                    │   │
│   │   0x7F2A ─────────────────────┐                     │   │
│   │ }                             │                     │   │
│   └───────────────────────────────┼─────────────────────┘   │
│                                   │                         │
│                                   ▼                         │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Function (tu listener)                              │   │
│   │ ──────────────────────                              │   │
│   │ (event) => {                                        │   │
│   │   if (event.type === "message_end") {               │   │
│   │     trackAnalytics(event.message);                  │   │
│   │   }                                                 │   │
│   │ }                                                   │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   La funcion existe en memoria                              │
│   El Set tiene una referencia a ella                        │
│   Nada mas ha pasado (aun no se ha ejecutado)               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Que Ocurre Cuando Se Emite un Evento

Ahora el Agent hace algo y emite un evento:

```typescript
// Dentro del Agent, en algun momento:
this.emit({ type: "message_end", message: "Hola mundo" });
```

### Paso 1: Se Crea el Objeto Evento

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   { type: "message_end", message: "Hola mundo" }            │
│                                                             │
│   Se crea un objeto en memoria:                             │
│                                                             │
│   ┌─────────────────────────────────────┐                   │
│   │ Object                              │                   │
│   │ ──────                              │                   │
│   │ Direccion: 0x8B3C                   │                   │
│   │ type: "message_end"                 │                   │
│   │ message: "Hola mundo"               │                   │
│   └─────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 2: Se Ejecuta emit()

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   this.emit(event)                                          │
│          │                                                  │
│          │  event = 0x8B3C                                  │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────────────────────────────┐                   │
│   │ emit(event) {                       │                   │
│   │   for (const fn of this.listeners) {│ ◄── Se ejecuta   │
│   │     fn(event);                      │                   │
│   │   }                                 │                   │
│   │ }                                   │                   │
│   └─────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 3: Se Itera Sobre los Listeners

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   for (const fn of this.listeners)                          │
│                                                             │
│   listeners = Set { 0x7F2A, 0x9C4D, 0x1E5F }                │
│                      │       │       │                      │
│                      │       │       └── Listener 3         │
│                      │       └────────── Listener 2         │
│                      └────────────────── Listener 1 (tuyo)  │
│                                                             │
│   Iteracion 1: fn = 0x7F2A (tu funcion)                     │
│   Iteracion 2: fn = 0x9C4D                                  │
│   Iteracion 3: fn = 0x1E5F                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 4: Se Llama a Cada Funcion

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   fn(event)                                                 │
│    │   │                                                    │
│    │   └── event = { type: "message_end", message: "..." }  │
│    │                                                        │
│    └── fn = tu funcion (0x7F2A)                             │
│                                                             │
│   Esto es EQUIVALENTE a escribir:                           │
│                                                             │
│   ((event) => {                                             │
│     if (event.type === "message_end") {                     │
│       trackAnalytics(event.message);                        │
│     }                                                       │
│   })({ type: "message_end", message: "Hola mundo" });       │
│                                                             │
│   O sea, simplemente se LLAMA a tu funcion                  │
│   pasandole el evento como argumento.                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 5: Tu Funcion Se Ejecuta

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Tu funcion recibe event:                                  │
│                                                             │
│   (event) => {                                              │
│     // event = { type: "message_end", message: "Hola..." }  │
│                                                             │
│     if (event.type === "message_end") {  // true!           │
│       trackAnalytics(event.message);     // Se ejecuta!     │
│     }                                                       │
│   }                                                         │
│                                                             │
│   ┌─────────────────────────────────────┐                   │
│   │ trackAnalytics("Hola mundo")        │                   │
│   │ ─────────────────────────────       │                   │
│   │ (hace lo que tenga que hacer)       │                   │
│   └─────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Paso 6: Se Continua con el Siguiente Listener

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   El for continua:                                          │
│                                                             │
│   for (const fn of this.listeners) {                        │
│     fn(event);  // Ya se llamo a 0x7F2A                     │
│   }             // Ahora se llama a 0x9C4D                  │
│                 // Luego a 0x1E5F                           │
│                                                             │
│   Cada listener recibe el MISMO objeto event                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Flujo Completo con Diagramas

### Diagrama de Secuencia Completo

```
     Tiempo
       │
       │   SETUP (al iniciar la app)
       │   ════════════════════════
       ▼
       │
       │   database.subscribe()
       │   ──────────────────────────────────────────────────►
       │                                                      │
       │   ui.subscribe()                                     │
       │   ──────────────────────────────────────────────────►│
       │                                                      │
       │   analytics.subscribe()                              │
       │   ──────────────────────────────────────────────────►│
       │                                                      │
       │                                                      │
       │   RUNTIME (cuando pasan cosas)                       │
       │   ═════════════════════════════                      │
       ▼                                                      │
       │                                                      │
       │   Usuario envia mensaje                              │
       │   ────────────────────►                              │
       │                       │                              │
       │                       │ Agent procesa                │
       │                       │                              │
       │                       │ emit(message_end)            │
       │                       │─────────────────────────────►│
       │                       │                              │
       │                       │         ┌────────────────────┤
       │                       │         │ for (fn of list)   │
       │                       │         │   fn(event)        │
       │                       │         └────────────────────┤
       │                       │                              │
       │                       │◄─────── database.save()      │
       │                       │◄─────── ui.render()          │
       │                       │◄─────── analytics.track()    │
       │                       │                              │
       ▼                       ▼                              ▼

    Tu codigo           Agent                        EventEmitter
```

### Vista de Memoria en Tiempo de Ejecucion

```
┌─────────────────────────────────────────────────────────────┐
│                         HEAP                                │
│                                                             │
│  ┌─────────────────────┐                                    │
│  │ Agent               │                                    │
│  │ ─────               │                                    │
│  │ listeners: ─────────┼────┐                               │
│  └─────────────────────┘    │                               │
│                             │                               │
│                             ▼                               │
│  ┌─────────────────────────────────────────────┐            │
│  │ Set                                         │            │
│  │ ───                                         │            │
│  │ [0]: ────┐  [1]: ────┐  [2]: ────┐         │            │
│  └──────────┼───────────┼───────────┼──────────┘            │
│             │           │           │                       │
│             ▼           ▼           ▼                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Function     │ │ Function     │ │ Function     │         │
│  │ (database)   │ │ (ui)         │ │ (analytics)  │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                             │
│  Cuando emit() se llama:                                    │
│  - Se recorre el Set                                        │
│  - Se llama a cada Function                                 │
│  - Cada una recibe el mismo event                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Comparacion con Codigo Tradicional

### Sin Eventos (Acoplamiento Directo)

```typescript
class Agent {
  // El Agent CONOCE a todos sus consumidores
  private database: Database;
  private ui: UI;
  private analytics: Analytics;

  constructor(db: Database, ui: UI, analytics: Analytics) {
    this.database = db;
    this.ui = ui;
    this.analytics = analytics;
  }

  async processMessage(msg: string) {
    const result = await this.llm.generate(msg);

    // El Agent llama DIRECTAMENTE a cada servicio
    await this.database.save(result);
    await this.ui.render(result);
    await this.analytics.track(result);

    // Si quieres agregar notificaciones:
    // 1. Agregar propiedad: private notifications: Notifications;
    // 2. Modificar constructor
    // 3. Agregar linea aqui: await this.notifications.send(result);
  }
}
```

**Problemas:**
- Modificar Agent cada vez que agregas un consumidor
- Agent depende de muchas clases
- Dificil de testear (muchos mocks)
- Si analytics falla, puede afectar a database y ui

### Con Eventos (Desacoplado)

```typescript
class Agent {
  // El Agent NO CONOCE a nadie
  private listeners = new Set<(e: AgentEvent) => void>();

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: AgentEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  async processMessage(msg: string) {
    const result = await this.llm.generate(msg);

    // El Agent solo dice "esto paso"
    this.emit({ type: "message_end", message: result });

    // Si quieres agregar notificaciones:
    // NO modificas Agent
    // Solo agregas en otro lugar:
    // agent.subscribe(e => notifications.send(e.message));
  }
}

// En otro archivo, quien quiera escuchar:
agent.subscribe((e) => {
  if (e.type === "message_end") database.save(e.message);
});

agent.subscribe((e) => {
  if (e.type === "message_end") ui.render(e.message);
});

agent.subscribe((e) => {
  if (e.type === "message_end") analytics.track(e.message);
});
```

**Ventajas:**
- Agent no cambia cuando agregas consumidores
- Cada consumidor es independiente
- Facil de testear (sin mocks, solo verifica que emit se llamo)
- Si analytics falla, no afecta a los demas

---

## 8. Patrones Avanzados

### 8.1 Eventos Asincronos

```typescript
class AsyncEventEmitter {
  private listeners = new Set<(e: Event) => Promise<void>>();

  // Esperar a que TODOS los listeners terminen
  async emit(event: Event): Promise<void> {
    const promises = Array.from(this.listeners).map(fn => fn(event));
    await Promise.all(promises);
  }
}
```

### 8.2 Eventos con Prioridad

```typescript
class PriorityEventEmitter {
  private listeners: Array<{ fn: Function; priority: number }> = [];

  subscribe(fn: Function, priority = 0) {
    this.listeners.push({ fn, priority });
    // Ordenar por prioridad (mayor primero)
    this.listeners.sort((a, b) => b.priority - a.priority);
  }

  emit(event: Event) {
    for (const { fn } of this.listeners) {
      fn(event);
    }
  }
}

// Uso:
emitter.subscribe(logEvent, 100);      // Se ejecuta primero
emitter.subscribe(saveToDb, 50);       // Se ejecuta segundo
emitter.subscribe(sendAnalytics, 10);  // Se ejecuta tercero
```

### 8.3 Eventos Cancelables

```typescript
interface CancellableEvent {
  type: string;
  cancelled: boolean;
  cancel(): void;
}

class CancellableEventEmitter {
  emit(event: CancellableEvent) {
    for (const fn of this.listeners) {
      fn(event);

      // Si alguien cancelo, dejar de notificar
      if (event.cancelled) {
        break;
      }
    }
  }
}

// Uso:
emitter.subscribe((event) => {
  if (event.type === "delete_file" && isImportant(event.file)) {
    event.cancel();  // Evita que otros listeners lo procesen
  }
});
```

### 8.4 Eventos por Canal (Como EventBus)

```typescript
class ChannelEventEmitter {
  // Un Map de canal -> Set de listeners
  private channels = new Map<string, Set<Function>>();

  on(channel: string, fn: Function) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(fn);
  }

  emit(channel: string, data: any) {
    const listeners = this.channels.get(channel);
    if (listeners) {
      for (const fn of listeners) {
        fn(data);
      }
    }
  }
}

// Uso:
bus.on("user:login", (user) => console.log("Login:", user));
bus.on("user:logout", (user) => console.log("Logout:", user));
bus.on("file:saved", (file) => console.log("Saved:", file));

bus.emit("user:login", { name: "Juan" });  // Solo notifica a user:login
```

---

## 9. Cuando Usar y Cuando No

### Usar Eventos Cuando:

| Situacion | Por que eventos |
|-----------|-----------------|
| Multiples consumidores del mismo dato | No quieres que el emisor conozca a todos |
| Sistema de plugins/extensiones | Los plugins se suscriben sin modificar el core |
| Comunicacion entre modulos desacoplados | Evita dependencias circulares |
| Necesitas agregar funcionalidad sin modificar codigo existente | Solo agregas un listener |
| El emisor no necesita saber el resultado | Fire and forget |

### NO Usar Eventos Cuando:

| Situacion | Por que no |
|-----------|------------|
| Solo hay un consumidor | Sobrecomplica sin beneficio |
| Necesitas el resultado de la operacion | Eventos son fire-and-forget |
| El orden de ejecucion es critico | Los listeners no garantizan orden |
| Debugging es prioritario | Los eventos hacen el flujo menos obvio |
| Operacion simple y lineal | KISS - Keep It Simple |

### Ejemplo: Cuando NO Usarlo

```typescript
// MALO: Usar eventos para algo simple
class Calculator {
  private listeners = new Set();

  add(a: number, b: number) {
    const result = a + b;
    this.emit({ type: "calculation_done", result });
    // Pero... como obtengo el resultado?!
  }
}

// BUENO: Simplemente retornar el valor
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
```

---

## Resumen Final

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   subscribe(fn)                                             │
│   ─────────────                                             │
│   = Agregar fn a una lista (Set)                            │
│   = Nada se ejecuta aun                                     │
│   = Retorna funcion para quitarse de la lista               │
│                                                             │
│   emit(event)                                               │
│   ───────────                                               │
│   = Recorrer la lista                                       │
│   = Llamar a cada funcion con el evento                     │
│   = Las funciones se ejecutan una por una                   │
│                                                             │
│   La "magia" es simplemente:                                │
│   ─────────────────────────────                             │
│   1. Guardar funciones en una lista                         │
│   2. Cuando algo pasa, llamar a todas                       │
│   3. No hay mas                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

El patron de eventos no es magia - es simplemente **almacenar funciones en una lista y llamarlas cuando algo pasa**. La potencia viene de que el emisor no necesita conocer a sus consumidores, permitiendo sistemas mas flexibles y extensibles.
