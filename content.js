(() => {
  'use strict';
  if (document.getElementById('nct-toolbar')) return;
  const REFRESH_AFTER = 5 * 60 * 1000;
  const VERSION = '0.2.0';
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
  const dialog = () => document.querySelector('add-to-collection-dialog');
  const blocked = () => !!document.querySelector('[aria-modal="true"], [role="menu"]');
  const notebookId = link => new URL(link.href).pathname.match(/^\/notebook\/([^/]+)\/?$/)?.[1];
  let memberships = new Map();
  let syncedAt = 0;
  let busy = false;
  let cancelled = false;
  let account = '';
  let activeNotebook = null;
  let activeDialog = null;
  let cacheKey = null;
  let cacheReady = false;
  let cacheEpoch = 0;
  let stateRevision = 0;
  let writes = Promise.resolve();
  let autoStarted = false;
  let lastActivity = Date.now();
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) cacheReady = true;
  let lastStatus = 'Sync collections to show tags. Or check an individual notebook.';
  const toolbar = document.createElement('aside');
  toolbar.id = 'nct-toolbar';
  toolbar.className = 'nct-toolbar';
  toolbar.dataset.version = VERSION;
  toolbar.setAttribute('aria-label', 'Notebook collection tags');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const syncButton = document.createElement('button');
  syncButton.textContent = 'Sync collections';
  syncButton.title = 'Read your native collection pages, then return to My notebooks';
  const version = document.createElement('small');
  version.textContent = `v${VERSION}`;
  toolbar.append(version, status, syncButton);
  document.body.append(toolbar);
  function announce(message) { lastStatus = message; status.textContent = message; }
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
        announce(syncedAt ? 'Cached collection tags restored. Sync to check for changes.' : 'Cached tags restored. Collections will refresh automatically.');
      }
    } catch {
      announce('Could not read cached tags. Collections will sync automatically.');
    } finally {
      if (epoch === cacheEpoch) {
        cacheReady = true;
        if (revision !== stateRevision) persistCache();
        render();
      }
    }
  }
  function cards(root = document) {
    return [...root.querySelectorAll('a[href^="/notebook/"]')].filter(visible).flatMap(link => {
      const id = notebookId(link);
      const container = link.closest('mat-card, tr');
      const mount = container?.matches('tr') ? link.closest('td') : container;
      return id && mount ? [{id, container, mount}] : [];
    });
  }
  function readOptions(root) {
    return [...root.querySelectorAll('[role="option"]')].map(el => ({
      name: text(el.querySelector('.collection-name')) || text(el),
      selected: el.getAttribute('aria-selected') === 'true', el
    }));
  }
  function remember(id, options) {
    memberships.set(id, {names: options.filter(o => o.selected).map(o => o.name), at: Date.now()});
    stateRevision++; persistCache();
  }
  function render() {
    const label = document.querySelector('[aria-label^="Google Account:"]')?.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() || '';
    if (label !== account) {
      if (account) { cancelled = true; memberships.clear(); syncedAt = 0; activeNotebook = null; announce('Account changed. Sync collections again.'); }
      account = label; stateRevision++; autoStarted = false;
      loadCache(label);
    }
    const home = ['My notebooks', 'Collections', 'All'].some(label => exactButton(label)) && !location.pathname.includes('/notebook/');
    toolbar.hidden = !home;
    syncButton.disabled = busy || !cacheReady;
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
    const menu = container.querySelector('button[aria-label="Project Actions Menu"]');
    if (!menu || !visible(menu)) throw new Error('Notebook actions changed. Open its native menu to manage collections.');
    menu.click();
    const item = await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')]
      .find(el => visible(el) && text(el).replace(/^category\s*/, '') === 'Add to collection'), 'Collection menu was not found.');
    item.click();
    let previous = '', stable = 0;
    return waitFor(() => {
      const root = dialog();
      // Angular's dialog component host uses display: contents and has no rect.
      // Read visibility from the rendered listbox or dialog surface instead.
      if (!root || !visible(root.querySelector('[role="listbox"], .dialog-container') || root) || root.querySelector('mat-spinner, mat-progress-spinner, [role="progressbar"]')) return false;
      const options = readOptions(root);
      const signature = JSON.stringify(options.map(({name, selected}) => [name, selected]));
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      const ready = options.length && options.every(o => o.name && o.el.hasAttribute('aria-selected'));
      const empty = /no collections|create your first collection/i.test(text(root));
      return stable >= 6 && (ready || empty) ? root : false;
    }, 'Collection picker did not finish loading. Use its native controls or try again.');
  }
  async function navigate(label) {
    if (label === 'Collections' && document.querySelector('.collection-expanded-section')) {
      const back = exactButton('Back to collections');
      if (!back) throw new Error('Could not find Back to collections.');
      back.click();
      await waitFor(() => !document.querySelector('.collection-expanded-section') && text(document.querySelector('h2')) === 'My collections', 'Could not return to Collections.');
      return;
    }
    const dropdown = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .find(el => visible(el) && ['All', 'My notebooks', 'Discover', 'Collections'].includes(text(el)));
    if (dropdown) {
      dropdown.click();
      const item = await waitFor(() => [...document.querySelectorAll('[role="menuitemradio"]')]
        .find(el => visible(el) && text(el) === label), `Could not find ${label} in navigation.`);
      item.click();
    } else {
      const button = exactButton(label);
      if (!button) throw new Error(`Could not find ${label} navigation.`);
      button.click();
    }
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
        root.querySelector('.collections-selection-header')?.after(hint);
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
      root.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button && text(button) === 'Save' && !button.disabled) {
          memberships.delete(id); syncedAt = 0; stateRevision++; persistCache();
          verifySaved(id, container, root).catch(error => announce(error.message));
        }
      }, true);
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
    const grid = [...document.querySelectorAll('collection-button')].filter(visible).map(el => {
      const title = el.querySelector('[id^="collection-"][id$="-title"]');
      const count = text(el).match(/(\d+)\s+notebooks?\b/i);
      return {id: title?.id, name: text(title), count: count ? Number(count[1]) : null, view: 'grid'};
    });
    if (grid.length) return grid;
    return [...document.querySelectorAll('tr.collection-row')].filter(visible).map((row, index) => {
      const name = text(row.querySelector('.name-cell .collection-name'));
      const count = text(row.querySelector('.count-cell')).match(/(\d+)\s+notebooks?\b/i);
      return {id: `row:${index}`, index, name, count: count ? Number(count[1]) : null, view: 'list'};
    });
  }
  function collectionTarget(collection) {
    if (collection.view === 'grid') {
      // Grid cards put their click listener on a sibling overlay button, not
      // the title span. Clicking the text programmatically is a no-op.
      return document.getElementById(collection.id)?.closest('collection-button')?.querySelector('button.primary-action-button') || null;
    }
    const row = [...document.querySelectorAll('tr.collection-row')].filter(visible)[collection.index];
    // Native list rows have no collection IDs. Recheck position, label and count
    // against the snapshot before opening one; never guess a different row.
    const current = collectionCards().find(item => item.id === collection.id && item.view === 'list');
    return current?.name === collection.name && current.count === collection.count ? row?.querySelector('.name-cell .collection-name') : null;
  }
  async function sync() {
    if (busy || blocked()) { announce('Close the open menu or dialog before syncing.'); return; }
    busy = true; cancelled = false;
    const startAccount = account;
    const initialHeading = text(document.querySelector('h2'));
    const restore = ['All notebooks', 'Recent notebooks'].includes(initialHeading) ? 'All' : initialHeading === 'My collections' || document.querySelector('.collection-expanded-section') ? 'Collections' : 'My notebooks';
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
        if (document.querySelector('mat-spinner, mat-progress-spinner, [role="progressbar"]')) return false;
        return stable >= 10 && (list.length || /no collections|create your first collection/i.test(document.body.innerText)) ? list : false;
      }, 'Collections did not finish loading. No memberships were changed.');
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
          const section = document.querySelector('.collection-expanded-section');
          if (!section || section.querySelector('mat-spinner, mat-progress-spinner, [role="progressbar"]')) return false;
          const set = new Set(cards(section).map(card => card.id));
          const signature = JSON.stringify([...set].sort());
          stableIds = signature === previousIds ? stableIds + 1 : 0; previousIds = signature;
          return stableIds >= 6 && set.size === collection.count ? set : false;
        }, 'Notebook count differs from collection count. Sync stopped to avoid incorrect unassigned tags.');
        for (const id of ids) {
          if (!next.has(id)) next.set(id, {names: [], at: Date.now()});
          next.get(id).names.push(collection.name);
        }
        exactButton('Back to collections').click();
        await waitFor(() => text(document.querySelector('h2')) === 'My collections' && !document.querySelector('.collection-expanded-section'), 'Could not return to Collections.');
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
      if (!cancelled) {
        try { await navigate(restore); }
        catch (error) { announce(error.message); }
      }
      busy = false; render();
    }
  }
  syncButton.addEventListener('click', sync);
  // Track native menus by their notebook ID, never by title (titles can repeat).
  document.addEventListener('click', event => {
    const menu = event.target.closest('button[aria-label="Project Actions Menu"]');
    if (menu) {
      const link = menu.closest('mat-card, tr')?.querySelector('a[href^="/notebook/"]');
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
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const root = dialog();
      if (root && root !== activeDialog && activeNotebook) {
        activeDialog = root;
        root.addEventListener('click', event => {
          const button = event.target.closest('button');
          if (button && text(button) === 'Save' && !button.disabled) {
            memberships.delete(activeNotebook); syncedAt = 0; stateRevision++; persistCache();
            announce('Membership changed. Sync collections to refresh tags.');
          }
        }, true);
      }
      if (!root) activeDialog = null;
      render();
    });
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-label']});
  announce(lastStatus); render();
  setInterval(render, 30000);
  // Automatically refresh once per page load after the account, native home
  // view, and any user interaction settle. Native collection navigation is
  // visible; postpone it whenever a dialog/menu is open or the user is active.
  setInterval(() => {
    if (autoStarted || !cacheReady || busy || !account || toolbar.hidden || blocked() || Date.now() - lastActivity < 2000) return;
    if (!document.querySelector('welcome-page, main h2') || document.querySelector('mat-spinner, mat-progress-spinner, [role="progressbar"]')) return;
    autoStarted = true;
    if (!syncedAt || Date.now() - syncedAt >= REFRESH_AFTER) sync();
  }, 1000);
})();
