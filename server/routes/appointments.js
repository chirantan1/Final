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
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

// GET patient appointments
router.get("/patient", protect, async (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ success: false, message: "Access denied. Patients only." });
  }

  const { status, from, to, page = 1, limit = 10 } = req.query;
  const query = { patient: req.user.userId };

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
      populate: { path: "doctor", select: "name specialization phone" },
    });

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

  const { doctorId, date, purpose, notes } = req.body;
  if (!doctorId || !date) {
    return res.status(400).json({ success: false, message: "Doctor ID and date are required." });
  }

  if (!isValidId(doctorId)) {
    return res.status(400).json({ success: false, message: "Invalid Doctor ID format." });
  }

  const appointmentDate = new Date(date);
  const today = new Date();
  if (isNaN(appointmentDate.getTime()) || appointmentDate < today) {
    return res.status(400).json({ success: false, message: "Invalid or past appointment date." });
  }

  try {
    const conflict = await Appointment.findOne({
      doctor: doctorId,
      date: {
        $gte: new Date(appointmentDate.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointmentDate.getTime() + 30 * 60 * 1000),
      },
      status: { $in: ["pending", "confirmed"] },
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: "Doctor already has an appointment at this time.",
        conflictingAppointment: {
          id: conflict._id,
          date: conflict.date,
          patient: conflict.patient,
        },
      });
    }

    const appointment = await Appointment.create({
      patient: req.user.userId,
      doctor: doctorId,
      date: appointmentDate,
      purpose: purpose || "General Consultation",
      notes: notes || "",
      status: "pending",
    });

    const populatedAppointment = await Appointment.populate(appointment, [
      { path: "doctor", select: "name specialization phone" },
      { path: "patient", select: "name email" },
    ]);

    res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: populatedAppointment,
    });
  } catch (err) {
    handleError(res, err, "book appointment");
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
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (appointment.doctor._id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Not authorized to accept this appointment." });
    }

    if (appointment.status !== "pending") {
      return res.status(400).json({ success: false, message: `Cannot accept a ${appointment.status} appointment.` });
    }

    const conflict = await Appointment.findOne({
      doctor: req.user.userId,
      date: {
        $gte: new Date(appointment.date.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointment.date.getTime() + 30 * 60 * 1000),
      },
      status: "confirmed",
      _id: { $ne: appointment._id },
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: "You already have a confirmed appointment at this time.",
        conflictingAppointment: {
          id: conflict._id,
          date: conflict.date,
          patient: conflict.patient,
        },
      });
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

// PATCH cancel appointment
router.patch("/:id/cancel", protect, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    const userId = req.user.userId.toString();
    const isPatient = userId === appointment.patient._id.toString();
    const isDoctor = userId === appointment.doctor._id.toString();

    if (!isPatient && !isDoctor) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this appointment." });
    }

    if (["cancelled", "completed"].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${appointment.status} appointment.`,
      });
    }

    const now = new Date();
    const hoursUntilAppointment = (appointment.date - now) / (1000 * 60 * 60);

    if (isPatient && hoursUntilAppointment < 24) {
      return res.status(403).json({
        success: false,
        message: "Patients must cancel at least 24 hours before the appointment.",
      });
    }

    if (isDoctor && hoursUntilAppointment < 1) {
      return res.status(403).json({
        success: false,
        message: "Doctors must cancel at least 1 hour before the appointment.",
      });
    }

    appointment.status = "cancelled";
    appointment.cancelledBy = req.user.role;
    appointment.cancellationReason = req.body.reason || "No reason provided";

    await appointment.save();

    res.json({
      success: true,
      message: "Appointment cancelled successfully.",
      data: appointment,
    });
  } catch (err) {
    handleError(res, err, "cancel appointment");
  }
});

// PATCH complete appointment
router.patch("/:id/complete", protect, async (req, res) => {
  if (req.user.role !== "doctor") {
    return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
  }

  const { id } = req.params;
  const { notes, prescription } = req.body;

  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (appointment.doctor._id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: "Not authorized to complete this appointment." });
    }

    if (appointment.status !== "confirmed") {
      return res.status(400).json({ success: false, message: `Cannot complete a ${appointment.status} appointment.` });
    }

    if (appointment.date > new Date()) {
      return res.status(400).json({ success: false, message: "Cannot complete a future appointment." });
    }

    appointment.status = "completed";
    appointment.notes = notes || appointment.notes;
    appointment.prescription = prescription || appointment.prescription;
    appointment.completedAt = new Date();

    await appointment.save();

    res.json({
      success: true,
      message: "Appointment marked as completed.",
      data: appointment,
    });
  } catch (err) {
    handleError(res, err, "complete appointment");
  }
});

// GET single appointment details
router.get("/:id", protect, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email phone")
      .populate("doctor", "name specialization phone");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    const userId = req.user.userId.toString();
    const isPatient = appointment.patient && userId === appointment.patient._id.toString();
    const isDoctor = appointment.doctor && userId === appointment.doctor._id.toString();

    if (!isPatient && !isDoctor && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized to view this appointment." });
    }

    res.json({
      success: true,
      data: appointment,
    });
  } catch (err) {
    handleError(res, err, "get appointment details");
  }
});

module.exports = router;
