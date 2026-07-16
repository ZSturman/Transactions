import { createServer } from "node:http";
import { spawn } from "node:child_process";

const firestoreProbe = "http://127.0.0.1:8080/";
const healthPort = 4010;
const firebase = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["firebase", "emulators:start", "--only", "auth,firestore", "--project", "demo-test"],
  { stdio: ["ignore", "pipe", "pipe"] }
);

firebase.stdout.on("data", (chunk) => process.stdout.write(chunk));
firebase.stderr.on("data", (chunk) => process.stderr.write(chunk));

let healthServer;
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  healthServer?.close();
  // Firebase handles SIGINT as a graceful emulator shutdown, including its
  // Firestore Java child process.
  firebase.kill("SIGINT");
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
firebase.on("exit", (code) => stop(code ?? 1));

async function waitForFirestore() {
  while (!stopping) {
    try {
      // A 404 is expected at the root path; receiving any HTTP response proves
      // the emulator is accepting connections and can serve test setup calls.
      await fetch(firestoreProbe);
      healthServer = createServer((request, response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ok":true}');
        if (request.url === "/shutdown") setImmediate(() => stop());
      });
      await new Promise((resolve, reject) => {
        healthServer.once("error", reject);
        healthServer.listen(healthPort, "127.0.0.1", resolve);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

void waitForFirestore();
