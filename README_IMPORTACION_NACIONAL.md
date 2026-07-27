# PARKS ONE · Importación Nacional V3

Esta versión permite seleccionar **una sola vez la carpeta PARKS_IMPORT completa** desde el navegador. No se cargan documentos uno por uno.

## Qué importa en esta versión

- Todo lo ubicado en `PARKS_IMPORT/DOCUMENTOS/...`
- Crea parques faltantes en Supabase.
- Sube archivos al bucket privado `parks-documentos`.
- Registra los documentos en la tabla `documents` y los vincula al requisito Top 23.
- Omite archivos que ya existen.
- Reintenta automáticamente cargas fallidas.
- Guarda un punto de reanudación en el navegador.
- Genera reporte CSV.

## Prueba recomendada

La casilla **Prueba inicial** viene activada. Selecciona la carpeta completa y el sistema procesará solo el primer parque detectado. Después de comprobar vista previa y descarga, desactiva la casilla y repite la selección para ejecutar la carga nacional.

## Importante

Los Excel de Top 5, hidráulica y auditorías son detectados, pero todavía no se convierten automáticamente en filas de sus tablas. Esta versión prioriza la carga documental segura y verificable.
