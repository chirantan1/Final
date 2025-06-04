// appointmentRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

const handleError = (res, err, context) => {
  console.error(`Error in ${context}:`, err.stack); // Include full stack trace for debugging
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
  if (!req.user || req.user.role !== "patient") {
    console.error("Access denied: Invalid user or role", { user: req.user });
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
      console.error("Invalid doctor references in appointments", { query, userId: req.user.userId });
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
  if (!req.user || req.user.role !== "doctor") {
    console.error("Access denied: Invalid user or role", { user: req.user });
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
      console.error("Invalid patient references in appointments", { query, userId: req.user.userId });
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
  if (!req.user || req.user.role !== "patient") {
    console.error("Access denied: Invalid user or role", { user: req.user });
    return res.status(403).json({ success: false, message: "Access denied. Patients only." });
  }

  const { doctorId, date, purpose, notes } = req.body;
  if (!doctorId || !date) {
    console.error("Missing required fields", { doctorId, date });
    return res.status(400).json({ success: false, message: "Doctor ID and date are required." });
  }

  if (!isValidId(doctorId)) {
    console.error("Invalid Doctor ID format", { doctorId });
    return res.status(400).json({ success: false, message: "Invalid Doctor ID format." });
  }

  const appointmentDate = new Date(date);
  const today = new Date();
  if (isNaN(appointmentDate.getTime()) || appointmentDate < today) {
    console.error("Invalid or past appointment date", { date });
    return res.status(400).json({ success: false, message: "Invalid or past appointment date." });
  }

  const useTransactions = process.env.NODE_ENV === "production";
  let session = null;

  try {
    if (useTransactions) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const conflict = await Appointment.findOne({
      doctor: doctorId,
      date: {
        $gte: new Date(appointmentDate.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointmentDate.getTime() + 30 * 60 * 1000),
      },
      status: { $in: ["pending", "confirmed"] },
    }).session(useTransactions ? session : null);

    if (conflict) {
      console.error("Conflicting appointment found", {
        doctorId,
        date: appointmentDate,
        conflictId: conflict._id,
      });
      if (useTransactions) await session.abortTransaction();
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
      { session: useTransactions ? session : null }
    );

    const populatedAppointment = await Appointment.populate(appointment[0], [
      { path: "doctor", select: "name specialization phone" },
      { path: "patient", select: "name email" },
    ]);

    if (!populatedAppointment.doctor || !populatedAppointment.patient) {
      console.error("Invalid doctor or patient reference", {
        doctor: populatedAppointment.doctor,
        patient: populatedAppointment.patient,
      });
      if (useTransactions) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid doctor or patient reference.",
      });
    }

    if (useTransactions) await session.commitTransaction();
    res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: populatedAppointment,
    });
  } catch (err) {
    console.error(`Error booking appointment for doctor ${doctorId}:`, err.stack);
    if (useTransactions && session) await session.abortTransaction();
    handleError(res, err, "book appointment");
  } finally {
    if (useTransactions && session) session.endSession();
  }
});

// PUT accept appointment
router.put("/:id/accept", protect, async (req, res) => {
  if (!req.user || req.user.role !== "doctor") {
    console.error("Access denied: Invalid user or role", { user: req.user });
    return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
  }

  const { id } = req.params;
  if (!isValidId(id)) {
    console.error("Invalid appointment ID:", id);
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  const useTransactions = process.env.NODE_ENV === "production";
  let session = null;

  try {
    if (useTransactions) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    console.log(`Attempting to accept appointment ${id} by doctor ${req.user.userId}`);

    // Find the appointment
    const query = { _id: id, doctor: req.user.userId, status: "pending" };
    const appointment = await Appointment.findOne(query)
      .populate("patient", "name email")
      .populate("doctor", "name email")
      .session(useTransactions ? session : null);

    if (!appointment) {
      console.error("Appointment not found or not eligible", { id, doctorId: req.user.userId });
      if (useTransactions) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Appointment not found or not eligible for acceptance.",
      });
    }

    // Validate populated fields
    if (!appointment.patient || !appointment.doctor) {
      console.error("Invalid appointment: missing patient or doctor", {
        appointmentId: id,
        patient: appointment.patient,
        doctor: appointment.doctor,
      });
      if (useTransactions) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
    }

    // Ensure the appointment is in the future
    if (appointment.date < new Date()) {
      console.error("Cannot accept past appointment", { appointmentId: id, date: appointment.date });
      if (useTransactions) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot accept a past appointment.",
      });
    }

    // Check for conflicting appointments
    const conflict = await Appointment.findOne({
      doctor: req.user.userId,
      date: {
        $gte: new Date(appointment.date.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointment.date.getTime() + 30 * 60 * 1000),
      },
      status: { $in: ["pending", "confirmed"] },
      _id: { $ne: appointment._id },
    }).session(useTransactions ? session : null);

    if (conflict) {
      console.error("Conflicting appointment found", {
        appointmentId: id,
        conflictId: conflict._id,
        conflictDate: conflict.date,
      });
      if (useTransactions) await session.abortTransaction();
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
      query,
      { status: "confirmed" },
      { new: true, runValidators: true }
    )
      .populate("patient", "name email")
      .populate("doctor", "name email")
      .session(useTransactions ? session : null);

    if (!updatedAppointment) {
      console.error("Failed to update appointment", { id, doctorId: req.user.userId });
      if (useTransactions) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Failed to update appointment. It may no longer be pending.",
      });
    }

    if (useTransactions) await session.commitTransaction();
    res.json({
      success: true,
      message: "Appointment accepted successfully.",
      data: updatedAppointment,
    });
  } catch (err) {
    console.error(`Error accepting appointment ${id} for doctor ${req.user.userId}:`, err.stack);
    if (useTransactions && session) await session.abortTransaction();
    handleError(res, err, "accept appointment");
  } finally {
    if (useTransactions && session) session.endSession();
  }
});

// PATCH cancel appointment
router.patch("/:id/cancel", protect, async (req, res) => {
  if (!req.user) {
    console.error("Access denied: No user provided", { user: req.user });
    return res.status(403).json({ success: false, message: "Access denied. Authentication required." });
  }

  const { id } = req.params;
  if (!isValidId(id)) {
    console.error("Invalid appointment ID", { id });
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      console.error("Appointment not found", { id });
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (!appointment.patient || !appointment.doctor) {
      console.error("Invalid appointment: missing patient or doctor", {
        appointmentId: id,
        patient: appointment.patient,
        doctor: appointment.doctor,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
    }

    const userId = req.user.userId.toString();
    const isPatient = userId === appointment.patient._id.toString();
    const isDoctor = userId === appointment.doctor._id.toString();

    if (!isPatient && !isDoctor) {
      console.error("Unauthorized attempt to cancel appointment", { userId, appointmentId: id });
      return res.status(403).json({ success: false, message: "Not authorized to cancel this appointment." });
    }

    if (["cancelled", "completed"].includes(appointment.status)) {
      console.error("Cannot cancel appointment in current status", { appointmentId: id, status: appointment.status });
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${appointment.status} appointment.`,
      });
    }

    const now = new Date();
    const hoursUntilAppointment = (appointment.date - now) / (1000 * 60 * 60);

    if (isPatient && hoursUntilAppointment < 24) {
      console.error("Patient cancellation too late", { appointmentId: id, hoursUntilAppointment });
      return res.status(403).json({
        success: false,
        message: "Patients must cancel at least 24 hours before the appointment.",
      });
    }

    if (isDoctor && hoursUntilAppointment < 1) {
      console.error("Doctor cancellation too late", { appointmentId: id, hoursUntilAppointment });
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
    console.error(`Error cancelling appointment ${id}:`, err.stack);
    handleError(res, err, "cancel appointment");
  }
});

// PATCH complete appointment
router.patch("/:id/complete", protect, async (req, res) => {
  if (!req.user || req.user.role !== "doctor") {
    console.error("Access denied: Invalid user or role", { user: req.user });
    return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
  }

  const { id } = req.params;
  const { notes, prescription } = req.body;

  if (!isValidId(id)) {
    console.error("Invalid appointment ID", { id });
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      console.error("Appointment not found", { id });
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (!appointment.patient || !appointment.doctor) {
      console.error("Invalid appointment: missing patient or doctor", {
        appointmentId: id,
        patient: appointment.patient,
        doctor: appointment.doctor,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
    }

    if (appointment.doctor._id.toString() !== req.user.userId) {
      console.error("Unauthorized attempt to complete appointment", { userId: req.user.userId, appointmentId: id });
      return res.status(403).json({ success: false, message: "Not authorized to complete this appointment." });
    }

    if (appointment.status !== "confirmed") {
      console.error("Cannot complete appointment in current status", { appointmentId: id, status: appointment.status });
      return res.status(400).json({ success: false, message: `Cannot complete a ${appointment.status} appointment.` });
    }

    if (appointment.date > new Date()) {
      console.error("Cannot complete future appointment", { appointmentId: id, date: appointment.date });
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
    console.error(`Error completing appointment ${id}:`, err.stack);
    handleError(res, err, "complete appointment");
  }
});

// GET single appointment details
router.get("/:id", protect, async (req, res) => {
  if (!req.user) {
    console.error("Access denied: No user provided", { user: req.user });
    return res.status(403).json({ success: false, message: "Access denied. Authentication required." });
  }

  const { id } = req.params;
  if (!isValidId(id)) {
    console.error("Invalid appointment ID", { id });
    return res.status(400).json({ success: false, message: "Invalid appointment ID." });
  }

  try {
    const appointment = await Appointment.findById(id)
      .populate("patient", "name email phone")
      .populate("doctor", "name specialization phone");

    if (!appointment) {
      console.error("Appointment not found", { id });
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (!appointment.patient || !appointment.doctor) {
      console.error("Invalid appointment: missing patient or doctor", {
        appointmentId: id,
        patient: appointment.patient,
        doctor: appointment.doctor,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid appointment: patient or doctor not found.",
      });
    }

    const userId = req.user.userId.toString();
    const isPatient = userId === appointment.patient._id.toString();
    const isDoctor = userId === appointment.doctor._id.toString();

    if (!isPatient && !isDoctor && req.user.role !== "admin") {
      console.error("Unauthorized attempt to view appointment", { userId, appointmentId: id });
      return res.status(403).json({ success: false, message: "Not authorized to view this appointment." });
    }

    res.json({
      success: true,
      data: appointment,
    });
  } catch (err) {
    console.error(`Error getting appointment details ${id}:`, err.stack);
    handleError(res, err, "get appointment details");
  }
});

module.exports = router;
