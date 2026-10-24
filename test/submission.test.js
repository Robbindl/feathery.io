const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createCaptureKey,
  validateJsonValue,
  validateSubmissionBody,
} = require("../server");
const {
  buildReportRows,
  reportToCsv,
  reportToXlsx,
} = require("../report-export");

test("accepts the dynamic JSON shape produced by the capture script", () => {
  assert.equal(
    validateSubmissionBody({
      formId: "/form.feathery.io/to/YAaOHQ",
      pageUrl: "http://localhost:8002/form.feathery.io/to/YAaOHQ",
      data: {
        firstName: "Jane",
        interests: ["loan", "refinance"],
        metadata: { source: "local" },
      },
      clientSubmissionId: "f1d7b3aa-4a74-4a08-8d8d-1e04f1b60361",
    }),
    null,
  );
});

test("rejects invalid submission envelopes", () => {
  assert.equal(validateSubmissionBody({ data: {} }), "formId is required");
  assert.equal(
    validateSubmissionBody({ formId: "/form", data: [] }),
    "data must be an object",
  );
  assert.equal(
    validateSubmissionBody({ formId: "/form", data: {}, pageUrl: 42 }),
    "pageUrl is invalid",
  );
  assert.equal(
    validateSubmissionBody({ formId: "/form", data: {}, clientSubmissionId: "bad id" }),
    "clientSubmissionId is invalid",
  );
});

test("bounds nested payload shape while allowing dynamic fields", () => {
  const tooManyFields = {};
  for (let index = 0; index < 201; index += 1) {
    tooManyFields[`field${index}`] = "value";
  }

  assert.equal(
    validateJsonValue(tooManyFields),
    "data contains too many fields",
  );
  assert.equal(
    validateJsonValue({ $where: "malformed" }),
    "data contains an invalid field name",
  );
});

test("capture keys are stable for one session and isolated across sessions/forms", () => {
  const first = createCaptureKey("a".repeat(64), "/form", "client-id");
  const same = createCaptureKey("a".repeat(64), "/form", "client-id");
  const otherSession = createCaptureKey("b".repeat(64), "/form", "client-id");
  const otherForm = createCaptureKey("a".repeat(64), "/other-form", "client-id");

  assert.equal(first, same);
  assert.notEqual(first, otherSession);
  assert.notEqual(first, otherForm);
});

test("builds flat CSV and XLSX reports from dynamic submission data", () => {
  const report = buildReportRows([
    {
      _id: "abc123",
      formId: "/form",
      pageUrl: "http://localhost/form",
      submittedAt: new Date("2026-10-24T00:00:00.000Z"),
      data: {
        firstName: "Jane",
        employment: { status: "employed" },
        interests: ["home", "car"],
      },
    },
  ]);

  assert.deepEqual(report.columns, [
    "id",
    "formId",
    "pageUrl",
    "submittedAt",
    "firstName",
    "employment.status",
    "interests",
  ]);
  assert.match(reportToCsv(report), /Jane/);

  const workbook = reportToXlsx(report);
  assert.equal(workbook.readUInt32LE(0), 0x04034b50);
  assert.ok(workbook.length > 500);
});
