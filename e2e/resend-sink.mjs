import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 3021;
const emails = [];

function respond(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return respond(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/emails") {
    return respond(response, 200, { emails });
  }

  if (request.method === "DELETE" && url.pathname === "/emails") {
    emails.length = 0;
    return respond(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/emails") {
    try {
      const payload = JSON.parse(await readBody(request));
      const id = `email-${emails.length + 1}`;
      emails.push({ id, ...payload });
      return respond(response, 200, { id });
    } catch {
      return respond(response, 400, { message: "invalid email payload" });
    }
  }

  return respond(response, 404, { message: "not found" });
});

server.listen(port, host, () => {
  console.log(`Resend test sink listening on http://${host}:${port}`);
});
