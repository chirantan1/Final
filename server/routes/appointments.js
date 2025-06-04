const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Error handler utility
const handleError = (res, err, context) => {
  console.error(`Error in ${context}:`, err.message);
  res.status(500).json({
    success: false,
    message: "Server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};

// Validate MongoDB ID
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Convert to date-only format (UTC)
const toDateOnly = (val) => {
  const date = new Date(val);
  if (isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

/**
 * @route GET /appointments/patient
 * @desc Get appointments for the logged-in patient
 * @access Private (Patient only)
 */
router.get("/patient", protect, async (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ 
      success: false, 
      message: "Access denied. Patients only." 
    });
  }

  try {
    const { status, from, to, page = 1, limit = 10 } = req.query;
    const query = { patient: req.user.userId };

    // Apply filters if provided
    if (status) query.status = status;
    if (from || to) {
      query.date = {};
      if (from) {
        const fromDate = toDateOnly(from);
        if (!fromDate) return res.status(400).json({ 
          success: false, 
          message: "Invalid 'from' date." 
        });
        query.date.$gte = fromDate;
      }
      if (to) {
        const toDate = toDateOnly(to);
        if (!toDate) return res.status(400).json({ 
          success: false, 
          message: "Invalid 'to' date." 
        });
        query.date.$lte = toDate;
      }
    }

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

/**
 * @route GET /appointments/doctor
 * @desc Get appointments for the logged-in doctor
 * @access Private (Doctor only)
 */
router.get("/doctor", protect, async (req, res) => {
  if (req.user.role !== "doctor") {
    return res.status(403).json({ 
      success: false, 
      message: "Access denied. Doctors only." 
    });
  }

  try {
    const { status, from, to, page = 1, limit = 10 } = req.query;
    const query = { doctor: req.user.userId };

    if (status) query.status = status;
    if (from || to) {
      query.date = {};
      if (from) {
        const fromDate = toDateOnly(from);
        if (!fromDate) return res.status(400).json({ 
          success: false, 
          message: "Invalid 'from' date." 
        });
        query.date.$gte = fromDate;
      }
      if (to) {
        const toDate = toDateOnly(to);
        if (!toDate) return res.status(400).json({ 
          success: false, 
          message: "Invalid 'to' date." 
        });
        query.date.$lte = toDate;
      }
    }

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

/**
 * @route POST /appointments
 * @desc Book a new appointment
 * @access Private (Patient only)
 */
router.post("/", protect, async (req, res) => {
  if (req.user.role !== "patient") {
    return res.status(403).json({ 
      success: false, 
      message: "Access denied. Patients only." 
    });
  }

  try {
    const { doctorId, date, purpose, notes } = req.body;

    // Validate required fields
    if (!doctorId || !date) {
      return res.status(400).json({ 
        success: false, 
        message: "Doctor ID and date are required." 
      });
    }

    if (!isValidId(doctorId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid Doctor ID format." 
      });
    }

    const appointmentDate = new Date(date);
    const today = new Date();

    if (isNaN(appointmentDate.getTime()) || appointmentDate < today) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or past appointment date." 
      });
    }

    // Check for scheduling conflicts
    const conflict = await Appointment.findOne({
      doctor: doctorId,
      date: { 
        $gte: new Date(appointmentDate.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointmentDate.getTime() + 30 * 60 * 1000)
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
          patient: conflict.patient
        }
      });
    }

    // Create new appointment
    const appointment = await Appointment.create({
      patient: req.user.userId,
      doctor: doctorId,
      date: appointmentDate,
      purpose: purpose || "General Consultation",
      notes: notes || "",
      status: "pending",
    });

    // Populate doctor and patient details
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
});

/**
 * @route PATCH /appointments/:id/cancel
 * @desc Cancel an appointment
 * @access Private (Patient or Doctor)
 */
router.patch("/:id/cancel", protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid appointment ID." 
      });
    }

    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ 
        success: false, 
        message: "Appointment not found." 
      });
    }

    const userId = req.user.userId.toString();
    const isPatient = userId === appointment.patient._id.toString();
    const isDoctor = userId === appointment.doctor._id.toString();

    if (!isPatient && !isDoctor) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to cancel this appointment." 
      });
    }

    if (["cancelled", "completed"].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${appointment.status} appointment.`,
        currentStatus: appointment.status
      });
    }

    const now = new Date();
    const hoursUntilAppointment = (appointment.date - now) / (1000 * 60 * 60);

    if (isPatient && hoursUntilAppointment < 24) {
      return res.status(403).json({
        success: false,
        message: "Patients must cancel at least 24 hours before the appointment.",
        hoursRemaining: Math.ceil(hoursUntilAppointment)
      });
    }

    if (isDoctor && hoursUntilAppointment < 1) {
      return res.status(403).json({
        success: false,
        message: "Doctors must cancel at least 1 hour before the appointment.",
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
});

/**
 * @route PUT /appointments/:id/accept
 * @desc Accept a pending appointment
 * @access Private (Doctor only)
 */
router.put("/:id/accept", protect, async (req, res) => {
  if (req.user.role !== "doctor") {
    return res.status(403).json({ 
      success: false, 
      message: "Access denied. Doctors only." 
    });
  }

  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid appointment ID." 
      });
    }

    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ 
        success: false, 
        message: "Appointment not found." 
      });
    }

    if (appointment.doctor._id.toString() !== req.user.userId) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to accept this appointment." 
      });
    }

    if (appointment.status !== "pending") {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot accept a ${appointment.status} appointment.`,
        currentStatus: appointment.status
      });
    }

    const conflictingAppointment = await Appointment.findOne({
      doctor: req.user.userId,
      date: {
        $gte: new Date(appointment.date.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointment.date.getTime() + 30 * 60 * 1000)
      },
      status: "confirmed",
      _id: { $ne: appointment._id }
    });

    if (conflictingAppointment) {
      return res.status(409).json({
        success: false,
        message: "You already have a confirmed appointment at this time.",
        conflictingAppointment: {
          id: conflictingAppointment._id,
          date: conflictingAppointment.date,
          patient: conflictingAppointment.patient
        }
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

/**
 * @route PATCH /appointments/:id/complete
 * @desc Mark an appointment as completed
 * @access Private (Doctor only)
 */
router.patch("/:id/complete", protect, async (req, res) => {
  if (req.user.role !== "doctor") {
    return res.status(403).json({ 
      success: false, 
      message: "Access denied. Doctors only." 
    });
  }

  try {
    const { id } = req.params;
    const { notes, prescription } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid appointment ID." 
      });
    }

    const appointment = await Appointment.findById(id)
      .populate("patient", "name email")
      .populate("doctor", "name email");

    if (!appointment) {
      return res.status(404).json({ 
        success: false, 
        message: "Appointment not found." 
      });
    }

    if (appointment.doctor._id.toString() !== req.user.userId) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to complete this appointment." 
      });
    }

    if (appointment.status !== "confirmed") {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot complete a ${appointment.status} appointment.`,
        currentStatus: appointment.status
      });
    }

    if (appointment.date > new Date()) {
      return res.status(400).json({
        success: false,
        message: "Cannot complete a future appointment.",
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
});

/**
 * @route GET /appointments/:id
 * @desc Get single appointment details
 * @access Private (Patient, Doctor, or Admin)
 */
router.get("/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid appointment ID." 
      });
    }

    const appointment = await Appointment.findById(id)
      .populate("patient", "name email phone")
      .populate("doctor", "name specialization phone");

    if (!appointment) {
      return res.status(404).json({ 
        success: false, 
        message: "Appointment not found." 
      });
    }

    const userId = req.user.userId.toString();
    const isPatient = appointment.patient && userId === appointment.patient._id.toString();
    const isDoctor = appointment.doctor && userId === appointment.doctor._id.toString();

    if (!isPatient && !isDoctor && req.user.role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to view this appointment." 
      });
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
