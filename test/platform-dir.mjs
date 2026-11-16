// Where the OpenGP5 platform's C sources are: the opengp5/ submodule (the public Launchpad repository), or this
// app's place inside the OpenGP5 tree. The tests compile the platform's own store and file code against Launchpad's.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const sub = fileURLToPath(new URL("../opengp5/platform/nds32", import.meta.url));
export const PLATFORM_NDS32 = existsSync(sub) ? sub : fileURLToPath(new URL("../../../platform/nds32", import.meta.url));
