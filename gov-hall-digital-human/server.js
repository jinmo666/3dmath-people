const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");

loadLocalEnv();

const PORT = Number(process.env.PORT || 5173);
const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const ALLOWED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        hasServerDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY),
        defaultModel: ALLOWED_MODELS.has(DEFAULT_MODEL)
          ? DEFAULT_MODEL
          : "deepseek-v4-flash"
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      return handleDeepSeekChat(req, res);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(url.pathname, req, res);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Server error" });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Gov hall digital human demo: http://localhost:${PORT}`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log(
      "DEEPSEEK_API_KEY is not set. The page will ask for a key for local testing."
    );
  }
});

async function handleDeepSeekChat(req, res) {
  if (typeof fetch !== "function") {
    return sendJson(res, 500, {
      error: "Node.js 18 or later is required for native fetch."
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid JSON" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY || String(body.apiKey || "").trim();
  if (!apiKey) {
    return sendJson(res, 400, {
      error: "缺少 DeepSeek API Key。请设置服务端环境变量，或在前端临时输入。"
    });
  }

  const messages = normalizeMessages(body.messages);
  if (!messages.length) {
    return sendJson(res, 400, { error: "messages 不能为空。" });
  }

  const model = ALLOWED_MODELS.has(body.model)
    ? body.model
    : ALLOWED_MODELS.has(DEFAULT_MODEL)
      ? DEFAULT_MODEL
      : "deepseek-v4-flash";

  const controller = new AbortController();
  let completed = false;
  res.on("close", () => {
    if (!completed) controller.abort();
  });

  const upstreamPayload = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 900,
    stream: true,
    thinking: {
      type: "disabled"
    }
  };

  let upstream;
  try {
    upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(upstreamPayload),
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    return sendJson(res, 502, {
      error: `无法连接 DeepSeek：${error.message || "network error"}`
    });
  }

  if (!upstream.ok) {
    const errorText = await safeReadText(upstream);
    return sendJson(res, upstream.status, {
      error: "DeepSeek API 调用失败。",
      detail: trimError(errorText)
    });
  }

  if (!upstream.body) {
    return sendJson(res, 502, { error: "DeepSeek 未返回可读流。" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    completed = true;
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) console.error(error);
    completed = true;
    res.end();
  }
}

function serveStatic(rawPathname, req, res) {
  const pathname = decodeURIComponent(rawPathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.normalize(path.join(publicDir, relativePath));

  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      return sendJson(res, 404, { error: "Not found" });
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()]
      || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("请求体过大。"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("请求体不是合法 JSON。"));
      }
    });

    req.on("error", reject);
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message) => ({
      role: String(message.role || "").trim(),
      content: String(message.content || "").trim()
    }))
    .filter((message) =>
      ["system", "user", "assistant"].includes(message.role) && message.content
    )
    .slice(-16);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function trimError(text) {
  if (!text) return "";
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

function loadLocalEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const rawValue = trimmed.slice(equalIndex + 1).trim();
    if (!key || process.env[key]) continue;

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}
