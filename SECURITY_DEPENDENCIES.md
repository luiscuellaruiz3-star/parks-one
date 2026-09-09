# PARKS ONE · Control de dependencias y seguridad web · V7.4.3

Corte de revisión: 2026-09-09

## Dependencias de navegador autorizadas

| Componente | Versión | Origen autorizado | Control |
|---|---:|---|---|
| Supabase JS | 2.57.4 | `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4` | URL con versión exacta + `package.json` fijado a 2.57.4 + `npm run security:check` |
| SheetJS | 0.20.3 | `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` | URL con versión exacta + verificación automática de configuración + checksum upstream de referencia |
| JSZip | 3.10.1 | Embebido en `index.html` | Sin petición CDN; el control automático verifica el encabezado de versión |

### SheetJS 0.20.3 · referencia de integridad upstream

La documentación oficial de SheetJS publica para `xlsx.full.min.js` 0.20.3 el MD5:

`6b3130af1ceadf07caa0ec08af7addff`

Antes de cambiar esta dependencia debe descargarse únicamente desde `cdn.sheetjs.com`, comprobarse nuevamente el checksum y actualizar este registro en el mismo commit.

## Política de cambio

1. No usar URLs `latest`, `@2`, rangos `^` o `~` para una dependencia que llegue a producción.
2. Toda nueva librería externa debe registrarse aquí antes de incorporarla al `index.html`.
3. Ejecutar `npm run security:check` antes de publicar.
4. Si cambia una dependencia, revisar sus avisos de seguridad y probar los módulos que la consumen.
5. No ampliar CSP para permitir un dominio nuevo sin documentar qué dependencia lo requiere.

## CSP

PARKS ONE conserva `unsafe-inline` únicamente por la arquitectura actual del `index.html`, que contiene estilos y scripts embebidos históricos. **No se permite `unsafe-eval`.** La eliminación de `unsafe-inline` requiere extraer esos bloques a archivos propios y debe hacerse como refactor controlado, no dentro de un hardening puntual.

La política V7.4.3 restringe además objetos, ancestros de frame, formularios, workers y manifiestos, y autoriza `frame-src`/`img-src` hacia el proyecto Supabase exclusivamente para vistas previas documentales mediante URLs firmadas.
