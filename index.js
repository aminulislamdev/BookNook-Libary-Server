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


function formatBook(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  const total = Number(doc.totalCopies ?? 1);
  const available = Number(doc.availableCopies ?? total);

  return {
    id: _id.toString(),
    ...rest,
    title: doc.title || "",
    author: doc.author || "",
    category: doc.category || "Fiction",
    description: doc.description || "",
    image: doc.image || "",
    totalCopies: total,
    availableCopies: available,
    addedBy: doc.addedBy || {
      id: doc.userId || "",
      name: doc.userName || "Anonymous",
      email: doc.userEmail || "",
    },
    createdAt: doc.createdAt || new Date().toISOString(),
    updatedAt: doc.updatedAt || new Date().toISOString(),
  };
}

app.get("/", (req, res) => {
  res.send("BookNook API is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});