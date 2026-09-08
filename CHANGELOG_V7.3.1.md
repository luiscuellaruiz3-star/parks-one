# PARKS ONE 7.3.1 — Correcciones revisión técnica

Fecha: 2026-09-07

## Seguridad
- Se elimina `data.js` del contenido público.
- La matriz operativa, Top 5 e información hídrica se entregan únicamente después de validar una sesión de Supabase mediante `/api/bootstrap`.
- El bootstrap usa el token del usuario y la RLS de `parks` para limitar el alcance.
- Se retiran del despliegue archivos Excel, respaldos y artefactos de validación.
- Se fijó Supabase JS en 2.57.4.
- Se agregaron CSP, anti-iframe, HSTS, Permissions-Policy y encabezados de navegador.

## Interfaz
- Centro de alertas: cuadrícula responsiva sin desbordamiento horizontal.
- Centro de Inteligencia: sugerencias responsivas y documentación visible de fuentes, alcance y limitaciones.
- Cada módulo conserva una ruta mediante `#page=<modulo>`.
- Versión general unificada: 7.3.1.

## Importante
La función `/api/bootstrap` no usa Service Role. Valida el JWT del usuario y consulta `parks` usando el mismo token, por lo que la RLS de Supabase sigue siendo la autoridad de acceso.
