const sharp = require("sharp");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ status: "error", message: "Use POST" });
    return;
  }

  try {
    const { url, grid } = req.body || {};

    if (!url || typeof url !== "string") {
      res.status(200).json({ status: "error", message: "Missing or invalid url" });
      return;
    }

    const gridSize = Math.min(Math.max(parseInt(grid) || 20, 5), 100);

    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      throw new Error("Could not download image, HTTP " + imgResp.status);
    }
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    const base = sharp(buffer).ensureAlpha();

    // Lanczos3 (sharp's default kernel) gives noticeably crisper results than
    // bilinear/bicubic, especially when shrinking an image down a lot.
    const previewBuf = await base
      .clone()
      .resize(128, 128, { fit: "fill", kernel: "lanczos3" })
      .sharpen()
      .png()
      .toBuffer();
    const previewBase64 = previewBuf.toString("base64");

    const { data, info } = await base
      .clone()
      .resize(gridSize, gridSize, { fit: "fill", kernel: "lanczos3" })
      .sharpen()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixels = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const idx = (row * gridSize + col) * channels;
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
      pixels: pixels,
      preview: previewBase64
    });
  } catch (err) {
    res.status(200).json({ status: "error", message: String(err.message || err) });
  }
};
