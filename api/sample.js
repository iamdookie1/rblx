const Jimp = require("jimp");

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
    const arrayBuf = await imgResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const image = await Jimp.read(buffer);

    // Small preview so the overlay can show what the image actually looks like
    const previewImg = image.clone().resize(128, 128, Jimp.RESIZE_BILINEAR);
    const previewDataUrl = await previewImg.getBase64Async(Jimp.MIME_PNG);
    const previewBase64 = previewDataUrl.split(",")[1];

    // Downsample to the requested grid and read every cell's color
    const sampled = image.clone().resize(gridSize, gridSize, Jimp.RESIZE_BILINEAR);

    const pixels = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const rgba = Jimp.intToRGBA(sampled.getPixelColor(col, row));
        pixels.push({ row, col, r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a });
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
