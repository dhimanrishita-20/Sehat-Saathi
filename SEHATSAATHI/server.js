
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const User = require("./models/User");
const Visit = require("./models/Visit");
const auth = require("./middleware/auth");

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ message: "Sehat Saathi API is running." });
});

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(400).json({
        message: "Enter a name, valid email and password of 8–128 characters."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });

    if (existing) {
      return res.status(409).json({
        message: "An account with this email already exists."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword
    });

    res.status(201).json({
      message: "Registration successful. Please log in."
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This email is already registered."
      });
    }
    console.error(error);
    res.status(500).json({ message: "Could not register." });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        message: "Enter your email and password."
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase()
    }).select("+password");

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: "Incorrect email or password."
      });
    }

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Login failed." });
  }
});

// GET CURRENT USER
app.get("/api/auth/me", auth, async (req, res) => {
  const user = await User.findById(req.userId).select("name email");

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  res.json({ user });
});

// GET ALL VISITS FOR LOGGED-IN USER
app.get("/api/visits", auth, async (req, res) => {
  try {
    const visits = await Visit.find({ user: req.userId })
      .sort({ date: 1 });

    res.json(visits);
  } catch (error) {
    res.status(500).json({ message: "Could not load visits." });
  }
});

// CREATE VISIT
app.post("/api/visits", auth, async (req, res) => {
  try {
    const {
      hospital, doctor, department, reason,
      date, reminderMinutes
    } = req.body;

    if (
      typeof hospital !== "string" ||
      !hospital.trim() ||
      hospital.trim().length > 150 ||
      typeof date !== "string" ||
      !date.trim()
    ) {
      return res.status(400).json({
        message: "Hospital name and appointment date/time are required."
      });
    }

    const appointmentDate = new Date(date);

    if (Number.isNaN(appointmentDate.getTime())) {
      return res.status(400).json({
        message: "Invalid appointment date."
      });
    }

    if (appointmentDate <= new Date()) {
      return res.status(400).json({
        message: "Choose an appointment date and time in the future."
      });
    }

    const allowedReminderMinutes = [0, 15, 30, 60, 1440];

    if (
      reminderMinutes !== undefined &&
      !allowedReminderMinutes.includes(Number(reminderMinutes))
    ) {
      return res.status(400).json({
        message: "Choose a valid reminder interval."
      });
    }

    const cleanText = (value, max = 200) =>
      typeof value === "string" ? value.trim().slice(0, max) : "";

    const visit = await Visit.create({
      user: req.userId,
      hospital: hospital.trim(),
      doctor: cleanText(doctor, 120),
      department: cleanText(department, 120),
      reason: cleanText(reason, 500),
      date: appointmentDate,
      reminderMinutes: Number(reminderMinutes ?? 60)
    });

    res.status(201).json(visit);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not create visit." });
  }
});

// UPDATE VISIT STATUS OR APPOINTMENT DETAILS
app.patch("/api/visits/:id", auth, async (req, res) => {
  try {
    const allowed = [
      "hospital", "doctor", "department",
      "reason", "date", "status", "reminderMinutes"
    ];

    const update = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        update[key] = req.body[key];
      }
    }

    if (update.hospital !== undefined) {
      if (
        typeof update.hospital !== "string" ||
        !update.hospital.trim() ||
        update.hospital.trim().length > 150
      ) {
        return res.status(400).json({
          message: "Enter a valid hospital name."
        });
      }
      update.hospital = update.hospital.trim();
    }

    for (const key of ["doctor", "department", "reason"]) {
      if (update[key] !== undefined) {
        if (typeof update[key] !== "string") {
          return res.status(400).json({
            message: `Invalid ${key}.`
          });
        }
        update[key] = update[key].trim();
      }
    }

    if (update.date !== undefined) {
      const parsed = new Date(update.date);
      if (
        typeof update.date !== "string" ||
        !update.date.trim() ||
        Number.isNaN(parsed.getTime())
      ) {
        return res.status(400).json({
          message: "Invalid appointment date."
        });
      }
      if (parsed <= new Date()) {
        return res.status(400).json({
          message: "Appointment date must be in the future."
        });
      }
      update.date = parsed;
      update.reminderSent = false;
    }

    if (
      update.status !== undefined &&
      !["Upcoming", "Completed", "Cancelled"].includes(update.status)
    ) {
      return res.status(400).json({ message: "Invalid visit status." });
    }

    if (update.status === "Cancelled" || update.status === "Completed") {
      update.reminderSent = true;
    }

    if (update.reminderMinutes !== undefined) {
      const value = Number(update.reminderMinutes);
      if (![0, 15, 30, 60, 1440].includes(value)) {
        return res.status(400).json({
          message: "Invalid reminder interval."
        });
      }
      update.reminderMinutes = value;
      update.reminderSent = false;
    }

    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!visit) {
      return res.status(404).json({ message: "Visit not found." });
    }

    res.json(visit);
  } catch (error) {
    res.status(400).json({ message: "Could not update visit." });
  }
});

// UPDATE A DOCUMENT CHECKBOX
app.patch("/api/visits/:id/documents/:documentId", auth, async (req, res) => {
  try {
    if (typeof req.body.packed !== "boolean") {
      return res.status(400).json({
        message: "packed must be true or false."
      });
    }

    const visit = await Visit.findOne({
      _id: req.params.id,
      user: req.userId
    });

    if (!visit) {
      return res.status(404).json({ message: "Visit not found." });
    }

    const document = visit.documents.id(req.params.documentId);

    if (!document) {
      return res.status(404).json({ message: "Document not found." });
    }

    document.packed = req.body.packed;
    await visit.save();

    res.json(visit);
  } catch (error) {
    res.status(400).json({ message: "Could not update document." });
  }
});

// DELETE VISIT
app.delete("/api/visits/:id", auth, async (req, res) => {
  try {
    const visit = await Visit.findOneAndDelete({
      _id: req.params.id,
      user: req.userId
    });

    if (!visit) {
      return res.status(404).json({ message: "Visit not found." });
    }

    res.json({ message: "Visit deleted successfully." });
  } catch (error) {
    res.status(400).json({ message: "Could not delete visit." });
  }
});

// CONNECT TO MONGODB, THEN START SERVER
async function startServer() {
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
    throw new Error("MONGODB_URI and JWT_SECRET must be configured in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const port = Number(process.env.PORT) || 5000;

  app.listen(port, () => {
    console.log(`Sehat Saathi running at http://localhost:${port}`);
    console.log("MongoDB connected.");
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
