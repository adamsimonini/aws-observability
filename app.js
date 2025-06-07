const express = require("express");
const rateLimit = require("express-rate-limit");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const app = express();
const port = process.env.PORT || 3000;

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Enable JSON parsing for request bodies
app.use(express.json());

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

// Get all cryptocurrencies
app.get("/api/crypto", async (req, res) => {
  try {
    const command = new QueryCommand({
      TableName: "aws-observability-crypto-table",
      IndexName: "timestamp-index",
      KeyConditionExpression: "#type = :type",
      ExpressionAttributeNames: {
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":type": "crypto",
      },
    });

    const result = await docClient.send(command);
    res.json(result.Items);
  } catch (error) {
    console.error("Error fetching cryptocurrencies:", error);
    res.status(500).json({ error: "Failed to fetch cryptocurrencies" });
  }
});

// Add a new cryptocurrency
app.post("/api/crypto", async (req, res) => {
  try {
    const { symbol, name, price } = req.body;
    const timestamp = new Date().toISOString();

    const command = new PutCommand({
      TableName: "aws-observability-crypto-table",
      Item: {
        id: symbol,
        timestamp,
        type: "crypto",
        name,
        price: parseFloat(price),
        lastUpdated: timestamp,
      },
    });

    await docClient.send(command);
    res.status(201).json({ message: "Cryptocurrency added successfully" });
  } catch (error) {
    console.error("Error adding cryptocurrency:", error);
    res.status(500).json({ error: "Failed to add cryptocurrency" });
  }
});

// Delete a cryptocurrency
app.delete("/api/crypto/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;

    const command = new DeleteCommand({
      TableName: "aws-observability-crypto-table",
      Key: {
        id: symbol,
        timestamp: "latest", // You might want to handle this differently
      },
    });

    await docClient.send(command);
    res.json({ message: "Cryptocurrency deleted successfully" });
  } catch (error) {
    console.error("Error deleting cryptocurrency:", error);
    res.status(500).json({ error: "Failed to delete cryptocurrency" });
  }
});

// Main endpoint now serves the HTML page
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
