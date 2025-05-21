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
    if (from) query.date.$gte = new Date(from);
    if (to) query.date.$lte = new Date(to);
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

  const appointmentDate = new Date(date);
  if (isNaN(appointmentDate) || appointmentDate <= new Date()) {
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
        message: "Doctor already has an appointment at this time.",
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

    // Make sure req.user.userId and appointment.patient._id / doctor._id are strings for comparison
    const userId = req.user.userId.toString();
    const patientId = appointment.patient._id.toString();
    const doctorId = appointment.doctor._id.toString();

    // Check if current user is either patient or doctor in the appointment
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

    // Calculate hours until appointment date
    const hoursUntil = (appointment.date - new Date()) / (1000 * 60 * 60);

    // Patients cannot cancel less than 24 hours before appointment
    if (req.user.role === "patient" && hoursUntil < 24) {
      return res.status(403).json({
        success: false,
        message: "Cannot cancel appointment less than 24 hours before scheduled time.",
      });
    }

    // Doctors can cancel anytime, no restriction

    appointment.status = "cancelled";

    try {
      const savedAppointment = await appointment.save();
      return res.json({
        success: true,
        message: "Appointment cancelled successfully.",
        data: savedAppointment,
      });
    } catch (saveError) {
      console.error("Error saving cancelled appointment:", saveError);
      return res.status(500).json({
        success: false,
        message: "Failed to cancel appointment due to server error.",
        error: saveError.message,
      });
    }
  } catch (err) {
    handleError(res, err, "cancel appointment");
  }
});

// PUT accept appointment (doctor only)
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
