import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./DoctorDashboard.css";

const DoctorDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [doctorDetails, setDoctorDetails] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const appointmentsPerPage = 5;

  const token = localStorage.getItem("token");
  const navigate = useNavigate();

  const fetchDoctorDetails = useCallback(async () => {
    try {
      const res = await axios.get("https://final-year-project-9ydn.onrender.com/api/doctors/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDoctorDetails(res.data.data);
    } catch (err) {
      console.error("Error fetching doctor details:", err);
    }
  }, [token]);

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
      setAppointments(res.data.data || []);
    } catch (err) {
      console.error("Error fetching appointments:", err);
      setError(err.response?.data?.message || "Failed to load appointments. Please try again later.");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDoctorDetails();
    fetchAppointments();
  }, [fetchAppointments, fetchDoctorDetails]);

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

  const handleComplete = async (id) => {
    if (!token || token.split('.').length !== 3) {
      setError("Invalid or missing token. Please login again.");
      return;
    }

    try {
      setActionLoadingId(id);
      const res = await axios.patch(
        `https://final-year-project-9ydn.onrender.com/api/appointments/${id}/complete`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      console.log("Appointment completed:", res.data);
      setSuccessMessage("Appointment marked as completed!");
      fetchAppointments();
    } catch (err) {
      console.error("Error completing appointment:", err);
      setError(err.response?.data?.message || "Failed to complete appointment.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleViewDetails = (appt) => {
    setModalContent(`
      <h3>Appointment Details</h3>
      <p><strong>Patient:</strong> ${appt.patient?.name || "Unknown"}</p>
      <p><strong>Date:</strong> ${formatDateTime(appt.date)}</p>
      <p><strong>Status:</strong> ${appt.status}</p>
      <p><strong>Reason:</strong> ${appt.purpose || "N/A"}</p>
      <p><strong>Notes:</strong> ${appt.notes || "No additional notes"}</p>
      <p><strong>Patient Contact:</strong> ${appt.patient?.email || "N/A"}</p>
    `);
    setShowModal(true);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toISOString().split("T")[0];
  };

  const formatDateTime = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const filteredAppointments = appointments.filter(appt => {
    if (filter !== "all" && appt.status !== filter) return false;
    if (searchTerm &&
      !appt.patient?.name?.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !appt.purpose?.toLowerCase().includes(searchTerm.toLowerCase())
    ) return false;
    if (selectedDate && formatDate(appt.date) !== selectedDate) return false;
    return true;
  });

  const indexOfLastAppointment = currentPage * appointmentsPerPage;
  const indexOfFirstAppointment = indexOfLastAppointment - appointmentsPerPage;
  const currentAppointments = filteredAppointments.slice(indexOfFirstAppointment, indexOfLastAppointment);
  const totalPages = Math.ceil(filteredAppointments.length / appointmentsPerPage);
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

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
      <div className="dashboard-header">
        <div>
          <h2>Doctor Dashboard</h2>
          {doctorDetails && (
            <p className="welcome-message">
              Welcome, Dr. {doctorDetails.name} ({doctorDetails.specialization})
            </p>
          )}
        </div>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>

      <div className="dashboard-controls">
        <div className="filter-controls">
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setCurrentPage(1); }} className="filter-select">
            <option value="all">All Appointments</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>

          <input type="text" placeholder="Search by patient or reason..." value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="search-input"
          />

          <input type="date" value={selectedDate}
            onChange={(e) => { setSelectedDate(e.target.value); setCurrentPage(1); }}
            className="date-filter"
          />
        </div>
      </div>

      <div className="appointments-summary">
        <div className="summary-card"><h4>Total</h4><p>{appointments.length}</p></div>
        <div className="summary-card"><h4>Pending</h4><p>{appointments.filter(a => a.status === 'pending').length}</p></div>
        <div className="summary-card"><h4>Confirmed</h4><p>{appointments.filter(a => a.status === 'confirmed').length}</p></div>
        <div className="summary-card"><h4>Cancelled</h4><p>{appointments.filter(a => a.status === 'cancelled').length}</p></div>
        <div className="summary-card"><h4>Completed</h4><p>{appointments.filter(a => a.status === 'completed').length}</p></div>
      </div>

      {loading && <div className="loading-spinner">Loading appointments...</div>}
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {!loading && filteredAppointments.length === 0 && (
        <div className="no-appointments">No appointments found matching your criteria.</div>
      )}

      <div className="appointments-list">
        {currentAppointments.map((appt) => (
          <div key={appt._id} className="appt-card">
            <div className="appt-card-header">
              <h4>{appt.patient?.name || "Unknown Patient"}</h4>
              <span className={`status-badge status-${appt.status}`}>
                {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
              </span>
            </div>

            <div className="appt-card-body">
              <p><strong>Date:</strong> {formatDateTime(appt.date)}</p>
              <p><strong>Reason:</strong> {appt.purpose || "N/A"}</p>
              <p><strong>Contact:</strong> {appt.patient?.email || "N/A"}</p>
            </div>

            <div className="appt-card-footer">
              <button className="details-btn" onClick={() => handleViewDetails(appt)}>View Details</button>
              <div className="action-btns">
                {appt.status === "pending" && (
                  <>
                    <button className="accept-btn" onClick={() => handleAccept(appt._id)} disabled={actionLoadingId === appt._id}>
                      {actionLoadingId === appt._id ? "Processing..." : "Accept"}
                    </button>
                    <button className="cancel-btn" onClick={() => handleCancel(appt._id)} disabled={actionLoadingId === appt._id}>
                      {actionLoadingId === appt._id ? "Processing..." : "Cancel"}
                    </button>
                  </>
                )}
                {appt.status === "confirmed" && (
                  <>
                    <button className="complete-btn" onClick={() => handleComplete(appt._id)} disabled={actionLoadingId === appt._id}>
                      {actionLoadingId === appt._id ? "Processing..." : "Complete"}
                    </button>
                    <button className="cancel-btn" onClick={() => handleCancel(appt._id)} disabled={actionLoadingId === appt._id}>
                      {actionLoadingId === appt._id ? "Processing..." : "Cancel"}
                    </button>
                  </>
                )}
                {appt.status === "completed" && (
                  <span className="completed-label">✔ Completed</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredAppointments.length > appointmentsPerPage && (
        <div className="pagination">
          <button onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1}>Previous</button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} onClick={() => paginate(i + 1)} className={currentPage === i + 1 ? "active" : ""}>
              {i + 1}
            </button>
          ))}
          <button onClick={() => paginate(currentPage + 1)} disabled={currentPage === totalPages}>Next</button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div dangerouslySetInnerHTML={{ __html: modalContent }} />
            <button className="close-modal" onClick={() => setShowModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DoctorDashboard;
