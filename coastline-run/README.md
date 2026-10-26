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

- Endless chunked world: village terraces, bunting, stone gates, cliffs, sea stacks, boats, a distant headland village
- Shell coins, magnet and shield power-ups, crates, barrels, hurdles, slide-under beams, a zipline section
- Luna, an animated low-poly runner with a cartoon outline (run, jump, slide, zipline, crash, idle poses)
- Menus: title, characters, missions, high score, pause
- Performance: merged vertex-coloured meshes, instanced coins, far scenery outside the shadow pass, one chunk built per frame, dynamic resolution

`screenshots/` holds frames captured from the running game (`contact-sheet.png` shows them together).

## Not done yet

Sound, real character animations from an asset pack, more regions, shop and upgrades logic, saving of missions and coins, app-store packaging.
