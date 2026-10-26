# Coastline Run

A three-lane endless runner along a Mediterranean cliff coast, written with plain JavaScript and [three.js](https://threejs.org) (vendored in `lib/`, no build step).

## Play

Serve the folder over HTTP (ES modules need it) and open it on a phone or desktop:

```
cd coastline-run
python3 -m http.server 8000      # then open http://localhost:8000
```

| Action | Touch | Keyboard |
|---|---|---|
| Change lane | swipe left / right | ← → or A D |
| Jump | swipe up or tap | ↑ W Space |
| Slide | swipe down | ↓ S |
| Zipline (demo) | – | Z |
| Pause | pause button | Esc |

Add `?region=sunset` to the URL for the Sunset Harbor look.

## What is in it

- Endless chunked world: village terraces with tiled roofs, plastered walls, quoins, shutters, flower boxes and ivy; bunting; stone gates; organic cliffs; islets, boats and a distant headland village
- **Rigged, animated characters** (glTF + `AnimationMixer`): Rusty the fox and Bolt the robot, with run / jump / slide / zipline / crash poses. Add your own by dropping a `.glb` into `assets/models/` and adding an entry to `CHARACTERS` in `game.js`
- Shell coins, magnet and shield power-ups, crates, barrels, hurdles, slide-under beams, a zipline section
- Menus: title, characters, missions, high score, pause

## Rendering

- MSAA through the post-processing chain, ACES tone mapping, bloom, colour grading with vignette and film grain
- Image-based lighting baked from the procedural sky (PMREM), sun shadows, baked vertex AO
- Procedural material shader (stucco, roof tiles, ashlar stone, painted wood, stratified rock, foliage, glass) with per-pixel bump lighting
- Analytic-wave water shader: depth gradient, fresnel sky reflection, sun glints, caustics, fog
- Volumetric-style procedural clouds in the sky shader
- Performance: merged vertex-coloured meshes, instanced coins, far scenery outside the shadow pass, one chunk built per frame, dynamic resolution, and an automatic drop to a low tier (no MSAA/bloom) on slow devices. Force it with `?q=low`

`screenshots/` holds frames captured from the running game (`contact-sheet.png` shows them together, `before-after.png` compares with the first prototype).

## Not done yet

Sound, a human hero character (the sandbox could not download one; drop a `.glb` in and wire it up), more regions, shop and upgrade logic, saving of missions and coins, app-store packaging.

See `assets/CREDITS.md` for model licences (the fox needs CC-BY attribution).
