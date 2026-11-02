---
'@curl.md/opencode': minor
---

Add OpenCode v2 support while keeping OpenCode v1 working.

The package now exports one entrypoint per part that both runtimes understand:

- v2 calls `setup()` on the server and TUI parts.
- v1 (1.18.29+) calls `server()` and `tui()`.

Both runtimes share the same fetch implementation, so tools and slash commands behave identically.
