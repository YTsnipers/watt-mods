# watt-mods

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | Español

Mods de Claude Code por apollon. Cada mod se suma a la propia interfaz de Claude Code: lo que muestra junto al prompt y, en
algunos casos, cómo trabaja Claude.

**[Demo en vivo](https://ytsnipers.github.io/watt-mods/)**: un turno reproducido con watt, dibujado por su propio código de renderizado.

| Mod | Qué hace |
| --- | --- |
| [watt](plugins/watt/README.es.md) | Muestra lo que Claude Code deja oculto: cuánto tardó cada llamada a herramienta, el contexto y el uso de cinco horas y siete días tras cada turno, un chip de estado por cada subagente en marcha y barras de progreso en vivo sobre el prompt, con sonidos suaves cuando el trabajo termina, falla o espera tu respuesta. También le pide a Claude que mantenga una barra de progreso en el trabajo de varios pasos; consulta [qué cambia en el comportamiento de Claude](plugins/watt/README.es.md#qué-cambia-en-el-comportamiento-de-claude). |

## Instalación

En Claude Code (2.1.295 o posterior):

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

La configuración, la solución de problemas y cómo desinstalarlo están en el [README de watt](plugins/watt/README.es.md).

## Seguridad

[SECURITY.md](SECURITY.md) (en inglés) enumera todo lo que watt puede tocar (sin red, un archivo local, dos comandos locales
fijos) y cómo informar de una vulnerabilidad.

## Licencia

MIT, consulta [LICENSE](LICENSE). watt incluye código adaptado de plan-progress (MIT); consulta
[plugins/watt/NOTICE](plugins/watt/NOTICE).
