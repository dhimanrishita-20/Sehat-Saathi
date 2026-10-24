
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  required: { type: Boolean, default: true },
  packed: { type: Boolean, default: false }
});

const visitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    hospital: { type: String, required: true, trim: true },
    doctor: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
    reason: { type: String, default: "", trim: true },
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: ["Upcoming", "Completed", "Cancelled"],
      default: "Upcoming"
    },
    reminderMinutes: { type: Number, default: 60 },
    reminderSent: { type: Boolean, default: false },
    documents: {
      type: [documentSchema],
      default: () => [
        { name: "Government ID proof" },
        { name: "Appointment confirmation" },
        { name: "Previous medical reports" },
        { name: "Current prescriptions" },
        { name: "Insurance card (if applicable)" },
        { name: "Payment method" }
      ]
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Visit", visitSchema);
