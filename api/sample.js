const sharp = require("sharp");

function maskOutBackground(raw, info, bg, tolerance) {
  const { channels } = info;
  const out = Buffer.from(raw);
  for (let i = 0; i < out.length; i += channels) {
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
      const { data, info } = await base
        .clone()
        .resize(500, 500, { fit: "inside", withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const masked = maskOutBackground(data, info, { r: 255, g: 255, b: 255 }, tolerance);
      base = sharp(masked, {
        raw: { width: info.width, height: info.height, channels: info.channels }
      });
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
    let previewPipeline = base.clone();
    if (matchAspect) {
      previewPipeline = previewPipeline.resize(previewMax, previewMax, { fit: "inside", kernel: "lanczos3" });
    } else {
      previewPipeline = previewPipeline.resize(previewMax, previewMax, { fit: "fill", kernel: "lanczos3" });
    }
    const previewBuf = await previewPipeline.sharpen().png().toBuffer();
    const previewBase64 = previewBuf.toString("base64");

    const { data, info } = await base
      .clone()
      .resize(gridCols, gridRows, { fit: "fill", kernel: "lanczos3" })
      .sharpen()
      .raw()
      .toBuffer({ resolveWithObject: true });

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
