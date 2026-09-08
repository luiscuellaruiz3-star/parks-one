# PARKS ONE V7.3.3 — Trazabilidad de fuentes

Fecha: 2026-09-08

Corrección dirigida al punto 2.2 de la revisión técnica de Sistemas.

## Cambios
- Cada módulo incorpora un panel de **Trazabilidad de la información**.
- Se muestra origen, última actualización conocida, archivo/proceso, responsable de carga, regla de cálculo y pendientes/rechazados.
- La trazabilidad se genera con información protegida del bootstrap y metadatos de Supabase; no expone payloads públicos.
- Las consultas de metadatos conservan el JWT del usuario y respetan RLS.
- Top 5, Matriz Hídrica, documentos y alertas utilizan metadatos de sus fuentes cuando están disponibles.
- Cuando la fuente histórica no registra responsable u hora exacta, PARKS ONE lo indica expresamente en lugar de inventarlo.
- Se registra también la fecha/hora de consulta protegida, rol y número de parques visibles para la sesión.

## Criterio
La plataforma debe poder explicar no sólo el resultado, sino también de dónde proviene, cuándo fue actualizado, qué proceso lo generó y qué elementos continúan pendientes de validación.
