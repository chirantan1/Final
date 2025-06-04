const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

// Utility to strip time and normalize to midnight UTC
const toDateOnly = (val) => {
  const date = new Date(val);
  date.setUTCHours(0, 0, 0, 0); // Set time to 00:00:00 UTC
  return date;
};

const appointmentSchema = new mongoose.Schema({
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
    set: toDateOnly, // store only date without time
    get: (val) => val.toISOString().split("T")[0], // return only YYYY-MM-DD
  },
  purpose: {
    type: String,
    trim: true,
    default: "",
  },
  status: {
    type: String,
    enum: ["pending", "confirmed", "cancelled", "completed"],
    default: "pending",
  },
}, {
  timestamps: true,
  toJSON: { getters: true },   // Enable getter when sending JSON
  toObject: { getters: true }, // Enable getter when converting to object
});

appointmentSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("Appointment", appointmentSchema);
