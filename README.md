# Standalone Feathery form

This folder contains the locally saved form and its Node/Express API. The API
saves form submissions to MongoDB's `submissions` collection.

## Setup

Install Node.js, then install the dependencies from this folder:

```powershell
npm install
```

The `.env.example` file uses local placeholder settings. Copy it to `.env` and
set `MONGODB_URI` to a MongoDB server that is reachable from that PC. Keep the
real `.env` file private. You may also set `SUBMISSION_SESSION_SECRET` to a
long random value if capture sessions should remain stable across server
restarts; otherwise the server generates a process-local secret.

## Run

From this folder:

```powershell
npm start
```

Keep the terminal open while using the form. Open
`http://localhost:8002/form.feathery.io/to/YAaOHQ`. Check the API and MongoDB
connection at `http://localhost:8002/api/health`; `mongo` should be `true`.

Run the automated checks with:

```powershell
npm test
```

For manual reports, open `http://localhost:8002/admin`. The page provides CSV
and Excel downloads generated from the current MongoDB submissions. Keep this
page private because it contains captured form data.

The cloned form disables browser autocomplete and clears browser-restored
visible field values when a new form page is opened. Continuous capture to
MongoDB remains enabled and unchanged.

The existing MongoDB database and submissions remain on the MongoDB server
specified by `MONGODB_URI`. If that URI points to MongoDB on this PC, its
service must be running. This app does not bundle MongoDB itself.
