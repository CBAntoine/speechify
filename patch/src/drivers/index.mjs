// Driver registry. Order matters: the first driver that recognises a host owns it, and the generic
// driver at the end catches everything else.
import router from "./router.mjs";
import hue from "./hue.mjs";
import roku from "./roku.mjs";
import samsung from "./samsung.mjs";
import lgwebos from "./lgwebos.mjs";
import androidtv from "./androidtv.mjs";
import sonos from "./sonos.mjs";
import cast from "./cast.mjs";
import shelly from "./shelly.mjs";
import wled from "./wled.mjs";
import elgato from "./elgato.mjs";
import kasa from "./kasa.mjs";
import lifx from "./lifx.mjs";
import yeelight from "./yeelight.mjs";
import printer from "./printer.mjs";
import homeassistant from "./homeassistant.mjs";
import upnp from "./upnp-media.mjs";
import generic from "./generic.mjs";
import self from "./self.mjs";

export const DRIVERS = [router, hue, roku, samsung, lgwebos, androidtv, sonos, cast, shelly, wled, elgato, kasa, lifx, yeelight, printer, homeassistant, upnp, generic];
// "self" (the computer running Patch) isn't discovered on the network, but it takes actions too.
export const driverById = Object.fromEntries([...DRIVERS, self].map((d) => [d.id, d]));
