const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

const handleError = (res, err, context) => {
  console.error(`Error in ${context}:`, err);
  res.status(500).json({
    success: false,
    message: `Server error while processing ${context}.`,
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const toDateOnly = (val) => {
  const date = new Date(val);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

// Validate and sanitize query parameters
const sanitizeQueryParams = (page, limit) => {
  const parsedPage = parseInt(page) || 1;
  const parsedLimit = parseInt(limit) || 10;
  return {
    page: Math.max(1, parsedPage),
    limit: Math.max(1, Math.min(100, parsedLimit)), // Limit to 100 max for performance
  };
};

// GET patient appointments
router.get("/patient", protect, async (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ success: false, message: "Access denied. Patients only." });
  }

  const { status, from, to, page, limit } = req.query;
  const { page: sanitizedPage, limit: sanitizedLimit } = sanitizeQueryParams(page, limit);
  const query = { patient: req.user.userId };

  if (status) query.status = status;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = toDateOnly(from);
    if (to) query.date.$lte = toDateOnly(to);
  }

  try {
    const result = await Appointment.paginate(query, {
      page: sanitizedPage,
      limit: sanitizedLimit,
      sort: { date: -1 },
      populate: { path: "doctor", select: "name specialization phone" },
    });

    if (result.docs.some((doc) => !doc.doctor)) {
      return res.status(400).json({ success: false, message: "One or more appointments reference invalid doctors." });
    }

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

  const { status, from, to, page, limit } = req.query;
  const { page: sanitizedPage, limit: sanitizedLimit } = sanitizeQueryParams(page, limit);
  const query = { doctor: req.user.userId };

  if (status) query.status = status;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = toDateOnly(from);
    if (to) query.date.$lte = toDateOnly(to);
  }

  try {
    const result = await Appointment.paginate(query, {
      page: sanitizedPage,
      limit: sanitizedLimit,
      sort: { date: -1 },
      populate: { path: "patient", select: "name email phone" },
    });

    if (result.docs.some((doc) => !doc.patient)) {
      return res.status(400).json({ success: false, message: "One or more appointments reference invalid patients." });
    }

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

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const conflict = await Appointment.findOne({
      doctor: doctorId,
      date: {
        $gte: new Date(appointmentDate.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointmentDate.getTime() + 30 * 60 * 1000),
      },
      status: { $in: ["pending", "confirmed"] },
    }).session(session);

    if (conflict) {
      await session.abortTransaction();
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

    const appointment = await Appointment.create(
      [
        {
          patient: req.user.userId,
          doctor: doctorId,
          date: appointmentDate,
          purpose: purpose || "General Consultation",
          notes: notes || "",
          status: "pending",
        },
      ],
      { session }
    );

    const populatedAppointment = await Appointment.populate(appointment[0], [
      { path: "doctor", select: "name specialization phone" },
      { path: "patient", select: "name email" },
    ]);

    if (!populatedAppointment.doctor || !populatedAppointment.patient) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid doctor or patient reference.",
      });
    }

    await session.commitTransaction();
    res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: populatedAppointment,
    });
  } catch (err) {
    await session.abortTransaction();
    handleError(res, err, "book appointment");
  } finally {
    session.endSession();
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

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Find the appointment and ensure it’s pending and belongs to the doctor
    const appointment = await Appointment.findOne({
      _id: id,
      doctor: req.user.userId,
      status: "pending",
    })
      .session(session)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Appointment not found or not eligible for acceptance.",
      });
    }

    if (!appointment.patient || !appointment.doctor) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
    }

    // Ensure the appointment is in the future
    if (appointment.date < new Date()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot accept a past appointment.",
      });
    }

    // Check for conflicting appointments (pending or confirmed)
    const conflict = await Appointment.findOne({
      doctor: req.user.userId,
      date: {
        $gte: new Date(appointment.date.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointment.date.getTime() + 30 * 60 * 1000),
      },
      status: { $in: ["pending", "confirmed"] },
      _id: { $ne: appointment._id },
    }).session(session);

    if (conflict) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "You already have a conflicting appointment at this time.",
        conflictingAppointment: {
          id: conflict._id,
          date: conflict.date,
          patient: conflict.patient,
        },
      });
    }

    // Update the appointment status to confirmed
    const updatedAppointment = await Appointment.findOneAndUpdate(
      { _id: id, doctor: req.user.userId, status: "pending" },
      { status: "confirmed" },
      { new: true, runValidators: true, session }
    )
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!updatedAppointment) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Failed to update appointment. It may no longer be pending.",
      });
    }

    await session.commitTransaction();
    res.json({
      success: true,
      message: "Appointment accepted successfully.",
      data: updatedAppointment,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(`Error accepting appointment ${id} for doctor ${req.user.userId}:`, err);
    handleError(res, err, "accept appointment");
  } finally {
    session.endSession();
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

    if (!appointment.patient || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
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

    if (!appointment.patient || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
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

    if (!appointment.patient || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
    }

    const userId = req.user.userId.toString();
    const isPatient = userId === appointment.patient._id.toString();
    const isDoctor = userId === appointment.doctor._id.toString();

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
