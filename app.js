const AWSXRay = require("aws-xray-sdk");
const express = require("express");
const rateLimit = require("express-rate-limit");

// Patch Express
AWSXRay.captureHTTPsGlobal(require("http"));
AWSXRay.captureHTTPsGlobal(require("https"));

// Create X-Ray Express Middleware
const app = express();
app.use(AWSXRay.express.openSegment("CryptoApp")); // Service name

// Standard middleware
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Static files
app.use(express.static("public"));

// DynamoDB Client (manually wrapped because X-Ray doesn't fully auto-instrument AWS SDK v3)
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

// Initialize the DynamoDB client
const rawClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const client = AWSXRay.captureAWSv3Client(rawClient);
const docClient = DynamoDBDocumentClient.from(client);

// Health check
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

    // First, get the item using the timestamp-index
    const queryCommand = new QueryCommand({
      TableName: "aws-observability-crypto-table",
      IndexName: "timestamp-index",
      KeyConditionExpression: "#type = :type AND #id = :id",
      ExpressionAttributeNames: {
        "#type": "type",
        "#id": "id",
      },
      ExpressionAttributeValues: {
        ":type": "crypto",
        ":id": symbol,
      },
    });

    const result = await docClient.send(queryCommand);

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({ error: "Cryptocurrency not found" });
    }

    // Get the most recent item
    const item = result.Items[0];

    // Then delete using the correct timestamp
    const deleteCommand = new DeleteCommand({
      TableName: "aws-observability-crypto-table",
      Key: {
        id: symbol,
        timestamp: item.timestamp,
      },
    });

    await docClient.send(deleteCommand);
    res.json({ message: "Cryptocurrency deleted successfully" });
  } catch (error) {
    console.error("Error deleting cryptocurrency:", error);
    res.status(500).json({ error: "Failed to delete cryptocurrency" });
  }
});

// Serve HTML
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Close X-Ray segment after response
app.use(AWSXRay.express.closeSegment());

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
