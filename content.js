(() => {
  'use strict';
  if (document.getElementById('nct-toolbar')) return;
  const REFRESH_AFTER = 5 * 60 * 1000;
  // All third-party (NotebookLM) selectors live here so a page change is a
  // one-place fix. Values are unchanged from the tested build.
  const SELECTORS = {
    account: '[aria-label^="Google Account:"]',
    addDialog: 'add-to-collection-dialog',
    blocking: '[aria-modal="true"], [role="menu"]',
    notebookLink: 'a[href^="/notebook/"]',
    cardContainer: 'mat-card, tr',
    actionsMenu: 'button[aria-label="Project Actions Menu"]',
    menuItem: '[role="menuitem"]',
    menuItemRadio: '[role="menuitemradio"]',
    navDropdown: 'button[aria-haspopup="menu"]',
    option: '[role="option"]',
    optionName: '.collection-name',
    dialogSurface: '[role="listbox"], .dialog-container',
    dialogHeader: '.collections-selection-header',
    spinner: 'mat-spinner, mat-progress-spinner, [role="progressbar"]',
    expandedSection: '.collection-expanded-section',
    collectionButton: 'collection-button',
    collectionTitle: '[id^="collection-"][id$="-title"]',
    collectionRow: 'tr.collection-row',
    collectionRowName: '.name-cell .collection-name',
    collectionRowCount: '.count-cell',
    collectionPrimary: 'button.primary-action-button',
    ready: 'welcome-page, main h2'
  };
  const SETTINGS_KEY = 'nct:settings';
  // Material icons contain ligature words (category, arrow_drop_down) that
  // are absent from the accessible name and must not become part of a label.
  const text = el => {
    if (!el) return '';
    const copy = el.cloneNode(true);
    copy.querySelectorAll('mat-icon, [aria-hidden="true"], .collection-emoji').forEach(icon => icon.remove());
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const visible = el => !!el && el.getClientRects().length > 0;
  const exactButton = (label, root = document) => [...root.querySelectorAll('button')]
    .find(el => visible(el) && (el.getAttribute('aria-label') === label || text(el) === label));
  const dialog = () => document.querySelector(SELECTORS.addDialog);
  const blocked = () => !!document.querySelector(SELECTORS.blocking);
  const notebookId = link => new URL(link.href).pathname.match(/^\/notebook\/([^/]+)\/?$/)?.[1];
  let memberships = new Map();
  let syncedAt = 0;
  let busy = false;
  let cancelled = false;
  let userCancelled = false;
  let account = '';
  let activeNotebook = null;
  let activeDialog = null;
  let cacheKey = null;
  let cacheReady = false;
  let cacheEpoch = 0;
  let stateRevision = 0;
  let writes = Promise.resolve();
  let autoStarted = false;
  let autoSync = false; // opt-in: off by default
  let layoutBroken = false;
  let progress = {done: 0, total: 0};
  let lastActivity = Date.now();
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) cacheReady = true;
  let lastStatus = 'Sync collections to show tags. Or check an individual notebook.';
  const toolbar = document.createElement('aside');
  toolbar.id = 'nct-toolbar';
  toolbar.className = 'nct-toolbar';
  toolbar.setAttribute('aria-label', 'Notebook collection tags');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const syncButton = document.createElement('button');
  syncButton.textContent = 'Sync collections';
  syncButton.title = 'Read your native collection pages, then return to My notebooks';
  const bar = document.createElement('progress');
  bar.className = 'nct-progress'; bar.hidden = true; bar.max = 1; bar.value = 0;
  bar.setAttribute('aria-label', 'Sync progress');
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.textContent = 'Cancel'; cancelButton.hidden = true;
  const autoLabel = document.createElement('label');
  autoLabel.className = 'nct-auto';
  autoLabel.title = 'When on, tags refresh automatically by briefly visiting each collection page.';
  const autoBox = document.createElement('input');
  autoBox.type = 'checkbox';
  autoLabel.append(autoBox, ' Auto-sync');
  // Layout: a small "Tags" toggle sits next to NotebookLM's "New notebook"
  // button; the panel (status, sync, auto-sync) is hidden until it is clicked.
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'nct-toggle';
  // Inline SVG tag icon (no icon-font dependency) plus the label, like the native "New notebook" button.
  // Built with DOM calls, not innerHTML: NotebookLM enforces Trusted Types, which rejects string HTML.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'nct-icon'); icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18'); icon.setAttribute('height', '18');
  icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
  const iconPath = document.createElementNS(SVG_NS, 'path');
  iconPath.setAttribute('fill', 'currentColor');
  iconPath.setAttribute('d', 'M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z');
  icon.append(iconPath);
  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'nct-toggle-label'; toggleLabel.textContent = 'Tags';
  toggle.append(icon, toggleLabel);
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'nct-panel'; panel.hidden = true;
  panel.append(status, bar, cancelButton, syncButton, autoLabel);
  toolbar.append(toggle, panel);
  const setOpen = open => {
    panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    toggle.title = open ? 'Hide tag sync' : (lastStatus || 'Tag sync');
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden && toolbar.contains(document.activeElement)) { setOpen(false); toggle.focus(); } });
  document.addEventListener('pointerdown', event => { if (!panel.hidden && !busy && !toolbar.contains(event.target)) setOpen(false); }, true);
  // Read the native button's computed look (size, font, page ink and surface colours) so the toggle and
  // panel follow NotebookLM's own light/dark theme instead of hard-coded colours.
  function matchNativeLook(anchor) {
    const cs = getComputedStyle(anchor), set = (name, value) => value && toolbar.style.setProperty(name, value);
    const label = anchor.querySelector('.mdc-button__label') || anchor, ls = getComputedStyle(label);
    set('--nct-h', cs.height); set('--nct-font-family', ls.fontFamily); set('--nct-font-size', ls.fontSize);
    set('--nct-font-weight', ls.fontWeight); set('--nct-letter-spacing', ls.letterSpacing);
    const host = anchor.closest('.my-projects-container') || document.body;
    set('--nct-ink', getComputedStyle(host).color);
    let el = host, surface = '';
    for (; el && !surface; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') surface = bg;
    }
    set('--nct-surface', surface);
  }
  // Mount beside "New notebook"; fall back to a fixed corner if it is not found.
  function mountToolbar() {
    const anchor = exactButton('New notebook') || exactButton('Create new notebook') || exactButton('Create new');
    // The native button sits inside an <nb-button> wrapper that is the flex item of the header actions row;
    // placing the toolbar before that wrapper puts it on the same row, with the row's own gap.
    const slot = anchor?.closest('nb-button') || anchor;
    if (slot?.parentElement) {
      toolbar.classList.remove('nct-floating');
      if (toolbar.nextElementSibling !== slot) slot.before(toolbar);
      matchNativeLook(anchor);
    } else {
      toolbar.classList.add('nct-floating');
      if (toolbar.parentElement !== document.body) document.body.append(toolbar);
    }
  }
  mountToolbar();
  cancelButton.addEventListener('click', () => { cancelled = true; userCancelled = true; announce('Cancelling…'); });
  autoBox.addEventListener('change', () => {
    autoSync = autoBox.checked; autoStarted = false;
    Promise.resolve(storage?.set({[SETTINGS_KEY]: {autoSync}})).catch(() => announce('Could not save the auto-sync setting.'));
    if (autoSync) startAutoWatcher();
  });
  Promise.resolve(storage?.get(SETTINGS_KEY)).then(saved => {
    autoSync = saved?.[SETTINGS_KEY]?.autoSync === true; autoBox.checked = autoSync;
    if (autoSync) startAutoWatcher();
  }).catch(() => {});
  function announce(message) { lastStatus = message; status.textContent = message; if (panel.hidden) toggle.title = message; }
  function persistCache() {
    if (!storage || !cacheKey || !cacheReady) return;
    const key = cacheKey;
    const value = {schema: 1, syncedAt, entries: [...memberships]};
    writes = writes.catch(() => {}).then(() => storage.set({[key]: value}));
    writes.catch(() => announce('Tags are visible, but local caching failed. Sync again to retry.'));
  }
  async function loadCache(label) {
    const epoch = ++cacheEpoch;
    const revision = stateRevision;
    cacheReady = false; cacheKey = null;
    try {
      if (!storage || !label) return;
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${location.origin}:${label}`));
      const key = 'nct:1:' + [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
      if (epoch !== cacheEpoch) return;
      cacheKey = key;
      const saved = (await storage.get(key))[key];
      if (epoch !== cacheEpoch || revision !== stateRevision) return;
      const valid = saved?.schema === 1 && Number.isFinite(saved.syncedAt) && saved.syncedAt >= 0 && saved.syncedAt <= Date.now()
        && Array.isArray(saved.entries) && saved.entries.every(entry => Array.isArray(entry) && entry.length === 2
          && typeof entry[0] === 'string' && Array.isArray(entry[1]?.names)
          && entry[1].names.every(name => typeof name === 'string') && Number.isFinite(entry[1].at));
      if (valid) {
        memberships = new Map(saved.entries); syncedAt = saved.syncedAt;
        announce('Cached collection tags restored. Sync to check for changes.');
      }
    } catch {
      announce('Could not read cached tags. Click Sync collections.');
    } finally {
      if (epoch === cacheEpoch) {
        cacheReady = true;
        if (revision !== stateRevision) persistCache();
        render();
      }
    }
  }
  function cards(root = document) {
    return [...root.querySelectorAll(SELECTORS.notebookLink)].filter(visible).flatMap(link => {
      const id = notebookId(link);
      const container = link.closest(SELECTORS.cardContainer);
      const mount = container?.matches('tr') ? link.closest('td') : container;
      return id && mount ? [{id, container, mount}] : [];
    });
  }
  function readOptions(root) {
    return [...root.querySelectorAll(SELECTORS.option)].map(el => ({
      name: text(el.querySelector(SELECTORS.optionName)) || text(el),
      selected: el.getAttribute('aria-selected') === 'true', el
    }));
  }
  function remember(id, options) {
    memberships.set(id, {names: options.filter(o => o.selected).map(o => o.name), at: Date.now()});
    stateRevision++; persistCache();
  }
  function render() {
    const label = document.querySelector(SELECTORS.account)?.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() || '';
    if (label !== account) {
      if (account) { cancelled = true; memberships.clear(); syncedAt = 0; activeNotebook = null; announce('Account changed. Sync collections again.'); }
      account = label; stateRevision++; autoStarted = false;
      if (autoSync) startAutoWatcher();
      loadCache(label);
    }
    const home = ['My notebooks', 'Collections', 'All'].some(label => exactButton(label)) && !location.pathname.includes('/notebook/');
    toolbar.hidden = !home;
    if (home) mountToolbar();
    // Kill-switch: notebook links are on screen but none matched our card
    // selectors, so the page layout probably changed. Do nothing rather than guess.
    const links = [...document.querySelectorAll(SELECTORS.notebookLink)].filter(visible).length;
    const tagged = cards().length;
    if (home && !busy && links >= 3 && tagged === 0) {
      if (!layoutBroken) { layoutBroken = true; announce('NotebookLM looks different from what this extension expects, so tags are paused.'); }
    } else if (layoutBroken && tagged > 0) { layoutBroken = false; announce('Sync collections to show tags.'); }
    syncButton.disabled = busy || !cacheReady || layoutBroken;
    bar.hidden = cancelButton.hidden = !busy || !progress.total;
    bar.max = progress.total || 1; bar.value = progress.done;
    autoLabel.hidden = busy;
    toggle.classList.toggle('nct-busy', busy);
    if (layoutBroken) { document.querySelectorAll('.nct-tags').forEach(el => el.remove()); return; }
    for (const {id, container, mount} of cards()) {
      let row = mount.querySelector(':scope > .nct-tags');
      if (!row) { row = document.createElement('div'); row.className = 'nct-tags'; mount.append(row); }
      const cached = memberships.get(id);
      const complete = syncedAt > 0;
      const names = cached ? cached.names : complete ? [] : null;
      const signature = JSON.stringify([id, names, busy, cacheReady]);
      if (row.dataset.signature === signature) continue;
      row.dataset.signature = signature;
      row.replaceChildren();
      const labels = names?.length ? names : [names ? '+ Assign collection' : 'Check collections'];
      for (const name of labels) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = name;
        button.className = names?.length ? '' : names ? 'nct-empty' : 'nct-unknown';
        button.disabled = busy || !cacheReady;
        const checkedAt = cached?.at || syncedAt;
        const snapshot = checkedAt ? ` Last checked ${new Date(checkedAt).toLocaleString()}. Sync for changes made elsewhere.` : '';
        button.title = (names?.length ? 'Manage native collection memberships.' : names ? 'Choose a collection to assign and save immediately.' : 'Read current memberships and open the collection picker.') + snapshot;
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          openPicker(id, container, names?.length === 0).catch(error => announce(error.message));
        });
        row.append(button);
      }
    }
  }
  async function waitFor(fn, message, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (cancelled) throw new Error('Sync interrupted. Click Sync collections to try again.');
      const result = fn();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
  async function launchDialog(container) {
    const menu = container.querySelector(SELECTORS.actionsMenu);
    if (!menu || !visible(menu)) throw new Error('Notebook actions changed. Open its native menu to manage collections.');
    menu.click();
    const item = await waitFor(() => [...document.querySelectorAll(SELECTORS.menuItem)]
      .find(el => visible(el) && text(el).replace(/^category\s*/, '') === 'Add to collection'), 'Collection menu was not found.');
    item.click();
    let previous = '', stable = 0;
    return waitFor(() => {
      const root = dialog();
      // Angular's dialog component host uses display: contents and has no rect.
      // Read visibility from the rendered listbox or dialog surface instead.
      if (!root || !visible(root.querySelector(SELECTORS.dialogSurface) || root) || root.querySelector(SELECTORS.spinner)) return false;
      const options = readOptions(root);
      const signature = JSON.stringify(options.map(({name, selected}) => [name, selected]));
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      const ready = options.length && options.every(o => o.name && o.el.hasAttribute('aria-selected'));
      const empty = /no collections|create your first collection/i.test(text(root));
      return stable >= 6 && (ready || empty) ? root : false;
    }, 'Collection picker did not finish loading. Use its native controls or try again.');
  }
  async function navigate(label) {
    if (label === 'Collections' && document.querySelector(SELECTORS.expandedSection)) {
      const back = exactButton('Back to collections');
      if (!back) throw new Error('Could not find Back to collections.');
      back.click();
      await waitFor(() => !document.querySelector(SELECTORS.expandedSection) && text(document.querySelector('h2')) === 'My collections', 'Could not return to Collections.');
      return;
    }
    const dropdown = [...document.querySelectorAll(SELECTORS.navDropdown)]
      .find(el => visible(el) && ['All', 'My notebooks', 'Discover', 'Collections'].includes(text(el)));
    if (dropdown) {
      dropdown.click();
      const item = await waitFor(() => [...document.querySelectorAll(SELECTORS.menuItemRadio)]
        .find(el => visible(el) && text(el) === label), `Could not find ${label} in navigation.`);
      item.click();
    } else {
      const button = exactButton(label);
      if (!button) throw new Error(`Could not find ${label} navigation.`);
      button.click();
    }
  }
  // One Save listener per dialog, whichever path opened it.
  function bindSaveListener(root, id, container) {
    if (root.dataset.nctSaveBound) return;
    root.dataset.nctSaveBound = 'true';
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || text(button) !== 'Save' || button.disabled) return;
      memberships.delete(id); syncedAt = 0; stateRevision++; persistCache();
      if (container) verifySaved(id, container, root).catch(error => announce(error.message));
      else announce('Membership changed. Sync collections to refresh tags.');
    }, true);
  }
  async function openPicker(id, container, quick) {
    if (busy || !cacheReady || blocked()) return;
    busy = true; cancelled = false; activeNotebook = id;
    render();
    try {
      const root = await launchDialog(container);
      const options = readOptions(root);
      remember(id, options);
      const isQuick = quick || !options.some(o => o.selected);
      activeDialog = root;
      if (isQuick && options.length) {
        const hint = document.createElement('p'); hint.className = 'nct-hint';
        hint.textContent = 'Quick assign: click a collection to save immediately.';
        root.querySelector(SELECTORS.dialogHeader)?.after(hint);
        root.addEventListener('click', event => {
          const option = event.target.closest('[role="option"]');
          if (!option || root.dataset.nctSaving) return;
          root.dataset.nctSaving = 'true';
          setTimeout(async () => {
            if (option.getAttribute('aria-selected') !== 'true') { delete root.dataset.nctSaving; return; }
            try {
              const save = await waitFor(() => {
                const button = exactButton('Save', root);
                return root.isConnected && button && !button.disabled ? button : false;
              }, 'Quick save is unavailable. Use the native Save button.', 3000);
              save.click();
            } catch (error) {
              delete root.dataset.nctSaving;
              announce(error.message);
            }
          }, 0);
        });
      }
      bindSaveListener(root, id, container);
      announce(isQuick ? 'Choose a collection in the picker to assign it.' : 'Manage collections, then click Save.');
    } finally { busy = false; render(); }
  }
  async function verifySaved(id, container, oldRoot) {
    busy = true; render();
    try {
      await waitFor(() => !oldRoot.isConnected, 'Save has not completed. Check the native picker for an error.');
      if (!container.isConnected || blocked()) throw new Error('Refresh collections to confirm the saved membership.');
      // Reopen through the native UI to read server-backed selection after saving.
      const root = await launchDialog(container);
      remember(id, readOptions(root));
      exactButton('Cancel', root)?.click();
      activeDialog = null; activeNotebook = null;
      announce('Collection memberships refreshed.');
    } finally { busy = false; render(); }
  }
  function collectionCards() {
    const grid = [...document.querySelectorAll(SELECTORS.collectionButton)].filter(visible).map(el => {
      const title = el.querySelector(SELECTORS.collectionTitle);
      const count = text(el).match(/(\d+)\s+notebooks?\b/i);
      return {id: title?.id, name: text(title), count: count ? Number(count[1]) : null, view: 'grid'};
    });
    if (grid.length) return grid;
    return [...document.querySelectorAll(SELECTORS.collectionRow)].filter(visible).map((row, index) => {
      const name = text(row.querySelector(SELECTORS.collectionRowName));
      const count = text(row.querySelector(SELECTORS.collectionRowCount)).match(/(\d+)\s+notebooks?\b/i);
      return {id: `row:${index}`, index, name, count: count ? Number(count[1]) : null, view: 'list'};
    });
  }
  function collectionTarget(collection) {
    if (collection.view === 'grid') {
      // Grid cards put their click listener on a sibling overlay button, not
      // the title span. Clicking the text programmatically is a no-op.
      return document.getElementById(collection.id)?.closest(SELECTORS.collectionButton)?.querySelector(SELECTORS.collectionPrimary) || null;
    }
    const row = [...document.querySelectorAll(SELECTORS.collectionRow)].filter(visible)[collection.index];
    // Native list rows have no collection IDs. Recheck position, label and count
    // against the snapshot before opening one; never guess a different row.
    const current = collectionCards().find(item => item.id === collection.id && item.view === 'list');
    return current?.name === collection.name && current.count === collection.count ? row?.querySelector(SELECTORS.collectionRowName) : null;
  }
  async function sync() {
    if (busy || blocked()) { announce('Close the open menu or dialog before syncing.'); return; }
    busy = true; cancelled = false; userCancelled = false; progress = {done: 0, total: 0};
    const startAccount = account;
    const initialHeading = text(document.querySelector('h2'));
    const restore = ['All notebooks', 'Recent notebooks'].includes(initialHeading) ? 'All' : initialHeading === 'My collections' || document.querySelector(SELECTORS.expandedSection) ? 'Collections' : 'My notebooks';
    const next = new Map();
    render();
    try {
      announce('Reading collections… Please wait while collection pages are visited.');
      await navigate('Collections');
      await waitFor(() => text(document.querySelector('h2')) === 'My collections', 'Could not open Collections.');
      // Require the collection list to settle before taking its snapshot.
      let previous = '', stable = 0;
      const collectionList = await waitFor(() => {
        const list = collectionCards();
        const signature = JSON.stringify(list);
        stable = signature === previous ? stable + 1 : 0; previous = signature;
        if (document.querySelector(SELECTORS.spinner)) return false;
        return stable >= 10 && (list.length || /no collections|create your first collection/i.test(document.body.innerText)) ? list : false;
      }, 'Collections did not finish loading. No memberships were changed.');
      progress = {done: 0, total: collectionList.length}; render();
      for (let i = 0; i < collectionList.length; i++) {
        const collection = collectionList[i];
        if (!collection.id || collection.count === null) throw new Error('Collection layout changed. Could not read notebook counts.');
        announce(`Reading ${collection.name} (${i + 1}/${collectionList.length})…`);
        const title = collectionTarget(collection);
        if (!title) throw new Error('Collection list changed. Sync again.');
        title.click();
        await waitFor(() => exactButton('Back to collections') && text(document.querySelector('h3')) === collection.name, 'Collection did not open.');
        let previousIds = '', stableIds = 0;
        const ids = await waitFor(() => {
          const section = document.querySelector(SELECTORS.expandedSection);
          if (!section || section.querySelector(SELECTORS.spinner)) return false;
          const set = new Set(cards(section).map(card => card.id));
          const signature = JSON.stringify([...set].sort());
          stableIds = signature === previousIds ? stableIds + 1 : 0; previousIds = signature;
          return stableIds >= 6 && set.size === collection.count ? set : false;
        }, 'Notebook count differs from collection count. Sync stopped to avoid incorrect unassigned tags.');
        for (const id of ids) {
          if (!next.has(id)) next.set(id, {names: [], at: Date.now()});
          next.get(id).names.push(collection.name);
        }
        progress.done = i + 1; render();
        exactButton('Back to collections').click();
        await waitFor(() => text(document.querySelector('h2')) === 'My collections' && !document.querySelector(SELECTORS.expandedSection), 'Could not return to Collections.');
      }
      if (account !== startAccount || cancelled) throw new Error('Account or page changed. Sync again.');
      syncedAt = Date.now();
      for (const entry of next.values()) entry.at = syncedAt;
      memberships = next;
      stateRevision++; persistCache();
      announce(`Synced ${collectionList.length} collections. Tags saved on this device.`);
    } catch (error) {
      announce(error.message + (syncedAt ? ' Showing the last saved tags.' : ''));
    } finally {
      // A user's navigation takes precedence over restoring our starting tab.
      if (!cancelled || userCancelled) {
        cancelled = false; userCancelled = false;
        try { await navigate(restore); }
        catch (error) { announce(error.message); }
      }
      busy = false; progress = {done: 0, total: 0}; render();
    }
  }
  syncButton.addEventListener('click', sync);
  // Track native menus by their notebook ID, never by title (titles can repeat).
  document.addEventListener('click', event => {
    const menu = event.target.closest(SELECTORS.actionsMenu);
    if (menu) {
      const link = menu.closest(SELECTORS.cardContainer)?.querySelector(SELECTORS.notebookLink);
      activeNotebook = link ? notebookId(link) : null;
    }
  }, true);
  const interrupt = event => {
    if (event.isTrusted) lastActivity = Date.now();
    if (busy && event.isTrusted && !event.target.closest('#nct-toolbar, add-to-collection-dialog')) cancelled = true;
  };
  document.addEventListener('pointerdown', interrupt, true);
  document.addEventListener('keydown', interrupt, true);
  const activity = event => { if (event.isTrusted) lastActivity = Date.now(); };
  document.addEventListener('wheel', activity, {capture: true, passive: true});
  document.addEventListener('touchmove', activity, {capture: true, passive: true});
  document.addEventListener('scroll', activity, {capture: true, passive: true});
  let scheduled = false;
  const ours = node => node.nodeType === 1 ? node.closest?.('#nct-toolbar, .nct-tags') : node.parentElement?.closest('#nct-toolbar, .nct-tags');
  new MutationObserver(records => {
    // Ignore churn we caused ourselves (our toolbar and tag rows).
    if (scheduled || records.every(r => ours(r.target))) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const root = dialog();
      if (root && root !== activeDialog && activeNotebook) {
        activeDialog = root;
        bindSaveListener(root, activeNotebook, null);
      }
      if (!root) activeDialog = null;
      render();
    });
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-label']});
  announce(lastStatus); render();
  setInterval(render, 30000);
  // Optional auto-sync (off by default, enabled via the toolbar checkbox).
  // Native collection navigation is visible; postpone it whenever a
  // dialog/menu is open or the user is active. The timer stops after it fires.
  let autoTimer = 0;
  function startAutoWatcher() {
    if (autoTimer) return;
    autoTimer = setInterval(() => {
      if (!autoSync || autoStarted) { clearInterval(autoTimer); autoTimer = 0; return; }
      if (!cacheReady || busy || !account || toolbar.hidden || layoutBroken || blocked() || Date.now() - lastActivity < 2000) return;
      if (!document.querySelector(SELECTORS.ready) || document.querySelector(SELECTORS.spinner)) return;
      autoStarted = true; clearInterval(autoTimer); autoTimer = 0;
      if (!syncedAt || Date.now() - syncedAt >= REFRESH_AFTER) sync();
    }, 1000);
  }
})();
