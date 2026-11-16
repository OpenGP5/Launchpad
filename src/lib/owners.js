// Firmware ids (four letters) that own settings and files on the pedal, and what to call them.
import { fourcc, idName } from "./gp5store.js";
export const OWNERS = { AMPB: "NAM Loader", DRMC: "Dreamcatcher", TUNR: "Strobe tuner", MODP: "Granular delay (old)" };
export const ownerTitle = (id) => OWNERS[typeof id === "string" ? id : idName(id)] || `Firmware “${typeof id === "string" ? id : idName(id)}”`;
export { fourcc, idName };
