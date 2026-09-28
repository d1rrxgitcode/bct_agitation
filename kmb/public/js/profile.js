(async function () {
  const user = await requireSession();
  if (!user) return;
  renderShell('profile');
  const canEdit = CAN_EDIT_ROSTER.includes(user.role);

  const main = document.getElementById('main-content');
  const id = new URLSearchParams(window.location.search).get('id') || (user.personnel_id ? String(user.personnel_id) : '');

  if (!id) {
    main.innerHTML = `<div class="card">Личное дело не выбрано. Выберите бойца в разделе «Состав» или попросите командование привязать ваш логин к личному делу.</div>`;
    return;
  }

  const isOwn = String(user.personnel_id) === String(id);
  const canFillActivity = canEdit || isOwn;
  let person;
  let ranks = [];
  let myActivities = [];

  try {
    person = await api(`/personnel/${id}`);
  } catch (e) {
    main.innerHTML = `<div class="card">Личное дело не найдено.</div>`;
    return;
  }

  async function loadExtras() {
    ranks = await api('/ranks');
    try {
      myActivities = await api(`/activities?personnel_id=${id}`);
    } catch (e) {
      myActivities = [];
    }
  }

  function render() {
    const formation = person.formation || FORMATION_NAME;
    main.innerHTML = `
      <div class="topbar">
        <div>
          <h1>Личное дело</h1>
          <div class="sub">${escapeHtml(person.callsign)} · IDN ${escapeHtml(person.idn)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canFillActivity ? '<button id="log-activity-btn">Записать активность</button>' : ''}
          ${canEdit ? '<button class="btn-primary" id="edit-btn">Редактировать</button>' : ''}
        </div>
      </div>
      <div class="dossier-doc">
        <h1>ГАЛАКТИЧЕСКАЯ РЕСПУБЛИКА</h1>
        <h2>${escapeHtml(person.subordination || 'ВЕЛИКАЯ АРМИЯ РЕСПУБЛИКИ')}</h2>
        <h3>${escapeHtml(formation).toUpperCase()}</h3>
        <hr>
        <div class="row"><b>Идентификационный номер:</b> [${escapeHtml(person.idn)}]</div>
        <div class="row"><b>Позывной / имя:</b> [${escapeHtml(person.callsign)}]</div>
        <div class="row"><b>Дата создания / поступления на службу:</b> [${fmtDate(person.service_date)}]</div>
        <div class="row"><b>Дата зачисления в 91-й разведывательный корпус:</b> [${fmtDate(person.corps_join_date)}]</div>
        <br>
        <div class="row"><b>Текущая должность:</b> [${escapeHtml((person.position_name || '—').toUpperCase())}]</div>
        <div class="row"><b>Текущее звание:</b> [${escapeHtml(person.rank_name || '—')}]</div>
        <div class="row"><b>Подразделение:</b> [${escapeHtml(person.unit_name || '-')}]</div>
        <hr>
        <div class="section-title">СЛУЖЕБНЫЕ ДАННЫЕ</div>
        <div class="row"><b>Формирование:</b> ${escapeHtml(formation)}</div>
        <div class="row"><b>Специализации:</b> [${escapeHtml(person.specialization || '—')}]</div>
        <div class="row"><b>Внутренние награды:</b> [${(person.awards && person.awards.length) ? person.awards.map(a => `"${escapeHtml(a)}"`).join(', ') : '—'}]</div>
        <hr>
        <div class="section-title">ИСТОРИЯ ЗВАНИЙ</div>
        ${(person.rank_history || []).length
          ? person.rank_history.map(h => `<div class="history-item">[${escapeHtml(h.rank_name)}] — [${fmtDate(h.awarded_at)}]</div>`).join('')
          : '<div class="hint">Записей нет</div>'}
        ${canEdit ? `
          <div class="rank-history-editor">
            <div class="hint">Добавьте запись: звание и дата присвоения (как в досье).</div>
            <div class="rank-history-form">
              <select id="rh-rank">${ranks.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>
              <input type="date" id="rh-date" value="${localToday()}">
              <label class="inline-check"><input type="checkbox" id="rh-current"> сделать текущим</label>
              <button class="btn-sm btn-primary" type="button" id="rh-add">Добавить</button>
            </div>
            ${(person.rank_history || []).map(h => `
              <div class="rank-history-row">
                <span>[${escapeHtml(h.rank_name)}] — [${fmtDate(h.awarded_at)}]</span>
                <button class="btn-sm btn-danger" type="button" data-del-rh="${h.id}">Удалить</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <hr>
        <div class="row"><b>Статус военнослужащего:</b> ${escapeHtml(person.status || 'АКТИВЕН')}</div>
        <div class="row"><b>Принадлежность:</b> ${escapeHtml(person.affiliation || 'ГАЛАКТИЧЕСКАЯ РЕСПУБЛИКА')}</div>
        <div class="row"><b>Подчинение:</b> ${escapeHtml(person.subordination || 'ВЕЛИКАЯ АРМИЯ РЕСПУБЛИКИ')}</div>
        <img class="dossier-emblem" src="/img/emblem.png" alt="Эмблема 91-го корпуса">
      </div>
      <div class="grid grid-4" style="margin-top:18px">
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Steam ID</div><div>${escapeHtml(person.steam_id || '—')}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Discord</div><div>${escapeHtml(person.discord || '—')}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Текущая активность</div><div>${escapeHtml(person.activity || '—')}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Наёмник</div><div>${person.mercenary ? 'Да' : 'Нет'}</div></div>
      </div>
      ${canFillActivity ? `
        <div class="card" style="margin-top:16px">
          <div class="toolbar">
            <strong style="margin-right:auto">Моя активность</strong>
          </div>
          <div class="field" style="max-width:420px">
            <label>Метка в таблице состава (заполняется самостоятельно)</label>
            <div style="display:flex;gap:8px">
              <input id="own-activity" value="${escapeHtml(person.activity || '')}" placeholder="Например: в строю / в отпуске">
              <button class="btn-primary" type="button" id="save-own-activity">Сохранить</button>
            </div>
            <div class="error-msg" id="own-act-error" style="display:none"></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Дата</th><th>Тип</th><th>Название</th><th>Заметки</th><th></th></tr></thead>
              <tbody>
                ${myActivities.map(r => `
                  <tr>
                    <td>${fmtDate(r.activity_date)}</td>
                    <td>${(ACTIVITY_TYPES.find(t => t.id === r.type) || {}).label || r.type}</td>
                    <td>${escapeHtml(r.title)}</td>
                    <td style="white-space:normal">${escapeHtml(r.notes || '')}</td>
                    <td>${(canEdit || String(r.conducted_by) === String(user.id)) ? `<button class="btn-sm btn-danger" data-del-act="${r.id}">Удалить</button>` : ''}</td>
                  </tr>
                `).join('') || `<tr><td colspan="5" style="color:var(--text-muted)">Пока нет записей — нажмите «Записать активность»</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    document.getElementById('edit-btn')?.addEventListener('click', openEditModal);
    document.getElementById('log-activity-btn')?.addEventListener('click', () => {
      openActivityModal({ personnel_id: Number(id), onSaved: refresh });
    });
    document.getElementById('save-own-activity')?.addEventListener('click', async () => {
      try {
        await api(`/personnel/${id}/activity`, {
          method: 'PATCH',
          body: { activity: document.getElementById('own-activity').value },
        });
        await refresh();
      } catch (e) {
        const err = document.getElementById('own-act-error');
        err.textContent = e.message; err.style.display = 'block';
      }
    });
    document.getElementById('rh-add')?.addEventListener('click', async () => {
      await api(`/personnel/${id}/rank-history`, {
        method: 'POST',
        body: {
          rank_id: document.getElementById('rh-rank').value,
          awarded_at: document.getElementById('rh-date').value,
          set_current: document.getElementById('rh-current').checked,
        },
      });
      await refresh();
    });
    main.querySelectorAll('[data-del-rh]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Удалить запись из истории званий?')) return;
      await api(`/personnel/${id}/rank-history/${btn.dataset.delRh}`, { method: 'DELETE' });
      await refresh();
    }));
    main.querySelectorAll('[data-del-act]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Удалить запись активности?')) return;
      await api(`/activities/${btn.dataset.delAct}`, { method: 'DELETE' });
      await refresh();
    }));
  }

  async function refresh() {
    person = await api(`/personnel/${id}`);
    await loadExtras();
    render();
  }

  async function openEditModal() {
    const [positions, units] = await Promise.all([api('/positions'), api('/units')]);
    openModal(`
      <h2>Редактирование личного дела</h2>
      <div class="grid grid-2">
        <div class="field"><label>Звание (текущее)</label>
          <select id="e-rank"><option value="">—</option>${ranks.map(r => `<option value="${r.id}" ${person.rank_id===r.id?'selected':''}>${r.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Военная должность</label>
          <select id="e-position"><option value="">—</option>${positions.map(p => `<option value="${p.id}" ${person.position_id===p.id?'selected':''}>${p.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Подразделение (внутренняя структура)</label>
          <select id="e-unit"><option value="">— нет —</option>${units.map(u => `<option value="${u.id}" ${person.unit_id===u.id?'selected':''}>${u.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Статус</label><input id="e-status" value="${escapeHtml(person.status || 'АКТИВЕН')}"></div>
        <div class="field"><label>Дата поступления на службу</label><input type="date" id="e-service-date" value="${isoDate(person.service_date)}"></div>
        <div class="field"><label>Дата зачисления в корпус</label><input type="date" id="e-join-date" value="${isoDate(person.corps_join_date)}"></div>
      </div>
      <div class="field"><label>Формирование</label><input id="e-formation" value="${escapeHtml(person.formation || FORMATION_NAME)}"></div>
      <div class="field"><label>Специализации</label><input id="e-specialization" value="${escapeHtml(person.specialization || '')}" placeholder="CH, SS | KD, * | D"></div>
      <div class="field"><label>Внутренние награды (через запятую)</label><input id="e-awards" value="${escapeHtml((person.awards||[]).join(', '))}"></div>
      <div class="field"><label>Примечания</label><textarea id="e-notes" rows="3">${escapeHtml(person.notes || '')}</textarea></div>
      <div class="error-msg" id="e-error" style="display:none"></div>
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="e-save">Сохранить</button></div>
    `);
    document.getElementById('e-save').addEventListener('click', async () => {
      try {
        const body = {
          rank_id: document.getElementById('e-rank').value || null,
          position_id: document.getElementById('e-position').value || null,
          unit_id: document.getElementById('e-unit').value || null,
          status: document.getElementById('e-status').value,
          service_date: document.getElementById('e-service-date').value || null,
          corps_join_date: document.getElementById('e-join-date').value || null,
          formation: document.getElementById('e-formation').value,
          specialization: document.getElementById('e-specialization').value,
          awards: document.getElementById('e-awards').value.split(',').map(s => s.trim()).filter(Boolean),
          notes: document.getElementById('e-notes').value,
        };
        await api(`/personnel/${id}`, { method: 'PUT', body });
        closeModal();
        await refresh();
      } catch (e) {
        const err = document.getElementById('e-error'); err.textContent = e.message; err.style.display = 'block';
      }
    });
  }

  await loadExtras();
  render();
})();
