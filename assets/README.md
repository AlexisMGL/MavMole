# MavMole visual assets

The source board is preserved in `source/mavmole-brand-board.png`. The transparent mascot in `source/mole-transparent-generated.png` was extracted from that board with the built-in OpenAI image generation tool, using the original board as its identity reference.

Generated project assets are organized by purpose:

- `brand/`: primary lockup and compact horizontal banner;
- `icons/`: square, circular, compact mascot and molehill marks;
- `banners/`: left and right decorative side banners;
- `backgrounds/`: wide tunnel/circuit pattern;
- `mascot/`: transparent standalone mascot;
- `animations/`: eight individual PNG frames for each sequence plus CSS-ready sprite strips.

To deterministically rebuild every crop from the source files on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\extract-assets.ps1
```

Sprite strip dimensions:

| Sequence | Frame | Strip |
| --- | --- | --- |
| Enter hole | 104×73 | 832×73 |
| Emerge | 105×73 | 840×73 |
| Walk | 115×70 | 920×70 |
