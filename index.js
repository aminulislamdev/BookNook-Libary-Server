import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Connect to MongoDB
const uri = process.env.DB_URL;
if (!uri) {
  console.error("DB_URL is missing from the server environment.");
  process.exit(1);
}

const client = new MongoClient(uri);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    throw err;
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("booknook");
const books = database.collection("books");
const borrows = database.collection("borrows");

// --------------------------------------------------------------------------
// ✅ Better Auth JWT Verification Middleware (JWKS)
// --------------------------------------------------------------------------
const NEXTJS_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://booknook-c-ph.vercel.app";
const JWKS = createRemoteJWKSet(
  new URL(`${NEXTJS_APP_URL}/api/auth/jwks`)
);

export async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized access: No token provided." });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized access: Invalid token format." });
  }

  try {

    const { payload } = await jwtVerify(token, JWKS);
    req.user = {
      id: payload.id || payload.sub,
      email: payload.email,
      name: payload.name,
    };
    next();
  } catch (err) {
    console.error("JWT Verification Error:", err.message);
    return res.status(401).json({ message: "Unauthorized access: Invalid or expired token." });
  }
}

// Helper to format a book document
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

// Helper to format a borrow document
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

// Home route
app.get(["/", "/api"], (req, res) => {
  res.send("BookNook API is running.");
});

/* -------------------------------------------------------------------------- */
/*  Books Routes                                                              */
/* -------------------------------------------------------------------------- */

async function handleGetBooks(req, res) {
  try {
    const { search, q, category, addedBy, userId, userEmail, page = "1", limit, sort = "newest" } = req.query;

    const filter = {};
    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      filter.$or = [
        { title: { $regex: searchTerm, $options: "i" } },
        { author: { $regex: searchTerm, $options: "i" } },
      ];
    }

    if (category && category !== "All") {
      filter.category = category;
    }

    const ownerConditions = [];
    if (addedBy) {
      ownerConditions.push({ "addedBy.id": addedBy });
      ownerConditions.push({ "addedBy.email": addedBy });
      ownerConditions.push({ userId: addedBy });
      ownerConditions.push({ userEmail: addedBy });
    }
    if (userId) {
      ownerConditions.push({ "addedBy.id": userId });
      ownerConditions.push({ userId });
    }
    if (userEmail) {
      ownerConditions.push({ "addedBy.email": userEmail });
      ownerConditions.push({ userEmail });
    }
    if (ownerConditions.length > 0) {
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: ownerConditions }];
        delete filter.$or;
      } else {
        filter.$or = ownerConditions;
      }
    }

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
    const formattedBooks = rawBooks.map(formatBook);
    const totalPages = parsedLimit > 0 ? Math.ceil(total / parsedLimit) : 1;

    res.json({
      books: formattedBooks,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: totalPages === 0 ? 1 : totalPages,
    });
  } catch (err) {
    console.error("Error fetching books:", err);
    res.status(500).json({ message: "Failed to fetch books." });
  }
}

app.get("/api/books", handleGetBooks);
app.get("/books", handleGetBooks);


// Get a single book by ID

async function handleGetBookById(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book ID format." });
    }

    const book = await books.findOne({ _id: new ObjectId(id) });
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }

    const formatted = formatBook(book);
    res.json({ book: formatted, ...formatted });
  } catch (err) {
    console.error("Error fetching book by ID:", err);
    res.status(500).json({ message: "Failed to fetch book details." });
  }
}

app.get("/api/books/:id", handleGetBookById);
app.get("/books/:id", handleGetBookById);


// Add a new book
async function handleAddBook(req, res) {
  try {
    const { title, author, category = "Fiction", totalCopies = 1, description = "", image = "" } = req.body;

    if (!title?.trim() || !author?.trim()) {
      return res.status(400).json({ message: "Title and author are required." });
    }

    const copies = Math.max(1, parseInt(totalCopies, 10) || 1);
    const now = new Date().toISOString();

    const newBook = {
      title: title.trim(),
      author: author.trim(),
      category,
      totalCopies: copies,
      availableCopies: copies,
      description: description.trim(),
      image: image.trim(),
      addedBy: {
        id: req.user?.id || "",
        name: req.user?.name || "Anonymous",
        email: req.user?.email || "",
      },
      userId: req.user?.id || "",
      userName: req.user?.name || "Anonymous",
      userEmail: req.user?.email || "",
      createdAt: now,
      updatedAt: now,
    };

    const result = await books.insertOne(newBook);
    const created = await books.findOne({ _id: result.insertedId });
    const formatted = formatBook(created);

    res.status(201).json({
      message: "Book added successfully.",
      book: formatted,
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.error("Error adding book:", err);
    res.status(500).json({ message: "Failed to add book." });
  }
}

app.post("/api/books", verifyJWT, handleAddBook);
app.post("/books", verifyJWT, handleAddBook);
app.post("/api/add-books", verifyJWT, handleAddBook);
app.post("/add-books", verifyJWT, handleAddBook);


// Update an existing book
async function handleUpdateBook(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book ID format." });
    }

    const existingBook = await books.findOne({ _id: new ObjectId(id) });
    if (!existingBook) {
      return res.status(404).json({ message: "Book not found." });
    }

    const { title, author, category, description, image, totalCopies } = req.body;
    const updateData = { updatedAt: new Date().toISOString() };

    if (title !== undefined) updateData.title = title.trim();
    if (author !== undefined) updateData.author = author.trim();
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description.trim();
    if (image !== undefined) updateData.image = image.trim();

    if (totalCopies !== undefined) {
      const newTotal = Math.max(1, parseInt(totalCopies, 10) || 1);
      const activeLoansCount = await borrows.countDocuments({
        bookId: id,
        returnedAt: null,
      });

      updateData.totalCopies = newTotal;
      updateData.availableCopies = Math.max(0, newTotal - activeLoansCount);
    }

    await books.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    const updated = await books.findOne({ _id: new ObjectId(id) });
    const formatted = formatBook(updated);

    res.json({
      message: "Book updated successfully.",
      book: formatted,
      ...formatted,
    });
  } catch (err) {
    console.error("Error updating book:", err);
    res.status(500).json({ message: "Failed to update book." });
  }
}

app.put("/api/books/:id", verifyJWT, handleUpdateBook);
app.put("/books/:id", verifyJWT, handleUpdateBook);
app.patch("/api/books/:id", verifyJWT, handleUpdateBook);
app.patch("/books/:id", verifyJWT, handleUpdateBook);


// Delete a book
async function handleDeleteBook(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book ID format." });
    }


    const activeLoan = await borrows.findOne({
      bookId: id,
      status: "active",
    });

    if (activeLoan) {
      return res.status(400).json({
        message: "Cannot delete a book that is currently on loan.",
      });
    }

    const result = await books.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Book not found." });
    }

    res.json({ message: "Book deleted successfully." });
  } catch (err) {
    console.error("Error deleting book:", err);
    res.status(500).json({ message: "Failed to delete book." });
  }
}

app.delete("/api/books/:id", verifyJWT, handleDeleteBook);
app.delete("/books/:id", verifyJWT, handleDeleteBook);

/* -------------------------------------------------------------------------- */
/*  Borrow & Return Routes                                                    */
/* -------------------------------------------------------------------------- */

async function handleGetBorrows(req, res) {
  try {

    const effectiveUserId = req.user?.id;
    const effectiveEmail = req.user?.email;

    if (!effectiveUserId && !effectiveEmail) {
      return res.status(401).json({ message: "User not found in token." });
    }

    const filter = {
      $or: [
        { userId: effectiveUserId },
        { userEmail: effectiveEmail }
      ]
    };

    const rawBorrows = await borrows.find(filter).sort({ _id: -1 }).toArray();

    const bookIds = [
      ...new Set(
        rawBorrows
          .map((b) => b.bookId)
          .filter((bId) => ObjectId.isValid(bId))
          .map((bId) => new ObjectId(bId))
      ),
    ];

    const relatedBooks = bookIds.length > 0
      ? await books.find({ _id: { $in: bookIds } }).toArray()
      : [];

    const booksMap = new Map(relatedBooks.map((b) => [b._id.toString(), b]));

    const formattedBorrows = rawBorrows.map((borrow) => {
      const bookDoc = booksMap.get(borrow.bookId);
      return formatBorrow(borrow, bookDoc);
    });

    res.json({ borrows: formattedBorrows });
  } catch (err) {
    console.error("Error fetching borrows:", err);
    res.status(500).json({ message: "Failed to fetch borrowed books." });
  }
}

app.get("/api/borrows", verifyJWT, handleGetBorrows);
app.get("/borrows", verifyJWT, handleGetBorrows);


// Borrow a book
async function handleBorrowBook(req, res) {
  try {
    const { bookId, dueDate, returnDate, borrowDate } = req.body;

    if (!bookId || !ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Valid book ID is required." });
    }


    const effectiveUserId = req.user?.id || "";
    const effectiveUserEmail = req.user?.email || "";
    const effectiveUserName = req.user?.name || "Reader";

    // Challenge 2: No Double Borrow
    const existingLoan = await borrows.findOne({
      bookId: bookId,
      $or: [
        { userId: effectiveUserId },
        { userEmail: effectiveUserEmail }
      ],
      status: "active"
    });

    if (existingLoan) {
      return res.status(400).json({
        message: "You have already borrowed this book. Please return your current copy before borrowing again."
      });
    }

    // Challenge 1: Check availability
    const book = await books.findOne({ _id: new ObjectId(bookId) });
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }

    const available = Number(book.availableCopies ?? 0);
    if (available <= 0) {
      return res.status(400).json({ message: "Not Available: No copies left to borrow." });
    }

    const updateResult = await books.updateOne(
      { _id: new ObjectId(bookId), availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({ message: "Not Available: No copies left to borrow." });
    }

    const now = new Date().toISOString();
    const finalDueDate = dueDate || returnDate || new Date(Date.now() + 14 * 86400000).toISOString();
    const finalBorrowDate = borrowDate || now;

    const borrowRecord = {
      bookId,
      bookTitle: book.title,
      bookImage: book.image,
      userId: effectiveUserId,
      userName: effectiveUserName,
      userEmail: effectiveUserEmail,
      borrowDate: finalBorrowDate,
      borrowedAt: finalBorrowDate,
      returnDate: finalDueDate,
      dueDate: finalDueDate,
      returnedAt: null,
      status: "active",
      createdAt: now,
    };

    const result = await borrows.insertOne(borrowRecord);
    const createdBorrow = await borrows.findOne({ _id: result.insertedId });
    const formatted = formatBorrow(createdBorrow, book);

    res.status(201).json({
      message: "Book borrowed successfully.",
      borrow: formatted,
    });
  } catch (err) {
    console.error("Error borrowing book:", err);
    res.status(500).json({ message: "Failed to borrow book." });
  }
}

app.post("/api/borrows", verifyJWT, handleBorrowBook);
app.post("/borrows", verifyJWT, handleBorrowBook);


// Return or Delete a borrow record
async function handleReturnOrDeleteBorrow(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid borrow ID format." });
    }

    const borrow = await borrows.findOne({ _id: new ObjectId(id) });
    if (!borrow) {
      return res.status(404).json({ message: "Borrow record not found." });
    }

    const isDelete = req.method === "DELETE";

    if (!borrow.returnedAt && ObjectId.isValid(borrow.bookId)) {
      await books.updateOne(
        { _id: new ObjectId(borrow.bookId) },
        { $inc: { availableCopies: 1 } }
      );
    }

    if (isDelete) {
      await borrows.deleteOne({ _id: new ObjectId(id) });
      return res.json({ message: "Borrow record deleted and book copy restored." });
    }

    // Return operation (PUT)
    const now = new Date().toISOString();
    await borrows.updateOne(
      { _id: new ObjectId(id) },
      { $set: { returnedAt: now, status: "returned" } }
    );

    const updatedBorrow = await borrows.findOne({ _id: new ObjectId(id) });
    const bookDoc = ObjectId.isValid(borrow.bookId)
      ? await books.findOne({ _id: new ObjectId(borrow.bookId) })
      : null;

    res.json({
      message: "Book returned successfully.",
      borrow: formatBorrow(updatedBorrow, bookDoc),
    });
  } catch (err) {
    console.error("Error returning/deleting borrow:", err);
    res.status(500).json({ message: "Failed to process book return." });
  }
}

app.put("/api/borrows/:id", verifyJWT, handleReturnOrDeleteBorrow);
app.put("/borrows/:id", verifyJWT, handleReturnOrDeleteBorrow);
app.delete("/api/borrows/:id", verifyJWT, handleReturnOrDeleteBorrow);
app.delete("/borrows/:id", verifyJWT, handleReturnOrDeleteBorrow);


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 