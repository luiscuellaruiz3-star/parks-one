(function (global) {
  'use strict';

  const Core = global.ParksIntelligenceCore;

  function findPark(label) {
    if (!label) return null;
    const target = Core.normalize(label);
    return Core.visibleParks().find(park =>
      Core.normalize(park.park) === target
    ) || null;
  }

  function top5ForPark(parkName, month = '') {
    const target = Core.normalize(parkName);
    let rows = Core.visibleTop5(month, '');
    rows = rows.filter(row => {
      const parks = Array.isArray(row.parks)
        ? row.parks
        : String(row.parks || '').split(',').map(item => item.trim()).filter(Boolean);
      return parks.some(park => Core.normalize(park) === target);
    });
    return rows;
  }

  function alertsForPark(parkName) {
    const target = Core.normalize(parkName);
    return Core.visibleAlerts().filter(alert =>
      Core.normalize(alert.park) === target
    );
  }

  function documentSummary(park) {
    const result = {
      integrated: 0, pending: 0, validating: 0, na: 0, unknown: 0,
      total: 0
    };
    Object.values(park?.statuses || {}).forEach(raw => {
      const status = Core.statusLabel(raw);
      result[status.group] = (result[status.group] || 0) + 1;
      result.total += 1;
    });
    return result;
  }

  function latestTop5(parkName, preferredMonth = '') {
    const periods = Core.availableTop5Periods();
    const period = preferredMonth || periods.at(-1) || '';
    const rows = top5ForPark(parkName, period);
    if (!rows.length) return null;

    const records = rows.reduce((sum, row) => sum + (Number(row.records) || 0), 0);
    const expected = rows.reduce((sum, row) => sum + (Number(row.expected) || 0), 0);
    const compliance = expected > 0
      ? records / expected
      : rows.reduce((sum, row) => sum + (Number(row.compliance) || 0), 0) / rows.length;

    return {
      month: period,
      compliance,
      records,
      expected,
      administrators: [...new Set(rows.map(row => row.administrator).filter(Boolean))]
    };
  }

  function parkSnapshot(parkName, month = '') {
    const park = findPark(parkName);
    if (!park) return null;

    const docs = documentSummary(park);
    const alerts = alertsForPark(parkName);
    const top5 = latestTop5(parkName, month);
    const hydrica = park.hydrica || {};

    return {
      park,
      relations: {
        administrator: park.administrator || '',
        region: park.region || '',
        division: park.division || '',
        supply: hydrica.suministro || park.supply || '',
        ptar: hydrica.ptar || park.ptar || '',
        pozo: hydrica.pozo || '',
        discharge: hydrica.tipo_descarga || park.discharge || ''
      },
      documents: docs,
      alerts,
      top5
    };
  }

  function parksByAdministrator(name) {
    const target = Core.normalize(name);
    return Core.visibleParks().filter(park =>
      Core.normalize(park.administrator) === target
    );
  }

  function entityGraph(entity) {
    if (entity?.kind === 'park' && entity.label) {
      return parkSnapshot(entity.label);
    }
    if (entity?.kind === 'administrator' && entity.label) {
      const parks = parksByAdministrator(entity.label);
      return {
        administrator: entity.label,
        parks,
        regions: [...new Set(parks.map(park => park.region).filter(Boolean))],
        divisions: [...new Set(parks.map(park => park.division).filter(Boolean))]
      };
    }
    return null;
  }

  global.ParksIntelligenceKnowledge = Object.freeze({
    findPark,
    parkSnapshot,
    parksByAdministrator,
    top5ForPark,
    alertsForPark,
    entityGraph
  });
})(window);
