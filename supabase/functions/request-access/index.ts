import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const body = await req.json();
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (fullName.length < 3) throw new Error('Captura el nombre completo.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Captura un correo válido.');
    if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

    // Crea la identidad sin correo de confirmación. Esto NO concede acceso:
    // el perfil queda pendiente/inactivo hasta aprobación del Arquitecto.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        requested_role: 'consulta',
        access_status: 'pendiente'
      }
    });
    if (error) throw error;
    if (!data.user) throw new Error('No fue posible crear la identidad del usuario.');

    const { error: profileError } = await admin.from('profiles').upsert({
      id: data.user.id,
      full_name: fullName,
      email,
      role: 'consulta',
      status: 'pendiente',
      is_active: false,
      approved_by: null,
      approved_at: null,
      suspended_at: null
    }, { onConflict: 'id' });

    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }

    return json({ ok: true, status: 'pendiente' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const duplicate = /already|registered|exists|duplicate/i.test(message);
    return json({ error: duplicate ? 'Ya existe una cuenta registrada con este correo.' : message }, 400);
  }
});
