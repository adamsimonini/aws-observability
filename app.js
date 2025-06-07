const express = require("express");
const rateLimit = require("express-rate-limit");
const app = express();
const port = process.env.PORT || 3000;

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all routes
app.use(limiter);

// Serve static files from the public directory
app.use(express.static("public"));

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

// Main endpoint now serves the HTML page
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
