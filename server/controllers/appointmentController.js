const Appointment = require("../models/Appointment");

// @desc    Get patient appointments
// @route   GET /api/appointments/patient
// @access  Private (Patient only)
exports.getPatientAppointments = async (req, res) => {
  try {
    if (req.user.role !== "patient") {
      return res.status(403).json({ success: false, message: "Access denied. Patients only." });
    }

    const appointments = await Appointment.find({ patient: req.user.userId })
      .populate("doctor", "name specialization")
      .sort({ date: -1 });

    res.json({ success: true, count: appointments.length, data: appointments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Get doctor appointments
// @route   GET /api/appointments/doctor
// @access  Private (Doctor only)
exports.getDoctorAppointments = async (req, res) => {
  try {
    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
    }

    const appointments = await Appointment.find({ doctor: req.user.userId })
      .populate("patient", "name email")
      .sort({ date: -1 });

    res.json({ success: true, count: appointments.length, data: appointments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Book an appointment
// @route   POST /api/appointments
// @access  Private (Patient only)
exports.bookAppointment = async (req, res) => {
  try {
    if (req.user.role !== "patient") {
      return res.status(403).json({ success: false, message: "Access denied. Patients only." });
    }

    const { doctorId, date, purpose } = req.body;

    if (!doctorId || !date) {
      return res.status(400).json({ success: false, message: "Doctor ID and date are required" });
    }

    const appointment = await Appointment.create({
      patient: req.user.userId,
      doctor: doctorId,
      date,
      purpose,
      status: "pending",
    });

    res.status(201).json({ success: true, data: appointment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Cancel an appointment
// @route   PATCH /api/appointments/:id/cancel
// @access  Private (Patient or Doctor)
exports.cancelAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    // Debug logs
    console.log("User ID:", req.user.userId);
    console.log("Patient ID:", appointment.patient.toString());
    console.log("Doctor ID:", appointment.doctor.toString());

    if (
      String(appointment.patient) !== String(req.user.userId) &&
      String(appointment.doctor) !== String(req.user.userId)
    ) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this appointment" });
    }

    appointment.status = "cancelled";
    await appointment.save();

    res.json({
      success: true,
      message: "Appointment cancelled",
      data: appointment,
    });
  } catch (err) {
    console.error("Cancel Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Update appointment status
// @route   PATCH /api/appointments/:id/status
// @access  Private (Doctor only)
exports.updateAppointmentStatus = async (req, res) => {
  try {
    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Access denied. Doctors only." });
    }

    const { status } = req.body;
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    if (String(appointment.doctor) !== String(req.user.userId)) {
      return res.status(403).json({ success: false, message: "Not authorized to update this appointment" });
    }

    appointment.status = status;
    await appointment.save();

    res.json({
      success: true,
      message: "Appointment status updated",
      data: appointment,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
