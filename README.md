# Mika 3D Wave

Standalone Mika VRM viewer with the same model and wave animation used by the app.

## Run

On Windows, double-click:

```bat
start-mika.bat
```

Or run from this folder:

```bat
python -m http.server 8090 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8090/index.html
```

Do not open `index.html` directly with `file://`; browsers block local 3D asset loading.

## Folder Contents

- `index.html`: the standalone page.
- `app.bundle.js`: bundled Three.js, VRM loader, and animation code.
- `vrm-models/8590256991748008892.vrm`: Mika model copied from the app.
- `animations/vrma_02.vrma`: wave animation copied from the app.
- `animations/Goodbye.vrma` and `animations/Relax.vrma`: fallback animations.
- `backgrounds/study-room-sunlit.png`: room background copied from the app.
- `start-mika.bat`: one-click local server launcher for Windows.

