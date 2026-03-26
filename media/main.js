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

  // ── Message listener ───────────────────────────────────────────────────────

  window.addEventListener('message', (/** @type {MessageEvent} */ event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      currentData = msg.data;
      activeTableIndex = 0;
      sortCol = -1;
      sortAsc = true;
      filterText = searchInput.value = '';
      render();
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

  // ── Main render ────────────────────────────────────────────────────────────

  function render() {
    if (!currentData) return;
    tabsEl.innerHTML = '';

    switch (currentData.kind) {
      case 'datatable':
        renderDataTable(currentData);
        break;
      case 'dataset':
        renderDataSet(currentData);
        break;
      case 'list':
      case 'array':
        renderList(currentData);
        break;
      case 'dictionary':
        renderDictionary(currentData);
        break;
      default:
        renderUnknown(currentData);
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
          td.textContent = cell;
          td.title = cell;
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
      else { td1.textContent = it.value; td1.title = it.value; }
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
})();
