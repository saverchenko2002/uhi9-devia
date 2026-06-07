import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_SRC_DIR = dirname(fileURLToPath(import.meta.url));

export const DEMO_ROOT = resolve(SERVER_SRC_DIR, "../..");
export const PROJECT_ROOT = resolve(DEMO_ROOT, "../project");
export const DEPLOYMENTS_FILE = resolve(DEMO_ROOT, "deployments.json");
