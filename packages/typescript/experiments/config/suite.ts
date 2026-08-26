import path from "node:path";
import { fileURLToPath } from "node:url";

const experimentsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SUITE_SNAPSHOT_PATH = path.join(
  experimentsDir,
  "data",
  "suite.json",
);

export const RESULTS_DIR = path.join(experimentsDir, "results");
