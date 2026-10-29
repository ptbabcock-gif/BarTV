# BarTV

Universal TV remote — control TVs and AV equipment you own or are authorized to
operate, over IR (via a WiFi/IR bridge or a phone IR blaster) and, where
available, smart-TV network APIs.

## Status

Early. The first working piece is a proof-of-concept transmit layer.

- `ir-remote-poc/` — a self-contained Python CLI that discovers a Broadlink
  WiFi/IR bridge, learns IR codes from a physical remote, replays them, and
  sends a channel number as a digit macro. See `ir-remote-poc/README.md`.

## Planned

- A `Transmitter` abstraction with interchangeable backends: WiFi/IR bridge,
  phone IR blaster, and smart-TV network control (Roku ECP, Samsung/LG
  WebSocket, Android TV / HDMI-CEC).
- A code database (IRDB/LIRC-derived) plus a learning fallback.
- A cross-platform app UI over that abstraction.

## History

This repository previously hosted "The Cheers," an espresso-martini rating PWA.
That app has been retired; its full source remains in the git history prior to
this change and can be recovered from there if needed.
