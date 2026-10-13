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
      page.rows = 0;
      applyRows();
    }
    const nav = t.closest('[data-page]');
    if (nav) {
      const name = nav.closest('[data-pager]')?.getAttribute('data-pager');
      if (name) {
        page[name] += nav.getAttribute('data-page') === 'next' ? 1 : -1;
        if (name === 'rows') applyRows(); else applyPlan();
      }
    }
  });

  // Long lists are shown in pages. Without JS every item stays visible.
  const PAGE_SIZE = { rows: 25, plan: 8 };
  const page = { rows: 0, plan: 0 };

  // Shows one page of `items`, updates its pager, and returns the items on the current page.
  function paginate(name, items) {
    const size = PAGE_SIZE[name];
    const pages = Math.max(1, Math.ceil(items.length / size));
    page[name] = Math.min(Math.max(page[name], 0), pages - 1);
    const from = page[name] * size;
    const shown = items.slice(from, from + size);
    const pager = document.querySelector(`[data-pager="${name}"]`);
    if (pager) {
      pager.hidden = items.length <= size;
      const info = pager.querySelector('[data-page-info]');
      if (info) info.textContent = `${from + 1}–${from + shown.length} of ${items.length}`;
      pager.querySelector('[data-page="prev"]').disabled = page[name] === 0;
      pager.querySelector('[data-page="next"]').disabled = page[name] === pages - 1;
    }
    return new Set(shown);
  }

  // Visibility always comes from the pressed tab AND the pressed filter, so a filter never shows the other tab's rows.
  function applyRows() {
    const scope = document.querySelector('[data-tab][aria-pressed="true"]')?.getAttribute('data-tab') || 'prod';
    const kind = document.querySelector('[data-filter][aria-pressed="true"]')?.getAttribute('data-filter') || 'all';
    const rows = [...document.querySelectorAll('tr.row')];
    const matching = rows.filter((r) => r.getAttribute('data-scope') === scope
      && (kind === 'all' || (r.getAttribute('data-kinds') || '').split(' ').includes(kind)));
    const shown = paginate('rows', matching);
    rows.forEach((r) => {
      const hide = !shown.has(r);
      r.hidden = hide;
      const d = document.getElementById(r.getAttribute('data-expand') || '');
      if (d && hide) d.hidden = true;
    });
  }

  function applyPlan() {
    const steps = [...document.querySelectorAll('[data-step]')];
    const shown = paginate('plan', steps);
    steps.forEach((s) => { s.hidden = !shown.has(s); });
  }

  if (document.querySelector('tr.row')) applyRows();
  if (document.querySelector('[data-step]')) applyPlan();

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

  // File pickers: show the chosen file's name next to the button (the native input is hidden behind it).
  const showFile = (input) => {
    const name = input.closest('.file-row')?.querySelector('[data-file-name]');
    if (!name) return;
    const f = input.files?.[0];
    name.textContent = f ? `${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB` : 'No file selected';
    name.classList.toggle('chosen', !!f);
  };
  document.querySelectorAll('input[data-file]').forEach((input) => {
    showFile(input);
    input.addEventListener('change', () => showFile(input));
  });

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
