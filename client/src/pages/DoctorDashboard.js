import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import "./DoctorDashboard.css";

const DoctorDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState("");

  const token = localStorage.getItem("token");

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccessMessage("");

    if (!token || token.split('.').length !== 3) {
      setError("Invalid or missing token. Please login again.");
      setLoading(false);
      return;
    }

    try {
      const res = await axios.get("https://final-year-project-9ydn.onrender.com/api/appointments/doctor", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const appointmentsData = res.data.data || [];
      setAppointments(appointmentsData);
    } catch (err) {
      console.error("Error fetching appointments:", err);
      setError(err.response?.data?.message || "Failed to load appointments. Please try again later.");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const handleAccept = async (id) => {
    if (!token || token.split('.').length !== 3) {
      setError("Invalid or missing token. Please login again.");
      return;
    }

    try {
      setActionLoadingId(id);
      await axios.put(
        `https://final-year-project-9ydn.onrender.com/api/appointments/${id}/accept`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setSuccessMessage("Appointment accepted successfully!");
      fetchAppointments();
    } catch (err) {
      console.error("Error accepting appointment:", err);
      setError(err.response?.data?.message || "Failed to accept appointment.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (id) => {
    if (!token || token.split('.').length !== 3) {
      setError("Invalid or missing token. Please login again.");
      return;
    }

    try {
      setActionLoadingId(id);
      await axios.patch(
        `https://final-year-project-9ydn.onrender.com/api/appointments/${id}/cancel`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setSuccessMessage("Appointment cancelled successfully!");
      fetchAppointments();
    } catch (err) {
      console.error("Error cancelling appointment:", err);
      setError(err.response?.data?.message || "Failed to cancel appointment.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  if (!token || token.split('.').length !== 3) {
    return (
      <div className="doctor-dashboard">
        <h2>Doctor Dashboard</h2>
        <p style={{ color: "red" }}>Authorization token missing or malformed. Please login again.</p>
      </div>
    );
  }

  return (
    <div className="doctor-dashboard">
      <h2>Doctor Dashboard</h2>
      <h4>Appointments</h4>

      {loading && <p>Loading appointments...</p>}
      {error && <p className="error-message">{error}</p>}
      {successMessage && <p className="success-message">{successMessage}</p>}

      {!loading && appointments.length === 0 && (
        <p className="no-appointments">No appointments yet.</p>
      )}

      {!loading &&
        Array.isArray(appointments) &&
        appointments.map((appt) => (
          <div key={appt._id} className="appt-card">
            <p><strong>Patient:</strong> {appt.patient?.name || "Unknown Patient"}</p>
            <p><strong>Date:</strong> {formatDate(appt.date)}</p>
            <p><strong>Reason:</strong> {appt.purpose || "N/A"}</p>
            <p>
              <strong>Status:</strong>{" "}
              <span className={`status-badge status-${appt.status}`}>
                {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
              </span>
            </p>

            <div className="btn-group">
              {appt.status === "pending" && (
                <>
                  <button
                    className="accept"
                    onClick={() => handleAccept(appt._id)}
                    disabled={actionLoadingId === appt._id}
                  >
                    {actionLoadingId === appt._id ? "Processing..." : "Accept"}
                  </button>
                  <button
                    className="cancel"
                    onClick={() => handleCancel(appt._id)}
                    disabled={actionLoadingId === appt._id}
                  >
                    {actionLoadingId === appt._id ? "Processing..." : "Cancel"}
                  </button>
                </>
              )}
              {appt.status === "confirmed" && (
                <button
                  className="cancel"
                  onClick={() => handleCancel(appt._id)}
                  disabled={actionLoadingId === appt._id}
                >
                  {actionLoadingId === appt._id ? "Processing..." : "Cancel"}
                </button>
              )}
            </div>
          </div>
        ))}
    </div>
  );
};

export default DoctorDashboard;
