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


function formatBorrow(doc, bookDoc = null) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  const borrowDate = doc.borrowDate || doc.borrowedAt || doc.createdAt || new Date().toISOString();
  const returnDate = doc.returnDate || doc.dueDate || "";

  return {
    id: _id.toString(),
    ...rest,
    bookId: doc.bookId?.toString() || "",
    bookTitle: doc.bookTitle || bookDoc?.title || "",
    bookImage: doc.bookImage || bookDoc?.image || "",
    userName: doc.userName || "",
    userEmail: doc.userEmail || "",
    userId: doc.userId || "",
    borrowDate,
    borrowedAt: doc.borrowedAt || borrowDate,
    returnDate,
    dueDate: doc.dueDate || returnDate,
    returnedAt: doc.returnedAt ?? null,
    status: doc.status || (doc.returnedAt ? "returned" : "active"),
    book: bookDoc ? formatBook(bookDoc) : (doc.book ? formatBook(doc.book) : null),
  };
}

async function handleGetBooks(req, res) {
  try {
    const rawBooks = await books.find({}).sort({ _id: -1 }).toArray();
    res.json({ books: rawBooks.map(formatBook), total: rawBooks.length });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch books." });
  }
}

app.get("/api/books", handleGetBooks);
app.get("/books", handleGetBooks);

app.get("/", (req, res) => {
  res.send("BookNook API is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});