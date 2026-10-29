# IR Remote PoC

A minimal universal remote over a Broadlink WiFi/IR bridge. Discovers the
bridge, learns IR codes from your real remote, stores them, and replays them.

**Use only on equipment you own or are authorized to control.**

## Setup

1. Plug in a Broadlink RM-series bridge and pair it to your WiFi with the
   Broadlink app (one-time, puts it on your LAN). Then close the app.
2. Install the dependency:

   ```
   pip install broadlink
   ```

## Use

```
# 1. Confirm the bridge is reachable
python ir_remote.py discover

# 2. Learn codes from your real remote (one button per prompt)
python ir_remote.py learn livingroom power
python ir_remote.py learn livingroom 0 1 2 3 4 5 6 7 8 9 enter ch_up ch_down

# 3. Replay
python ir_remote.py send livingroom power
python ir_remote.py channel livingroom 205   # sends 2, 0, 5, then enter

# See what's stored
python ir_remote.py list
```

Codes are saved as hex in `codes.json` next to the script. Re-learning a
button overwrites it. Pass `--host <ip>` before the subcommand to skip
discovery and talk to a specific bridge.

## Notes / limits

- **Line of sight.** Place the bridge where it can see the equipment's IR
  receiver. IR does not go through walls.
- **Channel entry** is a macro of digit presses with a short inter-key
  delay, then `enter`. Tune `DIGIT_DELAY` in the script if your box drops
  digits. If your box commits on timeout rather than an OK press, just don't
  learn an `enter` button.
- **Learning is finicky.** Hold the remote close to the bridge and press
  firmly once after hitting Enter. If capture times out, the button is
  skipped and you can retry it.
- This is the transmit-layer proof of concept from the architecture sketch.
  The next step is to wrap `send`/`channel` behind the `Transmitter`
  interface so the app can also target smart-TV network APIs.
