(function (global) {
  'use strict';

  const C = global.ParksIntelligenceCore;
  const K = global.ParksIntelligenceKnowledge;

  global.ParksIntelligenceRegistry.register({
    id: 'users',

    async execute(parsed) {
      const semanticAdmin = parsed.entities?.administrator?.label;

      if (semanticAdmin) {
        const parks = K.parksByAdministrator(semanticAdmin);
        return C.result(
          semanticAdmin,
          `${semanticAdmin} aparece relacionado con ${C.number(parks.length)} parque${parks.length === 1 ? '' : 's'} dentro de tu alcance.`,
          {
            html: C.listHtml(parks, park => ({
              title: park.park,
              subtitle: `${park.region || ''} · ${park.division || ''}`,
              value: C.percent(park.compliance, 1)
            })),
            diagnosticData: {
              source: 'SIGOP_DATA.parks',
              records: parks.length,
              formula: 'Relación Administrador → Parques',
              calculation: semanticAdmin,
              result: `${parks.length} parques`
            }
          }
        );
      }

      const role = C.getRole();

      if (['administrador', 'regional'].includes(role)) {
        if (parsed.role && parsed.role !== 'administrador') {
          return C.restriction(
            'Con tu perfil puedo mostrar Administradores de tu división, pero no otros niveles jerárquicos.'
          );
        }

        const admins = C.visibleTop5(parsed.month);
        const unique = [
          ...new Map(
            admins.map(row => [C.normalize(row.administrator), row])
          ).values()
        ];

        return C.result(
          'Administradores operativos de tu división',
          `Encontré ${C.number(unique.length)} Administradores con información Top 5 disponible.`,
          {
            html: C.listHtml(unique, row => ({
              title: row.administrator,
              subtitle: `${row.region} · ${(row.parks || []).join(', ')}`,
              value: C.percent(row.compliance, 1)
            }))
          }
        );
      }

      const cfg = global.PARKS_CONFIG || {};
      if (!global.supabase?.createClient) {
        return C.result('Usuarios', 'No fue posible consultar el directorio.');
      }

      const sb = global.supabase.createClient(
        cfg.supabaseUrl,
        cfg.supabaseAnonKey
      );

      let request = sb
        .from('profiles')
        .select('id,full_name,email,role,is_active,status,created_at')
        .order('full_name');

      if (parsed.role) request = request.eq('role', parsed.role);

      if (
        parsed.normalized.includes('inactivo') ||
        parsed.normalized.includes('suspendido')
      ) {
        request = request.eq('is_active', false);
      } else if (parsed.normalized.includes('activo')) {
        request = request.eq('is_active', true);
      }

      const { data, error } = await request;
      if (error) {
        return C.result(
          'Directorio de usuarios',
          'La base de datos no permitió consultar el directorio.',
          { note: error.message }
        );
      }

      const users = data || [];
      return C.result(
        'Consulta de usuarios',
        `Actualmente encontré ${C.number(users.length)} usuarios.`,
        {
          html: C.listHtml(users, user => ({
            title: user.full_name || 'Sin nombre',
            subtitle: `${user.email || ''} · ${user.role || 'Sin rol'}`,
            value: user.is_active ? 'Activo' : 'Inactivo'
          })),
          actions: [{ label: 'Ir a Usuarios', page: 'moduloUsuarios' }]
        }
      );
    }
  });
})(window);
