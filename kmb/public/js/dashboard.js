(async function () {
  const user = await requireSession();
  if (!user) return;
  renderShell('dashboard');

  const main = document.getElementById('main-content');
  const canEdit = CAN_EDIT_ROSTER.includes(user.role);

  main.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Дашборд</h1>
        <div class="sub">Статистика и графики активности ${escapeHtml(FORMATION_NAME)}</div>
      </div>
    </div>
    <div class="grid grid-4" id="stat-cards"></div>
    <div class="grid grid-2" style="margin-top:20px">
      <div class="card">
        <strong>Активности по категориям</strong>
        <div id="chart-bars" class="chart-wrap"></div>
      </div>
      <div class="card">
        <strong>Состав по подразделениям</strong>
        <div id="chart-units" class="chart-wrap"></div>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <strong>Динамика за 30 дней</strong>
      <div id="chart-line" class="chart-wrap"></div>
    </div>
    <div class="card" style="margin-top:20px">
      <div class="toolbar">
        <strong style="margin-right:auto">Журнал активностей</strong>
        <select id="filter-type"><option value="">Все категории</option></select>
        <a class="btn-sm" href="/activity.html">Страницы активности</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Дата</th><th>Категория</th><th>Название</th><th>Участники</th><th>Проводящий</th><th>Заметки</th><th></th></tr></thead>
          <tbody id="activity-rows"></tbody>
        </table>
      </div>
      <div id="journal-pager"></div>
    </div>
  `;

  const journal = { page: 1, pages: 1 };
  const PER_PAGE = 10;
  let journalItems = [];

  function barChart(el, items) {
    if (!items.length) {
      el.innerHTML = '<div class="hint">Категорий пока нет — создайте их на странице «Активность»</div>';
      return;
    }
    const max = Math.max(1, ...items.map(i => i.value));
    el.innerHTML = `<div class="bar-chart">${items.map(i => `
      <div class="bar-col">
        <div class="bar-val">${i.value}</div>
        <div class="bar" style="height:${Math.round((i.value / max) * 140)}px;background:${i.color || 'var(--accent)'}"></div>
        <div class="bar-label">${escapeHtml(i.label)}</div>
      </div>
    `).join('')}</div>`;
  }

  function hBarChart(el, items) {
    const max = Math.max(1, ...items.map(i => i.value));
    if (!items.length) {
      el.innerHTML = '<div class="hint">Нет данных — создайте подразделения в составе</div>';
      return;
    }
    el.innerHTML = `<div class="hbar-chart">${items.map(i => `
      <div class="hbar-row">
        <div class="hbar-name">${escapeHtml(i.label)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((i.value / max) * 100)}%"></div></div>
        <div class="hbar-val">${i.value}</div>
      </div>
    `).join('')}</div>`;
  }

  function lineChart(el, series) {
    const w = 640, h = 200, pad = 28;
    const dates = series.dates;
    if (!dates.length) {
      el.innerHTML = '<div class="hint">За последние 30 дней записей нет</div>';
      return;
    }
    const max = Math.max(1, ...series.lines.flatMap(l => l.points));
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const x = (i) => pad + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
    const y = (v) => pad + innerH - (v / max) * innerH;
    const paths = series.lines.map(l => {
      const d = l.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2"/>`;
    }).join('');
    const labels = [0, Math.round(dates.length / 2), dates.length - 1].filter((v, i, a) => a.indexOf(v) === i)
      .map(i => `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" font-size="10" fill="currentColor">${dates[i].slice(5)}</text>`).join('');
    const legend = series.lines.map(l => `<span class="legend-item"><i style="background:${l.color}"></i>${escapeHtml(l.label)}</span>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" class="line-svg" preserveAspectRatio="none">${paths}${labels}</svg><div class="chart-legend">${legend}</div>`;
  }

  async function loadStats() {
    const types = await loadActivityTypes();
    const [summary, series] = await Promise.all([
      api('/activities/summary/counts'),
      api('/activities/summary/series?days=30'),
    ]);
    const rows = summary.activities || [];
    document.getElementById('stat-cards').innerHTML = rows.map((r, i) => `
      <div class="card stat-card"><div class="num">${r.count}</div><div class="label">${escapeHtml(r.name)}</div></div>
    `).join('') || '<div class="card hint">Категорий пока нет</div>';

    barChart(document.getElementById('chart-bars'), rows.map((r, i) => ({
      label: r.name, value: r.count, color: typeColor(i),
    })));
    hBarChart(document.getElementById('chart-units'), (summary.by_unit || []).map(u => ({ label: u.name, value: u.count })));

    const dateSet = [];
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (series.days - 1));
    for (let i = 0; i < series.days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dateSet.push(`${y}-${m}-${day}`);
    }
    const map = {};
    (series.points || []).forEach(p => {
      map[`${p.date}|${p.type_id}`] = p.count;
    });
    const seriesTypes = (series.types && series.types.length ? series.types : types);
    lineChart(document.getElementById('chart-line'), {
      dates: dateSet,
      lines: seriesTypes.map((t, i) => ({
        label: t.name,
        color: typeColor(i),
        points: dateSet.map(d => map[`${d}|${t.id}`] || 0),
      })),
    });

    const filterSel = document.getElementById('filter-type');
    const cur = filterSel.value;
    filterSel.innerHTML = '<option value="">Все категории</option>' +
      types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    filterSel.value = cur;
  }

  async function loadRows() {
    const type = document.getElementById('filter-type').value;
    const res = await api(`/activities?${type ? 'type_id=' + type + '&' : ''}page=${journal.page}&limit=${PER_PAGE}`);
    journal.page = res.page; journal.pages = res.pages;
    journalItems = res.items;
    document.getElementById('activity-rows').innerHTML = res.items.map(r => {
      const canDel = canEdit || String(r.conducted_by) === String(user.id);
      return `
      <tr>
        <td>${fmtDate(r.activity_date)}</td>
        <td>${escapeHtml(typeLabel(r.type_id))}</td>
        <td>${escapeHtml(r.title)}${(r.images || []).length ? ` <span class="badge">${r.images.length} фото</span>` : ''}</td>
        <td style="white-space:normal">${(r.participants || []).map(p => escapeHtml(p.callsign)).join(', ') || '—'}</td>
        <td>${escapeHtml(r.conductor_name || r.conducted_by_name || '—')}</td>
        <td style="white-space:normal">${escapeHtml(r.notes || '')}</td>
        <td style="white-space:nowrap">${canDel ? `<button class="btn-sm" data-edit="${r.id}">Изменить</button> <button class="btn-sm btn-danger" data-del="${r.id}">Удалить</button>` : ''}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" style="color:var(--text-muted)">Записей нет</td></tr>`;
    const pagerEl = document.getElementById('journal-pager');
    pagerEl.innerHTML = pagerHtml(journal.page, journal.pages);
    bindPager(pagerEl, journal, loadRows);
    document.querySelectorAll('#activity-rows [data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = journalItems.find(x => x.id === Number(btn.dataset.edit));
        if (a) openActivityModal({ activity: a, onSaved: () => { loadRows(); loadStats(); } });
      });
    });
    document.querySelectorAll('#activity-rows [data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить запись?')) return;
        await api(`/activities/${btn.dataset.del}`, { method: 'DELETE' });
        loadRows(); loadStats();
      });
    });
  }

  document.getElementById('filter-type').addEventListener('change', () => { journal.page = 1; loadRows(); });
  window.addEventListener('themechange', () => loadStats());

  loadStats(); loadRows();
})();
