# Collection Tags for NotebookLM (unofficial)

Chrome Manifest V3 extension for the native collections at https://notebook.google.com/. Shows collection badges on notebook cards in grid and list views. Unassigned notebooks get an **Assign collection** button.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this `notebook-collection-tags` directory.
3. Refresh NotebookLM.
4. Click **Sync collections** (or turn on the optional **Auto-sync** checkbox, off by default). The extension briefly visits each collection, reads its notebook IDs, then returns to your starting view. A progress bar and Cancel button show while it runs.

After updating local files, click **Reload** for the extension in `chrome://extensions` and refresh Gemini Notebook.

## Use

- Collection badges show all memberships found during the last sync. Click a badge to open the native picker and manage multiple collections using **Save**.
- **Assign collection** opens the native picker. Click a collection to select it and save immediately. The extension reopens the picker to read the saved membership, then closes it.
- **Check collections** reads one notebook's current memberships without requiring a full sync. If it is unassigned, selecting a collection saves immediately.
- Tags are saved locally per Google account and restored on refresh or a later browser session. With Auto-sync on, it syncs once per page load if the saved snapshot is missing or older than five minutes. It postpones automatic navigation while a native menu/dialog is open or you are clicking, typing, or scrolling.
- **Sync collections** updates tags after edits in another tab. Cached badges show the last saved snapshot; hovering shows when they were checked. Changes made elsewhere appear after the next sync. Cached tags remain visible if refreshing collections fails.
- Sync checks every collection's notebook count. If some notebooks have not loaded or the page structure changes, it stops and shows an error instead of marking notebooks as unassigned.
- Clicking or typing elsewhere during sync interrupts it. Close any native menu or dialog before syncing.

## Privacy and scope

Uses the `storage` extension permission to save notebook IDs, collection names, and check timestamps in `chrome.storage.local` on this device. A hash of the Google account label and site origin separates account caches. Switching accounts clears the displayed snapshot before loading the new account's data. Google account labels are hashed locally; they are not stored as plain text or transmitted.

No background service, analytics, remote code, or custom network API calls. All assignments use Gemini Notebook's native UI and save to the same native collections. Uninstalling the extension removes its local cache.

This version targets the English collection UI inspected on October 12, 2026. Google can change its DOM, labels, loading behavior, or collection support. A sync works only when every collection's displayed notebook count matches the loaded notebook cards. Large or paginated collections may require adaptation.

## Validation status

Live checks confirmed successful five-collection syncs and real notebook badges in both list and grid views. An earlier build automatically synced all five native collections after idle, saved them through Chrome storage, and restored the cached badges after a real page refresh. The native quick-assignment picker opens and reaches its ready state. JavaScript syntax and manifest file checks passed. The local browser demo confirmed multiple membership badges, unassigned detection, delayed picker loading, quick assignment, and saved membership readback. Code review added guards around cache loading, account changes, and partially loaded UI.

No existing notebook memberships were changed during development. A real save to Google has not been performed because no specific notebook/collection assignment was requested.

To run the sample demo: from this directory run `python3 -m http.server 8793 --bind 127.0.0.1`, then open `http://127.0.0.1:8793/tools/demo.html` for list view or append `?view=grid` for grid view. It loads the same content script and stylesheet against sample native controls, including compact navigation, hidden icon text, grid overlay buttons, and a picker host with `display: contents`. A sample-only storage adapter exercises cache persistence using the demo page's local storage. It does not prove compatibility with Google's save requests or browser extension isolation.


## Packaging

`scripts/package.sh` zips only the shipping files (manifest, content script, CSS, icons) into `dist/`. Store text and privacy answers are in `docs/STORE-LISTING.md`. Third-party selectors are centralised in the `SELECTORS` constant at the top of `content.js`.
