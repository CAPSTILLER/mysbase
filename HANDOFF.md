# Avatar Prep — handoff for Axle (branch `avatar-prep`, NOT pushed)

Apply: `git am avatar-prep.patch` (or `git apply`) on main @ d1b12de. Adds deps `@gltf-transform/{core,functions,extensions}@4`, `meshoptimizer`.

## What it does
- `src/prep.js` (new, lazy-loaded chunk ~110 KB gz, only when someone taps Prep):
  `prepGLB(buf, opts)` → seal seams (averages JOINTS/WEIGHTS across co-located split vertices — this is the real cause of the cracks), dedup+weld, meshopt simplify (lockBorder, default ½), materials doubleSided, textures resized to 2K/1K + WebP via canvas (`canvasEncode`, falls back to JPEG/PNG), uniform rescale only if height is <0.5 m or >3 m (→1.8 m) + feet on floor/centered via wrapper node `AvatarPrepRoot`, prune. Throws if clip or skin count changes.
- `src/cloud.js`: `pick(f, skipPrep)` — single-file GLB that is >15 MB or rigged-with-clips gets an "Avatar Prep suggested" form (texture 2K/1K, triangles keep/½/⅓, seal cracks, fix scale). Shows before/after size/tris/texture/emote count; "Use prepped → upload" re-enters the normal pick flow with the new file (rig fast path keeps bytes); "Download prepped (.zip)" (stored zip via fflate). "Skip" = old path unchanged. Zip uploads (`pickZip/ingest`) untouched.

## Tests (Node, same pipeline + sharp WebP; browser run verified too: panda 2K → 8.5 MB, 14 clips, 2.8 s in headless Chromium)
| file | size | tris | tex | clips |
|---|---|---|---|---|
| panda_rigged_2k (B_rigged_2k) | 14.7 → 8.5 MB | 301,508 → 150,754 | 2048 | 14 → 14 |
| panda_rigged (B_rigged) | 61.3 → 8.5 MB | same | 8192 → 2048 | 14 → 14 |
| alien_rigged_2k | 9.1 → 4.6 MB | 192,226 → 96,112 | 2048 | 14 → 14 |
| alien_rigged (A_rigged) | 30.4 → 4.6 MB | same | 8192 → 2048 | 14 → 14 |
| panda 1K option | 14.7 → 7.6 MB | 150,754 | 1024 | 14 |
Joints 36 kept. Seams: 0 open edges before/after (mesh is closed); ~2,500 positions per model had split copies with different skin weights → after prep 1. Still: `panda_before_after.png` (Cheer_with_Both_Hands @50%, magenta bg): belly/crotch cracks visible left, gone right.

## Caveats
- Weld alone barely helps (copies differ in UV/normal so they can't merge); the seam-weight unify is what closes cracks.
- No KTX2/meshopt compression (would need decoders wired into every GLTFLoader); WebP needs iOS 14+/Safari 14+.
- Big GLBs: phones decode the full file in memory; 60 MB+ may be slow on old phones. Not tested on a real phone.
- Simplify is geometric only; check faces/fingers at ⅓.
