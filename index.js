import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const uri = process.env.DB_URL;
if (!uri) {
  console.error("DB_URL is missing from the server environment.");
  process.exit(1);
}

const NEXTJS_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const JWKS = createRemoteJWKSet(new URL(`${NEXTJS_APP_URL}/api/auth/jwks`));


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
    const { search, q, category, page = "1", limit, sort = "newest" } = req.query;
    const filter = {};

    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      filter.$or = [
        { title: { $regex: searchTerm, $options: "i" } },
        { author: { $regex: searchTerm, $options: "i" } },
      ];
    }
    if (category && category !== "All") filter.category = category;

    const sortOption = sort === "newest" ? { _id: -1 } : { title: 1 };
    const total = await books.countDocuments(filter);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);

    let query = books.find(filter).sort(sortOption);
    let parsedLimit = total;

    if (limit) {
      parsedLimit = Math.max(1, parseInt(limit, 10));
      const skip = (parsedPage - 1) * parsedLimit;
      query = query.skip(skip).limit(parsedLimit);
    }

    const rawBooks = await query.toArray();
    const totalPages = parsedLimit > 0 ? Math.ceil(total / parsedLimit) : 1;

    res.json({
      books: rawBooks.map(formatBook),
      total, page: parsedPage, limit: parsedLimit,
      totalPages: totalPages === 0 ? 1 : totalPages,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch books." });
  }
}

app.get("/api/books", handleGetBooks);
app.get("/books", handleGetBooks);


async function handleGetBookById(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid book ID." });

    const book = await books.findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).json({ message: "Book not found." });

    const formatted = formatBook(book);
    res.json({ book: formatted, ...formatted });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch book." });
  }
}

app.get("/api/books/:id", handleGetBookById);
app.get("/books/:id", handleGetBookById);


app.get("/", (req, res) => {
  res.send("BookNook API is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});