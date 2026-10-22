/**
 * `npm run dev`: API on :4100 with auto-reload, Vite on :5173 proxying /api to it.
 * PORT and APP_URL are pinned here so a PORT already set in your shell does not
 * make both servers fight for the same port, and links point at Vite.
 */
import { type ChildProcess, spawn } from "node:child_process";

const env = { ...process.env, PORT: "4100", APP_URL: "http://localhost:5173" };
const isWindows = process.platform === "win32";

const children: ChildProcess[] = ["@openturnly/server", "@openturnly/web"].map((workspace) =>
  spawn("npm", ["run", "dev", "-w", workspace], { env, stdio: "inherit", shell: isWindows }),
);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
