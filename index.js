import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const uri = process.env.DB_URL;
if (!uri) {
  console.error("DB_URL is missing from the server environment.");
  process.exit(1);
}

const client = new MongoClient(uri);
const connectedClient = await client.connect();
console.log("You successfully connected to MongoDB!");

const database = connectedClient.db("booknook");
const books = database.collection("books");
const borrows = database.collection("borrows");

app.get("/", (req, res) => {
  res.send("BookNook API is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});