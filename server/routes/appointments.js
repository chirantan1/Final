const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

const handleError = (res, err, context) => {
  console.error(`Error in ${context}:`, err.message);
  res.status(500).json({
    success: false,
    message: "Server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const toDateOnly = (val) => {
  const date = new Date(val);
  date.setUTCHours(0, 0, 0, 0); // reset time to 00:00:00.000 UTC
  return date;
};
// GET patient appointments
router.get("/patient", protect, async (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ success: false, message: "Access denied. Patients only." });
  }

  const { page = 1, limit = 10 } = req.query;

  try {
    const result = await Appointment.paginate(
      { patient: req.user.userId },
      {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { date: -1 },
        populate: { path: "doctor", select: "name specialization phone" },
      }
    );

    res.json({
      success: true,
      data: result.docs,
      total: result.totalDocs,
      pages: result.totalPages,
      currentPage: result.page,
    });
  } catch (err) {
    handleError(res, err, "get patient appointments");
  }
});

// GET doctor appointments
router.get("/doctor", protect, async (req, res) => {
  if (req.user.role !== "doctor") {
    return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
  }

  const { status, from, to, page = 1, limit = 10 } = req.query;
  const query = { doctor: req.user.userId };

  if (status) query.status = status;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = toDateOnly(from);
    if (to) query.date.$lte = toDateOnly(to);
  }

  try {
    const result = await Appointment.paginate(query, {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { date: -1 },
      populate: { path: "patient", select: "name email phone" },
    });

    res.json({
      success: true,
      data: result.docs,
      total: result.totalDocs,
      pages: result.totalPages,
      currentPage: result.page,
      filters: { status, from, to },
    });
  } catch (err) {
    handleError(res, err, "get doctor appointments");
  }
});

// POST book appointment
router.post("/", protect, async (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ success: false, message: "Access denied. Patients only." });
  }

  const { doctorId, date, purpose } = req.body;

  if (!doctorId || !date) {
    return res.status(400).json({ success: false, message: "Doctor ID and date are required." });
  }

  if (!isValidId(doctorId)) {
    return res.status(400).json({ success: false, message: "Invalid Doctor ID format." });
  }

  const appointmentDate = toDateOnly(date);
  const today = toDateOnly(new Date());

  if (isNaN(appointmentDate) || appointmentDate < today) {
    return res.status(400).json({ success: false, message: "Invalid or past appointment date." });
  }

  try {
    const conflict = await Appointment.findOne({
      doctor: doctorId,
      date: appointmentDate,
      status: { $in: ["pending", "confirmed"] },
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: "Doctor already has an appointment on this date.",
      });
    }

    const appointment = await Appointment.create({
      patient: req.user.userId,
      doctor: doctorId,
      date: appointmentDate,
      purpose: purpose || "",
      status: "pending",
    });

    const populatedAppointment = await Appointment.populate(appointment, {
      path: "doctor",
      select: "name specialization phone",
    });

    res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: populatedAppointment,
    });
  } catch (err) {
    handleError(res, err, "book appointment");
  }
});

// PATCH cancel appointment
router.patch("/:id/cancel", protect, async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id).populate("patient doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    const userId = req.user.userId.toString();
    const patientId = appointment.patient._id.toString();
    const doctorId = appointment.doctor._id.toString();

    const isOwner = userId === patientId || userId === doctorId;

    if (!isOwner) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this appointment." });
    }

    if (["cancelled", "completed"].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${appointment.status} appointment.`,
      });
    }

    const today = toDateOnly(new Date());
    const appointmentDate = toDateOnly(appointment.date);

    const daysUntil = (appointmentDate - today) / (1000 * 60 * 60 * 24);

    if (req.user.role === "patient" && daysUntil < 1) {
      return res.status(403).json({
        success: false,
        message: "Cannot cancel appointment less than 1 day before.",
      });
    }

    appointment.status = "cancelled";
    const savedAppointment = await appointment.save();

    return res.json({
      success: true,
      message: "Appointment cancelled successfully.",
      data: savedAppointment,
    });
  } catch (err) {
    handleError(res, err, "cancel appointment");
  }
});

// PUT accept appointment
router.put("/:id/accept", protect, async (req, res) => {
  if (req.user.role !== "doctor") {
    return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
  }

  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (appointment.doctor.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to accept this appointment." });
    }

    if (appointment.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only pending appointments can be accepted." });
    }

    appointment.status = "confirmed";
    await appointment.save();

    res.json({
      success: true,
      message: "Appointment accepted successfully.",
      data: appointment,
    });
  } catch (err) {
    handleError(res, err, "accept appointment");
  }
});

module.exports = router;
