const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

// Utility to normalize date to UTC midnight
const toDateOnly = (val) => {
  const date = new Date(val);
  if (isNaN(date)) return val; // Return as is if invalid date
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Patient ID is required"],
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Doctor ID is required"],
    },
    date: {
      type: Date,
      required: [true, "Appointment date is required"],
      set: toDateOnly,
      get: (val) => (val instanceof Date ? val.toISOString().split("T")[0] : val),
    },
    purpose: {
      type: String,
      trim: true,
      default: "General Consultation",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled", "completed"],
      default: "pending",
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Enable pagination
appointmentSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("Appointment", appointmentSchema);
