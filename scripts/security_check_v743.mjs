import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { console.error(`❌ ${message}`); process.exitCode = 1; };
const ok = (message) => console.log(`✅ ${message}`);

const pkg = JSON.parse(read('package.json'));
const vercel = JSON.parse(read('vercel.json'));
const html = read('index.html');

const expectedSupabase = '2.57.4';
const expectedSheetJS = '0.20.3';
const supabaseUrl = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${expectedSupabase}`;
const sheetUrl = `https://cdn.sheetjs.com/xlsx-${expectedSheetJS}/package/dist/xlsx.full.min.js`;

if (pkg.dependencies?.['@supabase/supabase-js'] === expectedSupabase) ok(`Supabase npm fijado en ${expectedSupabase}`);
else fail(`Supabase npm debe quedar fijado exactamente en ${expectedSupabase}`);

for (const [name, version] of Object.entries(pkg.dependencies || {})) {
  if (/^[~^*]|latest|next/i.test(String(version))) fail(`Dependencia no fijada: ${name}=${version}`);
}
if (!process.exitCode) ok('Dependencias npm sin rangos ^, ~, latest o *');

const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi)].map(m => m[1]);
const allowed = new Set([supabaseUrl, sheetUrl]);
for (const src of externalScripts) {
  if (!allowed.has(src)) fail(`Script externo no registrado o versión inesperada: ${src}`);
}
if (externalScripts.includes(supabaseUrl)) ok(`Supabase navegador fijado en ${expectedSupabase}`);
else fail(`No se encontró la URL exacta de Supabase ${expectedSupabase}`);
if (externalScripts.includes(sheetUrl)) ok(`SheetJS navegador fijado en ${expectedSheetJS}`);
else fail(`No se encontró la URL exacta de SheetJS ${expectedSheetJS}`);

if (/JSZip v3\.10\.1/.test(html)) ok('JSZip embebido identificado como 3.10.1');
else fail('No se pudo verificar el encabezado JSZip v3.10.1');

const globalHeaders = vercel.headers?.find(h => h.source === '/(.*)')?.headers || [];
const headerMap = new Map(globalHeaders.map(h => [h.key.toLowerCase(), h.value]));
const requiredHeaders = [
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'strict-transport-security',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'origin-agent-cluster',
  'x-permitted-cross-domain-policies'
];
for (const key of requiredHeaders) {
  if (headerMap.has(key)) ok(`Header ${key}`); else fail(`Falta header ${key}`);
}

const csp = headerMap.get('content-security-policy') || '';
const requiredDirectives = [
  "default-src 'self'",
  'script-src',
  'style-src',
  'img-src',
  'connect-src',
  'frame-src',
  'worker-src',
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  'upgrade-insecure-requests'
];
for (const directive of requiredDirectives) {
  if (csp.includes(directive)) ok(`CSP: ${directive}`); else fail(`CSP incompleta: ${directive}`);
}
if (csp.includes("'unsafe-eval'")) fail("CSP no debe permitir 'unsafe-eval'");
else ok("CSP no permite 'unsafe-eval'");

const apiHeaders = vercel.headers?.find(h => h.source === '/api/(.*)')?.headers || [];
const cache = new Map(apiHeaders.map(h => [h.key.toLowerCase(), h.value]));
if ((cache.get('cache-control') || '').includes('no-store')) ok('API marcada no-store');
else fail('API debe tener Cache-Control no-store');

if (process.exitCode) {
  console.error('\nPARKS ONE V7.4.3 · validación de seguridad FALLIDA');
  process.exit(process.exitCode);
}
console.log('\nPARKS ONE V7.4.3 · validación de seguridad OK');
