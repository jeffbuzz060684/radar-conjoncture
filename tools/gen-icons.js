var fs = require("fs");
var zlib = require("zlib");

// ---- PNG minimal RGBA ----
var CRC_TABLE = [];
for (var n = 0; n < 256; n++) {
  var c = n;
  for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var t = Buffer.from(type, "ascii");
  var body = Buffer.concat([t, data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(path, W, draw) {
  var raw = Buffer.alloc((W * 4 + 1) * W);
  var o = 0;
  for (var y = 0; y < W; y++) {
    raw[o++] = 0; // filtre "none"
    for (var x = 0; x < W; x++) {
      var px = draw(x, y); // [r,g,b,a]
      raw[o++] = px[0]; raw[o++] = px[1]; raw[o++] = px[2]; raw[o++] = px[3];
    }
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(path, png);
  console.log(path, png.length, "octets");
}

// ---- dessin : radar (arcs concentriques + aiguille + blip) ----
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
var BG = hex("#020617");
var ACC = hex("#38bdf8");
var GOOD = hex("#34d399");
var RAD = 104, CX = 104, CY = 408; // pôle du radar en repère 512 (à l'échelle)

function roundedIn(x, y, W) {
  if (x < 0 || y < 0 || x >= W || y >= W) return false;
  var r = RAD * W / 512;
  var x0 = r, y0 = r, x1 = W - r, y1 = W - r;
  if (x >= x0 && x < x1) return true;
  if (y >= y0 && y < y1) return true;
  var cx = x < x0 ? x0 : x1;
  var cy = y < y0 ? y0 : y1;
  var dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function draw(W) {
  var s = W / 512;
  return function (x, y) {
    if (!roundedIn(x, y, W)) return [0, 0, 0, 0];
    var X = x / s, Y = y / s;
    var dx = X - CX, dy = Y - CY;
    var d = Math.sqrt(dx * dx + dy * dy);
    var inArc = false, i, rr, w, ring;
    // arcs de rayons 304/212/120 (quart de cercle supérieur droit)
    var arcs = [{ r: 304, w: 22 }, { r: 212, w: 18 }, { r: 120, w: 14 }];
    for (i = 0; i < arcs.length; i++) {
      rr = arcs[i].r; w = arcs[i].w;
      if (d >= rr - w / 2 && d <= rr + w / 2 && dx >= -2 && dy <= 2) {
        var op = i === 0 ? 1 : i === 1 ? 0.65 : 0.4;
        return [ACC[0], ACC[1], ACC[2], Math.round(255 * op)];
      }
    }
    // aiguille vers (376,152)
    var ax = 376 - CX, ay = 152 - CY;
    var alen = Math.sqrt(ax * ax + ay * ay);
    var ux = ax / alen, uy = ay / alen;
    var t = dx * ux + dy * uy;
    var px = dx - ux * t, py = dy - uy * t;
    var perp = Math.sqrt(px * px + py * py);
    if (t >= 0 && t <= alen && perp <= 13) return [GOOD[0], GOOD[1], GOOD[2], 255];
    // blip vert
    var bx = dx - (340 - CX), by = dy - (248 - CY);
    if (bx * bx + by * by <= 26 * 26) return [GOOD[0], GOOD[1], GOOD[2], 255];
    // pôle
    if (d <= 20) return [ACC[0], ACC[1], ACC[2], 255];
    return [BG[0], BG[1], BG[2], 255];
  };
}
writePNG("icon-512.png", 512, draw(512));
writePNG("icon-192.png", 192, draw(192));
