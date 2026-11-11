# Chrome Web Store listing: Collection Tags for NotebookLM

Placeholders to fill before submitting: `TODO_PRIVACY_URL`, `TODO_SUPPORT_URL`, `TODO_AUTHOR`.

## Short description (max 132 chars)
Shows which collections each NotebookLM notebook belongs to, right on the notebook cards. Unofficial; not affiliated with Google.

## Long description
Collection Tags for NotebookLM adds small tags to the notebook cards on notebook.google.com so you can see at a glance which of your native collections each notebook is in. Notebooks that are not in any collection get an "Assign collection" button that opens NotebookLM's own picker and saves your choice in one click.

How it works
- Click "Sync collections" and the extension briefly opens each of your collections, reads which notebooks they contain, then returns to the page you started on. A progress bar and a Cancel button are shown while it runs.
- Optional "Auto-sync" (off by default) does the same once per page load when you are idle.
- Tags are cached on your device, separately for each Google account.
- Assigning a collection uses NotebookLM's own menus and Save button.

Privacy: nothing is sent anywhere. No analytics, no remote code, no servers.

This is an unofficial extension. It is not affiliated with, endorsed by, or sponsored by Google. NotebookLM is a trademark of Google LLC. Because it reads the page layout, a NotebookLM redesign can pause the tags until the extension is updated; it is designed to do nothing rather than guess when the page looks different.

## Single purpose
Display and manage NotebookLM collection memberships as tags on notebook cards.

## Permission justifications
- storage: saves the cached notebook-to-collection tags, the auto-sync preference, and a hashed account key in chrome.storage.local on this device.
- Host access (https://notebook.google.com/*): the content script runs only on NotebookLM to read notebook cards and collection pages and to draw tags.
- No remote code, no other host permissions, no tabs/cookies/history.

## Privacy answers (Developer Dashboard)
- Data collected: none transmitted. Locally stored: notebook IDs, collection names, check timestamps, a setting, and a SHA-256 hash of the Google account label combined with the site origin (used only to keep caches for different accounts apart; the plain label is never stored or sent).
- Sold / shared / used for unrelated purposes: no.
- Certify: remote code none; data not transferred to third parties.

## Privacy policy text (host at TODO_PRIVACY_URL)
Collection Tags for NotebookLM runs only on notebook.google.com. It reads notebook IDs, collection names and your Google account label shown on the page. It stores notebook IDs, collection names, timestamps and a setting in your browser's local extension storage; the account label is stored only as a one-way SHA-256 hash combined with the site address, to keep caches for different accounts separate. This data never leaves your device: the extension makes no network requests of its own, has no analytics, and loads no remote code. Uninstalling the extension deletes the stored data. Contact: TODO_SUPPORT_URL.

## Assets still needed (owner)
1280x800 screenshots (take on your own NotebookLM, list and grid view), 440x280 promo tile, support URL.
