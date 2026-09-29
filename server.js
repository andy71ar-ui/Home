var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = Number(process.env.PORT || 3101);
var PUBLIC_DIR = path.join(__dirname, "public");

var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return "/";
  }
}

function serve(req, res) {
  var rawPath = (req.url || "/").split("?")[0].split("#")[0];
  var requestPath = rawPath === "/" ? "/index.html" : safeDecode(rawPath);
  var filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));

  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, function (error, content) {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, content, TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

http.createServer(serve).listen(PORT, function () {
  console.log("Control del hogar listo en http://localhost:" + PORT);
  console.log("Carpeta: " + __dirname);
});
