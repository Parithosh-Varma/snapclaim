# Discord Context Saver

A Chrome Extension (Manifest V3) that captures Discord text messages from `discord.com` as they appear and stores them locally as context.

## Files
- `manifest.json` — extension manifest
- `content/content.js` — content script injected into Discord web; observes the DOM and harvests message-like elements
- `background/background.js` — service worker that receives messages and persists them in `chrome.storage.local`
- `popup/popup.html` + `popup/popup.js` — popup UI showing saved messages

## How it works
1. Load the extension in Chrome (Developer mode → Load unpacked → select this folder).
2. Open Discord in the browser (`https://discord.com/*`).
3. The content script watches for new message-like DOM nodes, extracts text + timestamp + channel, and sends them to the background service worker.
4. The service worker deduplicates and caps storage at ~500 messages, saving to `chrome.storage.local`.
5. Click the extension icon to open the popup and review everything saved.

## Install
1. `chrome://extensions/`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension to your toolbar.

## Privacy
All data stays in your browser's local storage. Nothing is sent to any server.
