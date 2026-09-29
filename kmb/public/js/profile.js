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

  let person;
  let ranks = [];
  let actState = { page: 1, pages: 1, items: [], total: 0 };
  let docPage = 1; // 1 — досье, 2..N — листы служебной активности
  const ACT_PER_PAGE = 4;

  try {
    person = await api(`/personnel/${id}`);
  } catch (e) {
    main.innerHTML = `<div class="card">Личное дело не найдено.</div>`;
    return;
  }

  async function loadExtras() {
    await loadActivityTypes();
    ranks = await api('/ranks');
    await loadActivities();
  }

  async function loadActivities() {
    try {
      const page = Math.max(1, docPage - 1);
      const res = await api(`/activities?personnel_id=${id}&page=${page}&limit=${ACT_PER_PAGE}`);
      actState = { page: res.page, pages: res.pages, items: res.items, total: res.total };
      if (docPage > 1) docPage = 1 + actState.page; // сервер мог ограничить страницу сверху
    } catch (e) {
      actState = { page: 1, pages: 1, items: [], total: 0 };
      docPage = 1;
    }
  }

  function rankHistoryHtml() {
    const history = person.rank_history || [];
    if (!history.length) return '<div class="hint">Записей нет</div>';
    return `
      <table class="dossier-table">
        ${history.map(h => `
          <tr>
            <td class="dossier-date">${fmtDate(h.awarded_at)}</td>
            <td>${escapeHtml(h.rank_name)}</td>
          </tr>`).join('')}
      </table>`;
  }

  function dossierActHtml(a, canManage) {
    return `
      <div class="dossier-act">
        <div class="dossier-act-head">
          <span>[${fmtDate(a.activity_date)}] — ${escapeHtml(a.type_name || 'БЕЗ КАТЕГОРИИ').toUpperCase()}</span>
          ${canManage ? `<span style="display:flex;gap:6px">
            <button class="btn-sm" type="button" data-edit-activity="${a.id}">Изменить</button>
            <button class="btn-sm btn-danger" type="button" data-del-activity="${a.id}">Удалить</button>
          </span>` : ''}
        </div>
        <div class="dossier-act-title">${escapeHtml(a.title)}</div>
        <div class="dossier-act-meta"><b>Проводящий:</b> ${escapeHtml(a.conductor_name || '—')} &nbsp;·&nbsp; <b>Участники:</b> ${(a.participants || []).map(p => escapeHtml(p.callsign)).join(', ') || '—'}</div>
        ${a.notes ? `<div class="dossier-act-notes">${escapeHtml(a.notes)}</div>` : ''}
        ${(a.images || []).length ? `
          <div class="dossier-act-images">
            ${a.images.map(im => `<img src="${escapeHtml(im.path)}" data-img="${escapeHtml(im.path)}" alt="Фото к записи «${escapeHtml(a.title)}»">`).join('')}
          </div>` : ''}
      </div>`;
  }

  function docPagesTotal() {
    return 1 + (actState.total ? actState.pages : 0);
  }

  function dossierPageHtml(formation) {
    return `
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
      ${rankHistoryHtml()}
      <hr>
      <div class="row"><b>Статус военнослужащего:</b> ${escapeHtml(person.status || 'АКТИВЕН')}</div>
      <div class="row"><b>Принадлежность:</b> ${escapeHtml(person.affiliation || 'ГАЛАКТИЧЕСКАЯ РЕСПУБЛИКА')}</div>
      <div class="row"><b>Подчинение:</b> ${escapeHtml(person.subordination || 'ВЕЛИКАЯ АРМИЯ РЕСПУБЛИКИ')}</div>
      <img class="dossier-emblem" src="/img/emblem.png" alt="Эмблема 91-го корпуса">
      <div class="dossier-page-num">— 1 —</div>
    `;
  }

  function activityPageHtml() {
    const canDeleteAny = canEdit;
    return `
      <h2>ЛИЧНОЕ ДЕЛО — ПРОДОЛЖЕНИЕ</h2>
      <h3>${escapeHtml(person.callsign)} · IDN [${escapeHtml(person.idn)}]</h3>
      <hr>
      <div class="section-title">СЛУЖЕБНАЯ АКТИВНОСТЬ · лист ${actState.page} из ${actState.pages}</div>
      ${actState.items.map(a => dossierActHtml(a, canDeleteAny || String(a.conducted_by) === String(user.id))).join('')
        || '<div class="hint">Записей на этом листе нет.</div>'}
      <div class="dossier-page-num">— ${docPage} —</div>
    `;
  }

  function render() {
    const formation = person.formation || FORMATION_NAME;
    const docPages = docPagesTotal();
    if (docPage > docPages) docPage = docPages;
    main.innerHTML = `
      <div class="topbar">
        <div>
          <h1>Личное дело</h1>
          <div class="sub">${escapeHtml(person.callsign)} · IDN ${escapeHtml(person.idn)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn-sm" href="/activity.html?personnel_id=${id}">Вся активность корпуса</a>
          ${canEdit ? '<button class="btn-primary" id="edit-btn">Редактировать</button>' : ''}
        </div>
      </div>
      <div class="dossier-pages-nav">
        <button class="btn-sm" type="button" id="doc-prev" ${docPage <= 1 ? 'disabled' : ''}>← Предыдущий лист</button>
        <span class="pager-info">Лист ${docPage} из ${docPages}</span>
        <button class="btn-sm" type="button" id="doc-next" ${docPage >= docPages ? 'disabled' : ''}>Следующий лист →</button>
      </div>
      <div class="dossier-doc">
        ${docPage === 1 ? dossierPageHtml(formation) : activityPageHtml()}
      </div>
      <div class="grid grid-3" style="margin-top:18px">
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Steam ID</div><div>${escapeHtml(person.steam_id || '—')}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Discord</div><div>${escapeHtml(person.discord || '—')}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted);font-size:12.5px">Наёмник</div><div>${person.mercenary ? 'Да' : 'Нет'}</div></div>
      </div>
    `;

    document.getElementById('edit-btn')?.addEventListener('click', openEditModal);
    document.getElementById('doc-prev')?.addEventListener('click', async () => {
      if (docPage <= 1) return;
      docPage -= 1;
      await loadActivities();
      render();
    });
    document.getElementById('doc-next')?.addEventListener('click', async () => {
      if (docPage >= docPagesTotal()) return;
      docPage += 1;
      await loadActivities();
      render();
    });
    bindActivityDelete(main, refresh);
    bindActivityEdit(main, (actId) => actState.items.find(x => x.id === actId), refresh);
  }

  async function refresh() {
    person = await api(`/personnel/${id}`);
    await loadExtras();
    render();
  }

  function rankHistoryEditorHtml() {
    return `
      <div id="rh-list">
        ${(person.rank_history || []).map(h => `
          <div class="rank-history-row">
            <span>${fmtDate(h.awarded_at)} — ${escapeHtml(h.rank_name)}</span>
            <button class="btn-sm btn-danger" type="button" data-del-rh="${h.id}">Удалить</button>
          </div>`).join('') || '<div class="hint">Записей нет</div>'}
      </div>
      <div class="rank-history-form">
        <select id="rh-rank">${ranks.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>
        <input type="date" id="rh-date" value="${localToday()}">
        <label class="inline-check"><input type="checkbox" id="rh-current"> сделать текущим</label>
        <button class="btn-sm btn-primary" type="button" id="rh-add">Добавить</button>
      </div>`;
  }

  function bindRankHistoryEditor() {
    document.getElementById('rh-add')?.addEventListener('click', async () => {
      await api(`/personnel/${id}/rank-history`, {
        method: 'POST',
        body: {
          rank_id: document.getElementById('rh-rank').value,
          awarded_at: document.getElementById('rh-date').value,
          set_current: document.getElementById('rh-current').checked,
        },
      });
      await syncRankHistory();
    });
    bindRhDelete();
  }

  function bindRhDelete() {
    document.querySelectorAll('[data-del-rh]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Удалить запись из истории званий?')) return;
      await api(`/personnel/${id}/rank-history/${btn.dataset.delRh}`, { method: 'DELETE' });
      await syncRankHistory();
    }));
  }

  // Подтягивает историю званий в открытую модалку редакции, не теряя остальные поля
  async function syncRankHistory() {
    person = await api(`/personnel/${id}`);
    const list = document.getElementById('rh-list');
    if (list) {
      list.innerHTML = (person.rank_history || []).map(h => `
        <div class="rank-history-row">
          <span>${fmtDate(h.awarded_at)} — ${escapeHtml(h.rank_name)}</span>
          <button class="btn-sm btn-danger" type="button" data-del-rh="${h.id}">Удалить</button>
        </div>`).join('') || '<div class="hint">Записей нет</div>';
      bindRhDelete();
    }
    const rankSel = document.getElementById('e-rank');
    if (rankSel) rankSel.value = person.rank_id ? String(person.rank_id) : '';
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
      <div class="modal-section">
        <div class="section-title">История званий</div>
        <div class="hint" style="margin:0 0 8px">Записи отображаются в досье; здесь они добавляются и удаляются.</div>
        ${rankHistoryEditorHtml()}
      </div>
      <div class="error-msg" id="e-error" style="display:none"></div>
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="e-save">Сохранить</button></div>
    `, { wide: true });
    bindRankHistoryEditor();
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
