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
      <button class="btn-primary" id="add-activity-btn">+ Записать активность</button>
    </div>
    <div class="grid grid-4" id="stat-cards"></div>
    <div class="grid grid-2" style="margin-top:20px">
      <div class="card">
        <strong>Активности по типам</strong>
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
        <select id="filter-type">
          <option value="">Все типы</option>
          ${ACTIVITY_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Дата</th><th>Тип</th><th>Название</th><th>Автор</th><th>Заметки</th><th></th></tr></thead>
          <tbody id="activity-rows"></tbody>
        </table>
      </div>
    </div>
  `;

  const TYPE_LABELS = Object.fromEntries(ACTIVITY_TYPES.map(t => [t.id, t.label]));
  const TYPE_COLORS = { agitation: '#52525b', training: '#71717a', recon: '#3f3f46', combat: '#18181b' };

  function barChart(el, items) {
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
    const [summary, series] = await Promise.all([
      api('/activities/summary/counts'),
      api('/activities/summary/series?days=30'),
    ]);
    const cards = [
      { label: 'Агитации проведено', num: summary.activities.agitation.count },
      { label: 'Тренировок проведено', num: summary.activities.training.count },
      { label: 'Разведок проведено', num: summary.activities.recon.count },
      { label: 'Боевых действий', num: summary.activities.combat.count },
    ];
    document.getElementById('stat-cards').innerHTML = cards.map(c => `
      <div class="card stat-card"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>
    `).join('');

    barChart(document.getElementById('chart-bars'), [
      { label: 'Агитации', value: summary.activities.agitation.count, color: TYPE_COLORS.agitation },
      { label: 'Тренировки', value: summary.activities.training.count, color: TYPE_COLORS.training },
      { label: 'Разведки', value: summary.activities.recon.count, color: TYPE_COLORS.recon },
      { label: 'Бои', value: summary.activities.combat.count, color: TYPE_COLORS.combat },
    ]);
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
      map[`${p.date}|${p.type}`] = p.count;
    });
    lineChart(document.getElementById('chart-line'), {
      dates: dateSet,
      lines: ACTIVITY_TYPES.map(t => ({
        label: t.label,
        color: TYPE_COLORS[t.id],
        points: dateSet.map(d => map[`${d}|${t.id}`] || 0),
      })),
    });
  }

  async function loadRows() {
    const type = document.getElementById('filter-type').value;
    const rows = await api(`/activities${type ? '?type=' + type : ''}`);
    document.getElementById('activity-rows').innerHTML = rows.map(r => {
      const canDel = canEdit || String(r.conducted_by) === String(user.id);
      return `
      <tr>
        <td>${fmtDate(r.activity_date)}</td>
        <td>${TYPE_LABELS[r.type] || r.type}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.personnel_callsign || r.conducted_by_name || '—')}</td>
        <td style="white-space:normal">${escapeHtml(r.notes || '')}</td>
        <td>${canDel ? `<button class="btn-sm btn-danger" data-del="${r.id}">Удалить</button>` : ''}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" style="color:var(--text-muted)">Записей нет</td></tr>`;
    document.querySelectorAll('#activity-rows [data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить запись?')) return;
        await api(`/activities/${btn.dataset.del}`, { method: 'DELETE' });
        loadRows(); loadStats();
      });
    });
  }

  document.getElementById('filter-type').addEventListener('change', loadRows);
  document.getElementById('add-activity-btn').addEventListener('click', () => {
    openActivityModal({ onSaved: () => { loadRows(); loadStats(); } });
  });

  loadStats(); loadRows();
})();
