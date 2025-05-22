import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useLocation } from "react-router-dom";
import "./BookAppointment.css";

const BookAppointment = () => {
  const [formData, setFormData] = useState({ date: "", reason: "" });
  const [doctorId, setDoctorId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.doctorId) {
      setDoctorId(location.state.doctorId);
    }
  }, [location]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError(false);

    const token = localStorage.getItem("token");
    if (!token) {
      setMessage("You must be logged in to book an appointment.");
      setError(true);
      return;
    }

    try {
      await axios.post(
        "https://final-year-project-9ydn.onrender.com/api/appointments",
        {
          doctorId,
          date: formData.date, // Only date is sent
          purpose: formData.reason,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setMessage("Appointment booked successfully!");
      setError(false);
      setTimeout(() => navigate("/patient-dashboard"), 1800);
    } catch (err) {
      setMessage(err.response?.data?.message || "Booking failed. Try again.");
      setError(true);
    }
  };

  return (
    <div className="book-appointment-container">
      <h2 className="title">Book Appointment</h2>
      <form className="appointment-form" onSubmit={handleSubmit}>
        {/* Date input added */}
        <label htmlFor="date">Select Date</label>
        <input
          type="date"
          id="date"
          name="date"
          value={formData.date}
          onChange={handleChange}
          required
        />

        <label htmlFor="reason">Purpose</label>
        <textarea
          id="reason"
          name="reason"
          value={formData.reason}
          onChange={handleChange}
          placeholder="Describe the reason for your appointment"
          rows={4}
          required
        />

        <button type="submit" className="submit-btn">Book Appointment</button>
      </form>
      {message && (
        <p className={`message ${error ? "error" : "success"}`}>{message}</p>
      )}
    </div>
  );
};

export default BookAppointment;
