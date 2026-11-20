// Shared pieces for device drivers: the action vocabulary, risk rules, errors, and value parsing.

/** Every action a device can offer. The voice agent's control_device tool uses these exact names. */
export const ACTIONS = {
  turn_on: { label: "Turn on" },
  turn_off: { label: "Turn off" },
  toggle: { label: "Toggle" },
  set_brightness: { label: "Brightness", value: "percent" },
  set_color: { label: "Colour", value: "color" },
  set_color_temperature: { label: "White tone", value: "kelvin" },
  set_effect: { label: "Effect", value: "choice" },
  set_preset: { label: "Preset", value: "choice" },
  set_scene: { label: "Scene", value: "choice" },
  set_volume: { label: "Volume", value: "percent" },
  volume_up: { label: "Volume up" },
  volume_down: { label: "Volume down" },
  mute: { label: "Mute" },
  unmute: { label: "Unmute" },
  play: { label: "Play" },
  pause: { label: "Pause" },
  stop: { label: "Stop" },
  next: { label: "Next" },
  previous: { label: "Previous" },
  launch_app: { label: "Open app", value: "choice" },
  press_button: { label: "Remote button", value: "choice" },
  search: { label: "Search", value: "text" },
  switch_input: { label: "Input", value: "choice" },
  set_temperature: { label: "Set temperature", value: "number" },
  set_mode: { label: "Mode", value: "choice" },
  set_position: { label: "Position", value: "percent" },
  open: { label: "Open" },
  close: { label: "Close" },
  lock: { label: "Lock" },
  unlock: { label: "Unlock" },
  start: { label: "Start" },
  dock: { label: "Send to dock" },
  activate: { label: "Run" },
  identify: { label: "Blink / identify" },
  reboot: { label: "Restart" },
  update_firmware: { label: "Install update" },
  enable_auto_updates: { label: "Turn on automatic updates" },
  set_led: { label: "Status light", value: "onoff" },
  wake: { label: "Wake up (Wake-on-LAN)" },
  rename: { label: "Rename", value: "text" },
  set_room: { label: "Set room", value: "text" },
  pair: { label: "Connect / pair" },
  remove_port_forward: { label: "Close a port forward", value: "choice" },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

// Things with something plugged into them: switching off could cut power to anything (a freezer,
// a computer, an aquarium pump). Wired relays ("switch") are nearly always lights or fans, so they're exempt.
const POWER_KINDS = new Set(["plug", "strip"]);

/**
 * Returns a sentence explaining the risk when an action needs the person's explicit "yes" first,
 * or null when it's safe to just do.
 */
export function riskOf(device, action, value) {
  switch (action) {
    case "reboot":
      return `Restarting ${device.name} takes it offline for a minute or two.`;
    case "update_firmware":
      return `Installing an update restarts ${device.name}, and it can be offline for several minutes while it installs.`;
    case "remove_port_forward":
      return `Closing that port forward will stop whatever app opened it from being reachable from the internet.`;
    case "unlock":
      return `This unlocks ${device.name}.`;
    case "open":
    case "close":
      return device.kind === "garage" ? `This moves the garage door.` : null;
    case "toggle":
      if (device.state?.on === false) return null; // toggling an off plug just turns it on
    // falls through
    case "turn_off":
      return POWER_KINDS.has(device.kind) ? `${device.name} is a smart ${device.kind === "strip" ? "power strip" : "plug"}, so turning it off cuts power to whatever is plugged into it.` : null;
    case "set_mode":
      return device.kind === "thermostat" && /off/i.test(String(value)) ? `This turns the heating/cooling off.` : null;
    default:
      return null;
  }
}

export class DeviceError extends Error {
  constructor(message, { code = "EDEVICE", hint } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export const done = (message, extra = {}) => ({ ok: true, message, ...extra });

export function unsupported(device, action) {
  return new DeviceError(`${device.name} can't ${ACTIONS[action]?.label?.toLowerCase() || action.replace(/_/g, " ")}.`, { code: "EUNSUPPORTED" });
}

export function need(value, what) {
  if (value == null || String(value).trim() === "") throw new DeviceError(`Which ${what}?`, { code: "EVALUE" });
  return value;
}

/** Turns low-level network errors into something worth saying out loud. */
export function explainError(err, name = "The device") {
  if (err instanceof DeviceError) return err;
  const code = err?.code;
  if (code === "EAUTH" || err?.status === 401)
    return new DeviceError(`${name} wants a password before it will take commands.`, { code: "EAUTH", hint: "Add the device's password on its card in Patch." });
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EHOSTDOWN")
    return new DeviceError(`${name} didn't answer. It may be switched off, asleep, or off the WiFi.`, { code: "EOFFLINE" });
  if (code === "ECONNREFUSED" || code === "ECONNRESET")
    return new DeviceError(`${name} refused the connection. Its control feature may be turned off in its own app.`, { code: "EREFUSED" });
  return new DeviceError(`${name} returned an error: ${err?.message || err}`, { code: code || "EDEVICE" });
}

/** On/off words → boolean, or null. */
export function parseOnOff(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^(on|true|yes|1|enable|enabled|show)$/.test(s)) return true;
  if (/^(off|false|no|0|disable|disabled|hide)$/.test(s)) return false;
  return null;
}

export const truthy = (v) => v === true || v === 1 || v === "1" || v === "true" || v === "on";
