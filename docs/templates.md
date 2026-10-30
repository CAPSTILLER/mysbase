# Mysbase room templates

A **template** is a room layout JSON that refers to assets by **name** (and optionally folder), not by upload id.
It lists **slots**: named holes that are filled by any asset in My assets with the same name.
Load a template, upload a zip of files named like the slots, and the room builds itself.

Examples in this repo:
- `public/rooms/example-template.json`: generic room with 7 slots. Load it with `?room=example-template`.
- `public/rooms/never-happier.json`: Never Happier converted to names. Load it with `?room=never-happier`.

## Quick start (for people and AIs)

1. Open Mysbase, then go to **Dev → Templates · slots · share → Load template…** and pick one. You can also use `?room=<slug>`.
2. Click **List slots · copy spec**. This copies a plain-text spec of every slot: file name, size in metres, pixel size, whether it must tile, and transparency. Give the spec to an image or 3D generator.
3. Name each file exactly like its slot (`wall_pad.png`, `door.glb`, …) and zip them.
4. Go to **My assets → Upload zip…**. Every file whose name matches a slot fills it straight away. Placeholders (orange wireframe; lilac for surfaces) turn into the real asset.
5. Click **Get share code** to get a 6-letter code. Anyone with the app can open `?room=<code>`. Admins can also click **Save as starter room**.

## File format

A template is a normal Mysbase layout (`version: 2`) with these extra top-level keys:

```jsonc
{
  "version": 2,
  "kind": "template",
  "name": "Example room (slots)",
  "folder": "example",            // preferred My-assets folder when several assets share a name (optional)
  "slots": [ /* see below */ ],
  "room": { "w": 5, "d": 6, "h": 3, "wallT": 0.12, "door": { "w": 0.9, "h": 2.1, "x": 1.2 } },
  "ambience": { ... },             // optional, same as exported layouts
  "surfaces": {
    "walls":   [ { "asset": "core-layer:plaster", "offsetM": 0, "color": "#f4f2ec" }, { "asset": "slot:wall_pad", "offsetM": 0.005 } ],
    "floor":   [ { "asset": "core-layer:plaster", "offsetM": 0 }, { "asset": "slot:floor_pad", "offsetM": 0.005 } ],
    "ceiling": [ { "asset": "core-layer:plaster", "offsetM": 0 } ],
    "overrides": { "north": [ ... ] }   // optional per-wall layers
  },
  "lights": [ ... ],                // optional, same as exported layouts
  "items": [
    { "id": 1, "slot": "cage_light", "pos": [0, 2.65, 0], "rotY": 0, "mount": "ceiling" },
    { "id": 2, "slot": "door", "pos": [1.2, 0, 2.94], "rotY": 180, "wall": true, "face": "south" },
    { "id": 3, "slot": "bench", "pos": [-1.3, 0, -2.7], "rotY": 0 },
    { "id": 4, "slot": "poster_1", "pos": [-1.2, 1.0, -2.94], "rotY": 0, "wall": true, "face": "north" },
    { "id": 5, "slot": "decal_1", "pos": [2.44, 1.2, 0.5], "rotY": -90, "wall": true, "face": "east" }
  ]
}
```

### Slots

| key | meaning |
|---|---|
| `name` | Required. Letters, digits, `_ . -` (max 60). The asset with this name fills the slot; matching ignores case and extension. |
| `type` | `image` or `model` (GLB). |
| `sizeM` | `[w, h]` or `[w, h, d]` in metres. For tileable surfaces this is the size of **one tile**. |
| `tileable` | Surfaces only. `true` repeats the image every `sizeM`; `false` stretches it once over the whole face. |
| `target` | `wall`, `floor` or `ceiling` (surface layer) · `wall-mount` · `decal` · `ceiling-mount` · `placed model`. |
| `folder` | Optional. Prefer the asset in this folder (overrides the template `folder`). |
| `file` | Optional. Match this asset name instead of `name`. |
| `category` | Optional. Override the asset category (`prop`, `table-top`, `free`, …). |
| `alpha` | Optional. Force transparency for an image (`.png` and `.webp` decals and cutouts are transparent anyway). |
| `prompt`, `note` | Optional text copied into the slot spec (style hints for the generator). |

What fills a slot:
- **Surface (`wall` / `floor` / `ceiling`) + image**: the image is used as a texture layer. It tiles at `sizeM` when `tileable`, otherwise it is stretched once across the face.
- **Surface + model**: the model is tiled as 3D panels (like `nh_pad_wall`). Its own size sets the spacing.
- **`wall-mount` + image**: a thin board (poster or painting) `sizeM` big, hung flat on the wall. A PNG with alpha becomes a cutout instead.
- **`decal` + image**: a transparent sticker flush on the wall, 2 mm deep.
- **`placed model` / `ceiling-mount` / `wall-mount` + GLB**: the model at its real size. It snaps to the floor, ceiling or wall.
- **Model slot + image**: a flat standing cutout (alpha) at `sizeM`. Swap in a GLB with the same name later and it upgrades automatically.
- **Nothing uploaded yet**: a placeholder of `sizeM` (orange wireframe; flat lilac for surfaces). It keeps its spot and is re-resolved whenever assets arrive (upload, zip, sign in).

### Items

The fields are the same as in an exported layout (`pos`, `rotY`, `scale`, `wall`, `face`, `mount`, `parent`, `preset`). There are three ways to say what an item is:
- `"slot": "door"`: a slot from `slots`.
- `"asset": { "name": "nh_bench", "folder": "never_happier" }`: by name, without declaring a slot. An implicit slot is created.
- `"typeId": "core:bed"` or `"asset:<uuid>"`: built-ins, or the old upload-id references, which still work.

A surface layer can also use `"asset": { "name": "...", "folder": "..." }` instead of `"slot:..."`.

Coordinates are in metres with the room centre at x=0, z=0 and the floor at y=0. North wall is z=-d/2, south is z=+d/2 (it has the door), west is x=-w/2, east is x=+w/2.
Wall items need `"wall": true` and a `face`. They are re-seated flush on the outermost wall layer, so `pos` along the wall normal can be rough.
For ceiling items use `"mount": "ceiling"`. Floor items settle on the floor automatically.

## Sharing

- **Get share code**: saves the current room or template and returns a 6-letter code (letters a–z without i, l, o, plus digits 2–9). Open it at `?room=<code>` or type it in the Code box. Loading needs no wallet. The assets stay private, so visitors without access see placeholders.
- **Save as starter room** (admin wallets in `BACKUP_ADMINS` only): publishes the room at `?room=<slug>` and adds it to everyone's room dropdown, marked ★. You are then asked whether to make the assets the room uses **public**. Public assets load for anyone. Everything else stays private (the default).
- **Load template…** lists built-ins, server starter rooms, your share codes and your server-saved rooms.

## API (My Wally, `/api/rocks/<route>`, POST JSON)

| route | auth | body → result |
|---|---|---|
| `mysbase-share` | session | `{layout, name, kind?, assetIds?}` → `{code}` |
| `mysbase-shared` | none | `{id}` (code or slug) → `{id, name, kind, starter, layout, assets: [public metas]}` |
| `mysbase-starters` | none | → `{starters: [{slug, name, savedAt}]}` |
| `mysbase-shared-list` | session | → `{shared: [your codes + starters], admin}` |
| `mysbase-starter-save` | admin + fresh sig | `{slug, name, layout, assetIds, sig}` → `{slug, updated, assets}`; every asset the room uses becomes public (ref-counted, no copies) |
| `mysbase-starter-hide` | admin + fresh sig | `{slug, hidden, sig}`: make private / public again |
| `mysbase-starter-delete` | admin + fresh sig | `{slug, sig}`: assets go private unless another public room uses them |
| `mysbase-starter-admin` | admin | → `{starters: [{slug, name, hidden}]}` |
| `mysbase-public` | admin | `{ids: [...], public: true/false}` → `{updated}` |
| `mysbase-public-url` | none | `{id, file}` → `{url, proxy}` (public assets only) |
| `mysbase-me` | session | → `{address, admin}` |

The client wrappers live in `src/cloud.js` and do not touch the DOM: `shareLayout`, `saveStarterRoom`, `setAssetsPublic`, `loadShared`, `starterList`, `sharedList`, `whoAmI`. Slot helpers live in `src/slots.js`: `normSlots`, `slotSpec`, `implicitSlot`.

## 🧰 Room Kit (round 4)

Build a whole room from a pile of files, no JSON, no IDs.

1. Tap **🧰 Room Kit** (or open `?kit`). Connect your wallet first if you want to Save.
2. Type a **room name**, tap **Add files** — images (png/jpg/webp), 3D models (glb/gltf/obj/fbx/stl…) or a kit **.zip**. You can also drag & drop.
3. Each card gets an auto-guessed tag (filename words, image aspect/tileability, model size):
   wall layer · floor layer · ceiling layer · wall-mount · ceiling-mount · prop · decal. Change the tag or name any time.
4. **Auto-layout** previews the room locally (nothing uploaded yet): layers on surfaces, doors in the south doorway,
   wall-mounts spread across walls at eye height, ceiling-mounts evenly spaced (with lights), props backed onto walls
   leaving the middle as a walkway, decals on walls. Close the kit and tweak in the normal editor.
5. **Save** uploads every asset into a folder named after the room (re-uses identical files already there),
   then saves the room to the server by asset name. Then optionally **Get share code** or (admin) **Save as starter room**
   (asks before making those assets public).
6. **Export kit zip** = `assets/*` + `room.json` + `README.md`. **Import kit zip** rebuilds the room; Save uploads only missing assets.

## Round 5
- **Ceiling images**: images tagged ceiling default to a FLAT ceiling surface layer (first free ceiling slot), tiled/stretched over the whole ceiling. Per-item choice "⬜ flat layer" / "🪧 hanging panel" in Room Kit cards; in Dev mode use "🪧 Hang as panel" (layer panel) or "⬜ Lay flat as ceiling layer" (selected item). Saved as `slot.ceiling: 'flat'|'hang'` in room JSON / kit zip.
- **Guest mode**: visitors without a holder session can build, auto-layout, Dev-tweak, preview, Export and Import kit zips entirely in the browser. Server-only controls (`.srvOnly`) are hidden for guests. Holders tap "Sign in to save".
- **TODO(submit-kit)**: `submitKit()` stub in src/roomkit.js, intended for a future `POST /api/rocks/mysbase-kit-submit` plus admin approval.
