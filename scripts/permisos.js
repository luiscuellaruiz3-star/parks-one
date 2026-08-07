(function () {
  'use strict';

  const ROLE_ALIASES = Object.freeze({
    architect: 'arquitecto',
    executive: 'direccion',
    administrator: 'administrador',
    operations: 'divisional',
    direccion: 'direccion',
    director: 'director',
    ceo: 'ceo',
    divisional: 'divisional',
    regional: 'regional',
    administrador: 'administrador',
    consulta: 'consulta',
    arquitecto: 'arquitecto'
  });

  const MODULES = Object.freeze({
    administrador: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','flujo','calendario','reportes'
    ],
    regional: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','flujo','calendario','reportes'
    ],
    divisional: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','flujo','calendario','reportes'
    ],
    direccion: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','calendario','reportes'
    ],
    director: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','calendario','reportes'
    ],
    ceo: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','calendario','reportes'
    ],
    consulta: [
      'inicio','parques','top23','top5','alertas','documentos',
      'agua','inteligencia','calendario','reportes'
    ],
    arquitecto: [
      'inicio','parques','top23','top5','alertas','documentos',
      'importacion','agua','inteligencia','flujo','calendario',
      'reportes','auditoria','moduloUsuarios'
    ]
  });

  const ROLE_PERMISSIONS = Object.freeze({
    consulta: Object.freeze({
      viewAll: true, download: true, upload: false,
      directPublish: false, approve: false, returnDocument: false,
      editMetadata: false, trash: false, restore: false,
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'own',
      workflowMode: 'hidden'
    }),
    administrador: Object.freeze({
      viewAll: false, download: true, upload: true,
      directPublish: false, approve: false, returnDocument: false,
      editMetadata: false, trash: false, restore: false,
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'own',
      workflowMode: 'own-followup'
    }),
    regional: Object.freeze({
      viewAll: false, download: true, upload: true,
      directPublish: 'own-division', approve: 'own-division',
      returnDocument: 'own-division', editMetadata: 'own-division',
      trash: 'own-division', restore: 'own-division',
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'own-division',
      workflowMode: 'division-approval'
    }),
    divisional: Object.freeze({
      viewAll: true, download: true, upload: true,
      directPublish: 'national', approve: 'national',
      returnDocument: 'national', editMetadata: 'national',
      trash: 'national', restore: 'national',
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'national',
      workflowMode: 'national-approval'
    }),
    direccion: Object.freeze({
      viewAll: true, download: true, upload: false,
      directPublish: false, approve: false, returnDocument: false,
      editMetadata: false, trash: false, restore: false,
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'executive',
      workflowMode: 'hidden'
    }),
    director: Object.freeze({
      viewAll: true, download: true, upload: false,
      directPublish: false, approve: false, returnDocument: false,
      editMetadata: false, trash: false, restore: false,
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'executive',
      workflowMode: 'hidden'
    }),
    ceo: Object.freeze({
      viewAll: true, download: true, upload: false,
      directPublish: false, approve: false, returnDocument: false,
      editMetadata: false, trash: false, restore: false,
      permanentDelete: false, manageUsers: false,
      importNational: false, viewAudit: 'executive',
      workflowMode: 'hidden'
    }),
    arquitecto: Object.freeze({
      viewAll: true, download: true, upload: true,
      directPublish: 'national', approve: 'national',
      returnDocument: 'national', editMetadata: 'national',
      trash: 'national', restore: 'national',
      permanentDelete: true, manageUsers: true,
      importNational: true, viewAudit: 'complete',
      workflowMode: 'full-control'
    })
  });

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  function normalizeRole(role) {
    const clean = String(role || '').trim().toLowerCase();
    return ROLE_ALIASES[clean] || clean || 'consulta';
  }

  function profile() {
    return typeof window.ParksCloud?.profile === 'function'
      ? (window.ParksCloud.profile() || {})
      : {};
  }

  function accessScope() {
    return typeof window.ParksCloud?.accessScope === 'function'
      ? (window.ParksCloud.accessScope() || {})
      : {};
  }

  function currentRole(explicitRole) {
    const realProfile = profile();
    const realRole = normalizeRole(
      realProfile.role ||
      window.PARKS_REAL_ROLE ||
      window.PARKS_AUTH_ROLE ||
      'consulta'
    );

    const realIsArchitect = realRole === 'arquitecto';

    // Solo el Arquitecto real puede pedir una vista simulada.
    if (realIsArchitect) {
      const simulated =
        explicitRole ||
        window.PARKS_SIMULATED_ROLE ||
        localStorage.getItem('parksOneSimulatedRole') ||
        '';

      if (simulated) return normalizeRole(simulated);
    }

    // Para cualquier otro usuario siempre manda el rol real de Supabase.
    return realRole;
  }

  function realRole() {
    return normalizeRole(
      profile().role ||
      window.PARKS_REAL_ROLE ||
      window.PARKS_AUTH_ROLE ||
      'consulta'
    );
  }

  function isRealArchitect() {
    return realRole() === 'arquitecto';
  }

  function setSimulatedRole(role) {
    if (!isRealArchitect()) return false;

    const normalized = normalizeRole(role);
    window.PARKS_SIMULATED_ROLE = normalized;

    try {
      localStorage.setItem('parksOneSimulatedRole', normalized);
    } catch (_) {}

    return true;
  }

  function clearSimulatedRole() {
    window.PARKS_SIMULATED_ROLE = '';

    try {
      localStorage.removeItem('parksOneSimulatedRole');
    } catch (_) {}
  }

  function permissionsFor(role) {
    return ROLE_PERMISSIONS[currentRole(role)] || ROLE_PERMISSIONS.consulta;
  }

  function userDivision(context = {}) {
    const p = context.profile || profile();
    const s = context.scope || accessScope();
    return normalize(
      context.userDivision ||
      s.division_code ||
      s.division_name ||
      s.division_id ||
      p.division_code ||
      p.division ||
      p.division_id ||
      ''
    );
  }

  function sameDivision(context = {}) {
    const user = userDivision(context);
    const target = normalize(
      context.documentDivision ||
      context.division ||
      context.parkDivision ||
      ''
    );
    return Boolean(user && target && user === target);
  }

  function userPark(context = {}) {
    const p = context.profile || profile();
    const s = context.scope || accessScope();
    return normalize(
      context.userPark ||
      s.park_code ||
      s.park_name ||
      s.park_id ||
      p.park_code ||
      p.park ||
      p.park_id ||
      ''
    );
  }

  function samePark(context = {}) {
    const user = userPark(context);
    const target = normalize(
      context.documentPark ||
      context.park ||
      context.parkCode ||
      context.parkId ||
      ''
    );
    return Boolean(user && target && user === target);
  }

  function scopedPermission(value, context = {}) {
    if (value === true || value === 'national' || value === 'complete') return true;
    if (!value || value === false) return false;
    if (value === 'own-division') return sameDivision(context);
    if (value === 'own') {
      return Boolean(
        context.userId && context.currentUserId &&
        context.userId === context.currentUserId
      );
    }
    if (value === 'executive') return true;
    return false;
  }

  function can(action, context = {}) {
    const permission = permissionsFor(context.role)[action];
    return scopedPermission(permission, context);
  }

  function canModule(moduleId, role) {
    const normalizedRole = currentRole(role);
    const modules = MODULES[normalizedRole] || MODULES.consulta;
    return modules.includes(moduleId);
  }

  function workflowMode(role) {
    return permissionsFor(role).workflowMode || 'hidden';
  }

  function canSeeWorkflowRequest(request, context = {}) {
    const mode = workflowMode(context.role);
    if (mode === 'hidden') return false;
    if (mode === 'full-control' || mode === 'national-approval' || mode === 'executive-readonly') {
      return true;
    }
    if (mode === 'own-followup') {
      const me = profile();
      if (request?.uploadedById && me?.id && request.uploadedById === me.id) return true;
      return samePark({
        ...context,
        documentPark: request?.park || request?.parkCode || request?.parkId
      });
    }
    if (mode === 'division-followup' || mode === 'division-approval') {
      return sameDivision({
        ...context,
        documentDivision: request?.division || request?.parkDivision
      });
    }
    return false;
  }

  function canApproveRequest(request, context = {}) {
    return can('approve', {
      ...context,
      documentDivision: request?.division || request?.parkDivision
    });
  }

  function canReturnRequest(request, context = {}) {
    return can('returnDocument', {
      ...context,
      documentDivision: request?.division || request?.parkDivision
    });
  }

  function uploadDecision(context = {}) {
    const role = currentRole(context.role);
    if (!permissionsFor(role).upload) {
      return { allowed:false, publication:'blocked', approvalScope:'none',
        reason:'Este rol no tiene permiso para cargar documentos.' };
    }
    if (role === 'administrador') {
      return { allowed:true, publication:'pending', approvalScope:'own-division' };
    }
    if (role === 'regional') {
      return sameDivision(context)
        ? { allowed:true, publication:'direct', approvalScope:'own-division' }
        : { allowed:false, publication:'blocked', approvalScope:'own-division',
            reason:'El Regional solo puede publicar directamente dentro de su división.' };
    }
    if (role === 'divisional' || role === 'arquitecto') {
      return { allowed:true, publication:'direct', approvalScope:'national' };
    }
    return { allowed:false, publication:'blocked', approvalScope:'none',
      reason:'Este rol no tiene permiso para cargar documentos.' };
  }

  function applyModuleVisibility() {
    const role = currentRole();

    document.querySelectorAll('.nav [data-page]').forEach(button => {
      const moduleId = button.dataset.page;
      const visible = canModule(moduleId, role);
      button.hidden = !visible;
      button.style.display = visible ? '' : 'none';
    });

    document.querySelectorAll('.page').forEach(page => {
      if (!canModule(page.id, role) && page.classList.contains('active')) {
        page.classList.remove('active');
        document.getElementById('inicio')?.classList.add('active');
      }
    });

    document.documentElement.dataset.parksRole = role;
    document.documentElement.dataset.workflowMode = workflowMode(role);
  }

  function applyReadOnlyInterface() {
    const role = currentRole();
    const readOnly = ['direccion','director','ceo','consulta'].includes(role);

    document.querySelectorAll('[data-parks-role-hidden="1"]').forEach(element => {
      element.style.removeProperty('display');
      delete element.dataset.parksRoleHidden;
    });

    if (!readOnly) return;

    const mutatingText = /(^|\s)(cargar|subir|importar|aprobar|devolver|rechazar|eliminar|borrar|restaurar|guardar|publicar|actualizar matriz|actualizar fuente|nuevo usuario|crear usuario|editar usuario|configurar)(\s|$)/i;

    document.querySelectorAll('button, label.btn, a.btn').forEach(element => {
      if (element.closest('.nav')) return;
      const text = String(element.textContent || '').replace(/\s+/g,' ').trim();
      if (mutatingText.test(text)) {
        element.style.display = 'none';
        element.dataset.parksRoleHidden = '1';
      }
    });
  }

  function applyInterface() {
    applyModuleVisibility();

    document.querySelectorAll('[data-permission]').forEach(element => {
      const allowed = can(element.dataset.permission);
      element.hidden = !allowed;
      element.disabled = !allowed;
    });

    applyReadOnlyInterface();
  }

  window.ParksPermissions = Object.freeze({
    ROLE_PERMISSIONS, MODULES, normalizeRole, currentRole,
    realRole, isRealArchitect, setSimulatedRole, clearSimulatedRole,
    permissionsFor, userDivision, sameDivision, userPark, samePark, can, canModule,
    workflowMode, canSeeWorkflowRequest, canApproveRequest,
    canReturnRequest, uploadDecision, applyModuleVisibility,
    applyReadOnlyInterface, applyInterface
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyInterface);
  } else {
    applyInterface();
  }
})();
