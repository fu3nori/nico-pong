# AGENTS.md

## Project overview

This repository is a Chrome extension project named nico-pong / NicoPitaCore.

The extension supports NicoNico Live / NicoNama workflows:
- detect viewer comments
- extract video IDs from comments
- resolve video metadata
- enqueue videos into the Request tab
- play requested videos manually or automatically
- display now-playing comments using templates

## Current critical issue

Viewer comments containing video IDs are not being added to the Request tab.

The suspected problem is not only video ID parsing.
The extension may not be receiving NicoNico Live comments at all.

A previous implementation attempted to read:

- `#embedded-data`
- `data.site.relive.webSocketUrl`

However, this may return an empty string on current NicoNico Live pages.

Do not only patch this path blindly.
Investigate and align the comment retrieval implementation with nicolivehelperxx-style behavior.

Reference:
- https://github.com/amanorox/nicolivehelperxx
- https://qiita.com/DaisukeDaisuke/items/3938f245caec1e99d51e

## Required debugging approach

Implement production-screen debug visibility that distinguishes:

1. embedded-data detection
2. WebSocket URL candidate discovery
3. watch WebSocket connection
4. startWatching send
5. seat / keepSeat handling
6. ping / pong handling
7. messageServer event reception
8. messageServer.data.viewUri acquisition
9. message server / segment server connection
10. protobuf decode
11. raw comment reception
12. video ID extraction
13. request tab enqueue

## Architecture preference

Prefer this separation:

- content script:
    - read page information
    - inject or update debug UI
    - communicate with side panel/background

- background service worker:
    - perform WebSocket / streaming / protobuf handling where possible
    - normalize comment events

- side panel:
    - show request queue
    - show debug state
    - show last received comment and parse result

## Review guidelines

When reviewing agent changes, check:

- whether comments are actually received before video ID extraction
- whether failure states are visible on the production screen
- whether the implementation avoids relying on a single brittle DOM path
- whether background/content/sidepanel responsibilities are cleanly separated
- whether debug logs can be disabled later
- whether existing auto-play and manual forced-play behavior is not broken