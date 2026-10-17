# Zorrilho — app (Tauri + React)

Frontend + shell live in `app/`. The project root docs are authoritative — see [`../README.md`](../README.md) (EN) · [`../README.pt-BR.md`](../README.pt-BR.md) · [`../README.es.md`](../README.es.md).

## Dev

```bash
npm ci
npm run build        # tsc -b + vite build
npx tauri dev        # Vite on 5173 proxies /api → localhost:8765
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run lint` | `oxlint` |
| `npm run preview` | `vite preview` |
| `npx tauri dev` | Tauri shell + Vite (auto-spawns sidecar) |
| `npx tsc -b --noEmit` | Typecheck only |

## Structure

- `src/` — React (components: `ClonarTab`, `EstudioTab`, `ProjetosTab`, `ConfiguracoesTab`; `lib/store.ts`, `lib/sidecar.ts`)
- `src-tauri/` — Rust ( `lib.rs`, `sidecar.rs`, `audio/mod.rs` ), Tauri config, `examples/test_audio.rs`
- `vite.config.ts` — dev proxy for `/api`, `/health`, `/ws` → `127.0.0.1:8765`
- `public/` + `src/assets/` — `zorrilho.svg`, icons, favicon

## Notes

- The sidecar is **not** bundled; `vite dev` proxies to it, Tauri prod hits `http://localhost:8765` directly.
- Rust toolchain: `1.90` (see `src-tauri/Cargo.toml` `rust-version`).
- License: Apache-2.0 (see root `LICENSE`).
