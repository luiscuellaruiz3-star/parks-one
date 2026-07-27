# PARKS ONE — Conectado a Supabase V1

Esta entrega conserva la interfaz aprobada y la conecta con el esquema real instalado en el proyecto Supabase `xmiushrjmlatrogfrsxu`.

## Ya está configurado

- URL del proyecto: `https://xmiushrjmlatrogfrsxu.supabase.co`
- Bucket privado: `parks-documentos`
- Inicio de sesión con Supabase Auth
- Lectura del perfil y rol en `public.profiles`
- Seguridad por RLS
- Consulta de parques y documentos autorizados
- URLs firmadas para vista previa y descarga
- Carga documental compatible con el esquema nuevo

## Único dato pendiente

Abre `config.js` y sustituye:

```js
"__PEGA_AQUI_LA_PUBLISHABLE_KEY__"
```

por la **Publishable key** de Supabase, la que inicia con `sb_publishable_`.

No uses la Secret key.

## Prueba local

1. Instala Node.js.
2. Abre una terminal dentro de esta carpeta.
3. Ejecuta:

```bash
npm install
npm run dev
```

4. Abre `http://localhost:3000`.
5. Ingresa con el usuario ya creado en Supabase.

## Publicación en Vercel

1. Sube esta carpeta a un repositorio privado de GitHub.
2. En Vercel selecciona **Add New > Project**.
3. Importa el repositorio.
4. Framework preset: **Other**.
5. Build command: dejar vacío.
6. Output directory: `.`
7. Pulsa **Deploy**.

## Comportamiento actual

Los datos históricos incorporados en `data.js` se mantienen como base visual para no perder el diseño ni la información validada. Al iniciar sesión, la plataforma consulta Supabase, aplica el rol real del usuario y combina los parques y documentos que ya existan en la nube.

La siguiente migración será cargar el catálogo nacional de parques y después importar los documentos al bucket con rutas:

```text
{park_uuid}/{requirement_code}/{nombre_archivo.pdf}
```
