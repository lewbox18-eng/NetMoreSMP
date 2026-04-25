const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const rootDirectory = __dirname;
const port = Number.parseInt(process.env.PORT || "8080", 10);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function resolvePath(requestUrl) {
  const pathname = requestUrl === "/" ? "/index.html" : requestUrl.split("?")[0];
  const normalized = path.normalize(path.join(rootDirectory, pathname));

  if (!normalized.startsWith(rootDirectory)) {
    return null;
  }

  return normalized;
}

const server = http.createServer(async (req, res) => {
  const filePath = resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    res.end(content);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`[gitshop-frontend] static server listening on http://localhost:${port}`);
});

