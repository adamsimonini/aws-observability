const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Metrics endpoint
app.get("/metrics", (req, res) => {
  res.status(200).json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// Main endpoint
app.get("/", (req, res) => {
  res.send("Hello from AWS ECS!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
