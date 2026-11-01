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


export async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "No token provided." });

  const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
  if (!token) return res.status(401).json({ message: "Invalid token format." });

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = { id: payload.id || payload.sub, email: payload.email, name: payload.name };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}


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



async function handleAddBook(req, res) {
  try {
    const { title, author, category = "Fiction", totalCopies = 1, description = "", image = "" } = req.body;
    if (!title?.trim() || !author?.trim()) return res.status(400).json({ message: "Title and author required." });

    const copies = Math.max(1, parseInt(totalCopies, 10) || 1);
    const now = new Date().toISOString();

    const newBook = {
      title: title.trim(), author: author.trim(), category,
      totalCopies: copies, availableCopies: copies,
      description: description.trim(), image: image.trim(),
      addedBy: { id: req.user?.id || "", name: req.user?.name || "Anonymous", email: req.user?.email || "" },
      userId: req.user?.id || "", userName: req.user?.name || "Anonymous", userEmail: req.user?.email || "",
      createdAt: now, updatedAt: now,
    };

    const result = await books.insertOne(newBook);
    const created = await books.findOne({ _id: result.insertedId });
    res.status(201).json({ message: "Book added.", book: formatBook(created) });
  } catch (err) {
    res.status(500).json({ message: "Failed to add book." });
  }
}

app.post("/api/books", verifyJWT, handleAddBook);
app.post("/books", verifyJWT, handleAddBook);


async function handleUpdateBook(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid book ID." });

    const existing = await books.findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).json({ message: "Book not found." });

    const { title, author, category, description, image, totalCopies } = req.body;
    const updateData = { updatedAt: new Date().toISOString() };

    if (title !== undefined) updateData.title = title.trim();
    if (author !== undefined) updateData.author = author.trim();
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description.trim();
    if (image !== undefined) updateData.image = image.trim();

    if (totalCopies !== undefined) {
      const newTotal = Math.max(1, parseInt(totalCopies, 10) || 1);
      const activeLoans = await borrows.countDocuments({ bookId: id, returnedAt: null });
      updateData.totalCopies = newTotal;
      updateData.availableCopies = Math.max(0, newTotal - activeLoans);
    }

    await books.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    const updated = await books.findOne({ _id: new ObjectId(id) });
    res.json({ message: "Book updated.", book: formatBook(updated) });
  } catch (err) {
    res.status(500).json({ message: "Failed to update book." });
  }
}

app.put("/api/books/:id", verifyJWT, handleUpdateBook);
app.patch("/api/books/:id", verifyJWT, handleUpdateBook);
app.put("/books/:id", verifyJWT, handleUpdateBook);
app.patch("/books/:id", verifyJWT, handleUpdateBook);


async function handleDeleteBook(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid book ID." });

    const activeLoan = await borrows.findOne({ bookId: id, status: "active" });
    if (activeLoan) return res.status(400).json({ message: "Cannot delete a book on loan." });

    const result = await books.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ message: "Book not found." });

    res.json({ message: "Book deleted." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete book." });
  }
}

app.delete("/api/books/:id", verifyJWT, handleDeleteBook);
app.delete("/books/:id", verifyJWT, handleDeleteBook);




async function handleGetBorrows(req, res) {
  try {
    const effectiveUserId = req.user?.id;
    const effectiveEmail = req.user?.email;
    if (!effectiveUserId && !effectiveEmail) return res.status(401).json({ message: "User not found." });

    const filter = { $or: [{ userId: effectiveUserId }, { userEmail: effectiveEmail }] };
    const rawBorrows = await borrows.find(filter).sort({ _id: -1 }).toArray();

    const bookIds = [...new Set(rawBorrows.map(b => b.bookId).filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)))];
    const relatedBooks = bookIds.length ? await books.find({ _id: { $in: bookIds } }).toArray() : [];
    const booksMap = new Map(relatedBooks.map(b => [b._id.toString(), b]));

    res.json({ borrows: rawBorrows.map(borrow => formatBorrow(borrow, booksMap.get(borrow.bookId))) });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch borrows." });
  }
}

app.get("/api/borrows", verifyJWT, handleGetBorrows);
app.get("/borrows", verifyJWT, handleGetBorrows);



app.get("/", (req, res) => {
  res.send("BookNook API is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});