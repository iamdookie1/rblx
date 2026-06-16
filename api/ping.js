module.exports = (req, res) => {
  res.status(200).json({ status: "ok", time: Date.now() });
};
