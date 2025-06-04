const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { body, param, query } = require("express-validator");
const validate = require("../middleware/validate");

const router = express.Router();

// Enhanced error handler
const handleError = (res, err, context) => {
  console.error(`Error in ${context}:`, err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Server error",
    error: process.env.NODE_ENV === "development" ? {
      message: err.message,
      stack: err.stack,
      ...err
    } : undefined,
  });
};

// Utility functions
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeDate = (val) => {
  const date = new Date(val);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const checkTimeSlotConflict = async (doctorId, date, appointmentId = null) => {
  return await Appointment.findOne({
    doctor: doctorId,
    date: { 
      $gte: new Date(date.getTime() - 30 * 60 * 1000),
      $lte: new Date(date.getTime() + 30 * 60 * 1000)
    },
    status: { $in: ["pending", "confirmed"] },
    ...(appointmentId && { _id: { $ne: appointmentId } })
  });
};

// GET doctor details
router.get("/doctors/me", 
  protect,
  async (req, res) => {
    if (req.user.role !== "doctor") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Doctors only.",
        code: "ACCESS_DENIED"
      });
    }

    try {
      const doctor = await User.findById(req.user.userId)
        .select("name email phone specialization");
      
      if (!doctor) {
        return res.status(404).json({ 
          success: false, 
          message: "Doctor not found.",
          code: "NOT_FOUND"
        });
      }

      res.json({
        success: true,
        data: doctor
      });
    } catch (err) {
      handleError(res, err, "get doctor details");
    }
  }
);

// GET patient appointments with validation
router.get("/patient", 
  protect,
  [
    query("status").optional().isIn(["pending", "confirmed", "cancelled", "completed"]),
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    validate
  ],
  async (req, res) => {
    if (req.user.role !== "patient") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Patients only.",
        code: "ACCESS_DENIED"
      });
    }

    const { status, from, to, page = 1, limit = 10 } = req.query;
    const query = { patient: req.user.userId };

    if (status) query.status = status;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = normalizeDate(from);
      if (to) query.date.$lte = normalizeDate(to);
    }

    try {
      const result = await Appointment.paginate(query, {
        page,
        limit,
        sort: { date: -1 },
        populate: { 
          path: "doctor", 
          select: "name specialization phone" 
        },
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
  }
);

// GET doctor appointments with validation
router.get("/doctor", 
  protect,
  [
    query("status").optional().isIn(["pending", "confirmed", "cancelled", "completed"]),
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    validate
  ],
  async (req, res) => {
    if (req.user.role !== "doctor") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Doctors only.",
        code: "ACCESS_DENIED"
      });
    }

    const { status, from, to, page = 1, limit = 10 } = req.query;
    const query = { doctor: req.user.userId };

    if (status) query.status = status;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = normalizeDate(from);
      if (to) query.date.$lte = normalizeDate(to);
    }

    try {
      const result = await Appointment.paginate(query, {
        page,
        limit,
        sort: { date: -1 },
        populate: { 
          path: "patient", 
          select: "name email phone" 
        },
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
  }
);

// POST book appointment with validation
router.post("/", 
  protect,
  [
    body("doctorId").notEmpty().custom(isValidId).withMessage("Invalid Doctor ID format"),
    body("date").notEmpty().isISO8601().withMessage("Invalid date format"),
    body("purpose").optional().trim().escape(),
    body("notes").optional().trim().escape(),
    validate
  ],
  async (req, res) => {
    if (req.user.role !== "patient") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Patients only.",
        code: "ACCESS_DENIED"
      });
    }

    const { doctorId, date, purpose, notes } = req.body;

    try {
      const appointmentDate = new Date(date);
      const today = new Date();

      if (isNaN(appointmentDate.getTime())) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid appointment date.",
          code: "INVALID_DATE"
        });
      }

      if (appointmentDate < today) {
        return res.status(400).json({ 
          success: false, 
          message: "Cannot book appointment in the past.",
          code: "PAST_DATE"
        });
      }

      const conflict = await checkTimeSlotConflict(doctorId, appointmentDate);
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: "Doctor already has an appointment at this time.",
          code: "SCHEDULE_CONFLICT",
          conflictingAppointment: {
            id: conflict._id,
            date: conflict.date,
            patient: conflict.patient
          }
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
        { path: "patient", select: "name email" }
      ]);

      res.status(201).json({
        success: true,
        message: "Appointment booked successfully",
        data: populatedAppointment,
      });
    } catch (err) {
      handleError(res, err, "book appointment");
    }
  }
);

// PATCH cancel appointment with validation
router.patch("/:id/cancel", 
  protect,
  [
    param("id").custom(isValidId).withMessage("Invalid appointment ID"),
    body("reason").optional().trim().escape(),
    validate
  ],
  async (req, res) => {
    const { id } = req.params;

    try {
      const appointment = await Appointment.findById(id)
        .populate("patient", "name email")
        .populate("doctor", "name email");

      if (!appointment) {
        return res.status(404).json({ 
          success: false, 
          message: "Appointment not found.",
          code: "NOT_FOUND"
        });
      }

      const userId = req.user.userId.toString();
      const isPatient = userId === appointment.patient._id.toString();
      const isDoctor = userId === appointment.doctor._id.toString();

      if (!isPatient && !isDoctor) {
        return res.status(403).json({ 
          success: false, 
          message: "Not authorized to cancel this appointment.",
          code: "UNAUTHORIZED"
        });
      }

      if (["cancelled", "completed"].includes(appointment.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel a ${appointment.status} appointment.`,
          code: "INVALID_STATUS",
          currentStatus: appointment.status
        });
      }

      const now = new Date();
      const hoursUntilAppointment = (appointment.date - now) / (1000 * 60 * 60);

      if (isPatient && hoursUntilAppointment < 24) {
        return res.status(403).json({
          success: false,
          message: "Patients must cancel at least 24 hours before the appointment.",
          code: "CANCELLATION_WINDOW",
          hoursRemaining: Math.ceil(hoursUntilAppointment)
        });
      }

      if (isDoctor && hoursUntilAppointment < 1) {
        return res.status(403).json({
          success: false,
          message: "Doctors must cancel at least 1 hour before the appointment.",
          code: "CANCELLATION_WINDOW",
          hoursRemaining: Math.ceil(hoursUntilAppointment)
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
  }
);

// PUT accept appointment with validation
router.put("/:id/accept", 
  protect,
  [
    param("id").custom(isValidId).withMessage("Invalid appointment ID"),
    validate
  ],
  async (req, res) => {
    if (req.user.role !== "doctor") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Doctors only.",
        code: "ACCESS_DENIED"
      });
    }

    const { id } = req.params;

    try {
      const appointment = await Appointment.findById(id)
        .populate("patient", "name email")
        .populate("doctor", "name email");

      if (!appointment) {
        return res.status(404).json({ 
          success: false, 
          message: "Appointment not found.",
          code: "NOT_FOUND"
        });
      }

      if (appointment.doctor._id.toString() !== req.user.userId) {
        return res.status(403).json({ 
          success: false, 
          message: "Not authorized to accept this appointment.",
          code: "UNAUTHORIZED"
        });
      }

      if (appointment.status !== "pending") {
        return res.status(400).json({ 
          success: false, 
          message: `Cannot accept a ${appointment.status} appointment.`,
          code: "INVALID_STATUS",
          currentStatus: appointment.status
        });
      }

      const conflict = await checkTimeSlotConflict(
        req.user.userId, 
        appointment.date, 
        appointment._id
      );

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: "You already have a confirmed appointment at this time.",
          code: "SCHEDULE_CONFLICT",
          conflictingAppointment: {
            id: conflict._id,
            date: conflict.date,
            patient: conflict.patient
          }
        });
      }

      appointment.status = "confirmed";
      await appointment.save();

      const populatedAppointment = await Appointment.findById(appointment._id)
        .populate("patient", "name email")
        .populate("doctor", "name email");

      res.json({
        success: true,
        message: "Appointment accepted successfully.",
        data: populatedAppointment,
      });
    } catch (err) {
      handleError(res, err, "accept appointment");
    }
  }
);

// PATCH complete appointment with validation
router.patch("/:id/complete", 
  protect,
  [
    param("id").custom(isValidId).withMessage("Invalid appointment ID"),
    body("notes").optional().trim().escape(),
    body("prescription").optional().trim().escape(),
    validate
  ],
  async (req, res) => {
    if (req.user.role !== "doctor") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Doctors only.",
        code: "ACCESS_DENIED"
      });
    }

    const { id } = req.params;
    const { notes, prescription } = req.body;

    try {
      const appointment = await Appointment.findById(id)
        .populate("patient", "name email")
        .populate("doctor", "name email");

      if (!appointment) {
        return res.status(404).json({ 
          success: false, 
          message: "Appointment not found.",
          code: "NOT_FOUND"
        });
      }

      if (appointment.doctor._id.toString() !== req.user.userId) {
        return res.status(403).json({ 
          success: false, 
          message: "Not authorized to complete this appointment.",
          code: "UNAUTHORIZED"
        });
      }

      if (appointment.status !== "confirmed") {
        return res.status(400).json({ 
          success: false, 
          message: `Cannot complete a ${appointment.status} appointment.`,
          code: "INVALID_STATUS",
          currentStatus: appointment.status
        });
      }

      if (appointment.date > new Date()) {
        return res.status(400).json({
          success: false,
          message: "Cannot complete a future appointment.",
          code: "FUTURE_APPOINTMENT",
          appointmentDate: appointment.date,
          currentDate: new Date()
        });
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
  }
);

// GET single appointment details with validation
router.get("/:id", 
  protect,
  [
    param("id").custom(isValidId).withMessage("Invalid appointment ID"),
    validate
  ],
  async (req, res) => {
    const { id } = req.params;

    try {
      const appointment = await Appointment.findById(id)
        .populate("patient", "name email phone")
        .populate("doctor", "name specialization phone");

      if (!appointment) {
        return res.status(404).json({ 
          success: false, 
          message: "Appointment not found.",
          code: "NOT_FOUND"
        });
      }

      const userId = req.user.userId.toString();
      const isPatient = appointment.patient && userId === appointment.patient._id.toString();
      const isDoctor = appointment.doctor && userId === appointment.doctor._id.toString();

      if (!isPatient && !isDoctor && req.user.role !== "admin") {
        return res.status(403).json({ 
          success: false, 
          message: "Not authorized to view this appointment.",
          code: "UNAUTHORIZED"
        });
      }

      res.json({
        success: true,
        data: appointment,
      });
    } catch (err) {
      handleError(res, err, "get appointment details");
    }
  }
);

module.exports = router;
