const sharp = require("sharp");

function premultiply(rawBuf, channels) {
  if (channels < 4) return rawBuf;
  const out = Buffer.from(rawBuf);
  for (let i = 0; i < out.length; i += channels) {
    const a = out[i + 3] / 255;
    out[i]     = Math.round(out[i]     * a);
    out[i + 1] = Math.round(out[i + 1] * a);
    out[i + 2] = Math.round(out[i + 2] * a);
  }
  return out;
}

function unpremultiply(rawBuf, channels) {
  if (channels < 4) return rawBuf;
  const out = Buffer.from(rawBuf);
  for (let i = 0; i < out.length; i += channels) {
    const a = out[i + 3];
    if (a === 0) continue;
    const f = 255 / a;
    out[i]     = Math.min(255, Math.round(out[i]     * f));
    out[i + 1] = Math.min(255, Math.round(out[i + 1] * f));
    out[i + 2] = Math.min(255, Math.round(out[i + 2] * f));
  }
  return out;
}

// sharp doesn't premultiply alpha before blending pixels during resize, which
// means color from opaque areas bleeds into nearby transparent pixels' RGB
// (invisible normally, but it corrupts both our white-background detection
// and the final painted colors). Premultiplying first and undoing it after
// fixes that.
async function alphaSafeResize(sharpImg, width, height, resizeOpts) {
  const { data, info } = await sharpImg.raw().toBuffer({ resolveWithObject: true });
  const pre = premultiply(data, info.channels);
  const resizedRaw = await sharp(pre, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  })
    .resize(width, height, resizeOpts)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const post = unpremultiply(resizedRaw.data, resizedRaw.info.channels);
  return sharp(post, {
    raw: { width: resizedRaw.info.width, height: resizedRaw.info.height, channels: resizedRaw.info.channels }
  });
}

function maskOutBackground(raw, info, bg, tolerance) {
  const { channels } = info;
  const out = Buffer.from(raw);
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] < 5) continue; // already transparent, nothing to do
    const dr = out[i] - bg.r;
    const dg = out[i + 1] - bg.g;
    const db = out[i + 2] - bg.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tolerance) {
      out[i + 3] = 0;
    }
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ status: "error", message: "Use POST" });
    return;
  }

  try {
    const { url, grid, removeBackground, bgTolerance, matchAspect } = req.body || {};

    if (!url || typeof url !== "string") {
      res.status(200).json({ status: "error", message: "Missing or invalid url" });
      return;
    }

    const gridSize = Math.min(Math.max(parseInt(grid) || 20, 5), 100);
    const tolerance = Math.min(Math.max(parseInt(bgTolerance) || 35, 1), 200);

    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      throw new Error("Could not download image, HTTP " + imgResp.status);
    }
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    let base = sharp(buffer).ensureAlpha();
    const meta = await base.metadata();
    const aspectRatio = meta.width / meta.height;

    if (removeBackground) {
      const working = await alphaSafeResize(base.clone(), 500, 500, {
        fit: "inside",
        withoutEnlargement: true
      });
      const { data, info } = await working.raw().toBuffer({ resolveWithObject: true });
      const masked = maskOutBackground(data, info, { r: 255, g: 255, b: 255 }, tolerance);
      base = sharp(masked, { raw: { width: info.width, height: info.height, channels: info.channels } });
    }

    let gridCols = gridSize;
    let gridRows = gridSize;
    if (matchAspect) {
      if (aspectRatio >= 1) {
        gridCols = gridSize;
        gridRows = Math.max(5, Math.round(gridSize / aspectRatio));
      } else {
        gridRows = gridSize;
        gridCols = Math.max(5, Math.round(gridSize * aspectRatio));
      }
    }

    const previewMax = 160;
    let previewW = previewMax, previewH = previewMax;
    if (matchAspect) {
      if (aspectRatio >= 1) {
        previewH = Math.max(1, Math.round(previewMax / aspectRatio));
      } else {
        previewW = Math.max(1, Math.round(previewMax * aspectRatio));
      }
    }

    const previewSharp = await alphaSafeResize(base.clone(), previewW, previewH, {
      fit: "fill",
      kernel: "lanczos3"
    });
    const previewBuf = await previewSharp.sharpen().png().toBuffer();
    const previewBase64 = previewBuf.toString("base64");

    const gridSharp = await alphaSafeResize(base.clone(), gridCols, gridRows, {
      fit: "fill",
      kernel: "lanczos3"
    });
    const { data, info } = await gridSharp.sharpen().raw().toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixels = [];
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const idx = (row * gridCols + col) * channels;
        pixels.push({
          row: row,
          col: col,
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2],
          a: channels >= 4 ? data[idx + 3] : 255
        });
      }
    }

    res.status(200).json({
      status: "ok",
      grid: gridSize,
      gridCols: gridCols,
      gridRows: gridRows,
      aspectRatio: aspectRatio,
      pixels: pixels,
      preview: previewBase64
    });
  } catch (err) {
    res.status(200).json({ status: "error", message: String(err.message || err) });
  }
};
