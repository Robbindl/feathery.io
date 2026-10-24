require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  buildReportRows,
  reportToCsv,
  reportToXlsx,
} = require("./report-export");

const app = express();
const port = Number(process.env.PORT || 8002);
const staticRoot = path.resolve(__dirname, "cloned_site");
const mongoUri = process.env.MONGODB_URI;
const captureScriptTag = '<script src="/submission-capture.js"></script>';
const formResetScriptTag = '<script src="/form-reset.js"></script>';
const sessionCookieName = "feathery_capture_session";
const sessionSecret =
  process.env.SUBMISSION_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const maxJsonDepth = 8;
const maxJsonNodes = 2000;
const maxObjectKeys = 200;
const maxArrayLength = 200;
const maxStringLength = 10000;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonValue(value, pathName = "data", depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > maxJsonNodes) {
    return `${pathName} contains too many values`;
  }

  if (depth > maxJsonDepth) {
    return `${pathName} is nested too deeply`;
  }

  if (value === null || typeof value === "boolean") return null;

  if (typeof value === "string") {
    if (value.length > maxStringLength) {
      return `${pathName} is too long`;
    }
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? null : `${pathName} must contain finite numbers`;
  }

  if (Array.isArray(value)) {
    if (value.length > maxArrayLength) {
      return `${pathName} contains too many items`;
    }

    for (let index = 0; index < value.length; index += 1) {
      const error = validateJsonValue(value[index], `${pathName}[${index}]`, depth + 1, state);
      if (error) return error;
    }
    return null;
  }

  if (!isPlainObject(value)) {
    return `${pathName} must contain JSON values`;
  }

  const keys = Object.keys(value);
  if (keys.length > maxObjectKeys) {
    return `${pathName} contains too many fields`;
  }

  for (const key of keys) {
    if (!key || key.length > 200 || key.startsWith("$") || key.includes("\u0000")) {
      return `${pathName} contains an invalid field name`;
    }

    const error = validateJsonValue(value[key], `${pathName}.${key}`, depth + 1, state);
    if (error) return error;
  }

  return null;
}

function validateSubmissionBody(body) {
  if (!isPlainObject(body)) return "request body must be an object";

  const { formId, pageUrl, data, clientSubmissionId } = body;

  if (typeof formId !== "string" || !formId.trim()) {
    return "formId is required";
  }
  if (formId.length > 200 || controlCharacterPattern.test(formId)) {
    return "formId is invalid";
  }

  if (pageUrl !== undefined && pageUrl !== null) {
    if (typeof pageUrl !== "string" || pageUrl.length > 2000 || controlCharacterPattern.test(pageUrl)) {
      return "pageUrl is invalid";
    }
  }

  if (clientSubmissionId !== undefined && clientSubmissionId !== null) {
    if (typeof clientSubmissionId !== "string") {
      return "clientSubmissionId is invalid";
    }
    const normalizedId = clientSubmissionId.trim();
    if (
      normalizedId.length > 100 ||
      (normalizedId && !/^[A-Za-z0-9._:-]+$/.test(normalizedId))
    ) {
      return "clientSubmissionId is invalid";
    }
  }

  if (!isPlainObject(data)) {
    return "data must be an object";
  }

  return validateJsonValue(data);
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function isValidSessionId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function getCaptureSession(req) {
  const sessionId = readCookie(req, sessionCookieName);
  return isValidSessionId(sessionId) ? sessionId : null;
}

function ensureCaptureSession(req, res) {
  const existingSession = getCaptureSession(req);
  if (existingSession) return existingSession;

  const sessionId = crypto.randomBytes(32).toString("hex");
  const secureFlag = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
  );
  return sessionId;
}

function createCaptureKey(sessionId, formId, clientSubmissionId) {
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(sessionId)
    .update("\u0000")
    .update(formId)
    .update("\u0000")
    .update(clientSubmissionId)
    .digest("hex");
}

const submissionSchema = new mongoose.Schema(
  {
    formId: { type: String, required: true, trim: true, maxlength: 200 },
    pageUrl: { type: String, trim: true, maxlength: 2000 },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    submittedAt: { type: Date, required: true, default: Date.now },
    captureKey: {
      type: String,
      required: true,
      maxlength: 64,
      unique: true,
      sparse: true,
    },
    // Retained for compatibility with older records. New records use captureKey
    // and do not persist the client-controlled identifier as an identity key.
    clientSubmissionId: {
      type: String,
      trim: true,
      maxlength: 100,
    },
  },
  { collection: "submissions" },
);

const Submission = mongoose.model("Submission", submissionSchema);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

app.get("/submission-capture.js", (_req, res) => {
  ensureCaptureSession(_req, res);
  res.sendFile(path.join(__dirname, "submission-capture.js"));
});

app.get("/form-reset.js", (_req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "form-reset.js"));
});

app.post("/api/submit", async (req, res) => {
  const validationError = validateSubmissionBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { formId, pageUrl, data, clientSubmissionId } = req.body;
  const normalizedFormId = formId.trim();
  const normalizedClientId =
    typeof clientSubmissionId === "string" && clientSubmissionId.trim()
      ? clientSubmissionId.trim()
      : null;

  try {
    const submissionFields = {
      formId: normalizedFormId,
      pageUrl: typeof pageUrl === "string" ? pageUrl : undefined,
      data,
      submittedAt: new Date(),
    };

    let submission;
    const captureSession = normalizedClientId ? getCaptureSession(req) : null;
    if (captureSession && normalizedClientId) {
      const captureKey = createCaptureKey(captureSession, normalizedFormId, normalizedClientId);
      submission = await Submission.findOneAndUpdate(
        { captureKey },
        {
          $set: submissionFields,
          $setOnInsert: { captureKey },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
    } else {
      submission = await Submission.create({
        ...submissionFields,
        captureKey: crypto.randomBytes(32).toString("hex"),
      });
    }

    return res.status(201).json({ ok: true, id: submission._id });
  } catch (error) {
    console.error("Failed to save form submission:", error);
    return res.status(500).json({ error: "Unable to save submission" });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

async function loadSubmissionReport() {
  const submissions = await Submission.find({}).sort({ submittedAt: -1 }).lean();
  return buildReportRows(submissions);
}

function reportFilename(extension) {
  return `submissions-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

app.get("/api/export.csv", async (_req, res) => {
  try {
    const report = await loadSubmissionReport();
    res.attachment(reportFilename("csv"));
    res.set("Content-Type", "text/csv; charset=utf-8");
    return res.send(reportToCsv(report));
  } catch (error) {
    console.error("Failed to export CSV report:", error);
    return res.status(500).json({ error: "Unable to export CSV report" });
  }
});

app.get("/api/export.xlsx", async (_req, res) => {
  try {
    const report = await loadSubmissionReport();
    res.attachment(reportFilename("xlsx"));
    res.set(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return res.send(reportToXlsx(report));
  } catch (error) {
    console.error("Failed to export Excel report:", error);
    return res.status(500).json({ error: "Unable to export Excel report" });
  }
});

// Serve the cloned HTML while injecting the capture script. This avoids
// editing the generated one-line Next.js HTML artifact.
app.use((req, res, next) => {
  if (req.method !== "GET") return next();

  const requestPath = decodeURIComponent(req.path);
  const candidate = path.resolve(staticRoot, `.${requestPath}`);
  const htmlPath = path.extname(requestPath)
    ? candidate
    : `${candidate}.html`;
  const rootPrefix = `${staticRoot}${path.sep}`;

  if (!htmlPath.startsWith(rootPrefix) || !fs.existsSync(htmlPath)) {
    return next();
  }

  if (path.extname(htmlPath).toLowerCase() !== ".html") return next();

  ensureCaptureSession(req, res);
  const html = fs.readFileSync(htmlPath, "utf8");
  const withCaptureScript = html.replace(
    "</head>",
    formResetScriptTag + captureScriptTag + "</head>",
  );
  res.type("html").send(withCaptureScript);
});

app.use(express.static(staticRoot, {
  setHeaders: (res, filePath) => {
    // Local clones can retain stale generated JavaScript after an asset is
    // repaired. Avoid serving an old cached copy during local testing.
    if (filePath.toLowerCase().endsWith(".js")) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

async function start() {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set. Copy .env.example to .env and configure it.");
  }

  await mongoose.connect(mongoUri);
  return app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('MongoDB connected; submissions use the "submissions" collection.');
  });
}

module.exports = {
  app,
  createCaptureKey,
  start,
  validateJsonValue,
  validateSubmissionBody,
};

if (require.main === module) {
  start().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
