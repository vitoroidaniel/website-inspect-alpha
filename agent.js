// Kurtex - Agent/Dispatcher Application
// Designed by Rekka Software

const TL = {
  pickup: 'PickUp Trailer',
  drop: 'Drop Trailer',
  general: 'General'
};

const G = {
  drivers: [],
  sel: null,
  isAdmin: false,
  lbPhotos: [],
  lbIdx: 0,
  feedFilter: 'all',
  feedRows: [],
  usersMap: {}
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) {
      location.href = '/login';
      return;
    }
    
    const u = await r.json();
    
    if (u.role === 'driver') {
      location.href = '/driver/inspect';
      return;
    }
    
    G.isAdmin = u.role === 'superadmin';

    document.getElementById('agentName').textContent = u.name || u.username;
    document.getElementById('roleBadge').textContent = G.isAdmin ? 'Admin' : 'Dispatcher';

    if (G.isAdmin) {
      document.getElementById('navAdmin').style.display = 'flex';
      document.getElementById('adminSep').style.display = 'block';
      // Show Admin button in mobile nav
      const mNavAdmin = document.getElementById('mNavAdmin');
      if (mNavAdmin) mNavAdmin.style.display = 'flex';
    }

    // Show mobile nav (CSS hides it on desktop via media query)
    const mobileNav = document.getElementById('mobileNav');
    if (mobileNav) mobileNav.style.display = '';

    loadStats();
    loadDrivers();
  } catch (e) {
    location.href = '/login';
  }
}

// Load statistics
async function loadStats() {
  try {
    const d = await (await fetch('/api/agent/stats')).json();
    document.getElementById('sD').textContent = d.totalDrivers;
    document.getElementById('sDi').textContent = d.totalDispatchers || '—';
    document.getElementById('sT').textContent = d.totalInspections;
    document.getElementById('sTd').textContent = d.todayInspections;
    document.getElementById('sP').textContent = d.totalPhotos;
  } catch (e) {}
}

// Load drivers list
async function loadDrivers() {
  try {
    G.drivers = await (await fetch('/api/agent/drivers')).json();
    document.getElementById('dCount').textContent = G.drivers.filter(d => d.active).length;
    renderDrivers(G.drivers);
  } catch (e) {}
}

// Render drivers list
function renderDrivers(list) {
  const el = document.getElementById('driversList');
  
  if (!list.length) {
    el.innerHTML = '<div style="padding:16px;font-size:15px;color:var(--dim);font-weight:600">No drivers</div>';
    return;
  }
  
  el.innerHTML = list.map(d => {
    const av = (d.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="driver-row${G.sel?.id === d.id ? ' sel' : ''}" onclick="selectDriver(${d.id})" data-id="${d.id}">
      <div class="dr-av">${av}</div>
      <div class="dr-info">
        <div class="dr-name">${esc(d.full_name)}</div>
        <div class="dr-sub">${esc(d.truck_model || 'No truck')}${d.truck_number ? ' · ' + esc(d.truck_number) : ''}</div>
      </div>
      <div class="dr-cnt">${d.submitted_count || 0}</div>
    </div>`;
  }).join('');
}

// Filter drivers
function filterDrivers() {
  const q = document.getElementById('searchBox').value.toLowerCase();
  renderDrivers(G.drivers.filter(d => 
    (d.full_name || '').toLowerCase().includes(q) ||
    (d.truck_model || '').toLowerCase().includes(q) ||
    (d.truck_number || '').toLowerCase().includes(q)
  ));
}

// Select driver
async function selectDriver(id) {
  const d = G.drivers.find(x => x.id === id);
  if (!d) return;
  
  G.sel = d;
  
  document.querySelectorAll('.driver-row').forEach(el => 
    el.classList.toggle('sel', parseInt(el.dataset.id) === id)
  );
  
  document.getElementById('detailEmpty').style.display = 'none';
  const content = document.getElementById('detailContent');
  content.style.display = 'flex';
  
  document.getElementById('detailName').textContent = d.full_name;
  document.getElementById('detailSub').innerHTML = 
    `<span>${esc(d.truck_model || 'No truck')}${d.truck_number ? ' · ' + esc(d.truck_number) : ''}</span>
     <span>${d.submitted_count || 0} inspection${d.submitted_count !== 1 ? 's' : ''}</span>`;
  
  const list = document.getElementById('inspList');
  list.innerHTML = '<div style="padding:14px;font-size:15px;color:var(--dim);font-weight:600">Loading…</div>';
  
  try {
    const insps = await (await fetch(`/api/agent/drivers/${id}/inspections`)).json();
    
    if (!insps.length) {
      list.innerHTML = '<div style="padding:14px;font-size:15px;color:var(--dim);font-weight:600">No inspections yet.</div>';
      return;
    }
    
    list.innerHTML = insps.map(i => {
      const tk = i.inspection_type || 'pickup';
      return `<div class="insp-card">
        <div class="insp-card-hd" onclick="toggleCard('${i.id}')">
          <div>
            <div class="insp-card-date">
              <span class="type-badge ${tk}">${TL[tk] || tk}</span>
              ${fmtDate(i.submitted_at)}
            </div>
            <div class="insp-card-sub">${i.photo_count} photos${i.latitude ? ' · GPS recorded' : ''}</div>
          </div>
          <div class="insp-card-r">
            <div class="pill-ok">Submitted</div>
            <span class="chev" id="chev-${i.id}">⌄</span>
          </div>
        </div>
        <div class="insp-card-body" id="body-${i.id}">
          <div id="cnt-${i.id}">
            <div style="font-size:14px;color:var(--dim);font-weight:600">Loading…</div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="font-size:15px;color:var(--red);font-weight:700">Error loading.</div>';
  }
}

// Toggle inspection card
async function toggleCard(id) {
  const body = document.getElementById(`body-${id}`);
  const chev = document.getElementById(`chev-${id}`);
  
  if (body.classList.contains('open')) {
    body.classList.remove('open');
    chev.classList.remove('open');
    return;
  }
  
  body.classList.add('open');
  chev.classList.add('open');
  
  const c = document.getElementById(`cnt-${id}`);
  if (c.dataset.loaded) return;
  
  try {
    const insp = await (await fetch(`/api/agent/inspections/${id}`)).json();
    c.dataset.loaded = '1';
    
    const photos = insp.photos || [];
    const mapUrl = insp.latitude ? `https://www.google.com/maps?q=${insp.latitude},${insp.longitude}` : null;
    
    window._lbPhotos = window._lbPhotos || {};
    window._lbPhotos[id] = photos;
    
    c.innerHTML = `
      ${photos.length ? `<div class="photo-grid">${photos.map((p, i) => 
        `<div class="photo-cell" onclick="openLb('${id}',${i})">
          <img src="${esc(p.file_path)}" loading="lazy">
          <div class="photo-cell-lbl">${esc(p.step_label || 'Step ' + p.step_number)}</div>
          <div class="photo-cell-num">${p.step_number}</div>
        </div>`
      ).join('')}</div>` : '<div style="font-size:14px;color:var(--dim);margin-bottom:14px;font-weight:600">No photos</div>'}
      
      <div class="drows">
        <div class="drow"><span class="k">Driver</span><span class="v">${esc(insp.driver_name)}</span></div>
        <div class="drow"><span class="k">Type</span><span class="v">${esc(TL[insp.inspection_type] || insp.inspection_type || 'PickUp')}</span></div>
        <div class="drow"><span class="k">Truck</span><span class="v">${esc(insp.truck_model || '—')}</span></div>
        ${insp.truck_number ? `<div class="drow"><span class="k">Truck No.</span><span class="v">${esc(insp.truck_number)}</span></div>` : ''}
        <div class="drow"><span class="k">Submitted</span><span class="v">${fmtDate(insp.submitted_at)}</span></div>
        <div class="drow"><span class="k">GPS</span><span class="v">${mapUrl ? `<a href="${mapUrl}" target="_blank">View Maps ↗</a>` : 'Not recorded'}</span></div>
      </div>
      ${insp.notes ? `<div class="notes-box">📝 ${esc(insp.notes)}</div>` : ''}
      <a class="btn-dl" href="/api/agent/inspections/${id}/download" download>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download ZIP
      </a>`;
  } catch (e) {
    c.innerHTML = '<div style="font-size:14px;color:var(--red);font-weight:700">Error loading.</div>';
  }
}

// Lightbox functions
function openLb(id, idx) {
  const p = (window._lbPhotos && window._lbPhotos[id]) || [];
  if (!p.length) return;
  
  G.lbPhotos = p;
  G.lbIdx = idx;
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}

function openLbArr(arr, idx) {
  G.lbPhotos = arr;
  G.lbIdx = idx;
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}

function showLbPhoto() {
  const p = G.lbPhotos[G.lbIdx];
  if (!p) return;
  
  document.getElementById('lbImg').src = p.file_path;
  document.getElementById('lbMeta').textContent = `Step ${p.step_number}${p.step_label ? ' — ' + p.step_label : ''} | ${G.lbIdx + 1} of ${G.lbPhotos.length}`;
}

function lbNav(d) {
  const n = G.lbIdx + d;
  if (n < 0 || n >= G.lbPhotos.length) return;
  G.lbIdx = n;
  showLbPhoto();
}

function closeLb() {
  document.getElementById('lightbox').classList.remove('open');
}

// Keyboard navigation for lightbox
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  
  if (e.key === 'ArrowLeft') lbNav(-1);
  if (e.key === 'ArrowRight') lbNav(1);
  if (e.key === 'Escape') closeLb();
});

// History / Feed
async function loadFeed() {
  try {
    G.feedRows = await (await fetch('/api/agent/inspections')).json();
    renderFeed();
  } catch (e) {
    document.getElementById('feedBody').innerHTML = 
      '<tr><td colspan="7" style="padding:20px;font-size:15px;color:var(--red);font-weight:700">Error loading.</td></tr>';
  }
}

function setFilter(f) {
  G.feedFilter = f;
  
  ['All', 'Pickup', 'Drop', 'General'].forEach(t => {
    document.getElementById('f' + t).classList.toggle('active', 
      t.toLowerCase() === f || (f === 'all' && t === 'All')
    );
  });
  
  renderFeed();
}

function renderFeed() {
  const tbody = document.getElementById('feedBody');
  let rows = G.feedRows;
  
  if (G.feedFilter !== 'all') {
    rows = rows.filter(r => (r.inspection_type || 'pickup') === G.feedFilter);
  }
  
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;font-size:15px;color:var(--dim);font-weight:600">No inspections found.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = rows.map(i => {
    const tk = i.inspection_type || 'pickup';
    return `<tr onclick="openHistPanel('${i.id}')">
      <td><span class="insp-id">#${i.id.slice(0, 8).toUpperCase()}</span></td>
      <td><span class="pill-ok" style="font-size:12px;padding:5px 12px">Submitted</span></td>
      <td style="color:var(--dim);font-size:14px">${fmtDate(i.submitted_at)}</td>
      <td>${i.truck_number ? `<span class="asset-val">${esc(i.truck_number)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="font-weight:800">${esc(i.driver_name)}</td>
      <td><span class="type-badge ${tk}">${TL[tk] || tk}</span></td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:6px">
          <button class="action-btn" onclick="openHistPanel('${i.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> View
          </button>
          <a class="action-btn" href="/api/agent/inspections/${i.id}/download" download>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ZIP
          </a>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function openHistPanel(id) {
  const panel = document.getElementById('histPanel');
  panel.classList.remove('closed');
  
  document.getElementById('hpTitle').textContent = '#' + id.slice(0, 8).toUpperCase();
  document.getElementById('hpBody').innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600;padding:8px">Loading…</div>';
  
  try {
    const insp = await (await fetch(`/api/agent/inspections/${id}`)).json();
    const photos = insp.photos || [];
    const tk = insp.inspection_type || 'pickup';
    const mapUrl = insp.latitude ? `https://www.google.com/maps?q=${insp.latitude},${insp.longitude}` : null;
    
    document.getElementById('hpBody').innerHTML = `
      <div style="margin-bottom:16px">
        <span class="type-badge ${tk}">${TL[tk] || tk}</span>
        <span style="font-size:14px;color:var(--dim);font-weight:600">${fmtDate(insp.submitted_at)}</span>
      </div>
      ${photos.length ? `<div class="photo-grid">${photos.map((p, i) => 
        `<div class="photo-cell" onclick="openLbArr(${JSON.stringify(photos).replace(/"/g, '"')},${i})">
          <img src="${esc(p.file_path)}" loading="lazy">
          <div class="photo-cell-lbl">${esc(p.step_label || 'Step ' + p.step_number)}</div>
          <div class="photo-cell-num">${p.step_number}</div>
        </div>`
      ).join('')}</div>` : ''}
      <div class="drows" style="margin-top:14px">
        <div class="drow"><span class="k">Driver</span><span class="v">${esc(insp.driver_name)}</span></div>
        <div class="drow"><span class="k">Truck</span><span class="v">${esc(insp.truck_model || '—')}</span></div>
        ${insp.truck_number ? `<div class="drow"><span class="k">Truck No.</span><span class="v">${esc(insp.truck_number)}</span></div>` : ''}
        <div class="drow"><span class="k">Photos</span><span class="v">${photos.length}</span></div>
        <div class="drow"><span class="k">GPS</span><span class="v">${mapUrl ? `<a href="${mapUrl}" target="_blank">View ↗</a>` : '—'}</span></div>
      </div>
      ${insp.notes ? `<div class="notes-box" style="margin-top:12px">📝 ${esc(insp.notes)}</div>` : ''}
      <div style="margin-top:14px">
        <a class="btn-dl" href="/api/agent/inspections/${id}/download" download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download ZIP
        </a>
      </div>`;
  } catch (e) {
    document.getElementById('hpBody').innerHTML = '<div style="font-size:15px;color:var(--red);font-weight:700">Error loading.</div>';
  }
}

function closeHistPanel() {
  document.getElementById('histPanel').classList.add('closed');
}

// Admin functions
function setAdminTab(t) {
  const tabs = { drivers: 'asDrivers', dispatchers: 'asDispatchers', steps: 'asSteps' };
  
  Object.values(tabs).forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById(tabs[t]).classList.add('active');
  
  document.querySelectorAll('.at-btn').forEach((b, i) => 
    b.classList.toggle('active', ['drivers', 'dispatchers', 'steps'][i] === t)
  );
  
  if (t === 'drivers') loadAdminDrivers();
  if (t === 'dispatchers') loadAdminDispatchers();
  if (t === 'steps') loadSteps();
}

async function createDriver() {
  const body = {
    full_name: v('drName'),
    username: v('drUser'),
    email: v('drEmail'),
    password: v('drPass'),
    truck_model: v('drTruck'),
    truck_number: v('drTruckNum'),
    role: 'driver'
  };
  
  const al = document.getElementById('drAlert');
  
  if (!body.full_name || !body.username || !body.password) {
    showAlert(al, 'error', 'Name, username and password required.');
    return;
  }
  
  const r = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const d = await r.json();
  
  if (!r.ok) {
    showAlert(al, 'error', d.error || 'Error');
    return;
  }
  
  showAlert(al, 'ok', `Driver "${body.full_name}" added!`);
  
  ['drName', 'drUser', 'drEmail', 'drPass', 'drTruck', 'drTruckNum'].forEach(id => 
    document.getElementById(id).value = ''
  );
  
  loadAdminDrivers();
  loadDrivers();
  loadStats();
}

async function createDispatcher() {
  const body = {
    full_name: v('diName'),
    username: v('diUser'),
    email: v('diEmail'),
    password: v('diPass'),
    role: 'agent'
  };
  
  const al = document.getElementById('diAlert');
  
  if (!body.full_name || !body.username || !body.password) {
    showAlert(al, 'error', 'Name, username and password required.');
    return;
  }
  
  const r = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const d = await r.json();
  
  if (!r.ok) {
    showAlert(al, 'error', d.error || 'Error');
    return;
  }
  
  showAlert(al, 'ok', `Dispatcher "${body.full_name}" added!`);
  
  ['diName', 'diUser', 'diEmail', 'diPass'].forEach(id => 
    document.getElementById(id).value = ''
  );
  
  loadAdminDispatchers();
  loadStats();
}

async function loadAdminDrivers() {
  try {
    const users = await (await fetch('/api/admin/users?role=driver')).json();
    const el = document.getElementById('driversTable');
    
    if (!users.length) {
      el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No drivers yet.</div>';
      return;
    }
    
    users.forEach(u => G.usersMap[u.id] = u);
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Truck</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td style="font-weight:800">${esc(u.full_name)}</td>
        <td style="color:var(--dim)">${esc(u.username)}</td>
        <td style="color:var(--dim);font-size:13px">${esc(u.email || '—')}</td>
        <td style="font-size:13px;color:var(--dim)">${esc(u.truck_model || '—')}${u.truck_number ? ' · <strong>' + esc(u.truck_number) + '</strong>' : ''}</td>
        <td><span style="font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;background:${u.active ? 'var(--green-light)' : 'var(--red-light)'};color:${u.active ? '#16a34a' : 'var(--red)'}">${u.active ? 'Active' : 'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditModal(${u.id})">✏️ Edit</button>
          <button class="tbl-btn ${u.active ? 'disable' : 'enable'}" onclick="toggleUser(${u.id},${u.active},'drivers')">${u.active ? 'Disable' : 'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteUser(${u.id},'${esc(u.full_name)}','drivers')">🗑 Delete</button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (e) {}
}

async function loadAdminDispatchers() {
  try {
    const users = await (await fetch('/api/admin/users?role=agent')).json();
    const el = document.getElementById('dispatchersTable');
    
    if (!users.length) {
      el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No dispatchers yet.</div>';
      return;
    }
    
    users.forEach(u => G.usersMap[u.id] = u);
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td style="font-weight:800">${esc(u.full_name)}</td>
        <td style="color:var(--dim)">${esc(u.username)}</td>
        <td style="color:var(--dim);font-size:13px">${esc(u.email || '—')}</td>
        <td><span style="font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;background:${u.active ? 'var(--green-light)' : 'var(--red-light)'};color:${u.active ? '#16a34a' : 'var(--red)'}">${u.active ? 'Active' : 'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditModal(${u.id})">✏️ Edit</button>
          <button class="tbl-btn ${u.active ? 'disable' : 'enable'}" onclick="toggleUser(${u.id},${u.active},'dispatchers')">${u.active ? 'Disable' : 'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteUser(${u.id},'${esc(u.full_name)}','dispatchers')">🗑 Delete</button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (e) {}
}

function openEditModal(id) {
  const user = G.usersMap[id];
  if (!user) return;
  document.getElementById('editUserId').value = user.id;
  document.getElementById('editName').value = user.full_name || '';
  document.getElementById('editUsername').value = user.username || '';
  document.getElementById('editEmail').value = user.email || '';
  document.getElementById('editPass').value = '';
  document.getElementById('editTruck').value = user.truck_model || '';
  document.getElementById('editTruckNum').value = user.truck_number || '';
  document.getElementById('editTruckFields').style.display = user.role === 'driver' ? 'block' : 'none';
  document.getElementById('editModalTitle').textContent = 'Edit ' + user.full_name;
  document.getElementById('editAlert').style.display = 'none';
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('open');
}

async function saveEditUser() {
  const id = document.getElementById('editUserId').value;
  
  const body = {
    full_name: v('editName'),
    username: v('editUsername'),
    email: v('editEmail'),
    password: v('editPass'),
    truck_model: v('editTruck'),
    truck_number: v('editTruckNum')
  };
  
  const al = document.getElementById('editAlert');
  
  const r = await fetch(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const d = await r.json();
  
  if (!r.ok) {
    showAlert(al, 'error', d.error || 'Error');
    return;
  }
  
  showAlert(al, 'ok', 'Changes saved!');
  
  setTimeout(() => {
    closeEditModal();
    loadAdminDrivers();
    loadAdminDispatchers();
    loadDrivers();
  }, 1200);
}

async function toggleUser(id, active, tab) {
  await fetch(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !active })
  });
  
  if (tab === 'drivers') loadAdminDrivers();
  else loadAdminDispatchers();
  
  loadDrivers();
  loadStats();
}

async function deleteUser(id, name, tab) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  
  const r = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  const d = await r.json();
  
  if (!r.ok) {
    alert(d.error || 'Error deleting');
    return;
  }
  
  if (tab === 'drivers') loadAdminDrivers();
  else loadAdminDispatchers();
  
  loadDrivers();
  loadStats();
}

async function loadSteps() {
  try {
    const steps = await (await fetch('/api/admin/steps')).json();
    const el = document.getElementById('stepsTable');
    
    if (!steps.length) {
      el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No steps</div>';
      return;
    }
    
    const byType = {};
    steps.forEach(s => {
      if (!byType[s.inspection_type]) byType[s.inspection_type] = [];
      byType[s.inspection_type].push(s);
    });
    
    el.innerHTML = Object.entries(byType).map(([type, ss]) => `
      <div class="steps-list" style="margin-bottom:16px">
        <div class="step-type-hd"><span class="type-badge ${type}">${TL[type] || type}</span>${ss.length} steps</div>
        ${ss.map(s => `<div class="step-row${!s.active ? ' inactive' : ''}">
          <div class="step-num-badge">${s.step_number}</div>
          <div class="step-info">
            <div class="step-lbl">${esc(s.label)}</div>
            <div class="step-inst">${esc(s.instruction)}</div>
          </div>
          <button class="step-tog ${s.active ? 'on' : 'off'}" onclick="toggleStep(${s.id},${s.active})">${s.active ? 'Disable' : 'Enable'}</button>
        </div>`).join('')}
      </div>
    `).join('');
  } catch (e) {}
}

async function toggleStep(id, active) {
  await fetch(`/api/admin/steps/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !active })
  });
  loadSteps();
}

// Tab navigation
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab${name}`).classList.add('active');
  document.getElementById(`nav${name}`).classList.add('active');

  // Sync mobile bottom nav active state
  const mobileNavMap = { Overview: 'mNavOverview', Feed: 'mNavFeed', Admin: 'mNavAdmin' };
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const mBtn = document.getElementById(mobileNavMap[name]);
  if (mBtn) mBtn.classList.add('active');

  if (name === 'Feed') loadFeed();
  if (name === 'Admin') {
    loadAdminDrivers();
    loadAdminDispatchers();
  }
}

// Utility functions
function fmtDate(dt) {
  if (!dt) return 'N/A';
  const d = new Date(dt.includes('T') ? dt : dt + 'Z');
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

function v(id) {
  return (document.getElementById(id) || {}).value?.trim() || '';
}

function showAlert(el, type, msg) {
  el.textContent = msg;
  el.style.color = type === 'ok' ? '#16a34a' : 'var(--red)';
  el.style.borderColor = type === 'ok' ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)';
  el.style.background = type === 'ok' ? 'var(--green-light)' : 'var(--red-light)';
  el.style.display = 'block';
  
  if (type === 'ok') setTimeout(() => el.style.display = 'none', 3500);
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
}

// Export functions to window
window.filterDrivers = filterDrivers;
window.selectDriver = selectDriver;
window.toggleCard = toggleCard;
window.openLb = openLb;
window.openLbArr = openLbArr;
window.lbNav = lbNav;
window.closeLb = closeLb;
window.setFilter = setFilter;
window.openHistPanel = openHistPanel;
window.closeHistPanel = closeHistPanel;
window.setAdminTab = setAdminTab;
window.createDriver = createDriver;
window.createDispatcher = createDispatcher;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveEditUser = saveEditUser;
window.toggleUser = toggleUser;
window.deleteUser = deleteUser;
window.toggleStep = toggleStep;
window.showTab = showTab;
window.logout = logout;

