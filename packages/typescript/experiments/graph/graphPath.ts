import path from "node:path";
import { fileURLToPath } from "node:url";

const experimentsDir = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

/** Where the learned page graph lives; committed so runs share one view of the app. */
export const GRAPH_PATH = path.join(experimentsDir, "data", "page-graph.json");
