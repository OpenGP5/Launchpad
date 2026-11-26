// Valeton's language command on a GP-5 running its stock V1.0.6 firmware.
// It changes the pedal's language setting over USB-MIDI; no firmware image is patched or flashed.
// Protocol: 12 32 reads the Device ID, 12 10 reads global settings, 11 33 sends an encrypted
// Device ID + language code (0001 English, 0002 Chinese, 0003 both). Derived from Valeton Suite 2.1.0;
// the working command is documented at https://github.com/flameshikari/valeton-unlocker.
import { command, NoAnswer, readGlobals, request, StockError, V106 } from "./stockpresets.js";

const CODES = { en: "0001", zh: "0002", both: "0003" };
const FIRMWARE = 0x0101, LANGUAGE = 0x0201;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rol2 = (b) => ((b << 2) | (b >> 6)) & 0xFF;
const ror2 = (b) => ((b >> 2) | (b << 6)) & 0xFF;

export function decodeDeviceId(reply) {
  if (reply.length < 5 || reply[0] !== 0x12 || reply[1] !== 0x32) throw new StockError("The Device ID reply is invalid.");
  const length = reply[2] | (reply[3] << 8), blob = reply.subarray(4, 4 + length);
  // The stock protocol decoder uses the declared length to ignore any bytes after the blob.
  // A reply can still be usable when its declared length is larger than the delivered data:
  // the validated Device ID below tells us whether the complete encrypted ID was present.
  if (!blob.length || !blob[0] || blob[0] + 1 >= blob.length) throw new StockError("The Device ID reply is incomplete.");
  const key = blob.subarray(1, 1 + blob[0]), encrypted = blob.subarray(1 + blob[0]);
  const id = String.fromCharCode(...encrypted.map((b, i) => rol2(b) ^ key[i % key.length]));
  if (!/^[0-9a-f]{16}$/.test(id)) throw new StockError("The pedal returned an unexpected Device ID.");
  return id;
}

export function languagePayload(deviceId, mode) {
  const code = CODES[mode];
  if (!code || !/^[0-9a-f]{16}$/.test(deviceId)) throw new StockError("Invalid language or Device ID.");
  const key = Uint8Array.from(deviceId, (ch) => ch.charCodeAt(0));
  const plain = Uint8Array.from(deviceId + code, (ch) => ch.charCodeAt(0));
  const blob = Uint8Array.from([key.length, ...key, ...plain.map((b, i) => ror2(b ^ key[i % key.length]))]);
  return Uint8Array.from([0x11, 0x33, blob.length, 0, 0, 0, ...blob]);
}

async function readState(link) {
  const globals = await readGlobals(link, 6000);
  const language = globals.get(LANGUAGE);
  if (globals.get(FIRMWARE) !== V106 || !(typeof language === "number" || language instanceof Uint8Array && language.length > 0)) {
    throw new StockError("Language changes are only supported on a GP-5 running Valeton's firmware V1.0.6.");
  }
  // A four-byte TLV is decoded as a number by readGlobals; shorter TLVs retain their raw bytes.
  return (typeof language === "number" ? language : language[0]) === 1 ? "zh" : "en";
}

export async function setLanguage(link, mode) {
  if (!CODES[mode]) throw new StockError("Choose English, Chinese, or both languages.");
  const before = await readState(link);
  const deviceId = decodeDeviceId(await request(link, [0x12, 0x32], 3000));
  if (!await command(link, languagePayload(deviceId, mode), 6000)) throw new StockError("The pedal rejected the language command.");
  // The global setting reports the selected display language, not which languages are unlocked.
  // For "both" an ACK is all the protocol can confirm. Single-language changes can be read back.
  if (mode === "both") {
    await delay(1000);
    try { return { before, after: await readState(link) }; }
    catch (error) { if (error instanceof NoAnswer) return { before, after: null }; throw error; }
  }
  let after = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    await delay(1000);
    try { after = await readState(link); }
    catch (error) { if (error instanceof NoAnswer) continue; throw error; }
    if (after === mode) return { before, after };
  }
  if (after === null) throw new NoAnswer("The pedal accepted the command but did not answer the language readback.");
  throw new StockError("The pedal accepted the command but still reports the previous display language.");
}
