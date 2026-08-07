(function (global) {
  'use strict';

  const C = global.ParksIntelligenceCore;

  function rowCompliance(row) {
    const records = Number(row.records) || 0;
    const expected = Number(row.expected) || 0;

    // Esta es la regla operativa que utiliza la pantalla Top 5:
    // registros válidos / meta del administrador.
    if (expected > 0) return records / expected;

    // Mayo no tiene detalle de registros por administrador en la fuente.
    // En ese caso únicamente conservamos un valor explícito si existe.
    return Number(row.compliance) || 0;
  }

  function totals(rows) {
    return rows.reduce((acc, row) => {
      acc.records += Number(row.records) || 0;
      acc.expected += Number(row.expected) || 0;
      return acc;
    }, { records: 0, expected: 0 });
  }

  function monthSummary(month) {
    return (C.top5Data().months || []).find(item =>
      C.normalize(item.month) === C.normalize(month)
    ) || null;
  }

  function regionSummary(month, region) {
    return (C.top5Data().regions || []).find(item =>
      C.normalize(item.month) === C.normalize(month) &&
      C.normalize(item.region) === C.normalize(region)
    ) || null;
  }

  function displayedCompliance(parsed, rows) {
    const total = totals(rows);

    // Una región se calcula con sus registros reales:
    // Junio R1 = 155 / 220 = 70.45%
    // Julio R1 = 162 / 170 = 95.29%
    if (parsed.region) {
      if (total.expected > 0) return total.records / total.expected;
      return Number(regionSummary(parsed.month, parsed.region)?.compliance) || 0;
    }

    const scope = C.scopeInfo();

    // El cierre nacional conserva el porcentaje ejecutivo oficial
    // de la fuente, igual que la pantalla principal de Top 5.
    if (scope.level !== 'division') {
      const fixed = monthSummary(parsed.month);
      if (fixed && Number.isFinite(Number(fixed.compliance))) {
        return Number(fixed.compliance);
      }
    }

    // Para un alcance divisional, calcular únicamente con sus registros.
    if (total.expected > 0) return total.records / total.expected;

    const valid = rows.filter(row => Number(row.compliance) > 0);
    return valid.length
      ? valid.reduce((sum, row) => sum + Number(row.compliance), 0) / valid.length
      : 0;
  }

  function usableDetailRows(rows) {
    // No mostrar porcentajes falsos cuando la fuente no contiene
    // registros ni meta por administrador, como ocurre en Mayo.
    return rows.filter(row =>
      Number(row.expected) > 0 ||
      Number(row.records) > 0 ||
      Number(row.compliance) > 0
    );
  }

  global.ParksIntelligenceRegistry.register({
    id: 'top5',

    execute(parsed) {
      let rows = C.visibleTop5(parsed.month, parsed.region);

      const semanticPark = parsed.entities?.park?.label || '';
      if (semanticPark) {
        rows = rows.filter(row => {
          const parks = Array.isArray(row.parks)
            ? row.parks
            : String(row.parks || '').split(',').map(item => item.trim()).filter(Boolean);
          return parks.some(park => C.normalize(park) === C.normalize(semanticPark));
        });
      }

      const semanticAdmin = parsed.entities?.administrator?.label || '';
      if (semanticAdmin) {
        rows = rows.filter(row =>
          C.normalize(row.administrator) === C.normalize(semanticAdmin)
        );
      }

      if (!rows.length) {
        return C.result(
          'Top 5 sin información visible',
          parsed.region
            ? `No encontré registros Top 5 para ${parsed.region} en ${parsed.month || 'el último periodo disponible'}.`
            : `No encontré registros Top 5 visibles para ${parsed.month || 'el último periodo disponible'}.`
        );
      }

      const detailRows = usableDetailRows(rows).map(row => ({
        ...row,
        calculatedCompliance: rowCompliance(row)
      }));

      const ordered = [...detailRows].sort((a, b) =>
        b.calculatedCompliance - a.calculatedCompliance
      );

      const total = totals(rows);
      const compliance = displayedCompliance(parsed, rows);
      const period = parsed.month || 'Último periodo';

      if (parsed.intent === 'compare') {
        const months = C.top5Data().months || [];
        const currentIndex = months.findIndex(item =>
          C.normalize(item.month) === C.normalize(period)
        );
        const current = months[currentIndex] || null;
        const previous = currentIndex > 0 ? months[currentIndex - 1] : null;

        return C.result(
          `Comparativo Top 5 · ${period}`,
          current && previous
            ? `${period} registra ${C.percent(current.compliance, 2)}, frente a ${C.percent(previous.compliance, 2)} en ${previous.month}.`
            : `El cumplimiento visible en ${period} es ${C.percent(compliance, 2)}.`,
          {
            html: `
              <div class="intel-result-grid">
                <div class="intel-result-card">
                  <small>Cumplimiento</small>
                  <strong>${C.percent(compliance, 2)}</strong>
                </div>
                <div class="intel-result-card">
                  <small>Administradores</small>
                  <strong>${C.number(rows.length)}</strong>
                </div>
                <div class="intel-result-card">
                  <small>Registros válidos</small>
                  <strong>${C.number(total.records)}</strong>
                </div>
              </div>
            `,
            actions: [{ label: 'Abrir Top 5', page: 'top5' }],
            note: 'El comparativo nacional utiliza los cierres ejecutivos oficiales de cada mes.',
            diagnosticData: {
              source: 'TOP5_DATA.months + TOP5_DATA.admins',
              records: total.records,
              expected: total.expected,
              formula: total.expected > 0 ? 'Registros válidos ÷ Meta' : 'Cierre ejecutivo oficial',
              calculation: total.expected > 0
                ? `${total.records} ÷ ${total.expected}`
                : `${C.percent(compliance, 2)}`,
              result: C.percent(compliance, 2)
            }
          }
        );
      }

      const detailUnavailable = detailRows.length === 0 || total.expected === 0;

      const detailHtml = detailUnavailable
        ? `<div class="intel-note">
            La fuente de ${C.escapeHtml(period)} conserva el porcentaje consolidado,
            pero no contiene el desglose de registros y metas por Administrador.
           </div>`
        : C.listHtml(ordered, row => ({
            title: row.administrator,
            subtitle: `${row.region} · ${(Array.isArray(row.parks) ? row.parks : []).join(', ')}`,
            value: C.percent(row.calculatedCompliance, 1)
          }));

      const title =
        `Rendimiento Top 5 · ${parsed.region ? `${parsed.region} · ` : ''}${period}`;

      const scopeText = parsed.region
        ? `de ${parsed.region}`
        : C.scopeInfo().level === 'division'
          ? 'de tu división'
          : 'nacional';

      return C.result(
        title,
        `El cumplimiento Top 5 ${scopeText} es ${C.percent(compliance, 2)} entre ${C.number(rows.length)} Administradores.`,
        {
          html: `
            <div class="intel-result-grid">
              <div class="intel-result-card">
                <small>Cumplimiento</small>
                <strong>${C.percent(compliance, 2)}</strong>
              </div>
              <div class="intel-result-card">
                <small>Administradores</small>
                <strong>${C.number(rows.length)}</strong>
              </div>
              <div class="intel-result-card">
                <small>Registros válidos</small>
                <strong>${C.number(total.records)}</strong>
              </div>
              <div class="intel-result-card">
                <small>Meta</small>
                <strong>${C.number(total.expected)}</strong>
              </div>
            </div>
            ${detailHtml}
          `,
          actions: [{ label: 'Ver Top 5 completo', page: 'top5' }],
          note: parsed.region
            ? 'El porcentaje regional se calcula como registros válidos ÷ meta regional.'
            : C.scopeInfo().level === 'division'
              ? 'El porcentaje divisional se calcula únicamente con los Administradores visibles para el usuario.'
              : 'El porcentaje nacional utiliza el cierre ejecutivo oficial almacenado en TOP5_DATA.',
          context: {
            domain: 'top5',
            region: parsed.region,
            month: period
          },
          diagnosticData: {
            source: parsed.region
              ? 'TOP5_DATA.admins (filtro regional)'
              : C.scopeInfo().level === 'division'
                ? 'TOP5_DATA.admins (alcance divisional)'
                : 'TOP5_DATA.months + TOP5_DATA.admins',
            records: total.records,
            expected: total.expected,
            formula: parsed.region || C.scopeInfo().level === 'division'
              ? 'Registros válidos ÷ Meta'
              : 'Cierre ejecutivo oficial del periodo',
            calculation: parsed.region || C.scopeInfo().level === 'division'
              ? `${total.records} ÷ ${total.expected}`
              : `${C.percent(compliance, 2)}`,
            result: C.percent(compliance, 2)
          }
        }
      );
    }
  });
})(window);
