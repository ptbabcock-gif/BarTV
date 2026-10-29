#!/usr/bin/env python3
"""
ir_remote.py — proof-of-concept universal remote over a Broadlink WiFi/IR bridge.

Use only on TVs/equipment you own or are authorized to control.

Workflow:
    1. python ir_remote.py discover
    2. python ir_remote.py learn livingroom power
    3. python ir_remote.py learn livingroom 0 1 2 3 4 5 6 7 8 9 enter ch_up ch_down
    4. python ir_remote.py send livingroom power
    5. python ir_remote.py channel livingroom 205

Codes are stored as hex in codes.json next to this script, keyed by
device name -> button name. Re-learning a button overwrites it.

Requires: pip install broadlink
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

try:
    import broadlink
    from broadlink.exceptions import ReadError, StorageError
except ImportError:
    sys.exit("Missing dependency. Run: pip install broadlink")

CODES_PATH = Path(__file__).with_name("codes.json")
DISCOVER_TIMEOUT = 5          # seconds to wait for bridges to answer
LEARN_TIMEOUT = 20           # seconds to wait for a button press
DIGIT_DELAY = 0.4            # seconds between digits in a channel macro


# --------------------------------------------------------------------------- #
# Code store
# --------------------------------------------------------------------------- #
def load_codes() -> dict:
    if CODES_PATH.exists():
        return json.loads(CODES_PATH.read_text())
    return {}


def save_codes(codes: dict) -> None:
    CODES_PATH.write_text(json.dumps(codes, indent=2, sort_keys=True))


# --------------------------------------------------------------------------- #
# Bridge connection
# --------------------------------------------------------------------------- #
def connect(host: str | None = None):
    """Find and authenticate one Broadlink bridge.

    If host is given, talk to that device directly; otherwise discover on the
    LAN and use the first device found.
    """
    if host:
        dev = broadlink.hello(host)
    else:
        devices = broadlink.discover(timeout=DISCOVER_TIMEOUT)
        if not devices:
            sys.exit("No Broadlink bridge found on the network. "
                     "Check it is powered, on the same subnet, and paired.")
        dev = devices[0]
    dev.auth()
    return dev


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_discover(_args) -> None:
    devices = broadlink.discover(timeout=DISCOVER_TIMEOUT)
    if not devices:
        print("No devices found.")
        return
    print(f"Found {len(devices)} device(s):")
    for d in devices:
        host = d.host[0] if isinstance(d.host, tuple) else d.host
        mac = ":".join(f"{b:02x}" for b in reversed(d.mac))
        print(f"  {d.type:<12} host={host:<15} mac={mac}")


def cmd_learn(args) -> None:
    dev = connect(args.host)
    codes = load_codes()
    device_codes = codes.setdefault(args.device, {})

    for button in args.buttons:
        input(f"Point the remote at the bridge, then press [Enter] and "
              f"immediately press the '{button}' button... ")
        dev.enter_learning()
        packet = _wait_for_code(dev)
        if packet is None:
            print(f"  ! timed out waiting for '{button}', skipped")
            continue
        device_codes[button] = packet.hex()
        print(f"  learned '{button}' ({len(packet)} bytes)")
        save_codes(codes)   # persist after each button so partial runs survive

    print(f"Saved to {CODES_PATH}")


def _wait_for_code(dev, timeout: int = LEARN_TIMEOUT) -> bytes | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.4)
        try:
            return dev.check_data()
        except (ReadError, StorageError):
            continue   # nothing captured yet
    return None


def cmd_send(args) -> None:
    dev = connect(args.host)
    codes = load_codes()
    _send_button(dev, codes, args.device, args.button)


def cmd_channel(args) -> None:
    dev = connect(args.host)
    codes = load_codes()
    for digit in str(args.number):
        _send_button(dev, codes, args.device, digit)
        time.sleep(DIGIT_DELAY)
    # Send enter/ok if it was learned; many TVs need it, some commit on timeout.
    if "enter" in codes.get(args.device, {}):
        _send_button(dev, codes, args.device, "enter")


def _send_button(dev, codes: dict, device: str, button: str) -> None:
    try:
        packet_hex = codes[device][button]
    except KeyError:
        sys.exit(f"No code for device '{device}' button '{button}'. "
                 f"Learn it first.")
    dev.send_data(bytes.fromhex(packet_hex))
    print(f"sent {device}/{button}")


def cmd_list(_args) -> None:
    codes = load_codes()
    if not codes:
        print("No codes learned yet.")
        return
    for device, buttons in sorted(codes.items()):
        print(f"{device}:")
        for button in sorted(buttons):
            print(f"  {button}")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", help="bridge IP address (skip discovery)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("discover", help="find bridges on the LAN").set_defaults(func=cmd_discover)

    p_learn = sub.add_parser("learn", help="capture codes from a real remote")
    p_learn.add_argument("device", help="device name, e.g. livingroom")
    p_learn.add_argument("buttons", nargs="+", help="button names to learn")
    p_learn.set_defaults(func=cmd_learn)

    p_send = sub.add_parser("send", help="replay one learned code")
    p_send.add_argument("device")
    p_send.add_argument("button")
    p_send.set_defaults(func=cmd_send)

    p_chan = sub.add_parser("channel", help="send a channel number as digits")
    p_chan.add_argument("device")
    p_chan.add_argument("number", help="e.g. 205")
    p_chan.set_defaults(func=cmd_channel)

    sub.add_parser("list", help="show learned devices and buttons").set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
