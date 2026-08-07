(function (global) {
  'use strict';

  const documents = Object.freeze({
    predial: {
      label: 'Predial',
      aliases: [
        'predial','prediales','pago predial','pago de predial',
        'impuesto predial','boleta predial','recibo predial',
        'pago de impuesto predial','catastro'
      ]
    },
    agua: {
      label: 'Agua',
      aliases: ['agua','pago de agua','recibo de agua','consumo de agua']
    },
    descargas: {
      label: 'Descargas',
      aliases: [
        'descarga','descargas','permiso de descarga','permisos de descarga',
        'pago de descarga','pago de descargas'
      ]
    },
    funcionamiento: {
      label: 'Licencia de Funcionamiento',
      aliases: [
        'licencia de funcionamiento','funcionamiento',
        'licencia funcionamiento','licencia de operacion'
      ]
    },
    uso_suelo: {
      label: 'Uso de Suelo',
      aliases: [
        'uso de suelo','uso suelo','licencia de uso de suelo','licencia de uso',
        'lus','zonificacion','certificado de zonificacion'
      ]
    },
    pc_estatal: {
      label: 'PC estatal',
      aliases: [
        'proteccion civil estatal','pc estatal','dictamen estatal de proteccion civil'
      ]
    },
    pc_municipal: {
      label: 'PC municipal',
      aliases: [
        'proteccion civil municipal','pc municipal','dictamen municipal de proteccion civil'
      ]
    },
    proteccion_civil: {
      label: 'Protección Civil',
      aliases: [
        'proteccion civil','pc','dictamen pc','visto bueno pc',
        'dictamen de proteccion civil'
      ]
    },
    estructural: {
      label: 'Dictamen estructural',
      aliases: [
        'dictamen estructural','estructural','dictamen de seguridad estructural'
      ]
    },
    factibilidad_agua: {
      label: 'Factibilidad de agua',
      aliases: [
        'factibilidad de agua','factibilidad agua','factibilidad hidraulica'
      ]
    },
    alineamiento: {
      label: 'Alineamiento y número oficial',
      aliases: [
        'alineamiento','numero oficial','número oficial',
        'alineamiento y numero oficial'
      ]
    },
    impacto_regional: {
      label: 'Impacto regional',
      aliases: [
        'impacto regional','factibilidad impacto regional','impacto edomex'
      ]
    },
    terminacion_obra: {
      label: 'Terminación de obra',
      aliases: [
        'terminacion de obra','constancia de terminacion de obra','terminacion obra'
      ]
    },
    construccion: {
      label: 'Licencia de construcción',
      aliases: [
        'licencia de construccion','construccion','licencia construcción'
      ]
    },
    ambiental: {
      label: 'Licencia ambiental',
      aliases: ['licencia ambiental','ambiental','permiso ambiental']
    },
    junta_caminos: {
      label: 'Acceso Junta de Caminos',
      aliases: [
        'junta de caminos','acceso junta de caminos','permiso de acceso'
      ]
    },
    anuncios_totem: {
      label: 'Permisos anuncios / Tótem',
      aliases: [
        'anuncios','permiso de anuncios','permisos de anuncios',
        'totem','tótem','permiso de totem'
      ]
    },
    constancia_estructural: {
      label: 'Constancia seguridad estructural',
      aliases: [
        'constancia seguridad estructural','constancia estructural',
        'constancia de seguridad estructural'
      ]
    },
    visto_bueno: {
      label: 'Visto bueno seguridad y operación',
      aliases: [
        'visto bueno','visto bueno seguridad y operacion','vbo',
        'vo bo','visto bueno de seguridad y operacion'
      ]
    },
    pozo_cesion: {
      label: 'Pozo cesión',
      aliases: ['pozo cesion','cesion de pozo','cesión pozo']
    },
    pozo_titulo: {
      label: 'Pozo título',
      aliases: [
        'titulo de pozo','titulo conagua','concesion de pozo',
        'concesion conagua','pozo titulo'
      ]
    },
    pozo_consumo: {
      label: 'Pozo consumo',
      aliases: ['consumo pozo','pozo consumo','lectura de pozo']
    }
  });

  const concepts = Object.freeze({
    ptar: {
      label: 'PTAR',
      aliases: [
        'ptar','ptra','planta de tratamiento','planta tratadora',
        'planta de tratamiento de aguas','tratamiento de aguas',
        'tratadora de agua'
      ]
    },
    pozo: {
      label: 'Pozo',
      aliases: [
        'pozo','pozos','pozo de agua','pozo profundo','concesion de agua'
      ]
    },
    descarga: {
      label: 'Descarga',
      aliases: [
        'descarga','descargas','descarga sanitaria','descarga federal',
        'descarga municipal','vertimiento'
      ]
    },
    red: {
      label: 'Red municipal',
      aliases: ['red municipal','red de agua','red publica','red pública']
    },
    pipa: {
      label: 'Pipa',
      aliases: ['pipa','pipas','agua por pipa','abastecimiento por pipa']
    }
  });

  const executive = Object.freeze([
    'como amanecimos','cómo amanecimos','que me preocupa','qué me preocupa',
    'resumen ejecutivo','panorama ejecutivo','dame el panorama',
    'estado general de la operacion','estado general de la operación',
    'prioridades de hoy','que debo atender','qué debo atender'
  ]);

  const relationWords = Object.freeze({
    administrator: [
      'administrador','admin','quien administra','quién administra',
      'responsable','encargado'
    ],
    region: ['region','región','que region','qué región'],
    documents: ['documentos','expediente','top 23','top23'],
    top5: ['top 5','top5','rendimiento','cumplimiento operativo'],
    water: ['agua','ptar','pozo','descarga','hidraulica','hidráulica'],
    alerts: ['alertas','alerta','riesgos','riesgo']
  });

  global.ParksIntelligenceAliases = Object.freeze({
    documents, concepts, executive, relationWords
  });
})(window);
