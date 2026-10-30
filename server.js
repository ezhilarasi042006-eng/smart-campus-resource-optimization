const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const RESOURCES_FILE = path.join(DATA_DIR, "resources.json");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(ROOT, "public")));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function writeJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}
function getResources() { return readJson(RESOURCES_FILE); }
function getBookings() { return readJson(BOOKINGS_FILE); }
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  return new Date(value).getTime();
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
function makeInsights(resources, bookings) {
  const average = resources.length
    ? Math.round(resources.reduce((sum, item) => sum + Number(item.utilization || 0), 0) / resources.length)
    : 0;
  const high = resources.filter(item => Number(item.utilization) >= 80);
  const low = resources.filter(item => Number(item.utilization) < 40);
  const recommendations = [];
  high.forEach(item => recommendations.push({
    id: `high-${item.id}`, type: "high-demand", priority: "High",
    title: `${item.name} is nearing capacity`,
    message: `Utilization is ${item.utilization}%. Offer alternative rooms or additional time slots to reduce scheduling pressure.`,
    resourceId: item.id, resourceName: item.name
  }));
  low.forEach(item => recommendations.push({
    id: `low-${item.id}`, type: "underused", priority: "Opportunity",
    title: `Improve use of ${item.name}`,
    message: `Utilization is ${item.utilization}%. Promote this resource to suitable classes, clubs, or project teams.`,
    resourceId: item.id, resourceName: item.name
  }));
  if (high.length && low.length) recommendations.push({
    id: "balance-allocation", type: "allocation", priority: "Suggested",
    title: "Balance resource allocation",
    message: `Consider shifting flexible activities from ${high[0].name} to an underused option such as ${low[0].name}, when capacity and equipment requirements match.`,
    resourceId: low[0].id, resourceName: low[0].name
  });
  const now = Date.now();
  const activeBookings = bookings.filter(b => b.status === "Confirmed" && parseDate(b.end) > now).length;
  const upcomingBookings = bookings.filter(b => b.status === "Confirmed" && parseDate(b.start) >= now).length;
  return {
    generatedAt: new Date().toISOString(),
    averageUtilization: average,
    totalResources: resources.length,
    highDemandCount: high.length,
    underutilizedCount: low.length,
    activeBookings,
    upcomingBookings,
    resources: resources.map(r => ({ id: r.id, name: r.name, category: r.category, utilization: Number(r.utilization) })),
    recommendations,
    methodology: "Explainable rule-based prototype: high demand >= 80%, underutilized < 40%. Utilization values are illustrative sample data, not live sensor measurements."
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "Smart Campus Resource Optimization API", timestamp: new Date().toISOString() });
});

app.get("/api/resources", (req, res, next) => {
  try {
    let resources = getResources();
    const category = String(req.query.category || "").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    if (category && category !== "all") resources = resources.filter(r => r.category.toLowerCase() === category);
    if (search) resources = resources.filter(r =>
      [r.name, r.id, r.category, r.location, r.description].some(v => String(v).toLowerCase().includes(search))
    );
    res.json({ resources, total: resources.length });
  } catch (err) { next(err); }
});

app.get("/api/bookings", (req, res, next) => {
  try {
    let bookings = getBookings();
    const status = String(req.query.status || "").trim().toLowerCase();
    if (status && status !== "all") bookings = bookings.filter(b => b.status.toLowerCase() === status);
    bookings.sort((a, b) => parseDate(a.start) - parseDate(b.start));
    res.json({ bookings, total: bookings.length });
  } catch (err) { next(err); }
});

app.get("/api/insights", (_req, res, next) => {
  try { res.json(makeInsights(getResources(), getBookings())); }
  catch (err) { next(err); }
});

app.post("/api/bookings", (req, res, next) => {
  try {
    const body = req.body || {};
    const resourceId = String(body.resourceId || "").trim();
    const bookerName = String(body.bookerName || "").trim();
    const email = String(body.email || "").trim();
    const start = String(body.start || "").trim();
    const end = String(body.end || "").trim();
    const purpose = String(body.purpose || "").trim();

    const missing = [];
    if (!resourceId) missing.push("resource");
    if (!bookerName) missing.push("name");
    if (!email) missing.push("email");
    if (!start) missing.push("start date and time");
    if (!end) missing.push("end date and time");
    if (!purpose) missing.push("purpose");
    if (missing.length) return res.status(400).json({ error: `Please provide: ${missing.join(", ")}.` });
    if (bookerName.length > 100 || purpose.length > 240) {
      return res.status(400).json({ error: "Name must be at most 100 characters and purpose at most 240 characters." });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const startMs = parseDate(start);
    const endMs = parseDate(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return res.status(400).json({ error: "Enter valid start and end date/time values." });
    }
    if (endMs <= startMs) return res.status(400).json({ error: "End time must be later than start time." });
    if (startMs < Date.now() - 60_000) return res.status(400).json({ error: "Bookings cannot start in the past." });

    const resources = getResources();
    const resource = resources.find(r => r.id === resourceId);
    if (!resource) return res.status(404).json({ error: "The selected campus resource was not found." });

    const bookings = getBookings();
    const conflict = bookings.find(b =>
      b.resourceId === resourceId &&
      b.status === "Confirmed" &&
      overlaps(startMs, endMs, parseDate(b.start), parseDate(b.end))
    );
    if (conflict) {
      return res.status(409).json({
        error: `This resource is already booked during that time (${conflict.start.replace("T", " ")} to ${conflict.end.replace("T", " ")}). Choose another time or resource.`,
        conflictBookingId: conflict.id
      });
    }

    const booking = {
      id: `BK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      resourceId, resourceName: resource.name, bookerName, email, start, end, purpose,
      status: "Confirmed", createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    writeJson(BOOKINGS_FILE, bookings);
    res.status(201).json({ message: "Booking created successfully.", booking });
  } catch (err) { next(err); }
});

app.patch("/api/bookings/:id/cancel", (req, res, next) => {
  try {
    const bookingId = String(req.params.id || "").trim();
    const bookings = getBookings();
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    if (booking.status === "Cancelled") return res.status(409).json({ error: "This booking is already cancelled." });
    booking.status = "Cancelled";
    booking.cancelledAt = new Date().toISOString();
    writeJson(BOOKINGS_FILE, bookings);
    res.json({ message: "Booking cancelled successfully.", booking });
  } catch (err) { next(err); }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use((err, _req, res, _next) => {
  console.error("[API error]", err);
  res.status(500).json({ error: "An unexpected server error occurred. Check the terminal for details." });
});

app.listen(PORT, () => {
  console.log(`Smart Campus Resource Optimization System running at http://localhost:${PORT}`);
});
