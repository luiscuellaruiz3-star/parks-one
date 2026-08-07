    (function () {
    'use strict';

    const state = {
        users: [],
        scopes: [],
        divisions: [],
        regions: [],
        parks: [],
        client: null
    };

    const $ = selector => document.querySelector(selector);

    const esc = value =>
        String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
        })[char]);

    function getClient() {
        if (state.client) return state.client;

        const cfg = window.PARKS_CONFIG || {};

        if (
        !cfg.supabaseUrl ||
        !cfg.supabaseAnonKey ||
        !window.supabase?.createClient
        ) {
        throw new Error(
            'Supabase no está configurado o todavía no está disponible.'
        );
        }

        state.client = window.supabase.createClient(
        cfg.supabaseUrl,
        cfg.supabaseAnonKey,
        {
            auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
            }
        }
        );

        return state.client;
    }

    function currentProfile() {
        const cloudProfile =
            typeof window.ParksCloud?.profile === 'function'
                ? window.ParksCloud.profile()
                : window.ParksCloud?.profile;

        return cloudProfile || window.PARKS_PROFILE || {};
    }

    function isArchitect() {
        const role = String(
            currentProfile().role ||
            window.PARKS_AUTH_ROLE ||
            localStorage.getItem('parksOneRole') ||
            ''
        ).trim().toLowerCase();

        return role === 'arquitecto' || role === 'architect';
    }

    function notify(message) {
        if (typeof window.toast === 'function') {
        window.toast(message);
        } else {
        alert(message);
        }
    }

    function roleLabel(role) {
        return ({
        arquitecto: 'Arquitecto',
        ceo: 'CEO',
        director: 'Director',
        direccion: 'Dirección',
        divisional: 'Divisional',
        regional: 'Regional',
        administrador: 'Administrador',
        consulta: 'Consulta'
        })[role] || role || 'Sin rol';
    }

    function effectiveStatus(user) {
        if (user?.status === 'pendiente') return 'pendiente';
        if (user?.status === 'rechazado') return 'rechazado';
        if (user?.status === 'suspendido') return 'suspendido';
        return user?.is_active ? 'activo' : 'suspendido';
    }

    function isCurrentUser(user) {
        return Boolean(
            user?.id &&
            currentProfile()?.id &&
            user.id === currentProfile().id
        );
    }

    function activeArchitects() {
        return state.users.filter(user =>
            ['arquitecto', 'architect'].includes(
                String(user.role || '').toLowerCase()
            ) &&
            effectiveStatus(user) === 'activo'
        );
    }

    function rowStyle(user) {
        const status = effectiveStatus(user);

        if (status === 'pendiente') {
            return 'background:rgba(244,176,0,.07)';
        }

        if (status === 'suspendido' || status === 'rechazado') {
            return 'background:rgba(223,68,68,.055)';
        }

        return 'background:rgba(8,135,90,.025)';
    }

    function renderUserKpis() {
        const module = $('#moduloUsuarios');
        if (!module) return;

        let host = $('#userKpiCards');

        if (!host) {
            host = document.createElement('div');
            host.id = 'userKpiCards';
            host.style.cssText =
                'display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px;margin:0 0 18px';

            const filters =
                $('#buscarUsuario')?.closest('.users-filters') ||
                $('#buscarUsuario')?.parentElement;

            if (filters?.parentElement) {
                filters.parentElement.insertBefore(host, filters);
            } else {
                const table = $('#tablaUsuarios')?.closest('table');
                table?.parentElement?.insertBefore(host, table);
            }
        }

        const counts = state.users.reduce((acc, user) => {
            const status = effectiveStatus(user);
            acc[status] = (acc[status] || 0) + 1;

            if (
                ['arquitecto', 'architect'].includes(
                    String(user.role || '').toLowerCase()
                )
            ) {
                acc.arquitectos += 1;
            }

            return acc;
        }, {
            activo: 0,
            pendiente: 0,
            suspendido: 0,
            rechazado: 0,
            arquitectos: 0
        });

        const cards = [
            ['Activos', counts.activo, '#087a5a'],
            ['Pendientes', counts.pendiente, '#d48b00'],
            ['Suspendidos', counts.suspendido + counts.rechazado, '#c64040'],
            ['Arquitectos', counts.arquitectos, '#2563a6']
        ];

        host.innerHTML = cards.map(([label, value, color]) => `
            <div style="
                background:#fff;
                border:1px solid #dbe7e2;
                border-top:4px solid ${color};
                border-radius:14px;
                padding:14px 16px;
                box-shadow:0 8px 22px rgba(4,72,58,.05)
            ">
                <small style="display:block;color:#6b7e78;font-weight:700">${label}</small>
                <strong style="display:block;margin-top:5px;font-size:28px;color:#064c3d">${value}</strong>
            </div>
        `).join('');
    }

    function actionButtons(user) {
        const status = effectiveStatus(user);
        const self = isCurrentUser(user);

        const edit = `
            <button class="btn secondary" type="button" data-edit-user="${user.id}">
                Editar
            </button>
        `;

        if (status === 'pendiente') {
            return `
                ${edit}
                <button class="btn primary" type="button" data-approve-user="${user.id}">
                    Aprobar
                </button>
                <button class="btn secondary" type="button" data-reject-user="${user.id}">
                    Rechazar
                </button>
            `;
        }

        const reset = `
            <button class="btn ghost" type="button" data-reset-user="${user.id}">
                Restablecer
            </button>
        `;

        if (status === 'activo') {
            return `
                ${edit}
                ${reset}
                <button
                    class="btn secondary"
                    type="button"
                    data-toggle-user="${user.id}"
                    ${self ? 'disabled title="No puedes suspender tu propia cuenta"' : ''}
                >
                    Suspender
                </button>
            `;
        }

        return `
            ${edit}
            ${reset}
            <button class="btn primary" type="button" data-toggle-user="${user.id}">
                Reactivar
            </button>
        `;
    }


    function statusLabel(user) {
        const status = effectiveStatus(user);

        if (status === 'pendiente') {
            return '<span class="badge bamber">Pendiente</span>';
        }

        if (status === 'rechazado') {
            return '<span class="badge bred">Rechazado</span>';
        }

        if (status === 'suspendido') {
            return '<span class="badge bred">Suspendido</span>';
        }

        return '<span class="badge bgreen">Activo</span>';
    }

    function scopeText(userId) {
        const rows = state.scopes.filter(
        scope => scope.user_id === userId
        );

        if (!rows.length) return 'Sin alcance asignado';

        return rows.map(scope => {
        if (scope.scope_type === 'nacional') {
            return 'Nacional';
        }

        if (scope.scope_type === 'division') {
            return (
            state.divisions.find(
                item => item.id === scope.division_id
            )?.name || 'División'
            );
        }

        if (scope.scope_type === 'region') {
            const region = state.regions.find(
            item => item.id === scope.region_id
            );

            return region
            ? `${region.code || ''} ${region.name || ''}`.trim()
            : 'Región';
        }

        if (scope.scope_type === 'parque') {
            const park = state.parks.find(
            item => item.id === scope.park_id
            );

            return park?.commercial_name || park?.name || 'Parque';
        }

        return scope.scope_type || 'Sin alcance';
        }).join(', ');
    }

    async function load() {
        if (!isArchitect()) return;

        const client = getClient();

        const [
        usersRes,
        scopesRes,
        regionsRes,
        parksRes,
        divisionsRes
        ] = await Promise.all([
        client
            .from('profiles')
            .select(
            'id,full_name,email,role,job_title,phone,is_active,status,approved_by,approved_at,suspended_at,last_login_at,created_at,updated_at'
            )
            .order('full_name'),

        client
            .from('user_scopes')
            .select(
            'id,user_id,scope_type,division_id,region_id,park_id,created_at'
            ),

        client
            .from('regions')
            .select('id,code,name,is_active')
            .eq('is_active', true)
            .order('name'),

        client
            .from('parks')
            .select(
            'id,code,name,commercial_name,region_id,status'
            )
            .eq('status', 'activo')
            .order('name'),

        client
            .from('divisions')
            .select('id,code,name,is_active')
            .eq('is_active', true)
            .order('name')
        ]);

        if (usersRes.error) throw usersRes.error;
        if (scopesRes.error) throw scopesRes.error;
        if (regionsRes.error) throw regionsRes.error;
        if (parksRes.error) throw parksRes.error;

        if (
        divisionsRes.error &&
        divisionsRes.error.code !== '42P01'
        ) {
        console.warn(
            'No fue posible cargar divisions:',
            divisionsRes.error
        );
        }

        state.users = usersRes.data || [];
        state.scopes = scopesRes.data || [];
        state.regions = regionsRes.data || [];
        state.parks = parksRes.data || [];
        state.divisions = divisionsRes.error
        ? []
        : divisionsRes.data || [];

        render();
    }

    function filteredUsers() {
        const query =
        ($('#buscarUsuario')?.value || '')
            .trim()
            .toLowerCase();

        const role = $('#filtroRol')?.value || '';
        const status = $('#filtroEstado')?.value || '';

        return state.users.filter(user => {
        const haystack =
            `${user.full_name || ''} ${user.email || ''}`
            .toLowerCase();

        const userStatus = effectiveStatus(user);

        return (
            (!query || haystack.includes(query)) &&
            (!role || user.role === role) &&
            (!status || userStatus === status)
        );
        });
    }
        function render() {
        const body = $('#tablaUsuarios');
        if (!body) return;

        renderUserKpis();

        const users = filteredUsers();

        if (!users.length) {
            body.innerHTML =
                '<tr><td colspan="6">No hay usuarios que coincidan con los filtros.</td></tr>';
            return;
        }

        body.innerHTML = users.map(user => `
            <tr style="${rowStyle(user)}">
                <td>
                    <b>${esc(user.full_name || 'Sin nombre')}</b><br>
                    <small>${esc(user.email || '')}</small>
                    ${
                        isCurrentUser(user)
                            ? '<br><small style="color:#087a5a;font-weight:800">Tu cuenta</small>'
                            : ''
                    }
                </td>

                <td>${esc(roleLabel(user.role))}</td>
                <td>${statusLabel(user)}</td>
                <td>${esc(scopeText(user.id))}</td>

                <td>
                    ${
                        user.last_login_at
                            ? new Date(user.last_login_at).toLocaleString('es-MX')
                            : 'Sin registro'
                    }
                </td>

                <td style="display:flex;gap:6px;flex-wrap:wrap">
                    ${actionButtons(user)}
                </td>
            </tr>
        `).join('');
    }

    function scopeOptions(
        selectedType = 'nacional',
        selectedId = ''
    ) {
        if (selectedType === 'division') {
        return state.divisions.map(item => `
            <option
            value="${item.id}"
            ${item.id === selectedId ? 'selected' : ''}
            >
            ${esc(item.name)}
            </option>
        `).join('');
        }

        if (selectedType === 'region') {
        return state.regions.map(item => `
            <option
            value="${item.id}"
            ${item.id === selectedId ? 'selected' : ''}
            >
            ${esc(item.code)} · ${esc(item.name)}
            </option>
        `).join('');
        }

        if (selectedType === 'parque') {
        return state.parks.map(item => `
            <option
            value="${item.id}"
            ${item.id === selectedId ? 'selected' : ''}
            >
            ${esc(item.commercial_name || item.name)}
            </option>
        `).join('');
        }

        return '';
    }

    function requiredScopeForRole(role) {
        const clean = String(role || '').trim().toLowerCase();

        if (clean === 'regional') return 'division';
        if (clean === 'administrador') return 'parque';

        if ([
            'arquitecto','architect',
            'ceo','director','direccion',
            'divisional','consulta'
        ].includes(clean)) return 'nacional';

        return 'nacional';
    }

    function userModal(user = null, options = {}) {
        const currentScope = user
        ? state.scopes.find(
            item => item.user_id === user.id
            )
        : null;

        const effectiveRole = user?.role || 'administrador';
        const defaultScope = requiredScopeForRole(effectiveRole);

        const scopeType =
        currentScope?.scope_type || defaultScope;

        const scopeId =
        currentScope?.division_id ||
        currentScope?.region_id ||
        currentScope?.park_id ||
        '';

        const approvalMode = Boolean(options.approvalMode);

        const title = approvalMode
        ? 'Aprobar usuario'
        : user
            ? 'Editar usuario'
            : 'Nuevo usuario';

        const divisionOption = state.divisions.length
        ? `
            <option
            value="division"
            ${scopeType === 'division' ? 'selected' : ''}
            >
            División
            </option>
        `
        : '';

        const html = `
        <form id="userAdminForm">
            <div class="upload-grid">

            <label>
                Nombre completo
                <input
                name="full_name"
                required
                value="${esc(user?.full_name || '')}"
                >
            </label>

            <label>
                Correo
                <input
                name="email"
                type="email"
                required
                ${user ? 'readonly' : ''}
                value="${esc(user?.email || '')}"
                >
            </label>

            ${
                user
                ? ''
                : `
                    <label>
                    Contraseña temporal
                    <input
                        name="password"
                        type="password"
                        minlength="8"
                        required
                    >
                    </label>
                `
            }

            <label>
                Rol
                <select name="role" id="userRoleSelect" required>
                ${
                    [
                    'arquitecto',
                    'ceo',
                    'director',
                    'divisional',
                    'regional',
                    'administrador',
                    'consulta'
                    ].map(role => `
                    <option
                        value="${role}"
                        ${(user?.role || 'administrador') === role ? 'selected' : ''}
                    >
                        ${roleLabel(role)}
                    </option>
                    `).join('')
                }
                </select>
            </label>

            <label>
                Estado
                <select name="status">
                <option
                    value="pendiente"
                    ${!approvalMode && user?.status === 'pendiente' ? 'selected' : ''}
                >
                    Pendiente
                </option>

                <option
                    value="activo"
                    ${
                    approvalMode ||
                    user?.status === 'activo' ||
                    (!user?.status && user?.is_active !== false)
                        ? 'selected'
                        : ''
                    }
                >
                    Activo
                </option>

                <option
                    value="suspendido"
                    ${
                    user?.status === 'suspendido' ||
                    user?.is_active === false
                        ? 'selected'
                        : ''
                    }
                >
                    Suspendido
                </option>
                </select>
            </label>

            <label>
                Tipo de alcance
                <select
                name="scope_type"
                id="userScopeType"
                >
                <option
                    value="nacional"
                    ${scopeType === 'nacional' ? 'selected' : ''}
                >
                    Nacional
                </option>

                ${divisionOption}

                <option
                    value="region"
                    ${scopeType === 'region' ? 'selected' : ''}
                >
                    Región
                </option>

                <option
                    value="parque"
                    ${scopeType === 'parque' ? 'selected' : ''}
                >
                    Parque
                </option>
                </select>
            </label>

            <label id="userScopeTargetLabel">
                Alcance
                <select
                name="scope_id"
                id="userScopeTarget"
                >
                ${scopeOptions(scopeType, scopeId)}
                </select>
            </label>

            </div>

            <div
            style="
                display:flex;
                justify-content:flex-end;
                gap:8px;
                margin-top:18px
            "
            >
            <button
                class="btn secondary"
                type="button"
                onclick="closeModal()"
            >
                Cancelar
            </button>

            <button
                class="btn primary"
                type="submit"
            >
                ${approvalMode ? 'Aprobar usuario' : 'Guardar'}
            </button>
            </div>
        </form>
        `;

        window.openModal(title, html);

        const roleSelect = $('#userRoleSelect');
        const typeSelect = $('#userScopeType');
        const target = $('#userScopeTarget');
        const label = $('#userScopeTargetLabel');

        function refreshTarget(preserveId = '') {
        const type = typeSelect.value;

        label.style.display =
            type === 'nacional'
            ? 'none'
            : '';

        target.innerHTML =
            scopeOptions(type, preserveId);
        }

        function enforceRoleScope(preserveId = '') {
            const required = requiredScopeForRole(roleSelect.value);
            typeSelect.value = required;
            typeSelect.title =
                roleSelect.value === 'regional'
                    ? 'El Regional opera toda su división.'
                    : roleSelect.value === 'administrador'
                        ? 'El Administrador opera el parque asignado.'
                        : 'Este rol utiliza alcance nacional.';
            refreshTarget(preserveId);
        }

        roleSelect.addEventListener(
        'change',
        () => enforceRoleScope()
        );

        typeSelect.addEventListener(
        'change',
        () => {
            const required = requiredScopeForRole(roleSelect.value);
            if (typeSelect.value !== required) typeSelect.value = required;
            refreshTarget();
        }
        );

        enforceRoleScope(scopeId);

        $('#userAdminForm').addEventListener(
        'submit',
        event => {
            saveUser(event, user, options).catch(handleError);
        }
        );
    }
        async function saveUser(event, user, options = {}) {
        event.preventDefault();

        const submitButton =
        event.currentTarget.querySelector('[type="submit"]');

        submitButton.disabled = true;
        submitButton.textContent = 'Guardando…';

        try {
        const form = new FormData(event.currentTarget);
        const status =
            String(form.get('status') || 'activo');

        const payload = {
            full_name:
            String(form.get('full_name') || '').trim(),

            email:
            String(form.get('email') || '')
                .trim()
                .toLowerCase(),

            role: form.get('role'),

            status,

            is_active:
            status === 'activo',

            scope_type:
            form.get('scope_type'),

            scope_id:
            form.get('scope_id') || null
        };

        const requiredScope = requiredScopeForRole(payload.role);
        if (payload.scope_type !== requiredScope) {
            throw new Error(
                `El rol ${roleLabel(payload.role)} requiere alcance ${requiredScope}.`
            );
        }
        if (requiredScope !== 'nacional' && !payload.scope_id) {
            throw new Error('Selecciona el alcance organizacional del usuario.');
        }

        if (!user) {
            payload.password =
            String(form.get('password') || '');
        }

        if (!user) {
            const { data, error } =
            await getClient().functions.invoke(
                'admin-users',
                {
                body: {
                    action: 'create_user',
                    ...payload
                }
                }
            );

        if (error) {
    let message = error.message || 'Error al ejecutar admin-users.';

    try {
        if (error.context && typeof error.context.json === 'function') {
        const functionError = await error.context.json();

        message =
            functionError?.error?.message ||
            functionError?.error ||
            functionError?.message ||
            message;
        }
    } catch (readError) {
        console.error(
        'No fue posible leer la respuesta de la Edge Function:',
        readError
        );
    }

    throw new Error(message);
    }

    if (data?.error) {
    throw new Error(
        data.error?.message ||
        data.error
    );
    }
        } else {
            const approvalMode = Boolean(options.approvalMode);
            const current = currentProfile();

            if (
                isCurrentUser(user) &&
                (
                    payload.status !== 'activo' ||
                    !['arquitecto', 'architect'].includes(
                        String(payload.role || '').toLowerCase()
                    )
                )
            ) {
                throw new Error(
                    'No puedes suspender tu propia cuenta ni quitarte el rol de Arquitecto.'
                );
            }

            if (
                ['arquitecto', 'architect'].includes(
                    String(user.role || '').toLowerCase()
                ) &&
                activeArchitects().length === 1 &&
                (
                    payload.status !== 'activo' ||
                    !['arquitecto', 'architect'].includes(
                        String(payload.role || '').toLowerCase()
                    )
                )
            ) {
                throw new Error(
                    'No puedes desactivar ni cambiar el rol del único Arquitecto activo.'
                );
            }

            const updates = {
            full_name: payload.full_name,
            role: payload.role,
            status: payload.status,
            is_active: payload.is_active,

            suspended_at:
                payload.status === 'suspendido'
                ? new Date().toISOString()
                : null,

            approved_by:
                approvalMode
                    ? current?.id || null
                    : user.approved_by || null,

            approved_at:
                approvalMode
                    ? new Date().toISOString()
                    : user.approved_at || null
            };

            const { error } = await getClient()
            .from('profiles')
            .update(updates)
            .eq('id', user.id);

            if (error) throw error;

            await replaceScope(
            user.id,
            payload.scope_type,
            payload.scope_id
            );
        }

        window.closeModal();

        notify(
            options.approvalMode
            ? 'Usuario aprobado y activado.'
            : user
                ? 'Usuario actualizado.'
                : 'Usuario creado.'
        );

        await load();

        } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Guardar';
        }
    }

    async function replaceScope(
        userId,
        type,
        scopeId
    ) {
        const client = getClient();

        const deleteResult = await client
        .from('user_scopes')
        .delete()
        .eq('user_id', userId);

        if (deleteResult.error) {
        throw deleteResult.error;
        }

        const row = {
        user_id: userId,
        scope_type: type,
        created_by:
            currentProfile().id || null
        };

        if (type === 'division') {
        row.division_id = scopeId;
        }

        if (type === 'region') {
        row.region_id = scopeId;
        }

        if (type === 'parque') {
        row.park_id = scopeId;
        }

        const insertResult = await client
        .from('user_scopes')
        .insert(row);

        if (insertResult.error) {
        throw insertResult.error;
        }
    }


    function approveUser(id) {
        const user = state.users.find(item => item.id === id);
        if (!user) return;

        userModal(user, { approvalMode: true });
    }

    async function rejectUser(id) {
        const user = state.users.find(item => item.id === id);
        if (!user) return;

        if (isCurrentUser(user)) {
            throw new Error('No puedes rechazar tu propia cuenta.');
        }

        const reason = prompt(
            `Motivo del rechazo para ${user.full_name || user.email}:`,
            'Solicitud no autorizada'
        );

        if (reason === null) return;

        const confirmed = confirm(
            `¿Rechazar la solicitud de ${user.full_name || user.email}?`
        );

        if (!confirmed) return;

        /*
         * El esquema actual trabaja con pendiente / activo / suspendido.
         * Un rechazo se conserva como suspendido para mantener compatibilidad
         * con las políticas y filtros existentes.
         */
        const { error } = await getClient()
            .from('profiles')
            .update({
                is_active: false,
                status: 'suspendido',
                suspended_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) throw error;

        notify(
            `Solicitud rechazada.${reason.trim() ? ' Motivo: ' + reason.trim() : ''}`
        );

        await load();
    }

    async function toggleUser(id) {
        const user = state.users.find(item => item.id === id);
        if (!user) return;

        if (isCurrentUser(user)) {
            throw new Error(
                'No puedes suspender ni modificar el estado de tu propia cuenta.'
            );
        }

        const userIsArchitect =
            ['arquitecto', 'architect'].includes(
                String(user.role || '').toLowerCase()
            );

        if (
            userIsArchitect &&
            activeArchitects().length === 1 &&
            effectiveStatus(user) === 'activo'
        ) {
            throw new Error(
                'No puedes suspender al único Arquitecto activo del sistema.'
            );
        }

        if (effectiveStatus(user) === 'pendiente') {
            approveUser(id);
            return;
        }

        const nextActive = effectiveStatus(user) !== 'activo';

        const confirmed = confirm(
            `${nextActive ? 'Reactivar' : 'Suspender'} a ${
                user.full_name || user.email
            }?`
        );

        if (!confirmed) return;

        const updates = {
            is_active: nextActive,
            status: nextActive ? 'activo' : 'suspendido',
            suspended_at: nextActive ? null : new Date().toISOString()
        };

        const { error } = await getClient()
            .from('profiles')
            .update(updates)
            .eq('id', id);

        if (error) throw error;

        notify(
            nextActive
                ? 'Usuario reactivado.'
                : 'Usuario suspendido.'
        );

        await load();
    }

    async function resetPassword(id) {
        const user = state.users.find(
        item => item.id === id
        );

        if (!user?.email) return;

        const confirmed = confirm(
        `Enviar correo de restablecimiento a ${user.email}?`
        );

        if (!confirmed) return;

        const { data, error } =
        await getClient().functions.invoke(
            'admin-users',
            {
            body: {
                action: 'reset_password',
                user_id: id,
                email: user.email
            }
            }
        );

        if (error) throw error;

        if (data?.error) {
        throw new Error(data.error);
        }

        notify(
        'Correo de restablecimiento enviado.'
        );
    }

    async function init() {
    const module = $('#moduloUsuarios');
    if (!module) return;

    // Espera activa hasta que cloud.js cargue completamente el perfil.
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
        const profile = currentProfile();
        if (profile && profile.id && profile.role) {
            ready = true;
            break;
        }
        await new Promise(r=>setTimeout(r,200));
    }

    if (!ready) {
        // Reintenta automáticamente sin mostrar acceso restringido.
        setTimeout(() => init().catch(handleError), 1000);
        return;
    }

    if (!isArchitect()) {
        module.innerHTML = `
        <div class="preview-message">
            <b>Acceso restringido</b>
            Solo el Arquitecto del Sistema puede administrar usuarios.
        </div>
        `;

        return;
    }

        $('#btnNuevoUsuario')
        ?.addEventListener(
            'click',
            () => userModal()
        );

        [
        'buscarUsuario',
        'filtroRol',
        'filtroEstado'
        ].forEach(id => {
        const element = $('#' + id);

        element?.addEventListener(
            'input',
            render
        );

        element?.addEventListener(
            'change',
            render
        );
        });

        document.addEventListener(
        'click',
        event => {
            const editId =
            event.target
                .closest('[data-edit-user]')
                ?.dataset.editUser;

            const toggleId =
            event.target
                .closest('[data-toggle-user]')
                ?.dataset.toggleUser;

            const resetId =
            event.target
                .closest('[data-reset-user]')
                ?.dataset.resetUser;

            const approveId =
            event.target
                .closest('[data-approve-user]')
                ?.dataset.approveUser;

            const rejectId =
            event.target
                .closest('[data-reject-user]')
                ?.dataset.rejectUser;

            if (editId) {
            userModal(
                state.users.find(
                item => item.id === editId
                )
            );
            }

            if (toggleId) {
            toggleUser(toggleId)
                .catch(handleError);
            }

            if (resetId) {
            resetPassword(resetId)
                .catch(handleError);
            }

            if (approveId) {
            approveUser(approveId);
            }

            if (rejectId) {
            rejectUser(rejectId)
                .catch(handleError);
            }
        }
        );

        await load();
    }

    function handleError(error) {
        console.error(error);

        let message =
        error?.message || String(error);

        if (
        /Failed to send a request to the Edge Function/i
            .test(message) ||
        /Function not found/i.test(message) ||
        /404/i.test(message)
        ) {
        message =
            'La función segura admin-users todavía no está desplegada en Supabase.';
        }

        alert(message);
    }

    window.ParksUsers = {
        load,
        init,
        reload: load
    };

function startUsersModule() {
    setTimeout(
        () => init().catch(handleError),
        800
    );
}

if (document.readyState === 'loading') {
    window.addEventListener('load', startUsersModule);
} else {
    startUsersModule();
}
})();
