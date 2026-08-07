(function (global) {
  'use strict';

  const C = global.ParksIntelligenceCore;
  const K = global.ParksIntelligenceKnowledge;

  function parkSnapshotResponse(parsed, parkName) {
    const snapshot = K.parkSnapshot(parkName, parsed.month);
    if (!snapshot) {
      return C.result(
        'Parque no localizado',
        `No encontré ${parkName} dentro de los parques visibles para tu perfil.`
      );
    }

    const park = snapshot.park;
    const docs = snapshot.documents;
    const top5 = snapshot.top5;
    const rel = snapshot.relations;
    const alerts = snapshot.alerts || [];

    const statusDocument = parsed.entities?.document;
    if (statusDocument) {
      const entries = Object.entries(park.statuses || {}).filter(([name]) =>
        C.documentMatchesName(name, statusDocument.label)
      );
      if (entries.length) {
        const statuses = entries.map(([name, raw]) => ({
          name,
          status: C.statusLabel(raw)
        }));
        return C.result(
          `${statusDocument.label} · ${park.park}`,
          `Encontré ${statuses.length} registro${statuses.length === 1 ? '' : 's'} relacionado${statuses.length === 1 ? '' : 's'} con ${statusDocument.label}.`,
          {
            html: C.listHtml(statuses, row => ({
              title: row.name,
              subtitle: `${park.region} · ${park.administrator || 'Por asignar'}`,
              value: row.status.label
            })),
            actions: [{ label: 'Abrir Top 23', page: 'top23' }],
            diagnosticData: {
              source: 'SIGOP_DATA.parks.statuses',
              records: statuses.length,
              formula: 'Consulta directa por entidad parque + documento',
              calculation: `${park.park} → ${statusDocument.label}`,
              result: statuses.map(row => row.status.label).join(', ')
            }
          }
        );
      }
    }

    const top5Html = top5
      ? `<div class="intel-result-card"><small>Top 5 · ${C.escapeHtml(top5.month)}</small><strong>${C.percent(top5.compliance, 1)}</strong></div>`
      : `<div class="intel-result-card"><small>Top 5</small><strong>Sin dato</strong></div>`;

    return C.result(
      park.park,
      `Este es el panorama consolidado de ${park.park} dentro de la información actualmente disponible.`,
      {
        html: `
          <div class="intel-result-grid">
            <div class="intel-result-card"><small>Top 23</small><strong>${C.percent(park.compliance, 1)}</strong></div>
            <div class="intel-result-card"><small>Pendientes</small><strong>${C.number(park.pending || docs.pending)}</strong></div>
            ${top5Html}
            <div class="intel-result-card"><small>Alertas</small><strong>${C.number(alerts.length)}</strong></div>
          </div>
          <div class="intel-list">
            <div class="intel-list-item"><span class="intel-list-number">1</span><div><b>Administrador</b><small>Responsable visible</small></div><span class="intel-list-value">${C.escapeHtml(rel.administrator || 'Por asignar')}</span></div>
            <div class="intel-list-item"><span class="intel-list-number">2</span><div><b>Región</b><small>${C.escapeHtml(rel.division || '')}</small></div><span class="intel-list-value">${C.escapeHtml(rel.region || 'Sin región')}</span></div>
            <div class="intel-list-item"><span class="intel-list-number">3</span><div><b>PTAR</b><small>${C.escapeHtml(rel.supply || 'Suministro por validar')}</small></div><span class="intel-list-value">${C.escapeHtml(rel.ptar || 'Por validar')}</span></div>
            <div class="intel-list-item"><span class="intel-list-number">4</span><div><b>Pozo</b><small>Infraestructura hídrica</small></div><span class="intel-list-value">${C.escapeHtml(rel.pozo || 'Por validar')}</span></div>
            <div class="intel-list-item"><span class="intel-list-number">5</span><div><b>Descarga</b><small>Tipo identificado</small></div><span class="intel-list-value">${C.escapeHtml(rel.discharge || 'Por validar')}</span></div>
          </div>
        `,
        actions: [
          { label: 'Abrir Parques', page: 'parques' },
          { label: 'Abrir Top 23', page: 'top23' },
          { label: 'Abrir Agua', page: 'agua' }
        ],
        note: 'Puedes continuar con “¿y su Predial?”, “¿quién lo administra?”, “¿tiene PTAR?” o “¿qué alertas tiene?”.',
        context: {
          domain: 'parks',
          park: park.park,
          region: park.region,
          month: parsed.month
        },
        diagnosticData: {
          source: 'SIGOP_DATA.parks + TOP5_DATA + SIGOP_DATA.alerts',
          records: 1,
          formula: 'Snapshot semántico por parque',
          calculation: park.park,
          result: `${park.park} · Top23 ${C.percent(park.compliance, 1)}`
        }
      }
    );
  }

  global.ParksIntelligenceRegistry.register({
    id: 'parks',

    execute(parsed) {
      const semanticPark = parsed.entities?.park?.label;
      if (semanticPark) {
        return parkSnapshotResponse(parsed, semanticPark);
      }

      let parks = C.parksForQuery(parsed);

      if (parsed.risk) {
        parks = parks.filter(park =>
          C.normalize(park.risk) === C.normalize(parsed.risk)
        );
      }

      const q = parsed.normalized;
      if (/\b(peor|menor|bajo|rezago|atrasado)\b/.test(q)) {
        parks.sort((a, b) => (a.compliance || 0) - (b.compliance || 0));
      } else if (/\b(mejor|mayor|alto)\b/.test(q) && !parsed.risk) {
        parks.sort((a, b) => (b.compliance || 0) - (a.compliance || 0));
      }

      const average = parks.reduce(
        (sum, park) => sum + (park.compliance || 0), 0
      ) / Math.max(1, parks.length);

      return C.result(
        parsed.risk
          ? `Parques con riesgo ${parsed.risk.toLowerCase()}`
          : 'Consulta de parques',
        `Encontré ${C.number(parks.length)} parques dentro de tu alcance. El cumplimiento promedio es ${C.percent(average, 1)}.`,
        {
          html: C.listHtml(parks, park => ({
            title: park.park,
            subtitle: `${park.region || ''} · ${park.administrator || 'Por asignar'} · ${park.pending || 0} pendientes`,
            value: C.percent(park.compliance, 1)
          })),
          actions: [{ label: 'Ir a Parques', page: 'parques' }]
        }
      );
    }
  });
})(window);
