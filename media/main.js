// @ts-nocheck — acquireVsCodeApi is injected at runtime by VS Code's webview host
(function () {
  'use strict';

  /** @type {any} */
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────────

  /** @type {any} */
  let currentData = null;
  let activeTableIndex = 0;
  let sortCol = -1;
  let sortAsc = true;
  let filterText = '';

  // ── DOM refs ───────────────────────────────────────────────────────────────

  const titleEl      = /** @type {HTMLElement} */ (document.getElementById('title'));
  const contentEl    = /** @type {HTMLElement} */ (document.getElementById('content'));
  const tabsEl       = /** @type {HTMLElement} */ (document.getElementById('tabs-container'));
  const statusEl     = /** @type {HTMLElement} */ (document.getElementById('status-bar'));
  const searchInput  = /** @type {HTMLInputElement} */ (document.getElementById('searchInput'));
  const btnExport    = /** @type {HTMLButtonElement} */ (document.getElementById('btnExportCsv'));
  const btnCopy      = /** @type {HTMLButtonElement} */ (document.getElementById('btnCopyClip'));
  const btnOpenValue = /** @type {HTMLButtonElement} */ (document.getElementById('btnOpenValue'));
  const btnShowMore  = /** @type {HTMLButtonElement} */ (document.getElementById('btnShowMore'));

  // ── Message listener ───────────────────────────────────────────────────────

  window.addEventListener('message', (/** @type {MessageEvent} */ event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      currentData = msg.data;
      // Store expression if provided by the host
      currentData.__expression = msg.data.__expression || msg.data.expression || currentData.__expression;
      activeTableIndex = 0;
      sortCol = -1;
      sortAsc = true;
      filterText = searchInput.value = '';
      render();
    } else if (msg.command === 'rerender') {
      // Panel became visible again — re-apply button state based on currentData
      render();
    } else if (msg.command === 'clear') {
      // Debugger stopped or cleared — show "Start debugger first"
      currentData = null;
      activeTableIndex = 0;
      sortCol = -1;
      sortAsc = true;
      filterText = searchInput.value = '';
      clearUI(false);
    } else if (msg.command === 'waiting') {
      // No active debug session — show "Start debugger first"
      currentData = null;
      clearUI(false);
    }
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  searchInput.addEventListener('input', () => {
    filterText = searchInput.value.toLowerCase();
    sortCol = -1;
    render();
  });

  // ── Export CSV ─────────────────────────────────────────────────────────────

  btnExport.addEventListener('click', () => {
    if (!currentData) return;
    const csv = buildCsv(currentData, activeTableIndex);
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Copy ───────────────────────────────────────────────────────────────────

  btnCopy.addEventListener('click', () => {
    if (!currentData) return;
    const csv = buildCsv(currentData, activeTableIndex);
    if (csv) {
      navigator.clipboard.writeText(csv).catch(() => {
        // fallback for older webviews
        const ta = document.createElement('textarea');
        ta.value = csv;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    }
  });

  // ── State-aware UI reset ──────────────────────────────────────────────────

  function clearUI(isWaiting = true) {
    // Hide all interactive buttons and content when there's no data
    if (btnOpenValue) btnOpenValue.style.display = 'none';
    if (btnShowMore)  btnShowMore.style.display = 'none';
    if (searchInput)  searchInput.style.display = 'none';
    if (btnExport)    btnExport.style.display = 'none';
    if (btnCopy)      btnCopy.style.display = 'none';
    if (tabsEl)       tabsEl.innerHTML = '';
    if (contentEl)    contentEl.innerHTML = '';
    
    // Update title based on state
    if (titleEl) {
      titleEl.textContent = isWaiting ? '⏳ Waiting for data…' : '❌ Start debugger first';
    }
  }

  // ── Main render ────────────────────────────────────────────────────────────

  function render() {
    if (!currentData) {
      clearUI(true);
      return;
    }
    
    // Data is available — show all interactive buttons
    if (searchInput)  searchInput.style.display = 'block';
    if (btnExport)    btnExport.style.display = 'inline-block';
    if (btnCopy)      btnCopy.style.display = 'inline-block';
    
    // Reset contextual buttons (View, Show More)
    if (btnOpenValue) { btnOpenValue.style.display = 'none'; btnOpenValue.onclick = null; }
    if (btnShowMore)  { btnShowMore.style.display  = 'none'; btnShowMore.onclick  = null; }

    tabsEl.innerHTML = '';

    switch (currentData.kind) {
      case 'datatable':
        renderDataTable(currentData);
        // Show "Show More" when data is truncated
        if (btnShowMore && currentData.truncated) {
          btnShowMore.style.display = 'inline-block';
          btnShowMore.onclick = () => {
            if (currentData.__expression) {
              vscode.postMessage({ command: 'requestMore', expression: currentData.__expression });
            }
          };
        }
        break;
      case 'dataset':
        renderDataSet(currentData);
        break;
      case 'list':
      case 'array':
        renderList(currentData);
        if (btnShowMore && currentData.truncated) {
          btnShowMore.style.display = 'inline-block';
          btnShowMore.onclick = () => {
            if (currentData.__expression) {
              vscode.postMessage({ command: 'requestMore', expression: currentData.__expression });
            }
          };
        }
        break;
      case 'dictionary':
        renderDictionary(currentData);
        if (btnShowMore && currentData.truncated) {
          btnShowMore.style.display = 'inline-block';
          btnShowMore.onclick = () => {
            if (currentData.__expression) {
              vscode.postMessage({ command: 'requestMore', expression: currentData.__expression });
            }
          };
        }
        break;
      default:
        renderUnknown(currentData);
        // For unknown objects, show the View button when a displayValue exists
        if (btnOpenValue && currentData.displayValue) {
          btnOpenValue.style.display = 'inline-block';
          btnOpenValue.onclick = () => openStringViewer(String(currentData.displayValue));
        }
    }
  }

  // ── DataTable ──────────────────────────────────────────────────────────────

  /**
   * @param {{ kind: string, tableName: string, columns: {name:string,typeName:string}[], rows: string[][], totalRows: number, truncated: boolean }} dt
   */
  function renderDataTable(dt) {
    const shortType = 'DataTable';
    titleEl.innerHTML = `${escHtml(dt.tableName)} <span class="type-badge">${shortType}</span>`;

    contentEl.innerHTML = '';
    if (dt.truncated) {
      contentEl.appendChild(truncWarning(dt.totalRows, dt.rows.length));
    }

    if (dt.columns.length === 0) {
      contentEl.insertAdjacentHTML('beforeend', '<p class="empty-msg">No columns.</p>');
      setStatus(`0 rows`);
      return;
    }

    let rows = dt.rows;
    if (filterText) {
      rows = rows.filter(r => r.some(c => c.toLowerCase().includes(filterText)));
    }
    if (sortCol >= 0) {
      rows = [...rows].sort((a, b) => {
        const cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', undefined, { numeric: true, sensitivity: 'base' });
        return sortAsc ? cmp : -cmp;
      });
    }

    const table = document.createElement('table');
    table.className = 'data-table';

    // Header
    const thead = table.createTHead();
    const hRow = thead.insertRow();
    // Row-number gutter
    const rowNumTh = document.createElement('th');
    rowNumTh.className = 'row-num';
    rowNumTh.textContent = '#';
    hRow.appendChild(rowNumTh);

    dt.columns.forEach((col, i) => {
      const th = document.createElement('th');
      th.textContent = col.name;
      th.title = col.typeName;
      if (sortCol === i) th.className = sortAsc ? 'sort-asc' : 'sort-desc';
      th.addEventListener('click', () => {
        if (sortCol === i) { sortAsc = !sortAsc; }
        else { sortCol = i; sortAsc = true; }
        render();
      });
      hRow.appendChild(th);
    });

    // Body
    const tbody = table.createTBody();
    rows.forEach((row, rowIdx) => {
      const tr = tbody.insertRow();
      const numTd = tr.insertCell();
      numTd.className = 'row-num';
      numTd.textContent = String(rowIdx + 1);

      row.forEach(cell => {
        const td = tr.insertCell();
        if (cell === '(null)') {
          td.className = 'null-value';
          td.textContent = 'null';
        } else {
          td.className = 'cell-value';
          td.textContent = cell;
          td.title = cell;
          td.addEventListener('click', () => openStringViewer(cell));
        }
      });
    });

    contentEl.appendChild(table);
    setStatus(
      filterText
        ? `Showing ${rows.length} of ${dt.totalRows} rows (filtered)`
        : `${dt.totalRows} row${dt.totalRows !== 1 ? 's' : ''}, ${dt.columns.length} column${dt.columns.length !== 1 ? 's' : ''}`
    );
  }

  // ── DataSet ────────────────────────────────────────────────────────────────

  /**
   * @param {{ kind: string, dataSetName: string, tables: any[] }} ds
   */
  function renderDataSet(ds) {
    titleEl.innerHTML = `${escHtml(ds.dataSetName)} <span class="type-badge">DataSet</span>`;

    if (ds.tables.length === 0) {
      contentEl.innerHTML = '<p class="empty-msg">No tables.</p>';
      tabsEl.innerHTML = '';
      setStatus('0 tables');
      return;
    }

    // Build tabs
    tabsEl.innerHTML = '';
    ds.tables.forEach((tbl, i) => {
      const tab = document.createElement('div');
      tab.className = 'tab' + (i === activeTableIndex ? ' active' : '');
      tab.textContent = tbl.tableName || `Table ${i}`;
      tab.title = `Rows: ${tbl.totalRows}`;
      tab.addEventListener('click', () => {
        activeTableIndex = i;
        sortCol = -1;
        sortAsc = true;
        renderDataSet(ds);
      });
      tabsEl.appendChild(tab);
    });

    contentEl.innerHTML = '';
    renderDataTable(ds.tables[activeTableIndex]);
    setStatus(`${ds.tables.length} table${ds.tables.length !== 1 ? 's' : ''}`);
  }

  // ── List / Array ───────────────────────────────────────────────────────────

  /**
   * @param {{ kind: string, typeName: string, items: {index:number,value:string}[], totalCount: number, truncated: boolean }} lst
   */
  function renderList(lst) {
    const badge = lst.kind === 'array' ? 'Array' : 'List';
    titleEl.innerHTML = `<span class="type-badge">${badge}</span> <small>${escHtml(lst.typeName)}</small>`;

    contentEl.innerHTML = '';
    if (lst.truncated) {
      contentEl.appendChild(truncWarning(lst.totalCount, lst.items.length));
    }

    let items = lst.items;
    if (filterText) {
      items = items.filter(it => it.value.toLowerCase().includes(filterText));
    }

    const table = document.createElement('table');
    table.className = 'list-table';

    const thead = table.createTHead();
    const hRow = thead.insertRow();
    [['Index', '60px'], ['Value', '']].forEach(([text, width]) => {
      const th = document.createElement('th');
      th.textContent = text;
      if (width) th.style.width = width;
      hRow.appendChild(th);
    });

    const tbody = table.createTBody();
    items.forEach(it => {
      const tr = tbody.insertRow();
      const td0 = tr.insertCell(); td0.textContent = String(it.index); td0.className = 'row-num';
      const td1 = tr.insertCell();
      if (it.value === '(null)') { td1.className = 'null-value'; td1.textContent = 'null'; }
      else {
        td1.className = 'cell-value';
        td1.textContent = it.value; td1.title = it.value;
        td1.addEventListener('click', () => openStringViewer(it.value));
      }
    });

    contentEl.appendChild(table);
    setStatus(
      filterText
        ? `Showing ${items.length} of ${lst.totalCount} items (filtered)`
        : `${lst.totalCount} item${lst.totalCount !== 1 ? 's' : ''}`
    );
  }

  // ── Dictionary ─────────────────────────────────────────────────────────────

  /**
   * @param {{ kind: string, typeName: string, entries: {key:string,value:string}[], totalCount: number, truncated: boolean }} dict
   */
  function renderDictionary(dict) {
    titleEl.innerHTML = `<span class="type-badge">Dictionary</span> <small>${escHtml(dict.typeName)}</small>`;

    contentEl.innerHTML = '';
    if (dict.truncated) {
      contentEl.appendChild(truncWarning(dict.totalCount, dict.entries.length));
    }

    let entries = dict.entries;
    if (filterText) {
      entries = entries.filter(
        e => e.key.toLowerCase().includes(filterText) || e.value.toLowerCase().includes(filterText)
      );
    }

    const table = document.createElement('table');
    table.className = 'kv-table';

    const thead = table.createTHead();
    const hRow = thead.insertRow();
    for (const txt of ['Key', 'Value']) {
      const th = document.createElement('th'); th.textContent = txt; hRow.appendChild(th);
    }

    const tbody = table.createTBody();
    entries.forEach(e => {
      const tr = tbody.insertRow();
      const tk = tr.insertCell(); tk.textContent = e.key; tk.title = e.key;
      const tv = tr.insertCell();
      if (e.value === '(null)') { tv.className = 'null-value'; tv.textContent = 'null'; }
      else { tv.textContent = e.value; tv.title = e.value; }
    });

    // make values clickable
    tbody.querySelectorAll('td').forEach(td => {
      if (td.classList.contains('null-value')) return;
      if (td.cellIndex === 1) {
        const v = td.textContent || '';
        td.classList.add('cell-value');
        td.addEventListener('click', () => openStringViewer(v));
      }
    });

    contentEl.appendChild(table);
    setStatus(
      filterText
        ? `Showing ${entries.length} of ${dict.totalCount} entries (filtered)`
        : `${dict.totalCount} entr${dict.totalCount !== 1 ? 'ies' : 'y'}`
    );
  }

  // ── Generic / Unknown ──────────────────────────────────────────────────────

  /**
   * @param {{ kind: string, typeName: string, expression: string, displayValue: string, properties: {name:string,value:string,typeName?:string}[] }} obj
   */
  function renderUnknown(obj) {
    titleEl.innerHTML = `${escHtml(obj.expression)} <span class="type-badge">${escHtml(obj.typeName)}</span>`;

    contentEl.innerHTML = '';

    let props = obj.properties;
    if (filterText) {
      props = props.filter(
        p => p.name.toLowerCase().includes(filterText) || p.value.toLowerCase().includes(filterText)
      );
    }

      if (props.length === 0) {
        contentEl.innerHTML = `<p class="empty-msg">Value: ${escHtml(obj.displayValue)}</p>`;
        setStatus('No properties');
        return;
      }

    const table = document.createElement('table');
    table.className = 'prop-table';

    const thead = table.createTHead();
    const hRow = thead.insertRow();
    for (const txt of ['Name', 'Value', 'Type']) {
      const th = document.createElement('th'); th.textContent = txt; hRow.appendChild(th);
    }

    const tbody = table.createTBody();
    props.forEach(p => {
      const tr = tbody.insertRow();
      const tn = tr.insertCell(); tn.className = 'prop-name'; tn.textContent = p.name;
      const tv = tr.insertCell();
      if (p.value === '(null)') { tv.className = 'null-value'; tv.textContent = 'null'; }
      else { tv.textContent = p.value; tv.title = p.value; }
      const tt = tr.insertCell(); tt.className = 'prop-type'; tt.textContent = p.typeName || '';
    });

    // make property values clickable
    tbody.querySelectorAll('td').forEach(td => {
      if (td.classList.contains('null-value')) return;
      if (td.classList.contains('prop-type')) return;
      if (td.classList.contains('prop-name')) return;
      const v = td.textContent || '';
      td.classList.add('cell-value');
      td.addEventListener('click', () => openStringViewer(v));
    });

    contentEl.appendChild(table);
    setStatus(`${obj.properties.length} properties`);
  }

  // ── CSV builder ────────────────────────────────────────────────────────────

  /**
   * @param {any} data
   * @param {number} tableIdx
   * @returns {string}
   */
  function buildCsv(data, tableIdx) {
    /** @param {string} v @returns {string} */
    const csv = v => `"${String(v).replace(/"/g, '""')}"`;

    if (data.kind === 'datatable') {
      const lines = [data.columns.map((/** @type {{name:string}} */ c) => csv(c.name)).join(',')];
      data.rows.forEach((/** @type {string[]} */ row) => lines.push(row.map(csv).join(',')));
      return lines.join('\r\n');
    }

    if (data.kind === 'dataset' && data.tables[tableIdx]) {
      return buildCsv(data.tables[tableIdx], 0);
    }

    if (data.kind === 'list' || data.kind === 'array') {
      const lines = ['"Index","Value"'];
      data.items.forEach((/** @type {{index:number,value:string}} */ it) =>
        lines.push(`${csv(String(it.index))},${csv(it.value)}`)
      );
      return lines.join('\r\n');
    }

    if (data.kind === 'dictionary') {
      const lines = ['"Key","Value"'];
      data.entries.forEach((/** @type {{key:string,value:string}} */ e) =>
        lines.push(`${csv(e.key)},${csv(e.value)}`)
      );
      return lines.join('\r\n');
    }

    if (data.kind === 'unknown') {
      const lines = ['"Name","Value","Type"'];
      data.properties.forEach((/** @type {{name:string,value:string,typeName?:string}} */ p) =>
        lines.push(`${csv(p.name)},${csv(p.value)},${csv(p.typeName || '')}`)
      );
      return lines.join('\r\n');
    }

    return '';
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  // ── String viewer (Plain / JSON / Markdown) ────────────────────────────────
  function openStringViewer(value) {
    // create viewer container if missing
    let viewer = document.getElementById('string-viewer');
    // store current value on the viewer element so button handlers use latest
    if (viewer) { viewer.__currentValue = value; }
    if (!viewer) {
      viewer = document.createElement('div');
      viewer.id = 'string-viewer';
      // sv-pre lives OUTSIDE sv-dynamic so it is never destroyed by innerHTML changes
      viewer.innerHTML = `
        <div class="sv-header">
          <div class="sv-title">String Viewer</div>
          <div class="sv-actions">
            <button data-mode="plain" class="sv-btn">Plain</button>
            <button data-mode="json" class="sv-btn">JSON</button>
            <button data-mode="md" class="sv-btn">Markdown</button>
            <button id="sv-close" class="sv-btn">✕</button>
          </div>
        </div>
        <pre id="sv-pre" class="sv-pre" style="display:none"></pre>
        <div id="sv-dynamic" class="sv-body"></div>
      `;
      viewer.style.marginTop = '10px';
      viewer.style.borderTop = '1px solid var(--vscode-editorWidget-border)';
      contentEl.appendChild(viewer);

      // Use event delegation for robustness: a single handler covers all buttons.
      viewer.addEventListener('click', (ev) => {
        const target = /** @type {HTMLElement} */ (ev.target);

        const btn = target.closest ? target.closest('.sv-btn') : null;
        if (!btn) return;
        if (btn.id === 'sv-close') { viewer.remove(); return; }
        const mode = btn.getAttribute('data-mode');
        if (!mode) return;
        viewer.querySelectorAll('.sv-btn').forEach(x => x.classList.remove('sv-active'));
        btn.classList.add('sv-active');
        renderStringMode(viewer.__currentValue, mode);
      });
    }

    // update current value and render
    viewer.__currentValue = value;
    const detectedMode = detectStringMode(viewer.__currentValue);
    const activeBtn = viewer.querySelector(`.sv-btn[data-mode="${detectedMode}"]`) || viewer.querySelector('.sv-btn[data-mode="plain"]');
    viewer.querySelectorAll('.sv-btn').forEach(x => x.classList.remove('sv-active'));
    activeBtn.classList.add('sv-active');
    renderStringMode(viewer.__currentValue, detectedMode);
    viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Strip outer C# debug quotes and unescape escape sequences. */
  function csharpUnquote(s) {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
      return t.slice(1, -1)
        .replace(/\\r\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return t;
  }

  function detectStringMode(s) {
    if (!s || s === '') return 'plain';
    // Normalize C# outer-quoted value before detection
    const v = csharpUnquote(s);
    // JSON detection
    try { JSON.parse(v); return 'json'; } catch {}
    // basic markdown detection
    if (/^\s{0,3}#|\n-{3,}|\*\*|\* |\-|\[.*\]\(.+\)/.test(v)) return 'md';
    return 'plain';
  }

  /**
   * Render string content in the chosen mode.
   * #sv-pre and #sv-dynamic are siblings: we never nuke sv-pre with innerHTML.
   */
  function renderStringMode(s, mode) {
    const svPre     = document.getElementById('sv-pre');
    const svDynamic = document.getElementById('sv-dynamic');
    if (!svPre || !svDynamic) return;

    svPre.style.whiteSpace = 'pre-wrap';
    svPre.style.padding    = '8px';

    if (mode === 'plain') {
      svDynamic.innerHTML   = '';
      svPre.textContent     = s;
      svPre.style.display   = 'block';

    } else if (mode === 'json') {
      svDynamic.innerHTML = '';
      try {
        // C# debugger wraps string values in outer quotes with escape sequences
        // (e.g. "{\r\n \"name\": ...}"). JSON.parse would return that as a JS
        // string rather than an object. If the first parse yields a string,
        // try parsing the inner value again to get the actual object.
        let parsed = JSON.parse(s);
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
        }
        svPre.textContent = JSON.stringify(parsed, null, 2);
      } catch {
        svPre.textContent = 'Invalid JSON\n\n' + s;
      }
      svPre.style.display = 'block';

    } else if (mode === 'md') {
      svPre.style.display = 'none';
      try {
        const src = csharpUnquote(s);
        const mdRenderer = (typeof markdownit === 'function') ? markdownit() : null;
        const html = mdRenderer ? mdRenderer.render(src) : escHtml(src).replace(/\n/g, '<br/>');
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        wrapper.querySelectorAll('script').forEach(n => n.remove());
        wrapper.querySelectorAll('[onclick]').forEach(n => n.removeAttribute('onclick'));
        wrapper.querySelectorAll('a').forEach(a => {
          if (/^javascript:/i.test(a.getAttribute('href') || '')) { a.removeAttribute('href'); }
          a.setAttribute('rel', 'noreferrer noopener');
          a.setAttribute('target', '_blank');
        });
        const preview = document.createElement('div');
        preview.className = 'md-preview';
        preview.appendChild(wrapper);
        svDynamic.innerHTML = '';
        svDynamic.appendChild(preview);
      } catch {
        svDynamic.innerHTML = '<pre style="white-space:pre-wrap;padding:8px">' + escHtml(s) + '</pre>';
      }

    }
  }

  /** @param {string} s @returns {string} */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** @param {string} msg */
  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  /**
   * @param {number} total
   * @param {number} shown
   * @returns {HTMLElement}
   */
  function truncWarning(total, shown) {
    const div = document.createElement('div');
    div.className = 'truncation-warning';
    div.textContent =
      `⚠ Showing first ${shown} of ${total} records. ` +
      `Increase "dotnetVisualizer.maxRows" / "dotnetVisualizer.maxItems" in Settings for more.`;
    return div;
  }

  // ── Initialize on page load ────────────────────────────────────────────────
  clearUI(false);
})();
