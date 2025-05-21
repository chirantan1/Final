const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

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
});

appointmentSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("Appointment", appointmentSchema);
