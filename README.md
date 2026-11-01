# BookNook Server

REST API backend for **BookNook**, a library management application. The server manages a book catalog and borrowing records in MongoDB, and protects book mutations and all borrow operations with JWTs issued by the paired BookNook Next.js/Better Auth frontend.

The API is built with **Express 5** and the official **MongoDB Node.js driver**, and exposes both `/api/...` routes and equivalent unprefixed aliases.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [Technologies Used](#technologies-used)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [How to Run Locally](#how-to-run-locally)
- [API Documentation](#api-documentation)
  - [Authentication](#authentication)
  - [Health Check](#health-check)
  - [Books](#books)
  - [Borrows & Returns](#borrows--returns)
  - [Error Responses](#error-responses)
- [Data Model](#data-model)
- [Business Rules](#business-rules)
- [Deployment Information](#deployment-information)
- [Notes & Current Limitations](#notes--current-limitations)
- [License](#license)

---

## Project Overview

BookNook Server is the backend for a digital library. It provides:

- A shared catalog of books with metadata, cover images, categories, and copy inventory.
- Per-user borrowing records, including due dates and return status.
- JWT authentication via a remote JWKS endpoint, so authentication remains centralized in the BookNook Next.js application.
- JSON responses shaped for direct use by a frontend (normalized `id` fields, camelCase properties, and embedded book data on borrow records).

The application connects to a MongoDB database named `booknook` and uses two collections: `books` and `borrows`.

---

## Key Features

### Book Catalog
- Create, read, update, and delete books.
- Case-insensitive search by title or author.
- Filter by category and by the user who added the book.
- Sort by newest or by title.
- Optional pagination with total counts and total pages.
- Track total copies and currently available copies.
- Store cover image URLs, descriptions, and attribution for the user who added each book.

### Borrowing
- Borrow an available book as an authenticated user.
- Prevent the same user from borrowing the same book twice while an active loan exists.
- Automatically decrement available copies when a loan is created.
- Set a default 14-day due date when none is provided.
- List only the authenticated user's borrow records.
- Return a book, which marks the record as returned and restores the copy.
- Delete a borrow record, restoring the copy if it was still on loan.
- Include the related book document in borrow responses.

### Security & Infrastructure
- JWT verification against a remote JWKS endpoint using `jose`.
- Bearer token support with optional `Bearer ` prefix.
- CORS enabled for cross-origin frontend access.
- JSON request body parsing.
- Centralized response formatting for books and borrows.
- Startup validation for the MongoDB connection string.
- Clear JSON error messages with appropriate HTTP status codes.

---

## Technologies Used

| Technology | Version | Purpose |
|---|---|---|
| Node.js | ES modules | Runtime (uses `"type": "module"` and top-level `await`) |
| Express | `^5.3.0` | HTTP server, routing, and middleware |
| MongoDB Node.js Driver | `^7.8.0` | MongoDB connection and data access |
| `jose` | `^6.2.14` | Remote JWKS retrieval and JWT verification |
| `cors` | `^2.8.6` | Cross-Origin Resource Sharing |
| `dotenv` | `^18.0.9` | Loading environment variables from `.env` |
| `jsonwebtoken` | `^9.0.3` | Declared dependency (token verification is currently performed with `jose`) |

No frontend framework, ORM, test framework, or build tooling is included in this repository.

---

## Project Structure

```text
booknook-server/
├── index.js           # Complete server: database access, auth middleware, routes, and startup
├── package.json       # Project metadata and dependencies
├── package-lock.json  # Locked dependency versions
├── .gitignore         # Ignores node_modules/ and .env
├── README.md          # Project documentation
├── .env               # Local environment variables (not committed)
└── node_modules/      # Installed dependencies (not committed)
```

The entire API lives in `index.js`. It is organized into the following sections:

1. Express app and middleware setup
2. MongoDB connection and collection references
3. JWT verification middleware
4. Book and borrow response formatters
5. Book routes
6. Borrow and return routes
7. Server startup

---

## Installation & Setup

### Prerequisites

- A modern Node.js runtime that supports ES modules, top-level `await`, and the global `fetch` API.
- npm (included with Node.js).
- A MongoDB database (MongoDB Atlas or a locally running MongoDB instance).
- Access to the BookNook Next.js application's JWKS endpoint for authentication.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
DB_URL=mongodb+srv://<username>:<password>@<cluster>/<database>
PORT=8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> `.env.example` is not currently included in the repository. The variables above are the complete set consumed by the application.

### 3. Start MongoDB and the auth service

Ensure that:
- The MongoDB instance referenced by `DB_URL` is reachable.
- The Next.js application at `NEXT_PUBLIC_APP_URL` is running and exposes `/api/auth/jwks`.

### 4. Start the server

```bash
node index.js
```

Expected output:

```text
You successfully connected to MongoDB!
Server is running on port 8000
```

> `package.json` currently has no `start` or `dev` script, so the server is started directly with `node index.js`. The existing `npm test` script is a placeholder and exits with an error because no tests are configured.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_URL` | Yes | — | MongoDB connection string. The server exits immediately if it is missing or if the initial connection fails. The database name used by the code is hardcoded as `booknook`. |
| `PORT` | No | `8000` | Port the Express server listens on. |
| `NEXT_PUBLIC_APP_URL` | No | `http://localhost:3000` | Base URL of the BookNook Next.js application. The JWKS URL is derived as `${NEXT_PUBLIC_APP_URL}/api/auth/jwks`. |

Environment variables are loaded with `dotenv/config`. `.env` is excluded from version control by `.gitignore`.

---

## How to Run Locally

1. Clone the repository and move into the project directory.
2. Run `npm install`.
3. Create `.env` with `DB_URL`, `PORT`, and `NEXT_PUBLIC_APP_URL`.
4. Start the server with `node index.js`.
5. Verify the API is reachable:

```bash
curl http://localhost:8000/
```

Response:

```text
BookNook API is running.
```

6. Obtain a JWT from the BookNook Next.js application and include it in protected requests:

```bash
curl http://localhost:8000/api/borrows \
  -H "Authorization: Bearer <your-jwt>"
```

The server must be restarted manually after code changes; no file watcher or hot-reload tool is configured.

---

## API Documentation

### Base URL

```text
http://localhost:8000
```

All book, borrow, and return routes are registered twice:

- Prefixed: `/api/books`, `/api/borrows`, etc.
- Unprefixed aliases: `/books`, `/borrows`, etc.

Both forms behave identically. The `/api/...` form is recommended.

All request and response bodies use JSON. Send `Content-Type: application/json` for requests with a body.

### Authentication

Protected routes require a JWT in the `Authorization` header:

```http
Authorization: Bearer <token>
```

The middleware also accepts a raw token without the `Bearer ` prefix.

**Verification flow:**

1. The server fetches the JWKS from `${NEXT_PUBLIC_APP_URL}/api/auth/jwks` using `jose.createRemoteJWKSet`.
2. The token is verified with `jwtVerify`.
3. The authenticated user is derived from the token payload:
   - ID: `payload.id` or `payload.sub`
   - Email: `payload.email`
   - Name: `payload.name`

**Protected routes:**

| Method | Route |
|---|---|
| `POST` | `/api/books`, `/api/add-books` |
| `PUT`, `PATCH` | `/api/books/:id` |
| `DELETE` | `/api/books/:id` |
| `GET` | `/api/borrows` |
| `POST` | `/api/borrows` |
| `PUT`, `DELETE` | `/api/borrows/:id` |

Missing, malformed, invalid, or expired tokens return `401 Unauthorized`.

### Health Check

#### `GET /` or `GET /api`

Returns a plain-text status message.

**Response — `200 OK`**

```text
BookNook API is running.
```

---

### Books

#### `GET /api/books`

Retrieve books with optional search, filtering, sorting, and pagination.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `search` or `q` | string | Case-insensitive search across `title` and `author`. |
| `category` | string | Exact category match. The value `All` is ignored. |
| `addedBy` | string | Matches `addedBy.id`, `addedBy.email`, `userId`, or `userEmail`. |
| `userId` | string | Matches `addedBy.id` or `userId`. |
| `userEmail` | string | Matches `addedBy.email` or `userEmail`. |
| `page` | number | Page number, minimum `1`. Defaults to `1`. Only applied when `limit` is provided. |
| `limit` | number | Number of books per page. If omitted, all matching books are returned. |
| `sort` | string | `newest` (default) sorts by MongoDB `_id` descending. Any other value sorts by title ascending. |

When both a search term and owner filters are provided, they are combined with `$and`.

**Example request:**

```bash
curl "http://localhost:8000/api/books?search=atomic&category=Non-Fiction&limit=10&page=1&sort=newest"
```

**Response — `200 OK`**

```json
{
  "books": [
    {
      "id": "65f1c2a9e4b0a1b2c3d4e5f6",
      "title": "Atomic Habits",
      "author": "James Clear",
      "category": "Non-Fiction",
      "description": "A practical guide to habit formation.",
      "image": "https://example.com/atomic-habits.jpg",
      "totalCopies": 3,
      "availableCopies": 2,
      "addedBy": {
        "id": "user_123",
        "name": "Jane Doe",
        "email": "jane@example.com"
      },
      "userId": "user_123",
      "userName": "Jane Doe",
      "userEmail": "jane@example.com",
      "createdAt": "2026-01-10T12:00:00.000Z",
      "updatedAt": "2026-01-10T12:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

If `limit` is omitted, `limit` is set to the total number of matching documents and all results are returned in a single page.

---

#### `GET /api/books/:id`

Retrieve a single book by its MongoDB ObjectId.

**Path parameters:**

| Parameter | Description |
|---|---|
| `id` | Valid 24-character MongoDB ObjectId. |

**Response — `200 OK`**

```json
{
  "book": {
    "id": "65f1c2a9e4b0a1b2c3d4e5f6",
    "title": "Atomic Habits",
    "author": "James Clear",
    "category": "Non-Fiction",
    "description": "A practical guide to habit formation.",
    "image": "https://example.com/atomic-habits.jpg",
    "totalCopies": 3,
    "availableCopies": 2,
    "addedBy": {
      "id": "user_123",
      "name": "Jane Doe",
      "email": "jane@example.com"
    },
    "createdAt": "2026-01-10T12:00:00.000Z",
    "updatedAt": "2026-01-10T12:00:00.000Z"
  },
  "id": "65f1c2a9e4b0a1b2c3d4e5f6",
  "title": "Atomic Habits"
}
```

The formatted book fields are returned both nested under `book` and flattened at the top level.

**Errors:**

- `400` — Invalid book ID format.
- `404` — Book not found.

---

#### `POST /api/books` or `POST /api/add-books`

Add a new book. Requires authentication.

**Request body:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `title` | string | Yes | — | Book title. Must not be empty after trimming. |
| `author` | string | Yes | — | Book author. Must not be empty after trimming. |
| `category` | string | No | `Fiction` | Book category. |
| `totalCopies` | number | No | `1` | Total copies. Coerced to an integer with a minimum of `1`. |
| `description` | string | No | `""` | Book description. |
| `image` | string | No | `""` | Cover image URL. |

The authenticated user's ID, name, and email are stored as `addedBy` and as flat `userId`, `userName`, and `userEmail` fields.

**Example request:**

```bash
curl -X POST http://localhost:8000/api/books \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Atomic Habits",
    "author": "James Clear",
    "category": "Non-Fiction",
    "totalCopies": 3,
    "description": "A practical guide to habit formation.",
    "image": "https://example.com/atomic-habits.jpg"
  }'
```

**Response — `201 Created`**

```json
{
  "message": "Book added successfully.",
  "book": {
    "id": "65f1c2a9e4b0a1b2c3d4e5f6",
    "title": "Atomic Habits",
    "author": "James Clear",
    "category": "Non-Fiction",
    "totalCopies": 3,
    "availableCopies": 3,
    "description": "A practical guide to habit formation.",
    "image": "https://example.com/atomic-habits.jpg",
    "addedBy": {
      "id": "user_123",
      "name": "Jane Doe",
      "email": "jane@example.com"
    },
    "createdAt": "2026-01-10T12:00:00.000Z",
    "updatedAt": "2026-01-10T12:00:00.000Z"
  },
  "insertedId": "65f1c2a9e4b0a1b2c3d4e5f6"
}
```

**Errors:**

- `400` — Missing title or author.
- `401` — Missing or invalid token.

---

#### `PUT` / `PATCH /api/books/:id`

Update an existing book. Requires authentication. `PUT` and `PATCH` are handled identically, and every field is optional.

**Path parameters:**

| Parameter | Description |
|---|---|
| `id` | Valid MongoDB ObjectId. |

**Request body:**

| Field | Type | Description |
|---|---|---|
| `title` | string | Updated title (trimmed). |
| `author` | string | Updated author (trimmed). |
| `category` | string | Updated category. |
| `description` | string | Updated description (trimmed). |
| `image` | string | Updated image URL (trimmed). |
| `totalCopies` | number | Updated total copies. Minimum `1`. |

When `totalCopies` changes, `availableCopies` is recalculated as:

```text
max(0, totalCopies - number of active loans for the book)
```

`updatedAt` is always refreshed.

**Example request:**

```bash
curl -X PATCH http://localhost:8000/api/books/65f1c2a9e4b0a1b2c3d4e5f6 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "totalCopies": 5 }'
```

**Response — `200 OK`**

```json
{
  "message": "Book updated successfully.",
  "book": {
    "id": "65f1c2a9e4b0a1b2c3d4e5f6",
    "title": "Atomic Habits",
    "author": "James Clear",
    "totalCopies": 5,
    "availableCopies": 4
  },
  "id": "65f1c2a9e4b0a1b2c3d4e5f6"
}
```

The response includes the book both nested under `book` and flattened at the top level.

**Errors:**

- `400` — Invalid book ID format.
- `401` — Missing or invalid token.
- `404` — Book not found.

---

#### `DELETE /api/books/:id`

Delete a book. Requires authentication.

A book cannot be deleted while it has an active loan (`status: "active"`).

**Response — `200 OK`**

```json
{
  "message": "Book deleted successfully."
}
```

**Errors:**

- `400` — Invalid book ID format, or the book is currently on loan.
- `401` — Missing or invalid token.
- `404` — Book not found.

---

### Borrows & Returns

#### `GET /api/borrows`

Return the authenticated user's borrow records, newest first. Requires authentication.

Records are matched by `userId` or `userEmail` from the token. Each record includes the associated book document when it can be found.

**Response — `200 OK`**

```json
{
  "borrows": [
    {
      "id": "65f2d3b0e4b0a1b2c3d4e5f7",
      "bookId": "65f1c2a9e4b0a1b2c3d4e5f6",
      "bookTitle": "Atomic Habits",
      "bookImage": "https://example.com/atomic-habits.jpg",
      "userId": "user_123",
      "userName": "Jane Doe",
      "userEmail": "jane@example.com",
      "borrowDate": "2026-01-10T12:00:00.000Z",
      "borrowedAt": "2026-01-10T12:00:00.000Z",
      "returnDate": "2026-01-24T12:00:00.000Z",
      "dueDate": "2026-01-24T12:00:00.000Z",
      "returnedAt": null,
      "status": "active",
      "createdAt": "2026-01-10T12:00:00.000Z",
      "book": {
        "id": "65f1c2a9e4b0a1b2c3d4e5f6",
        "title": "Atomic Habits",
        "author": "James Clear",
        "availableCopies": 2,
        "totalCopies": 3
      }
    }
  ]
}
```

**Errors:**

- `401` — Missing or invalid token, or no user ID/email in the token payload.

---

#### `POST /api/borrows`

Borrow a book. Requires authentication.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `bookId` | string | Yes | Valid MongoDB ObjectId of the book. |
| `borrowDate` | string | No | ISO date string. Defaults to the current time. |
| `dueDate` | string | No | ISO date string. Defaults to 14 days from now. |
| `returnDate` | string | No | Alias for `dueDate`, used if `dueDate` is absent. |

**Example request:**

```bash
curl -X POST http://localhost:8000/api/borrows \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "bookId": "65f1c2a9e4b0a1b2c3d4e5f6" }'
```

**Response — `201 Created`**

```json
{
  "message": "Book borrowed successfully.",
  "borrow": {
    "id": "65f2d3b0e4b0a1b2c3d4e5f7",
    "bookId": "65f1c2a9e4b0a1b2c3d4e5f6",
    "bookTitle": "Atomic Habits",
    "bookImage": "https://example.com/atomic-habits.jpg",
    "userId": "user_123",
    "userName": "Jane Doe",
    "userEmail": "jane@example.com",
    "borrowDate": "2026-01-10T12:00:00.000Z",
    "returnDate": "2026-01-24T12:00:00.000Z",
    "dueDate": "2026-01-24T12:00:00.000Z",
    "returnedAt": null,
    "status": "active",
    "book": { "id": "65f1c2a9e4b0a1b2c3d4e5f6", "title": "Atomic Habits" }
  }
}
```

**Errors:**

- `400` — Invalid/missing `bookId`, no copies available, or the user already has an active loan for the book.
- `401` — Missing or invalid token.
- `404` — Book not found.

---

#### `PUT /api/borrows/:id`

Return a borrowed book. Requires authentication. Marks the record as returned and restores one available copy if it had not already been returned.

**Path parameters:**

| Parameter | Description |
|---|---|
| `id` | Valid MongoDB ObjectId of the borrow record. |

**Response — `200 OK`**

```json
{
  "message": "Book returned successfully.",
  "borrow": {
    "id": "65f2d3b0e4b0a1b2c3d4e5f7",
    "status": "returned",
    "returnedAt": "2026-01-15T09:30:00.000Z"
  }
}
```

**Errors:**

- `400` — Invalid borrow ID format.
- `401` — Missing or invalid token.
- `404` — Borrow record not found.

---

#### `DELETE /api/borrows/:id`

Delete a borrow record. Requires authentication. If the book was still on loan, one available copy is restored before the record is deleted.

**Response — `200 OK`**

```json
{
  "message": "Borrow record deleted and book copy restored."
}
```

**Errors:**

- `400` — Invalid borrow ID format.
- `401` — Missing or invalid token.
- `404` — Borrow record not found.

---

### Error Responses

Errors are returned as JSON with a `message` field:

```json
{
  "message": "Book not found."
}
```

| Status | Meaning |
|---|---|
| `400` | Invalid ID format, missing required fields, unavailable book, duplicate active loan, or deletion blocked by an active loan. |
| `401` | Missing, malformed, invalid, or expired JWT; or missing user identity in the token. |
| `404` | Requested book or borrow record does not exist. |
| `500` | Database or unexpected server error. |

---

## Data Model

### `books` Collection

| Field | Type | Description |
|---|---|---|
| `_id` | ObjectId | MongoDB primary key; exposed as `id` in responses. |
| `title` | string | Book title. |
| `author` | string | Book author. |
| `category` | string | Book category. Defaults to `Fiction` in responses. |
| `totalCopies` | number | Total owned copies. |
| `availableCopies` | number | Copies currently available to borrow. |
| `description` | string | Book description. |
| `image` | string | Cover image URL. |
| `addedBy` | object | `{ id, name, email }` of the user who added the book. |
| `userId` | string | Flat copy of the adding user's ID. |
| `userName` | string | Flat copy of the adding user's name. |
| `userEmail` | string | Flat copy of the adding user's email. |
| `createdAt` | string (ISO date) | Creation timestamp. |
| `updatedAt` | string (ISO date) | Last update timestamp. |

### `borrows` Collection

| Field | Type | Description |
|---|---|---|
| `_id` | ObjectId | MongoDB primary key; exposed as `id`. |
| `bookId` | string | ID of the borrowed book. |
| `bookTitle` | string | Book title snapshot at borrow time. |
| `bookImage` | string | Book cover snapshot at borrow time. |
| `userId` | string | Borrower's user ID from the JWT. |
| `userName` | string | Borrower's name from the JWT. |
| `userEmail` | string | Borrower's email from the JWT. |
| `borrowDate` | string (ISO date) | Date the book was borrowed. |
| `borrowedAt` | string (ISO date) | Alias of `borrowDate`. |
| `returnDate` | string (ISO date) | Due date. |
| `dueDate` | string (ISO date) | Alias of `returnDate`. |
| `returnedAt` | string \| null | Return timestamp, or `null` while active. |
| `status` | string | `active` or `returned`. |
| `createdAt` | string (ISO date) | Record creation timestamp. |

The API normalizes legacy field variants when formatting responses (for example, `borrowedAt`/`borrowDate` and `dueDate`/`returnDate`).

---

## Business Rules

- **Availability:** A loan can only be created if `availableCopies > 0`.
- **Atomic decrement:** Availability is decremented with a conditional `$inc` update that requires `availableCopies` to remain greater than zero.
- **No duplicate active loans:** A user cannot borrow the same book twice while an `active` loan exists for their user ID or email.
- **Default loan period:** When no due date is supplied, the due date is set to 14 days from the borrow time.
- **Return:** Returning a book sets `returnedAt`, sets `status` to `returned`, and increments `availableCopies` only if the loan had not already been returned.
- **Delete borrow record:** Deleting a loan also restores a copy if the loan was still active, then removes the record.
- **Delete book restriction:** Books with an active loan cannot be deleted.
- **Copy recalculation:** Updating `totalCopies` recalculates `availableCopies` from the number of active loans, never below zero.
- **Attribution:** Book ownership is recorded from the verified JWT at creation time.
- **User-scoped history:** Borrow listings are always filtered to the authenticated user's ID or email.

---

## Deployment Information

No deployment configuration (Dockerfile, Procfile, CI/CD workflow, hosting manifest, or platform configuration) is included in this repository. The server is a standard long-running Node.js process and can be deployed to any environment that supports Node.js and outbound access to MongoDB and the Next.js auth service.

Deployment checklist:

1. Set `DB_URL`, `PORT`, and `NEXT_PUBLIC_APP_URL` in the hosting environment.
2. Ensure the MongoDB cluster allows connections from the deployment environment.
3. Ensure the Next.js application is publicly reachable at `NEXT_PUBLIC_APP_URL`, because JWKS keys are fetched from `${NEXT_PUBLIC_APP_URL}/api/auth/jwks` for every verification.
4. Start the process with `node index.js` and expose the configured `PORT`.
5. Configure TLS at the platform or reverse-proxy level, since the application itself serves plain HTTP.

Operational notes:

- The database name (`booknook`) is hardcoded in `index.js`.
- CORS is enabled for all origins via `app.use(cors())`.
- The process connects to MongoDB before starting the HTTP listener and exits if `DB_URL` is missing or the initial connection fails.
- There is no health-check endpoint beyond `GET /`, which returns a plain-text message.

---

## Notes & Current Limitations

These reflect the current state of the codebase and may be useful when extending the project:

- `package.json` contains no `start`, `dev`, or build script, and the `test` script is a placeholder that exits with an error.
- `jsonwebtoken` is listed as a dependency but is not imported; JWT verification uses `jose` and a remote JWKS.
- Book mutation routes require a valid token but do not verify that the authenticated user originally added the book.
- Borrow return and delete routes do not verify that the borrow record belongs to the authenticated user.
- Duplicate `/api/...` and unprefixed routes are intentional aliases in the current implementation.
- MongoDB indexes are not created by the application.
- No request logging, rate limiting, or input schema validation library is configured.

---

## License

ISC, as specified in `package.json`.
