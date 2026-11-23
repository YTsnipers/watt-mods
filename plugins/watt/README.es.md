# watt

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | Español

Claude Code no muestra cuánto tardó cada llamada a herramienta, cuánto te queda del uso de cinco horas y siete días, ni qué
está haciendo cada subagente. watt dibuja todo eso en la terminal, junto al prompt.

**[Demo en vivo](https://ytsnipers.github.io/watt-mods/)**: un turno reproducido con watt, dibujado por su propio código de renderizado.

![watt en una terminal de Claude Code: tiempos de herramientas, línea del turno, chips de agentes y barras de progreso](../../docs/screenshot.png)

- **Tiempo de cada llamada**: la fila de cada llamada a herramienta terminada acaba con lo que tardó, p. ej. `took 1.2s`.
- **Línea del turno**: bajo la línea de duración de un turno principal, el contexto usado (frente a la ventana del propio
  modelo) y el uso de cinco horas y siete días, en naranja y luego en rojo al pasar sus umbrales.
- **Fila de agentes**: una fila sobre el prompt con un chip (un pequeño recuadro de estado) por cada subagente en marcha: su
  modelo, el tiempo transcurrido y el llenado del contexto. Un chip terminado se vuelve verde o rojo y se queda unos
  segundos, o hasta que se pulsa su ×.
- **Barras de progreso**: en el trabajo de varios pasos, la herramienta `plan_progress` dibuja barras de etapas en vivo sobre
  el prompt, para ver en qué paso está Claude (portado de [plan-progress](https://github.com/zycck/claude-mods), MIT,
  Kirill Serditov).
- **Sonidos**: un sonido suave cuando termina un turno largo o todos los subagentes, el de error cuando algo falló y el de
  decisión cuando Claude espera tu respuesta.

## Requisitos

- Claude Code 2.1.295 o posterior (`claude --version`).
- En macOS, watt sigue la apariencia clara u oscura del sistema. En otras plataformas dibuja para un fondo oscuro, salvo que
  el tema de `/config` sea claro.

## Instalar y quitar

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## Qué cambia en el comportamiento de Claude

watt no solo dibuja. Antes de instalarlo, ten en cuenta que:

- **Añade una sección al system prompt** de la conversación principal: las reglas para usar las barras de progreso, un
  párrafo de unos 150 tokens en cada petición. Los subagentes no la reciben.
- **Rechaza una edición de archivo**: cuando la conversación principal hace su cuarta edición de archivo (Edit, Write,
  MultiEdit, NotebookEdit) sin barra de progreso, esa edición se rechaza una vez y se le pide a Claude que cree antes una
  barra. Los comandos de shell y los subagentes nunca se rechazan.
- **Añade recordatorios breves** tras los resultados de herramientas cuando una barra abierta lleva varias ediciones sin
  actualizarse.
- **Devuelve a Claude una vez al final de un turno** que trabajó y dejó una barra abierta sin preguntarte nada: Claude hace
  una ronda más para actualizar la barra, lo que consume los tokens de esa ronda. Un turno que termina con una pregunta
  marca la barra como pendiente de tu respuesta, y un turno que espera trabajo en segundo plano termina sin más.
- **Escribe un archivo local**: `~/.cache/claude-usage/usage-<hash>.json`, con los porcentajes de uso, para que la app
  [CC Switch](https://github.com/farion1231/cc-switch) los muestre. No se envía nada por la red.

La lista completa de lo que watt puede tocar está en [SECURITY.md](../../SECURITY.md) (en inglés).

## Configuración

| Comando | Qué hace |
| --- | --- |
| `/watt-settings` | Activa o desactiva el destello (puntos animados en el relleno de la barra), los sonidos o el modelo en los chips; ajusta cuánto tiempo se quedan los chips y barras terminados. Las mismas opciones están en watt dentro de `/config`. |
| `/progress` | Ocultar o mostrar las barras de progreso |
| `/progress-clear` | Quitar todas las barras de progreso |

## Solución de problemas

- **No hay herramienta `plan_progress` en la sesión**: un filtro web de antivirus (AVG Web Shield, por ejemplo) o un proxy
  bloquea 127.0.0.1, por donde la herramienta llega a la sesión. Añade 127.0.0.1 a las excepciones del filtro, o define
  `NO_PROXY=127.0.0.1,localhost`, y reinicia Claude Code. Si no es eso, revisa la versión requerida más arriba.
- **Faltan los números tras la línea de duración del turno**: otro mod dibujó esa línea sin pasarla (el mod
  [prismantis](https://github.com/NahumLitvin/prismantis), por ejemplo;
  [issue #601](https://github.com/NahumLitvin/prismantis/issues/601)). Carga watt primero añadiendo esto a
  `~/.claude/settings.json` y ejecuta `/reload-plugins`:

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## Desarrollo

Lee [AGENTS.md](../../AGENTS.md) (en inglés) para ver cómo está organizado el código. Desde `plugins/watt`:

```sh
claude plugin validate .
claude plugin test .
```

Después de editar el código, ejecuta `/reload-plugins` en Claude Code para cargar el cambio.
