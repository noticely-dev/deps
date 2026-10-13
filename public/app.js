// Progressive enhancement only: every page works without this file.
(() => {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch { /* storage blocked */ }

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-theme-toggle]')) {
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch { /* ignore */ }
    }
    const copy = t.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.getAttribute('data-copy') || location.href);
      copy.textContent = 'Copied';
    }
    const row = t.closest('tr[data-expand]');
    if (row) {
      const detail = document.getElementById(row.getAttribute('data-expand'));
      if (detail) detail.hidden = !detail.hidden;
    }
    const toggle = t.closest('[data-tab], [data-filter]');
    if (toggle) {
      const group = toggle.hasAttribute('data-tab') ? '[data-tab]' : '[data-filter]';
      document.querySelectorAll(group).forEach((b) => b.setAttribute('aria-pressed', String(b === toggle)));
      applyRows();
    }
  });

  // Visibility always comes from the pressed tab AND the pressed filter, so a filter never shows the other tab's rows.
  function applyRows() {
    const scope = document.querySelector('[data-tab][aria-pressed="true"]')?.getAttribute('data-tab') || 'prod';
    const kind = document.querySelector('[data-filter][aria-pressed="true"]')?.getAttribute('data-filter') || 'all';
    document.querySelectorAll('tr.row').forEach((r) => {
      const hide = r.getAttribute('data-scope') !== scope
        || (kind !== 'all' && !(r.getAttribute('data-kinds') || '').split(' ').includes(kind));
      r.hidden = hide;
      const d = document.getElementById(r.getAttribute('data-expand') || '');
      if (d && hide) d.hidden = true;
    });
  }

  // Report progress: poll the status endpoint instead of waiting for the meta refresh.
  const status = document.querySelector('[data-status-url]');
  if (status) {
    const url = status.getAttribute('data-status-url');
    const poll = async () => {
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' } });
        const j = await r.json();
        if (j.status !== 'running') { location.reload(); return; }
      } catch { /* keep polling */ }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1000);
  }

  // Drag & drop a file onto the textarea.
  const area = document.querySelector('[data-dropzone] textarea');
  if (area) {
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', async (e) => {
      e.preventDefault();
      area.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.size <= 256 * 1024) area.value = await file.text();
    });
  }
})();
